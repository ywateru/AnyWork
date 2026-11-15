# 移动协调入口调查与 gateway 作者候选

2026-11-15。基线 `b110681ad451754b5e1be6b59833fee5771a3d4c`；契约 `772de4a` 在本 lane 接为 `8c430ba`。旧基线缺少任务文件，cherry-pick 的 modify/delete 冲突保留了来件完整任务内容，没有改写契约。实施依据为[恢复任务](../tasks/mobile-coordination-recovery.md)、[移动接口](../../mobile-native-contract.md)与[云配置](../../cloud-configuration.md)。

结论：采用手机已可达的官网 HTTPS origin，精确转发 Android Native 协调请求至现有协调 alias。当前仅完成配置候选和离线回归，**没有部署，不能宣称移动同步已恢复**。没有操作手机、模拟器或桌面宿主，没有改 DNS、代理、云环境、issuer、授权或存储。

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

使用缓存 Vercel CLI `50.28.0` 的既有 OAuth，只调用 GET API；移除 subprocess 的 `VERCEL_TOKEN`，未检查或输出凭据内容。未读取项目 env 或 Redis、用户、设备、业务记录。

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

这是配置边界与离线组装回归，不是自造 HTTP proxy 来代替 Vercel 的协议验收。未运行 Cargo、全站 E2E、APK 构建或新的公网重复探针。尚无本候选的 production build、上传或原生恢复通过结论。

## 获审后的精确预构建与可逆计划

当前停在源码审查门槛；协调者接受具体候选并明确部署后才执行：

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
