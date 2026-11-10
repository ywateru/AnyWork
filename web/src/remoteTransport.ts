import {
  NqHandshake,
  noiseIk,
  chachaPoly,
  sha256H,
  x25519Keygen,
  type TransportState,
} from "@lukeburns/clatterjs";

export interface TerminalEvents {
  ready(): void;
  data(bytes: Uint8Array): void;
  closed(): void;
}
export interface TerminalChannel {
  input(data: string): void;
  resize(cols: number, rows: number): void;
  close(): void;
}
export interface BusinessTransport {
  request(path: string, options?: RequestInit): Promise<Response>;
  terminal(sessionId: string, events: TerminalEvents): TerminalChannel;
  close(): void;
}
export class RemoteError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "RemoteError";
  }
}
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const MAX_BODY = 22 * 1024 * 1024;
const MAX_CHUNK = 32768;
function random(length: number) {
  return crypto.getRandomValues(new Uint8Array(length));
}
export function base64(bytes: Uint8Array): string {
  let result = "";
  for (let i = 0; i < bytes.length; i += 8192)
    result += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(result);
}
export function unbase64(value: string): Uint8Array {
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  )
    throw new RemoteError("INVALID_FRAME");
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}
export function publicKeyBytes(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value))
    throw new RemoteError("INVALID_DEVICE_KEY");
  const result = unbase64(
    value.replaceAll("-", "+").replaceAll("_", "/") + "=",
  );
  if (
    result.length !== 32 ||
    base64(result)
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/, "") !== value
  )
    throw new RemoteError("INVALID_DEVICE_KEY");
  return result;
}
export function browserHandshake(installationId: string, publicKey: string) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(installationId))
    throw new RemoteError("INVALID_DEVICE_ID");
  return new NqHandshake(noiseIk(), {
    initiator: true,
    prologue: encoder.encode(`AnyWork\0remote-v1\0${installationId}`),
    s: x25519Keygen(random),
    rs: publicKeyBytes(publicKey),
    cipher: chachaPoly,
    hash: sha256H,
    rng: random,
  });
}
interface Pending {
  resolve(response: Response): void;
  reject(error: unknown): void;
  parts: Uint8Array[];
  bytes: number;
  status?: number;
  contentType?: string;
  clean(): void;
}
interface Ack {
  received: number;
  resolve(): void;
  reject(error: unknown): void;
  timer: ReturnType<typeof setTimeout>;
}

/** One authenticated Noise session. No business operation is retried on a new session. */
export class RemoteTransport implements BusinessTransport {
  private pending = new Map<string, Pending>();
  private acks = new Map<string, Ack>();
  private retiredAcks = new Map<string, number>();
  private reportEnded!: (reason: string) => void;
  readonly ended = new Promise<string>((resolve) => {
    this.reportEnded = resolve;
  });
  private terminals = new Map<string, TerminalEvents>();
  private sequence = 0;
  private preparing = 0;
  private bodyBytes = 0;
  private expiresAt = Date.now() + 300000;
  private leaseEndsAt = performance.now() + 300000;
  private closed = false;
  private expiry?: ReturnType<typeof setTimeout>;
  private renewalTimer?: ReturnType<typeof setTimeout>;
  private renewalSequence = 0;
  private renewing?: number;
  private freshToken?: () => Promise<string>;
  private readonly checkResume = () => {
    if (this.expired())
      this.closeWithError(new RemoteError("AUTHORIZATION_EXPIRED"));
  };
  private constructor(
    private ws: WebSocket,
    private noise: TransportState,
  ) {
    ws.onmessage = (event) => {
      try {
        if (
          !(event.data instanceof ArrayBuffer) ||
          event.data.byteLength > 65535
        )
          throw new RemoteError("INVALID_FRAME");
        const data = JSON.parse(
          decoder.decode(this.noise.receiveVec(new Uint8Array(event.data))),
        );
        this.receive(data);
      } catch (error) {
        this.closeWithError(
          error instanceof RemoteError
            ? error
            : new RemoteError("INVALID_FRAME"),
        );
      }
    };
    ws.onerror = () =>
      this.closeWithError(new RemoteError("CONNECTION_CLOSED"));
    ws.onclose = () =>
      this.closeWithError(new RemoteError("CONNECTION_CLOSED"));
    window.addEventListener("pageshow", this.checkResume);
    document.addEventListener("visibilitychange", this.checkResume);
  }
  static async connect(options: {
    url: string;
    installationId: string;
    publicKey: string;
    accessToken: string;
    getFreshAccessToken?: () => Promise<string>;
    signal?: AbortSignal;
  }): Promise<RemoteTransport> {
    options.signal?.throwIfAborted();
    const address = new URL(options.url);
    if (
      address.protocol !== "https:" ||
      address.username ||
      address.password ||
      address.search ||
      address.hash ||
      address.pathname !== "/" ||
      !/^([a-z0-9]+-)*[a-z0-9]+\.trycloudflare\.com$/.test(address.hostname)
    )
      throw new RemoteError("INVALID_REMOTE_ADDRESS");
    address.protocol = "wss:";
    address.pathname = "/remote/v1/ws";
    const handshake = browserHandshake(
      options.installationId,
      options.publicKey,
    );
    const expected = publicKeyBytes(options.publicKey);
    const ws = new WebSocket(address.href);
    ws.binaryType = "arraybuffer";
    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", cancel);
      };
      const fail = (code: string) => {
        if (settled) return;
        settled = true;
        cleanup();
        ws.onclose = null;
        ws.onerror = null;
        ws.onmessage = null;
        ws.onopen = null;
        ws.close();
        reject(new RemoteError(code));
      };
      const cancel = () => fail("CANCELLED");
      const timer = setTimeout(() => fail("HANDSHAKE_TIMEOUT"), 10000);
      options.signal?.addEventListener("abort", cancel, { once: true });
      ws.onerror = () => fail("CONNECTION_FAILED");
      ws.onclose = () => fail("CONNECTION_CLOSED");
      ws.onopen = () => {
        try {
          const payload = encoder.encode(
            JSON.stringify({
              type: "auth",
              installationId: options.installationId,
              accessToken: options.accessToken,
            }),
          );
          const out = new Uint8Array(
            payload.length + handshake.getNextMessageOverhead(),
          );
          const length = handshake.writeMessage(payload, out);
          ws.send(out.slice(0, length));
        } catch {
          fail("HANDSHAKE_FAILED");
        }
      };
      ws.onmessage = (event) => {
        try {
          if (
            !(event.data instanceof ArrayBuffer) ||
            event.data.byteLength > 65535
          )
            throw new Error();
          const out = new Uint8Array(event.data.byteLength);
          const length = handshake.readMessage(new Uint8Array(event.data), out);
          const actual = handshake.getRemoteStatic();
          if (
            !actual ||
            actual.length !== expected.length ||
            actual.some((v, i) => v !== expected[i]) ||
            !handshake.isFinished()
          )
            throw new Error();
          const ready = JSON.parse(decoder.decode(out.subarray(0, length)));
          const ttl = ready.expiresAt * 1000 - Date.now();
          if (
            ready.type !== "ready" ||
            !Number.isSafeInteger(ready.expiresAt) ||
            ttl <= 0 ||
            ttl > 301000
          )
            throw new Error();
          if (options.signal?.aborted) {
            fail("CANCELLED");
            return;
          }
          settled = true;
          cleanup();
          const transport = new RemoteTransport(ws, handshake.finalize());
          if (ready.authRenewal === 1)
            transport.freshToken = options.getFreshAccessToken;
          transport.armLease(ready.expiresAt);
          resolve(transport);
        } catch {
          fail("HANDSHAKE_FAILED");
        }
      };
      if (options.signal?.aborted) cancel();
    });
  }
  async request(path: string, options: RequestInit = {}): Promise<Response> {
    options.signal?.throwIfAborted();
    this.assertActive();
    if (this.pending.size + this.preparing >= 8)
      throw new RemoteError("TOO_MANY_REQUESTS");
    const method = (options.method ?? "GET").toUpperCase();
    if (
      !["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method) ||
      !path.startsWith("/api/") ||
      path.includes("#")
    )
      throw new RemoteError("INVALID_REQUEST");
    this.preparing++;
    let bodyRequest: Request, bytes: Uint8Array;
    try {
      bodyRequest = new Request("https://body.invalid", {
        method: options.body ? "POST" : "GET",
        body: options.body,
        headers: options.headers,
      });
      bytes = new Uint8Array(await bodyRequest.arrayBuffer());
    } finally {
      this.preparing--;
    }
    options.signal?.throwIfAborted();
    if (bytes.byteLength + this.bodyBytes > MAX_BODY)
      throw new RemoteError("BODY_TOO_LARGE");
    const id = this.nextId();
    this.bodyBytes += bytes.length;
    const response = new Promise<Response>((resolve, reject) => {
      const abort = () => {
        this.cancelRequest(id, "CANCELLED");
      };
      const timer = setTimeout(
        () => this.cancelRequest(id, "REQUEST_TIMEOUT"),
        240000,
      );
      this.pending.set(id, {
        resolve,
        reject,
        parts: [],
        bytes: 0,
        clean: () => {
          this.bodyBytes -= bytes.length;
          clearTimeout(timer);
          options.signal?.removeEventListener("abort", abort);
        },
      });
      options.signal?.addEventListener("abort", abort, { once: true });
    });
    // Attach a handler before sending: cancellation may reject during backpressure.
    void response.catch(() => {});
    try {
      this.send({
        type: "request",
        id,
        method,
        path,
        size: bytes.length,
        ...(bodyRequest.headers.get("Content-Type")
          ? { contentType: bodyRequest.headers.get("Content-Type") }
          : {}),
      });
      for (let offset = 0; offset < bytes.length; offset += MAX_CHUNK) {
        options.signal?.throwIfAborted();
        if (!this.pending.has(id)) throw new RemoteError("CANCELLED");
        const part = bytes.subarray(offset, offset + MAX_CHUNK);
        const ack = this.waitAck(id, offset + part.length);
        this.send({ type: "chunk", id, data: base64(part) });
        await ack;
      }
      options.signal?.throwIfAborted();
      this.send({ type: "end", id });
    } catch (error) {
      this.reject(id, error);
    }
    return response;
  }
  terminal(sessionId: string, events: TerminalEvents): TerminalChannel {
    if (this.terminals.size >= 2) throw new RemoteError("TOO_MANY_TERMINALS");
    const id = this.nextId();
    this.terminals.set(id, events);
    this.send({ type: "pty.open", id, sessionId });
    let closed = false;
    return {
      input: (data) => {
        if (!closed && !this.closed) {
          let part = "",
            bytes = 0;
          for (const character of data) {
            const length = encoder.encode(character).length;
            if (bytes + length > 8192) {
              this.send({ type: "pty.input", id, data: part });
              part = "";
              bytes = 0;
            }
            part += character;
            bytes += length;
          }
          if (part) this.send({ type: "pty.input", id, data: part });
        }
      },
      resize: (cols, rows) => {
        if (!closed && !this.closed)
          this.send({
            type: "pty.resize",
            id,
            cols: Math.max(2, Math.min(500, cols)),
            rows: Math.max(2, Math.min(200, rows)),
          });
      },
      close: () => {
        if (closed) return;
        closed = true;
        if (!this.closed) this.send({ type: "pty.close", id });
        this.terminals.delete(id);
      },
    };
  }
  close() {
    this.closeWithError(new RemoteError("CONNECTION_CLOSED"));
  }
  private nextId() {
    if (!Number.isSafeInteger(++this.sequence))
      throw new RemoteError("SESSION_LIMIT");
    return "r" + this.sequence;
  }
  private send(value: unknown) {
    this.assertActive();
    const bytes = encoder.encode(JSON.stringify(value));
    if (bytes.length > 65519 || this.ws.bufferedAmount > 2 * 1024 * 1024) {
      this.closeWithError(new RemoteError("BACKPRESSURE"));
      throw new RemoteError("BACKPRESSURE");
    }
    this.ws.send(this.noise.sendVec(bytes));
  }
  private waitAck(id: string, received: number) {
    const promise = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.cancelRequest(id, "REQUEST_TIMEOUT");
      }, 15000);
      this.acks.set(id, { received, resolve, reject, timer });
    });
    void promise.catch(() => {});
    return promise;
  }
  private cancelRequest(id: string, code: string) {
    const ack = this.acks.get(id);
    if (ack) {
      // A cancelled chunk may never receive its final ACK. Bound retained exceptions
      // even when the underlying connection is renewed indefinitely.
      if (this.retiredAcks.size >= 1024)
        this.closeWithError(new RemoteError("SESSION_LIMIT"));
      else this.retiredAcks.set(id, ack.received);
    }
    try {
      if (!this.closed) this.send({ type: "cancel", id });
    } catch {
      /* reject below even if socket has already closed */
    }
    this.reject(id, new RemoteError(code));
  }
  private reject(id: string, error: unknown) {
    const pending = this.pending.get(id);
    if (pending) {
      this.pending.delete(id);
      pending.clean();
      pending.reject(error);
    }
    const ack = this.acks.get(id);
    if (ack) {
      this.acks.delete(id);
      clearTimeout(ack.timer);
      ack.reject(error);
    }
  }
  private receive(frame: Record<string, unknown>) {
    this.assertActive();
    if (frame?.type === "auth.renewed") {
      if (
        this.renewing === undefined ||
        frame.id !== this.renewing ||
        !Number.isSafeInteger(frame.expiresAt) ||
        (frame.expiresAt as number) * 1000 <= this.expiresAt ||
        (frame.expiresAt as number) * 1000 - Date.now() > 301000
      )
        throw new RemoteError("INVALID_FRAME");
      this.renewing = undefined;
      this.armLease(frame.expiresAt as number);
      return;
    }
    if (
      !frame ||
      typeof frame !== "object" ||
      typeof frame.id !== "string" ||
      typeof frame.type !== "string"
    )
      throw new RemoteError("INVALID_FRAME");
    const id = frame.id;
    if (frame.type === "ack") {
      const ack = this.acks.get(id);
      if (!ack) {
        const retired = this.retiredAcks.get(id);
        if (retired !== undefined && retired === frame.received) {
          this.retiredAcks.delete(id);
          return;
        }
        throw new RemoteError("INVALID_FRAME");
      }
      if (frame.received !== ack.received)
        throw new RemoteError("INVALID_FRAME");
      this.acks.delete(id);
      clearTimeout(ack.timer);
      ack.resolve();
      return;
    }
    const terminal = this.terminals.get(id);
    if (terminal) {
      if (frame.type === "pty.ready") terminal.ready();
      else if (frame.type === "pty.data" && typeof frame.data === "string") {
        const bytes = unbase64(frame.data);
        if (bytes.length > MAX_CHUNK) throw new Error();
        terminal.data(bytes);
      } else if (frame.type === "pty.closed" || frame.type === "error") {
        this.terminals.delete(id);
        terminal.closed();
      } else throw new RemoteError("INVALID_FRAME");
      return;
    }
    const pending = this.pending.get(id);
    if (!pending) return; // A cancelled request may have an already queued response.
    if (frame.type === "error") {
      this.reject(
        id,
        new RemoteError(
          typeof frame.code === "string" && /^[A-Z_]{1,64}$/.test(frame.code)
            ? frame.code
            : "REMOTE_FAILURE",
        ),
      );
      return;
    }
    if (frame.type === "response") {
      if (
        pending.status !== undefined ||
        !Number.isSafeInteger(frame.status) ||
        (frame.status as number) < 200 ||
        (frame.status as number) > 599 ||
        typeof frame.contentType !== "string" ||
        frame.contentType.length > 256
      )
        throw new RemoteError("INVALID_FRAME");
      pending.status = frame.status as number;
      pending.contentType = frame.contentType;
      return;
    }
    if (frame.type === "chunk") {
      if (pending.status === undefined || typeof frame.data !== "string")
        throw new RemoteError("INVALID_FRAME");
      const bytes = unbase64(frame.data);
      pending.bytes += bytes.length;
      if (bytes.length > MAX_CHUNK || pending.bytes > MAX_BODY)
        throw new RemoteError("BODY_TOO_LARGE");
      pending.parts.push(bytes);
      return;
    }
    if (frame.type === "end") {
      if (pending.status === undefined) throw new RemoteError("INVALID_FRAME");
      const body = new Uint8Array(pending.bytes);
      let offset = 0;
      for (const part of pending.parts) {
        body.set(part, offset);
        offset += part.length;
      }
      this.pending.delete(id);
      pending.clean();
      pending.resolve(
        new Response([204, 205, 304].includes(pending.status) ? null : body, {
          status: pending.status,
          headers: { "Content-Type": pending.contentType! },
        }),
      );
      return;
    }
    throw new RemoteError("INVALID_FRAME");
  }
  private closeWithError(error: RemoteError) {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.expiry);
    clearTimeout(this.renewalTimer);
    this.freshToken = undefined;
    this.renewing = undefined;
    window.removeEventListener("pageshow", this.checkResume);
    document.removeEventListener("visibilitychange", this.checkResume);
    this.ws.onmessage = null;
    this.ws.onerror = null;
    this.ws.onclose = null;
    this.ws.close();
    for (const id of this.pending.keys()) this.reject(id, error);
    for (const events of this.terminals.values()) events.closed();
    this.terminals.clear();
    this.retiredAcks.clear();
    this.reportEnded(error.code);
  }
  private expired() {
    return (
      Date.now() >= this.expiresAt || performance.now() >= this.leaseEndsAt
    );
  }
  private assertActive() {
    if (!this.closed && this.expired()) {
      this.closeWithError(new RemoteError("AUTHORIZATION_EXPIRED"));
      throw new RemoteError("AUTHORIZATION_EXPIRED");
    }
    if (this.closed) throw new RemoteError("CONNECTION_CLOSED");
  }
  private armLease(expiresAt: number) {
    const ttl = expiresAt * 1000 - Date.now();
    if (!Number.isSafeInteger(expiresAt) || ttl <= 0 || ttl > 301000) {
      this.closeWithError(new RemoteError("INVALID_FRAME"));
      return;
    }
    clearTimeout(this.expiry);
    clearTimeout(this.renewalTimer);
    this.expiresAt = expiresAt * 1000;
    this.leaseEndsAt = performance.now() + ttl;
    this.expiry = setTimeout(
      () => this.closeWithError(new RemoteError("AUTHORIZATION_EXPIRED")),
      ttl,
    );
    if (this.freshToken) {
      this.renewalTimer = setTimeout(
        () => void this.renewAuthorization(),
        Math.max(1, ttl - Math.min(60000, ttl / 3)),
      );
    }
  }
  private async renewAuthorization() {
    if (this.closed || !this.freshToken || this.renewing !== undefined) return;
    try {
      this.assertActive();
      const getToken = this.freshToken;
      const token = await getToken();
      // Logout, account changes and a suspended tab cannot revive an expired lease.
      this.assertActive();
      if (this.freshToken !== getToken) return;
      if (
        !token ||
        token.length > 16384 ||
        !Number.isSafeInteger(this.renewalSequence + 1)
      )
        throw new RemoteError("AUTHORIZATION_EXPIRED");
      this.renewing = ++this.renewalSequence;
      this.send({ type: "auth.renew", id: this.renewing, accessToken: token });
      // The old expiry remains armed until the matching authenticated ACK arrives.
    } catch {
      if (!this.closed)
        this.closeWithError(new RemoteError("AUTHORIZATION_EXPIRED"));
    }
  }
}
