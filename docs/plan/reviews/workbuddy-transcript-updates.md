# WorkBuddy transcript and updates — independent review

**Accepted:** product commit `1f72424` and carrier/browser follow-up `b65922a`. They were independently cherry-picked into the review worktree as `50d61fa76c410c702d6e9cebc00283a43b42d9b3` and `4248db81724bba75e5c093ac0f3269e0cfa7b8c7`. The tracked worktree was clean before verification. No blocking findings remain for [the correction task](../tasks/workbuddy-transcript-updates.md).

This accepts the reported visible-context and missing-update corrections. Actual installed WorkBuddy creation/send/collaboration acceptance remains a separate gate. All prompts in this verification were sent to deterministic isolated preload fixtures. The reviewer did not send a real native prompt, restart a native application, change desktop selection/subscriptions, inspect account credentials, modify native history or restart production AnyWork. Root owns merged checks and the authorized AnyWork-only deployment. No version or public release change is part of this task.

## Independent diagnosis and source review

The reviewer independently confirmed the cursor bug in the pinned WorkBuddy 5.9.3 artifact before reviewing the implementation. `ConversationHistoryQueries.requests` passes `beforeRequestId === undefined` to `pageByIds`; that method appends realtime IDs/current assembler requests only when the flag is true. AnyWork's explicit JSON null disabled that merge. The native renderer omits the cursor for latest pages. The correction omits it for latest root/child queries and retains actual older cursors. No native mutation, refresh-through-selection, second engine or retransmission was added.

The same artifact distinguishes canonical user display content, source display blocks and meta prompts. Live canonical text is now preserved verbatim while proven meta blocks are excluded from visible text, attachments and raw input. Passive decoding requires native provenance, a complete sequence of recognized context-role wrappers and a complete user-query wrapper. It preserves the inner query verbatim. It does not globally strip reminder tags, reinterpret arbitrary canonical user text or apply the Codex-specific request-body decoder to WorkBuddy inputs.

The reviewer also independently identified the stable-key repair gap: ordinary Store replay returns the first saved event, so a cleaned projection alone cannot repair an already imported dirty row. The dedicated repair is restricted to the owning external WorkBuddy session, native user key, user-message method and non-pending event. It repairs text/display/input in place while retaining sequence, client/composer metadata and other event fields. Meta-only user rows become non-visible observations without blank user bubbles. Transactional history resets and wakeups refresh existing browsers; assistant and pending records remain intact. A validated live display supersedes passive provenance and cannot subsequently be replaced by a lagging passive snapshot.

The code retains previous branch/partial-read protections, fixed native call allowlists and pending-interaction ownership. No UI response mock was used to establish end-to-end update delivery.

## Shipped and runtime evidence boundaries

Independent REA acquisition analyzed `main/conversations.js` and `renderer/assets/wb-DgDqwhME.js` as inert text from the private extraction with SHA-256 `607a9114759019e892c18763789f6ab26f5bbf0c81bb5102648227ce09a74ea7`. Retained parent: `ev_ed18dd5442d5e2a1e5b6f196f6c79fe1a5d4ce5394a2648cd851d3d7cb908ace`; summary: `ev_01edfb222e81d5bfdad85d9e21425f1a691bb082b071b7809b7e918950470319`. Two selected sources parsed successfully. Graph coverage is partial, with unselected sources and bounded semantic omissions explicit; static analysis does not prove runtime execution.

The reviewer manually inspected the relevant readable artifact bounds: native request queries around `main/conversations.js:16693`, assembler merge around `:17334`, display-source selection around `:2530`, meta classification around `:7690`, and the renderer's cursor-free query around `wb-DgDqwhME.js:3364`. Context-wrapper/visible-text helpers in the artifact's `main/account.js` were inspected as program text, not as an account database or credential store.

The developer/root's declared passive current-runtime comparison returned one completed request with the old null cursor and three with omission; canonical user lengths were 5/8/8 characters, versus 7,364/6,282/490 characters in three generated native runtime envelopes. This was read-only and printed no actual user text or credentials. The reviewer corroborated the boundary from shipped code and independent native-shaped fixtures rather than repeating privileged current-runtime calls. Detailed provenance is in [the module report](../../workbuddy-transcript-updates.md).

## Independent verification

| Check | Result |
| --- | --- |
| Full server Rust suite | 115 passed, 4 explicit native opt-in tests ignored |
| Server Clippy, all targets with warnings denied; workspace formatting | passed |
| Existing shared-history HTTP acceptance, including newly seeded old-cache migration | passed; scope, partial/corrupt/branch retention and idempotence preserved |
| Additional reviewer HTTP native-envelope matrix | passed: complete framing, inner literal tags, missing provenance, quoted input, malformed wrapper, unknown role and input-text provenance |
| Additional reviewer HTTP migration and SSE | same source key/sequence; text, display text and raw input clean; client/composer, pending approval and tool details preserved; history reset delivered in approximately 6 ms; repeated reads stable |
| Final committed CDP carrier with actual built Web client | passed: null-sensitive native snapshots, browser old-cache repair/reset, progressive Web and desktop replies, meta-only bubble absence, repeated snapshots and prior ownership/error regression cases |
| Additional independent real-server Chrome proof | passed: actual older-page import/string cursor, omitted latest cursor, metadata-hidden content, Web composer sends exactly once, desktop-originated partial reply, completion during browser offline, SSE reconnection, idle status, no resend/duplicate and reload stability |
| Fresh out-of-tree Web build and PWA generation | passed; production Web distribution unchanged |

The additional HTTP test was first run against the previous accepted binary and failed at stable-key user correction, demonstrating that the regression is not vacuous. The reviewer migration test modifies only its own temporary SQLite fixture. It checks exported raw input as well as visible history, so cleaning only the rendered bubble would fail acceptance.

The additional browser proof serves built AnyWork assets through a real isolated server, authenticates normally and observes the actual HTTP/SSE/Store/adapter chain. Its native preload intentionally returns only durable content for null and requires the exact string cursor for an older page. Web responses are not intercepted or replaced. Browser offline/reconnect operates only on the isolated Web context; native fixture progress continues independently. The final screenshot was inspected: visible user prompts and the completed reply remain intact without injected context. An intentionally induced earlier disconnect remains a historical fixture notice; the final runtime status is explicitly verified idle.

Verified immutable debug binary: `/private/tmp/anywork-transcript-review-server`, SHA-256 `459b92d6aa3c708f24a87bcba3a2f4c056d3c2841664b7408769c094fef76615`. Additional reviewer artifacts: `/private/tmp/anywork-transcript-independent.py`, `/private/tmp/anywork-transcript-browser.mjs`, `/private/tmp/anywork-transcript-review-dist`, `/private/tmp/anywork-transcript-review-browser.png`. HTTP/CDP services used ephemeral loopback ports and temporary HOME/data/native fixture roots. Only owned fixture processes were stopped.
