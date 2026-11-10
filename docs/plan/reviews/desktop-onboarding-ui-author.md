# Desktop onboarding UI — author evidence

Date: 2026-11-10. Product source: `aefd304bc876080231ac1c034be0a4d0445004ef`; this follow-up adds regression cases, bilingual release/site copy and this report, with no further desktop product change. Contract: [desktop onboarding layout](../../desktop-onboarding-layout.md), including the portal/updater refinements at `32072bd`. This is implementation evidence, not an independent acceptance report.

## Delivered behavior

Every new UI runtime begins with the introduction, even when Native retains an authorized grant or an existing service is ready. Continue advances to the official registration/sign-in flow. A confirmed authorization prepares the workspace once through `desktop_start`; preparation neither opens the browser nor enables remote access. Failure offers a manual retry. Logout/relogin, including the same account, creates a new authorization epoch; obsolete polls and prepare completions cannot restore the prior console. Polls are serialized, and an unavailable account snapshot fences new start/open actions rather than retaining actionable stale sign-in state.

The console keeps local and remote actions distinct. The local address uses the validated saved port, while `desktop_open` performs the authenticated browser handoff. The remote address comes exclusively from the snapshot's valid bare HTTPS `accountPortalUrl`; missing or malformed values stay unavailable. Remote access remains explicit. Connected rows come from `account_snapshot.remoteClients`, represent authenticated active connections rather than unique physical devices, and distinguish unavailable data from an empty list. Client categories are display hints. Unsupported platforms explain their account limitation and cannot silently start or open through a legacy route.

Settings, save errors, account cancellation, identity verification, logout and update confirmation remain available. The update message describes the new introduction/login/preparation flow after restart. Native account credentials and private keys remain scoped to Native RAM; no new credential persistence, Rust implementation, cloud configuration or business Web change is included in this UI lane.

## Verification

- TypeScript and production desktop UI build: PASS; independently reproduced production JavaScript `index-CtORsyv5.js` from `aefd304`.
- Existing updated desktop/access/tunnel matrix: **70/70 PASS**, using actual Chrome at desktop/mobile projects and strict synthetic IPC. Independent reviewer separately reproduced 70/70.
- Added regression cases: **6/6 PASS**, three cases in both projects: reload with a retained Native grant still requires introduction; a pending local browser handoff stays a single disabled action; a settings save failure remains visible without losing the current phase. These supplement the 70 cases; a single combined 76-case run is not claimed.
- Production account-entry script: PASS, covering official authorization screen, cancellation and stale authorization response handling. Production updater script: PASS, covering quiet checks, install confirmation and obsolete-version handling. Independent reviewer reproduced both.
- Four existing screenshot scenarios repeated after the focused runner cleaned prior artifacts: **4/4 PASS**, at 1440×1000, 960×720, 800×620 and 390×844. Each covers introduction, account entry, preparing, preparation error, console and settings, with no horizontal overflow.
- Bilingual site build and existing site checks: PASS. The prior hardcoded 0.1.15 download-note assertion now verifies latest desktop, sign-in/preparation, explicit remote enable and active connections. JSON locale structures remain aligned.
- `git diff --check`: PASS.

The added tests do not broaden runtime privileges. Their browser origin is `http://anywork-desktop.test/`, served by routed production assets; no installed Native process or real local service is used. No real account sign-in, remote enable, install, service stop or publication occurred in this author task.

## Screenshots and visual review

All images below are **production UI with synthetic IPC**, not a real installed Native account or physical phone connection. Screenshot files are full-page captures at the named viewport, so a narrow console is taller than its viewport and intentionally scrolls vertically. The diagram is explicitly illustrative; the two connection rows in the console are fixture data.

| View | Absolute image path |
| --- | --- |
| Introduction, 960×720 | `/tmp/anywork-onboarding-author-results/desktop-overview-onboarding-and-console-at-960×720-desktop/intro-960.png` |
| Console, 960×720 | `/tmp/anywork-onboarding-author-results/desktop-overview-onboarding-and-console-at-960×720-desktop/console-960.png` |
| Introduction, 390×844 | `/tmp/anywork-onboarding-author-results/desktop-overview-onboarding-and-console-at-390×844-desktop/intro-390.png` |
| Console, 390×844 | `/tmp/anywork-onboarding-author-results/desktop-overview-onboarding-and-console-at-390×844-desktop/console-390.png` |
| Introduction, 800×620 | `/tmp/anywork-onboarding-author-results/desktop-overview-onboarding-and-console-at-800×620-desktop/intro-800.png` |
| Console, 800×620 | `/tmp/anywork-onboarding-author-results/desktop-overview-onboarding-and-console-at-800×620-desktop/console-800.png` |
| Introduction, 1440×1000 | `/tmp/anywork-onboarding-author-results/desktop-overview-onboarding-and-console-at-1440×1000-desktop/intro-1440.png` |
| Console, 1440×1000 | `/tmp/anywork-onboarding-author-results/desktop-overview-onboarding-and-console-at-1440×1000-desktop/console-1440.png` |

The same directories contain `account-<width>.png`, `preparing-<width>.png`, `preparation-error-<width>.png` and `settings-<width>.png`. Root visually reviewed the 960 introduction/console and 390 console; the independent reviewer reviewed additional 800-stage captures and 390 introduction.

The cool, restrained palette and one device relationship diagram establish the introduction's hierarchy without invented status. At 960 the first action fits comfortably alongside the diagram. The console uses a single divided surface for local and remote controls, making the bare local address and browser handoff distinct. At 390 the controls remain readable and tappable, with the remote sequence and connected rows below the local action. The tradeoff is a longer narrow-screen page; it preserves full explanations rather than squeezing steps or hiding status. This browser evidence does not establish actual WKWebView clipboard behavior, installed startup behavior, real account/Noise connections or physical mobile acceptance; those remain the integration/release gates owned by root and the Native reviewer.
