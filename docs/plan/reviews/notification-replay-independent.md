# Notification replay setup: independent review

Result: **accepted, no blocking finding** for exact commit `a3ff87cb555f261b22735f4ec3c539725f772e45`, based on `f3ac0db041ffdaaeeca8397bb08b9c154c8cd468`. The change repairs synchronization in the existing regression setup. It preserves the notification regression and does not establish that full exact-source CI has passed.

## Failure evidence and bounded change

Independently inspected the retained network records in both original CI traces from [Checks 43551761469, server-web job 132315597251](https://github.com/ywateru/AnyWork/actions/runs/43551761469/job/132315597251), as well as the author's header-free timeline. Desktop history returned through sequence 177 without the final answer/completion, while the held poll subsequently contained both through 181. Android history returned through 952 without request 700, while the held poll contained it through 954. Both failures preceded the intended replay assertion.

The source explains that ordering: the fake agent acknowledges `turn/start` before emitting its later output, and App refreshes history after the message POST. The test intentionally holds the global event stream, so an early history response can leave its setup waiting for events it has itself withheld. Merely extending the UI wait does not synchronize that response.

The exact diff changes only `e2e/notifications.spec.ts` and the author report. The selected synthetic session's history route repeatedly reads the real endpoint until it contains the initial completion and then request 700, fulfilling the browser request with the original response. Responses are disposed, and the gate is disabled before replay and later approval resolution. The route does not fabricate bodies or notifications, inject pending state, release the global stream early, change product behavior, add sleeps, extend timeouts, skip cases or force approval clicks.

All existing assertions remain. History first restores the new pending approval; replay then delivers a different older turn's completion before the same pending request. The center must retain exactly one unresolved request notice, floating toasts must not overlap, and the actual approval button remains usable. An ordinary click must clear the card, allow the completion toast and mark the notice handled. The new `expect(replayed).toBe(false)` additionally confirms that the setup completed before releasing the old batch.

## Independent browser verification

Verified the private server binary's SHA-256 independently:

`4a3f725939bae2bed338ade1e83e59306d3a2602232a157d49e05ef8a38dfe7a`

It was built from exact base `f3ac0db`; the worktree's production Web output is from the same unchanged product source. Reused these fixed outputs without rebuilding or depending on the shared target's mutable binary. The reviewed commit changes no Rust or product Web file.

From the frozen author's worktree, ran the original case independently on port 3288 with a separate evidence directory:

```sh
PLAYWRIGHT_CHANNEL=chrome ANYWORK_E2E_PORT=3288 \
ANYWORK_E2E_BINARY=<main-workspace>/artifacts/notification-replay-check/anywork-f3ac0db \
ANYWORK_E2E_OUTPUT_DIR=<main-workspace>/artifacts/notification-replay-check/independent \
node_modules/.bin/playwright test e2e/notifications.spec.ts \
  -g 'pending history survives' --project=desktop --project=android-web \
  --repeat-each=3 --workers=1 --trace=on
```

Result: **6 passed in 20.9 seconds**, three desktop and three Android Web emulations. All original notification, turn-order and normal-click assertions executed. Independently parsed all six successful traces: each contained the pending request in the selected session's real history and a replay batch with an older, different turn's completion before that request. Focused Prettier and `git diff --check` passed; the checkout remained at the reviewed exact commit throughout testing.

Logs, six traces and a summary without credentials/session IDs are ignored under `artifacts/notification-replay-check/independent*` in the main workspace. The existing full e2e command in `scripts/check.sh` continues to select this same spec for both projects; coverage is not restricted to the local repeated command.

## Delivery boundary

The local run used installed Chrome because the matching bundled headless shell is absent. Android here means Playwright's Android Web project, not a native APK or physical phone. No real account, original session, device, native application, remote write or release action was used. No broad suite was rerun by this review. Accept the bounded test repair for merging and a new exact-source Checks run; retain the original v37 failure evidence and require the complete CI/release gates before publication.
