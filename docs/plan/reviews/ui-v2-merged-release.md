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

Short-height independent and targeted merged acceptance are complete. Ready for immutable `0.1.26` publication through the existing resumable `scripts/publish.py` flow. No release/tag has yet been created and the application website has not been updated. Exact source/version and live entry checks follow publication.

## Limits

Synthetic OAuth/Grid/Noise and Native fixtures establish UI/controller behavior, not a new real-account encrypted transport acceptance. Actual local ticket/cookie/PTY boundaries were independently exercised. Remote protocols, Native lifecycle and chat execution components were preserved. Public-page and release metadata checks must not be described as physical mobile, installed-upgrade or real-account business acceptance.
