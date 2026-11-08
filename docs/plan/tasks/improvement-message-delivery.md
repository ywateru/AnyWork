---
id: improvement-message-delivery
scope: prioritized-project-improvement
status: pending
depends-on: [improvement-message-ledger]
---

# G1 / I02b: Connect the ledger to every first-party sending path

## Objective

Integrate the accepted ledger into actual API → preparation → native adapter → queue worker → event → Web flows under [message operations](../../message-operations.md). Implement the minimum I03 write-ahead/result safety in that contract. Acceptance requires the combined real HTTP/SQLite/fake-Agent/browser path; a new UUID field or mocked ledger does not satisfy this task. Root may split disjoint native/Web implementation after the accepted ledger interface is known, while retaining this combined integration gate.

## Context

- [Operation contract and full acceptance matrix](../../message-operations.md)
- [Ledger module](improvement-message-ledger.md)
- [Schema/recovery](../../schema-and-recovery.md)
- [Support matrix](../../support-matrix.md)
- [Review](../../project-improvement-review.md), I02/I03/I07/I10
- [Accepted runtime lifecycle contract](../../runtime-lifecycle.md) and [SDK transport module task](improvement-runtime-transport.md)

## Paths and ownership

Server API/runtime/preparation/Store integration, native identity mapping in the three adapters, shared Web submission journal and both main/child composers, queue editing, all first-party message callers/fixtures and focused real HTTP/browser tests. Root owns central docs/check registration. Develop in isolation; use only deterministic fake Agents/private data/ephemeral ports. No production assets, installed native app changes, native messages, version bump or release.

Coordinate runtime/preparation/adapter changes serially with lifecycle B/C. The accepted design now requires final-writer qualification, initial attach/history/media/child effects and same-Arc peer validation; SDK A alone is dormant and cannot be treated as an installed control boundary. Before dispatching overlapping source tasks, root must assign one owner for `deliver`, cold preparation and adapter native-ID dispatch, identify the exact accepted SDK/ledger interfaces, and settle the separately typed non-message creation authority. A lifecycle ticket is not an I02 preparation claim, and an artificial message operation must not stand in for create/connect. Web journal work can be split only when the actual connected API/projection contract is pinned; the combined HTTP/SQLite/fake-Agent/browser gate remains mandatory.

## Required connected behavior

Authenticate/scope-check; resolve stable ID/digest before duplicate preparation; persist immutable preparation and native identities; commit dispatching before input RPC; preserve goal sub-phases; publish checked operation/queue/event changes; expose scoped authoritative operation queries and protocol capability; reuse the same pending Web envelope after ambiguous HTTP/reload. Enforce missing-ID upgrade behavior and update every first-party caller. Both composer entry points must use one submission mechanism. Do not reopen WorkBuddy auxiliary conversations for writing.

Choose concrete bounded attachment snapshot/hash budgets and document them. Bind/reuse prepared goal/native upload results; no hidden repeated preparation after a lost receipt. WorkBuddy request-ID persistence must be available before snapshot projection, without claiming the native host deduplicates it. Preserve the old queue safety/metadata semantics and ensure queue controls cannot bypass operation identity.

Input-record commit failure invokes zero input RPCs. Accepted-native/result-record failure yields explicit same-ID recording uncertainty and blocks relevant new sends until verified recovery. Stable-ID lookup/observation resolves uncertainty; no text matching or blind resend. Broader storage-degraded UI/approval/health catch-up remains separately open under I03, and must be described honestly.

## Verification

Execute the full contract matrix through production HTTP, SQLite, fake adapter transports and desktop/Pixel browsers. Include double-client same-ID concurrency, changed intent and scope denial, every crash/response-loss boundary, late native echoes, queue admission/edit/worker rollback and legacy recovery, FULL/read-only/lock failures, changing attachments and preparation uncertainty, split goal results and both composers' durable journals/late drafts. Assert native input call counts and exact identities, not just HTTP status or DOM text.

Independent verification reviews the exact committed combined source and executes meaningful negative scenarios beyond implementation-mirroring tests. Root merges only after that pass, runs merged regression, and records that fixture-based correctness does not close native WorkBuddy writing/platform compatibility or complete I03/I05.
