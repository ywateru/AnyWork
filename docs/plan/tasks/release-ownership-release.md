---
id: release-ownership-release
scope: store-ownership-lifetime
status: in-progress
depends-on: [release-mobile-menu-synchronization]
---

## objective

Fix the ownership-release window exposed by v0.1.19 Intel Mac release job `129902001318`, run `42837033903`. All exact-source Checks passed, and the other release platforms passed. The Intel job failed at the immediate reopen after `drop(store)` in `fresh_current_and_historical_layouts_preserve_data_sequences_and_recover_atomically`, before a subsequent migration assertion. The immutable v0.1.19 tag exists but no Release was published.

## evidence and contract

The author isolated the Darwin `File::try_lock` behavior using disposable files: concurrent ordinary `Command` spawn and open-lock-drop loops produced 451 `WouldBlock` failures in 104,485 iterations, with no other errors or competing path opener. A controlled inherited descriptor blocked reacquisition after parent close, then released at child exec. Close-on-exec does not close the fork-to-exec window. This is a real ownership-lifetime issue, not a sufficient basis for treating the failure as an external transient.

Follow [the ownership contract](../../schema-and-recovery.md): release the guard's OS lock explicitly when its lifetime ends, after SQLite teardown. Preserve live-owner refusal, schema/recovery ordering, file permissions, alias handling, exit/crash recovery and platform-specific safety. Do not add sleeps, lock retries, ignored tests or permissive fallback. No real user database or running service is used in implementation or tests.

## ownership and verification

The implementation author owns the minimal guard release in `crates/server/src/store/ownership.rs`, local-binding teardown order in `crates/server/src/store/schema.rs`, deterministic regressions in `crates/server/src/store/schema/tests.rs`, and its author report. Error paths must close SQLite before releasing ownership as well as normal Store teardown; the returned interface stays unchanged. Windows release must match the existing reserved-byte lock range. The independent reviewer checks exact committed code, inherited-descriptor reproduction, live-owner rejection and existing schema/ownership regressions, including appropriate platform compilation/lint. Root merges accepted source and starts a new immutable publisher candidate; v0.1.19 source and tag remain unchanged. The new candidate must pass full trusted Checks and the release matrix. This task does not authorize replacement or restart of the currently retained local business server.
