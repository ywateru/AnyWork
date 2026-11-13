import { describe, expect, it } from "vitest";
import {
  sessionAgentAvailable,
  sessionAgentSelection,
  sessionManualApprovalsOnly,
} from "./sessionAgentSelection";
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
  it("separates enabled plugins from configured entries while supporting older catalogs", () => {
    const plugins = [
      plugin("codex"),
      { ...plugin("deepseek-harness"), available: false },
      { ...plugin("workbuddy"), available: true },
    ];
    expect(sessionAgentAvailable("codex", plugins)).toBe(true);
    expect(sessionAgentAvailable("deepseek-harness", plugins)).toBe(false);
    expect(sessionAgentAvailable("workbuddy", plugins)).toBe(true);
    expect(sessionAgentAvailable("absent", plugins)).toBe(false);
    expect(sessionAgentSelection("deepseek-harness", plugins)).toBe(
      "deepseek-harness",
    );
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
  it("takes Claude and future agents from the API catalog without a client allowlist", () => {
    for (const id of ["claude-code", "claude-desktop", "future-agent"]) {
      const catalog = [{ ...plugin(id), available: true }];
      expect(sessionAgentSelection("", catalog)).toBe(id);
      expect(sessionAgentAvailable(id, catalog)).toBe(true);
      expect(sessionAgentAvailable(id, [])).toBe(false);
      expect(
        sessionAgentAvailable(id, [{ ...plugin(id), available: false }]),
      ).toBe(false);
      expect(sessionAgentSelection(id, [])).toBe(id);
    }
  });
  it("uses service approval capabilities for Claude and future agents, retaining old catalog behavior", () => {
    expect(sessionManualApprovalsOnly(undefined)).toBe(true);
    for (const id of ["claude-code", "claude-desktop", "future-agent"]) {
      expect(
        sessionManualApprovalsOnly({
          ...plugin(id),
          capabilities: ["chat", "manual-approvals-only"],
        }),
      ).toBe(true);
    }
    expect(sessionManualApprovalsOnly(plugin("codex"))).toBe(false);
    expect(sessionManualApprovalsOnly(plugin("future-agent"))).toBe(false);
  });
});
