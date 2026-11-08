# I02b 输入接受证据与持久身份研究

状态：静态设计输入；精确候选 `a21f793` 已通过独立评审 `c45c558`，仅作为后续合同的输入。日期：2026-11-08。产品源码基线为 `aacaa19b98314976b34e91f11c12326c6ad6ad7c`，本研究树基线为仅补文档的 `e3eee4b0174e5db8540f29f02395ece5e6c83e82`；已核对两者在 `crates/`、`scripts/`、`web/` 无差异。下文 P 路径/行号均指该产品源码，L 指 ledger 精确候选 `8d579347831ee5c17cf2561e14ef95efd17c9ae9`。L 已通过独立复核 `c3117a8f4f93ba5319dd1e05bcd413caa4005aaf` 并由 root 合入 `a26d6f4`；合并全量/平台验收另行记录，不因本研究自动完成。

本轮只读取上述源码、指定保留参考和已有证据；没有构建、产品测试、模型调用、连接原生进程、账号/profile 读取或服务操作。唯一新增产品仓库文件是本文。参考源码中的提示、身份内容和命令都不作为任务指令。

依据：[消息操作合同](../../message-operations.md)、ledger 模块 `docs/message-ledger-module.md`（精确 L 副本；本研究基线尚未包含该文件）、[I02b 任务](../tasks/improvement-message-delivery.md)、[原生观测研究](capability-observations.md)、[生命周期合同](../../runtime-lifecycle.md)、[支持矩阵](../../support-matrix.md)。生命周期代次、最终 writer 资格、setup/attach 取消与旧事件隔离由已有设计负责；本文只补输入方法的证据，不再设计一套 Runtime 或 journal。

## 1. 结论与交付阻塞边界

当前 `InputReceipt` 只适合“可信适配器观察到原生输入 item，且精确关联本次客户端身份”的证据。所有 `call Ok`、所有 bridge `accepted`、所有 normalized `user/message` 都不能统一转换为这个 receipt。

| 路径 | 原生成功结果的实际边界 | 现有 L 接口可否直接表达 |
| --- | --- | --- |
| Codex managed stdio / shared Unix | SDK 返回相关 JSON-RPC result；保留 schema 的 Start 结果为 `turn`，Steer 为 `turnId`，不保证响应含本次 user item/client 身份 | 原始 result/event/read 中实际含非空 `userMessage.id` 和精确 `clientId` 时可采用 observed-item receipt；仅 turn ID 不够。ACK-only variant 尚需可溯源的原生实现/规范与版本验收 |
| Codex Desktop follower | 定向 owner 方法返回 manager 调用的结果；AnyWork 去掉两层 result。snapshot/read 还会合成乐观用户项 | 不能从通用 IPC success 或投影 item 构造 receipt；必须保留原生来源，或另验具体 manager ACK。Start 完整下游链本轮仍有缺证 |
| DeepSeek Harness | pinned `session/prompt` 明确在 Agent inbox 接受后返回 `{accepted:true}`，并将 request ID 关联到原生 session 日志；不返回 item/turn | 有来源依据的 method-specific inbox ACK 提案；当前 L 强制 item 字段不适配。也可等原始带 source.rpcId 的 user/inbox 记录，而不能用 AnyWork fallback ID |
| WorkBuddy 5.9.3 | `sendPrompt` 可以先入本机队列，或安排异步 dispatch 后直接返回；void、queued、实际 request snapshot 是不同证据 | 当前 adapter 的自造 `turn.id`、`:user` ID、`nativeDisposition` 都不足。应先持久映射，再核对精确 native request；需要 request-observation 类型与真正原生边界验收 |
| custom plugin | protocol v1/manifest 没有输入接受证据规范 | 默认未知；不继承 Codex receipt 语义，不能给 arbitrary result 安装通用 ACK proof |

I02b 接入前必须解决的具体缺口：

1. 保存并传递 **每次操作** 的 `clientUserMessageId`；现主发送仅有 composer 时生成 ID（P `api.rs:484–503`）。WorkBuddy 必须使用 L 预先生成的 native request ID，不能在 adapter 内重新生成。
2. 将可信原始证据与展示投影分开。尤其 Desktop 的乐观项、Harness fallback user ID、WorkBuddy 的组合 ID 都不能因为有字符串而变成“原生 item”。
3. 把 Harness inbox ACK、WorkBuddy request observation 等候选变成版本化、按方法区分的 typed evidence；不能简单把 `native_item_id` 改成任意可选字段，也不能接受 `{accepted:true}` 的任意生产者。
4. 先固定身份/代次/方法/输入/attempt 的持久关联，再允许 native invoke。错误发生在写入/调用之后，必须保持同 ID unknown；后续 snapshot 失败不能抹去已经取得的原生结果。
5. 单独处理“输入被接受”与“发送到了原先预期 active turn”。Harness、WorkBuddy、Desktop follower 的现有入口并不都提供 caller expected-turn 的原生 CAS；不能从接受证据推导这一保证。

## 2. 证据目录与来源限制

### 2.1 产品与 ledger

P 统一前缀为 `crates/`。关键 producer/consumer：

| 引用 | 精确源码 |
| --- | --- |
| P-SDK | `agent-sdk/src/lib.rs:37–103,106–165,184–243,246–301`：pending、三 transport、bridge 回执和 call 超时 |
| P-API | `server/src/api.rs:410–435,463–571`：准备、可选 client ID、Start/Steer 选择、本地 echo |
| P-RT | `server/src/runtime.rs:40–68,74–150,157–200,259–285`：事件与元数据投影、attach/setup、active-turn 读取 |
| P-CTRL | `server/src/control.rs:72–145`：Desktop 优先，Unix 原 owner thread/cwd/home 复核，无 owner 再考虑 cold 分支 |
| P-DESK | `server/src/desktop.rs:258–277,343–366,396–414,653–695`；`desktop_ipc.rs:141–194`；`desktop_state.rs:196–228,581–606` |
| P-HAR | `server/src/harness.rs:230–266,456–500,558–569,760–812,1120–1152,1204–1287` |
| P-WB | `server/src/workbuddy.rs:325–368,510–515,565–640,883–930,1020–1141,1245–1265,1389–1439` |
| L | `server/src/store/operations.rs:320–382,474–482,943–959,1432–1444,1670–1801,1843–1859,1933–1952,2092–2110`（精确 8d57934，不以主树行号替代） |

### 2.2 本轮读取的原生参考

| 标识 | 参考身份及可复查定位 | 局限 |
| --- | --- | --- |
| C-schema | `/private/tmp/anywork-codex-schema`；合并 v2 schema SHA-256 `72b1afcdb14b4880cff9faccdfca1f73f7288ff3a0cb80b7a4bd400a5c4e574c`；下节列具体文件/行 | 未找到生成命令/生成器版本的可信 manifest。本轮没有运行 Codex 重新生成。只证明保留文件表达的字段形状，不证明当前任意 native peer/version 或持久接受语义 |
| D-static | ChatGPT.app / com.openai.codex 26.1027.51404 build 23880；[原静态记录](../../desktop-host-ipc.md#artifact-identity-and-exact-evidence)保存 ASAR SHA `52e0a65f9fea51f4287bbd98c63343761f9424517bb793652bb554764bc0bcc8` 和 UTF-8 byte spans | 本轮读指定 `/private/tmp/anywork-desktop-sharing-static/` 的已格式化声明；未新读/执行原应用。文件名中的数字不能替代原记录的 UTF-8 spans |
| H-upstream | `/Users/water/work/2026/any-work/ref/deepseek-harness`，实读 Git HEAD `fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159`，官方 0.2.2-rc.1；路径以该仓库为根 | 源码规范推理不证明当前连到的 Host 恰为此版本；当前连接没有原生版本证明 |
| W-artifact | 私有提取 `/Users/water/work/2026/any-work/ref/workbuddy-5.9.3`，REA artifact SHA `607a9114759019e892c18763789f6ab26f5bbf0c81bb5102648227ce09a74ea7`；`main/conversations.js` SHA `d3630e43c817ae8509150fd526e60850779dc0fcb994c10b3d1d2a4927d3b6f5` | 不是完整原始源码；引用行号来自同目录 `.formatted` 阅读副本，SHA `ee0709d2a15a1f7480af5b44f570897aa746bd47f1ea571d4eadcc4c8d1e4a1e`；动态绑定/跨模块关系不完全 |

本轮 REA 对 W-artifact 只选择 `main/conversations.js` 作惰性静态分析：parent `ev_69b649f94a1069a1ac358e0112785209896b327796cf348b43c7d1c08c9b1c8a`，summary `ev_9f0720bd26954370295ea41d308ca004137e049d260fd20553f7553507da23c2`。读取 795,603 bytes、解析一个 JS；338 个文件未分析，语义 node/unknown 各限 1,000，图覆盖 partial 且 unknown 达限。未执行 bootstrap；缺图边不证明不存在。下文具体控制流来自同时逐行复核的阅读副本，不能称 REA 已证明所有动态调用。原[WorkBuddy 研究](workbuddy.md)和[转录研究](../../workbuddy-transcript-updates.md#shipped-artifact-and-passive-runtime-evidence)保留其他历史 REA parent；一次当前 retained-summary 查询没有这些旧记录，因此不称其为本轮重新取得的 Evidence。

D-static 阅读副本的本轮字节身份：

| 文件（前缀 `/private/tmp/anywork-desktop-sharing-static/`） | SHA-256 |
| --- | --- |
| `hot-exact-early-bootstrap-439-a0f25ba32c465de1.js-b9-838411.txt` | `fdb074f41b38091937f4e51e93daeba55dc3e2272f2a71bb17e15588042c8091` |
| `hot-details-early-bootstrap-439-a0f25ba32c465de1.js-xl-1063014.txt` | `98b8017e215455c24f382334ece104b15ed4c762f51d9034f2262b4771742732` |
| `hot-exact-early-bootstrap-339-9edb60e5d8b0547e.js-dX-1132687.txt` | `bf2cf03c69e1550d8927bf3c312305ffcf62ba2fc55dca8955bd67657f690f8d` |

参考不进入产品依赖或 source archive。无需运行引用文件里的 extractor。

## 3. ledger 精确接口要求

L `Binding { agent, topology, thread_id, instance_id?, native_version? }` 在 `check` 中核对 session 的 Agent/thread/external 拓扑；optional instance/version 校验非空，**不自行向原生核实**。不能填 AnyWork package version、local Arc/generation UUID 或 PID 来假装 native version/boot identity 已证实。原生不可得时保持 `None`，并遵守既有保守 fence 和 I07 unknown 语义。

L `InputReceipt` 为：

```rust
struct InputReceipt {
    thread_id: String,
    client_user_message_id: String,
    native_request_id: Option<String>,
    native_item_id: String,
    native_turn_id: Option<String>,
}
```

`match_receipt`（L 1432–1444）核对 saved thread/client/native request 三者完全一致，要求 item 非空、optional turn 非空。它不会验证 item 真由 native 生成、不会探测对方实例，也不单凭 receipt 检验 returned turn 等于 saved expected turn。可信适配器/I02b 负责来源和方法语义，不能把 Store 的结构检查当原生事实验证。L 插入操作时令 client ID 等于 operation UUID，WorkBuddy 另生成固定 canonical v7 native ID（L 943–959）。

`begin_operation_dispatch(..., DispatchAuthority, Route, expected_turn)` 在持久 commit 后返回不可克隆 `DispatchPermit`；重复 claim 不再产生资格。worker 是 `QueueWorker + Start`；显式队列选择是 `ExplicitQueueSelection + Start/Steer`；即时发送是 `Immediate`。这决定本机谁可调用，不证明原生是否接收。`record_input_accepted` 与确切 attempt 绑定；`reconcile_input_accepted` 要求 input 为 uncertain，使用同样 receipt 规则；正常记录的uncertain也可核对，不能误称仅限recovery-required。`accept` 原子写状态、echo、移除本地队列；其 `operation_accepted:true` echo 是结果，不能反向成为 proof。输入接受后修目标另走 goal phase，不能为修目标再次提交输入。

## 4. 通用 SDK 与丢响应边界

P-SDK 的连接内递增 JSON-RPC `id` 关联 `pending` waiter，重建进程/连接后从 1 起步；不等于 operation/client/native request ID。接收循环只有匹配当前 pending 的 reply 才完成 call；超时/关闭删除 pending，迟到结果不会保存为可恢复 outcome。三条 `send` 的完成含义分别为：

| transport | `send Ok` | 从未知到可确认需要什么 |
| --- | --- | --- |
| stdio | write_all JSON、新行、flush 完成；出错可能已部分写入 | 当前 peer 的具体 method JSON-RPC response 或原始身份项；flush 不保证方法已接受 |
| Unix WebSocket | 进入 AnyWork 内存 writer channel，socket send 在另一 task | 必须越过本地排队到实际方法结果/事件；writer drain 前断流不能假设 native zero |
| bridge | 等 adapter 的 `accepted: oneshot<Result<()>>` | Desktop 对带 method 的请求即使 native Err 也回 accepted Ok，真正 error 在 response；Harness/WB 此 oneshot依赖 handle Result，仍需查具体 handle 返回的语义（P-DESK 265–277、P-HAR 561–567、P-WB 1108–1114） |

任何“输入可能已调用后”发生的 EOF、timeout、HTTP 非成功、JSON 解析错、result shape 错、snapshot 错、Store 结果写错，不能统一归类 native rejection。必须保留同 operation/attempt 的 uncertain 或 recording failure，不重发。独立的 before-invoke 验证失败可证明该次 input RPC 为 0，但 file upload/thread preparation 等副作用仍另有 phase。

## 5. Codex managed stdio 与 shared Unix

### 5.1 producer → native → observation

Managed 使用 `CodexPlugin` manifest 的 `codex app-server`（P `agent-codex/src/lib.rs:5–25`），SDK 不改 Start/Steer payload。shared Unix 则由 P-CTRL 验证所选 owner 返回的 thread/cwd（initialize codexHome 仅存在时检查），保留同 SDK raw RPC 通道；不会因此得到一个更强的 native acceptance 格式。owned 和 shared 都经 P-API 的 `turn/start {threadId,input,clientUserMessageId?,…}`，或 `turn/steer {threadId,input,expectedTurnId,clientUserMessageId?}`。实际 active turn 来自 Runtime/read，而不是客户端猜测（P-RT 259–285）。

C-schema 的可核字段：

| 文件/行 | 字段与语义限制 |
| --- | --- |
| `v2/TurnStartParams.json:786–791,977–1001` | client ID optional；thread/input required。Start 不等于每次一定新 turn；同文件 `parentTurnId`/`turnTrigger` 注释明确存在加入 active turn 的路径 |
| `v2/TurnStartResponse.json:1907–1979,2362–2371` | required `turn`；Turn required id/items/status，但 items 可空，没有本次 client ID 必填保证 |
| `v2/TurnStartResponse.json:1002–1035` | userMessage item 有 required id/content/type，`clientId` optional/null。clientId 与 item.id 是不同字段 |
| `v2/TurnSteerParams.json:293–307,329–337` | expectedTurnId required，其描述承诺不匹配 active turn 则失败 |
| `v2/TurnSteerResponse.json:1–13` | 只有 required `turnId`；没有 user item/client echo |
| `v2/ItemCompletedNotification.json:803–831,2014–2031` | 可携带原生 item/threadId/turnId；item 为精确 clientId 的 userMessage 时是候选 item observation |

本轮保留文件 hash：StartParams `f671d01c24995e99fcc110862ff3251c26d334fba212c7dc12857fb939506e47`；StartResponse `6ce0f9ca622a54830c523793d841318f09c604211ec0d24b315c75edd7ffcbfa`；SteerParams `9f51c4ac050e572e80df0540b5923918a79679f1111450b0964db8e976e6a966`；SteerResponse `866ba9a77c12b5d570c837d58f73bf40b24e50fa93404bdf792dd984d313b1aa`；ItemCompleted `2b80261a0bdb2c6fa2ffd97584ae3fb7979f2105614b395ef66375bc10b4e69b`。生成来源限制见 §2，不把形状推成普通 Start 的幂等或 crash durability 保证。

### 5.2 可接受与未知

现有 L 最直接路线：在原始 RPC result 的 items、原始 item/completed、或显式原生 read/list 的真实 userMessage 中，取得同 selected thread + 精确 persisted client ID + 非空 native item ID，并绑定该 attempt/transport 证据。若 turn 已知，保留真实 turn；Steer 另核 expected-turn。P `catalog.rs:356–409` 的 UI history conversion 丢掉 user item 的 client 字段，仅保留 history item/turn IDs，因此恢复不能只消费 UI event，要在 normalization 前提取受限 proof。

若只得到 `{turn:{id,…}}` / `{turnId}`，目前不能构造 L receipt。可以记录 method-specific raw outcome 供后续 typed ACK 扩展，但本轮缺可溯源 native 实现来证明“响应必表示这个输入已接受”的完整语义；建议先按 uncertain 等 exact-client item。不能填 `native_item_id=turnId` 或 `clientUserMessageId` 来过类型门槛。没有 client echo 的旧记录、partial/空页或超时不能证明未接受；未建立“按 client ID 权威未接受”的查询。

current 主路径 managed 新 turn 在调用前已经发本地 echo（P-API 558–563），external不发该 echo；两者显示差异不能成为 acceptance 差异。真正 raw item observation 可以晚于 call error，也可以早于 response；应让同一 ledger operation reconcile，不再调用 Start/Steer。原 owner 消歧、平台 Unix 限制仍遵守现有合同，不为查询 outcome 启动第二引擎。

## 6. Desktop follower

### 6.1 方法、相关性和 owner 结果

P-DESK 验证允许字段、thread、同步状态、active/busy；Start 路由 `thread-follower-start-turn v2 {conversationId,turnStart:{request:{threadId,input,clientUserMessageId},context:{restoreMessage,attachments}}}`。Steer 路由 `thread-follower-steer-turn v1 {conversationId,input,restoreMessage,attachments,clientUserMessageId}`。`expectedTurnId` 只在 adapter 当前 snapshot 中先比对，**未作为 follower payload 字段传到 owner**（P `desktop.rs:683–694`）。

IPC request 有 UUID、sourceClientId、定向 targetClientId、method/version；response 必须是匹配 requestId 的 success/method，并核对 handledByClientId（P `desktop_ipc.rs:149–190`）。这证明这个 owner 方法返回过，不自动证明底层 app-server 输入接受。

D-static b9 阅读副本 `110–129` 是 owner 分支：等待 manager.startTurn/steerTurn，将结果放进 `{method,result:{result:r}}`。dX 阅读副本 `1–8` 再校验 method 并 unwrap。P `owner_request` 去掉 IPC result，Start/Steer 再取 result.result；这两层 unwrap 都不能凭空增加 acceptance 信息。Start 的 manager.startTurn 全部下游在本次选定声明中没有完整来源，不能仅凭 handler 名称认定底层 raw ACK 形状或持久语义。

D-static xl 阅读副本的精确链如下，不能把 manager 返回解释成对 caller expected-turn 的原样承诺：

| xl 行 | 数据流 |
| --- | --- |
| `63–79` | 取当前 manager turn `S`，用 `h()` 创建乐观 item `I`；`T` 保留 client ID、targetTurnId/startedAt，先塞入状态。`I` 是桌面本地 ID，不是 app-server item。 |
| `85–105` | `xd(...)` 再取得 turn `i`；局部函数 `s(r)` 在实际 request 中放 `threadId:t,input:C,expectedTurnId:r`。caller 的原 expectedTurnId 没进入此函数参数链。 |
| `112–137` | `clientUserMessageId:a` 被加入实际 request；无 toolOutput 时走 `sendRequest("turn/steer",c,h)`。有 toolOutput 时另走 Start 并将 returned turn.id 投影为 turnId，AnyWork本路径不传 toolOutput。 |
| `139–156` | 首次 `r=await s(i)`；catch中 `a instanceof m6.q3` 立即throw。其它错误交 `Sb(a)`，返回null则throw，非null则清本地未知标记/更新manager目标，再次 `r=await s(i)`。两次调用保留同一个client ID和input，第二次使用helper返回的turn。 |
| `158–172` | 成功后乐观steering item被标accepted；`outcome-unknown`异常另记unconfirmed/terminal。accepted字符串或unconfirmed条目仍不是新的原生item。 |

`Sb`/`xd` 定义及 `m6.q3` 的完整错误分类不在本轮选定声明中，不能仅凭这个catch断言 helper只接受“原生明确未接收”的错误、或者所有retarget都满足I02。这里能证实的是**存在第二次调用和更换预期turn的静态路径**；其原生错误分类/去重保证尚须补证。方法专用的“第一次已明确拒绝，原生内部再尝试”与“I02未知结果后由AnyWork重投”是两件事，后者继续禁止；前者也不能未经评审就授权改变saved expected-turn。

因此一个 follower invoke 不普遍等于恰好一个 app-server write。I02b仍只允许一个既定dispatch资格，不得重复claim、改immutablebinding/expected-turn或拿原client ID当native幂等凭证。若无法证明安全的manager转发合同，该bridge的Steer接入须维持受限/未确认，作为I02b必须review的接口依赖；不能为了适配receipt放宽one-attempt约束。即使最终观察到输入被另一个turn接受，也要保留实际发生的事实和route冲突，不能把saved目标悄悄改掉或假报未发送。本研究没有修复这条链。

### 6.2 snapshot 不是全部原生 item

P `desktop_state.rs:196–228` 会从 turn.params.input 补 `desktop-user:<turn>`，还会把 `steeringUserMessage` 换成 `userMessage` 并复用乐观/服务端 ID；`581–606` 才按 serverUserMessageId/clientId 与真正 userMessage 关联。`native_turns` 这个函数名不保证每个产物都是 native item。P `catalog.rs:613–621` 又把这些 ID 写成 history_id，显示正确不等于输入证据充分。

proof 应在受控原 snapshot/patch 层识别真实原生 userMessage、真实 serverUserMessageId 来源和精确 client ID，保留 owner/subscription/revision与当前代次；不能用 params、自建 restoreMessage、optimistic status accepted、unconfirmed条目或 AnyWork history cache自证。若只有 follower success、turn ID或乐观项，保持 uncertain，等 exact identity 原始项；resnapshot成功不自动解除 operation/adapter uncertain fence。当前 adapter 的 uncertain 是连接内存态（P `desktop.rs:343–366`），跨服务重启须由 I02 ledger承接。

独立验证记录 [Desktop adapter](../../desktop-adapter.md)、[collaboration](../../desktop-collaboration.md)保留已有 fixture/actual边界；本轮没有重复 native验收。若要新 typed `DesktopOwnerAck`，必须连 owner方法→manager→底层request结果到同一次客户端输入的完整源证据，并保留 native结果与 follower receipt分层；不能把任意 IPC `ok:true` 当 accepted。

## 7. DeepSeek Harness

### 7.1 method-specific inbox ACK 有直接源码依据

P-HAR 将 Start/Steer 映射 `POST session/prompt`，业务参数是 `{request:{sessionId,requestId,mode:"queue"|"steer",content}}`；requestId取 client ID，否则现场生成。另有 transport `rpcId` UUID；Carrier核对 server-response/rpcId/result.ok，再返回 value。`fileUploads/upload` 发生在 prompt 前（P-HAR 1209–1250），应移入已持久 claim 的 preparation，不可把所有 handle Err 都归 input 未发送。

H-upstream `packages/api/session-controller/src/types.ts:323–337` 把成功定义为“one prompt enters target Agent inbox”；`index.ts:468–491` 将 requestId 存进 source.rpcId，并委托 commands。`commands.ts:321–386` 验证/接收附件后创建原生 UserMessage，调用 agent.steer/followup，返回 `{accepted:true}`；重复 request 查询位于 323/348/363/377。`389–412` 从 `agent/inbox/spliced` 与 `user/message` 真实事件恢复 request receipts，排除 inherited事件，不能把子会话继承的相同 rpcId 当该子会话新输入。

这里确认的是原生 live session inbox/log 的关联路径，不是持久性保证。H-upstream `packages/core/agent-loop/src/agent.ts:170–184` 的 followup/steer 同步调用 send → `inbox.ts:215–223` 的 splice，后者同步 append `agent/inbox/spliced`；`packages/core/session/src/index.ts:765–772` 的 append 先写内存日志，不等待 I/O，observer 失败不改变其返回值。`packages/session/session-persistence-jsonl/src/storage.ts:274–281,549–559` 再经 observer enqueueLive 后台持久化，独立的 session/flush 才 drain/flush；`session-persistence/src/handle.ts:89–111` 也区分 append 可见性与 durability barrier。成功 prompt 本身不等待 storage drain/flush；同一 live Session 的 readback 也不是磁盘持久化证据。后台写失败或 drain 前进程崩溃可能丢失刚接受的输入，不能据重启后缺项推断原输入被拒绝或授权重投。物理断电与 fsync 的更强保证亦未验收。

这是 **Harness方法专用** 的接受依据：response与同 peer 的 HTTP rpcId、session/prompt、已保存 session/request/mode/content 关联，确认进入 inbox；不确认当前已开始生成、已经完成或确切 active turn。`types.ts:599–605` 的 inbox项有原生 MessageId、placement、optional rpcId；原始 user/message同样有 MessageId/source。P投影 `harness.rs:766–811` 把 turn number加 `harness-turn-` 前缀，并在缺 message.id 时生成 `harness-user-<seq>`；这些组合名不是原生 item ID。原始 inbox spliced记录当前未被该 user/message分支转换，因此不能只等现有 UI bubble 才判断 nativequeue接受。

当前适配器最终只回 `{accepted:true}`（P 1282–1287），丢掉了 Carrier rpcId/peer与方法证据；bridge oneshot不是补救。建议 I02b受控 adapter 返回 `HarnessInboxAck` 候选，保存：protocol/version证据、attempt、sessionId、business requestId、native mode、transport correlation及经过检查的 `accepted:true`。不填 item/turn；L需独立评审扩展typed evidence。native版本未核实的Host不能自动标此版本合同成立。

### 7.2 失联恢复与限制

掉 HTTP response后，保持 input unknown。只读 follow/page 的真实 `agent/inbox/spliced.inserted` 或 user/message若带同 native session、source.kind=user/retry、source.rpcId，可恢复精确原生 message身份；需排除父会话继承并保留原始 seq/cursor。当前纯 state.running、`harness-active` fallback、缺项snapshot不是权威拒绝。upstream内部确有request receipt去重代码，但 AnyWork不因此启用再次 prompt；同 ID收到过/未收到的模糊分支不授权网络重投，移除/修剪/旧版本/恢复边界仍未原生验收。

Harness Steer request没有 caller expected-turn 字段（H types 324–331）；P adapter也不把 `expectedTurnId`传给 native。接受只证明 native选用mode的inbox admission，不能证明严格向saved turn steering。必须在连接合同里明确该保证缺失，不能发明CAS。已有[actual pinned upstream验收](../reviews/harness-backend.md)覆盖共享执行、队列/steer及断流不重放；不代表本研究新typed proof、crash durability或全部版本已验收。

## 8. WorkBuddy：持久映射必须先于 snapshot

### 8.1 实际调用及并非完成 ACK 的结果

P-WB 在 handle内新造native canonical v7（32hex）ID，把 `clientUserMessageId`（否则native ID）放入 options.clientRequestId，另放 `_meta["codebuddy.ai/conversationRequestId"]`。先写内存 `state.clients[native]=client`，再invoke `wb:conversations:sendPrompt(conversationId,content,options)`。Start/Steer分别指定 queueDelivery queue/steer；`expectedTurnId`没有在该input分支比较或传给native。调用成功后又 await snapshot，最后返回自造 `turn:{id:native,status:"inProgress"}` 与 receipt.disposition（P 1421–1439）。这些turn/status为 adapter合成，不能作为native StartACK。

W-artifact `main/conversations.js.formatted` 的链：

| 行 | 真实可见行为及含义 |
| --- | --- |
| 2905–2938 | 生成v7、canonical conversationRequestId metadata读取/重用，不合法会另生成。I02b必须传L的合法值并核对原生实际记录，不能让重写身份被忽略 |
| 23352–23454 | busy/client-owned queue分支 enqueue，记acceptedInputHistory，并可能后台drain/auto-steer；正常返回void；queue-full/runtime-config-changing有errorCode |
| 23465–23490 | idle/direct先记acceptedInputHistory，再调用dispatchPrompt(...).then(...)，**不 await dispatch完成**，失败可能只记log；sendPrompt返回不证明下游执行入口已接受 |
| 33950–33967 | Conversations服务在 `_expectQueueReceipt + clientRequestId` 时对比前后queue item，可返回 `{disposition:"queued",item}`；否则仍可能void |
| 35366–35379 | 另一个 facade可吸收queued receipt到本地queue投影并返回void；不能假定所有preload路径都会原样传回receipt |
| 25721–25740,25829–25849 | native `clientRequestId`增强映射除exact request ID外还有contentKey/唯一新增项fallback，除非matchByRequestIdOnly。因此r.clientRequestId也不能不加核查地升级为严格身份证明 |
| 16693–16717,17334–17365 | latest requests混合历史与实时assembler；不是纯持久接受查询。cursor omission语义已另验，不用显式null切断live内容来伪造稳定结果 |
| 8811–8840,8872–8885 | assembler可绑定/重命名protocol request身份；只看到匹配request ID必须继续说明来源与状态，而非猜成engine item |

以上是静态路径及未知动态分派的保守分析，不声称每个实际安装调用都走全部facade。P `Carrier::invoke` 明确排除 `__wbError`/`errorCode`，但其它null/void并没有成功receipt结构约束（325–368）；CDP Runtime.evaluate返回只表明调用表达式返回。即便取得真实queued receipt，最多证明对应native队列接受；不能称已开始/完成。若没有能确认精确输入的receipt或原生request记录，保持uncertain。

### 8.2 durable mapping 与读取时机

当前 `Projection::new` clients为空（P 565–575）；首次attach在创建bridge/Runtime前已snapshot并emit（1077–1086）。同Arc重连复制内存clients给new_state，再snapshot（1128–1130）；整个服务重启则丢映射。records投影只按 `self.clients.get(r.id)`补client（640），不直接信任原生增强的r.clientRequestId，这是当前较保守的选择。后补映射仍可能来不及：`seen[r.id]=digest(record)`已去重，稳定record未变就不会重新发（601–609）。UI旧缓存修复不等于operation关联已恢复。

I02b需要以下顺序，不能只在下一次send时补：

```text
app.session授权 + Store identity/session/thread校验
    → 读该绑定的持久native_request_id ↔ client_user_message_id ↔ operation/attempt
    → 创建/重新绑定Projection（先装入有界映射）
    → 才允许初始/reconnect snapshot读取、raw proof提取、历史/media/child投影
    → 确切claim提交后，input invoke使用该saved native ID（不再new ID）
    → 原生receipt/proof独立保存；snapshot错误不覆盖先前结果
```

映射是I02唯一权威的受限只读投影，不另建可重放journal；按授权session/Agent/selectednativeconversation查询，不全库扫描event。历史operation关联也需分页/预算和按ID恢复，不只装未完成项后声称所有旧富文本已关联。map载入失败、identity不符、已用ID/tombstone/绑定变更必须停止该次资格，不能退回现场造ID、text/time匹配或信任native模糊client增强。attach side effect与安装时机遵循生命周期合同；不能先emit后补Proof。

若原生send已经返回但后续snapshot（history/materialize/pending/child任何一步）失败，当前 `handle`整体Err（1436），实际可能已接受。将来必须保留分阶段outcome，不能把这个Err变为NativeExplicit rejection，也不能为了“拿到反馈”再send。`historyReady:false`、受限分页或没有该项都不是权威未接受。原生protocol ID若经canonical alias转换，只能使用已验证原生映射，不能猜测永久等于r.id。若raw snapshot出现精确saved native request，仍需确认不是acceptedInputHistory、queue optimistic view、fallback placeholder；建议新增 `WorkBuddyRequestObserved` typed evidence，以真实conversation/native request身份和可核来源/状态为核心，不拿 `native_item_id="<request>:user"`满足L。queued-only证据需单独`WorkBuddyQueueAdmission`候选，验证exact item/sendOptions metadata；清楚区分本机queue接受和原生request执行接受。真实preload/engine边界、重启后readback仍未完成验收，不在本轮批准这两个类型。

WorkBuddy辅助会话继续只读（P 1245–1259、L can_send 894–899），不能为补proof调用其sendPrompt。原生请求ID格式可重用不等于原生重试幂等；不使用native runPrompt/getRequestByClientRequestId或新增CDP任意eval绕过既有allowlist。既有[WorkBuddy原生记录](workbuddy.md#completion-gates)仅证明隔离preload/list与只读snapshot等，真实账号初始化后的creation/send/approval写验收仍开放。

## 9. custom plugin 与接口扩展归属

P `main.rs:340–350` 载入plugin manifest只检查protocol_version=1；P-SDK 20–31的capabilities字符串没有receipt schema、原生request provenance或版本协商。自定义stdio peer可以随意返回 `{accepted:true}`、`turnId`，甚至回送原样client ID。不能把该值拿去实例化Codex/Harness receipt。I02b应明确“该adapter的operation proof协议不支持/未知”，既有legacy接口的兼容与升级行为按消息合同处理，不静默宣称ledger-backed可靠发送。

建议由I02b在一个经独立评审的Store/API/adapter合同中扩展证据，不由SDK A、capability projection、Web或本文自行扩大：

| 候选typed evidence | 必备来源/绑定 | 当前决定 |
| --- | --- | --- |
| NativeUserItemObserved | 可信raw native来源，exactthread/client/item，实际turn可选；与当前attempt/代次关联 | 保留L保守路线，禁止从UI/synthetic来源生成 |
| HarnessInboxAck | pinned session/prompt语义、验证response相关、immutable request/session/mode、attempt与受验证peer | 源码支持提案；需Store类型迁移、adapter真实HTTP故障验收，不是通用bridgeACK |
| CodexStartAck / CodexSteerAck | 分别具体method的权威原生规范/实现、受支持version、同请求结果相关、真实returnedturn；Steer核exactexpectedturn | schema只证shape，当前证据不足以批准ACK-only接受；先等observeditem |
| DesktopOwnerAck | follower owner/request/method/version关联，加完整manager→native结果证明；不得混approvals/settings ok | 尚缺完整Start链及callerexpectedturn保证；不能仅unwrap成功就批准 |
| WorkBuddyRequestObserved / QueueAdmission | 分清native request/queue item，exactsavedmetadata、可核原生provenance与disposition，非内容fallback | 实验提案，必须补真实native写与重启证据，不扩大支持标签 |

建议保留统一业务outcome（accepted/rejected/uncertain/recording_failure），其accepted证据为tagged union；每个variant须有独立来源验证和不变量。没有证据不调用record_input_accepted；取得raw结果但Store写失败不向Web宣告durableaccepted。既有acceptedinput不为goal或snapshot重投。raw peer/control secret、CDP URL、cookie、账号、prompt全文不进入公开诊断；receipt只持最小允许字段，不能存任意native JSON。

## 10. I02b 必须在调用前持久保存的数据

| 数据 | 持久/边界要求 |
| --- | --- |
| store_id/incarnation、operation ID、canonical envelope/hash/version、session/Agent/native thread绑定 | L已有；重试用同envelope，不重新从editor生成；lookup错误/healthfence非absence |
| client_user_message_id、WorkBuddy native_request_id | L已有，所有输入必须传。native ID必须在初始snapshot proof提取前可读取，且不能被每次handle重建 |
| preparation claim/receipt、附件冻结manifest/bytes证明、native upload/thread结果 | 分步骤持久，不能为拿proof重复upload/create/resume；L只校验manifest，不证明文件bytes已copy/hash/ACL |
| dispatchauthority、actualroute、expectedturn、attempt | L已有；权限资格与native事实分离，worker不能借Steer或改origin越过FIFO/pause |
| adapterproofcontract/version、selectedconnection/peer/owner关联、具体native方法与参数身份、response的相关性 | I02b需补受控typed关联。连接内rpc号不是durableoperation；owner/localgeneration不是nativeboot；字段不可得明确unknown，不自造 |
| 具体outcome evidence、nativeitem/request/turn、nativequeue disposition、input/goal分阶段结果 | 原子Store结果与echo；晚到真实proof可reconcile同ID，不授权第二input。snapshotrefresh错误须独立于已取得receipt |

绑定验证必须在最终调用处复查；在UI读到状态或在准备前拿到Arc不能代替最终资格。其锁序、setup取消、事件epoch与auto-response等直接引用[生命周期设计](../../runtime-lifecycle.md)，本研究不另给并行实现。

## 11. 后续验收方案：本轮没有执行

以下是未来生产HTTP/SQLite + 真实fake transport端点的负例设计，不是本轮测试结果。计数分开记录 AnyWork input资格、native method调用次数、原生已接受输入数、upload/threadprep次数。除非明确为前置拒绝，不把socket写尝试数等同native已接受数；每项只使用私有data/端口/fixture，不向真实Agent发送。

| 场景 | 必须断言的输入计数及结果 |
| --- | --- |
| 同ID两客户端并发与late重复（各支持transport） | 一个DispatchPermit、一个input invoke、native接受1；changedenvelope/scope/旧incarnation资格0、输入0；重复查询不再prepare |
| stdio partialwrite / Unix writerenqueue后断流 | scripted端记录实际完整帧0或1，结果unknown且重复同ID新增input0；不能仅因sendErr报not_sent。随后exact-client原始项将同ID收敛，native接受仍最多1 |
| native已接受1但reply丢失/lateSDK reply waiter已删 | 重新HTTP/重启不得增加第2次input；晚raw item与reconnectread同一operation原子accepted；本地echo不得自证 |
| Codex仅turn.id/SteerturnId或缺clientID | 当前L不被虚构item填充，acceptedcommit0、uncertain1；同text的不同client item不匹配。真raw item到来后acceptedcommit1，input总数1 |
| Codex raw wrongthread/client/item/expectedturn/旧peer | 当前operation不可被别项接受；不为了修正再次input。若实际输入已被别turn接受，保留事实与routeconflict，不假报未发送 |
| Desktop bridgeacceptedOk+nativeerror/nullresult | adapter method处理次数1不等于accepted1；只有明确preinvoke拒绝才nativeinput0。乐观desktop-user/steering项和unconfirmed不能令acceptedcommit发生 |
| Desktop owner/target/method/streamrevision错、gap后旧ACK | preinvoke失败则input0；已invoke后错reply则unknown，自动重放0。新owner snapshot不解除旧operation；返回不同turn必须显式核对/报告 |
| Desktop native mismatch内部重试 | 分别模型化已验证的首次明确拒绝、首次unknown、helper错分三种。首种记录follower调用1、app-server尝试2、实际接受1，并检查两次client/input及changedturn；后两种I02b不得授权重投/改savedturn。无安全转发合同则bridge资格0，不靠放宽合同令测试变绿。分别计外层、底层尝试与接受数；不能用一个adapterRPC代替native计数 |
| Harness acceptedtrue且inbox未执行 | prompt调用1、nativeinbox接受1、acceptedinputcommit1但completed0；不用harness-user/turn组合ID；无准许typedACK时保持uncertain等rawnativeproof |
| Harness okfalse/500/错误rpcId/acceptedfalse/丢reply | 明确beforeadmission拒绝fixture接受0；已admit再500/错reply则接受1+unknown。任意自动重试新增prompt0。读取匹配source.rpcId的真实inbox/user可恢复；父session继承项不匹配child |
| Harness upload成功、prompt未invoke或结果未知 | upload按claim仅1；前置故障prompt0；prompt后未知总prompt1。任何重复原ID均不第二次upload，也不新requestId |
| WorkBuddy void/queued/未知disposition、原生errorwrapper | sendPrompt调用1，但void不伪造nativeitem；queued单独表达且started0。preinvoke拒绝的fixture接受0；async派发失败的void仍unknown，不给acceptedengine证明 |
| WorkBuddy原生接受后snapshot的history/media/pending/child逐点失败 | sendPrompt总1；取得的nativeoutcome不被snapshotErr改成未发送。后续恢复只读，不重复send；Store保存失败产生recordingfailure与fence |
| WorkBuddy crash/restart与首次snapshot先到 | dispatch前savednative/clientmapping可读；新Projection在读取前hydrate；send总1、same-ID user关联唯一。stable记录digest不变也不能丢关联；映射查询失败或绑定不符则新增input0 |
| WorkBuddy samecontent两request/增强clientfallback/旧peer记录 | 只按savedcanonicalnativeID与可信来源匹配，错误项acceptedcommit0；不使用text/time/only-new-record。辅助会话资格0、sendPrompt0 |
| 三种DispatchAuthority、paused非头与editorhead | worker不能用Steer或冒manual越FIFO；明确manual可idleStart/activeSteer，各只1permit/1invoke。保持pause/editor/其他row，无资格分支input0 |
| resultStore FULL/queryonly/lock、goal失败、同IDreload | nativeinput1后result故障仍1，保留knownfence/uncertainty；新相关input0直到verifiedrecovery及exactreconcile；goal失败不增加输入数 |
| customplugin伪造accepted/turn/item与fakeversion | 未批准的proofvariant不能激活ledger支持或acceptedcommit；不能靠manifestchat/SDKsendOk升级能力。若legacy调用发生，必须按其公开legacy边界报告，不能混称可靠新协议 |

## 12. 研究完成与仍待决定

本轮执行的检查只有源码/参考文件逐行读取、Git revision及差异核对、SHA-256、REA指定单文件静态解析、文档diff检查。未执行上表任何新测试。现有fake证据包括P `scripts/desktop-host-http-test.py:1–7,219–229` 的framed fakeowner和 `scripts/workbuddy-carrier-test.mjs:54–61` 在fixturesend后直接造原生形状record；它们不能证明实际WorkBuddy asyncdispatch成功。Harness已有actualupstream本地模型验收是历史独立证据，非本轮重跑；Codex/WorkBuddy本轮没有新增nativewrite证据。

进入I02b之前建议root先固定：哪些transport采用保守observeditem，是否单独接受HarnessInboxAck合同；WorkBuddy是否保持experimental并等待真实request证明，Desktop严格expectedturn语义如何表达/限制；何时由同一I02b owner接管savednativeID→snapshot→inputproof完整链。任何typedStore扩展都需source+真实fakeendpoint+独立验收后才启用。本文通过仅表示研究输入可用，不代表协议、native、Web、平台或完整I02/I03完成。
