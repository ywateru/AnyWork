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
On first configure Rust accepts a native saved-grant restore only from `restoring`
and establishes a fresh runtime epoch. Configure/retry return without waiting for
network: public snapshots poll the process-owned restore and `refresh` while
`restoring` only checks status. `restoreRetryable` has no usable account or
connection targets; `mobile_account_refresh` retries native restore without SSO.
Native logout and Rust epoch fences reject a late restore after explicit logout.
Rust first retires access as `reauthRequired`/`MOBILE_AUTH_CLEAR_REQUIRED`; only a
confirmed durable native clear can report `signedOut`.
Only the plugin's new Keystore schema stores grant data; this module continues to
persist public trust pins only. See the [plugin lifecycle](../../../tauri-plugin-mobile-auth/README.md).

Foreground refresh is a read operation; it never silently logs in or replays a
business request. Native refresh keeps one serial owner even if a Rust caller
drops its future.

## CyberBus network, not SPA console

Android keeps the existing Kotlin Logto grant owner and obtains the CyberBus
resource token with both `connect` and `network:join`. `network.rs` verifies the
JWT, credential claim and account subject before deriving CyberBus network
material through the local `anywork-cyberbus` crate. The refresh token never
enters Rust, CyberBus, or WebView storage.

The derived material starts a native EasyTier overlay, opens the AnyWork Noise
Gateway on the selected locator address and port `11001`, and exposes only an
outbound byte stream. Control port `11000` is rejected. The device directory
contains public labels, platform, public key and key version; its versioned
`anywork.cyberbus[installationId]` locator is short-lived and independently
validated for product, overlay pool, service port, key version and expiry.
Missing, stale or mismatched locators are never treated as online evidence.

The existing Account API token remains opaque and has no resource. Only fixed
`/api/my-account` is used. Replies are bounded, redirects are disabled, subject
and account epoch are checked, and directory parsing follows the existing Web
schema/bounds. Update operations retain unknown customData and device fields,
reread before writing and verify the full result after writing. Device removal
also deletes that installation's CyberBus locator. Unknown write outcomes are
reported and never automatically retried.

Directory identity and locator availability remain separate. A failed account
read is `unknown`, not empty/offline. JS supplies a device reference, never an
address, URL or token. The redacted snapshot retains fixed CyberBus
configuration, token, startup and connect failure codes. JWT, seed, network
secret, PSK and service response bodies are never projected.

## Validation boundary

`tests.rs` uses synthetic identities, a loopback Account API, a real loopback
raw Gateway listener and pure state/trust checks. It covers late login after
cancellation, unknown rotation retirement, snapshot redaction, schema limits,
first/changed key confirmation, no pin on failed handshake, stale commit
rejection, locator product/staleness/port/key-version validation,
rename/remove preservation and write readback conflict. Transport tests exercise
JSON, binary, HTTP errors, PTY, renewal across the old lease, cancellation,
backpressure, malformed frames, maximum body size and the 22 MiB exact
round-trip. These loopback fixtures are not live Logto, CyberBus relay or
production device acceptance. Plugin lifecycle tests use Robolectric. Full APK
compilation, emulator/device behavior, real registered callback login and
production overlay connectivity must be reported separately.
