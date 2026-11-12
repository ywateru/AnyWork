# UI v2 merged checks and publication

Date: 2026-11-12. Product scope is the [UI v2 task](../tasks/ui-refactor-v2.md). This record separates candidate review, merged checks and actual deployment.

## Accepted candidates

- Web `81a97709e37d3a1df5cd6b592caad1d65bbdb654`: independently passed and merged. See [Web review](ui-v2-web-independent.md).
- Desktop `4be6ef378074487d8c2736f2f63a01eb4a36b899`: independently passed and merged. See [desktop review](ui-v2-desktop-independent.md).
- Hosted branding: actual configuration and public page independently passed at 1440/390. See [hosted review](ui-v2-hosted-branding.md). Only branding and primary colors changed; existing Logto background/footer remain.
- Corrected Web `148f380b1fa7404b2d7f3cb0d37cf9e6ad8e5ee2`: independently passed, then merged as `c87ac8790cae0f18c9019f8bf8f6d55ee2a2cfb8`. See [short-height review](ui-v2-web-short-height.md). Original touch tests and timeout are unchanged; all six sidebar cases passed independently, including the 390 × 480 case in 19.9 seconds. The short-window history measured 192px and its first trusted touch advanced 145px.

## Merged local checks

- Web TypeScript, production build, 353 unit tests across 38 files and 8 private-state tests passed.
- Desktop build (including TypeScript), root-level account-entry check and updater interaction script passed. The updater check used installed Chrome via `PLAYWRIGHT_CHANNEL=chrome`; the first invocation without that setting could not locate Playwright's bundled browser and did not exercise the product.
- Repository Prettier checks and `git diff --check` passed.
- All 96 desktop E2E cases passed on isolated port 3331, covering both Playwright projects. Logs: ignored `artifacts/ui-v2-integrated/desktop-e2e.log`.
- Full non-desktop Web E2E on isolated port 3330 finished with 572 passed, 1 existing conditional skip and 1 blocking failure. At 390 × 480, the sidebar session list had only 67px usable height; repeated real-touch strokes could not reach the bottom within the 45-second test budget. The failure is in `sidebar-scroll.spec.ts`'s short-window Android case. Logs and native-touch geometry: ignored `artifacts/ui-v2-integrated/{web-e2e.log,web-results}`. These checks use an isolated actual service and deterministic Agent fixtures; no real user account, current service or native Agent session is used.

The two initial task worktrees and merged branches were removed after independent candidate acceptance. On the merged regression failure, the Web merge was reverted locally, and a separate `codex/ui-v2-web-fix` worktree reapplies the candidate to fix compact-height navigation before re-review. Desktop remains accepted. Existing unrelated worktrees and installed services were retained.

After correction merge `c87ac87`, root repeated the affected integration checks on isolated port 3336: all 12 account/local-entry and sidebar E2E cases passed in 45.9 seconds on Desktop and Android projects. The original short-height Android touch case passed in 19.8 seconds. Actual local ticket/cookie/PTY paths remain covered. Production build (including TypeScript), repository format and 1440/390 client account-entry checks also passed. Logs: ignored `artifacts/ui-v2-integrated-final/`. Earlier unaffected full-suite evidence remains above; no test was weakened.

## Publication

Published [v0.1.26](https://github.com/ywateru/AnyWork/releases/tag/v0.1.26) from exact source `c8fcb717f835bd903cf8c2d4bf37ff26fd240e8f`. The existing resumable publisher finished with exit 0 and phase `complete`.

- Exact-source [Checks](https://github.com/ywateru/AnyWork/actions/runs/43141374588) passed, including the full service/Web suite and Android, container, Windows and macOS checks.
- All-platform [Release](https://github.com/ywateru/AnyWork/actions/runs/43143859381) passed. Publisher verified 20 assets, 19 SHA-256 entries and five updater target/signature/version bindings.
- Final [Vercel deployment](https://github.com/ywateru/AnyWork/actions/runs/43145655894) passed. Official [application](https://anywork-tau.vercel.app/app/) and bilingual download metadata match 0.1.26; `/build.json` identifies the exact release source.
- Independent public-entry review at 1440/390 passed, including actual OAuth entry navigation, canonical SVG bytes and coordinator health. Final independent publication evidence is recorded in [production review](ui-v2-production.md).

Initial Vercel run 43141374531 failed while pulling configuration because the stored deployment token had expired. The existing authenticated CLI refreshed its credential; the existing GitHub `VERCEL_TOKEN` secret was updated without printing it, and the failed job retry passed. This OAuth access credential expires at 2026-11-12 10:30:37 UTC; successful current deployment does not establish durable future CI authentication. See [cloud configuration](../../cloud-configuration.md).

The final correction worktree and branch were removed after merge and independent verification. The installed desktop and running local service were retained; new desktop packages and signed update metadata are available in the release.

## Cache cleanup

The user's follow-up cleanup removed untracked, rebuildable Rust artifacts from three old worktrees (`account-desktop`, `account-reliability-review`, `improve-ledger-merged`) and the main `target/debug/incremental`. No compiler or runtime was using these paths. Disk free space increased from about 33GiB to 70GiB at that measurement (approximately 37GiB reclaimed). `npm cache verify` additionally garbage-collected 1,162 unreferenced entries / 1,463,116,162 bytes while retaining verified dependency content. Current activity elsewhere can change disk totals.

Source branches, worktree edits, business sessions/configuration/credentials, current root executables and acceptance evidence were preserved. Cleanup audit is local-only at `artifacts/ui-v2-integrated-final/cache-cleanup.json`; no personal runtime data or development screenshots were added to the release source.

## Limits

Synthetic OAuth/Grid/Noise and Native fixtures establish UI/controller behavior, not a new real-account encrypted transport acceptance. Actual local ticket/cookie/PTY boundaries were independently exercised. Remote protocols, Native lifecycle and chat execution components were preserved. Public-page and release metadata checks must not be described as physical mobile, installed-upgrade or real-account business acceptance.
