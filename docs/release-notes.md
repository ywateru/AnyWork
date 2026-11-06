AnyWork brings a local Codex workspace to browsers and Android, with a Rust desktop manager for hosting and connectivity.

AnyWork 将本机 Codex 工作区带到浏览器与 Android，使用 Rust 桌面管理器管理服务与连接。

**New in 0.1.6 / 本次更新**

The Rust desktop manager has a new white, monochrome interface centered on a live connection diagram: Codex → AnyWork → three independent remote connections. Anonymous Cloudflare Tunnel, a fixed Cloudflare hostname and WireGuard + TLS relay can remain enabled together. The AnyWork node includes its service status, local address, port, settings and start/stop button. The Codex node is reduced to its icon and name, with settings available on click.

Rust 桌面管理器采用全新的白底黑白界面，以实时连接关系图呈现 Codex → AnyWork → 三路独立远程连接。Cloudflare 匿名隧道、固定域名与 WireGuard + TLS 中继可以同时启用。AnyWork 节点直接显示服务状态、本机地址、端口、设置和启停按钮；Codex 节点精简为图标与名称，点击可进入设置。

Connection cards display known URLs, truncating long addresses while keeping the full address in their tooltip and details. Click a node for connection details, copy/open actions, Android pairing or configuration. Popovers close on outside click, Escape or a second click, and scroll within available space to keep their trigger usable. The management label, downward arrow, standalone LAN card and redundant overview footer have been removed; LAN addresses remain in local service details. Compatible authenticated CLI services can be stopped explicitly from the manager; busy managed sessions prevent shutdown, and automatic cleanup leaves independent services running.

连接卡片显示已知网址，长地址自动截断，悬停提示和详情中保留完整地址。点击节点即可查看详情、复制或打开地址、进行 Android 配对或配置连接。浮层支持点击外部、Escape 或再次点击触发器关闭，根据可用空间限制高度并内部滚动，保证窄屏开关可操作。移除管理归属文字、下方箭头、独立局域网卡片及重复的总览底部区域，局域网地址保留在本地服务详情。兼容的命令行服务认证后可显式停止，仍有自有任务执行时拒绝停止；自动清理保留独立服务。

Settings now show save results and errors. Desktop layouts were checked at 1440×1000, 960×720, 800×620 and a narrow 390px viewport; 46 isolated manager interaction cases and the updater UI regression passed locally. New Web users start with a white theme; existing explicit light/dark/system choices and custom appearances are preserved.

设置页补齐保存结果和错误反馈。桌面布局检查覆盖 1440×1000、960×720、800×620 和 390px 窄屏；本地通过 46 项隔离管理界面交互测试及更新界面回归。Web 新用户默认白色主题，已有用户明确保存的浅色、深色、跟随系统与自定义外观继续保留。

**Installers and updates / 安装与更新**

macOS downloads are now DMG installers for Apple Silicon and Intel. Open the image, drag AnyWork into Applications, and follow the included bilingual `INSTALL-macOS.txt`. It includes `sudo xattr -cr "/Applications/AnyWork.app"` for the current ad-hoc signed app. Release builds mount each DMG read-only and verify its application signature, processor architecture, resources and exact agreement with the signed automatic-update app.

macOS 现提供 Apple Silicon 和 Intel 的 DMG 安装盘。打开后将 AnyWork 拖入应用程序，并参考盘内中英文 `INSTALL-macOS.txt`，其中包含当前临时签名应用的运行命令 `sudo xattr -cr "/Applications/AnyWork.app"`。构建时只读挂载每个 DMG，验证应用签名、处理器架构、资源，并逐文件确认与签名自动更新包内的应用一致。

Quick Tunnel retains automatic recovery, preferring to keep its existing process and temporary address. The website prefers DMG downloads and automatically chooses Chinese or English at its language-neutral entry point, while preserving manual language selections.

匿名隧道保留自动恢复能力，优先维持现有进程和临时地址。官网优先下载 DMG，并在语言中立入口根据浏览器自动选择中文或英文，保留用户手动选择的语言。

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
