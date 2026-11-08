---
id: improvement-runtime-transport
scope: prioritized-project-improvement
status: in-progress
depends-on: [improvement-runtime-lifecycle-design]
---

# G1 / I07b1-A: Qualified SDK transport boundary

## Objective

Implement delivery module A of the independently accepted [runtime lifecycle contract](../../runtime-lifecycle.md): the private qualification/transport primitives needed by the later complete runtime migration. This is a deliberately dormant SDK boundary until every installed-runtime producer/consumer and final adapter mutation is migrated in B/C. Do not describe a module pass as connected stale-actor protection, full I07, new capability support or restart-safe creation.

## Context

- [Exact design review](../reviews/improvement-runtime-lifecycle-design.md), including N1/N2.
- [Runtime/peer call-path research](../analysis/capability-observations.md).
- [Message operation contract](../../message-operations.md), especially one-attempt dispatch authority and preparation uncertainty.
- [Capability module](../../capability-projection-module.md), whose native-dependent actions remain denied.
- [I03 design input](../analysis/storage-degradation.md), whose persistence/health authority is not owned by the SDK.

## Paths and ownership

Own `crates/agent-sdk/` and new `docs/runtime-transport-module.md`, with focused private test fixtures if necessary. Do not edit server runtime/adapters/Store/API, Web, release versions, root deployment assets or central task/index/progress files. Develop in a new isolated tree from accepted main, with `CARGO_INCREMENTAL=0`, a private target and deterministic fake processes/Unix sockets/bridges only. No real native account, history, process, message or production restart.

Before implementation, record the exact public-to-the-crate type/API, admission/close ownership and bounded channel contract in the module document. Runtime-specific setup/session/peer/occurrence evidence stays server-owned; the SDK carries an opaque qualified admission contract without interpreting caller JSON as authority. Do not introduce a duplicate registry, operation journal or permissive default validator. Report essential file/dependency overlap before expanding ownership.

## Required module behavior

Provide an opt-in qualification path with immutable captured binding and a real final-admission check in the serialized local writer. Stdio checks immediately before its first bounded write; Unix must carry the qualifier through the outbound queue and check at the actual writer, not only at enqueue. Distinguish refused-before-admission from admitted/in-flight/unknown; partial write, timeout, closure and generic native errors cannot become not-sent or accepted proof. No retargeting or replay after revocation. Pending requests and receipts must terminate with explicit outcomes on cancellation/close without leaking registrations.

Preserve raw legacy SDK compatibility for unmigrated consumers but keep it visibly separate; never silently downgrade a qualified call to raw send. Bridge admission must reach the actual final adapter mutation. Since production adapters are outside A, either supply a separate mandatory qualified bridge consumer boundary that cannot ignore qualification, or explicitly refuse qualified use on an unmigrated bridge. A guard checked only before bridge enqueue is insufficient. Document and test that migration seam without claiming the old adapters already consume it.

Provide bounded metadata/terminal primitives and explicit resource ownership consistent with the lifecycle contract: sticky revocation independent of event queue draining, no reuse after close, bounded receipt metadata with actual byte/count enforcement, and owned versus external transport teardown. A legacy unbounded transcript queue must not become the qualified metadata backlog or defeat terminal revocation. No observation cache may hold input text, attachments, provider objects or an unbounded replay queue. Monotonic freshness/cancellation/deadline state is explicit; no wall-clock or arbitrary-frame inference.

The server manager will eventually construct and consume the qualifying authority. There is no permissive production constructor wired into existing paths, no blanket lint suppression and no artificial call added just to make dormant code look used. Record which APIs B/C must consume and when staging-only lint annotations can be removed.

## Verification

Use the actual SDK transports and deterministic fake endpoints with barriers/oneshots and bounded timeouts: revoke before enqueue, while queued, immediately before admission and after admission; assert exact wire/invoke counts and uncertainty classification. Cover partial stdio writes, socket queue pressure, bridge consumer refusal/mandatory admission, pending-call cancellation, EOF/close/producer failure with full metadata queues, repeated close and nonrevivable old bindings. Assert receipt byte/count bounds and resource reclamation. Owned child shutdown must reap the test process; external teardown must leave its fake host alive. Existing SDK/bridge tests and dependent workspace compilation must pass without production integrations changing behavior.

A different reviewer checks the exact committed candidate and independently exercises negative final-writer/closure cases. Root merges only after that pass and appropriate merged regressions. Complete B/C still requires internal runtime singleflight, qualified attach/history/media/child effects, all existing callers, same-Arc reconnect validation, nonblocking automatic responses and durable preparation/creation integration. This task cannot retire those gates or enable native-positive capabilities.

## Dispatch evidence

Independent static review `6290eeee123f430b8cac4e6dbcc07598279cbec6` passed exact task `3e980bf20e0eb4ab6e6c66738b2541223e131e28`, with the unmigrated bridge seam explicitly retained as an implementation gate. Development is dispatched in `codex/improve-runtime-transport` from that accepted baseline. No source candidate or transport-test evidence exists at dispatch; implementation and exact-source review remain open.
