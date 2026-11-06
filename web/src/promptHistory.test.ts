import { describe, expect, it, vi } from "vitest";
import {
  appendHistory,
  appendPromptHistory,
  historyEntries,
  historyStringHasReferences,
  historyText,
  moveHistory,
  readPromptHistory,
  type PromptHistory,
} from "./promptHistory";

describe("native scoped prompt history", () => {
  it("isolates chats and only exposes a legacy array to the global scope", () => {
    expect(historyEntries(["old"], "global")).toEqual(["old"]);
    expect(historyEntries(["old"], "chat")).toEqual([]);
    const history = appendHistory(["old"], "chat", { markdown: "new" });
    expect(historyEntries(history, "global")).toEqual(["old"]);
    expect(historyEntries(history, "chat")).toEqual([{ markdown: "new" }]);
    expect(historyEntries(history, "other")).toEqual([]);
  });
  it("preserves duplicate submissions and only retains the newest 20", () => {
    let history: PromptHistory = {};
    for (let i = 0; i < 22; i++) history = appendHistory(history, "a", `${i}`);
    history = appendHistory(history, "a", "21");
    expect(historyEntries(history, "a")).toEqual([
      ...Array.from({ length: 19 }, (_, i) => `${i + 3}`),
      "21",
    ]);
    expect(appendHistory(history, "a", { plain: " \t\n" })).toBe(history);
  });
  it("evicts the oldest chat scope, preserving global scopes and updated scope order", () => {
    let history: PromptHistory = {
      global: ["global"],
      "chatgpt-global": ["chatgpt"],
    };
    for (let i = 0; i < 100; i++)
      history = appendHistory(history, `chat-${i}`, "x");
    history = appendHistory(history, "chat-0", "updated");
    history = appendHistory(history, "chat-100", "new");
    expect(historyEntries(history, "chat-1")).toEqual([]);
    expect(historyEntries(history, "chat-0")).toEqual(["x", "updated"]);
    expect(historyEntries(history, "global")).toEqual(["global"]);
    expect(historyEntries(history, "chatgpt-global")).toEqual(["chatgpt"]);
  });
  it("reads and writes own scopes without prototype aliases", () => {
    expect(historyEntries({}, "constructor")).toEqual([]);
    const result = appendHistory({}, "__proto__", "own");
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(historyEntries(result, "__proto__")).toEqual(["own"]);
  });
  it("starts only with Up from empty persisted text and wraps from oldest to newest", () => {
    const entries = ["first", { markdown: "**last**" }];
    expect(moveHistory(entries, null, "down", "")).toBeUndefined();
    expect(moveHistory(entries, null, "up", "current")).toBeUndefined();
    expect(moveHistory(entries, null, "up", "  \n")).toEqual({
      index: 1,
      entry: entries[1],
    });
    expect(moveHistory(entries, 1, "up", "**last**")).toEqual({
      index: 0,
      entry: entries[0],
    });
    expect(moveHistory(entries, 0, "up", "first")).toEqual({
      index: 1,
      entry: entries[1],
    });
  });
  it("Down clears after newest and edited or replaced history never overwrites a draft", () => {
    expect(moveHistory(["first", "last"], 1, "down", "last")).toEqual({
      index: null,
      entry: null,
    });
    expect(moveHistory(["first", "last"], 0, "down", "first")).toEqual({
      index: 1,
      entry: "last",
    });
    expect(moveHistory(["first"], 0, "up", "changed")).toBeUndefined();
    expect(moveHistory(["other"], 0, "up", "first")).toBeUndefined();
    expect(moveHistory([], null, "up", "")).toBeUndefined();
  });
  it("uses persisted Markdown for rich entries and plain text for older records", () => {
    expect(historyText("old")).toBe("old");
    expect(historyText({ plain: "**literal**" })).toBe("**literal**");
    expect(historyText({ markdown: "**formatted**" })).toBe("**formatted**");
    expect(historyStringHasReferences("**literal**")).toBe(false);
    expect(historyStringHasReferences("[file](src/main.ts)")).toBe(true);
    expect(
      historyStringHasReferences(
        "[web](codex-text-link://https://example.com)",
      ),
    ).toBe(true);
  });
  it("survives unavailable browser storage and isolates different servers", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    try {
      appendPromptHistory("https://history-a.invalid/", "a", "first");
      appendPromptHistory("https://history-a.invalid", "a", "last");
      expect(
        historyEntries(readPromptHistory("https://history-a.invalid"), "a"),
      ).toEqual(["first", "last"]);
      expect(
        historyEntries(readPromptHistory("https://history-b.invalid"), "a"),
      ).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("filters malformed persisted records without executing or merging their fields", () => {
    vi.stubGlobal("localStorage", {
      getItem: () =>
        JSON.stringify({
          a: [null, 3, { markdown: 4 }, "valid", { plain: "old" }],
          b: "invalid",
        }),
    });
    try {
      expect(readPromptHistory("https://history-data.invalid")).toEqual({
        a: ["valid", { plain: "old" }],
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("does not resurrect successfully saved history after storage is cleared or corrupted", () => {
    let saved: string | null = null;
    vi.stubGlobal("localStorage", {
      getItem: () => saved,
      setItem: (_key: string, value: string) => {
        saved = value;
      },
    });
    try {
      const server = "https://history-cleared.invalid";
      appendPromptHistory(server, "a", "saved");
      expect(historyEntries(readPromptHistory(server), "a")).toEqual(["saved"]);
      saved = null;
      expect(readPromptHistory(server)).toEqual({});
      saved = "invalid json";
      expect(readPromptHistory(server)).toEqual({});
      saved = "null";
      expect(readPromptHistory(server)).toEqual({});
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
