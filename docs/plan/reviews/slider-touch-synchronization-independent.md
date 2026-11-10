# Slider touch synchronization — independent review

Date: 2026-11-11. Verdict: **accept exact `854afb702c35cf821c4ce3667374ae0e1be46e66`**, with no blocking finding, for the fresh v0.1.21 candidate. Root's `6493a1a` contains the identical test file. Review scope follows [the task](../tasks/release-slider-touch-synchronization.md): test targeting only, without product, timeout, assertion or skip changes.

## Exact v0.1.20 outcome

The reviewer read-only monitored Checks [42851478933](https://github.com/ywateru/AnyWork/actions/runs/42851478933) and independently confirmed its final source `2eb935ac9f598e1b7bdedb70606881ceb9b4900f`, completed/failure result, and these jobs:

| Job | Final result |
| --- | --- |
| Windows Native `129953028209` | PASS; native server 170 passed/five existing opt-ins ignored, desktop 22 passed/one existing opt-in ignored; the historical-layout schema case passed |
| Container `129953028641` | PASS |
| Android `129953028824` | PASS |
| Server/Web `129953028847` | FAIL in the early browser suite: 41 passed, one failed; later full `check.sh`, formatting and site checks were skipped |

The failure was the Android-browser slider case at `e2e/model-picker.spec.ts:205`, expecting `aria-valuenow=2` but receiving `0` after the final raw touchscreen tap. It was not an ownership-test failure or evidence of a completed full server-web matrix. Vercel run `42851478921` succeeded for the same source. Root reported its publisher exited on Checks failure; no v0.1.20 tag or Release was created. The reviewer did not mutate or retry CI.

## Trace evidence and its limits

The reviewer independently downloaded the retained artifact to `/tmp/anywork-release-020-browser`, read the failed case's trace/network snapshots and viewed the actual screencast frames. `aria-busy=false` completed at trace time 20681 ms; bounding-box measurement ran at 20683–20690 ms; raw `touchscreenTap(328,745)` ran at 20691–20704 ms. A composer GET began around 20697 ms. The after-touch snapshot at 20707 ms has `aria-busy=true` and newly inserted loading text; the bottom-anchored menu grows, moving its slider upward by approximately 35 px. The previous coordinate is outside the slider in the resulting frame. There is no subsequent high-effort POST. Earlier setting saves succeeded.

Frozen-source review found conditional loading content and fixed bottom positioning, not a menu transform animation. Spinner rotation and thumb scaling are separate effects. The trace has no actual pointerdown-target record; it does **not** establish exact pointer dispatch ordering, prove the target that received the event or demonstrate a product pointer-handler defect. The concrete fixture defect is the absence of a current element/hit-target guarantee between a bounding-box read and a raw page-coordinate touch. This supports correcting targeting and creating a fresh candidate, rather than treating the unchanged failure as an external transient.

## Source and independent execution

The only test-line change is Android's `slider.tap({ position: { x: bounds.width - 14, y: 14 } })`, replacing the raw page tap. It preserves real touch input and uses locator actionability/stability/hit-target checks with current element-relative coordinates. The measured width still identifies the existing right-end inset; menu loading changes vertical layout. No `force`, explicit retry, timeout increase or bypass was added. Desktop drag, serialization, wheel, high-value ARIA/server persistence, menu dismissal and focus assertions are unchanged.

Independent actual Chrome execution of that exact case, two repetitions in each configured project, passed **4/4**: desktop 2/2 and Android Web 2/2, with no skips, in 20.4 seconds. Output is `/tmp/anywork-slider-touch-independent-021-chrome-results`. The reviewer used its isolated worktree and port 3442, the existing temporary workspace/data/plugin launcher and fake agent; the owned listener was confirmed closed afterward. `git diff --check` passed. A prior invocation without the Chrome channel stopped all four attempts at browser launch because the expected Playwright headless executable was absent; no case body ran. Setting the existing `PLAYWRIGHT_CHANNEL=chrome` selected installed Chrome without a browser download or source change; that setup failure is not counted as a product/test regression or successful execution.

Reused immutable Web: archived `f77299569e8a8109c43d3813c263cdcfa2eba339` build at `/var/folders/ll/s836stz50mg85d4h0g4xc8jm0000gn/T/anywork-mobile-menu-018-batai54p/source/web/dist`. The reviewer independently confirmed `f772..2eb` Web differences are only `web/package.json` version metadata, with no component difference, and checked both production asset hashes:

- `index-BWUHNMXg.js`: `5d3d3e8ea16a8d5e6c0547bfd331fa634760101f86b62f5028501bd355fc4274`.
- `index-DPJX8MUf.css`: `1bc1aacfb2751e8e5cae9fc33a74f63b2c0ec18a7f651dfd14d21ec9e98b41ac`.

The previously authorized read-only root debug server fixture was `/Users/water/work/2026/any-work/target/debug/anywork`, independently hashed `9a48a625e3e5842768560307b520a8a0ed7e878e73e7973dba7b167f4b782942`. It is an earlier merged build, **not** an exact v0.1.20 server claim. Launcher and local fixture match the frozen source. The author's separate evidence is three Android repetitions plus the full two-project model-picker suite, 36/36, and formatting; the reviewer did not repeat that whole suite.

New exact-source Checks remain the final platform gate. This targeted browser verification is mobile emulation, not a physical-phone claim. No installed app, retained business server, real account, remote access or release artifact was changed; no new local candidate is requested.
