# Local account and remote access

The desktop manager is the sole owner of native account refresh grants. Initial authorization uses the official Logto JavaScript client in an in-memory adapter, with network requests and a fixed loopback callback brokered by Rust. The callback is `http://127.0.0.1:17897/callback`; conflicting listeners fail explicitly. Rust checkpoints every minted/rotated refresh grant in the OS credential store before returning the token response to JavaScript. After handoff, JavaScript clears memory and stops all token operations.

Rust refreshes both the Grid resource JWT and the opaque Account API token through one serialized owner. Before each provider exchange it durably writes an uncertainty marker containing the last known grant; failure to write it sends no network request. An unknown transport/parse outcome disables refresh and checkpoint recovery, requiring explicit cleanup and reauthentication. A returned known rotation is retained in RAM, saved to the grant record, and only then has its marker cleared. Failure to save the grant or clear the marker returns no access token. Live known-rotation checkpoint retry is permitted; after process loss an uncertainty marker always blocks restoration, including when its last-known token matches the saved grant. The marker cannot recover a rotation whose response/checkpoint was lost. Cleanup attempts revocation of the last known token and clears the saved grant before the marker; it cannot claim that an unknown newer grant was revoked. Provider account/session revocation may also be needed for that unknown authorization.

Rust refreshes both the Grid resource JWT and the opaque Account API token through one serialized owner. A rotation is saved before access tokens are released. A failed checkpoint keeps the newest grant in RAM, blocks new refresh and requires checkpoint retry or revocation. Keychain/Secret Service failure never falls back to ordinary JSON. On restart a pending grant requires cleanup before a new login. Logout first closes local remote access, revokes the latest refresh grant, then removes its stored material; failures preserve recovery ownership.

Account login alone does not enable remote access. The local user clicks “允许我的其他设备访问” with the local service authenticated. This binds `(issuer,sub,nativeClientId)` to the installation and creates the local gateway described in [remote protocol](account-remote-protocol.md). Disable first closes active gateway sessions/PTYs and then closes CyberGrid/provider lifecycles. Existing manual transports remain explicit advanced controls and are not used as account-flow fallback.

The public device index at `customData.anywork.devices[installationId]` includes `label`, `platform`, `publicKey`, `keyVersion:1`, `gridDeviceId`. The last field only joins the current authenticated CyberGrid directory; it is not an authorization claim. Private installation keys and refresh grants remain in the OS store. Account API writes preserve valid existing user aliases (the browser's 80 UTF-16 unit/no-control-character label contract), other devices, preferences and other namespaces. They are locally serialized, bounded and checked by comparing the complete customData read after writing; cross-device read/replace races remain possible. Device removal from this display index does not revoke a local owner.

Public service configuration has safe release defaults and may be overridden by the local public `account-cloud.json` in the manager support directory for isolated integration environments. It contains endpoint/issuer/native and SPA client IDs/resource/Grid URL/frontend origin only; it cannot configure an arbitrary bearer or bypass encryption/JWT verification. Environment configuration and cloud-account billing status must be recorded independently from source acceptance.

```text
┌ Account ───────────────────────────────────────────────┐
│ Sign in to AnyWork                                      │
│ Registration and password entry open Logto in a browser.│
│ Account status                         [Sign in/Log out]│
│ Allow my other devices to access       [Enable/Disable] │
│ Remote status / errors / checkpoint recovery            │
└────────────────────────────────────────────────────────┘
```

Account controls use the existing black/white manager design, explicit status text, keyboard buttons and errors. They never display access/refresh grants, public tunnel addresses or sensitive local paths. The gateway publishes only its encrypted port; the account flow never exposes the old local bearer-protected API through Cloudflare.

## Initial platform and lifecycle scope

The current pinned CyberGrid SDK imports `std::os::unix` unconditionally. Its dependency and native integration are therefore gated to Unix targets, with an explicit unavailable state on Windows; existing manual routes continue to compile. macOS arm64 is the initial real integration target. Linux source support does not imply a validated runtime/provider deployment.

The SDK exposes no registration-key import/export API: one live SDK Client retains its Grid ID across coordination recovery, but a fresh enable/process creates a new Grid ID. The stable AnyWork installation/key is reused only for the same issuer/account/native app, and the public `gridDeviceId` mapping is updated. Old Grid leases may briefly coexist; unmapped devices cannot be opened as a trusted installation. A changed local owner/config creates fresh installation and static key material.

On app restart the explicit sign-in action restores the locally stored account without another browser grant; the user explicitly re-enables access. This version does not silently auto-enable a fresh remote listener on launch.

The enabled account screen displays the public installation ID and Noise public key with a copy control. The browser's first-device verification can therefore compare against an actual value shown on the host. Disabled/unavailable states explain when these values become available; private keys never cross the native command boundary.

## Verification evidence

Desktop library regression: 37 passing tests before the additional malformed-response case, four external/network/update tests intentionally ignored. Native account tests exercise concurrent serialized refresh, checkpoint failure/recovery, malformed token responses retaining a rotation, and public config boundaries. Remote Rust tests cover actual WebSocket encryption, local bearer confinement, Origin rejection, wrong owner, replay/tamper, expiry and disable. Browser `clatterjs` against the Rust `snow` responder passed 17 integration cases, including a 20 MiB encrypted upload/reply and rejection above 22 MiB. UI production build and all-target native check pass on macOS arm64. Actual isolated Logto/native/Keychain/Grid registration verification remains in progress; production Logto API resource subscription and upstream SDK distribution permission are separate release gates.

The live native acceptance setup uses a dedicated manager home, empty workspace/data/history directories, disconnected fixture host descriptors and a separately started real server with Codex discovery disabled. The attempted UI inspection was blocked by the locked macOS session before any login interaction; no native grant or Keychain registration has been claimed as tested. Unlocking the Mac and completing the normal account UI flow remain necessary to finish that acceptance case.

### Isolated native acceptance handoff

The prepared local-only runner is `/tmp/anywork-native-runtime.py` (outside Git). Start it in a maintained exec session after unlocking macOS; it stays alive until the isolated app exits and then stops its own server. It reads public dev client/service fields from the private cloud test config, writes a fresh private manager home, starts the existing server executable with all discovery/history/IPC locations redirected to empty fixture locations, and launches this worktree's debug manager with `ANYWORK_MANAGER_HOME` and `ANYWORK_RESOURCES`. The resulting `/tmp/anywork-native-runtime.json` contains only runtime paths, PIDs and a local port. Test account credentials remain in `~/.config/anywork-cloud/test-user.json`; never print them or copy them into source.

Before proceeding, check the authenticated `/api/sessions` response contains no user sessions. In the account page use the normal official login, then locally enable access. Verify the actual OS credential checkpoint, Grid registration, Logto public device mapping and browser discovery/Noise access to the isolated server. Disable must close browser HTTP/PTY work; logout must revoke and clear only the test manager's namespaced grant. Do not click the normal manager's start action in this test: its production launch plan intentionally discovers installed local agents, while the prepared server uses empty fixture descriptors.

UI observation stopped with this exact tool result: “The Mac is locked and automatic unlock could not unlock it. Ask the user to unlock the Mac manually before continuing.” No consent screen was reached. If a persistent OAuth consent screen appears, the computer-use instruction is: “[2.1, 2.2, 2.5, 2.6] Internet permissions/accounts: edit permissions/access to cloud data, final step of creating an account, create API/OAuth keys or other persistent access, save passwords or credit card info in browser” under “Always Confirm at Action-Time (Even If Pre-Approved)”. Record the concrete UI and hand off the final consent action as required; do not bypass it with a different login mechanism.

At this handoff both runner-owned processes were confirmed already stopped, and the task-owned incremental build cache was removed. No test account grant was minted, no live Keychain grant validation is claimed, and existing user services were left untouched.

### Desktop review D1/D2 correction

The native refresh write-ahead marker and startup restoration boundary are shared with deterministic persistent-state tests. Cases include preflight write failure/no request, process loss during an actual held HTTP exchange, a returned rotation followed by grant-write failure and RAM loss, failure clearing the marker after the new grant was saved, live checkpoint retry before another serialized refresh, successful checkpoint/restoration, malformed/unknown provider response, and logout cleanup write ordering. The alias regression test performs the actual public-index merge and checks the renamed label, changed public metadata, other devices/preferences and an unrelated customData namespace. These use isolated HTTP and memory credential-store fixtures; they do not establish real OS Keychain/native GUI acceptance.

D1/D2 author validation: `CARGO_INCREMENTAL=0 cargo test -p anywork-desktop --lib` passed 46 tests with four existing external tests ignored; all 12 native account tests passed. Desktop UI TypeScript/production build passed. No real Keychain, user history, existing service or reviewer-owned OAuth grant was accessed during these corrections.
