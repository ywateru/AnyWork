---
id: harness-ui
scope: upstream conversation UI extraction
status: merged
depends-on: []
---

## Objective

Extract and adapt the official DeepSeek Harness conversation body from its source, including tool activity, details, execution status and elapsed time. Keep the existing AnyWork composer intact. Apply the extracted presentation to both normalized Codex and Harness messages and preserve existing attachments, previews, approvals, subagent entry points and split views.

## Context

- `docs/INDEX.md`, `docs/deepseek-harness-integration.md`, `docs/ui-design.md`
- Read-only reference: local ignored `ref/deepseek-harness` checkout.
- Screenshot: user-supplied private conversation reference, excluded from public source.

## Path

Own `web/` conversation views/styles/event presentation and agent selection UI, UI-specific `e2e/` files, npm package/lock files if dependencies are required, upstream notices/licenses and UI extraction/layout documentation. Do not alter `Composer.tsx`, `PromptEditor.tsx` or their behavior. Do not edit Rust, backend scripts, `.gitignore`, Cargo files or backend design sections. Coordinate normalized event/capability needs with backend agent through the orchestrator.

## Verification

Record exact upstream commit/files/extraction changes and preserve license attribution. Run TS checks and meaningful rendering/projection tests; browser checks at desktop/mobile widths cover live tools, completed history, interruption/errors, rich output, edit/preview, keyboard disclosures and unchanged composer. Use isolated fixture servers only; do not build into production-served `web/dist` or manipulate real Codex. Commit and report evidence for independent review. An imitation without actual extraction does not satisfy the objective.

## Delivery

Extraction and native-metadata/rich-output follow-ups are merged through `5d9d5b1`. [Independent review](../reviews/harness-ui.md) passes, including actual native image history/tool previews on desktop and mobile. The TypeScript narrowing finding was fixed and independently checked. Composer and PromptEditor remain unchanged.
