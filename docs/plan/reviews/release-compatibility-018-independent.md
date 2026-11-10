# Release compatibility independent review

## Scope and current verdict

The v0.1.17 candidate remains abandoned and unadopted. Its failed Checks run did not produce a release tag. A subsequent release requires a fresh immutable source, operation, candidate and approval; none of the old operation's approvals can be reused.

Accepted allocator source: `a2219325272e2d774542989a0cda55724c33e195`. Accepted Windows fixture/CI source: `85d619487f0bb865c3051f228bde2fa2d47b4c96`. Both commits are combined in the reviewer worktree. The subsequent exact-source GitHub Checks remains required before publication.

## Allocator evidence

The only production change replaces deprecated `fetch_update` with a `checked_add` / `compare_exchange_weak` loop. Successful compare-and-exchange is the allocation's linearization point. Relaxed ordering remains appropriate because the counter allocates identities without publishing other memory. Contention reloads the observed value; exhaustion retains `u64::MAX`, returns the existing fixed error, and never wraps or reuses an identity. Client authorization, lifecycle and metadata remain unchanged.

Independently run in the review worktree with its own Cargo target directory:

- `cargo test -p anywork-remote`: five unit tests and eight real WebSocket/Noise integration tests passed.
- `cargo clippy -p anywork-remote --all-targets -- -D warnings`: passed on the installed Mac toolchain, Rust `1.97.1 (8bab26f4f 2026-07-14)`.
- New tests exercise 8,000 concurrent allocations with unique contiguous results and per-thread monotonicity, plus eight competing allocations at exhaustion with precisely one final success and subsequent refusal.

These local results do not claim Linux latest-stable or Windows execution. The fresh release's trusted GitHub Checks remains the cross-platform gate.

## Windows fixture evidence

The exact change is limited to disposable test peers, their tests and explicit Windows CI Python setup. `setup-python` supplies an absolute CPython 3.12 executable through a test-only override. Peer invocations use isolated Python startup. The partial reader reports readiness before the existing five-second write budget begins, then directly reads exactly 4096 bytes in a loop before exiting. The transport still sends 4 MiB, admits once, requires `Unknown`, verifies the actual prefix count and asserts reaping plus released pending/outgoing state. No production deadline, transport, authorization check or platform test is removed or relaxed.

The new real-pipe test sends 17 bytes and then 4079 bytes, keeps stdin open, and verifies that the peer waits for the complete prefix and exits without requiring EOF. Normal readiness failures explicitly close/reap the owned child. Unix external-process detach coverage remains enabled.

Independently run against the combined exact source on macOS with explicit `/usr/bin/python3`:

- `ANYWORK_TEST_PYTHON=/usr/bin/python3 cargo test -p remote-agent-sdk --test qualified`: all six actual transport/pipe tests passed, zero ignored.
- `cargo clippy -p remote-agent-sdk --test qualified -- -D warnings`: passed.

The original failed Windows log identifies missing readiness/count evidence, but not a proved interpreter or pipe-buffering cause. The author's final report correctly notes that the preceding successful job used the same runner image, that the old buffered stdin read did not reproduce a universal short-read defect, and that Windows execution is still required. Source acceptance permits a fresh release candidate; it does not substitute Mac results for Windows CI.

## Fresh local-update draft

Reviewed the new private operation's draft plan and recovery binding fix. Fourteen synthetic contract tests passed independently using disposable fixture bundles and mocked runtime/signature checks. Reconciliation now validates intent-to-candidate, helper, official export, build receipt, baseline and runtime hashes before recording either apply or rollback completion. Tampered candidate/runtime evidence leaves the operation in its unknown submission state without replacing bundle files or writing a completion receipt.

The plan retains the existing business server inode, process, listener, environment, configuration/token hashes, schema and prior session-ID subset. It permits only individually replaced Native, corresponding source offer, official version/build Info.plist fields, and CodeResources. It neither launches Native nor starts/stops a service. The final source is unset and no candidate or GO is bound at this review stage. Final frozen scripts, source offer, candidate bytes and approval still require independent review; passing draft tests grants no installation authorization.

No real account, production service, installed bundle or user business body was modified or queried during this review.
