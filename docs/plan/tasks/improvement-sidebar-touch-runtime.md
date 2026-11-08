---
id: improvement-sidebar-touch-runtime
scope: prioritized-project-improvement
status: in-progress
depends-on: [improvement-sidebar-boundary]
---

# Merged regression: diagnose short-mobile real-touch timeout

## Objective and actual failure

Root full SDK+ledger regression at `855f971` exited 1: Rust/Web/registered HTTP checks passed, browser **610 passed / one existing skip / one failure**. The failing Android `e2e/sidebar-scroll.spec.ts:142` short-window case exhausted its 45-second whole-test timeout during `reachBoundary(up)` progress polling at line 188. This is not yet established as a product defect or a defective helper. Root artifacts at `.worktrees/improve-ledger-merged/artifacts/sdk-ledger-merged/check.log` and `test-results/sidebar-scroll-sidebar-con-8ba47--gestures-in-a-short-window-android-web/` are immutable failure evidence. Earlier exact-source ledger CI `66bd6f0` passed the same Web/e2e source on Linux. SDK merge changed no Web/e2e source and remains dormant, but its merged full regression is not a pass.

## Context and paths

Read the prior `improvement-sidebar-boundary` task/review, `e2e/sidebar-scroll.spec.ts`, `e2e/touch-input.ts`, actual sidebar layout and captured trace/transport/geometry. Work in the provided isolated tree from current main. Own focused browser/helper correction and a new analysis `docs/plan/analysis/sidebar-touch-runtime.md`; do not edit product code unless evidence independently demonstrates a product bug and root assigns its scope first. No server/native/source-schema/dependency/workflow change. Root owns task/status/full regression.

## Required investigation and behavior

First reproduce focused short-mobile with real Chrome, private built assets, port/data/output. Preserve each command/source/result and original failure. Distinguish genuine stalled/escaped scroll, fractional boundary and whole-test budget consumed by many successful bounded strokes. Instrument actual gesture/boundary timing and final geometry in test evidence if necessary. Do not infer root cause from the stack line alone.

Preserve 80-session long-list coverage, true touch transport checks, in-viewport touch strokes, finite geometry-derived gesture budget, observable per-gesture progress, exact top zero, bottom rounding allowance, document/shell/footer/menu containment and screenshots. No direct scrollTop assignment, DOM manipulation to pass, forced clicks, retries hiding failures, fewer assertions or arbitrary larger timeout as substitute. A justified structural/driver correction may make the complete real-boundary scenario efficient while retaining the actual user behavior. If only load accounts for timeout, state the exact evidence and propose a reviewable bounded execution model rather than blindly raising 45 seconds.

## Verification

Use one private UI/Web build (no root dist), root shared Node dependencies, private `CARGO_TARGET_DIR` only if the existing integration cache can be safely reused after its process is terminal; avoid rebuilding Rust needlessly for mocked sidebar API. Run focused desktop/Pixel and bounded original short-mobile repeats, plus touched touch-helper consumers if changed. All original evidence retained. Commit exact candidate; a different reviewer executes meaningful independent negatives/repeats and audits preserved genuine-touch/containment coverage. Root then records full-test failure and appropriate corrected merged regression separately. No production restart, actual Agent/app/profile or release.
