import type { AgentEvent, Connection } from "./types";
import type { TerminalChannel, TerminalEvents } from "./remoteTransport";
const newClientId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
const clientId = (() => {
  try {
    const key = "anywork.client-id";
    let id = localStorage.getItem(key);
    if (!id) {
      id = newClientId();
      localStorage.setItem(key, id);
    }
    return id;
  } catch {
    return newClientId();
  }
})();
export class Api {
  constructor(public connection: Connection) {}
  url(path: string) {
    return this.connection.url.replace(/\/$/, "") + path;
  }
  async request<T = any>(path: string, options: RequestInit = {}): Promise<T> {
    const headers = new Headers(options.headers);
    if (!this.connection.transport)
      headers.set("Authorization", `Bearer ${this.connection.token}`);
    headers.set("X-AnyWork-Client-Id", clientId);
    if (options.body && !(options.body instanceof FormData))
      headers.set("Content-Type", "application/json");
    const response = this.connection.transport
      ? await this.connection.transport.request("/api" + path, {
          ...options,
          headers,
        })
      : await fetch(this.url("/api" + path), { ...options, headers });
    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ error: response.statusText }));
      throw Object.assign(
        new Error(error.error || `请求失败 (${response.status})`),
        { status: response.status },
      );
    }
    return response.json();
  }
  async binary(path: string, options: RequestInit = {}): Promise<Blob> {
    const headers = new Headers(options.headers);
    if (!this.connection.transport)
      headers.set("Authorization", `Bearer ${this.connection.token}`);
    headers.set("X-AnyWork-Client-Id", clientId);
    const response = this.connection.transport
      ? await this.connection.transport.request("/api" + path, {
          ...options,
          headers,
        })
      : await fetch(this.url("/api" + path), { ...options, headers });
    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ error: response.statusText }));
      throw new Error(error.error || `请求失败 (${response.status})`);
    }
    return response.blob();
  }
  terminal(id: string, events: TerminalEvents): TerminalChannel {
    if (this.connection.transport)
      return this.connection.transport.terminal(id, events);
    const ws = new WebSocket(
      this.url(`/ws/terminal/${id}`).replace(/^http/, "ws"),
    );
    ws.binaryType = "arraybuffer";
    ws.onopen = () => {
      ws.send(JSON.stringify({ token: this.connection.token }));
      events.ready();
    };
    ws.onmessage = (event) =>
      events.data(
        event.data instanceof ArrayBuffer
          ? new Uint8Array(event.data)
          : new TextEncoder().encode(event.data),
      );
    ws.onclose = events.closed;
    ws.onerror = events.closed;
    return {
      input: (data) => {
        if (ws.readyState === WebSocket.OPEN)
          ws.send(JSON.stringify({ type: "input", data }));
      },
      resize: (cols, rows) => {
        if (ws.readyState === WebSocket.OPEN)
          ws.send(JSON.stringify({ type: "resize", cols, rows }));
      },
      close: () => {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onclose = null;
        ws.onerror = null;
        ws.close();
      },
    };
  }
  post<T = any>(path: string, data: unknown = {}) {
    return this.request<T>(path, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }
  async stream(
    id: string,
    after: number,
    onEvent: (e: AgentEvent) => void,
    signal: AbortSignal,
  ) {
    return this.streamPath(`/sessions/${id}/events`, after, onEvent, signal);
  }
  async streamAll(
    after: number,
    onEvent: (e: AgentEvent) => void,
    signal: AbortSignal,
  ) {
    return this.streamPath("/events", after, onEvent, signal);
  }
  private async streamPath(
    path: string,
    after: number,
    onEvent: (e: AgentEvent) => void,
    signal: AbortSignal,
  ) {
    // Accountless Cloudflare tunnels do not support SSE. Keep event cursors and
    // use bounded JSON responses through that transport instead.
    if (
      this.connection.transport ||
      new URL(this.connection.url).hostname.endsWith(".trycloudflare.com")
    ) {
      let cursor = after;
      while (!signal.aborted) {
        const before = cursor;
        const page = await this.request<{
          events: AgentEvent[];
          cursor?: number;
          has_more?: boolean;
        }>(`${path}/poll?after=${cursor}`, { signal });
        for (const event of page.events) {
          if (event.seq <= cursor) continue;
          onEvent(event);
          cursor = event.seq;
        }
        if (page.cursor !== undefined) {
          if (!Number.isSafeInteger(page.cursor) || page.cursor < 0)
            throw new Error("服务返回了无效的事件游标");
          cursor = Math.max(cursor, page.cursor);
        }
        const hasMore =
          page.has_more === true ||
          (page.has_more === undefined && page.events.length === 500);
        if (hasMore) {
          if (cursor <= before) throw new Error("服务返回了未推进的事件游标");
          continue;
        }
        await new Promise<void>((resolve) => {
          const finish = () => {
            clearTimeout(timer);
            signal.removeEventListener("abort", finish);
            resolve();
          };
          const timer = setTimeout(finish, 1000);
          signal.addEventListener("abort", finish, { once: true });
          if (signal.aborted) finish();
        });
      }
      return;
    }
    const response = await fetch(this.url(`/api${path}?after=${after}`), {
      headers: {
        Authorization: `Bearer ${this.connection.token}`,
        "X-AnyWork-Client-Id": clientId,
      },
      signal,
    });
    if (!response.ok) throw new Error(`连接失败 (${response.status})`);
    const reader = response.body!.getReader(),
      decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder
          .decode(value, { stream: true })
          .replace(/\r\n/g, "\n");
        let end: number;
        while ((end = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const lines = block.split("\n");
          const eventName = lines.find((line) => line.startsWith("event:"));
          if (eventName && eventName.slice(6).trim() !== "message") continue;
          const data = lines
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).trimStart())
            .join("\n");
          if (data) onEvent(JSON.parse(data));
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
