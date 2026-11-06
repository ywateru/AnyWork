# WorkBuddy integration investigation

Status: implementation candidates are committed and undergoing independent review; isolated installed preload and native reads have passed, while native writing remains open. No production adapter or runtime support is claimed yet. Goal: add WorkBuddy as an Agent while preserving the existing desktop's session and execution ownership. The installed application remains unchanged.

## Artifact and primary evidence

Observed installation: `/Applications/WorkBuddy.app`, bundle `com.tencent.workbuddy.mac`, desktop 5.9.3. `Contents/Resources/app.asar` SHA-256: `12a2be53ec7db2943a9958f6986d7807adcf083bd79b307d26706d83750effa7`.

REA retained parent evidence:

- `ev_4280e05cd6ef563b483e52043816489e4417ee3cff29f5e1d38ea6f28846d2ab`: selected desktop/daemon entry modules.
- `ev_042f46590772353486284fd4da36d88004afb680e629727f35e5324b1a3d8690`: sidecar, protocol, remote-window broker and prewarm modules.
- `ev_3f9bd3f06527cc5732bb2a379214721562103492fb673c56029f7bfeb4dfe31c`: preload and app-instance modules.
- `ev_44d7618c300943a53418c6fe89f18f6a7f3704b0292ebcab13fc2783fbbc55c7`: selected renderer facade, protocol and desktop setup modules.

Analyses selected exact sources and used `record-and-continue` because ASAR metadata contradicts observed bytes for some native/unpacked members. This is a provenance limitation, not a diagnosis of its cause. Graph coverage is partial, dynamic calls remain unresolved and semantic limits apply. Static API observations do not establish a successful runtime attachment. Private extracted/formatted files remain under ignored `ref/workbuddy-5.9.3/`; none may enter a source archive or release. Line numbers below refer to those private formatted reading copies.

## Investigated control paths

| Path | Evidence / limitation | Decision |
| --- | --- | --- |
| Sidecar data socket | `sidecar-entry.js:1347–1375` destroys the previous data client when another connects | Reject: would disconnect desktop |
| Sidecar control list | Provides ready runtime endpoints, PID and PTY dimensions, not business chat history; prewarm also holds instances in memory | Insufficient for session import/control |
| Sidecar manager | ensure/start may replace or restart hosts; endpoint lookup may create a runner | Do not use for attach |
| WBIPC | private descriptor and HMAC handshake exist; `server.js:165995–166015` only registers backend HTTP, entitlement and WeCom authorization pipes | No chat interface is registered |
| Daemon RPC | Existing conversations handlers are exposed through the parent's stdio; DaemonServer itself has no network listener | Do not compete for stdio |
| Extension service | Can invoke existing daemon; production requires verified/signed service and granted permissions | Cannot promise arbitrary unsigned companion installation |
| Agent Harness SDK | Actual package is `@genie/agent-harness` 0.2.0-beta.15; public same-generation `@tencent-ai/agent-harness` offers multi-client resume/listeners. WorkbuddyHarnessHost's observed use is settings, not proof all desktop chats live in it | Do not start another Harness or claim auto-discovery |
| Renderer preload | `preload/index.js:6504–6530,11513` exposes `__wbInvoke(channel, context, ...args)` and `__wbEventBridge` to the existing trusted main/daemon route; `workbuddyDesktop.invoke` is a different general app boundary | Use verified conversation channels, not guessed legacy app envelopes; runtime proof pending |
| Built-in renderer debugging | `main/index.js:8179–8193` honors `WORKBUDDY_REMOTE_DEBUGGING_PORT`; config and userData paths can be selected independently | Candidate explicit launcher, no app patch or silent restart |

The current running desktop has not been interrupted or reconfigured. No real prompt, account provision, auth login, sidecar data connection, session injection or guessed-token request was used during research.

## Candidate delivery boundary

Use a version-bound adapter to the existing desktop API only after independently checking its exact invocation, event, history, approval and model contracts. An explicit launcher may enable WorkBuddy's built-in loopback debugging option for the next launch. An already running desktop without this entry must produce actionable setup guidance; AnyWork must not silently restart it or create another execution engine. Closing AnyWork must only detach its client.

CDP is a privileged local control channel. Any descriptor must be private, tied to the chosen application/profile and process, and excluded from diagnostics/archives. Restrict all connection endpoints to loopback; reject unrelated renderer targets and redirects. Subscribe before reading a snapshot and reconcile event identity rather than replaying messages. Never call account/login/provision, globally dispose sessions, or rewrite approval policy to obtain connectivity.

The verified renderer envelope is `__wbInvoke('wb:conversations:<method>', undefined, ...args)`; a nested repository uses the dot namespace (`wb:conversations.local:list`). Observed methods include `list`, `get`, `create`, `requests`, `requestEntries`, `getPendingInfo`, `sendPrompt`, `cancel`, `resolvePending`, `configSetModel` and `configSetThoughtLevel`. Models are queried through `wb:models:list`. Model results may contain provider credentials: project an explicit public-field allowlist inside the evaluation boundary, before any result crosses CDP or enters diagnostics/storage. `window.workbuddyDesktop.appVersion` provides a native preload version binding; a descriptor's self-declared version is insufficient by itself.

`get` acquires the desktop's shared Conversation facade and touches its LRU; for an already pooled instance it also triggers history refresh. `requests` and `requestEntries` read the shared assembler, with lazy history loading and possible native legacy session-load fallback. They do not set the renderer's current-conversation set in the inspected paths, but must not be described as pure disk reads. Prefer bounded canonical request snapshots over repeatedly calling `get` just to obtain streaming content. Initial `requestEntries` can return history-not-ready; poll its explicit readiness state rather than treating an empty page as no history.

An isolated application startup also has a potential global effect: WorkBuddy registers deep-link handlers before taking its instance lock and performs legacy registration cleanup. Config/userData isolation alone therefore does not prove OS integration isolation. Runtime acceptance must account for this explicitly, rather than launching another instance under the assumption it is harmless.

## Primary online sources

- [Official HTTP API](https://www.codebuddy.cn/docs/cli/http-api), [daemon](https://www.codebuddy.cn/docs/cli/daemon), [remote control](https://www.codebuddy.cn/docs/cli/remote-control), [WorkBuddy ACP](https://www.workbuddy.ai/docs/zh/cli/acp). These describe CLI capabilities; they do not establish a discoverable desktop conversations broker.
- Version-bound public SDK [server assembly](https://unpkg.com/@tencent-ai/agent-harness@0.2.0-beta.15/docs/server.md), [ACP v2 protocol](https://unpkg.com/@tencent-ai/agent-harness@0.2.0-beta.15/docs/acp-v2.md), [authentication](https://unpkg.com/@tencent-ai/agent-harness@0.2.0-beta.15/docs/authentication-guide.md). The older stable 0.1.6 statement that WorkBuddy is not integrated must not be generalized to the installed newer package.
- [WorkBuddy brand center](https://5864e0de6f1f4cf1a9444ae3ebb70ce2.app.codebuddy.work/), [original icon SVG](https://5864e0de6f1f4cf1a9444ae3ebb70ce2.app.codebuddy.work/assets/workbuddy-icon.svg). Preserve its teal color and aspect ratio; software package licensing does not grant broad trademark rights.

## Independent runtime preflight

The original installed executable was launched with a private configuration and userData under a tested outer macOS sandbox. A normal nested Chromium sandbox could not initialize in that test environment. A test-only `--no-sandbox` launch, while keeping the verified outer restrictions, reached the actual file renderer and confirmed `__wbInvoke` / `__wbEventBridge` functions, a working event-unsubscribe function, native appVersion 5.9.3 and the exact isolated configDir. This flag is not part of the product launcher or a claim about default runtime behavior.

The first native list call returned `No handler registered for 'wb:invoke'`: startup had aborted before IPC registration because BrowserRuntimeHost chmodded its shared UID temporary directory. This is an environment failure, not an empty successful catalog. The native path is `/tmp/wb-browser-<uid>/<main-pid>-<random12hex>.sock` (`main-bootstrap.js:26700–26706`). Further verification can allow only the new test process's own PID-prefixed socket and idempotent 0700 directory mode, while continuing to deny other processes' sockets, real profiles, external writes, persistent LaunchServices changes and external network access. A subsequent owned launch also required its own PID-specific `/tmp/wb-office-<pid>.sock` and an isolated `app-config.json` default workspace to avoid the application's normal HOME/WorkBuddy/Claw fallback. With only those additional per-process paths, actual `wb:conversations.local:list` succeeded and returned the native paginated envelope with an empty isolated catalog; the event bridge received events as well. This proves the installed native IPC boundary, not yet message delivery/history/approval interoperability.

The outer restrictions were separately exercised by the actual Electron runtime and a native child: owned temporary writes succeed; outside writes, lsregister execution and lsd.modifydb/cfprefsd/securityd access are denied. A unique throwaway scheme remained without an owner after the denied registration call. Test processes were cleaned by their owned process groups; no production desktop was stopped.

## Completion gates

The independent runtime check also found two native error forms: `__wbError: true` wrappers and API `errorCode` objects. An explicit-local, stable-ID creation diagnostic narrows the isolated profile's failure to `[LocalConversationsImpl] create failed: no user id`; a subsequent unknown-ID get instead produces aggregate incomplete-provider-lookup. This distinguishes repository identity setup from a generic transport failure. No real account credentials were read or fabricated. A supported offline identity route is not yet established. All native projections and mutations must recognize errors before accepting success, and an uncertain create must never trigger an automatic retry.

1. Record the actual supported native envelopes and version compatibility check.
2. Verify safe attachment to an isolated desktop runtime with a second local client and no independent runner.
3. Implement registration, history import, create, stream, send, cancel, approval and supported composer settings without leaking Codex-only operations.
4. Add WorkBuddy identity to existing generic sidebar/chooser infrastructure; use the official locally bundled asset with checksum/provenance.
5. Independent review covers reconnect/replay, errors/unsupported operations, disconnect ownership and rich resources; meaningful isolated tests and final merged checks pass.
6. No release, version bump or replacement of the current production service is implied by this integration research goal.
