---
id: improvement-connected-delivery-contract
scope: prioritized-project-improvement
status: in-progress
depends-on: [improvement-message-ledger, improvement-delivery-proofs, improvement-runtime-lifecycle-design]
---

# G1 / I02b and lifecycle B/C: pin the connected delivery contract

## Objective

Produce a concrete implementation contract `docs/connected-delivery.md` for the complete API/Store/native/runtime/Web delivery chain. The accepted ledger and dormant SDK do not yet protect current sending. Resolve the actual integration seams rather than inventing another generic journal or enabling a partial migration. This is a source-informed contract deliverable requiring independent review before implementation; it does not itself close I02/I07 or authorize native-positive capability advertising.

## Context

Read the index, `message-operations.md`, `message-ledger-module.md`, `runtime-lifecycle.md`, `runtime-transport-module.md`, `plan/analysis/delivery-proofs.md`, the exact independent proof/SDK reviews, `schema-and-recovery.md`, support matrix and pending `improvement-message-delivery` task. Read real API/Store/adapter/Web call sites, not only documents. Base is current main with SDK source `123cc1c`, ledger source `8d57934` and proof research `a21f793` merged. Source implementation ownership of delivery, cold preparation and native-ID dispatch will be serial and singular; do not assign these to competing tasks.

## Paths and ownership

Own only new `docs/connected-delivery.md` in an isolated worktree. Root owns this task, index, progress and final assignments. No code, build, test process, native profile/account/application, credential, network mutation, production asset, release/version or real prompt. Existing read-only source/references suffice. Propose follow-up module/integration boundaries in the document without making central task files or self-approving the contract.

## Required decisions

1. Enumerate actual HTTP/queue/worker/goal/main+child composer entry points, error/status/recovery response shapes, scoped query and info protocol identity, upgrade behavior and the exact shared Web persistent journal contract. Pin concrete JSON examples, which fields are authoritative, and how a same-ID ambiguous POST is resolved without replay or erasing a newer draft. Explicitly handle unavailable IndexedDB/local persistence and pending attachment references; no credential persistence.
2. Define typed semantic receipt variants with exact trust/provenance requirements and per-adapter production of proof versus presentation items. Use the accepted research: native observed item may be conservative fallback; Harness inbox ACK is method-specific live-memory admission (not crash durability); Desktop internal retarget and WorkBuddy void/async queue cannot be mislabeled. Do not fabricate item IDs or expected-turn CAS. Any unresolved native source question is explicit, with a precise proof gate rather than a generic accepted=true escape. Preserve usable honest outcomes instead of silently disabling the intended product or claiming native completion.
3. Set concrete attachment file-count/per-file/aggregate/copy/hash/private-mode budgets consistent with existing limits, immutable artifact path/identity, per-step preparation claim/receipt/reconciliation, native uploads, saved WorkBuddy native/client mapping hydrated before first/reconnect snapshot, and goal subphases. A lost create/upload receipt never permits blind repeat.
4. Settle separately typed durable non-message creation/connection/fork authority. Enumerate real native effects outside admitted messages, uniqueness/identity/scope, preclaim/result/uncertainty/startup recovery/migration, single-service ownership and explicit abandonment/reconciliation. Reuse accepted Store transaction/schema infrastructure where appropriate; no artificial message IDs, permissive legacy token, competing setup journal or implicit fallback. Pure attachment to a confirmed durable native binding versus potentially mutating start/resume must be distinguished with actual source evidence.
5. Connect accepted lifecycle singleflight/CommitCell/current runtime+peer+occurrence, final SDK writer and mandatory adapter bridge boundary, all initial/event/history/media/child effects and automatic-response scheduling. Name the injected-clock/five-second freshness owner and all raw installed Runtime consumers to migrate. No source rollout can activate only an easy subset; split implementation may remain unactivated until combined negative matrix passes.
6. Define source/schema/API compatibility and exact test matrix through real HTTP/SQLite/fake transports/browser, including native method/accepted/upload/thread-prep counts, crashes/recording-fence outcomes and exact attempt/turn/peer identity. Separate fixture pass from actual supported native/platform acceptance. Include concrete development tasks that end in the combined actual first-party acceptance, not only more research.

## Verification

The author checks every local document/source reference and exact accepted-interface assumptions, commits the one document and reports remaining explicit questions. A different agent independently reviews actual source call-chain completeness, durability/native proof semantics and implementability. Blocking findings are corrected before root pins source task ownership. Passing the design is not source acceptance; root continues implementation and combined verification afterward.
