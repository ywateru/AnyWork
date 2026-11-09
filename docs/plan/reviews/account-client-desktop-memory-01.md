# Independent desktop client entry and memory-only account review

- Accepted exact candidate: **`7756b67a020cc99319c0cc082f6c2e1fedc68ee7`**.
- Product implementation: `fcf4f32b7ec76cb6f239f792e354a0dc9f1b5c61`; `7756b67` changes only one test's equivalent default-configuration initialization for Clippy.
- Scope: latest memory-only amendment in [account-client-entry](../tasks/account-client-entry.md), the retained client entry work from `46ac30b`, and the current [desktop contract](../../account-desktop.md).
- Reviewer: independent `verify_desktop`; date/platform: 2026-11-09, macOS arm64.
- Verdict: **PASS for source review and the isolated checks below. No blocking finding identified.** This supersedes the older persistence/checkpoint acceptance for the new account path. Real native/cloud full-chain acceptance remains separate.

## Account storage and SDK call chain

Reviewed the complete account implementation, UI controller/entry and native command wiring. `Grant` and `Installation` are RAM-only state; the account module no longer imports/calls `Secrets`, `OsSecrets`, Keychain/Secret Service, old account record keys, or restoration/checkpoint helpers. Startup creates no owner/installation and a signed-out/disabled snapshot. Login always starts a new browser transaction. The JS official adapter stores every SDK item in a `Map`, with no browser storage fallback. `OwnedInMemory` ACK installs the sole native owner, removes the transaction and is followed by JS token clearing (`accounts.rs:687`, `desktop/ui/src/accounts.tsx:194`).

The only account filesystem paths are the complete public configuration, the public UUID identity file, and an empty tunnel configuration. The UUID file contains exactly `installationId`; grants, private/public keys and owner subject are not serialized into it. The existing manual transport credential feature is separate and was not changed or used by these checks.

Independently inspected the pinned upstream SDK source at `2bd6729c6bbee90ed2926410caca883a0a100890`: `sdk-rust/src/client.rs:78` creates its registration key in RAM and `:117` initializes `grant_store` to None. AnyWork constructs the Client with SDK cloudflared disabled and installs only `GrantOwner` as its provider (`accounts.rs:843`). It calls `login_with_access_token`, not SDK browser authorization/import/loading or `use_credential_store`. The credential-store implementation is therefore not bound by this path. SDK recovery uses the same RAM provider. SDK tunnel-file creation is not the account path's selected provider; the separate AnyWork provider writes only `{}` configuration. No implicit account secret store was found in the selected call chain.

## Refresh, cancellation and cleanup

`GrantOwner::token:161` serializes both Account API and resource exchanges under one mutex, marks RAM uncertain before network dispatch, captures a returned new refresh token before checking the rest of the response, and refuses replay after an unknown outcome. The initial native broker independently serializes exchanges, tracks the latest token in RAM and blocks another token exchange after an unknown response. Commit checks the exact latest known grant, transaction uncertainty/cancellation, real Native resource JWT signature/identity and opaque Account API identity before ownership transfer.

Native cancellation/cleanup waits for the transaction exchange before revoking its latest known grant. Logout closes remote work first, then waits for/revokes the RAM owner's latest known grant; failure retains ownership for retry (`accounts.rs:947`, `:989`). Successful logout drops owner and private installation state. Process exit loses all account secrets and does not claim provider revocation. Unknown newer authorizations remain unknowable; the document and interrupted-owner UI correctly avoid promising their revocation and point to provider cleanup when needed.

The UI uses native authorization state, rather than a generic error, to select register/login, cancel, logout or ending/relogin controls. Separate register/login actions use the official `firstScreen` values with PKCE/state. Welcome, overview and account page share the App-level controller. A stale JS adapter is matched by transaction ID; completed native cancellation can be recognized by a new snapshot instead of permanently blocking another login. There are no account checkpoint/Keychain recovery controls in the current UI. Account label derives from the already fetched account profile with bounded/control-free display text; no additional management scope/request is introduced.

## Public identity, fresh keys and index rotation

The public file binding hashes all seven public fields, the support path and the owner subject (`accounts.rs:223`). Same owner/config/support reuses one random UUID; another owner/config gets another UUID. Existing malformed, oversized, non-file or symlink identities and a symlink identity directory are rejected without replacement. No old account secret namespace is scanned or imported. Public configuration is a complete required seven-field replacement with unknown fields rejected and HTTPS/exact-origin/issuer checks; Development defaults are explicit.

New native state reuses only the UUID and generates fresh Noise key material in RAM (`:717`). The Logto merge updates the same record, preserves valid aliases/preferences/other devices/namespaces, increments a changed key's positive safe-integer version, keeps the version for a same-key retry and rejects invalid/exhausted versions. A full customData readback checks the write; cross-device read/replace races remain documented. Repeated modeled restarts therefore do not add another offline installation each time.

Reviewed the current browser connection contract in `web/src/AccountApp.tsx:573`: the old pinned public key is compared before connecting; a mismatch opens the changed-key dialog and requires explicit confirmation. The new key is pinned only after successful encrypted connection. This is source evidence for the existing browser behavior, not a new real browser/host key-rotation acceptance run.

## Independent checks

Ran against accepted `7756b67` after the author's build released the target:

```sh
CARGO_INCREMENTAL=0 cargo test -p anywork-desktop --lib -p anywork-remote --tests
npm run test:account-entry --workspace desktop/ui -- http://127.0.0.1:3237
npm run build --workspace desktop/ui
cargo fmt --all -- --check
git diff --check
```

All passed. Rust results: desktop **45 passed, 0 failed, 4 ignored**, including **11 current account tests**; remote **2 protocol + 4 gateway passed**. Desktop main has no tests. The four external/bundled/tunnel/update cases remain ignored. The current account cases cover serialized RAM rotation; unknown owner/broker response refusing replay; recreated native state signed out with one stable UUID/fresh keys; full-config/owner isolation; malformed/symlink identities; bounded one-record version increment/alias preservation; failed revocation retaining RAM with successful retry; ignored legacy-file sentinel; complete self-hosted config and bounded account labels.

The rendered test uses a synthetic Tauri bridge and aborts all non-local network requests. It verifies actual register/login controls and official URLs (`first_screen=register/signIn`, PKCE/state/callback), failed-login retry, pending cancellation race, RAM-only notice, account label, absence of checkpoint controls and reauthentication actions. The generated desktop/welcome screenshots were inspected during this review sequence; entry controls are visible in the existing desktop layout.

An additional reviewer-only temporary extension exercised three independent DOM failure boundaries: a failed cancel preserves the cancel/ownership controls instead of showing logout; a lost IPC reply after native cancellation recovers to retry; a renderer reload with no JS adapter can cancel an interrupted transaction using only its native ID. All passed. The temporary script was deleted and the reviewer-owned local Vite server was stopped. No product source was changed by the reviewer.

No real OAuth request, Keychain access, old account credential read, root fixture, existing user service/history or paid/cloud deployment action was performed. The modelled restart uses fresh Handle instances and temporary directories; it is not a literal OS process-crash test. SDK no-store and browser changed-pin conclusions combine source/call-chain review with isolated account tests, not an end-to-end interception trace of a real account session. The earlier actual JWT/crypto tests concern the unchanged verifier/transport and do not substitute for this new native lifecycle.

Real native registration/login → memory ownership → explicit enable → Grid registration/public index → browser discovery/changed-key confirmation → isolated business API/PTY → logout acceptance must be recorded against this memory-only candidate. Physical-device/email/runtime/platform and distribution-license limitations remain as documented. The Development-backed stage does not require buying a Logto production plan and must not be described as paid production infrastructure.
