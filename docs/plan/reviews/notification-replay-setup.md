# Notification replay setup synchronization

Author verification, 2026-11-14. Independent review pending.

Base: `f3ac0db041ffdaaeeca8397bb08b9c154c8cd468`, version `0.1.37`.
CI Checks `43551761469`, server-web job `132315597251`, failed the same
notification replay case in desktop and android-web. This is a test setup
race, before the intended notification interleaving is exercised.

## Trace evidence

Downloaded the run's `browser-failure-evidence` with `gh run download`.
The original traces and a header-free HTTP summary are retained in the main
workspace's `artifacts/notification-replay-check/ci-trace/` and
`artifacts/notification-replay-check/ci-timeline.json` respectively.

- Desktop: hello POST began at `03:40:29.324Z`; the immediate history read at
  `03:40:29.343Z` returned `latest_seq: 177`, containing the user message,
  turn start and user item, without the final answer or completion. The held
  poll fetched during failure cleanup contained the answer and completion
  through cursor 181. The test failed waiting for the answer at original
  line 121, before it could send the approval turn.
- Android: hello history was complete. Approval POST began at
  `03:47:33.991Z`; history at `03:47:34.048Z` returned `latest_seq: 952`
  with the new turn start but no request 700. The held batch contained that
  request through cursor 954. The test failed waiting for its approval button
  at original line 126, before releasing the poll.

`fake-agent.py` acknowledges `turn/start` before emitting its items, completion
or approval. App immediately refreshes history after the message POST. Holding
global polling removes delivery of later events, so this early snapshot cannot
satisfy the setup's UI assertions. The trace establishes this cause for both
failures; extending the UI timeout would not synchronize that snapshot.

## Change and validation

Only the replay test setup changes. A route for the exact selected session's
history repeatedly reads the real endpoint until it contains the first turn's
completion, then until it contains the second turn's request 700. It fulfills
the browser history read with that original response and disposes responses.
The gate is removed for subsequent reads before releasing global polling.
No body, pending request, notification, native output or product behavior is
fabricated. No timeout, retry configuration, skip or force-click is added.

All existing assertions remain: history restores the pending request first;
the later replay contains a different older turn's completion before the same
request; the center keeps the pending notice unresolved; toasts do not overlap;
a normal approval click resolves the card and notice and allows the completion
toast. An additional assertion confirms replay has not happened before release.

Built the exact base server with `cargo build --locked -p anywork` using the
shared target, then immediately copied it to the private evidence directory.
Binary `anywork-f3ac0db` SHA-256:
`4a3f725939bae2bed338ade1e83e59306d3a2602232a157d49e05ef8a38dfe7a`.
The Web build from this same worktree passed. No Rust or product Web file changed.

The original case passed desktop and android-web five times each: **10/10**, in
35.7 seconds. Command from this worktree, with the evidence path abbreviated:

```sh
PLAYWRIGHT_CHANNEL=chrome ANYWORK_E2E_PORT=3287 \
ANYWORK_E2E_BINARY=<main-workspace>/artifacts/notification-replay-check/anywork-f3ac0db \
ANYWORK_E2E_OUTPUT_DIR=<main-workspace>/artifacts/notification-replay-check/targeted-chrome \
node_modules/.bin/playwright test e2e/notifications.spec.ts \
  -g 'pending history survives' --project=desktop --project=android-web \
  --repeat-each=5 --workers=1 --trace=on
```

The local cached Playwright headless shell was absent, so validation used the
installed Chrome channel; the initial default-browser attempt could not launch
and did not execute the case. Ten successful traces and their HTTP summaries
are retained under `targeted-chrome/` and `targeted-evidence.json`. Focused
Prettier and `git diff --check` passed. No full browser suite or actual account
was used; exact-source CI and independent review remain delivery gates.
