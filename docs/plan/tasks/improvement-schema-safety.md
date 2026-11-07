---
id: improvement-schema-safety
scope: prioritized-project-improvement
status: done
depends-on: []
---

# G1 / I05a: Safe schema opening before operation-ledger changes

## Objective

Implement the first deliverable of [schema-and-recovery](../../schema-and-recovery.md): explicit transactional schema opening/migration, supported/legacy schema validation, single-service startup ownership and fail-closed future-version handling. This is a dependency of I02's durable operation ledger, not completion of full I05 backup/restore.

Source dependency I01 is independently accepted and merged at `463cb29`; that Store change is the baseline. This task may develop in isolation while the disjoint G0 file/CI candidates are repaired. It does not waive their gates or mark G0 complete.

## Context

- [Project review I02/I03/I05](../../project-improvement-review.md)
- [Schema and recovery contract](../../schema-and-recovery.md)
- [Progress tracker](../improvement-progress.md)

## Paths and module boundary

Own `crates/server/src/store.rs`, an extracted `crates/server/src/store/` schema module if useful, focused Store tests, an isolated restart/schema HTTP test under `scripts/`, and the module contract's actual evidence section. Register a module through `main.rs` only if genuinely required; report overlap before changing other API/runtime paths. Do not add the future message-operation schema or implement a superficial full-backup command in this task.

Root owns check-pipeline registration and central API/architecture/progress documentation. Build outputs and test data must stay within the assigned isolation worktree. No production assets/services, real tokens/native histories or external task calls.

## Verification

Use real SQLite transactions and production `Store::open`. Cover fresh/current/recognized legacy/future/foreign/malformed schema, interrupted/failed DDL, concurrent-owner refusal, crash/reopen, sequence preservation and atomic startup recovery. Add a real isolated HTTP restart smoke with a fake Agent proving no automatic replay. Developer commits focused changes and evidence; another agent independently reviews the exact candidate, including forward-version no-application-mutation and legacy compatibility. Root merges only an accepted candidate and runs merged checks.

Full I05 consistent backup/restore/retention, G1 stable operation IDs and storage-degraded state remain tracked independently.

## Review gate

Candidate `fc2b9aa` was independently reviewed at `ce482da` and remains blocked by B1. Its SQL whitespace normalizer conflates identifiers such as `TEXTNOTNULL` with `TEXT NOT NULL`, and `INTEGERPRIMARYKEYAUTOINCREMENT` with an actual integer primary key. The latter malformed declaration was accepted by the production opening path and recovery inserted a NULL event sequence. Repair must validate actual structural constraints and preserve SQL token/literal identity before WAL changes or recovery. Add real-opening negative regressions that retain seeded active status, queues, journal mode and sequence state after refusal; preserve existing legacy, ownership, future-version and I01 acceptance. A separate verifier must review the exact corrected commit before merge.

Correction `84774c2` passed independent review `9fa5154` and was merged at `d343d0d`; the first candidate remains historical failed evidence. The accepted correction combines token-boundary-safe identity with SQLite structural metadata and additional negative/positive real-opening tests. [Full merged checks](../reviews/improvement-schema-merged.md) exited 0: server 144 / desktop 34 / SDK 5 / Codex 3 unit tests, Web 317, all registered HTTP checks including schema 3 / I01 4 / files 6 / desktop-host 20, browser 611 passed / one existing skip and updater. This accepts the scoped local module and unblocks ledger work. Native Windows at `3d66212` subsequently passed all 17 applicable schema/ownership tests. The failed run did not reach Linux schema checks; that remaining gate, physical power loss and the rest of I05 remain separately tracked.
