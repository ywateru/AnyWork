# Independent review: compact history and delayed event replay

Reviewed stable commit: `5d20f1f719ffc101ac3ec6894e2a2e9465506e15`, developer worktree `.worktrees/release-018-ci`.

Result: **PASS; the completed-answer duplication blocker is closed**. The separate desktop-manager containment failure is addressed by coherent measurement without relaxing bounds. The immutable v0.1.8 release is not changed; the orchestrator owns the v0.1.9 merge, complete CI and publication gates.

## Evidence and classification

Independently examined the failure log, both error contexts and the workspace trace from CI run `42246204530`. The desktop document-preview error context shows one assistant article containing the entire answer and all four links twice, with the session idle and a completion notification. This was product evidence, not an ambiguous navigation link or a test selector to weaken.

The trace's compact history response (`c18486095f6d9b7069ba25dca1617908657cc4fd.json`) contains a single 216-character answer. Its sequence is user 718, turn start 719, commentary completion 721, tool completion 722, answer completion 725 and turn completion 726; `latest_seq` is 726. Answer start 723 and delta 724 are omitted. A global SSE connection from cursor 717 was established before that response. The trace does not retain the streaming body, so delayed delivery of 723/724 is an inference checked by deterministic reproduction rather than a claim to have observed those raw frames.

The backend intentionally compacts start/delta events once an item completes. The owned-session cache sorted snapshot merges but appended subsequently received missing live events, including older events omitted from that snapshot. Projection therefore processed complete text before a late delta; a late start could also regress item status. Replayed completion was correctly deduplicated by sequence, leaving the wrong text/status. This explains the canonical single-copy response and doubled article without assuming duplicate model output.

## Product fix review

The change inserts missing owned-session events in ascending canonical sequence order. Ordinary newer events keep the append fast path; exact sequence replays remain ignored. The fix does not compare text, drop all events below a snapshot watermark, replace item IDs or change imported external-history reconciliation. Concurrent older items, distinct identical delta chunks and separate sessions remain valid. The original document-preview strict link assertion is unchanged.

Independently reviewed the committed tests and ran:

```sh
npm run typecheck -w web
npm test -w web -- src/sessionHistory.test.ts src/events.test.ts src/transcript.test.ts
npm exec -w web -- vite build --outDir /private/tmp/anywork-ci-019-verifier-dist
ANYWORK_E2E_PORT=3249 ANYWORK_E2E_WEB_DIR=/private/tmp/anywork-ci-019-verifier-dist ANYWORK_E2E_OUTPUT_DIR=/private/tmp/anywork-ci-019-verifier-results PLAYWRIGHT_CHANNEL=chrome npx playwright test e2e/session-replay.spec.ts e2e/desktop-overview.spec.ts e2e/workspace.spec.ts --grep 'compacted completed|connection map and popup|document preview keeps' --repeat-each=2
```

Each standalone command exited 0: TypeScript checking, 31 cache/projection/transcript unit cases, isolated build, and all 24 browser cases. The browser run checks the snapshot-before-SSE ordering on desktop and Android, waits for a subsequent replay marker before asserting a single answer/article/link, repeats the unchanged real-fixture stale-document-response test, and checks four desktop-manager viewport sizes twice per browser project.

Also wrote a separate temporary verifier test under `/private/tmp/anywork-ci-019-independent`, outside either source tree. It preloads compact completions for two turns, then replays their missing starts/deltas plus a concurrent older item, starts a third live turn with two distinct identical chunks and an exact replay, and delivers the matching item ID in another session. Against the unchanged main cache module it failed with `samesame` instead of `same`. Changing only that module import to the reviewed fix made the same test pass. It asserts both completed turns remain completed, their text stays canonical, the older concurrent item survives, the new turn retains `haha`, exact replay is ignored, turn order is preserved and the other session remains isolated. This independent red/green check closes the cross-turn/new-item and legitimate-repetition acceptance boundaries without modifying product source.

## Desktop geometry classification

The CI geometry assertion compared the host's rectangle from one asynchronous browser call with the button's rectangle from a later call, reporting a 1.5px bottom difference. The markup places the button inside the naturally sized host flex node. Font loading can change layout between those calls; the available error context alone cannot establish the exact reflow instant, and no claim is made to have captured it.

The reviewed test waits for bundled font readiness and obtains both rectangles in one synchronous DOM evaluation. It checks left, top, right and bottom containment with no tolerance, strengthening the old bottom-only assertion. All four sizes passed repeatedly in both browser projects, including the previously failing Android emulation at 1440×1000. No desktop CSS, service control or ownership behavior changed. There is no remaining evidence of a stable containment defect.

## Isolation and remaining gates

All verification used an out-of-tree Web build and isolated fixture server on port 3249. The fixture server exited after the browser run. No production port 3210, installed application, real user conversation, real model credential or production build output was changed. Full merged CI and release delivery remain separate orchestrator checks; this report passes the committed product correction and focused regression scope.
