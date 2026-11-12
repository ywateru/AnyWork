# DeepSeek Harness delivery

- [CyberGrid v0.8.0](tasks/cybergrid-v080.md)：用户追加的上游更新检查与必要 SDK/宿主适配，纳入本次发行；登录设备修订、Web 和 Native SDK 已独立接受、合并并通过集成检查，v0.1.27 发行测试失败后，修正另行独立验收，等待精确源码 CI 和 v0.1.28 发布验收。当前固定客户端配置下保留协调服务，服务端迁移另行验证。

## Current login and device follow-up

[登录与设备体验修订](tasks/ui-login-device-followup.md) 对 v0.1.26 的实际截图反馈实施五项修正，分离 Native 和 UI 作者并独立验收，保留授权/服务边界。源码与合并检查已通过，与 CyberGrid SDK 更新统一发布；实际拖动位移仍保留输入环境验收限制，见[合并记录](reviews/ui-login-cybergrid-merged.md)。

## Current UI v2 delivery

[统一界面 v2](tasks/ui-refactor-v2.md) 已完成并发布 [v0.1.26](https://github.com/ywateru/AnyWork/releases/tag/v0.1.26)：精简桌面控制台与 Web 登录、连接、设备入口，统一六角标志，保留 Web 对话内部。两端隔离开发、独立验收、短窗口回归修复及精确源码 CI 均通过；正式网站已更新，安装包与签名更新可用。见[合并发布记录](reviews/ui-v2-merged-release.md)和[线上验收](reviews/ui-v2-production.md)。用户追加的旧构建缓存清理已完成，业务数据与当前运行服务保留。

## Current desktop follow-up

[Default remote access and compact console](tasks/desktop-default-remote.md) is in progress against released v0.1.24. Login and verified local readiness trigger one Native-owned default remote attempt; manual disable holds for that login session. Native transport diagnosis, UI implementation and independent verification precede the next immutable release. Existing installed services remain untouched.

## Unified account and workspace experience

Current user revision: [desktop introduction, account-first startup and live connected clients](../desktop-onboarding-layout.md) is implemented through disjoint [Native](tasks/desktop-onboarding-native.md) and [UI](tasks/desktop-onboarding-ui.md) tasks. It passed [independent review](reviews/desktop-onboarding-independent.md) and [merged-system checks](reviews/desktop-onboarding-merged.md). The pending 0.1.16 publisher was interrupted before tagging; a fresh release will include this new flow. Publication and local artifact adoption remain separate from source acceptance. Existing runtime services were untouched during isolated implementation and verification.

The [CyberGrid integration feedback](../cybergrid-product-feedback.md) is ready for upstream discussion; it has not been sent automatically. The [unified experience contract](../account-unified-experience.md) and [delivery task](tasks/account-unified-experience.md) were delivered with [live independent checks](reviews/account-unified-live-independent.md), retaining their stated platform and public-tunnel test limits. The [desktop console layout, local address and connection explanation](../desktop-workspace-layout.md) follow-up is also delivered: its [task](tasks/desktop-workspace-layout.md) records independent UI checks and actual Mac clipboard verification, with the existing server retained without restart.

## Account and device cloud proposal

The [account/device proposal](../account-device-cloud-review.md) is now authorized for implementation, full testing and update. [Tasks](tasks/account-device-cloud.md) track three isolated lanes: cloud provisioning, Web/site and local desktop security. The research pin was CyberGrid `1e65328`; implementation has checked and pinned the update `2bd6729`. Logto owns account/config data, Upstash is only CyberGrid coordination storage, and business content/private keys remain on user devices. Research probes do not count as feature acceptance. Final publication requires independent review, real integration evidence and merged-system checks.

Current continuing work: [prioritized project improvements](improvement-progress.md), starting with the [G0 correctness and delivery contract](tasks/improvement-g0.md). Current G1 connections: [complete delivery contract](tasks/improvement-connected-delivery-contract.md), [Desktop native-input source gaps](tasks/improvement-desktop-input-proof.md), then [connected delivery implementation](tasks/improvement-message-delivery.md). Earlier delivery records below remain historical evidence.

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

## WorkBuddy transcript and update correction

The user reported injected context appearing as a user message and missing Web updates after successful native execution. [Investigation and correction](tasks/workbuddy-transcript-updates.md) cover native visible-content projection, latest-page cursor semantics and repairing already imported cache rows. The correction passed [independent review](reviews/workbuddy-transcript-updates.md), merged and passed [merged checks/local deployment](reviews/workbuddy-transcript-updates-merged.md). The affected native conversation now exposes all three completed turns with clean user input. All 101 sessions, the key, native applications and the tunnel were preserved; native testing remained read-only and no public release was made.

## One-command publication

The user requested reusable release automation after v0.1.12 publication. The [task contract](tasks/one-command-publish.md) defines a resumable publisher for exact-commit Checks, immutable releases, website deployment and lightweight final validation. Implementation passed [independent review](reviews/one-command-publish.md) and merged checks: 26 publisher tests, release-version/source-export checks and a read-only verification of the real v0.1.12 release and bilingual site. The delivered [one-command workflow](../releasing.md) includes progress recovery, explicit failed-job retry and Pages-only repair. This task delivers source and documentation without publishing another version or changing the local service.

## Project-wide expert review

The [2026-11-07 improvement review](../project-improvement-review.md) examines the source at `db7f2ab`, current contracts and existing acceptance records. It records 30 proposed improvements, evidence levels, acceptance directions, staged dependencies and 11 expert decisions. Backend, Agent and client reviews informed the draft; two independent directions checked the consolidated document. This is analysis for expert discussion, not approval or implementation of the proposed work. No product code, running service or release changed.
