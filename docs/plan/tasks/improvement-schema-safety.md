---
id: improvement-schema-safety
scope: prioritized-project-improvement
status: in-progress
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
