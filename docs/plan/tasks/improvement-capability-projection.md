---
id: improvement-capability-projection
scope: prioritized-project-improvement
status: done
depends-on: []
---

# G1 / I07a: Additive read-only capability projection

## Objective

Implement only the first server module of [capability/readiness projection](../../capability-projection.md) after independent contract review. Preserve manifests and legacy fields, add typed catalog/session state with scoped pure reads and conservative unknowns. Do not change message-operation delivery or advertise complete I07/real-native acceptance.

## Context

- [Projection contract](../../capability-projection.md)
- [Support matrix](../../support-matrix.md)
- [Review I07/I10](../../project-improvement-review.md)
- [Message operations](../../message-operations.md), for boundaries this task must not bypass

## Paths and ownership

Own a new server capability-policy/observation module, minimal API/catalog routing/integration and focused unit/real HTTP tests, plus module evidence docs. Avoid Store/schema, SDK/native invocation changes, Web behavior and release artifacts. Existing session data/runtime observations may be read, but never start an execution process or call mutating probes. Report required shared API overlaps before work; delivery integration must not develop overlapping API paths concurrently. Root owns central documentation/check registration.

## Verification

Independently review exact committed source; use real HTTP with fake plugins/private persisted fixture sessions to assert session/current-scope auth, explicit unknown and topology-specific policies, safe experiment labels and absence of leaked descriptor/credential fields. Demonstrate zero spawned execution processes/input/setting changes when catalog or capability endpoints are read repeatedly. Verify descriptor validity is not called liveness, disconnected cached histories remain readable, busy is not unsupported, custom unobserved capabilities are unknown, and stale identity/runtime observations are invalidated. Preserve existing command safety checks and no-competition behavior. Module completion is not activation of the new Web consumer or completion of I07.

Independent contract review of `fb48eae` found no blocking findings. Implementation starts in a separate worktree while the disjoint schema merged/browser and previous-source CI checks run. No module may merge before its own exact-commit independent review and relevant merged checks. Unknown native readiness is an acceptable truthful output when this module has no trustworthy observation source; filling it from runtime membership or stored status is not.

## Accepted module

Source `b374fe31` passed independent review `1bfd268` and merged at `89f5d30`; script registration merged at `2942baa`. [Merged regressions](../reviews/improvement-capability-merged.md) passed at that exact source. This closes only the additive read-only module. Trustworthy native observations, Web consumption, typed critical errors, command enforcement and the remainder of I07/I10 remain open; no native operation was accepted by this task.
