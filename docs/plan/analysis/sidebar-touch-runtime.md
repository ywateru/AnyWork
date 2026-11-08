# Short-mobile sidebar boundary timeout: diagnosis and scoped correction

Status: test-driver candidate, pending independent review. Source baseline: `1c7dcfe`; original merged failure: `855f971`. This work changes no product UI, server, native adapter, timeout, fixture size or boundary assertion. It resumes only the release-blocking sidebar test investigation, not the paused broader improvements.

## Observed failure and diagnosis

The original merged run finished with 610 browser passes, one existing skip and the short-mobile timeout. The timeout stack at `reachBoundary(up)` alone did not establish a stalled scroll or a product bug. The original failure trace and geometry were retained, then the unchanged gesture driver was rerun with temporary per-stroke timing/progress instrumentation in the private worktree.

Reproduction command (temporary instrumentation only):

```sh
PLAYWRIGHT_CHANNEL=chrome ANYWORK_E2E_PORT=3242 \
  ANYWORK_E2E_OUTPUT_DIR=test-results/baseline-short \
  ./node_modules/.bin/playwright test e2e/sidebar-scroll.spec.ts \
  --project=android-web --grep 'in a short window'
```

Result: one short-mobile boundary failure at the original 45-second whole-test deadline and one empty-sidebar pass. The private application list at 390×480 had bounds `{x:8,y:228,width:303,height:159}`, a 6,575px scroll range, and a 127px in-viewport stroke (16px inset at each edge). The finite helper budget was 106 strokes per traversal.

| Instrumented original driver | Actually observed |
| --- | --- |
| Down traversal | 59/59 strokes made progress; normally 112px/stroke, final 79px to exact zero remaining. Total 31,451ms, of which 23,837ms was inside the touch gesture call. |
| Up traversal before whole-test expiry | 13 successful progress checks; the 14th gesture reached the global timeout before its progress check could finish. Recorded elapsed 6,196ms, last completed remaining distance 5,119px. |
| Geometry | No containment assertion failed; bottom screenshot was captured before the up traversal. |

This reproduces a cumulative runtime-budget failure after many successful small-viewport strokes. It does **not** prove a stalled or fractional boundary: the test timed out far from the top, with repeated 112px progress. The incomplete final stroke at cancellation is not evidence that scrolling itself stalled. Earlier independent tests at the same 45-second limit passed in 35–38 seconds; that does not contradict the reproduced failure under slower driver scheduling.

The original driver sampled four touchMove positions. Each sample awaits a browser animation frame and a CDP dispatch round trip. Across roughly 118 traversing strokes, those repeated round trips dominate the short-window case. Increasing timeout or reducing 80 directories/sessions would hide the cost instead of correcting this driver overhead.

## Minimal correction and retained coverage

`e2e/touch-input.ts::touchStroke` uses two frame-separated real touchMove samples: midpoint and full endpoint. It still dispatches native CDP touchStart/touchMove/touchEnd, waits animation frames, covers the same in-viewport coordinates and checks real browser input transport separately. This is a boundary/containment scenario, not a high-frequency touch interpolation test. Two samples retain a real movement past touch slop and the complete stroke.

The final candidate removes **all** temporary timing/progress instrumentation; `e2e/sidebar-scroll.spec.ts` is byte-identical to the baseline. It retains:

- 80 sessions, each in a separate directory, and the 390×480 short-mobile viewport.
- The original 45-second mobile deadline and geometry-derived finite gesture budget.
- Observable progress after every stroke, exact top `scrollTop === 0`, and bottom tolerance of at most 1px.
- Three additional real gestures against both boundaries, viewport/document/shell/header/footer/list containment after gestures, anchored menus and both screenshots.
- Native transport check requiring trusted touchstart and actual control scrolling; application first-stroke touch evidence remains attached.

There is no scrollTop assignment, scrollIntoView, forced click, synthetic DOM touch dispatch, skipped assertion, retry-on-failure or product layout modification. The only current consumers of `touchStroke` are this sidebar suite and its `verifyTouchTransport` calibration, both exercised by the focused suite.

## Execution environment and evidence

Tests use Chrome with Pixel emulation and desktop Chrome, port 3242, private `web/dist` and private Playwright output directories. One private `npm --prefix web run build` passed before the pause; product Web source stayed unchanged, so its output was reused after resumption. Root Node dependencies are symlinked solely as local build/test dependencies; no lockfile/install change is included.

The e2e server uses a symlink to the already-built terminal integration binary at `.worktrees/improve-ledger-merged/target/debug/anywork`; no Rust compilation was performed. `scripts/e2e-server.py` was inspected: temporary workspace/data/home/plugin state, `--codex-discovery false`, deterministic fake Agent, and private Web directory. Sidebar API calls are intercepted by the existing test fixture. No production port, real Agent/profile/account, native application or release was used. The dependency/binary symlinks and generated outputs are not committed.

Original failure artifacts were copied read-only into `artifacts/sidebar-touch-runtime/original-failure/`, with `manifest.json` identifying their original paths, sizes and SHA-256. The trace SHA-256 is `ca59d17766234d96e5d554d6de515c74687ee833ef73e39af87e73e37649220f`; the root originals were not modified. The instrumented reproduction is retained under `test-results/baseline-short/`, including its failure trace and down/up timing JSON. The temporary code itself is absent from the candidate.

Before the pause, the two-sample experiment passed once in 33.0s and twice more in 33.9s/35.4s, all with the original assertions. Its down/up traversals each needed 59 strokes, completing in 14.02s/13.22s in the first successful timing run. This supports the overhead diagnosis but is not substituted for the final uninstrumented verification below.

## Final candidate verification

The complete focused suite and bounded short-mobile repeats are executed after removing instrumentation, without changing source between them. Commands use `PLAYWRIGHT_CHANNEL=chrome`, `ANYWORK_E2E_PORT=3242` and separate private output directories:

```sh
ANYWORK_E2E_OUTPUT_DIR=test-results/final-focused \
  ./node_modules/.bin/playwright test e2e/sidebar-scroll.spec.ts
ANYWORK_E2E_OUTPUT_DIR=test-results/final-short-repeat \
  ./node_modules/.bin/playwright test e2e/sidebar-scroll.spec.ts \
  --project=android-web --grep 'boundary gestures in a short window' --repeat-each=2
```

Observed final results (2026-11-08, macOS/Chrome):

| Check | Result and private evidence |
| --- | --- |
| Final uninstrumented complete sidebar suite | **6/6 passed** across desktop and Pixel, 1.1 minutes total. Short-mobile boundary case 32.9s. Log `artifacts/sidebar-touch-runtime/final-focused.log`; screenshots/input attachments `test-results/final-focused/`. |
| Final uninstrumented short-mobile repeat | **2/2 passed**, 33.4s and 33.8s, no retry. Log `artifacts/sidebar-touch-runtime/final-short-repeat.log`; evidence `test-results/final-short-repeat/`. |
| Repository standard `npm run format:check` | Passed for all configured Web/e2e/Playwright paths, including both touch-related files. Log `artifacts/sidebar-touch-runtime/format-check.log`. |
| Source hygiene | `git diff --exit-code HEAD -- e2e/sidebar-scroll.spec.ts` and `git diff --check` passed; no temporary instrumentation or test assertion change remains. |

Inspected the final native transport/application attachments: both normal and short Pixel runs contain trusted touchstart/touchmove/touchend and scroll events; short application first stroke reaches 112px and transport control 205px at 390×480, scale 1. The final short-mobile `bounded-sidebar.png` was visually inspected: controls/sidebar stay inside the viewport with no blank page extension. The test assertions, rather than the screenshot alone, prove exact top and containment. After execution port 3242 has no listening fixture process. No full-suite result is inferred from these focused passes. This remains Chrome emulation/fake-server evidence, not physical Android/Safari elastic overscroll or a fresh whole-project regression. Root owns independent review, merge, full release checks and publication.
