# Independent review: model-menu focus after native saves

Reviewed commits: `e875454bc17757f8830942557ee3f9de838e3ce3` and follow-up `98d379f82ab5cd3639e4b3df920e1530696fce32`, worktree `.worktrees/model-picker-focus`.

Result: **PASS on the final follow-up; both focus findings are closed**. The first commit alone was blocked by the composite Escape-then-input ownership case below. Published v0.1.9 is unchanged; merged full checks and v0.1.10 delivery remain orchestrator gates.

## Actual failure and timing evidence

Independently read the cloud failure log and the exact `model-picker-single-fast-t-ff07e-ps-focus-after-native-saves-desktop` error context and trace. The fast checkbox was disabled with the menu busy at trace timestamp 79890.103. At 79923.089 it was checked, enabled and no longer busy. Its focus assertion remained inactive through 84937.358 while the menu still existed. This is a real post-save keyboard-focus failure, despite the same case passing the full local suite. The assertion was not removed, forced or weakened.

The old implementation disabled its focused control while saving and attempted restoration in a single animation-frame callback after the save promise. That frame could run before React committed the enabled control, making the focus call ineffective. The CI trace does not record the application's frame callback or activeElement, so its exact scheduling is not asserted as directly observed. The committed controlled regression demonstrates that ordering by holding React's MessageChannel task across two real animation frames, without replacing focus APIs, requestAnimationFrame or the native save request.

Independently ran that committed regression against the reviewer's previously built v0.1.9 UI. Both successful-save and rejected-save cases failed at the original strict focus assertion with an enabled, inactive checkbox. This independently confirms the timing defect rather than relying only on the developer's red/green output.

## Review finding and closure

Commit `e875454` restores the speed control only after the enabled DOM commit and binds restoration to the original session, mutation and button. Its 28 targeted browser cases passed independently, but review found a remaining ownership defect in the older trigger-restoration path: save pending → Escape → deliberately focus the draft → save completes. Escape deferred returning to the disabled picker trigger; the subsequent draft focus did not cancel that return after the menu closed.

A separate reviewer-authored test in `/private/tmp/anywork-model-focus-independent/independent.spec.ts` reproduced this sequence against the first fixed build and failed because the draft became inactive. This was blocking under the existing ownership contract, not an expansion into unrelated UI work.

Follow-up `98d379f` scopes trigger restoration to the same session/mutation/DOM identity, restores it in a layout effect after it is enabled, and removes the old unscoped frame callback. Both restoration intents are cancelled by subsequent pointer/key actions, other focus, window blur or session cleanup. The cancellation listener remains present after menu closure so a later user action cancels a deferred Escape return. New committed cases cover Escape followed by outside focus or another session, on successful and rejected saves. The independent standalone composite test now also passes against the final build.

## Independent final checks

Ran each command separately in the stable developer worktree and checked its exit status:

```sh
npm run typecheck -w web
npm exec -w web -- vite build --outDir /private/tmp/anywork-model-focus-verifier-final-dist
ANYWORK_E2E_PORT=3256 ANYWORK_E2E_WEB_DIR=/private/tmp/anywork-model-focus-verifier-final-dist ANYWORK_E2E_OUTPUT_DIR=/private/tmp/anywork-model-focus-verifier-final-results PLAYWRIGHT_CHANNEL=chrome npx playwright test e2e/model-picker.spec.ts
ANYWORK_E2E_PORT=3256 ANYWORK_E2E_WEB_DIR=/private/tmp/anywork-model-focus-verifier-final-dist PLAYWRIGHT_CHANNEL=chrome npx playwright test --config /private/tmp/anywork-model-focus-independent/playwright.config.ts
```

Standalone TypeScript checking and the isolated build exited 0. All 36 committed model-picker browser cases passed across desktop and Android, followed by the separate reviewer composite case. Coverage includes the original single-fast-tier focus assertion, controlled enabled-commit timing on success/failure, native tier IDs and cleared overrides, rejected settings, speed flyout focus, Escape return, focus moved to a sibling slider or draft, session changes with a new menu already open, composite close-then-move cases, draft/error isolation, and existing slider input/serialization. Window-blur cancellation was inspected in code; it is not claimed as a separately exercised browser-background scenario.

The fix changes presentation focus lifecycle only. Native save payloads, current-value/error handling and session ownership are preserved. Verification used an out-of-tree Web build and isolated fixture service on port 3256, which exited after the runs. No production session, real model credential, installed application or production service was changed. The full project suite was left to the orchestrator rather than repeated by this reviewer.
