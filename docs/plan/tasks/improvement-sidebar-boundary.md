---
id: improvement-sidebar-boundary
scope: prioritized-project-improvement
status: done
depends-on: []
---

# CI regression: consistent real-touch sidebar boundary checking

## Objective and evidence

New-source [Checks at `3d66212`](https://github.com/ywateru/AnyWork/actions/runs/42374272433) passed container/Android/Windows but failed its early mobile short-window sidebar case before server/schema checks. `e2e/sidebar-scroll.spec.ts::reachBoundary` stops when remaining distance is at most one pixel, while its following top assertion requires exactly zero. CI actually stopped at one pixel. Preserve strict top behavior and resolve this test-helper contradiction, without weakening production containment assertions or claiming a product fix from a fixture correction.

## Context and paths

Own only `e2e/sidebar-scroll.spec.ts` in a private worktree. Top must continue real touch/wheel gestures until zero; bottom may retain its existing one-pixel rounding tolerance. Retain finite geometry-derived gesture budget, per-gesture progress checks, native touch-transport verification, screenshots, menus and viewport/overscroll containment checks. Do not programmatically set scrollTop, force clicks, extend timeout as a substitute, or edit product/runtime code. Report a real product defect separately if verification demonstrates one.

## Verification

Run focused sidebar cases on desktop and Pixel plus a bounded repeat of the failing short-mobile case, using private assets/data and the local Chrome channel. Commit the exact single-file candidate; a different agent independently reviews and executes it before root merges. Then require a new exact-source Checks run; earlier platform job successes do not authorize a different source or replace the previously skipped Linux/schema stages. No release, production restart or native task.

## Current evidence

Candidate `7aa1877` passed [independent review](../reviews/improvement-sidebar-boundary.md) at `9b542c3` and merged at `efc57de`. Independent original short-mobile repeats passed 2/2 and the complete desktop/Pixel focused suite passed 6/6. Strict top-zero, real touch, progress/budget and containment checks are retained. [Fresh exact-source cloud Checks](../reviews/improvement-g1-source-ci.md) passed all four jobs at `aacaa19`, including the early browser gate and complete `check.sh`. This closes the test-helper task; the prior failed cloud run is not reclassified as a pass and physical-device acceptance remains separate.
