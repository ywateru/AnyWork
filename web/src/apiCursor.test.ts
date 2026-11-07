import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "./types";

let Api: typeof import("./api").Api;
beforeAll(async () => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  Api = (await import("./api")).Api;
});
afterEach(() => vi.restoreAllMocks());
const event = (seq: number): AgentEvent => ({
  seq,
  session_id: "visible",
  method: "user/message",
  params: { text: "visible" },
  created_at: 0,
});
function pollFixture() {
  const api = new Api({
    url: "https://fixture.trycloudflare.com",
    token: "test",
  });
  const controller = new AbortController();
  const receive = vi.fn();
  const request = vi.spyOn(api, "request");
  return { api, controller, receive, request };
}

describe("authenticated event cursor transport", () => {
  it("drains fully hidden pages using the scanned cursor and has_more", async () => {
    const { api, controller, receive, request } = pollFixture();
    request.mockResolvedValueOnce({ events: [], cursor: 500, has_more: true });
    request.mockResolvedValueOnce({
      events: [event(501)],
      cursor: 1000,
      has_more: true,
    });
    request.mockImplementationOnce(async () => {
      controller.abort();
      return { events: [], cursor: 1000, has_more: false };
    });
    await api.streamAll(0, receive, controller.signal);
    expect(request.mock.calls.map(([path]) => path)).toEqual([
      "/events/poll?after=0",
      "/events/poll?after=500",
      "/events/poll?after=1000",
    ]);
    expect(receive.mock.calls).toEqual([[event(501)]]);
  });

  it("retains legacy 500-event pagination when cursor metadata is absent", async () => {
    const { api, controller, receive, request } = pollFixture();
    request.mockResolvedValueOnce({
      events: Array.from({ length: 500 }, (_, i) => event(i + 1)),
    });
    request.mockImplementationOnce(async () => {
      controller.abort();
      return { events: [] };
    });
    await api.streamAll(0, receive, controller.signal);
    expect(request.mock.calls[1][0]).toBe("/events/poll?after=500");
    expect(receive).toHaveBeenCalledTimes(500);
  });

  it("never regresses a cursor or emits repeated events", async () => {
    const { api, controller, receive, request } = pollFixture();
    request.mockResolvedValueOnce({
      events: [event(3), event(11)],
      cursor: 2,
      has_more: true,
    });
    request.mockImplementationOnce(async () => {
      controller.abort();
      return { events: [], cursor: 8, has_more: false };
    });
    await api.streamAll(10, receive, controller.signal);
    expect(request.mock.calls[1][0]).toBe("/events/poll?after=11");
    expect(receive.mock.calls).toEqual([[event(11)]]);
  });

  it("fails instead of spinning on a has_more page without progress", async () => {
    const { api, controller, receive, request } = pollFixture();
    request.mockResolvedValue({ events: [], cursor: 10, has_more: true });
    await expect(api.streamAll(10, receive, controller.signal)).rejects.toThrow(
      "未推进",
    );
    expect(request).toHaveBeenCalledTimes(1);
    expect(receive).not.toHaveBeenCalled();
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid scanned cursor %s",
    async (cursor) => {
      const { api, controller, receive, request } = pollFixture();
      request.mockResolvedValue({ events: [], cursor, has_more: true });
      await expect(
        api.streamAll(0, receive, controller.signal),
      ).rejects.toThrow("无效");
    },
  );

  it("does not forward SSE checkpoint/extension frames as AgentEvents", async () => {
    const api = new Api({ url: "https://fixture.example", token: "test" });
    const wire = [
      "event: cursor\nid: 500\n\n",
      'event: cursor\nid: 600\ndata: {"cursor":600}\n\n',
      `id: 601\ndata: ${JSON.stringify(event(601))}\n\n`,
      `event: message\nid: 602\ndata: ${JSON.stringify(event(602))}\n\n`,
      ": keepalive\n\n",
    ].join("");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(wire, {
            headers: { "Content-Type": "text/event-stream" },
          }),
      ),
    );
    const receive = vi.fn();
    await api.streamAll(0, receive, new AbortController().signal);
    expect(receive.mock.calls).toEqual([[event(601)], [event(602)]]);
    vi.unstubAllGlobals();
  });
});
