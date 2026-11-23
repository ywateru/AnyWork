import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RemoteTransport, type RemoteChannel } from "./remoteTransport";

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
  chachaPoly() {},
  sha256H() {},
  x25519Keygen() {},
}));

const encode = new TextEncoder();
const decode = new TextDecoder();
class Channel implements RemoteChannel {
  static all: Channel[] = [];
  static renewalCapability = true;
  static acknowledge = true;
  frames: Record<string, unknown>[] = [];
  closed = false;
  private incoming: Uint8Array[] = [];
  private waiters: ((value: Uint8Array) => void)[] = [];
  constructor() {
    Channel.all.push(this);
  }
  receive(frame: unknown) {
    const bytes = encode.encode(JSON.stringify(frame));
    const waiter = this.waiters.shift();
    if (waiter) waiter(bytes);
    else this.incoming.push(bytes);
  }
  readFrame(): Promise<Uint8Array> {
    const queued = this.incoming.shift();
    if (queued) return Promise.resolve(queued);
    if (this.closed) return Promise.reject(new Error("closed"));
    return new Promise((resolve, reject) => {
      this.waiters.push(resolve);
      Promise.resolve().then(() => {
        if (this.closed) reject(new Error("closed"));
      });
    });
  }
  async writeFrame(bytes: Uint8Array): Promise<void> {
    if (this.closed) throw new Error("closed");
    const frame = JSON.parse(decode.decode(bytes));
    this.frames.push(frame);
    if (frame.type === "auth")
      this.receive({
        type: "ready",
        expiresAt: Date.now() / 1000 + 300,
        ...(Channel.renewalCapability ? { authRenewal: 1 } : {}),
      });
    if (frame.type === "auth.renew" && Channel.acknowledge)
      this.receive({
        type: "auth.renewed",
        id: frame.id,
        expiresAt: Math.floor(Date.now() / 1000) + 300,
      });
    if (frame.type === "pty.open")
      this.receive({ type: "pty.ready", id: frame.id });
  }
  async close(): Promise<void> {
    this.closed = true;
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("document", new EventTarget());
  Channel.all = [];
  Channel.renewalCapability = true;
  Channel.acknowledge = true;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const connect = async (getFreshAccessToken?: () => Promise<string>) => {
  const channel = new Channel();
  const remote = await RemoteTransport.connect({
    channel,
    installationId: "fixture",
    publicKey: "A".repeat(43),
    accessToken: "initial-token",
    getFreshAccessToken,
  });
  return { remote, channel };
};

describe("short authorization leases on one encrypted connection", () => {
  it("renews repeatedly and preserves an existing HTTP request and PTY past the old expiry", async () => {
    const fresh = vi.fn(async () => "fresh-token");
    const { remote, channel } = await connect(fresh);
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
    const requestId = channel.frames.find(
      (frame) => frame.type === "request",
    )!.id;
    channel.receive({
      type: "response",
      id: requestId,
      status: 200,
      contentType: "text/plain",
    });
    channel.receive({ type: "end", id: requestId });
    expect((await response).status).toBe(200);
    await vi.advanceTimersByTimeAsync(180000);
    expect(fresh).toHaveBeenCalledTimes(2);
    expect(Channel.all).toHaveLength(1);
    expect(
      channel.frames.filter((frame) => frame.type === "request"),
    ).toHaveLength(1);
    expect(
      channel.frames.some(
        (frame) => frame.type === "pty.input" && frame.data === "still-live",
      ),
    ).toBe(true);
    remote.close();
  });

  it("bounds retained cancelled ACK exceptions across a long-lived connection", async () => {
    const { remote } = await connect();
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
    Channel.renewalCapability = false;
    const fresh = vi.fn(async () => "token");
    const { remote } = await connect(fresh);
    await vi.advanceTimersByTimeAsync(300001);
    expect(await remote.ended).toBe("AUTHORIZATION_EXPIRED");
    expect(fresh).not.toHaveBeenCalled();
  });

  it("cannot revive after a suspended tab expires while its token callback is pending", async () => {
    let finish!: (token: string) => void;
    const { remote, channel } = await connect(
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
    expect(channel.frames.some((frame) => frame.type === "auth.renew")).toBe(
      false,
    );
  });

  it.each(["wrong-id", "same-expiry"])(
    "rejects a %s renewal ACK",
    async (kind) => {
      Channel.acknowledge = false;
      const { remote, channel } = await connect(async () => "fresh-token");
      await vi.advanceTimersByTimeAsync(240001);
      channel.receive({
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
    const { remote, channel } = await connect(async () => {
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
      channel.frames.filter((frame) => frame.type === "request"),
    ).toHaveLength(1);
    expect(
      channel.frames.filter((frame) => frame.type === "auth.renew"),
    ).toHaveLength(0);
  });

  it("does not send a late token after explicit close", async () => {
    let finish!: (token: string) => void;
    const { remote, channel } = await connect(
      () =>
        new Promise((done) => {
          finish = done;
        }),
    );
    await vi.advanceTimersByTimeAsync(240001);
    remote.close();
    finish("late-token");
    await Promise.resolve();
    expect(channel.frames.some((frame) => frame.type === "auth.renew")).toBe(
      false,
    );
  });
});
