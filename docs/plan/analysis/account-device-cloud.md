# 账号、设备与云端部署调研记录

日期：2026-11-09（Asia/Shanghai）。本次重新调研 CyberGrid 更新，替换先前基于单进程内存版本的结论。未使用 Logto PAT、生产凭据或真实用户 token；未创建租户、会话、设备或部署。

目标设计和未解决约束见[评审方案](../../account-device-cloud-review.md)，交付拆分见[实施计划](../tasks/account-device-cloud.md)。用户后续已指定 CyberGrid Redis 使用 Upstash；账号与最少配置仍在 Logto，AnyWork 不建立自己的业务存储，不接触用户业务明文。提供管理凭据不等于已创建、更改或迁移任何云资源。

## 1. 固定基线与变化范围

| 项目 | 版本/提交 | 证据 |
| --- | --- | --- |
| AnyWork 本地 | `2fdfa02baa79a35f2974bac0a01151dbd4391bb6` | 本地源码读取；当前仅有本方案文档改动 |
| CyberGrid 上一轮 | `3a423b845e8a5168a81f60d3380a3b0f815ce526` | 单 Node owner / MemoryStore / flock |
| CyberGrid 本轮 main | `1e6532893fbfa29619807a3ee66b389e57695a22`，提交时间 2026-11-09 17:22:48 上海时间 | [固定源码](https://github.com/ywateru/CyberGrid/tree/1e6532893fbfa29619807a3ee66b389e57695a22) |
| 最新公开 Release | `v0.7.0`，早于本轮四个新提交 | [Release](https://github.com/ywateru/CyberGrid/releases/tag/v0.7.0)；不能把旧发布归档当作含新服务部署代码 |

[提交对比](https://github.com/ywateru/CyberGrid/compare/3a423b845e8a5168a81f60d3380a3b0f815ce526...1e6532893fbfa29619807a3ee66b389e57695a22)共四个提交：`9488018` 引入共享 Redis、`dff3c14` 增加 Functions/Docker 部署、`8dcece4` 修正许可溯源跨平台一致性、`1e65328` 记录生产验收。Rust/JS SDK 源代码不在本次差异清单中；主要变化为中央服务及部署，不能据此推断新增浏览器 P2P/E2EE。

## 2. 哪些结论需要改变

| 问题 | 本轮结论 |
| --- | --- |
| 能否部署 Vercel | **可以，已提供正式入口与配置**；不需要 AnyWork 再写 Vercel 适配、shared-v2 或指向旧主机的外部代理 |
| 是否仍依赖单进程 | 否。生产创建 RedisStore，移除 owner flock；MemoryStore 仅作测试夹具 |
| 是否无需 Logto 外存储 | **否。Redis 是强制依赖**，缺少/混用配置拒绝启动，无 RAM fallback |
| memory-v1 是否代表内存存储 | 否。保留现有线协议名称；状态实际在 Redis |
| 冷启动是否丢会话 | 正常 Function 冷启动和 Node 重启保留 Redis 会话与 epoch；namespace 重置才换代 |
| 是否新增浏览器远控 | 否。JS SDK 仍只读发现和获取业务端口 URL，不实现 map/WebRTC/iroh/业务加密传输 |
| 是否不接触业务数据 | 中央服务仍不接收/转发业务 payload；但存有用户关联、地址、信令和协调身份材料，不能称零数据 |
| 是否已通过 AnyWork 集成 | 否。上游服务验收、公开路由探测和 AnyWork 真实用户业务验收是不同证据 |

## 3. 源码核验

以下链接均固定本轮提交，不使用浮动 main。

| 来源 | 读取结果 | 对 AnyWork 的影响 |
| --- | --- | --- |
| [vercel.json](https://github.com/ywateru/CyberGrid/blob/1e6532893fbfa29619807a3ee66b389e57695a22/vercel.json) | 根目录构建，Node 22，`api/index.ts`，iad1，maxDuration 30 秒，所有路径内部 rewrite | 使用官方部署，不设置外部 owner/proxy |
| [api/index.ts](https://github.com/ywateru/CyberGrid/blob/1e6532893fbfa29619807a3ee66b389e57695a22/api/index.ts) / [function.ts](https://github.com/ywateru/CyberGrid/blob/1e6532893fbfa29619807a3ee66b389e57695a22/server/src/function.ts) | 导出同一服务 handler，不启动监听进程；使用 `vercel-shared` 入口配额 | Function 可复用连接，但授权权威仍在 Redis；入口限流为跨访问者共享桶 |
| [config.ts](https://github.com/ywateru/CyberGrid/blob/1e6532893fbfa29619807a3ee66b389e57695a22/server/src/config.ts) | 生产直接创建 RedisStore，固定 Logto 配置，无内存 fallback | Redis 不是可选缓存 |
| [redis.ts](https://github.com/ywateru/CyberGrid/blob/1e6532893fbfa29619807a3ee66b389e57695a22/server/src/redis.ts) | TCP/TLS Redis 或 HTTPS REST 二选一；非只读 EVAL；共享 seed/epoch；全 Store 异步 | 不需要 AnyWork 自建状态机；需配置及保护服务端 Redis 凭据 |
| [redis-script.ts](https://github.com/ywateru/CyberGrid/blob/1e6532893fbfa29619807a3ee66b389e57695a22/server/src/redis-script.ts) | Redis TIME，原子校验，会话/代次/revision/配额/信令；分实体 hash+expiry 索引 | 正常节点内原子性，不能宣称提供商分区/故障切换线性一致 |
| [Redis 协调契约](https://github.com/ywateru/CyberGrid/blob/1e6532893fbfa29619807a3ee66b389e57695a22/docs/redis-coordination.md) | 冷启动保留共享状态，namespace 清空需重注册；长轮询有共享 waiter lease | 验收以 Redis 故障/namespace 重置区分实例重启 |
| [部署说明](https://github.com/ywateru/CyberGrid/blob/1e6532893fbfa29619807a3ee66b389e57695a22/docs/deployment.md) | Vercel 根目录导入，REST/TLS 配置，环境 namespace 隔离；Docker Redis AOF/卷 | 不需要 PostgreSQL，但存在真正的持久协调存储 |
| [JS SDK](https://github.com/ywateru/CyberGrid/blob/1e6532893fbfa29619807a3ee66b389e57695a22/sdk-js/README.md) | 只读 console；业务 HTTP 权限和 CORS 由宿主负责 | “登录看到设备”可做；“安全打开 AnyWork 全部功能”仍需本机授权与客户端传输 |
| [Rust SDK](https://github.com/ywateru/CyberGrid/blob/1e6532893fbfa29619807a3ee66b389e57695a22/sdk-rust/README.md) | WebRTC/iroh/Cloudflare，内层 mTLS；路径依赖，平台/provider 边界未变 | 原生可复用，浏览器不能继承原生加密保证 |

### 3.1 Redis 实际保存什么、保留多久

| 数据 | 保留/失效方式 | 说明 |
| --- | --- | --- |
| 用户 subject、app、device、名称、端口、证书指纹、tunnel URL、iroh 候选等设备记录 | 有逻辑到期；设备在线租约 65 秒，心跳 20 秒；设备记录可保留到会话期 | 离线不等于已删除；包含连接相关个人元数据 |
| 协调 session hash 与注册幂等回执 | 会话有效期 24 小时 | 非 Logto refresh token，但仍是认证相关协调记录 |
| offer/answer/candidate 等信令 | 逻辑有效期 120 秒 | 无业务 payload，仍可能含地址等网络元数据 |
| epoch、注册回执派生 seed、初始化标记/序列等 | namespace 身份状态，无自动到期 | seed 属敏感协调密钥材料，不是设备端到端私钥 |
| 注册 fence | namespace 生命周期内保留 | 记录 userId/revision/requestId/content hash；不是全部短期 TTL |
| 限流/等待者/去重 | 各自期限，有界清理 | 超限明确错误，不静默驱逐身份记录 |

源码 `put()` 用 HSET 和 ZADD expiry 索引，`sweep()` 在后续原子请求内移除到期条目，并非为每条记录设置 Redis 原生过期。**逻辑失效不等于对应时刻已物理擦除**；namespace 静默后可能保留过期数据，AOF/备份还需单独确定留存/删除策略。用户要求若是 Logto 外完全不落任何数据，这个实现不符合，不能仅以“只有 TTL 元数据”描述。

### 3.2 容量和费用

硬上限：512 个会话、256 台设备、1024 条/2 MiB 信令、2048 个注册 fence、4096 项幂等、2048 个限流桶、128 个 waiter；同 namespace 固定容量，只能下调。永久 fence 会在长期安装增长时触顶，不得用随意删除安全记录解除配额。

信令等待中 Redis 查询从 500 ms 逐步到 2 秒，单个 HTTP 请求对应多次 EVAL，另有检查、清理和 waiter 操作。因此 HTTP 请求数不等于 Redis 命令数，不能用“每 15 秒一个请求”估算免费额度足够。需以目标在线设备数和实际流量计费测量。

## 4. 验收证据分级

### 4.1 上游记录与 CI

读取[独立评审记录 redis-003](https://github.com/ywateru/CyberGrid/blob/1e6532893fbfa29619807a3ee66b389e57695a22/docs/plan/reviews/redis-003.md)：报告真实 Redis、多 Store/handler 的 21 项独立断言，覆盖回执丢失、旧 revision、epoch 重置、限流、等待租约和健康失败关闭；报告 Functions 预览、生产域名有限后验及 Docker CI。

本轮通过 GitHub API 独立查询[服务器 CI 42589602334](https://github.com/ywateru/CyberGrid/actions/runs/42589602334)：`head_sha=8dcece43e28d3d401ae1d10b25962aefc8c91f1e`、`completed/success`。82/82 测试和 Docker/AOF 场景的详细数字来自上游报告，未在本轮重新执行。最新 `1e65328` 为验收文档提交，运行源码对应 `8dcece4`；不能把旧 v0.7.0 Release 的 SDK 归档称作新服务发布包。

### 4.2 本轮实际公开路由探测

对 SDK README 中公开默认地址 [cybergrid.aixgg.com](https://cybergrid.aixgg.com) 仅执行以下四个无凭据 GET，无平台 bypass、无用户登录或状态写入：

| 路径 | 本轮结果 |
| --- | --- |
| `/healthz` | 200，精确 `ok` 换行 |
| `/api/v1/console/auth/config` | 200，Logto provider、HTTPS issuer、公开 SPA/resource 存在、协议 `memory-v1` |
| `/api/v1/admin/overview` | 401，固定 `INVALID_ADMIN_KEY` |
| 随机不存在路径 | 404 |

四者均返回 `Cache-Control: no-store` 和 Vercel 响应标识。Console 配置没有 Native 专用 loginFlow 字段，不能从这个响应声称已验证 Native 登录。该探测证明公开入口和有限就绪/鉴权拒绝行为，不证明真实 OAuth、跨账号隔离、生产多实例故障或 AnyWork 业务数据链路已通过；也没有独立证明线上每个文件与固定源码逐字节相等。

## 5. 仍有效的 AnyWork 与 Logto 结论

AnyWork 本机 API 目前使用实例固定 bearer；终端另做首帧鉴权；前端 Connection 保存 URL/token。账号接入需由本机验证身份，不可只改登录页面。已有 trycloudflare 的事件 JSON poll 可复用，但明文 HTTP/WSS 业务入口不自动获得 SDK 内层 mTLS。

Logto 官方资料已在上一轮实际读取：

- [Account API](https://docs.logto.io/end-user-flows/account-settings/by-account-api)：可由前端直接读取/修改当前用户非敏感配置；需启用 Account API、自定义数据权限和 `custom_data` scope；opaque Account token 与 Grid resource JWT 分开获取。
- [Update profile](https://openapi.logto.io/operation/operation-updateprofile)：`PATCH /api/my-account` 的 `customData` 整体替换，未确认 CAS/事务能力。
- [用户数据](https://docs.logto.io/user-management/user-data)：自定义数据不放秘密或业务正文；当前用户可编辑，不能作为管理员授权/防回滚真源。

这些能力未因 CyberGrid 本次更新而改变。本轮未重复读取全部 Logto/Cloudflare/Vercel 平台文档，CyberGrid 的部署变量和行为优先根据本轮固定源码确认。

## 6. 对评审方案的更新

1. 删除“CyberGrid 尚无正式 Vercel 入口”“必须自己开发 shared-v2”的结论，改为配置/验收上游现有服务。
2. 保留不新增 AnyWork 云端业务数据层的要求；用户后续已将 CyberGrid 内部 Redis 提供方确定为 Upstash，仅用于协调，不再把提供方选择列为未决问题。
3. Logto 外仍存在真实的 Upstash 协调存储，不能改名缓存后声称完全零存储；元数据、长期 fence/seed 和删除/备份边界需准确披露。
4. 浏览器 E2EE、本机授权、Logto 配置并发、私钥留本机、撤销真实生效窗口仍是集成门槛。
5. 后续用固定新提交部署服务；SDK 按官方匹配版本/归档锁定，分别记录来源，不混用主分支服务和历史部署说明。

## 7. Upstash 配置补充

用户已指定本机外部 API key 文件。文件存在，当前为仅含 key 的单行文本，未在工具输出或仓库复制其内容；文件权限已收紧为 `0600`。

本轮实际读取 [Upstash Authentication](https://upstash.com/docs/devops/developer-api/authentication) 和 [List Databases](https://upstash.com/docs/devops/developer-api/redis/list_databases)：Developer API 使用账号邮箱作为 Basic username、API key 作为 password；数据库列表接口为 `GET https://api.upstash.com/v2/redis/databases`。列表响应可能包含数据库 password 和 REST token，后续调用必须在内存中过滤，不能直接打印完整响应。

用户随后补齐账户邮箱。本轮两次执行只读 `GET /v2/redis/databases`，均通过认证返回 HTTP 200；确认响应类型为数据库数组且内容为空 `[]`，不是解析失败或错误对象。密钥未输出、未落盘，认证邮箱未复制进仓库。该结果只说明这组凭据当前可见范围没有数据库，不能推断其他账户/团队没有现有 CyberGrid 资源。尚未取得数据库运行凭据，也无法核验地区、方案、TLS、备份或配额；没有创建/升级/更改数据库或读取 Redis 键值。

Developer API key 不等于 CyberGrid 所需的数据库 REST token。后续查到选定数据库后，根据上游支持选择 TLS TCP 或可写 REST 凭据，仅注入服务端；不向浏览器发管理 key，不探测其他应用的键值，不创建/升级/重置数据库。

## 8. 实施启动后的上游增量

实施阶段重新查询 main 为 `2bd6729c6bbee90ed2926410caca883a0a100890`。与调研基线 `1e65328` 的 GitHub compare 显示两项新增提交：`45f8840` 显式支持 Vercel KV 传输配置、`2bd6729` 更新 Marketplace 部署文档。运行代码改动在 `server/src/redis.ts`；本次差异没有修改 Rust/JS SDK，也不提供浏览器业务加密。

用户指定继续使用 Upstash，不因新的 KV 配置自动更换存储或增加第二套协调状态。最终部署 pin 与实际资源验证另记到云配置和集成验收。

用户已授权从方案转入实施、完整测试和更新。此前“未创建/未部署”的描述是调研截止时的事实，后续状态以任务及验收记录为准。

独立审查期间再次只读查询 upstream main 为 `50a12e0d7b58e3f8dd84b9d9a97fe650faaac691`。[与实施 pin 的官方比较](https://github.com/ywateru/CyberGrid/compare/2bd6729c6bbee90ed2926410caca883a0a100890...50a12e0d7b58e3f8dd84b9d9a97fe650faaac691)只新增 `276eb41`（自有 Upstash 测试库配置说明）与 `50a12e0`（上游 KV 验收记录）；变更仅在文档、计划和静态说明页，没有改动运行时 `server/src`、SDK 或 LICENSE。继续固定已部署/测试的 `2bd6729`，不因上游文档验收通过而扩大 AnyWork 验收范围。新说明明确区分“同库切换连接方式保持 epoch”和“主动换新库产生新 epoch”；本任务保留既有专用数据库与 namespace，不进行此类重置。
