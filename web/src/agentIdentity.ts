/** Branding only. Never use this list to register or authorize an Agent. */
export const agentIdentities: Record<
  string,
  { name: string; images: string[] }
> = {
  codex: { name: "Codex", images: ["codex-light.png", "codex-dark.png"] },
  "deepseek-harness": {
    name: "DeepSeek Harness",
    images: ["deepseek-harness-light.svg", "deepseek-harness-dark.svg"],
  },
  workbuddy: { name: "WorkBuddy", images: ["workbuddy.svg"] },
  "claude-code": { name: "Claude Code", images: ["claude.svg"] },
  "claude-desktop": { name: "Claude Desktop Code", images: ["claude.svg"] },
};

export function agentIdentity(id: string) {
  return Object.hasOwn(agentIdentities, id) ? agentIdentities[id] : undefined;
}
