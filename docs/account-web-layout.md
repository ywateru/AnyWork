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
- The actual browser clatterjs client interoperates with the Rust snow gateway example: 22 assertions cover handshake, real local API response, chunked140k and20MiB upload/response, >22MiB rejection, connection-wide22MiB assembly budget,8concurrent requests, multipart encoding,100k binary download, PTY, cancellation, ciphertext at the relay boundary, replay closure, wrong token/key and plaintext URL rejection. Review regressions also exercise native browser fetch, late authentic ACK after cancellation/timeout, rejection of unknown/malformed ACKs and session expiry notification. `web/scripts/remote-interop.mjs` explicitly requires an isolated native checkout and test fixture; the product has no plaintext test endpoint. The fixture account verifier is a test verifier, so this does not prove production Logto JWT verification.
- Bilingual website browser checks pass at1440/1024/768/390/320px, including tabs, keyboard, download versions and language negotiation. Screenshots are local `artifacts/anywork-site-{en,zh}-{width}.png`.
- Production account service remains gated by Logto production resource/role plan availability. Real hosted OAuth/AccountAPI/registered device lifecycle tests are separate integration gates. Windows account endpoints remain unsupported. Native-device/cellular testing, permission grant, service behavior and release gate are not inferred from these Web checks.

Dependency coordination exception: this task updates only `desktop/ui/package.json` dependency declarations for pinned `@logto/browser3.1.2`, `@logto/client3.2.2`, `jose5.10.0` plus root `package-lock.json`, coordinated with the desktop lane.

HTTP request timeout is240seconds capped by the remaining authenticated session lifetime (at most300seconds); chunk acknowledgements time out after15seconds. This allows supported20MiB uploads across mobile round trips without silently reducing the business API limit. A session expiration still closes all requests and terminals.

## Independent review corrections

The first independent review (`account-web-01`) reproduced a browser-only native fetch receiver failure, an authentic late chunk ACK closing the whole connection after request cancellation, and a closed transport retaining the workspace view. The corrective implementation wraps the default browser fetch, retires only the exact expected ACK for a cancelled/timed-out request (bounded by the session's1024 never-reused IDs), and delivers one transport-ended notification. Account UI consumes that notification only for the current transport and account lifecycle, clears the connection and returns to the device page without replaying writes.

Actual isolated DEV hosted Logto email/password sign-in and callback succeeded. After the fetch correction, at2026-11-09 19:42+08:00 the browser recorded Account API GET200, CyberGrid trusted config200, console exchange200 and devices200, with zero UI alerts and a real empty device list. This verifies that Web account/discovery session against the DEV services; it is not production readiness or proof of an enrolled native device. Private browser state remains outside Git with0600permissions. Healthy DEV screenshots are `artifacts/anywork-account-devices-dev-{1440,390}.png`; logged-out account screenshots are `artifacts/anywork-account-login-{1440,390}.png`.

At19:48+08:00 a subsequent run using the saved isolated browser state returned Account API401 twice and displayed the fixed account error/retry UI. That repeat is a failed acceptance run; its cause (expired/rotated grant versus Account token renewal) was not established and must not be reported as a repeated OAuth or discovery success. The script `web/scripts/account-cloud-check.mjs` requires a valid, independently owned DEV browser grant; do not reuse another reviewer's refresh grant. Native enrollment/registration/discovery/full remote interaction remains a separate unaccepted integration gate.

The second independent review accepted W1/W2/W3 and independently completed fresh DEV login and immediate owned-state Account/Grid200 checks. Its W4 correction is limited to verification credentials: `account-cloud-check.mjs` now requires an absolute normalized path outside every Git worktree, a regular current-user file with0600or stricter permissions, a directory without group/other write access and no symlinks in the traversal. It acquires an exclusive sidecar lease before loading; Playwright receives the parsed state object rather than a path. Checkpoints verify file and ancestor identities, write and sync a private0600temporary file, then atomically replace the destination. The same context checkpoints in `finally`, including after post-refresh UI assertions fail; the check still exits nonzero. Changed paths are refused and parsing/browser/file failures produce fixed errors without tokens, paths or raw page content. A leftover lease after process termination requires the owner to inspect the stopped process and private state before recovering; the tool never guesses that a lease is stale.

W4 uses only synthetic credentials in isolated temporary directories: `npm run test:private-state -w web` checks rejected repository/public/symlink paths, owner exclusivity, private temporary/final permissions, atomic replacement, changed identity/traversal refusal, checkpoint after simulated rotation plus assertion failure, and redacted CLI errors. The file is named `private-browser-state.check.mjs` so Vitest does not collect Node test API checks. Root `npm test` runs the existing Vitest suite and then these Node checks explicitly; test paths are resolved from the script's location so both root and workspace npm entry points work. It does not load the reviewer's browser state or `oauth-spa` grant. No additional real OAuth success is inferred from these safety regressions.

The initial W4 Node test filename was also collected by Vitest, causing root `npm test` to fail with “No test suite found” despite its323existing checks passing. After the runner correction, at2026-11-09 20:11+08:00 complete root `npm test` passed323Vitest tests plus8Node checks. Typecheck, format check, production build, standalone root `node --test web/scripts/private-browser-state.check.mjs` and diff whitespace checks passed. This correction changes only runner wiring, test path resolution and documentation; it does not exercise real credentials or change the encrypted transport.

Independent full-suite re-verification then found W5: the temporary-file permission assertion could miss a short-lived file because it relied on `fs.watch` followed by asynchronous path lookup. Its replacement instruments the actual `fs.promises.open` call in an isolated child process, calls `fstat` on the real temporary file handle before returning it to the helper, and asserts creation permissions0600, empty contents and exclusive-create flags. The test retains final contents, inode replacement, final0600permissions, owner exclusion and cleanup assertions. It uses no sleeps, larger payload or retry-until-pass logic. The application and credential helper are unchanged.

At20:16+08:00 the corrected candidate passed complete root `npm test` (323Vitest plus8Node), typecheck, format check, production build, standalone root Node8checks and diff whitespace checks. These are author results; independent exact-source re-verification remains required before merging.

## Current client entry — authorized follow-up

The 2026-11-09 follow-up uses the existing Development Logto tenant for this phase; a paid production Cloud tenant is no longer a prerequisite. Existing workspace UI must expose a persistent account entry on desktop and mobile. Signed-out users can reach registration and sign-in; account users can return to their devices. Password entry remains on Logto. The entry follows the existing narrow navigation and black/white tokens.

```text
┌─ 当前工作区 ────────────────────────────────┐
│ AnyWork                   [注册 / 登录]    │
│ 会话/Agent导航     当前会话                  │
│                  保留当前工作与高级连接     │
└────────────────────────────────────────────┘
                  ↓ 官方账号流程
┌─ 我的设备 ─────────────────────────────────┐
│ AnyWork                      [账号 / 退出] │
│ 我的设备          当前账号设备与连接状态    │
└────────────────────────────────────────────┘
```

Local/manual workspace navigation does not log out, replace credentials, or enable remote access. Account navigation must not auto-restore a manual connection into account mode. Complete public build configuration selects the Logto deployment; a changed issuer/client is a separate auth namespace and requires a fresh authorization. No Cloud-only admin endpoint belongs in the client runtime.
