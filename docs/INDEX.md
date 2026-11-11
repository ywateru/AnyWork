# Documentation index

- [桌面与 Web 统一 UI / 交互框线设计稿（2026-11-11，v2 讨论稿）](design/desktop-refactor/README.md)：采用现有六角标志，精简桌面信息与 Web 登录、连接、设备入口；Web 对话部分暂保留，尚未修改产品实现。

- [统一界面 v2 实施与发布](plan/tasks/ui-refactor-v2.md)：隔离实施桌面及 Web 入口，独立验收后按既有流程发布。

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

