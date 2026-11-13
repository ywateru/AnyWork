# Claude Desktop mapper / discovery 独立评审

日期：2026-11-13。**最终结论：mapper/discovery 源码 `129f3d0` + `fd7132533ed35ee15a5564c41656a2b908bfd239` + `c4aff63ab5a39599137e16e972546760d878f659` 在源码、fixture 与默认发现/真实只读 API 范围 pass；M1 已关闭，无开放的 P1/P2/P3 finding。** 测试-only `2f69beb` 的 assistant/tool 身份增强也已独立通过；最终 `c4aff63` 仅为新建 Desktop session 显式选择 native default 权限模式，已另行私有构建并通过 12 项 Desktop/profile API fixture。真实只读验证在 `fd71325` 完成，未因新建参数变化重新触碰实际会话。原生 Desktop 运行验收保留为人工交接后的独立 gate，不阻塞本轮限定范围源码接受。以下保留初次反例及最终复核证据。

## 精确对象与分工

- 源码顺序：已接受的 CLI `e70c8a50442be05d7d15947d3097e003553de250` → carrier `a8bccea` → mapper/discovery **`129f3d0127eaa5a5bd6059345a049c050914efb0`**。
- 评审分支 `codex/claude-backend-review` 中的等价 cherry-pick：carrier `d413505`、mapper `fd54a6a`。除既有评审文档外，与作者候选的 tracked tree diff 为空；无未提交产品修改。
- 本轮负责 `desktop_adapter.rs`、默认 profile/下载 CLI 发现、持久历史投影、App/API/runtime 接线与 capability。Carrier 独立评审由 Boole 负责，使用报告提交 `e3febe8`（主 workspace 等价 `6e19e34`）的已接受边界；未重复 transport review，也未修改 carrier 五文件。
- 参考主 workspace 的 `docs/claude-integration.md`、`docs/plan/tasks/claude-verification.md`，以及作者提交内的 Desktop 原生静态调查。用户明确保留真实 DevTools/CSP/LocalSessions 执行到人工交接后，源码 gate 不要求绕过该边界。
- 私有构建继续使用 `/tmp/anywork-claude-review-68dde8d/target`；运行冻结 **`/tmp/anywork-claude-review-129f3d0/anywork-129f3d0`**，SHA-256 **`ee2999698c776ca5b27ef3a1827f37816e6d87c71716aecee09721338e43b0e6`**。未写入或运行主 workspace 的共享 binary。

## M1 — P2 / blocking，已关闭：live 与 history 的 replay identity 不同，重读重复用户消息

位置：`crates/server/src/claude/desktop_adapter.rs:483` 的 assistant/user 转换；`crates/server/src/claude/history.rs:434` 的持久导入。

Live `native()` 以投影 Desktop thread 调用 `protocol::row_events(&self.thread, ...)`，source key 为 `claude:local_UUID:<messageUuid>:user`；hydrate/history 导入以原生 SDK `session_id` / CLI UUID 为 source key 前缀。同一消息 UUID 在两种读取路径得到不同 key，无法被 store 去重。Live 同时未输出该消息的 `claudeCliSessionId`。作者原 fixture 的 SDK envelope 未带 `session_id`，因此漏过此边界。

独立复现只修改临时 peer，不改产品代码：每个 native session 有独立 cliSessionId，live SDK envelope 和 transcript 中的同一行均带该 `session_id`；发一条 synthetic 输入，正常完成，重启隔离 AnyWork 后 GET history。export 的 user/message 从 **1 条变为 2 条**，相同 message UUID 的 source key 分别为：

```text
claude:local_<desktop-id>:<same-message-uuid>:user
claude:<cli-session-uuid>:<same-message-uuid>:user
```

第一条 `claudeCliSessionId:null`，第二条为实际 CLI UUID；Web 对 user/message 会追加显示两次。独立 `test_01_reconnect_same_sdk_uuid_does_not_duplicate_user` 与 `test_02_live_source_includes_native_cli_lineage` 均失败，同属一个根因。应统一 Desktop 投影的 replay identity，并按每条原生消息保留 CLI lineage，不能拿当前 snapshot.cliSessionId 覆盖旧 lineage 消息。发现后已直接通知 Planck，并在协调 chat 同步。

## 已通过的 mapper 边界

| 边界 | 证据与判断 |
| --- | --- |
| 原 owner / 无 CLI takeover | mapper 只调用 carrier 的原 LocalSessions；没有 CLI spawn/resume 路径；attach 保留 local_UUID，并核对原 cwd。隔离 CLI fixture 保持 native live-owner 拒绝；真实目标仅 registry 观察 |
| send 回执 | Promise<void>/null 仅返回 `turn:null`、submission submitted/unknown；user echo 本身不触发 turn-start。第二次发送有本地 fence；已知 queued reply 报错断连且只调用一次 send，不自动重放 |
| 原生活动与完成 | SDK stream/assistant/result 单独投影 `nativeSessionActivity`；snapshot busy:false 不制造 completion。terminal 可以释放 local fence，但 submission deliveryState 始终 unknown；不宣称是哪条输入执行成功 |
| 审批 / AskUserQuestion | requestId 与所选 session/原 input 绑定，拒绝 acceptForSession 和篡改 updatedInput；实际传给 carrier 的参数仅原 requestId + once/deny，问答经原问题键返回，不发第二条 user prompt。原 fixture 问答通过，独立 deny/重复响应反例通过 |
| 断连与 generation/gap | 事件缺口或 generation 变化会断连、失效 pending、不发送旧响应、不重放输入；显式重连重新读取原生 snapshot/history，未从缺失状态推断空闲 |
| 模型 | native setModel 后重新 snapshot 确认才提交；未确认的模型在独立 API 反例中拒绝、不写入 store，并断连保留未知控制结果 |
| 能力与晚到 bridge | manifest 保留固定 feature，descriptor 未到时 available:false，不伪装 writable；connector 后到后可重新检查。无完整 native catalog getter，catalogComplete:false 和设置提示均有 API 覆盖 |
| history / discovery | 默认 Claude 与 Claude-3p root 并集；单显式 override 替代默认。跨 profile 重复 ID fail closed、保留缓存；movedToCloud 对象排除，普通 RC cloudSessionId 保留；history 记录有 profileRoot 和独立 CLI lineage |
| 附件 / 不支持动作 | 复用 HTTP 与适配器 session cwd/uploads 边界；文件 20 MiB、native 内联附件格式。显式 steer/goal/fork/plan/effort/tier 拒绝，CLI 审批 policy 边界保持 |

## 真实截图会话：严格只读 API 验证

使用上述冻结候选启动临时服务，独立 workspace/data/plugins、`--codex-discovery false --agent-scope all`。**没有设置 history root override**，由默认 root union 发现 `/Users/<user>/Library/Application Support/Claude-3p/claude-code-sessions`。真实 carrier 尚待人工连接，因此 descriptor 指向临时不存在路径，CLI binary 也指向临时不存在路径作为额外隔离；这没有替代默认 profile/CLI 历史路径的发现逻辑。

| 断言 | 实际结果 |
| --- | --- |
| Desktop ID | `local_<desktop-session-uuid>` |
| CLI lineage | `<cli-session-uuid>` |
| 标题 / cwd | 精确匹配 `用户指定的截图会话` / `/Users/<user>` |
| 发现状态 | `external`，磁盘状态未被当作 live running |
| 完整分页读取 | **5 页，98 条去重事件：4 user/message、94 item/completed** |
| history 来源 | 每条相关事件的 profileRoot 为上述 Claude-3p history root，claudeCliSessionId 为指定 UUID |
| 重复读取 | 第一页内容和序号一致；所有页 sourceEventKey 无重复 |
| runtime / 写入 | 只发 GET health/sessions/history；临时 DB 的 turn/started、plugin/exited、connection/interrupted 合计 **0** |
| 文件保留 | 目标 metadata 与 CLI JSONL 读取前后 SHA-256 **均未变化** |
| 实际 owner 观察 | `/Users/<user>/.claude/sessions/<native-pid>.json` 存在；PID 存活、kind=interactive、sessionId=指定 CLI UUID、hostSessionId=指定 Desktop ID，UTC/C locale 的 procStart 与 ps lstart 一致 |

**没有调用真实目标的 connect、resume、new runtime、messages、respond、interrupt 或模型/设置写入，也未用它做预期拒绝测试。** 真实 owner 信息仅仅读 registry 的必要字段并做无信号的存活/启动时间观察；拒绝行为全部交由隔离 fixture。真实 history 数据仅在进程内计数/核对，不打印正文、原始记录或凭据。上述结果不代表真实 Desktop carrier/runtime 控制通过。

## 独立执行与附件

```sh
CARGO_TARGET_DIR=/tmp/anywork-claude-review-68dde8d/target cargo test --locked -p anywork claude -- --nocapture
CARGO_TARGET_DIR=/tmp/anywork-claude-review-68dde8d/target cargo build --locked -p anywork
cp /tmp/anywork-claude-review-68dde8d/target/debug/anywork /tmp/anywork-claude-review-129f3d0/anywork-129f3d0
ANYWORK_BINARY=/tmp/anywork-claude-review-129f3d0/anywork-129f3d0 python3 scripts/claude-desktop-adapter-test.py -v
ANYWORK_BINARY=/tmp/anywork-claude-review-129f3d0/anywork-129f3d0 python3 /tmp/anywork-claude-review-129f3d0/desktop-boundary-review.py
ANYWORK_BINARY=/tmp/anywork-claude-review-129f3d0/anywork-129f3d0 python3 scripts/claude-integration-test.py -v
python3 /tmp/anywork-claude-review-129f3d0/readonly-screenshot-review.py
```

结果：**14 Claude Rust passed；11 作者 Desktop/profile API passed；17 CLI fixture API passed；8 独立 mapper 边界 API 中 6 passed / 2 failed（M1）；真实只读目标核对 passed。** 没有为本轮机械重跑 carrier fixture 或无关全量测试。作者提供的 workspace/clippy/全量 API 证据单独记录于其 verification.md，不计作本评审者独立执行。

临时附件目录 `/tmp/anywork-claude-review-129f3d0/`：

- `desktop-boundary-review.py` SHA-256 `82196aba4ae13f941c96453000139331e58c5aa353918326ca6e801a4e07fc23`；结果 `desktop-boundary-results.txt` SHA-256 `d16ee8ec478f533675815ecfaba09a8940b1e5df19417222d4c9f3b0345ca924`。
- `readonly-screenshot-review.py` SHA-256 `5142ed515dc721f6cf9ff65bbcfd96fd327c386fe871db519284433cc8717605`；结果 `readonly-screenshot-results.txt` SHA-256 `3cf79aa30aa793734f7fc93ad5974d9aae491f74f01b6c2d4f0c55be3bb20acd`。

所有临时 fixture/编译输出均不随报告提交，产品代码由作者修复。本轮没有确认其他开放的 P1/P2/P3 finding；**native 运行未验收是已声明的后续 gate，不被误列为新的源码缺陷**。M1 修复后只需精确候选私有重建、重跑相关身份/receipt/API 反例与必要 CLI 回归，即可给出限定范围的最终源码结论；不等待人工 native handoff 才审源码。

## M1 精确复核：`fd71325` 源码 + `2f69beb` 测试

作者修复提交 **`fd7132533ed35ee15a5564c41656a2b908bfd239`** 只有 mapper 的逐消息 CLI provenance、历史 replay identity 和相关 fixture/证据变更。跳过的 `5c63e1d` 仅为作者报告；cherry-pick 时该报告发生上下文冲突，已直接采用 `fd71325` 中的完整原文，未人工更改产品修复。评审等价提交为 `c9734ba`；后续测试-only **`2f69bebdb09734053f818ec92312ad8c46b753a0`** 等价为 `0291451`。排除两份评审文档后与作者精确 tree diff 为空，且 crates 产品源码与 `fd71325` 完全一致。

修复将持久导入 source key 统一绑定投影 Desktop ID；live assistant/user 的每条 SDK `session_id` 独立进入 `claudeCliSessionId`。CLI ID 保留为 provenance，旧消息不套当前 snapshot 的新 CLI lineage。原 M1 两个反例已转绿；新增独立换代/重启反例验证 user、assistant、tool_use/tool_result 均不重复，tool started/completed 的 ID、Bash command 和输出均保留。**M1 closed。**

私有重建并冻结 **`/tmp/anywork-claude-review-fd71325/anywork-fd71325`**，SHA-256 **`e9f3595ed1ec48906267854b80a46086d5f577ff5cd0c29565b55f4b1ca3d5af`**。新增测试不改变已冻结的产品源码/binary。

```sh
CARGO_TARGET_DIR=/tmp/anywork-claude-review-68dde8d/target cargo build --locked -p anywork
cp /tmp/anywork-claude-review-68dde8d/target/debug/anywork /tmp/anywork-claude-review-fd71325/anywork-fd71325
ANYWORK_BINARY=/tmp/anywork-claude-review-fd71325/anywork-fd71325 python3 /tmp/anywork-claude-review-fd71325/desktop-boundary-review.py
ANYWORK_BINARY=/tmp/anywork-claude-review-fd71325/anywork-fd71325 python3 scripts/claude-desktop-adapter-test.py -v
ANYWORK_BINARY=/tmp/anywork-claude-review-fd71325/anywork-fd71325 python3 scripts/claude-integration-test.py -v
python3 /tmp/anywork-claude-review-fd71325/readonly-screenshot-review.py
CARGO_TARGET_DIR=/tmp/anywork-claude-review-68dde8d/target cargo test --locked -p anywork claude -- --nocapture
```

| 独立执行 | 最终结果 |
| --- | --- |
| 独立 mapper API 反例 | **10 passed**：M1 去重/逐消息 lineage；原问题 snapshot 换代；assistant/tool 身份、command/output；精确 deny 与过期重复响应；unknown receipt/false-idle/terminal 不升级 delivery；queued 不重放；模型不确认不持久化；generation 失效 |
| 作者 Desktop/profile API（含 `2f69beb`） | **11 passed**：test07 加强为 Bash tool_use + tool_result + final，CLI snapshot 轮换与重启后 user/assistant 各 1 条、tool started/completed 各 1 条且 ID/命令/输出/provenance 保留 |
| CLI fixture API | **17 passed** |
| Claude 定向 Rust | **14 passed** |
| 修复后真实截图会话只读重验 | **passed**：默认发现、标题/cwd、5 页 98 事件（4 user、94 completed）、profile/CLI 来源和重复读稳定、runtime lifecycle 0；owner 的存活/interactive/两种 ID/procStart 均匹配；metadata/JSONL hash 不变 |

独立 API harness 固定加载 `129f3d0` 的原始 peer 定义再增加反例，没有依赖作者改好的身份 fixture 来掩盖问题。最后运行的 teardown 有一条正在关闭的 synthetic HTTP poll 的 ConnectionResetError；10 项断言全部完成、unittest 为 OK、退出码 0，没有原生连接或产品故障。

最终附件目录 `/tmp/anywork-claude-review-fd71325/`：独立脚本 `desktop-boundary-review.py` SHA-256 `7cb7fa52330d2560f0ab7da2879b366393c4bf2eb78e4baf3d8a6f00e82c5a7f`；`desktop-boundary-results.txt` `cd2c1d9806a13edf4b2e5e581cfdbc82f07cda3321cf4bcca32c7c0503be83ac`；`desktop-fixture-results.txt` `00496c3c0e6269c86154e9aecae8345a716411e51d04c4068c4304f2f02742a1`；`cli-fixture-results.txt` `af895929e2e30943ec7ca064b6d284143e53d63e625d1d946ecda26564b441cf`；`readonly-screenshot-results.txt` `8db5782144057a7bcedf27e7714f778ab28717e0f263117c35832510a8340b78`。只读脚本除候选名/binary 路径外保持原边界，不新增任何控制请求。

## 最终窄范围补核：`c4aff63` 新建权限模式

作者精确提交 **`c4aff63ab5a39599137e16e972546760d878f659`**，评审等价提交 **`8673651`**。排除两份评审报告后与作者候选 tracked tree diff 为空。产品差异仅在 `desktop_adapter::create()` 的 `start` info 增加 `permissionMode:"default"`；既有 attach/import/hydrate 路径无修改，mapper 中没有 `setPermissionMode` 调用。已接受 carrier 的 start 参数白名单允许该字段及 `default` 值。该变化符合新建 AnyWork manual policy 的 native 默认模式选择，并保留已有原生 Auto 会话设置。

独立执行私有 `cargo build --locked -p anywork`，冻结 **`/tmp/anywork-claude-review-c4aff63/anywork-c4aff63`**，SHA-256 **`b84c8b9d0c4113202ceb7f03672ec2af5826bc90ca2924d9696e393220fe8db7`**。未运行共享 target binary。

```sh
CARGO_TARGET_DIR=/tmp/anywork-claude-review-68dde8d/target cargo build --locked -p anywork
cp /tmp/anywork-claude-review-68dde8d/target/debug/anywork /tmp/anywork-claude-review-c4aff63/anywork-c4aff63
ANYWORK_BINARY=/tmp/anywork-claude-review-c4aff63/anywork-c4aff63 python3 scripts/claude-desktop-adapter-test.py -v
```

**12 项 Desktop/profile API fixture 全通过**。新增 test10 明确断言新建 start 选择 default；另造原生 Auto 会话，经发现、connect 后仍为 Auto，整个调用记录无 `setPermissionMode`。此处 connect 只针对隔离 synthetic peer，未调用用户指定真实会话。其他 11 项覆盖既有 mapper/replay/receipt/approval/late bridge/profile 边界。结果 `/tmp/anywork-claude-review-c4aff63/desktop-fixture-results.txt` SHA-256 **`78690ee1c89f250261846d8bd62e97f2b91cc32c1322a27d2a60adc79c6e2d30`**。这次单字段变化未重跑无关 CLI/Rust 广套件，前节证据对应其明确记录的 `fd71325` 候选。未发现新增 P1/P2/P3 问题；M1 修复没有变化。

**接受含义：可以合并含 `c4aff63` 的精确 mapper/discovery 源码并进行主分支全量检查。** 真实 DevTools/CSP/WS、原生 LocalSessions list/history/event/permission 形状及实际 Desktop create/send/control 仍未验收，交给后续人工 native handoff；本报告不将 fixture 或被动磁盘 history 当作这些能力的真实运行证明。Carrier 的独立结论仍沿用其专门评审，未重复审查或改动传输层。
