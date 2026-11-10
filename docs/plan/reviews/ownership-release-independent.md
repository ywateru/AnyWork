# Database ownership release — independent review

Date: 2026-11-11. Verdict: **accept exact implementation `39f1b44410fdf8bcb1b3df1530664d6ee566bd26` for the fresh release candidate**, subject to its trusted cross-platform Checks and release matrix. Root's cherry-pick `e7379f1` has identical contents in all three changed Rust files. This review follows [the ownership-release task](../tasks/release-ownership-release.md) and the normal/error teardown contract refined in root commits `0cc3831` and `7575312`.

## Cause and release decision

The v0.1.19 release run `42837033903`, Intel Mac job `129902001318`, failed on the immediate `Store::open` after explicit `drop(store)` in the historical-layout test at `schema/tests.rs:203`. The failure was ownership `WouldBlock`, before the next migration/recovery assertion; the result was 191 passing tests, one failure and five existing explicit opt-ins ignored. It was distinct from the successful exact-source Checks run `42831979308` for `a738372dc1536847972f8dc3ea602bb18abb723b`.

The reviewer independently read the disposable-file causal probe, compiled a private copy and ran it without changing product code. A controlled inherited descriptor prevented reacquisition after parent close and released at child exec. Ordinary concurrent `Command("/usr/bin/true")` spawning produced **966 WouldBlock results in 118,611 open/lock/drop attempts, zero other errors**, with one path owner and no custom pre-exec hook in that ordinary-spawn loop. The private probe and its owned processes were cleaned up. This establishes an intrinsic close/reopen window: close-on-exec does not remove descriptor inheritance between fork and exec. The failed release is not suitable for an unchanged transient retry. The immutable v0.1.19 tag/source must remain historical; root owns the fresh v0.1.20 candidate.

## Source assessment

- `OwnerGuard::drop` explicitly unlocks before its handle closes. A failed unlock logs only a fixed warning and retains handle-close cleanup; no retry, sleep, lock deletion or permissive opening path was added. Failed acquisition does not construct a guard and therefore cannot unlock another owner.
- Unix unlock applies only to the private inode-keyed sidecar. Successful acquisition constructs the guard before the final inode/path identity check, so an error in that check now also releases the acquired lock explicitly.
- Windows acquisition and release share one `windows_lock` range construction: OVERLAPPED offset `2^62`, length one byte, the same synchronous handle, `LockFileEx` for acquisition and `UnlockFileEx` for release. No whole-file standard unlock is applied to the database inode, and unsupported platforms still reject ownership locking. This is a source assessment, not a local Windows execution claim.
- Successful `Store` field order remains `Mutex<Connection>` followed by its guard, closing SQLite before unlock. `schema::open` now declares `(owner, db)`, whose reverse local destruction order also closes SQLite first on validation/recovery/opening errors. Transaction locals close before those outer bindings. The returned `(Connection, Option<OwnerGuard>)` interface is unchanged.
- The deterministic Unix-only regression duplicates the actual Store sidecar's open-file description into a disposable child test's stdin using `File::try_clone` and `Stdio::from`. The child neither reads the descriptor nor opens the database: it writes a private readiness marker and waits. The parent drops Store and immediately reopens while the child remains alive, without a retry/delay. After killing and waiting for that exact child, a third opener remains refused by the new owner. RAII also kills/waits the test-owned child on failure. The Unix-only condition avoids exposing the Windows reserved-range database handle through this sidecar fixture.

No schema, migration, stored-data format, path-alias policy, permissions, process-ownership admission or public interface change was introduced. The changed scope is appropriate for the diagnosed defect. No blocking finding remains.

## Independent verification

The reviewer merged the exact author commit only into the isolated `codex/desktop-onboarding-review` tree. Its package metadata predates release bumps; the relevant changed Rust files were independently compared to root's cherry-pick and are identical. Tests used only the reviewer-owned `account-reliability-review/target` cache, on Apple Silicon macOS with Rust 1.97.1.

| Check | Independent result |
| --- | --- |
| `cargo test --locked -p anywork store::schema:: -- --nocapture` | **19 PASS**, zero failed/ignored; includes inherited-description, live owner, crash/process competition, alias/permission, SQLite record-lock, recovery and historical-layout cases |
| `cargo clippy --locked -p anywork --all-targets -- -D warnings` | PASS |
| `git diff --check` | PASS |
| Exact changed Rust files compared with root `e7379f1` | No difference |

The author's separately reported negative control (temporarily omitting only explicit Drop) failed at the expected ownership refusal, followed by exact restoration. The author's full server run reports **193 PASS / five existing opt-ins ignored**, plus formatting and Clippy. These are author evidence, not duplicate reviewer runs. The reviewer's independent causal probe and targeted actual Store regression provide separate verification without altering product source for another negative control.

Native Windows, Intel macOS and other release-platform runtime behavior remain gates for the new exact-source CI/release matrix. This review does not substitute ARM Mac tests for those platforms.

## Local installation boundary

No installed application, real account, running service or user database was operated on for this fix. No new local v0.1.20 candidate, replacement or service restart is requested. The already accepted private operation `native-onboarding-05917a0d-62ed-4ac8-8912-64019e9907de` installed **Native v0.1.19/build20** while retaining the older server at PID28102 and its configuration, token, environment and data. Its post-apply evidence and root-attributed introduction-page observation are recorded in [the local candidate review](desktop-onboarding-native-candidate-019-independent.md). Public v0.1.20 completion must be reported separately from that local Native version and retained server. Earlier abandoned private operations and their invalid approvals stay abandoned.
