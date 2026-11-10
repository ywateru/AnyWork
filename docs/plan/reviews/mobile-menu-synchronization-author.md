# Mobile directory-order fixture synchronization — author evidence

Date: 2026-11-10. Task: [release mobile menu synchronization](../tasks/release-mobile-menu-synchronization.md). Scope: two readiness assertions in the existing directory-order browser test; no production code, timeout or skip change.

## Diagnosis

Exact v0.1.18 Checks [run 42820324352](https://github.com/ywateru/AnyWork/actions/runs/42820324352) reported 646 browser passes, one existing skip and one timeout in the Android-browser directory-order case. The retained trace and error context are under `/tmp/anywork-release-018-browser/panels-menus-directory-gro-89d77--rather-than-alphabetically-android-web/`.

The trace identifies the blocked action rather than an ordering assertion:

- Initial setup, fixture authorization and requests succeeded. First reload completed in about 99 ms.
- Immediately after reload, `sidebar()` queried `.sidebar.open`, then its role locator resolved the temporary overview `.mobile-menu` button. Trace call `kcek@18467` began at 514993 ms and resolved that element at 515026 ms.
- Session hydration then exposed the conversation header. `.main.has-session > .window-tabbar` hides the overview button while leaving it in the DOM. Playwright's actionability checks retained that selected hidden button and repeatedly reported `element is not visible` until the overall 30-second test deadline. The directory-order assertions were never entered.
- Session fixture responses continued successfully every 2.5 seconds, typically taking 1–2 ms. The final error-context snapshot already contained the expected initial zeta/alpha/middle groups and the actual conversation toggle.

This is a test synchronization race between reload hydration and sidebar interaction. The evidence does not support dismissing it as an external infrastructure transient or retrying the unchanged candidate. It also does not demonstrate a directory sorting product defect.

## Minimal change

After **each** of the case's two reloads, wait for the actual conversation message editor to become visible before `sidebar()` chooses its toggle. This is the same conversation-ready condition already used by the shared setup. All existing group-order, newest-chat, archived filtering and post-activity/reload assertions remain unchanged. No forced click, arbitrary sleep, raised timeout, skipped case or production change is introduced.

## Targeted verification

- Built the production Web UI from an isolated `git archive` of frozen source `f77299569e8a8109c43d3813c263cdcfa2eba339`, with inherited VITE/ANYWORK build overrides removed and the existing installed dependencies reused. TypeScript and production build passed. Asset names match the failed CI trace: `index-BWUHNMXg.js`, `index-DPJX8MUf.css`.
- Immutable author build location: `/var/folders/ll/s836stz50mg85d4h0g4xc8jm0000gn/T/anywork-mobile-menu-018-batai54p/source/web/dist`.
- Repeated only the original failed Android-browser case three times: **3/3 PASS**, using actual Chrome, an owned temporary workspace/data directory and isolated port 3439. No test deadline changes. Result directory: `/tmp/anywork-mobile-menu-018-results`.
- The isolated launcher reused the approved read-only `/Users/water/work/2026/any-work/target/debug/anywork`, an earlier merged build. This report does not claim that server binary was rebuilt from f772. The Web source and production assets for the affected browser behavior are from f772; the unchanged server is a fixture dependency. The newly merged exact release source still needs the full trusted CI gate.
- Prettier for the touched test and `git diff --check`: PASS.

The author's worktree predates the version bump, but the relevant Web/test/launcher source was checked against f772 and has no product delta; the actual Web build used archived f772 package metadata (0.1.18). The independent reviewer can use that immutable build with a separate isolated server port. No real account, installed application, live service, remote enable or candidate adoption was touched. Root will use a new immutable candidate after review rather than retrying v0.1.18 unchanged.
