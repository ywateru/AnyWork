---
id: release-slider-touch-synchronization
scope: mobile-slider-browser-test
status: in-progress
depends-on: [release-ownership-release]
---

## objective

Correct the mobile touch target synchronization in the model-picker test exposed by v0.1.20 Checks `42851478933`, exact source `2eb935ac9f598e1b7bdedb70606881ceb9b4900f`. Windows, Android and container checks passed; the early browser suite had 41 passes and one failure. Full server-web checks were not reached. No v0.1.20 tag or Release was created.

## evidence

The test reads a slider bounding box, then sends a raw absolute-coordinate touchscreen tap. The retained trace shows an asynchronous composer refresh and loading content changing the bottom-anchored menu layout within that interval; the old tap coordinate is outside the slider in the resulting frame. No high-effort POST follows. The trace does not record the actual pointerdown target, so it cannot prove exact hit ordering or a product pointer-handler defect. Independent source review found no menu transform animation; the observed change comes from conditional loading content. This supports fixing the fixture's target guarantee, not classifying the run as an external transient.

## implementation and verification

The UI author owns only the corresponding Android branch in `e2e/model-picker.spec.ts` and its author report. Use the slider locator's real touch action with element-relative positioning and Playwright actionability checks instead of the stale raw page coordinate. Preserve rapid-change serialization, wheel, desktop drag, touch, high-effort persistence, focus, dismissal, timeouts and skips. Do not change product code. Targeted actual mobile/browser regressions and exact-commit independent review must pass. Reused Web/server fixtures must state their source scope accurately; new exact-source CI remains the final platform gate. Root merges accepted source for a fresh v0.1.21 publisher operation, leaving previous tags and failure evidence unchanged. No account, production service or local application changes are authorized by this test correction.
