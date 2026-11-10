# 支持与验收矩阵 / Support and acceptance matrix

更新日期：2026-11-10。维护位置：本文是当前 Agent/拓扑、平台和验收边界的统一入口；原生协议细节与历史测试计数保留在链接的专门契约/验收记录中。公开版本以 [GitHub Release](https://github.com/ywateru/AnyWork/releases/latest) 为准，源码改进及对应验收见[交付进度](plan/improvement-progress.md)。不把源码已合并自动视为已发布或已实机验收。

## 状态的含义 / State definitions

`enabled` 只代表集成已开启；`configured` 代表配置可解释；`reachable` 代表入口可达且身份校验通过；`readable` / `writable` 分别代表当前会话可读/可操作。`tested` 必须注明版本、拓扑与实际验证层级。`experimental` 不因夹具通过而自动升级为正式支持。

界面当前已分别处理部分就绪/不可用状态，完整结构化能力协议仍属于 I07 后续工作。没有控制入口时，历史可读不意味着发送可用；发现应用目录也不等于已经登录/可协作。

## Agent 与连接拓扑 / Agents and topology

| Agent / topology | 当前能力 | 验收证据 | 限制与设置入口 |
| --- | --- | --- | --- |
| Codex：AnyWork 自管 app-server | 创建、原 thread 恢复、流式、工具/子 Agent、审批、模型设置及原生支持的目标/计划；受限最新用户消息编辑 | CLI 0.163/0.164 隔离真实引擎联调；部分更高内置版本仅 schema/空会话核对，不等同全能力联调 | 使用用户已有 Codex 登录和工作目录；行为取决于原生 thread 类型/能力。[验收边界](validation.md)、[消息编辑契约](api.md#用户消息编辑与恢复) |
| Codex：已有共享 Unix 引擎 | 在可验证的共享入口加入原 thread，不另建执行进程；共享状态/控制能力按引擎协议 | [真实隔离共享引擎](desktop-collaboration.md)与[HTTP 控制验收](desktop-host-tests.md) | Unix 路径；不能由“文件存在/历史 writer 持锁”推断已有控制权 |
| Codex：已运行桌面 follower | 原会话历史/状态、已实现的 start/steer/interrupt/审批适配；目标读取/暂停 | 同 thread、同 turn 的真实 steer 已验收；其余有协议夹具，真实审批/停止/空闲下一轮/完整附件等仍有缺口 | 限定原生接口/流协议 v11；Windows 没有相同热接入路径；完整目标恢复/编辑/清除不在此路径支持范围。[当前 adapter 范围](desktop-adapter.md) |
| Codex：无共享入口的独立进程 | 支持的历史可发现/读取 | 被动历史与持锁/只读行为有隔离验证 | 不承诺任意 stdio 进程热接管；连接失败不另开竞争引擎。[启动与共享方案](desktop-shared-start.md) |
| DeepSeek Harness：官方 0.2.2-rc.1 gateway | 原生会话发现/创建、历史、流式、队列/引导、取消、模型、一次审批/问答和附件；主机未连接时可读受支持的持久历史 | 实际 pinned upstream + 本地确定性模型；历史独立复核；不是仅测试自制 carrier | 需要原 gateway 或发现插件，目标/计划/分叉/用户消息编辑禁用；无共享入口的独立 TUI 不受控。[接入与复现](harness-setup.md) |
| WorkBuddy Desktop 5.9.3：被动历史 | 原生历史发现、可见正文/附件/工具投影；稳定来源 key 修复已导入缓存 | 真实已有三轮记录只读核对，另有损坏/分页/分支/重投影隔离回归 | 仅支持已知格式与 profile；上游未知 envelope 不猜测清洗。[历史](workbuddy-persisted-history.md)、[正文与更新修复](workbuddy-transcript-updates.md) |
| WorkBuddy Desktop 5.9.3：共享执行 | 实验桥接/可见实时快照，创建/输入/控制的限定 preload 调用与安全保护 | 原生 preload/列表/模型与被动快照核对；写入/审批/取消/重连主要为确定性夹具，真实写入验收仍开放 | **Experimental**；需正常初始化账号及受支持共享入口，不绕过登录、不替换原桌面订阅。不能把“后台收到过输入”推广为完整写能力已验收。[契约](workbuddy-integration.md)、[连接引导](workbuddy-launcher.md) |
| Claude Code / Cursor / 其他 Agent | 插件扩展边界 | 没有内置生产适配器的验收声明 | 不在当前已交付 Agent 列表，不提供假开关；见[插件协议](plugin-protocol.md) |

原生队列与 AnyWork 本地队列尚未实现所有拓扑的双向迁移。缺少原生幂等键/CAS 时，跨客户端编辑或取消存在原生原子性边界；不能承诺端到端 exactly-once。完整目标能力按拓扑判断，不能仅按 Agent 名称显示。

跨目录发现：默认 workspace；显式 `--agent-scope all` 对 Codex/dsh/WorkBuddy 开启跨项目历史，旧 `--codex-scope all` 只影响 Codex。桌面管理服务显式使用通用 all。新建自管会话和文件边界仍按配置及当前会话验证。

## 客户端、平台与证据 / Clients and platforms

| 平台 | 构建/交付基础 | 已知验收边界 |
| --- | --- | --- |
| Web / PWA | React/TypeScript；桌面 Chromium 和 Pixel 7 Chromium 仿真有集成回归；按会话缓存/分页、流式、草稿和分屏 | Pixel 模拟不是 Android App；完整 WebKit/Firefox、视觉 1:1、读屏和容量基线未闭环 |
| macOS arm64 / Intel | macOS 14+，Rust/Tauri，DMG 与更新包内容/架构检查，版本绑定更新签名 | 当前 ad-hoc 签名，未 Apple 公证；完整慢网络下载安装验收未闭环，不将资产核验视为实装升级 |
| Windows x64 | Windows 10/11 + WebView2，安装版/便携包，已有原生 release 构建与测试 | 无发行商签名；便携包不自动替换；不支持 Codex 桌面 Unix 热接入 |
| Linux x64 / arm64 | AppImage/便携包；GTK3/WebKitGTK4.1；基于 Ubuntu 22.04 / 24.04 的不同架构构建 | 实际发行版/桌面环境矩阵未穷尽；glib 告警和可达性风险见[安全说明](../SECURITY.md) |
| Android | Android 8.0+；当前源码改为固定HTTPS账号入口的Custom Tabs宿主，系统浏览器回退；不再使用旧WebView业务桥、WireGuard或手动连接配置 | 新构建/验收见统一体验任务；build/lint/unit与手机浏览器验证不替代实体设备；后台持续连接不作承诺。旧公开APK能力以对应发行记录为准 |
| Docker | 仅构建服务端；Linux x64 CI 已实测干净镜像、非 root、认证、源码绑定 Web/完整文件摘要与持久化 | [精确提交 `aacaa19` 实际容器验收](https://github.com/ywateru/AnyWork/actions/runs/42376388458/job/128414728192)通过，包含 I05a schema 与 I07a 纯读取模块；不等同其他架构、原生登录/模型或宿主桌面共享验收；本机 daemon 仍不可用 |

平台依赖与安装步骤见[中文指南](getting-started.zh-CN.md) / [English guide](getting-started.md)。Android applicationId 和既有内部名称保留兼容，不能为了品牌改名破坏覆盖升级和数据。

## 连接、权限和持续可用性 / Connection boundaries

- 本地工作不依赖AnyWork云账号，不表示模型推理离线。当前源码统一远程账号入口，独立匿名/固定/WireGuard连接退役；底层provider可传输业务密文，不向用户公开独立业务URL。
- 本服务面向个人可信设备，使用宿主系统用户的工作权限。本机Web使用受限cookie会话；远程在加密通道内校验同账号短期证明。在线设备表是presence，不是业务授权。首次目录、设备和托管前端均属于信任边界。
- 短期授权可在原加密通道内更新；失效或本机关闭会终止子请求/PTY。传输断开不保证原字节流无缝恢复，不自动重放业务写入。
- Web 前台事件与浏览器通知已有实现；浏览器关闭/Android 进程被杀后的原生后台推送未实现。语音听写/朗读继续延后。
- 管理器退出会清理其拥有的服务/路由，独立原生 Agent 不因其断开而被结束；“关窗口继续后台”的完整平台规范尚未建立。

## 账号与统一设备访问

已有自部署账号链路验收与当前[统一入口改造](plan/tasks/account-unified-experience.md)分别记录；本轮源代码退役旧手动入口，不能从旧v0.1.13包推断新版行为，也不能从源码改动推断所有平台均已发布/实机验收。

| 范围 | 当前目标与限制 | 证据状态 |
| --- | --- | --- |
| Web/手机浏览器 → 用户电脑 | Logto 登录、CyberGrid 发现；浏览器到本机 Noise 加密网关；业务仍由本机服务执行 | 自部署真实原生启用/发现/换钥/公网加密空工作区/关闭与退出、正式域名390/1440视口通过；22项浏览器/Rust业务互操作夹具另记；物理手机蜂窝未实测 |
| macOS 桌面账号宿主 | 官方 Native 注册/登录、账号令牌及私钥仅进程内存、本机显式开启、独立加密入口 | 内存实现与真实自部署重启换钥已通过；进程退出后重新登录及开启，不自动恢复授权；注册入口到达托管用户名表单，未验证邮件投递 |
| Linux 桌面账号宿主 | 新账号路径不使用系统 Secret Service，授权和密钥只在进程内存 | 编译/运行及上游provider矩阵待验证，不据macOS验收声称所有发行版支持 |
| Windows 桌面账号宿主 | 上游 Rust SDK 凭据模块当前依赖 Unix；账号远程访问明确不可用 | 本地工作仍可用；不以恢复旧手动入口假装平台支持完成，SDK支持另立阶段 |
| Android 账号入口 | 当前源码使用Custom Tabs/系统浏览器打开与Web/PWA相同的正式账号页；原生传输SDK接入另立阶段 | 旧手动连接、WireGuard及WebView桥退役；新APK/实际手机证据见统一入口任务。网页支持目标包含iOS浏览器，不等于新增原生iOS客户端；Safari/手机验证另记 |
| 当前账号云服务 | 最新配置已改自部署Logto default业务租户，独立CyberGrid项目/Upstash namespace；旧Cloud Development资源保留 | 新应用/权限/Account API已配置并独立读回；协调服务与正式主页READY；真实CORS/Redis/Native-Web加密链通过，本机更新见[当前记录](plan/reviews/account-selfhost-cutover-01.md)；无Cloud付费升级 |

账号数据与最少配置在 Logto，Upstash 仅作 CyberGrid 协调；业务正文和端到端私钥留在用户两端。HTTPS 本身不等于端到端加密。首次公钥目录、浏览器托管代码及终端仍是信任边界，详情见[方案](account-device-cloud-review.md)。

## 发布与证据维护 / Publishing and evidence

常规入口：`python3 scripts/publish.py` 或 `npm run release`。自动版本递增、精确 SHA 的 Checks、不可变发行、Pages 和轻量核验见[发布与恢复](releasing.md)。版本号一致、签名元数据/文件/网页核验、完整包密码学验签、真实安装升级是不同层级，必须分开记录。

更新规则：修改能力声明时，同步本矩阵和相应原生/平台验收记录；README、官网和概述链接本文，不复制一份互相矛盾的支持列表。历史记录保留原日期/SHA和当时边界，以后来明确验收取代旧现状，而不删除失败证据。I07 后续结构化 capabilities/readiness 需与本文一致。
