# UI v2 Web short-height integration review

Date: 2026-11-11. Current result: **blocked**, pending a committed layout correction and independent regression verification. The earlier isolated Web candidate review remains historical evidence; it does not supersede this subsequently discovered merged-system gate. Publication has not occurred.

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

Awaiting correction candidate. The verifier has only inspected the failed submitted candidate and integration evidence, not the author's uncommitted fix. No real account or production service was operated.
