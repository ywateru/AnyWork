# Slider touch synchronization — author evidence

Date: 2026-11-11. Task: [release slider touch synchronization](../tasks/release-slider-touch-synchronization.md). Scope: one Android-browser test action and this report; no production code, timeout, assertion or skip changes.

## Diagnosis

Exact v0.1.20 Checks [run 42851478933](https://github.com/ywateru/AnyWork/actions/runs/42851478933), source `2eb935ac9f598e1b7bdedb70606881ceb9b4900f`, failed the early Android model-picker slider case. The early browser result was 41 passes and one failure; the later full checks were not reached. Retained evidence is under `/tmp/anywork-release-020-browser/model-picker-slider-serial-71fcc-eel-pointer-and-touch-input-android-web/`.

The final touch action used an absolute coordinate calculated from an earlier bounding box:

- Menu `aria-busy=false` completed at trace time 20681 ms; the bounding-box action ran at 20683–20690 ms.
- Raw `touchscreenTap(328,745)` ran at 20691–20704 ms. A composer GET began in the same interval, around 20697 ms, and returned 200.
- The post-touch snapshot at 20707 ms has `aria-busy=true` and an additional loading status. Because the menu is anchored by its bottom edge, this content makes the menu taller and moves the slider upward by about 35 px. The old coordinate is outside the slider in the resulting frame.
- No high-effort POST followed the touch. Earlier setting saves returned 200; there is no evidence of a rejected save or a server response resetting a successfully selected high value.

Source inspection connects normal settings notifications to `settingsVersion`, the picker's `controlsRevision`, and its composer refresh. The menu has conditional loading content rather than a menu transform animation. The trace does not record the actual pointerdown target, so it cannot establish the exact event hit ordering or prove a product pointer-handler defect. It does establish that a bounding-box read followed by a raw page coordinate does not guarantee a stable slider target through this refresh. This supports correcting the test synchronization instead of treating the failure as an external transient.

## Minimal change

Only the Android branch now calls `slider.tap({ position: { x: bounds.width - 14, y: 14 } })`. This remains a real touch action, with an element-relative position, while Playwright checks the element's stability and hit target and resolves its current page coordinates. The existing desktop drag is unchanged. Rapid-change serialization, wheel handling, high-value ARIA and server persistence assertions, menu dismissal, restored focus and all existing deadlines remain intact.

## Targeted verification

- Actual Chrome Android-browser execution of the original failed case, repeated three times: **3/3 PASS**. Log: `/tmp/anywork-slider-touch-021-fixed-repeat.log`; output: `/tmp/anywork-slider-touch-021-fixed-repeat-results`.
- Existing model-picker suite once across desktop and Android browser: **36/36 PASS** in 33.2 s. Log: `/tmp/anywork-slider-touch-021-suite.log`; output: `/tmp/anywork-slider-touch-021-suite-results`.
- Prettier for the touched test and `git diff --check`: PASS.

Both runs used isolated port 3441, owned temporary workspace/data/plugin directories, the existing launcher that omits HOME/CODEX_HOME overrides, and the approved read-only server fixture `/Users/water/work/2026/any-work/target/debug/anywork` (SHA-256 `9a48a625e3e5842768560307b520a8a0ed7e878e73e7973dba7b167f4b782942`). That binary is an earlier merged debug build, not claimed to be the exact v0.1.20 server.

The immutable production Web build is `/var/folders/ll/s836stz50mg85d4h0g4xc8jm0000gn/T/anywork-mobile-menu-018-batai54p/source/web/dist`, built previously from archived source `f77299569e8a8109c43d3813c263cdcfa2eba339`. `ReasoningSlider.tsx`, `ModelPicker.tsx` and `ModelPicker.css` in that archive were byte-compared with frozen v0.1.20 source and match. The full Web source difference between those versions is package version metadata only; the launcher, fake agent and local browser fixture also match frozen v0.1.20. Reused production asset identities:

- `index-BWUHNMXg.js`: SHA-256 `5d3d3e8ea16a8d5e6c0547bfd331fa634760101f86b62f5028501bd355fc4274`.
- `index-DPJX8MUf.css`: SHA-256 `1bc1aacfb2751e8e5cae9fc33a74f63b2c0ec18a7f651dfd14d21ec9e98b41ac`.

An initial preparation attempt incorrectly selected `/tmp/anywork-ci-018-web-dist`, which contains an older bearer-login UI. Its three attempts stopped at the message-editor prerequisite and never exercised the slider. This input error was corrected to the archived build above; those attempts are not counted as slider regressions or successful verification.

No real account, installed application, live service, remote access or release artifact was changed. Exact new-source CI remains the final cross-platform gate after independent review and root integration; the unchanged v0.1.20 candidate is not retried.
