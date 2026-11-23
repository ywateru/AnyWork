# Local account, saved login and remote access

2026-11-22 · current CyberBus implementation

## Authorization ownership

The desktop account has one refresh owner. Initial authorization uses the
official Logto JavaScript client with an in-memory adapter; Rust brokers the
pinned issuer requests and the fixed loopback callback
`http://127.0.0.1:17897/callback`. Rust keeps every returned rotation in its
journal before returning it across IPC. JavaScript requests the opaque Account
API token and the CyberBus resource JWT serially. The ownership handoff moves
exclusive refresh control to Rust; JavaScript clears its tokens and stops
refreshing.

Normal browser authorization requests consent without forcing a new login. A
valid identity-provider session in the same system browser/profile may satisfy
the separate Native PKCE grant; Web tokens and cookies are never copied into
the client. Consent, expired sessions, another profile or provider policy can
still require interaction. The callback page reports receipt rather than
successful token verification, clears its query, loads no external resources
and never reflects credentials or provider error text.

Before dispatch, a token exchange is marked pending. A lost, malformed or
unconfirmed exchange blocks replay of the old rotating grant. A returned
rotation is retained before the rest of the response is validated. Logout waits
for the sole in-flight exchange, closes the gateway/PTY/network first, then
attempts revocation of the latest known grant. Revocation failure is exposed as
`ACCOUNT_REVOCATION_PENDING`; the local grant journal is retired separately.

## Saved login

macOS and Linux use the operating-system credential store through
`keyring-core`. The service name is `dev.anywork.desktop.oauth.v1`; the account
key is the full public-configuration namespace hash. The stored record contains
schema, the complete public configuration, a random owner ID, the verified
subject, refresh grant and journal phase. It is bounded to 32 KiB and is never
included in IPC snapshots.

The journal phases are `provisional`, `pending`, `ready` and `retired`.
`pending` is written before a refresh POST, so a restart cannot silently replay
an unknown rotation. Restore accepts only a `ready` record whose config,
namespace, subject and size are valid. Unavailable, locked or failed credential
stores produce fixed account-store errors and never fall back to a plaintext
file. Explicit logout deletes the stored record; failure to confirm deletion is
reported rather than claiming success.

Endpoint private keys, Noise session keys and CyberBus credential claims remain
in process memory. The saved record does not contain device private keys,
network secrets, access tokens or CyberBus derived material. See
[saved-login behavior and verification](login-session-persistence.md).

## Public device identity and rotation

The only generated account identity file is
`<manager support>/account-installations/<binding hash>.json`, containing one
non-sensitive random `installationId`. Its filename hashes the complete public
configuration, manager support path and owner subject. Malformed, oversized,
non-file or symlink identities fail closed.

For the same owner/config/support directory, each process reuses the public ID
but generates fresh Noise keys when remote access is enabled. The Logto record
at `customData.anywork.devices[installationId]` contains exactly:

```json
{
  "label": "Mac · AB12",
  "platform": "macos",
  "publicKey": "43-character-unpadded-base64url",
  "keyVersion": 1
}
```

The CyberBus locator is stored separately at
`customData.anywork.cyberbus[installationId]`:

```json
{
  "version": 1,
  "productId": "anywork",
  "ipv4": "10.144.0.42",
  "port": 11001,
  "keyVersion": 1,
  "issuedAt": 1760000000,
  "expiresAt": 1760000600
}
```

The locator is a discovery hint, not authorization. It is accepted only inside
`10.144.0.0/20`, never on control port `11000`, with a positive TTL no longer
than 24 hours. The Web client additionally requires a 600-second TTL and a
matching installation key version. The desktop republishes the locator before
its 600-second expiry while the overlay is enabled.

A changed public key increments the positive safe-integer `keyVersion`; retries
with the same key retain it. Invalid or exhausted versions fail closed. The
browser does not silently accept a changed key: the user confirms the new key
against the host's displayed installation/public key. Removing the local
identity file deliberately creates a new installation and can leave the old
public record behind until it expires or is removed.

The account index permits at most 32 devices and 32 KiB custom data. Writes
preserve other devices, preferences, locators and unrelated namespaces; they are
locally serialized and verified by full readback. Cross-device read/replace
races remain possible. Removing an index item does not revoke host access.

The non-secret installation name lives in
`<manager support>/device-name.json` as `{ "name": "Mac · AB12" }`. Native
rename compares the editor baseline with a fresh directory read and verifies the
result after writing. Readback failures do not appear as synchronized success.
Renaming does not regenerate keys, enable remote access or restart the service.

## CyberBus enable and disable

An enable starts only after the local workspace is authenticated and ready. The
host:

1. reads the public installation ID and generates fresh Noise keys;
2. starts the loopback AnyWork gateway and its `connect` JWT verifier;
3. refreshes one resource token through the sole account owner;
4. verifies issuer, audience, Native client, subject, `network:join` and the
   CyberBus credential claim;
5. derives, with HKDF-SHA-256, the account network name/secret, application PSK
   and binding ID;
6. starts EasyTier with the configured bootstrap peers;
7. listens on virtual `11001`, accepts raw TCP streams and passes each through
   the same Noise, HTTP, PTY and limit policy as the local WebSocket entry;
8. publishes the bounded locator to Logto and republishes it before expiry.

The default remote policy is once after a successful login and workspace
preparation. A manual disable is remembered for that login session and cannot
be undone by polling, renderer reload or repeated preparation. An explicit
enable retry remains available. Disable closes active remote work, the overlay,
the gateway and PTY children before removing the locator.

The two authorization scopes are distinct:

- `network:join` permits derivation of the account's CyberBus overlay material;
- `connect` authorizes the AnyWork Noise gateway for the verified owner.

Both are issued for the CyberBus resource and both must be granted to the
AnyWork role in Logto.

## Fixed diagnostics

The Native boundary exposes only exact allowlisted stage codes. The UI renders a
fixed explanation and keeps retries manual. Unknown IPC text is replaced by a
generic message. Underlying URLs, response bodies, tokens and network secrets
are never appended or logged.

| Code suffix (`REMOTE_ENABLE_…`) | Step |
| --- | --- |
| `SIGN_IN_REQUIRED` | No usable saved login |
| `REAUTH_REQUIRED` | Rotation result unknown or grant invalid |
| `LOCAL_SERVICE` / `LOCAL_SERVICE_UPGRADE` | Local workspace not ready or incompatible |
| `CLEANUP_PENDING` / `CANCELLED` / `ALREADY_ENABLED` | Account remote policy state |
| `IDENTITY` | Read installation identity / prepare fresh local key |
| `GATEWAY` | Start the local Noise gateway |
| `NETWORK_TOKEN` | Refresh or verify the CyberBus resource token |
| `NETWORK_START` | Start EasyTier or derive overlay credentials |
| `INDEX_TOKEN` | Refresh the opaque Account API token |
| `INDEX_READ` / `INDEX_SCHEMA` / `INDEX_WRITE` / `INDEX_READBACK` | Publish and verify the public locator |

## Self-hosted defaults and complete override

Defaults use the self-hosted Logto service:

- endpoint `https://auth.x.aixgg.com`
- issuer `https://auth.x.aixgg.com/oidc`
- CyberBus resource `https://cyberbus.x.aixgg.com/api`
- product `anywork`
- bootstrap peer `tcp://43.155.169.102:11010`
- frontend origin `https://anywork.aixgg.com`
- Native callback `http://127.0.0.1:17897/callback`

The public Native and SPA client IDs are embedded deployment identifiers, not
management secrets. For another deployment, replace the complete public
configuration in `<manager support>/account-cloud.json`:

```json
{
  "endpoint": "https://identity.example.org",
  "issuer": "https://identity.example.org/oidc",
  "nativeClientId": "native-app",
  "spaClientId": "web-app",
  "resource": "https://bus.example.org/api",
  "productId": "anywork",
  "bootstrapPeers": ["wss://relay.example.org/"],
  "frontendOrigin": "https://work.example.org"
}
```

Missing or unknown fields, insecure URLs, issuer/endpoint mismatch and invalid
peers are rejected. Every public field participates in the saved-login and
installation namespaces, so changing the configuration starts a separate
account boundary and requires a new login.

## Platform and verification scope

Native account integration is available on macOS and Linux. Windows retains the
local workspace entry and reports the account runtime as unsupported.
Standalone anonymous/named tunnels, `cloudflared`, tunwg and WireGuard routes are
retired from the desktop user flow; no tunnel-provider binary is bundled.

Current automated evidence is recorded in
[the CyberBus migration record](cyberbus-migration-review.md). The production
WSS relay, TLS certificate, WebSocket upgrade and an EasyTier cross-transport
smoke are verified. A real three-endpoint desktop, Android and browser workspace
acceptance remains an explicit gate and is not claimed by those infrastructure
results.
