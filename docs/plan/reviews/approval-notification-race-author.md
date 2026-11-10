# Approval notification race — author evidence

Date: 2026-11-11. Task: [release approval notification race](../tasks/release-approval-notification-race.md). Scope: notification identity/lifecycle, current pending-request wiring and related tests. Approvals, backend behavior, authentication, timeouts and skips are unchanged.

## Diagnosis

Exact v0.1.21 Checks [run 42859028675](https://github.com/ywateru/AnyWork/actions/runs/42859028675), source `b050beae4f353d727be15ffd7376f1216b322fbf`, had 646 browser passes, one existing skip and a failed desktop workspace approval click. Retained trace: `/tmp/anywork-release-021-browser/workspace-authentication-c-b9289--files-terminal-and-archive-desktop/trace.zip`.

The request was actually visible and enabled. A floating notification persistently intercepted its ordinary click. Trace and source together identify a product lifecycle race:

1. At approximately 373738 ms, history returned the older turn-A completion (sequence 501), then a newer turn-B approval (505). The current pending-history effect registered the newer request notice before the global stream delivered those events.
2. At 373818 ms, the approval was present and toasts were suppressed. A global poll at 373841 ms then delivered sequences 493–505, including old completion A followed by the already-seen request B.
3. Completion resolution previously marked every outstanding request in that session resolved, without checking turn identity. It therefore incorrectly marked B handled. Replayed B was ignored by existing deduplication.
4. The notification-derived pending flag became false while the actual request remained pending. At 373878 ms, both approval and toast were present, and the toast continued intercepting clicks until the deadline.

This violates the existing pending-request notification contract. It is not a reason to dismiss reminders in the test, force clicks, increase timeouts or retry an unchanged candidate as an infrastructure transient.

## Change

- `App` passes the same `pendingRequests` condition used to render `RequestCard` to `NotificationCenter`. Actual pending requests suppress floating toasts independently of notification bookkeeping. The notification bell and center remain available; the existing notice-based suppression is retained as well.
- Request notices retain a stable string `turnId`. Completion-based resolution requires that same stable identity. Empty, whitespace-only, incorrectly typed or conflicting completion identities cannot resolve a request. Nested completion `turn.id` and the existing direct `turnId` representation are supported; conflicting simultaneous values are treated as unknown. Request identity comes from the request's `turnId`.
- Explicit typed request-ID resolution and plugin exit retain their existing behavior. Read/unread, request deduplication, other-session isolation, permission opt-in and notification content remain intact. No approval is accepted automatically.

## Verification

- Production Web build, including TypeScript `--noEmit`: **PASS**. Inherited `VITE_`, `ANYWORK_` and `WORKBUDDY_` build overrides were omitted. Existing Vite large-chunk advisory remains unchanged.
- Targeted unit suites: **6/6 PASS**. They cover old/new turn isolation, unknown/invalid/conflicting identity, explicit numeric/string request resolution and plugin exit. A rendering boundary test supplies `hasCurrentRequest=false` with actual pending state and confirms toasts are absent while the bell/unread badge remain available.
- Notification browser suite, actual Chrome desktop and Android browser: **8/8 PASS**. The new deterministic test holds global event delivery, submits real isolated messages so history exposes B's pending approval first, then releases the real batch containing A's completion and B's replay. It asserts different turn identities and event order, one still-pending notice in the center, absent toasts, an ordinary successful approval click, card removal, resolved notice and restored completion toasts. Existing foreground/background, cross-client response and permission tests pass.
- Original workspace authentication/chat/approval/questions/files/terminal/archive case on both browser projects: **2/2 PASS**, with its original interactions and deadlines.
- Prettier for touched source/tests and `git diff --check`: **PASS**.

The tests used only owned temporary workspace/data/plugin directories on isolated port 3443. Production Web was freshly built from the changed author source; the old f772 build was not used for this product regression. Immutable copy: `/var/folders/ll/s836stz50mg85d4h0g4xc8jm0000gn/T/anywork-approval-notifications-022-s46wh84d/web-dist`.

Production asset identities:

- `index-BFdSLnQn.js`: SHA-256 `872d7c09eeb6ff9eeac8b68aec9c3fd2b39b91eba57fa41061d46af0141ad87c`.
- `index-DPJX8MUf.css`: SHA-256 `1bc1aacfb2751e8e5cae9fc33a74f63b2c0ec18a7f651dfd14d21ec9e98b41ac`.

The approved read-only server fixture was `/Users/water/work/2026/any-work/target/debug/anywork`, SHA-256 `9a48a625e3e5842768560307b520a8a0ed7e878e73e7973dba7b167f4b782942`. This is an earlier merged debug build, not claimed to be the exact new release server. Relative to frozen v0.1.21, the author tree's Web differs only by this fix and older package-version metadata; fake-agent, launcher and local browser fixture source match. Full exact-source release CI remains the final platform gate after review and root integration.

Logs: `/tmp/anywork-approval-notifications-022.log` and `/tmp/anywork-approval-workspace-022.log`. Browser evidence directories: `/tmp/anywork-approval-notifications-022-results` and `/tmp/anywork-approval-workspace-022-results`. One initial workspace command used an over-anchored grep, selected zero tests and was corrected before the recorded two-case run; no assertion or timeout was changed.

No real account, installed application, live service, user data, remote access or release artifact was changed. Root owns integration and the fresh v0.1.22 release candidate.
