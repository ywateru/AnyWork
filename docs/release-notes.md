AnyWork brings local Codex and DeepSeek Harness workspaces to browsers and Android, with a Rust desktop manager for hosting and connectivity.

AnyWork 将本机 Codex 和 DeepSeek Harness 工作区带到浏览器与 Android，使用 Rust 桌面管理器管理服务与连接。

**New in 0.1.7 / 本次更新**

DeepSeek Harness is now available alongside Codex. AnyWork connects to the existing official Harness Web/Desktop host, preserving its native workspace and session IDs. Existing history, live replies, tools, image attachments, model selection, queue/steer, cancellation and one-time approvals run through that same host. An optional discovery companion publishes the host's dynamic loopback address privately; it creates no listener or execution engine. See the [Harness setup guide](https://github.com/ywateru/AnyWork/blob/main/docs/harness-setup.md).

新增 DeepSeek Harness Agent，与 Codex 并存。AnyWork 连接原有官方 Harness Web/Desktop 主机，沿用原生工作区与会话 ID，支持已有历史、实时回复、工具、图片、模型选择、排队与引导、取消和单次审批。配套发现插件通过私有文件提供动态本机地址，不创建监听器或另一套执行引擎。接入方式见 [Harness 双语说明](https://github.com/ywateru/AnyWork/blob/main/docs/harness-setup.md)。

The conversation body is extracted and adapted from the official Harness UI: message bubbles, tool disclosures, execution state, elapsed time and reasoning. The existing AnyWork composer, image editor, approvals, subagent navigation and split views remain integrated. Source revisions, MIT attribution and adaptations are documented in the [UI provenance guide](https://github.com/ywateru/AnyWork/blob/main/docs/harness-ui-provenance.md).

对话主体从 Harness 官方源码提取并适配，包括消息气泡、工具展开详情、执行状态、耗时和思考内容。沿用现有 AnyWork 输入框、图片编辑、审批、子 Agent 导航与分屏能力，来源版本、MIT 授权及适配范围已记录。

Cancellation now reports interrupted accurately. Catalog refreshes preserve waiting approvals. Connection loss invalidates old approval controls; redelivered requests belong to the new connection and can be answered once. Mid-output reconnection restores the full message without duplicate text or replaying execution commands.

取消操作准确显示为已中断，目录刷新保留待审批状态。断线使旧审批失效，重连后重新投递的请求只允许有效回复一次；输出中途重连恢复完整正文，不重复文本或重放执行命令。

Acceptance used the real official Harness 0.2.2-rc.1 host and a deterministic local model, including shared native sessions, tools, images, queue/steer, approval isolation and transport failures. Merged checks passed 121 Rust tests, 298 Web unit tests, 111 desktop/mobile browser tests, 124 service/interface tests and 8 companion lifecycle tests. Four existing optional Rust tests were ignored; one desktop-only browser layout case was skipped on Android. Production Desktop plugin installation remains a manual step; the isolated official Web profile and its shared services were tested.

已使用真实官方 Harness 0.2.2-rc.1 与本地确定性模型验收原生共享会话、工具、图片、排队与引导、审批隔离及断线恢复。合并检查通过 121 项 Rust 测试、298 项 Web 单测、111 项桌面/移动浏览器测试、124 项接口测试及 8 项插件生命周期测试。4 项既有可选 Rust 测试未运行，1 项桌面专用布局用例在 Android 跳过。生产 Desktop 的插件安装仍需用户操作，隔离官方 Web profile 与其共享接口已通过验证。

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

Codex is included; DeepSeek Harness uses the official 0.2.2-rc.1 loopback HTTP carrier. Harness goal/plan, fork and message editing are not supported, and independent TUI processes without a shared carrier cannot be controlled. Codex desktop hot attach depends on compatible Unix sharing interfaces; Windows uses CLI-backed chats. Full goal operations need a compatible shared engine; the desktop follower supports reading/pausing. Temporary tunnel addresses can change. Voice and closed-browser push are not included.

内置 Codex，并新增官方 0.2.2-rc.1 本机 HTTP 共享主机的 DeepSeek Harness 接入。Harness 暂不支持目标/计划、分叉和消息编辑，也不能控制没有共享入口的独立 TUI。Codex 桌面热接入依赖兼容的 Unix 共享入口；Windows 使用 CLI 会话。完整目标操作需兼容共享引擎，follower 支持读取/暂停。临时隧道可能换址。暂不含语音与关闭浏览器后的推送。

Independent open-source project, not affiliated with OpenAI. AGPL-3.0-only; see NOTICE for third-party acknowledgements.

独立开源项目，与 OpenAI 无隶属关系。AGPL-3.0-only，第三方来源见 NOTICE。

**Known Linux desktop dependency / Linux 桌面已知依赖**

Tauri's GTK 3 stack includes glib 0.18.5, covered by the moderate [GHSA-wrw7-89jp-8q8g](https://github.com/advisories/GHSA-wrw7-89jp-8q8g) iterator advisory. The standalone CLI server/Web deployment does not require that desktop stack. See [SECURITY.md](https://github.com/ywateru/AnyWork/blob/main/SECURITY.md) for scope and tracking.

Tauri GTK 3 栈中的 glib 0.18.5 存在上述中等级别迭代器通告；独立 CLI 服务/Web 部署不依赖该桌面栈，详见安全说明。
