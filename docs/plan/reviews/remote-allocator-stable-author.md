# Remote connection ID allocator compatibility

v0.1.17 release checks rejected the active-connection registry's `AtomicU64::fetch_update` on the newer stable compiler because it is deprecated and the project treats warnings as errors. The allocator now uses `checked_add` and `compare_exchange_weak` with the same relaxed ordering and original failure code. This uses APIs available on both older and newer stable Rust. No lint exemptions, authorization changes, wire changes, or changes to the registry lifetime were introduced.

The successful compare-and-exchange is the allocation point. A competing writer updates the observed value and the loop retries. The counter never wraps: at `u64::MAX`, allocation continues to reject with `REMOTE_CONNECTION_LIMIT`, preserving the original behavior. The existing registry mutex still owns insertion/removal and cancellation checks.

Verification on macOS with Rust 1.97.1:

- Full remote crate tests: 5 unit tests and 8 real WebSocket/Noise integration tests passed. Existing expiry, renewal, replay protection, connection cleanup, and 1,024-plus requests remain covered.
- New contention regression: eight threads allocate 8,000 distinct IDs, with strict ordering within each thread and the exact final counter value.
- New exhaustion regression: eight threads contend at `MAX - 1`; exactly one receives that ID, all remaining calls fail with the original error, and the exhausted counter remains `MAX` on subsequent attempts.
- `cargo fmt -p anywork-remote -- --check` and package Clippy for all targets with `-D warnings` passed.

Logs: `/tmp/anywork-allocator-cas-tests.log` and `/tmp/anywork-allocator-cas-clippy.log`. Newer-stable Linux and Windows acceptance remains the responsibility of the fresh release checks; this local result does not claim those platforms ran.

The private v0.1.17 Native candidate operation was marked `abandoned-unadopted` after the failed release checks. No apply authorization was issued, no application files were replaced, and the running service was not stopped, started, or reconfigured. A future candidate requires a new operation and frozen release source.
