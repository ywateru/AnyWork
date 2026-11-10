# Native IPC preparation fixture — independent review

Task: [release-native-ipc-preparation](../tasks/release-native-ipc-preparation.md).

Reviewed exact author commits `31f707b2d0e2fa3e00c69929e6b57a0c3d05b033` and `05c37e96569ff44c316abe2bec66d9dfa46c6f76`, based on v0.1.22 source `aed458033f20636447d174a64f5507cc1eaa00f2`. The reviewer cherry-picked both onto the task-doc baseline `b9295d1` in an isolated worktree; the final `crates/desktop` tree is byte-identical to the author's final tree.

## Findings

No blocking findings remain in the final committed correction. The initial helper's non-info GET authentication difference was corrected in `05c37e9`: all non-health GETs retain the previous fixture's Bearer requirement, with explicit missing/wrong/selected-token coverage on `/api/clients`.

- **P3, non-blocking, existing fixture limitation:** the ephemeral port is reserved and released before the child binds (`accounts.rs` IPC test and `test_service.rs::fixture_config`). This remains a possible port-allocation race. The new deliberate bind-failure test verifies a distinct exit/stage/stderr classification; no retry or deadline extension hides it. This limitation and the unconfirmed remote cause are recorded in the author report and task contract.

## Scope and contract review

The production account, manager, process, bridge and updater implementations are unchanged. The account-file changes are inside its test module; the helper is registered only under `cfg(all(test, unix))`. Windows and shipped applications acquire no new Python dependency.

The original real IPC flow still rejects signed-out, authorizing, interrupted and reauthorization states before service preparation. Its successful path still verifies account ownership, authenticated service identity/workspace/capability, manager-owned rather than external service, no browser-ticket creation, token preservation and shutdown. The additional ready/authenticated-request assertions strengthen its evidence. The real manager's 30-second preparation deadline and explicit command required for retry remain unchanged.

The fixture resolves and preflights Python before the production launch plan changes PATH, then uses an absolute interpreter with isolated mode. Quoted wrapper paths and shell `exec` preserve the single owned child PID. The controlled old-resolution negative case exits 87 through a shadow interpreter; the fixed child under the same PATH serves authenticated HTTP without executing that shadow. Normal cleanup waits for the exact child and verifies the local port closes; the launch plan also retains its existing kill-on-drop protection.

Diagnostics are confined to disposable fixture directories. Reported state consists of fixed stages, exit classifications, request counters and stderr-marker/presence booleans. It does not add production logging or print real service output, account credentials, request headers or environment values. Startup error 73, bind error 74 and real HTTP 401 remain observable failures. A manager shutdown leaves the external 401 fixture alive and preserves its selected token; that fixture is then stopped by its test owner. An owned startup failure reaches Error and stays unauthorized until an explicit preparation command succeeds with the same generated token. Both paths retain zero browser-ticket requests.

## Independent verification

Verification uses the reviewer's separate Cargo target directory and disposable loopback processes, without touching the installed app or service.

- Final helper tests: **four passed**, zero failed/ignored, 30.82 seconds, including the restored non-health Bearer regression and unchanged real 30-second owned-start failure/retry path.
- Final exact original IPC test: **one passed**, zero failed/ignored, 0.84 seconds.
- Final scoped Native Clippy (`--lib --tests -- -D warnings`), workspace formatting check and diff check: **passed**. Clippy used a read-only `TAURI_CONFIG` reference to the existing root UI distribution for the binary test target; no UI distribution was rebuilt or modified.

Before the final Bearer-equivalence followup, the reviewer also ran the four helper tests successfully in 31.10 seconds and the exact original IPC test successfully in 0.90 seconds. Final-source results above supersede those preliminary checks.

The author additionally reports the complete final release-profile Native library suite passing, **45 passed and two existing ignored**, plus Clippy with tests and `-D warnings`. That evidence is attributed to the author; local ARM testing is not an Intel CI result.

## Release evidence and limits

The v0.1.22 formal release failure was run `42870372544`, Intel job `130019822102`. The manager verification assertion failed after 32.88 seconds; Native reported 40 passed, one failed and two ignored, and all 193 server tests passed. The earlier exact-source Checks success does not make that release failure a cache failure or a completed release.

The remote log does not identify the actual Python interpreter, child exit/stderr or bind/request state. Its duration is consistent with readiness verification reaching the existing deadline, but does not establish PATH shadowing, port collision or another concrete cause. The negative/positive local tests demonstrate a real fixture dependency weakness and the correction's boundary; they do not prove which weakness caused the remote failure. The immutable v0.1.22 tag is not moved or retried by this review. A fresh immutable source candidate must still pass full Checks and every release platform, including Intel Mac.

## Verdict

**PASS** for the exact final test-only correction (`31f707b` plus `05c37e9`), with no remaining blocking finding. Fresh exact-source release acceptance remains required. No installed application, existing service, user account, remote access, user workspace or business content was changed or accessed for this review.
