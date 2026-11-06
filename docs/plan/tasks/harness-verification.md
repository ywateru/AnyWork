---
id: harness-verification
scope: independent protocol and UI acceptance
status: pending
depends-on: [harness-backend, harness-ui]
---

## Objective

Independently verify committed backend and UI deliverables against the full Harness integration goal. Before commits are ready, prepare an isolated actual upstream Harness host and determine protocol-level acceptance checks; do not implement the product or change developer worktrees. Coordinate fixture ownership with the backend developer to avoid duplicate installations and ports.

## Context

- `docs/deepseek-harness-integration.md`
- `docs/plan/tasks/harness-backend.md`, `docs/plan/tasks/harness-ui.md`
- Actual source in the main workspace's ignored `ref/` directory.

## Path

Own `docs/plan/reviews/harness-*.md` review reports in the main workspace, plus temporary isolated verification resources. Review only committed development changes after the orchestrator identifies each commit. Do not edit product code; send actionable blocking findings to the orchestrator for developer fixes.

## Verification

Verify real host workspace/session identity, native-host-created history, same-session messages through both clients, tools/output/status projection, approvals, cancellation, reconnect/deduplication, capability errors and host lifetime. Verify UI provenance and license, desktop/mobile rendering and unchanged composer functionality. Verify ref/source archive exclusions. Report findings with severity, blocking status, source/design and code locations, actual command evidence and an overall pass/blocked conclusion. Never manipulate the real 3210 service or installed Codex/Harness/AnyWork processes. No real model API expenditure.
