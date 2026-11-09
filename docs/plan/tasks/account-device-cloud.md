---
id: account-device-cloud
scope: accounts-device-discovery-cloud
status: in-progress
depends-on: []
---

# 账号与设备入口实施计划（实施中）

## objective

按用户修订要求交付：云端持久账号及最少配置全部在 Logto，发现与信息交换使用 CyberGrid；官网/账号界面在 Vercel；AnyWork 不新增云后端、数据库、业务代理或云审计库。业务与解密密钥留在用户设备。D1–D8 统一维护在[评审方案](../../account-device-cloud-review.md)。

本文替换旧版 AnyWork Redis/Postgres、Control API、中央票据和 shared-v2 实施拆分；旧任务不再作为目标。本轮重新调研的 CyberGrid `1e65328` 已自带 Functions+Redis，用户已指定该 Redis 使用 Upstash，用户已授权按方案实施、完成测试并更新；现转入隔离开发、独立审查和发布阶段。

## context

- [评审方案](../../account-device-cloud-review.md)、[调研记录](../analysis/account-device-cloud.md)
- [现有架构](../../architecture.md)、[API](../../api.md)、[部署](../../deployment.md)
- [桌面管理器](../../desktop-manager-design.md)、[支持矩阵](../../support-matrix.md)
- [事件范围](../../global-event-scope.md)、[消息操作](../../message-operations.md)、[发布](../../releasing.md)

## path

预期改动面：`site/`、`web/src/`、`desktop/ui/`、`crates/desktop/`、`crates/server/` 本机授权/加密适配、后续 `android/`、发布脚本/workflow 与相应文档。无 `cloud/control`、云数据库 schema 或业务日志采集模块。

CyberGrid 优先配置现有服务、锁定官方 SDK；如浏览器加密能力需要上游扩展，单列客户端/传输任务评审，不默认展开中央服务分布式重构。

## 模块任务

| ID | 目标 | 依赖 | 验证 |
| --- | --- | --- | --- |
| AC-00 | Logto Account API、customData 权限/覆盖/配额验证；核验用户指定 Upstash 资源、访问权限与 namespace；浏览器 E2EE 选型 | 评审 | 列出会话/网络元数据、永久 fence/seed、逻辑清理和备份边界；无管理秘密下发；Upstash 仅承担协调，不增加业务存储 |
| AC-01 | 配置 Logto 租户、SPA/Native、Grid resource、默认角色、Account API、注册邮件和精确 origin | AC-00 | 真实注册与邮件；正确区分 Account opaque token/Grid JWT；错误账号/权限拒绝 |
| AC-02 | 按上游根配置部署 CyberGrid Functions，配置 Logto、Upstash、namespace 与 CORS；锁定新服务提交和匹配 SDK | AC-00、AC-01 | 同账号设备发现；冷启动保留 session/epoch；namespace 重置恢复；Redis 不可用失败关闭；不建 AnyWork 业务存储 |
| AC-03 | 前端 Logto 登录与配置读写；保留其他 customData 命名空间、串行写和冲突反馈 | AC-01 | 多账号隔离、完整替换、并发丢更新、写后核对、体积上限；不把配置当授权 |
| AC-04 | 桌面本机 owner/安装密钥/SDK/provider，grant 唯一刷新所有者；本机开启远程访问 | AC-01、AC-02 | 本机确认、跨账号拒绝、密钥不上传、Account/Grid 两类 token、取消与轮换恢复 |
| AC-05 | Web/PWA 设备页；Logto 配置与 CyberGrid 在线目录合并；缓存/草稿隔离 | AC-02、AC-03、AC-04 | 空态/未知/离线/入口未就绪；切账号与迟到响应；390 px 与键盘交互 |
| AC-06 | 浏览器端到端加密通道与桌面本地鉴权/受限路由；全部业务 API、事件、文件、PTY | AC-00、AC-04 | 成熟协议/库、身份绑定、重放/nonce/密钥更新、流控/取消；中转无业务明文 |
| AC-07 | 官网重设计与 Vercel 静态部署；发布器 Pages→Vercel 迁移 | AC-01、AC-05 | 双语、注册/下载、精确提交、回跳/失败恢复；无业务分析采集 |
| AC-08 | 原生手机/其他平台接入（独立阶段） | 首发链路通过后 | 官方独立授权、SDK map、本机密钥存储、实机网络与完整业务验收 |

## 真实集成验收

| ID | 链路 | 依赖 | 必须证明 |
| --- | --- | --- | --- |
| AI-01 | Logto 注册 → Account API → 前端配置 → CyberGrid console/设备发现 | AC-01–AC-05 | 仅当前用户配置；无自建后端；设备状态来自实时协调 |
| AI-02 | 桌面本机确认 → owner/密钥 → CyberGrid 注册 → 另一端自动发现 | AC-02、AC-04、AC-05 | 不输入 URL/长期密钥；重启可恢复；公钥变化明确处理 |
| AI-03 | Web 选择设备 → 核对设备 → E2EE → 桌面授权 → 完整 AnyWork API | AC-05、AC-06、AI-02 | 会话/审批/文件/上传/PTY 实际可用；中转只有密文，无弱鉴权回退 |
| AI-04 | CyberGrid 实例重启/Redis 不可用/namespace 重置/网络切换/取消/过期/关闭/移除显示 | AI-01–AI-03 | 不上传业务内容/端到端私钥；Upstash 仅存 CyberGrid 必要协调数据；无业务重放；目录删除不被误记为安全撤销 |
| AI-05 | Vercel 发布 → 注册登录 → 手机蜂窝访问桌面 Wi-Fi | AC-07、AI-03、AI-04 | 当前提交与支持矩阵一致；日志/上报无敏感数据；发布恢复不重复发 release |

## verification

1. 云数据边界是交付门槛：不得新增 AnyWork 自有 Redis/Postgres、云业务 API、对象存储或审计库；用户指定的 Upstash 仅配置为 CyberGrid 内部协调存储。Logto customData 不存秘密和业务内容；不得将逻辑过期描述成物理到期擦除。
2. Account API 仅用于当前用户的非安全配置。全量替换必须保留其他命名空间，并发能力与局限以实测报告说明。
3. 业务权限必须由桌面执行；用户可编辑的设备索引、名称、schemaVersion 不能当角色/owner/撤销信任源。
4. 完整浏览器远控以前端与桌面的 E2EE 审查及真实集成为前置，普通 HTTPS tunnel 不等同通过。
5. 实现与独立验证分别执行；新任务补齐最终改动路径、协议、错误与验收，不以 mock/上游 Lab 代替真实链路。
6. 使用隔离账号和工作区，不覆盖现有凭据/会话。文档记录源码、隔离测试、真实网络证据各自范围。
7. 首发依赖 AI-01–AI-05；CyberGrid Vercel 官方支持已核实，Redis 提供方已确定为 Upstash，余下门槛是资源/配置核验、数据最小化与 AnyWork 实际集成。账户管理 API key 只作资源管理，不用作运行时 Redis token。

## 当前状态

2026-11-09 的调研基线结束后，三条实现分支的阻断均经独立复验关闭并合并，整套合并后项目检查与静态产物检查通过。浏览器业务加密由本机网关与前端Noise适配补齐，不新增云业务服务。用户随后要求现有客户端注册/登录、账号仅内存，并立即切换自部署Logto；[当前客户端任务](account-client-entry.md)及[自部署切换记录](../reviews/account-selfhost-cutover-01.md)维护最新状态。新自部署应用/权限、独立CyberGrid/Upstash namespace和正式Vercel主页均已配置发布；真实Native/Web发现、公钥核对、加密空工作区、重启换钥、退出及正式域名390/1440视口通过。本机更新结果见当前记录，不新增GitHub二进制release。此前DEV/付费生产门槛为历史；不购买Cloud套餐，也没有以浏览器小屏验证代替物理手机蜂窝测试。

## 当前开发分工

用户已授权按上述方案实施、整体测试并更新。保持主分支现有业务与运行实例，使用 `codex/` 隔离分支。

| 任务 | 路径所有权 | 交付与依赖 |
| --- | --- | --- |
| [account-cloud](account-cloud.md) | `scripts/cloud/`、云配置公开清单、发布器与 workflow | 新租户、Upstash、CyberGrid 服务；先返回公开配置，站点正式发布依赖前端通过 |
| [account-web](account-web.md) | `web/`、`site/`、根 Vercel 静态配置 | 登录/注册/设备页、官网；加密业务适配依赖安全协议固化 |
| [account-desktop](account-desktop.md) | `crates/`、`desktop/`、Cargo 锁文件、本机安全协议文档 | 本机独立登录/owner/设备注册/加密端点；先明确跨端协议并共享 |

所有子任务先提交，再由不同代理独立审查。只允许在已有用户授权与方案安全边界内细化实现，不新增云业务服务；遇到需要降低安全门槛的情况不得自行降级。AC-08 原生手机独立阶段，本次手机范围为浏览器/PWA。

## 生产发布前置事项（实施中发现）

1. 新建 Logto 生产 Free 租户的 custom API resource 创建返回 `403 subscription.limit_exceeded`。实际只读 Cloud API 确认 Free 的 resource/用户角色额度均为 0；Pro `pro-202509` 为 24 美元/月且仍无用户角色额度，RBAC 附加项为 32 美元/月。因此当前设计的生产基础费用为 **56 美元/月**，另有税费、token 超额及其他附加项，最终以官方结算为准。官方订阅 API 会立即扣首张账单；未调用收费接口或升级套餐。单独的 Development 租户用于真实集成，不能描述为生产验收。付费变更需要在实现、测试与费用可审阅后由用户授权。
2. CyberGrid 固定提交 `2bd6729` 的 LICENSE 原文保留 “All rights reserved” 以及 “Use beyond the rights otherwise granted by its owner requires the owner's permission.” 用户已要求集成使用；正式向第三方分发 SDK 与 AGPL 客户端前，需落定可分发且兼容的许可文本。不得凭模型判断改写上游 LICENSE 或自行虚构授权。

这些事项不停止本机开发和隔离测试；也不允许省略最终验收或将开发租户伪称生产环境。
