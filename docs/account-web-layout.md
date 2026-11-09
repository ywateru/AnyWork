# Account entry and device UI

The existing AnyWork white/black design is the source of visual identity. This implementation uses white `#FFFFFF`, navigation `#FAFAFA`, light surfaces `#F4F4F4`, text/action `#171717`, secondary `#737373`, borders `#E7E7E7`; online success `#208454` and error red express state only. The system UI stack and existing bundled Chinese font remain. Headings are 24–26px in account screens, body 14–15px; homepage headline is larger. Keep the canonical AnyWork logo.

The design borrows the quiet, application-like account entry and narrow navigation from DeepSeek Harness, with device rows as its central interaction. The homepage shows how local work continues on another device. Download links remain exact immutable GitHub release assets. Avoid decorative gradients, blue accents, invented statistics, and a dashboard of unrelated cards.

## Homepage

```text
┌────────────────────────────────────────────────────────────────┐
│ AnyWork       工作界面  安全与连接  下载       English  [登录]   │
├────────────────────────────────────────────────────────────────┤
│ 工作，随你继续。                  ┌── 我的设备 · 示意界面 ──┐  │
│ 在自己的电脑上运行 Agent。        │ 工作电脑  在线          │  │
│ 从另一块屏幕继续对话和工作。      │      加密连接后打开工作区│  │
│ [注册并查看设备] [下载桌面端]      │ 家中电脑  离线          │  │
│                                  └─────────────────────────┘  │
│ 真实工作界面预览 / 设备访问流程 / 数据边界 / 平台下载 / FAQ     │
└────────────────────────────────────────────────────────────────┘
```

The site is bilingual `/en/` and `/zh/`; `/` negotiates language while explicit language links remain stable. `/app/` opens the account application, `/app/?signup=1` requests Logto signup, `/app/callback` handles the official SDK callback. Passwords are entered only on the Logto hosted page.

## Account and devices

```text
┌──────────────────────────────────────────────────────────────┐
│ AnyWork                                       [账号 / 退出]  │
├─────────────┬────────────────────────────────────────────────┤
│ 我的设备    │ 我的设备                    [刷新] [添加设备]   │
│ 使用指南    │ 在工作电脑上登录同一账号并允许远程访问。        │
│             │                                                │
│             │ 电脑图标  工作电脑     在线  [打开工作区]       │
│             │          macOS          [设备名称 / 移除显示]  │
│             │ 电脑图标  家中电脑     离线                    │
│             │                                                │
│ 高级连接    │ 协调服务不可用时显示“暂时无法确认设备状态”。    │
└─────────────┴────────────────────────────────────────────────┘
```

On 390px screens the side navigation becomes an inline header; device actions wrap below the label and state. Focus rings remain visible; actions have text labels and do not rely on hover. Add-device opens a dialog with download/local authorization instructions. Escape and close return focus to the trigger. Loading, empty, unknown, offline, unavailable secure endpoint, connecting, cancellation, and errors are distinct states. Device removal only hides the non-security directory entry; explain it does not revoke the computer's access.

## Data and lifecycle

Only public Vite configuration enters static bundles: `VITE_LOGTO_ENDPOINT`, `VITE_LOGTO_APP_ID`, `VITE_LOGTO_RESOURCE`, `VITE_CYBERGRID_URL`, `VITE_CYBERGRID_NATIVE_APP_ID`. Logto official browser SPA SDK owns authorization. A small React context uses that same client directly so SDK errors are handled with fixed UI messages rather than the React hook’s raw console logger. Account API uses its opaque no-resource access token; CyberGrid uses resource JWT. The fixed Native app ID selects this product's devices.

`customData.anywork` has schemaVersion 1, optional locale/appearance preferences and at most 32 device records. Device fields are installation ID, label, platform, base64url 32-byte public key and positive keyVersion. The public `gridDeviceId` maps the installation to live CyberGrid directory entries and is never authorization. Limit labels to 80 characters and complete customData to 32KiB. Writes read the complete object, preserve other namespaces, serialize on this client and verify after patch. Concurrent clients can still lose updates because the API has no CAS; report verification conflict explicitly and never use this object as an authorization or revocation database.

The account root owns current user and device connection. Logout/account changes abort directory/account reads and requests, close encrypted sessions and unmount the workspace. Business connections never persist in `ra.connection`. Storage scopes use issuer/sub/installation ID, independent of tunnel URL. Existing advanced/manual connection remains available in local/native workspace entry `/`. The hosted `/app/` entry explains where to use it and keeps its restrictive CSP; it does not submit legacy plaintext business HTTP to arbitrary hosts. Account mode must not silently restore a previous manual connection.

The browser pins the currently selected public device key; a changed key requires explicit confirmation before connection. Browser E2EE follows [local protocol](account-remote-protocol.md) once finalized. Device URLs from CyberGrid are only connection addresses; no business HTTP fallback is permitted. All API, binary, event polling, preview and PTY traffic passes the encrypted adapter. User business data and keys are not cached by the service worker.

## Supported account endpoint

The first account-enabled endpoint target is macOS. The upstream native SDK currently relies on Unix credential storage and its bundled provider is qualified only on supported targets. Windows download availability describes existing manual connections; it does not imply account remote support. The add-device dialog names macOS explicitly until additional platform acceptance is recorded.

## Validation recorded on 2026-11-09

- TypeScript compilation passes. AccountStore boundary tests cover complete configuration, schema/size/public-key/prototype validation, preserved namespaces, serialized writes, detectable replacement conflicts and cancelled token resolution.
- The actual browser clatterjs client interoperates with the Rust snow gateway example: 17 assertions cover handshake, real local API response, chunked140k and20MiB upload/response, >22MiB rejection, connection-wide22MiB assembly budget,8concurrent requests, multipart encoding,100k binary download, PTY, cancellation, ciphertext at the relay boundary, replay closure, wrong token/key and plaintext URL rejection. `web/scripts/remote-interop.mjs` explicitly requires an isolated native checkout and test fixture; the product has no plaintext test endpoint. The fixture account verifier is a test verifier, so this does not prove production Logto JWT verification.
- Bilingual website browser checks pass at1440/1024/768/390/320px, including tabs, keyboard, download versions and language negotiation. Screenshots are local `artifacts/anywork-site-{en,zh}-{width}.png`.
- Production account service remains gated by Logto production resource/role plan availability. Real hosted OAuth/AccountAPI/registered device lifecycle tests are separate integration gates. Windows account endpoints remain unsupported. Native-device/cellular testing, permission grant, service behavior and release gate are not inferred from these Web checks.

Dependency coordination exception: this task updates only `desktop/ui/package.json` dependency declarations for pinned `@logto/browser3.1.2`, `@logto/client3.2.2`, `jose5.10.0` plus root `package-lock.json`, coordinated with the desktop lane.

HTTP request timeout is240seconds capped by the remaining authenticated session lifetime (at most300seconds); chunk acknowledgements time out after15seconds. This allows supported20MiB uploads across mobile round trips without silently reducing the business API limit. A session expiration still closes all requests and terminals.
