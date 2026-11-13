import type {
  BusinessTransport,
  TerminalChannel,
  TerminalEvents,
} from "../remoteTransport";
import {
  TRANSPORT_CHUNK as CHUNK,
  TRANSPORT_MAX_BODY as MAX_BODY,
  TRANSPORT_CLOSED_EVENT,
  publicTauri,
  type ClosedEvent,
  type ConnectRequest,
  type ConnectionEnded,
  type ConnectionInfo,
  type ConnectionRef,
  type OperationRef,
  type PtyEvent,
  type ResponseChunk,
  type ResponseHead,
  type TransportFailure,
} from "./transportTypes";

export class NativeTransportError extends Error implements TransportFailure {
  constructor(
    readonly code: string,
    readonly delivery: TransportFailure["delivery"] = "not_sent",
  ) {
    super(code);
    this.name = "NativeTransportError";
  }
}
function failure(value: unknown): NativeTransportError {
  if (value instanceof NativeTransportError) return value;
  if (
    value &&
    typeof value === "object" &&
    "code" in value &&
    typeof value.code === "string"
  ) {
    const delivery = "delivery" in value ? value.delivery : undefined;
    return new NativeTransportError(
      value.code,
      delivery === "not_sent" || delivery === "response_complete"
        ? delivery
        : "outcome_unknown",
    );
  }
  return new NativeTransportError("NATIVE_BRIDGE_FAILED", "outcome_unknown");
}
function encode(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}
function decode(value: string): Uint8Array {
  if (typeof value !== "string" || value.length > Math.ceil(CHUNK / 3) * 4)
    throw new NativeTransportError("INVALID_FRAME", "response_complete");
  let text: string;
  try {
    text = atob(value);
  } catch {
    throw new NativeTransportError("INVALID_FRAME", "response_complete");
  }
  if (text.length > CHUNK || btoa(text) !== value)
    throw new NativeTransportError("INVALID_FRAME", "response_complete");
  return Uint8Array.from(text, (c) => c.charCodeAt(0));
}
function same(a: ConnectionRef, b: ConnectionRef) {
  return a.connectionId === b.connectionId && a.generation === b.generation;
}
const MAX_FILE = 20 * 1024 * 1024;
function utf8Size(value: string): number {
  let size = 0;
  for (let index = 0; index < value.length && size <= MAX_BODY; index++) {
    const unit = value.charCodeAt(index);
    if (unit < 0x80) size++;
    else if (unit < 0x800) size += 2;
    else if (
      unit >= 0xd800 &&
      unit <= 0xdbff &&
      value.charCodeAt(index + 1) >= 0xdc00 &&
      value.charCodeAt(index + 1) <= 0xdfff
    ) {
      size += 4;
      index++;
    } else size += 3;
  }
  return size;
}
/** A lower bound only; multipart/URL encoding overhead is checked while reading. */
function knownBodySize(body: BodyInit | null | undefined): number {
  const fileSize = (blob: Blob) => {
    if (blob.size > MAX_FILE) throw new NativeTransportError("LIMIT_EXCEEDED");
    return blob.size;
  };
  if (body == null) return 0;
  if (body instanceof Blob) return fileSize(body);
  if (typeof body === "string") return utf8Size(body);
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body))
    return body.byteLength;
  let size = 0;
  if (body instanceof FormData) {
    for (const [, value] of body) {
      size += typeof value === "string" ? utf8Size(value) : fileSize(value);
      if (size > MAX_BODY) break;
    }
  } else if (body instanceof URLSearchParams) {
    for (const [key, value] of body) {
      size += utf8Size(key) + utf8Size(value);
      if (size > MAX_BODY) break;
    }
  }
  return size;
}

/** Business bytes go through Rust; this class owns only Web API / IPC adaptation. */
export class NativeTransport implements BusinessTransport {
  readonly scopeId: string;
  readonly ended: Promise<ConnectionEnded>;
  private end!: (value: ConnectionEnded) => void;
  private closed = false;
  private readonly requests = new Map<string, AbortController>();
  private readonly terminals = new Map<string, () => void>();
  private requestBytes = 0;
  private responseBytes = 0;
  private constructor(
    readonly connectionInfo: ConnectionInfo,
    private unlisten: () => void,
  ) {
    this.scopeId = connectionInfo.scopeId;
    this.ended = new Promise((resolve) => {
      this.end = resolve;
    });
  }
  static async connect(request: ConnectRequest): Promise<NativeTransport> {
    const api = publicTauri();
    let transport: NativeTransport | undefined;
    const early: ClosedEvent[] = [];
    // Install before invoking: the socket may end before connect's IPC reply arrives.
    const unlisten = await api.event.listen<ClosedEvent>(
      TRANSPORT_CLOSED_EVENT,
      ({ payload }) => {
        if (!payload?.connection || typeof payload.code !== "string") return;
        if (transport) {
          if (same(payload.connection, transport.connectionInfo))
            transport.finish(payload.code);
        } else {
          if (early.length === 4) early.shift();
          early.push(payload);
        }
      },
    );
    try {
      const info = await api.core.invoke<ConnectionInfo>(
        "mobile_transport_connect",
        { request },
      );
      if (
        !info ||
        typeof info.connectionId !== "string" ||
        !Number.isSafeInteger(info.generation) ||
        info.generation < 1 ||
        typeof info.scopeId !== "string" ||
        !info.scopeId
      )
        throw new NativeTransportError("INVALID_FRAME");
      transport = new NativeTransport(info, unlisten);
      const ended = early.find((event) => same(event.connection, info));
      if (ended) {
        transport.finish(ended.code);
        throw new NativeTransportError(ended.code);
      }
      return transport;
    } catch (error) {
      unlisten();
      throw failure(error);
    }
  }
  private operation(): OperationRef {
    if (this.closed) throw new NativeTransportError("CONNECTION_CLOSED");
    return {
      connection: {
        connectionId: this.connectionInfo.connectionId,
        generation: this.connectionInfo.generation,
      },
      operationId: crypto.randomUUID(),
    };
  }
  private async invoke<T>(name: string, request: unknown): Promise<T> {
    try {
      return await publicTauri().core.invoke<T>("mobile_transport_" + name, {
        request,
      });
    } catch (error) {
      throw failure(error);
    }
  }
  private cancel(operation: OperationRef) {
    void this.invoke("cancel", operation).catch(() => {});
  }
  async request(path: string, options: RequestInit = {}): Promise<Response> {
    if (this.requests.size >= 8)
      throw new NativeTransportError("LIMIT_EXCEEDED");
    if (!path.startsWith("/api/") || /[\\\r\n\0#]/.test(path))
      throw new NativeTransportError("INVALID_REQUEST");
    const operation = this.operation();
    const controller = new AbortController();
    const signal = controller.signal;
    const abort = () => {
      controller.abort();
      this.cancel(operation);
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    this.requests.set(operation.operationId, controller);
    let reserved = 0,
      responseReserved = 0;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const check = () => {
      if (options.signal?.aborted || signal.aborted || this.closed)
        throw new DOMException("The operation was aborted", "AbortError");
    };
    const wait = <T>(work: Promise<T>): Promise<T> =>
      new Promise((resolve, reject) => {
        let done = false;
        const finish = (value?: T, error?: unknown) => {
          if (done) return;
          done = true;
          signal.removeEventListener("abort", cancelled);
          if (error !== undefined) reject(error);
          else resolve(value as T);
        };
        const cancelled = () =>
          finish(
            undefined,
            new DOMException("The operation was aborted", "AbortError"),
          );
        signal.addEventListener("abort", cancelled, { once: true });
        work.then(
          (value) => finish(value),
          (error) => finish(undefined, error),
        );
        if (signal.aborted) cancelled();
      });
    try {
      check();
      // Reserve known bytes synchronously before Request can encode FormData or
      // read Blob data, including the budget held by concurrent requests.
      reserved = knownBodySize(options.body);
      if (this.requestBytes + reserved > MAX_BODY) {
        reserved = 0;
        throw new NativeTransportError("LIMIT_EXCEEDED");
      }
      this.requestBytes += reserved;
      const headers = new Headers(options.headers);
      // Credentials are never accepted from the React business surface.
      headers.delete("Authorization");
      const request = new Request("https://tauri.localhost" + path, {
        ...options,
        headers,
        signal,
      });
      reader = request.body?.getReader();
      const body: Uint8Array[] = [];
      let encodedSize = 0;
      if (reader)
        for (;;) {
          check();
          const item = await wait(reader.read());
          check();
          if (item.done) break;
          encodedSize += item.value.byteLength;
          const additional = Math.max(0, encodedSize - reserved);
          if (this.requestBytes + additional > MAX_BODY)
            throw new NativeTransportError("LIMIT_EXCEEDED");
          reserved += additional;
          this.requestBytes += additional;
          body.push(item.value);
        }
      await wait(
        this.invoke("http_begin", {
          ...operation,
          method: request.method,
          path,
          contentType: request.headers.get("Content-Type"),
          size: encodedSize,
        }),
      );
      check();
      let offset = 0;
      for (const bytes of body)
        for (let start = 0; start < bytes.length; start += CHUNK) {
          check();
          const chunk = bytes.subarray(start, start + CHUNK);
          const ack = await wait(
            this.invoke<{ received: number }>("http_write", {
              ...operation,
              offset,
              base64: encode(chunk),
            }),
          );
          check();
          offset += chunk.length;
          if (ack?.received !== offset)
            throw new NativeTransportError("INVALID_FRAME");
        }
      check();
      const head = await wait(
        this.invoke<ResponseHead>("http_finish", operation),
      );
      check();
      if (
        !head ||
        !Number.isInteger(head.status) ||
        head.status < 200 ||
        head.status > 599 ||
        !Number.isSafeInteger(head.size) ||
        head.size < 0 ||
        head.size > MAX_BODY ||
        (head.contentType != null &&
          (typeof head.contentType !== "string" ||
            head.contentType.length > 256))
      )
        throw new NativeTransportError("INVALID_FRAME", "response_complete");
      if (this.responseBytes + head.size > MAX_BODY)
        throw new NativeTransportError("LIMIT_EXCEEDED", "response_complete");
      this.responseBytes += head.size;
      responseReserved = head.size;
      const chunks: Uint8Array<ArrayBuffer>[] = [];
      let received = 0;
      for (;;) {
        check();
        const item = await wait(
          this.invoke<ResponseChunk>("http_read", operation),
        );
        check();
        if (!item || typeof item.done !== "boolean")
          throw new NativeTransportError("INVALID_FRAME", "response_complete");
        const bytes = decode(item.base64);
        received += bytes.length;
        if (received > head.size || (!item.done && bytes.length === 0))
          throw new NativeTransportError("INVALID_FRAME", "response_complete");
        chunks.push(bytes as Uint8Array<ArrayBuffer>);
        if (item.done) break;
      }
      if (received !== head.size)
        throw new NativeTransportError("INVALID_FRAME", "response_complete");
      const noBody = [204, 205, 304].includes(head.status);
      if (noBody && received !== 0)
        throw new NativeTransportError("INVALID_FRAME", "response_complete");
      return new Response(noBody ? null : new Blob(chunks), {
        status: head.status,
        headers: head.contentType ? { "Content-Type": head.contentType } : {},
      });
    } catch (error) {
      this.cancel(operation);
      if (signal.aborted || options.signal?.aborted || this.closed)
        throw new DOMException("The operation was aborted", "AbortError");
      throw error;
    } finally {
      options.signal?.removeEventListener("abort", abort);
      void reader?.cancel().catch(() => {});
      this.requestBytes -= reserved;
      this.responseBytes -= responseReserved;
      this.requests.delete(operation.operationId);
    }
  }
  terminal(sessionId: string, events: TerminalEvents): TerminalChannel {
    if (this.terminals.size >= 2)
      throw new NativeTransportError("LIMIT_EXCEEDED");
    const operation = this.operation();
    const channel = new (publicTauri().core.Channel)<PtyEvent>();
    let closed = false,
      ready = false,
      sequence = 0,
      pendingBytes = 0,
      pendingCommands = 0;
    let tail = Promise.resolve();
    const finish = () => {
      if (closed) return;
      closed = true;
      ready = false;
      channel.onmessage = () => {};
      this.terminals.delete(operation.operationId);
      events.closed();
    };
    const send = (request: Record<string, unknown>) => {
      if (closed || ++pendingCommands > 64) {
        close();
        return;
      }
      tail = tail
        .then(async () => {
          if (closed || this.closed) return;
          await this.invoke("pty", { ...operation, ...request });
        })
        .catch(() => close())
        .finally(() => {
          pendingCommands--;
        });
    };
    const close = () => {
      if (closed) return;
      finish();
      void this.invoke("pty", { ...operation, type: "close" }).catch(() => {});
    };
    this.terminals.set(operation.operationId, close);
    channel.onmessage = (event) => {
      if (closed || this.closed) return;
      if (
        !event ||
        !event.connection ||
        !same(event.connection, operation.connection) ||
        event.operationId !== operation.operationId ||
        event.sequence !== sequence + 1
      )
        return close();
      sequence = event.sequence;
      try {
        switch (event.type) {
          case "ready":
            if (ready) return close();
            ready = true;
            events.ready();
            break;
          case "data":
            if (!ready) return close();
            events.data(decode(event.base64));
            break;
          case "closed":
            finish();
            return;
          default:
            close();
            return;
        }
        send({ type: "ack", sequence });
      } catch {
        close();
      }
    };
    // Listener exists before the native peer can emit its first ready event.
    void this.invoke("pty", {
      ...operation,
      type: "open",
      sessionId,
      onEvent: channel,
    }).catch(() => close());
    return {
      input: (data) => {
        if (!ready || closed || this.closed) return;
        const bytes = new TextEncoder().encode(data).length;
        if (pendingBytes + bytes > 65_536) return close();
        pendingBytes += bytes;
        let chunk = "",
          size = 0;
        for (const character of data) {
          const length = new TextEncoder().encode(character).length;
          if (size + length > 8192) {
            send({ type: "input", data: chunk });
            chunk = "";
            size = 0;
          }
          chunk += character;
          size += length;
        }
        if (chunk) send({ type: "input", data: chunk });
        tail = tail.finally(() => {
          pendingBytes -= bytes;
        });
      },
      resize: (cols, rows) => {
        if (ready && !closed && Number.isFinite(cols) && Number.isFinite(rows))
          send({
            type: "resize",
            cols: Math.max(2, Math.min(500, Math.floor(cols))),
            rows: Math.max(2, Math.min(200, Math.floor(rows))),
          });
      },
      close,
    };
  }
  private finish(code: string) {
    if (this.closed) return;
    this.closed = true;
    this.unlisten();
    for (const request of this.requests.values()) request.abort();
    for (const close of [...this.terminals.values()]) close();
    this.end({ code });
  }
  close() {
    this.finish("CONNECTION_CLOSED");
    void this.invoke("close", {
      connectionId: this.connectionInfo.connectionId,
      generation: this.connectionInfo.generation,
    }).catch(() => {});
  }
}
export default NativeTransport;
