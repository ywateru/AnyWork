AnyWork brings a local Codex workspace to browsers and Android, with a Rust desktop manager for hosting and connectivity.

AnyWork 将本机 Codex 工作区带到浏览器与 Android，使用 Rust 桌面管理器管理服务与连接。

**New in 0.1.2 / 本次更新**

Desktop updates download quietly, preserve verified complete downloads across restarts, defer reminders for 24 hours, and install only after confirmation. This maintenance release adds an idle-task check before stopping managed services, preserves a retryable state if a cached package is removed, and rejects stale version confirmations. Download packages and native updates use the same macOS launch path. Windows installers and Linux AppImages support automatic updates.

桌面更新在后台静默下载，完整下载跨重启保留，支持稍后 24 小时提醒，确认后才安装。本版增加安装前任务空闲检查，缓存丢失时可重新下载，并拒绝过期版本确认。统一 macOS 下载包与更新包的启动路径。Windows 安装版、Linux AppImage 支持自动更新。

Updates from 0.1.1 use the signed native updater. Version numbers and Android versionCode increase with every release; packages include the matching server, Web and corresponding source. See the update guide for supported installation types.

0.1.1 可通过签名原生更新器升级。每次发版递增各端版本及 Android versionCode，更新包含匹配的 Server、Web 与对应源码。支持的安装方式见更新说明。

**Upgrade from 0.1.0 / 从旧版升级：** Install this version manually once, retaining the user data directory. / 0.1.0 没有更新器，请先手动安装本版并保留数据目录。See [updates / 更新说明](https://github.com/ywateru/AnyWork/blob/main/docs/updates.md).

**Downloads / 下载**

- macOS 14+ Apple Silicon / Intel: ad-hoc signed app, not notarized / 临时签名，尚未公证。
- Windows x64: per-user installer or portable ZIP; requires WebView2, unsigned / 当前用户安装版或便携包；需 WebView2，未做发行商签名。
- Linux x64 / ARM64: AppImages or portable archives; compatible desktop libraries required / AppImage 或便携包，需兼容运行库。
- Android 8+: signed universal APK / 持久签名通用 APK。
- Web client and corresponding source / Web 资源与对应源码。

Checksums are provided in `SHA256SUMS`. Each desktop archive includes its corresponding source, licenses and a start guide.

所有文件提供 SHA-256 校验值。桌面包内含对应源码、许可证与启动说明。

[English installation guide](https://github.com/ywateru/AnyWork/blob/main/docs/getting-started.md) · [中文安装指南](https://github.com/ywateru/AnyWork/blob/main/docs/getting-started.zh-CN.md)

**Scope / 能力边界**

Codex is the included agent. Desktop hot attach depends on compatible Unix sharing interfaces; Windows uses CLI-backed chats. Full goal operations need a compatible shared engine; the desktop follower supports reading/pausing. Temporary tunnel addresses can change. Voice and closed-browser push are not included.

内置 Agent 为 Codex。桌面热接入依赖兼容的 Unix 共享入口；Windows 使用 CLI 会话。完整目标操作需兼容共享引擎，follower 支持读取/暂停。临时隧道可能换址。暂不含语音与关闭浏览器后的推送。

Independent open-source project, not affiliated with OpenAI. AGPL-3.0-only; see NOTICE for third-party acknowledgements.

独立开源项目，与 OpenAI 无隶属关系。AGPL-3.0-only，第三方来源见 NOTICE。

**Known Linux desktop dependency / Linux 桌面已知依赖**

Tauri's GTK 3 stack includes glib 0.18.5, covered by the moderate [GHSA-wrw7-89jp-8q8g](https://github.com/advisories/GHSA-wrw7-89jp-8q8g) iterator advisory. The standalone CLI server/Web deployment does not require that desktop stack. See [SECURITY.md](https://github.com/ywateru/AnyWork/blob/main/SECURITY.md) for scope and tracking.

Tauri GTK 3 栈中的 glib 0.18.5 存在上述中等级别迭代器通告；独立 CLI 服务/Web 部署不依赖该桌面栈，详见安全说明。
