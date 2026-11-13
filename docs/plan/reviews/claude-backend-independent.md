# Claude CLI 与被动 Desktop history 独立评审

日期：2026-11-13。**当前结论：精确候选 `e70c8a50442be05d7d15947d3097e003553de250` 对 CLI 与被动 history 范围 pass；F1–F6 全部关闭，无未关闭阻塞项。** 真实 CLI 控制链已用该候选的私有冻结 binary 独立通过，详见最终复核记录。Desktop mapper/carrier 的独立评审已列入计划，等待协调者提供已提交候选；本报告不验收 Desktop 主动控制。Web/官网和发布不在本报告范围。

以下原始记录针对 `68dde8d`：未发现已证实的 P1；新增 **3 个 P2 blocking、1 个 P2 non-blocking、1 个 P3 non-blocking**。当时协调者已告知的模型 PATCH、显式 steer/policy、Windows 路径修正单列于下文；后续复核结论不改写首次复现证据。

## 范围与不可变证据

- 工作目录：`/Users/<user>/work/2026/any-work/.worktrees/claude-backend-review`；分支：`codex/claude-backend-review`。
- 基线：`e3d7b8d`；候选：`68dde8d396ad355c083a290d5db91c2eeec4d39b`。编译和测试时产品源码保持候选原样；评审提交仅新增本报告。
- 最新契约从主 workspace 读取，而非依赖本 worktree 中不存在的副本：`docs/claude-integration.md` SHA-256 `aca3e2d22f502d4fda3b8b2d605477179f88edf180c818a3bbc8140f4d84d205`；`docs/plan/tasks/claude-verification.md` SHA-256 `6dfb7f035103d7fb9f090cefbcf8e87fa1feb7f7ec628673a4d49e317fee77d8`。
- 官方 Python SDK：`/tmp/anywork-claude-sdk-python`，实际核对 HEAD `22b8eb9c19adfa78759b79e22bd664a57843bb06`。参考 `sessions.py` 的 parentUuid/并行工具恢复，`query.py` 的双向控制与后台 run 生命周期，`message_parser.py` 的父工具身份。
- 本机真实 CLI：`claude --version` → `2.1.323 (Claude Code)`。
- APFS 克隆主 target 到私有 `/tmp/anywork-claude-review-68dde8d/target`，随后在评审 worktree 编译。API 只运行复制冻结的 `/tmp/anywork-claude-review-68dde8d/anywork-68dde8d`，SHA-256 **`8b4c4ac3c5d124ade9cddc65ccf4c9224e92a05dcaef666c5d7e0862be80ca5a`**。未运行共享 `target/debug/anywork`，避免作者并行编译覆盖。
- 独立反例脚本和协议 peer 均在 `/tmp`，未改产品代码或仓库测试。`boundary-review.py` SHA-256 `f9b2d95f93e9a739e604f6931bb401f1a7ff427874f7cab4c73948198a42e02d`；`boundary-fixture.py` SHA-256 `6b330d04462c145b827205740ef1cd5ba121a95fd7357ebc20fa2fd75559e979`；`boundary-results.txt` SHA-256 `cea71ada37f917fdc4101e1f58ef84b12a83057fe56a47268acd431759335571`。这些是本机临时复现附件，不作为仓库长期文件；下文同时保留协议级复现步骤。

## 新发现

### F1 — P2 / blocking：未知或无法识别的历史被当成空的权威快照，删除已缓存历史

位置：`crates/server/src/claude/history.rs:97`、`:370`、`:432`；Desktop history 同样调用 `history::import_messages`（`desktop_history.rs:258`）。

`read` 仅要求每行是 JSON object。未知类型、缺失有效消息结构、无法形成可见链的文件均可返回成功；`chain` 返回空数组后，`import_messages` 仍以空 key 集合执行 `prune_persisted_history`。这与“损坏或未知记录明确报告、发现失败不删除旧历史”的契约相反。

复现（独立 API `test_02_unknown_history_preserves_cached_records`）：

1. 在隔离配置目录 `projects/fixture/<UUID>.jsonl` 写入相同 sessionId/cwd 的 user `KEEP_ME` 和 assistant `KEEP_ANSWER`，GET `/api/sessions` 后 GET `/api/sessions/claude-code-<UUID>/history?limit=20`，得到两条记录。
2. 把该文件替换为一行合法 JSON：`{"type":"future-transcript-record","uuid":"unknown"}`，末尾换行。
3. 再读同一个 history。实际只返回 `history/reset`，reason 为 `native_history_branch`，`history_notice:null`；此前两条缓存记录被删。原生 JSONL 本身未被适配器改写。

期望：无法证明是完整且受支持的消息快照时保留旧缓存，给出内容无关的损坏/未知格式提示；验证完成后才允许 prune。有效的分支切换/压缩仍应正常替换。证据层级：**实际服务 API + 人工磁盘反例**，不是对真实用户历史进行破坏性操作。

### F2 — P2 / blocking：子 Agent final 丢失 parent_tool_use_id，被显示为主轮次普通回答

位置：`crates/server/src/claude/process.rs:493`、`:544`，`crates/server/src/claude/protocol.rs:47`。

`stream_event` 对非空 `parent_tool_use_id` 直接忽略，但 `assistant` / `user` final 分支继续转换，既不隔离，也不把父工具身份传入事件。官方 SDK `message_parser.py:213` 和 `types.py:1396` 明确保留 AssistantMessage 的该字段。被动历史又过滤 sidechain，因此 live 和 history 的可见内容不一致。

复现（`test_05_subagent_does_not_leak_into_parent_as_unqualified_message`）：在一个正常 CLI turn 中，peer 发送以下 frame，再发送主回答 `PARENT_ONLY` 和正常 result/idle：

```json
{"type":"assistant","uuid":"<child-uuid>","session_id":"<same-native-session>","parent_tool_use_id":"agent-parent","message":{"id":"subagent-message","content":[{"type":"text","text":"CHILD_ONLY"}]}}
```

实际 export 出现 `item/completed`，`item.id:"subagent-message:0"`、`item.type:"agentMessage"`、`text:"CHILD_ONLY"`，直接绑定主 turnId；没有父工具或子会话身份。现有 Web 事件投影会把它作为普通 assistant 回答。子工具 final 也进入同一分支，受同样的归属问题影响。

期望：要么一致地只投影主会话，要么建立能保留父工具/子会话身份的专用投影；不能一半忽略子流、一半把子 final 展平。证据层级：**官方 SDK 字段契约 + 实际服务 API 协议 peer 反例**；未声称已在真实模型运行中重现该场景。

### F3 — P2 / blocking：原生后台工作重新运行后仍标 idle，取消不可达且接受并发输入

位置：`crates/server/src/claude/process.rs:219`、`:288`、`:476`、`:515`；`runtime.rs:278`。

`finish` 清空 `self.turn`；之后 `session_state_changed` 只保存 `native_state` 并处理 idle，不重新开启 run 或投影忙碌状态。`status()`、`thread/read`、turn/start 的 busy guard 均依赖 `turn`。官方 SDK `query.py:953` 的 `_on_session_state` 明确在非 idle 状态调用 `_reopen_run()`，并说明后台任务完成会唤醒主会话；不能把上一次 result 当成该进程永久空闲。

复现（`test_06_native_background_run_is_not_idle`）：

1. peer 对新用户输入发送主回答、result、`session_state_changed:idle`。
2. 同一 CLI 进程随后发送 `session_state_changed:running`、新的主 `message_start`、text block 和 `FOLLOWUP_RUNNING` delta，保持原生工作未完成。
3. GET session 实际为 `idle`；followup delta 的 turnId 为 null。
4. POST `/interrupt` 返回 `No active turn`；接着 POST `/messages` 仍返回成功 turn，表明第二条输入已写入活动原生执行器。反例日志：

```json
{"background_status":"idle","interrupt_error":"No active turn","second_input_accepted":true}
```

期望：将原生 run 状态纳入 busy/取消/轮次归属；重新开启工作的身份和结束边界必须完整，未知状态不能允许新的 turn/start。证据层级：**官方 SDK 生命周期说明 + 实际服务 API 协议 peer 反例**。本轮未用真实模型启动后台子任务。

### F4 — P2 / non-blocking：被拒绝的取消污染最终轮次状态

位置：`crates/server/src/claude/process.rs:335`、`:388`、`:409`。

turn/interrupt 在发送 native 控制请求之前设置 `interrupted=true`。native `control_response:error` 只向 RPC 返回错误，不回滚标记；后续自然成功的 result 被 `finish` 标成 interrupted。

复现（`test_04_rejected_interrupt_does_not_mark_turn_interrupted`）：先保持一个活动 turn，POST `/interrupt`；peer 返回该 request_id 的 error，然后正常发送成功回答/result/idle。HTTP 正确报取消失败，但 export 的 `turn/completed.turn.status` 是 `interrupted`，期望 `completed`。输入没有重放；此项主要影响历史/状态准确性，因此不单独阻塞本次 CLI/history 接入。应在原生确认后提交取消状态，拒绝/写入失败时保留实际执行结果。

### F5 — P3 / non-blocking：相互冲突的重复 UUID 静默通过，读取结果依赖缓存时序

位置：`crates/server/src/claude/history.rs:106`、`:151`；`crates/server/src/store.rs:651`。

复现（`test_03_duplicate_uuid_reports_corrupt_and_keeps_cache`）：导入 `uuid:"same"`、文本 `KEEP_ORIGINAL` 的 user 后，在同一 JSONL 追加相同 UUID、文本 `CONFLICTING_CONTENT` 的 user。再次 history 的 `history_notice:null`，旧缓存仍为 `KEEP_ORIGINAL`。链索引以后出现的 UUID 为准，而事件存储以旧 sourceEventKey 去重返回已有记录；冷读和已缓存读取可能不一致。原始内容未泄漏到错误日志，但冲突未被识别为损坏。建议允许完全相同的重放，冲突副本则保留旧记录并报告身份损坏。

## 协调者已知、待后续提交的事项

这些问题没有被混入“已修复”的判断；本次 binary 始终是 68dde8d。

| 事项 | 68dde8d 核对 | 分级与验收要求 |
| --- | --- | --- |
| 普通 PATCH model | `api.rs:230` 直接写入 store；运行中的 CLI turn/start 不处理 params.model。与走 set_model ack 的 composer 路径不同 | P2 / blocking，已知修复中；须核实成功 ack 后持久化，以及拒绝/超时不写入 |
| 显式 steer | `api.rs:512` 在 idle 时落入 turn/start；虽然适配器拒绝真正的 turn/steer，HTTP 的显式 steer 仍可能被当普通发送，和 capability `message.steer:no` 不一致 | P2 / blocking，已知修复中；必须入口明确拒绝，不发送 prompt |
| policy:auto | create 的 shared 分支忽略 policy，PATCH 可存 auto，但 runtime 明确不会对 Claude 自动审批 | P3 / non-blocking，已知修复中；没有发现权限绕过，仍需拒绝不支持的 API 配置，避免 UI 声明失真 |
| Windows .exe 路径 | PATH 分支有 `claude.exe`；HOME 下多个 fallback 仍硬编码 `bin/claude` | P3 / non-blocking，已知修复中；macOS 源码审查，不构成 Windows 运行验收 |

## 调用链与契约核对

| 边界 | 本次证据与结果 |
| --- | --- |
| 注册/创建 | main 注册两种 agent → API shared_host::create → claude::create → ensure_runtime → attach → UUID 校验/历史定位 → writer lease → Engine::spawn → initialize → RpcProcess bridge。真实新 CLI 会话/API 成功；Desktop create 明确拒绝 |
| 恢复/被动发现 | sessions/workspaces → shared_host::sync → CLI projects JSONL / Desktop account/org/local_UUID 元数据。只读发现和 history 不启动 CLI；恢复用原 UUID 的 --resume，无替代 ID。fixture API 覆盖重启后恢复 |
| 历史分支与压缩 | parentUuid 主链、忽略 logicalParentUuid、主链过滤 sidechain/meta/team、同 API message ID 的并行 tool siblings；Rust + API 反例通过。压缩摘要替换被放弃的根；重复读取及 limit=1 游标分页覆盖所有 sourceEventKey。未知记录完整性有 F1/F5 |
| Desktop history 身份 | local_UUID 与 cliSessionId 分离，事件保留 claudeCliSessionId；云/SSH/WSL 不冒充本地 Code；缺入口时 connect 返回 history，不启动 CLI。fixtures 通过；未操作真实 Desktop 进程 |
| 流/final/工具 | text/thinking delta 与 split assistant final 使用相同 message ID + block offset；工具 ID 与结果合并，流式/final 不重复形成 item。人工 split-final、并行工具及原 fixture 通过；子 Agent 归属存在 F2 |
| 审批与问答 | can_use_tool request_id、tool_use_id、原 input 经事件/HTTP/respond 回原 control_response；只提供 accept/decline，拒绝 acceptForSession 和篡改 updatedInput。AskUserQuestion 从问题索引映射回原 question 文本，保留完整 questions/input；回答不发第二条 user prompt。Rust/API 通过；未真实触发模型工具审批 |
| 原生模型确认 | composer → 原生 catalog 校验 → set_model → 按 request_id 等 ack → settings notification → store.model。正常 ack 与 error ack API 通过；普通 PATCH 是上述已知缺口 |
| 取消/故障/重连 | 只终止本适配器子进程，绝不 signal registry PID；正常 interrupt fixture 通过。malformed frame、clean EOF、session_id 改变会断连；显式 reconnect 后只发送新输入，旧输入不重放。取消拒绝有 F4，后台重新激活有 F3 |
| 附件 | HTTP 与适配器双重 canonicalize 会话 cwd/uploads 边界，20 MiB 上限及 regular-file 检查；图片转 native base64。越界、软链逃逸、超限均拒绝，拒绝前没有 user/message。原 fixture 的图片为人工字节，不能当真实图像解析或真实模型图像验收 |
| writer conflict | AnyWork file lease + 原生 sessions/<pid>.json；macOS procStart 区分 PID 复用，活 native owner 拒绝且不启动 CLI；Rust + fixture API 通过。未对已有真实会话发送 prompt |
| capability/API 拒绝 | Claude CLI 的 fork/edit/goal/plan/effort/tier/steer 为 no；Desktop 只有 history 和本地 queue 操作可声明支持，writable 未伪装为 true。API composer 的 plan/goal/effort/tier 与 fork 拒绝实测；edit 的 Codex-only guard 静态核对。显式 steer/policy 的通用 API 入口缺口待补 |
| 持久事件/SSE | Engine → bridge → runtime event pump → App::emit/Store → history/export/events；本次用实际 HTTP history/export 验证落盘投影。SSE/全局事件发送器沿用基线，未进行浏览器端端到端验收 |

## 执行命令与结果

以下复现命令从仓库根目录运行，`target` 可替换为本机已构建目标目录；原验收在评审 worktree 完成。无源码注入、无未提交产品补丁。仅复用依赖，不使用共享可执行文件。

```sh
mkdir -p /tmp/anywork-claude-review-68dde8d
cp -cR target /tmp/anywork-claude-review-68dde8d/target
CARGO_TARGET_DIR=/tmp/anywork-claude-review-68dde8d/target cargo test -p anywork claude -- --nocapture
CARGO_TARGET_DIR=/tmp/anywork-claude-review-68dde8d/target cargo build -p anywork
cp /tmp/anywork-claude-review-68dde8d/target/debug/anywork /tmp/anywork-claude-review-68dde8d/anywork-68dde8d
shasum -a 256 /tmp/anywork-claude-review-68dde8d/anywork-68dde8d
ANYWORK_BINARY=/tmp/anywork-claude-review-68dde8d/anywork-68dde8d python3 scripts/claude-integration-test.py -v
ANYWORK_BINARY=/tmp/anywork-claude-review-68dde8d/anywork-68dde8d python3 /tmp/anywork-claude-review-68dde8d/boundary-review.py
ANYWORK_BINARY=/tmp/anywork-claude-review-68dde8d/anywork-68dde8d python3 scripts/claude-real-smoke.py --api-message
CARGO_TARGET_DIR=/tmp/anywork-claude-review-68dde8d/target cargo test -p anywork capabilities::tests -- --nocapture
CARGO_TARGET_DIR=/tmp/anywork-claude-review-68dde8d/target cargo test -p anywork runtime:: -- --nocapture
```

仓库脚本实际采用 `ANYWORK_BINARY` 环境变量名；它满足私有 binary 路径隔离的要求。没有为本次评审修改脚本接口。

| 执行 | 结果 |
| --- | --- |
| Claude 定向 Rust | 7 passed |
| capability 投影 Rust | 7 passed |
| runtime 定向 Rust | 1 passed |
| 候选自带 fixture API | 10 passed（该候选脚本实际有 10 项，含重启恢复，不是仅依据作者口述的 9 项） |
| 独立边界 API | 13 executed，8 passed / 5 failed，对应 F1–F5；不存在因为未跑到断言而误报成功的情况 |
| 真实 CLI/API 新隔离会话 | passed：`real_api_message:true`、`status:idle`、`native_id_preserved:true`、`text_stream_observed:true`、`turn_completed:true`、`isolated_new_session:true` |

独立边界通过项：split final ID 一致；软链/超限附件拒绝；AskUserQuestion 回原工具且没有第二条 user；压缩/并行工具/重复读/游标覆盖；malformed committed JSONL 保留缓存且提示不含原始正文；clean EOF/身份错误断连及显式恢复不重放；model error ack 不持久化 composer 选择；不支持的 composer 控制和 fork 拒绝。

真实 CLI smoke 使用本机现有登录，只在新建临时 workspace 和新 UUID 会话发了一条无工具的短提示。未向已有真实会话发 prompt，未输出账号字段、凭据或真实历史正文。它证明普通文本 API 链路，不能替代真实工具审批、AskUserQuestion、后台 Agent、图像或取消联调。

## 交接与接受条件

F1–F3 发现后已直接通知作者 Planck（chat `<review-chat-uuid>`），并在当前协调 chat 同步；消息包含 private binary hash、源码位置和 `/tmp` 复现路径。实现修复由作者完成，评审者未改产品代码。

接受 CLI/history 候选前，至少修复 F1–F3 和已知的模型 PATCH/显式 steer 阻塞项，在新提交重新构建并冻结 binary，对应反例转绿。F4/F5 与其余已知非阻塞项应有明确修复或接受记录。本报告不对尚未同步的新 commit 作预先验收，也不因普通 CLI smoke 成功而背书完整 Desktop 接入。

## Followup `4399921` 独立复核

复核对象是作者已提交的 **`4399921ba04ed00d17d6b36ee55c34bfc5a1539b`**，未审查未提交产品修改。该提交 cherry-pick 到评审分支得到 `18265e60f1c63e2c1c200ff6717ff655f13b49c3`；与作者 commit 的产品源码/脚本 diff 为空，区别是保留本分支的评审报告。复核期间仍没有代改产品代码。

继续使用前次的私有 `CARGO_TARGET_DIR=/tmp/anywork-claude-review-68dde8d/target` 复用依赖，编译后冻结到 **`/tmp/anywork-claude-review-4399921/anywork-4399921`**；SHA-256 **`42a7b7a93ba7dfe8eb7a0f0bc1aaa2e9527d9df59f8da85b3fb9a2be479b1187`**。旧 `anywork-68dde8d` 保留用于同反例对照；主 workspace target 未被写入。

| 原问题 | 独立复核结果 |
| --- | --- |
| F1 未知/空链清缓存 | **closed**：原反例保留两条缓存且返回 notice；catalog 保留 false+notice，Desktop 共用 importer 的空链也不会 prune |
| F2 子 Agent final 身份展平 | **closed**：assistant/user final 均检查 parent_tool_use_id，原反例不再产出主回答；作者 API regression 同时覆盖子 user tool_result |
| F3 后台唤醒仍 idle | **closed**：原反例有新的非空 turnId、状态 running；并发输入被拒绝且没有 user/message，interrupt 可结束新本地 run |
| F4 拒绝取消仍 interrupted | **closed**：仅 success ack 且绑定原 turn 时提交 interrupted；原拒绝后自然完成反例为 completed |
| F5 冲突 UUID 静默通过 | **closed**：原反例返回 notice 并保留原消息；完全相同的重复行允许去重 |
| 已知 model PATCH | **closed**：正向 native 选择、error ack 不持久化均 API 通过 |
| 已知显式 steer/policy | **closed**：活动/idle 显式 steer 拒绝；create/PATCH auto、数据库遗留 auto send 拒绝；未发送 user 输入 |
| Windows fallback | **source fix verified**：fallback 统一使用 exe，拒绝 cmd/bat wrapper；未进行 Windows 运行验收 |

metadata title 优先级及“不从第一 catalog 项猜默认模型”的补充变化已检查；title 有定向 Rust 证明，普通模型/恢复路径的 fixture API 通过。

### F6 — P2 / blocking：idle 先到时伪造成功完成，随后原生错误或未知结果被覆盖

位置：**`crates/server/src/claude/process.rs:511`**（followup 源码）。这是本次修复引入的回归：

```rust
Some("idle") if self.turn.is_some() => {
    let result = self.result.take()
        .unwrap_or_else(|| json!({"is_error":false}));
    self.finish(tx, result);
}
```

`idle` 是状态证据，不能替代尚未到达的原生 result。官方 SDK `query.py:497–498` 明确说明部分 host 在 result 前发送 idle；`:956–958` 的 idle 分支仅在 `_result_received` 时结束。因此以下事件顺序属于协议必须处理的边界，而不是要求适配器支持未知协议。

复现 A（独立 `test_14_idle_before_error_result_does_not_fabricate_success`）：新 turn 后 peer 依次发送：

```json
{"type":"system","subtype":"session_state_changed","state":"running","session_id":"<same-uuid>"}
{"type":"system","subtype":"session_state_changed","state":"idle","session_id":"<same-uuid>"}
{"type":"result","session_id":"<same-uuid>","subtype":"error_during_execution","is_error":true}
```

实际：唯一 `turn/completed` 是 `status:"completed",error:null`，session 为 idle。idle 分支先取走 turn；随后真实 error result 在 `finish` 因 turn 为 None 而被丢弃。期望：唯一完成状态为 failed，并保留实际错误。

复现 B（独立 `test_15_idle_before_eof_retains_unknown_execution_result`）：running → idle → clean EOF，没有任何 result。实际先写入虚假的 successful turn/completed，再 disconnected；期望没有原生结果证据时保留 unknown/disconnected，不把执行记录为成功。

**同一脚本、相同两项输入在旧冻结 `68dde8d` binary 上均通过，在 `4399921` 上均失败**，确认这是 followup 回归。应等待对应 result 后再结合 idle 结束；如果取消或后台 run 存在无 result 的合法路径，也必须依据可验证的原生证据区分，不能用默认成功补全。证据层级：官方 SDK 明确顺序 + 实际服务 API peer 反例；未将该顺序冒充真实模型观察。

### Followup 执行结果与复现附件

```sh
CARGO_TARGET_DIR=/tmp/anywork-claude-review-68dde8d/target cargo test --locked -p anywork claude -- --nocapture
CARGO_TARGET_DIR=/tmp/anywork-claude-review-68dde8d/target cargo build --locked -p anywork
cp /tmp/anywork-claude-review-68dde8d/target/debug/anywork /tmp/anywork-claude-review-4399921/anywork-4399921
ANYWORK_BINARY=/tmp/anywork-claude-review-4399921/anywork-4399921 python3 scripts/claude-integration-test.py -v
ANYWORK_BINARY=/tmp/anywork-claude-review-4399921/anywork-4399921 python3 /tmp/anywork-claude-review-4399921/boundary-review.py
ANYWORK_BINARY=/tmp/anywork-claude-review-68dde8d/anywork-68dde8d python3 /tmp/anywork-claude-review-4399921/boundary-review.py Boundary.test_14_idle_before_error_result_does_not_fabricate_success Boundary.test_15_idle_before_eof_retains_unknown_execution_result
```

- Claude 定向 Rust：**9 passed**。
- 作者新增后的 fixture API：**16 passed**。
- 独立边界 API：**17 executed，15 passed / 2 failed**；原 13 项（其中后台反例断言改为期待正确拒绝并发/允许取消）全部通过。新增的 model PATCH error ack 和 idle steer 拒绝也通过；两项失败都指向 F6。
- 同 F6 两项反例在旧 binary：**2 passed**。
- 独立脚本保留旧基线 peer，并注入新增顺序，避免仅复用作者更新后的 fixture 验收。`/tmp/anywork-claude-review-4399921/boundary-review.py` SHA-256 `50e989b9ad9fcefd1a887ec89dca5227ef8be53bf981c1b84da48efac322642e`；`boundary-results.txt` SHA-256 `17869e73f5b41701e1fd6155b1bc6c3b0df0a542a8b2ba3d88235daa6c686167`。

作者在 `scripts/claude-verification.md` 提供了真实 CLI `--api-controls` 结果；本轮已阅读，但不把作者输出计作独立复跑。由于 F6 已阻塞，未机械重跑完整真实工具链或无关全量测试；首次独立真实 CLI 文本 API smoke 仍仅适用于当时记录的旧 binary。本轮没有向真实历史会话发送 prompt。

F6 确认后已直接通知 Planck，并在协调 chat 同步。**该轮门禁：原五项关闭，新增 F6 修复并在精确提交重跑后才能接受 CLI/history 候选。**

## 最终复核 `e70c8a5`：CLI/history pass

作者后续已提交 **`e70c8a50442be05d7d15947d3097e003553de250`**，在 `4399921` 上修复 F6。评审分支 cherry-pick 为 `0e5c9b4497d36a5a4bf4539ee333e0fe7b72fd3e`；与作者 commit 对比，除本报告外的 tracked tree diff 为空。未使用作者未提交修改。

`process.rs:511` 现在仅在已有真实 result 时于 idle 结束；idle 先到则保持本地 turn，待真实 result 或断连。复现 A 得到唯一 failed completion 与 error，复现 B 断连且没有任何成功完成；F6 关闭。原 F1–F5 和已知模型 PATCH/显式 steer/policy 修复反例全部保持通过。

私有重建后冻结 **`/tmp/anywork-claude-review-e70c8a5/anywork-e70c8a5`**，SHA-256 **`206ee18e9e017a904a179c1db8eb1e57686f114c2227697bb889d36af54cefb1`**。主 workspace target 未改；继续复用之前的评审私有 target，API 始终执行上述冻结文件。

```sh
CARGO_TARGET_DIR=/tmp/anywork-claude-review-68dde8d/target cargo build --locked -p anywork
cp /tmp/anywork-claude-review-68dde8d/target/debug/anywork /tmp/anywork-claude-review-e70c8a5/anywork-e70c8a5
ANYWORK_BINARY=/tmp/anywork-claude-review-e70c8a5/anywork-e70c8a5 python3 /tmp/anywork-claude-review-4399921/boundary-review.py
ANYWORK_BINARY=/tmp/anywork-claude-review-e70c8a5/anywork-e70c8a5 python3 scripts/claude-integration-test.py -v
CARGO_TARGET_DIR=/tmp/anywork-claude-review-68dde8d/target cargo test --locked -p anywork claude -- --nocapture
ANYWORK_BINARY=/tmp/anywork-claude-review-e70c8a5/anywork-e70c8a5 python3 -u scripts/claude-real-smoke.py --api-controls
```

| 独立执行 | 结果 |
| --- | --- |
| 原独立 peer 加边界反例 | **17 passed**，含 F1–F6、EOF/身份错误、审批/问答、附件边界、压缩并行工具分页、模型拒绝、idle 显式 steer |
| 作者 fixture API | **17 passed**，含新增 idle-error/idle-eof regression |
| Claude 定向 Rust | **9 passed** |
| 真实 CLI 2.1.323 `--api-controls` | **全部阶段通过**，下列输出来自本评审者本次运行 |

```json
{"real_api_message":true,"status":"idle","native_id_preserved":true,"text_stream_observed":true,"turn_completed":true,"isolated_new_session":true}
{"real_api_tool":true,"real_approval_once":true}
{"real_api_question":true}
{"real_api_owned_interrupt":true}
{"real_api_set_model":true}
{"real_api_restart_resume":true,"native_id_preserved":true,"persisted_history_read":true}
```

真实 CLI 测试新建临时 workspace 与新原生 UUID；唯一批准的 Bash input 精确匹配 `printf ANYWORK_TOOL_OK > smoke-proof.txt`，只写该隔离文件；AskUserQuestion 以 free text 回原 pending request。随后取消本适配器工作、等待原生模型控制确认、重启隔离服务，并以相同 UUID 恢复后验证先前上下文。未向既有真实会话发送 prompt，未读取或输出账号凭据，未启用 bypassPermissions。所有服务和 owned subprocess 随测试清理；没有关闭外部 Desktop 应用。

本机附件目录 `/tmp/anywork-claude-review-e70c8a5/`：`boundary-results.txt` SHA-256 `fcfcd832797d512f32f910408427d5ffba4c2cf0f577b01a340a0d48aa904755`；`fixture-results.txt` SHA-256 `41e020d72a0ed458cef74cdda780a4622f37f93ac31781095b9a489135e8b9e6`；`real-controls-results.txt` SHA-256 `ae27f37c045ad2239b5ffc6b2878b6a3913186c9daed077f87e1c0572fce8e18`。独立脚本仍是前述 SHA-256 `50e989b9...`，未为新 binary 改写断言。

**最终门禁：在已声明的 CLI 与被动 Desktop history 范围接受此精确候选。** 本报告新增的五项原始发现及 F6 均已修复，没有遗留 P1/P2/P3 review finding。该结论不等于发布，也不扩大到 Windows 运行、真实模型图片理解、真实后台子任务或 Desktop 主动控制；这些场景仍按各自证据层级和后续任务验收。

## Desktop 独立评审计划（等待已提交 mapper/carrier）

协调者要求由不同于实现作者的验证者独立验收；同一评审者可以继续执行。只有在协调者提供 mapper/carrier 精确 commit 后开始，不审查不稳定的未提交实现。Desktop 的结果另记，不能由本报告的 CLI/history 通过状态推导。

计划检查：carrier 的 loopback/首帧认证、独立有限作用域 token、来源/大小/固定方法校验、实例身份与私有描述符、换代失效；mapper 的 LocalSessions 原生 session/turn/tool 身份、审批精确输入与问答回原工具、模型确认、取消与连接断开；generation/cursor/gap 后的快照恢复以及 unknown 状态禁止重放；原生 writer 冲突与拒绝 CLI fallback；history-only/可写 capability 和 API 实际能力一致。实际桌面操作仅限用户明确指定的应用/profile，保持应用所有权，不终止外部应用、不复制登录配置。真实 Desktop 原生执行证据与 carrier fixture 证据分别报告。
