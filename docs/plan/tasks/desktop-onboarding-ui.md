---
id: desktop-onboarding-ui
scope: introductory-signin-preparation-and-workspace-ui
status: ready
depends-on: []
---

## objective

按[新启动引导与连接控制台](../../desktop-onboarding-layout.md)设计并实现完整新桌面 UI。用户明确要求先介绍、登录/注册后再启动；不要复用旧首页的入口并列顺序。

## context

阅读 docs/INDEX.md、docs/desktop-onboarding-layout.md、frontend-design 技能、既有账号安全/更新说明。保留官方 SDK 的唯一 grant 所有者、取消/重新授权逻辑和更新确认，不在本地存账号或新启动状态。

## path

拥有 `desktop/ui/`、`e2e/desktop-*`、相关 UI 定向验证脚本和本任务作者报告；不编辑 Rust、业务 Web 或云配置。Native 并行作者交付 `desktop_start`（仅准备服务，成功 `void`，失败固定安全错误）、account snapshot 的 `remoteClients: {id:string,kind:'ios'|'android'|'desktop'|'unknown',connectedAt:number}[]`。使用真实对应接口，不制造永远就绪的空实现。

首屏介绍与设备关系图→注册/登录→成功后一次自动准备服务→控制台。失败显式重试；登录取消/退出/迟到响应有状态隔离。已有外部服务只核验复用。连接列表来源 account_snapshot.remoteClients，不用 manager.clients 旧心跳代替。未知快照状态不能显示0连接。提供本地裸地址与远程裸账号入口的复制/打开、远程三步说明和身份核对。四种尺寸的可用新视觉；设置/更新一致。supported 未登录不得发 desktop_start/desktop_open；unsupported 清楚解释现有限制，不偷偷跳过账号流程启动。

## verification

生产构建/TypeScript、账号与更新定向回归、真实生产 UI 配合严格合成 IPC 的阶段与竞态检查、四尺寸截图视觉复核。覆盖无启动、自动准备只一次、失败需手动重试、登录变化不采纳迟到结果、裸地址复制、远程指引、真实连接数据与不可用状态。旧桌面测试按新契约更新，不通过跳过合理检查来消除失败。提交实现和作者报告，不更新真实应用、不使用用户账号、不发布。
