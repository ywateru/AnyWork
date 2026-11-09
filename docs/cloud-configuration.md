> 最新用户修订：本轮现在切换到自部署Logto default业务租户（公开endpoint https://auth.x.aixgg.com，Console https://logto.x.aixgg.com/），新应用与信任配置正在核验。下方Cloud Development配置保留为此前证据，不能作为最终部署默认值；完整迁移状态见[当前任务](plan/tasks/account-client-entry.md)。不迁移秘密或用户业务数据。

# AnyWork 云服务配置与验收

日期：2026-11-09（Asia/Shanghai）。本阶段按最新用户要求使用自部署 Logto default 业务租户；此前 Cloud Development 资源保留，不需要购买 Cloud 生产套餐。本页记录实际资源、公开客户端配置与交付限制。云端只有 Logto 账号/配置、CyberGrid 协调服务及其 Upstash Redis；没有 AnyWork 业务数据库或业务代理。业务内容与端到端私钥留用户设备。账号与本机安全流程以[方案](account-device-cloud-review.md)为准。

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

这些字段是客户端必需的公开标识，不是管理秘密。本阶段客户端与 Vercel 前端使用本页末尾的自部署配置；下表为历史 Cloud 配置，不能混入当前自部署绑定。

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
2. 用独立私有状态/namespace 配置 CyberGrid 对新 issuer/JWKS、SPA client、resource 的信任；本轮使用显式公开应用目录固定 SPA/Native，不在协调运行期配置任何 Management API secret。当前 Cloud provisioner 的 `create-tenant` 是 Cloud 专用，不能拿 Cloud PAT 去初始化自部署；自部署通过其官方管理接口配置后，保存同样的公开 binding。
3. 一次性替换前端五项公开变量，按上节重新生成 CSP 并 prebuild/deploy；若前端域名变更，同时替换账号入口 `VITE_ACCOUNT_PORTAL_URL` 和 Logto/CyberGrid 精确 origins。桌面 `account-cloud.json` 完整覆盖 endpoint/issuer、SPA/Native IDs、resource、Grid URL、frontend origin。任何一侧只换 issuer 或只换 app ID 均不算完整迁移。
4. 用户在新 issuer 重新注册/登录、在桌面重新显式允许远程访问，形成新的设备登记和本机认证命名空间。不迁移 refresh/access tokens、端到端私钥或本机工作内容；旧设备索引不是新租户的授权。先独立验证注册/默认权限、Account API、发现、加密业务及退出关闭，再启用 `ANYWORK_ACCOUNT_READY`。不新增 AnyWork 云业务数据库。

本轮已实际配置自部署 AnyWork 对象；完整 Native/Web/协调真实链路须另行验收。

本轮 Development/自部署配置改动的离线作者检查：9项配置安全、7项前端CSP/真实临时目录CLI及Git prepare→assemble源码字节核对、18项协调部署恢复、28项发布器以及6项source-export检查通过；`scripts/check.sh` 已包含三组cloud检查。这里未运行真实云变更、未设置启用flag、未刷新任何OAuth grant；独立审查与合并后验证另行记录。

## 自部署 default 租户切换（当前实施契约）

用户随后授权以 `https://auth.x.aixgg.com` 的自部署 default 业务租户代替本轮 Cloud Development 配置。issuer 为 `https://auth.x.aixgg.com/oidc`，管理 API 地址为 `https://auth.x.aixgg.com/api`，管理 resource **单独固定**为 `https://default.logto.app/api`；禁止从自定义域名推导该 audience。管理凭据与恢复状态只存仓库外0600文件，不进入公开客户端配置、日志或上传产物。Cloud Development 资源保留。

配置仅创建/更新 AnyWork 拥有的 SPA、Native、独立远控 resource/connect 和默认用户 role，并启用 Account API 所需 customData Edit、name/avatar/email ReadOnly；不修改用户提供的管理 M2M、不整体覆盖共享 sign-in experience。当前租户只有用户名与密码注册/登录且没有邮件连接器，因此保持现状，不能宣称邮箱验证或邮件投递可用。

协调服务使用独立项目 `anywork-cybergrid-selfhost` 与专用 Upstash 内独立 namespace `anywork:selfhost:v1`，不得重置 Development 数据。固定上游目录硬编码 `origin/api` 与 `all`，而此自部署系统 Management resource 仅提供 `all`；本轮采用显式公开应用目录适配，运行期仅接收已核验的 SPA/Native ID/type，完全不配置 Management M2M ID/secret，也不伪造只读管理 scope。固定 issuer/audience/client/connect 校验保持不变。前端部署仍等待最终精确源码与真实链路审查。

### 自部署配置与协调发布恢复

`configure-selfhost.py` 使用独立仓库外状态的显式 `mode=self-hosted`、tokenEndpoint、managementApi 和 managementResource。每个新对象先保存创建 intent，再提交，已有 ID/名称/类型必须与库存一致；响应未知时先按库存恢复，禁止盲目重建。它不调用 Cloud 租户/订阅 API，不写全局 sign-in experience、连接器或用户提供的 M2M。

作者真实配置读回：Account API enabled，customData Edit 与 name/avatar/email ReadOnly；共享 sign-in experience 与配置前对象完全相等。独立无邮箱 synthetic 用户由管理 API 新建后，直接 GET roles 已自动拥有唯一 AnyWork 默认角色，从未显式分配用户角色；旧的首个含连字符用户名被 guard 拒绝，库存确认为0后才改下划线用户名。该证据证明默认角色自动赋予，不代替用户资源 JWT 或真实界面登录验收。测试登录信息与公开七字段分开存仓库外0600文件，GUI不需要读取 bootstrap 状态。

协调适配以固定 CyberGrid `2bd6729c6bbee90ed2926410caca883a0a100890` 加可重现 patch/provenance 发布；不推送上游仓库、不改上游许可。`deploy-cybergrid.py` 的自部署路径必须提供受检 prebuilt staging、完整40位 adapted source SHA、固定 base+patch 摘要的 provenance，以及 Vercel CLI50.28.0。staging 仅包含 `.vercel/project.json` 和受检 output；禁止符号链接、私有构建元数据、`.env`、已知秘密字节；builds.json 仅留 production target。运行期 encrypted env 只含公开信任配置和 Upstash 凭据，显式 `LOGTO_APPLICATION_DIRECTORY_MODE=pinned`/`LOGTO_APPLICATIONS_JSON`，不含 bootstrap M2M。

提交前原子保存 operation、源码/patch/output/config 身份与 submitting 阶段；CLI返回未知时按 operation 及 metadata 对账，不重新上传。实际部署必须同时核对 project、production target、adapted source、fixed upstream、patch 与 artifact/config 摘要。该路径默认不替代既有 Cloud Git 发布；前端发布另有最终门禁。

| Current public field | Self-hosted value |
| --- | --- |
| `endpoint` | `https://auth.x.aixgg.com` |
| `issuer` | `https://auth.x.aixgg.com/oidc` |
| `nativeClientId` | `x7lzj58abb1sdp16lkd34` |
| `spaClientId` | `5ere2kbu9mugfu3xd8e90` |
| `resource` | `https://anywork-cybergrid-selfhost.vercel.app/api` |
| `cybergridUrl` | `https://anywork-cybergrid-selfhost.vercel.app` |
| `frontendOrigin` | `https://anywork-tau.vercel.app` |
| `accountPortalUrl` | `https://anywork-tau.vercel.app/app/` |

作者离线检查：6项自部署配置契约、6项prebuilt隐私/身份/CLI/未知结果契约、20项原发布恢复与新增pinned环境检查、9项配置安全、7项前端配置/CSP、6项源码导出、28项发布器检查，共82项通过；候选变更文件对已知真实bootstrap/管理令牌/synthetic登录秘密字节扫描命中0。真实自部署配置已创建并重放读回，不代表协调服务已部署，也未发布前端或修改运行中的用户服务。

### 自包含 Vercel 函数产物

Vercel Node builder 会在函数 `.vc-config.json` 的 `filePathMap` 中保留相对项目根目录的外部文件引用。CLI50.28.0 在上传前从项目根读取这些引用；仅复制 `.vercel/output` 会遗漏它们。本轮实际诊断在本地 hash 阶段因 `server/notices/manifest.json` 缺失退出，尚未进入 deployment upload；旧 intent 仍保留，库存与独立复核另作恢复证据。

`materialize-prebuilt.py` 在上传前把映射逐项物化到函数内：来源必须是精确 adapted SHA 的已跟踪普通 Git blob，工作区字节须与 blob 相等；相对来源和目标路径均禁止绝对路径、穿越、符号链接、私有文件名或冲突。先验证全部计划及已知秘密字节，再复制精确字节与模式并移除 `filePathMap`，不上传整个 checkout。仓库外收据记录源码、Git blob ID、目标路径和 SHA256，以及配置变换前后摘要。notice/license/public 资源继续以相同函数内路径提供。`prebuilt_identity` 拒绝残留 `filePathMap`，产物变化必须形成新 outputHash；原两次 intent 不被覆盖或自动重试。

2026-11-10 00:44（Asia/Shanghai）协调部署已完成：专用 alias `https://anywork-cybergrid-selfhost.vercel.app` 指向同一 READY production deployment；实际 `/api/v1/auth/config?appId=<Native ID>` 与 `/api/v1/console/auth/config` 返回新 issuer 的完整绑定，官方与两项 loopback CORS、未授权 origin 拒绝、真实 Upstash 独立 namespace epoch/initialized 核对通过。运行期10项环境变量全部 encrypted，Management 变量0；旧 Cloud Development 服务与数据保留。精确源码、产物、恢复操作和限定范围见 [上线证据](plan/reviews/account-selfhost-grid-live.md)。该基础设施验收不代替 Native/Web 的用户 JWT、设备登记及加密业务链，也未发布 AnyWork 主页或更新运行中的用户服务。
