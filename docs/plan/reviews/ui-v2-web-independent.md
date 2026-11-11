# UI v2 Web independent review

Date: 2026-11-11. Result: **pass**. No blocking or non-blocking findings requiring follow-up.

Candidate: `81a97709e37d3a1df5cd6b592caad1d65bbdb654`, reviewed in `/Users/water/work/2026/any-work/.worktrees/ui-v2-web`. HEAD matched the supplied candidate and tracked files were clean before and after verification. No author code was modified.

## Source and integration review

- Changes stay within the task's Web paths. The implementation uses the canonical `/icon.svg` asset in account entry, sidebar and overview. No placeholder Layers branding remains in the changed surfaces.
- An independent TypeScript AST extraction compared all 86 statements in `App` before its render return against the parent commit: each statement is byte-identical. Message, composer, approvals and tool components, transports and existing shared CSS files are unchanged. `App` JSX differences are outer navigation/header/account controls; the overview changes its logo only. Added `workspace-context.css` targets the new chrome and uses existing theme variables; account styling is scoped to account classes rather than conversation internals.
- `AccountHome`'s `closeConnection`, `checkedToken`, `login`, `logout`, `pinKey`, `connect` and `mutate` declarations are byte-identical to the parent. New key-checkbox and dialog focus/cancel guards wrap those existing controller paths. Existing owner aborts, canceled tunnel result checks, pinned-key scope and transport-ended handling remain intact.
- `LocalApp` retains its one-use bootstrap, cookie-backed transport and local-only disconnect logic. The new source menu explicitly distinguishes the opening snapshot from a signed-in Web account. Switching or exiting a connected workspace uses cancelable confirmation without stopping the computer's Agent.

## Independently executed checks

| Check | Result |
| --- | --- |
| `npm run typecheck -w web` and `npm run build -w web` | Passed; ordinary build chunk-size advisory only |
| `web/scripts/account-layout-check.mjs`, isolated Vite port 3323 | Passed at 1440/390: real AccountHome/AccountStore with synthetic OAuth/Grid/transport boundaries; login/signup arguments, appearance/locale, rename retaining other customData, first/changed key explicit checkbox, focused cancel, late canceled result, successful connection, safe switch, expired transport, remove-list semantics, empty/error/offline/unready/unverified states |
| `web/scripts/client-account-check.mjs` | Passed at 1440/390: entry, obsolete connection/bridge ignored, local provenance, 401 teardown and callback recovery |
| `e2e/account-unified.spec.ts`, isolated server 3324 and `/tmp/anywork-ui-v2-independent-web/e2e` | All 6 desktop/Android-project cases passed: actual isolated service ticket consumption, fragment clearing, HttpOnly/Strict cookie refresh, local logout, PTY auth ACK and teardown, hosted entry without manual token form |
| Additional independent Chrome chrome checks, 1440/960/390/320 | No horizontal overflow; connected picker has transparent background, zero border, 16px icon, single-line text and same icon x-coordinate as new-chat navigation. Canonical logos decode. Web logout confirmation focuses cancel; Escape does not sign out or close transport |

The controller/layout script used the submitted code with module boundaries intercepted locally, and its output was isolated under `/tmp`. Additional temporary verification scripts were not added as product tests. No real account was authenticated and no production configuration was changed in this candidate review.

## Visual review

Actual submitted React UI was rendered in Chrome, without a prototype wrapper. Login has a single centered content column, one heading and brand, and no empty sidebar/account menu; device pages use one header title and no connected picker; empty state has one add-device CTA. The device row and connected navigation follow the v2 reduction. Both desktop and narrow captures were visually inspected.

- [Device directory 1440](ui-v2-web-previews/devices-1440.png) and [390](ui-v2-web-previews/devices-390.png).
- [Login 390](ui-v2-web-previews/login-390.png), captured after the appearance/English controls were exercised.
- [Connected shell 1440](ui-v2-web-previews/connected-1440.png) and [390 with sidebar open](ui-v2-web-previews/connected-390.png).

This review verifies the UI candidate, controller ownership and isolated local integration. Synthetic Grid/Noise boundaries do not demonstrate a real remote encrypted session; full merged-system checks remain the integration gate. Actual hosted Logto branding is covered separately in [the hosted branding review](ui-v2-hosted-branding.md).
