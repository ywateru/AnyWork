# 移动协调入口调查、候选与上线记录

2026-11-15。基线 `b110681ad451754b5e1be6b59833fee5771a3d4c`；契约 `772de4a` 在本 lane 接为 `8c430ba`。旧基线缺少任务文件，cherry-pick 的 modify/delete 冲突保留了来件完整任务内容，没有改写契约。实施依据为[恢复任务](../tasks/mobile-coordination-recovery.md)、[移动接口](../../mobile-native-contract.md)与[云配置](../../cloud-configuration.md)。

结论：采用手机已可达的官网 HTTPS origin，精确转发 Android Native 协调请求至现有协调 alias。初始候选完成配置与离线回归后，经协调者转达独立 PASS 并明确 GO，已按精确网站源码 `40e0548431bc4467f5046a8334edaee685ce15df` 上线；下文分别记录调查阶段、冻结计划与真实部署结果。作者受控 wire 通过，**实体手机同步恢复仍由独立 verifier 验证**。没有操作手机、模拟器或桌面宿主，没有改 DNS、代理、项目环境、issuer、授权配置或存储命名空间。

## 只读路线证据

Mac 的 HTTP/HTTPS/SOCKS 系统代理均启用，指向无 userinfo 的本机端口 `7890`，shell 同时存在对应代理变量。系统 DNS 给官网、auth、协调域均返回 `198.18.x.x`；不是可据以证明公网直连的解析。另通过 Google 公共 DoH 取得公网地址，并保持原 HTTPS hostname/SNI/证书验证作临时 `curl --resolve` 对照；这些 IP 未写入产品或持久网络配置。

| 请求路线                        | 官网 `/build.json`         | auth OIDC discovery        | 协调 `/healthz` 和 Native `auth/config` |
| ------------------------------- | -------------------------- | -------------------------- | --------------------------------------- |
| 现有 shell 代理                 | HTTP200，TLS 校验通过      | HTTP200，TLS 校验通过      | HTTP200，TLS 校验通过                   |
| 移除显式代理，系统 DNS          | HTTP200，连接 `198.18.x.x` | HTTP200，连接 `198.18.x.x` | HTTP200，连接 `198.18.x.x`              |
| 移除显式代理，公开 DNS 地址对照 | HTTP200，TLS 校验通过      | HTTP200，TLS 校验通过      | HTTP200，TLS 校验通过                   |

三个公网地址的 `route get` 实际均指向 `utun4`。因此最后两行仍受现有隧道影响，不能记为真正绕过隧道的公网直连成功。`curl --ipv6` 在系统解析下还返回 IPv4-mapped 地址，不能记为原生 IPv6 验收。没有关闭隧道、改系统 route 或反复重试来制造直连证据。

Native 公开配置的 issuer/resource/client 逐项匹配源码默认，协议为 `memory-v1`，epoch 为既有 `8bc766fc-e282-437c-9f4c-f36e7c14aa8a`。响应未含 products；本报告不伪称对不存在的字段完成了运行时 product 校验。产品身份继续由既有配置与 Native 注册校验约束。

父端转达的**最新独立手机基线**是：协调 IPv4 已完成 DNS/TCP，随后 TLS `SSL_ERROR_SYSCALL`（exit35）；IPv6 TCP 超时约8秒；官网与 auth 为 HTTP200/TLS 验证通过。这更新了旧报告中的 TCP 超时现象，支持传输路径差异，不能断言具体运营商/SNI内部原因。本 lane 未重跑该手机探针。API30 emulator 的既有 v41 对照由 verifier 独占；其成功也不能替代实体蜂窝路线验收。

## 生产项目、alias 与域名

以下为上线前的只读库存。使用缓存 Vercel CLI `50.28.0` 的既有 OAuth，只调用 GET API；移除 subprocess 的 `VERCEL_TOKEN`，未检查或输出凭据内容。未读取项目 env 或 Redis、用户、设备、业务记录。

| 对象                   | 实际只读结果                                                                                                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 官网项目               | `anywork` / `prj_LpMd1SfQU8GokkNUIJZk9wfJIELK`，READY production                                                                                                                            |
| 官网 alias             | `anywork.aixgg.com` → `dpl_6JyqfndLrs42zeDLCLgvydPqU1Tw`，与 v41 人工恢复 deployment 一致                                                                                                   |
| 官网 custom domain     | verified；无 redirect；CNAME 正常，`misconfigured=false`                                                                                                                                    |
| 协调项目               | `anywork-cybergrid-selfhost` / `prj_QEkGqB1XuC8AbtRGZaNSsMD1otvX`，与官网同一现有 team                                                                                                      |
| 协调 alias             | `anywork-cybergrid-selfhost.vercel.app` → READY `dpl_7TSSCHxqypSjpvNmawUyyUYdaw1J`，region `iad1`                                                                                           |
| 协调产物身份           | adapted source `c923cc232e74e4aff78fa3c82916ce9fb9a283b5`；upstream `2bd6729c6bbee90ed2926410caca883a0a100890`；artifact `aa53c54c1306560a12bdb7c35f2a71e91c31aff42474647f1cbe7fd3edb5cd10` |
| 协调域名库存           | 仅原 `anywork-cybergrid-selfhost.vercel.app`，未配置 custom domain                                                                                                                          |
| `aixgg.com`            | 外部 Cloudflare NS；Vercel 已验证官网子域，不等于本轮确认 DNS 写权限                                                                                                                        |
| 备选 `coord.aixgg.com` | 协调项目域名查询404，domain config 为 `configuredBy=null` / `misconfigured=true`                                                                                                            |

当前协调 deployment 比历史 Redis 切换记录中的 deployment 更新；本报告使用当前 alias/API 身份，没有把旧 ID 当作当前事实。没有解密环境变量核验存储；保持同一既有 deployment/alias，避免重部署协调服务或初始化新 namespace。

新增 custom-domain alias 在协议上可行，但还需要外部 DNS、证书及新域名手机可达性证明。已选官网入口无需这些改动，故本轮不实施备选域名。

## 已实施的精确配置

依据 Native lane 的 `mobile-coordination-native.md` 路径表（原提交 `1dbf398`，协调者已接为 `02e90f8`）及 Cargo.lock 固定 SDK `f2a3961536e5c69b13c7dbc661953d9243becbae` 核对：完整 SDK 为10个 pathname，Android 当前调用链需要其中9个。父端逐条确认的清单与本候选一致。Native transport 改动由另一路 `523fc9d`／主线 `207e890` 提供，不重复接入本 lane。`vercel.json` 仅增加以下逐条 literal-source rewrite，destination 是固定原协调 origin 加完全相同的 pathname，没有动态 host、路径前缀或 query 替换。

| 方法（由原服务校验） | 精确 pathname                         | 保留语义                               |
| -------------------- | ------------------------------------- | -------------------------------------- |
| GET                  | `/api/v1/auth/config`                 | 原 `appId` query                       |
| POST                 | `/api/v1/auth/registration/challenge` | admission 请求体                       |
| POST                 | `/api/v1/auth/registration/admit`     | admission 请求体及请求身份             |
| POST                 | `/api/v1/auth/exchange`               | Native 注册请求体                      |
| GET                  | `/api/v1/directory`                   | 可选 cursor，策略目录分支              |
| GET                  | `/api/v1/devices`                     | 兼容目录分支                           |
| PUT                  | `/api/v1/devices/self`                | publication、心跳及 revision           |
| GET / POST           | `/api/v1/signals`                     | after/wait query、15秒轮询和信令请求体 |
| DELETE               | `/api/v1/session`                     | 精确 session 撤销                      |

未暴露 Android 未调用的 `/api/v1/apps`、console/admin、旧 auth/login/register、宿主 `/connect` 或 `/remote/v1/ws`。没有 `/api/:path*` 或 `/api/v1/:path*`。这些是 pathname 规则，不是边缘 method ACL；其他方法到达同一路径时仍由原服务处理，不声称已在边缘限制方法。

每条精确路径都有 `Cache-Control: no-store`、`CDN-Cache-Control: no-store`、`Vercel-CDN-Cache-Control: no-store` 和 `x-vercel-enable-rewrite-caching: 0`。最后一项按 Vercel 官方文档显式关闭 external rewrite 默认缓存。没有注入 Authorization/cookie/epoch、改 CORS、重定向或处理 Native grant。预期原方法/query/body、认证及 epoch header、状态和响应体由平台转发，**真实 wire 透传及长轮询仍是部署后门槛**。

现有官网页面、`/app`/callback、`/source`、build/release metadata 路由和 buildCommand 保持；Web/desktop 配置及版本不改。Android transport root 的切换由 Native lane 独立负责，resource/audience 不由入口推导。

## 定向回归与限制

`python3 scripts/cloud/test_frontend.py`：**9/9 PASS**。既有 `scripts/check.sh` 已直接运行此文件，无需另加门禁脚本。

- 精确 Android 路径集合、固定同路径 HTTPS destination、无 query 替换/redirect，原页面/source rewrites 保留；任何宽泛或新增外部路径会失败。
- 九条缓存规则精确覆盖，无重复 header、无 auth/cookie/epoch 注入或 CORS 扩展。
- 实际 prepare CLI 在隔离临时目录运行，改变公开 CSP 配置时保留固定 gateway 与所有非 CSP header；不把 runtime grid override 当作任意代理上游。
- 既有不完整配置拒绝、CSP核对及精确 Git 源码归档/身份 fixture 继续通过。原“整份配置不含旧协调域”的断言已缩窄为检查 CSP，仍保留旧租户 origin 禁止项与完整 rewrite 保留断言。

额外在临时目录运行同一 gateway tests 的反例控制：旧 `b110681` 配置被两项契约断言拒绝；增加宽泛 `/api/v1/:path*` rewrite 被路径门禁拒绝；将 signals 改为 `public, max-age=60` 被缓存门禁拒绝。未改源码或删断言来执行反例。

这是配置边界与离线组装回归，不是自造 HTTP proxy 来代替 Vercel 的协议验收。上述离线阶段未运行 Cargo、全站 E2E、APK 构建或新的公网重复探针，当时尚无 production build、上传或原生恢复通过结论。后续获审部署与 wire 结果单列如下。

## 获审后的精确预构建与可逆计划

以下为获审前冻结的计划；实际执行依据是协调者随后对精确 `40e0548` 的明确 GO：

1. 固定协调者指定的获审网站源码 SHA，确认工作树干净、依赖仅链接 root；记录当前官网 deployment、协调 alias ID/产物身份及公开配置 fingerprint，拒绝未知漂移。
2. 分别绑定 **websiteSource** 和 **installerTag/installerSource**。若先部署 gateway 而安装包仍为 v41，`build.json` 与 `/source` 必须反映获审网站新 SHA，release metadata/四 ABI 链接仍来自不可变 v41（安装包 source `f669ef59bde7cb70bbe98fd59592b6f87e93698b`），不得把新网站冒写成旧源码或伪造新 Release。latest 前进时先向协调者报告，不能静默混用。
3. 既有 OAuth、CLI50.28.0、原五项公开配置及 portal、精确 `SOURCE_COMMIT` 执行 prepare/CSP 绑定与 prebuild，局部 `installCommand: true` 避免改共享依赖。不改项目 env/secrets 或协调配置。源码归档逐 Git blob 核验，包含本次路由配置与当前 release notes。
4. 验证最终 prebuilt config 的外部路由只有上述九条、目标未漂移、逐条缓存关闭且无 redirects；既有页面、CSP、app、source、release links 正确。清理 diagnostics、build元数据、env/凭据/symlink 后再上传，未知提交结果只读对账，不盲重发。
5. 上线匿名 GET config，比较 issuer/resource/client、coordination完整字段及相同 epoch；核实际 query、安全错误/状态/epoch/no-store。受控合成认证夹具验证 method/body/header 和长轮询后，交独立 verifier 使用正常 Native 流程验注册、目录与已授权工作区只读读取，不用真实 token 做 shell 探针或向 Agent 发提示。
6. 保留既有旧协调入口及原官网不可变 deployment。若转发语义不成立，由协调者授权恢复旧官网 alias，并恢复 Native transport root；不回退或重置协调数据，不扩大代理路径。
7. 公开读回独立验证获审网站 `build.json` 与 `/source`。`--verify-existing` 可核现有发行/下载页，但该分支未传 source 给 `verify_site`，不能单独证明新网站 SHA；不调用 `--site-only`、不改 canonical publisher 的私有 phase。清理本 lane env/output/link，保留小证据。

## 官方资料与证据

- [Vercel rewrites](https://vercel.com/docs/rewrites)：external origin reverse proxy、默认缓存及显式关闭方式；本轮只读200核对。
- [添加域名](https://vercel.com/docs/domains/working-with-domains/add-a-domain)：子域 CNAME 使用目标项目给出的值，外部 DNS 与证书配置；不复制另一个项目的 CNAME。
- Vercel GET API：`/v9/projects/:id`、项目 domains、`/v4/aliases/:host`、`/v13/deployments/:id`、`/v6/domains/:host/config`。保存字段经过白名单投影，无凭据/环境值。

本机 ignored `artifacts/mobile-coordination-route/` 保留 `provider-readonly.json`、`provider-additional.json`、`network-initial.json`、`network-public-resolved.json`、`public-dns.json` 与官方文档摘录。没有保存账号正文或登录材料，不提交这些运行产物。

## 精确 40e0548 生产部署与公开读回

2026-11-15，协调者明确转达精确 source 的 Native + route + 9 tests / negative controls 独立 PASS 后授权上线。本 lane 没有自行替代该独立审查结论。部署前重新核验产物 manifest、HEAD、原公开配置、既有项目、latest v41 和原 rollback deployment 无漂移，随后只提交了一次 `deploy --prebuilt --prod`。命令成功，Vercel GET API 确认 READY，没有未知结果或部署重试。

| 身份                       | 实际结果                                                                                                        |
| -------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 生产入口                   | <https://anywork.aixgg.com>                                                                                     |
| 新不可变 deployment        | <https://anywork-l1jfwi8f4-yywater68-1778s-projects.vercel.app>                                                 |
| 新 deployment ID           | `dpl_97y1sK6c1fMDqHzRAwZAjsHdiCg1`                                                                              |
| 精确网站源码               | `40e0548431bc4467f5046a8334edaee685ce15df`                                                                      |
| 网站版本                   | `0.1.41`                                                                                                        |
| 安装包发行 / 源码          | [v0.1.41](https://github.com/ywateru/AnyWork/releases/tag/v0.1.41) / `f669ef59bde7cb70bbe98fd59592b6f87e93698b` |
| 保留的 rollback deployment | `dpl_6JyqfndLrs42zeDLCLgvydPqU1Tw`，<https://anywork-r44p9fjfo-yywater68-1778s-projects.vercel.app>             |

仍为既有 `anywork` 项目、原 org 与 CLI50.28.0 OAuth。五项生产 VITE 值及 portal 与实际 v41 部署一致，CSP 逐字相等；没有更改 backend、env、DNS、issuer、resource、产品绑定、存储配置/命名空间或 repository vars。没有重发 Release、改 tag、覆盖安装包或改 canonical publisher 状态；历史 CI token 失败没有被描述为修复成功。

最终 Vercel 编译输出仅有九条精确外部 rewrite，逐条四项禁缓存 header，未新增宽泛路由。生产匿名 Native config 返回 200，与原协调入口 JSON 完全相等，既有 epoch 保留。公开响应为 `Cache-Control: no-store`、`x-vercel-cache: MISS`、`Age: 0`。`x-vercel-enable-rewrite-caching` 未回显；它作为平台内部开关存在于编译规则，不能要求客户端收到该内部头。CDN 专用缓存头也不作为必须回显的公开 header。

公开读回以下八项均200，逐字节等于已核验预构建：`/build.json`、`/release.json`、`/en/`、`/zh/`、`/app/`、`/app.js`、实际 app JS 模块、`/source`。英中文各四个正式 v41 ABI 链接，ARM64 第一，无 universal 或旧 alias。`build.json` 使用网站 SHA；release/download 继续使用不可变 v41，未混用两个 source 身份。

源码归档的1056个文件逐一匹配网站精确 Git blob，另有生成的 `SOURCE_MANIFEST.json`；公开 `/source` SHA256 为 `84f14133573f6ac88627d56a991ad0822d54d340f5b052f3b82edd1cb698a656`。上传目录447个文件，去除 diagnostics、敏感文件与 symlink，manifest 在 GO 前后保持一致。

## 受控 synthetic wire：9组通过

仅使用既有、明确标记为隔离自部署验收的 synthetic 账号，在临时独立 Chromium context 完成 Native client 的授权码 + PKCE。callback 由测试拦截，不启动17897 listener。没有操作用户浏览器登录态、真实用户 grant 或桌面宿主；没有把 token 放进 shell 参数、stdout、报告或磁盘文件。grant 仅在测试进程内存中，临时浏览器的 IdP cookie 边界不被描述为所有登录材料均在 RAM。

初期夹具曾因 callback 拦截与遗漏 OAuth resource 未走到注册，随后已按既有 Native 绑定修正。不存在的合法 appId 按服务契约返回404，而非夹具初写的400。另一轮夹具误要求新 `/directory` 恒为200，记录为失败并撤销该轮两条自有 session；没有用改 backend 或开启能力掩盖失败。最终按配置和锁定 SDK 的真实兼容分支重新验证，结果为：

| 检查                   | 实际结果                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------ |
| synthetic Native OAuth | issuer/resource/client/scope 绑定通过，无 auth limit                                                   |
| GET config query       | 正确 appId 200；未知产品404，与旧 alias 的错误 JSON 相等                                               |
| 方法与 JSON body       | GET exchange 405 `METHOD_NOT_ALLOWED`；POST malformed JSON 400                                         |
| POST exchange          | 两个新生成 registration key 成功，响应 epoch 与公开 config 相等                                        |
| PUT devices/self       | 两条 synthetic publication 200，返回对应 fixture device                                                |
| Authorization / epoch  | 有效200；缺失/无效401；过期 epoch409 `COORDINATOR_RESET`，错误 JSON 与旧 alias 相等                    |
| SDK 兼容目录           | config 无 `endpointPolicy`；新旧 `/directory?cursor=...` 均404 `NOT_FOUND` 且 JSON 相等；`/devices`200 |
| POST / GET signals     | POST201；合成 payload、connection、来源精确往返；after cursor 生效；非法 after/wait 各400              |
| 空队列 wait=15         | HTTP200，空 signals，端到端19556ms（包含网络开销），未提前返回或超时                                   |

成功与预期错误的 gateway 响应均核验 `no-store`、无 HIT、Age 不大于0。最终两条自有 synthetic session 经 DELETE200撤销，随后各读 devices 均401；前一轮目录夹具的两条 session 也已撤销。注册/信令只涉及本轮随机生成的 fixture 标识，没有读写真实业务文件或向 Agent 会话发提示。

当前既有后端 upstream `2bd6729c6bbee90ed2926410caca883a0a100890` 没有 versioned directory 路由，且公开 config 没有宣告 `endpointPolicy`。锁定 SDK 的 `devices()` 在该配置下调用 `/devices`，不会先调用 `/directory` 再靠404降级。本夹具核对了该分支对应的真实 HTTP 行为，未把模拟 HTTP 客户端声称为已运行手机 Native 客户端。既有后端也未宣告 registration admission，所以本次未执行 challenge/admit 成功分支，不宣称新 admission 或 versioned cursor 成功能力。九条精确路由的静态/编译边界继续保留，未为这些能力更改服务端。

部署 READY 后已先向协调者发送 deployment 身份、匿名 config200及缓存结果，供独立 verifier 并行手机探针。实体手机 Native 注册、设备目录与已授权工作区读取以 verifier 实际报告为准；本作者记录不提前宣布移动同步完整恢复。

本 lane 已清除 pulled env、Vercel build输出、site/web dist、生成源码归档及两个共享依赖 symlink；派生 CSP恢复为精确 Git内容，未动共享依赖或root target。小证据保存在 ignored `artifacts/mobile-coordination-gateway-40e0548-prebuild/`：`go-checks.json`、`immediate-production-result.json`、`prebuilt-verification.json`、`gateway-compiled-verification.json`、`production-readback.json`、`wire-result.json`及上传 manifest。最终提交仅更新本报告，不改变已部署网站源码。
