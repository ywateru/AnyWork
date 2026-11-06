# Existing desktop host IPC: static protocol reconstruction

Date: 2026-11-05. Artifact: ChatGPT.app / com.openai.codex 26.1027.51404 build 23880. This document describes inert source evidence only. No original application was started, attached to, connected to, injected into, or controlled for this investigation. Runtime registration, live socket presence and end-to-end success remain unverified.

## Finding and meaning

The desktop host already contains a second control route alongside its private stdio app-server connection. A host-manager coordination client registers thread-owner discovery and follower operations with a local IPC router. Requests are dispatched into the **existing manager**, which invokes startTurn, steerTurn, interruptConversation, settings updates and approval replies. Existing stream coordination publishes full conversation snapshots and incremental patches. Thus this is a concrete candidate for joining an already-running desktop session without restarting its engine or acquiring its writer lock from a second engine. It is not proof that arbitrary independent CLI processes have an equivalent host.

The routing chain is:

`CODEX_HOME/ipc/ipc.sock -> router dB -> desktop client dj -> dQ owner handlers -> RT.bind(manager) -> manager.handleThreadFollowerRequest -> b9(manager,request)`.

RT.bind's discovery predicate checks the exact manager host and `getStreamRole(conversationId)?.role === 'owner'`. b9 repeats `assertThreadFollowerOwner(conversationId)` before dispatch. No thread/resume in another app-server is required by this routing chain.

## Artifact identity and exact evidence

Source file names below are relative to the extracted `.vite/build` directory. The temporary extraction is not included in the public source archive. All ranges are **UTF-8 byte offsets, end exclusive**, not formatted text character offsets.

| File | SHA-256 |
|---|---|
| early-bootstrap.js | bb8f2f467b40c583d889a52c1048865d3fa11ee123c6147606fc3087470b4c46 |
| early-bootstrap-339-9edb60e5d8b0547e.js | 480cf9c01ab1794c1b788aaf1bc159e96972f341e7f7ec03a53a8769e7b0d175 |
| early-bootstrap-824-3c24dda6dba622ec.js | c387296475ca0729e4be35c4831b512d39316e0f7e24fe4d631ad0d96ec8e13f |
| early-bootstrap-439-a0f25ba32c465de1.js | c23f63f8ff156b2a92a81ee2870d80ab959ced6ce6232d6fe7e54bbefe11d333 |

| Binding | File shorthand | Bytes | Observed purpose |
|---|---|---:|---|
| 92272 | 824 | 205159–207795 | Paths, socket permissions, framed JSON codec |
| dB | 339 | 1113743–1119636 | Router, discovery, correlation, errors |
| dF | 339 | 1119636–1120695 | Existing router reuse / creation |
| dj | 339 | 1120724–1127478 | Client initialize, request/broadcast envelopes, version gate |
| dY | 339 | 1127520–1130853 | Coordination methods and owner discovery |
| dQ | 339 | 1131743–1132903 | Owner request registrations |
| dX | 339 | 1132903–1133099 | Await manager result and unwrap method result |
| RT | 439 | 1458052–1460342 | Actual manager owner-handler registration |
| b9 | 439 | 849682–854000 | Actual manager control dispatch |
| iS / iA / ij / iE | entry | 175097–176463 | Versions and version compatibility |
| handleThreadStreamFollowingChanged | 439 | 709697–710289 | Add follower, send initial or replacement snapshot |
| sendConversationSnapshot | 439 | 710897–711330 | Snapshot of original manager's conversation |
| handleThreadStreamStateChanged | 439 | 706867–709102 | Snapshot acceptance and patch revision rules |
| xl | 439 | 1074287–1078933 | Steer input construction and original turn/steer call |
| SJ | 439 | 903943–905318 | Thread-setting state update |
| host-manager construction o | 439 | 1479611–1490484 | Broadcast transport payload construction |

The development investigation retained extraction manifests and formatted declarations. They are not redistributed with the public project; the source identities and byte spans above support reinspection against an independently installed artifact. Original ASAR identity inherited from prior extraction: SHA-256 `52e0a65f9fea51f4287bbd98c63343761f9424517bb793652bb554764bc0bcc8`.

REA application analysis for selected 339 source: parent `ev_cab17bd4a830b8ec6d91b7fa4931d14290b6c63e765e601e3e2bba359e870e86`; summary `ev_c4f09912c6ebab363e92db17cc6e3e7dc1384481363e92231b6bcc8f3ee58c6a`. The graph reached semantic retention limits and is partial. A subsequent literal feature trace had no retained seed match; it does not establish absence. The exact source spans above, independently recovered with inert Babel AST parsing, carry the concrete chain described here.

## Endpoint, access and framing

On macOS the primary route is `<resolved Codex home>/ipc/ipc.sock`. Module 92272 computes home through module 34338.D. The IPC directory must be owned by current uid and is chmod 0700. The router socket must be owned by current uid and is chmod 0600.

The legacy route is `<os.tmpdir()>/codex-ipc/ipc-<uid>.sock` (or ipc.sock when uid is falsy). The desktop router manager tries the primary route, then a validated legacy socket, before creating a router. **An AnyWork adapter should only connect to an existing validated socket; it should not create a competing router as a fallback.**

Frames are `uint32 little endian byte_length` followed by UTF-8 JSON bytes, **not JSONL, WebSocket or LSP Content-Length**. The reader permits 1 through 0x10000000 bytes inclusive and handles split header/body chunks and multiple frames per chunk. Zero, oversized frame or JSON parse error closes the connection. AnyWork may impose a smaller explicit bound, but must expose that limitation.

In the inspected router dB accept path there is no bearer token or cF native signing-peer authorization. Its observed access boundary is local socket ownership and permissions. This is a bounded static statement, not a security audit. The unrelated dynamic app-tools native pipe does use cF and must not be confused with this router.

## Envelopes, correlation and initialization

A client request has this shape:

```json
{"type":"request","requestId":"uuid-r1","sourceClientId":"registered-client-id","version":1,"method":"thread-owner-discovery","params":{"hostId":"local","conversationId":"thread-id"},"timeoutMs":10000}
```

Optional top-level fields are `targetClientId`, `hostId`, `timeoutMs`. `requestId` is generated per attempt and is used directly by the router pending-request map. The router separately generates IDs for its client-discovery handshakes. Preserve the requestId through every response and use unique IDs to avoid collisions.

Initialize first, using the observed client initialization version 0:

```json
{"type":"request","requestId":"uuid-init","sourceClientId":"initializing-client","version":0,"method":"initialize","params":{"clientType":"desktop"}}
```

```json
{"type":"response","requestId":"uuid-init","resultType":"success","method":"initialize","handledByClientId":"assigned-client-id","result":{"clientId":"assigned-client-id"}}
```

The observed desktop uses `clientType:'desktop'`. The router records clientType and broadcasts it; no enum validation was found in dB.registerClient. A third-party label remains an unverified compatibility choice. Reinitialization on the same socket returns its existing ID. Use the returned ID for sourceClientId; reconnect assigns a fresh ID.

An operation success looks like:

```json
{"type":"response","requestId":"uuid-r2","resultType":"success","method":"thread-follower-read-model-settings","handledByClientId":"owner-client-id","result":{"settings":{}}}
```

An error looks like:

```json
{"type":"response","requestId":"uuid-r2","resultType":"error","error":"no-client-found"}
```

No JSON-RPC `jsonrpc`, `id`, numeric error code, or nested `result.method` is present in this IPC envelope. Internally b9 returns `{method,result}`, and dX verifies method then returns only `.result` to the IPC response.

The router's request target is **optional**, but mutations should pin the discovered owner. Without targetClientId, the router asks all other registered clients whether they can handle the request and uses Promise.any. With targetClientId, it asks only that client. Therefore omitted target can choose any accepting owner and does not prove ownership is unique. Every mutation should verify that its success handledByClientId matches the selected owner.

## Method versions and hostId placement

For **local** follower operations, omit top-level hostId. Include `params.hostId:'local'` for owner discovery. For ordinary local follower control params, conversationId is sufficient; dQ uses envelope hostId or its bound host as the default.

The version function adds 1 to a follower method's base version when a non-null top-level hostId exists. Therefore top-level `hostId:'local'` with a base-version request is **wrong** and yields version mismatch. For nonlocal hosts use their real host ID and base+1, after independently validating routing support.

| Method | Local version |
|---|---:|
| initialize | 0 |
| thread-owner-discovery | 1 |
| thread-follower-start-turn | 2 |
| thread-follower-load-complete-history | 1 |
| thread-follower-compact-thread | 1 |
| thread-follower-steer-turn | 1 |
| thread-follower-interrupt-turn | 4 with expectedTurnId; compatible 3 when no expectedTurnId |
| thread-follower-update-thread-settings | 2 |
| thread-follower-update-daybreak | 1 |
| thread-follower-read-model-settings | 1 |
| thread-follower-edit-last-user-turn | 2 |
| thread-follower-command-approval-decision | 1 |
| thread-follower-file-approval-decision | 1 |
| thread-follower-permissions-request-approval-response | 1 |
| thread-follower-submit-user-input | 1 |
| thread-follower-submit-mcp-server-elicitation-response | 1 |
| thread-follower-set-queued-follow-ups-state | 1 |
| thread-follower-remove-queued-message | 1 |
| thread-follower-clear-queued-messages | 1 |

For interrupt, sender ij returns version 3 when local params omit expectedTurnId or explicitly set it null; receiver iE accepts this compatibility version. Prefer a known exact active turn ID and v4 when stopping that specific turn. Version numbers are artifact-specific, not stable public API promises.

## Owner discovery

Request: method `thread-owner-discovery`, v1, params `{hostId:'local',conversationId:threadId}`. Initial discovery has no targetClientId. Success result is `{supportsUntrustedAppInput:true}`, and owner identity is in `handledByClientId`.

The manager accepts discovery only when its host matches and it owns the conversation stream. Discovery does not load or resume an arbitrary history thread. Unknown or inactive/unowned thread can yield no-client-found even when its history is readable.

Before a start-turn context with nonempty responseItems, dY performs targeted discovery and requires the same target and `supportsUntrustedAppInput === true`; otherwise it throws the stored unsupported-input error. Do not strip that protection when adding rich app context.

## Control params and results

The following table contains **directly observed consumed fields and exact result wrappers**, not a complete validated schema for every nested payload. Payload types labeled opaque below must be preserved according to the corresponding original app-server/desktop schema. The local IPC dispatcher itself does not validate all nested fields before invoking manager methods.

| Method suffix (`thread-follower-`) | Params consumed by b9 | Success `result` |
|---|---|---|
| start-turn | `{conversationId,turnStart}` | `{result:<manager.startTurn return>}` |
| steer-turn | `{conversationId,input,restoreMessage,serviceTier?,attachments?,clientUserMessageId?,additionalContext?,toolOutput?}` | `{result:<manager.steerTurn return>}` |
| interrupt-turn | `{conversationId,mode,expectedTurnId?}` | `{ok:true,interruptedTurnId}`; optional `goalPauseError` |
| read-model-settings | `{conversationId}` | `{settings:null | {model,reasoningEffort,daybreakEnabled,resumeState,mode,threadSource,modelProvider}}` |
| update-thread-settings | `{conversationId,threadSettings,activeTurnId?,condition?}` | `{applied:boolean}` |
| update-daybreak | `{conversationId,daybreakEnabled}` | `{ok:true}` |
| command-approval-decision | `{conversationId,requestId,decision}` | `{ok:true}` |
| file-approval-decision | `{conversationId,requestId,decision}` | `{ok:true}` |
| permissions-request-approval-response | `{conversationId,requestId,response}` | `{ok:true}` |
| submit-user-input | `{conversationId,requestId,response}` | `{ok:true}` |
| submit-mcp-server-elicitation-response | `{conversationId,requestId,response}` | `{ok:true}` |
| load-complete-history | `{conversationId}` | `{revision:<snapshot revision>}` |
| compact-thread | `{conversationId}` | `{ok:true}` |
| edit-last-user-turn | `{conversationId,...original edit options}` | `{ok:true}` |
| set-queued-follow-ups-state | `{conversationId,state,discardedMessageIds}` | `{ok:true}` |
| remove-queued-message | `{conversationId,messageId}` | `{removed:<coordinator return>}` |
| clear-queued-messages | `{conversationId}` | `{messages:<coordinator return>}` |

`turnStart` is the desktop shape `{request:<native turn request>,context?:<desktop context>}`, not the raw native turn/start params directly. The observed start path enforces `turnStart.request.threadId === conversationId`. A text candidate is `{request:{threadId,input:[{type:'text',text:'...'}],clientUserMessageId:'unique-message-id'}}`; acceptance of omitted optional desktop context still needs an independent test. Desktop context can contain attachments, commentAttachments, inheritedSelection, restoreMessage, messageThreadId, MCP app model context attachments, responseItems, passiveContext, permission selection, and threadStartKind. Do not discard these when claiming lossless parity.

Steering requires a real `restoreMessage` object. xl directly accesses `restoreMessage.id`, `.cwd`, `.context.workspaceRoots`, `.context.collaborationMode`, `.context.commentAttachments`, and `.responsesapiClientMetadata`. Its optimistic steering item stores this object for later restoration. Therefore passing only native `{threadId,input,expectedTurnId}` to the follower steer method is insufficient. A candidate restore object may include `{id:clientUserMessageId,context:{workspaceRoots:[cwd]}}`, but its full required UI restore contract is not yet independently validated. The owner resolves its current active turn itself, then calls native turn/steer with expectedTurnId and preserved clientUserMessageId.

`threadSettings` is the native settings update fields; observed effort field is **`effort`**, while read-model-settings reports **`reasoningEffort`**. SJ also handles model, collaborationMode, serviceTier and permissions/sandbox fields. Without activeTurnId the owner updates settings for next turn. With non-null activeTurnId b9 calls `updateThreadPermissions`, not the general next-turn updater. `condition` can include `ifEffortEquals` and `ifModelEquals`; an unmet condition returns applied:false. Do not assume arbitrary in-turn model edits from this branch.

Approval `requestId` inside params is the **original pending request ID from the conversation**, separate from envelope requestId. Preserve its type and source owner. `decision` and `response` are opaque original method payloads; do not invent enum values or normalize numeric/string IDs. The response only acknowledges dispatch; pending-request removal in a later owner state update is the completion evidence.

For interrupt, observed modes include `user-stop` and `system`. A user-stop can interrupt successfully while failing goal pause: b9 returns ok:true, interruptedTurnId and goalPauseError. Preserve this partial-success distinction.

Queue state uses `state[conversationId] ?? []` and discardedMessageIds. It is the desktop coordinator's queue state, not an independently validated synonym for native thread/queue APIs or AnyWork's private queue.

## Following and state snapshots

Broadcast envelope:

```json
{"type":"broadcast","method":"thread-stream-following-changed","sourceClientId":"assigned-client-id","targetClientIds":["owner-client-id"],"version":1,"params":{"conversationId":"thread-id","hostId":"local","following":true}}
```

The router excludes the sender, honors optional targetClientIds, and overwrites broadcast sourceClientId with the registered sender's ID. The array is top-level, not inside params. An empty array intentionally reaches nobody. Following broadcasts have no requestId and no direct response.

The owner registers the source client as a follower. The first follower triggers a new snapshot revision; an additional follower gets the current revision's snapshot. Repeating following:true for an existing follower also sends a fresh snapshot at the current revision, making it a possible resync request. following:false removes the follower. A repeated follow is not a task start or thread restore.

A snapshot arrives as:

```json
{"type":"broadcast","method":"thread-stream-state-changed","sourceClientId":"owner-client-id","targetClientIds":["assigned-client-id"],"version":11,"params":{"conversationId":"thread-id","hostId":"local","change":{"type":"snapshot","revision":7,"conversationState":{}}}}
```

The inspected snapshot consumer assigns the snapshot sender as owner for a followed conversation; it does not perform the same prior-owner check used for patches. An AnyWork adapter should independently pin the selected owner before accepting a snapshot.

conversationState is the **whole original manager thread object**, serialized through Object.fromEntries(Object.entries(state)); this is not native thread/read output. It includes the manager's turns/history, settings, pending requests and UI execution state when present. Retain unrecognized fields. No snapshot is sent if manager lacks a conversation, transport, or owner role. A following broadcast alone does not prove subscription success; wait for a matching owner snapshot.

Incremental update:

```json
{"type":"broadcast","method":"thread-stream-state-changed","sourceClientId":"owner-client-id","targetClientIds":["assigned-client-id"],"version":11,"params":{"conversationId":"thread-id","hostId":"local","change":{"type":"patches","baseRevision":7,"revision":8,"patches":[{"op":"replace","path":["title"],"value":"new title"}],"acceptedTextChanges":[]}}}
```

Patches use Immer-style array paths and add/remove/replace operations, not RFC6902 string paths. The desktop consumer only accepts a patch whose baseRevision equals its current revision and whose source matches its owner, then applies patches and updates revision. acceptedTextChanges is a separate optimization/accepted transcript channel and is not identical to ordinary patches. The inspected consumer simply ignores a mismatched revision/source in this handler; automatic resync in that branch was not observed. An AnyWork adapter should explicitly request a replacement snapshot by reannouncing following:true on a revision gap. A third-party implementation should not silently drop the text channel until its correctness is demonstrated.

Other relevant broadcast versions:

- thread-stream-following-status-requested v1, params `{conversationId,hostId}`. Existing followers answer with targeted following:true; this is not an owner snapshot request by itself.
- thread-queued-followups-changed v2; full queue payload still needs separate contract verification.
- client-status-changed v0 for methods absent from iS, params `{clientId,clientType,status:'connected'|'disconnected'}`. Client reset is locally emitted as ipc-connection-reset v1.

On socket loss clear owner/subscription correlation, invalidate pending requests and discover again after reconnect. Do not replay a mutation merely because the response was lost; the operation might have already reached the original manager. Restore subscription with following:true and use original clientUserMessageId/pending snapshots to reconcile.

## Router and owner errors

Observed router errors: `no-client-found`, `server-closed`, `client-disconnected`, `request-timeout`. Discovery probes can internally fail as `client-not-found`, `client-cannot-handle-request`, `timeout`; router find failure maps to no-client-found. A specified target does not bypass its discovery predicate.

Observed client errors: `request-version-mismatch`, `no-handler-for-request`, `error-handling-request` or the thrown manager's Error.message. Local client lifecycle failures include `not-connected`, `not-initialized`, `connection-closed`, `initialization-timeout`, `disposed`, `timeout`. Owner loss or missing stream can produce `no-client-found: thread stream owner became unavailable`, `Conversation ... is not being streamed.`, or an inactive-turn error. Manager assertThreadFollowerOwner prevents operations after role loss even if discovery succeeded earlier.

dX bounds normal follower operations to dH=5000 ms and complete-history to 300000 ms. Caller/router also have their own timeout. A timeout is an unknown delivery outcome, never proof that a mutation did not execute.

## Independent verification plan and outstanding blockers

A useful isolated test can launch a fixture that owns a real independent CLI app-server and implements the recovered host-router/manager boundary. Keep its engine PID, thread ID and active turn ID fixed, then verify second-client discovery, subscribe, steer, approval, settings, interrupt, disconnect and restart-free reconnection through this IPC framing. Include stale owner IDs, wrong versions, hostId placement, revision gaps, unknown delivery and duplicate message IDs. This validates the AnyWork adapter against the recovered contract but does not prove real desktop integration.

Stronger controlled replay can exercise the inertly extracted dB/dj/dQ logic with explicit fixture-only stubs and test manager functions; never execute the original bundle bootstrap or connect to the original app as a side effect. Such replay must be labeled controlled replay, not original runtime evidence.

On 2026-11-05 the scoped real-desktop acceptance passed current automatic review and was executed: verified socket UID and restrictive permissions; read-only initialize/discovery/snapshot; real Rust HTTP adapter on the same thread/cwd; one labeled steer through live AnyWork into this existing active desktop task. The original turn acknowledged it, and the message arrived in the original desktop conversation. Thread, turn, opening input, model, effort and owner stayed unchanged. All observed original app/Codex PIDs and start times were retained; this does not independently map every IPC owner to a specific engine PID. Only AnyWork was restarted to validate durable configuration and reconnection. The original app was neither modified, restarted nor injected. Real-desktop pending approvals, interruption, idle start, native queue and complete tool parity remain untested. Earlier reports of an approval boundary describe the earlier stage and are not a continuing blanket prohibition.

This route only serves threads with a live desktop host manager owner. A stand-alone CLI stdio engine lacking both this host and a shared engine listener remains a separate case. Do not remove that distinction or claim universal arbitrary-process injection from this finding.


## Candidate client and isolated verification

`scripts/desktop-ipc-client.py` provides an independent transport prototype; `scripts/desktop-ipc-test.py` verifies it against a temporary host fixture. The prototype is not wired into AnyWork's runtime and is not enabled by the live service. The CLI requires an explicit socket and fixture conversation ID, then discovers the owner and reads a complete snapshot; it does not print conversation contents. No original desktop connection was attempted.

```sh
python3 scripts/desktop-ipc-test.py
```

Eleven isolated checks passed: split Unicode frame decoding, initialization, owner discovery and pinning, preservation of unknown snapshot fields, opaque restore/approval payloads and original request-ID types, cross-thread rejection, unknown outcomes without replay (including router timeout and owner loss), disconnect/reconnect identity, concurrent request correlation, follower non-ownership, interrupt compatibility versions, stream-version rejection, invalid frames, and existing-socket ownership/permission checks. These are fixture transport checks, not original-desktop or real-engine IPC integration results.

The current prototype accepts complete snapshots only. It does not implement the desktop's Immer patches, acceptedTextChanges channel, rich restoreMessage construction, native-event translation or shared queue coordinator. It preserves opaque caller-supplied payloads and never claims that their nested contracts have been validated. All of those pieces, plus a controlled real-desktop fixture, remain required before production integration and hot-takeover acceptance.

## Rust adapter implementation

The opt-in Rust adapter now lives in `crates/server/src/desktop.rs`, `desktop_ipc.rs` and `desktop_state.rs`. It implements framed transport, pinned owner calls, transactional patches, epoch-bound pending responses, native read views and live/durable history merge through real AnyWork HTTP routes. Eight isolated HTTP fixture checks passed; the live service has no desktop endpoint configured. This supersedes the Python prototype implementation-status paragraph above, not its historical test results. Rich attachment restoration, specialized merge options, shared queue/edit/goal operations and original desktop runtime acceptance remain incomplete. See [implementation and limitations](desktop-adapter.md).
