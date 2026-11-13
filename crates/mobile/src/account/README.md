# Android account and directory

`Handle` is the Rust owner of the redacted account snapshot, account epoch,
Account API directory, device trust and target lifetime. The internal
`mobile-auth` plugin is the only OAuth owner. The business WebView can call only
the six `mobile_account_*` commands; their JSON never contains native grant,
subject, authorization code or a caller-supplied destination URL.

`prepare_target(device_ref, expected_epoch, expected_revision, key_confirmation)`
refreshes the authoritative directory and returns native-only `PreparedTarget`:
`VerifiedTarget`, `Arc<dyn transport::Authorization>` and an opaque, single-use
`TrustCommit`. The shell performs the Noise handshake, then calls
`commit_trust`. A handshake failure drops the evidence; a failed commit closes
the new connection. First/changed keys need exact public-key confirmation. Trust
is scoped by hashes of issuer/client/subject and installation, saved atomically
as public pins only. Corrupt/unavailable trust storage fails closed.

Logout and authorization uncertainty retire target cancellation tokens before
network cleanup. Shell installs `set_retire_hook` to close all transport sessions
and abort system exports. Old responses cannot apply after an epoch change.
Foreground refresh is a read operation; it never silently logs in or replays a
business request. Native refresh keeps one serial owner even if a Rust caller
drops its future.

## Native coordination, not SPA console

Android uses the existing desktop Native client and resource configuration.
`grid.rs` wraps the pinned official CyberGrid Rust SDK revision
`f2a3961536e5c69b13c7dbc661953d9243becbae`. An external AuthProvider validates
client identity, issuer, resource, scope, SDK generation/cancellation and account
epoch before and after acquiring a resource token from Kotlin. The SDK never
receives a refresh token; no CredentialStore, browser/device login, credential
import, provider executable, STUN or iroh endpoint is enabled by this lane.

The SDK implements Native `/auth/config`, admission challenge/admit, Native
`/auth/exchange`, real ephemeral certificate identity, device lease/heartbeat,
directory and coordinator epoch recovery, and exact `/session` revocation.
An unknown registration retains the same SDK instance and its RAM request IDs,
registration key and admission operation. It is not converted into a fresh
console exchange or a newly generated idempotency key.

Source evidence at that pinned revision: `sdk-rust/src/client.rs` (external
provider, admission, registration, heartbeat, recovery and close), `auth.rs`
(Native config), `capabilities.rs` (Native devices/versioned directory),
`secure.rs` (real certificate) and `types.rs` (wire DTOs). The source is pinned
in the Android-only Cargo dependency maintained by the shell owner. Runtime
disabled iroh does not remove its compile dependencies. Shell owner reported a
real `cargo check --offline --locked --target aarch64-linux-android -p
cybergrid-sdk` success, NDK 27.2/clang API26, debug=0/incremental=0; this verifies
the SDK dependencies, not the complete app or a production login. No platform
patch was needed. On non-Android hosts, this module returns explicit
`SYSTEM_UNAVAILABLE` for Native coordination rather than simulating a session.

The separate Account API token has no resource and includes the granted
`custom_data` scope. Only fixed `/api/my-account` is used. Replies are bounded,
redirects are disabled, subject and account epoch are checked, and directory
parsing follows the existing Web schema/bounds. Update operations retain unknown
customData and device fields, reread before writing and verify the full result
after writing. The service does not expose atomic conditional updates; another
writer between reread and PATCH is an unavoidable server-side limitation.
Unknown write outcomes are reported and never automatically retried.

Directory identity and online information remain separate. A failed account read
or Native directory fetch is `unknown`, not empty/offline. Connection targets
require a current ready directory, correct business port and a canonical HTTPS
endpoint permitted by the Native server policy (or its supported Quick Tunnel
pattern). JS supplies a device reference, never a URL or token.

## Validation boundary

`tests.rs` uses synthetic identities, a loopback Account API and pure state/trust
checks. It covers late login after cancellation, unknown rotation retirement,
snapshot redaction, schema limits, first/changed key confirmation, no pin on
failed handshake, stale commit rejection, scope isolation, atomic pin loading,
Native config bindings, endpoint restrictions, rename/remove preservation and
write readback conflict. These are core/HTTP fixtures, not live Logto or Native
registration acceptance. Plugin lifecycle tests use the pinned SDK Activity in
Robolectric. Full APK compilation, emulator/device behavior, real registered
callback login and production device directory acceptance must be reported
separately; no existing user account has been operated during development.
