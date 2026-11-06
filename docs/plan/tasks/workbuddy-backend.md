# WorkBuddy backend

State: final product commit `46fed88` merged locally after [independent experimental-source acceptance](../reviews/workbuddy-backend.md), following baseline `cd6699a`. Follow-ups close the installed application's native error envelope and approval IDs reused across turns. Installed native writing/E2E remains open because the isolated upstream account is not initialized. Develop agent: harness_backend; independent verifier: harness_verify.

Contract: [shared desktop integration](../../workbuddy-integration.md), [investigation](../analysis/workbuddy.md). Implement only observed native contracts; unknown capability is a gate, not permission to fabricate a fallback.

Deliver the Rust CDP carrier/adapter, minimal shared-host dispatch, configuration and catalog/runtime/composer/API/queue integration. Preserve Codex semantics, native WorkBuddy ownership, exact native IDs and prompt delivery uncertainty. Fix per-Agent import deletion and directory scope before exposing another external Agent. Include meaningful isolated tests for the complete invocation path, projection/history, generation-bound interactions and disconnects. No production process, account, version or release changes.

Descriptor v1: `version:1`, `agent:"workbuddy"`, `appVersion:"5.9.3"`, numeric `pid`, loopback root `url`, `browserId` matching `/json/version`'s browser endpoint identity, absolute `configDir` and per-launch UUID `instanceId`. Default private file: `~/.anywork/workbuddy/host.json`; explicit CLI/env override supported. Do not print target URLs, which can contain account snapshots.

Paths: `crates/**` and backend test scripts as coordinated with root. UI and launcher belong to the separate UI task. Commit before independent review. Record implementation limits with evidence.
