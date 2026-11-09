# Independent desktop E2E fixture correction review

- Accepted exact product commit: **`463a907f3dcf7662f9d2fe169c275ea4de3b17e9`** (parent `adceb53`).
- Reviewer: independent `verify_desktop`; date/platform: 2026-11-09, macOS arm64, installed Chrome.
- Verdict: **PASS for the fixture correction and affected browser regression gate.** No blocking or non-blocking finding identified in this delta.

## Scope and source review

The entire delta adds 16 lines to `e2e/desktop-fixture.ts`; it changes no product implementation, test assertion, browser configuration or server fixture. The current account controller polls `account_snapshot` in the manager UI. That read-only status query previously fell through to the fixture's operation log and returned null, contaminating tests which deliberately require no engine operations or a precise sequence.

At `e2e/desktop-fixture.ts:118`, only the exact command string `account_snapshot` returns before `calls.push` at line 148. Its 11 fields match the current `AccountSnapshot` type in `desktop/ui/src/accounts.tsx:23`: a signed-out, disabled, idle account with no transaction, subject, label, error or public device identifiers. The handler does not use a prefix filter, remove existing log entries, or exempt account mutations and unknown commands.

The strict existing assertions remain unchanged, including empty operation logs in `e2e/desktop-overview.spec.ts:172` and `:192`, the complete save/status/start sequence at `:214`, and exact cloudflared-status/start ordering in `e2e/desktop-tunnel.spec.ts:152`. The preexisting route-start exclusion assertions and cancellation checks also remain intact.

## Independent execution

Ran against the exact accepted candidate, with an isolated server on port 3242, temporary test data/home and private output under `/tmp`, without reusing the orchestrator's server:

```sh
ANYWORK_E2E_PORT=3242 \
PLAYWRIGHT_CHANNEL=chrome \
npm run test:e2e -- e2e/desktop-overview.spec.ts e2e/desktop-tunnel.spec.ts
```

**46 passed, 0 failed**, covering both `desktop` and `android-web` projects; elapsed 2.2 minutes. Existing exact-sequence and empty-log expectations passed without relaxation.

A reviewer-only temporary Playwright test then exercised the fixture directly in both projects. It wrapped the IPC bridge to observe the real rendered UI's background polling, waited across a polling interval, and verified that polling occurred while the strict operation log remained empty. An explicit exact snapshot read returned the complete expected object without adding an operation. Invoking `account_begin`, `account_cancel`, `account_logout`, `account_enable`, the similar name `account_snapshot_extra`, and `unknown_command` retained all six entries in exact order. **2 passed, 0 failed**. This direct invocation tests fixture dispatch only; these commands do not perform real account mutations in this synthetic bridge.

`npx prettier --check e2e/desktop-fixture.ts` and `git diff --check` passed. The temporary reviewer test was removed, the test server exited, and port 3242 had no listener afterward. No tracked product files were modified by the reviewer.

## Evidence boundary

This accepts a synthetic manager fixture correction and the 46 affected browser cases. It does not rerun the full browser suite or establish actual OAuth, native lifecycle, physical Android, Keychain, or cloud behavior. No real grant, root acceptance fixture, existing user service/history or native UI was accessed.

The orchestrator separately reports that the real memory-only same-home restart → login/enable → Web discovery/encrypted access chain now succeeded and the public record was read back at key version 2. That observation belongs in the real-device acceptance record; this reviewer did not independently observe it. The original single restart failure still has no established cause. This isolated test change must not be described as a known fix for that real restart failure.
