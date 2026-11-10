# Approval notification race — independent review

Date: 2026-11-11. Verdict: **accept exact `a81cc537e59950c1bdfd991f2f4a29bba757d963`** for the fresh v0.1.22 candidate, with no blocking finding. Root's `cdb1609` has identical contents in the changed product files and browser regression. This review follows [the authorized task](../tasks/release-approval-notification-race.md) and root's `3ab09dc` contract. Exact-source Checks and the release matrix remain required; v0.1.21 is not an unchanged transient retry.

## Failed candidate and independent diagnosis

The reviewer independently confirmed the completed/failure result of [Checks 42859028675](https://github.com/ywateru/AnyWork/actions/runs/42859028675), source `b050beae4f353d727be15ffd7376f1216b322fbf`. Windows Native, Android and Container passed. Server/Web reached the full browser suite: **646 passed, one existing skip, one failed**. The failing desktop workspace case timed out on the ordinary “允许一次” click at `e2e/workspace.spec.ts:52`, with `notification-toast-open` repeatedly intercepting pointer events. The 42-case early sidebar/model-picker check had succeeded; this is a separate product failure. The server's 193 tests and related native/interface checks had also passed. No v0.1.21 tag or Release was created.

The reviewer exclusively downloaded the retained artifact to `/tmp/anywork-release-021-browser` and shared its path with the author. Reading its network bodies, DOM snapshots and source independently established this sequence for the same isolated fixture session:

1. History at trace time 373738.408 ms returned old turn-A completion sequence 501 and new turn-B approval sequence 505, request ID 700. The pending-history effect could register B's request notice before global delivery. At 373808–373818 ms the approval existed and no toast was rendered.
2. Global poll at 373841.835 ms returned sequences 493–505, including A's completion before B's replay. The previous `resolveNotices` resolved every outstanding request notice in that session regardless of turn. Existing deduplication then prevented the already-seen B request from recreating its notice.
3. The actual approval remained pending, but the notice-derived flag became false. At 373878 ms the action snapshot contained both the approval and toast; the retained click log confirms persistent interception until the deadline.

This is a source-of-truth/lifecycle mismatch with the existing requirement that pending requests take priority over floating reminders. It is not resolved by dismissing reminders in the workspace test, force-clicking, extending a deadline or classifying the unchanged run as an external transient. Diagnosis did not query real account or business data.

## Exact implementation assessment

- `App` passes `pendingRequests.length > 0` to `NotificationCenter`. It is the same array already used to render `RequestCard`; no pending projection, session-status condition, history/snapshot gate, approval handler or backend behavior changed. Toast suppression therefore survives missing, truncated or incorrectly resolved notice bookkeeping. The previous notice-based suppression remains an additional condition.
- Only the floating-toast render condition changes. The bell, unread badge, notification center, system-notification permission behavior and other-session notification paths remain available and unchanged. The independent rendering test explicitly supplies a false notice-derived pending flag with actual pending state: the unread bell remains while the toast is absent.
- Request notice turn identity comes from the known raw `params.turnId` field and accepts only nonblank strings. Original identifier bytes are preserved; there is no string coercion or whitespace normalization that could manufacture equality. Completion accepts the known nested `params.turn.id` or direct `params.turnId` representation. Simultaneous conflicting values yield unknown identity. Missing, empty, whitespace-only and invalid types cannot resolve a request from completion; numeric and string values cannot become a match.
- Turn completion resolves only requests with the same stable turn identity within the already matched session. Explicit `serverRequest/resolved` retains its typed request-ID comparison; `plugin/exited` retains session-wide resolution. Read/unread updates, deduplication and fixed notification content otherwise remain unchanged. No automatic approval was added.

The regression uses a real isolated fake-agent session with a held global poll. It waits until history renders B's approval, then releases the real batch containing A's completion and B's replay. It checks distinct turn identities/event order, exactly one request notice still unhandled in the center, no floating toasts, an ordinary approval click, card removal, resolved notice and restored completion toasts. The original workspace case is unchanged. No force action, reminder dismissal workaround, timeout change or skip was added.

## Independent verification

The reviewer merged the exact author commit only into its isolated review worktree, then ran:

| Check | Independent result |
| --- | --- |
| Vitest `sessionNotifications.test.ts` and `NotificationCenter.test.tsx` | **6/6 PASS** |
| New deterministic history/global notification race, actual Chrome desktop and Android Web | **2/2 PASS** |
| Original workspace chat/approval/questions/files/terminal/archive case, same two browser projects | **2/2 PASS** |
| Combined targeted browser execution | **4/4 PASS**, no skips, 27.1 seconds |
| `git diff --check`; changed files compared with root `cdb1609` | PASS; no source difference |
| Owned port 3444 after Playwright teardown | Closed |

The unit cases cover old/new turn isolation, missing/invalid/conflicting identities, explicit typed request resolution, plugin exit, and actual-pending suppression independent of a false notice-ledger flag. The ordinary browser click and subsequent authoritative resolution succeeded; no test-side approval bypass was used. Browser evidence is `/tmp/anywork-approval-notifications-independent-022-results`.

Unlike the prior test-only slider correction, this product regression ran against the **new production build containing this fix**, not the old f772 build. Immutable author build: `/var/folders/ll/s836stz50mg85d4h0g4xc8jm0000gn/T/anywork-approval-notifications-022-s46wh84d/web-dist`. The reviewer independently verified its asset identities:

- JavaScript `index-BFdSLnQn.js`: `872d7c09eeb6ff9eeac8b68aec9c3fd2b39b91eba57fa41061d46af0141ad87c`.
- CSS `index-DPJX8MUf.css`: `1bc1aacfb2751e8e5cae9fc33a74f63b2c0ec18a7f651dfd14d21ec9e98b41ac`.

The approved read-only server fixture remained `/Users/water/work/2026/any-work/target/debug/anywork`, SHA-256 `9a48a625e3e5842768560307b520a8a0ed7e878e73e7973dba7b167f4b782942`, an earlier merged debug build, not claimed as an exact v0.1.22 server. Tests used owned temporary workspace/data/plugin directories and a fake agent through the existing isolated launcher. The author separately reports production TypeScript/build PASS, all notification browser cases **8/8 PASS**, original workspace **2/2 PASS**, and formatting; these are attributed author checks rather than a duplicate full reviewer matrix.

Mobile evidence is browser emulation, not a physical-phone claim. No real login, installed Native operation, retained service restart, user business-body read, remote enable, CI mutation or release publication was performed. Local Native v0.1.19 and the explicitly retained older business server remain outside this fix's rollout scope.
