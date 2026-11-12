# UI v2 Web short-height integration review

Current result (2026-11-12, Asia/Shanghai): **pass** for correction candidate `148f380b1fa7404b2d7f3cb0d37cf9e6ad8e5ee2`; ready to merge. No remaining blocking or non-blocking correction findings. Publication and production acceptance remain separate gates. The 2026-11-11 failure and original acceptance requirements below are retained as historical evidence.

## Finding

**P1 / blocking — Connected sidebar leaves only one row of usable history in a 390 × 480 window.**

- Contract: `docs/design/desktop-refactor/shell.md`, responsive Web short-window requirements; existing `e2e/sidebar-scroll.spec.ts` requires actual in-viewport touch progress, both boundaries, no viewport scroll chaining and reachable anchored controls.
- Candidate source: `81a97709e37d3a1df5cd6b592caad1d65bbdb654`, `web/src/components/NavigationHeader.tsx:80` adds the device row to fixed navigation; `web/src/App.tsx:1340` retains the existing two footer rows and adds the account row; `web/src/workspace-context.css:89` and its coarse-pointer rule add account height; shared `web/src/desktop.css:274` allocates the remaining space to the history list.
- Merged integration result: 574 Web cases, 572 passed, one skipped and one failed. Android short-window boundary test reached its existing 45-second timeout. Root reverted the Web integration pending correction; desktop is retained.

## Independent evidence analysis

Evidence was read from `artifacts/ui-v2-integrated/web-results/sidebar-scroll-sidebar-con-8ba47--gestures-in-a-short-window-android-web/`, including `error-context.md`, `sidebar-native-touch.json` and `native-touch-transport.json`.

- The history box is at y=273 with height 66.5px; `clientHeight` is 67px and `scrollHeight` is 6734px. It cannot display more than roughly one grouped chat row.
- The recorded first native swipe goes from y=323.5 to y=289, a 34.5px stroke after the existing 16px boundary margins. Its actual scroll progress is only 20px after touch slop.
- Pointer/touch/scroll events are trusted, not prevented, and reach the actual history element. Separate plain-control native touch checks advance 205–220px. This is evidence of inadequate usable history area, not a missing browser input transport or application cancellation.
- The history range is roughly 6667px. At the observed progress, a round trip requires approximately 667 strokes; four frame-separated steps per stroke alone approach 44 seconds at 60Hz, before CDP and assertion overhead. Raising a timeout would preserve the underlying usability regression.
- The added device and account rows consume fixed vertical space alongside existing heading, actions, Agent filter, view controls and footer rows. The flexible list absorbs the loss. Reasonable correction is to reduce or combine newly added chrome/duplicate footer content, or introduce appropriate bounded scroll regions while keeping every control reachable.

## Correction acceptance gate

1. Supply a clean committed SHA. Review only that committed code; no author code changes are made by the verifier.
2. At 390 × 480, restore a useful multi-row history area. Roughly 150–180px or more is a useful design target rather than a new hard-coded test threshold. Keep usable touch targets and device/account functions accessible; do not recover history by clipping required controls.
3. Preserve the existing sidebar-scroll test data, boundary assertions, gesture delivery and timeout. No direct `scrollTop`, synthetic wheel substitution for touch or test-only layout branch may stand in for native touch acceptance.
4. Independently pass the complete existing `sidebar-scroll.spec.ts` on Desktop and Android projects: normal and short windows, empty list, actual touch progress, both boundaries and overscroll containment, anchored Agent/view menus and reachable settings/footer.
5. Recheck new device/account controls at short height: switch and safe exit remain reachable; cancellation retains the current connection. Normal-height 1440/390 and canonical branding remain intact. Conversation/composer/tool internals remain frozen.

At the end of the 2026-11-11 review, correction was pending and the verifier had inspected only the failed submitted candidate and integration evidence, not the author's uncommitted fix. No real account or production service was operated.

## Correction acceptance — 2026-11-12

**Pass; candidate may merge.** Independently reviewed committed `148f380b1fa7404b2d7f3cb0d37cf9e6ad8e5ee2` in `.worktrees/ui-v2-web-fix`. HEAD matched the supplied SHA and tracked files were clean before and after execution. The verifier did not change author code or tests.

### Source and contract review

- The correction changes 97 product lines across `App.tsx`, `WorkspaceContext.tsx` and `workspace-context.css`. At heights at or below 600px the sidebar uses grid rows, Agent/view controls share a row, settings/account share the footer, and workspace home is available in the account menu. Short coarse-pointer Agent/view targets retain 44px height. The account popup has viewport-bounded height and contained scrolling. Required controls remain available instead of being clipped to recover history space.
- `App` only adds `onHome={() => select("")}` to the existing account component. Independent TypeScript AST comparison confirms all 86 statements before the render return are byte-identical to the previously accepted Web candidate `81a9770`. AccountHome and LocalApp are unchanged from that candidate. The existing selection, connection cleanup, cancellation and logout paths remain in use.
- The original `e2e/sidebar-scroll.spec.ts` and `e2e/touch-input.ts` are byte-identical to the accepted candidate. Session data, 45-second mobile timeout, four-step native touch delivery, progress assertions, upper/lower boundary checks and viewport containment were preserved. Conversation, composer, tool and transport internals were not changed by the correction.

### Independently executed checks

| Check | Result |
| --- | --- |
| Production Web build, including TypeScript no-emit | Passed; existing chunk-size advisory only |
| Complete existing `sidebar-scroll.spec.ts`, Desktop and Android projects, isolated service port 3334 | **6 passed in 44.2s**. Android short-window case passed in **19.9s**, within its unchanged 45-second timeout |
| `account-layout-check.mjs`, isolated Vite port 3335, real AccountHome/AccountStore with synthetic external boundaries | Passed at 1440/390 and coarse-pointer 390×480; no horizontal overflow or viewport height growth |
| Additional independent normal/short connected-shell checks | 1440×900, 390×900 and 390×480: canonical logo decoded, no horizontal overflow; normal-height homepage placement preserved and short-height menu placement available |
| Source/working-tree checks | `git diff --check` passed; correction HEAD and clean tracked worktree reconfirmed |

The independently observed Android 390×480 history area is **192px** high with `scrollHeight: 6734`, compared with the failed 67px. Its first trusted native stroke goes from y=406 to y=246 and advances **145px**. The complete test reaches both ends of the unchanged 80-session fixture, observes continued containment during three extra gestures at each boundary, exercises Agent/view menus, and verifies reachable settings/footer. The independent geometry differs slightly from the author's 204px/157px measurement; both satisfy the useful multi-row gate, and this result uses the independent run's measurements.

The short coarse-pointer account run independently verifies fully visible device/account triggers and switch action, default cancel focus, switch cancellation restoring device focus with zero transport closes, relocated home closing the menu/drawer, visible logout and confirmation, Escape restoring account focus with zero closes or sign-out, and explicit confirmed logout closing transport once. Additional 390×480 measurements confirm device/account, Agent/view and settings targets are at least 44px high. Normal-height Agent/view controls retain their previous dimensions; the new compact sizing applies only to short windows.

### Evidence and limits

Independent logs, native-touch JSON and screenshots are retained in the main checkout's ignored `artifacts/ui-v2-independent-short-height/`: `build.log`, `sidebar.log`, `account.log`, `normal.log`, `sidebar-results/` and `account/`. Visually inspected captures include the Android short-window bounded sidebar, normal 1440/390 connected shells, 390×480 account menu and safe-exit dialog. These are actual React UI captures, not prototype wrappers.

The sidebar tests use the actual isolated service's local ticket/cookie boundary with deterministic API data. Account checks use synthetic OAuth/Grid/remote-transport boundaries and do not establish a real user login or encrypted remote session. Desktop/Android refers to Chrome projects and mobile emulation; physical-device elastic overscroll is not rendered by headless Chrome. Existing 353-unit, 96-desktop and other 572-Web results were not rerun for this focused correction review. No real account, installed service, production data or configuration was accessed or changed. Merge checks, publication and exact production SHA/version verification remain the root's next gates.
