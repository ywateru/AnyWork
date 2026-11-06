# Harness independent verification preflight

Status: preparation complete. Committed UI, companion and backend were independently reviewed and accepted; see [backend acceptance](harness-backend.md), [UI acceptance](harness-ui.md), and [companion acceptance](harness-discovery.md). Historical preparation observations below retain their original context.

## Contract observations

- Remote reference revision: `24160bd52e070f55e4e5a949d111644ca4a9a763`.
- Actual npm target is `@deepseek-ai/dsh@0.2.2-rc.1`; its package requires Node `>=24.9.0`. The verifier installs both under `/private/tmp/anywork-harness-verification/runtime`, outside the product and real user Harness home.
- Published `dsh-client-connection/README.md` documents API authentication via `GET /connect?token=...&interactions=answer|none`, a signed API cookie and one owning `/api/remote.mux` socket. Closing the owning socket invalidates that API Peer. Authorization-header launch-token authentication is not supported. Browser root token exchange uses a different shared browser Peer.
- The Gateway uses `client-request` envelopes for unary HTTP and `{type:"open",streamId,endpoint,payload:{args}}` multiplexed streams. Every invocation must carry a live Peer. Answering approvals requires an `answer` Peer and `$events` ownership; source request IDs must survive the adapter.
- Session follow first returns a snapshot/cursor. Journal events, source event sequences and assistant-stream attempts must retain their identities across replay and reconnection. A transport failure must not replay prompt/approval mutations.
- Upstream 0.2.2 image retrieval requires the full image-attachment reference, not a bare id. Subagents use a durable parent address; plain child-session access may be rejected as agent-busy.

## Running forms and scope fence

The npm `dsh-official-bundles/lib/index.js` shipped templates are `acp`, `web`, `headless`, `sdk`, and `sdk-minimal`. No shipped TUI template is present in this published version. A process launched as `dsh web` is an official CLI-launched Host with a shareable authenticated Web Gateway; an arbitrary headless, SDK or external TUI process is not thereby controllable. Shared session files alone do not establish shared active execution ownership.

Official Desktop source `apps/desktop-host/src/index.ts` starts the `desktop` profile using the Web application with `--host 127.0.0.1 --port 0` and sends the authenticated URL to Electron over its private child-process IPC. No public port/token discovery file was found in that path. An explicitly configured, legitimately obtained compatible Host URL is a viable carrier. Automatic discovery or seamless takeover of arbitrary Desktop/TUI processes remains unverified and must not be advertised on the strength of a new Web Host fixture.

## Planned independent acceptance

1. Start actual published Harness in a fresh `DSH_HOME` and workspace on loopback 9387 with an OpenAI-compatible deterministic local model on 9386. Scrub inherited model keys and disable title-model generation; never use real provider keys.
2. A separate native carrier client creates a workspace/session and sends a prompt before AnyWork connects. Record exact host and session IDs.
3. AnyWork discovers that pre-existing session, restores its history, sends through its original Host and receives status/tool/output/completion. Send another prompt through the native client and check the same AnyWork session updates.
4. Verify interrupt, actual one-time approval handling, replay/reconnect deduplication, capability errors, and disconnect without stopping the Host. Separate durable source identity from projected UI ids.
5. Review UI extraction provenance and license against the pinned official files; test desktop/mobile tool disclosure, elapsed/live state, history, rich output and unchanged composer interactions.
6. Test source-archive exclusions with deliberately force-tracked `ref/` and `.worktrees/` fixtures in an isolated checkout, not just the default untracked state.

Development agents own product fixes. Any blocking finding will name the committed code and exact reproduction; the independent verifier does not modify implementation files or manipulate the real AnyWork/Codex services.

## Actual runtime preparation result

The isolated install completed successfully: 657 npm packages, Node `24.9.0`, `@deepseek-ai/dsh@0.2.2-rc.1`. Host `http://127.0.0.1:9387` uses only local model `http://127.0.0.1:9386/v1`; startup URL is kept in a mode-0600 local file, never in product docs. A native API client independently authenticated with `/connect`, opened `$events` and `workspace/follow`, created workspace `3cecc774-5921-420f-bbfe-ea149e1196af` and session `session-da0097fe-5268-41b0-9d77-389e0968e6f3`, and completed `verify-history` before any AnyWork adapter connection. Closing that native client left the Host alive.

A second native session successfully executed real Harness `bash` with `printf ANYWORK_HARNESS_TOOL_OK`; the durable result contains that exact output and `sourceEventSeqs` referencing its call. A third isolated escalation using `sandbox_permissions: danger-full-access` emitted a real `approval/request` waterfall through `$events`; no approval was granted by this preparation client. The response shape from pinned Remote source is `$events/result {clientId,eventId,outcome:{kind:"result",value:"allowed-once"|"rejected"}}`. Codex's `require_escalated` spelling is invalid for Harness and was rejected before execution in a separate negative fixture.

Not all `user/message` events are human messages: the native stream includes runtime context, skills, and time snapshots with user roles but distinct `data.source.kind`. These must not be displayed as authored human messages. The adapter developer received native frame captures for history, tools and approval; they live only in the verifier's temporary directory.

This section records the original preparation evidence. Subsequent actual AnyWork round trips, full-reference image hydration, companion discovery, independent browser acceptance, reconnect/permission boundaries and archive tests passed against committed changes; their exact revisions and limits are recorded in the linked final review reports.
