# Independent account Web re-review 02

Reviewed exact fix candidate: `18b4b8aa5ed00bdfeeb8d969dc09deedcc3153f9`. Previous review: [account-web-01](account-web-01.md). This commit contains the review only. Product implementation and verification-tool changes were authored by a different agent.

## Resolved findings

W1 is resolved: the default AccountStore fetcher is now an arrow wrapper, so the native browser fetch receives its correct receiver. Independently ran the committed browser regression through a real Chrome native fetch with an intercepted HTTPS Account API response. Actual fresh DEV hosted login and real Account API calls also returned200, as recorded below.

W2 is resolved: cancellation and chunk-ACK timeout retire only the exact outstanding ACK count for that request. One matching late ACK is accepted and removed; arbitrary unknown/malformed ACKs remain rejected. Request IDs are never reused and the session has a1024-ID bound, bounding retired records. Timeout goes through the same cancellation path. Independently ran the committed22-assertion interop suite. Separately reran the original independent reproduction using genuine delayed encrypted Rust fixture messages: `{cancelled:"CANCELLED",next:200}`. The test closes its transport explicitly after the successful next request; this is not an involuntary closure.

W3 is resolved: one `ended` notification reports transport expiry/closure. AccountHome clears only the currently owned transport and guards against old account lifecycle/transport callbacks; expiry returns to the device page with the translated authorization-expired message and does not replay writes. The committed browser/Rust regression independently exercised expiry notification and closure. The narrow UI ownership logic was independently inspected; no full actual desktop workspace-expiry UI run is inferred.

## New finding

### W4 — P2, blocking: the new cloud-check tool can write rotated OAuth credentials to an unsafe path and discard them on failure

Code: `web/scripts/account-cloud-check.mjs:5-17`, `:79-80`, `:85-86`. Contract: approved account design and cloud configuration require test credentials/OAuth tokens outside Git in private mode0600 files, no symlink writes, and a single durable refresh owner. The cloud OAuth verification tool already enforces several of these boundary rules.

`ANYWORK_DEV_BROWSER_STATE` is passed directly to Playwright for credential loading and later saving. The script does not enforce an absolute outside-repository target, regular non-symlink file, or existing restricted permissions. `context.storageState({path:state})` writes OAuth-bearing state before the subsequent chmod; a repository path or symlink target is accepted, and chmod after writing does not protect the write itself. This file contains real SDK refresh credentials, not public configuration.

The script only checkpoints on success. Account/Grid calls can rotate this context's sole refresh grant before a later assertion fails, after which `finally` closes the browser without persisting the updated state. A later retry can therefore replay stale credentials. This is a source-proven recovery gap; the previously observed19:48 saved-state401 is not claimed to have this established cause.

Validate the resolved target before launching/loading credentials: absolute, outside the repository, existing regular file, no symlink target/unsafe symlink traversal, and mode0600 or stricter. Create a private mode0600 temporary file in the verified directory and atomically replace the verified destination; do not write credentials first and chmod afterward. Checkpoint the same context's current SDK state in an appropriate `finally` after it has acquired ownership, including assertion failures after refresh, while keeping the original failure nonzero. Refuse ambiguous/changed path identity, and emit fixed sanitized errors for credential parsing/browser failures. Add isolated fake-credential tests for repository/public/symlink paths, failure after a simulated rotation, atomic permissions and error redaction; no real OAuth grant is necessary for those safety regressions.

## Independently executed re-verification

- `npm run typecheck -w web`: passed.
- `npm test -w web`:32 files,323 tests passed.
- `PLAYWRIGHT_CHANNEL=chrome ANYWORK_REMOTE_WORKTREE=/Users/water/work/2026/any-work/.worktrees/account-desktop node web/scripts/remote-interop.mjs`:22 real browser/Rust assertions passed, including default native fetch, late authentic ACK after cancel and timeout, unknown/malformed ACK rejection, expiry notification and the previous cryptographic/HTTP/binary/multipart/PTY/size/concurrency/replay/authentication tests. The Rust fixture account verifier and HTTP responses remain synthetic; production JWT/full business acceptance is not implied.
- Original independent late-ACK scratch reproduction: now next `/api/info` returns200 after the canceled upload.
- Fresh actual DEV hosted Logto sign-in through the corrected account UI, using a new headless Chrome context and this reviewer's independently owned SDK grant: callback completed; Account API GET200 twice, CyberGrid trusted config200, console exchange200, devices200; zero UI alerts. No other reviewer's refresh state was loaded or refreshed. Only the dedicated generated test account was used.
- Immediate replay of that same reviewer's privately checkpointed state with `account-cloud-check.mjs`: passed actual Account/Grid200 checks,1440/390px no overflow, add-device dialog and Escape dismissal. Private state is outside Git at `~/.config/anywork-cloud/web-review-browser-state.json`, mode0600; no secrets were printed. Successful rerun does not prove expiry/rotation behavior across a longer time window.

The author's prior successful19:42DEV run and later19:48saved-state401 remain separately recorded in the layout document. This review's fresh login and immediate owned-state rerun both passed; it does not retroactively reclassify the failed run or establish its cause.

## Conclusion

**blocked** for the exact candidate because the newly added credential-bearing verification tool requires W4. W1/W2/W3 are accepted as resolved. Full enrolled-native discovery/rename preservation, desktop remote grant/disable, phone/cellular access, production resource/role fees, CyberGrid distribution permission and final exact-source release acceptance remain separate integration/release gates. No production feature readiness or publication approval is granted.
