import { describe, it, expect } from "vitest";
import { newestHistoryReset, prependHistory, refreshHistory } from "./history";
import { projectEvents } from "./events";
import type { AgentEvent } from "./types";
const e = (id: string, text = id): AgentEvent => ({
  seq: 1,
  session_id: "s",
  method: "user/message",
  params: { text, history_id: id, history_turn_id: "same-turn" },
  created_at: 0,
});
describe("history pagination", () => {
  it("replaces a complete merged desktop turn while retaining earlier turns", () => {
    const before = {
      ...e("before"),
      params: { ...e("before").params, history_turn_id: "earlier" },
    };
    expect(
      refreshHistory([before, e("optimistic"), e("native-old")], {
        events: [e("native", "confirmed")],
        replace_turn_ids: ["same-turn"],
        next_cursor: null,
      }),
    ).toEqual([before, e("native", "confirmed")]);
  });
  it("refreshes for native reversions and ignores replayed reset markers", () => {
    const events = [
      { ...e("a"), method: "history/reset", seq: 8 },
      { ...e("b"), method: "thread/reverted", seq: 12 },
      { ...e("c"), method: "turn/completed", seq: 14 },
    ];
    expect(newestHistoryReset(events, 0)).toBe(12);
    expect(newestHistoryReset(events, 8)).toBe(12);
    expect(newestHistoryReset(events, 12)).toBe(12);
    expect(newestHistoryReset([], 12)).toBe(12);
  });
  it("keeps user messages distinct even when pages reuse sequence numbers", () => {
    const events = prependHistory([e("new")], [e("old"), e("new")]);
    expect(projectEvents(events).messages.map((m) => m.id)).toEqual([
      "user-old",
      "user-new",
    ]);
  });
  it("refreshes the latest items without deleting older items in that same turn", () => {
    const old = [e("old"), e("new")];
    expect(
      refreshHistory(old, {
        events: [e("new", "updated"), e("newer")],
        next_cursor: null,
      }).map((x) => x.params.text),
    ).toEqual(["old", "updated", "newer"]);
    expect(refreshHistory(old, { events: [e("new")], next_cursor: null })).toBe(
      old,
    );
  });
});
