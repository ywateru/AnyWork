# Desktop saved-login privacy E2E assertions

2026-11-16. Author validation; independent review remains a separate gate. Base: `0f4018782f952ce4a006546c711c02106a496ed0`.

## Confirmed failure and change

[Checks 43833433203](https://github.com/ywateru/AnyWork/actions/runs/43833433203) for `ac7c4229023afef5231fadfe9efcef3f7d97b48e` finished with Windows, macOS, Android and container success. The server-web full E2E suite had 671 passed, one skipped and ten failed. All failures expected the obsolete disclosure that application credentials and device private keys remain only in memory.

The accepted [login persistence contract](../../login-session-persistence.md) and production Desktop UI instead disclose OS-secure saved login, restoration after closing, deletion on explicit logout, and device connection private keys remaining only in memory.

Only four text locators in `e2e/desktop-overview.spec.ts` and `e2e/desktop-tunnel.spec.ts` change. Each now requires all four disclosure statements together. Existing console absence, settings visibility, keyboard Enter, viewport, preparation, ownership and IPC assertions remain unchanged. No production implementation, timeout, retry, project matrix or CI gate changes.

## Validation

- Desktop production UI built successfully in the author worktree's independent `desktop/ui/dist`, using `npm run build -w anywork-desktop-ui`. Its source is unchanged from `ac7c422`.
- Both complete specs passed in both original Playwright projects, `desktop` and `android-web`: **56 passed, zero skipped, zero failed (2.0 minutes)**. This includes the original ten failing cases: four onboarding viewport sizes and the keyboard disclosure case, each in both projects.
- Used installed Chrome with `PLAYWRIGHT_CHANNEL=chrome`. An ignored local configuration inherits the repository configuration and both projects, sets an isolated output directory, and disables its unrelated Rust web server. These specs serve production files through `desktop-fixture.ts` at the synthetic `anywork-desktop.test` origin and mock the Native boundary. No real account, installed application or device is used.
- Command: `PLAYWRIGHT_CHANNEL=chrome node_modules/.bin/playwright test e2e/desktop-overview.spec.ts e2e/desktop-tunnel.spec.ts --config artifacts/desktop-persistence-e2e/playwright.config.ts`.
- Prettier for both changed specs and `git diff --check`: passed.

Ignored author evidence is under `artifacts/desktop-persistence-e2e/`: production build log, isolated configuration, Playwright log and synthetic screenshots. No Cargo command or shared target access was needed. This test-only change does not establish real account restart behavior and does not change candidate APK contents.
