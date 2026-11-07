# Independent I03 storage-degradation analysis review

Reviewed document commit: `698b7dee444f0da1c88b6894e61194dec827ec16`.

Source baseline: `aacaa19b98314976b34e91f11c12326c6ad6ad7c`. The document-only candidate has no changes to `crates`, `web`, `desktop` or `scripts` relative to that source.

Verdict: **PASS as analysis/design input; no blocking findings.** This review does not approve an implementation contract, authorize native experiments or establish completion of I03. Concrete response-claim storage, native proof types, freshness/reconciliation rules and budgets still require their separately scoped contracts and independent verification before implementation acceptance.

## Source-grounded findings

The principal current-behavior claims match the pinned source:

- `runtime::App::emit` (`crates/server/src/runtime.rs:40`) returns `()`. Composer metadata read/retention failures can be ignored or logged, and `Store::event` failure is logged without notifying `changed` or returning failure to the caller. The analysis correctly identifies a visibility/durability gap without calling an in-memory event durable.
- The `ensure_runtime` event loop emits before applying status transitions (`runtime.rs:150`), and several subsequent Store writes discard their result. Its approval branch (`runtime.rs:201`) shares the HTTP gate, skips answering when the persisted request cannot be read, then can send an automatic response before a resolution event fails to persist. Existing gating is useful but is not a durable occurrence-level response claim. The analysis does not mislabel it as one.
- `api::respond` (`crates/server/src/api.rs:711`) validates the scoped stored request and response, acquires the runtime turn lock, then sends the native response. On the non-desktop path it calls infallible-at-the-type-level `emit` and subsequently performs a fallible status update. A later local error therefore cannot establish that the earlier native effect was rejected. Desktop response handling remains distinct: `desktop.rs:771` reserves the exact pending web/native identity in memory, retaining that reservation on ambiguous owner-request errors and releasing it only for a definitive protocol rejection. The proposal to add a separately reviewed durable response boundary does not erase this existing protection.
- Both global and per-session event streams read actual Store pages (`api.rs:811`, `api.rs:866`) and close on read failure. The global hidden-row checkpoint has an ID but no data (`api.rs:835`); it is not a durable AgentEvent payload. The proposed transient health channel correctly forbids fake persisted sequence IDs or advancing clients past uncommitted events. Existing Web polling/SSE behavior (`web/src/api.ts:84`) and history-cache reconnection (`web/src/sessionHistory.ts:238`) cannot independently prove storage/native reconciliation.
- Public `/api/health` is outside authenticated API routing and returns fixed liveness/version fields (`main.rs:466`). The analysis correctly calls for a separate authenticated readiness/recording projection rather than silently redefining this public endpoint or exposing private diagnostics. Cached Web history is retained across transport reconnection, so the stated freshness problem is real.

## Accepted boundaries and design safety

The analysis preserves the accepted message-operation contract's minimum write-ahead/result fence and its explicit remaining I03 scope (`docs/message-operations.md`, “Minimum storage-failure safety and remaining I03”). It neither creates a second message ledger nor treats missing receipts, timeouts, body/time matches or fresh IDs as permission to resend. The explicit caveat that I02a's eventual accepted interface must be rechecked is appropriate: that ledger implementation is not present in this pinned source.

I05a opening/ownership/schema validation and transactional startup recovery remain separate. Existing opening recovery can mark owned active sessions disconnected and queued/edit operations uncertain without any native RPC; it is not proof that missing native events or approvals have been reconciled. The analysis retains that distinction and the unsupported arbitrary rollback boundary. It does not present the still-open backup/restore/incarnation work as delivered by I05a.

Accepted I07a deliberately has no trustworthy native generation/expiry observation and keeps native-dependent actions denied (`docs/capability-projection-module.md`). The analysis describes native generation/reconciliation as a future dependency, not evidence already available from a runtime Arc, descriptor or stored status. Its separate listing of liveness, readable cache, writable Store, valid native identity and reconciled history prevents these independent facts from becoming a single permissive boolean.

The bounded-memory, coalescing, no-conversation-backlog and bounded retry requirements are suitable design constraints. The document explicitly leaves exact budgets and overflow behavior open. It also accounts for failure to persist the incident itself, a restart losing volatile incident state, unavailable diagnostics transport and a healthy disk with unresolved native outcomes. These are necessary negatives; they are not claimed to have passed tests here.

## Nonblocking recommendations before implementation tasks

1. **Name the future I07 dependency explicitly.** At analysis lines 18 and 85, link the native-observations follow-up and state that accepted I07a supplies neither connection generations nor authoritative pending-occurrence observations. The present document is sufficiently labelled as a proposal, but this extra sentence would prevent a task author from assuming an existing observation interface can simply be consumed.
2. **Add the present interrupt ordering to the call-path inventory.** `api::interrupt` currently executes fallible `Store::pause_queue` before acquiring/verifying the runtime and sending `turn/interrupt` (`api.rs:617`). The proposed safety behavior therefore requires an intentional integration change. Its contract should explain how local workers remain fenced if durable queue pause fails; merely ignoring that error could let a later queued input race cancellation. Preserve the adapter/owner/turn checks and the external teardown wait, and keep native acknowledgement separate from durable cancellation/reconciliation evidence.
3. **Clarify the startup diagram's `healthy` scope.** The arrow labelled “required opening/recovery complete” should explicitly mean checked recording availability, with native reconciliation freshness still unknown until separately established, or include those required observation checks in the transition. The surrounding five-fact model and restart rules already prohibit the unsafe interpretation; repeating the distinction in the diagram would make the eventual state-machine contract easier to implement consistently.

These are refinements to the next contracts, not evidence that the analysis currently promises implemented health, safe retry, completed native reconciliation or full I03 acceptance.

## Review method and limits

This was a read-only comparison of the exact committed document, selected actual Store/runtime/HTTP/Desktop/Web call chains and the accepted I02/I05/I07 documents. `git diff --check` passed for this review document. No builds, test suites, model calls, real account/native histories, production server operations, Actions mutations or release operations were performed for this analysis review. Concurrent CI observation is separate evidence and does not validate a proposed storage-health implementation.

Before development, root must resolve the listed design decisions, assign non-overlapping files/owners and specify real storage-fault/call-count/crash/browser negatives. No schema migration, response journal, readiness API or UI activation is accepted by this review alone.
