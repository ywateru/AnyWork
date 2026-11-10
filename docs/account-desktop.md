# Local account and remote access

## Current contract: account secrets stay in memory

The native account path keeps refresh/access tokens, Noise private keys and CyberGrid registration material only in process memory. It does not call OS Keychain/Secret Service, read old account credential records, or write secrets to ordinary files. Closing the client loses this authorization: the next process starts signed out and remote access disabled. Existing manual connection credential settings remain separate and unchanged.

The desktop manager owns one serialized refresh lifecycle. Initial authorization uses the official Logto JavaScript client with an in-memory adapter; Rust brokers pinned issuer requests and the fixed loopback callback `http://127.0.0.1:17897/callback`. Rust retains each returned rotation in RAM before returning it across IPC. JavaScript requests the opaque Account API token and the Grid resource JWT serially. The `OwnedInMemory` handoff ACK transfers exclusive refresh ownership to Rust; JavaScript clears its tokens and stops refreshing. Rust then serves both token classes under one mutex. No refresh owner is restored after restart.

Before dispatching a token exchange the RAM owner marks its outcome uncertain. A lost, malformed or unconfirmed exchange blocks reuse of the old grant, including retries through the initial broker. A known returned rotation is retained before the rest of its response is validated. An invalid grant or unknown outcome requires ending this authorization and logging in again. Cancellation/logout waits for the sole in-flight exchange, closes gateway/PTY/SDK/provider access first, then attempts revocation of the latest **known** grant. Revocation failure retains RAM ownership and exposes retry. An unknown newer grant cannot be proven revoked; provider account/session revocation may be needed. Closing the process discards RAM but is not a claim that cloud authorization was revoked.

The official pinned CyberGrid SDK's `Client::new` initializes `grant_store: None` and generates its registration key in RAM. AnyWork installs only its RAM `AuthProvider`, calls `login_with_access_token`, and never calls `use_credential_store`, SDK browser login/import, or credential loading. SDK coordination recovery asks this same provider. Upstream SDK source and license are unchanged.

## Public device identity and key rotation

The only generated account identity file is `<manager support>/account-installations/<binding hash>.json`, containing exactly one non-sensitive random `installationId`. Its filename hashes the complete public configuration, manager support path and owner subject; neither subject nor tokens/keys are stored in its contents. File writes use the existing atomic private-file helper. Existing malformed, oversized, non-file or symlink identities are rejected without replacement; the account-installations directory cannot be a symlink. No old account secret namespace is scanned or migrated.

For the same owner/config/support directory, each new process reuses this public ID but generates fresh Noise keys when remote access is enabled. The public Logto record at `customData.anywork.devices[installationId]` contains `label`, `platform`, `publicKey`, `keyVersion` and `gridDeviceId`. A changed public key increments the existing positive safe-integer `keyVersion`; retries with the same key retain its version. Invalid/exhausted versions fail closed. Repeated restarts update one directory item, rather than adding offline installations. Different owners/configurations receive separate IDs and fresh keys. Removing the local ID file deliberately creates a new installation and can leave its old public directory item behind.

The browser's old pin is never silently accepted after a key change: the user must explicitly confirm the new key against the host's displayed installation/public key. Login alone does not enable access. The host must explicitly enable it with the local service authenticated. Disable closes active remote work before retiring coordination/provider lifecycles. Manual transports are independent advanced controls and are not an account-flow fallback. See [remote protocol](account-remote-protocol.md) for encrypted HTTP/files/event/PTY boundaries.

`gridDeviceId` joins the current authenticated CyberGrid directory; it is not an authorization claim. The SDK has no registration-key import/export API, so a fresh SDK Client can have a different Grid ID. The stable installation ID maps to the current Grid registration. Old Grid leases/registration fences may briefly coexist according to upstream retention; unmapped devices cannot be opened as a trusted installation. This client does not change cloud metadata retention. The Logto index permits at most 32 devices and 32 KiB customData. Writes preserve valid aliases (80 UTF-16 units, no control characters), other devices, preferences and other namespaces; they are locally serialized and compared against a full readback. Cross-device read/replace races remain possible. Removing an index item does not revoke a host authorization.

## Client entry and state

```text
┌ AnyWork 账号 ──────────────────────────────────────────────┐
│ 尚未登录                  [注册] [登录] [账号与远程访问] │
└────────────────────────────────────────────────────────────┘
  Existing overview / local service / advanced connections

┌ 账号与远程访问 ────────────────────────────────────────────┐
│ 已登录 · account email/username                 [退出账号]│
│ 凭据和设备私钥仅存内存，退出客户端后需重新登录             │
│ 允许我的其他设备访问                         [开启/关闭] │
│ 已开启：设备身份、公钥、复制控件                           │
└────────────────────────────────────────────────────────────┘
```

The overview and welcome screen expose independent registration and login actions. One controller and official adapter use `firstScreen:register` or `firstScreen:signIn`. The account label comes from the existing Account API response (email, username or name; otherwise a short subject); no additional management request or scope is added. The black/white UI never displays tokens, private keys, sensitive paths or public tunnel URLs.

Native `authorizationStatus` controls actions: signedOut offers registration/login; authorizing/loginInterrupted retain cancellation; signedIn offers logout; reauthRequired offers ending this authorization before relogin; unsupported explains platform limits. Generic network errors never imply a signed-in account. After failures the UI re-reads native state. Native transaction IDs survive renderer remounts, and a stale JS adapter keeps an explicit cancellation control until cleaned. There are no checkpoint, saved-grant recovery or Keychain actions in the current account UI.

## Self-hosted defaults and complete override

Defaults now use the user's self-hosted Logto service: endpoint `https://auth.x.aixgg.com`, issuer `https://auth.x.aixgg.com/oidc`, Native client `x7lzj58abb1sdp16lkd34`, SPA client `5ere2kbu9mugfu3xd8e90`, resource `https://anywork-cybergrid-selfhost.vercel.app/api`, Grid `https://anywork-cybergrid-selfhost.vercel.app`, frontend origin `https://anywork-tau.vercel.app`. These seven public Native fields correspond to the Web's five public identity/Grid defaults; issuer is derived from the endpoint in Web. No management secret belongs in either client. The account portal stays `https://anywork-tau.vercel.app/app/`.

The self-hosted tenant uses username/password registration and has no email connector. This client configuration does not establish email delivery or verification. The fixed Native callback remains `http://127.0.0.1:17897/callback`; the SPA's registered callbacks include the public app and explicit localhost development origins. The complete override and all memory-only constraints above remain unchanged. Old Logto Cloud grants, drafts and installation namespaces are not imported into this issuer. New login and explicit local enable are required; previous Development acceptance remains historical evidence and cannot validate the self-hosted chain.

For another deployment, replace all **seven** public fields in `<manager support>/account-cloud.json` before launch:

```json
{
  "endpoint": "https://identity.example.org",
  "issuer": "https://identity.example.org/oidc",
  "nativeClientId": "self-hosted-native-app",
  "spaClientId": "self-hosted-browser-app",
  "resource": "https://grid.example.org/api",
  "cybergridUrl": "https://grid.example.org",
  "frontendOrigin": "https://work.example.org"
}
```

Missing/unknown fields, insecure service URLs and issuer/endpoint mismatch are rejected; this is a complete replacement rather than a merge. Register the exact native callback `http://127.0.0.1:17897/callback` and align Grid/browser issuer, client, resource, scopes and Account API contracts. The frontend origin must be exact; HTTP is allowed only for explicit localhost/127.0.0.1 development origins. Every public field participates in identity isolation, so any configuration change requires a new login/registration. Disable and log out under the old configuration before migration; the new configuration never reads previous grants. For historical persisted grants, use the earlier application/configuration or the identity provider's session controls for cleanup; the current account runtime deliberately cannot read them.

## Platform and verification scope

The pinned SDK imports `std::os::unix` unconditionally. Account integration is gated to Unix; Windows displays unavailable while existing manual routes remain supported. macOS arm64 is the initial actual integration target. Linux source compilation does not establish validated runtime/provider deployment. Upstream licensing/distribution permission remains independently recorded in [native dependency notices](../desktop/CYBERGRID_NOTICES.md).

Memory-only regressions use isolated HTTP fixtures and temporary directories: serialized Account/Grid rotation; unknown exchange refusing replay; process restart signed out with stable public ID/fresh keys; owner/full-config isolation; malformed/symlink identity rejection; one updated directory record/version increment; alias/preferences/namespace preservation; failed revocation retaining RAM and successful retry; existing legacy sentinel left untouched. Rendered UI tests use a synthetic Tauri bridge, not a real OAuth or Keychain operation, and cover separate hosted screens, failed-login retry, cancellation races, RAM-only notice, account label and reauthentication controls.

The earlier Rust `snow`/browser `clatterjs` interop evidence includes actual encrypted HTTP/binary/PTY, 20 MiB upload/reply and over-limit rejection; it is separate from native account acceptance. Real native login → Grid registration → Logto public index → browser discovery → isolated real API acceptance must be recorded against this new exact candidate by the orchestrator. No old Keychain test is evidence for this implementation.

## Historical implementation and reviews

The previous design persisted grants/private keys and used checkpoint/write-ahead recovery. It is superseded by the memory-only contract above. Its implementation and isolated evidence remain in Git and reviews [01](plan/reviews/account-desktop-01.md), [02](plan/reviews/account-desktop-02.md), [03](plan/reviews/account-desktop-03.md); these describe historical behavior only.

An earlier native acceptance attempt stopped at the exact computer-use error “The Mac is locked and automatic unlock could not unlock it. Ask the user to unlock the Mac manually before continuing.” No consent screen or full Keychain/Grid chain was validated then. The outside-repository `/tmp/anywork-native-runtime.py` runner was an isolated test helper with empty workspace/history and disconnected fixture descriptors; it must be reviewed against the current candidate before reuse. Never read/migrate old test or user Keychain grants for memory-only acceptance. Keep existing user processes/history untouched.

Memory-only author checks for this candidate: `CARGO_INCREMENTAL=0 cargo test -p anywork-desktop --lib` passed 45 tests with four existing external tests ignored (11 current account tests); desktop TypeScript/production build and rendered `test:account-entry` regression passed. These tests accessed no real Keychain, OAuth grants, user history or existing services. Full clippy/debug-binary checks are reported separately with the delivered candidate.

## Safe enable-stage diagnostics

An enable failure returns one fixed typed stage code through the native boundary. The UI accepts only the exact allowlist, renders a fixed explanation with that code, and keeps retries manual. Unknown IPC errors retain the generic message. Underlying provider/SDK/HTTP errors are discarded at this boundary, never appended or logged; tokens, public tunnel URLs and provider response bodies cannot become diagnostics. These codes identify the failed step, not its root cause or a successful restart acceptance.

| Code suffix (`REMOTE_ENABLE_…`) | Step |
| --- | --- |
| `IDENTITY` | Read public installation ID / prepare fresh local key |
| `GATEWAY` | Prepare JWT verifier / start local encrypted gateway |
| `PROVIDER` | Resolve/start/configure public tunnel or await its URL |
| `GRID_CLIENT` | Construct the RAM-only coordination client |
| `GRID_CONFIG` | Fetch and verify pinned coordination auth configuration |
| `GRID_CONFIG_UNAVAILABLE` | Public coordination configuration GET remained temporarily unavailable after bounded retries |
| `RESOURCE_TOKEN` | Refresh Grid authorization through the sole RAM owner |
| `GRID_REGISTER` | Register and install the new coordination session |
| `GRID_EXPOSE` | Publish the encrypted gateway port |
| `INDEX_TOKEN` | Refresh opaque Account API authorization |
| `INDEX_READ` | Read the public account index and verify account identity |
| `INDEX_SCHEMA` | Validate/merge index, key version, aliases and capacity |
| `INDEX_WRITE` | Write the merged public index |
| `INDEX_READBACK` | Read and compare the result after writing |

An early historical memory-only native acceptance connected through a public Noise gateway and disable disconnected the browser. The subsequent same-manager restart correctly started signed out, but re-enabling after another login failed before updating the existing version-1 public record. That failed run does not establish its cause or a successful restart; later accepted restart and formal-origin evidence are recorded in the current cutover report.

The public Native configuration GET now has at most three attempts, each bounded to eight seconds, with 250ms/750ms delays (25 seconds total). Only transport failures, timeouts and HTTP 408/429/500/502/503/504 are retried. Schema/protocol errors, rejected requests and mismatched issuer/resource/client fail immediately with `GRID_CONFIG`; exhausted temporary failures use `GRID_CONFIG_UNAVAILABLE`. No response body, URL or credential is surfaced. This retry applies only to the initial unauthenticated GET, not OAuth exchanges, registration, publication or account writes; the pinned SDK may independently fetch configuration again inside registration. Login without successful explicit enable does not publish the Logto device index, so the browser correctly cannot open that device yet; after successful publication the browser's next 20-second refresh discovers it.

Diagnostics author validation: desktop library 47 passed/four existing external tests ignored; the additional tests exercise all 13 fixed codes, discard a synthetic secret/URL cause, and call the real index-publication path against isolated token/read/schema/write/readback failures while counting requests. UI build and rendered regression verify stage visibility, one request per click, and generic fallback for arbitrary URL-bearing errors. These checks do not establish the real restart failure's cause.

Self-hosted default author validation uses exact assertions for all seven Native fields and all five Web fields, complete alternate overrides, browser grant isolation from the old Cloud issuer, and a temporary-directory native regression proving the old issuer's public ID is not reused and startup remains signed out. The unchanged current account/remote tests continue to cover RAM-only ownership, rotation, fresh restart keys and explicit authorization. Real self-hosted login and cross-device acceptance are separate orchestrator checks; no management credential or cloud grant is used by these regressions.
