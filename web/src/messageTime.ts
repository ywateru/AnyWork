import type { ConversationTurn } from "./types";

export function validMessageTime(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Math.abs(value) <= 8.64e15
  );
}

function calendarDays(left: Date, right: Date) {
  return (
    (Date.UTC(left.getFullYear(), left.getMonth(), left.getDate()) -
      Date.UTC(right.getFullYear(), right.getMonth(), right.getDate())) /
    864e5
  );
}

/** The ordinary user footer uses short time, weekday or month/day by recency. */
export function formatMessageTime(value: unknown, nowMs = Date.now()) {
  if (!validMessageTime(value)) return null;
  const date = new Date(value),
    days = calendarDays(date, new Date(nowMs));
  const options: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    minute: "2-digit",
  };
  if (days < 0 && days > -7) options.weekday = "long";
  else if (days !== 0) {
    options.month = "short";
    options.day = "numeric";
  }
  return new Intl.DateTimeFormat("zh-CN", options).format(date);
}

export function formatTimestampSeparator(value: number, nowMs = Date.now()) {
  const date = new Date(value),
    days = Math.max(calendarDays(new Date(nowMs), date), 0);
  const day =
    days <= 1
      ? new Intl.RelativeTimeFormat("zh-CN", { numeric: "auto" }).format(
          -days,
          "day",
        )
      : new Intl.DateTimeFormat(
          "zh-CN",
          days <= 7
            ? { weekday: "long" }
            : days <= 365
              ? { weekday: "short", month: "short", day: "numeric" }
              : { year: "numeric", month: "short", day: "numeric" },
        ).format(date);
  const time = new Intl.DateTimeFormat("zh-CN", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
  return { day, time };
}

/** Native local thread rules: first user older than 1h; assistant→user 1h, assistant→assistant 10m. */
export function conversationTimestampSeparators(
  turns: ConversationTurn[],
  nowMs = Date.now(),
) {
  let previous: {
    role: "user" | "assistant";
    time: number | undefined;
  } | null = null;
  let seenUser = false;
  return turns.map((turn) => {
    const entries: { role: "user" | "assistant"; time: number | undefined }[] =
      [];
    const user = turn.messages.find((message) => message.role === "user");
    if (user)
      entries.push({
        role: "user",
        time: turn.turnStartedAtMs ?? user.createdAtMs,
      });
    if (turn.messages.some((message) => message.role === "assistant"))
      entries.push({ role: "assistant", time: turn.finalStartedAt });
    let marker: number | null = null;
    for (const entry of entries) {
      if (
        marker === null &&
        validMessageTime(entry.time) &&
        ((entry.role === "user" && !seenUser && nowMs - entry.time > 36e5) ||
          (previous?.role === "assistant" &&
            validMessageTime(previous.time) &&
            entry.time - previous.time > (entry.role === "user" ? 36e5 : 6e5)))
      )
        marker = entry.time;
      seenUser ||= entry.role === "user";
      previous = entry;
    }
    return marker;
  });
}
