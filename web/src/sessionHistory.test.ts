import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionHistoryCache } from "./sessionHistory";
import { projectEvents } from "./events";
import type { AgentEvent, Session } from "./types";
const session = (id: string, status = "idle", external = false): Session => ({
  id,
  thread_id: id,
  title: id,
  cwd: "/tmp",
  agent: "codex",
  model: null,
  policy: "manual",
  status,
  external,
  archived: false,
  created_at: 0,
  updated_at: 0,
});
const event = (
  id: string,
  seq: number,
  method = "user/message",
): AgentEvent => ({
  session_id: id,
  seq,
  method,
  params: { text: String(seq) },
  created_at: 0,
});
const page = (events: AgentEvent[], cursor: string | null = null) => ({
  events,
  next_cursor: cursor,
});
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
const flush = async () => {
  for (let i = 0; i < 15; i++) await Promise.resolve();
};
const caches: SessionHistoryCache[] = [];
function fixture() {
  const histories = new Map<string, ReturnType<typeof page>>();
  const streams: {
    after: number;
    receive: (event: AgentEvent) => void;
    signal: AbortSignal;
    close: () => void;
  }[] = [];
  const api = {
    request: vi.fn(
      async (path: string, _options?: RequestInit): Promise<any> => {
        if (path === "/events/poll") return { events: [], cursor: 10 };
        if (path.endsWith("/connect")) return { connected: true };
        if (path.includes("/events/poll")) return { events: [] };
        const id = path.split("/")[2];
        return histories.get(id) || page([]);
      },
    ),
    post: vi.fn(),
    stream: vi.fn(
      async (
        _id: string,
        _after: number,
        _receive: (event: AgentEvent) => void,
        signal: AbortSignal,
      ) =>
        new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        ),
    ),
    streamAll: vi.fn(
      async (
        after: number,
        receive: (event: AgentEvent) => void,
        signal: AbortSignal,
      ) =>
        new Promise<void>((resolve) => {
          streams.push({ after, receive, signal, close: resolve });
          signal.addEventListener("abort", () => resolve(), { once: true });
        }),
    ),
  };
  const cache = new SessionHistoryCache(api);
  caches.push(cache);
  return { cache, api, streams, histories };
}
afterEach(() => {
  caches.splice(0).forEach((cache) => cache.dispose());
  vi.useRealTimers();
});
describe("session history lifecycle", () => {
  it("switches immediately from cache without another history request or stream", async () => {
    const { cache, api, histories, streams } = fixture();
    histories.set("a", page([event("a", 1)]));
    histories.set("b", page([event("b", 2)]));
    cache.start();
    cache.reconcile([session("a"), session("b")], "a");
    await flush();
    cache.reconcile([session("a"), session("b")], "b");
    await flush();
    const before = api.request.mock.calls.length,
      a = cache.get("a");
    cache.reconcile([session("a"), session("b")], "a");
    expect(cache.get("a")).toBe(a);
    expect(a.loaded).toBe(true);
    expect(a.events[0].seq).toBe(1);
    expect(api.request).toHaveBeenCalledTimes(before);
    expect(streams).toHaveLength(1);
    expect(streams[0].signal.aborted).toBe(false);
  });
  it("keeps every running chat subscribed in the background and deduplicates replay", async () => {
    const { cache, streams } = fixture();
    cache.start();
    cache.reconcile([session("a", "running"), session("b", "waiting")], "a");
    await flush();
    streams[0].receive(event("b", 11));
    streams[0].receive(event("b", 11));
    streams[0].receive(event("a", 12));
    cache.reconcile([session("a", "running"), session("b", "waiting")], "b");
    expect(cache.get("b").events.map((e) => e.seq)).toEqual([11]);
    expect(cache.get("a").events.map((e) => e.seq)).toEqual([12]);
    expect(streams).toHaveLength(1);
  });
  it("merges a delayed initial snapshot with concurrent live events in order", async () => {
    const { cache, api, streams } = fixture(),
      pending = deferred<ReturnType<typeof page>>();
    api.request.mockImplementation(async (path) =>
      path === "/events/poll" ? { events: [], cursor: 10 } : pending.promise,
    );
    cache.start();
    cache.reconcile([session("a")], "a");
    await flush();
    streams[0].receive(event("a", 12));
    pending.resolve(page([event("a", 1), event("a", 12)]));
    await flush();
    expect(cache.get("a").events.map((e) => e.seq)).toEqual([1, 12]);
  });
  it("converges compact completed history with older SSE deltas without duplicating final text", async () => {
    const { cache, streams, histories } = fixture();
    const text = "文档已准备好：[设计说明](/docs/guide.md)。";
    const packet = (seq: number, method: string, params: unknown) =>
      ({
        ...event("a", seq, method),
        params,
      }) as AgentEvent;
    const started = packet(11, "turn/started", { turn: { id: "t" } });
    const completed = packet(15, "item/completed", {
      turnId: "t",
      item: { id: "answer", type: "agentMessage", text },
    });
    const done = packet(16, "turn/completed", {
      turn: { id: "t", status: "completed" },
    });
    // The server's compact history omits started/delta events for completed items.
    histories.set("a", page([started, completed, done]));
    cache.start();
    cache.reconcile([session("a")], "a");
    await flush();
    const answer = () =>
      projectEvents(cache.get("a").events).messages.find(
        (message) => message.id === "answer",
      )?.text;
    expect(answer()).toBe(text);
    for (const replay of [
      started,
      packet(12, "item/started", {
        turnId: "t",
        item: { id: "answer", type: "agentMessage", text: "" },
      }),
      packet(13, "item/agentMessage/delta", {
        turnId: "t",
        itemId: "answer",
        delta: text,
      }),
      // Another item below the snapshot watermark must still be retained.
      packet(14, "item/agentMessage/delta", {
        turnId: "t",
        itemId: "other",
        delta: "并行进度",
      }),
      completed,
      done,
    ]) {
      streams[0].receive(replay);
      expect(answer()).toBe(text);
      const view = projectEvents(cache.get("a").events);
      expect(
        view.messages.find((message) => message.id === "answer")?.item?.status,
      ).toBe("completed");
      expect(view.turns.find((turn) => turn.id === "t")?.status).toBe(
        "completed",
      );
    }
    expect(cache.get("a").events.map((event) => event.seq)).toEqual([
      11, 12, 13, 14, 15, 16,
    ]);
    expect(
      projectEvents(cache.get("a").events).messages.find(
        (message) => message.id === "other",
      )?.text,
    ).toBe("并行进度");
  });
  it("retains distinct identical delta chunks and isolates matching item ids in another session", async () => {
    const { cache, streams } = fixture();
    cache.start();
    cache.reconcile([session("a", "running"), session("b", "running")], "a");
    await flush();
    const delta = (id: string, seq: number, text: string): AgentEvent => ({
      ...event(id, seq, "item/agentMessage/delta"),
      params: { turnId: "t", itemId: "same-item", delta: text },
    });
    streams[0].receive(delta("a", 11, "哈"));
    streams[0].receive(delta("a", 12, "哈"));
    streams[0].receive(delta("a", 12, "哈"));
    streams[0].receive(delta("b", 13, "另一个会话"));
    expect(projectEvents(cache.get("a").events).messages[0].text).toBe("哈哈");
    expect(projectEvents(cache.get("b").events).messages[0].text).toBe(
      "另一个会话",
    );
  });
  it("retains cached text and resumes from the global cursor after disconnect", async () => {
    vi.useFakeTimers();
    const { cache, streams } = fixture();
    cache.start();
    cache.reconcile([session("a")], "a");
    await flush();
    streams[0].receive(event("a", 11));
    streams[0].close();
    await flush();
    expect(cache.get("a").events).toHaveLength(1);
    expect(cache.get("a").streaming).toBe(false);
    await vi.advanceTimersByTimeAsync(1500);
    expect(streams).toHaveLength(2);
    expect(streams[1].after).toBe(11);
  });
  it("does not treat a transient network failure as an old server", async () => {
    vi.useFakeTimers();
    const { cache, api, streams } = fixture();
    api.request.mockRejectedValueOnce(new TypeError("fetch failed"));
    cache.start();
    cache.reconcile([session("a")], "a");
    await flush();
    expect(api.stream).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1500);
    expect(streams).toHaveLength(1);
    expect(api.stream).not.toHaveBeenCalled();
    expect(cache.get("a").loaded).toBe(true);
  });
  it("retains loaded older pages when the latest page changes", async () => {
    const { cache, histories } = fixture();
    histories.set("a", page([event("a", 8)], "older"));
    cache.start();
    cache.reconcile([session("a")], "a");
    await flush();
    histories.set("a", page([event("a", 1)], null));
    await cache.loadOlder("a");
    histories.set("a", page([event("a", 8), event("a", 12)], "older"));
    cache.refresh("a");
    await flush();
    expect(cache.get("a").events.map((e) => e.seq)).toEqual([1, 8, 12]);
    expect(cache.get("a").cursor).toBe(null);
  });
  it("retains loaded older pages when delayed reset is covered by the accepted snapshot", async () => {
    const { cache, api, histories, streams } = fixture();
    histories.set("a", {
      ...page([event("a", 15)], "older"),
      latest_seq: 16,
      source: "catalog",
    } as ReturnType<typeof page>);
    cache.start();
    cache.reconcile([session("a")], "a");
    await flush();
    histories.set("a", page([event("a", 1)], null));
    await cache.loadOlder("a");
    const before = api.request.mock.calls.length;
    streams[0].receive(event("a", 12, "thread/reverted"));
    await flush();
    expect(cache.get("a").events.map((e) => e.seq)).toEqual([1, 15]);
    expect(cache.get("a").cursor).toBeNull();
    expect(api.request).toHaveBeenCalledTimes(before);
  });
  it("invalidates an unreflected reset even after a newer ordinary event advanced the live cursor", async () => {
    const { cache, histories, streams } = fixture();
    histories.set("a", {
      ...page([event("a", 1)]),
      latest_seq: 10,
    } as ReturnType<typeof page>);
    cache.start();
    cache.reconcile([session("a")], "a");
    await flush();
    streams[0].receive(event("a", 30));
    histories.set("a", {
      ...page([event("a", 31)]),
      latest_seq: 31,
    } as ReturnType<typeof page>);
    cache.refresh("a");
    await flush();
    histories.set("a", {
      ...page([event("a", 32)]),
      latest_seq: 32,
    } as ReturnType<typeof page>);
    // Use the legacy per-entry receiver to exercise an out-of-order reset;
    // the shared stream independently rejects old global sequence numbers.
    (cache as any).receive(
      (cache as any).entries.get("a"),
      event("a", 20, "history/reset"),
    );
    await flush();
    expect(cache.get("a").events.map((e) => e.seq)).toEqual([32]);
  });
  it("does not cover a reset when live rows were merged during the first snapshot read", async () => {
    const { cache, api, histories, streams } = fixture();
    const pending = deferred<any>();
    api.request.mockImplementation(async (path) =>
      path === "/events/poll" ? { events: [], cursor: 10 } : pending.promise,
    );
    cache.start();
    cache.reconcile([session("a")], "a");
    await flush();
    streams[0].receive(event("a", 11));
    pending.resolve({ ...page([event("a", 20)]), latest_seq: 20 });
    await flush();
    api.request.mockResolvedValue({
      ...page([event("a", 21)]),
      latest_seq: 21,
    });
    streams[0].receive(event("a", 15, "history/reset"));
    await flush();
    expect(cache.get("a").events.map((e) => e.seq)).toEqual([21]);
  });
  it("replaces snapshot coverage when the history source changes", async () => {
    const { cache, histories, streams } = fixture();
    histories.set("a", {
      ...page([event("a", 90)]),
      latest_seq: 100,
      source: "catalog",
    } as ReturnType<typeof page>);
    cache.start();
    cache.reconcile([session("a")], "a");
    await flush();
    histories.set("a", {
      ...page([event("a", 5)]),
      latest_seq: 10,
      source: "desktop",
    } as ReturnType<typeof page>);
    cache.refresh("a");
    await flush();
    histories.set("a", {
      ...page([event("a", 51)]),
      latest_seq: 51,
      source: "desktop",
    } as ReturnType<typeof page>);
    streams[0].receive(event("a", 50, "history/reset"));
    await flush();
    expect(cache.get("a").events.map((e) => e.seq)).toEqual([51]);
  });
  it("discards stale in-flight reads and pagination after a history reset", async () => {
    vi.useFakeTimers();
    const { cache, api, histories, streams } = fixture();
    histories.set("a", page([event("a", 1)], "old"));
    cache.start();
    cache.reconcile([session("a")], "a");
    await flush();
    const pending = deferred<ReturnType<typeof page>>();
    api.request.mockImplementationOnce(async () => pending.promise);
    const older = cache.loadOlder("a");
    histories.set("a", page([event("a", 13)]));
    streams[0].receive(event("a", 14, "history/reset"));
    await flush();
    pending.resolve(page([event("a", 0)]));
    await older;
    expect(cache.get("a").events.map((e) => e.seq)).toEqual([13]);
    expect(cache.get("a").cursor).toBeNull();
    expect(cache.get("a").olderLoading).toBe(false);
  });
  it("preserves messages on refresh error and retries attach immediately on request", async () => {
    const { cache, api, histories } = fixture();
    histories.set("a", page([event("a", 1)]));
    api.request.mockImplementation(async (path) =>
      path === "/events/poll"
        ? { events: [], cursor: 10 }
        : path.endsWith("/connect")
          ? { connected: false, reason: "offline" }
          : histories.get("a"),
    );
    cache.start();
    cache.reconcile([session("a", "running", true)], "a");
    await flush();
    api.request.mockRejectedValueOnce(new Error("history offline"));
    cache.refresh("a");
    await flush();
    expect(cache.get("a").events).toHaveLength(1);
    expect(cache.get("a").error).toBe("history offline");
    const before = api.request.mock.calls.filter(([p]) =>
      p.endsWith("/connect"),
    ).length;
    cache.retry("a");
    await flush();
    expect(
      api.request.mock.calls.filter(([p]) => p.endsWith("/connect")),
    ).toHaveLength(before + 1);
  });
  it("coalesces external updates and refreshes goal controls", async () => {
    vi.useFakeTimers();
    const { cache, api, histories, streams } = fixture();
    histories.set("a", page([event("a", 1)]));
    cache.start();
    cache.reconcile([session("a", "running", true)], "a");
    await flush();
    await vi.advanceTimersByTimeAsync(200);
    const before = api.request.mock.calls.filter(([p]) =>
      p.includes("/history"),
    ).length;
    histories.set("a", page([event("a", 2)]));
    streams[0].receive(event("a", 11, "thread/history/updated"));
    streams[0].receive(event("a", 12, "thread/goal/updated"));
    await vi.advanceTimersByTimeAsync(200);
    expect(cache.get("a").events.map((e) => e.seq)).toEqual([1, 2]);
    expect(cache.get("a").settingsVersion).toBeGreaterThan(1);
    expect(
      api.request.mock.calls.filter(([p]) => p.includes("/history")),
    ).toHaveLength(before + 1);
  });
  it("disposes the old authentication scope and supports React strict remount", async () => {
    const { cache, streams } = fixture();
    cache.start();
    cache.reconcile([session("a")], "a");
    await flush();
    streams[0].receive(event("a", 11));
    cache.dispose();
    expect(streams[0].signal.aborted).toBe(true);
    expect(cache.get("a").events).toEqual([]);
    cache.start();
    cache.reconcile([session("b")], "b");
    await flush();
    expect(streams).toHaveLength(2);
    streams[0].receive(event("b", 50));
    expect(cache.get("b").events).toEqual([]);
    streams[1].receive(event("b", 12));
    expect(cache.get("b").events).toHaveLength(1);
  });
  it("pins active chats while evicting old idle caches and deleting removed chats", async () => {
    const { cache } = fixture();
    cache.start();
    const sessions = [
      session("running", "running"),
      ...Array.from({ length: 30 }, (_, i) => session(String(i))),
    ];
    for (let i = 0; i < 30; i++) {
      cache.reconcile(sessions, String(i));
      await flush();
    }
    expect(cache.get("running").loaded).toBe(true);
    expect(cache.get("0").loaded).toBe(false);
    expect(cache.get("29").loaded).toBe(true);
    cache.reconcile([session("running", "running")], "running");
    expect(cache.get("29").loaded).toBe(false);
  });
  it("hydrates pre-existing approvals without resurrecting a request resolved during hydration", async () => {
    const { cache, api, streams } = fixture();
    const pending = deferred<{ events: AgentEvent[] }>();
    api.request.mockImplementation(async (path) =>
      path === "/events/poll"
        ? { events: [], cursor: 10 }
        : path.includes("controls=true")
          ? pending.promise
          : path.endsWith("/connect")
            ? { connected: true }
            : page([]),
    );
    cache.start();
    cache.reconcile([session("a", "waiting", true)], "a");
    await flush();
    streams[0].receive({
      ...event("a", 11, "serverRequest/resolved"),
      params: { requestId: "pending" },
    });
    pending.resolve({
      events: [
        {
          ...event("a", 2, "item/commandExecution/requestApproval"),
          request_id: "pending",
        },
      ],
    });
    await flush();
    expect(cache.get("a").controls.map((e) => e.seq)).toEqual([2, 11]);
  });
  it("shares cached child transcripts across panel navigation without opening an idle engine", async () => {
    const { cache, api, histories } = fixture();
    histories.set("child", page([event("child", 1)]));
    cache.start();
    cache.reconcile(
      [session("parent"), session("child", "idle", true)],
      "parent",
    );
    await flush();
    const release = cache.watch("child");
    await flush();
    expect(cache.get("child").loaded).toBe(true);
    release();
    const before = api.request.mock.calls.length;
    const releaseAgain = cache.watch("child");
    await flush();
    expect(api.request).toHaveBeenCalledTimes(before);
    expect(
      api.request.mock.calls.some(([path]) => path.endsWith("/connect")),
    ).toBe(false);
    releaseAgain();
  });
  it("keeps per-chat connections alive when an older server has no shared stream", async () => {
    const { cache, api } = fixture();
    api.request.mockRejectedValueOnce(
      Object.assign(new Error("Not found"), { status: 404 }),
    );
    cache.start();
    cache.reconcile([session("a", "running"), session("b", "running")], "a");
    await flush();
    expect(api.stream).toHaveBeenCalledTimes(2);
    cache.reconcile([session("a", "running"), session("b", "running")], "b");
    expect(api.stream).toHaveBeenCalledTimes(2);
    expect(api.stream.mock.calls.every((call) => !call[3].aborted)).toBe(true);
  });
});
