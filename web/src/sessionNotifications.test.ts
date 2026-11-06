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
    expect(resolveNotices(resolved, event("turn/completed"))[1].resolved).toBe(
      true,
    );
    expect(notices[0].read).toBe(false);
  });
});
