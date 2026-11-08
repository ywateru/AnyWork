# Durable message operation contract (G1 / I02)

Status: implementation contract under the authorized prioritized improvement goal. Not implemented merely by publication of this document. Depends on independently accepted [schema safety](schema-and-recovery.md): corrected source `84774c2` passed independent review `9fa5154`, is merged and passed full local merged regression. The operation contract's ledger-incarnation and preparation-state findings were corrected at `53354fc` and rechecked without further blocking findings. The corrected ledger module `8d57934` passed independent review `c3117a8`, is merged and passed full local regression at `a26d6f4`. Current HTTP/native/Web sending does not yet consume it; the [connected integration task](plan/tasks/improvement-message-delivery.md) remains open. Full storage degradation (I03), native support acceptance and backup/restore remain separate deliverables.

## Purpose and actual boundaries

Give each submitted message a stable, durable identity before dispatch so a missing HTTP response never requires guessing whether to send again. This covers the primary composer, child-session composer, immediate start/steer, queue admission and queue-worker delivery. It does not promise native exactly-once execution: current RPC failures do not reliably distinguish a partial write, native acceptance, timeout or disconnect. A stable native ID is evidence for correlation, not proof that the native host deduplicates retries.

The operation ledger owns AnyWork's dispatch intent and local observation of acceptance. Native turn/task state still owns execution and completion. A user-message echo, matching text, bridge receipt, arbitrary `turn/started`, idle status or absence from one history page is not sufficient acceptance/rejection proof. Existing imported histories need not be assigned fabricated operations.

Source investigation at the G0 baseline found these connected paths:

| Boundary | Current source | Required change |
| --- | --- | --- |
| Admission / busy routing | `api.rs::message`, `Message` | Check stable operation before preparing a runtime or re-evaluating busy routing |
| Immediate native input | `api.rs::deliver` | Durable dispatch boundary before input RPC; no swallowed result-record failure |
| Queue / worker | `send_queued`, `start_queue_worker`, Store queue methods | Same operation from admission through worker; atomic queue/operation transitions |
| Optional goal activation | `activate_message_goal` | Independent saved goal result; never resend accepted input to repair a goal |
| Native identity | Codex desktop bridge, Harness prompt, WorkBuddy projection | Persist native/client identity before dispatch; observe exact identity after reconnect |
| Main and child composers | `App.tsx`, `SubagentComposer.tsx` | Share a submission client and persistent pending journal |
| Event/cache recovery | `runtime.rs::emit`, `sessionHistory.ts` | Events notify; scoped ledger query is the authority for submitted-operation state |

## Admission identity and canonical request

New message submissions require a client-generated UUID `operation_id`. Advertise the protocol as `message_operations_v1` in `/api/info`. Missing IDs return HTTP 428 with an actionable refresh/upgrade code and leave the client draft intact. Do not retain an unadvertised legacy sending bypass. This is an intentional protocol change; update all first-party senders and test clients before integrating the feature. New Web must not silently fall back to unidentified sending against an older server; explain the required upgrade and retain its journal/draft.

The schema migration also creates durable random `store_id` and `ledger_incarnation` values, exposed by authenticated info/operation responses. Both are independent of URL, hostname, credentials and credential hashes. Each submission/journal binds the pair; the server rejects a mismatched pair before preparation or dispatch. Ordinary restart preserves them. A new/rebuilt data directory creates a new pair; missing or malformed identity in a versioned store is an opening error, not permission to invent a replacement identity. Any supported restore/rollback must rotate the incarnation before accepting commands, so old journals become explicit reconciliation cases. Manual copying/rolling back database files while retaining the old identity is outside the supported recovery protocol and cannot be claimed detectable by this ledger alone.

Do not prune used operation identities in this deliverable. Session deletion/content minimization must retain a non-executable tombstone sufficient to reject reuse, even if private request/result content is removed; cascading deletion must not turn an already used ID into a new admissible operation. A later retention/restore design must preserve these invariants before introducing pruning.

Authenticate and check the current session scope before looking up or exposing an operation. IDs are unique across the database and bound to session, Agent and native thread identity. A different session must not read or take ownership of an existing ID. After scope and syntactic checks, handle an existing ID before starting/resuming a runtime, rematerializing a goal, uploading native attachments or reading mutable source attachments again.

Persist a versioned canonical representation of the exact request intent: text, ordered attachment references, composer document/Markdown, goal flag, explicit mode and `queue_if_busy`. Preserve string and array semantics; define absent/default equivalence once and test it. Canonical object key ordering must be deterministic without rewriting user text. Store a cryptographic digest and the representation required for comparison/recovery. Same ID and same intent returns the current operation; same ID and changed intent returns 409 `operation_conflict`, without preparing or dispatching. Same text with a different ID remains a distinct deliberate message.

The actual selected start/steer/queue route and expected native turn are saved separately from the original intent. A repeated request must not change route because the Agent's busy state has since changed. If the native thread binding has changed, refuse dispatch of that saved operation with an explicit conflict rather than retargeting it silently.

## Durable state and transitions

Introduce the ledger with a real ordered v1→v2 schema migration, transactional with its version update and schema validation. Do not append another unversioned `CREATE IF NOT EXISTS`. Persist operation/session/native identity, canonical request version/digest/body, preparation/artifact metadata, selected route/expected turn, queue association, input and goal state/results, stable error code and timestamps. Do not confuse the connection-local numeric RPC request ID with the operation identity.

| Input phase | Meaning and allowed continuation |
| --- | --- |
| `recorded` | Intent is durable and input is definitely not dispatched. Preparation may have side effects. An explicit same-ID resume may continue; no background automatic dispatch. |
| `queued` | Queue entry and operation were committed together; input not dispatched. Existing explicit resume policy still applies. |
| `dispatching` | A durable transaction authorized one dispatch attempt. Wire/native outcome may already be unknown. Repeated POST only queries this operation. |
| `accepted` | A native result or exact identity observation proves this input was accepted, and the result is durably recorded. Does not mean task completion. |
| `rejected` | This input is provably not accepted, with an explicit reason. Preparation/validation failures may be definite; generic RPC errors are not. |
| `uncertain` | Input may have been accepted. Query/observe; never automatically invoke again. |
| `cancelled` / `superseded` | Only a known-undispatched operation was explicitly cancelled or replaced. Never apply this as a shortcut to unknown delivery. |

```text
immutable client journal → authenticated scoped admission → recorded
                                    │                       │
                          duplicate │                 preparation
                                    ▼                       │
                           current operation        queued / ready
                                                            │
                                  commit dispatching + queue state
                                                            │
                                                one native input RPC
                                                            │
                                           accepted / rejected / uncertain
```

Durably commit `dispatching` before invoking start/steer. If that transaction fails, input RPC count is zero. A crash after that commit but before wire write still recovers conservatively to `uncertain`; do not infer it was safe to retry. On startup, in-flight dispatches become uncertain, accepted stays accepted, recorded does not auto-dispatch, and restored queues remain paused. Session ownership must prevent two live recovery-capable services for one store.

Preparation has its own checked phases, independent of input phase: `not_started`, `preparing`, `prepared`, `failed` and `uncertain`. Before any native preparation side effect, commit a claim identifying the exact step and stable preparation identity. An in-flight duplicate only queries; it cannot run that step concurrently. Persist each confirmed result/receipt before moving to the next step. A crash/lost receipt during a side-effecting step becomes preparation-uncertain, even when input is still `recorded`; explicit same-ID resume is allowed only for provably undispatched input **and** safe/confirmed preparation state. It does not authorize repeating an uncertain upload or thread creation. Pure local snapshot steps may resume only when saved artifacts/claims prove safe reuse. Preparation uncertainty requires identity-based reconciliation or explicit abandonment, never background continuation.

For ordinary successful delivery, persist operation acceptance and its local echo/operation-change event together where those records are owned by AnyWork. Owned-session pre-RPC echoes must not imply acceptance. Native echoes may arrive first; stable client/native identity merges them without duplicate user messages. Lack of upstream correlation leaves an operation uncertain instead of matching text/time heuristically.

## Queue, editing and legacy rows

Queue admission plus operation creation is one transaction. The worker references that operation, not a new ID. Entering dispatching plus queue sending is atomic. Acceptance plus queue removal/completion is atomic; a failure cannot leave an accepted operation executable again. Returning a duplicate enqueue request projects its operation/queue association, not a second queue entry or a replay of a stale complete queue list.

Dispatch authority is distinct from the actual native `Start`/`Steer` route. A typed automatic-worker qualification requires an unpaused queue and the earliest recoverable FIFO sequence across both queued and editor-held rows; an editor-held head blocks later automatic dispatch. Earlier eligible rows may still run before an edited middle row. Restoring, replacing or cancelling an editor-held row uses the existing atomic identity/revision transitions; it never silently drops or renumbers that row to unblock the worker. The worker cannot acquire manual authority merely by choosing `Steer`.

An explicit user selection may send a pending queued row while the queue is paused or while earlier rows remain pending/editor-held, preserving the current queue action. It leaves pause and the other rows unchanged. If native execution is idle this selection uses `Start`; if an active turn can accept it, it uses `Steer` bound to that exact turn. A typed manual qualification must therefore support both routes without impersonating worker execution or silently unpausing the queue. The selected row itself must be in the queue, not held by the editor. Both authorities retain the same exact operation/revision/native binding, scope/archive/auxiliary, preparation, storage-fence and one-permit checks. Route/turn validation remains independent of scheduling authority.

Editing changes semantic content. Atomically supersede the known-undispatched old operation and associate a new ID/intent; retain the existing recoverable editor/FIFO behavior. Cancel only known-undispatched items. Existing uncertain items remain inspectable and cannot regain a sending action merely because metadata migrated. Legacy pending rows acquire durable operation identity before their first dispatch; startup migration does not send them. Legacy sending rows remain uncertain/paused, with no invented native acceptance proof.

Queue sequence/FIFO identity is distinct from operation UUID. A replacement request carries an expected old operation/queue identity and a client-persisted new operation ID. A lost replacement response is resolved by querying that new ID, not by allocating another one or editing the old immutable body. Validate the expected old identity and commit supersession/queue replacement together.

## Attachments and preparation

Separate an immutable request intent from prepared artifacts. Persist submitted attachment references before reading their bytes. During preparation, enforce session/path authorization and bounded per-file/total hashing/copy budgets, produce a private operation-scoped immutable snapshot with size and SHA-256, and bind actual prepared paths to the operation. The implementation task must choose and document concrete budgets within the existing upload/body limits; no unbounded hashing/copy loop is accepted.

Once preparation succeeds, retries reuse its saved manifest/artifacts instead of rereading changed source files. A missing or altered prepared artifact is a definite pre-input failure; never silently substitute current bytes. A mid-preparation crash may leave private orphan files but must not auto-dispatch. Filesystem artifact creation is not atomic with SQLite: record preparation boundaries, clean only provably unreferenced artifacts, and retain every artifact referenced by queued/uncertain work. No full garbage collector is implied by this deliverable.

Goal materialization, native thread creation/resume/fallback and Harness native file uploads are preparation steps. They can touch the native host before input dispatch; the guarantee is that no task input is dispatched before its durable boundary. Classify their actual side effects and bind artifacts/receipts/thread ownership to the operation; reuse confirmed preparation. A lost new-thread result cannot silently fall back to creating another thread. If an upload response is lost and native idempotency/query is unavailable, report preparation uncertainty rather than repeat the upload without explanation. For text-based local-file references, submit the operation snapshot path when claiming exact attached bytes; hashing the original path alone cannot control bytes the native host reads later. Snapshots are private service-owned files (Unix directories 0700/files 0600 or an equivalent platform ACL); enforce file-count as well as per-file/total-byte budgets.

Persist `clientUserMessageId` for all submitted operations, not only messages with rich composer metadata. WorkBuddy additionally needs its canonical native request ID persisted before invoke, passed through a validated internal adapter boundary, and available to snapshot projection before native records are read. Its current in-memory client mapping is insufficient for restart correlation. The same native ID must never be treated as a verified retry/deduplication capability.

## Goal sub-operation

Track goal activation separately from accepted input: not requested, pending, accepted, rejected or uncertain. Save objective/artifact references and verified native identity. Input accepted plus goal failure returns the accepted input and goal error/uncertainty; no path resends input or silently overrides another device's newer goal. Without provable goal ownership/query, a lost activation result remains uncertain and is not automatically reissued.

## HTTP and Web recovery

Return a stable operation projection with `operation_id`, `phase`, input result/identity, goal sub-state, queue association, error code and durability/recording condition. HTTP 202 means durably recorded/queued/in progress, not native acceptance. A known accepted projection may return 200. Explicit input/request conflicts use stable codes. An ambiguous native outcome must not become an ordinary generic 400 suggesting a fresh send.

Provide authenticated, session-scoped single-operation and unresolved-operation queries. Events are a refresh hint; GET state remains authoritative after reload or another device's action. List/query paths obey the same current Agent/workspace visibility as session APIs. Scope changes must not leak operation payloads or bypass archive/child-read-only rules. A plain 404/empty list never authorizes resubmission. After an ambiguous POST, same-ID submission is permissible only after an explicit healthy authoritative `never_recorded` result bound to the journal's exact store/incarnation pair, under the no-pruning/no-unsupported-rollback rules above; the POST revalidates that pair atomically with admission. A missing route/proxy error/read failure/identity mismatch/tombstone is not that proof. Otherwise retain uncertainty for reconciliation, never allocate a new ID as a retry.

Before the first POST, Web stores an immutable submission envelope/ID in an error-aware persistent journal (for example IndexedDB), scoped by stable server identity and session. Never store the service token in that journal. If persistence fails, explain the issue and prevent a supposedly recoverable submission; do not claim durability for a memory-only fallback. Store plain/rich composer content, attachment manifest, goal/mode and submitted draft revision. Main and child composers reuse one submission implementation.

The editable next draft is separate. Accepted/queued results clear only the submitted draft revision, not newer user typing or another tab's draft. Timeout/offline/reload first queries the existing operation. Accepted merges one echo; uncertain shows inspection/reconciliation with no blind resend button. Known-undispatched explicit resume uses the same ID. Editing an old request creates a new operation while retaining unresolved predecessors. Pending state from another session/late responses cannot clear current drafts or attach messages to the wrong conversation.

## Minimum storage-failure safety and remaining I03

I02 must fail closed when intent, prepared or dispatching records cannot commit: no input RPC. After native acceptance, result/event transaction failure must return a structured same-ID `recording_error`/unknown-local-result condition and block related new dispatches until a verified recovery. The fence covers at least every entry point and worker for the same session/native thread, including alternate local mappings; widen to the store when the failure is shared or its scope is unknown. Do not report durable accepted or swallow the failure into tracing. The durable pre-dispatch state survives restart as uncertain; if even an uncertainty update cannot commit, clearly distinguish the in-memory warning from persisted state. A subsequent same-ID lookup/identity observation reconciles; resending is never a repair mechanism. Unavailable/failed reads return explicit errors, never an invented absent operation.

While a known Store recording-health fence is active, lookup may still return existing operation or retained-tombstone state for inspection, but a missing ID must return an explicit fenced/unavailable result rather than authoritative `never_recorded`. Make that decision coherently under the Store lock used for result recording. A successful SELECT is not a write-health recovery check. Verified storage recovery may restore authoritative absence for a new ID without clearing unrelated operation, preparation or native-reconciliation fences; it never makes an uncertain existing operation executable.

This minimum guard does not close I03. Full event-consumer, approval/automatic-response, completion, health/readiness, desktop/UI degradation, resynchronization and disk-fault recovery require a separate contract. Neither ledger acceptance nor task completion may be inferred from unavailable local records.

## Delivery and acceptance

1. Ledger module after accepted I05a: real v1→v2 migration, typed transitions/transactions, recovery rules and deterministic failure injection. No public claim of deduplicated delivery until all call paths integrate.
2. API/adapter/queue integration: mandatory IDs, preparation/native identity and scoped queries; critical storage boundaries; every sending path uses the ledger.
3. Shared Web submission journal: both composers, queue editing, late responses, attachments/goal, protocol upgrade handling and unresolved operation presentation.
4. Independent end-to-end review of the committed combined source before mainline acceptance. No production/native-account writes are needed for these controlled failure tests; actual native capabilities retain their separate support-matrix gates.

| Required real-boundary scenario | Expected evidence |
| --- | --- |
| Concurrent same ID/body on two HTTP clients; changed text/attachment/composer/goal/mode; same text/different IDs | One ledger and at most one native input for the same ID; semantic change 409; deliberate distinct IDs remain valid |
| Before-admission disconnect, recorded disconnect, accepted/lost HTTP, timeout/partial-write/late native result | Stable-ID query/reconciliation, no blind re-dispatch, conservative unknown outcome |
| Kill before/after intent, preparation, dispatching, native acceptance/result commit/HTTP | No automatic prompt after restart; accepted never executable; in-flight uncertain; queue paused |
| Queue admission/edit/cancel/restore/worker with transaction failures and legacy rows | No duplicate queue/task, same identity, atomic state, old unknowns never become pending |
| FULL/read-only/lock-wait at pre-input and post-acceptance commits | Zero pre-input calls on failure; no false durable success or log-only continuation after result failure |
| Changed/missing snapshot, hashing/copy limits, preparation crash, lost upload receipt | Bounded preparation, exact saved bytes/explicit uncertainty, no hidden duplicate preparation or input |
| Goal rejection/lost response/other-device replacement | Input called once; goal separately tracked; no blind overwrite |
| Main/child composer on desktop and Pixel; reload, session/tab switching, local storage failure | Journal/attachments/rich draft survive; late result preserves new draft; no token persisted; explicit protocol mismatch |
| Cross-session/current-scope/archived/auxiliary access | Same authorization as session API; no operation payload leak or capability bypass |
| Rebuilt store/rotated restore incarnation, tombstoned ID, failed query/proxy 404 | No blind re-admission; pair revalidated on POST; plain absence is not acceptance/rejection proof |

Keep actual command/results and unverified native/platform limits in the progress/review records. Tests of ledger methods alone cannot prove input/queue/Web integration.
