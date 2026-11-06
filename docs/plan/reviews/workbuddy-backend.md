# Independent review: experimental WorkBuddy shared-desktop backend

Result: **PASS for experimental local-main source integration; installed native writing/E2E gate remains OPEN.** Final reviewed product commit is `46fed888579eb223538d6b391405bcbea8d005d8`, following baseline `cd6699ac8d9dcd34aeb05b5fb6624f514cb0bf66`, error/nonce fix `58830e5cf6bd41a5c7cd9faa486e3e821de6cf91`, and metadata-only native error test `0b9abc10001576616b87b09a062909f90a527604`. Verifier `harness_verify` is independent of the developer. No open code blocker was found in the final candidate within the reviewed contract. This result authorizes neither publication nor a claim that full WorkBuddy collaboration is verified.

## Scope and committed source

Reviewed fixed CDP transport and discovery identity, native call allowlist, shared-host dispatch, per-Agent import persistence/scope, request/history/media projection, model privacy and settings, read-only child conversations, busy queue/cancel, approval isolation, disconnect ownership and mutation failure behavior. UI/launcher review belongs to the separate independent verifier.

Relevant final source locations:

| Boundary | Source |
| --- | --- |
| Loopback/no proxy/no redirect transport; browser instance and renderer version/profile identity | `crates/server/src/workbuddy.rs:102` |
| Private descriptor ownership/mode, ancestor symlink and file-size checks | `crates/server/src/workbuddy.rs:182` |
| Fixed native method evaluation and error projection before receipts/public metadata | `crates/server/src/workbuddy.rs:328` |
| Workspace-scoped native imports; partial catalogs rejected before saving observations | `crates/server/src/workbuddy.rs:385`, `:423` |
| Native create once; save only a valid native conversation returned in selected workspace | `crates/server/src/workbuddy.rs:469` |
| Request projection, source identity, pending occurrence/turn owner, disconnect invalidation | `crates/server/src/workbuddy.rs:559`, `:720`, `:774` |
| Read-only snapshot/materialization, reattachment without mutation replay | `crates/server/src/workbuddy.rs:797`, `:896`, `:962`, `:998` |
| Fresh snapshot before answering; exact local identity and native pending checks | `crates/server/src/workbuddy.rs:1091` |
| Child references/observations without changing the desktop's current subscriptions | `crates/server/src/workbuddy.rs:1417` |
| Atomic per-Agent import replacement and durable per-session source replay identity | `crates/server/src/store.rs:461`, `:535` |

No adapter call changes native `current` subscriptions, disposes the desktop's existing subscribers, replaces its event handlers, closes its application or starts another agent engine. Code calls only fixed allowlisted methods with serialized arguments; arbitrary evaluation/account/authentication methods are not Web API capabilities. Existing file/image routes still apply authenticated session/workspace/upload boundaries. WorkBuddy children reject send/cancel/settings; goal, plan, fork and unsupported interaction choices fail rather than falling through to Codex.

## Historical blockers and closure

| Finding | Independent evidence and consequence | Final closure |
| --- | --- | --- |
| **B1:** actual native `__wbError` was treated as a value | Installed 5.9.3 get/create resolved `{__wbError,code,source,message}`. Baseline checked only `errorCode`, risking failed projections and false mutation confirmation. | `58830e5` rejects both envelopes before every projection/receipt, exposes only fixed operation plus allowlisted code and setup guidance, and omits raw message/source. Actual installed create returned safe HTTP400; get-only native test passed on `0b9abc1`. |
| **B2:** reused pending IDs could match previous occurrences | Baseline local identity used only conversation, connection generation and native tool/pending ID. Native IDs may repeat on the same peer. | `58830e5` adds a fresh occurrence UUID; repeated poll of one occurrence remains stable. Unit/full carrier checks reject previous occurrence and peer IDs. |
| **B2 follow-up:** an intervening empty pending snapshot may never be observed | Equal pending metadata on a different native turn could retain an old button and fail to surface the next actionable permission. Store terminal events reject many old responses, but do not replace the missing new request. | `46fed88` binds pending identity to active native request, resolves/reissues even with identical pending content, and refreshes canonical snapshot before response. A deterministic CDP desktop-side atomic turn swap immediately followed by the old response returned409; a fresh local request answered once. |
| Failed send could leave optimistic `starting` | Authoritative idle snapshot might be skipped by status deduplication after a rejected send. | `58830e5` invalidates cached status before send, so next native snapshot restores actual state without fabricating turn lifecycle events. |

These findings are closed for the candidate code. Fresh snapshot checks are not a native transactional compare-and-swap: the underlying desktop resolve/cancel methods do not expose an atomic expected-turn argument. The final code narrows the stale window and validates observed ownership; it does not claim an upstream transaction guarantee.

## Independent execution

Ran commands separately and checked their exit status. Final WorkBuddy focused tests ran on exact `46fed88`: **9 passed, 2 deliberately ignored native opt-in tests**. Store focused tests on `0b9abc1`: **12 passed**, including mixed-Agent invalid batches, atomic Agent-scoped deletion, managed-row/history retention and generic/legacy Harness replay identity. Later `46fed88` changes touch only WorkBuddy pending handling and its test fixture; store implementation is identical.

```sh
cargo test --locked --offline -p anywork workbuddy::tests -- --nocapture
cargo test --locked --offline -p anywork store::tests -- --nocapture
ANYWORK_BINARY=/private/owned/anywork-46fed88 node scripts/workbuddy-carrier-test.mjs
```

The final carrier run used an immutable private copy of the developer-built final binary, SHA256 `1cb3688c66cb310a7384789290329318a36e6ace65001866049362d8bcd1675f`, after checking clean worktree HEAD. Full real-Chromium/CDP protocol fixture **passed**. Its native preload implementation is deterministic test data, not installed WorkBuddy execution.

That fixture exercised existing native-ID catalog/history, source replay protection, tool detail/document/image resources, child read-only views, public model projection and settings, metadata create, text/injection-resistant JSON, multipart image input/history/authorized bytes, local busy queue exactly once, cancellation, one-time permission/question responses, waiting state over catalog refresh, two-session isolation, peer reconnection, old-ID rejection across occurrences, no-intermediate-null turn swaps, failed-send state recovery, no fabricated cancel/approval success, and owner survival after AnyWork detaches. Native `__wbError`/legacy errors were rejected across list/get/create/models/send/cancel/approval/model/effort calls without raw secret-bearing messages entering responses or logs.

## Actual installed artifact evidence

Ran unchanged `/Applications/WorkBuddy.app`, version **5.9.3**, with owned temporary config/userData/workspace. Existing user WorkBuddy, Codex and production AnyWork were not used as test subjects. No installed artifact was modified/copied/patched/re-signed. The actual renderer exposed original `window.__wbInvoke` and `window.__wbEventBridge`; version/profile checks passed, event subscribe/unsubscribe worked, and list/model reads crossed the real preload boundary.

Independently ran the opt-in read test on `58830e5` and metadata-only get error test on `0b9abc1` against that actual isolated application. Read produced 0 conversations and 3 public model entries; native catalog was `partial:true`, so this is **not** a successful complete empty-catalog acceptance. The adapter returned a discovery warning and retained previous observations rather than treating the partial result as authoritative removal.

A metadata-only native create with local transport and a stable owned ID was rejected. A narrow diagnostic identified `[LocalConversationsImpl] create failed: no user id`; get of that failed ID separately reported incomplete provider lookup. Source extracted from the installed artifact confirms `LocalConversationsImpl.currentUserId()` reads `context.accountProvider()?.uid`, and insert rejects a missing user ID before model/cwd processing (`ref/workbuddy-5.9.3/main/node.js`, lines48/105). Its account provider is supplied by `authenticationManager.currentSessionSubject` (`ref/workbuddy-5.9.3/main/server.js.formatted:93678`). Bounded inspection established no supported offline identity setup for this fixture. A custom loopback model does not supply that account identity. No account/token/uid was fabricated, and no real account credentials were read.

An isolated AnyWork service using `58830e5` called actual native create once through `/api/sessions`. It returned **HTTP400**, safe `conversations.create (UNKNOWN)` and desktop initialization/account guidance, without native raw error details. No successful session row appeared after rejection; no prompt was sent. The `0b9abc1` native get-only opt-in test then independently confirmed safe rejection of the observed real error envelope. These product paths are unchanged in final `46fed88`.

## Isolation, cleanup and remaining gate

Native research used a tested outer macOS seatbelt: deny real home reads, writes outside owned paths, persistent LaunchServices mutation, credential services/Apple Events, and all outbound IP networking. Only AppKit temporary process registration and exact own-PID Unix sockets were allowed. Native child probes verified external writes, other PID sockets and persistent scheme modification remained denied. Shared browser directory stayed user-owned0700.

Chromium nested sandbox initialization failed under this outer seatbelt. The isolated research process used **test-only `--no-sandbox`**, with the outer restrictions inherited and verified, plus test-only proxy suppression. This is an explicit instrumentation difference; it is not a product launcher requirement or evidence of normal uninstrumented startup in this external sandbox. An earlier proxy-deny experiment was invalid because generic localhost access won; it was stopped and replaced by all-IP-outbound-denied rules before final probes. The private investigation retains this correction.

After native probes, stopped only verifier WorkBuddy process group46921 and removed its own browser/office socket paths. Verified pre-existing WorkBuddy PID46809 remained alive and production3210 listener PID25254 was unchanged before/after. The native fixture is now stopped. Private evidence remains under `/private/tmp/anywork-workbuddy-isolated-rt63wcur`, including `verification-current.md`, safe `verify-anywork-error-result.json`, native diagnostic shape files and `cleanup-final.json`; no debugger identity or credentials are reproduced here.

**Open feature gate:** actual installed native conversation creation/history/send/cancel/approval/attachment/reconnect and same-desktop end-to-end collaboration have not passed. The fresh signed-out native repository requires normal upstream WorkBuddy account/setup before local conversation creation. The user must complete that setup normally; this review does not invent a bypass or assert every `UNKNOWN` error means login failure. Once ready, repeat isolated native history/delivery/approval/resource acceptance with a deterministic local provider. Full fixture success and read-only native success must not be presented as completion of that gate. Experimental local-main integration can proceed; release and full feature acceptance remain unauthorized/unresolved.
