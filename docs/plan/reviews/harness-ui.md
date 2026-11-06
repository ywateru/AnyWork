# Independent review: Harness conversation extraction

Reviewed commit: `7343d47e4871fffa37cb5981fe151d0282b27a20`, developer worktree `.worktrees/harness-ui`.

Result: **pass for the committed UI extraction scope; no blocking UI finding**. This report does not pass the still-unreviewed backend or companion integration.

## Source and license

Compared extracted components with the actual local official checkout at `fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159`, rather than accepting a CSS imitation. `DisclosureRow.tsx`, `TextShimmer.tsx`, and `ToolRow.module.css` retain substantial upstream content (text similarity 0.944, 0.922, 0.994 respectively), with explicit AnyWork adapter slots and source comments. The extracted MIT license exactly matches upstream `LICENSE`. Root and public third-party notices and `docs/harness-ui-provenance.md` record revision, files and adaptations.

The diff for both `Composer.tsx` and `PromptEditor.tsx` is empty. Conversation presentation changes remain in the body and activity adaptation; existing authenticated Markdown, rich tool output, preview and editing paths are retained. Reasoning display is explicitly enabled only for Harness; the Codex renderer retains its existing visibility contract.

## Independent execution evidence

Commands executed in the developer worktree, without changing its source:

```sh
npm run typecheck -w web
npm exec -w web -- vite build --outDir /private/tmp/anywork-harness-verifier-ui-dist
ANYWORK_E2E_PORT=3237 ANYWORK_E2E_WEB_DIR=/private/tmp/anywork-harness-verifier-ui-dist ANYWORK_E2E_OUTPUT_DIR=/private/tmp/anywork-harness-verifier-ui-results PLAYWRIGHT_CHANNEL=chrome npx playwright test e2e/harness-conversation.spec.ts e2e/tool-activity.spec.ts
ANYWORK_E2E_PORT=3237 ANYWORK_E2E_WEB_DIR=/private/tmp/anywork-harness-verifier-ui-dist ANYWORK_E2E_OUTPUT_DIR=/private/tmp/anywork-harness-verifier-ui-regression PLAYWRIGHT_CHANNEL=chrome npx playwright test e2e/workspace.spec.ts --grep 'pasting an image|imageView and queued images|document links open|expanded image activities|expanded activity uses individual'
```

Typecheck/build passed. The first browser run passed all 10 cases; the regression run passed all 10 cases. Both runs cover desktop and Android viewport projects. No production `web/dist` build or real Codex call occurred.

The independent browser checks exercise live duration and tool states, keyboard disclosures, failed/interrupted tool rows, agent-switch reasoning isolation, subagent entries, lazy historical output, raw-output modal focus/copy/dismissal, narrow/dark scrolling, image paste and preview, queued image admission, document side-panel rendering with draft retention, image gallery, and individual Codex activity rows.

Visually inspected the independently captured desktop and Android running-conversation screenshots. Tool icons, compact secondary rows, live blue elapsed status, user bubble, available draft composer and viewport containment are consistent with the extraction design. Long descriptions remain accessible through the disclosure's full accessible label and expanded body.

## Limits

These isolated UI fixtures prove the view contract and retained interaction paths. They do not prove that actual upstream Harness image references, tool events, approval ownership or reconnect cursors reach that contract correctly. Those are explicit separate backend and integrated acceptance gates. Arbitrary TUI carrier availability is not a UI defect and must be described accurately by connection documentation.

## Incremental native-metadata review

Reviewed follow-up commit `593f6a1c74adef362f594194d76538f6ad135c4a`: **pass**. The adapter now consumes native `title == tool wire name` plus parsed/string arguments, using pinned upstream tool variants and Chinese labels; explicit upstream presentation titles remain authoritative. This closes the difference between prelocalized fixtures and actual Harness call metadata without classifying shell source. Independently ran the six Harness adapter unit cases, rebuilt to the verifier's isolated output, and reran all four Harness conversation browser cases across desktop/Android; all passed. The browser fixture now supplies native `read`/`bash`/`job_output` names and arguments rather than synthetic Chinese titles.

### Correction: incremental typecheck gate

The initial incremental PASS above was incomplete: it ran unit tests, Vite and browsers, but did not rerun TypeScript's separate checker. The orchestrator subsequently found **blocking TS18046** in commit `593f6a1`, `tool-metadata.ts` catch branch, where mutable `args: unknown` is no longer narrowed to string. Vite is a transpilation/build check and does not satisfy this gate. At that review point, the incremental result was **blocked until a committed fix passed an independent standalone `npm run typecheck -w web` with its own checked exit status**; that blocker is now closed by the committed fix and independent checker result below. The earlier main extraction typecheck remains valid for `7343d47`; it does not cover this follow-up.

### Typecheck fix and real rich output closure

Reviewed `46c036ef90603004a339dbe74d71efb2ca4d18a5` and `94c001849d4de19b385264033ed7a7a4779543f5`: **PASS**. A separate standalone `npm run typecheck -w web` completed with exit 0 after the narrowing fix; the prior TS18046 blocker is closed. Independently rebuilt the committed UI and ran all six updated Harness conversation browser cases (desktop/Android), exit 0. The rich-output patch routes `localImage` through the existing session-authenticated `ImagePreview` and `localFile` through the existing authorized resource action; equal Harness text/output is rendered once.

Beyond fixtures, used the actual official Harness Host with a session created and executed through a separate native carrier before AnyWork attached. The real `read_image` tool produced a durable full-reference image result. AnyWork downloaded that reference, rendered its output and image in both desktop and 390px mobile browsers, opened the image modal, kept it open through a 1.4-second observation and retained the composer draft after Escape. Repeated the big-image/draft check for a native historical user-message attachment. Screenshots in the ignored main-workspace artifacts directory:

- `artifacts/harness-native-desktop.png`, `artifacts/harness-native-mobile.png`: actual tool, output, assistant and unchanged draft composer.
- `artifacts/harness-native-image-desktop.png`, `artifacts/harness-native-image-mobile.png`: actual tool-image modal.
- `artifacts/harness-native-history-image-desktop.png`, `artifacts/harness-native-history-image-mobile.png`: actual historical user-image modal.

All inputs and paths belong to isolated verifier fixtures; no real user account key, private conversation or launch credential is shown. Overall UI extraction and both follow-ups now pass; backend cancellation/disconnection findings were separately blocking at that point and are now closed on `a26d54b`; see [final backend acceptance](harness-backend.md).
