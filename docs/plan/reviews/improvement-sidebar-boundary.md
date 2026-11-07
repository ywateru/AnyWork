# Independent review: sidebar real-touch boundary helper

Candidate: `7aa1877af2408a88b2d7f53ac6d0c4c6a6591244`, based on `bcdf558`, branch `codex/improve-sidebar-touch-boundary`. Review scope is the single-file test-only change in `e2e/sidebar-scroll.spec.ts`, against the root task contract `docs/plan/tasks/improvement-sidebar-boundary.md`. The reviewer did not author or modify the candidate test/product source.

## Decision

PASS for this test-helper correction. No blocking or non-blocking finding in the scoped diff. This is not a product/runtime fix or proof of real-device overscroll behavior. Root must still obtain a fresh exact-source Checks result before treating the previously skipped/failing CI pipeline as accepted.

## Source evidence

The exact candidate changes 5 lines and removes 2 lines in one file. It defines `tolerance = direction === "up" ? 0 : 1` and uses it both for the gesture-loop stop condition and the helper's final boundary poll. This repairs the contradiction where a top remainder of one pixel previously ended the loop while the following assertion still required `scrollTop === 0`.

The strict top assertion remains `.toBe(0)`. The bottom remains at most one pixel from the boundary. Geometry-derived finite gesture budgets, per-gesture observable progress, native touch-transport verification, viewport-state equality after every gesture, three additional gestures against each boundary, document/shell/footer/list geometry, explicit overscroll CSS assertions and anchored-menu checks remain unchanged. The mobile timeout remains 45 seconds. There is no assignment to `scrollTop`, forced click, scrollIntoView workaround, product mutation or widened timeout.

`scrollGesture` still sends viewport-bounded `touchStroke` input through CDP on Pixel; desktop still uses mouse wheel input. `touch-input.ts` is unchanged, and its direct transport check requires an `isTrusted` touchstart and positive native scrolling. Synthesized-gesture diagnostic output is not used as a substitute for that direct check.

## Independent execution

Executed against the candidate's existing private `target/debug/anywork` and `web/dist`, with `PLAYWRIGHT_CHANNEL=chrome`, ephemeral test data/fake plugins and the private port `43271`. `scripts/e2e-server.py` was inspected: native discovery is disabled, Codex points to the deterministic fake agent, and data/home/Codex home reside in its temporary directory. No production service, real Agent/account, shared target/dist or dependency installation was used. The pre-existing root-dependency `node_modules` symlink was left unchanged.

1. Original failing short-mobile case repeated twice: **2/2 passed**, 37.8s and 36.0s (1.3 minutes total). Output: `test-results/independent-sidebar-short`.
2. Complete focused sidebar suite, desktop and Pixel: **6/6 passed**, 52.4s total; short-mobile 35.5s. Output: `test-results/independent-sidebar-focused`.
3. Prettier check of the candidate file and `git diff --check bcdf558..7aa1877`: passed.

The two independent short-mobile touch artifacts were inspected: both have trusted direct touchstart and scrolling (transport control `scrollTop=205`), and the application gesture diagnostics report trusted touch input at a 390×480 CSS-pixel viewport, scale 1. The short-mobile `bounded-sidebar.png` was visually inspected: session rows, header and bottom settings/brand controls are contained in the sidebar, with no extra blank page area below the fixed viewport. The test additionally proves exact top zero and containment assertions through real gestures; the screenshot alone is not used as that proof.

## Limits

This is Chrome with Pixel emulation and native browser input delivery, not an Android physical device or Safari elastic overscroll test. A bounded repeat establishes the observed executions, not an unconditional flake-free guarantee. No full product suite, CI dispatch, release, installation, native task or production restart was performed by this reviewer. The independent review commit adds only this evidence document; it does not merge the candidate or update central status/check registration.
