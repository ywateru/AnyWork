# Existing Web client account entry — independent review

Date: 2026-11-09 (Asia/Shanghai).

Reviewed product commit: `683094b898484f1419e769b65403f1ec5f835847`.

Task: [account-client-entry](../tasks/account-client-entry.md), Web lane. Contract: [account-web-layout](../../account-web-layout.md), “Current client entry” and “Existing workspace entry implementation”.

## Findings

No blocking or non-blocking findings in this change.

- `web/src/App.tsx` renders the account entry in the persistent window bar independently of the selected session/sidebar. The disconnected screen exposes both registration and login. `AccountEntry.tsx` uses an ordinary HTTPS link with a fixed validated `/app/` path and `noopener noreferrer`, preserving the current local tab and manual connection. No account navigation writes `ra.connection` or changes the active local transport.
- The encrypted workspace receives `onDevices={closeConnection}` from `AccountHome`. The button invokes the existing parent cleanup, aborting connection establishment, closing the active `RemoteTransport` and setting the connection to null; unmounting the workspace also runs its existing effect cleanup. There is no manual-connection restoration in this path.
- Development defaults form a complete five-field deployment. The presence of any supplied account field selects only the supplied group; missing/empty/invalid groups fail closed. The portal override is independently optional and rejects credentials, HTTP, query, fragment and paths outside `/app/`.
- The official SDK remains in use. The installed pinned `@logto/client` source explicitly defers access-token reads until first use so subclasses may replace `adapter.storage` in their constructor. `AccountLogtoClient` does that before any persisted-token operation. The namespace includes encoded issuer and SPA ID; callback sign-in sessions, all persisted tokens and storage-event handling use the same namespace. Different issuers/apps do not load the previous grant, and the code does not migrate old unnamespaced tokens.

## Independent validation

All executed against the exact product commit above, before writing this report:

- `npm test`: 327 Vitest tests and 8 Node private-state checks passed.
- `npm run typecheck`: passed.
- `npm run format:check`: passed.
- `npm run build`: passed; existing large-chunk informational warning only.
- `node web/scripts/client-account-check.mjs`: passed at 1440 and 390 pixels. Covered registration/login destination and new-tab behavior, keyboard activation, visible workspace entry, unchanged manual connection, account entry refusing to restore that connection and failed-callback recovery.
- Inspected the generated 390px screenshot: account entry remains visible in the upper bar with no horizontal overflow, matching the existing black/white client styling.
- `git diff --check`: passed; product worktree was clean before this report.

The UI check uses local static files and isolated intercepted responses. This review did not log in, read private credential/grant files, write cloud resources, exercise actual email delivery or claim real enrolled-device/cellular acceptance. The new “我的设备” callback/cleanup path was traced through the real components and existing transport lifecycle; it was not represented as a new real Logto/Grid/Noise end-to-end run.

## Conclusion

**pass** for the Web client-entry follow-up at the reviewed product commit. Merge-time and actual account/native-device acceptance remain with the orchestrator.
