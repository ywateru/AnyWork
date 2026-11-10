---
id: desktop-onboarding-native
scope: native-start-authorization-and-active-remote-connections
status: done
depends-on: []
---

## objective

实现[桌面启动引导契约](../../desktop-onboarding-layout.md)中的 Native 启动顺序与真实远程连接投影。用户已明确授权“介绍→注册/登录→启动服务”的行为变更，取代旧首屏可直接启动的约束，无需再次请求产品确认。

## context

阅读 docs/INDEX.md、docs/desktop-onboarding-layout.md、docs/account-unified-experience.md、docs/account-remote-protocol.md 和既有账号/服务生命周期说明。保持官方 Logto grant 唯一所有者、内存凭据、gateway JWT/Noise 限制和外部服务所有权。

## path

拥有 `crates/desktop/src/`、`crates/remote/` 以及该任务的独立测试/作者报告；不编辑 desktop/ui、e2e、业务 Web 或云配置。新增 `desktop_start`（准备服务，不打开浏览器），对受支持平台的新启动和打开进行 Native 登录校验。manager 复用现有安全准备路径。accounts snapshot 新增 `remoteClients: {id:string,kind:'ios'|'android'|'desktop'|'unknown',connectedAt:number}[]`；账号快照失败由现有 IPC 错误表示，不能伪造空列表。unsupported snapshot 返回同结构空连接并明确状态，不提供隐式未登录启动旁路。

账号快照同时提供 `accountPortalUrl:string`，来自 Native 已验证的 `Handle::portal_url()`，与打开账号页命令同源，支持未来 frontendOrigin 自部署覆盖。gateway 基于 WS 头仅推导有限设备类别，在实际授权握手完成后注册 RAM 连接；RAII/退出覆盖取消、异常、过期、关闭。禁止把 request UA/地址/内容保存到云或扩大授权。与 UI 作者共享上述字段及命令；必要契约变化先报告 root。

## verification

定向 Rust/IPC/真实隔离 manager、真实 Noise gateway 边界验证：未登录不启动/打开，登录后只准备服务，显式打开仍交接，现有服务不停止/修改；只有已验证握手计入远程，续期保持、断线/到期/关闭消失、类别投影有限。保持现有远程过期/反重放/本地退出测试。交付提交与作者报告，不操作真实安装、用户登录、远程或公开发布。

## delivery

Native `87102db` 与测试夹具修正 `88fea9b` 已通过[独立审查](../reviews/desktop-onboarding-independent.md)并合入。合并后[完整检查](../reviews/desktop-onboarding-merged.md)通过；正式发行和本机候选采用单独跟进，不把源码验收当成真实账号或实体手机验收。
