# Claude backend verification

Candidate: `codex/claude-backend`, first implementation `68dde8d`. Subsequent boundary fixes are recorded in this branch's git history. This report distinguishes deterministic protocol fixtures from real native execution.

## Reproduction

Run from the backend checkout. `ANYWORK_BINARY` can point at a separately built server.

```sh
cargo build --locked -p anywork
cargo clippy --locked -p anywork --all-targets -- -D warnings
cargo test --locked -p anywork -p remote-agent-sdk -p remote-agent-codex
python3 scripts/claude-integration-test.py
python3 scripts/plugin-catalog-test.py
python3 scripts/event-scope-test.py
python3 scripts/capability-projection-test.py
```

The fixture tests use isolated Claude config/data/workspace directories and the executable `scripts/claude-fixture.py`. They do not use a model, real login, real desktop window, or existing session. Covered boundaries: passive discovery/history pagination, native-ID resume, text/thinking item identities, tools, exact pending approval decisions, AskUserQuestion free-text answers through the original `can_use_tool` response's `updatedInput.answers`, owned cancellation, attachment scope, native model updates, failed native results, invalid stream/EOF recovery without input replay, service restart, writer exclusion, explicit rejection of auto policy and steer, and Desktop-to-CLI ID separation without CLI fallback.

## Real CLI evidence, 2026-11-13

Native CLI: **2.1.323**. Protocol reference: official Python SDK **22b8eb9c19adfa78759b79e22bd664a57843bb06**. License attribution is in `THIRD_PARTY_NOTICES.md` and `licenses/claude-agent-sdk-MIT.txt`.

```sh
python3 scripts/claude-real-smoke.py
python3 scripts/claude-real-smoke.py --api-message
python3 scripts/claude-real-smoke.py --api-controls
```

Initialization was run with `--permission-mode manual`, `--permission-prompt-tool stdio`, explicit `--session-id`, stream JSON input/output, verbose output, partial messages and user replay. It completed successfully and exposed **94** native model catalog entries. The initialization-only run sends no model prompt and does not print account details.

The service API smoke used a new isolated workspace and new native UUID, sent a small fixed marker prompt, and completed with:

```json
{"real_api_message":true,"status":"idle","native_id_preserved":true,"text_stream_observed":true,"turn_completed":true,"isolated_new_session":true}
{"real_api_tool":true,"real_approval_once":true}
{"real_api_question":true}
{"real_api_owned_interrupt":true}
{"real_api_set_model":true}
{"real_api_restart_resume":true,"native_id_preserved":true,"persisted_history_read":true}
```

`--api-controls` creates an isolated workspace and new native UUID, requests Bash to write only its test marker, approves only that exact command once, answers the original AskUserQuestion permission, interrupts owned work, changes the native model and restarts the server to resume the same UUID with persisted context. It never approves unrelated commands. Only newly created test sessions were written. Existing application/session records and credentials were not edited. No bypass-permissions mode was enabled. These are real CLI/API results; Desktop native control remains separate.

The follow-up fixture suite has **17 API tests**, including unknown-format history retention, conflicting UUID rejection, child-agent final-frame filtering, background main-run reopening, interrupt rejection without a false interrupted completion, and idle-before-error/EOF without fabricated success. Rust tests cover title precedence, empty metadata values and nested tool-field exclusion. Both Claude manifests carry `manual-approvals-only`; create/PATCH auto and legacy-auto send are rejected explicitly. Generic API integration (**25 tests**) and shared-history (**1 test**) also passed using this checkout's private `target` binary.

## Configuration and current limits

- Agent IDs: `claude-code`, `claude-desktop`.
- `ANYWORK_CLAUDE_BIN`: native executable override. Discovery checks PATH, `~/.local/bin`, common npm/runtime paths and Desktop's separately downloaded host CLI (never its VM download). Download discovery checks the install `.verified` full-checksum text, the checksum directory prefix and native executable header; this is discovery evidence, not a new authenticity guarantee. Windows uses `claude.exe`; `.cmd`/`.bat` wrappers return an explicit configuration error. Binary discovery is not authentication or writer readiness.
- `ANYWORK_CLAUDE_HISTORY_ROOT`: Claude config home containing `projects/` and `sessions/`, also passed as `CLAUDE_CONFIG_DIR` to the owned CLI. Default: `CLAUDE_CONFIG_DIR`, then `~/.claude`.
- `ANYWORK_CLAUDE_DESKTOP_HISTORY_ROOT`: a **single explicit root replacing all defaults**, not an additional root. With no override, the union of known `Claude` and `Claude-3p` profiles is discovered: macOS `~/Library/Application Support/{Claude,Claude-3p}/claude-code-sessions`; Windows `%APPDATA%/{Claude,Claude-3p}/claude-code-sessions` (home fallback if APPDATA is unset); other platforms `${XDG_CONFIG_HOME:-~/.config}/{Claude,Claude-3p}/claude-code-sessions`. Custom profiles use the explicit override. Native IDs stay unchanged; duplicate IDs across profiles/accounts fail closed for import/attach and preserve prior cache. Persisted Desktop events carry `claudeDesktopProfileRoot` and the independent `claudeCliSessionId` provenance.
- Generic `--agent-scope all` includes both Claude agents. Discovery/history reads do not start inference or acquire a session writer. Malformed history retains prior discovery and reports a notice/error without logging record content.
- History discovery currently reads complete JSONL files on each session sync, bounded to 128 MiB/file and the directory/record limits in `history.rs`. There is no mtime cache or lightweight head/tail reader yet; large history collections can make `/sessions` slow. This is a documented performance boundary.
- `manual-approvals-only` is advertised in plugin capabilities. Auto policy, concurrent steer, Codex message edit/fork, goals, plan controls, service tiers, and reasoning-effort mutation are not advertised as supported. Explicit auto/steer API requests fail instead of silently changing semantics. AnyWork queueing remains an explicit local queue.
- Native live writer registry plus a cooperative cross-process lease prevent resuming an already owned session. macOS registry `procStart` is compared to `ps -o lstart= -p PID` under `LC_ALL=C,TZ=UTC` to detect PID reuse. Missing or unverifiable process identity fails conservatively; non-macOS start-time verification has not been validated.
- Desktop metadata discovery is limited to account/org/`local_UUID.json`, excludes SSH/WSL/moved-to-cloud sessions (including actual `movedToCloud:{cloudSessionId}` objects), and preserves the separate `cliSessionId`. A plain `cloudSessionId` Remote Control link does not exclude a local session. Disk reads use the current native CLI parent chain. Prior CLI lineage/rewind stitching is not claimed; such records get a notice.

After `npm run build:desktop-ui` generated the required desktop UI artifact, `cargo test --locked --workspace` passed with **328 passed, 8 ignored** (log: `/tmp/anywork-claude-workspace-tests.log`). This count precedes the additional review regression tests; subsequent focused results are reported separately. The initial missing-artifact failure was resolved, not counted as a passing run.

## Desktop mapper candidate, 2026-11-13

Integrated carrier source: original worker commit `ba0cdd0`, cherry-picked as `a8bccea`. Rust mapping is in `desktop_adapter.rs`; it is distinct from the worker-owned `desktop.rs`. No main hook is required: `scripts/claude-desktop-launch.py` owns its independent loopback broker. Descriptor default is `~/.anywork/claude-desktop/host.json`, overridden by `ANYWORK_CLAUDE_DESKTOP_DESCRIPTOR`.

Fixed implemented plugin features are advertised at startup. `available` rechecks private descriptor validity on each catalog request, and connect performs a live carrier handshake; descriptor existence is not a claim of authentication, writable readiness or native acceptance. This supports starting AnyWork before the renderer connector. Both Claude IDs retain `manual-approvals-only` and reject steer, goal, fork, plan, effort and tier mutations.

The mapper covers native `start(withoutFirstMessage:true)`, existing local-ID attach, list/get, message submission, text/thinking/tool events, bounded local files/images, original permission-ID responses and AskUserQuestion answers, interrupt, setModel, cursor/generation fault handling, explicit reconnect and native history pagination. History reads page backward through tail/page up to 21,000 records, project recognized message envelopes, preserve unknown renderer records as a completeness notice and never prune earlier cache from a native read. Native transcript transformations and actual renderer shapes remain part of pending native acceptance.

**Submission semantics are deliberately weaker than atomic turn start.** Static source confirms public `LocalSessions.sendMessage` is `Promise<void>` and swallows the manager's `{delivered,queued}`. A matching user echo is emitted before some native queue paths. Therefore `POST /messages` returns `turn:null` plus `submission:{id,status:"submitted",deliveryState:"unknown",message:...}`. It never claims steer or an executed turn from null/echo/busy alone. Observed native session activity has its own locally correlated turn identity and `nativeSessionActivity:true`; terminal session events do not claim which submitted message ran. An unconfirmed submission fences another concurrent send until a native terminal observation or explicit reconnect. Unknown outcomes are never replayed. Native queue synchronization and atomic reject-if-busy are not claimed.

Reproduce without opening Desktop or using any account:

```sh
cargo build --locked -p anywork
python3 scripts/claude-integration-test.py
python3 scripts/claude-desktop-launch-test.py
python3 scripts/claude-desktop-adapter-test.py
cargo test --locked --workspace
```

The merged source passed **335 workspace tests, 8 ignored** (log `/tmp/anywork-claude-desktop-workspace-tests.log`), **6 launcher/JS/local HTTP+WebSocket fixture tests**, and the Desktop API/default-profile fixture suite. The latter checks create without a prompt, native identity preservation, streamed/final item IDs, failed result, exact permission/question response, busy/steer rejection, cancel, attachments, gap invalidation, restart/history, late connector discovery, default Claude/Claude-3p union, explicit override isolation and cross-profile ambiguity. These tests use synthetic peers and isolated files, not a real Desktop renderer. `scripts/check.sh` includes all three Claude fixture scripts.

**Native Desktop acceptance is pending.** Normal DevTools in an isolated unmodified app copy reached the self-XSS warning; tools did not bypass it. The coordinator will arrange the user's manual review/console step only after source and merged tests. CSP/WebSocket permission, real LocalSessions list/history/permission/event shapes and real create/send/control are not claimed as passed. The existing screenshot session remains read-only. The ordinary Enable Developer Mode menu may quit/relaunch Desktop; enabling it is not a zero-impact action. No real app preference, active writer, credential or existing conversation was altered by this mapper work.

Final source checkpoint: **`129f3d0127eaa5a5bd6059345a049c050914efb0`**. Its frozen API binary is `/private/tmp/anywork-claude-mapper-129f3d0`, built in this checkout's private target. At this exact checkpoint, workspace clippy with `--locked --all-targets -- -D warnings` passed; workspace tests again passed **335/0/8** (passed/failed/ignored, `/tmp/anywork-claude-mapper-129f3d0-tests.log`). The final Desktop API/default-profile suite has **11 tests**, including null/void send plus user echo not producing a started/completed turn, and native error results without preceding assistant text.

Using the frozen binary, generic API integration **25**, shared history **1**, event scope **4**, plugin catalog **2**, capability projection **6**, and source archive **6** all passed. The source archive test confirms newly added tracked modules/scripts are included. The same frozen binary passed `python3 scripts/claude-real-smoke.py --api-controls --binary /private/tmp/anywork-claude-mapper-129f3d0` with all six real CLI boolean result records shown above. This real smoke disables Desktop discovery/descriptor access and creates only new isolated CLI test sessions.

The independent mapper review found M1: actual SDK messages carry `session_id`, so using that CLI lineage in history source keys while live keys used the Desktop ID duplicated messages after reconnect. The follow-up now uses the projected Desktop identity for both source keys and preserves each individual SDK envelope's `session_id` as `claudeCliSessionId`, without applying the current snapshot lineage to older messages. The fixture now contains distinct native Desktop/CLI IDs on every SDK envelope, rotates the snapshot CLI lineage before service restart, and verifies exactly one user/assistant plus the original message lineage after hydration. Follow-up validation: strict server clippy, build, **11 Desktop API/profile**, **17 CLI API**, **14 Claude Rust** passed.

New AnyWork Desktop sessions explicitly pass native `permissionMode:"default"` to `start`, alongside `withoutFirstMessage:true`. They do not inherit the Desktop host's auto preference. This is the Desktop API's native enum (distinct from the CLI's `manual` argv). Attaching/importing an existing native auto session never calls `setPermissionMode` or changes its policy. The final fixture suite has **12 Desktop API/profile tests**, including explicit new-default creation and preservation of an existing native auto mode.
