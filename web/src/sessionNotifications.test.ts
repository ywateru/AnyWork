import { describe, expect, it } from "vitest";
import { noticeForEvent, resolveNotices } from "./sessionNotifications";
import type { AgentEvent } from "./types";
const event = (
  method: string,
  params = {},
  request_id?: number | string,
): AgentEvent => ({
  seq: 1,
  session_id: "one",
  method,
  params,
  request_id,
  created_at: 1,
});
describe("session notifications", () => {
  it("classifies completion, failure, permission and questions, ignoring streaming and user interruption", () => {
    expect(noticeForEvent(event("item/agentMessage/delta"), "test")).toBeNull();
    expect(
      noticeForEvent(
        event("turn/completed", { turn: { id: "t", status: "completed" } }),
        "test",
      )?.kind,
    ).toBe("complete");
    expect(
      noticeForEvent(
        event("turn/completed", { turn: { status: "failed" } }),
        "test",
      )?.kind,
    ).toBe("failure");
    expect(
      noticeForEvent(
        event("turn/completed", { turn: { status: "interrupted" } }),
        "test",
      ),
    ).toBeNull();
    expect(
      noticeForEvent(event("item/permissions/requestApproval", {}, 0), "test")
        ?.kind,
    ).toBe("approval");
    expect(
      noticeForEvent(event("item/tool/requestUserInput", {}, "q"), "test")
        ?.kind,
    ).toBe("question");
  });
  it("deduplicates by turn and request identity and preserves numeric/string request differences", () => {
    expect(
      noticeForEvent(event("turn/completed", { turn: { id: "t" } }), "a")?.id,
    ).toBe(
      noticeForEvent(
        { ...event("turn/completed", { turn: { id: "t" } }), seq: 42 },
        "b",
      )?.id,
    );
    expect(noticeForEvent(event("approval", {}, 1), "a")?.id).not.toBe(
      noticeForEvent(event("approval", {}, "1"), "a")?.id,
    );
  });
  it("resolves only the matching session and request, marking prompts handled elsewhere as read", () => {
    const a = noticeForEvent(event("approval", {}, 1), "a")!;
    const b = noticeForEvent(event("approval", {}, "1"), "a")!;
    const c = { ...a, id: "other", sessionId: "two" };
    const notices = [a, b, c];
    expect(resolveNotices(notices, event("item/delta"))).toBe(notices);
    const resolved = resolveNotices(
      notices,
      event("serverRequest/resolved", { requestId: 1 }),
    );
    expect(resolved[0]).toMatchObject({ resolved: true, read: true });
    expect(resolved[1].read).toBe(false);
    expect(resolved[2].read).toBe(false);
    expect(resolveNotices(resolved, event("turn/completed"))).toBe(resolved);
    expect(resolveNotices(resolved, event("plugin/exited"))[1].resolved).toBe(
      true,
    );
    expect(notices[0].read).toBe(false);
  });
  it("does not resolve a newer pending request when an older turn completion arrives after history", () => {
    const old = noticeForEvent(event("approval", { turnId: "old" }, 1), "a")!;
    const pending = noticeForEvent(
      event("approval", { turnId: "new" }, 2),
      "a",
    )!;
    const other = { ...old, id: "other", sessionId: "two" };
    const resolved = resolveNotices(
      [old, pending, other],
      event("turn/completed", { turn: { id: "old" } }),
    );
    expect(resolved[0]).toMatchObject({ read: true, resolved: true });
    expect(resolved[1]).toBe(pending);
    expect(resolved[2]).toBe(other);
    expect(
      resolveNotices(resolved, event("turn/completed", { turnId: "new" }))[1],
    ).toMatchObject({ read: true, resolved: true });
  });
  it("requires stable unambiguous turn identities and retains explicit request and exit resolution", () => {
    const pending = noticeForEvent(
      event("approval", { turnId: "new" }, 2),
      "a",
    )!;
    const notices = [pending];
    for (const params of [
      {},
      { turn: { id: "" } },
      { turn: { id: " " } },
      { turn: { id: 2 } },
      { turn: { id: "new" }, turnId: "old" },
    ])
      expect(resolveNotices(notices, event("turn/completed", params))).toBe(
        notices,
      );
    for (const turnId of [undefined, "", " ", 2]) {
      const unknown = noticeForEvent(event("approval", { turnId }, 2), "a")!;
      const current = [unknown];
      expect(unknown.turnId).toBeUndefined();
      expect(
        resolveNotices(
          current,
          event("turn/completed", { turn: { id: "new" } }),
        ),
      ).toBe(current);
      expect(
        resolveNotices(
          current,
          event("serverRequest/resolved", { requestId: 2 }),
        )[0],
      ).toMatchObject({ read: true, resolved: true });
      expect(resolveNotices(current, event("plugin/exited"))[0]).toMatchObject({
        read: true,
        resolved: true,
      });
    }
  });
});
