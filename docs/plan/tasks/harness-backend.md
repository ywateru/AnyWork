---
id: harness-backend
scope: Harness shared-host backend
status: merged
depends-on: []
---

## Objective

Implement a usable DeepSeek Harness agent connected to the existing local Harness host, alongside Codex. Investigate the actual cloned upstream carrier, document exact contracts, and implement configuration, workspaces/session discovery, history, stream translation, prompt, interrupt, models and supported approvals/attachments. Preserve shared ownership and meaningful errors. Add local-only reference protections. No stubs as final integration.

## Context

- `docs/INDEX.md`
- `docs/deepseek-harness-integration.md`
- `docs/plugin-protocol.md`, `docs/architecture.md`
- Read-only reference clones: local ignored `ref/` directory.

## Path

Own Rust crates, root Cargo files, backend adapter assets (outside web), `.gitignore`, scripts for Harness integration/source archives, backend integration/setup documentation, and backend CI paths as needed. Do not edit `web/`, root npm lock/package files, `e2e/`, or the UI task files. Propose any unavoidable boundary edits to the orchestrator.

## Verification

Use an isolated actual upstream Harness host and a deterministic local model endpoint (no real provider key/charges), alongside unit/protocol/error tests. Test host-created session discovery and bidirectional same-session traffic, history/live deduplication, reconnect, interruption and supported permissions. Verify archives exclude force-tracked `ref`/`.worktrees`. Run formatting, targeted Rust checks/tests and record exact commands/results. Never stop or send prompts to the real 3210 AnyWork/Codex instances. Commit all deliverables and report source contracts and remaining risks before independent review.

## Delivery

Backend commits through `a26d54b` are merged. [Independent review](../reviews/harness-backend.md) passes against official npm Harness `0.2.2-rc.1`, with native-created history, shared-session traffic, real tools/attachments, queue/steer, cancellation, approval isolation, pending-request redelivery and interruption during assistant streaming. The review's cancellation and interaction-lifecycle blockers are fixed. Setup and supported scope are documented in [the connection guide](../../harness-setup.md); no fallback engine is started.

