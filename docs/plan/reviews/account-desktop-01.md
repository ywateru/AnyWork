# Independent desktop account and encrypted gateway review

- Reviewer: independent `verify_desktop` lane; no product implementation changes.
- Reviewed commit: `d23f5a82a436abeaead9e7968320e2ff02d1847f` (`codex/account-desktop`; implementation `e895318`).
- Date: 2026-11-09, macOS arm64.
- Verdict: **BLOCKED** by D1 and D2. Passing source/tests below does not approve production publication or establish native GUI/Keychain end-to-end acceptance.

## Findings

### D1 — P2, blocking: native refresh checkpoint failure is not durable across process loss

Locations: `crates/desktop/src/accounts.rs:156`, `:169`, `:170`, `:172`, `:378`, `:395`. Contract: `docs/account-desktop.md:5` (checkpoint failure/restart cleanup), `docs/account-device-cloud-review.md:204` and `:206` (rotation persistence and one native owner).

After handoff, `GrantOwner::token` calls the provider using the stored refresh grant without first writing a durable uncertainty marker. When a rotated refresh token arrives it sets `state.pending` only in RAM, then attempts to replace `GRANT_KEY`. If this write fails, the newest token is retained correctly for the live process, but `PENDING_KEY` remains empty. After process death, `begin` sees an ordinary saved grant and restores the stale pre-rotation token with `pending = false`. The previous rotated grant cannot then be recovered/revoked from persisted state; a later refresh may reuse a rotated token. This contradicts the documented restart cleanup boundary. The initial JS-broker escrow path does write a pending record, but it does not cover subsequent native-owner refreshes.

Deterministic independent reproduction passed in an external temporary harness, without changing tracked product source. The harness uses the unchanged `GrantState`/`GrantOwner::token` and bounded HTTP client source extracted from this exact commit, a failing in-memory Secrets implementation, and an actual loopback HTTP token endpoint:

1. Persist grant `persisted-old` and an empty pending key.
2. Let the endpoint return `rotated-new`, then fail every credential-store write.
3. Confirm the live owner retains `rotated-new`, marks RAM pending and returns an error.
4. Drop the owner to simulate loss of RAM; allow store access again.
5. Confirm the saved grant remains `persisted-old`, pending remains empty, and a new owner constructed from that saved grant has `pending = false`.

This is a failure-state model of process loss, not a real macOS Keychain failure or OS crash test. The restored-state conclusion also follows directly from `begin:378–405`. Fix the durable state transition before a provider operation that can rotate the grant; restart must explicitly recognize uncertain rotation and must not silently reuse the old saved token. Cover preflight failure, response/write failure, process loss, checkpoint recovery and logout cleanup. Do not describe a marker containing an old token as proof that the latest rotated token can always be recovered after a crash.

### D2 — P2, blocking: enabling the desktop overwrites the user’s device alias

Locations: `crates/desktop/src/accounts.rs:693`, `:694`. Contract: `docs/account-device-cloud-review.md:132` and `:142` (user aliases and explicit alias updates).

`publish_index` reads the current full Account API object, then unconditionally replaces this installation’s record with a new record whose label is `AnyWork desktop`. The web candidate has a real device rename action (`account-web` `web/src/AccountApp.tsx:893` at its reviewed candidate). Therefore a user can successfully rename a device, then lose that label on the desktop’s next disable/enable cycle or restart. The write/readback comparison confirms the replacement rather than protecting the alias.

Preserve an existing valid label when refreshing this installation’s Grid ID/key metadata; use the neutral default for a new record. Keep the bounded schema checks and preservation of other namespaces. Add a focused rename → republish case. This finding is established by the exact source write path and cross-lane callsite review; the native GUI cycle has not been run.

## Independent verification performed

### Committed tests

Ran in the reviewed worktree using its existing target directory and `CARGO_INCREMENTAL=0`:

```sh
cargo test -p anywork-remote -p anywork-desktop --lib --tests
```

Result: desktop library **38 passed, 0 failed, 4 ignored**; desktop main has no tests; remote protocol **2 passed** and actual WebSocket gateway **4 passed**. The ignored cases require external downloads, a built/bundled server or real tunnel/update resources. The desktop total includes four account tests, rather than adding four to the total again.

The executed gateway tests use actual Rust Noise/WebSocket traffic and prove local bearer injection/confinement, Origin rejection, plaintext rejection, verifier failure closure, replay/tamper rejection before local requests, authorization expiry and disable closure. Their verifier is a fixture; those tests alone do not prove JWT verification.

### Actual cloud JWT through the product Rust verifier

An independent temporary Rust executable depends on the public `anywork-remote` crate at the reviewed path and directly calls its real `JwtVerifier`. It reuses the worktree target directory. No verifier substitute is used.

The generated development SPA test account’s exclusively owned refresh grant was refreshed programmatically against the real development Logto issuer. Each returned latest refresh token was durably checkpointed to a mode0600 private file outside Git before another token request. This did not manipulate a consent UI, use user business data or access an existing user grant. The original expired JWT was retained privately for the expiry case. A second actual resource token was obtained with `scope=openid`; it has a real cloud signature and lacks `connect`.

All cases passed:

| Case | Actual evidence |
| --- | --- |
| Valid token | Real ES384 cloud signature/JWKS, expected issuer/audience/SPA client/local owner accepted; returned expiry is bounded to five minutes. |
| Wrong local owner | Original, unmodified signed cloud token rejected by verifier configured for another owner. |
| Wrong audience | Original signed token rejected with another configured resource. |
| Wrong client | Original signed token rejected with another configured client. |
| Expired token | Previously issued, actually expired signed cloud JWT rejected. |
| Missing `connect` | Separately issued, actually signed cloud resource JWT without `connect` rejected. |
| Wrong algorithm | Header variants `none`, `HS256`, `ES256`, `RS256` rejected. These are deliberately modified headers, not provider-signed alternate algorithms. |
| Opaque token | Non-JWT Account-token-shaped input rejected. |

No credentials or raw tokens were printed or committed. The actual native client’s complete login/commit/Keychain/Grid path was not exercised by this SPA verifier harness. No actual signed future-`nbf` token was generated; source validation enables `nbf` checks with zero leeway.

### Source and call-chain review

Reviewed the native account entry and Tauri registration/shutdown callsites, in-memory official Logto adapter, callback broker, commit/identity checks, refresh ownership, pending recovery, installation-key binding, Account API merge, remote enable/disable/logout, and all remote authentication/protocol/gateway source and gateway tests.

- The official pinned `@logto/client` code exchange omits `resource`, then the UI obtains the opaque Account token and resource JWT serially before ownership handoff. The UI explicitly requests login/consent and uses PKCE/state with the fixed loopback redirect. Actual consent/native GUI acceptance is still pending.
- The broker restricts token/discovery/JWKS URLs to the configured issuer, denies redirects and arbitrary headers, bounds bodies/responses, serializes transaction exchanges and captures minted grants before IPC. Callback binds loopback, checks the expected state, bounds read/time and sends fixed no-store text.
- The native commit checks the real resource signature/client and matches the opaque Account API `id`; SDK refresh calls delegate to the one `GrantOwner`. Live-process checkpoint retry and latest-token revocation are serialized. D1 concerns persistence across process loss, not the existing live-process serialization tests.
- Same configuration/subject reuses the private installation identity; a different subject/configuration creates a new installation/static key. The OS secret namespace includes issuer/client/support directory. No ordinary-file secret fallback is present. These are source conclusions; real Keychain storage/restoration and owner-switch runtime behavior are not established by FakeStore tests.
- Public customData contains the bounded device display mapping and public key. Local owner proof is the verified JWT subject; `gridDeviceId` and user-editable cloud data are not authority. Whole-object Account API replacement/cross-device lost updates are documented. D2 is the avoidable same-record alias overwrite.
- The remote listener binds loopback and exposes only `/remote/v1/ws`; the separate provider points to it. Noise IK uses the fixed suite and installation prologue. Issuer/audience/client/owner/scope/expiry verification happens before ready/business requests.
- Route parsing rejects arbitrary hosts, control/traversal/encoded separators and non-allowlisted API shapes. The allowlist covers current business APIs and poll endpoints; service stop/health and SSE are excluded. Only Content-Type crosses the request header boundary; local bearer and presence ID are gateway supplied.
- Declared request sizes, canonical chunks, assembly budget, unique IDs, concurrent requests, PTYs, socket count, output queue and session TTL are explicitly bounded. HTTP responses stream through the bounded queue with response-size/deadline checks. Malformed protocol input closes the connection; no plaintext fallback exists.
- PTY opens only on the fixed local loopback service and receives the local bearer as its first frame. Gateway connection teardown aborts child tasks and drops their sockets; the existing local terminal handler kills/waits for its shell on socket closure. The independently executed tests do not create a real shell or dynamically exhaust all these limits; the actual browser/Rust large-upload and PTY acceptance belong to separately recorded evidence.

## Acceptance boundaries still open

- **Native GUI/full chain: pending.** The Mac is locked. No attempt was made to bypass the lock or manipulate CUA. Real desktop login, Keychain checkpoint/restart, native commit, enable, CyberGrid registration, public-index publication, browser discovery, business/PTY flow and native logout must be completed after manual unlock using the isolated fixture server/account. Programmatic JWT/FakeStore tests do not count as that acceptance.
- **Browser candidate:** independently reviewed in the web lane; its late-ACK cancellation and AccountStore fetch fixes need their own exact-commit recheck. This document does not accept a moving web worktree.
- **Platforms:** checks here target macOS arm64. Windows account flow remains explicitly unsupported because of the pinned upstream Unix SDK restriction; Linux runtime was not verified. This is the approved platform boundary, not a newly discovered desktop blocker.
- **Production:** development cloud token success does not establish production readiness. The production Logto API-resource/RBAC subscription/payment gate and upstream CyberGrid redistribution-license permission remain explicit. No paid action or publication was performed by this reviewer.

D1 and D2 were sent to the orchestrator and desktop author before completing this report. Reverification must name the corrected commit and retain the native GUI and production boundaries until actual evidence closes them.
