# AnyWork 云服务配置与验收

日期：2026-11-09（Asia/Shanghai）。本页记录实际资源、公开客户端配置与交付限制。云端只有 Logto 账号/配置、CyberGrid 协调服务及其 Upstash Redis；没有 AnyWork 业务数据库或业务代理。业务内容与端到端私钥留用户设备。账号与本机安全流程以[方案](account-device-cloud-review.md)为准。

## 已创建的资源

本轮均为新建的专用资源，未覆盖、升级、迁移或删除此前的 CyberGrid/Logto/Vercel 资源。没有付费升级。

| 资源 | 标识 / 地区 | 当前状态 |
| --- | --- | --- |
| Logto 生产租户 AnyWork | `afwf0u`，JP | Free；SPA/Native 已建；API resource / 用户角色受套餐限制，生产账号远程流程未就绪 |
| Logto 开发租户 AnyWork Development | `ueg42e`，JP | Development；独立的 SPA/Native、connect resource、默认用户角色、Account API、邮箱注册配置 |
| Vercel 官网/前端 | 项目 `anywork`，`https://anywork-tau.vercel.app` | 项目已创建，前端正式部署待集成审查 |
| Vercel CyberGrid 生产 | 项目 `anywork-cybergrid`，`https://anywork-cybergrid.vercel.app` | 项目已创建，租户套餐解决前不部署为可用生产服务 |
| Vercel CyberGrid 开发 | 项目 `anywork-cybergrid-dev`，`https://anywork-cybergrid-dev.vercel.app` | 官方源码 `2bd6729c6bbee90ed2926410caca883a0a100890`，部署 `dpl_HRWeXZr9HycRZbzarGQHbJRU4LRp` READY |
| Upstash Redis | `57d7542d-a68d-4a5b-b908-b92a54b862aa`，AWS `us-east-1` | Free，active，TLS=true，eviction=false；未启用付费升级 |

Vercel Function 使用上游 `iad1`；Upstash 与其接近。Logto 账号地区为 JP。开发 namespace 为 `anywork:development:v1`，预留生产 namespace 为 `anywork:production:v1`。同一专用 Redis 内的开发/生产 namespace 分离；后续若接近免费容量/命令额度，需另行评估，不能静默升级或驱逐安全记录。

## 公开配置

这些字段是客户端必需的公开标识，不是管理秘密。开发配置仅用于隔离测试，不能以开发租户替代生产验收。

| 字段 | 生产（资源权限待启用） | 开发 |
| --- | --- | --- |
| `VITE_LOGTO_ENDPOINT` | `https://afwf0u.logto.app` | `https://ueg42e.logto.app` |
| `VITE_LOGTO_APP_ID` | `3ico1d90eb82nd10ekz2a` | `4wu64isauau1xh9gkrh85` |
| `VITE_LOGTO_RESOURCE` | `https://anywork-cybergrid.vercel.app/api` | `https://anywork-cybergrid-dev.vercel.app/api` |
| `VITE_CYBERGRID_URL` | `https://anywork-cybergrid.vercel.app` | `https://anywork-cybergrid-dev.vercel.app` |
| `VITE_CYBERGRID_NATIVE_APP_ID` | `wqikraeyfzcsx5h6d4e9n` | `xfo4o0pmacag9qui4mrmf` |

Logto issuer 为对应 endpoint 加 `/oidc`。生产 audience 是待配置的固定值，不能据表格声称 API resource 已存在。生产 SPA 精确回跳 `/app/callback`，退出 `/app/`；Native 为 `http://127.0.0.1:17897/callback`，Device Flow 关闭，授权码+PKCE，唯一 grant 刷新所有者；配置 alwaysIssueRefreshToken 与 rotateRefreshToken。开发额外允许 `http://127.0.0.1:4173` 与 `http://localhost:5173`，生产没有 loopback/wildcard origin。

CyberGrid 的只读 console CORS 仅允许正式前端 origin；开发增加上述两个 loopback origin。不开放设备注册/信令/管理 API 的跨域权限，不授予业务接口访问能力。端口 URL 不等于用户授权。

## 套餐限制与付费边界

实际新生产 Free 租户创建 SPA/Native 成功；创建独立目录 M2M、创建自定义 API resource 均返回 HTTP 403 `subscription.limit_exceeded`。库存确认只有系统 Management API，没有 AnyWork resource。不能将系统 Management API 当成用户业务 audience，不能把管理权限授予普通用户。

2026-11-09 实际读取 [Logto 定价](https://logto.io/pricing)：Free 的 API resources / permissions / user roles 列为不可用；Pro 从 **24 美元/月**起，含 3 个 API resources，RBAC 为独立 **32 美元/月**附加项，包含用户角色与 M2M 角色。因此本方案 connect 权限与默认用户角色的**基础费用为 56 美元/月**，另有 token 超额用量、其他附加项及税费；最终首张账单及结算须以官方 Console/订阅预览为准。

已实际读取 Cloud API 的生产 subscription，确认 `planId=free`、active、dedicated。随后从官方 Console 静态代码核实并以 PAT 实际只读请求 `GET /api/skus`、`GET /api/tenants/afwf0u/available-skus`、`GET /api/tenants/afwf0u/subscription-usage`，均200：Free 的 `resourcesLimit=0,userRolesLimit=0,machineToMachineLimit=1`；`pro-202509` 的 `unitPrice=2400`（美分）、`resourcesLimit=3,userRolesLimit=0`；`rbac-enabled` 的 `unitPrice=3200`（美分）、`userRolesLimit=null`（不限）。这确认单买 Pro 仍没有用户角色额度，所需基础组合为24+32美元。该读取不等于已生成或支付发票，不调用收费接口探测权限。[官方 Pro 订阅 API](https://docs.logto.io/logto-cloud/subscribe-tenant-to-pro) 明确会立即扣首张账单，故本轮没有调用。套餐选择及费用批准是生产启用前的真实外部条件；开发租户不受该生产限制，已用于隔离集成。

上游当前要求目录 M2M 持有 Management API `all`，权限范围较宽。专用租户的默认 M2M 仅存 CyberGrid 服务端加密环境变量，本机/浏览器/仓库均无此秘密。Free 只允许一个 M2M，未为创建第二个 M2M 升级套餐。

## 秘密、存储与保留

Logto Cloud PAT、租户 M2M、Upstash 管理 API key、Redis writable REST token、测试账号凭据与 OAuth token 只保存在仓库外私有文件或服务端 Vercel encrypted env。配置脚本要求私有状态 mode 0600，拒绝符号链接；请求错误不回显请求/响应正文或 Authorization。Upstash Developer API key 只用于资源管理；运行时使用 Redis writable REST token，两者不混用。

Logto `customData` 仅保存公开安装标识/公钥、设备别名与偏好；Account API enabled，customData Edit，name/avatar/email ReadOnly。用户可编辑的配置不作为 owner/角色/撤销真源。

Redis 只存 CyberGrid 协调元数据（包括账号/设备关联、地址、信令、session hash、epoch、派生 seed、注册 fence）。设备租约65秒、session24小时、信令120秒是逻辑有效期；上游采用后续请求清理索引，不保证到期时物理擦除。fence/seed 可保留 namespace 全生命周期，备份和提供商留存需单独处理。未开启主动业务日志或内容采集。不得宣传整个系统不接触任何身份/连接元数据。

## 可恢复配置与发布

`scripts/cloud/configure.py` 的状态放仓库外；所有变更先核对已保存 ID/库存，不做付费升级、删除、Redis reset 或盲目重试。创建结果未知时先对账。配置脚本再次运行时按应用名称/类型和 resource indicator 查询已存在对象；重放已知 PATCH 不会新建租户。开发/生产使用不同状态文件。

```sh
# 私有状态 JSON 的初始字段为 logtoCloudPat，由秘密管理器写入；不要放进 Git。
python3 scripts/cloud/configure.py --state /absolute/private/production.json create-tenant --name AnyWork --tag production --region JP
python3 scripts/cloud/configure.py --state /absolute/private/production.json create-redis --upstash-email ACCOUNT_EMAIL
python3 scripts/cloud/configure.py --state /absolute/private/production.json configure-logto
python3 scripts/cloud/configure.py --state /absolute/private/production.json public-config
python3 scripts/cloud/configure.py --state /absolute/private/production.json entitlements
# 只有资源权限/角色真实就绪后才部署对应协调服务；开发另用独立 state/origin/prefix。
python3 scripts/cloud/deploy-cybergrid.py --state /absolute/private/production.json --redis-state /absolute/private/production.json --project anywork-cybergrid --prefix anywork:production:v1 --grid-origin https://anywork-cybergrid.vercel.app
```

部署命令首先持久保存 `gridDeploymentIntent`（操作 UUID、项目、固定源码、namespace、整个配置的 SHA-256 摘要与阶段），intent 和 Vercel deployment metadata 均不包含管理秘密明文。相同参数重复执行会查询并复用已保存的 READY/进行中部署，不再写 env 或创建 deployment。提交前先把阶段保存为 submitting；如果 POST 成功但响应或状态落盘丢失，下次按操作 UUID 和配置摘要查询项目库存，只有唯一匹配且项目/源码/metadata核验一致才恢复。没有匹配、多个匹配、不同配置、未知状态均明确停止，不盲目补发 POST。配置更改或凭据轮换同样需要显式新操作；旧操作未确认或仍进行中时不能跳过。

确实需要重新部署时使用 `--redeploy UUID`，为本次新操作生成一次 UUID 并私下保存；恢复时重用同一 UUID，不能每次重生。只有先前部署已确认结束后才允许新操作；重复执行同一新操作仍复用其结果。旧版状态只有在保存了匹配的 gridSource/gridEnvironment 及部署 ID，并通过服务端项目/源码核对后才自动采用；缺少旧版身份资料时必须人工对账，不能凭当前参数推定旧部署配置。prefix 按固定上游限制为1–80字符，超过上限在访问提供商前拒绝。

CyberGrid 从其 GitHub **仓库根**固定源码部署，Node22，官方 `api/index.ts` / `vercel.json`。预览环境默认无生产 secret，必须另行配置独立 namespace；不复制生产凭据到预览。

官网 workflow 已改为 `vercel.yml`，使用精确事件提交、Vercel prebuilt 产物与 `/build.json` 源码身份。`pages.yml` 只保留手动恢复旧网站。发布器以 Vercel 为正式站点，保留不可变 Release、签名/校验和与 `--pages-only` 兼容别名；推荐 `--site-only` 修复现有版本网站。CI 的 `ANYWORK_PRODUCTION_READY=true` 是运营启用开关：仅在套餐、生产配置、E2EE、独立审查及真实链路全部验收后设置；未设置时明确失败，不能出现“跳过即成功”。Vercel token 只作为 GitHub secret，org/project ID 作为 repository vars。

## 实际验证范围

- 上游当前固定源码服务测试实际运行：87 项中 80 pass、7 skip、0 fail。7 项需要本机 redis-server，未以假通过记账；后续实际 Upstash/部署验证另记。
- 专用开发 Vercel 部署 API 返回 READY，公开 `/healthz` 经 curl 实际返回200、`ok`、no-store、Vercel响应标识；console/auth/config200且issuer/client/resource与开发配置一致；未配置admin key时管理概览503，未知路径404；批准origin返回精确ACAO，未批准origin403且无ACAO。一次 Python 直连 TLS 超时不是服务验收通过或失败；与可用代理路径的 curl 探测分别记录。
- 本地发布器回归及私有配置安全测试通过，完整产品/手机网络/生产注册邮件验收尚未完成。本页不会以项目创建或上游测试替代 AnyWork 实际业务验收。

云认证隔离验证：实际用生成的测试账号完成 Logto 托管页面 SPA 登录、授权码+PKCE、ES384签名验证（固定issuer/audience/client/connect，TTL300秒），使用另一份 opaque token 成功读写 Account API。实际验证保留其他命名空间、customData整体替换行为、resource JWT调用Account API被拒绝。需要先以无resource参数兑换账号token，再通过同一refresh所有者取得Grid JWT；从resource-only兑换开始会把refresh范围收窄，不能据此假设可取得Account API权限。测试账号通过Management API预置并显式赋角色，不作为新用户注册/默认角色或邮箱投递验收；原生grant双token链路继续验证，完整产品生产验收仍未完成。

真实OAuth验证可由 `node scripts/cloud/verify-oauth.cjs --spa --credentials /absolute/private/test-user.json` 复跑；`--native` 单独测试原生client。脚本只对带 verificationFixture 的隔离账号执行配置写入，凭据与token产物必须放仓库外、0600；不输出token、密码或带敏感query的浏览器错误。系统Chrome用于独立临时profile，不使用用户浏览器登录态。原生测试首次没有consent时未取得refresh，最后一次显式consent测试遇到登录页网络超时，不能记为通过；后续桌面官方SDK实际UI验收负责闭合此门槛。

独立审查后修复：普通 Release 的显式分发已改为 vercel.yml；新增18项离线真实CLI恢复/发布调用链验收，覆盖完成/进行中重跑、POST响应丢失、提交前/响应后落盘中断、配置与凭据变更、库存歧义、显式稳定UUID重部署、旧状态采用及80/81字符边界。该轮未触发真实部署、套餐购买、生产启用或共享OAuth grant刷新。真实Upstash的11项独立验证证据与限定范围见 [cloud review](plan/reviews/account-cloud-01.md)。

## 当前交付修订：Development优先，后续自部署

2026-11-09用户明确指定本阶段 Logto 使用开发模式，后续切换自部署。因此上文“开发配置仅用于隔离测试”与生产付费前置仅为先前计划，本阶段由本节取代：当前客户端及Vercel前端使用现有 `ueg42e` Development配置和 `anywork-cybergrid-dev`。不购买Pro/RBAC，不把Vercel的production部署目标称为Logto生产租户。真实安全链路和独立审查仍是启用条件。

后续迁移以完整公开配置切换，保持官方OIDC/AccountAPI接口，不新增AnyWork云业务数据库；新issuer/client要求重新登录并重新登记设备，不复制令牌、私钥或本机工作数据。
