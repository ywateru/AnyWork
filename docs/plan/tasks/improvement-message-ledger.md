---
id: improvement-message-ledger
scope: prioritized-project-improvement
status: in-progress
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

## Implementation choices

Source dependency I05a has passed independent review, full merged local checks and [actual Linux/Windows CI at `aacaa19`](../reviews/improvement-g1-source-ci.md). The new ledger/v2 source still requires its own review and platform checks. Implement the reviewed design with one ordered migration/opening path, durable singleton store/incarnation, permanent opaque used-ID registry without a session FK, cascade-deletable operation details, typed preparation-step claims and a checked queue association preserving existing FIFO/edit sequence IDs. Registry-only entries are non-executable tombstones. Old untyped queue mutation methods must reject ledger-associated rows rather than bypass the new transactions.

Canonical v1 uses sorted JSON object keys, exact strings/array order and versioned parsed `serde_json::Number` serialization, without claiming RFC 8785 or mathematical numeric equivalence. Compare canonical bytes as well as version/hash. Enforce 22 MiB/depth-128 canonical limits; manifest budgets are at most 16 files, 20 MiB each and 64 MiB total, with checked arithmetic. Actual artifact copying/hashing/native path security remains delivery integration, not a claim inferred from manifest validation.

Detailed DDL/typed method signatures, recovery/fence transitions and selected error/proof formats must be recorded in the module document with the implementation before exact-commit review. No arbitrary phase setter, automatic legacy adoption, native idempotency claim, duplicate migration engine, full event decode or Web/API feature advertisement. Preserve confirmed/unknown preparation and input/goal states across crashes and avoid issuing a second dispatch/side-effect execution qualification on repeated method calls.

## Candidate and resumed review — 2026-11-08

Candidate `35cbd01002143ef09bac442f6650cfb5e238e7e6` is committed in `codex/improve-message-ledger` and awaits independent source acceptance. Developer evidence: server 172 passed / 5 ignored (28 ledger cases plus the internal child-process entry exercised by its parent tests, existing native opt-ins remain ignored); Clippy/build/fmt passed; schema HTTP 3, I01 HTTP 4 and selected legacy-queue HTTP 4 passed. The candidate's module document records exact APIs, fault/crash history and remaining typed native-ACK evidence work. These are developer reports, not merged or end-to-end acceptance.

The extra server manifest change enables serde_json's `unbounded_depth` facility only for the ledger's explicitly byte/depth-bounded decoding path; other JSON decoders retain default limits. The independent reviewer must verify that boundary and exact staged API `expect` annotations rather than accepting a blanket dead-code waiver. User-authorized cleanup removed reproducible targets, so review rebuilds use the private tree with `CARGO_INCREMENTAL=0`. Source, pending branches, accepted logs and review evidence were retained; production remains unchanged.

Independent review `800950fa0e9779c05043978d21c8288692e782eb` requires changes for three reproduced blockers: known-fenced authoritative absence, editor-held FIFO head overtaking and loss of explicit paused/manual queue dispatch. The message operation contract now explicitly separates scheduling authority from actual native routing and preserves inspectable state during the Store recording fence. Correct the module with production-path regression tests, retain the first failure evidence, and independently review the exact corrected commit before merge. Module review still does not activate existing HTTP/native/Web paths.

The clarification at `ca0eaaf` passed independent static review `32739c17f83e29f966386e6f2d57d870490a0429`. Corrected source `8d579347831ee5c17cf2561e14ef95efd17c9ae9` is committed and undergoing exact-source re-review. Its typed `DispatchAuthority::{Immediate,QueueWorker,ExplicitQueueSelection}` preserves native routing as a separate choice. Developer evidence: ledger 34 passed / 1 internal crash-child entry ignored, server 178 passed / 5 ignored, Clippy/build/fmt/diff passed, schema HTTP 3 / I01 HTTP 4 / legacy queue HTTP 4 passed. The developer stopped editing before re-review; these reports are not independent acceptance or new merged/platform evidence.

Independent re-review `c3117a8f4f93ba5319dd1e05bcd413caa4005aaf` passed the exact corrected source and closed B1/B2/B3 with all seven additional production-Store tests passing. Exact-source server 178 / 5 ignored, schema HTTP 3, I01 HTTP 4, legacy queue HTTP 4, restored-source Clippy/build/fmt also passed independently. Root merged at `a26d6f437b8296649d346cac04626f69e7777af8` and started one full isolated `scripts/check.sh` invocation in `codex/improve-ledger-merged`; task completion still awaits that result. The root production service/data/Web assets were not used; local test caches are reused only between private accepted/review trees. New v2 platform CI and connected delivery remain separate gates.
