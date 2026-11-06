# DeepSeek Harness delivery

Base: `main` at `f2e2ebd`. References are local-only. Implementation tasks use separate worktrees and do not modify the real Codex or AnyWork runtime.

| Task | Scope | State |
| --- | --- | --- |
| [harness-backend](tasks/harness-backend.md) | shared host adapter, agent registration, history and API integration, reference export boundaries | ready |
| [harness-ui](tasks/harness-ui.md) | upstream conversation body extraction, tool/status views, composer preserved | ready |
| integration review | independent protocol, browser and full-system verification after both tasks | pending |

Backend and UI paths are disjoint. Each task commits before independent verification; merge only after blocking findings are fixed. The orchestrator merges and runs full-system checks. No release is requested for this goal.

