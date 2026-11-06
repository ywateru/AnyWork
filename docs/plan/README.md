# DeepSeek Harness delivery

Base: `main` at `f2e2ebd`. References are local-only. Implementation tasks use separate worktrees and do not modify the real Codex or AnyWork runtime.

| Task | Scope | State |
| --- | --- | --- |
| [harness-backend](tasks/harness-backend.md) | shared host adapter, agent registration, history and API integration, reference export boundaries | final independent review of `a26d54b` |
| [harness-ui](tasks/harness-ui.md) | upstream conversation body extraction, tool/status views, composer preserved | independently passed and merged |
| [harness-companion](tasks/harness-companion.md) | optional official Harness plugin for private Desktop/CLI host discovery | independently passed and merged |
| [independent verification](tasks/harness-verification.md) | actual upstream host preparation, then protocol, browser and system review of committed changes | UI/discovery passed; backend final lifecycle checks in progress |

Backend and UI paths are disjoint. Each task commits before independent verification; merge only after blocking findings are fixed. The orchestrator merges and runs full-system checks. No release is requested for this goal.

[Integration analysis](analysis/harness.md) enumerates the creation and call paths that must work together.

