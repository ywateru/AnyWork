# Claude Desktop carrier 独立审查

日期：2026-11-13。作者：Bacon。审查分支：`codex/claude-desktop-review`。

**结论：pass，仅接受精确提交 `ba0cdd0120454116c91fc66eaa94a2f8124ce5a6` 的 carrier 源码与夹具范围。** 未发现本范围内开放的 P1/P2/P3 blocking 或 non-blocking finding。本结论不代表 Desktop 原生连接、读写或产品端到端验收通过；这些仍为 **pending / unverified**。没有建立真实 Desktop 写入成功的证据，也不授权发布。

本轮只新增此报告，不修改产品代码。没有启动、控制或修改真实原生应用、会话、服务、profile、账户或部署；未操作 DevTools 或绕过 self-XSS、CDP 签名及组织限制。测试中的 `.app`、preload、session、token 和 HTTP/WS peer 均为临时伪造夹具；临时 launcher 是本轮自行启动并清理的 Python 进程。

## 精确对象与边界

接受对象为上述一个作者提交，以下文件均来自其原始内容，无 cherry-pick 修复或产品变更：

| 文件 | 核验范围 |
| --- | --- |
| `crates/server/src/claude/desktop.rs` | 描述符读取、身份/权限/端点校验、open/list 握手、RPC、cursor 传递、disconnect/Drop |
| `scripts/claude-desktop-launch.py` | 私有发布与清理、bundle 观察、loopback HTTP/WS、首帧认证、pending 调用及启动/退出 |
| `scripts/claude-desktop-carrier.js` | 固定调用白名单、本地会话过滤、参数约束、审批刷新、事件 generation/cursor/gap、消费者隔离 |
| `scripts/claude-desktop-launch-test.py` | 作者提供的 6 项 Python/Node/socket 夹具 |
| `docs/plan/analysis/claude-desktop.md` | 原生研究证据与未验收边界，作为范围说明读取 |

同时参照 `docs/claude-integration.md`。本分支的 Rust carrier 尚未接入完整后端；按用户分工使用独立 Cargo harness 编译原文件。后端 mapper、writer 所有权、事件投影、最终 App 集成由另一路审查，本报告不替它们作结论。未将并行接线尚未合并视为 carrier 缺陷。

## 审查结果

| 边界与具体位置 | 独立核验与判断 |
| --- | --- |
| `claude-desktop-launch.py:309` 首帧与来源；`:287` 客户端 RPC；`:413` loopback bind | Broker 只绑定 `127.0.0.1` 随机端口。WS 在读取认证帧前校验精确 Host、固定 Origin、upgrade/version/key；native token 在首个 JSON 消息内验证，一次绑定后销毁。RPC 使用另一个随机 bearer，拒绝任意 Origin 和错误 Host。实测错误 token、把 client token 当 native token、错误 protocol、空认证、错误 Host/Origin 及已绑定后的重连均不能取得 native peer；正确认证成功且 native token 清空。没有把 token 放进 URL/subprotocol。 |
| `desktop.rs:83` / `:147` / `:193`；`claude-desktop-launch.py:68` / `:86` / `:109` | 描述符拒绝未知字段、错误协议/agent/版本、无效 token/UUID/hash、相对 app path、不合理 PID、非 loopback 端点、路径/query/fragment/credentials。Unix owner、0700 目录、0600 常规文件、symlink 和大小限制存在。并发 24 次 no-replace 发布只有一次成功；清理保留替换后的 inode，FIFO 读取及时拒绝，不残留临时文件。App version/hash/PID 是观察信息，不是对当前 renderer 的签名认证；认证依赖用户选择上下文及私有 token，未将 hash 当作 native-ready 证明。 |
| `desktop.rs:116` 握手与 `:206` RPC | `connect` 做 open/list 后重读描述符检查 instanceId。独立 fake HTTP 在 list 回复前替换 generation，连接明确失败。禁用代理与重定向，响应有 32 MiB 上限；未知交付结果不自动重放。URL 库会把 `127.1`、十进制 IPv4 等别名规范化为 `127.0.0.1`，`/../` 规范化为根路径；最终发往数字 loopback 根 origin。这没有产生外部主机或额外路由，不作为漏洞。 |
| `claude-desktop-carrier.js:18` / `:72` / `:114` / `:133` | 未暴露 eval、任意 IPC 或账户/文件 API。拒绝未知方法、synthetic/toolStates/priority 参数、额外 start 字段、bypassPermissions、复用已存在 ID 新建、忙碌时改模型。send alias 按固定 positional 签名转换。独立用带 SSH 配置和 movedToCloud 的 `local_UUID` 记录测试，列表/模型候选均过滤，向远程记录发送被拒绝且没有调用 native send。此处是本地会话范围检查，最终消费者/writer 授权仍属于 mapper。 |
| `claude-desktop-carrier.js:41` / `:99` 审批 | 仅 once/deny；作答前以 getSession 快照重建该 session 的 pending。实测事件中出现、快照中已消失的请求不能作答；always、任意 updatedInput、非原问题答案键、附加字段被拒绝。正常 deny 转发精确 requestId。AskUserQuestion 仅合并原 input 与原问题键对应答案；保留原 questions/其它 native input。成功作答后删除 pending，重复作答被拒绝。未向原生应用提交任何审批。 |
| `claude-desktop-carrier.js:51` / `:178`；`desktop.rs:300` | 队列 1024 条/4M 字符、每次最多 128 条/约 1M 字符，序号持续递增，丢失显式 gap。独立输入 1100 条后第一条为 sequence 77，cursor 204；继续轮询取得剩余全部 1024 条，无漏页或重放。超大单事件清空队列、推进 floor 后 gap=true，下一条恢复正常；负值、小数、未来值及不安全整数 cursor 被拒绝。generation 随 Rust 新连接随机 consumer UUID 区分，两个消费者互不消费对方 cursor。mapper 对 gap/generation 的重拉处理不在本轮范围。 |
| `claude-desktop-launch.py:227` / `:241`；`claude-desktop-carrier.js:66` / `:174`；`desktop.rs:250` / `:304` | fake WS 发出一个 pending 调用后断开，调用在 3 秒内醒来，错误明确 outcome unknown / do not replay，pending 清空且只收到一次命令。close 仅退订该 consumer，另一 consumer 仍可收到新事件；过期 consumer 在下一条命令时被清理。Rust 重复 disconnect 幂等，之后拒绝调用，Drop 仅尽力 close。所有 fixture 断开均没有调用 native stop/interrupt；无需退出或替换原生 owner。 |
| `claude-desktop-launch.py:398` 生命周期 | 仅使用临时 fake bundle 运行真实 launcher：认证及 open/list/close 探测之前无 descriptor；探测后生成 0600 descriptor，与 snippet 使用不同 token；对该 launcher SIGTERM 后只删除本次 descriptor/snippet。token 未出现在 stdout/stderr。该结果只证明发布时序与本地传输，不证明任何真实 preload、CSP 或 native session。 |

## 独立执行证据

| 执行 | 结果 |
| --- | --- |
| `python3 scripts/claude-desktop-launch-test.py` | 6/6 通过，含作者的 Node VM native contract、本地 HTTP/WS、分片/ping、私有文件与大包夹具 |
| 独立 `extra-review.py` | 4/4 通过：错误认证/单次 attach、pending 断开、并发发布/FIFO/替换清理、fake bundle launcher 生命周期 |
| 独立 `carrier-review.cjs` | 通过：上述 whitelist/local scope、stale/exact approvals、cursor/count/oversize loss、双消费者 close/expiry；无真实 native 调用 |
| 独立 Cargo harness `cargo test --offline --manifest-path <harness>/Cargo.toml` | 原始 `desktop.rs` 的 3/3 单测通过；依赖独立 crate，未改原文件 |
| 同一 harness 的 `--test independent` | 2/2 通过：描述符字段/端点/目录权限反例矩阵、握手期间 instanceId 替换 |
| `git diff --check` | 通过；提交内容仅此报告 |

复核夹具保留在本 worktree 的 ignored `artifacts/claude-desktop-independent/`：`extra-review.py`、`carrier-review.cjs`、`independent.rs`；`rust-harness-path.txt` 指向临时 Cargo 工程。独立 harness 通过绝对 `#[path]` 引用本次工作树的原始 Rust 模块，使用 anyhow/serde/serde_json/tokio/uuid/url/reqwest/libc/tempfile。临时 fixture 与编译输出不随报告提交，不能视为仓库内新增测试。

自建 Rust 反例最初把 URL 的 loopback 别名也预期为拒绝，实际发现库先规范化；核对其最终数字 origin 后修正测试预期，上述 2/2 为修正后的结果。产品文件未作任何调整。

## 未验收项与合并含义

- 当前原生 Desktop 仍受人工 self-XSS 交接边界限制；本轮未尝试处理它。不能从夹具通过推导正常 DevTools snippet 的 CSP/WS 可连接、真实 preload 可调用、实际订阅/历史可读取或真实写入成功。
- 真实创建、发送、审批、取消、设置变更、重连及原 owner/writer 排他均未在原生环境验收。原生 acceptance 明确 **pending**，无 established write claim。
- 只接受精确 `ba0cdd0` 的载体候选及其有限安全/正确性边界；后续修改、mapper 集成与真实模型/原生验收需要各自证据。不要求为本轮 pass 绕过防护或补跑真实 UI。
- 本轮没有确认 blocking finding，因此没有向 Bacon 发送缺陷消息；若最终接线发现可复现载体问题，需另记具体提交并重开审查。本报告未将用户已明确保留的 native 未验证事实列作新的 P2 产品缺陷。
