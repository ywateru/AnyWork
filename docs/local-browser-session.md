# Local browser session boundary

The current [unified experience](account-unified-experience.md) uses an authenticated desktop handoff into the same local workspace. It does not export the service bearer. The browser uses a RAM-only HttpOnly cookie; this is local authorization, not a browser Logto login.

## HTTP contract

| Endpoint | Authorization | Body / successful response |
| --- | --- | --- |
| `POST /api/service/browser-ticket` | Genuine service bearer, `X-AnyWork-Service-Control: desktop`, direct loopback, exact loopback Host and no Origin or forwarding headers | Optional public context object → `{ticket, expiresIn:60}` |
| `POST /api/local/session` | Direct loopback, exact Host and exact same-origin Origin; no forwarding headers | `{ticket}` → public context and `Set-Cookie` |
| `GET /api/local/session` | Valid local cookie and browser boundary | Public context |
| `DELETE /api/local/session` | Valid local cookie and exact same-origin Origin | `{ok:true}`, expires cookie and actively cancels attached PTYs |

Public context is directly `{accountLabel?, installationId?, remoteEnabled:boolean}`. `accountLabel` permits at most80 Unicode scalar values without control characters; `installationId` is a UUID. Unknown fields, including subject, tokens and keys, are rejected. Native strips subject-derived fallback labels and bounds display labels before handoff. Context is a snapshot from ticket creation, without continuous native-account synchronization or independent browser login claims.

Tickets have244 random bits, last60seconds and are consumed atomically once. Native opens `http://127.0.0.1:<port>/#local-ticket=<ticket>`; the Web entry removes the fragment before further initialization. Tickets never enter query/path, Web Storage or logs. At most32 pending tickets and64 live sessions exist; cleanup removes expired entries and capacity rejection never evicts a live session. Sessions expire after1hour idle or8hours absolute; legal authenticated HTTP advances idle time. Restart loses all sessions.

The cookie is `anywork_local_<port>`, `HttpOnly; SameSite=Strict; Path=/`, without persistent expiry. Port naming avoids collisions; cookies themselves are not port-isolated. Trusted processes running as the same local user remain part of the existing machine trust boundary.

## Request and terminal restrictions

Cookie authorization requires the direct socket peer to be loopback and Host to exactly match `127.0.0.1:<bound-port>`, `localhost:<bound-port>` or `[::1]:<bound-port>`. Origin must exactly equal `http://<Host>`; HTTP requests may omit Origin only with `Sec-Fetch-Site: same-origin`. Duplicate/null/mismatched Origin, other Fetch Metadata sites and all Forwarded / X-Forwarded-* headers, Via and known client-IP proxy headers fail closed. WebSockets always require exact Origin. An invalid Authorization header never falls back to a cookie. Existing bearer validation and CORS are preserved.

All `/api/service/*` routes require the actual bearer. Cookies cannot sign tickets, stop services or gain control authority. `/api/local/*` is outside the remote encrypted gateway allowlist. Local errors use fixed safe fields and `Cache-Control: no-store`; invalid JSON never echoes supplied values.

Local PTY upgrades use the cookie plus the fixed non-secret text first frame `anywork-local-session`. Only after authentication and actual PTY creation does the server send text `{type:"local.session.ready"}`. Binary output and ordinary input/resize messages then follow the existing protocol. Bearer first-frame authentication remains available to internal gateway/CLI callers. Idle/absolute expiry, logout and service shutdown stop the PTY even without subsequent HTTP. Every outgoing send also checks revocation/expiry/shutdown and has a5second backpressure deadline; a non-reading client cannot conceal revocation.

## Desktop ownership and rollback

“Open workspace” reuses a verified local service or starts one owned child on loopback. An occupied/unverified port is never replaced. Selecting a service data directory permits reading only that directory's bounded regular `access-token` file. Existing valid credentials are reused byte-for-byte rather than rotated. Snapshot IPC omits the bearer. Old services without `local_browser_session` capability require an explicit upgrade; there is no bearer-link fallback.

The manager no longer has standalone route commands, launch plans, validation/reconnection workers, pairing exports or OS secret-store dependencies. Existing cloudflared remains an internal account-gateway provider. Old manager fields/files remain inert; first save preserves exact original `manager-before-unified.json` bytes and later saves merge unknown fields. Legacy update plans containing routes remain untouched and are ignored. Modern update recovery can resume the owned local service, while account login and remote enable remain explicit after process restart. External services are never stopped by manager cleanup or its stop control.

## Verification

`cargo test -p anywork -p anywork-desktop` covers the native/server boundaries. `node scripts/local-browser-session-check.mjs /absolute/path/to/anywork` starts an isolated service with real-user discovery environment omitted, performs HTTP and Chrome cookie checks, creates a fixture shell PTY, exchanges its ACK/output and verifies logout cancellation. Full product Web fragment clearing, refresh and encrypted remote behavior are separately verified by the Web lane and independent reviewer. No live service or real workspace is used.
