import { describe, it, expect } from "vitest";
import { projectEvents } from "./events";
import { splitTurn, turnWorkLabel, groupActivity } from "./transcript";
import type { AgentEvent } from "./types";
const e = (
  method: string,
  params: any,
  seq: number,
  time = seq * 1000,
): AgentEvent => ({ method, params, seq, created_at: time, session_id: "s" });
describe("Codex turn disclosure", () => {
  it("groups the user, commentary and final answer into a real turn and counts work until the final starts", () => {
    const view = projectEvents([
      e("user/message", { text: "question" }, 1),
      e("turn/started", { turn: { id: "t" } }, 2),
      e(
        "item/completed",
        {
          item: {
            id: "c",
            type: "agentMessage",
            phase: "commentary",
            text: "working",
          },
        },
        3,
      ),
      e(
        "item/completed",
        { item: { id: "cmd", type: "commandExecution", status: "completed" } },
        4,
      ),
      e(
        "item/started",
        { item: { id: "a", type: "agentMessage", phase: "final_answer" } },
        5,
      ),
      e("item/agentMessage/delta", { itemId: "a", delta: "answer" }, 6),
      e("turn/completed", { turn: { id: "t", status: "completed" } }, 10),
    ]);
    expect(view.turns).toHaveLength(1);
    const turn = view.turns[0];
    expect(turn.id).toBe("t");
    const split = splitTurn(turn);
    expect(split.user[0].text).toBe("question");
    expect(split.activity.map((m) => m.id)).toEqual(["c", "cmd"]);
    expect(split.final?.text).toBe("answer");
    expect(split.collapsible).toBe(true);
    expect(turnWorkLabel(turn, split.activity)).toBe("用时 3 秒");
  });
  it("keeps live commentary expanded and errors outside the collapsed activity", () => {
    const view = projectEvents([
      e("turn/started", { turn: { id: "t" } }, 1),
      e(
        "item/completed",
        {
          item: {
            id: "c",
            type: "agentMessage",
            phase: "commentary",
            text: "working",
          },
        },
        2,
      ),
      e("error", { message: "failed" }, 3),
    ]);
    const split = splitTurn(view.turns[0], true);
    expect(split.final).toBeUndefined();
    expect(split.collapsible).toBe(false);
    expect(split.errors[0].text).toBe("failed");
  });
  it("separates historical turns without inventing duration from session timestamps", () => {
    const events = [
      e(
        "item/completed",
        {
          history_turn_id: "old",
          item: {
            id: "a",
            type: "agentMessage",
            phase: "commentary",
            text: "step",
          },
        },
        1,
      ),
      e(
        "item/completed",
        {
          history_turn_id: "old",
          item: {
            id: "b",
            type: "agentMessage",
            phase: "final_answer",
            text: "result",
          },
        },
        2,
      ),
      e("user/message", { history_turn_id: "new", text: "next" }, 3),
      e(
        "item/completed",
        {
          history_turn_id: "new",
          item: { id: "c", type: "agentMessage", text: "next result" },
        },
        4,
      ),
    ];
    const view = projectEvents(events);
    expect(view.turns).toHaveLength(2);
    const split = splitTurn(view.turns[0]);
    expect(split.final?.text).toBe("result");
    expect(turnWorkLabel(view.turns[0], split.activity)).toBe("1 条先前消息");
  });
  it("merges a paginated partial turn by turn id and does not hide a live unphased answer", () => {
    const view = projectEvents([
      e(
        "item/completed",
        { history_turn_id: "t", item: { id: "a", type: "commandExecution" } },
        1,
      ),
      e(
        "item/agentMessage/delta",
        { turnId: "t", itemId: "b", delta: "streaming" },
        2,
      ),
    ]);
    expect(view.turns).toHaveLength(1);
    expect(splitTurn(view.turns[0], true).final).toBeUndefined();
    expect(splitTurn(view.turns[0], true).activity).toHaveLength(2);
  });
});

describe("Codex activity units", () => {
  it("omits reasoning without splitting consecutive tools and preserves commentary boundaries", () => {
    const messages: any[] = [
      {
        id: "a",
        role: "tool",
        item: { type: "commandExecution", status: "completed" },
      },
      { id: "thought", role: "reasoning", text: "private reasoning" },
      {
        id: "b",
        role: "tool",
        item: { type: "commandExecution", status: "completed" },
      },
      { id: "c", role: "assistant", text: "progress" },
      {
        id: "d",
        role: "tool",
        item: { type: "commandExecution", status: "failed" },
      },
      { id: "e", role: "tool", item: { type: "imageView", path: "one.png" } },
      { id: "f", role: "tool", item: { type: "imageView", path: "two.png" } },
    ];
    expect(
      groupActivity(messages).map((g) => [g.kind, g.messages.map((m) => m.id)]),
    ).toEqual([
      ["tools", ["a", "b"]],
      ["message", ["c"]],
      ["message", ["d"]],
      ["images", ["e", "f"]],
    ]);
    const split = splitTurn({ id: "turn", status: "interrupted", messages });
    expect(split.activity.some((m) => m.role === "reasoning")).toBe(false);
    expect(split.collapsible).toBe(false);
  });
});
