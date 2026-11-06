import { describe, expect, it } from "vitest";
import { sessionAgentSelection } from "./sessionAgentSelection";
import type { Plugin } from "./types";
const plugin = (id: string): Plugin => ({
  id,
  name: id,
  protocol_version: 1,
  capabilities: ["chat"],
});

describe("new conversation Agent ownership", () => {
  it("initializes a late empty choice from the actual catalog, preferring Codex", () => {
    expect(sessionAgentSelection("", [])).toBe("");
    expect(sessionAgentSelection("", [plugin("workbuddy")])).toBe("workbuddy");
    expect(
      sessionAgentSelection("", [plugin("workbuddy"), plugin("codex")]),
    ).toBe("codex");
  });
  it("retains a deliberate choice even when it disappears, without falling through to another Agent", () => {
    expect(sessionAgentSelection("workbuddy", [])).toBe("workbuddy");
    expect(sessionAgentSelection("workbuddy", [plugin("codex")])).toBe(
      "workbuddy",
    );
    expect(sessionAgentSelection("codex", [plugin("workbuddy")])).toBe("codex");
    expect(
      sessionAgentSelection("custom", [plugin("codex"), plugin("workbuddy")]),
    ).toBe("custom");
  });
});
