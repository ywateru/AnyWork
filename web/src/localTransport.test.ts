import { beforeEach, afterEach, expect, it, vi } from "vitest";
import {
  LocalTransport,
  localContext,
  readLocalSession,
} from "./localTransport";
class Socket {
  static last: Socket;
  static OPEN = 1;
  readyState = 1;
  frames: string[] = [];
  binaryType = "";
  onopen?: () => void;
  onmessage?: (event: { data: unknown }) => void;
  onclose?: () => void;
  onerror?: () => void;
  constructor(readonly url: string) {
    Socket.last = this;
  }
  send(frame: string) {
    this.frames.push(frame);
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}
beforeEach(() => {
  vi.stubGlobal("location", new URL("http://127.0.0.1:3219/"));
  vi.stubGlobal("WebSocket", Socket);
});
afterEach(() => {
  vi.unstubAllGlobals();
});
it("accepts bounded public Unicode context but rejects credentials or invalid IDs", () => {
  expect(
    localContext({ accountLabel: "😀".repeat(80), remoteEnabled: false })
      .accountLabel,
  ).toHaveLength(160);
  for (const data of [
    { accountLabel: "😀".repeat(81), remoteEnabled: false },
    { remoteEnabled: true, token: "secret" },
    { remoteEnabled: false, installationId: "not-a-uuid" },
  ])
    expect(() => localContext(data)).toThrow("LOCAL_CONTEXT_INVALID");
});
it("exchanges a RAM ticket once using same-origin no-store HTTP", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ remoteEnabled: false }), { status: 200 }),
    );
  vi.stubGlobal("fetch", fetch);
  await readLocalSession("synthetic-ticket");
  expect(fetch).toHaveBeenCalledWith(
    "/api/local/session",
    expect.objectContaining({
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      body: JSON.stringify({ ticket: "synthetic-ticket" }),
    }),
  );
});
it("waits for actual PTY authorization ACK and sends no bearer; 401 closes every child", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response("", { status: 401 }));
  vi.stubGlobal("fetch", fetch);
  const transport = new LocalTransport(),
    events = { ready: vi.fn(), data: vi.fn(), closed: vi.fn() };
  transport.terminal("fixture", events);
  Socket.last.onopen?.();
  expect(Socket.last.frames).toEqual(["anywork-local-session"]);
  expect(events.ready).not.toHaveBeenCalled();
  Socket.last.onmessage?.({
    data: JSON.stringify({ type: "local.session.ready" }),
  });
  expect(events.ready).toHaveBeenCalledOnce();
  await expect(
    transport.request("/api/info", {
      headers: { Authorization: "Bearer must-not-send" },
    }),
  ).rejects.toThrow("LOCAL_SESSION_REQUIRED");
  expect(new Headers(fetch.mock.calls[0][1].headers).has("Authorization")).toBe(
    false,
  );
  expect(events.closed).toHaveBeenCalledOnce();
  await transport.ended;
});
it("cannot route control/local APIs or another origin through the workspace adapter", async () => {
  const transport = new LocalTransport();
  for (const path of [
    "https://other.invalid/api/info",
    "//other.invalid/api/info",
    "/api/service/browser-ticket",
    "/api/local/session",
  ])
    await expect(transport.request(path)).rejects.toThrow();
  transport.close();
});
