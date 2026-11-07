---
id: improvement-capability-observations
scope: prioritized-project-improvement
status: in-progress
depends-on: [improvement-capability-projection]
---

# G1 / I07b: Native observations and critical-error integration analysis

## Objective

Identify the smallest implementable next module after accepted I07a, by tracing actual native connection/identity/version/closure and command-error ownership. Produce a source-grounded design and call-path inventory for expert/independent review before changing runtime code. Existing conservative unknowns are correct until trustworthy observations exist; do not make native writes available merely by interpreting runtime-map membership as connection health.

## Context

- [Capability/readiness contract](../../capability-projection.md), [accepted I07a module](../../capability-projection-module.md)
- [Support matrix](../../support-matrix.md)
- [Message operations](../../message-operations.md), [ledger task](improvement-message-ledger.md), [delivery task](improvement-message-delivery.md)
- [Review I07/I08/I10/I11](../../project-improvement-review.md)

## Paths and ownership

Read server runtime, SDK/RPC, Codex managed/shared/follower adapters, Harness and WorkBuddy transport/identity/approval/goal/settings and capability sources. Own only `docs/plan/analysis/capability-observations.md` in the private worktree. Root owns central contract/task/progress changes. No product source, schema, API, browser assets, production or real native account calls. Do not run model/native experiments or install dependencies for this analysis.

## Required output

Trace connection creation → validated identity/version → observation generation/freshness → native notification/command → closure/invalidation → pure capability read, separately by topology. Name concrete structs/functions and trustworthy fields versus missing evidence; explicitly identify races and unknown/custom-plugin cases. Enumerate all main/child/queue command creation and error adaptation paths so no hidden consumer bypasses the contract. Propose typed errors only from controlled boundaries; unclassified after-dispatch transport failures remain unknown and cannot trigger resend. Preserve old compatibility/explicit-status contracts and native acceptance labels.

Recommend an independently verifiable module boundary with concrete inputs/outputs/ownership, safe freshness budget, invalidation and bounded-memory policy, authority/recheck rules, focused negative tests and native/platform acceptance gaps. Describe required SDK/adapters changes if existing observations are insufficient. Do not silently introduce generic probes, new native control, a second operation journal or broad error-substring translation. Coordinate delivery-owned error/dispatch changes as dependencies rather than editing overlapping code.

## Verification

Analysis must cite actual source symbols at the pinned SHA, distinguish proposed behavior from implemented behavior, and state all unresolved design choices. A different reviewer checks the exact committed document and selected source chains before root accepts design or creates implementation tasks. Documentation acceptance is not implementation, native observation acceptance, UI activation or completion of I07.
