# Independent review: sidebar native-touch sampling correction

Reviewed exact candidate: `064ccd2da78d63284f91f46529eac31c6bd7a6b7`. Date: 2026-11-08. Reviewer did not author this test-driver change. Scope is only the release-blocking [touch runtime correction](../analysis/sidebar-touch-runtime.md); broader improvement work remains paused.

**PASS. No blocking or nonblocking defect found in this bounded change.** This accepts a test-driver overhead correction, not a new product fix or physical-device support claim.

## Source and coverage checks

The candidate changes only `e2e/touch-input.ts` (eight diff lines) and its analysis. Independently verified `e2e/sidebar-scroll.spec.ts` is byte-identical to its parent: Git blob `5573d9c330d3b62b71c4eb2ffdbefee512a14ac3`. No product source, timeout, fixture, geometry or assertion is changed.

`touchStroke` still sends native CDP `Input.dispatchTouchEvent` start, frame-separated moves, end and a final animation frame. Interpolation now visits the midpoint and full endpoint rather than four intermediate samples. It retains stroke coordinates and a movement beyond touch slop. This reduces interpolation density; the current consumers are sidebar boundary/containment traversal and the independent plain scrolling calibration, neither of which asserts high-frequency interpolation. Their input and endpoint coverage is preserved. There is no DOM synthetic touch dispatch, scrollTop assignment, scrollIntoView, force click, assertion skip, retry-on-failure or product fallback.

Read all call sites and the unchanged suite: 80 sessions in separate directories; mobile 45-second whole-test timeout; geometry-derived finite gesture budget; progress after every traversal stroke; exact top zero; bottom at most 1px; extra three gestures against each boundary; stable window/document/shell/header/footer/list geometry; visible final session, overscroll CSS, anchored menus/fixed controls, screenshots and short empty-state controls all remain enforced. Mobile calibration requires a trusted touchstart and positive actual control scrolling, independently of application scrolling.

## Independent execution

Ran against candidate source in `.worktrees/review-sidebar-touch`, Chrome/Pixel emulation on macOS, port **3243**. Reused only the author's private unchanged `web/dist` and the already built `.worktrees/improve-ledger-merged/target/debug/anywork` fixture binary. Inspected `scripts/e2e-server.py`: private temporary workspace/data/home/plugins, fake Agent, Codex discovery disabled. The existing sidebar API fixture intercepts calls. No Rust/Web build, real Agent/profile/native app, production assets or port3210 was touched.

Commands used `PLAYWRIGHT_CHANNEL=chrome`, `ANYWORK_E2E_PORT=3243`, `ANYWORK_E2E_WEB_DIR=<author-private-web-dist>`, and distinct private `ANYWORK_E2E_OUTPUT_DIR`:

| Independent check | Observed result |
| --- | --- |
| `playwright test e2e/sidebar-scroll.spec.ts` | **6/6 passed**, 1.4 minutes. Desktop normal/short/empty and Pixel normal/short/empty. Short Pixel 39.0s; normal Pixel 18.7s. Log `artifacts/sidebar-touch-review/focused.log`, outputs `test-results/review-focused/`. |
| Same spec `--project=android-web --grep 'boundary gestures in a short window' --repeat-each=2` | **2/2 passed**, 32.3s and 31.6s; no retries. Log `artifacts/sidebar-touch-review/repeat.log`, outputs `test-results/review-repeat/`. |
| Prettier check of both touch/sidebars test files | Passed. Log `artifacts/sidebar-touch-review/format.log`. |
| Byte identity, diff scope and `git diff --check` | Passed. Only this review document is committed by reviewer. |

Independently parsed focused and repeat JSON evidence. Direct calibration has trusted touchstart/touchmove/touchend and scroll, with scrollTop205. Short application first stroke has scrollTop112. Both repeats explicitly record trusted start at y371, midpoint move y307.5, endpoint move y244 and end y244, followed by actual scroll. Normal Pixel application evidence also has trusted start/move/end and positive scrollTop471. This is real browser input, not merely successful CDP method return. Visually opened the independent short Pixel `bounded-sidebar.png`: sidebar/footer/controls fit the viewport, without a white page extension; exact top/geometry are established by assertions rather than screenshot alone.

Port3243 had no listening fixture after the runs. Removed reviewer-created dependency and binary symlinks only; retained private logs/screenshots/input evidence. No original-author outputs or other worktrees were changed.

## Limits retained

The original failure/instrumented diagnosis is preserved in the author's analysis and private artifacts; this review did not rerun or overwrite that failure. Its own passing runs retain all original assertions and the 45-second limit. The 39.0s independent focused result also shows scheduling variance; these passes do not guarantee every loaded CI host will finish within that limit. No timeout increase is accepted here.

These are focused Chrome emulation/fake-server results, not a fresh full browser suite, native Android input or Safari elastic overscroll acceptance. The reduced samples do not claim high-frequency gesture fidelity. Release-wide checks, publication and physical-device validation remain separate gates; this review makes no claim that broader improvements resumed or shipped.
