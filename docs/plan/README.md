# DeepSeek Harness delivery

Base: `main` at `f2e2ebd`. References are local-only. Implementation tasks use separate worktrees and do not modify the real Codex or AnyWork runtime.

| Task | Scope | State |
| --- | --- | --- |
| [harness-backend](tasks/harness-backend.md) | shared host adapter, agent registration, history and API integration, reference export boundaries | independently passed and merged |
| [harness-ui](tasks/harness-ui.md) | upstream conversation body extraction, tool/status views, composer preserved | independently passed and merged |
| [harness-companion](tasks/harness-companion.md) | optional official Harness plugin for private Desktop/CLI host discovery | independently passed and merged |
| [independent verification](tasks/harness-verification.md) | actual upstream host preparation, then protocol, browser and system review of committed changes | passed, including merged-main actual-host smoke |

Backend and UI paths are disjoint. Each task commits before independent verification; merge only after blocking findings are fixed. The orchestrator merges and runs full-system checks. No release is requested for this goal.

[Integration analysis](analysis/harness.md) enumerates the creation and call paths that must work together.

Final verification and cleanup are complete. [Backend](reviews/harness-backend.md), [UI](reviews/harness-ui.md) and [discovery](reviews/harness-discovery.md) reviews have no open blocking findings. The existing production service was not replaced; implementation and acceptance use the local main branch and isolated hosts. There is no version bump, release or deployment in this goal.

## Authorized follow-up delivery

After accepting the integration, the user requested GitHub publication and a server update. Release [v0.1.7](https://github.com/ywateru/AnyWork/releases/tag/v0.1.7) is published with all 20 assets, five signed desktop-update targets, both macOS DMGs, Android and the corresponding Web/source. The bilingual download site and local service were updated and checked; existing sessions and the access key were retained. This deployment is separate from the isolated integration acceptance above.

The user then added [sidebar Agent filtering and identity icons](tasks/sidebar-agent-filter.md). That follow-up passed [independent review](reviews/sidebar-agent-filter.md) and is merged. v0.1.8 is published with all 20 assets, the bilingual site and local service updated, and existing sessions/key retained. Full CI then exposed an intermittent duplicate-answer race outside the new filter tests; [message replay correction](tasks/message-replay-race.md) passed independent verification and is merged for v0.1.9 deployment/publication. The published v0.1.8 tag and assets remain immutable.

