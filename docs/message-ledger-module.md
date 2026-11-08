# Internal operation ledger (I02a)

Status: corrected source `8d579347831ee5c17cf2561e14ef95efd17c9ae9` passed [independent module re-review](plan/reviews/improvement-message-ledger.md) at `c3117a8`, is merged at `a26d6f4` and passed [full merged local regressions](plan/reviews/improvement-message-ledger-merged.md). This module does not activate HTTP IDs, a Web journal, native deduplication, or the I02b dispatch integration. Existing native capabilities and experimental labels are unchanged. New v2 platform CI, actual native proof and complete I02/I03 acceptance remain open.

The only opening path is `Store::open` → `schema::open`. Version 2 adds five tables using the ordered migration registry; migration, random identity creation, validation, recovery and version change share one immediate transaction. Schema SQL and parsed metadata are checked against the version-specific reference. Existing eight tables, replay keys and AUTOINCREMENT high-water values are not rebuilt. Future versions are refused before application mutation. No new global event decoding or foreign-key-repair gate exists.

## Persistent representation

The exact DDL lives in `store/operations.rs::DDL` and is used by the real migration and reference validation:

- `message_ledger_identity`: singleton primary key constrained to 1; random canonical `store_id` and `ledger_incarnation`, identity format 1, creation time. A version-2 store missing/malformed identity is refused, never repaired. Ordinary restart retains both UUIDs. Supported restore/rotation remains a later deliverable.
- `message_operation_ids`: permanent operation UUID primary key, owning session ID and creation time, composite unique `(operation_id,session_id)`. **No session FK**. Registry-only rows are non-executable tombstones. Neither session deletion nor imported-catalog deletion makes a used ID admissible again. There is no registry deletion API.
- `message_operations`: primary key, session FK CASCADE, composite registry FK, indexed Agent/effective-thread binding; input/preparation/goal/recording phases and revision are constrained relational columns. `data` is a bounded, versioned Rust typed payload containing immutable canonical intent, exact native/client identities, saved route/turn, prepared manifest, typed receipts, stable error and timestamps. It cannot be supplied or replaced through a public arbitrary-JSON/phase setter.
- `message_operation_preparation`: operation FK CASCADE, `(operation_id,ordinal)` primary key, unique stable claim UUID, checked kind/phase and typed specification/receipt. A claim is committed before a new non-cloneable execution qualification is returned. Duplicate calls only report existing state. Unknown outcomes never receive another qualification. Same-binding native preparation is serialized across operations; an unknown thread widens that check conservatively. Upload qualification requires a confirmed frozen snapshot step for its attachment index.
- `message_operation_queue`: stable FIFO seq primary key, unique operation ID, session/operation composite FK CASCADE, checked physical location. It follows moves between existing `message_queue` and `queue_edits`; checked methods and opening validation require exactly the corresponding physical row. No FK to one physical queue table can model that move correctly.

Private operation content can cascade with sessions; the permanent opaque used-ID registry remains. Tombstones do not keep request hashes or native receipts. Manual copying/rollback retaining identity is outside the protocol and cannot be detected by this ledger alone. Retention, artifact GC and backup are not implemented.

## Canonical intent v1

The typed intent contains exact text, ordered submitted attachment references, optional rich document/Markdown, goal, explicit auto/start/steer/queue mode and queue-if-busy. Defaults: absent attachments `[]`, booleans false, composer null, mode auto (explicit null is also auto). References are not resolved/read during admission or duplicate lookup. Strings, Unicode, quoted contents and array order are not rewritten. Object keys sort recursively; numeric tokens use versioned parsed `serde_json::Number` serialization, **not RFC8785/JCS or mathematical equality** (`1` and `1.0` may differ). Compare canonical bytes as well as SHA-256/version. Maximum canonical length 22 MiB in UTF-8 bytes, maximum JSON value depth 128 (root value depth zero, including the Intent/composer/document wrappers). A server-local dependency feature enables only the ledger decoder to disable serde_json's lower default parser ceiling **after** a byte-budget and lexical-container scan bounds its input; other HTTP/application deserializers keep their normal recursion guard. Quoted braces/brackets and escaped strings do not increment lexical depth. The accepted empty-container boundary can contain 129 containers including the depth-zero root; recursion is never arbitrary. Journal integration must reuse the immutable original envelope, not regenerate it from a current editor. Nonfinite/unknown variants and malformed required data are errors.

Prepared manifests allow at most 16 attachments, each 20 MiB, total 64 MiB with checked arithmetic; SHA-256 is lowercase 64-hex, operation-relative artifact paths have no traversal/absolute components. Store only validates the manifest. Actual file authorization, private ACLs, copying, fsync, hashing, native uploads and later byte verification belong to I02b; accepting metadata proves none of those actions happened.

## Checked method contract

All ledger writes use the Store connection lock and one immediate transaction; expected identity and session/Agent/thread bindings are rechecked within the transaction. API callers must first authorize with `app.session`; Store cannot implement HTTP scope/token policy. Single-operation queries require the owning session, and listing is per-session and bounded. An unavailable read is an error, never `NeverRecorded`. The missing-ID decision and process-global recording-fence check hold the same Store connection mutex as result recording. A known-fenced missing ID returns `Fenced`, even when SELECT succeeds; lookup does not probe storage health or clear a fence. Existing records and registry-only tombstones remain inspectable. A healthy missing ID is only authoritative for the exact store/incarnation pair; cross-session IDs never expose content.

The concrete exported methods are recorded alongside their Rust signatures. The interface families are:

- identity / admit / lookup / bounded session list; existing immutable intent returns state before route/preparation work, changed intent conflicts;
- one-time route selection; typed preparation claim/confirm/fail/uncertain/finalize; a confirmed result can be reused, not replayed;
- dispatch claim (non-cloneable qualification), typed accepted/rejected/uncertain result and exact-identity reconciliation;
- separate goal claim and accepted/rejected/uncertain result; accepted input is never resent to repair a goal;
- atomic queue admission, legacy-pending adoption, take/restore/replace/cancel, queue dispatch/result and uncertain display detachment. Changed content uses a new client-persisted operation UUID and expected old identity/revision; FIFO seq survives editing. Old untyped queue methods reject ledger-linked rows.

Prepared thread binding may change only through its recorded thread preparation claim and receipt with a session thread CAS; no free retarget setter exists. Native evidence is adapter-supplied typed data, not an independently verified native fact merely because Store accepts it. Correlation UUIDs never imply native idempotency.

`recorded` cannot dispatch until preparation is confirmed and an explicit caller claims it. `queued` uses its existing operation. A successful dispatch claim persists `dispatching`, one attempt UUID and `result_pending` before returning qualification. Acceptance plus local echo/operation event and queue completion is one commit. Owned local echoes are constructed from saved intent and carry the stable client identity; native-echo merging remains I02b.

After a result commit failure, the module caller gets a typed recording error and the Store conservatively raises a process-local global dispatch fence. Persisted `result_pending` survives. Startup changes input dispatching to uncertain, in-flight preparation/goal to uncertain and result-pending to recovery-required, retaining all receipts and identities; queues stay paused. Accepted never becomes executable, recorded never automatically continues. A binding with recovery-required blocks another dispatch, including aliases; unknown identity widens the fence conservatively. No arbitrary force-clear/retry API exists. Successful exact-identity reconciliation clears only that operation's persisted recovery condition; global fence recovery requires a verified transactional/readback health check and does not clear unresolved binding fences. This is minimum ledger support, not complete I03 service degradation.

Legacy pending/editing rows receive no automatic operation identity. An explicit checked adoption requires unchanged row/seq and known pending status. Legacy sending recovers uncertain/paused and cannot be adopted into executable work. Old unlinked compatibility paths remain until I02b replaces them; this module does not advertise safer existing HTTP delivery.

## Verification boundaries

Focused tests exercise production Store/opening code with real SQLite, not a separate test ledger. Fault seams are test-compiled checks at real transaction stages; crash children exit without destructors. Required scenarios include real v1→v2/new/current/future/malformed databases, migration/identity/version rollback, permanent tombstones, concurrency/digest conflicts, prep/dispatch/goal recovery, queue edit/FIFO/result atomicity, SQLITE_FULL/query-only/lock failures and I01 orphan/hidden-event preservation. Module tests cannot prove HTTP/native/Web integration or Linux/Windows lock behavior. Exact commands/results and gaps are appended before candidate review.

## Exact I02b-consumable signatures

The following methods are actual production `Store` methods. `p` is the exact saved `Identity { store_id, ledger_incarnation }`; `sid` is an already-authorized local session. Every `v`/`old_revision` is the expected persisted operation revision. All return module `Result<T>`; no call may interpret storage/corruption/read errors as absence or success. IDs are canonical client UUIDs (WorkBuddy native request IDs are separately persisted canonical v7 UUIDs).

```rust
pub fn canonical(&self) -> Result<CanonicalIntent>;
pub fn intent(&self) -> Result<Intent>;
pub fn operation_id(&self) -> &str;
pub fn claim_id(&self) -> &str;
pub fn operation_id(&self) -> &str;
pub fn attempt_id(&self) -> &str;
pub fn operation_id(&self) -> &str;
pub fn claim_id(&self) -> &str;
pub fn ledger_identity(&self) -> Result<Identity>;
pub fn admit_operation(
        &self,
        p: &Identity,
        sid: &str,
        id: &str,
        intent: &Intent,
        binding: &Binding,
    ) -> Result<Admission>;
pub fn lookup_operation(&self, p: &Identity, sid: &str, id: &str) -> Result<Lookup>;
pub fn list_session_operations(
        &self,
        p: &Identity,
        sid: &str,
        after: Option<&str>,
        limit: usize,
        unresolved: bool,
    ) -> Result<Vec<Operation>>;
pub fn select_operation_route(
        &self,
        p: &Identity,
        sid: &str,
        id: &str,
        v: i64,
        route: Route,
        turn: Option<&str>,
    ) -> Result<Operation>;
pub fn claim_preparation_step(
        &self,
        p: &Identity,
        sid: &str,
        id: &str,
        v: i64,
        spec: &PreparationSpec,
    ) -> Result<PreparationClaim>;
pub fn confirm_preparation_step(
        &self,
        p: &Identity,
        sid: &str,
        permit: &PreparationPermit,
        receipt: &PreparationReceipt,
    ) -> Result<Operation>;
pub fn fail_preparation_step(
        &self,
        p: &Identity,
        sid: &str,
        permit: &PreparationPermit,
        uncertain: bool,
    ) -> Result<Operation>;
pub fn finish_preparation(
        &self,
        p: &Identity,
        sid: &str,
        id: &str,
        v: i64,
    ) -> Result<Operation>;
pub fn begin_operation_dispatch(
        &self,
        p: &Identity,
        sid: &str,
        id: &str,
        v: i64,
        authority: DispatchAuthority,
        route: Route,
        expected_turn: Option<&str>,
    ) -> Result<DispatchPermit>;
pub fn record_input_accepted(
        &self,
        p: &Identity,
        sid: &str,
        permit: &DispatchPermit,
        receipt: &InputReceipt,
    ) -> Result<Operation>;
pub fn record_input_rejected(
        &self,
        p: &Identity,
        sid: &str,
        permit: &DispatchPermit,
        reason: Rejection,
    ) -> Result<Operation>;
pub fn record_input_uncertain(
        &self,
        p: &Identity,
        sid: &str,
        permit: &DispatchPermit,
    ) -> Result<Operation>;
pub fn reconcile_input_accepted(
        &self,
        p: &Identity,
        sid: &str,
        id: &str,
        receipt: &InputReceipt,
    ) -> Result<Operation>;
pub fn verify_ledger_storage_recovery(&self, p: &Identity) -> Result<()>;
pub fn claim_operation_goal(
        &self,
        p: &Identity,
        sid: &str,
        id: &str,
        v: i64,
        expected_goal_id: Option<&str>,
    ) -> Result<GoalPermit>;
pub fn record_operation_goal(
        &self,
        p: &Identity,
        sid: &str,
        permit: &GoalPermit,
        outcome: GoalOutcome,
    ) -> Result<Operation>;
pub fn admit_queued_operation(
        &self,
        p: &Identity,
        sid: &str,
        id: &str,
        intent: &Intent,
        binding: &Binding,
    ) -> Result<Admission>;
pub fn queue_recorded_operation(
        &self,
        p: &Identity,
        sid: &str,
        id: &str,
        v: i64,
    ) -> Result<Operation>;
pub fn adopt_legacy_pending(
        &self,
        p: &Identity,
        sid: &str,
        seq: i64,
        id: &str,
        expected: &Value,
        binding: &Binding,
    ) -> Result<Admission>;
pub fn take_operation_queue_edit(
        &self,
        p: &Identity,
        sid: &str,
        id: &str,
        v: i64,
        seq: i64,
    ) -> Result<Operation>;
pub fn restore_operation_queue_edit(
        &self,
        p: &Identity,
        sid: &str,
        id: &str,
        v: i64,
        seq: i64,
    ) -> Result<Operation>;
pub fn replace_operation_queue(
        &self,
        p: &Identity,
        sid: &str,
        old_id: &str,
        old_revision: i64,
        seq: i64,
        new_id: &str,
        intent: &Intent,
        binding: &Binding,
    ) -> Result<Admission>;
pub fn cancel_undispatched_operation(
        &self,
        p: &Identity,
        sid: &str,
        id: &str,
        v: i64,
    ) -> Result<Operation>;
pub fn detach_uncertain_queue(
        &self,
        p: &Identity,
        sid: &str,
        id: &str,
        v: i64,
    ) -> Result<Operation>;
pub fn reject_before_input(
        &self,
        p: &Identity,
        sid: &str,
        id: &str,
        v: i64,
        reason: Rejection,
    ) -> Result<Operation>;
pub fn reconcile_input_rejected(
        &self,
        p: &Identity,
        sid: &str,
        id: &str,
        observation: &NotAcceptedObservation,
    ) -> Result<Operation>;
pub fn reconcile_preparation_receipt(
        &self,
        p: &Identity,
        sid: &str,
        id: &str,
        claim_id: &str,
        receipt: &PreparationReceipt,
    ) -> Result<Operation>;
pub fn reconcile_operation_goal(
        &self,
        p: &Identity,
        sid: &str,
        id: &str,
        receipt: &GoalReceipt,
    ) -> Result<Operation>;
pub fn detach_rejected_queue(
        &self,
        p: &Identity,
        sid: &str,
        id: &str,
        v: i64,
    ) -> Result<Operation>;
```

`Admission { created, operation }` distinguishes a committed new intent from the existing same intent. `Lookup` is exactly `Found(Operation)`, `Tombstone`, or `NeverRecorded`; the latter is only a healthy query bound to the same identity and current session. Per-session listing uses UUID-keyset pagination, limit 1–100 and an unresolved filter; it never reads another session or decodes unrelated events.

`PreparationClaim::New(PreparationPermit)` alone qualifies the exact preparation step. `Existing { claim_id, phase, receipt }` conveys committed state and **never** another execution permit. Confirm/fail consume a reference to the qualification but validate active phase/claim so repeated calls cannot reapply a result. Native preparation uncertainty can reconcile only through that exact stable claim and a matching typed receipt, or the known-undispatched input can be explicitly abandoned. `finish_preparation` derives the immutable bundle from confirmed receipts; opening also checks exact bundle/receipt equality. It does not rerun steps, read original files, or claim artifact bytes were verified.

`DispatchPermit` and `GoalPermit` have private constructors and are not cloneable. Dispatch returns qualification only after its durable transaction. Same-ID repeated dispatch calls fail rather than yield another permit. `record_*` validate the exact attempt/claim; stale/terminal results cannot change another attempt. `select_operation_route` saves a one-time immediate route/turn; queue dispatch chooses and persists its actual start/steer route once. Native liveness, route choice, permissions, exact expected turn validity and wire behavior remain I02b responsibilities. Scheduling authority is a separate typed argument and is persisted with the dispatch attempt; it is never inferred from `Start`/`Steer`:

| `DispatchAuthority` | Required I02b caller and qualification |
| --- | --- |
| `Immediate` | Direct-message dispatch with no queue association; actual route and expected turn must match the saved immediate route. |
| `QueueWorker` | Automatic queue worker only. Actual route must be `Start` for an independently verified idle thread. The selected physical row must be pending, the queue unpaused, and its sequence the minimum across **both** `message_queue` and `queue_edits`. An editor-held head therefore blocks later rows; an edited middle does not block an earlier row. Choosing `Steer` cannot bypass these checks. |
| `ExplicitQueueSelection` | Explicit authenticated user queue action on the exact selected pending physical queue row. I02b chooses actual `Start` when idle or `Steer` with an exact active-turn identity. Pause and FIFO position do not block this explicit choice; the queue remains paused and unrelated head/editor rows are unchanged. An editor-held selected row still cannot dispatch. |

Every authority retains the same identity/session/thread binding, archive/auxiliary, revision, preparation, global/per-binding fence and single-permit guards. `Start` cannot carry an expected active turn; `Steer` requires a nonempty expected turn. Store does not establish idle/active native state merely by accepting an argument. I02b must pass the authority for the actual caller, never relabel worker work as explicit selection. The optional persisted `dispatch_authority` defaults to absent for pre-fix v2 records, retaining inspectability without inventing their original caller. Old accepted/uncertain/dispatching records gain no new execution qualification; new dispatch claims always persist an authority.

`replace_operation_queue` takes expected old ID/revision/sequence and a **pre-journaled new ID**. One transaction supersedes the old known-undispatched intent, adopts the same FIFO sequence, and publishes both operation events. Repeating that exact replacement resolves by new ID and immutable intent rather than superseding again. `adopt_legacy_pending` compares the entire expected row and preserves sequence and editing location; unknown/sending/rejected legacy rows cannot be adopted as pending. Original queue mutators reject associated rows. Unlinked legacy compatibility entry points continue to exist and are not newly advertised as ledger-backed.

### Evidence and outcome limits

`InputReceipt` requires the saved `thread_id`, exact `client_user_message_id`, optional saved `native_request_id`, a **nonempty observed native item ID**, and optional nonempty native turn ID. The receipt must describe an adapter-verified occurrence carrying the exact client/native correlation. Store checks the saved identities and structural binding; it cannot prove a caller's observation is true. Supplying the client's own identity beside an unrelated item does not become native evidence. The accepted local echo is emitted only after receipt validation in the same result transaction; that echo is never a source of proof.

This initial conservative receipt variant **does not** accept Codex `turn/start` ACK containing only `turn.id`, a steer ACK without an observed input item, a locally invented item ID, text/time similarity, or an AnyWork echo as native acceptance. With only these signals, I02b must save `uncertain` and wait for a verified exact-identity input observation; it cannot resend to obtain one. Before an adapter integrates request-correlated ACKs without item IDs (including a possible WorkBuddy request-only acceptance), I02b must add a distinct typed ACK evidence variant and prove its actual protocol semantics and binding in independent integration tests. It must not fabricate an item ID or bypass this interface. A fixed WorkBuddy v7 request ID is correlation only, not a promise that resubmitting is safe.

`NotAcceptedObservation` binds the same saved thread, client/request identities and a nonempty native-query proof key. The adapter must prove authoritative nonacceptance; an empty page, timeout, unavailable query or guessed key is insufficient. Direct `record_input_rejected` is for a qualified dispatch's definite validation/native rejection; pre-input failures use `reject_before_input` and cannot pretend unknown preparation was definite. All three input outcomes are terminal for that dispatch; no rejection/uncertainty API grants a replay.

`GoalReceipt` contains native goal/thread IDs, and the claim saves the expected prior goal ID. `GoalOutcome` is accepted(receipt), rejected, or uncertain; goal result failures retain accepted input and raise recording fences independently. Only accepted-input operations can claim a goal. An adapter must prove goal ownership and compare expected goal before command invocation; Store cannot execute or query that native CAS. Reconciliation of an uncertain goal requires exact operation ownership verified by I02b, not merely a goal with matching text. There is no automatic goal retry/force setter.

### Error handling

- `Invalid`: malformed request, IDs, bounds or typed receipt; do not invoke side effects.
- `IdentityMismatch`, `BindingConflict`, `IntentConflict`, `UsedId`: pair/session/native/request mismatch or permanent used ID; never allocate a replacement ID as an automatic retry.
- `Missing`, `Conflict`, `IllegalTransition`: missing concrete record or expected revision/phase no longer applies; query the same operation and preserve the caller's journal. `Missing` is not authoritative never-recorded.
- `Fenced`: global recording health, same-binding unresolved recording/preparation, or native preparation in flight; no dispatch/preparation qualification.
- `Corrupt`, `Storage`: invalid persisted state or failed SQLite read/transaction; no absence/success claim.
- `RecordingFailure`: native outcome may exist but result commit failed; retain stable IDs, stop related sends and verify storage before exact-identity reconciliation. Never resend as repair.

Preparation receipt confirmation/failure/reconciliation uses the same result-transaction guard as input/goal results. Claimed native preparation blocks other same-session/thread input or goal dispatch before a response is recorded; local snapshot steps alone do not assert a native side effect. Persisted same-session fences remain even after its local native-thread mapping changes.

The process-global fence is conservatively retained until `verify_ledger_storage_recovery` completes an immediate write transaction and readback validation. It reuses the startup recovery implementation to convert durable pending input/goal outcomes to uncertainty and recovery-required and claimed preparation to preparation-uncertain, but does not clear per-operation binding fences. A successful result reconciliation clears that operation only. Snapshot/claim failures before native invocation need no invented native result; ambiguous native preparation must explicitly call the uncertain outcome when storage allows. Original non-ledger APIs do not consume these fences until I02b connects all thread entry points and workers; I02a is not complete degradation/dispatch safety.

### Staged unused-interface lint policy

There is no module/crate-wide dead-code waiver. Each currently unconsumed public Store entry and permit accessor has `cfg_attr(not(test), expect(dead_code, reason = ...))` naming its I02b consumer; the concrete `PreparationClaim` return type and `GoalOutcome` input type similarly identify preparation/goal adapters. Tests retain normal unused-code checking. Internal helpers and Store fields have no new blanket exemption. Remove each expectation as its production I02b caller is connected; fulfilled-to-unfulfilled expectation warnings make forgotten removals visible. This staging does not make Store public outside the server module or add synthetic runtime calls.

## Developer verification record (2026-11-07)

Executed on macOS local disposable filesystem fixtures with Rust 1.97.1, locked `rusqlite 0.37.0` / bundled `libsqlite3-sys 0.35.0`, and `serde_json 1.0.154`. All build outputs/data were private to this worktree or temporary fixture directories. The manifest change is limited to enabling `unbounded_depth` on the server's existing serde_json dependency for the bounded ledger parser; package versions/lockfile are unchanged. No production server, native application, profile/account, release/version or Web assets were accessed or changed.

| Final command | Actual observation |
| --- | --- |
| `CARGO_INCREMENTAL=0 cargo test --locked --offline -p anywork` | 172 passed, 5 ignored. Includes 28 active ledger tests, all 18 accepted I05a schema/owner tests and existing I01 Store tests. One ignored ledger crash-child entry is explicitly executed by parent tests; the other four are existing native/profile opt-in tests intentionally not enabled. |
| `CARGO_INCREMENTAL=0 cargo clippy --locked --offline -p anywork --all-targets -- -D warnings` | Passed, including normal test-target unused-code checks. |
| `CARGO_INCREMENTAL=0 cargo build --locked --offline -p anywork` | Passed; this final binary is used in the HTTP checks below. |
| `ANYWORK_BINARY="$PWD/target/debug/anywork" python3 scripts/schema-recovery-test.py` | 3 passed: actual owner refusal/crash/restart/no replay; future logical/journal refusal; six declaration lookalikes × two historical schema stamps (12 actual refused startups). |
| `ANYWORK_BINARY="$PWD/target/debug/anywork" python3 scripts/event-scope-test.py` | 4 passed: all/workspace/three-Agent visibility, orphan/hidden payload semantics, SSE/poll/cursor isolation retained. |
| Selected `scripts/integration-test.py` queue-if-busy/FIFO-edit-steer-stop/edit-position/unknown-not-resent methods | 4 passed using the real isolated HTTP service and deterministic fake Agent. Existing unlinked legacy queue behavior retained. |
| `cargo fmt --all -- --check`, `git diff --check` | Passed. |

Meaningful production-path regressions include 12 concurrent same-ID admissions with exactly one creation; permanent IDs surviving session delete/import refresh/recreation; changed semantic input conflict; all queue/ledger/echo publication rollback fault points; real SQLite query-only, FULL and lock contention; alias/same-session retarget result fences; native-preparation in-flight/result-record failure fences and exact claim reconciliation; separate input/goal outcomes; and actual child exit at five task boundaries plus v2 identity migration. Each child exits without destructors; restart retains identities, pauses executable queues, never issues another qualification automatically, and repeated restart preserves the recovered snapshot. Migration checks retain source string identity and deleted event high-water 900→901. Maximum depth 128 admits/persists/reopens/looks up correctly; +1 has no registry/content mutation; UTF-8 byte limits and quoted/escaped structural characters are verified. This is finite fixture evidence, not a proof against physical power loss.

Two failed developer runs exposed real gaps before final source: an additional native preparation could initially receive qualification while another was in flight; the default JSON parser initially rejected valid canonical depth-128 content on readback. Both have actual regression tests and corrected production boundaries. A subsequent result-fence extension intentionally caused the old prep test's next action to be refused until explicit health verification; the test now proves that fence rather than assuming successful recording clears it. Earlier module-level unused-code lint suppression was removed; only concrete staged public interfaces have expectations as described above. One server build was interrupted by ENOSPC while writing an incremental query cache; only this worktree's reproducible package cache was cleaned, and the affected build plus final checks completed with `CARGO_INCREMENTAL=0`. These failed/interrupted runs are not claimed as successful checks.

Unverified: native Linux/Windows guard/crash behavior, network filesystems, physical power loss/disk-controller persistence, actual Agent ACK/query/echo/proof semantics, private artifact byte copying/ACL/hash checks, HTTP operation endpoints, Web durable journals, all-entry-point runtime fences, native WorkBuddy writing and complete backup/restore/retention. The isolated HTTP checks here preserve current behavior; they do not exercise a ledger HTTP protocol because none is activated. Independent exact-commit review and root's merged regression remain required. I02a does not close I02/I03/I05.

## Blocker correction verification (2026-11-08)

The original developer record above describes candidate `35cbd01002143ef09bac442f6650cfb5e238e7e6`; it does not supersede the independent review failures. Independent review `800950fa0e9779c05043978d21c8288692e782eb` reproduced B1 (known-fenced absence), B2 (worker bypass of an editor-held FIFO head), and B3 (paused/non-head explicit queue selection rejected because scheduling origin was inferred from native route). The accepted clarification of `docs/message-operations.md` is synchronized from `ca0eaaf2783793ca1975203d6051fecf3338a9f2`. This correction changes only the internal Store module and its tests; no existing HTTP/Agent/Web dispatch caller consumes the new interface yet.

Six added production-Store regressions cover real `PRAGMA query_only` result failure and failed/successful storage-health verification; Found/tombstone inspection during a global fence; retained input/preparation binding fences after health verification; editor-head restore/cancel/new-ID replacement without renumbering; edited-middle behavior; on-disk restart; paused non-head explicit idle Start and active Steer; and rejection snapshots proving no operation/registry/preparation/queue/editor/event mutation or permit on invalid qualifications. The normal and explicit dispatch paths retain one qualification per attempt. The tests do not invoke native Agents, and the HTTP compatibility checks do not advertise a ledger protocol.

Executed on macOS with private worktree build outputs and disposable data. Logs are under `artifacts/ledger-blocker-fixes/`:

| Correction command | Actual result / log |
| --- | --- |
| `CARGO_INCREMENTAL=0 cargo test --locked --offline -p anywork store::operations::tests` | 34 passed, 1 ignored child entry (executed by its parent test); `focused.log`. |
| `CARGO_INCREMENTAL=0 cargo test --locked --offline -p anywork` | 178 passed, 5 ignored; `server-tests.log`. The six additional tests are the blocker regressions above; existing ignored native/profile gates remain unchanged. |
| `CARGO_INCREMENTAL=0 cargo clippy --locked --offline -p anywork --all-targets -- -D warnings` | Passed; `clippy.log`. |
| `CARGO_INCREMENTAL=0 cargo build --locked --offline -p anywork` | Passed; `build.log`. |
| `ANYWORK_BINARY="$PWD/target/debug/anywork" python3 scripts/schema-recovery-test.py` | 3 passed; `schema-http.log`. |
| `ANYWORK_BINARY="$PWD/target/debug/anywork" python3 scripts/event-scope-test.py` | 4 passed; `event-http.log`. |
| Selected real `scripts/integration-test.py` queue-if-busy/FIFO-edit-steer-stop/edit-position/unknown-not-resent methods | 4 passed; `queue-http.log`. |
| `cargo fmt --all -- --check`, `git diff --check` | Passed; `fmt.log`, `diff-check.log`. |

Independent exact-candidate re-review and merged regression remain required. Native Linux/Windows, physical power-loss behavior, I02b runtime authority selection/native liveness and the previously listed integration gaps remain unverified. No HTTP operation protocol, native delivery safety, complete I02 or complete I03 is claimed.
