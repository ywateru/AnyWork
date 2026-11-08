---
id: improvement-runtime-lifecycle-design
scope: prioritized-project-improvement
status: done
depends-on: [improvement-capability-observations]
---

# G1 / I07b1: Specify runtime lifecycle and generation fencing

## Objective

Turn independently accepted [call-path research](../analysis/capability-observations.md) into the smallest concrete implementation contract for connection creation/installation/peer replacement, qualified event effects and bounded lifecycle observations. Keep all native-dependent capability actions denied, no Web activation or new probe. This task delivers a design for independent review, not implementation of I07b1.

## Context

- [I07 contract](../../capability-projection.md) and [accepted analysis review](../reviews/improvement-capability-observations.md)
- [Accepted read-only module](../../capability-projection-module.md)
- [I02 operations](../../message-operations.md), [I02a ledger task](improvement-message-ledger.md), [I02b integration](improvement-message-delivery.md)
- [I03 reviewed design input](../analysis/storage-degradation.md)
- [Support matrix](../../support-matrix.md)

## Paths and ownership

Own only new `docs/runtime-lifecycle.md` in the private worktree, with concrete integration/file inventory and future test gates. Root owns central tasks/index/progress. Read actual SDK/server/adapters as needed; root's current source differs from pinned `aacaa19` only in documentation. Do not build, install, connect real native accounts, edit product source/schema or alter running services. Do not start implementation before exact-document independent review.

## Required design decisions

Choose internal singleflight or nonforgeable gate qualification and enumerate lock ordering with existing caller gates, runtime map, peer state and Store. Prevent recursive acquisition/deadlock for callers already holding the session gate; do not hold broad global locks across native/network awaits. Specify the exact creation/install/remove linearization points, cancellation/timeout cleanup, owned versus external transport teardown and deletion/recreation behavior. An orphaned setup task must not keep a new owned process or commit an install after the caller/session was invalidated.

Fence attach-time history/status/emit effects as well as the later runtime event consumer; a check followed by an unguarded await/effect is not a fence. Enumerate both internal runtime epoch and adapter peer epoch with typed producer/binding qualifiers, peer replacement validation and current request/turn occurrences. Cover all existing ensure callers and same-Runtime Harness/WorkBuddy reconnects; include actual revalidation on WorkBuddy reconnect and repeated Harness ready-client invalidation. Explain how current-runtime removal, old response, old settings/status/approval and external close avoid touching a replacement, without claiming remote CAS or multi-owner disambiguation.

Define bounded receipt delivery and snapshot storage, reliable closure/overflow invalidation, monotonic freshness and cleanup. Public native-instance/version fields keep their original meaning and remain unknown when not proved; a local connection ID is separately named. Do not add body/attachment replay buffers, message journals or independent storage-health/uncertainty authorities. Preserve current adapter/mutation/approval reservations, no-competing-engine policy, archive/aux guards and existing read behavior. No source-level exception should silently allow stale native writes.

Explain interaction with I02 preparation claims/immutable native identity, I03 recording gaps, I08 native version support and I11 aliases/owner selection. Identify changes that require coordinated serial delivery before I02b versus disjoint safe work. Specify which old behavior changes in this slice and why, while keeping conservative projection/legacy-client limits explicit.

## Verification

Provide concrete module, real fake-native HTTP and actor/cancellation tests with call counts: two concurrent creates; setup failure/cancel/timeout/session deletion; attachment initial emissions; replacement across each await; old actor/event/exited/automatic response; same-Arc reconnect; invalid peer/snapshot/version; no prompt replay; current occurrence binding; closure/overflow/clock expiry; scoped reads with zero native calls/Store writes. Cover lock/liveness with bounded timeouts rather than sleeps or forced scheduling assumptions. List public/legacy protocol effects and real upstream/platform gaps. A different reviewer checks exact committed contract and key source chains; a design pass does not complete runtime source or native acceptance.

## Accepted design, not source implementation

Candidate `1d92f714f829bc79079016cfed58451190cff8ff` passed independent static/source-chain review `cb924b8563d7c279da60f059d98949a798c7599b` and was merged with its review record. Both P2 implementation clarifications are made explicit in the contract: automatic-response gate waits must not block the normal event consumer, and native Start/Steer cannot stand in for I02's worker/manual authority. No code/build/native test was performed for this design-only gate. SDK primitives, complete connected runtime/adapter migration, durable non-message creation authority and real native/platform acceptance remain separate deliverables; I07 is not complete.
