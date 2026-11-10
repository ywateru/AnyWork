# Desktop updates / 桌面自动更新

AnyWork 0.1.1 introduces signed desktop updates. **Version 0.1.0 has no updater:** install a new version once from [GitHub Releases](https://github.com/ywateru/AnyWork/releases/latest). Keep your user data directory to retain configuration, credentials and chats.

AnyWork 从 0.1.1 起提供签名自动更新。**0.1.0 没有更新器，需要先手动安装一次新版本。**保留原用户数据目录，即可继续使用配置、访问密钥和会话。

## Everyday behavior / 日常使用

- Checks run 30 seconds after startup and every six hours. Background downloads are enabled by default. Click the sidebar version to check manually or disable this preference.
- Verified downloads produce an inline notice and version indicator. No automatic dialogs, OS notifications or forced restarts. “Remind me later” defers that version for 24 hours; its download stays cached.
- Choose **Update and restart**, then confirm. Only confirmation installs. The confirmed version is bound to the request, preventing background discoveries from silently substituting another version.
- Before stopping an owned service, the manager checks for executing, starting or approval-waiting local chats. Busy or unavailable task state leaves the verified package ready for a later attempt. Update while your workspace is idle.
- After restart, the new desktop onboarding requires login before preparing manager-owned local services; a disk resume hint cannot start a service before login. Independently launched services stay running. A failed installation in the same process may restore only the local service already owned and admitted before installation. Native account credentials and keys are RAM-only: remote access requires a new login, explicit enable and changed-key confirmation. Retired standalone tunnel switches are not restored.
- Check/download failures remain in the update page and retry after 5 minutes, 15 minutes, 1 hour, then every 6 hours. Installation failures report the error and attempt to restore services.
- Verified complete downloads survive restarts and can be installed offline. Interrupted downloads restart from the beginning; HTTP Range resume is not implemented.

管理器启动 30 秒后检查正式发行版，此后每 6 小时检查一次，默认静默下载。点击侧栏底部版本号可查看进度、手动检查或关闭自动检查下载。下载并校验完成后只显示轻量提醒和版本提示点，不自动弹窗、不发送系统通知、不强制重启。

“稍后提醒”对当前版本延后 24 小时，下载包保留。点击“更新并重启”并确认后才安装。安装前检查本应用管理的会话是否空闲；执行中、启动中或等待确认的任务会阻止安装，无法确认状态时也保留更新包供稍后重试。请在工作空闲时更新。按当前新启动引导，重启后需先登录再准备本应用管理的本地服务，磁盘恢复提示不能在登录前启动服务；独立启动的服务保持运行。账号凭据和私钥仅存内存，远程访问需重新登录、明确开启并确认新公钥；旧独立隧道开关不恢复。网络错误静默退避重试；若安装失败且原进程仍在，只能恢复安装前已经由 manager 管理并获准运行的同一本地服务，不启动外部服务或远程。完整下载可跨重启保留和离线安装，未完成的下载下次重新下载。

## Supported packages / 支持的安装方式

| Platform / 平台 | Automatic updates / 自动更新 |
| --- | --- |
| macOS Apple Silicon / Intel | `AnyWork.app` copied from the DMG into a writable Applications directory / 从 DMG 拖入可写应用目录后运行 |
| Windows x64 | Per-user `anywork-windows-x86_64-setup.exe`; quiet NSIS updates / 当前用户安装版，确认后静默安装 |
| Linux x64 / ARM64 | `anywork-linux-*.AppImage`, launched from a writable location / 从可写位置运行 AppImage |
| Windows / Linux portable directories | Manual replacement through Releases / 从发行页面手动替换 |
| Development builds / 开发构建 | Automatic replacement disabled / 不自动替换 |
| Android APK / Web | APK uses Android's manual installation flow; Web updates with the host and PWA refresh / APK 由系统安装流程处理，Web 随主机升级及 PWA 刷新 |

macOS manual downloads use DMG installers from 0.1.3. Open the image, drag the app into Applications and follow `INSTALL-macOS.txt`. The DMG contains the exact app from the signed `.app.tar.gz` update; the update archive remains available for the built-in updater.

macOS 从 0.1.3 起使用 DMG 手动安装包，打开后拖入应用程序并参考盘内 `INSTALL-macOS.txt`。DMG 与签名 `.app.tar.gz` 更新包内的应用逐文件一致；更新压缩包继续用于应用内自动更新。

Native updates include the server, Web, licenses and corresponding source. User data and downloaded tools in the support directory remain outside the application bundle.

Server、Web、许可证与对应源码一起升级；用户数据和支持目录内的可选工具位于应用包外，不随更新覆盖。

## Integrity and publishing / 完整性与发布

The Rust updater uses Tauri's updater plugin. Clients accept HTTPS downloads from `ywateru/AnyWork` Releases, compare semantic versions, reject prereleases/downgrades, and verify Minisign/Ed25519 signatures binding packages to their announced versions. Caches are verified again before stopping services. The frontend cannot supply another endpoint or public key.

Rust 更新器使用 Tauri 官方插件，只接受指定仓库的 HTTPS 发行文件，拒绝预发布版和降级，验证绑定版本号的 Minisign/Ed25519 签名。缓存包会在停止服务前再次验签，前端无法指定其他下载地址或公钥。

The public key is in `crates/desktop/tauri.conf.json`. Keep and back up the matching private key outside Git and configure the Actions secret `TAURI_SIGNING_PRIVATE_KEY`. The release key has an empty password and relies on filesystem permissions and GitHub secret storage. Losing it prevents existing clients from trusting future updates. This is independent of Apple notarization, Windows publisher certificates and Android signing.

公钥进入源码；私钥保存在 Git 之外并私下备份，配置为 Actions 的 `TAURI_SIGNING_PRIVATE_KEY` secret。当前私钥不额外设置口令，由文件权限和 GitHub secret 存储保护。丢失将影响后续验签。更新签名与 Apple 公证、Windows 发行商证书和 Android 签名相互独立。

Use `python3 scripts/publish.py` (or `npm run release`) for normal publication: one version increment, exact-source Checks, release builds, website and resumable verification. All advanced/manual entry points must obey the same release gate; consult [publication and recovery](releasing.md) for their current status. The guard rejects duplicate or lower releases before building; missing platforms, missing macOS DMGs or mismatched version-bound signatures prevent publication of `latest.json`. Each macOS runner mounts its DMG read-only, checks the installation guide and Applications link, verifies app signature and architecture, then compares every app file with the native update archive.

常规发布执行 `python3 scripts/publish.py`（或 `npm run release`），自动递增一次版本、等待精确提交 Checks、构建、更新网站并完成可恢复核验。高级手动入口同样必须经过发布门禁，状态见[发布与恢复](releasing.md)。构建前拒绝重复或倒退版本；平台、macOS DMG 缺失或签名版本不符时，不发布 `latest.json`。每个 Mac 构建机只读挂载 DMG，检查安装说明、Applications 入口、应用签名和架构，并与原生更新包逐文件比较。

Current source status (2026-11-07): the Release workflow now enforces trusted exact-source Checks and remote tag-to-commit binding before builds and immediately before publication; the old prepare shortcut is retired. This I20 change passed independent source/offline review and is merged, but no new release was created to exercise the live publishing path. Use the normal publisher; see [current delivery evidence](plan/improvement-progress.md) for the remaining validation.

当前源码状态（2026-11-07）：Release 工作流已在构建前及正式发布前强制检查可信精确源码的 Checks 与远端标签绑定，旧 prepare 捷径已停用。I20 已通过独立源码/离线审查并合入；本轮未创建新发行来验证真实发布链。常规使用发布脚本，剩余验收见[交付进度](plan/improvement-progress.md)。
