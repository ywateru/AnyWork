import { describe, expect, it } from "vitest";
import {
  conversationTimestampSeparators,
  formatMessageTime,
  formatTimestampSeparator,
  validMessageTime,
} from "./messageTime";
import type { ConversationTurn } from "./types";

const hour = 36e5,
  now = new Date(2026, 10, 4, 16, 0).getTime();
function turn(
  time?: number,
  finalTime?: number,
  user = true,
): ConversationTurn {
  return {
    id: String(time),
    status: "completed",
    turnStartedAtMs: time,
    finalStartedAt: finalTime,
    messages: [
      ...(user ? [{ id: "u", role: "user" as const, text: "hello" }] : []),
      { id: "a", role: "assistant", text: "reply" },
    ],
  };
}

describe("native conversation times", () => {
  it("uses strict first-user and assistant-to-user hour thresholds", () => {
    expect(conversationTimestampSeparators([turn(now - hour)], now)).toEqual([
      null,
    ]);
    expect(
      conversationTimestampSeparators([turn(now - hour - 1)], now),
    ).toEqual([now - hour - 1]);
    const first = turn(now - hour, now - hour);
    expect(conversationTimestampSeparators([first, turn(now)], now)).toEqual([
      null,
      null,
    ]);
    expect(
      conversationTimestampSeparators([first, turn(now + 1)], now),
    ).toEqual([null, now + 1]);
  });
  it("uses ten minutes between assistant-only turns and resets unknown adjacency", () => {
    const first = turn(undefined, now - 6e5, false);
    expect(
      conversationTimestampSeparators(
        [first, turn(undefined, now, false)],
        now,
      ),
    ).toEqual([null, null]);
    expect(
      conversationTimestampSeparators(
        [first, turn(undefined, now + 1, false)],
        now,
      ),
    ).toEqual([null, now + 1]);
    expect(
      conversationTimestampSeparators([first, turn(), turn(now + hour)], now),
    ).toEqual([null, null, null]);
  });
  it("uses only known turn/user sources, with native turn time preferred for separators", () => {
    const known = turn(undefined);
    known.messages[0].createdAtMs = now - 2 * hour;
    expect(conversationTimestampSeparators([known], now)).toEqual([
      now - 2 * hour,
    ]);
    known.startedAt = now - 3 * hour;
    known.turnStartedAtMs = now - 4 * hour;
    expect(conversationTimestampSeparators([known], now)).toEqual([
      now - 4 * hour,
    ]);
    delete known.turnStartedAtMs;
    delete known.messages[0].createdAtMs;
    expect(conversationTimestampSeparators([known], now)).toEqual([null]);
  });
  it("formats day labels from local calendar days rather than elapsed 24-hour periods", () => {
    expect(
      formatTimestampSeparator(new Date(2026, 10, 4, 0, 1).getTime(), now).day,
    ).toBe("今天");
    expect(
      formatTimestampSeparator(new Date(2026, 10, 3, 23, 59).getTime(), now)
        .day,
    ).toBe("昨天");
    expect(
      formatTimestampSeparator(new Date(2026, 10, 2, 12).getTime(), now).day,
    ).toBe("星期一");
    expect(
      formatTimestampSeparator(new Date(2025, 0, 1, 12).getTime(), now).day,
    ).toContain("2025");
    expect(formatTimestampSeparator(now + 24 * hour, now).day).toBe("今天");
  });
  it("keeps footer dates short and changes the seventh previous day to month/day", () => {
    expect(formatMessageTime(now, now)).toBe("16:00");
    expect(
      formatMessageTime(new Date(2026, 9, 29, 12).getTime(), now),
    ).toContain("星期四");
    const seventh = formatMessageTime(new Date(2026, 9, 28, 12).getTime(), now);
    expect(seventh).toContain("10月28日");
    expect(seventh).not.toContain("星期");
  });
  it("rejects missing, nonnumeric and out-of-Date-range timestamps without coercion", () => {
    for (const value of [null, undefined, NaN, Infinity, "123", 8.64e15 + 1]) {
      expect(validMessageTime(value)).toBe(false);
      expect(formatMessageTime(value, now)).toBeNull();
    }
    expect(validMessageTime(0)).toBe(true);
    expect(validMessageTime(-1)).toBe(true);
  });
});
