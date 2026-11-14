# Documentation index

- [Android v0.1.38 设备读取卡住](plan/tasks/android-device-loading.md)：同签名实机验证关闭永久 loading；后续原生错误确认为协调配置读取失败，手机蜂窝到该域名 TCP 超时。41 项 Native 测试通过，手机保留修复/诊断包；工作区连接仍待可达网络或服务入口验证。

- [Android APK 体积优化](plan/tasks/android-apk-size.md)：已随 [v0.1.38](https://github.com/ywateru/AnyWork/releases/tag/v0.1.38) 按四架构正式发布；ARM64 为 37.43 MiB，相对旧通用下载包减少 80.77%，[交付记录](plan/reviews/android-size-release.md)说明逐包验收与官网恢复。
- [桌面首次登录后开启远程访问](plan/tasks/desktop-login-remote-first.md)：检查必须先在 Web 登录才能开启远程的初始化/授权差异，修复桌面独立登录流程。
- [手机设备状态与连接调查](plan/tasks/mobile-device-status.md)：截图对应网页设备页；已修复独立的 Native 恢复缺陷，并补充安全阶段详情，现场失败根因待阶段码确认。

- [Android 原生 Rust/Tauri 2 客户端重构](android-account-entry.md)：已发布[v0.1.34](https://github.com/ywateru/AnyWork/releases/tag/v0.1.34)；[手机布局](mobile-client-layout.md)、[原生接口](mobile-native-contract.md)、[实施任务](plan/tasks/android-native-client.md)、[合并验收与官网恢复](plan/reviews/android-native-merged.md)；完整界面随包、应用内登录与原生远程连接，连接前先更新电脑宿主。

- [网页当前用户名修复](plan/tasks/account-identity-visible.md)：2026-11-13 用户截图反馈；当前账号名称按已验证 profile/username/email 显示，保持 subject 隔离。

- [Claude Code / Claude Desktop Code 接入](claude-integration.md)：[Desktop 连接与后续手测](claude-desktop-setup.md)、[第三方会话读取与接管研究](plan/analysis/claude-third-party.md)、[CLI 独立审查](plan/reviews/claude-backend-independent.md)、[网页独立审查](plan/reviews/claude-web-independent.md)；[CLI/服务接线](plan/tasks/claude-backend.md)、[桌面载体](plan/tasks/claude-desktop.md)、[网页任务](plan/tasks/claude-web.md)与[独立验收](plan/tasks/claude-verification.md)。

- [开源说明与正式域名](plan/tasks/open-source-ui.md)：已随 v0.1.29 发布；官网、Web 与桌面补充服务端和客户端开源说明及 GitHub，默认入口统一为 `https://anywork.aixgg.com`，[最终独立验收](plan/reviews/open-source-release.md)通过。

- [CyberGrid v0.8.0 集成更新](plan/tasks/cybergrid-v080.md)：官方 Rust/JS SDK 与宿主远程门禁、令牌新鲜度适配已随 v0.1.28 交付；[最终独立验收](plan/reviews/ui-login-cybergrid-v28-release.md)通过，服务端迁移另行验证。

- [登录、窗口与设备体验修订](plan/tasks/ui-login-device-followup.md)：弹窗居中、回调页、浏览器 SSO、原生标题栏、用户名和可编辑设备名已随 v0.1.28 交付，实证边界见最终独立验收。

- [桌面与 Web 统一 UI / 交互框线设计稿（2026-11-11，v2）](design/desktop-refactor/README.md)：采用现有六角标志，精简桌面信息与 Web 登录、连接、设备入口；Web 对话部分暂保留，设计核验与产品验收分别记录。

- [统一界面 v2 实施与发布](plan/tasks/ui-refactor-v2.md) · [线上验收](plan/reviews/ui-v2-production.md)：已发布 v0.1.26，正式 Web 与各平台安装包核验通过；旧构建缓存已清理。

- [登录后默认远程与精简控制台](plan/tasks/desktop-default-remote.md)：当前用户修订，修正协调配置读取失败，支持会话内手动关闭。
- [自部署 TLS Redis 切换](plan/tasks/cybergrid-selfhost-redis.md) · [独立验收](plan/reviews/cybergrid-selfhost-redis-independent.md)：替代已耗尽免费月额度的 Upstash，保持账号与端到端授权绑定。

- [桌面启动介绍、登录与连接控制台](desktop-onboarding-layout.md) · [Native 任务](plan/tasks/desktop-onboarding-native.md) · [UI 任务](plan/tasks/desktop-onboarding-ui.md)：当前新一轮用户要求，先介绍和登录，随后准备服务并显示真实连接。
- [给 CyberGrid 开发组的使用反馈与改进要求（2026-11-10）](cybergrid-product-feedback.md)：统一账号连接前的能力、分工与验收讨论稿。
- [统一账号与工作区体验](account-unified-experience.md) · [实施与验收任务](plan/tasks/account-unified-experience.md)
- [桌面控制台布局与访问说明](desktop-workspace-layout.md) · [界面优化任务](plan/tasks/desktop-workspace-layout.md) · [界面独立审查](plan/reviews/desktop-workspace-layout-independent.md) · [本机采用记录](plan/reviews/desktop-workspace-layout-live.md)
- [统一入口合并检查](plan/reviews/account-unified-merged.md) · [运行与产物独立验收](plan/reviews/account-unified-runtime-artifacts.md) · [正式 Web 上线记录](plan/reviews/account-unified-web-live.md) · [Mac 本机上线记录](plan/reviews/account-unified-native-live.md)
- [统一账号上线独立核验](plan/reviews/account-unified-live-independent.md)：正式域名、实际 Mac 包与进程、原环境、配置及会话标识保留的最终核对。
- [账号、设备发现与 Vercel 云入口专家评审方案（2026-11-09）](account-device-cloud-review.md) · [调研证据](plan/analysis/account-device-cloud.md) · [实施拆分](plan/tasks/account-device-cloud.md)
- [账号入口验收状态](plan/reviews/account-device-acceptance.md) · [云配置与费用](cloud-configuration.md) · [桌面账号与隔离验收](account-desktop.md) · [加密协议](account-remote-protocol.md) · [官网/设备页布局](account-web-layout.md)
- [当前自部署切换与验收](plan/reviews/account-selfhost-cutover-01.md) · [自部署CyberGrid上线证据](plan/reviews/account-selfhost-grid-live.md) · [正式主页发布证据](plan/reviews/account-homepage-selfhost-live.md)
- [本机更新与恢复记录](plan/reviews/account-selfhost-local-rollout-01.md) · [本机更新独立验收](plan/reviews/account-local-update-01.md)
- [账号连接可靠性修正](plan/tasks/account-live-reliability.md) · [本次故障调查](plan/analysis/account-live-reliability.md)
- [全项目改进与专家评审稿（2026-11-07）](project-improvement-review.md)
- [当前支持与验收矩阵 / Support matrix](support-matrix.md)
- [Architecture](architecture.md), [API](api.md), [plugin protocol](plugin-protocol.md)
- [Schema safety and recovery contract (G1 / I05)](schema-and-recovery.md)
- [Durable message operations contract (G1 / I02)](message-operations.md)
- [Internal durable operation ledger module (I02a)](message-ledger-module.md)
- [Effective capabilities and readiness contract (G1 / I07)](capability-projection.md)
- [Read-only capability projection module (I07a)](capability-projection-module.md)
- [Native observation and error call-path research (I07b design input)](plan/analysis/capability-observations.md)
- [Qualified runtime lifecycle and generation fencing contract (I07b1)](runtime-lifecycle.md)
- [Dormant qualified SDK transport module (I07b1-A)](runtime-transport-module.md)
- [Native input acceptance evidence research (I02b design input)](plan/analysis/delivery-proofs.md)
- [Storage degradation and recovery analysis (I03 design input)](plan/analysis/storage-degradation.md)
- [Global event scope and cursor contract (I01)](global-event-scope.md)
- [Conditional file editing and conflict recovery (I04)](file-edit-consistency.md)
- [Conversation UI](ui-design.md), [conversation panels](conversation-panels.md)
- [Sidebar Agent filtering and icons](sidebar-agent-filter.md)
- [WorkBuddy integration contract](workbuddy-integration.md), [investigation](plan/analysis/workbuddy.md)
- [WorkBuddy launcher / 桌面连接引导](workbuddy-launcher.md)
- [WorkBuddy visible transcript and live updates](workbuddy-transcript-updates.md)
- [DeepSeek Harness integration](deepseek-harness-integration.md)
- [Harness shared-host setup / 共享主机接入](harness-setup.md)
- [Harness persisted history](harness-persisted-history.md), [WorkBuddy persisted history](workbuddy-persisted-history.md)
- [Harness Desktop discovery](harness-desktop-discovery.md)
- [Discovery companion installation](../integrations/harness-discovery/README.md)
- [Harness UI source provenance](harness-ui-provenance.md)
- [Delivery plan](plan/README.md)
- [Getting started](getting-started.md), [中文入门](getting-started.zh-CN.md)
- [Release automation and recovery / 一键发布与恢复](releasing.md)

