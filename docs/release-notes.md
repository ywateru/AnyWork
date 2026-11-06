AnyWork brings a local Codex workspace to browsers and Android, with a Rust desktop manager for hosting and connectivity.

AnyWork 将本机 Codex 工作区带到浏览器与 Android，使用 Rust 桌面管理器管理服务与连接。

**New in 0.1.4 / 本次更新**

AnyWork has a new product logo: a dark rounded hexagon with two white ring eyes, redrawn as a transparent SVG. The Web client, desktop manager, macOS/Windows/Linux application icons, Android launcher and bilingual website now share the same mark. Platform assets are generated from one canonical SVG to keep future changes consistent.

AnyWork 更换为新的产品标志：深色圆角六边形与双圆环眼睛，使用透明背景 SVG 重新绘制。Web 界面、桌面管理器、macOS/Windows/Linux 应用图标、Android 启动图标与双语官网同步更新。各平台资源统一从一份主 SVG 生成，便于持续保持一致。

**Included from 0.1.3 / 延续上一版本**

macOS downloads are now DMG installers for Apple Silicon and Intel. Open the image, drag AnyWork into Applications, and follow the included bilingual `INSTALL-macOS.txt`. It includes `sudo xattr -cr "/Applications/AnyWork.app"` for the current ad-hoc signed app. Release builds mount each DMG read-only and verify its application signature, processor architecture, resources and exact agreement with the signed automatic-update app.

macOS 现提供 Apple Silicon 和 Intel 的 DMG 安装盘。打开后将 AnyWork 拖入应用程序，并参考盘内中英文 `INSTALL-macOS.txt`，其中包含当前临时签名应用的运行命令 `sudo xattr -cr "/Applications/AnyWork.app"`。构建时只读挂载每个 DMG，验证应用签名、处理器架构、资源，并逐文件确认与签名自动更新包内的应用一致。

Quick Tunnel checks now report specific timeout, TLS, DNS, HTTP and response errors. Proxy HTTP failures and invalid responses also trigger a direct authenticated retry. Temporary failures keep the same tunnel process and address. The website prefers DMG downloads while retaining compatibility with older ZIP-only releases. This release also includes the raw tool-output dialog improvements and browser interaction fixes from main.

匿名隧道验证区分超时、TLS、DNS、HTTP 和响应错误；代理返回临时 HTTP 错误或异常页面时也会进行带身份校验的直连重试。短暂故障保留原隧道进程和地址。官网优先下载 DMG，同时兼容仅有 ZIP 的旧版。本版也包含 main 中的工具原始输出弹窗及浏览器交互修复。

Desktop updates continue downloading quietly and install only after confirmation. Every release increments all app versions and Android versionCode; packages include the matching server, Web and corresponding source.

桌面自动更新仍在后台静默下载，确认后才安装。每次发版递增各端版本与 Android versionCode，安装包内含匹配的 Server、Web 和对应源码。

**Upgrade from 0.1.0 / 从旧版升级：** Install this version manually once, retaining the user data directory. / 0.1.0 没有更新器，请先手动安装本版并保留数据目录。See [updates / 更新说明](https://github.com/ywateru/AnyWork/blob/main/docs/updates.md).

**Downloads / 下载**

- macOS 14+ Apple Silicon / Intel: DMG installers; ad-hoc signed app, not notarized / DMG 安装盘；临时签名，尚未公证。
- Windows x64: per-user installer or portable ZIP; requires WebView2, unsigned / 当前用户安装版或便携包；需 WebView2，未做发行商签名。
- Linux x64 / ARM64: AppImages or portable archives; compatible desktop libraries required / AppImage 或便携包，需兼容运行库。
- Android 8+: signed universal APK / 持久签名通用 APK。
- Web client and corresponding source / Web 资源与对应源码。

Checksums are provided in `SHA256SUMS`. Desktop packages include the corresponding source and licenses; the DMG includes a bilingual installation guide.

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
