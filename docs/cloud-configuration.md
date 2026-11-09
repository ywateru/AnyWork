# AnyWork 云服务配置与验收

日期：2026-11-09（Asia/Shanghai）。本阶段按用户要求使用 Logto Development，后续迁移自部署；不需要购买 Cloud 生产套餐。本页记录实际资源、公开客户端配置与交付限制。云端只有 Logto 账号/配置、CyberGrid 协调服务及其 Upstash Redis；没有 AnyWork 业务数据库或业务代理。业务内容与端到端私钥留用户设备。账号与本机安全流程以[方案](account-device-cloud-review.md)为准。

## 已创建的资源

本轮均为新建的专用资源，未覆盖、升级、迁移或删除此前的 CyberGrid/Logto/Vercel 资源。没有付费升级。

| 资源 | 标识 / 地区 | 当前状态 |
| --- | --- | --- |
| Logto 生产租户 AnyWork | `afwf0u`，JP | Free；SPA/Native 已建；API resource / 用户角色受套餐限制，生产账号远程流程未就绪 |
| Logto 开发租户 AnyWork Development | `ueg42e`，JP | Development；独立的 SPA/Native、connect resource、默认用户角色、Account API、邮箱注册配置 |
| Vercel 官网/前端 | 项目 `anywork`，`https://anywork-tau.vercel.app` | 项目已创建，前端正式部署待集成审查 |
| Vercel CyberGrid 生产 | 项目 `anywork-cybergrid`，`https://anywork-cybergrid.vercel.app` | 预留未启用；当前交付使用专用 Development 服务 |
| Vercel CyberGrid 开发 | 项目 `anywork-cybergrid-dev`，`https://anywork-cybergrid-dev.vercel.app` | 官方源码 `2bd6729c6bbee90ed2926410caca883a0a100890`，部署 `dpl_HRWeXZr9HycRZbzarGQHbJRU4LRp` READY |
| Upstash Redis | `57d7542d-a68d-4a5b-b908-b92a54b862aa`，AWS `us-east-1` | Free，active，TLS=true，eviction=false；未启用付费升级 |

Vercel Function 使用上游 `iad1`；Upstash 与其接近。Logto 账号地区为 JP。开发 namespace 为 `anywork:development:v1`，预留生产 namespace 为 `anywork:production:v1`。同一专用 Redis 内的开发/生产 namespace 分离；后续若接近免费容量/命令额度，需另行评估，不能静默升级或驱逐安全记录。

## 公开配置

这些字段是客户端必需的公开标识，不是管理秘密。本阶段客户端与 Vercel 前端使用下表开发列；生产列仅为先前预留资源，不是当前启用前置。Development 服务的验收范围须如实记录，不称为 Logto 生产租户。

| 字段 | 生产（资源权限待启用） | 开发 |
| --- | --- | --- |
| `VITE_LOGTO_ENDPOINT` | `https://afwf0u.logto.app` | `https://ueg42e.logto.app` |
| `VITE_LOGTO_APP_ID` | `3ico1d90eb82nd10ekz2a` | `4wu64isauau1xh9gkrh85` |
| `VITE_LOGTO_RESOURCE` | `https://anywork-cybergrid.vercel.app/api` | `https://anywork-cybergrid-dev.vercel.app/api` |
| `VITE_CYBERGRID_URL` | `https://anywork-cybergrid.vercel.app` | `https://anywork-cybergrid-dev.vercel.app` |
| `VITE_CYBERGRID_NATIVE_APP_ID` | `wqikraeyfzcsx5h6d4e9n` | `xfo4o0pmacag9qui4mrmf` |

Logto issuer 为对应 endpoint 加 `/oidc`。生产 audience 是待配置的固定值，不能据表格声称 API resource 已存在。生产 SPA 精确回跳 `/app/callback`，退出 `/app/`；Native 为 `http://127.0.0.1:17897/callback`，Device Flow 关闭，授权码+PKCE，唯一 grant 刷新所有者；配置 alwaysIssueRefreshToken 与 rotateRefreshToken。开发额外允许 `http://127.0.0.1:4173` 与 `http://localhost:5173`，生产没有 loopback/wildcard origin。

CyberGrid 的只读 console CORS 仅允许正式前端 origin；开发增加上述两个 loopback origin。不开放设备注册/信令/管理 API 的跨域权限，不授予业务接口访问能力。端口 URL 不等于用户授权。

## 历史生产套餐调研（不阻断本阶段）

实际新生产 Free 租户创建 SPA/Native 成功；创建独立目录 M2M、创建自定义 API resource 均返回 HTTP 403 `subscription.limit_exceeded`。库存确认只有系统 Management API，没有 AnyWork resource。不能将系统 Management API 当成用户业务 audience，不能把管理权限授予普通用户。

2026-11-09 实际读取 [Logto 定价](https://logto.io/pricing)：Free 的 API resources / permissions / user roles 列为不可用；Pro 从 **24 美元/月**起，含 3 个 API resources，RBAC 为独立 **32 美元/月**附加项，包含用户角色与 M2M 角色。因此本方案 connect 权限与默认用户角色的**基础费用为 56 美元/月**，另有 token 超额用量、其他附加项及税费；最终首张账单及结算须以官方 Console/订阅预览为准。

已实际读取 Cloud API 的生产 subscription，确认 `planId=free`、active、dedicated。随后从官方 Console 静态代码核实并以 PAT 实际只读请求 `GET /api/skus`、`GET /api/tenants/afwf0u/available-skus`、`GET /api/tenants/afwf0u/subscription-usage`，均200：Free 的 `resourcesLimit=0,userRolesLimit=0,machineToMachineLimit=1`；`pro-202509` 的 `unitPrice=2400`（美分）、`resourcesLimit=3,userRolesLimit=0`；`rbac-enabled` 的 `unitPrice=3200`（美分）、`userRolesLimit=null`（不限）。这确认单买 Pro 仍没有用户角色额度，所需基础组合为24+32美元。该读取不等于已生成或支付发票，不调用收费接口探测权限。[官方 Pro 订阅 API](https://docs.logto.io/logto-cloud/subscribe-tenant-to-pro) 明确会立即扣首张账单，故本轮没有调用。若未来仍选择 Cloud 生产租户，套餐选择及费用批准是该选择的外部条件；本阶段使用 Development，计划后续自部署，不受该生产限制，已用于隔离集成。

上游当前要求目录 M2M 持有 Management API `all`，权限范围较宽。专用租户的默认 M2M 仅存 CyberGrid 服务端加密环境变量，本机/浏览器/仓库均无此秘密。Free 只允许一个 M2M，未为创建第二个 M2M 升级套餐。

## 秘密、存储与保留

Logto Cloud PAT、租户 M2M、Upstash 管理 API key、Redis writable REST token、测试账号凭据与 OAuth token 只保存在仓库外私有文件或服务端 Vercel encrypted env。配置脚本要求私有状态 mode 0600，拒绝符号链接；请求错误不回显请求/响应正文或 Authorization。Upstash Developer API key 只用于资源管理；运行时使用 Redis writable REST token，两者不混用。

Logto `customData` 仅保存公开安装标识/公钥、设备别名与偏好；Account API enabled，customData Edit，name/avatar/email ReadOnly。用户可编辑的配置不作为 owner/角色/撤销真源。

Redis 只存 CyberGrid 协调元数据（包括账号/设备关联、地址、信令、session hash、epoch、派生 seed、注册 fence）。设备租约65秒、session24小时、信令120秒是逻辑有效期；上游采用后续请求清理索引，不保证到期时物理擦除。fence/seed 可保留 namespace 全生命周期，备份和提供商留存需单独处理。未开启主动业务日志或内容采集。不得宣传整个系统不接触任何身份/连接元数据。

## 可恢复配置与发布

`scripts/cloud/configure.py` 的状态放仓库外；所有变更先核对已保存 ID/库存，不做付费升级、删除、Redis reset 或盲目重试。创建结果未知时先对账。配置脚本再次运行时按应用名称/类型和 resource indicator 查询已存在对象；重放已知 PATCH 不会新建租户。开发/生产使用不同状态文件。

```sh
# 当前使用已配置的 Development state；public-config 只输出五项公开标识。
python3 scripts/cloud/configure.py --state /absolute/private/development.json public-config
# 新建独立开发资源时显式指定 Development 和专用 origin；不要重复创建现有租户。
python3 scripts/cloud/configure.py --state /absolute/private/new-development.json create-tenant --name AnyWork-Development --tag development --region JP
python3 scripts/cloud/configure.py --state /absolute/private/new-development.json configure-logto --frontend-origin https://anywork-tau.vercel.app --grid-origin https://anywork-cybergrid-dev.vercel.app
# 仅在对应 resource/default role 真实就绪后使用持久化恢复机制部署协调服务。
python3 scripts/cloud/deploy-cybergrid.py --state /absolute/private/development.json --redis-state /absolute/private/redis.json --project anywork-cybergrid-dev --prefix anywork:development:v1 --grid-origin https://anywork-cybergrid-dev.vercel.app
```

部署命令首先持久保存 `gridDeploymentIntent`（操作 UUID、项目、固定源码、namespace、整个配置的 SHA-256 摘要与阶段），intent 和 Vercel deployment metadata 均不包含管理秘密明文。相同参数重复执行会查询并复用已保存的 READY/进行中部署，不再写 env 或创建 deployment。提交前先把阶段保存为 submitting；如果 POST 成功但响应或状态落盘丢失，下次按操作 UUID 和配置摘要查询项目库存，只有唯一匹配且项目/源码/metadata核验一致才恢复。没有匹配、多个匹配、不同配置、未知状态均明确停止，不盲目补发 POST。配置更改或凭据轮换同样需要显式新操作；旧操作未确认或仍进行中时不能跳过。

确实需要重新部署时使用 `--redeploy UUID`，为本次新操作生成一次 UUID 并私下保存；恢复时重用同一 UUID，不能每次重生。只有先前部署已确认结束后才允许新操作；重复执行同一新操作仍复用其结果。旧版状态只有在保存了匹配的 gridSource/gridEnvironment 及部署 ID，并通过服务端项目/源码核对后才自动采用；缺少旧版身份资料时必须人工对账，不能凭当前参数推定旧部署配置。prefix 按固定上游限制为1–80字符，超过上限在访问提供商前拒绝。

CyberGrid 从其 GitHub **仓库根**固定源码部署，Node22，官方 `api/index.ts` / `vercel.json`。预览环境默认无生产 secret，必须另行配置独立 namespace；不复制生产凭据到预览。

官网 workflow 已改为 `vercel.yml`，使用精确事件提交、Vercel prebuilt 产物与 `/build.json` 源码身份。`pages.yml` 只保留手动恢复旧网站。发布器以 Vercel 为正式站点，保留不可变 Release、签名/校验和与 `--pages-only` 兼容别名；推荐 `--site-only` 修复现有版本网站。CI 的 `ANYWORK_ACCOUNT_READY=true` 是账号/加密传输启用开关：Development、自部署或 Cloud 生产模式均可使用，但仅在所选完整配置、E2EE、独立审查及真实链路验收后设置；未设置时明确失败，不能出现“跳过即成功”。它不表示已购买或启用 Logto Cloud 生产套餐。Vercel token 只作为 GitHub secret，org/project ID 和下述公开配置作为 repository vars；旧 `ANYWORK_PRODUCTION_READY` 不再读取。

## 实际验证范围

- 上游当前固定源码服务测试实际运行：87 项中 80 pass、7 skip、0 fail。7 项需要本机 redis-server，未以假通过记账；后续实际 Upstash/部署验证另记。
- 专用开发 Vercel 部署 API 返回 READY，公开 `/healthz` 经 curl 实际返回200、`ok`、no-store、Vercel响应标识；console/auth/config200且issuer/client/resource与开发配置一致；未配置admin key时管理概览503，未知路径404；批准origin返回精确ACAO，未批准origin403且无ACAO。一次 Python 直连 TLS 超时不是服务验收通过或失败；与可用代理路径的 curl 探测分别记录。
- 本地发布器回归及私有配置安全测试通过，完整产品/手机网络/生产注册邮件验收尚未完成。本页不会以项目创建或上游测试替代 AnyWork 实际业务验收。

云认证隔离验证：实际用生成的测试账号完成 Logto 托管页面 SPA 登录、授权码+PKCE、ES384签名验证（固定issuer/audience/client/connect，TTL300秒），使用另一份 opaque token 成功读写 Account API。实际验证保留其他命名空间、customData整体替换行为、resource JWT调用Account API被拒绝。需要先以无resource参数兑换账号token，再通过同一refresh所有者取得Grid JWT；从resource-only兑换开始会把refresh范围收窄，不能据此假设可取得Account API权限。测试账号通过Management API预置并显式赋角色，不作为新用户注册/默认角色或邮箱投递验收；原生grant双token链路继续验证，完整产品生产验收仍未完成。

真实OAuth验证可由 `node scripts/cloud/verify-oauth.cjs --spa --credentials /absolute/private/test-user.json` 复跑；`--native` 单独测试原生client。脚本只对带 verificationFixture 的隔离账号执行配置写入，凭据与token产物必须放仓库外、0600；不输出token、密码或带敏感query的浏览器错误。系统Chrome用于独立临时profile，不使用用户浏览器登录态。原生测试首次没有consent时未取得refresh，最后一次显式consent测试遇到登录页网络超时，不能记为通过；后续桌面官方SDK实际UI验收负责闭合此门槛。

独立审查后修复：普通 Release 的显式分发已改为 vercel.yml；新增18项离线真实CLI恢复/发布调用链验收，覆盖完成/进行中重跑、POST响应丢失、提交前/响应后落盘中断、配置与凭据变更、库存歧义、显式稳定UUID重部署、旧状态采用及80/81字符边界。该轮未触发真实部署、套餐购买、生产启用或共享OAuth grant刷新。真实Upstash的11项独立验证证据与限定范围见 [cloud review](plan/reviews/account-cloud-01.md)。

## 前端部署的完整公开配置

`vercel.yml` 从同名 GitHub repository vars 显式传入五项 `VITE_LOGTO_ENDPOINT`、`VITE_LOGTO_APP_ID`、`VITE_LOGTO_RESOURCE`、`VITE_CYBERGRID_URL`、`VITE_CYBERGRID_NATIVE_APP_ID`，当前值为上表开发列。可选 `VITE_ACCOUNT_PORTAL_URL` 指定工作区账号入口，默认 `https://anywork-tau.vercel.app/app/`。不要把 PAT、M2M secret、Upstash token 或用户 grant 放入任何 `VITE_` 字段。

部署前执行 `python3 scripts/cloud/prepare-frontend.py`：只读这五项公开环境变量，必须完整且是合法 HTTPS origin/resource 和客户端 ID；不读管理凭据、不调用云 API。脚本用所选 Logto/Grid origin 生成 `vercel.json` 中唯一全局 CSP，保留现有脚本/字体/对象/frame限制与加密 Cloudflare tunnel 连接许可，不保留旧租户 origin 或放开所有 HTTPS。随后 `vercel build --prod` 读取该配置。`scripts/assemble-vercel.py` 再次核对 CSP 与同一构建环境一致，缺字段或未提前生成配置均拒绝组装，避免发出能构建却被 CSP 拦截的自部署前端。Vercel 的 `--prod` 只指 Vercel 部署目标，不表示 Logto 模式。

```sh
# 用秘密管理器/CI环境注入五项公开值；不从私有state整份导出环境。
python3 scripts/cloud/prepare-frontend.py
vercel build --prod
vercel deploy --prebuilt --prod
```

目前受支持的是上述 workflow/prebuilt 发布路径；Vercel 平台直接从 Git 构建时也必须先在构建配置解析前执行准备步骤，否则自部署 issuer 的 CSP 不会生效。代码仓库内的 `vercel.json` 仅携带当前 Development origin，运行生成的配置是公开部署产物；组装显式调用 `source-archive.py --revision <HEAD>`，从不可变 Git tree/blob 导出对应源码，仍执行公开文件过滤并拒绝公开 symlink/submodule；生成的 CSP 只进入部署产物，不以该 SHA 的源码文件归档。通用源码导出命令不带 `--revision` 时保留原工作区导出行为。生成规则包含在对应源码中。

## 切换自部署 Logto

1. 在自己的 HTTPS Logto endpoint 创建 SPA 与 Native public applications；SPA 回跳为前端 `/app/callback`、退出 `/app/`，Native 固定 `http://127.0.0.1:17897/callback`，授权码+PKCE、refresh rotation。配置 Account API `customData: Edit`、注册/邮件和默认用户 `connect` resource 权限；不在客户端放 Management API 凭据。
2. 用独立私有状态/namespace 配置 CyberGrid 对新 issuer/JWKS、SPA client、resource 及 Native 目录 client 的信任；其服务侧 Management API secret 只在 Vercel。当前 Cloud provisioner 的 `create-tenant` 是 Cloud 专用，不能拿 Cloud PAT 去初始化自部署；自部署通过其官方管理接口配置后，保存同样的公开 binding。
3. 一次性替换前端五项公开变量，按上节重新生成 CSP 并 prebuild/deploy；若前端域名变更，同时替换账号入口 `VITE_ACCOUNT_PORTAL_URL` 和 Logto/CyberGrid 精确 origins。桌面 `account-cloud.json` 完整覆盖 endpoint/issuer、SPA/Native IDs、resource、Grid URL、frontend origin。任何一侧只换 issuer 或只换 app ID 均不算完整迁移。
4. 用户在新 issuer 重新注册/登录、在桌面重新显式允许远程访问，形成新的设备登记和本机认证命名空间。不迁移 refresh/access tokens、端到端私钥或本机工作内容；旧设备索引不是新租户的授权。先独立验证注册/默认权限、Account API、发现、加密业务及退出关闭，再启用 `ANYWORK_ACCOUNT_READY`。不新增 AnyWork 云业务数据库。

以上仅实现配置可迁移性，不声称已搭建或验收自部署 Logto。

本轮 Development/自部署配置改动的离线作者检查：9项配置安全、7项前端CSP/真实临时目录CLI及Git prepare→assemble源码字节核对、18项协调部署恢复、28项发布器以及6项source-export检查通过；`scripts/check.sh` 已包含三组cloud检查。这里未运行真实云变更、未设置启用flag、未刷新任何OAuth grant；独立审查与合并后验证另行记录。
