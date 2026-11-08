# Independent review: I02a operation ledger

Review date: 2026-11-08. Exact candidate: `35cbd01002143ef09bac442f6650cfb5e238e7e6` (`codex/improve-message-ledger`). Reviewer is not the implementation author. **Decision: changes required; three blocking contract findings.** This is a Store/schema module review, not acceptance of HTTP/native/Web delivery, complete I02/I03 or a release.

The candidate was clean before review. Product implementation was read without modification. Independent negative/positive tests were temporarily appended to the existing production-Store unit-test module, executed, saved as review evidence and restored byte-for-byte to the candidate before this document was written. The review commit contains only this document. No real native Agent, account, production service, token, release or browser asset was used.

Context: [ledger task](../tasks/improvement-message-ledger.md), [message operation contract](../../message-operations.md), [module contract](../../message-ledger-module.md), [schema safety](../../schema-and-recovery.md). Source links and line references below refer to candidate `35cbd01`.

## Blocking findings

### B1 — Known unhealthy Store still returns authoritative `NeverRecorded`

Location: [lookup_operation](../../../crates/server/src/store/operations.rs#L1126), [record_result](../../../crates/server/src/store/operations.rs#L1744), [missing-ID lookup](../../../crates/server/src/store/operations.rs#L674).

`lookup_operation` checks UUID, identity and current session, then returns `load`. It never checks the process recording fence. After a genuine SQLite result-recording failure, a readable Store therefore still returns the same `NeverRecorded` variant documented as healthy, authoritative absence. This violates the operation contract's recovery prerequisite. A later refusal to dispatch prevents some further effects, but does not make the earlier health/absence claim true.

Independent reproduction `independent_review_empty_lookup_during_recording_failure_is_not_health_proof`:

1. Open a real in-memory production Store; admit and prepare an operation; obtain one dispatch permit.
2. Set `PRAGMA query_only=ON` on that Store connection.
3. Call `record_input_accepted` with its exact matching receipt. It returns `RecordingFailure`; assert the process fence is true.
4. An existing-ID lookup remains `Found`, allowing inspection.
5. Lookup a fresh canonical UUID using the exact saved store/incarnation and same session. Actual result: **`Ok(NeverRecorded)`**. The independent assertion that known-unhealthy absence must not be resubmission-grade fails.

Required correction: preserve inspectable existing/tombstone state, but do not expose healthy authoritative absence while a known Store recording-health fence is active. Check this coherently under the Store lock or return an explicit typed unavailable/fenced absence projection that I02b cannot mistake for `NeverRecorded`. Add regression coverage before and after verified storage recovery, without clearing unrelated input/preparation recovery fences. Do not redefine a read-only SELECT succeeding as recording health, or turn ordinary `Missing`/404 into absence proof.

This finding concerns a known failure state; it does not demand a mutating health probe on every read or claim that all filesystem failures can be discovered by one query.

### B2 — Worker can overtake the FIFO head while that head is in the editor

Location: [queue dispatch checks](../../../crates/server/src/store/operations.rs#L1701), [take_operation_queue_edit](../../../crates/server/src/store/operations.rs#L2264).

Taking a queue row for editing moves it from `message_queue` to `queue_edits` while retaining its original sequence. `begin_operation_dispatch(..., Route::Start, ...)` computes the first sequence from `message_queue` alone. Its `location == queue` guard checks only the operation being dispatched, not an earlier editor-held row. Once the original FIFO head is taken, the next physical row can receive a durable dispatch permit. The module document currently claims the queue-start editor/FIFO guard is enforced.

Independent reproduction `independent_review_fifo_head_held_by_editor_cannot_be_overtaken`:

1. Admit queued head and tail with separate operation IDs; prepare the tail.
2. Take the head into the editor using its exact ID/revision/sequence; assert the editor still holds that sequence.
3. Begin a normal tail `Route::Start` dispatch.
4. Actual result: **`Ok(DispatchPermit { ... })`**, and the tail becomes dispatching while the earlier recoverable head remains editing.

Required correction: automatic worker qualification must account for the recoverable editor's FIFO position in the same transaction. The operation/link/physical-row state must remain unchanged on denial. Test head held, middle held, restored/cancelled/replaced head and restart with editor state; specify whether earlier rows preceding an edited middle remain eligible. Do not “repair” this by deleting the editor or renumbering FIFO identities.

Coordinate the correction with B3: an explicit user selection is a different scheduling authority from automatic FIFO work.

### B3 — The interface cannot preserve explicit manual dispatch from a paused queue

Location: [begin_operation_dispatch](../../../crates/server/src/store/operations.rs#L1641), [unconditional paused check](../../../crates/server/src/store/operations.rs#L1716). Existing behavior: [queue_action](../../../crates/server/src/api.rs#L952), [send_queued](../../../crates/server/src/api.rs#L1043), [deliver actual route](../../../crates/server/src/api.rs#L399), [manual steer button](../../../web/src/components/conversation/MessageQueue.tsx#L145).

The module allows non-FIFO `Route::Steer`, but requires an unpaused queue for every route. Current HTTP/UI allow a user to explicitly select a pending row and send it while automatic queueing is paused. When no native turn is active, that explicit action actually calls `turn/start`; it is still manual selection, not automatic FIFO. Thus actual native route is insufficient to distinguish the two authorities. I02b cannot preserve the existing interaction through this interface without clearing pause, bypassing Store checks or pretending an idle send is a steer.

Evidence:

- The existing integration case `test_queue_fifo_edit_delete_steer_and_stop` passed. It interrupts, observes a paused queue, then explicitly sends its retained row successfully.
- Independent real Rust HTTP case `test_explicit_nonhead_paused_manual_on_idle_uses_start` passed: pause an idle session's local queue; enqueue head plus selected tail; explicitly send the tail. Exactly one fake native **`turn/start`** contains the selected input. Head remains queued and queue remains paused.
- The UI's pending-row steer button does not disable on `paused`; the handler also has no paused denial.
- Independent production-Store negative `independent_review_explicit_manual_steer_retains_paused_queue_choice` selects a prepared non-head row in a paused queue with `Route::Steer` and an expected turn. Actual result: **`IllegalTransition: Local queue is paused`**.

Required correction: represent explicit-user dispatch authority separately from native `Start`/`Steer` routing, using a checked typed entry/argument and the same one-time durable qualification. Automatic worker dispatch must respect pause and FIFO/editor ordering; explicit manual selection must preserve the documented current semantics without implicitly unpausing the rest of the queue. Both still enforce exact identity, revision, current thread, archive/auxiliary, preparation, recording fences and no second permit. Test manual active steer, manual idle start, paused/non-head selection, worker denial and unchanged pause/head state. Do not solve B2 with a blanket denial that erases the manual path.

## Additional source assessment

No additional blocking finding was established in the paths below. These observations are module-level evidence, not a claim that callers or upstream protocols are already integrated.

| Area | Assessment and retained limits |
| --- | --- |
| Schema v2 | One existing ordered opening path; v1→v2 DDL, identity initialization, validation, recovery and version commit share an immediate transaction. Accepted I05a schema identity/owner machinery remains in place. No new global legacy-event decode/repair gate was added. |
| Identity and tombstones | Canonical non-nil UUID pair, exact pair checks, database-global operation registry without session FK, session-owned private content. Existing-ID immutable body comparison precedes new preparation. Session delete/import refresh/recreation retain non-executable used IDs. B1 limits the absence-health claim. |
| Typed state and qualifications | Private, non-cloneable preparation/dispatch/goal permits; repeated claim returns committed state, not another execution permit. Saved states are not writable through a public arbitrary phase setter. Actual adapter execution still has to consume the qualification correctly in I02b. |
| Acceptance proof | The module checks exact saved thread/client/native-request identity plus a nonempty observed item ID. It explicitly excludes bare turn ACK, local echo and text/time inference. `NotAcceptedObservation` and native goal ownership remain adapter assertions whose actual semantics must be independently verified in I02b. A separate typed correlated ACK variant remains a documented integration dependency; callers must not fabricate an item ID. |
| Native preparation gap | Claimed native preparation fences other same-session/thread work; unknown thread widens conservatively. Confirmation/failure/reconciliation use result-recording protection. Recovery reuses claimed→uncertain logic. Independent readonly-fail and session-retarget/alias scenarios below passed. Local snapshot steps do not pretend to be native side effects. |
| Result fences | Commit failure raises process-global fence; persisted result-pending recovers conservatively. Health verification does not erase per-operation recovery. Same-session retarget and old-thread aliases are accounted for by the checked fence query. Existing unlinked HTTP/native entry points do not yet consume this module and must remain explicitly out of scope. |
| Queue transactions and legacy | Admission/link/state, replacement/supersession, queue result/echo are transactional. Original untyped mutation methods reject ledger-linked rows. Legacy adoption is explicit, compares exact row/seq and accepts only known pending; sending/uncertain never gain execution by migration. B2/B3 remain scheduler-interface blockers. |
| Canonical/decode budgets | Intent comparison includes bytes/version/hash with sorted keys and exact string/array semantics; no JCS claim. Only the bounded saved-intent decoder calls `disable_recursion_limit`, after byte and lexical-depth checks. Other deserializers keep their default limit. The depth-128 admitted/reopen boundary has real production Store coverage. Manifest validation does not claim private files were copied/hashed/ACL-checked. |
| Lint staging | No new module/crate-wide `allow(dead_code)`. Exact staged entries/accessors and two concrete protocol types use `cfg_attr(not(test), expect(...))` with I02b consumer/removal reasons. The single `clippy::too_many_arguments` allowance is local to atomic replacement with rationale. No synthetic production usage was added. |

## Verification actually executed

All commands ran in the candidate worktree with private target/data and fake hosts. Baseline unit tests and the real HTTP binary used the exact committed source. Temporary independent tests exercised the actual production Store functions and SQLite, then were restored. `CARGO_INCREMENTAL=0` was used for local Rust commands.

| Check | Actual result |
| --- | --- |
| `cargo test --locked --offline -p anywork` | **172 passed, 5 ignored**. Includes existing schema/owner, ledger, event-scope and crash-parent tests; opt-in native/profile tests were not enabled. |
| `cargo build --locked --offline -p anywork` | Passed; exact candidate binary used for isolated HTTP checks. |
| `ANYWORK_BINARY=... python3 scripts/schema-recovery-test.py` | **3 passed**: actual owner refusal, process crash/restart/no replay, future-version logical/journal refusal and malformed schema lookalikes. |
| `ANYWORK_BINARY=... python3 scripts/event-scope-test.py` | **4 passed**: all/workspace/three-Agent scope, scoped SSE/poll/cursors, hidden/orphan behavior and invalid/auth handling. |
| Four existing queue integration methods | **4 passed**: busy routing, FIFO/edit/delete/manual/stop, recoverable editor sequence, uncertain not resent. These old HTTP paths remain unlinked legacy behavior, not ledger E2E acceptance. |
| Three independent production-Store negatives | **All 3 fail on the candidate**, establishing B1/B2/B3. No assertions were removed, forced or weakened. |
| Independent 8-thread dispatch contention | Passed: exactly one `DispatchPermit`, one committed dispatch-change event and one linked sending row. Admission concurrency alone would not have proved this boundary. |
| Independent readonly preparation-result failure after session retarget | Passed: old-thread alias dispatch refused while native preparation claimed; real query-only failure of `fail_preparation_step` yields `RecordingFailure`; storage verification recovers uncertain; both old alias and new same-session thread dispatch remain fenced. |
| Independent actual `SIGKILL` after durable native preparation claim | Passed: child signals committed claim, parent sends SIGKILL and verifies signal 9; reopen retains identity, converts preparation to uncertain, returns only Existing for the old claim and refuses another input qualification. Child had private HOME/data and no native call. |
| Independent real HTTP paused non-head manual idle send | Passed with exact fake-native input count and preservation of paused head. |

A second independent real-HTTP active-steer scenario successfully posted the explicit paused-row action, but its test then incorrectly waited for idle: the fake Agent continued its current task. That harness expectation failed, so this scenario is **not counted as passed** and is not a product finding. Existing HTTP/manual source evidence and the separately passing idle case establish B3; follow-up should use a fixture response that deliberately ends the turn or assert the active-steer receipt/call without inventing completion.

No new checks were started after root relayed the user's disk-cleanup request. All running builds/fixtures finished; temporary source tests were restored, and root then removed this worktree's reproducible `target`. Review logs and appended test copies remain under `artifacts/ledger-independent-review/` (about 168 KiB at handoff; ignored, local evidence). Relevant logs: `server-test.log`, `server-build.log`, `schema-http.log`, `event-scope-http.log`, `queue-http.log`, `independent-negatives.log`, `independent-safety.log`. Saved test copies retain the exact independent reproductions; they are evidence, not product changes. Root's cleanup record is `artifacts/cleanup-2026-11-08.json` in the main workspace.

Independent Clippy/format execution was not performed before cleanup; the author's reported passes are not relabelled as reviewer results. Review source checks found no blanket waiver. Linux/Windows behavior, network filesystems, physical power loss, actual native ACK/query/echo semantics, private artifact file enforcement, operation HTTP endpoints, Web journals and all-entry-point fence integration remain unverified/open. This review does not run real accounts or reinterpret fake proofs as native acceptance.

## Follow-up gate

Do not merge this candidate as accepted I02a until B1/B2/B3 are corrected in a new exact commit, documented with the actual exported interface, and independently rechecked. Preserve the passing preparation/result/alias/restart protections and acceptance evidence restrictions while fixing the scheduler and absence boundaries. Root should authorize any new build after the cleanup pause; do not regenerate large caches merely to repeat already green checks.

A successful follow-up module review will still leave I02b API/adapter/queue/Web integration and complete I03 open. No capability advertisement, production service change, release or website update is authorized by this module review alone.

## Independent contract clarification follow-up

Exact root contract commit reviewed: `ca0eaaf2783793ca1975203d6051fecf3338a9f2` (`docs: clarify fenced absence and queue dispatch authority`). **Decision: PASS as the design contract for the corrections; no new blocking contract inconsistency found.** This is a read-only comparison of that exact documentation diff with candidate `35cbd01` API/Store/UI source and the independent evidence above. It does not accept corrected product behavior: the original candidate and B1/B2/B3 remain unchanged and blocking until a new exact source commit is independently verified.

| Finding | Independent contract determination |
| --- | --- |
| B1 — fenced absence | The clarification correctly permits inspection of existing operations and retained tombstones while denying authoritative `NeverRecorded` for a missing ID during the known Store recording-health fence. Requiring the absence decision under the same Store lock as result recording closes the demonstrated health/proof gap. Verified storage recovery may restore absence proof for a new ID, but must preserve existing operation/preparation/native-reconciliation fences and cannot make uncertain input executable. This is consistent with the real query-only failure reproduction; a successful read alone is not recovery. |
| B2 — automatic FIFO/editor ordering | Typed automatic qualification must use the earliest recoverable sequence across queue and editor-held state, with an unpaused queue. An edited head therefore blocks later automatic work; an eligible earlier row before an edited middle is still allowed. The physical split in `Store::queue()` and the retained sequence in `queue_begin_edit()` support this distinction. This is the clarified required worker contract, not a claim that the legacy HTTP worker already enforces it. Atomic restore/replace/cancel must preserve identity/revision and cannot silently delete or renumber held work. |
| B3 — explicit selection versus native route | The clarification preserves actual behavior: `queue_action` selects only pending physical queue items, has no paused/FIFO denial for `steer`, and the UI's manual button remains available while paused. `deliver` chooses actual Start when idle and Steer with the exact active turn otherwise; the passing isolated HTTP idle/non-head/paused case independently confirms Start plus unchanged head/pause. Explicit manual authority must consequently support both routes, independently of worker authority. The selected row itself cannot be editor-held. |

Neither origin bypasses exact operation/revision/native binding, scope/archive/auxiliary checks, preparation/storage fences or one-permit qualification. In particular, a worker cannot gain manual authority merely by requesting Steer, and a manual selection cannot turn an unknown active turn into a valid expected-turn binding. The task's requirement to preserve the first failures and re-review the corrected commit is appropriate; it leaves HTTP/native/Web activation and complete I02/I03 outside module acceptance.

No new source tests, builds, native calls or production actions were performed for this follow-up. The active-steer harness limitation recorded above remains unverified rather than being upgraded to a pass by the contract review. The follow-up review commit changes only this review document.

## Independent corrected-source re-review — 8d57934

Exact corrected candidate: `8d579347831ee5c17cf2561e14ef95efd17c9ae9`. **Decision: PASS for the I02a Store module; B1/B2/B3 are closed on this exact candidate.** No new blocking source finding was established. This supersedes the original candidate's module gate, not its historical failure evidence, and does not accept connected HTTP/native/Web delivery or complete I02/I03. The reviewer remains independent of the implementation author.

The candidate was clean at entry. Compared the actual source/module-document changes with the reviewed clarification `ca0eaaf2783793ca1975203d6051fecf3338a9f2`, inspected all six added production-Store regressions and reran the exact baseline. Seven additional independent tests temporarily exercised production Store methods and real SQLite; their copies were saved and the source restored byte-for-byte to the corrected commit before final lint/build/format checks. Only this review document is committed. All outputs/data/ports were private; no native Agent, account, token, production service or shared Web asset was used.

| Original blocker | Corrected source and independent determination |
| --- | --- |
| B1 — unhealthy authoritative absence | [lookup_operation:1149](../../../crates/server/src/store/operations.rs#L1149) holds the Store mutex through identity/session lookup, record loading and the global-fence decision. Only absent IDs are refused as `Fenced`; Found/tombstone remain inspectable. [record_result:1813](../../../crates/server/src/store/operations.rs#L1813) raises the flag before releasing that same lock. The original query-only negative now passes. A further barrier-controlled independent test holds the actual result transaction while a concurrent lookup starts, triggers a genuine read-only SQLite write failure inside it, then proves the waiting lookup returns Fenced and commits no data/event change. Turning query-only off alone does not restore absence. Explicit verified recovery restores new-ID absence while the old dispatch remains RecoveryRequired. The committed regression also proves failed verification, tombstone inspection and retained preparation/input fences. |
| B2 — editor-held FIFO ordering | [dispatch checks:1747](../../../crates/server/src/store/operations.rs#L1747) distinguish authority, require a physical pending row and compute the automatic minimum over both `message_queue` and `queue_edits` in the same transaction. The original held-head negative now passes with no mutation. The committed production tests prove head restore/cancel/new-ID replacement retains seq, eligible earlier work before an edited middle can run, later work cannot overtake it, and disk reopen preserves editor identity with paused recovery. Choosing worker Steer is explicitly invalid before any permit can be issued. |
| B3 — manual selection independent of route | [DispatchAuthority:395](../../../crates/server/src/store/operations.rs#L395) separates Immediate, QueueWorker and ExplicitQueueSelection. Only the worker is subject to automatic FIFO/pause and Start-only rules; explicit selection supports Start or exact-expected-turn Steer while paused/non-head and preserves other rows. Immediate cannot qualify a linked row, queue authorities cannot qualify a direct input, and editor-held selected rows are refused. Both origin types retain the existing revision/current binding/archive/auxiliary/preparation/global/per-binding fence and one-attempt checks before publication. The original paused-manual negative now passes. Eight independent concurrent mixed worker/manual contenders produce exactly one explicit manual permit, no worker permit, and preserve the paused unrelated head through acceptance. |

The new optional saved `dispatch_authority` is not a newly required field for old v2 records and is not guessed on load. Independent fixtures remove it from real accepted, dispatching and uncertain saved operations, close/reopen the production Store, and confirm inspectability, conservative dispatching→uncertain recovery and refusal of a new permit without any queue/ledger/event mutation. Removing the mandatory dispatch-attempt identity as well still returns Corrupt; optional authority does not relax that old invariant. When present, [validation:778](../../../crates/server/src/store/operations.rs#L778) checks attempt/origin consistency and forbids worker Steer. New dispatches persist authority atomically with attempt/status/event changes. Independent WorkBuddy auxiliary denial and injected after-state/before-commit dispatch failures leave ledger, queue/editor, events and pause unchanged, with no persisted authority or permit on rollback.

The enum represents a trusted internal I02b caller's origin; it does not authenticate an HTTP selection, prove native idle/active state or verify an adapter's expected turn. I02b must supply ExplicitQueueSelection only for a real authorized selected-row action and must not relabel worker work. These dependencies are explicit in the module document. No current native/API/Web caller was connected or replaced by this correction, and the original legacy guards remain separate.

### Verification actually executed for the correction

| Check | Independent result |
| --- | --- |
| Exact-source `CARGO_INCREMENTAL=0 cargo test --locked --offline -p anywork` | **178 passed, 5 ignored**; includes all 34 active ledger tests. Native/profile opt-ins remained ignored; the crash-child entry is exercised by its parent tests. |
| Original three independent negative reproductions, adapted only for the new authority argument | **3 passed**: fenced absence, held-head worker denial and paused manual Steer. Earlier failing evidence above is retained. |
| Four additional independent production-Store tests | **4 passed**: concurrent real SQLite result failure/absence locking; 8-thread mixed-origin one-permit contention; old-v2 missing-authority reopen plus malformed required-attempt refusal; WorkBuddy auxiliary and dispatch-fault rollback. Final focused command ran exactly these seven independent tests, all passing. |
| Real Rust schema-recovery HTTP | **3 passed** with private fake processes/data. |
| Real Rust I01 event-scope HTTP | **4 passed**. |
| Four selected legacy queue HTTP integration cases | **4 passed**, preserving existing busy routing, FIFO/edit/steer/stop, edit position and unknown-not-resent behavior. These exercise legacy HTTP, not a new ledger protocol. |
| Restored exact-source Clippy, build and formatting | `cargo clippy --locked --offline -p anywork --all-targets -- -D warnings`, `cargo build --locked --offline -p anywork`, `cargo fmt --all -- --check` and `git diff --check` passed. The reused HTTP binary was up to date with the restored exact source. |

Local ignored evidence is in `artifacts/ledger-independent-followup/`: `server-tests.log`, `schema-http.log`, `event-http.log`, `queue-http.log`, `independent-tests-final.log`, `independent-added-tests.rs`, `candidate-tests-original.rs`, `clippy.log`, `build.log` and `fmt.log`. These are local evidence, not portable native acceptance. Two reviewer-fixture mistakes preceded the final seven-test pass: an invalid Topology variant name prevented compilation, and enabling SQLite query-only before BEGIN IMMEDIATE prevented the intended barrier closure from running. The latter was corrected to enable query-only inside the held production result transaction before its real write failure. Neither was counted as a product failure or a successful check; the intermediate runtime failure log is retained as `independent-tests.log`.

### Remaining gate

Root still owns merge and merged regressions. The original unverified platform/storage/native-proof boundaries remain open. This review adds no actual native call-count evidence: Store permits are local qualifications, and the passing HTTP cases remain legacy compatibility evidence. The earlier active-steer HTTP harness failure is not upgraded to a native pass. I02b must still connect authoritative operation IDs, artifact/preparation proof, actual dispatch origin, typed native acceptance/unknown outcomes, all entry-point fences, goal phases and Web journals. SDK/lifecycle and complete I03 health/control integrations retain their separate acceptance gates. Module PASS grants no capability advertisement, production restart, release or website update.
