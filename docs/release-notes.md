AnyWork brings local Codex and DeepSeek Harness workspaces to browsers and Android, with a Rust desktop manager for hosting and connectivity.

AnyWork 将本机 Codex 和 DeepSeek Harness 工作区带到浏览器与 Android，使用 Rust 桌面管理器管理服务与连接。

**New in 0.1.25 / 本次更新**

The desktop console and Web account entry share a quieter, neutral interface and the existing hexagonal AnyWork logo. Desktop navigation separates the local workspace, remote access, settings and updates. The local panel keeps its open action, saved loopback address, copy action, first-visit explanation and working directory together.

桌面控制台与 Web 账号入口采用统一的中性视觉和现有六角 AnyWork 标志。桌面导航区分本地工作区、远程访问、设置和更新；打开操作、已保存的本机地址、复制、首次访问说明与工作目录集中在本地工作区面板中。

Web sign-in uses a focused single-column layout. Devices appear as compact rows with contextual connection progress and cancellation. After connecting, the device switcher is a single borderless navigation row aligned with the workspace sidebar. Conversation messages, composer, approvals and tool panels retain their existing interactions.

Web 登录改为聚焦的单列布局，设备列表使用紧凑行，连接进度和取消操作在对应设备处显示。连接后，设备切换入口为与工作区侧栏对齐的无框单行。对话消息、输入框、审批与工具面板保留原有交互。

The hosted account page also uses the AnyWork logo and neutral primary color. Its existing username/password, registration and authorization settings remain in place.

托管账号页同步采用 AnyWork 标志与中性主色，保留现有用户名/密码、注册及授权设置。

Local browser handoff, OAuth ownership, first-use or changed-key identity confirmation, connection cancellation, and service/update ownership checks retain their security boundaries. A visual refresh does not change account permissions or automatically replay workspace writes.

本机浏览器交接、OAuth 授权所有权、首次及换钥身份核对、连接取消、服务与更新所有权检查继续遵循原有安全边界。界面改版不改变账号权限，也不会自动重放工作区写入。

**Previous release 0.1.25 / 上一版本**

After signing in and preparing the local service, the desktop client now attempts to enable remote access automatically. You can turn it off at any time; it stays off for the current login session, including when the interface refreshes or you return from Settings. A remote error leaves the local workspace available and offers an explicit retry. Each new sign-in starts with the default-on policy again.

登录并准备好本地服务后，桌面客户端默认尝试开启远程访问。你可以随时关闭；在本次登录期间，即使界面刷新或从设置返回，也会保持关闭。远程失败不会阻塞本地工作区，可以手动重试。重新登录后恢复默认开启策略。

The console keeps the local address and remote controls in view. Active connections, identity checks and connection instructions expand when needed; privacy and credential-lifetime details are available in Settings. Errors show a short explanation, with diagnostic codes in expandable details. Unknown connection status remains distinct from zero active connections.

控制台保留本地地址和远程开关，活动连接、身份核对与连接指引按需展开；隐私和凭据有效期说明移至设置。错误只显示简短提示，诊断代码放在可展开详情中。连接状态不可用与真实没有活动连接仍分别显示。

Local browser access continues to use a one-time handoff and HttpOnly session cookie. Signing out closes remote authorization without stopping an already running local service. Credentials and device private keys stay in memory, with no Keychain storage; restarting requires sign-in again. Cloud services handle identity and necessary connection metadata. Workspace content remains on user devices and is transferred through the encrypted connection.

本地浏览器继续通过一次性交接和 HttpOnly Cookie 获得访问权限。退出账号会关闭远程授权，不会停止已经运行的本地服务。账号凭据和设备私钥只保留在内存，不写入钥匙串；重启后需要重新登录。云端处理账号与必要连接元数据，工作内容留在用户设备，经加密连接传输。

The reported coordinator-configuration failure was reproduced as an HTTP503 from CyberGrid, caused by the Upstash free monthly command quota being exhausted. Updating the client does not reset that quota; coordinator availability requires a separate infrastructure resolution.

本次协调配置读取错误已重现为 CyberGrid 返回 HTTP503，原因是 Upstash 免费月度命令额度耗尽。更新客户端不会重置该额度，协调服务恢复需要单独处理基础设施限制。

Desktop account support is qualified on macOS. Other platforms retain their stated account-support limits. Release checks do not establish physical phone, cellular-network or installed-upgrade acceptance. macOS apps remain ad-hoc signed and are not notarized.

桌面账号当前已验证 macOS，其他平台仍遵循已有账号支持限制。发布检查不代表物理手机、蜂窝网络或实装升级验收。macOS 应用仍为临时签名，尚未公证。

Releases database ownership explicitly after closing the store, so a concurrently spawned child cannot retain an inherited lock and briefly block reopening. Active services still hold exclusive ownership; this change does not retry or bypass a contested lock.

数据库关闭后显式释放所有权锁，避免并发启动的子进程短暂保留继承的锁，阻碍立即重新打开。运行中的服务仍保持独占所有权，不重试或绕过发生冲突的锁。

Pending approval cards keep floating notifications out of their interaction area using the actual current request state. Delayed completion events only resolve notices for the matching turn, so an older turn cannot mark a newer approval as handled.

当前有待处理审批时，浮动通知依据真实请求状态让出操作区域。迟到的完成事件只处理对应轮次的通知，避免旧轮次将新审批误标为已处理。

Fixes Windows terminal startup to use the Windows command interpreter. Release checks cover desktop interactions, encrypted renewal, native Windows, Android and container builds. Responsive phone-browser tests do not establish physical Android, cellular-network or installed-upgrade acceptance. macOS apps remain ad-hoc signed and are not notarized.

修复 Windows 终端启动时的命令解释器选择。发布检查涵盖桌面交互、加密续期、Windows 原生、Android 和容器构建；手机浏览器尺寸测试不代表物理 Android、蜂窝网络或实装升级验收。macOS 应用仍为临时签名，尚未公证。

**Previous release 0.1.13 / 上一版本**

Global event streams and polling now enforce the same workspace and Agent scope as the conversation list. Bounded scan cursors advance through hidden records so reconnecting and polling can reach subsequent visible updates without exposing out-of-scope message bodies.

全局事件流与轮询现在遵循与会话列表一致的工作目录及 Agent 范围。扫描游标可以越过不可见记录，继续接收后续可见更新，避免泄露范围外的消息正文。

The file editor now uses content revisions for conditional saves. Conflicts and uncertain results retain the draft, with explicit comparison and baseline selection before another save. Concurrent saves through one AnyWork service are serialized across path aliases. Native editors and Agents do not share this lock; arbitrary external writes are not an atomic compare-and-swap guarantee.

文件编辑器新增基于内容版本的条件保存。冲突或保存结果不确定时保留草稿，支持比较最新文件并明确选择新的保存基线。同一 AnyWork 服务内的并发保存统一协调路径别名；原生编辑器与 Agent 不共享此锁，不能保证对任意外部写入实现原子比较替换。

Database opening now validates known schemas, takes exclusive service ownership and commits migration/startup recovery transactionally. This release introduces **schema version 2** and internal durable-operation storage. Restart recovery preserves uncertain work without automatically replaying Agent commands. Full backup/restore tooling remains future work.

数据库打开新增已知结构验证、服务独占保护，以及迁移和启动恢复的事务处理。本版引入 **数据库结构版本 2** 和内部持久操作记录模块；重启恢复保留不确定状态，不自动重放 Agent 命令。完整备份与恢复工具仍待后续实现。

**Upgrade caution:** stop the old service before upgrading. If a rollback may be needed, privately preserve the complete stopped data directory, including attachments and any remaining SQLite sidecars, before the first new-version startup. Published 0.1.12 and earlier must **not** open a directory already migrated to v2; replacing the application does not downgrade data. Use an untouched pre-upgrade copy for a rollback. See [schema and recovery](https://github.com/ywateru/AnyWork/blob/main/docs/schema-and-recovery.md).

**升级注意：**先停止旧服务。若需保留回退可能，应在首次启动新版之前，私下保存停止状态下的完整数据目录，包括附件和仍存在的 SQLite 附属文件。**不要使用已发布的 0.1.12 或更早版本打开已经升级至 v2 的目录**；更换程序不能回退数据结构。回退时应使用未被新版打开过的升级前副本，详见数据库与恢复说明。

Adds a read-only capability projection and dormant qualified SDK transport/operation-ledger foundations. These modules do not activate a new sending path, universal hot takeover or end-to-end exactly-once delivery. Agent-specific execution limits, including experimental WorkBuddy sharing, remain in the [support matrix](https://github.com/ywateru/AnyWork/blob/main/docs/support-matrix.md).

新增只读能力投影，以及尚未接入现有执行路径的限定 SDK 传输与持久操作基础模块。这些模块不代表已启用新的消息发送链路、任意进程热接管或端到端仅执行一次保证。各 Agent 的执行边界（包括实验性的 WorkBuddy 共享）继续以支持矩阵为准。

Publication is now a resumable single command: `python3 scripts/publish.py`. Exact-source Checks gate immutable releases; the workflow builds all installers, refreshes the bilingual website and verifies asset digests and update metadata. Checks include actual container acceptance and SDK package tests on Windows using isolated fake processes, not native-Agent acceptance. Publication verification does not replace installed-upgrade testing. Long-list mobile touch coverage retains real gestures and strict scroll boundaries with a more efficient input driver.

发布统一为可续跑的一条命令：`python3 scripts/publish.py`。精确源码检查通过后才创建不可变发行，自动构建各平台安装包、刷新双语网站并核验文件摘要与更新元数据。检查包含实际容器验收，以及使用隔离假进程在 Windows 上运行的 SDK 包测试，不代表真实 Agent 验收；发行核验也不替代实装升级测试。长列表移动端回归保留真实触摸及严格滚动边界，改进输入驱动效率。

**History and WorkBuddy fixes in 0.1.12 / 历史会话与 WorkBuddy 修复**

Discover existing local DeepSeek Harness and WorkBuddy histories alongside Codex, including conversations from other projects when `--agent-scope all` is enabled. Desktop-managed service launches enable that scope. Saved text and tool results remain readable without an execution host; native child sessions keep their parent relationship. Existing Agent icons, filters, search, directory ordering, archive state and filtering apply to these histories too.

新增本机 DeepSeek Harness 与 WorkBuddy 历史会话发现，与 Codex 一同显示。启用 `--agent-scope all` 后可查看跨项目历史，桌面管理器启动服务时默认启用该范围。执行入口未连接时仍可查看已保存的文本和工具结果；原生子会话保留父子关系，并沿用 Agent 图标、筛选、搜索、目录排序、归档状态与筛选。

Fixes WorkBuddy's injected runtime context appearing as user messages, including already cached records. Latest native snapshots now include in-memory requests and replies, restoring incremental updates after Web or desktop input. Legacy-cache repair preserves message identities, attachments and pending interactions; reconnect does not resend prompts.

修复 WorkBuddy 将注入的运行上下文显示为用户消息的问题，并更正已缓存的错误记录。最新原生快照现在包含内存中的请求与回复，恢复网页和桌面输入后的增量同步。缓存修复保留消息身份、附件及待处理交互，重连不会重新发送提示。

Codex, DeepSeek Harness and WorkBuddy integrations are enabled by default; an absent host stays visible with setup guidance. Adds WorkBuddy's official locally bundled icon and an explicit private desktop launcher. Sidebar wheel/touch scrolling now stays within its bounds instead of exposing a blank area below the application.

默认启用 Codex、DeepSeek Harness 和 WorkBuddy 集成；未连接的主机保留设置引导。新增本地打包的 WorkBuddy 官方图标和显式私有桌面引导程序。修复侧边栏鼠标／触摸滚动越界导致页面底部白屏的问题。

WorkBuddy shared execution remains experimental and version-bound to Desktop 5.9.3. Passive installed-history and read-only native snapshot checks passed; send/stream/approval/reconnect checks use an isolated deterministic carrier with the real AnyWork service and Web UI. Complete installed-native creation/message/collaboration acceptance remains open. Shared execution requires a normally initialized WorkBuddy account and the original desktop launched with its private control entry; no second engine is started. See [WorkBuddy setup](https://github.com/ywateru/AnyWork/blob/main/docs/workbuddy-launcher.md) and [history/synchronization evidence](https://github.com/ywateru/AnyWork/blob/main/docs/workbuddy-transcript-updates.md).

WorkBuddy 共享执行仍为实验功能，当前适配 Desktop 5.9.3。真实安装环境的历史读取和只读原生快照检查已通过；发送、流式输出、审批和重连使用隔离载体配合真实 AnyWork 服务与 Web 界面验证。真实原生创建、消息和协作的完整验收仍待完成。共享执行需要正常初始化的 WorkBuddy 账户，并通过私有控制入口启动原桌面应用，不会启动第二个执行引擎。详见接入说明与同步调查记录。

Windows persisted Harness history now validates complete drive and UNC roots before reading metadata, including verbatim paths, while retaining junction/reparse-point rejection and read-only boundaries. Native Windows tests now run on main before releases. Version 0.1.11 was not published because its Windows gate failed.

修复 Windows 下 Harness 历史读取对盘符、UNC 及 verbatim 路径的检查，保留 junction／reparse point 拒绝策略和只读边界。主分支新增 Windows 原生测试，提前验证发行兼容性。0.1.11 因 Windows 验证未通过而未发布。

**Focus restoration fixed in 0.1.10 / 焦点修复**

Restores keyboard focus after model-speed settings finish saving and the control becomes available again. Delayed saves respect deliberate focus changes, menu dismissal and session switches.

修复模型速度设置保存后偶发丢失键盘焦点的问题，在控件恢复可用后归还焦点。迟到的保存响应尊重用户主动移焦、关闭菜单与切换会话的操作。

**Message consistency fixed in 0.1.9 / 消息一致性修复**

Fixes an intermittent duplicate-answer race when a compact history snapshot arrives before older live events. Replayed deltas and snapshots now converge to the canonical message while preserving legitimate repeated text and ongoing updates.

修复精简历史快照先于旧实时事件到达时，回答偶发重复拼接的问题。事件重放与快照合并后收敛到原始消息，保留合法的重复文本和实时更新。

**Agent sidebar introduced in 0.1.8 / Agent 侧边栏**

Filter the sidebar by All Agents, Codex, DeepSeek Harness or another available Agent. The choice is saved for each server and combines with search, projects, archives and grouping. Directories follow the newest matching conversation. Filtering preserves the current chat, draft, split views and live replies even when its row is hidden.

侧边栏新增 Agent 筛选，可选择所有 Agent、Codex、DeepSeek Harness 或其他可用 Agent。各服务器分别记住选择，并与搜索、项目、归档和分组组合使用；目录按匹配会话的最新时间排序。筛选隐藏当前会话时，对话、草稿、分屏和实时回复继续保留。

Conversation rows now use verified Codex product artwork and the official Harness whale mark, bundled locally in light and dark variants. Running and waiting indicators remain visible. Sources, checksums and trademark attribution are recorded in the [asset provenance](https://github.com/ywateru/AnyWork/blob/main/web/public/agents/README.md).

会话图标使用经过核对的 Codex 专用产品图标和 Harness 官方鲸鱼标识，本地打包深浅主题版本，保留执行动画及待响应提示。来源、校验值和商标归属见图标来源说明。

**Included since 0.1.7 / 已有 Harness 支持**

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

The website prefers DMG downloads and automatically chooses Chinese or English at its language-neutral entry point, while preserving manual language selections.

官网优先下载 DMG，并在语言中立入口根据浏览器自动选择中文或英文，保留用户手动选择的语言。

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

Codex is included; DeepSeek Harness uses the official 0.2.2-rc.1 loopback HTTP carrier. Harness goal/plan, fork and message editing are not supported, and independent TUI processes without a shared carrier cannot be controlled. Codex desktop hot attach depends on compatible Unix sharing interfaces; Windows uses CLI-backed chats. Full goal operations need a compatible shared engine; the desktop follower supports reading/pausing. Voice and closed-browser push are not included.

内置 Codex，并新增官方 0.2.2-rc.1 本机 HTTP 共享主机的 DeepSeek Harness 接入。Harness 暂不支持目标/计划、分叉和消息编辑，也不能控制没有共享入口的独立 TUI。Codex 桌面热接入依赖兼容的 Unix 共享入口；Windows 使用 CLI 会话。完整目标操作需兼容共享引擎，follower 支持读取/暂停。暂不含语音与关闭浏览器后的推送。

Independent open-source project, not affiliated with OpenAI. AGPL-3.0-only; see NOTICE for third-party acknowledgements.

独立开源项目，与 OpenAI 无隶属关系。AGPL-3.0-only，第三方来源见 NOTICE。

**Known Linux desktop dependency / Linux 桌面已知依赖**

Tauri's GTK 3 stack includes glib 0.18.5, covered by the moderate [GHSA-wrw7-89jp-8q8g](https://github.com/advisories/GHSA-wrw7-89jp-8q8g) iterator advisory. The standalone CLI server/Web deployment does not require that desktop stack. See [SECURITY.md](https://github.com/ywateru/AnyWork/blob/main/SECURITY.md) for scope and tracking.

Tauri GTK 3 栈中的 glib 0.18.5 存在上述中等级别迭代器通告；独立 CLI 服务/Web 部署不依赖该桌面栈，详见安全说明。
