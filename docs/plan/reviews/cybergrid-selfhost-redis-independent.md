# 自部署 TLS Redis 切换：独立审查

日期：2026-11-11。状态：PASS（精确源码/候选与上线后独立只读验收）。执行前证据及其边界保留如下；实际切换由根代理另行签发 GO 执行，本审查未执行外部变更。

审查工作树 `codex/cybergrid-redis-review`，基线 `6cb1bc61da63fe3408a4b88f45a3605b6e99d518`。按 `cybergrid-selfhost-redis` 任务执行独立 verify；仅写此报告，不修改产品代码、main、现有应用/服务或真实 Logto 账号。本次只读探测使用本任务明确授权的 Redis 用户；没有触碰旧 Upstash、扫描其他 namespace、读取业务正文或执行初始化/写入。

## 传输与独立只读证据

核对实际既有 portable function artifact 中的 `redis` / `@redis/client` 6.3.1，而非用较新 CyberGrid 仓库推断部署行为。部署源是 upstream `2bd6729c6bbee90ed2926410caca883a0a100890` 加公开应用目录补丁的 adapted `c923cc232e74e4aff78fa3c82916ce9fb9a283b5`；既有补丁不改变 Redis 传输。

- `server/src/redis.ts` 的 TCP 传输调用 `createClient({url, socket:{connectTimeout:4000,reconnectStrategy:false}, disableOfflineQueue:true})`。`rediss:` 由实际客户端解析为 `tls:true` 和域名 host，TLS socket 使用 Node `tls.connect`。没有关闭证书验证、自定义信任绕过或明文 fallback。
- 该版本不会仅因 URL host 自动设置 SNI `servername`。独立插桩仅记录布尔选项，确认实际连接没有显式 SNI、没有 `rejectUnauthorized:false`、没有自定义 identity check。不能将“rediss URL”说成“客户端明确发送了 SNI”。这是行为边界，不代表缺少域名验证。
- 独立 Python 默认信任链 + `server_hostname=redis.x.aixgg.com` 验证成功：TLS1.2，受信任 Let's Encrypt 签发，证书有效期至 2027-02-09。仅记录校验结果/签发者类别/到期时间，不记录证书或凭据正文。
- 独立 Node22.16.0 使用上述实际部署 package 和生产相同默认选项：TLS1.3、`authorized=true`、AUTH/PING 成功；读取专用 `{anywork:selfhost:v1}:meta` 类型为 none，initialized 标记不存在。不调用 RedisStore.ready/EVAL/init，不写入、不获取 seed，不做全局 INFO/KEYS/SCAN。
- 两项独立反向控制使用同一实际客户端、同一域名端口，不发送 AUTH：错误 servername 被 `ERR_TLS_CERT_ALTNAME_INVALID` 拒绝；空 CA 集合被 `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` 拒绝。没有把普通网络断开或任意 connect 异常计为证书拒绝。

因此该端点在默认实际 Node 传输下兼容严格受信任链和域名验证；没有证据要求修改运行时 Redis socket 接口。实际缺省不发送 SNI，但当前端点提供了正确证书；不能通过 IP、关闭校验或明文来“修复”。目标部署环境仍须排除 `NODE_TLS_REJECT_UNAUTHORIZED=0` 等不安全覆盖。

## 存储代次与保全边界

新的 Redis 专用协调存储允许初始化新 epoch，不从 Upstash 复制/清空数据。上述少量 metadata 不存在仅证明这些确切键，不等同已枚举整个 namespace。Pinned Lua init 会检查专用索引类型、initialized 标记和已有记录，异常时拒绝，不应通过自动 reset 绕过。

RedisStore.ready 生成并原子保留 namespace 的 epoch/seed/容量约束；不得从 seed-bearing meta.state 输出秘密。Rust SDK `auth_config()` 每次重新取得配置，在比较 OAuth 固定绑定时仅允许 coordination 代次变化；已认证响应的 epoch 改变会失效旧会话/旧流，现有 AuthProvider 可取得新授权并重新注册。网页协调客户端对 epoch 变化/INVALID_SESSION/COORDINATOR_RESET 执行受控重新认证。这里是源码机制核对，不是已完成真实用户恢复实验；需要显式重试/重新登录时应明确提示，不借 M2M 伪造用户。

Logto 账号/设备目录、客户端内存凭据策略、Noise 端到端授权与本地服务不应改动。回退旧 immutable deployment 可恢复原配置，但旧 Upstash 月额度已耗尽，所以不能承诺回退一定恢复可用性。

## 精确源码与操作候选：PASS

作者精确提交 `0acf3cba5ca6644e26a246f03ccc9e8260f738e9`；审查树隔离 cherry-pick 为 `72fd9c8`，没有修改产品代码。具体 operation `baa4abc0-b698-4e81-98be-f443812549fa` 当前 prepared；独立调用其纯 binding 核查成功，未调用 apply/ready/环境写入/CLI submit。

| 证据 | 固定身份 |
| --- | --- |
| candidate SHA256 | `ede4580af6a913a0cec3072ee7f97d3065d8368a8885286f178bdd968df60ca5` |
| cutover helper SHA256 | `258ecfb43628af64d74594b8e46da91e5bd741c39a201c91365905c924b21e23` |
| ready helper SHA256 | `3fb886421de7634c7434aacaf33b855cce6763563dc5da74659d8c2bee8c50a3` |
| readonly probe SHA256 | `76331d9062c5d2617fdd0b4347975389d834ac842a2ada8040613564a8df3740` |
| unchanged CyberGrid artifact SHA256 | `aa53c54c1306560a12bdb7c35f2a71e91c31aff42474647f1cbe7fd3edb5cd10` |
| desired configuration SHA256 | `5eeaeee0f93cad5e869deae2c150c56ff732b9378f2d1662887573bfffb67189` |
| Vercel50.28.0 dependency tree SHA256 | `e0afbe119cf589b6f75c2f13b54b21f9452ba0fc6688e8a883f7ac6be67f20a2` |
| original immutable deployment | `dpl_29SDBhEjHTkMmXw13KmS1aXNpFpb` |

独立重新计算 CLI 完整依赖树及 link closure：34个 symlink 全部解析在该树内部，0个外部目标；bytes/linktext 均进入绑定。旧/新环境和候选秘密仅存在仓库外0700目录下0600私有材料；未进入源码、上传产物、argv 或本报告。检查新增仓库文件与凭据扫描，未发现真实 Redis 密码或完整带凭据 URL。

环境清单严格固定：原8项 OAuth/public origin/namespace/应用目录设置完全保留，新增 `REDIS_URL`（rediss 域名、6379、DB0、指定用户）与 `CYBERGRID_REDIS_TRANSPORT=tcp`，删除旧 Upstash REST URL/token 两项。不接受额外生产变量、未知范围或不匹配环境；旧不可变 deployment 和原环境快照供独立 GO 回退，两个 Redis 均不被回退清空。

操作在外部写入之前验证 fresh GO（action、operation、candidate、helper、到期上限600秒）及 exact alias/environment baseline，使用非阻塞排他锁。先 durable 记录 namespace-initializing，再运行实际既有 artifact 的 RedisStore.ready；内层10秒、外层20秒有界，finally close，失败不进行 Vercel 变更。成功结果仅 epoch/limits/ready，不包含 seed。随后环境写入/readback、记录 submitting、一次 CLI submit；未知结果只读 observe，不重放提交。rollback 要求另一个 fresh GO，并拒绝无关 alias/环境漂移。

有意保守的恢复限制：inspect 也先核对原 artifact/helper/tool 绑定；如果未知结果发生后材料被改动，会停止，需恢复原受检材料或人工只读核查 provider，而非依据已变化材料自动标 ready。当前固定候选不存在该漂移，属于可接受的 fail-closed 边界。

## 独立验证与结果

- `python3 -m unittest discover -s scripts/cloud -p 'test_redis_cutover.py'`：14 PASS；覆盖 exact binding/GO、未知结果不重放、环境漂移/回退、初始化先于云写及失败阻止云写。
- `python3 -m unittest discover -s scripts/cloud -p 'test_redis_ready.py'`：1 PASS（含合成成功与拒绝子流程）；验证固定输出/0600、无原始异常或秘密输出、finally close、拒绝不生成 proof。
- `node --test scripts/cloud/test-redis-tls-probe.mjs`：5 PASS；覆盖固定域名/URL编码、只读指令白名单、具体证书错误分类、普通网络错误不能冒充证书拒绝、错误主机名被接受即失败、namespace 类型异常 cleanup。
- 额外独立合成 stalled-PING：5秒 PROBE_DEADLINE，6秒内退出且 client.destroy 已执行，无网络请求。
- `scripts/check.sh` 已注册 `test_redis_*.py` discover（包含两个新增 Python 文件）及 Node probe suite；无手工专用未接入的主要回归。

作者更广范围71项 Python +5项 Node 通过；上述为独立执行的针对性结果，两者不混记。日志分别为 `/tmp/anywork-redis-independent-python.log`、`/tmp/anywork-redis-independent-ready.log`、`/tmp/anywork-redis-independent-node.log`。

未发现阻塞问题。精确 source/candidate 可交根代理按已授权范围发 fresh internal GO；没有新增付费授权要求。AUTH/PING/TYPE 成功尚不证明协调 Lua/全部写命令兼容，实际 ready 是必要执行门槛。部署后仍需独立核对新 READY/alias 身份、公开 health/Native+SPA OAuth 绑定/CORS/同一新 epoch 和专用 metadata；这些不是本次执行前 PASS 已完成的证据。没有进行真实用户恢复、账号登录、远程开启或本机 runtime 变更。

## 上线后独立只读验收：PASS

实测时间：2026-11-11 13:30–13:33（Asia/Shanghai，UTC05:30–05:33）；最后一次 provider 证据完成于13:33:27。根代理已执行被审候选，本审查仅作 GET/OPTIONS、Vercel 只读 API 和新 Redis 专用 metadata 只读检查，未调用 apply/rollback、部署或 namespace 初始化，未修改 main/产品源码/本机运行应用或账号。

独立重新验证 operation/material binding 后，确认 operation 为 ready，candidate 仍为前文 `ede458…ca5`。Vercel 直接 API 证据：

- 新 deployment `dpl_7Xvjo9kSsDNoWycj57W4zLyP4Xz4` 为 READY，project 仍为 `prj_QEkGqB1XuC8AbtRGZaNSsMD1otvX`；正式 alias `anywork-cybergrid-selfhost.vercel.app` 指向该 ID。
- deployment metadata 中 operation `baa4abc0-b698-4e81-98be-f443812549fa`、adapted source `c923cc232e74e4aff78fa3c82916ce9fb9a283b5`、upstream/patch、artifact `aa53c54c…cd10`、configuration `5eeaeee0…7189` 全部与精确候选一致。
- 生产环境逐项只读 readback 与候选 desiredEnvironment 完全一致，原8项设置保持，TCP/rediss 新变量已生效，旧 Upstash REST 两项变量已删除。只比较内存值/布尔结果，不输出秘密或带凭据 URL。

| 正式 alias 实测 | 结果 |
| --- | --- |
| GET `/healthz` | HTTP200（纯文本响应） |
| GET `/api/v1/auth/config?appId=x7lzj58abb1sdp16lkd34` | HTTP200；Native clientId、固定 issuer/resource 与候选一致 |
| GET `/api/v1/console/auth/config`，Origin `https://anywork-tau.vercel.app` | HTTP200；SPA clientId `5ere2kbu9mugfu3xd8e90`、固定 issuer/resource 与候选一致；ACAO 精确为该来源 |
| 可信 Origin 的 console/devices OPTIONS（GET + authorization,x-cybergrid-epoch） | HTTP204，正确 ACAO |
| 不可信 `https://untrusted.invalid` 的 config GET 与 devices OPTIONS | 均 HTTP403，无 ACAO |
| console/devices 无 Authorization 与合成无效 Bearer | 均 HTTP401 / INVALID_SESSION，没有返回设备目录 |

两份配置都保持 issuer `https://auth.x.aixgg.com/oidc` 和 resource `https://anywork-cybergrid-selfhost.vercel.app/api`；body coordination.epoch 与 `X-CyberGrid-Epoch` 都等于新 ready epoch `8bc766fc-e282-437c-9f4c-f36e7c14aa8a`。这里只证明公开配置/会话拒绝边界，不把合成无效 Bearer 当作真实 Logto 授权验证。

实际新 Redis 用同一个 deployed Node redis6.3.1 package、原 strict rediss/domain 配置独立 AUTH/PING 成功。仅4个专用 metadata TYPE：meta=hash、initialized=string、revision=string、sequence=none（尚无信号序列时允许不存在），GET initialized='1'。先审查实际 `redis-script.js`：meta hash 的 state 字段是带 epoch/seed/startedAt/limits 的 JSON。为避免 seed 离开 Redis，独立执行 `EVAL_RO`，脚本只 HGET 此确切字段，在 Redis 内 cjson.decode 后只返回 epoch 字符串；没有使用生产 op/meta（该脚本包含其他写操作），没有返回 meta.state 全文或 seed。返回 epoch 与公开配置/namespace-ready 一致；客户端 finally destroy 且有总时间界限。

脱敏独立证据位于 `/tmp/anywork-redis-independent-provider.json`、`/tmp/anywork-redis-independent-live.json`、`/tmp/anywork-redis-independent-metadata.json`（0600）。第一次公开批量因 health 纯文本被误按 JSON 解析而退出，修正验证器后成功；另一次 provider 直连在 TLS handshake 本机超时，随后完整只读核验成功。未把这些本地探测错误误记为服务503或重放外部变更。

结论：正式 alias 已按精确受检配置使用新的 TLS Redis，公开配置与专用存储的新 epoch 一致，健康/CORS/未授权拒绝检查通过。旧 Upstash 未被扫描、复制、reset 或改套餐。未读 Redis 用户会话/设备/业务记录、未读取 Logto 真实用户、未做真实登录或远程启用，未验证已有用户的实际业务恢复；已有 SDK epoch 失效/重新注册是前文源码机制证据，不能改称完成真实账号端到端实验。本机进程和用户数据未因本次审查变更。
