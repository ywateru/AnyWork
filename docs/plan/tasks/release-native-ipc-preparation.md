---
id: release-native-ipc-preparation
scope: native-account-preparation
status: done
depends-on: [release-approval-notification-race]
---

## objective

Resolve the Intel Mac release failure in `accounts::tests::native_ipc_requires_current_account_then_prepares_without_browser_ticket`. Exact-source v0.1.22 Checks passed, as did every other release platform. Run `42870372544`, Intel job `130019822102`, failed at `accounts.rs:1726`: authenticated `desktop_start` returned the local-service verification error. All 193 server tests passed; Native reported 40 passed, one failed and two ignored. The v0.1.22 tag is immutable; no Release was published.

## contract and evidence

Diagnose the real child-process fixture and manager boundary before choosing a correction. Preserve account gating, identity/workspace/token verification, no browser handoff during preparation, explicit retry after failure, and external-service preservation. Do not weaken assertions, add blind retry/sleep, bypass authorization, ignore the regression, or change production behavior without demonstrated cause. Use disposable fixtures only; do not read business content or modify/restart the installed application or existing service. Failure log: `/tmp/anywork-release-022-intel-job.log`.

## ownership and delivery

The Native author investigates and implements the smallest justified correction in an isolated worktree, with focused positive and negative evidence and an author report. A separate reviewer verifies the exact committed correction, contract preservation, fixture lifecycle and relevant regressions. Root merges accepted source and starts a fresh immutable release candidate only after the current publisher stops. Full exact-source Checks and all release platforms remain required; no tagged source or published asset is moved.

## delivery

Author commits `31f707b` and `05c37e9` passed [independent review](../reviews/release-native-ipc-preparation-independent.md) and were merged as `7a6d299` and `188fe80`. All changes are confined to Unix test fixtures: preflight and pin the Python executable, retain safe startup/request evidence, and preserve the original non-health Bearer checks. Production manager, process, authorization, service verification and timeouts are unchanged. Deterministic PATH shadow and startup/bind failures, HTTP rejection, external-service preservation, and the real 30-second owned failure followed by explicit retry passed. Author full release-profile Native tests passed 45 tests with two existing ignores; independent helper tests, exact IPC test, scoped strict Clippy and formatting passed.

The v0.1.22 remote failure's specific cause was not captured by its original logs. The reproducible PATH dependency is corrected without claiming it was that remote cause; the existing port allocation-to-bind window remains observable through new fixture diagnostics. Release run `42870372544` ended with failure and its publish job was skipped. The next immutable candidate still requires full exact-source Checks, all release jobs, and asset/site verification. The installed application and retained local business service were not modified by this correction.
