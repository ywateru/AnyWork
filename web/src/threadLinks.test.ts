import { describe, expect, it } from "vitest";
import type { Session } from "./types";
import {
  linkedSession,
  sessionReviewRoute,
  sessionReviewTarget,
  messageThreadLinkTarget,
  routeThreadTarget,
  threadLinkNewTab,
  threadLinkRoute,
  threadLinkTarget,
} from "./threadLinks";

const id = "019b1234-1234-7123-8123-123456789abc";
const href = `codex://threads/${id}`;
const session = (value: Partial<Session> = {}): Session => ({
  id: "server-session",
  thread_id: id,
  agent: "codex",
  title: "linked conversation",
  cwd: "/workspace",
  model: null,
  policy: "manual",
  status: "idle",
  archived: false,
  created_at: 1,
  updated_at: 1,
  ...value,
});

describe("native composer conversation links", () => {
  it("extracts the exact native conversation and decoded host after strict validation", () => {
    expect(threadLinkTarget(` ${href}?hostId=local `)).toEqual({
      threadId: id,
      hostId: "local",
    });
    expect(threadLinkTarget(href)).toEqual({ threadId: id, hostId: null });
    expect(threadLinkTarget(`${href}?hostId=host%3Aone`)?.hostId).toBe(
      "host:one",
    );
    for (const suffix of [
      "/extra",
      "?view=review",
      "#turn",
      "?hostId=local&hostId=local",
    ])
      expect(threadLinkTarget(href + suffix)).toBeNull();
    expect(threadLinkTarget("codex://threads/not-uuid")).toBeNull();
  });
  it("resolves the native thread id rather than matching a title or server id", () => {
    const target = threadLinkTarget(href)!;
    const right = session();
    expect(
      linkedSession([session({ id, thread_id: null }), right], target),
    ).toBe(right);
    expect(linkedSession([session({ agent: "fixture" })], target)).toBeNull();
    expect(linkedSession([], target)).toBeNull();
  });
  it("can open archived native threads without changing archive state", () => {
    const archived = session({ archived: true, external: true });
    expect(linkedSession([archived], threadLinkTarget(href)!)).toBe(archived);
    expect(archived.archived).toBe(true);
  });
  it("rejects another host or ambiguous mappings rather than opening a different conversation", () => {
    expect(() =>
      linkedSession([session()], threadLinkTarget(`${href}?hostId=other`)!),
    ).toThrow("其他设备");
    expect(() =>
      linkedSession(
        [session(), session({ id: "second" })],
        threadLinkTarget(href)!,
      ),
    ).toThrow("多个");
  });
  it("round trips a Web tab route without host, credentials or filesystem context", () => {
    const target = threadLinkTarget(`${href}?hostId=local`)!;
    expect(threadLinkRoute(target)).toBe(`codex-thread/${id}`);
    expect(routeThreadTarget(threadLinkRoute(target))).toEqual({
      threadId: id,
      hostId: null,
    });
    expect(routeThreadTarget(`codex-thread/${id}?token=secret`)).toBeNull();
    expect(routeThreadTarget(id)).toBeNull();
  });
  it("uses the platform modifier or middle button for a new tab", () => {
    expect(threadLinkNewTab({ metaKey: true }, "MacIntel")).toBe(true);
    expect(threadLinkNewTab({ ctrlKey: true }, "MacIntel")).toBe(false);
    expect(threadLinkNewTab({ ctrlKey: true }, "Linux aarch64")).toBe(true);
    expect(threadLinkNewTab({ metaKey: true }, "Win32")).toBe(false);
    expect(threadLinkNewTab({ button: 1 }, "MacIntel")).toBe(true);
    expect(threadLinkNewTab({}, "Linux aarch64")).toBe(false);
  });
});

describe("native Markdown conversation routes", () => {
  it("accepts generic route syntax without weakening the composer validator", () => {
    for (const suffix of [
      "/",
      "?extra=ignored",
      "#fragment",
      "?hostId=local&hostId=other",
    ]) {
      expect(messageThreadLinkTarget(href + suffix)?.threadId).toBe(id);
      expect(threadLinkTarget(href + suffix)).toBeNull();
    }
    expect(messageThreadLinkTarget(`codex://threads///${id}//`)).toEqual({
      threadId: id,
      hostId: null,
    });
    expect(messageThreadLinkTarget(href + "?hostId=other")?.hostId).toBe(
      "other",
    );
  });
  it("retains review intent and the native conditional path rule", () => {
    expect(messageThreadLinkTarget(href + "?view=review")?.review).toEqual({});
    expect(
      messageThreadLinkTarget(href + "?view=review&path=a.ts")?.review,
    ).toEqual({});
    expect(
      messageThreadLinkTarget(
        href + "?view=review&diffFilter=branch&path=src%2Fa%20b.ts",
      )?.review,
    ).toEqual({ diffFilter: "branch", path: "src/a b.ts" });
    expect(
      messageThreadLinkTarget(href + "?view=review&diffFilter=last-turn&path=")
        ?.review,
    ).toEqual({ diffFilter: "last-turn" });
    expect(
      messageThreadLinkTarget(href + "?view=review&diffFilter=invalid&path=a")
        ?.review,
    ).toEqual({});
    expect(
      messageThreadLinkTarget(href + "?view=other&diffFilter=branch")?.review,
    ).toBeUndefined();
  });
  it("rejects invalid threads, nested routes and unrelated schemes", () => {
    for (const value of [
      "javascript:alert(1)",
      "data:text/html,x",
      `https://threads/${id}`,
      `codex://other/${id}`,
      "codex://threads/not-a-uuid",
      href + "/extra",
      `codex://threads/${id.replaceAll("-", "")}`,
      `codex://threads/${id.slice(0, -1)}%63`,
    ]) {
      expect(messageThreadLinkTarget(value)).toBeNull();
    }
  });
});

describe("review Web routes", () => {
  it("retains review source and Unicode path through both route forms", () => {
    const review = {
      diffFilter: "last-turn" as const,
      path: "src/中文 name.ts",
    };
    const target = { threadId: id, hostId: null, review };
    expect(routeThreadTarget(threadLinkRoute(target))).toEqual(target);
    expect(
      sessionReviewTarget(sessionReviewRoute("local-session", review)),
    ).toEqual({ id: "local-session", review });
    expect(
      sessionReviewTarget(sessionReviewRoute("local-session", {})),
    ).toEqual({ id: "local-session", review: {} });
    expect(sessionReviewRoute("local-session")).toBe("local-session");
  });
  it("rejects duplicated, unknown and invalid review parameters", () => {
    for (const suffix of [
      "?view=review&token=secret",
      "?view=review&view=review",
      "?view=review&diffFilter=bad",
      "?view=review&path=a&path=b",
      "?view=other",
    ]) {
      expect(sessionReviewTarget("local-session" + suffix)).toBeNull();
      expect(routeThreadTarget("codex-thread/" + id + suffix)).toBeNull();
    }
    expect(sessionReviewTarget("../session?view=review")).toBeNull();
  });
});
