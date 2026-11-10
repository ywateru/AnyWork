# Database ownership release — author evidence

Date: 2026-11-10. Task: [release ownership release](../tasks/release-ownership-release.md), contract recorded by root at `0cc3831` and refined at `7575312`. Scope: ownership-guard teardown, error-path declaration order and a deterministic Unix descriptor-inheritance regression. No schema, migration, stored data, service configuration or public interface change.

## Diagnosis

Frozen v0.1.19 source `a738372dc1536847972f8dc3ea602bb18abb723b` failed the Intel Mac release job at `schema/tests.rs:203`, the immediate `Store::open` after explicit `drop(store)` in a UUID-isolated historical-layout fixture. The error was ownership `WouldBlock`, before the subsequent recovery assertion. The fixture did not share a database path with other tests.

The close-only guard retained an OS lock while any forked child still shared its open-file description, even with close-on-exec set. An independent disposable-file author probe reproduced the actual Darwin mechanism: a controlled inherited descriptor blocked reacquisition after parent close and released after child exec. Ordinary concurrent `Command("/usr/bin/true")` spawning produced **451 WouldBlock errors in 104,485 open/lock/drop attempts, zero other errors**. This was not limited to a test-specific fork hook and could affect production close/reopen. It did not justify retrying v0.1.19 unchanged as an external transient.

## Minimal implementation

- `OwnerGuard::drop` explicitly releases the OS lock before closing its handle. Normal `Store` field order is unchanged: SQLite connection first, ownership guard second. Unlock failure produces only a fixed warning; handle close remains OS cleanup, with no lock retry, sleep, bypass or fallback authorization.
- Unix unlock operates on the private sidecar using `File::unlock`. Windows uses `UnlockFileEx` for the **same one-byte range at offset 2^62** as `LockFileEx`; both operations share the range/OVERLAPPED construction. It never uses whole-file standard unlocking on the SQLite inode.
- After successful lock acquisition, construct `OwnerGuard` before the final inode check so an error there also executes explicit release. Failed acquisitions never create a guard or attempt to unlock another owner's lock.
- In `schema::open`, change local tuple binding from `(db, owner)` to `(owner, db)` and reorder the two branch tuples. Rust drops locals in reverse declaration order on errors, so SQLite now closes before ownership release on opening/validation/recovery failures as well. The returned `(Connection, Option<OwnerGuard>)` interface and successful `Store` field order remain unchanged.

## Deterministic regression

The Unix-only regression opens a real `Store`, verifies a second live opener is refused, duplicates only its empty sidecar description and passes that duplicate as a disposable child test's stdin using standard `Stdio::from`. This preserves the same description across exec without unsafe custom fork/pre-exec code. The child never reads stdin, opens the database or acquires its own guard; it only acknowledges readiness and waits.

While that owned child remains alive, the parent drops `Store` and immediately reopens without any retry or delay. It then kills and waits for that exact child and verifies the new live owner still refuses a third opener; closing the old inherited description cannot release the new owner's separate lock. A test-local RAII wrapper kills/waits the owned child on assertion failure too. Files and child state are private disposable fixtures. Windows is excluded from this Unix inheritance regression because its guard is a reserved-range database handle, not a sidecar; existing cross-platform ownership regressions remain enabled.

Negative control: temporarily removing only the explicit guard destructor made this new regression fail with the expected ownership refusal. The exact source bytes were restored in a `finally` block before the final passing checks. No negative-control alteration is committed.

## Verification

Author host: Apple Silicon macOS, Rust 1.97.1. Root explicitly authorized exclusive non-destructive reuse of `/Users/water/work/2026/any-work/.worktrees/account-desktop/target`; no clean or shared-root/reviewer-cache modification occurred.

| Check | Result |
| --- | --- |
| New inherited-description regression with explicit release | PASS |
| Negative control with close-only guard | Expected ownership failure confirmed |
| `cargo test --locked -p anywork store::schema:: -- --nocapture` | **19 PASS**, zero ignored |
| `cargo test --locked -p anywork` | **193 PASS**, 5 existing explicit native/profile/crash-entry opt-ins ignored |
| `cargo clippy --locked -p anywork --all-targets -- -D warnings` | PASS |
| Rustfmt on the three modified Rust files and `git diff --check` | PASS |

The schema suite retains historical/fresh recovery, live-owner refusal, aliases/hardlinks, sidecar permissions, thread/process competition, crash release, transaction rollback and SQLite record-lock coverage. No ignored test was added or enabled, and no existing assertion was removed.

The worktree's package version predates the release bumps; the relevant store source was checked against a738 before modification and had no product delta. Local checks do not establish Intel Mac or native Windows behavior. Those platform results, including `UnlockFileEx`, require the newly merged exact-source trusted Checks and release matrix before publication. No installed app, real account, running business service or user database was opened or changed. The immutable v0.1.19 source/tag is not altered; root owns the fresh candidate and publication.
