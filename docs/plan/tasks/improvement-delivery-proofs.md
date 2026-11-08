---
id: improvement-delivery-proofs
scope: prioritized-project-improvement
status: done
depends-on: [improvement-runtime-lifecycle-design]
---

# G1 / I02b design input: actual native input acceptance evidence

## Objective

Trace the actual native acceptance/correlation boundary for each supported transport before connecting the operation ledger. Explain which exact method-specific response or identity-bound observation can prove input accepted, and which remain unknown. This is read-only research for I02b, not permission to broaden `InputReceipt`, enable native writes or implement a generic bridge-ACK proof. I02a source is still under independent re-review; cite its exact candidate rather than treating it as accepted.

## Context

- [Operation contract](../../message-operations.md), [ledger task](improvement-message-ledger.md) and [delivery integration](improvement-message-delivery.md).
- Ledger candidate `8d579347831ee5c17cf2561e14ef95efd17c9ae9` and its module document in the retained ledger worktree.
- [Native observation research](../analysis/capability-observations.md), [runtime lifecycle contract](../../runtime-lifecycle.md), [support matrix](../../support-matrix.md).
- WorkBuddy and Harness integration, persisted-history and transcript-projection contracts linked from [the index](../../INDEX.md).

## Paths and ownership

Own only new `docs/plan/analysis/delivery-proofs.md` in a separate tree. Read current repository/adapters/SDK and existing local reference source/evidence as needed; no source edits, builds, native processes, account/profile reads, network mutations, prompts or production operations. Root owns this task/index/progress. Independent design-input review follows the exact committed document.

## Required findings

Enumerate managed Codex stdio, shared Unix Codex, Desktop follower, Harness and WorkBuddy actual start/steer/control paths. For each, record the exact native method and request/result/event fields, where transport receipt ends and native acceptance begins, how thread/client/request/item/turn identity is established, which mappings survive restart, and the point at which a native result could be lost. Include owned versus shared/auxiliary restrictions and generic custom plugins without assuming Codex proof semantics apply to them.

Compare actual evidence to candidate ledger `InputReceipt`/`Binding`/one-attempt qualification. A turn-only response, bridge `accepted` oneshot, local echo and exact text/time coincidence are not generic acceptance proof. If a method-specific correlated native ACK could supply a separate typed proof, identify its actual upstream contract/source, the immutable request binding needed before invocation, what it proves, and all absent/unverified fields. Do not invent an item ID, turn UUID, native instance or native deduplication guarantee to fit the current receipt type. If evidence is inadequate, specify an honest uncertain outcome and the exact identity query/observation that could resolve it, or state that no such query is established.

List all durable correlation data I02b must store before invoke and make available before initial/reconnect snapshot projection, especially WorkBuddy native/client request mapping. Identify the necessary typed interface additions and their owner, but do not implement or claim them accepted. Distinguish source/spec reasoning, existing fake-host tests and existing actual native evidence; missing runtime evidence stays missing. Reuse existing lifecycle research instead of restating its whole registry/cleanup design.

## Verification

Static trace tables must cite exact product/reference revisions and source paths/lines. Recheck every claimed producer-to-adapter-to-native/response-to-event-to-ledger relationship in real code; label synthetic adapter fields explicitly. Provide concrete future real-fake-transport/HTTP negative tests with exact input counts, response loss, late echoes, restart, rejected/unknown responses and identity mismatch. No new test is claimed executed. A different reviewer checks the exact committed analysis and key chains before it informs the connected API/ledger proof contract.

## Independent acceptance

Exact research `a21f793` passed independent static review `c45c558` and is merged. Root incorporated N1 Harness synchronous-memory/asynchronous-persistence detail; no new receipt or native behavior is accepted. Ledger source is accepted/merged separately at `a26d6f4`; original candidate references remain exact historical source locators.
