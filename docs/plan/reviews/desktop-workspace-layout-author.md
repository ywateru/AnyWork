# Desktop workspace layout author evidence

Date: 2026-11-10. Scope: the desktop React UI and synthetic desktop interaction tests. Native authorization, service ownership, Rust, cloud configuration and business Web remain unchanged.

## Result and visual decisions

The home page now has two aligned columns for this computer's local workspace and other-device access. The local address is the focal text, followed by the full-width open action; account and remote status remain visible at 960×720 and 800×620. The smaller layout stacks local, remote and explanation sections without horizontal overflow. Settings and updates use the same light canvas, blue actions, clear focus and white surfaces.

The working-principle section explains local browser access without a cloud account, same-account remote discovery and device identity checks, end-to-end encryption, necessary cloud account/connection metadata, computer availability and the Native client's RAM-only authorization. Registration/login explicitly opens the system browser. The page distinguishes the bare root address from the first-use browser-session handoff.

An initial visual critique removed sprint language from the privacy explanation and retained a user-facing statement about device content and connection metadata. Screenshots were inspected at 1440×1000, 960×720, 800×620 and 390×844, including signed-out/ready, remote-enabled, login-pending and local-off/reauthentication states. At 800px the local address, open action and remote settings remain in the viewport; explanation can scroll below. At 390px the address and controls fit, longer instructions wrap, and settings fields retain their labels and actions. Expanded public identity and update-ready views were also inspected. These are production UI screenshots with synthetic IPC, not evidence of actual OAuth or a remote connection.

## Address and interaction boundary

- The address comes only from the latest successful `desktop_snapshot.config.port`, restricted to an integer in 1024–65535. No settings draft, default port, LAN guess or provider origin is substituted.
- Copy is enabled only for an authorized, running service with a valid address. It writes only `http://127.0.0.1:<port>/`, never a ticket or bearer. Fixed success/failure feedback survives unchanged polling; a delayed clipboard response cannot label a different current address as copied.
- Open still invokes only the existing `desktop_open` handoff. First use, switching browsers and expired local sessions explicitly direct users to this button. The root address is identified as belonging only to this computer.
- Account cancellation, explicit remote enable/disable, logout, safe error stages, reauthentication, public identity verification and update confirmation behavior remain unchanged.

## Checks

- Production build and TypeScript passed.
- Desktop Playwright: 62/62 passed in Chrome desktop and mobile emulation, including all existing 36 cases and 26 new cases. The new cases cover saved-snapshot versus draft ports, port updates, missing state, unauthorized/off service, invalid and boundary ports, exact clipboard bytes, clipboard failure, delayed-copy races, feedback persistence, existing open IPC, four state/size combinations, aligned columns and no horizontal overflow.
- Account-entry regression passed: separate official register/login screens, cancellation/cleanup races, safe retry, scoped memory notice, account identity, reauthentication and stage diagnostics.
- Updater regression passed: quiet download/failure, deferral, preferences, confirmation focus/Escape, changed-version rejection and explicit install.
- No real service or user account was operated by these checks. The temporary Playwright configuration omitted the real-service launcher because all desktop cases use strict synthetic IPC and production static files.

Screenshots are in `/tmp/anywork-desktop-layout-author-results/`, with state-specific `desktop-access-*` folders and `access-<state>-<width>.png` files. Settings snapshots are in the existing overview-test folders. Actual Mac/WKWebView clipboard availability and the reviewed client-only installation remain live acceptance gates; browser clipboard mocks verify the string and state behavior only.
