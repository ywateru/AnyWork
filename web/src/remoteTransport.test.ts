import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RemoteTransport } from "./remoteTransport";

// Scheduling tests use a transparent codec. Actual clatterjs/snow authentication,
// ciphertext and PTY interoperability are exercised by remote-interop.mjs.
vi.mock("@lukeburns/clatterjs", () => ({
  NqHandshake: class {
    getNextMessageOverhead() {
      return 0;
    }
    writeMessage(data: Uint8Array, out: Uint8Array) {
      out.set(data);
      return data.length;
    }
    readMessage(data: Uint8Array, out: Uint8Array) {
      out.set(data);
      return data.length;
    }
    getRemoteStatic() {
      return new Uint8Array(32);
    }
    isFinished() {
      return true;
    }
    finalize() {
      return {
        sendVec: (data: Uint8Array) => data,
        receiveVec: (data: Uint8Array) => data,
      };
    }
  },
  noiseIk() {},
  chachaPoly: {},
  sha256H: {},
  x25519Keygen() {},
}));
const encode = new TextEncoder();
class Socket {
  static all: Socket[] = [];
  static renewalCapability = true;
  static acknowledge = true;
  onopen?: () => void;
  onmessage?: (event: { data: ArrayBuffer }) => void;
  onclose?: () => void;
  onerror?: () => void;
  bufferedAmount = 0;
  binaryType = "";
  frames: Record<string, unknown>[] = [];
  closed = false;
  constructor() {
    Socket.all.push(this);
    queueMicrotask(() => this.onopen?.());
  }
  send(data: Uint8Array) {
    const frame = JSON.parse(new TextDecoder().decode(data));
    this.frames.push(frame);
    if (frame.type === "auth")
      queueMicrotask(() =>
        this.receive({
          type: "ready",
          expiresAt: Date.now() / 1000 + 300,
          ...(Socket.renewalCapability ? { authRenewal: 1 } : {}),
        }),
      );
    if (frame.type === "auth.renew" && Socket.acknowledge)
      queueMicrotask(() =>
        this.receive({
          type: "auth.renewed",
          id: frame.id,
          expiresAt: Math.floor(Date.now() / 1000) + 300,
        }),
      );
    if (frame.type === "pty.open")
      queueMicrotask(() => this.receive({ type: "pty.ready", id: frame.id }));
  }
  receive(frame: unknown) {
    this.onmessage?.({ data: encode.encode(JSON.stringify(frame)).buffer });
  }
  close() {
    this.closed = true;
  }
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
  vi.stubGlobal("WebSocket", Socket);
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("document", new EventTarget());
  Socket.all = [];
  Socket.renewalCapability = true;
  Socket.acknowledge = true;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const connect = (getFreshAccessToken?: () => Promise<string>) =>
  RemoteTransport.connect({
    url: "https://fixture.trycloudflare.com",
    installationId: "fixture",
    publicKey: "A".repeat(43),
    accessToken: "initial-token",
    getFreshAccessToken,
  });
describe("short authorization leases on one encrypted connection", () => {
  it("renews repeatedly and preserves an existing HTTP request and PTY past the old expiry", async () => {
    const fresh = vi.fn(async () => "fresh-token");
    const remote = await connect(fresh);
    const ws = Socket.all[0];
    await vi.advanceTimersByTimeAsync(239000);
    const response = remote.request("/api/info");
    let settled = false;
    void response.then(() => {
      settled = true;
    });
    const events = { ready: vi.fn(), data: vi.fn(), closed: vi.fn() };
    const terminal = remote.terminal("fixture", events);
    await vi.advanceTimersByTimeAsync(62000);
    expect(fresh).toHaveBeenCalledOnce();
    expect(settled).toBe(false);
    expect(events.ready).toHaveBeenCalledOnce();
    expect(events.closed).not.toHaveBeenCalled();
    terminal.input("still-live");
    const requestId = ws.frames.find((frame) => frame.type === "request")!.id;
    ws.receive({
      type: "response",
      id: requestId,
      status: 200,
      contentType: "text/plain",
    });
    ws.receive({ type: "end", id: requestId });
    expect((await response).status).toBe(200);
    await vi.advanceTimersByTimeAsync(180000);
    expect(fresh).toHaveBeenCalledTimes(2);
    expect(Socket.all).toHaveLength(1);
    expect(ws.frames.filter((frame) => frame.type === "request")).toHaveLength(
      1,
    );
    expect(
      ws.frames.some(
        (frame) => frame.type === "pty.input" && frame.data === "still-live",
      ),
    ).toBe(true);
    remote.close();
  });
  it("bounds retained cancelled ACK exceptions across a long-lived connection", async () => {
    const remote = await connect();
    const internals = remote as unknown as {
      retiredAcks: Map<string, number>;
      acks: Map<string, unknown>;
      cancelRequest(id: string, code: string): void;
    };
    for (let n = 0; n < 1024; n++) internals.retiredAcks.set(`old${n}`, 1);
    internals.acks.set("cancelled", {
      received: 1,
      timer: setTimeout(() => {}, 10000),
      reject() {},
      resolve() {},
    });
    internals.cancelRequest("cancelled", "CANCELLED");
    expect(await remote.ended).toBe("SESSION_LIMIT");
    expect(internals.retiredAcks.size).toBe(0);
  });
  it("does not send new control frames to a legacy gateway", async () => {
    Socket.renewalCapability = false;
    const fresh = vi.fn(async () => "token");
    const remote = await connect(fresh);
    await vi.advanceTimersByTimeAsync(300001);
    expect(await remote.ended).toBe("AUTHORIZATION_EXPIRED");
    expect(fresh).not.toHaveBeenCalled();
  });
  it("cannot revive after a suspended tab expires while its token callback is pending", async () => {
    let finish!: (token: string) => void;
    const remote = await connect(
      () =>
        new Promise((done) => {
          finish = done;
        }),
    );
    await vi.advanceTimersByTimeAsync(240001);
    vi.setSystemTime(new Date("2030-01-01T00:05:01Z"));
    window.dispatchEvent(new Event("pageshow"));
    expect(await remote.ended).toBe("AUTHORIZATION_EXPIRED");
    finish("late-token");
    await Promise.resolve();
    expect(
      Socket.all[0].frames.some((frame) => frame.type === "auth.renew"),
    ).toBe(false);
  });
  it.each(["wrong-id", "same-expiry"])(
    "rejects a %s renewal ACK",
    async (kind) => {
      Socket.acknowledge = false;
      const remote = await connect(async () => "fresh-token");
      await vi.advanceTimersByTimeAsync(240001);
      Socket.all[0].receive({
        type: "auth.renewed",
        id: kind === "wrong-id" ? 2 : 1,
        expiresAt:
          kind === "same-expiry"
            ? new Date("2030-01-01T00:05:00Z").getTime() / 1000
            : Date.now() / 1000 + 300,
      });
      expect(await remote.ended).toBe("INVALID_FRAME");
    },
  );
  it("closes on refresh failure without replaying a business operation", async () => {
    const remote = await connect(async () => {
      throw new Error("unconfirmed exchange");
    });
    const response = remote.request("/api/sessions", {
      method: "POST",
      body: "{}",
    });
    void response.catch(() => {});
    await vi.advanceTimersByTimeAsync(240001);
    expect(await remote.ended).toBe("AUTHORIZATION_EXPIRED");
    expect(
      Socket.all[0].frames.filter((frame) => frame.type === "request"),
    ).toHaveLength(1);
    expect(
      Socket.all[0].frames.filter((frame) => frame.type === "auth.renew"),
    ).toHaveLength(0);
  });
  it("does not send a late token after explicit close", async () => {
    let finish!: (token: string) => void;
    const remote = await connect(
      () =>
        new Promise((done) => {
          finish = done;
        }),
    );
    await vi.advanceTimersByTimeAsync(240001);
    remote.close();
    finish("late-token");
    await Promise.resolve();
    expect(
      Socket.all[0].frames.some((frame) => frame.type === "auth.renew"),
    ).toBe(false);
  });
});
