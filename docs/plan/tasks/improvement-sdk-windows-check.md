---
id: improvement-sdk-windows-check
scope: prioritized-project-improvement
status: in-progress
depends-on: [improvement-runtime-transport]
---

# G1 SDK A: actual Windows SDK tests in the existing native check

## Objective and context

The qualified SDK now has new cross-platform owned-stdio/cancellation/cleanup behavior. The existing Windows Checks job builds the SDK transitively but `cargo test -p anywork -p anywork-desktop` does not run SDK package tests. Include actual SDK package tests in that same Windows native test step so a future green matrix does not hide this missing execution. Linux workspace checks already run them. This is a narrow CI coverage integration, not a native-agent support claim, and can be developed while the SDK merged local regression finishes.

Read `.github/workflows/ci.yml`, SDK integration/unit tests and `plan/reviews/improvement-runtime-transport.md`. Source candidate `123cc1c` is independently accepted/merged; do not change SDK product/test behavior merely to pass Windows. A real platform failure must be preserved and fixed in its own source review loop.

## Paths and ownership

Own only the Windows native test step in `.github/workflows/ci.yml`, plus a brief new `docs/plan/analysis/sdk-platform-checks.md` explaining actual coverage and remaining native/platform gaps. No dependency/toolchain/version update, no job weakening, fallback or ignored test. Root owns central task/progress/check registration. Isolated worktree; no build required locally for the one-package selection change, since this Darwin machine cannot prove Windows behavior. No native app/process/profile/real prompt or production asset change.

## Verification

Inspect Cargo test package selection and all SDK cfg gates. Validate YAML and exact diff, and run the existing release CI selection tests if relevant without invoking publication. Commit before a different reviewer checks exact candidate and platform-count claims. After merge, actual fresh Windows Actions completion/logs are the execution gate. Windows green build alone is not evidence that tests ran. Keep platform-specific skipped/Unix-only cases explicit.
