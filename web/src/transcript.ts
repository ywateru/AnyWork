import type { ConversationTurn, Message } from "./types";
export function splitTurn(
  turn: ConversationTurn,
  latestWorking = false,
  showReasoning = false,
) {
  const user = turn.messages.filter((m) => m.role === "user");
  const candidates = turn.messages.filter(
    (m) =>
      m.role === "assistant" &&
      m.item?.phase !== "commentary" &&
      m.item?.async !== true,
  );
  const explicit = [...candidates]
    .reverse()
    .find((m) => m.item?.phase === "final_answer");
  const complete = ["completed", "interrupted", "failed"].includes(turn.status);
  const final =
    explicit ||
    (!latestWorking && (complete || turn.status === "unknown")
      ? candidates.at(-1)
      : undefined);
  const finalIndex = final
    ? turn.messages.indexOf(final)
    : turn.messages.length;
  const after = final
    ? turn.messages
        .slice(finalIndex + 1)
        .filter(
          (m) =>
            m.role !== "user" &&
            m.role !== "error" &&
            (showReasoning || m.role !== "reasoning"),
        )
    : [];
  const activity = turn.messages
    .slice(0, finalIndex)
    .filter(
      (m) =>
        m.role !== "user" &&
        m !== final &&
        m.role !== "error" &&
        (showReasoning || m.role !== "reasoning"),
    );
  const errors = turn.messages.filter((m) => m.role === "error");
  const collapsible = (!!final || complete) && turn.status !== "interrupted";
  return { user, final, activity, after, errors, collapsible };
}
export function turnWorkLabel(turn: ConversationTurn, activity: Message[]) {
  // Historical snapshots without real timestamps must not inherit session updated_at.
  const finalTime = turn.finalStartedAt || splitTurn(turn).final?.startedAtMs;
  const end =
    finalTime && turn.startedAt && finalTime >= turn.startedAt
      ? finalTime
      : turn.completedAt;
  if (turn.startedAt && end && end >= turn.startedAt) {
    const seconds = Math.max(1, Math.round((end - turn.startedAt) / 1000));
    const minutes = Math.floor(seconds / 60),
      hours = Math.floor(minutes / 60);
    return `用时 ${hours ? `${hours} 小时 ${minutes % 60} 分钟` : minutes ? `${minutes} 分钟 ${seconds % 60} 秒` : `${seconds} 秒`}`;
  }
  return `${activity.length} 条先前消息`;
}

/** Consecutive completed activities share a summary; prose remains in sequence. */
export function groupActivity(messages: Message[]) {
  const groups: {
    kind: "images" | "tools" | "message";
    messages: Message[];
  }[] = [];
  for (const message of messages) {
    if (message.role === "reasoning") continue;
    const kind =
      message.item?.type === "imageView" && message.item.path
        ? "images"
        : message.item?.type === "commandExecution" &&
            message.item.status === "completed" &&
            !(
              typeof message.item.exitCode === "number" &&
              message.item.exitCode !== 0
            )
          ? "tools"
          : "message";
    const last = groups.at(-1);
    if (kind !== "message" && last?.kind === kind) last.messages.push(message);
    else groups.push({ kind, messages: [message] });
  }
  return groups;
}
