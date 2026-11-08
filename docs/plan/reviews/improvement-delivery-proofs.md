# I02b delivery-proof research — independent static review

Result: **PASS as design input**, with one nonblocking clarification. No P1/P2 blocking finding. This does not accept a new proof type, connected ledger integration, native acceptance guarantees or real-agent interoperability.

Reviewed candidate: `a21f793b3704bc93e574532360146489a7395298`, only `docs/plan/analysis/delivery-proofs.md`. Review date: 2026-11-08. Reviewer is independent of this research and the ledger implementation. The SDK A candidate authored by this reviewer is outside this review and was not edited or used as evidence of connected safety.

## Scope and source identity

- Product source: `aacaa19b98314976b34e91f11c12326c6ad6ad7c`. Independently checked that the research baseline `e3eee4b0174e5db8540f29f02395ece5e6c83e82` has no differences in `crates/`, `scripts/`, `web/`.
- Ledger source: exact `8d579347831ee5c17cf2561e14ef95efd17c9ae9`, read through Git objects, not substituted with current-main line numbers.
- Harness reference: `/Users/water/work/2026/any-work/ref/deepseek-harness`, clean working tree at `fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159`.
- Recomputed the five cited Codex schema hashes, WorkBuddy `conversations.js` and `.formatted` hashes, and the three selected Desktop static excerpts' hashes; they match §2/§5. These checks establish retained-file identity, not native version negotiation or a missing schema-generator provenance.
- Read existing static source/excerpts only. No new REA run, native process/profile/account access, network operation, build, product test, model call, production service operation or source change. Historical actual/fake acceptance evidence is referenced as historical evidence, not independently rerun here.

## Checked chains and findings

| Boundary | Independent source check | Assessment |
| --- | --- | --- |
| Transport receipt versus method result | `crates/agent-sdk/src/lib.rs:69–103,106–165,184–243,246–301`; Desktop bridge `desktop.rs:258–277`; Harness bridge `harness.rs:558–569`; WorkBuddy bridge `workbuddy.rs:1104–1115` | Correct: raw Unix send acknowledges queue insertion; stdio acknowledges local write; Desktop method bridge accepted can be Ok even when its RPC response contains an error. None is a generic native-input receipt. SDK pending correlation is connection-local and late results are not a durable outcome journal. |
| Codex result versus actual user item | Retained `TurnStartResponse`, `TurnSteerResponse`, `TurnSteerParams`, `ItemCompletedNotification`; `api.rs:484–503,525–571`; `catalog.rs:356–409` | Correct: start requires a turn but not an exact-client user item; steer returns only turnId. Local echo/UI conversion cannot establish raw item provenance. Generator/native-version uncertainty is explicit, and the document does not approve ACK-only acceptance or client-ID-based replay. |
| Desktop expected-turn and nested attempts | `desktop.rs:683–694`; `desktop_ipc.rs:141–194`; selected b9 excerpt:110–129, xl:63–172 and dX:1–8 | Correct: caller expectedTurnId is locally compared, then omitted from follower payload; the owner invokes manager.steerTurn without it. xl obtains its own turn and can call `s(i)` a second time after helper classification. The document explicitly leaves `Sb`/`xd`/`m6.q3` classification unproven. It does not claim the first native attempt is provably rejected, equate one follower invoke with one native write, or authorize retargeting the ledger's saved expected turn. |
| Desktop raw versus synthetic observations | `desktop_state.rs:196–228,581–606`; `catalog.rs:613–621` | Correct: params-based `desktop-user:<turn>` and converted steering items can be synthetic even when exposed through `native_turns`; serverUserMessageId/clientId reconciliation needs original provenance. Follower success, optimistic accepted state and normalized history IDs remain insufficient. |
| Harness inbox acknowledgement | P `harness.rs:230–266,760–812,1204–1287`; upstream `session-controller/src/index.ts:468–491`, `commands.ts:321–412`, `types.ts:323–337`; also Agent/inbox/Session paths below | Correct at the stated inbox-admission level: immutable business requestId is distinct from transport rpcId, source.rpcId enters the native log, inherited entries are excluded by upstream dedup, and expected-turn CAS is absent. The proposal remains method/version-specific, not bridge accepted=true. See N1 for a stronger explicit memory/persistence statement. |
| WorkBuddy invocation result and actual request | P `workbuddy.rs:325–368,1389–1439`; retained artifact:23352–23490,33950–33967,35366–35379 | Correct: sendPrompt may enqueue or start asynchronous dispatch and return void; another facade can consume a queued receipt. Adapter-produced turn/status and nativeDisposition do not prove engine request execution. Snapshot failure occurs after invoke and cannot be classified as proof that the input was not sent. Dynamic/preload/engine provenance and native write acceptance remain open. |
| WorkBuddy mapping before first snapshot | P `workbuddy.rs:565–575,601–609,640,764,1077–1086,1128–1130`; retained artifact:25721–25740,25829–25849 | Correct: clients starts empty, initial snapshot emits before Runtime installation, reconnect preserves only the in-memory mapping, and unchanged native-record digest suppresses later re-emission. Hydrating the persisted native-request/client/operation map before snapshot/proof extraction is necessary. Native client enhancement can use content/unique-new-item fallback, so it is not interchangeable with exact persisted identity. |
| Ledger authority and acceptance interface | L `Binding::check:343–382`, admission:943–959, `match_receipt:1432–1444`, dispatch:1670–1801, result:1843–1859, reconcile:1933–1952, accept:2092–2110 | Accurate: structural receipt validation requires nonempty item and exact thread/client/native-request identity; it does not authenticate provenance or enforce expected-turn equality. Permit is one attempt; worker Start and explicit selection are distinct authorities. Uncertain reconciliation is not restricted to recovery-required rows. Atomic echo/queue removal is an acceptance consequence, not independent proof. |

The document's proposed tagged proof variants and pre-invoke durable correlation requirements are clearly marked as future, independently reviewed I02b work. It preserves immutable binding, the one-attempt rule, post-invoke uncertainty, preparation ownership and native-positive denial. Its negative matrix distinguishes native invocation count from native accepted count and explicitly labels all new tests unexecuted.

## N1 — nonblocking: make Harness's asynchronous persistence boundary concrete

Target: analysis §7.1, especially lines 164–168. It already says ACK is not a crash-durability guarantee, so this is not an unsafe acceptance claim or a blocker for research input. However, the cited reference contains a stronger source-level fact than “fsync/physical power loss not audited”:

1. Upstream `packages/core/agent-loop/src/agent.ts:170–184`: followup/steer synchronously call send, which calls inbox.splice.
2. `packages/core/agent-loop/src/inbox.ts:215–223`: splice constructs and synchronously appends `agent/inbox/spliced` with the identified message.
3. `packages/core/session/src/index.ts:765–772`: append commits to the in-memory Session log without waiting for I/O; persistence plugins buffer asynchronously, and observer failures do not change append's return value.
4. `packages/session/session-persistence-jsonl/src/storage.ts:274–281,549–559`: the session-event observer enqueues a live copy for a later background drain; session/flush separately drains and flushes. `session-persistence/src/handle.ts:89–111` also distinguishes append visibility from the durability barrier.

Recommended clarification: a successful session/prompt response proves the matching request entered the native live inbox/log at that moment; the prompt method itself does not await a storage drain/flush. Background storage failure or a process crash before that drain is therefore outside its acceptance proof, not merely an unmeasured disk-fsync detail. A read from that same live Session is not by itself evidence of durable persistence. Keep the proposed HarnessInboxAck semantics explicit about this limit; do not add retry, infer absence after restart as rejection, or claim completion.

This evidence strengthens the existing conservative conclusion without approving a new Store receipt variant. Typed contract decisions and actual fault/restart acceptance remain separate gates.

## Remaining gates

- A PASS here authorizes using this research as input to a separately reviewed contract. It does not authorize implementing or enabling HarnessInboxAck, DesktopOwnerAck or WorkBuddy proof variants unchanged.
- Native version/instance evidence, Desktop's complete start chain and internal error classification, WorkBuddy's actual preload/engine request provenance, and real post-restart readback remain absent or explicitly limited.
- Connected final-admission B/C, durable preparation/creation, before-snapshot map hydration and API/ledger atomic-result fault tests still need implementation and independent acceptance. No current capability or support label changes through this review.
