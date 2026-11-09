# Local account and remote access

The desktop manager is the sole owner of native account refresh grants. Initial authorization uses the official Logto JavaScript client in an in-memory adapter, with network requests and a fixed loopback callback brokered by Rust. The callback is `http://127.0.0.1:17897/callback`; conflicting listeners fail explicitly. Rust checkpoints every minted/rotated refresh grant in the OS credential store before returning the token response to JavaScript. After handoff, JavaScript clears memory and stops all token operations.

Rust refreshes both the Grid resource JWT and the opaque Account API token through one serialized owner. A rotation is saved before access tokens are released. A failed checkpoint keeps the newest grant in RAM, blocks new refresh and requires checkpoint retry or revocation. Keychain/Secret Service failure never falls back to ordinary JSON. On restart a pending grant requires cleanup before a new login. Logout first closes local remote access, revokes the latest refresh grant, then removes its stored material; failures preserve recovery ownership.

Account login alone does not enable remote access. The local user clicks “允许我的其他设备访问” with the local service authenticated. This binds `(issuer,sub,nativeClientId)` to the installation and creates the local gateway described in [remote protocol](account-remote-protocol.md). Disable first closes active gateway sessions/PTYs and then closes CyberGrid/provider lifecycles. Existing manual transports remain explicit advanced controls and are not used as account-flow fallback.

The public device index at `customData.anywork.devices[installationId]` includes `label`, `platform`, `publicKey`, `keyVersion:1`, `gridDeviceId`. The last field only joins the current authenticated CyberGrid directory; it is not an authorization claim. Private installation keys and refresh grants remain in the OS store. Account API writes preserve all other namespaces, are locally serialized, bounded and checked by a read after writing; cross-device read/replace races remain possible. Device removal from this display index does not revoke a local owner.

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
