# I07b 原生连接观测与关键错误调用链研究

状态：分析提案已通过[独立评审 `42ed133`](../reviews/improvement-capability-observations.md)，无阻塞发现；字段命名澄清已纳入。源码基线为 `aacaa19b98314976b34e91f11c12326c6ad6ad7c`，研究日期 2026-11-07。本文只读取源码和既有契约；没有编译、安装、运行产品测试、连接真实 Agent、读取账号凭据或修改运行服务。下文“现状”是该基线的事实，“建议”不是已实现能力，b1 仍需明确实施契约。

依据：[能力契约](../../capability-projection.md)、[I07a 模块及验收边界](../../capability-projection-module.md)、[支持矩阵](../../support-matrix.md)、[消息操作契约](../../message-operations.md)、[I02a ledger](../tasks/improvement-message-ledger.md)、[I02b delivery](../tasks/improvement-message-delivery.md)、[项目评审 I07/I08/I10/I11](../../project-improvement-review.md#7-agent-协作与兼容)。任务正文由 root 在主工作树提供；本分析没有修改中央契约、任务或进度。

另只读核对了 root 提交 `698b7de` 及澄清提交 `d72ab1d` 的 `docs/plan/analysis/storage-degradation.md`，其独立分析评审记录为 `9040174`。它仍是 I03 design input，并非本基线中已实现的健康协议。下述接口分工与其协调；不复制其存储健康状态机或响应持久化设计。

## 1. 结论与最小下一步

I07a 把原生 readiness 保持 `unknown` 是正确的。目前不存在可以直接接入投影、同时证明身份、版本、连接代次和新鲜度的统一观测。不能将 `Arc<Runtime>`、会话 `status`、manifest、descriptor 可解析或最近一次模型列表成功升级为“现在可以写”。

建议先交付 **I07b1：连接生命周期观测与旧代次隔离**，再交付 **I07b2：受控关键错误保真**，最后才由独立任务接入 capabilities 与 Web。b1 不启用原生按钮、不新增 native probe、不创建第二份消息 journal；b2 的消息准备/发送边界由 I02b 负责，不能两个任务各自改出一套 dispatch 逻辑。

首要缺口及其影响：

| 缺口 | 实际证据 | 实施含义 |
| --- | --- | --- |
| SDK 没有可订阅的连接身份/关闭/代次；错误被字符串化 | [RpcProcess 字段与 bridge](../../../crates/agent-sdk/src/lib.rs#L44)、[stdio 接收](../../../crates/agent-sdk/src/lib.rs#L106)、[Unix 接收](../../../crates/agent-sdk/src/lib.rs#L184) | 从 transport/adapter 原点产生 typed receipt；不要在 HTTP 读端猜测 |
| Runtime 插入与事件处理没有完整代次保护 | [ensure_runtime](../../../crates/server/src/runtime.rs#L74)、[事件循环](../../../crates/server/src/runtime.rs#L140) | 在任何投影、持久化、自动响应之前确认当前绑定；同 thread 不等于同 generation |
| 同一 Runtime 内仍可能更换原生 peer | [Harness 重连](../../../crates/server/src/harness.rs#L522)、[WorkBuddy 重连](../../../crates/server/src/workbuddy.rs#L1117) | 至少分开 runtime 安装代次和 adapter peer 代次；不能仅用 Arc 比较 |
| 已校验身份/版本未作为证明保留 | [control::connect_owner](../../../crates/server/src/control.rs#L72)、[WorkBuddy connect](../../../crates/server/src/workbuddy.rs#L109) | 保留字段来源、证明强度和缺失值；descriptor UUID/PID 不单独证明原生 boot |
| 部分 GET 仍会建立原生执行入口或写缓存 | [composer::read](../../../crates/server/src/composer.rs#L179)、[catalog::read_history](../../../crates/server/src/catalog.rs#L645) | 新纯读投影不得复用这些路径；将来显式诊断另立合同 |
| 旧客户端把缺字段当兼容可用、错误只保留文案 | [Agent 选择](../../../web/src/sessionAgentSelection.ts#L14)、[Api.request](../../../web/src/api.ts#L26) | 迁移需显式旧协议状态；不能静默全面替换或声称 Web 已统一 |

WorkBuddy 共享写入继续标为实验。连接观测或 fake 测试通过，都不关闭真实创建、发送、审批、取消、附件与重连的原生验收缺口。Codex 多 owner 消歧、原生无 CAS 竞态、版本支持生命周期也不由本模块顺带宣告解决。

## 2. 状态与权威边界

```text
受控 transport / adapter
  ├─ transport 关闭、合法帧、请求阶段
  ├─ 身份/版本验证结果、peer 代次、快照同步状态
  └─ 当前交互 occurrence / 所属 turn
             │ typed 内存 receipt（非 AgentEvent）
             ▼
Runtime 安装/绑定 + 当前代次比较
  ├─ 事件 → 受控投影/Store/自动响应（先验证代次）
  └─ 有界、仅内存 observation snapshot
             │ app.session 先鉴权；不 probe / import / resume
             ▼
I07a capability projection → 后续统一 Web consumer

I02 ledger ── operation / preparation / dispatch / result 的持久权威
      ▲                    ▲
      └─ typed command outcome；观测重连不能把 unknown 变成可重发
```

必须区分四类身份：AnyWork session/thread 映射；本地 Runtime 安装代次；adapter 当前连接/订阅代次；原生实例/版本身份。前两者可以由 AnyWork 生成，后两者必须说明证据来源。自造 UUID 是本地代次，不是原生 boot ID。原生版本未知时返回未知，不用 AnyWork 包版本或 launcher 文档版本补齐。

历史来源 key 和持久事件 seq 用于转录去重/恢复，不能作为当前连接或审批 occurrence 证明。AnyWork 操作 ID、native request ID、SDK JSON-RPC request number 同样不能互换。

## 3. SDK 与 Runtime 共用链

### 3.1 SDK transport 与错误丢失点

[RpcProcess](../../../crates/agent-sdk/src/lib.rs#L44) 只有 input、可拥有的 child、pending 和 next_id。`PluginManifest.protocol_version=1` 是 AnyWork 插件协议，不是 Codex/Harness/WorkBuddy 原生版本。

| transport | 创建与帧处理 | 关闭和可信范围 | 现有错误转换 |
| --- | --- | --- | --- |
| owned stdio | `RpcProcess::spawn` 校验插件协议后启动配置命令，读取逐行 JSON | EOF/read 错误清空 pending、发 `plugin/exited`；拥有子进程；无关闭 watch / frame 时间 | 原生 JSON error → `anyhow!("{error}")`；spawn OS 错误不证明账户未登录；malformed JSON 仅警告 |
| Unix WebSocket | `connect_unix` 有 5 秒连接/握手限制；外部进程不归 AnyWork 所有 | 关闭清空 pending、发 exited；transport 本身不校验 thread/home | JSON error 同样字符串化；坏 JSON 被忽略，不能计作有效身份/新鲜度 |
| in-process bridge | `bridge` 用内部 request/accepted 和 response channel | 所有 response sender drop 后清空 pending、发 exited | bridge error envelope 被字符串化；`accepted` 名称不能解读成通用 native input accepted |

[send/call](../../../crates/agent-sdk/src/lib.rs#L246)：stdio `write_all` / 换行 / flush 可能部分写入后失败；socket `tx.send` 仅本地入队；bridge send 等待最多 90 秒。`call` 先登记本地递增 ID，再 send，再等最多 90 秒结果；超时/失败会删除 pending，迟到回复不能自动恢复被丢弃的 waiter。不能把“没有收到成功”映射成“未发送”。所有 transport 的 after-dispatch 未分类错误都应保留 unknown。

尤其不能将 `send Ok(())` 统一叫作 native ack：stdio 只到 writer 的 write/flush；Unix socket 只到无界 writer queue，尚无 wire/flush 证明；bridge 等到 adapter 的 accepted oneshot，但该回执含义取决于具体方法，仍需检查原生结果。手动和 auto approval 使用的是 `send`，不能由它的 Ok 一律推导原生已经回答。后续 typed 阶段至少区分 before-dispatch、local-enqueued、wire-attempted 与 definitive native receipt；队列接收后断线或部分写失败都是 unknown，不是自动重发资格。

建议保留现有 JSON-RPC 兼容 envelope，增加内部 typed transport receipt/closure watch。bridge 必须传递受控 error kind 或 side-channel typed result，否则只在 adapter 中创建 Rust error、随后 JSON 字符串化，HTTP 仍无法识别。不要把生命周期 receipt 包装成伪 AgentEvent 再让历史 parser 解析。

### 3.2 Runtime 创建、安装及所有调用者

[ensure_runtime](../../../crates/server/src/runtime.rs#L74) 首先查 map；查不到即 attach/spawn、initialize、thread resume/start、写 thread 映射、插入 runtime。map mutex 未跨创建 await 持有，函数本身没有 singleflight；它依赖调用者 gate，但没有 lock token 或强制契约。`initialize` 的返回体被丢弃；仅 resume/start 的模型、思考强度、协作模式、tier 被保留。现有 owned Codex “missing empty rollout” 的窄 fallback 由 Agent、非 external、resume、明确消息、无 turn history 共同限制，应保留，不扩展成通用 not-found 重建。

全量 `ensure_runtime` 调用 inventory（该基线全目录检索）：

| 入口 | 是否持 `app.gate(session)` | 注意事项 |
| --- | --- | --- |
| [api::create](../../../crates/server/src/api.rs#L167) → ensure | **未持有**；先保存新 UUID session | UUID 一般唯一，但保存后已有发现窗口；不能依赖“通常无人并发”作为模块约束 |
| [shared_host::create](../../../crates/server/src/shared_host.rs#L30) 的 Harness 指定模型分支 | **未持有** | native 创建后保存 session，再 ensure/update；后续准备/创建副作用归 I02 合同 |
| [api::message](../../../crates/server/src/api.rs#L306) → busy 检查、enqueue / deliver | 持有 | deliver 本身不锁；它的两个现有入口分别是 message 和已持锁的 send_queued |
| [api::interrupt](../../../crates/server/src/api.rs#L607)、[connect](../../../crates/server/src/api.rs#L672) | 持有 | interrupt 自管走 existing map；external ensure；connect 的历史模式仍返回 200 显式 `connected:false` |
| [api::models](../../../crates/server/src/api.rs#L903) | managed ensure 时持有；调用模型 RPC 前释放 | shared-host 仅 existing Arc、无 gate；external Codex 转 catalog，不 ensure |
| [queue_action](../../../crates/server/src/api.rs#L952) replace/unpause | 持有 | take/restore/edit/delete 等部分纯本地动作不 ensure；不能统一要求 native online |
| [composer::read](../../../crates/server/src/composer.rs#L179) | managed ensure 时持有、后续 IO 前释放 | shared-host existing 分支无 gate；external 无 runtime 或 archive 转 catalog；不是能力纯读来源 |
| [composer::update](../../../crates/server/src/composer.rs#L349) | 持有 | shared settings 和其他模型/计划/目标路径；保留 adapter guards |
| [editing::get/post](../../../crates/server/src/editing.rs#L347) | 持有；post 将 owned guard 移入 detached task | 编辑目标读取也可能 ensure；编辑自有 journal 仍由 editing 管理 |
| [catalog::read_history](../../../crates/server/src/catalog.rs#L645) shared 无 runtime、无缓存且无被动历史 | fallback ensure 时持有 | 其他历史分支可以导入/写缓存；不能复用作能力 GET |

[queue worker](../../../crates/server/src/api.rs#L1066) 每秒 try_lock gate，要求既有 runtime，读 idle 后 send_queued；它不 cold-ensure 以避免重启后自动继续 managed turn。`respond`、history detail、shared model/composer reads 等不调用 ensure，但会抓取 existing Arc 后异步执行，是完整“当前连接”检查的额外消费者。

建议 b1 在 Runtime 模块内部建立每 session 的创建资格：采用内部 singleflight 或显式不可伪造的 gate token 二选一，不能简单在 ensure 再获取同一不可重入 gate造成死锁。处理 setup cancellation/失败必须关闭本次 owned transport、撤销本次资格，不能留下已经被替换却仍能更新 Store 的 actor。不同 session 指向同一 native thread 的互斥/交付 fence 属 I02/I11，单 session singleflight不够证明跨映射原子性。

### 3.3 旧代次污染覆盖整个事件循环

[事件循环](../../../crates/server/src/runtime.rs#L140) 仅 `session_thread_mismatch` 过滤明显异 thread。缺 thread 的事件也可通过；同 thread 的旧 peer 更会通过。`app.emit` 在 match 之前执行，随后更新 settings/turn/Store status、处理请求和自动审批。`plugin/exited` 只在移除 map 时检查 `Arc::ptr_eq`，**之后仍无条件写 disconnected**。循环自然结束只有 notify，不保证移除 map或标记关闭。

因此旧代次保护必须在下列所有副作用之前成立，不能只给 exited 分支打补丁：

1. `app.emit` 的事件持久化、composer metadata 增补和唤醒；
2. `rt.settings` / `rt.turn` 与 Store status 的更新；
3. pending request 发布/解析、自动策略读取、发送自动响应及 resolved 发布；
4. detach/closed 导致的 runtime map 删除与状态变化；
5. adapter attach 阶段直接执行的初始历史/status 写入（Harness/WB 在 runtime 安装前已 `app.emit`）。

需要统一绑定比较和受控提交点，而不是“先 compare，解锁，再 await，然后无条件 commit”。等待 gate/Store/RPC 期间可能被替换，提交/发命令前还要再检查。允许旧 actor做自己的安全资源清理，不能操作新代次数据。避免持有 runtime-map mutex 跨 native IO；设计锁顺序与 snapshot compare-and-commit，独立验证取消/删除/重连竞态。

自动审批仅对 owned+auto 生效的现有规则保持不变。新观测不能替外部桌面改权限。Store request 未解决也不证明它属于当前连接；需要 occurrence 和代次匹配。`serverRequest/resolved` 若携带 connection_lost/native_changed 只是使旧 UI 按钮失效，不是原生已回答证明。

## 4. 各拓扑的实际证据与缺口

### 4.1 AnyWork 自管 Codex

链：manifest → SDK owned child → initialize/initialized → thread/start 或 resume → Runtime → stdio events → EOF/exited。

[Codex manifest](../../../crates/agent-codex/src/lib.rs#L5) 声明 chat/models/approval 等；这是实现声明。spawn 成功只证明本机创建过指定命令；initialize 成功证明当时该 peer能应答该协议；当前没有提取、验证、持久保留原生 app-server 版本/boot ID。resume/start 仅强制返回 thread ID，Runtime不进行共享入口那样的 home/cwd 验证。命令参数仍按已保存策略与 thread_options 设置；不能把 owned身份自动等同所有未来 Codex版本都支持 goal/plan/edit。

建议：为 owned process 分配本地安装/连接代次，保留受控 initialize字段及来源；只在已明确认识的字段存在时填 native version，未知不猜。child PID只是本地诊断关联、不能直接公开或当持久实例 ID。进程生命周期与合法协议帧分别更新 transport/identity观察；退出同步失效。native support 版本表仍由 I08 和支持矩阵维护。

### 4.2 共享 Unix Codex 引擎

[connect_owner](../../../crates/server/src/control.rs#L72) 优先桌面 follower，只有 typed `NoOwner` 允许继续其他注册入口；其它 transport/snapshot/identity失败不降级为第二个执行进程。候选 socket检查文件类型/UID；初始化若返回 codexHome则检查 canonical home；thread/read 检查 exact thread、guardian 排除、目录 scope、cwd equality。`codexHome` 缺失时并未强制拒绝，不能报告“已验证 home”。SDK Unix transport没有桌面 IPC那套 peer_cred/私有目录证明；不要把两条链的安全强度混写。

返回 `(rpc, events, desktop=false)` 丢失了逐项身份证据、选中 owner信息和初始化版本。第一个 loaded host即返回；cold选择另有 writer检查。I11 多 owner收集消歧尚未实现，所以观测不能宣称 `unique_owner_verified=true`。建议可记录“该连接的thread/cwd已验证，owner唯一性未知”，在严格支持策略要求唯一性时继续拒绝 `allowed_now`，不要用新 UUID掩盖原缺口。

恢复和初始化仍可能有原生副作用；不能把重连作为 capability GET内部动作。候选变化、peer关闭、版本/身份校验失败都使本次连接观测失效；无需杀外部进程。

### 4.3 Codex 桌面 follower

[desktop_ipc::Client::connect](../../../crates/server/src/desktop_ipc.rs#L45) 实际校验 socket/父目录 owner与权限、peer credential UID，initialize获取非空 clientId。`request` 校验 success/method、targeted reply的 handledByClientId。pending相关 UUID和关闭 watch已存在，但 Client没向 Runtime暴露 typed receipt。

[desktop::connect](../../../crates/server/src/desktop.rs#L86) discovery v1找到 owner；follow获取 stream v11；`stream_identity`校验 owner/source、conversation、host=local及目标 client；[Snapshot](../../../crates/server/src/desktop_state.rs#L14)验证 thread/canonical cwd、turn/request结构，patch要求baseRevision精确且前进后原子替换。Adapter epoch是本地实例 UUID，不是原生桌面 boot ID。owner clientID、stream协议、snapshot revision及同步状态是可以保留的细粒度证据，不能把 v11当应用版本。

[stream loop](../../../crates/server/src/desktop.rs#L170) 对owner离线、版本不符、patch错误采取断开/重同步；busy或unsynced时周期请求快照，pending resnapshot有10秒期限。关闭标记snapshot不同步、解决旧Web请求、发 exited、unfollow并关闭自有IPC连接。静态sidebar [Statuses](../../../crates/server/src/desktop_observer.rs#L12)只存状态和时间、12秒过期，是UI运行提示，不含控制连接身份/写能力，不得拿来启用写。

[owner_request](../../../crates/server/src/desktop.rs#L343) 对不同步状态typed拒绝；非明确拒绝会置`uncertain`，阻止当前连接后续mutation。`native`保留mutation mutex、thread校验和现有支持方法allowlist。[respond](../../../crates/server/src/desktop.rs#L720)检查本代pending对象、current snapshot、answered保留以及受支持交互；Web ID为epoch+freshUUID。仅明确`Rejected`才回退answered。必须保留这些保护。

能力分开：目标get/pause已适配，set/clear其它写被拒绝；pause可中断当前执行，不是纯目标字段写。状态read成功不证明创建/恢复/编辑/清除目标。`uncertain`不能因新观测read成功自动清空，也不能用重连清除来鼓励旧动作重发。

### 4.4 DeepSeek Harness gateway

[Config](../../../crates/server/src/harness.rs#L26)要求loopback HTTP/root、launch token或私有descriptor；descriptor版本1是发现格式，不是gateway版本。`available`只检查显式配置/descriptor可解释，未连接。 [connect](../../../crates/server/src/harness.rs#L167)先用token换302+cookie，再WebSocket API peer；cookie不公开。当前未核对/保存gateway应用版本或host boot身份；文档支持0.2.2-rc.1不等于运行peer已证明该版本。

[attach](../../../crates/server/src/harness.rs#L456) follow snapshot校验header sessionID，读取历史、baseline并建立bridge。`Carrier::call`有rpcId和result.ok校验、response预算；HTTP成功或cookie只证明当时会话API可用，不提供所有动作支持。nativeHTTP错误/ok=false被flatten，未知服务错误不能按文案决定未执行。

断流先invalidate pending与interaction client，再发interrupted；当前Runtime内每秒重建peer，只重连读、不重放mutation。重连follow返回的snapshot再次检查thread，baseline后发status。建议观测在断流立即失效，新peer generation在connect时创建，**必须等已验证快照/交互ready后按字段发布**，不能在TCP/WS接通就恢复旧writable。`Projection.event_client`来自`$events ready.clientId`，只证明交互流关联，不是host boot/version；当前ready分支直接覆盖它，未显式处理同peer第二个不同clientId时已有pending的失效，后续应有负例。

[interaction_id/response](../../../crates/server/src/harness.rs#L982)将clientId+eventId作为本地交互身份，限制agentId和一次allow/reject；断线会resolved。不能凭持久审批事件恢复按钮。Harness `session/prompt`要求accepted=true并保留clientUserMessageId映射；start/steer nativemode分别queue/steer。localFile准备会先调用fileUploads/upload，是I02准备副作用；即使prompt未发，失败也不能笼统报告“没有任何原生副作用”。目标/计划/tier/edit/fork仍不支持。

### 4.5 WorkBuddy Desktop 5.9.3

[descriptor/connect](../../../crates/server/src/workbuddy.rs#L26)读取私有且非symlink描述，严格5.9.3、有效PID/UUID/configDir/browserId；live `/json/version`核对同源browser path；从`/json/list`选唯一file-backed主renderer，再连接同源page WebSocket；preload验证invoke/eventBridge函数、appVersion、configDir。不能放宽版本、支持任意CDP target、用账号页面或绕登录。

重要区分：descriptor instance_id/PID通过格式校验，并没有与renderer返回的同名boot ID/PID作live equality；live证明的是browserID路径、受控target、preload版本/configDir。Carrier只保存commands sender，丢弃了上述receipt。不能声称“原生instance_id已由握手认证”；可保留它为discovery claim并明确强度，public `native_instance` 继续 unknown。如需表达本地连接身份，使用另名 `connection_binding`，不能将自造 UUID 填入原生实例字段。

[Carrier](../../../crates/server/src/workbuddy.rs#L281)拥有CDPactor，发送Runtime.evaluate、30秒等待；CDP异常映射通用失败，关闭清pending，未暴露watch。`invoke`固定allowlist、原生错误code白名单、source白名单并隐藏raw account/provider对象，但最后`bail!`将这些结构化code变成字符串。建议在这一受控边界保留typed kind/source；例如UNAUTHORIZED是该operation返回的受控错误，不能进一步猜为“全局未登录”或安全重试。

[attach/snapshot](../../../crates/server/src/workbuddy.rs#L1020)主会话验证nativeID和local transport；500ms快照投影records/pending/children。generation由Projection::new创建；pending ID包含thread/generation/nativeID/freshUUID且绑定active turn。回答前刷新snapshot、复查pending exact对象；cancel前复查active turn，但native cancel只有conversationID，仍无原子expected-turn保证。[重连](../../../crates/server/src/workbuddy.rs#L1117)建立新Carrier+Projection并全量snapshot，保留clients内存映射，绝不重发命令。

单独身份缺口：重连分支直接`connect + snapshot`，没有复用最初主会话`conversations:get`的local-transport/identity检查。下一模块应统一peer绑定资格，覆盖每次重连；不要仅因records可读就把它认作可写原会话。auxiliary使用结构化child reference和专用read channels；[handle](../../../crates/server/src/workbuddy.rs#L1149)硬拒绝其它操作，Web [ComposerAccess](../../../web/src/components/ComposerAccess.tsx#L4)挂载前也拒绝。auxiliary不会因parent在线而获得写能力。

sendPrompt会先生成native v7 ID、记录clients映射，再调用原生，以防echo先于receipt。此映射现在仅内存；[I02b](../tasks/improvement-message-delivery.md)应在dispatch之前持久保存native ID/clientID与intent，观测缓存不承担这项工作。`nativeDisposition`来自实际receipt，不可把native queued/handoff称作started/completed；snapshot刷新失败也不能否认先前input可能已被接受。模型设置model+effort是多步，后一步失败不回滚前一步；新错误必须保留阶段/部分结果。

### 4.6 自定义插件与只读 catalog/observer

custom命令沿managed SDK链，manifest只限定插件协议1，不给运行应用身份、版本、账户或每方法支持证明。非empty command/registered/静态capability均不得生成nativeready；缺少可验证handshake schema时保持unknown。以后扩展可选receipt接口必须版本化，旧插件不补假默认值。

[CatalogRpc](../../../crates/server/src/catalog.rs#L25)偏好Observer只读方法，失败回退另起的catalog app-server；初始化结果被丢弃、events被drain。fork是catalog process上的显式mutation，另生成managed session；它不走runtime ensure。 [Observer](../../../crates/server/src/observer.rs#L52)只读allowlist、5秒timeout、失败丢socket。catalog/observer成功可说明特定历史/metadata读成功，不能证明执行owner/写连接；也不能被capabilities GET调用来刷新观测。读历史本身可导入持久事件，不是纯本地快照读取。

## 5. 命令、队列、Web 与错误全路径

### 5.1 服务端命令与错误适配

[ApiError::into_response](../../../crates/server/src/main.rs#L232)仍按英文子串决定404/403/409，其他400，body仅`error`文案。必须增量保留旧字段与显式status，不在统一化时让“pending”出现在提示里就改变结果；未迁移错误进入legacy_unclassified，不猜retryable。以下表包含不经普通message路径的消费者：

| 路径 | 原生动作/本地记录与现有error出口 | 后续owner |
| --- | --- | --- |
| create / shared create | native创建、Harness workspace/session两步、WB create；保存失败可能已有副作用；普通create ensure失败仍返回session并发error event | 创建/准备阶段接I02；不以最后HTTP状态否认副作用 |
| messages → validate → ensure → deliver | archive/aux/scope/attachment/busy前置；native start/steer后返回；owned路径会先echo、external依nativeecho，shared回传clientID | I02b统一operation；I07只供guard/error类型 |
| queue enqueue / edit / replace / pause / restore / delete | 本地Store拥有；部分入队/恢复会ensure；有edit锁和不能移除sending等规则 | localqueue离线操作各自评估，不继承native总开关 |
| send_queued / worker /手动steer | 先写sending，deliver，成功删本地行，任何Err写uncertain；worker仅既有runtime+idle | 保持保守；I02事务与typed阶段将来细分，不能仅凭新not_sent代码自动重放旧数据 |
| message goal activation | input成功后`thread/goal/set`；失败仍返回input结果+goal_error，发goal_activation_failed event | I02独立input/goal阶段；accepted input不得重发 |
| interrupt | localqueue先pause且失败会提前返回；native活跃turn查找、interrupt、最多10秒等teardown | I03后续若允许记录降级时安全interrupt，必须先设同session内存worker fence，不能直接忽略pause错误；ack后等待失败属结果未确认；WB无nativeCAS边界保留 |
| respond / owned auto approval | Store request→existing rt→SDK send，非desktop即发resolved；SDKsend不统一代表native确认 | 当前occurrence+generation及原有验证先行；审批持久记录失败属于后续I03，不伪造成功 |
| composer read/models | 部分native读取/ensure；models/shared直接existing；controlled fields和goal_error分开 | I07b不替换成probe；后续聚合错误不能让一个模型失败冒充全部unsupported |
| composer update | archive/aux/idle/catalog校验；model/effort/tier/plan/goal分别；followerpause-only | 按动作+阶段；只有read成功不推导write support |
| edit GET/POST/cancel | `EditError`独立HTTP状态；target/fingerprint→durable edit→detached execute、原有恢复journal | 保留专用journal和非CAS限制；不迁移到观测缓存 |
| fork / history detail | fork显式catalog thread/fork；WBdetail existing nativeRPC；history可readattach/import | 各自typed boundary，不能漏给统一命令inventory |
| remove / shutdown | gate后remove+close/delete；shutdown关闭各runtime/catalog | 必须使观测失效，旧actor不能复活状态；外部process不归其所有 |

相关证据：[deliver](../../../crates/server/src/api.rs#L399)、[activate_message_goal](../../../crates/server/src/api.rs#L576)、[respond](../../../crates/server/src/api.rs#L711)、[send_queued](../../../crates/server/src/api.rs#L1043)、[composer guards](../../../crates/server/src/composer.rs#L349)、[EditError](../../../crates/server/src/editing.rs#L19)、[fork](../../../crates/server/src/catalog.rs#L817)、[remove](../../../crates/server/src/api.rs#L268)、[shutdown](../../../crates/server/src/main.rs#L508)。现有 `emit` 写失败仅日志、部分status写忽略，不是typed观测就能解决；I03最小write-ahead/result fence已归I02，完整storage-degraded仍单列。

### 5.2 Web 的实际消费者

| consumer | 当前来源/缺省/错误行为 | 迁移必须保留或补齐 |
| --- | --- | --- |
| [Api.request/binary/stream](../../../web/src/api.ts#L26) | request只保留Error.message+status；binary连status也不保留；stream初始只报HTTP状态，重连交historycache | additive字段解析、未知/旧协议分支；不能将网络异常当not_sent；SSE生命周期receipt不是AgentEvent |
| [new session](../../../web/src/App.tsx#L2213)、[selection helper](../../../web/src/sessionAgentSelection.ts#L14) | catalog.available缺失兼容true；选择后可create；再次检查主要refresh配置 | 显式legacy compatibility；catalog配置不等于native当前可创建 |
| [主send](../../../web/src/App.tsx#L890) | external先connect；attached布尔缓存；scope/selectedRef拒绝迟到；body无稳定operationID；成功清draft，catch保留 | I02持久envelope与同ID恢复；不能用capability_revision代替intent ID |
| [子send](../../../web/src/components/SubagentComposer.tsx#L167) | 同messages/queue接口但独立实现；alive/revision guard；成功清draft；未显式处理goal_error | main/child同submission机制，保留晚响应防护；辅助WB永远只读 |
| [child UI](../../../web/src/components/SubagentConversation.tsx#L159)、[subagents](../../../web/src/subagents.ts#L177) | canInteract来自tool/collab/data投影；非archive则可挂载 | tool推导的canInteract不是当前连接写资格；具体child session须scope+观测绑定 |
| [SessionHistoryCache](../../../web/src/sessionHistory.ts#L315) | attach以`connected !== false`为成功，30秒尝试节流；exited清attached；interrupted没有同等清attached逻辑 | 缺字段不当新协议真；currentgeneration/stale区分，断流不重发input；保留已有分页/历史缓存 |
| [ModelPicker](../../../web/src/components/conversation/ModelPicker.tsx#L114) | composer controls + settings_available，effort/model可用性分开，version guard | 不能退化成manifest/models列表非空；busy effort规则按topology |
| [ComposerAdd](../../../web/src/components/ComposerAdd.tsx#L63)、[Composer](../../../web/src/components/conversation/Composer.tsx#L184) | 由composer的goal/plan字段，goal.create仅explicitfalse时拒绝 | 新协议unknown必须deny，旧服务器显式兼容；保持richdraft/附件 |
| [GoalBanner](../../../web/src/components/conversation/GoalBanner.tsx#L417) | post后GET确认；capability缺失时部分按钮只在explicitfalse禁用；失败文案可能建议重试 | 分开pause/resume/clear；inputaccepted+goalunknown不暗示重发，说明followerpause副作用 |
| [RequestCard](../../../web/src/components/RequestCard.tsx#L184) | event requestID发respond；本地inFlight/submitted/lifetime；error尾部有通用“请重试” | 以current occurrence/generation判断；unknown不给重发response指引 |
| [useMessageEditing](../../../web/src/hooks/useMessageEditing.ts#L167) | 已有operationID/phase/fingerprint和恢复UI；普通message不共享它 | 维持edit独立权威，typederror别抹平phase或强制自动重做 |

草稿 [useSessionDraft](../../../web/src/hooks/useSessionDraft.ts#L13)按server+session写sessionStorage+memory，goal chip另存。它不等于包含附件/准备身份的持久submission journal。本文不添加第三种草稿/操作存储；I02统一负责。

## 6. 建议模块合同（尚未实现）

### 6.1 I07b1 的输入、状态与输出

建议新增独立内存 `NativeObservations` 模块，Runtime拥有安装生命周期，adapter拥有peer生命周期，SDK拥有transportclosure/request阶段。capabilities只读它的不可变snapshot；native状态仍由native决定，Store不是活连接权威。

建议内部类型职责（名称可评审后调整）：

| 类型 | 必需信息及约束 |
| --- | --- |
| `RuntimeBinding` | session+agent+thread+canonical cwd内部标识、runtime_epoch；安装前/替换/删除有比较资格；不可由HTTP任填 |
| `PeerBinding` | runtime_epoch+peer_epoch+topology；known native版本/opaque实例及其证明来源；未知字段显式None；认证材料/socket/CDP/token留私有层 |
| `ObservationReceipt` | 受控producer、binding、合法协议观察的monotonic time、synchronized/closed、thread/turn/request occurrence的分别字段；不是任意JSON通道 |
| `ObservationSnapshot` | revision、generation、observed/expiry、安全原因与正交readiness；public只受控字段，不包含raw descriptor/account/native对象 |
| `CurrentInteraction` | peer_epoch+local occurrence+native request correlation+owning turn；值变化/消失/断线即失效；不会从旧Store event恢复许可 |

最小b1先证明生命周期正确，不强行填所有readiness。native版本/boot identity没有可信字段的topology保留unknown及证据局限，不能通过扩大`native_instance`语义绕过合同；若public需要“连接身份”字段，应明确另名而非假装原生实例。建议先接typedreadsnapshot/失效，native allowed_now仍false，待b2和版本策略按topology独立审查后再逐动作激活。

### 6.2 新鲜度、失效与有界内存

建议第一版预算：原生动态状态（turn/pending/settings）只使用最近 **5秒内** 的受控合法快照/相关原生响应；这是保守建议值，不是原生SLA。使用monotonic时钟比较年龄，wallclock只序列化展示；系统时间回拨不续期。仅transportclose watcher只能证明已知未关闭，不证明登录、同步、所有动作可写。身份binding可在同连接保留到关闭，但动态状态过期仍为unknown；原生版本/identity变更、不同步、reconnect开始立即失效。

仅重读capabilities、计时tick、ping/pong、任意stdout/JSON、本地缓存加载和旧事件重放都不刷新nativefreshness。WB每500ms验证snapshot可更新；follower只有相关快照/patch/受控readresponse更新；managed或sharedidle长时间无新帧会过期，**允许显示unknown，不偷偷探测来保持绿灯**。未来显式read-only诊断需另定范围与预算；现有connect会resume，不自动改名成纯诊断。

建议每个current runtime最多保存一个current peer snapshot，旧代仅保留不能写入的短期关闭标识；无runtime的记录即时移除，公共读取无插入作用。pending只保留当前已验证occurrence，消失/断线立即移除；设置总量上限（建议每session128、全实例4096）及条目字节预算，达到上限明确unknown/over_budget而非裁剪后仍allow。receipt 的交付路径也必须有界，不能在 snapshot 之外新增无界 channel 或关闭代次积压；溢出失效为 unknown 并保留关闭信号，不以静默丢弃维持许可。Runtime/gate和历史缓存现有容量问题另属I06/I24；observation不得再引入无界session墓碑。具体限制需实现合同确认并测边界。

### 6.3 授权、竞态与持久化边界

- capability GET严格先`app.session`，然后只读cached本地事实和已有observation；hidden session不能触发descriptor、runtime或Store额外错误泄漏。不得调用sync/import/read_persisted_history/ensure/catalog/native。
- projection是建议。命令仍在现有gate和adapter guards下复查当前binding/archive/aux/supported/pending/turn，不能接受浏览器revision作为权限令牌。获取观测后到RPC前代次变化→受控state_conflict/not_sent（仅真正未dispatch时）。
- 自管创建singleflight、adapter peer安装与事件提交比较需要共同锁顺序；所有旧代次事件在投影/持久化/自动响应前被fence。必须测试检查后替换、await后旧response、delete后exited，不只测试mapremove。
- WorkBuddy/Harness重连读可以刷新新peer状态，不能把旧operation unknown清掉，也不能恢复旧审批按钮。跨runtime/双设备native竞态仍依赖nativeCAS或明确限制；本地mutex不是远端CAS。
- I02 ledger独占operation/preparation/nativeID/dispatch结果/fence。observation是易失证据；不保存消息正文/附件，不记录可恢复发送意图、不自动排队重放。I03持久结果写失败时observednativeaccepted不等于recorded成功；命令必须遵守ledgerfence。
- I07 作为唯一连接观测 owner 输出绑定和失效；I03 消费该绑定，独占 recording-health / gap / reconciliation-completeness，不另维护一份可独立判定 native ready 的缓存。只有合法 native snapshot 不足以清除记录缺口，只有 Store 恢复也不足以刷新原生身份。组合投影须同时表达两者，不能互相覆盖 unknown。

### 6.4 I07b2 受控错误与 I02 分工

建议内部 `CommandFailure` 保留kind、safe source、stage、delivery_state、correlation ID和安全message；由受控本地分支/原生code生成。HTTP保留`error`字段并增量给code/status/retryable/delivery_state/recovery；unknown字段未来扩展可忽略，未知code按unknown处理。`retryable`只能表达重读/重连资格，不能单独授权重发消息。correlationID不等于operationID。

| 受控边界 | 可输出的结论 | 不能推出 |
| --- | --- | --- |
| before native本地archive/aux/invalidinput/unsupported allowlist | 本动作not_sent，稳定typedreason | 不证明先前其它operation没执行 |
| discovery typed NoOwner/OwnerUnavailable | owner不可用/历史模式；本次尚未输入 | 不代表全局未安装/未登录；不得另开竞争引擎 |
| desktop typed Rejected | 对**该次受控method**明确拒绝；保留version/owner等分类 | 不通用于所有nativeerror；不自动解开ledgerunknown |
| native受控WBcode / Harnessresult | 保留安全code/source与对应stage；语义不明则native_rejected_or_unknown | UNAUTHORIZED/TIMEOUT/CONFLICT不自动映射可安全重试，也不猜账号状态 |
| stdiopartialwrite / socketenqueue后close / bridgeaccepted超时 / native响应丢失 | deliveryunknown；可查询状态/核对原会话 | 不把超时、transport404/500或断线视作not_sent |
| nativeinput明确accepted、goalset未确认 | inputaccepted，goal阶段unknown/failed另述 | 不重发input来修goal |
| criticalStore前置/结果失败 | storage_unavailable或recording_unknown，服从I02durablefence | 不用观测缓存冒充durablecommit，不向用户假报success |

SDK需要保留errorcode/data的受控内部分支，bridge不能flatten；adapter将原生错误白名单投影后给SDK，不返回rawprovider/account消息。通用anyhow仍作为未迁移legacy出口，禁止按英文/中文子串猜新typedcode。旧HTTPstatus与connect200history、goal部分成功、edit409等明确合同不能被一个全局mapper悄悄改变。

I02b拥有prepare/dispatch/receipt边界及所有message/queue/main/child调用；b2只提供error类型与运输接口。Harnessupload、goal文件准备、WBnativeID持久化、录入结果失败等需由I02保存phase和副作用receipt。native无幂等时，录入后/重启后/重连后都不自动重放；旧queued数据也不能凭观测“看起来idle”自动升级为安全可执行。控制类操作若需持久恢复，应另开合同，不借观察缓存生成新journal。

## 7. 可独立交付顺序与验收矩阵

建议root先确认6节未决项，再建立互不重叠任务：

1. **b1 lifecycle模块**：SDK只提供typed关闭/阶段来源；runtime安装/peer代次与全事件fence；adapters输出真实receipts；纯读snapshot及预算。保持capability原生unknown、旧Web不变。独立review重点是旧actor、重连、取消、并发ensure与无副作用read。
2. **b2 error模块**：受控本地/adapter/SDK错误保真，保持旧字段/status和安全脱敏；I02b整合消息阶段，不并行修改同一delivery路径。不能只建enum却在bridge丢失。
3. **b3 projection接入与Web统一**：选有充分身份/版本/新鲜度的topology逐动作接入；legacy显式兼容；主/子/queue/approval/model/goal/edit一个消费者；desktop+Pixel直接HTTP和界面双验。未确认topology持续unknown。
4. **独立native/platform gates**：依支持矩阵另做真实环境验证，尤其WorkBuddy写入；不由fake回归替代。

未来必要fake-only验证（本轮未执行）：

| 场景 | 必须证明的断言 |
| --- | --- |
| 两个同session ensure并发、setup中取消、失败后重试 | 单创建资格；ownedtransport正确清理；不会装入两个可写actor；无旧状态提交 |
| 同thread新runtime替旧runtime，旧event/settings/approval/exited迟到 | Storeevents/status、projection、autoresponse计数均无旧代污染；不能只断言map还有新Arc |
| 同Runtime的Harness/WB断流、重连身份变更/快照失败 | peer代次变；立即失效；未验证重连不allow；prompt零重放；旧审批无效 |
| follower owner/source/target/thread/cwd/streamversion/baseRevision错误 | failclosed、重同步期间unknown、preserveanswered/uncertain；不给另引擎fallback |
| sharedUnixhome缺失/不匹配、两个loadedowner、coldwriterheld | 缺失证据不冒充verified；多owner边界暴露未闭合；不发输入/不spawn替代 |
| WBdescriptor实例claim与livebrowser/renderer/preload变化 | 字段证明强度正确；每次重连重验主会话localID；auxiliary任何直接HTTP写零调用 |
| Harnessreadyclient改变、重复eventID；WB相同pending换turn/connection | 旧localoccurrence拒绝，原生response零重放；未supported交互保留native处理 |
| fakeclock过期/回拨、无效JSON/ping、本地读100次、budget超限 | 有效时间不被伪续期；projectionread零nativecall/零Storewrite；有界内存且unknown |
| controllederror换语言、timeout/partialwrite/迟到ack/native500 | code/status/disposition与语句无关；afterdispatch保持unknown，无retryinput |
| acceptedinput+goal未知、model设置部分成功、acceptednative+Storefailure | 不声称全部未发送/未设置；I02phase/fence一致；重连不解锁重发 |
| scopedhidden/archived/custom/legacyserver / disconnectedhistory | scope先行无泄漏；离线localactions独立；unknowndeny；旧协议显式标识 |
| main/child/queueduplicate/两设备/刷新及晚响应 | I02stableID唯一权威；保留draft/附件；currentgenerationguard；无第二份journal |

真实native/platform仍开放：未知Codexinitialize字段/版本策略、共享owner唯一性和peer身份强度、桌面follower真实审批/停止/空闲下一轮/完整附件、Harness版本握手可获得性、WorkBuddy正常初始化环境写入全链、Windows无Unix热接入、Android实际网络/进程生命周期。遵循[支持矩阵](../../support-matrix.md)，不扩大已有证据的范围。

## 8. 需评审决定的事项与本次局限

- 是否先接受完全不启用nativeallowed_now的b1，只交生命周期可验证基础；建议是，以免被不完整版本证明迫使放宽规则。
- public `native_instance`坚持原生实例身份还是另增connection_binding；建议保持原含义并另名表达本地连接代次。版本不可得时保留unknown，I08另定受支持范围，不在本文发明bootID。
- 创建singleflight采用内部资格还是gate-token；需列map/peer/gate/Store锁顺序、attach初始投影的安装时点、取消清理，以及跨session同thread与I02fence关系。每个跨 await 的提交点都要重新取得当前资格，不能仅预先比较一次再执行稍后的无保护副作用。
- 5秒动态TTL与128/4096建议预算需按真实闲置/容量结果审查；无证据时过期unknown，不以隐式probe掩盖。不能直接照搬sidebar12秒运行提示为控制TTL。
- generic `retryable`的兼容语义与typedHTTPstatus逐类表需b2落实；任何迁移保留legacyerror与显式成功/部分成功合同。
- 控制类操作的uncertain目前各adapter强弱不同，不能用新observations重连刷新清除它；如需持久跨重启控制fence，单立契约，避免与I02重叠。

本文是静态源码研究与提案，不是运行审计或漏洞复现。对竞态描述给出可达代码缺少的保护和未来负例，不声称已发生生产事故；对原生身份只记录代码实际比较的字段，不声称密码学认证、nativeCAS或端到端exactly-once。独立评审须核对本文精确提交和选定调用链后，root再决定合同和实现拆分。文档通过不等于I07实现、Web激活、真实写入验收或发布完成。
