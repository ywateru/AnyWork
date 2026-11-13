# Android Mobile UI candidate — author evidence

2026-11-13. Source lane: `codex/mobile-ui`. This document accompanies the UI candidate commit; it is author verification, not independent acceptance or APK evidence.

## Source and dependencies

Contract base `b7f13f1`. Transport TS dependency `d8afd9e` (local cherry-pick `6b1daeb`) plus oversized-body followup `8cb5eb6` (local `f546f2c`; its complete adapter harness retained when resolving the missing-file conflict). Account DTO checked read-only against `951c22c` / `fc9f307`: snapshot/cancel/logout/refresh have no invoke args; login/device_update use `{request: DTO}`. Native system contract coordinated with Boole (`73d4e23`, `1dd7467`); UI source does not import shell code. Username `5462fe4` was not cherry-picked or edited.

The entry is bundled `web/mobile.html`, built by `web/vite.mobile.config.ts` into `web/dist-mobile`. It mounts the existing App controller with mobile navigation; no remote `/app` loading and no forked business controller. Public Tauri `core.invoke`, `core.Channel`, and `event.listen` are the only bridge surface. No token or login credential is provided to UI.

## Verification

Run from this worktree root, using existing dependencies (no install):

```sh
npx tsc -p web/tsconfig.json --noEmit
PLAYWRIGHT_CHANNEL=chrome npx playwright test --config e2e/mobile.config.ts
```

From `web/`:

```sh
../node_modules/.bin/vite build --config vite.mobile.config.ts
npm run build
../node_modules/.bin/vitest run src/sessionHistory.test.ts src/requests.test.ts src/sessionNotifications.test.ts src/imageAnnotations.test.ts src/remoteTransport.test.ts src/fileLinks.test.ts src/threadLinks.test.ts
```

Results: 9/9 browser scenarios; 7 files / 66 targeted shared-Web tests; TypeScript, mobile build and existing Web build pass. Vite reports existing large syntax-highlight/main chunks. Site string change verification: `python3 scripts/build-site.py` and `PLAYWRIGHT_CHANNEL=chrome node scripts/site-test.mjs` pass. Download destinations unchanged.

Browser config starts Vite on `127.0.0.1:3248/mobile.html`; no asset build prerequisite. The fixture in `e2e/mobile-native.spec.ts` injects the public `window.__TAURI__` boundary with `page.addInitScript`. It uses the real `NativeTransport`, real App and shared components, synthetic account/session/file/PTY data, and no real account, credential, gateway or existing session. No native package is required for this source review.

Covered:

- First-run, login/cancel/retry, device guide, account summary; exact noarg/enveloped account command calls.
- Unknown directory distinct from empty; online `null` distinct from offline; full first/changed key display and exact key confirmation; clipboard rejection visible.
- Real NativeTransport FormData Chinese filename upload, native file save/share, cumulative chunk ACK and 22 MiB explicit export failure; external HTTPS/source handling and unsafe scheme rejection.
- Late chooser completion after account epoch change cannot report saved; stable scope isolates file drafts and uncertain sends.
- Native back event consumed/ACKed once, safe-area CSSpx values and stale-inset rejection; dirty file back confirmation and draft restore.
- Native terminal Channel ready/input; unsupported system notification settings omitted.
- Unknown send preserves draft and blocks resubmission across page reload/reconnect; refresh does not resend; cancelling explicit unlock keeps protection.
- Native back leaves approval pending; explicit allow sends exact request_id and result through transport.

Screenshots are small synthetic browser evidence in `/tmp/anywork-mobile-ui-e2e` (welcome, devices, key verification, conversation, terminal). They are not committed. No real account screenshot or text dump was used.

## Remaining integration gates

No Android runtime evidence is claimed here. Actual SDK login, system URI chooser/multiple/cancel, save/share Android outcomes, clipboard secure context, PTY/paste, edge-to-edge `adjustNothing`/IME geometry, system gesture/back and foreground authorization need the integrated shell/AVD verification. Browser approval/transport bytes do not substitute for a real gateway or APK test.

Connect cancellation invalidates UI waiting and closes a late successful transport; it does not claim native handshake cancellation (native bounded timeout applies). Save cancellation is distinct from success, and share reports only chooser opened. PDF in native UI uses save/share fallback rather than an unsupported iframe. Grant is process-local, while SSO cookies may persist independently. Existing App copy remains Chinese; no nonfunctional language or notification toggle was added.

Independent reviewer: Mendel (`mobile-ui-review` worktree). Any P1 raised against this source candidate will be fixed in this lane. Shell/transport/account review remains with their assigned independent reviewers.

## Followup after independent review ccaca93

Mendel independently reproduced two P1s in `062130d`: a restored file draft silently adopted a newer remote revision; a native closed event while POST was pending aborted the request without marking unknown delivery. The followup accompanying this section fixes both:

- File drafts retain their original content and revision. Remote revision changes put the restored draft into the existing comparison UI and disable direct save until explicit rebase or discard. No PUT is issued before that choice.
- Each message submission persists a unique receipt ticket before POST crosses IPC. Pending native disconnect, abort, unload and reload preserve that ticket. Successful response or explicit `not_sent` settles only its matching ticket; late responses/confirmations cannot clear a newer one. If persistence fails the message is not dispatched. Drafts remain editable while send is protected.

Additional followup fixes: preserve browser `a[download]` for DocumentPreview (independent Web PDF regression); native continues to use direct Blob system-save. Late export success and failure belong to their original account; cancellation only removes captured export handles. Dirty file tab selection/close and preview close ask before leaving. Mobile dialogs trap focus, restore it and support Escape. File tabs have real 48px hit areas without toolbar overlap. Corrected the document tree CSS selector.

Verification on final source: TypeScript and mobile build pass; shared 7 files / 66 unit tests pass. The 17-case full mobile suite passed, followed by an additional targeted explicit-`not_sent` scenario (1/1 pass). New cases include both independent P1 triggers (remote change and pending native close), pending reload, confirmed receipt clearing, bridge missing with no browser auth fallback, native PDF save/share/cancel, dirty tab cancellation/focus, and late export failure. The independent reviewer is rechecking these fixes and the Web PDF case; his initial report remains the authoritative blocked review until that followup is accepted. Native APK gates remain as listed above.

## System bar appearance handshake

UI now invokes `plugin:mobile-system|appearance_set` with `{request:{dark:boolean}}` on initialization and resolved `data-theme` changes. Responses must confirm `{dark:boolean}`. Calls are serialized so theme toggles cannot reorder native icon state. Native owner Boole implements both status/navigation icon contrast and reapplies it on resume; the app's resolved theme, rather than OS-only night mode, is authoritative. The final full mobile browser suite passes **19/19**, including OS-light/app-dark and return to system appearance; TypeScript and the transport adapter harness (7 checks) pass. This is bridge evidence only: actual system-bar pixels and SDK/IME overlays remain an Android runtime gate.

## Approval/child receipt and destructive contrast closure

This followup is limited to the known native approval/child-composer unknown-result P2 and account-screen contrast. The separately reported image-viewer/editor portal inset P2 remains open and is excluded from this commit by the coordinator's narrowed scope.

`RequestCard` now persists a receipt before POST, scoped to the native connection identity and exact session/method/request_id/sequence. Native unknown delivery, close, abort and reload leave actions protected and show that the computer may have received the response. Refresh reads history/catalog only; it never replies. Explicitly unlocking requires confirmation and never sends by itself. A trusted completed call or definite `not_sent` settles only its ticket. Ordinary Web retry semantics remain enabled. `SubagentComposer` reuses the same session receipt protection as the main composer. The shared notice does not fork the App/controller.

The two failing author fixtures were corrected without removing assertions: question success now waits for the actual submitted state before asserting receipt removal; the child fixture now represents a real spawned, interactive child instead of a read-only activity. Successful question bytes are asserted as the original request_id plus exact answers result.

Dangerous account actions/errors use `--mobile-destructive`, with light `#b42318` and dark `#ff8a80`, rather than one color for both backgrounds. On the actual account screen, WCAG text contrast is 6.57:1 on the light page / 6.03:1 on its surface, and 7.85:1 on the dark page / 6.71:1 on its surface. Opposite custom content backgrounds do not override the account screen's theme background; all four combinations exceed 4.5:1. The synthetic dark/custom screenshot was visually inspected at `/tmp/anywork-mobile-ui-e2e/mobile-contrast-mobile-des-66abb-contrast-dark-custom-ffffff/dark-destructive-custom-background.png`.

Final-source checks:

- `PLAYWRIGHT_CHANNEL=chrome npx playwright test --config e2e/mobile.config.ts`: **24 Mobile cases + 4 contrast cases = 28/28 pass**, including all prior P1 trigger regressions and typed-unknown/close/reload approval receipts, query without replay, original-tool question response, and child-only message dispatch protection.
- TypeScript, mobile assets and existing Web production build: pass. Targeted requests/sessionHistory/subagents unit tests: **3 files / 51 pass**.
- Existing Web PDF fixture: **desktop + android-web 2/2 pass**. Its test covers draft restore, authenticated PDF, download-link semantics and keyboard split persistence. Additional affected shared-component Web cases cover approval error retry and child lifecycle/send isolation: **desktop + android-web 4/4 pass**.

For the Web checks only, the existing service executable was copied to the private path `/tmp/anywork-mobile-ui-web-receipt/anywork` before use; SHA256 `8a861fdcc8f0ed59598c6ee85cc0687ed8c41a7a6282380256c8f7fc4a418cbe`. It was not rebuilt or represented as a Rust candidate from this UI lane. Tests use the script's isolated fake-agent workspace and private port 3268; no existing real sessions or accounts are used.

Exact Web PDF command: `PLAYWRIGHT_CHANNEL=chrome ANYWORK_E2E_BINARY=/tmp/anywork-mobile-ui-web-receipt/anywork ANYWORK_E2E_PORT=3268 ANYWORK_E2E_OUTPUT_DIR=/tmp/anywork-mobile-ui-web-receipt/results npx playwright test e2e/conversation.spec.ts --grep 'previews authenticated PDF'`.

Dependencies remain those above, plus native `appearance_set` registration/ACL/Kotlin/resume candidate `260c14a` for UI `74698d2`. No package/lock/Cargo/username files are changed. This is source/browser evidence, not APK login, chooser, IME, system-bar pixel or lifecycle acceptance. Mendel receives the stable followup directly for independent re-review; the open portal P2 and native runtime gates must remain explicit in the final independent report.
