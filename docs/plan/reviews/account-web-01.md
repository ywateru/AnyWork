# Independent account Web review 01

Reviewed candidate: `13ead5cfd107ca1875aa02166e40861020d67ffb` (product implementation `39ae724`; candidate followup is documentation only). Reviewer is separate from the author. Review is against the approved account/device design, `account-verification`, and the Web layout/lifecycle contract. Product fixes are outside this review commit.

## Findings

### W1 — P1, blocking: native browser fetch is invoked with the AccountStore as its receiver

Code: `web/src/accountData.ts:132` (constructor default `fetcher = fetch`) and `:176` (`this.fetcher(...)`). Contract: `docs/account-web-layout.md`, Data and lifecycle, requires real Account API reads and preserved custom-data writes after official Logto login.

A default AccountStore stores the native Window fetch function on an object and calls it as that object's method. In Chrome, native fetch rejects this receiver with Illegal invocation. AccountStore catches the exception and reports ACCOUNT_UNAVAILABLE. Consequently successful hosted sign-in cannot load or edit the device settings in the shipped browser path. The injected fetch mocks in the unit suite do not reproduce native receiver requirements.

The author's actual development-tenant hosted sign-in completed. With the same official SDK opaque Account API token, alternating calls using the default constructor and an arrow-function fetch wrapper produced failure / HTTP 200 / failure / HTTP 200. This real integration result was reported during independent review; the static call chain independently establishes the receiver error. A real browser regression must exercise the default constructor. Preserve injectable fetch support without changing the native receiver.

### W2 — P2, blocking: cancellation of an uploading request closes unrelated encrypted work

Code: `web/src/remoteTransport.ts:396-430`. Contract: approved design § remote business boundary requires cancellation/PTY cleanup and multiplexed encrypted access; Web layout Data and lifecycle requires all business operations through the adapter. Cancellation of one request must not invalidate an otherwise valid Noise session.

`cancelRequest` calls `reject`, which deletes the outstanding ACK waiter. A genuine ACK already queued by the desktop can subsequently arrive. The ACK branch treats the now-missing waiter as INVALID_FRAME, and the websocket message handler closes the complete transport, terminating sibling operations and terminals.

Independent reproduction used the actual Rust snow interop fixture and headless Chrome clatterjs client. After the successful handshake, the test delayed delivery of genuine encrypted websocket messages by 100 ms, started a 65,536-byte upload, waited for an active ACK waiter, aborted it, then issued `/api/info` after 250 ms. Result: `{cancelled:"CANCELLED",next:"CONNECTION_CLOSED",closed:true}`. No plaintext or fabricated frame was injected. The existing 17 assertions pass but their immediate cancellation happens before this in-flight ACK race.

Accept a bounded, precisely matching retired ACK for a canceled request without accepting arbitrary unknown ACKs, duplicate ACKs, or replayed ciphertext. Add a real browser/Rust regression that keeps another request or PTY alive. Inspect the corresponding timeout/error waiter-retirement paths as well.

### W3 — P3, non-blocking: closed-session recovery is hidden in workspace settings

Code: `web/src/remoteTransport.ts:222-237`, `web/src/AccountApp.tsx:629-641`, `web/src/App.tsx:2036-2045`. RemoteTransport expires within five minutes and closes requests/terminals, but does not notify AccountHome to clear its connection. AccountHome continues rendering the workspace with a closed adapter. The translated `sessionExpired` message is unused. A user can recover through Settings → disconnect, so this is not a security fallback or a blocked recovery path, but an explicit expired/disconnected state with a return-to-devices action would improve the intended account flow. No business operation should be retried automatically.

## Independent verification

- `npm run typecheck -w web`: passed.
- `npm test -w web`: 32 files, 323 tests passed.
- `PLAYWRIGHT_CHANNEL=chrome ANYWORK_REMOTE_WORKTREE=/Users/water/work/2026/any-work/.worktrees/account-desktop node web/scripts/remote-interop.mjs`: 17 real browser/Rust assertions passed. Covers Noise IK clatterjs↔snow handshake, chunked HTTP including 20 MiB, 22 MiB per-connection assembly bound, eight concurrent requests, binary/multipart, PTY, immediate cancellation, relay ciphertext, replay closure, incorrect token/key and plaintext URL rejection. This uses the native fixture's test account verifier and synthetic local HTTP handlers; it does not establish production JWT validation or all AnyWork business semantics.
- Additional genuine delayed-ACK cancellation test: failed as W2 above. Reproduction scratch script `/tmp/anywork-review-late-ack.mjs`; essential steps are recorded above because scratch files are not a release artifact.
- `python3 scripts/build-site.py` and `PLAYWRIGHT_CHANNEL=chrome node scripts/site-test.mjs`: passed all ten en/zh viewport combinations (1440/1024/768/390/320), language negotiation/manual language persistence, keyboard tabs, asset loads, immutable release URL selection, stale metadata ordering and DMG/ZIP selection.
- Inspected desktop Chinese homepage and 390 px account sign-in screenshots. White/black AnyWork identity, visible account entry, registration and local-data boundary copy are consistent with the layout document. Homepage preview identifies itself as a demonstration. Account login screenshots alone do not establish authenticated device UI correctness.

## Source and boundary assessment

Reviewed the complete candidate changes, including the official Logto client creation/callback/token use; AccountStore read/patch/verify preservation and bounds; CyberGrid directory/tunnel mapping; key confirmation/pinning; Noise transport; Api HTTP/event/binary/PTY injection; preview/download/upload paths; account-scoped drafts, notification state and caches; logout/account-change aborts; service worker exclusions; bilingual site; Vercel assembly/source export and vendored notices.

The intended chain exists: account SPA → official Logto hosted authorization → per-account customData directory → CyberGrid public device/tunnel lookup → pinned desktop Noise responder identity plus encrypted resource JWT → encrypted API/binary/event/PTY adapter. The Web source does not introduce a plaintext business fallback. Business connection scopes use issuer/subject/installation rather than changing tunnel URLs. Public registry metadata is not used as authorization or revocation. Local manual entry remains at the native/local root; hosted advanced entry explains that route. CyberGrid source provenance and upstream all-rights-reserved notice are retained; retention does not grant publication permission.

Logout closes the active transport, aborts connection establishment and account writes, clears account data and unmounts the workspace. Identity/storage changes invalidate the account and redirect. Directory reads are separately aborted during effect cleanup; no independently reproduced stale-account rendering defect was established. Actual default AccountStore browser integration is blocked by W1, so authenticated rename/remove, refresh after native device registration, logout/late-response and owner-switch integration must be rerun on the corrected committed candidate rather than inferred from mocks.

## Cross-lane and release gates

- First-key confirmation asks the user to compare the desktop's public key. Native installation ID/public-key display is being completed separately; verify the integrated desktop UI before accepting this flow. This is a cross-lane gate, not an additional Web-author-only defect.
- Actual development Logto hosted login succeeded, but actual AccountStore use is blocked by W1 at this candidate. Real desktop grant → directory registration → same-owner Web discovery → encrypted business workspace → disable/logout still requires isolated integrated acceptance.
- Production resource/role configuration is unavailable under the existing Logto Free plan. The separately documented $56/month base prerequisite has not been purchased. No production readiness is inferred from development tests.
- CyberGrid distribution permission, exact-source/publisher release gates, physical phone/cellular acceptance, native permission confirmation and supported-platform acceptance remain separate gates. No paid deployment or source publication was performed by this reviewer.

## Conclusion

**blocked** for the reviewed Web source candidate: fix W1 and W2 and independently rerun the default AccountStore browser path and delayed-ACK integration against the exact new commit. W3 is non-blocking. Passing isolated crypto/site/unit checks does not approve production functionality or publication.
