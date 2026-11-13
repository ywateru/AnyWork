# 安装与使用 AnyWork

[English](getting-started.md) · [项目首页](../README.zh-CN.md)

本页描述当前源码的统一账号流程；已发布安装包以对应发行说明为准。账号远程宿主首先验收macOS，其他平台范围见[支持矩阵](support-matrix.md)。

## 选择下载

从 [GitHub Releases](https://github.com/ywateru/AnyWork/releases/latest) 下载，使用随发行版提供的 `SHA256SUMS` 核对。macOS 执行 `shasum -a 256 <文件>`，Linux 执行 `sha256sum <文件>`，Windows 执行 `Get-FileHash <文件> -Algorithm SHA256`。

- **macOS 14+：** Apple Silicon 选 `macos-arm64`，Intel 选 `macos-x86_64`。打开 `.dmg`，将 `AnyWork.app` 拖入 Applications（应用程序）。磁盘映像内附 `INSTALL-macOS.txt` 中英文说明；打开安装后的应用前，在终端执行 `sudo xattr -cr "/Applications/AnyWork.app"`。请从应用程序目录运行，便于后续自动更新。目前是临时签名，尚未经过 Apple 公证。核对来源和校验值后，如被 Gatekeeper 拦截，可前往“隐私与安全性 → 仍要打开”。
- **Windows 10/11 x64：** 推荐使用当前用户 `-setup.exe` 安装版以支持自动更新。便携版需解压并保持 `anywork-desktop.exe` 和 `resources` 在同一目录。如缺少则安装 [Microsoft Edge WebView2](https://developer.microsoft.com/microsoft-edge/webview2/)。程序尚无发行商证书。本版不支持 Windows Codex 桌面进程热接入，可使用 Codex CLI 会话。
- **Linux：** 推荐从可写位置运行 AppImage 以支持自动更新（`chmod +x anywork-linux-*.AppImage`）。便携包解压后运行 `./anywork-desktop`。x64 基于 Ubuntu 22.04（glibc 2.35+），ARM64 基于 Ubuntu 24.04（glibc 2.39+）。安装运行库：`sudo apt install libwebkit2gtk-4.1-0 libgtk-3-0 libayatana-appindicator3-1 libsecret-1-0`。其他发行版使用等价软件包。
- **Android 8+：** 安装适用发行版的APK，或直接用手机浏览器打开[我的设备](https://anywork.aixgg.com/app/)。新版Android账号入口优先使用系统浏览器Custom Tabs，不保存桌面地址/访问密钥。签名不兼容时不要自行卸载以免删除旧数据，应使用匹配签名的安装包。保持浏览器更新。

0.1.1 起支持桌面自动更新。Windows 推荐当前用户安装版，Linux 推荐 AppImage，并放在可写位置。较新 Ubuntu 可安装 `libfuse2t64`；无 FUSE 时可尝试 `--appimage-extract-and-run`。0.1.0 需先手动升级一次。[更新行为与支持的安装方式](updates.md)。

## 启动电脑端

先按下方[后端指南](#选择后端-agent)配置所用 Agent。使用 Codex 时，在同一系统用户下运行 `codex login status` 检查；如果桌面程序的 PATH 找不到它，启动前设置 `CODEX_BIN` 为其可执行文件绝对路径。模型账号与AnyWork设备账号用途不同，模型调用仍使用你原来的账号。

打开AnyWork，按需选择允许操作的工作目录，点击“打开工作区”。桌面准备本地服务后，在浏览器进入同一工作区；无需复制访问密钥。本地使用不要求先登录云账号，云服务暂不可用时仍可工作。

已有独立启动的服务会在身份验证后复用；需要在设置中选择匹配的数据目录，不要在同一端口另起第二个服务。旧服务不支持本机交接时，界面会提示升级，不会改成把长期令牌放进地址栏。

## 从网页或手机继续

1. 在工作电脑的AnyWork中注册或登录，明确开启“允许我的其他设备访问”。
2. 在其他电脑或手机打开[我的设备](https://anywork.aixgg.com/app/)，登录同一账号。Android App打开同一个正式HTTPS账号入口，无需配置VPN或导入配对链接。
3. 选择已就绪的电脑。首次连接或公钥变化时，与工作电脑核对设备身份，确认后打开工作区。
4. 返回“我的设备”可以切换电脑；退出远程账号会结束当前远程连接。关闭工作电脑的远程访问后，本地仍可继续使用。

工作电脑需要保持开机和联网。Native账号凭据与端点私钥仅存内存；退出客户端后需重新登录、开启远程访问并确认新公钥。正常短期授权更新在加密通道内完成，不应要求每隔几分钟手动连接。断线不会自动重发业务写入；结果未知时先核对历史。

新版不提供独立匿名/固定隧道、WireGuard及手动地址/令牌连接。旧配置保留用于明确回滚，但不会自动运行。更详细的本地交接、远程授权及迁移边界见[桌面和Android说明](desktop-manager.md)。

## 选择后端 Agent

以下描述当前源码接入范围，不代表每个已发布包都已包含。各拓扑的证据见[支持与验收矩阵](support-matrix.md)。Web 从宿主 `/plugins` 读取真实清单；“新建会话 → Agent”和“设置 → Agent”使用该清单、可用状态及设置提示。侧栏筛选可显示历史或不可用的 Agent，不会因此注册执行能力。

| 后端 | 设置与范围 |
| --- | --- |
| Codex | 在宿主同一系统用户下安装并登录 [Codex CLI](https://github.com/openai/codex)。GUI 找不到时设置 `CODEX_BIN`；已有桌面控制需要兼容的[共享入口](desktop-shared-start.md)。 |
| Claude Code（`claude-code`） | 安装 [Claude Code CLI](https://code.claude.com/docs/en/setup)，在宿主同一系统用户下完成原生登录，确认服务环境可运行 `claude --version`。宿主清单报告可用后选择 **Claude Code**，设置完成后点击“重新检查连接”。已有会话按原生 ID 读取历史和显式恢复。 |
| Claude Desktop Code（`claude-desktop`） | 在 Claude Desktop 的**本地 Code** 中准备工作目录。普通聊天、Cowork 和云会话分别处理。在侧栏选择 **Claude Desktop Code** 查看已发现的本地历史；写入需要**组织政策允许的有效原生桥**，当前可用桌面控制路径尚未确证；无入口时仍可读取受支持的持久历史。控制入口以宿主设置提示为准。历史可见、桌面深链或独立 CLI 恢复均不证明连接了原桌面执行进程；实时桌面控制仍待验收。 |
| DeepSeek Harness | 使用官方 0.2.2-rc.1 gateway 或发现插件，见[设置指南](harness-setup.md)。没有共享入口的独立 TUI 无法受控。 |
| WorkBuddy | 可读取受支持的持久历史；[共享执行设置](workbuddy-launcher.md)仍为实验功能，真实写入、审批及取消验收仍有限。 |

Claude Code 的接入范围包括文本/图片、流式正文/思考/工具、审批与开放问答、取消和模型选择。CLI 2.1.323 的原生初始化，以及候选 `e70c8a5` 的隔离服务 API 发送/文本流、工具一次批准、开放问答、自管取消、模型切换和原 UUID 重启恢复已[独立验收通过](plan/reviews/claude-backend-independent.md)。此结论针对当前源码，不表示对应能力已发布，也不扩大到 Windows 运行、真实图片理解、后台子任务、所有模型或 Desktop 控制。界面以实际后端及会话能力为准；不能仅凭 Claude 名称推断支持 Codex 式目标、消息编辑、服务等级或分叉。`manual-approvals-only` 表示 AnyWork 不自动代答审批请求，只能提交原请求提供的决定。AnyWork 新建的 CLI 运行时以 `--permission-mode manual` 启动；已有 Desktop 会话的原生 `permissionMode`（包括 `auto`）仍由原宿主管理，历史导入与桥接不重置该设置。AnyWork 会话策略与原生权限模式分别管理，不将 Codex 的沙箱边界推广到 Claude。

### 安装 Claude CLI 与 Desktop

按操作系统使用 [Claude Code 官方安装说明](https://code.claude.com/docs/en/setup)安装终端 CLI，运行 `claude` 完成原生登录。在 AnyWork 实际运行的同一系统用户与 PATH 下执行 `claude --version`。找不到可执行文件时，在服务环境中设置 `ANYWORK_CLAUDE_BIN`。`ANYWORK_CLAUDE_HISTORY_ROOT` 指定包含 `projects` / `sessions` 的 Claude 配置根目录，优先于 `CLAUDE_CONFIG_DIR`；两者均未设置时使用 `~/.claude`。Windows 应指向原生 `claude.exe`，不支持 `.cmd` / `.bat` 包装器。模型凭据无需复制到 AnyWork 设备账号设置。

桌面路径按[官方 Desktop 入门](https://code.claude.com/docs/en/desktop-quickstart)安装并登录 Claude Desktop，选择 **Code**，打开**本地**项目目录。Desktop 与终端 CLI 使用相同底层 engine，共享项目配置/记忆，但各自保留会话列表。Desktop 自行下载、更新它的内置 Claude Code，更新终端 CLI 不会同步更新 Desktop，反之亦然；需检查 Desktop 自身的更新菜单，并新建会话使用新版 engine。

实时写入需要组织政策允许的有效原生桥。Claude Desktop 5.11492.x 的可用控制路径尚未确证：普通 CDP 启动要求厂商签名的授权 profile，`scripts/claude-desktop-launch.py` 等本地脚本不能自行开启该入口。完成登录、读到持久历史或找到描述符都不代表取得控制权；无有效桥接时，保留受支持历史的只读模式，不以重启应用、绕过原生授权或启动第二个 writer 强行连接。识别到原生方法，与真实写入、审批、取消和重连验收分别记录。

正常 DevTools 的 outgoing loopback 桥是另一个**实验连接路径，尚未完成原生验收**，不依赖 CDP 启动参数。该方案由本机工具生成固定桥接脚本，用户审阅后，在原应用本地 Code renderer 的正常 DevTools 中显式连接；仍须满足原应用开发者模式、HIPAA 与组织政策限制。原生 self-XSS 等防护要求的手动操作必须由用户在原应用完成，AnyWork 不代为关闭或绕过。桥接源码与夹具验证单独记录；当前原生探测、连接步骤与完整写入链路仍待验收，不能将运行工具、生成脚本或载体测试通过视为可控制原桌面。连接不使用 AnyWork 通用访问令牌或模型账号凭据；重载或断线后须重新建立有效连接，结果未知的请求不自动重放。

实现和独立源码审查已完成；按用户安排，Desktop 原生桥连接和写入真机测试留待提交后手动执行。[Desktop 连接与手测指南](claude-desktop-setup.md)提供已核对的启动命令、私有描述符设置、断开方式和后续验收清单。桌面控制继续标为实验能力，未宣称真机通过。

当前已接受的源码在未设置覆盖变量时，被动扫描 Claude 与 Claude-3p 两个已知 profile 的 `claude-code-sessions` 根目录；默认发现及真实 Claude-3p 会话的只读历史已[独立验收通过](plan/reviews/claude-desktop-mapper-independent.md)，不表示已发布或原生桥接已验收。两个 profile 使用相同平台父目录：

| 平台 | 默认扫描根目录 |
| --- | --- |
| macOS | `~/Library/Application Support/Claude/claude-code-sessions` 与 `~/Library/Application Support/Claude-3p/claude-code-sessions` |
| Windows | `%APPDATA%/Claude/claude-code-sessions` 与 `%APPDATA%/Claude-3p/claude-code-sessions`；无 `APPDATA` 时以用户 home 为父目录 |
| Linux | `$XDG_CONFIG_HOME/Claude/claude-code-sessions` 与 `$XDG_CONFIG_HOME/Claude-3p/claude-code-sessions`；未设置时使用 `~/.config` 为父目录 |

显式设置 `ANYWORK_CLAUDE_DESKTOP_HISTORY_ROOT` 时，**仅扫描指定的一个根目录，替代上述默认双根扫描**。变量应在 AnyWork 服务环境中设为实际 `claude-code-sessions` 目录的绝对路径，而非其中的账号/组织子目录或桥接描述符文件。发现记录保留元数据来源；同一原生会话 ID 匹配多处元数据时明确报歧义，不静默选择一个 profile。第三方 profile 的记录格式仍需单独核对，不从截图或目录名称推断兼容。此配置仅用于受支持格式的历史发现，不建立实时桥接。

本地桥接描述符默认位于 `~/.anywork/claude-desktop/host.json`，可在 AnyWork 服务环境中设置 `ANYWORK_CLAUDE_DESKTOP_DESCRIPTOR` 改用其他描述符。它是本机发现记录，不是模型凭据，也不单独证明桌面可控。

Desktop 初版模型列表仅包含已观测本地桌面会话使用的模型，并报告 `catalogComplete: false`，不代表完整模型目录。未列出某个模型不能推断 Claude 本身不支持它；模型操作仍以当前后端/会话响应为准。

[官方 Desktop 说明](https://code.claude.com/docs/en/desktop#coming-from-the-cli)提供明确交接：终端会话中 `/desktop` 保存会话、在 Desktop 打开并退出 CLI；shell 的 `claude --desktop` 直接打开 Desktop，`claude --desktop --resume <session-id>` 按 ID 交接已有 CLI 会话。shell 参数要求 Claude Code **2.1.285+**；交接限 macOS 或 x64 Windows，且需 Claude 订阅登录，不适用于 API key 或第三方 provider 认证。其他终端仍打开或后台运行的会话不会被迁移。此原生交接不是 AnyWork 桌面控制 API，也不证明可实时控制任意已运行的桌面会话。

历史发现为被动读取，不启动推理、不取得 writer，也不从最后一条历史事件判断当前仍在运行。跨项目发现使用 `--agent-scope all`，旧 `--codex-scope all` 仅影响 Codex。已有原生会话锁或忙碌状态时不要强行启动第二个 writer；结果未知时先核对历史，重启 AnyWork 不意味着可以重放请求。取消仅影响适配器拥有的执行，不结束 Claude Desktop 应用。附件使用当前会话的上传/文件选择入口，任意本地路径不自动获得附件访问权限。

## 命令行服务

源码构建后：

```bash
./target/release/anywork \
  --workspace /absolute/path/to/projects \
  --agent-scope all
```

便携包先进入 `resources`（macOS 为 `AnyWork.app/Contents/Resources`）：

```bash
./bin/anywork --web-dir web --workspace /absolute/path/to/projects
# Windows PowerShell：
# .\bin\anywork.exe --web-dir web --workspace C:\Projects
```

默认令牌文件是相对运行目录的 `.anywork/access-token`。桌面管理器将配置保存在系统应用支持目录。不要在同一个端口再启动第二个服务。

| 参数 / 环境变量 | 默认 | 说明 |
| --- | --- | --- |
| `--bind` / `ANYWORK_BIND` | `127.0.0.1:3210` | 监听接口与端口 |
| `--workspace` / `ANYWORK_WORKSPACE` | 当前目录 | 允许访问的工作根目录 |
| `--agent-scope` / `ANYWORK_AGENT_SCOPE` | `workspace` | 设置 `all` 跨项目发现受支持 Agent |
| `--codex-scope` / `ANYWORK_CODEX_SCOPE` | `workspace` | 兼容旧 Codex 专属发现范围 |
| `--data-dir` / `ANYWORK_DATA` | `.anywork` | 令牌、数据库、附件 |
| `--web-dir` / `ANYWORK_WEB` | `web/dist` | Web 静态文件 |
| `ANYWORK_TOKEN` | 自动生成 | 自定义密钥，至少 16 字符 |
| `CODEX_BIN` | `codex` | Codex 可执行文件路径 |
| `--origins` / `ANYWORK_ORIGINS` | 本地开发与 Android 来源 | 自定义跨域白名单 |

CLI bearer供内部桌面/API认证使用，Web不再提供粘贴密钥表单。Android账号入口使用正式HTTPS前端，不需要旧appassets来源访问本地业务API。兼容旧 `REMOTE_AGENT_*` 环境变量，新 `ANYWORK_*` 优先。未指定新数据目录、仅存在 `.remote-agent` 时继续复用旧目录。

## 功能与限制

- Codex、Claude Code CLI、本地 Claude Desktop Code、Harness 和 WorkBuddy 的拓扑与验收边界见[支持与验收矩阵](support-matrix.md)。插件接口不代表已内置 Cursor 等其他适配器。
- 桌面协作依赖版本相关的 Unix 本地接口。发现历史不代表已有执行进程一定具备可控入口，以界面报告的能力为准。不要强行对执行中的会话建立第二个 writer。
- 桌面 follower 路径支持读取和暂停目标。创建、恢复、编辑、删除需要兼容共享引擎，见[共享启动说明](desktop-shared-start.md)与[宿主适配器说明](desktop-adapter.md)。
- 排队消息属于 AnyWork，尚未承诺原生桌面队列迁移。语音听写/朗读，以及关闭浏览器后的 FCM/服务器推送未包含在本版。
- 服务拥有系统用户的终端和文件权限，工作区边界检查不等同于多租户沙箱。远程账号应由本人使用；端到端加密不消除设备、首次目录及托管前端的信任边界。
- Logto保存账号及最少设备配置，CyberGrid/Upstash保存必要协调元数据；业务正文、文件和终端内容留在设备。第三方中继仅传输业务密文；模型服务仍按原账号约定处理请求。

## 常见问题

**没有模型或首条消息发送失败：** 检查宿主用户能否运行 Codex、是否登录，以及 `CODEX_BIN` 是否正确。GUI 的 PATH 可能与终端不同。

**历史可见但无法控制：** 检查共享能力与状态、版本兼容性和本地入口配置。不要反复重发同一条消息；结果未知时先核对历史。

**远程访问无法开启：** 查看电脑端固定的失败阶段提示，确认本地服务已就绪、账号有效和网络正常。暂时服务故障可重试，配置绑定错误需维护者修正，不能跳过验证。

**手机看不到电脑：** 确认同一账号、电脑端仍在运行且远程已开启；协调故障可能显示状态暂时未知。Android优先通过系统浏览器打开账号页，不忽略TLS错误，不导入旧WireGuard配置。

**本地浏览器会话已结束：** 回到桌面点击“打开工作区”重新建立本机会话；无需输入服务令牌。服务重启后旧本机会话失效。

**没有通知：** 授予浏览器与系统通知权限，使用 HTTPS，保持页面可用。本版浏览器关闭后不会接收服务器推送。
