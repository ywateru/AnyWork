# Independent review: sidebar Agent filter and identity

Reviewed product commit: `db44b615410138052c0837dcf38dc044f09a329f`.
Reviewed test follow-up: `ac0d80c4c565425f97c9cc3279d717a989134f92`.
Developer worktree: `.worktrees/sidebar-agent-filter`, branch `task/sidebar-agent-filter`.

Result: **PASS; no blocking product finding**. This is the sidebar presentation scope described in [the approved design](../../sidebar-agent-filter.md). Release publication and production deployment remain the orchestrator's separate gates.

## Contract review

The filter uses the actual `Session.agent` ID and creates a separate filtered/sorted array. It does not replace App's complete session collection or change selected-chat, draft, panels, stream, notification or execution ownership. Agent, archive, project and search matching happen before directory timestamps are derived, so a newer excluded chat cannot move a directory ahead of one with a newer matching chat. Existing status grouping and trailing running/starting/waiting indicators remain in place.

All/Codex/DeepSeek Harness remain offered even with no registered plugin or matching sessions. Configured plugins, historical IDs and an unavailable saved selection are included without treating an unknown Agent as Codex. Selection is stored per server URL. Current-server loading/error guards take priority over filtered empty messages; the empty Agent view has a clear-All action. The menu uses the existing floating-menu dismissal and keyboard handling. No Composer, PromptEditor or backend execution code changed.

## Independent execution

Ran each command against the committed developer worktree, checking its exit status independently:

```sh
npm run typecheck -w web
npm test -w web -- src/sidebarAgents.test.ts
python3 scripts/source-archive-test.py
npm exec -w web -- vite build --outDir /private/tmp/anywork-sidebar-filter-verifier-dist
ANYWORK_E2E_PORT=3243 ANYWORK_E2E_WEB_DIR=/private/tmp/anywork-sidebar-filter-verifier-dist ANYWORK_E2E_OUTPUT_DIR=/private/tmp/anywork-sidebar-filter-final-results PLAYWRIGHT_CHANNEL=chrome npx playwright test e2e/sidebar-agent-filter.spec.ts e2e/session-loading.spec.ts e2e/panels-menus.spec.ts
```

Standalone TypeScript checking, four focused unit cases, four source-export tests and the isolated Vite build passed. The final browser run passed all 28 desktop/Android cases. This includes actual Agent IDs, configured/unknown/unavailable IDs, the always-present unconfigured Harness option, combined filters, the search-induced directory-order reversal, archive/project intersection, directory/status empty views, per-server persistence and loading/error behavior. It also verifies that filtering out the selected Codex row retains its draft and hash and still receives an SSE message, with no API writes. Related regressions cover cache reuse, offscreen execution streams, conversation-owned panels and menu dismissal.

The browser tests exercise outside click, focus exit, Escape, selection closing, arrow-key selection and focus restoration; light/dark image visibility and decoding; 320px mobile drawer operation; and retained running/waiting indicators. Independently inspected desktop and 320px screenshots. The 18px Agent marks fit existing rows and remain separate from the trailing execution status. Review captures are retained in ignored `artifacts/sidebar-agent-filter-verifier-desktop.png` and `artifacts/sidebar-agent-filter-verifier-mobile.png`.

### Initial browser failure and closure

The first independent 28-case run had 27 passes and one Android per-server test timeout. Trace evidence showed the helper resolving the loading overview's `window-tabbar .mobile-menu`; session loading then hid that old trigger and presented the conversation toolbar trigger. The drawer was already open in the failure snapshot and the correct Harness preference remained selected. A standalone rerun of that case passed, but the initial failure was retained as a test reliability finding.

Committed follow-up `ac0d80c` fixes only the helper: it treats an open drawer as success, freshly locates the visible trigger after the real loading transition, uses bounded retries, and asserts the resulting open state. It also exercises repeated opening without closing the drawer. There is no force-click or weakened filter assertion. The independent final rerun of the same complete 28-case set passed, closing this finding without changing product behavior.

## Asset identity, safety and source export

Independently hashed both installed official Codex original files read-only and matched the documented original SHA-256 values. Bundled 96×96 PNG hashes match `web/public/agents/README.md`; source artwork and theme variants are explicitly identified there. The two Harness SVGs are byte-for-byte identical to `apps/web/public/favicon.svg` and `favicon-dark.svg` in the official checkout at `fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159`. Their hashes also match the attribution table. XML inspection found only `svg`/`path` geometry, without scripts, event attributes, external references or executable content.

`AgentIcon` references local `/agents/` files only, so runtime icon display has no external provider dependency. Known marks have separate light/dark assets; unknown IDs use the generic Lucide Bot glyph. Root/public notices and the asset README preserve source, license/trademark and no-affiliation information. Both exact Codex PNG paths are Git/source-export allowlisted. Independently checked the trusted export file list includes all four marks and the provenance README, while reference checkouts, worktrees and an unreviewed neighboring raster filename remain excluded. No installed app file was modified.

## Scope and isolation

This task changes the presentation of already loaded sessions; isolated routed UI fixtures are appropriate acceptance evidence. It does not require repeating the separately accepted real Harness Host integration, and this report does not imply arbitrary TUI control. Tests used an isolated fixture server on port 3243 and an out-of-tree Web build. They did not send prompts to production port 3210, modify installed applications, replace production Web output or use a real model key. The Playwright-owned fixture process exited with the test run.
