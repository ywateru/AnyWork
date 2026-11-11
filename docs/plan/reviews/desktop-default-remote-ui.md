# Desktop default remote — UI author evidence

Date: 2026-11-11. Base: `bae0758`. Contract: [desktop onboarding layout](../../desktop-onboarding-layout.md) and [task](../tasks/desktop-default-remote.md). This report accompanies the UI implementation commit; Native implementation and independent acceptance are separate lanes.

## Delivered behavior

After the introduction, a fresh signed-in authorization prepares the local workspace through `desktop_start`. Only successful preparation for the current authorization epoch dispatches `account_enable_default`, once per UI epoch. An unavailable account snapshot suspends this dispatch until a fresh snapshot arrives. The Native RAM grant owns the durable once-per-login/default-consumed/manual-off policy across UI reloads; the fixture models that boundary rather than inventing browser persistence. Explicit retry remains `account_enable`.

Remote operations now have a separate pending state. A held or failed default attempt leaves the prepared local console, browser-open action, Settings and logout usable. Generation and authorization-epoch checks discard obsolete operation results after logout. Default failure does not loop or restart preparation. Manual close survives Settings navigation and UI reload; a subsequent explicit enable remains available. Registration, official browser login, cancellation, saved-port validation, safe local browser handoff, validated snapshot HTTPS portal and identity/public-key verification are preserved.

The console keeps the two primary jobs on one divided surface:

```text
This computer's workspace                         Account / sign out
┌ Local use                         ┬ Remote access                 ┐
│ Ready                             │ Status + enable / close       │
│ Bare loopback address / copy      │ Public account portal         │
│ Open local workspace              │ Copy / open                   │
│ Short browser-session instruction │ ▸ How to connect              │
│ Workspace                         │ ▸ Verify this computer        │
└───────────────────────────────────┴───────────────────────────────┘
▸ Connected devices                         Real count / unavailable / off
```

Connection rows, connection instructions and identity are initially collapsed. Their summaries remain keyboard operable; connection count/status stays visible without expanding. An unavailable or malformed snapshot is distinct from a valid zero count. Privacy and Native RAM-credential details live in the Settings disclosure. Short pre-login text explains default remote access and the ability to close it. Known error codes appear only in an expanded diagnostic; action errors accept exact fixed stage codes and never expose arbitrary IPC/SDK payloads. Site copy in both languages describes the same default-on behavior.

This UI does not resolve the hosted coordination service's Upstash quota exhaustion. A safe unavailable message remains appropriate when the service rejects requests; infrastructure recovery and Native transport evidence belong to their separate lanes.

## Verification

- Production desktop TypeScript/build: PASS. Final assets: `index-BNmv74FC.js`, `index-DfVnwZ1X.css`; log `/tmp/anywork-default-remote-ui-build.log`.
- Updated desktop access/overview/tunnel tests: **78/78 PASS** on Chrome desktop and Android-Web projects; log `/tmp/anywork-default-remote-ui-test.log`. Covers default dispatch, failure/manual retry, held default with local access and logout, obsolete enable completion, same-account relogin, manual-off across reload, unknown/zero/off clients, portal/local-address validation, copy feedback, settings and existing onboarding boundaries.
- Final layout/copy delta and added regressions: **12/12 PASS** across both projects, including four sizes, keyboard disclosure navigation and unavailable-account preparation completion. Log `/tmp/anywork-default-remote-ui-final.log`. This is a focused follow-up to the 78 cases, not a claimed combined 82-case run.
- Production account-entry script: PASS, including official screens/cancellation, default disclosure, settings-scoped RAM notice and collapsed safe diagnostic. Log `/tmp/anywork-default-account-entry.log`.
- Existing updater script: PASS, preserving quiet checks/failure, confirmation and stale-version behavior; log `/tmp/anywork-default-updater.log`.
- Final bilingual site build/checks: PASS at 1440, 1024, 768, 390 and 320 in both languages, plus language negotiation, release ordering and download selection. Logs `/tmp/anywork-default-site-build-final.log`, `/tmp/anywork-default-site-test-final.log`.
- Prettier for touched typed UI/CSS/e2e/locale files and `git diff --check`: PASS.

All browser checks use actual Chrome and the newly built production desktop assets with strict synthetic Native IPC. No real account, installed application, local service, remote session, cloud configuration or publication was changed. Initial launcher setup errors (preview not running and bundled browser unavailable) were corrected by an owned preview and installed Chrome before the passing runs; they were not product regressions.

## Screenshots and critique

These are production UI with synthetic IPC, **not installed Native or physical mobile acceptance**. Each directory also contains introduction, account entry, preparing, preparation error and Settings captures. The two active connections are synthetic fixture data. Full-page capture permits intentional vertical scrolling at narrow sizes.

| Viewport  | Console screenshot                                                                                                           |
| --------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1440×1000 | `/tmp/anywork-default-remote-ui-final-results/desktop-overview-onboarding-and-console-at-1440×1000-desktop/console-1440.png` |
| 960×720   | `/tmp/anywork-default-remote-ui-final-results/desktop-overview-onboarding-and-console-at-960×720-desktop/console-960.png`    |
| 800×620   | `/tmp/anywork-default-remote-ui-final-results/desktop-overview-onboarding-and-console-at-800×620-desktop/console-800.png`    |
| 390×844   | `/tmp/anywork-default-remote-ui-final-results/desktop-overview-onboarding-and-console-at-390×844-desktop/console-390.png`    |

Introduction example: `/tmp/anywork-default-remote-ui-final-results/desktop-overview-onboarding-and-console-at-960×720-desktop/intro-960.png`.

The existing cool workspace palette is retained deliberately: ink `#14253d`, background `#f5f7fb`, action blue `#155ce8`, muted text `#61728a`, divider `#d7e2ef`. System UI typography with bundled Noto Sans SC fallback preserves the Native feel. The local address and primary browser-open action carry the visual emphasis; remote details use quiet disclosure rows instead of competing permanent paragraphs. At 800×620 the local action, remote toggle and connection summary fit in the viewport without reducing type or touch targets. At 390 the stacked layout is longer, with clear controls and no horizontal overflow. Root visually accepted the 960/390 hierarchy; author inspected final 800. Real WKWebView clipboard, Native policy and hosted connectivity remain integration gates outside these synthetic screenshots.

## Independent review follow-up: remote error ownership

The reviewer reproduced a same-grant race on `0d16eb1`: while the default enable was held, opening the account portal advanced the shared action generation. The subsequent enable failure was discarded even though authorization had not changed. An ordinary action also cleared an already visible remote error.

The follow-up separates the remote issue and latest remote-operation sequence from incidental action/poll ordering. A new remote retry/disable clears its prior issue; opening the portal or copying identity does not. Sign-in/cancel/logout synchronously invalidate remote ownership, and confirmed Native authorization identity changes also clear it. Both failure handling and post-await snapshot application retain authorization and operation fences; the default caller retains its preparation epoch check. No Native/backend contract, automatic retry, timeout, CSS or layout changed.

The rebuilt production assets are `index-BbANbFn-.js` and unchanged `index-DfVnwZ1X.css`. Focused Chrome verification passed **10/10** across desktop and Android-Web: pending failure → portal → failure alert/expanded diagnostic/retry; portal after a visible error; logout clears the issue; failing late default completion after logout; same-account relogin; default retry and fresh-snapshot gating. Logs: `/tmp/anywork-default-remote-ui-error-owner-build-final.log`, `/tmp/anywork-default-remote-error-owner-final.log`. A first launcher invocation lacked the installed-Chrome channel and stopped before entering the application; the corrected actual-browser run is the reported result. The strengthened late-failure case explicitly asserting no signed-out alert also passed **2/2** (`/tmp/anywork-default-remote-late-failure.log`). The official account-entry regression was rerun and passed against this final build; log `/tmp/anywork-default-remote-error-owner-account-entry.log`. Prior layout screenshots remain representative because this correction changes only controller ownership and regression assertions.
