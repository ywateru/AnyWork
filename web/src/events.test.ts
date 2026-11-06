import { describe, it, expect } from "vitest";
import { projectEvents } from "./events";
import type { AgentEvent } from "./types";
const event = (
  method: string,
  params: any,
  seq: number,
  request_id?: number,
): AgentEvent => ({
  seq,
  session_id: "s",
  method,
  params,
  request_id,
  created_at: 0,
});
describe("event projection", () => {
  it("enriches only an exact same-turn native echo without rewriting raw events or attachments", () => {
    const events = [
      event(
        "user/message",
        { text: "boilerplate", attachments: ["image.png"] },
        1,
      ),
      event("turn/started", { turn: { id: "t1" } }, 2),
      event(
        "item/started",
        {
          turnId: "t1",
          display_text: "正文 ## My request: 保留",
          item: {
            id: "u1",
            type: "userMessage",
            content: [
              { type: "text", text: "boilerplate" },
              { type: "text", text: "auxiliary" },
            ],
          },
        },
        3,
      ),
      event(
        "item/completed",
        {
          turnId: "t1",
          display_text: "",
          item: {
            id: "u1",
            type: "userMessage",
            content: [{ type: "text", text: "boilerplate" }],
          },
        },
        4,
      ),
      event("user/message", { text: "next" }, 5),
      event("turn/started", { turn: { id: "t2" } }, 6),
      event(
        "item/completed",
        {
          turnId: "t1",
          display_text: "first corrected",
          item: {
            id: "u1",
            type: "userMessage",
            content: [{ type: "text", text: "boilerplate" }],
          },
        },
        7,
      ),
    ];
    const before = JSON.stringify(events);
    const result = projectEvents(events);
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]).toMatchObject({
      text: "first corrected",
      attachments: ["image.png"],
    });
    expect(result.messages[1].text).toBe("next");
    expect(projectEvents(events.slice(0, 3)).messages[0].text).toBe(
      "正文 ## My request: 保留",
    );
    expect(projectEvents(events.slice(0, 4)).messages[0].text).toBe("");
    expect(JSON.stringify(events)).toBe(before);
  });
  it("never guesses native echo identity for ambiguous text or a different turn", () => {
    const result = projectEvents([
      event("user/message", { text: "same" }, 1),
      event("turn/started", { turn: { id: "t1" } }, 2),
      event("user/message", { text: "same" }, 3),
      event(
        "item/completed",
        {
          turnId: "t1",
          display_text: "must not replace",
          item: {
            id: "u1",
            type: "userMessage",
            content: [{ type: "text", text: "same" }],
          },
        },
        4,
      ),
      event(
        "item/completed",
        {
          turnId: "other",
          display_text: "must not replace",
          item: {
            id: "u2",
            type: "userMessage",
            content: [{ type: "text", text: "same" }],
          },
        },
        5,
      ),
    ]);
    expect(result.messages.map((message) => message.text)).toEqual([
      "same",
      "same",
    ]);
  });
  it("uses the authoritative native display body without applying request extraction again", () => {
    const display = "正文 ## My request: 这段不能再次提取";
    const events = [
      event("user/message", { text: "raw context", display_text: display }, 1),
      event(
        "user/message",
        { text: "hidden auxiliary context", display_text: "" },
        2,
      ),
    ];
    const before = JSON.stringify(events);
    expect(
      projectEvents(events).messages.map((message) => message.text),
    ).toEqual([display, ""]);
    expect(JSON.stringify(events)).toBe(before);
  });
  it("keeps malformed user text from interrupting the rest of a conversation", () => {
    const result = projectEvents([
      event("user/message", { text: { invalid: true } }, 1),
      event("user/message", { text: "valid follow-up" }, 2),
    ]);
    expect(result.messages.map((message) => message.text)).toEqual([
      "",
      "valid follow-up",
    ]);
  });
  it("displays native request text without rewriting its original context or assistant text", () => {
    const raw =
      "# Files mentioned by the user:\n- report.pdf\n\n## My request:\n核对 **报告**\n";
    const events = [
      event("user/message", { text: raw, attachments: ["report.pdf"] }, 1),
      event(
        "item/completed",
        { item: { id: "a", type: "agentMessage", text: raw } },
        2,
      ),
    ];
    const before = JSON.stringify(events);
    const result = projectEvents(events);
    expect(result.messages[0]).toMatchObject({
      text: "核对 **报告**",
      attachments: ["report.pdf"],
    });
    expect(result.messages[1].text).toBe(raw);
    expect(JSON.stringify(events)).toBe(before);
  });
  it("replaces streamed text with the authoritative completed item without duplicating it", () => {
    const result = projectEvents([
      event("item/agentMessage/delta", { itemId: "a", delta: "hel" }, 1),
      event("item/agentMessage/delta", { itemId: "a", delta: "lo" }, 2),
      event(
        "item/completed",
        { item: { id: "a", type: "agentMessage", text: "hello!" } },
        3,
      ),
    ]);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].text).toBe("hello!");
  });
  it("clears approvals at resolution, cancellation, disconnect and completion", () => {
    for (const method of [
      "serverRequest/resolved",
      "turn/completed",
      "plugin/exited",
      "connection/interrupted",
    ]) {
      const result = projectEvents([
        event(
          "item/commandExecution/requestApproval",
          { command: "echo hi" },
          1,
          9,
        ),
        event(method, { requestId: 9 }, 2),
      ]);
      expect(result.pending).toEqual([]);
    }
  });
  it("does not render the echoed upstream userMessage twice", () => {
    const result = projectEvents([
      event("user/message", { text: "hi" }, 1),
      event(
        "item/completed",
        { item: { id: "a", type: "userMessage", content: [{ text: "hi" }] } },
        2,
      ),
    ]);
    expect(result.messages).toHaveLength(1);
  });
  it("preserves user text and attachments separately, including literal Markdown", () => {
    const text = "**keep this literal**\n\n[design](docs/design.md)";
    const result = projectEvents([
      {
        ...event("user/message", { text, attachments: ["docs/design.md"] }, 1),
        created_at: 123456,
      },
    ]);
    expect(result.messages[0]).toMatchObject({
      text,
      attachments: ["docs/design.md"],
      createdAtMs: 123456,
    });
  });
  it("uses real historical item time and never labels an import time as a user message time", () => {
    const result = projectEvents([
      {
        ...event(
          "user/message",
          {
            text: "known",
            history_turn_id: "t1",
            history_item_started_at_ms: 123456,
          },
          1,
        ),
        created_at: 999999,
      },
      {
        ...event("user/message", { text: "unknown", history_turn_id: "t2" }, 2),
        created_at: 999999,
      },
    ]);
    expect(result.messages.map((message) => message.createdAtMs)).toEqual([
      123456,
      undefined,
    ]);
    for (const invalid of [null, NaN, Infinity, 8.64e15 + 1, "123456"])
      expect(
        projectEvents([
          event(
            "user/message",
            {
              text: "invalid",
              history_turn_id: "t3",
              history_item_started_at_ms: invalid,
            },
            1,
          ),
        ]).messages[0].createdAtMs,
      ).toBeUndefined();
  });
});
