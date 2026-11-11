# 默认远程开启：Native 作者证据

日期：2026-11-11。任务：`desktop-default-remote`；基线 `bae075838296a312d95de1fcefd4bb773df06262`。本文覆盖 Native 实现与隔离证据；不代替独立审查、真实账号验收或发布。

## 行为与边界

新增 `account_enable_default -> Promise<void>`，已注册生产 IPC；不支持账号的平台明确拒绝。原有 `account_enable` 保持显式重试入口。UI 必须在 `desktop_start` 成功后单独提交默认命令，Native 同样检查当前账号有效且 manager 已授权、服务运行。尚未核验本机服务时拒绝且不消费默认次数；默认失败会消费次数，不靠轮询重复发布。

当前 `GrantOwner` 的 RAM 策略保存默认消费、手动关闭、退出意图和操作代次。重复/并发默认请求只执行一次；手动关闭后，重复默认请求及再次准备本机服务均不重开，显式开启仍可重试。新 grant 具有新策略；不增加文件、Keychain 或云端秘密存储。

开启在排队前绑定 owner/代次，取得操作锁后再次核对。关闭/退出在等待操作锁之前先失效当前代次；配置 GET/等待 provider 地址可取消，已发出的 refresh、SDK 注册和目录 PATCH 则等待其结果，保留已返回的最新轮换，不重放未知交换。后续阶段及最终 `state.remote` 接管均有代次检查。失败/取消明确关闭 gateway、SDK session 和 provider；旧 watcher 也绑定原 owner/代次，不能关闭后续开启的通道。

已经发出的公开目录 PATCH 无法撤回，可能留下离线目录条目；关闭会等待其完成并清理协调会话，拒绝最终接管，不假装未发生该写入，也不重放或自动重写目录。注销撤销失败仍保留 RAM grant 以供再次撤销，但拒绝默认及显式开启。撤销沿该 RAM grant 所属完整配置执行；正式登录提交本来即将相同的已验证配置绑定至 owner。

同时移除了 snapshot/开启入场/watcher 在等待 refresh mutex 时持有全局 account State 的做法，否则 renderer 轮询本身可能挡住关闭意图。snapshot 在等待后重读公开状态，并检查 owner 未变；不返回等待前的旧启用状态。

## 实际公开配置故障

以当前正式公开配置端点、默认 Native appId 进行无账号探测：

- shell 环境代理路径的 curl 出现 TLS reset；curl direct 得到 HTTP 503，公开固定响应 `error.code=COORDINATOR_UNAVAILABLE`。
- opt-in Rust `public_grid_configuration_transport_probe` 在同一进程调用正式 pinned SDK `Client::new().auth_config()` 与 Native 默认 `client().get()`，均得到 HTTP 503；测试总耗时 1.61 秒。仅输出固定状态类别，无响应正文、令牌或 URL 日志。
- root/独立审查者另行检查基础设施，确认 Upstash 处于 free/active 且实际 GET 报 `max requests limit exceeded`，限额 500000、计数已超过限额。该供应商证据由其独立记录；本作者未使用 Upstash 密钥、修改数据库或套餐。

因此当前 `REMOTE_ENABLE_GRID_CONFIG_UNAVAILABLE` 是可复现的协调服务不可用，已有固定错误码足够，无需调整 SDK、代理、重试时长、issuer/resource/client_id 绑定或新增客户端绕行。现有配置重试/严格绑定测试继续通过。基础设施恢复、真正账号登录/发布成功及浏览器设备发现仍需另外验证；本地 fixture 不证明云端已恢复。

## 隔离验证

新增八项集成测试调用真实 Handle、SDK、HTTP fixture 和受控单一 provider 子进程：一次默认/并发幂等；失败消费及显式重试；关闭后重复准备/默认保持关闭；新 grant 重置；未核验服务不消费；排队旧 owner 不采用新 grant；注销失败保留最新已知 grant但不重开；等待 provider 时取消。

延迟网络测试分别在配置 GET、资源 token、SDK 注册、目录 GET/PATCH 中关闭，在 token 中退出。另启动等待同一 token 的 snapshot，证明其不挡住前置失效；token 正常返回后保留最新 grant且不置 uncertain、不额外交换。断言无最终 remote、已注册 session 有 DELETE、未开始的 PATCH 不发送、provider 已退出、gateway 端口已关闭。唯一已在飞行中的 PATCH 允许完成，但不能接管远程。

真实 Tauri IPC 集成通过实际 owned child + HTTP 核验 `desktop_start`，继而调用 `account_enable_default`，走两次严格配置 GET、SDK 注册/端口发布和目录写入；不打开浏览器、不签发 ticket；关闭后重复 `desktop_start/default` 无第二次注册。使用本任务临时目录与合成凭据，不改用户目录变量或触碰现有应用/服务。

检查结果：

- 最终精确产品源码 Native lib 完整回归（31.34 秒）：54 passed，3 ignored（两项既有联网/安装 opt-in，新增一项公开探测 opt-in）。
- 最后 snapshot 锁边界及轮询回归变更后的 accounts 定向另为 26 passed，1 ignored；随后完整回归同样通过。
- `cargo clippy -p anywork-desktop --all-targets -- -D warnings`、`cargo fmt --all -- --check`、`git diff --check` 通过。生成 handler 检查使用 UI 作者当前生产 dist 的只读副本；不是正式发布包构建。
- Python bridge 6、IPC 11 通过。host HTTP 脚本尝试因本工作树没有 `target/debug/anywork`，20 项均在启动前报同一 FileNotFoundError；未因此重编/替换任何已有 server binary，该脚本不计为通过，由合并检查提供新源码 server 验证。

隔离边界纠正：首轮新增注销 fixture 的 token 配置指向本地，但撤销原先读取 Handle 的正式 issuer，导致一次纯合成无效 grant 撤销请求到正式 issuer。没有真实账号、凭据、授权或远程操作；不能声称整个开发过程中绝无云请求。随后将撤销明确绑定 RAM grant 所属配置，正反撤销用例均在本地 HTTP fixture 完成。公开配置探测本身按任务授权访问正式无认证端点。

未操作已安装客户端、真实账号、本机现有服务、远程连接或云配置；未构建/安装/发布 candidate。Windows unsupported 分支已补同形命令及断言，本机 macOS 验证不代替 Windows CI。
