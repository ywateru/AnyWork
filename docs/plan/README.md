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

The user then added [sidebar Agent filtering and identity icons](tasks/sidebar-agent-filter.md). That follow-up passed [independent review](reviews/sidebar-agent-filter.md) and is merged. v0.1.8 is published with all 20 assets, the bilingual site and local service updated, and existing sessions/key retained. Full CI then exposed an intermittent duplicate-answer race outside the new filter tests; [message replay correction](tasks/message-replay-race.md) passed independent verification and shipped in v0.1.9 with all 20 assets, signed updates, the bilingual site and the local service verified.

Final cloud checks found a separate model-menu focus race. The [focus correction](tasks/model-picker-focus.md) passed [independent review](reviews/model-picker-focus.md), including a composite Escape-then-input ownership fix. Merged v0.1.10 checks passed 304 Web unit tests and 567 desktop/mobile browser cases (one existing desktop-only case skipped on Android), typechecking, format, source export/version checks, desktop updater UI and bilingual site checks. Full cloud Checks and the release matrix succeeded. [v0.1.10](https://github.com/ywateru/AnyWork/releases/tag/v0.1.10) is published with all 20 assets, 19 matching checksums, five signed desktop-update targets and both verified DMG downloads. The bilingual website links to v0.1.10, and the local service is deployed with all 69 prior sessions and the access key retained. Its existing tunnel process and installed hosts were left in place. All published tags and assets remain immutable.


## WorkBuddy follow-up

The new goal is to add WorkBuddy from the installed desktop, preserving shared execution. [Research](analysis/workbuddy.md) records the exact artifact, primary references and rejected transports; the [integration contract](../workbuddy-integration.md) defines the candidate native boundary and completion gates. The installed application's isolated preload, native list and credential-safe model projection have passed runtime checks. Native creation and message delivery remain open acceptance gates. No production instance, credentials, version or release is changed by this work.

| WorkBuddy task | State |
| --- | --- |
| [Native backend and shared-host integration](tasks/workbuddy-backend.md) | experimental source merged locally after exact-commit independent review; native writing gate open |
| [Identity and explicit launch setup](tasks/workbuddy-ui.md) | merged locally; UI, launcher and delayed-plugin follow-up independently passed |
| [Independent verification](tasks/workbuddy-verification.md) | final candidate code accepted for experimental integration; installed native writing/E2E remains open |

The [backend review](reviews/workbuddy-backend.md) accepts product commit `46fed88`; the [UI/launcher review](reviews/workbuddy-ui.md) accepts `18282da`. [Merged-system checks](reviews/workbuddy-merged.md) record local validation separately. Native error-envelope and approval occurrence/turn findings are closed. A normally initialized WorkBuddy account remains necessary to complete actual native creation and collaboration acceptance. This experimental source merge is not a feature-completion or publication claim.

## Default integration and sidebar scrolling follow-up

The user requested default dsh/WorkBuddy visibility and bounded sidebar scrolling. [Contract and delivery tasks](tasks/default-agents-sidebar-scroll.md) separate enabled integration registration from native-host connection readiness. Both isolated implementations passed [independent review](reviews/default-agents-sidebar-scroll.md), merged, and passed [merged checks and local deployment](reviews/default-agents-sidebar-scroll-merged.md). All 70 prior sessions and the access key were retained. This follow-up does not publish a release or send messages to native sessions.

## Shared Agent historical sessions

The user requested dsh and WorkBuddy history parity with Codex. [Contract and tasks](tasks/shared-agent-history.md) cover passive native persisted catalogs, disconnected history reading and explicit all-Agent directory scope. Separate implementations passed [independent review](reviews/shared-agent-history.md), merged, and passed [merged checks and local deployment](reviews/shared-agent-history-merged.md). The local service now lists 71 retained Codex sessions, 22 dsh roots (including 4 archived) and 8 WorkBuddy sessions. No native prompts, version bump, release or public deployment were part of this follow-up. The separate installed WorkBuddy native-writing acceptance gate remains open.
