# Mobile saved-login UI author verification

2026-11-16. Worktree `mobile-workspace-layout`, branch `codex/mobile-restore-ui-final`. This is the mobile UI lane for the root `docs/login-session-persistence.md` contract. No real account, credential, device, Agent, production service or deployment was used.

## Dependencies and ownership

- Layout: `f92061a` → `15c975e` → `0f7d5a4` (the latter is the cherry-pick of layout-only `6fc9311`). Layout independent report `17e6558` accepts the final layout separately.
- Frozen public DTO/messages: Native author's `8e8a77c`, cherry-picked here as `e2044c0`. That author owns `account.ts` and its tests; this UI commit does not modify them.
- Native system integration: `81cee2f`, reviewed separately. It is **not** required to build these synthetic browser fixtures and is not included in this UI branch. The UI uses existing no-argument `snapshot`, `refresh`, `logout` calls and the existing login request envelope; no new native method or request field is introduced.
- This lane changes only `MobileApp.tsx`, collected mobile fixture cases and this report. It does not change the desktop account UI, Native persistence, server/SW cache or website strings.

## Visible state and actions

```text
startup: restoring (account null; no devices / login / register)
   ├─ Native verified signedIn → my devices / existing connected App
   ├─ signedOut, no saved grant → explicit login / register
   ├─ restoreRetryable → retry restore / exit and clear saved grant
   └─ reauthRequired
        ├─ invalid/uncertain grant → explicit login; never silent SSO
        └─ CLEAR_REQUIRED → retry exit/clear only, until confirmed signedOut
```

Initial projection is `restoring`, epoch0/revision0. Native configure/snapshot supplies the authoritative phase. While restoring and after initial setup is ready, one snapshot read is scheduled about one second after the previous read finishes. It never overlaps reads or invokes login/refresh automatically. A phase/epoch change, busy account operation, unmount or IPC failure cleans up the timer and invalidates the pending callback. A failed snapshot read leaves recovery gated, displays an error and offers explicit state recheck/exit. The Native 90-second shared network budget and rotation semantics remain Native-owned; the UI does not cancel or replay a rotation.

Manual restore retry uses `accountCommand("refresh")`, with no request arguments and no SSO. IPC-error recheck also uses this command; Native treats it as a projection read while restoring and starts a retry only in restoreRetryable. Logout stays available during recovery. Pending snapshot results use the operation ticket and the existing Native epoch/revision comparison, so a pre-logout result cannot reopen the old account. Repeated same-owner restoring snapshots no longer dismiss the user's exit confirmation; connection/export cleanup still happens on an owner change or leaving signedIn.

Only the five frozen public recovery codes are rendered through fixed friendly messages. Unknown snapshot errors get a generic recovery explanation, rather than displaying arbitrary Native data. `MOBILE_AUTH_CLEAR_REQUIRED` has no login/register or retry-restore button: only another explicit attempt to exit and clear. A failed clear remains reauthRequired; the UI does not claim logout success.

The existing account page now explains that Native protected storage holds the recovery authorization and that reopening attempts restoration. It separately describes the login service/WebView cookie boundary. Exit confirmation explicitly says it clears this application's saved grant and closes phone connections; computer Agent tasks continue. Website memory-only wording is intentionally deferred until candidate acceptance, so this report makes no shipped/release claim.

## Verification

Seven new collected cases use only the public synthetic Tauri bridge and real React UI. Controlled browser clocks test the one-second polling behavior without adding sleeps:

1. Held initial configure/snapshot never flashes SSO or devices; a Native completion with no state event is observed through polling; polling stops at signedIn; account copy is accurate.
2. Storage-unavailable retry is explicit refresh, never login. A held poll blocks subsequent polls; logout followed by late poll/event results remains signedOut.
3. IPC failure stops automatic reads and offers manual recheck; subsequent restoring polls preserve the open exit confirmation.
4. Saved-grant-invalid requires explicit login.
5. Uncertain refresh requires explicit login, with no automatic refresh/replay.
6. Failed durable clear with CLEAR_REQUIRED offers no SSO; a second confirmed successful clear unlocks the normal signedOut entry.
7. Unknown snapshot error content is not rendered.

Executed results:

- Development MOBILE entry, the seven new cases: **7 passed**.
- Exact production **MOBILE** entry (`web/vite.mobile.config.ts`), **15 passed, 0 skipped, 0 flaky**. This includes all seven new cases plus both short-landscape geometry/trusted-touch cases, existing first-run/cancelled-login, unknown-directory/key verification, full App upload/save/share/back, late chooser after epoch change, pending approval identity/back and absent-Native-bridge behavior.
- TypeScript `tsc --noEmit -p web/tsconfig.json`, relevant Prettier and whitespace checks: PASS.
- No new dependency, full unrelated suite, Rust build, APK, AVD or physical-phone operation. Browser projections do not verify Android Keystore persistence, actual OAuth SDK refresh or real process restart; those gates belong to the Native author and independent verifier.

The fixture rejects argument envelopes on no-argument account commands, retaining the real bridge spelling. Its restore modes are optional; all previous fixture defaults remain unchanged. These cases are in `e2e/mobile-native.spec.ts`, already collected by the required mobile CI config.

## Source and evidence binding

Private output: root `artifacts/mobile-restore-ui-author/`. The directory contains `dev-first.log`, `build-final.log`, `exact-final.log`, `exact-results.json`, `bundle-binding.json`, private Vite/Playwright configs and `exact-final/` screenshots. Screenshots show the retry, invalid/uncertain grant, clear-required and account states with synthetic identity `林晓` / `lin@example.invalid`, as well as the existing connected-workspace controls. The author visually checked the retry page. Build/dist/cache use private paths and port3430, with shared dependencies linked rather than copied.

| Entry asset                  | SHA-256                                                            |
| ---------------------------- | ------------------------------------------------------------------ |
| `assets/mobile-B6tbbjYu.js`  | `cb7ac388e3ae3d138a88551afd562a4768d656b6060825ed085af9ab5c8431de` |
| `assets/mobile-BdM7bMIa.css` | `d872ce01a599ab5fe58b04ac8466a860d82066cd2b2157a9d848fe3d65b01765` |

Production command (replace local private paths for an independent worktree):

```sh
node <root>/node_modules/@playwright/test/cli.js test \
  --config <root>/artifacts/mobile-restore-ui-author/playwright.built.config.ts \
  --grep 'saved login|first run|directory unknown|full App uses|late chooser|missing native bridge|native back leaves approval|short landscape'
```

Independent UI review is required before merge. No site, release metadata, publisher state or running service was changed.
