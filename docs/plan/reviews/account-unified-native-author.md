# Unified Native/local author evidence

Scope: the unified workspace/account entry, retirement of standalone routes, and RAM-only local browser authorization. This report is author evidence; independent review and live rollout remain separate gates.

## Implemented boundary

- Desktop first screen combines local workspace and account/explicit remote access. One action prepares or reuses the local service and opens a one-use ticket. Settings have workspace/data directory/port/program selection without a bearer form or credential export. Identity verification remains expandable, and account registration, cancellation, logout, errors and safe stage diagnostics remain supported. Updates explicitly distinguish local-service recovery from RAM-only account authorization.
- Standalone Quick/Named/WireGuard launch plans, workers, reconnection, route IPC, pairing/clipboard/key export and OS credential-store dependencies are removed. Internal cloudflared account-provider launch remains; its bounded output parser publishes only a validated tunnel origin internally. Legacy configuration remains inert. First save preserves exact original manager bytes; unknown settings survive subsequent saves. Legacy route recovery files are retained and ignored.
- Existing authenticated external services are reused without stopping or replacing them. The selected data directory's bounded regular service bearer file is read; an existing valid token is never rewritten by startup. Snapshot IPC omits it. A service missing the new handoff capability fails explicitly and never falls back to bearer URLs.
- Local ticket/cookie/HTTP/PTY boundaries are documented in [local browser sessions](../../local-browser-session.md). The service advertises `local_browser_session`; it adds no business storage, schema change or Agent behavior. Public context is a bounded snapshot without subject or credential claims. Cookie auth does not enter service controls or remote gateway routes.

## Checks executed

- Native and server `cargo clippy --all-targets -- -D warnings` passed.
- Final full impacted Rust run passed: server191 passed /5 existing opt-in ignored (196 total); Native37 passed /2 existing opt-in ignored (39 total). This includes bridge public-context filtering and two actual-loopback terminal checks: idle/absolute expiry without further HTTP and shutdown while a sink is blocked.
- Desktop UI production build/TypeScript passed. Actual Chrome rendering passed account registration/login first-screen parameters, failure retry, pending cancellation races, unified-screen presence, retired-entry absence, memory notice, account label, authorization stages, reauthentication and settings without token fields. Update rendering passed quiet download/failure, defer, preference, confirmation focus/Escape, stale version rejection and explicit install.
- `scripts/local-browser-session-check.mjs` passed with an isolated real server, actual HTTP, Chrome cookies and a real shell PTY. It proves no-session401, one-use ticket, HttpOnly/Strict cookie hidden from JS, reload, source/Host/proxy rejection, invalid Authorization rejection, bearer-only service controls, bounded ticket capacity, safe JSON rejection, PTY ready ACK/output and logout closing PTY within3seconds. Direct raw HTTP was used for the wrong-Host case because Node fetch normalizes the Host header.
- Original manager configuration preservation, selected bearer file preservation, external service reuse and shutdown ownership passed targeted tests. No Keychain call, cloud account read, running service change, installation or deployment was performed.

## Delivery limitations

The same-source new server is required in the final Mac bundle; the older accepted server cannot implement the new ticket API. Web/mobile integration and long-running encrypted remote acceptance belong to the other author and independent reviewer. An external old service is deliberately left running until the root's reviewed, reversible rollout and current activity/ownership checks authorize an actual switch. Screenshots use synthetic Tauri state and prove rendering; they do not prove real OAuth. No runtime user data, credentials or active tunnels were used for these author checks.

## Follow-up acceptance support and desktop E2E

The server resolver accepts optional `ANYWORK_CODEX_DATA_DIR` before the unchanged `CODEX_HOME` and `HOME/.codex` fallback. Its focused test covers precedence, override without either fallback, both legacy fallbacks and unavailable configuration without mutating process environment. The rebuilt debug server and all-target Native/server clippy passed at `4699e3d`.

The obsolete `e2e/desktop-*` route-map tests now exercise the unified contract through strict synthetic IPC: four viewport sizes, no retired controls or token forms, one local-open action with pending/error states, settings drafts across polling, selected-service ownership, explicit account enable/disable, fixed-stage/manual retry, logout, cancellation, reauthentication, unsupported accounts and device portal. All 36 cases passed in Chrome desktop and mobile emulation against the actual production UI build. A temporary Playwright configuration omitted `webServer` because these tests intercept all desktop UI resources and never use the real API; the separate real HTTP/cookie/PTY check remains the backend acceptance. This run did not start a user service or call OAuth. Screenshots are test-output artifacts, not live account evidence.
