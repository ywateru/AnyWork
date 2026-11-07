---
id: improvement-message-ledger
scope: prioritized-project-improvement
status: pending
depends-on: [improvement-schema-safety]
---

# G1 / I02a: Durable operation ledger module

## Objective

Implement the durable Store boundary in [message operations](../../message-operations.md) after the independently accepted I05a merge. This module introduces a real v1→v2 migration and typed operation admission/state/queue transactions. It does not by itself make HTTP delivery idempotent, implement the Web journal, or close I02/I03. Do not advertise the protocol capability until the connected sending paths are accepted.

## Context

- [Project review I02/I03/I05](../../project-improvement-review.md)
- [Message operation contract](../../message-operations.md)
- [Schema safety and recovery](../../schema-and-recovery.md)
- [Continuing progress](../improvement-progress.md)

## Paths and ownership

Own the Store/schema operation module, focused real-SQLite tests/fixtures and operation-module documentation evidence. Root owns central task/progress/API/index updates. Do not change native adapters, API dispatch, Web or release/runtime assets in this first module task. Report any essential ownership overlap before implementation. Use an isolated worktree based on accepted I05a main, private target/data and no real account histories/tokens/Agent calls.

## Required module boundary

- Define a versioned canonical immutable intent and typed ledger/goal states, stable identities and error distinctions. Reject ID/request/session binding conflicts, malformed required data and illegal phase transitions. A transport request number or text/time heuristic is not an identity.
- Persist store/incarnation identity, enforce it at admission, retain non-executable used-ID tombstones through session deletion, and distinguish authoritative never-recorded from unavailable reads. Model the independent preparation claim/result/uncertainty transitions; recorded input alone never authorizes a repeated side effect. No retention or manual-rollback safety claim.
- Add the actual v1→v2 migration with schema validation and preserved event IDs, source metadata, legacy queues/edits/composer/feedback. Future-version refusal still precedes application mutation, and ownership/recovery remain safe. No generic orphan/event decode gate or data repair fallback.
- Implement checked Store operations for admission/read/scoped session listing, preparation references, dispatch boundary, acceptance/rejection/uncertainty and required queue transactions. Same ID/body returns existing state; changed content cannot update it in place. Expose enough atomic module operations that later API integration cannot accidentally split queue/ledger/event publication.
- Startup `dispatching` becomes `uncertain`, accepted is never executable, recorded does not auto-continue, restored queues remain paused. Legacy rows get identities only through explicit safe module transitions; unknown historical sends never become pending. Preserve queue edit/cancel/FIFO/recoverability semantics with new IDs for changed content.
- Critical transaction failures return explicit errors and roll back. Do not hide write failure in tracing or claim an update is durable before commit. Implement deterministic production-path fault seams needed for meaningful transaction tests, not an alternate test-only ledger.

The implementation must specify the actual schema, operation fields and transition API in its module docs before verification. Follow the accepted contract rather than introducing unbounded JSON state or an API that allows arbitrary caller-selected phase rewrites.

## Verification

Real SQLite and production Store methods: fresh/v1→v2/current/future/malformed schema; migration fault rollback; exact source/sequence preservation; same-ID concurrency; semantic digest conflicts; illegal transitions; queue/operation/echo transaction rollback; legacy pending/sending safety; crash/reopen and accepted/unknown recovery; owner refusal and I01 scope regressions. Preserve existing I05a tests. A separate reviewer inspects and executes the exact committed candidate.

Before module acceptance, list the concrete methods consumed by the next [delivery integration](improvement-message-delivery.md) task and their expected inputs/errors. Module pass is not an end-to-end delivery claim. Root runs merged checks and records remaining native/platform boundaries before advancing dependencies.
