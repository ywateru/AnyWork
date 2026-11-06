---
id: sidebar-agent-filter
scope: sidebar Agent filtering and sourced identity icons
status: ready
depends-on: []
---

Implement [the sidebar Agent filter contract](../../sidebar-agent-filter.md). Own the relevant Web sidebar/header/state/styles, local Agent assets and source attribution, source-export image allowlist if required, and focused unit/browser tests. Do not change Composer/PromptEditor, backend execution ownership, release versions, production outputs, or installed applications.

Develop in the orchestrator-created worktree, commit before independent review, and build Web to an isolated temporary output. The running 3210 service must not receive test prompts or be replaced by the developer. The orchestrator will merge, deploy and publish the final version after review.
