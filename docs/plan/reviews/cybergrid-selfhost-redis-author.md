# 自部署 TLS Redis：作者准备证据

日期：2026-11-11。任务 `cybergrid-selfhost-redis`，AnyWork 基线 `6cb1bc6`。本提交准备切换工具及私有候选，**未执行 namespace 初始化、Vercel 环境写入、部署或 alias 变更**。

## 已验证的连接与产物

新端点使用 `redis.x.aixgg.com:6379`，专用 ACL 用户；凭据只在仓库外0600输入及候选文件中。只接受 `rediss://`、默认信任链和域名验证，不使用 IP、不关闭校验、不退回明文。Python 默认 TLS 验证实际确认 Let's Encrypt 证书、TLS1.2、AUTH/PING；只对 `{anywork:selfhost:v1}:meta/initialized/revision/sequence` 做 TYPE，全部 `none`。

另以正式可移植部署产物内的 **redis6.3.1** `createClient` 和原始默认 socket 参数实际验证 `rediss://`、AUTH/PING、同一专用元数据检查，通过。错误 servername 和空 CA 信任集均拒绝；独立审查进一步确认固定错误类别分别为 `ERR_TLS_CERT_ALTNAME_INVALID`、`UNABLE_TO_GET_ISSUER_CERT_LOCALLY`。最终探测脚本只接受这两个类别，网络断开不能冒充证书负控成功；命令/连接有界，finally 清理连接。没有读取 seed、会话内容或其他命名空间，没有 SCAN/KEYS/EVAL/SET。

这不证明 Lua/ACL/容量兼容性。经精确 GO 后，切换工具首先调用**同一产物**导出的 `RedisStore.ready()`，在专用新 namespace 执行原版初始化 Lua，验证 EVAL/元数据权限和原版 limits。该阶段明确会创建 epoch、seed 元数据；凭据和 seed 均不进入输出，私有证明仅含公开 epoch/limits。失败则零 Vercel 写入；不会放宽 ACL 或回退存储。当前尚未执行此 gate。

复用固定 CyberGrid 上游 `2bd6729c6bbee90ed2926410caca883a0a100890`、适配源码 `c923cc232e74e4aff78fa3c82916ce9fb9a283b5`、patch SHA256 `1b569fa296150cbcc0e6a3e02dcc2b5ce2e2d991215d8655282a381ec6ef5137`。原始及新私有 upload 的产物 SHA256 均为 `aa53c54c1306560a12bdb7c35f2a71e91c31aff42474647f1cbe7fd3edb5cd10`。原运行时已支持 TLS Redis，不改上游源码、传输、业务协议或 AnyWork 客户端。

Vercel 原别名只读核对仍为 `dpl_29SDBhEjHTkMmXw13KmS1aXNpFpb`，项目 `prj_QEkGqB1XuC8AbtRGZaNSsMD1otvX`。通过单变量 GET 解密只读核对全部10个生产变量与旧私有状态完全一致，原 deployment metadata 绑定原 artifact/config/source。未复用旧已完成部署 operation。

## 候选及执行边界

新操作目录为 `~/.config/anywork-cloud/redis-selfhost-baa4abc0-b698-4e81-98be-f443812549fa`（0700）；其输入、完整候选、回退环境、运行状态和证明均0600。完整 URL 和旧/新密码不入仓库、argv、console 或上传产物。旧 Upstash、旧不可变 deployment、原私有状态和 artifact 均保留。准备阶段草稿保存在 `draft1-*`；未有 GO、未提交或变更外部状态。

候选绑定脚本及共用 helper 全部哈希、新凭据文件哈希、只读证明、原部署身份、完整前后环境、复制的 exact upload、CLI 50.28.0 entry 及完整 node_modules 树哈希。该 CLI 树实际有34个 symlink，全部解析至树内，外部依赖目标0；私有 `cli-link-proof.private.json`记录其树哈希。不是只固定入口而忽略依赖。

环境改动仅两增两删：增加 encrypted production `REDIS_URL` 和 `CYBERGRID_REDIS_TRANSPORT=tcp`，删除原 encrypted production `UPSTASH_REDIS_REST_URL/TOKEN`；其余8个公开身份/来源/目录配置保持原值。KV 或 Management 凭据等未知环境拒绝。新连接 URL 固定 DNS 主机、6379、DB0及 ACL 用户，密码正确 percent-encode。

精确 root GO 必须绑定 operationId、candidateHash、所有 helperHashes、动作 `apply` 和未来不超过10分钟的 expiresAt。独占锁覆盖执行及本地状态更新。durable `namespace-initializing` 在 Lua 前，`environment-submitting` 在首个 Vercel 写之前，`submitting` 在一次 CLI 部署之前写盘。环境读回后才提交相同 prebuilt artifact；元数据绑定新 operation/config 与原 source/artifact。

未知 CLI 结果只能 `inspect`，通过 provider metadata 找回唯一结果，不能再次 apply。inspect 同样校验原 helper/artifact/tool 绑定；证据变更则保留 unknown，恢复原受审材料或另行人工只读协调，不根据变更材料宣告完成。环境部分写入/初始化失败同样停止，不隐式启动新部署。

根代理审查通过后使用的无秘密命令（工作树源文件须保持受审版本）：

```sh
python3 /Users/water/work/2026/any-work/.worktrees/cybergrid-redis-switch/scripts/cloud/redis-cutover.py apply --operation /Users/water/.config/anywork-cloud/redis-selfhost-baa4abc0-b698-4e81-98be-f443812549fa --go /Users/water/.config/anywork-cloud/redis-selfhost-baa4abc0-b698-4e81-98be-f443812549fa/root-apply-go.private.json
python3 /Users/water/work/2026/any-work/.worktrees/cybergrid-redis-switch/scripts/cloud/redis-cutover.py inspect --operation /Users/water/.config/anywork-cloud/redis-selfhost-baa4abc0-b698-4e81-98be-f443812549fa
```

回退另需新鲜 `action=rollback` GO，使用同一路径 `rollback --operation ... --go .../root-rollback-go.private.json`。只在 alias 仍是原/本次部署且环境每个值仍属于本操作原/新配置时恢复旧环境并将 alias 指回旧不可变 deployment；不会覆盖第三方改动、删除 Redis 或退订/修改旧 Upstash。先 durable `rollback-submitting`，未知回退仅只读核对完成态。恢复旧 Upstash 配置不是健康承诺，其额度问题仍可能存在。

## 检查与后续验收

- 新切换状态测试14项：prepare 零 provider 写；严格 TLS 固定域名/namespace；精确 GO/过期/漂移拒绝；durable intent；初始化失败阻挡 Vercel；旧 REST 删除；CLI unknown 只读找回且不重放；候选/凭据/helper/CLI 依赖篡改拒绝；回退与第三方变更保护。
- Node 探测无网络测试5项：命令 allowlist、URL 编码、证书固定类别、网络错误不得假成功、namespace 错型及清理。
- Ready wrapper 合成模块测试通过：成功写公开 proof；失败不输出底层错误、URL或私密内容，finally 关闭；不连接任何实际 Redis。
- 原有 cloud helper 回归保持通过；新离线检查已接入 `scripts/check.sh`，无需 Redis 服务/额外依赖。

正式切换后仍需独立核对 READY deployment/alias/new configHash/原 artifact、healthz、Native与SPA配置精确绑定/相同新epoch、CORS、来源拒绝，以及专用 Redis 的 initialized/meta 类型/epoch一致性（不能读 seed 或会话）。仅这些通过才能宣布协调服务恢复；真实账号授权/设备/加密业务链另验，不能以管理 JWT 或这些元数据证明代替。当前未改本机 Native、运行中的本地服务、真实账号、Logto目录或业务内容，也未打断 AnyWork v0.1.25 publisher。
