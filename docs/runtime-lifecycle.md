# Runtime lifecycle and qualified native effects (I07b1)

Status: **proposed implementation contract, awaiting independent review**. Product-source baseline: `aacaa19b98314976b34e91f11c12326c6ad6ad7c`; this document was prepared on documentation baseline `c0d6fcfc027235275d91fdd2f13ba705bcb243c9`. No lifecycle implementation, native acceptance or Web activation is delivered by this document.

The [independently reviewed research](plan/analysis/capability-observations.md) and [review](plan/reviews/improvement-capability-observations.md) establish the actual call paths. This contract decides the lifecycle subset. [Message operations](message-operations.md) own durable preparation/input authority; [I03 analysis](plan/analysis/storage-degradation.md) owns proposed recording-health and reconciliation work; [capability projection](capability-projection.md) remains advisory. Actual topology/platform support remains in the [support matrix](support-matrix.md).

## Purpose and non-negotiable boundary

One scoped AnyWork session has at most one qualified setup attempt and one installed Runtime. An installed Runtime has at most one current adapter peer. Old setup tasks, runtime actors, peer frames, command results and queued transport writes cannot mutate a replacement or obtain a new permission merely because the native thread ID is unchanged.

All native-dependent capability actions remain `allowed_now=false` in this slice. There is no new native probe, Web consumer, native-positive readiness policy, message replay mechanism, second operation journal or storage-health authority. Existing HTTP command paths still need their actual policy checks; a disabled capability projection does not protect an older client that calls those paths directly.

This is local lifecycle isolation, not native CAS. A native effect admitted while its binding was current may finish after local revocation, and may have an unknown result. Revocation cannot retract bytes or commands already admitted to the native transport. It must prevent subsequent admissions and stale local commits. A canceled/closed connection does not prove an input or approval was rejected, and does not clear an I02 or adapter uncertainty fence.

## Ownership and private types

Choose **internal singleflight**, not a requirement that every caller possess the existing session-operation gate. The manager never acquires that gate inside `ensure`; existing callers may already hold it. Unlocked create/read paths therefore get the same creation qualification without recursive locking.

```text
authenticated scoped request / current native producer
                      │
             RuntimeRegistry (short lookup only)
                      │ Arc<SessionSlot>
                      ▼
          CommitCell: membership + epochs + cancellation
             │                     │
       qualified local effect   qualified native admission
       Store / projection       SDK writer / adapter invoke
             │                     │
          checked result        native result or uncertainty
                      │
        immutable, bounded observation snapshot (pure read)

I02 preparation/input claims ──► required effect authority
I03 recording gap ◄──────────── checked persistence failures
```

Names below specify responsibilities, not a public plugin/API protocol:

| Private type | Owner and invariant |
| --- | --- |
| `SessionSlot` | Registry owns current membership. Contains a random process-local `session_incarnation`, immutable session ID and a short synchronous `CommitCell`. A deleted/recreated ID gets a new slot/incarnation. Old Arcs never become current again. |
| `SessionBinding` | Exact session incarnation, Agent, external/auxiliary topology, canonical workspace and native-thread mapping revision. A cold setup can begin with no thread; its qualified binding transition can fill that value once. A later different thread requires revocation and a new runtime epoch. |
| `SetupTicket` | Nonforgeable owner of one opening attempt/runtime epoch, expected binding, deadline and cancellation. Only RuntimeManager constructs it. Followers cannot use it to spawn or publish. |
| `RuntimeHandle` | Read-only identity plus qualified call/local-commit methods. Raw `rpc`, runtime-map mutation and writable turn/settings fields become private to the manager/qualified consumer. Cloning a handle preserves its old epoch; it does not follow replacements. |
| `PeerTicket` | Runtime epoch plus fresh local peer epoch, topology and producer qualification. Created before initial connection/reconnect; ordinary session effects require the required identity/snapshot validation. Establishment has the narrower setup-only permission below. Reusing the Runtime Arc does not reuse this ticket. |
| `NativeEvidence` | Typed, topology-specific verified fields and their sources. Native application version/instance may be absent. Local `connection_binding_id` is separate from `native_instance`; a generated UUID/PID/stream version never fills the latter. |
| `InteractionBinding` | Session/runtime/peer identity, fresh local occurrence, exact native request correlation and owning turn. An occurrence ends on disappearance, change, closure, overflow or peer revocation. Stored request IDs cannot recreate it. |
| `QualifiedEffect` | Typed producer and ticket plus an allowed event/status/settings/child-cache effect. Cannot be constructed from arbitrary HTTP JSON or a generic `app.emit` call. Metadata augmentation and file publication are effects too. |
| `QualifiedCall` | Expected binding/peer/turn/occurrence and operation-specific guard outcome. The final transport receives the qualifier, not merely a JSON value. I02 authority is an additional requirement for preparation/input, not encoded by claiming a lifecycle ticket is a durable receipt. |

Native input text, attachments and replay intent remain outside observation snapshots. Existing transcript/event paths may carry content, but there is no observation-owned transcript buffer or recoverable send queue.

## State, creation and removal linearization

```text
Absent ── claim ──► Opening ── verified peer ──► Bootstrapping ── activate ──► Active
                      │                             │                       │
                fail/cancel/timeout              failure              peer invalidation
                      ▼                             ▼                       ▼
                Closed / SetupBlocked ◄──────────────┘                 Reconnecting

Reconnecting ── old local writer quiesced + verified new peer ──► Active
Reconnecting ── terminal close / uncertain setup ──► Closed / SetupBlocked

any nonremoved state ── revoke/remove ──► Removing ── checked delete ──► Removed
```

`Closed` is no longer live; `SetupBlocked` additionally means a setup side effect may have happened and another native preparation cannot be inferred safe. These are lifecycle projections, not persisted delivery outcomes. Shared-host peer reconnection is a new peer inside an existing runtime epoch; replacing the whole runtime is a new runtime epoch.

### Internal singleflight

1. Authorize with `app.session` before looking up/creating a slot or exposing errors. Registry lookup/insertion takes a short registry lock, releases it, then operates on the returned slot. Registry membership is represented by that slot's nonrevivable membership flag; no later nested registry lock is needed to validate it.
2. Under the CommitCell, compare the actual scoped binding. Return the existing current handle only if its state qualifies. If an Opening/Bootstrapping attempt exists, subscribe to that attempt's bounded terminal watch; release the cell and await it. A follower cancellation only removes its subscription.
3. Otherwise claim one new epoch and become leader. This is the **creation linearization point**. It is distinct from native spawn, first frame and active installation. The leader owns the setup future; the manager does not detach a setup task to outlive that request.
4. Perform native I/O outside the cell. The ticket must still qualify at each local effect, preparation admission, peer verification and activation. A follower returns this exact attempt's success/error; it does not silently initiate a retry on failure. A later explicit request can claim a new attempt only if no uncertainty/closing/removal/preparation fence prevents it.
5. Activate under the cell only after verified identity, checked thread/preparation receipt, qualified bootstrap completion and current membership. This is the **active installation linearization point**. Publish the handle and initial observation atomically in memory, then notify waiters. No `ensure` returns a writable raw adapter during bootstrap.

Creating two different deliberate session UUIDs is not deduplicated by singleflight. Two concurrent `ensure` calls for one stored session must share one native setup. Different mappings to the same native thread still require I02/I11's wider identity fence; this module cannot claim cross-mapping ownership uniqueness.

Peer establishment has explicit private phases: unverified endpoint → validated transport/protocol → validated session binding. A current SetupTicket can admit only the topology's fixed establishment allowlist before the last phase, such as initialize/discovery/follow and exact identity reads. Claimed thread start/resume/fallback requires its separate durable preparation authority and the appropriate validated transport phase. Final writer checks apply to these setup calls too. There is no arbitrary-JSON or normal-input/control permission on an unverified ticket, and no session-cache/status/child publication before the session binding is validated. This avoids requiring an already installed Runtime to perform its own handshake while preventing handshake qualification from becoming a general bypass.

### Cancellation, failure and bounded cleanup

The leader's setup owner has a synchronous drop guard. Cancellation, timeout, panic unwind, session invalidation or explicit removal revokes its epoch under the CommitCell and publishes a sticky terminal outcome even if no ordinary data queue is readable. Drop does not run Store writes or wait for an async close. Any setup side effect that might have been admitted is reported to its existing preparation authority as uncertain; it is never made safe by discarding the task.

Transport ownership is separated from clonable request senders. A setup/installed resource owner retains cancellation, shutdown and task handles; reader/adapter tasks cannot retain ownership of an uninstalled owned child merely by retaining a sender. Owned child creation keeps `kill_on_drop(true)` and the owner closes stdin, requests kill and reaps under a bounded supervisor. External Unix/CDP/IPC transports only detach/close AnyWork's connection; they never kill the external host, cancel its task, dispose its conversation or start a competing engine.

Cleanup gets a 5-second local join budget, with a 1-second best-effort follower unfollow within that budget. On expiry, abort AnyWork's reader/writer/adapter tasks and drop its transport endpoints; for an owned child retain explicit kill/reap ownership until termination is observed. A slot remains closing and cannot spawn another owned child while that termination is unconfirmed. An asynchronous cleanup supervisor is allowed only for resource teardown, has no install/Store/response permission and cannot continue preparation. Cleanup failure is a safe reason code, not a log-only license to leave an executable setup actor current.

Replacing a runtime or peer requires the old **local writer to be quiesced** before activating the new one: pending old envelopes are discarded, no old writer task can start another write, and old endpoints are closed/dropped. An admitted partial/remote request can remain uncertain after that barrier; do not wait for unknowable remote cancellation or call it rejected. If local teardown cannot be confirmed within its budget, remain closing rather than run two locally dispatch-capable peers. Reconnection reads may prepare a candidate outside locks, but cannot publish/activate it before this barrier and its new validation pass.

Use a 120-second total setup deadline including bootstrap, preserving existing tighter connect/handshake/RPC limits. Timeout does not restart the attempt. Large/unavailable history may leave a checked partial cache and an explicit incomplete outcome; it does not permit unbounded setup or task input. Values are implementation acceptance budgets, not native service guarantees.

### Remove, replace and session mutation

Removal first takes the existing session-operation gate, then revokes membership/current epochs under the cell and enters Removing. This is the **revocation linearization point**, before native close or Store delete. Qualified commits and final dispatch admissions serialize with this point. An already admitted call may finish but cannot write through its stale handle. After successful Store deletion, remove the registry entry only if it is still the same slot; any future recreation gets a new incarnation. A failed delete leaves the row and a closed/removal-failed slot, with no automatic runtime restart. A later explicit recovery/connect must reauthorize and resolve the failure rather than revive the revoked actor.

Thread/Agent/workspace/external/auxiliary identity changes follow the same revoke-before-change ordering; no Store helper may silently retarget a live slot. Title/model/policy/archive changes preserve their existing authorization rules and recheck the current row before a command. Archiving cannot authorize writes and does not kill an independent native task. Removal/close callbacks touch only their own resources and matching slot, never a newly inserted Runtime or replacement's status.

## Lock order and qualified effect commit

The locks have this partial order; arrows mean “may be acquired while held”:

```text
registry lookup lock ──► release (never nested with the following locks)

optional existing session-operation gate
                      │
                      ▼
             per-session CommitCell
                      │
                      ▼
               Store connection lock

adapter private mutation serialization ──► final admission using CommitCell
```

- Never acquire the operation gate, registry or adapter mutex while holding a CommitCell/Store lock. Store code never calls back into RuntimeManager. Adapter private state is actor-owned or separately snapshotted; it is not locked while calling a qualified Store commit. No global or CommitCell lock is held across network, async filesystem, process spawn/kill/reap, timer waits or awaitable channel admission.
- Existing operation gates can span a native command as they do today. They serialize local operations, not all event processing. **Normal runtime/peer event commits never wait for that gate**: a command holding it may need those events to finish. They take only the short CommitCell→Store path. Automatic responses release every cell/Store/adapter state guard, obtain the operation gate, then reacquire current qualification immediately before request validation/admission.
- Writable runtime turn/settings projection moves behind the CommitCell. Snapshot readers copy it under that cell. Existing `rt.turn`/`rt.settings` async mutex access must not survive as an independent mutable authority. Adapter-specific snapshot/answered/uncertain state remains in its adapter and is not cleared by this migration.
- Store work inside a qualified commit is synchronous, bounded and contains no native/file I/O; preserve SQLite's existing 5-second busy timeout. This serializes local revocation with the real transaction, rather than checking a token before awaiting an unguarded write. Disk hangs beyond SQLite's contract remain an OS/storage liveness limit, not a claim of hard real-time cancellation. Do not hold this cell while scanning a transcript or hashing files; split those into bounded batches prepared outside it.

A derived child-row effect or passive import that also touches a session with an independent slot first resolves all needed slot Arcs under the registry lock, then releases it. Acquire at most the parent/source cell and one destination cell in stable `(session_id, session_incarnation)` order, then Store; never acquire a second cell opportunistically while holding the first. Validate source qualification and destination identity/current-runtime ownership in that same critical section. Merge child/catalog metadata but retain independently current destination execution status; parent-derived hints remain source-labelled. This is a two-cell cache effect, not a cross-thread command/dispatch lock. Process large child lists one bounded effect at a time. It avoids a Store→registry callback or an unchecked “no child Runtime existed before the await” assumption.

`commit_effect(ticket, effect)` locks the cell, validates membership/session binding/runtime/peer/occurrence as applicable, then performs the actual checked Store and in-memory update while still holding that cell. Rejected stale effects perform zero Store writes, file publication, native responses and `changed` notifications. A Store error is returned to the caller/I03 integration; it cannot be converted into a successful observation. Ordinary current event recording failures retain the existing I03 gap until that separate integration is delivered; I07 does not invent a health state or replay backlog.

Where event and status or mapping changes form one lifecycle transition, provide a checked Store transaction or explicitly ordered checked commits with an incomplete outcome. Do not update the in-memory projection to “persisted” if its required transaction failed. I03 owns the resulting recording incident and I02 owns any operation fence; the lifecycle manager only reports the failure and prevents a stale result from committing later.

## Attach/bootstrap effects and file publication

`harness::attach` and `workbuddy::attach` currently emit initial history/status before `Runtime` installation; WorkBuddy snapshots also write child rows and media, and Harness materializes media during follow processing. Moving only the later event loop behind an epoch check leaves these holes open. All of them move to qualified producers.

1. Start with a SetupTicket and unverified PeerTicket. Handshake/identity reads and native preparation execute outside locks with their required authority. No initial history/status/child-row/file publication happens until that peer validates its topology-specific identity and the selected native thread binding.
2. Bootstrap enters a qualified but nonactive state. Parse/read/download outside locks into one bounded page and private attempt-scoped scratch files. Publish no native-ready projection. Every page's final commit rechecks both tickets and the immutable target mapping, so deletion/replacement during any read/download prevents its later effect.
3. Bootstrap batches are limited to 100 records and 32 MiB of serialized working data. Preserve existing per-media 20 MiB decoded limit. At most 64 MiB/128 newly staged files may await publication per attempt; flush qualified batches before staging more. Reject an oversized individual record explicitly, leaving prior committed cache labelled incomplete. No complete transcript backlog is held for activation. Implementations must page/stream the existing history helpers or fail with an explicit bounded-history result; the current unbounded aggregate vectors cannot be hidden behind this interface.
4. Scratch directories are private and unique to the ticket. Writing them does not publish session history. Final media publication is a short, synchronous, no-overwrite same-filesystem rename/link under the cell, after checking the qualifier and approved destination. No async write remains outstanding against a public upload path after this check. Existing files are reused only after validating their identity/size; never overwrite another generation's file. Stage slow reads/hashes outside the cell. If DB commit then fails, keep only an unreferenced immutable file for conservative cleanup; never emit an event referring to a failed publication or delete a file already referenced by another generation.
5. WorkBuddy child observations are staged effects bound to the parent peer. At commit, use the two-cell cache-effect rule above, validate the exact structured child reference and scoped parent, and create/merge metadata without retargeting an existing child's identity or overwriting a separately current child's execution authority. A conflicting child binding fails closed. Parent-derived status is source-labelled observation, not proof the child's control connection is live. An auxiliary child never becomes writable. No adapter directly calls `save_shared_observation`, `app.emit`, upload publication or status setters after awaiting a snapshot.
6. Before final activation, revalidate membership/binding and complete the required checked preparation/thread receipt. Partial bootstrap failure/cancel leaves only already qualified cache; new `ensure` does not infer that native setup is safe to repeat. Notify one terminal result to all attempt followers.

Passive catalog/persisted-history imports keep their separate source/scope contracts and do not create runtime observations. They may not retarget a live session identity or overwrite current runtime-controlled status as a side effect of import; coordinate their merge guard with the lifecycle binding. Catalog history reads are not changed into native-writability evidence.

## Across-await calls and final transport admission

A handle check at an HTTP handler is insufficient. Every qualified native call captures runtime and peer epochs and, where required, the exact turn/interaction occurrence. Admission is rechecked after every preparatory await and again at the last local writer/invoke boundary. A new current peer never inherits an old queued call.

| Stage | Required behavior |
| --- | --- |
| Read policy, settings, active turn or pending occurrence | Snapshot current qualification. Release state locks before I/O. Preserve adapter allowlists, archive/auxiliary/owner and exact pending/turn checks. |
| Await native/read/preparation result | Retain the original qualifier. Replacement or revocation does not retarget the waiter. Recheck before deriving another mutation or committing returned settings/status/detail. |
| Enqueue to SDK/bridge/adapter | Carry the qualifier, method-specific guard and request phase. Raw `RpcProcess::send/call` is inaccessible to installed runtime consumers. Local enqueue is not wire/native acceptance. |
| Final writer/invoke | In the actual writer under the CommitCell, atomically check current qualification and mark this request `dispatch_admitted`; release the cell and begin its bounded write/invoke as that writer's current work. Do not put it into another unqualified queue after this point. This admission is not a claim that bytes reached the wire. Every nested adapter native mutation, including after refresh/upload/settings reads, uses this boundary. |
| Revocation versus an admitted write | An admission ordered before revocation is in flight and may have an unknown outcome. Drop queued but not admitted old work; abort/close the old endpoint as appropriate, without claiming bytes already attempted were unsent. Never transfer it to a new peer. |
| Native result/late event | Return or expose the actual in-flight outcome to I02/control owner without applying it to a replacement's runtime projection. A stale result cannot clear a fence. Any operation-bound durable reconciliation is authorized through I02's exact identity, not a broad “old epoch accepted” exception to runtime commits. |

For stdio/Unix the check belongs in the actual serialized writer, not just its channel sender. Partial writes stay unknown. For a bridge it belongs before the adapter's final native request enqueue/write, and again for subsequent native mutations in a multi-step method. The existing `accepted` oneshot cannot be renamed native acceptance without a method-specific proof. Read-only calls also retain qualification so their late results cannot update new settings or arm a later mutation.

The final admission is the local ordering point, not proof of a remote expected-turn transaction. Rechecking WorkBuddy's current turn before `cancel(conversationID)` still has its documented native no-CAS window. A command that reached the wire while current is not retroactively classified `not_sent` when a generation changes during the await.

## Runtime/peer generations and topology rules

| Topology | Qualification and reconnection |
| --- | --- |
| Owned Codex/custom stdio | A new transport gets a new peer epoch inside the setup runtime epoch. Validate plugin protocol and actual recognized initialize/thread fields. Missing native version/boot evidence stays unknown. Preserve the narrowly guarded owned-Codex empty-rollout fallback, but make fallback a separately claimed preparation step. EOF/read failure/explicit close immediately revokes admission, even if the event queue is full. No automatic child respawn or input replay. |
| Shared Unix Codex | Keep exact thread/cwd and conditional home checks, no competing-engine fallback, and existing ownership errors. A returned missing home is unknown evidence, not verified equality. A different socket/peer means a new epoch and complete revalidation. First-loaded-owner selection does not prove uniqueness; I11 remains open. |
| Desktop follower | Keep endpoint/peer credentials, targeted owner/source/thread/local-host/stream-v11 checks and canonical snapshot validation. Unsynchronized/invalid revision state invalidates the affected dynamic observation and denies mutations until valid resnapshot; terminal identity/version/closure failure revokes the peer. Preserve adapter `uncertain`, answered reservation and definitive-rejection-only release. Epochs/stream revision are not native boot/application version. Reconnection never clears a previous operation's uncertainty. |
| Harness, same Runtime Arc | On disconnect revoke the peer before forwarding `connection/interrupted`. New transport gets a fresh epoch and must authenticate/follow, validate exact snapshot thread, rebuild baseline and obtain a valid interaction-ready association before each corresponding field can qualify. A second different `$events.ready.clientId` invalidates all existing occurrences before replacement; malformed/missing ready cannot refresh them. Keep prompt/approval responses zero-replay and exact event/client binding. |
| WorkBuddy, same Runtime Arc | Each new Carrier repeats descriptor/browser/unique-renderer/preload validation **and** initial `conversations:get` equality plus `transport=local` for a root conversation before snapshot/publication. Auxiliary reconnect repeats structured child/read-only qualification, never the root-write path. Use a new peer epoch even if thread and descriptor claims are unchanged. Pending bindings include fresh local occurrence, active turn and peer. Preserve refresh-before-answer/cancel, allowlists, model/effort partial outcome and no-CAS limits. Client/native input mapping comes from I02 authority, not copied as evidence that old input may be replayed. |

Adapter private state from an old peer can be used only for safe resource cleanup or identity-correlated reconciliation owned elsewhere. It cannot send a response, update a new projection or publish old child/media/status effects. A pending native request ID reused on a different turn/peer creates a different local occurrence. `connection_lost`/`native_changed` resolution records disable old UI controls; they are not proof the host was answered.

## Bounded receipts, reliable closure and freshness

Lifecycle metadata uses a bounded per-runtime channel: 128 receipts, at most 2 KiB each and 256 KiB aggregate. Receipts contain bindings, typed validation/closure/observation facts and timestamps, never transcript bodies, attachments or provider objects. State-like snapshots may coalesce for the same current binding; occurrence invalidation and closure cannot be silently dropped or coalesced into a healthy value.

The terminal path is separate: sticky revoked flags for the runtime and each peer, plus a monotonic revision in the CommitCell and a `watch`-style wakeup. Overflow, producer failure, explicit close and EOF set the relevant flag synchronously before any best-effort receipt enqueue. Readers inspect the flag as well as the queue. A full queue therefore cannot delay revocation or keep auto-response/native admission enabled. A new peer has a new flag; reconnect never sets an old peer's revoked flag back to false. Overflow revokes the affected peer and rejects new work with a safe `observation_overflow` reason; reconnect, if the topology already supports it, must revalidate and must not replay mutations. Repeated failures coalesce rather than create unique incident objects. I03 alone decides recording-health consequences.

Keep one current peer snapshot per current runtime. Pending occurrences have limits of 128 per session, 4096 service-wide and 2 KiB of metadata each; a service-wide budget counter reserves/releases capacity atomically without locking unrelated sessions across I/O. Exhaustion invalidates permission for that peer; do not drop an arbitrary pending entry and keep the rest purportedly current. Reclaim snapshot/occurrence/receipt budgets on close/remove; no observation tombstone is retained per historical session. Attempt followers are limited to 64; excess callers get a bounded busy outcome and cannot spawn another setup. The new registry is limited to 1024 occupied slots, including opening/active/closing/SetupBlocked slots; at capacity refuse another claim rather than evict a live or uncertain slot. These are lifecycle capacity limits, not a general solution to I06's existing caches/gates. A SetupBlocked owner keeps its slot until the owning durable preparation/control authority has retained the fence or explicit identity-based resolution permits retirement; ordinary LRU/idle eviction cannot remove that protection. Other closed entries retire once resources/waiters finish. Removal revokes identity before reclamation. Durable operation tombstones remain solely I02's responsibility.

Use monotonic time for all freshness comparisons and deadlines. Dynamic turn/pending/settings observations expire after 5 seconds without the corresponding validated native observation; transport-known-open is separate. Capability reads, timers, ping/pong, arbitrary JSON, persisted history and replayed old frames never renew native freshness. Native identity fields can remain bound until revocation while dynamic facts expire independently. Serialize wall-clock observation time only for display. Expired/missing evidence is unknown, not a reason to probe or enable anything.

Expiry affects the observation's evidence, not the historical fact that an adapter registered a particular pending occurrence. It never fabricates a resolution. b1 does not replace existing per-command native guards with a blanket `observed_recently` permission bit, nor broaden them when freshness is unknown. Where a command needs fresh turn/pending proof, its existing or separately reviewed bound read must supply it; a local timestamp or repeated projection read cannot. Positive capability admission based on this evidence remains outside b1.

This bound is for the **new lifecycle observation and bootstrap layer**. Existing SDK transcript/raw-frame buffering has separate I06 limits; it cannot be used as an unbounded bootstrap or observation backlog. Qualified metadata must bypass neither the reliable revocation path nor its budgets merely because the legacy transcript receiver remains active. The complete connected gate tests full data-queue pressure as well as the new receipt queue.

## Existing caller migration and private API boundary

All rows are mandatory for the connected gate; no temporarily public raw Runtime RPC escape is accepted as completed lifecycle integration.

| Existing caller | Required integration |
| --- | --- |
| `api::create` → `ensure_runtime` | Use scoped manager singleflight even without the caller operation gate. Setup result/thread update/initial emit are ticket-qualified. Distinguish deliberate new-session creation from two ensures of one session. Native creation uncertainty remains subject to the preparation boundary below. |
| `shared_host::create` Harness selected-model branch | Existing native create/save and subsequent ensure/settings update preserve their actual phases. Use a qualified handle for the latter; never retarget after settings await. Native create receipt authority is not supplied by an observation. |
| `api::message` / `deliver` / `send_queued` / queue worker | Keep existing gate, but use manager ensure/current handle and I02 preparation/dispatch authority. Every policy/turn wait and native call requalifies. Worker cannot turn a stale handle, reconnect or idle cache into dispatch permission. Native result/event/queue atomicity stays I02-owned. |
| `api::connect` | Same singleflight; return only this attempt's outcome. Preserve explicit `connected:false` history-only compatibility where applicable. It is an explicit side-effecting connect, not a capability GET probe. |
| `api::interrupt` | Existing scoped/auxiliary checks, runtime lookup/ensure and active-turn guards use current handles. Preserve teardown wait. Store-degraded interrupt/queue-memory fencing is an I03 contract, not an error ignored by b1. |
| `api::models` | Managed cold ensure is internally singleflight; shared existing-handle reads qualify despite no existing gate. After releasing the gate, recheck the same handle when committing/returning a bound result; do not cache a new peer's state using an old reply. External catalog reads retain their separate read contract and cannot manufacture observations. |
| `queue_action` replace/unpause/steer | Existing gate plus qualified ensure/call; pure local edit/take/restore/delete/pause remain local and do not gain a native-online requirement. No local action can bypass I02 dispatch fences. |
| `composer::read` | Preserve shared disconnected/offline and external/archive catalog behavior. Managed cold ensure is qualified; shared existing reads and post-gate native results qualify too. No reuse in capability GET. |
| `composer::update` | Keep idle/busy, model/effort/tier/plan/goal, auxiliary/archive and follower support guards. Requalify each step of multi-RPC model/effort/settings/goal work and qualified in-memory settings commit. Partial native results are not rolled back or called unsent by a later stale failure. |
| `editing::{get,post}` and detached execution/cancel | Keep edit journal, fingerprint/target/phase and owned operation gate. Pass a qualified handle into the detached task; it cannot acquire a replacement by ID midway or erase an uncertain edit. Revalidate before each native rewind/resubmit and local commit. A revoked binding stops new edit effects; journal reconciliation remains edit-owned. |
| `catalog::read_history` cold shared fallback | Scoped internal ensure under existing gate, no duplicate setup. Native cache imports/materialization use their source binding and cannot overwrite a current identity from a stale fallback result. Keep history-only reads available. |
| `api::respond`, owned automatic approval | Existing runtime lookup becomes a qualified handle with exact current occurrence. Auto response waits for the operation gate without retaining cell/Store locks, then rechecks. Preserve validation/reservations. Durable response claims remain I03's separate future control contract. |
| History detail / shared-host existing runtime RPC / goal confirmation | Even without ensure, use qualified calls/results and staged media. A stale detail/settings result cannot create current evidence. Read-only outcomes retain explicit unavailable/incomplete errors. |
| Runtime event loop / adapter initial snapshots / subsequent snapshots | Every emit/composer augmentation, Store status, turn/settings, child row and media publication uses the same qualified commit boundary. Qualify before auto response and again at final native admission. Natural loop exit and exited clean only matching epochs. |
| Remove/shutdown/explicit transport close | Revoke before closing; suppress late old effects and pending writer admission. Preserve external-process ownership and Store/ledger deletion semantics. Shutdown cleanup cannot start/recover another runtime. |

Catalog `fork`/shared native creation and any control path outside an installed runtime still need their explicit scoped creation/control authority. They cannot invoke an installed raw RPC to evade this contract. Their independent durability semantics are not silently moved into a generic lifecycle command ledger.

## I02 preparation, I03, versions and alias boundaries

Lifecycle qualification is necessary but never sufficient to authorize native preparation or input. Before message-triggered cold thread start/resume/fallback, upload or other preparation effect, I02 must have resolved the operation identity, claimed that exact preparation step and provided immutable native/artifact identity. The ticket carries a reference to that authority; the final writer checks it along with current binding. Persist the confirmed thread/preparation receipt before activating or continuing input. Lost creation receipt means preparation-uncertain, not another thread/start; a new runtime/peer UUID cannot make it safe.

There is **no durable lifecycle setup journal** in this module. During one process, a setup with admitted but unconfirmed native effects leaves SetupBlocked and prohibits blind retry. Across restart, only accepted durable preparation/creation authority can preserve that outcome. Explicit session creation/connect also have native setup effects outside an admitted message. Their rollout must provide a separately accepted creation/preparation authority, reuse a confirmed durable binding, or fail closed for a side-effecting unbound step. An arbitrary legacy origin token is not such authority. The current legacy create/connect behavior is not evidence of restart-safe deduplication. Root must coordinate that boundary with I02 before accepting the full cold-setup integration; do not smuggle non-message operations into a message operation ID or invent a second ledger here.

I02 also owns native-client-ID availability before WorkBuddy projection and any exact late-result operation reconciliation. The lifecycle manager never clears an operation fence because a peer is now current. I03 consumes the lifecycle binding for recording gaps and reconciliation; valid native snapshots and successful local writes do not clear each other's unknowns. I08 owns supported native-version policy; absent version fields remain unknown. I11 owns multi-owner disambiguation and same-native-thread alias arbitration. Canonical workspace plus session epoch is not proof of native unique ownership or cross-device CAS.

## Delivery modules and complete connected gate

The following split permits independently useful verification without claiming partial runtime safety:

| Deliverable | Files/ownership and acceptance |
| --- | --- |
| A. Private qualifier/transport primitives | New private lifecycle types plus SDK qualified admission/close metadata, injected clock and bounded receipt channel. Existing legacy paths do not consume or advertise them yet. Unit/fake transport validation can accept these primitives, **not** connected stale-actor safety. Keep raw legacy SDK compatibility for catalog/custom transport internals only, never expose it through a future installed RuntimeHandle. |
| B. Connected runtime/adapter migration | `runtime.rs`, App/runtime registry fields, `control.rs`, `shared_host.rs`, `desktop*.rs`, `harness.rs`, `workbuddy.rs`, checked Store effect helpers, staging media and every caller row above. Deliver together or maintain an unactivated branch until all consumers use the mandatory boundary. A “minimal slice” that fences events but leaves initial imports, final writers, old automatic replies or same-Arc reconnect effects unqualified does not pass. |
| C. Preparation-authority integration | Serial coordinated work with accepted I02a/I02b and explicit non-message creation authority. Native thread preparation, native IDs, ambiguity, queue/goal/results and Web stable-ID delivery remain their owners. No two tasks independently change `deliver`, preparation or adapter native-ID dispatch. Needed for the complete cold-setup/no-duplicate-preparation gate; module B alone cannot claim restart safety. |
| D. Later projection/errors/Web/native acceptance | Not b1. Native-positive actions stay denied; typed error migration belongs to b2 and I02b; new capability consumers to b3. Real accounts/upstream/platform acceptance follows the support matrix separately. |

Root assigns disjoint A implementation first if desired, then serial B/C ownership by actual file overlap. Ordinary history remains usable through current scoped cached/persisted routes. No public new lifecycle API or feature flag may turn on only the convenient half of B. A merged but dormant primitive is labelled dormant; a connected implementation is accepted only after the complete negative matrix, including C's durable preparation dependency where setup can mutate.

## Verification and observable changes

Use the production manager/SDK/Store/HTTP paths with deterministic fake adapters, private temp data and ephemeral ports. Barriers/oneshots expose precise suspension points; each test has bounded timeout assertions. Do not rely on sleeps, forced DOM state or “eventually probably closed.” Assert native writes, Store snapshots, sequence IDs, process ownership and cleanup counts, not only errors.

| Negative/positive matrix | Required evidence |
| --- | --- |
| Two same-session ensures from locked/unlocked callers; two distinct sessions | Same session: one spawn/attach/start and one install, followers same attempt; distinct deliberate sessions remain distinct; no recursive-gate deadlock. Same-native aliases do not acquire an unproved wider guarantee. |
| Setup failure/cancel/deadline at spawn/handshake/resume/start/receipt/bootstrap/install | No late install or unowned child; waiters finish; external process untouched; admitted uncertain setup cannot repeat. Verify owned child kill/reap and no new spawn while previous termination is unknown. |
| Delete/recreate/mapping change at every setup await | New incarnation/epoch; old status/event/media/child commit and raw writer count zero after revocation; old cleanup never deletes a replacement. Failed delete retains closed inspectable row. |
| Initial Harness/WB records/media/child observations before activation | Qualification covers initial effects, file publication and status. Replace during download/parse/file staging; no old public writes or orphan reference. Bound stage memory/files; partially committed checked history remains explicit. |
| Same-thread runtime replacement with late event/settings/status/exited/request | Replacement Store/projection unchanged; no old auto/manual response; map still current; no spurious disconnected event or wakeup. Natural receiver close has the same isolation. |
| Command holds operation gate while native event arrives | Event/receipt processing and required native completion progress without gate deadlock; auto-response waits safely then rechecks, never answers obsolete occurrence. |
| Replace after guard, after local enqueue, before writer admission, after wire start and before result | Not-admitted native count zero; admitted outcome conservatively in flight/unknown; no retarget/replay; late result does not mutate replacement; I02 result authority preserved. Cover partial stdio write and socket/bridge queue pressure. |
| Harness same Arc reconnect/ready change; WorkBuddy same Arc reconnect | New peer epoch; malformed identity/snapshot/preload/version fails closed; WB root local identity rechecked on every Carrier. Old approvals/client associations invalid; prompt and response replay count zero; answered/uncertain reservations preserved. |
| Follower wrong source/target/owner/version/thread/cwd/revision, shared Unix absent/mismatched home and multiple owners | No invented verified fields or fallback engine; revalidation/unknown states explicit; snapshot repair does not clear uncertainty. Existing goal pause-only/no-CAS restrictions survive. |
| Current occurrence reused ID/turn change/disappearance/overflow | Exact occurrence required; old response count zero; no persisted event can re-arm it. Native connection-loss resolutions never become acceptance proof. |
| Receipt queue full, producer panic, data queue full, EOF close, repeated overflow | Sticky revocation observed without draining queue; no new admissions; bounded memory/budget release; no unique failure storm or automatically replayed mutation. |
| Clock expiry/rollback, invalid JSON/ping/old frame, repeated pure reads | Monotonic 5-second boundary; false freshness sources do not renew; capability actions stay denied. Scoped/hidden/aux/archive/custom reads produce zero native calls/Store writes and no private fields. |
| Store commit failure, bootstrap partial commit, late accepted operation result | No false persisted observation; no replacement mutation or fabricated cursor; I03/I02 receive actual failure, not an observation-owned repair/replay policy. |
| Compatibility and full consumers | All ensure/existing-handle rows directly exercised, including main/child/queue/edit/goal/approval and locked/unlocked reads. Existing history-only connect, offline cache, scoped event cursors and explicit status contracts retained. No installed raw-RPC path remains. |

Public changes are limited to actual safer command behavior: concurrent same-session setup shares an attempt; stale/closing/overflow calls fail closed; late results cannot update replacement state. Preserve existing `{error}` and explicit status/history-only/partial-success envelopes until typed-error integration supplies additive fields. Do not map generation change after dispatch to an English-substring “not sent.” No new lifecycle capability is advertised and no Web controls are enabled. I02's mandatory operation protocol/upgrade behavior is activated only with its connected first-party integration, never bypassed for older clients.

Independent exact-contract review precedes implementation; exact-source review plus merged regressions precede connected acceptance. No real native version/boot proof, account readiness, Windows hot-attach, WorkBuddy write acceptance, Android lifecycle or cross-device/CAS guarantee follows from this document or its fake tests. Full I03 health/reconciliation, I05 restore, I06 buffering budgets, I08 version lifecycle, I11 alias/owner selection and I07 Web activation remain separate work.
