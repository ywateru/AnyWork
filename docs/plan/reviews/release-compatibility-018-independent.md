# Release compatibility independent review

## Scope and current verdict

The v0.1.17 candidate remains abandoned and unadopted. Its failed Checks run did not produce a release tag. A subsequent release requires a fresh immutable source, operation, candidate and approval; none of the old operation's approvals can be reused.

Accepted allocator source: `a2219325272e2d774542989a0cda55724c33e195`. Windows fixture review and the subsequent exact-source GitHub Checks remain pending.

## Allocator evidence

The only production change replaces deprecated `fetch_update` with a `checked_add` / `compare_exchange_weak` loop. Successful compare-and-exchange is the allocation's linearization point. Relaxed ordering remains appropriate because the counter allocates identities without publishing other memory. Contention reloads the observed value; exhaustion retains `u64::MAX`, returns the existing fixed error, and never wraps or reuses an identity. Client authorization, lifecycle and metadata remain unchanged.

Independently run in the review worktree with its own Cargo target directory:

- `cargo test -p anywork-remote`: five unit tests and eight real WebSocket/Noise integration tests passed.
- `cargo clippy -p anywork-remote --all-targets -- -D warnings`: passed on the installed Mac toolchain, Rust `1.97.1 (8bab26f4f 2026-07-14)`.
- New tests exercise 8,000 concurrent allocations with unique contiguous results and per-thread monotonicity, plus eight competing allocations at exhaustion with precisely one final success and subsequent refusal.

These local results do not claim Linux latest-stable or Windows execution. The fresh release's trusted GitHub Checks remains the cross-platform gate.

## Fresh local-update draft

Reviewed the new private operation's draft plan and recovery binding fix. Fourteen synthetic contract tests passed independently using disposable fixture bundles and mocked runtime/signature checks. Reconciliation now validates intent-to-candidate, helper, official export, build receipt, baseline and runtime hashes before recording either apply or rollback completion. Tampered candidate/runtime evidence leaves the operation in its unknown submission state without replacing bundle files or writing a completion receipt.

The plan retains the existing business server inode, process, listener, environment, configuration/token hashes, schema and prior session-ID subset. It permits only individually replaced Native, corresponding source offer, official version/build Info.plist fields, and CodeResources. It neither launches Native nor starts/stops a service. The final source is unset and no candidate or GO is bound at this review stage. Final frozen scripts, source offer, candidate bytes and approval still require independent review; passing draft tests grants no installation authorization.

No real account, production service, installed bundle or user business body was modified or queried during this review.
