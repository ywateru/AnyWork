import { promptThreadHref } from "./promptText";
import type { Session } from "./types";
import type { ReviewRequest } from "./reviewDiff";

export interface ThreadLinkTarget {
  threadId: string;
  hostId: string | null;
  review?: ReviewRequest;
}

/** tla validates the composer URI more strictly than the general desktop router. */
export function threadLinkTarget(href: string): ThreadLinkTarget | null {
  const canonical = promptThreadHref(href);
  if (!canonical) return null;
  const url = new URL(canonical);
  return {
    threadId: url.pathname.slice(1),
    hostId: url.searchParams.get("hostId"),
  };
}

/** General Markdown routes use shared a9e/_et, independently of composer tla. */
export function messageThreadLinkTarget(href: string): ThreadLinkTarget | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== "codex:" || url.host !== "threads") return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (
    parts.length !== 1 ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      parts[0],
    )
  )
    return null;
  const target: ThreadLinkTarget = {
    threadId: parts[0],
    hostId: url.searchParams.get("hostId"),
  };
  if (url.searchParams.get("view") === "review") {
    const filter = url.searchParams.get("diffFilter");
    const path = url.searchParams.get("path");
    target.review =
      filter === "branch" || filter === "last-turn"
        ? { diffFilter: filter, ...(path ? { path } : {}) }
        : {};
  }
  return target;
}

export function localThreadTarget(target: ThreadLinkTarget) {
  return target.hostId == null || target.hostId === "local";
}

export function linkedSession(sessions: Session[], target: ThreadLinkTarget) {
  if (!localThreadTarget(target))
    throw new Error("此会话链接属于其他设备，请连接对应设备后打开。");
  const matches = sessions.filter(
    (session) =>
      session.agent === "codex" && session.thread_id === target.threadId,
  );
  if (matches.length > 1)
    throw new Error("当前服务器中有多个对应会话，无法确定要打开哪一个。");
  return matches[0] ?? null;
}

export function sessionReviewRoute(id: string, review?: ReviewRequest) {
  if (!review) return id;
  const params = new URLSearchParams({ view: "review" });
  if (review.diffFilter) params.set("diffFilter", review.diffFilter);
  if (review.diffFilter && review.path) params.set("path", review.path);
  return `${id}?${params}`;
}
export function sessionReviewTarget(
  route: string,
): { id: string; review: ReviewRequest } | null {
  const index = route.indexOf("?");
  if (index < 1 || !/^[a-zA-Z0-9_-]+$/.test(route.slice(0, index))) return null;
  const params = new URLSearchParams(route.slice(index + 1));
  if (
    params.get("view") !== "review" ||
    [...params.keys()].some(
      (key) => !["view", "diffFilter", "path"].includes(key),
    ) ||
    ["view", "diffFilter", "path"].some((key) => params.getAll(key).length > 1)
  )
    return null;
  const filter = params.get("diffFilter");
  if (filter != null && filter !== "branch" && filter !== "last-turn")
    return null;
  const path = params.get("path");
  return {
    id: route.slice(0, index),
    review: filter ? { diffFilter: filter, ...(path ? { path } : {}) } : {},
  };
}

// A Web tab resolves the native thread id against its authenticated local server.
// Connection credentials stay out of the URL; review paths retain authored intent.
export function threadLinkRoute(target: ThreadLinkTarget) {
  const route = `codex-thread/${target.threadId}`;
  if (!target.review) return route;
  const params = new URLSearchParams({ view: "review" });
  if (target.review.diffFilter)
    params.set("diffFilter", target.review.diffFilter);
  if (target.review.diffFilter && target.review.path)
    params.set("path", target.review.path);
  return `${route}?${params}`;
}

export function routeThreadTarget(route: string): ThreadLinkTarget | null {
  if (!route.startsWith("codex-thread/")) return null;
  const href = `codex://threads/${route.slice(13)}`;
  if (!route.includes("?")) return threadLinkTarget(href);
  const target = messageThreadLinkTarget(href);
  if (!target?.review) return null;
  const url = new URL(href);
  const filter = url.searchParams.get("diffFilter");
  if (
    url.hash ||
    (filter != null && filter !== "branch" && filter !== "last-turn") ||
    ["view", "diffFilter", "path"].some(
      (key) => url.searchParams.getAll(key).length > 1,
    ) ||
    [...url.searchParams.keys()].some(
      (key) => !["view", "diffFilter", "path"].includes(key),
    )
  )
    return null;
  return target;
}

export function threadLinkNewTab(
  event: { button?: number; metaKey?: boolean; ctrlKey?: boolean },
  platform: string,
) {
  return (
    event.button === 1 ||
    (/Mac|iPhone|iPad|iPod/.test(platform) ? event.metaKey : event.ctrlKey) ===
      true
  );
}
