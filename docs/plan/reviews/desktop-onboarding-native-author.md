# Native onboarding and active connections: author verification

Scope: the Native lane of [desktop onboarding](../../desktop-onboarding-layout.md), implemented from base `be7208e` on `codex/desktop-onboarding-native`. This author report covers isolated code and boundary verification. It does not approve a runtime replacement or release.

## Delivered behavior

- `desktop_start` is registered as a Native IPC command returning `Result<(), String>`. It validates preview/update state and the current Native account before submitting a manager preparation request. It does not open a browser, mint a browser ticket, or enable remote access.
- `desktop_open` uses the same Native account gate before its existing safe handoff. Only `signedIn=true` with authorization status `signedIn` admits a command. Other supported-platform account states return `DESKTOP_SIGN_IN_REQUIRED`; the unsupported platform returns `DESKTOP_ACCOUNT_UNSUPPORTED`. The independent CLI entry is unaffected.
- The manager's shared `prepare_workspace` path retains port, local service identity, credential and browser-session capability checks. It starts an absent owned service or reuses a verified compatible external service. Explicit opening prepares first and then signs the existing short-lived ticket. Preparation does not change an external service's workspace, saved configuration or access key, and shutdown does not stop external processes.
- New-process updater startup no longer reads or executes disk resume hints, and installation no longer writes them. Existing `resume.json` files remain untouched. Failed installation recovery within the same accepted process retains a RAM-only copy of exactly the previously owned service configuration and token; it cannot choose a later snapshot's service or restart an external service.
- `account_snapshot` adds `accountPortalUrl`, derived from the existing validated frontend origin and identical to the portal-open command's URL, and `remoteClients: [{id,kind,connectedAt}]`. The unsupported snapshot also includes these fields and explicitly reports `unsupported` without authorizing Native startup.
- The gateway owns an in-memory connection registry. It registers only after account verification, the successful Noise ready response and transport construction. It exposes temporary process-local counter IDs, finite `ios`/`android`/`desktop`/`unknown` hints, and Unix-second connection start times. The upgrade path derives the hint and discards the original User-Agent; no address, token, subject or client key is added to the projection. The hint does not participate in authorization.
- A per-connection RAII guard removes the record on ordinary close, abrupt disconnection, protocol/authentication error, expiry or task exit. Gateway close/drop clears the registry and cancels its sockets. Renewal retains the original record, ID and start time. The existing four-socket limit remains enforced. No Noise protocol, JWT verification boundary, cloud schema or persistence was added.

## Verification

All commands used the task worktree and the existing author build cache at `.worktrees/account-desktop/target`; no installed application or user service was involved.

| Check                                                  | Result                                                                                                                                                   |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cargo test -p anywork-desktop --lib`                  | 41 passed; two existing download/installation tests ignored                                                                                              |
| `cargo test -p anywork-remote`                         | Three unit tests and eight real WebSocket/Noise gateway tests passed; doc tests passed                                                                   |
| `cargo check -p anywork-desktop --bin anywork-desktop` | Passed with a task-owned temporary compile-only HTML asset supplied through `TAURI_CONFIG`; checks Native command registration without editing UI output |
| `cargo fmt --all -- --check`                           | Passed                                                                                                                                                   |
| `git diff --check`                                     | Passed                                                                                                                                                   |

The Native IPC test uses Tauri's actual mock-runtime invoke dispatcher, the real account handle/manager and an isolated child-process HTTP service. Signed-out, authorizing, interrupted and reauthorization-required commands reject without starting the process or writing an access key. A synthetic valid RAM account admits preparation, starts the fixture process and returns success with no ticket request. Subsequent account invalidation/removal blocks new start/open calls while the already admitted service remains running with the same key. The fixture is then shut down through its own manager. No successful browser-open IPC is invoked, so the test never opens a user browser.

Real HTTP manager tests verify that preparation reuses a compatible external service without issuing a ticket; explicit manager opening issues exactly one 60-second ticket URL. Saved configuration/access-key bytes remain unchanged and the external listener survives manager shutdown. Unauthorized, wrong-product and old-capability external services reject preparation without ticket issuance, replacement, configuration changes or termination.

Updater tests preserve the bytes of a modern `owned:true` disk resume hint while starting the updater with no service command. The RAM recovery regression changes the later manager snapshot and verifies that recovery submits the original captured configuration/key instead; an external snapshot submits no startup command.

The unsupported-account source includes a public snapshot regression for its platform's CI: explicit unsupported status, absent account, empty connections, shared portal URL and rejected account actions. New Unix-specific child-process IPC tests remain inside the existing Unix-only account module. No Cargo dependency change was needed. The unsupported code was inspected for its cfg boundary, but its test and Windows executable were not run on this Mac.

Real gateway tests verify that an upgraded socket is absent until a successful Noise/account handshake, all four finite hints serialize to exactly three public fields, the fifth socket is rejected, graceful and abrupt disconnects remove records, bad renewal/expiry/disable remove records, and two renewals plus 1,030 real HTTP requests preserve the same record. Existing plaintext, unknown-origin, bad-account, replay and tampering rejection remains passing.

The short-lease fixture previously allowed a one-second Unix expiration to be only milliseconds away when created immediately before a wall-clock second boundary. The expiry and slow-renewal tests now start with a two-second initial lease and allow three seconds for closure. Their authorization rejection and real socket-close assertions remain intact; product expiry and lease limits were not relaxed.

## Limits and handoff

The IPC account is a synthetic RAM fixture; its purpose is testing the Native admission/manager boundary, not production Logto login. Gateway tests use a fixed-expiry synthetic verifier with the actual Snow Noise implementation and actual loopback WebSockets. They do not establish public tunnel availability or production account discovery.

Actual Windows compilation, merged UI rendering, signed installer behavior, real account login, real remote-device connections and release/runtime adoption require the independent and merged checks. The temporary HTML used for Native binary checking is not a packaged frontend or visual acceptance artifact. Existing ignored tests require explicit Internet/download/install setup and were not converted to passing mocks.

No user process, installed app, real login, remote-access state, cloud configuration, business Web source, UI source, e2e files, database or release was changed by this lane. The implementation is ready for exact-commit independent review and merged-system verification.
