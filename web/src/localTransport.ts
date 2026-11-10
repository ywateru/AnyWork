import type {
  BusinessTransport,
  TerminalChannel,
  TerminalEvents,
} from "./remoteTransport";
export interface LocalContext {
  accountLabel?: string;
  installationId?: string;
  remoteEnabled: boolean;
}
export class LocalSessionError extends Error {
  constructor(
    readonly code:
      | "LOCAL_SESSION_REQUIRED"
      | "LOCAL_SERVICE_UNAVAILABLE"
      | "LOCAL_CONTEXT_INVALID",
  ) {
    super(code);
  }
}
export function localContext(value: unknown): LocalContext {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new LocalSessionError("LOCAL_CONTEXT_INVALID");
  const data = value as Record<string, unknown>;
  if (
    typeof data.remoteEnabled !== "boolean" ||
    Object.keys(data).some(
      (key) =>
        !["accountLabel", "installationId", "remoteEnabled"].includes(key),
    ) ||
    (data.accountLabel !== undefined &&
      (typeof data.accountLabel !== "string" ||
        [...data.accountLabel].length > 80 ||
        /[\x00-\x1f\x7f]/.test(data.accountLabel))) ||
    (data.installationId !== undefined &&
      (typeof data.installationId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          data.installationId,
        )))
  )
    throw new LocalSessionError("LOCAL_CONTEXT_INVALID");
  return data as unknown as LocalContext;
}
export async function readLocalSession(ticket?: string): Promise<LocalContext> {
  const response = await fetch("/api/local/session", {
    method: ticket ? "POST" : "GET",
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
    headers: {
      Accept: "application/json",
      ...(ticket ? { "Content-Type": "application/json" } : {}),
    },
    ...(ticket ? { body: JSON.stringify({ ticket }) } : {}),
  });
  if (response.status === 401)
    throw new LocalSessionError("LOCAL_SESSION_REQUIRED");
  if (!response.ok) throw new LocalSessionError("LOCAL_SERVICE_UNAVAILABLE");
  return localContext(await response.json());
}
/** Same-origin HttpOnly-cookie transport. No local bearer is exposed to JS. */
export class LocalTransport implements BusinessTransport {
  private closed = false;
  private requests = new Set<AbortController>();
  private terminals = new Set<() => void>();
  private end!: () => void;
  readonly ended = new Promise<void>((resolve) => {
    this.end = resolve;
  });
  async request(path: string, options: RequestInit = {}) {
    if (this.closed) throw new LocalSessionError("LOCAL_SESSION_REQUIRED");
    if (
      !path.startsWith("/api/") ||
      path.startsWith("/api/service/") ||
      path.startsWith("/api/local/")
    )
      throw new LocalSessionError("LOCAL_SERVICE_UNAVAILABLE");
    const target = new URL(path, location.origin);
    if (target.origin !== location.origin)
      throw new LocalSessionError("LOCAL_SERVICE_UNAVAILABLE");
    const headers = new Headers(options.headers);
    headers.delete("Authorization");
    const controller = new AbortController();
    this.requests.add(controller);
    try {
      const signal = options.signal
        ? AbortSignal.any([options.signal, controller.signal])
        : controller.signal;
      const response = await fetch(target.href, {
        ...options,
        headers,
        signal,
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
      });
      if (response.status === 401) {
        this.close();
        throw new LocalSessionError("LOCAL_SESSION_REQUIRED");
      }
      // Keep the request cancellable through body consumption, including files.
      const body = await response.arrayBuffer();
      return new Response(
        [204, 205, 304].includes(response.status) ? null : body,
        {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        },
      );
    } finally {
      this.requests.delete(controller);
    }
  }

  terminal(id: string, events: TerminalEvents): TerminalChannel {
    if (this.closed || !/^[A-Za-z0-9_-]{1,128}$/.test(id))
      throw new LocalSessionError("LOCAL_SESSION_REQUIRED");
    const ws = new WebSocket(
      `${location.origin.replace(/^http/, "ws")}/ws/terminal/${id}`,
    );
    ws.binaryType = "arraybuffer";
    let finished = false,
      ready = false;
    const timer = setTimeout(() => close(), 10000);
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      this.terminals.delete(close);
      events.closed();
    };
    const close = () => {
      ws.onopen = null;
      ws.onmessage = null;
      ws.close();
      finish();
    };
    this.terminals.add(close);
    ws.onopen = () => {
      if (this.closed) return close();
      ws.send("anywork-local-session");
    };
    ws.onmessage = (event) => {
      if (!ready) {
        try {
          const ack =
            typeof event.data === "string" ? JSON.parse(event.data) : null;
          if (
            !ack ||
            ack.type !== "local.session.ready" ||
            Object.keys(ack).length !== 1
          )
            return close();
          ready = true;
          clearTimeout(timer);
          events.ready();
        } catch {
          close();
        }
        return;
      }
      events.data(
        event.data instanceof ArrayBuffer
          ? new Uint8Array(event.data)
          : new TextEncoder().encode(event.data),
      );
    };
    ws.onclose = finish;
    ws.onerror = finish;
    return {
      input(data) {
        if (ready && ws.readyState === WebSocket.OPEN)
          ws.send(JSON.stringify({ type: "input", data }));
      },
      resize(cols, rows) {
        if (ready && ws.readyState === WebSocket.OPEN)
          ws.send(JSON.stringify({ type: "resize", cols, rows }));
      },
      close,
    };
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    for (const request of this.requests) request.abort();
    this.requests.clear();
    for (const close of this.terminals) close();
    this.terminals.clear();
    this.end();
  }
}
