import type { AgentEvent } from "./types";
export type SessionNotice = {
  id: string;
  sessionId: string;
  kind: "complete" | "approval" | "question" | "failure";
  title: string;
  body: string;
  requestId?: string | number;
  turnId?: string;
  createdAt: number;
  read: boolean;
  resolved?: boolean;
};
function stableTurnId(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}
function completedTurnId(event: AgentEvent): string | undefined {
  const nested = event.params.turn?.id;
  const direct = event.params.turnId;
  if (nested !== undefined && direct !== undefined && nested !== direct)
    return undefined;
  return stableTurnId(nested !== undefined ? nested : direct);
}
export function noticeForEvent(
  event: AgentEvent,
  sessionTitle: string,
): SessionNotice | null {
  const p = event.params;
  const base = {
    sessionId: event.session_id,
    createdAt: event.created_at,
    read: false,
    body: sessionTitle || "未命名会话",
  };
  if (event.request_id != null && event.method !== "serverRequest/resolved") {
    const question = /requestUserInput|askUser|question/i.test(event.method);
    return {
      ...base,
      id: JSON.stringify([
        event.session_id,
        "request",
        typeof event.request_id,
        event.request_id,
        p.turnId ?? "",
      ]),
      requestId: event.request_id,
      turnId: stableTurnId(p.turnId),
      kind: question ? "question" : "approval",
      title: question ? "需要你回答" : "需要权限或确认",
    };
  }
  if (event.method !== "turn/completed") return null;
  const status = p.turn?.status || p.status || "completed";
  if (["interrupted", "cancelled", "canceled"].includes(status)) return null;
  const failed = status === "failed" || !!p.turn?.error || !!p.error;
  return {
    ...base,
    id: JSON.stringify([
      event.session_id,
      "turn",
      p.turn?.id || p.turnId || event.seq,
    ]),
    kind: failed ? "failure" : "complete",
    title: failed ? "会话执行失败" : "会话执行完成",
  };
}
export function resolveNotices(
  notices: SessionNotice[],
  event: AgentEvent,
): SessionNotice[] {
  let changed = false;
  const result = notices.map((n) => {
    if (n.sessionId !== event.session_id || n.requestId == null || n.resolved)
      return n;
    const matches =
      event.method === "serverRequest/resolved" &&
      typeof n.requestId === typeof event.params.requestId &&
      n.requestId === event.params.requestId;
    const completed =
      event.method === "turn/completed" &&
      n.turnId !== undefined &&
      n.turnId === completedTurnId(event);
    if (!matches && !completed && event.method !== "plugin/exited") return n;
    changed = true;
    return { ...n, resolved: true, read: true };
  });
  return changed ? result : notices;
}
