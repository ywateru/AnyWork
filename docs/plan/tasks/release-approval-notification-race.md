---
id: release-approval-notification-race
scope: pending-request-notifications
status: done
depends-on: [release-slider-touch-synchronization]
---

## objective and evidence

Fix the real notification lifecycle race exposed by exact-source v0.1.21 Checks `42859028675`, source `b050beae4f353d727be15ffd7376f1216b322fbf`. Full browser results were 646 passed, one existing skip and one failed desktop workspace approval interaction; other platform checks passed. No v0.1.21 tag was created.

Independent trace review shows history exposing a newer turn-B approval first, then a delayed global batch containing an older turn-A completion followed by the already-seen new request. Unscoped completion marks every request notice in that session resolved, and deduplication prevents the new request notice from being recreated. The actual approval remains pending, but notification-derived suppression becomes false and a toast persistently intercepts its button. This violates the existing [notification contract](../../image-editor-notifications-goal-capabilities.md), not an external transient or a justification for force-clicking/dismissing the fixture.

## implementation boundary

The UI author owns the minimal notification hook, NotificationCenter/App pending-state wiring and deterministic notification regression, plus the author report. The actual current-session pending request state suppresses floating toasts independently of notification bookkeeping. Completion-based notice resolution must match stable turn identity; missing identity cannot resolve unrelated/newer requests. Preserve explicit request resolution/plugin-exit handling, read/unread behavior, deduplication, other-session notifications, badge/center availability, privacy and notification opt-in. Do not change approvals, backend behavior, authentication, test deadlines or skips. Do not add automatic approval or native user-data access.

## verification and delivery

Use isolated synthetic sessions to deterministically deliver newer pending history before an older completion/global batch, retain the newer pending notice, suppress overlap and permit an ordinary real approval click; authoritative resolution must clear the card and permit subsequent notifications. Retain existing notification and workspace tests and run appropriate Web build/type/unit checks. Independent review accepts the exact committed fix and targeted actual browser evidence before root merges for a new v0.1.22 publisher operation. Full exact-source Checks and all release platforms remain required; no prior failure is retried as an external transient. Local Native and the retained production service remain untouched.

## delivery

Fix `a81cc53` is merged as `cdb1609`. Independent verification accepted the exact source with six unit tests and four actual Chrome runs on the new production Web across desktop and mobile, covering the deterministic interleaving and original workspace approval flow. The author additionally passed all eight notification cases and both original workspace cases. No approval policy, backend, authentication, timeout or skip changes were introduced. Root is preparing v0.1.22 with the accepted code and review; full exact-source CI, release matrix and website verification remain publication gates.
