---
id: harness-verification
scope: independent protocol and UI acceptance
status: completed
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

## Final acceptance

Independent [backend](../reviews/harness-backend.md), [UI](../reviews/harness-ui.md) and [discovery](../reviews/harness-discovery.md) reviews pass. Historical blockers are closed. A final real-host smoke used the merged main binary and final isolated Web build, restoring native-created history, executing a tool through the original host, and checking actual historical/tool images in desktop and mobile browsers. All owned verification processes and live fixture credentials were cleaned up.

The orchestrator additionally ran these merged checks, inspecting each command's exit status:

| Check | Result |
| --- | --- |
| `cargo fmt --all -- --check`, locked/offline workspace Clippy with `-D warnings`, server build | pass |
| `cargo test --locked --offline --workspace` | 121 passed, 4 existing external/internet tests ignored |
| Web standalone typecheck, unit tests, Prettier, isolated production build | pass; 298 unit tests |
| Discovery companion lifecycle tests | 8 passed |
| Harness/tool/conversation/history/approval/subagent/edit/rich-composer/model browser suites | 111 passed; 1 desktop-only layout case skipped on Android |
| Existing service integration, service-control, editing, discovery, shared-control, desktop bridge/IPC/HTTP, goal, review, source-export and release-version scripts | all 13 commands passed; 124 tests |

The browser suites used port 3241 and `/private/tmp/anywork-harness-final-web-dist`; root production `web/dist` was not overwritten. Backend real-host tests use official npm Harness `0.2.2-rc.1` and a deterministic local model, not real provider credentials. Both reference clones remain local and untracked; force-tracked reference/worktree fixtures are excluded from exported source. Composer and PromptEditor have zero diff against the pre-goal source.
