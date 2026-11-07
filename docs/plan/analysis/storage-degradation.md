# G1 / I03: storage degradation and recovery boundaries

Analysis baseline: `aacaa19` (2026-11-07). Status: **independently reviewed design input**, not an implemented storage-health protocol or approved implementation contract. [Review `9040174`](../reviews/improvement-storage-analysis.md) passed without blockers; its three nonblocking clarifications are incorporated below. The [project review](../../project-improvement-review.md), [message-operation contract](../../message-operations.md) and [schema contract](../../schema-and-recovery.md) remain authoritative for their respective scopes. I02a is still developing; concrete ledger methods must be rechecked against its independently accepted source before integration.

## Current creation and call paths

| Path at the baseline | Current behavior | Consequence to address |
| --- | --- | --- |
| `runtime::App::emit` → composer metadata → `Store::event` → `changed` | Event failure is logged; the method returns `()` | A caller cannot know whether an event was durably published; metadata failure can lose the visible composer representation |
| `App::ensure_runtime` → spawned native-event loop → `emit` → status update | Status writes are often ignored with `let _`; consumption continues | Stored events and session status can diverge; a missed completion cannot be called idle based on the previous cache |
| Same event loop → `Store::request` → auto approval → `rpc.send` → resolution event | A failed request read skips the response; successful send can be followed by a failed resolution write | Missing local resolution must not authorize repeated automatic approval; request/turn/occurrence and connection generation matter |
| `api::respond` → scoped request lookup → `rpc.send` → resolution event/status | Non-desktop response is written to native before local resolution; `emit` failure is not propagated | A generic error or missing resolution cannot prove the response was rejected by native |
| `api::message` / queue worker → preparation/input → echo/status/goal | Multiple local writes and native effects exist | I02 owns their durable intent/preparation/dispatch/acceptance safety, rather than a second I03 message journal |
| `api::interrupt` → fallible `Store::pause_queue` → runtime/owner/turn checks → native interrupt | A queue-pause storage failure currently exits before native interruption | The proposed safety-action behavior requires a deliberate integration change, not simply ignoring the queue error |
| Per-session `api::events` → `Store::events` | Storage read failure closes the stream | Reconnection alone cannot explain whether native events were missed or storage remains unavailable |
| Public `/api/health` | Fixed `status=ok` and package version | Liveness is not authenticated readiness, durable recording health or native synchronization |
| Desktop/Web transport and cached histories | Existing cached content can remain visible | A last known completion, approval or running label is not fresh evidence during a recording gap |

Native events can still arrive during a disk failure. Closing their transports to reduce local pressure can interrupt collaboration or lose the only available observation; it does not undo already accepted work. Conversely, retaining an unbounded in-memory event backlog is not a recovery strategy. I06 budgets and I07 connection generations must be coordinated with I03, without making either a prerequisite for a claim that writes succeeded. Accepted I07a supplies neither trustworthy native generations nor authoritative pending-occurrence observations; the [native-observations follow-up](../tasks/improvement-capability-observations.md) must define that interface before I03 consumes it.

## Authority and desired state

I03 owns **recording health and reconciliation completeness**. Native remains execution authority; I02 owns message-operation identity and dispatch fences; I05 owns schema opening, ownership and supported restoration. I03 must consume those states rather than override accepted/unknown outcomes or create new input IDs.

Treat these as separate facts:

1. Can the process answer requests?
2. Can scoped stored data be read?
3. Can required local transactions commit?
4. Is the native identity/generation currently valid?
5. Have affected native events/status/requests been reconciled since the recording gap?

Recovery of item 3 does not prove item 5. A successful test write cannot clear an unresolved result fence or turn a lost approval receipt into a safe resend. Native reconnection also cannot prove local storage durability.

Proposed recording-state model, subject to independent contract review:

```text
unverified recording at startup
      │ checked opening/recording recovery complete
      ▼
healthy ── failed required read/write ──► degraded
  ▲                                       │
  │ required reconciliation succeeds     │ bounded explicit/controlled retry
  └────────────────── recovering ◄────────┘
```

The diagram describes recording health only. Even a healthy recording state leaves native reconciliation freshness unknown until independently established; it does not clear an I02 result fence. Health is scoped conservatively. When the storage error is shared or its scope is unknown, degrade the entire store. A narrower per-session reconciliation gap may be represented only when shared storage health is independently known; it must bind the native thread and current connection generation, not merely a browser selection. Missing/failed checks are unknown, never healthy. Preserve I02's persisted pre-dispatch uncertainty and its in-memory shared-fault fence even if writing an I03 incident record also fails.

## Minimal safe behavior by operation

| Operation | Required behavior during a recording gap |
| --- | --- |
| New message, steer, queue dispatch, preparation with native side effects | Use I02's write-ahead and result fences. No native input after a failed required pre-input commit; no fresh-ID repair of ambiguous input |
| Automatic approval or question response | Do not answer from an unrecorded/unreadable occurrence. Repeated notifications are observations, not a second response authorization. A post-send recording failure remains response-unknown until exact native occurrence reconciliation |
| Manual approval/question response | A current verified native occurrence is still required. Persist a response claim before native effect; on ambiguous send/result, expose unknown and query the same occurrence. Do not claim these requests are protected by the message ledger without their own accepted integration |
| Interrupt/cancel | Do not silently block an explicitly requested safety action solely because recording is degraded. Before native interruption, fence local queue dispatch in process memory even if durable queue pause fails; do not permit a concurrent worker to dispatch another input. Preserve actual adapter/owner/turn guards and external teardown waits, and report native outcome separately from failed local recording. Never claim durable cancellation from a button click or successful transport write alone |
| Native completion/status | Continue bounded transport consumption without fabricating durable cache success. Invalidate freshness when persistence fails; use later native identity-bound snapshots/history for recovery |
| Read cached history/export | Return actual read errors or explicitly labelled last-known data. Do not substitute empty success or advance durable event cursors for uncommitted events |
| Local queue edits/deletion/config changes | Require their actual commit. Preserve drafts and uncertain rows; do not show success when only a UI mutation occurred |
| Goal/settings/history editing | Preserve native-owner/CAS limitations and typed dispatch uncertainty. Do not use a generic storage retry to repeat any native mutation |

The response-claim requirement is a **proposed separate control-operation boundary**. Its storage shape and exact proof rules need review after I02a; it is not permission to reuse input receipts, accept arbitrary native JSON proofs or build a generic command framework. User-declined/expired/resolved approvals must be distinguished from a newly issued occurrence with the same native request ID.

## Observability without false persistence

Provide authenticated recording/readiness diagnostics that remain answerable from bounded process memory when SQLite is unavailable. They should expose safe stable reason codes, affected scope, incident/generation identifier, first/last failure times and reconciliation state, without SQL statements, credentials, user text or file paths. Public liveness retains its limited meaning and discloses no private incidents.

A memory-only incident is explicitly volatile; it is not a durable event. Do not put it into the normal persisted sequence with a fabricated ID or let clients advance their event cursor past data not committed. A separate transient notification/checkpoint may prompt an authenticated readiness refresh, but event transport failure also requires a bounded independent diagnostic refresh path. Include this health projection in desktop status and Web without discarding existing drafts or creating repeated modal dialogs.

Memory and diagnostics need concrete budgets at implementation: a coalesced store-level fault plus bounded current per-session reconciliation entries, no retained conversation payload backlog, no unique incident per repeated failed frame, bounded log rate and bounded retry/backoff. Do not add successful fake Store writes solely for diagnostics if a real domain transaction/probe is required. The recovery probe must be private and cannot alter user records or be inferred from a SQLite `SELECT 1`.

## Recovery and restart

1. Keep unresolved input/preparation/goal outcomes from I02 authoritative. Record storage recovery only after an actual checked transaction succeeds; retain result/observation fences until their own reconciliation passes.
2. Invalidate stale native observations by identity/generation before accepting a recovery snapshot. Reconcile history, active turn, pending requests and relevant settings/goal independently; partial source coverage remains explicitly incomplete.
3. Deduplicate by existing native/source identities and revisions. Do not match body text/time, emit synthetic completion from idle, repeat approval responses or replay task input.
4. If the native host cannot provide trustworthy missing history/occurrence proof, keep the affected outcome unknown and offer inspection/export guidance. Local silence is not proof of rejection.
5. On process restart, a lost in-memory incident must not cause old cached statuses or requests to count as fresh. Opening/recovery checks and new native observations are required; no claim that historical gaps are detectable if the failed event never left a durable or native source trace.
6. Do not kill an independent Agent or start another engine to obtain a clean state. Supported backup/restore and incarnation rotation stay in I05; an arbitrary manual database rollback is outside the guarantee.

## Proposed delivery split

| Module | Inputs / outputs | Dependencies and acceptance boundary |
| --- | --- | --- |
| I03a recording-health primitive | Checked Store/runtime results → bounded typed fault state; safe authenticated diagnostics | Consume accepted I02 fence interface; no UI/native-resend policy. Unit and real HTTP storage-fault tests |
| I03b native event and response integration | Generation-bound events/requests → checked persistence, invalidation, safe response claim/unknown state | I07 trusted observations and separately reviewed response control contract. Real fake-native call-count/fault/crash tests |
| I03c recovery and clients | Authenticated health + native reconciliation → Web/desktop state and explicit recovery | Main/child/queue/client consumers; browser disconnection/late result/draft tests. No native capability acceptance inferred |

Before development, split actual files and call chains into non-overlapping tasks; no partial module may claim complete I03. Important acceptance negatives include `SQLITE_FULL`, read-only/lock timeout, commit failure before/after native effects, failed attempt to record the incident, restart without volatile state, unavailable diagnostics transport, stale old-generation events, repeated native request IDs, disk recovery without native reconciliation, cache read success during write failure and valid native snapshot with unavailable Store.

## Review decisions still required

- Which supported native APIs provide authoritative pending-response and completion/history proof per topology, and which must remain unknown?
- What exact interrupt-result evidence is available without treating a socket write as cancellation acceptance?
- Can response claims be added to the accepted operation infrastructure without weakening input proof types or requiring a generic command ledger?
- Which health state is store-global versus per-thread, and how is a memory-bound overflow conservatively represented?
- What concrete recovery cadence, diagnostic payload/retention limit and user-visible wording avoid both silent failure and repeated disruption?

These are design inputs, not invented SLOs, completed native tests or user/product approval. Current support stays in the support matrix; current source and tests remain in the continuing progress tracker.
