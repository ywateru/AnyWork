# HTTP 与实时接口

除 `/api/health`、静态界面和 `/source` 外，`/api/*` 均要求 `Authorization: Bearer <token>`。不支持 URL query token。除图片与二进制文档下载外返回 JSON；基本错误格式 `{error:string}`，文件保存等专门入口另含稳定 `code` / `delivery_state`。token 错误为 401，越界路径为 403，不存在会话为 404，忙碌/已失效审批为 409。

| 方法 | 路径 | 用途 / 请求体 |
| --- | --- | --- |
| GET | `/api/health` | 健康状态及版本 |
| GET | `/api/info` | 产品名称、工作区、机器名及版本 |
| GET | `/api/plugins` | 插件名称与能力，不公开启动命令或环境变量 |
| GET | `/api/workspaces` | `{workspaces:[{path,name,root,sessions}]}`；从 Codex 和本服务会话的真实 cwd 去重汇总；不扫描空目录 |
| GET | `/api/sessions` | `{sessions:[Session],discovery_error?}`；合并本服务及同用户的工作区内 Codex 会话 |
| POST | `/api/sessions` | `{cwd,agent?,model?,title?,policy?:"manual"|"auto"}` |
| GET | `/api/sessions/:id` | `{session:Session}` |
| GET | `/api/sessions/:id/capabilities` | 版本化、按当前会话作用域计算的只读能力建议；不启动进程、连接原生或导入历史 |
| PATCH | `/api/sessions/:id` | `{title?,archived?,policy?,model?}`；模型只能在空闲时修改 |
| DELETE | `/api/sessions/:id` | 删除会话、事件及上传附件 |
| POST | `/api/sessions/:id/messages` | `{text,attachments?:[上传返回的绝对路径],mode?:"steer"或"queue",composer?:{markdown,document}}` |
| GET | `/api/sessions/:id/edit` | 恢复最后未完成编辑；可带 `message_id` 查询该消息实时可编辑能力 |
| POST | `/api/sessions/:id/edit` | `{message_id,text,expected_fingerprint,operation_id,retry?}`；同 thread 回退后保留原输入附件重发 |
| DELETE | `/api/sessions/:id/edit/:operation_id` | 取消本地恢复操作；不恢复原生历史或文件 |
| POST | `/api/sessions/:id/connect` | 连接原 Codex 会话并订阅执行通知，不创建分支或覆盖原配置 |
| POST | `/api/sessions/:id/interrupt` | 中断当前 turn |
| POST | `/api/sessions/:id/respond` | 审批 `{request_id,result}` 或兼容 `{request_id,accept:boolean}`；问答 `{request_id,result}`，详见审批决策 |
| GET | `/api/sessions/:id/events?after=0` | SSE 重放及实时事件 |
| GET | `/api/sessions/:id/events/poll?after=0` | 增量 JSON 事件，最多 500 条，供不支持 SSE 的中转使用 |
| GET | `/api/events?after=N` | 当前会话作用域内的全局 SSE；省略 after 从当前水位开始 |
| GET | `/api/events/poll?after=N` | 全局增量 `{events,cursor,has_more}`；cursor 是扫描水位，包含不可见行的推进 |
| GET | `/api/sessions/:id/export` | `{session,events,feedback}` 完整 JSON 导出 |
| GET | `/api/sessions/:id/history?paged=true&cursor=...&limit=5` | 最近消息快照 `{events,next_cursor,latest_seq?}`，省略 cursor 读取最新页；返回事件按时间正序，上滑使用 next_cursor 读取更早页 |
| GET | `/api/sessions/:id/history/item?seq=...` | 本服务大型工具结果按需读取 `{item}`；导入会话使用 `turn_id`、`item_id` |
| POST | `/api/sessions/:id/fork` | 显式创建 Codex 分支及独立 AnyWork 会话 `{session}` |
| GET | `/api/sessions/:id/models` | 厂商模型列表 |
| GET | `/api/sessions/:id/composer` | 原生目标、模式、当前模型和强度、完整模型目录及设置可用性 |
| POST | `/api/sessions/:id/composer` | 显式更新模型、强度、计划模式或持续目标，详见下文 |
| GET | `/api/sessions/:id/feedback` | 当前会话全部本地反馈 `{feedback:[],tags:[],scope:"local"}` |
| GET | `/api/sessions/:id/feedback/:message_id` | 当前消息反馈 `{feedback:对象或null}` |
| PUT | `/api/sessions/:id/feedback/:message_id` | 覆盖保存 `{rating:"good"或"bad",tags?:[],text?:string或null}` |
| DELETE | `/api/sessions/:id/feedback/:message_id` | 幂等重置消息反馈 `{ok:true}` |
| GET | `/api/sessions/:id/files?path=src` | 目录 `{entries,path}` 或文本 `{content,revision}`；revision 为精确字节 SHA-256 |
| PUT | `/api/sessions/:id/files` | `{path,content,expected_revision}`；摘要须匹配，显式 null 仅创建；父目录需存在 |
| POST | `/api/sessions/:id/uploads` | multipart 文件，返回 `{files:[{name,path,size}]}` |
| GET | `/api/sessions/:id/image?path=...` | 带鉴权的 PNG/JPEG/GIF/WebP 图片字节 |
| GET | `/api/sessions/:id/document?path=...` | PDF 内联预览；Office/OpenDocument/RTF 文档附件下载，最大 20 MiB |
| GET | `/api/sessions/:id/git` | `{status,diff}`，当前工作树相对 HEAD 的差异 |
| WS | `/ws/terminal/:id` | PTY 交互终端 |

## 文本文件保存

文件文本保存必须使用读取时的 `revision`；缺少 `expected_revision` 返回 428，过期摘要、原文件已删除或 create-only 碰撞返回 409。成功要求 `{ok:true,revision}`；503 `file_save_uncertain` 或丢响应不能直接重发覆盖。Web 保留草稿，允许比较并明确采用新基线、复制或放弃草稿。服务使用同进程统一写入锁，避免大小写/Unicode/父路径别名绕过串行检查；不同文件的保存也会依次执行。外部进程最终比较到 rename 间的竞争、多个服务进程与跨平台持久化范围，详见[文件一致性契约](file-edit-consistency.md)。

## 默认 Agent 插件

`GET /api/plugins` 始终包含默认启用的 `codex`、`deepseek-harness`（dsh）和 `workbuddy`，另加用户安装的插件。每项包含 `id`、`name`、`capabilities`、`protocol_version`、`available` 和 `setup_hint`。`available` 表示已配置可尝试连接的入口，不保证主机在线，也不会为了查询启动或连接主机。未配置/无效的共享发现入口返回 `available:false` 与不含密钥的设置提示，插件仍保留在列表中。前端允许选择并阅读提示，入口就绪前禁用创建；完成设置后点击“重新检查连接”重新读取。旧服务省略 `available` 时沿用其“列表中的插件可尝试使用”语义。插件默认启用不会启动独立引擎，也不会绕过共享主机验证。

## 只读能力建议

`/api/info` 的 `capability_projection_v1:true` 表示提供附加能力协议；插件项增加 `capability_projection`，原六个字段的含义保持兼容。`GET /api/sessions/:id/capabilities` 先检查当前会话作用域，再读取本地事件/队列/配置；返回版本、revision、会话/thread/Agent/拓扑绑定、readiness、观测范围及 26 项逐动作建议。`supported` 是 `yes/no/unknown`，`allowed_now` 是当前已知前置条件下的建议，并非命令授权。

当前模块没有可信原生实例/代次观测，因此所有依赖原生的动作均不放行，transport/identity/native freshness 保持未知；本地缓存读取和符合条件的队列局部操作单独判断。`transport_reachable` 不是已验证原生身份的可达性。5 秒有效期仅属于本地读取，不能作为原生在线证明。旧 Web 尚未切换到该建议源，原命令仍执行既有守卫。详见[模块契约](capability-projection-module.md)；不能用此协议宣称完整 I07、原生写入或 WorkBuddy 正式支持已验收。

## 会话结构

`id` 为 AnyWork 会话 ID；`thread_id` 为厂商会话 ID。其余字段：`title`、`cwd`、`agent`、`model`、`policy`、`status`、`archived`、`created_at`、`updated_at`。时间均为 Unix 毫秒。

附加字段 `external` 标识来自 Codex 的普通会话，`auxiliary` 标识辅助会话。导入 ID 为 `codex-<thread_id>`；本服务已管理的 thread 按 `thread_id` 去重。

状态：`starting`、`idle`、`running`、`waiting`、`error`、`disconnected`、`external`。`external` 状态值表示无法取得原执行进程的运行状态；`external: true` 的普通会话也可显示 `running`、`waiting`、`idle` 或 `error`。历史索引查询本身不接管执行；选择会话或发送/停止时通过共享连接订阅原线程。导入会话支持直接消息、执行中 steer、停止和审批；重命名、归档、删除及策略修改仍在原客户端完成；模型和推理强度可通过显式原生 composer 设置修改。控制入口不可用或独立 CLI 持有 writer lock 时仍允许查看历史，connect 返回观察状态，不自动 fork 或启动第二个执行引擎。创建失败仍保留会话和错误事件，以便远程诊断/重试。

## SSE

事件数据为 `{seq,session_id,method,params,request_id?,created_at}`。SSE 的 `id` 等于 `seq`。重连时把最新已处理序号传入 `after`；所有事件持久化后才能供客户端读取。定期发送 keepalive。

全局事件与会话列表/单会话访问使用同一 Agent/workspace 范围，不因共用旧数据库而暴露范围外 payload。全局 poll 每次扫描最多 500 行；即使 `events` 为空也应使用返回的 `cursor`，按 `has_more` 继续读取，不能由可见事件数量推断是否读完。省略 after 仅建立当前水位；负数或格式错误拒绝。全局 SSE 可能返回只有 `id`、`event: cursor` 而无 `data` 的检查点，它不是 AgentEvent，不应投影为消息。旧客户端可忽略检查点，重连时可能重扫隐藏尾页。详见[全局事件契约](global-event-scope.md)。

## WebSocket

建立连接后 5 秒内发送首帧：`{"token":"访问令牌"}`。验证后才创建 PTY。

客户端：

```json
{"type":"input","data":"ls\n"}
{"type":"resize","cols":100,"rows":30}
```

输出为二进制 UTF-8 字节，客户端用 xterm 渲染。每个 WebSocket 是独立 shell，关闭连接会终止对应子进程。它不是 Codex 自身交互 TUI 的镜像；Codex 对话由 app-server 管理。

## 历史分页

本服务会话按可见消息边界分页。快照省略已有完整 `item/completed` 的增量和 started 副本，保留先前生命周期及审批状态，首屏从 `latest_seq` 开始接收 SSE/增量轮询，避免重新回放全部旧事件。`next_cursor` 是不透明字符串；不要从展示事件数量或 seq 自行推导。历史快照可能包含用于恢复状态的较早控制事件，客户端按 seq 去重。

导入会话优先用 Codex `thread/items/list` 倒序读取；不支持时回退 `thread/turns/list`，更旧版本再用全量兼容读取。后两种回退的服务器读取成本取决于 Codex 版本。条目使用 `params.history_id` 稳定去重，不能使用分页内临时 seq 合并。定时刷新仅更新最新页，保留已加载的更早记录。

原生 `thread/items/list` 若提供整数 `startedAtMs`、`completedAtMs`，分别原样传到 `params.history_item_started_at_ms`、`params.history_item_completed_at_ms`；缺少、空值或非整数时省略对应字段。`history_work_started_at`、`history_work_completed_at` 则是原生回合时间（秒转换为毫秒），不能当作用户消息发送时间。通过 turn/legacy 接口读取及分叉导入的历史没有原生条目时间时，消息时间保持未知；导入历史事件的 `created_at` 不代表原消息时间，也不能用会话更新时间或导入时间补造。

超过 8 KiB 的工具结果在快照中仅返回标识与 `item.history_detail`，展开时用其中参数请求 `/history/item`。接口仍要求同一用户鉴权和会话范围检查。原始数据库事件及完整导出保持不变；导入会话原有不带 `paged=true` 的 `/history` 保留全量导出行为。

## 审批决策

`POST /api/sessions/{id}/respond` 必须精确提供 `request_id` 及 `result`、`accept` 其中一项，不能混合，也不能使用 `null` 代替有效结果或布尔值。未知外层字段、未知审批方法、错误结果结构、未知字段或不属于本次请求的决定返回 400；校验失败不向原引擎发送响应，不消费待审批状态，可修正后重试。接口使用会话操作锁串行化；成功响应后再次提交或已结束回合的请求返回 409。401 同样不改变审批。

命令执行和文件修改支持 `{"request_id":700,"result":{"decision":"accept"}}`，以及 `acceptForSession`、`decline`、`cancel`。`accept` 仅批准本次动作；`acceptForSession` 使用原引擎提供的会话范围审批缓存；`decline` 拒绝动作但允许 Agent 继续；`cancel` 拒绝并中断回合。结果对象只允许 `decision`，文件修改不接受命令规则或网络规则对象。

对于命令请求，`availableDecisions` 如果是非 `null` 数组，就是精确白名单，包括空数组；不额外补充基础决定或规则提案。选择必须与其中一个已知格式的决定逐 JSON 值匹配。空数组不能提交任何决定，可通过停止回合处理。字段缺省或为 `null` 时，使用四种基础决定，并允许与本次原请求提案精确一致的规则决定：

```json
{"request_id":700,"result":{"decision":{"acceptWithExecpolicyAmendment":{"execpolicy_amendment":["npm","install"]}}}}
{"request_id":700,"result":{"decision":{"applyNetworkPolicyAmendment":{"network_policy_amendment":{"host":"example.com","action":"allow"}}}}}
```

命令前缀数组必须等于原 `proposedExecpolicyAmendment`，不能缩短、延长或替换；网络对象必须等于原 `proposedNetworkPolicyAmendments` 中的一个，`action` 仅 `allow` 或 `deny`，不能更换主机、动作或增加字段。若规则对象本身明确列在 `availableDecisions` 中，以该精确决定为准，不要求另有重复的 proposal。所有规则决定的外层、包装层及网络对象均拒绝未知字段。

权限请求使用 `{"request_id":700,"result":{"permissions":完整原请求permissions对象,"scope":"turn"}}`。`permissions` 只允许完整原请求对象或空 `{}`，不能添加权限、替换路径或仅批准部分权限。`scope` 只允许 `turn` 和 `session`，缺省为 `turn`；可附带原协议已知的 `strictAutoReview:boolean或null`，AnyWork 不主动开启该字段。拒绝可提交 `{"request_id":700,"result":{"permissions":{},"scope":"turn"}}`。

兼容入口 `accept:true` 在命令/文件请求中转换为 `decision:"accept"`，`false` 转为 `decline`；在权限请求中分别转换成完整原权限或 `{}`，且 `scope:"turn"`。转换后仍执行同一白名单校验。自动模式只尝试这种单次/回合范围的接受决定，禁止静默变成 `acceptForSession`、`scope:"session"` 或持久规则；若明确 `availableDecisions` 不包含 `accept`，则保持等待用户处理。自动和手动响应共享操作锁并重查待审批状态。

问答沿用 `{request_id,result:{answers:...}}`，不接受 `accept` 入口。审批原始请求、响应完成事件和后续执行状态通过原有 SSE/历史接口恢复。

## 输入栏模式与远程附件

- `GET /api/sessions/{id}/composer`：读取原引擎目标、计划模式、当前 `model`、`effort`、`service_tier`，以及完整分页读取的 `models`、`settings_available`、`settings_error`。模型目录保留原生 `supportedReasoningEfforts:[{reasoningEffort,description}]`、`defaultReasoningEffort`、`defaultServiceTier` 和 `serviceTiers:[{id,name,description}]`；服务等级列表按原引擎配置限制过滤，保留原顺序和文案。`service_tier_available` 表示当前模型存在可选的已公布档位；`service_tier_access:{fast:boolean,ultrafast:boolean}` 是有效速度权限，无法读取时为 `null` 并提供 `service_tier_error`。归档会话拒绝访问。
- `POST /api/sessions/{id}/messages` 增加可选 `goal:true`：复用普通富文本/附件消息，支持无文字但有附件的目标。服务验证附件边界并准备持久图片引用，发送原生 `/goal` 输入；原引擎接收消息后才执行 `thread/goal/set`，返回 `goal`。若消息已接收但目标启用未确认，HTTP 仍成功并带 `goal_error` 提示，此时不能重发已接收的消息。`mode:"queue"` 只持久化该标记，实际投递才启用；队列 `action:"replace"` 的可选 `goal:false` 可明确移除目标属性，省略保留原值。图片复制、长目标包装和结果未知时的文件保留见 [目标契约](anywork-goal-editor-contract.md)。
- `POST /api/sessions/{id}/composer`：`{"action":"plan","enabled":true}` 开关后续轮次计划模式；`{"action":"goal","objective":"目标和验收标准"}` 保存并启用原生持续目标；`{"action":"clear_goal"}` 清除目标。目标不能为空；4000 个 Unicode scalar 以内直接保存，超出写到 Codex home 下受控 attachments/UUID/goal-objective.md，再提交原生文件包装，HTTP请求体边界为20 MiB。`{"action":"goal_status","status":"paused"}` 暂停目标，`status:"active"` 恢复；只更新状态，保留原目标和预算。操作沿用原 thread、模型、推理强度及审批权限。
- `POST /api/sessions/{id}/composer`：`{"action":"settings","model":"模型标识","effort":"强度标识","service_tier":"档位标识或null"}` 显式更新原生线程模型、推理强度或服务等级，至少提供一项。`service_tier` 省略时不变，显式 JSON `null` 清除线程服务等级覆盖，字符串则必须是所选模型过滤后的 `serviceTiers[].id`；不把 `defaultServiceTier` 自动设置成当前值，也不为未公布的档位创建默认项。界面的标准档位使用 `null`，与目录中的默认 ID 分开处理。验证模型属于真实目录、强度属于该模型实际支持的列表；不硬编码模型和强度。若更换模型后原强度或原服务等级不被支持，请在同一请求提供支持的强度、服务等级，或者显式 `service_tier:null` 清除覆盖。执行中允许只包含 effort 的设置请求；模型、服务等级或计划模式在执行中返回 409。设置不改变审批权限、工作目录或线程身份。插件必须声明 `models` 能力；能力缺失或目录无法读取时界面可据 `settings_available:false` 显示不可用。
- 服务等级有效权限来自 `configRequirements/read`：`fast` 在 `featureRequirements.fast_mode !== false` 时允许；`ultrafast` 需 `ultrafast_mode !== false`，并且 `supportsIndependentSpeedModes === true` 或 `fast` 允许。沿用原应用规则：已公布的 `default` ID 不受速度限制；取得权限后 `flex` 不受速度限制；`ultrafast` 按独立权限，其余档位按 `fast` 权限过滤。无法读取权限时不猜测账号能力，只保留已公布的 `default` ID；显式 `null` 清除仍可用。目录的 `additionalSpeedTiers` 已废弃，不能替代真实 `serviceTiers`；账号套餐也不被推断成可用档位。原引擎仍可拒绝目录中可见的档位，失败不会写入本地运行状态。
- 服务等级调用原生 `thread/settings/update` 的 `serviceTier` 字段，初始化/恢复时从原生 `thread/start` 或 `thread/resume` 返回值恢复，后续 `thread/settings/updated` 通知保持同步。普通发送与执行中 steer 不额外注入服务等级覆盖，因此保留原线程设置。持久化及重连以原引擎为准，不保存会覆盖原生客户端后续设置的 AnyWork 独立偏好。
- 消息与队列的 `attachments` 同时接受当前会话上传目录和当前 cwd 内真实文件路径。远程文件可用绝对路径或相对 cwd 的路径；服务端 canonicalize 后检查边界、拒绝目录、跨 cwd 路径、符号链接越界及其他会话上传文件。

目标和计划模式调用原生 Codex 接口；其他 Agent 若不实现对应协议会报告不可用，不会以提示词降级。

## 用户消息编辑与恢复

编辑是对原生历史的实际变更。仅支持声明 `message-edit` 的 Codex 会话，要求会话未归档、原生 thread 空闲且为非 ephemeral 的持久化 paginated history。服务端读取最新回合的完整 items，必须恰好包含一个 userMessage 和可编辑的首个 text，并验证请求消息与该原生输入匹配；本服务会话还核对本地消息对应 turn 和原文字。更早回合、含多个用户项的回合、缺少原始输入或队列正在发送时不接受。没有原生 revert 能力的旧引擎不能用不完整历史估算 rollback 次数。

`GET /api/sessions/{id}/edit?message_id=...` 成功返回 `editable:true`、`message_id`、`turn_id`、`user_item_id`、编辑正文 `text`、`fingerprint`、`input_types`、显示用 `attachments` 和 `limitations`。text 不是完整原始 prompt：本服务管理的消息投影原首 text，导入历史投影完整 input，再将最终显示正文 trim 作为编辑初值。有效 app-input 或可恢复 library 元数据的首 text 可以编辑；提交采用历史编辑独立契约，不调用新消息 YEe/rDe 转换，旧 envelope/提及 text_elements 会被清空，其他 input 保留。当前 textarea 不具备原富文本编辑器的全部规范化行为。消息 ID 须 URL 编码；fingerprint 是短期修订校验值，不是权限令牌或原生 CAS。能力查询失败时客户端不显示编辑入口。省略 message_id 时返回 `{operation:最后未完成操作或null}`，用于刷新或重新进入会话后恢复；已完成或取消的最后操作不返回为待恢复操作。

首次提交：

```json
{
  "message_id": "能力查询返回的消息ID",
  "text": "修改后的文字",
  "expected_fingerprint": "能力查询返回的fingerprint",
  "operation_id": "由客户端生成的UUID",
  "retry": false
}
```

请求拒绝未知字段，operation_id 必须为 UUID。服务端锁定当前 AnyWork 会话、复读原生状态并比对 fingerprint，然后构造完整替换 input：仅在原始首个 text 上按 Ooe 对应规则重建上下文包装，清空该项 text_elements，保留该项其他属性以及其他所有 input 元素。精确 page wrapper 保留原前缀再接新正文与 LF；其他请求标记取最后一处，将其前缀 trimEnd 后统一重建 My request 头；无标记直接使用请求 text。此重建函数本身不 trim 新正文；普通 UI 与原版提交层一致，发送 `draft.trim()`，结果未知时的核对保留原提交文字。不能通过此接口增删附件。正文可为空，但原包装前缀不计作有效内容；修改后须仍有非空正文、其他非空 text 或非文本 input。原 localImage/localAudio 文件在首次变更前必须仍存在。保存操作前暂停队列，队列不会在编辑完成或取消后自动恢复。

原生 input 显示已接入辅助图片说明筛选、library 提及恢复和经过严格 schema 验证的 app-input；首个有效应用消息决定一次或两次包装提取。历史与原生 userMessage 事件附带最终 `params.display_text`，可能为空字符串；`params.text` 与 `item.content` 保留原值。发送者、自动化等其他特化路径仍有差距。显示层连接多个 text，不改变编辑事务只重建首 text、保留其余 input 的边界。超长正文的10,240 UTF-16 单元预切只影响浏览器折叠呈现，编辑接口仍传输并保存完整正文。

Codex 新消息、引导和队列在实际投递时，将 library Markdown 链接序列化为 sourceUrl 并生成 UTF-8 text_elements；本地回显 `params.text` 为实际 wire 首文本，`params.display_text` 恢复原链接，转换确实改变文本时另附 `params.submitted_text` 保存作者草稿。非 Codex 插件保持原文字。此路径与上述历史编辑不同；队列存储原草稿，实际发送时才转换。

编辑分两阶段：`thread/revert {threadId,beforeTurnId:目标回合}` 成功后提交本地历史重置，再在同一 thread 以完整替换 input 调用 `turn/start`。不 fork，不使用一条追加提示模拟编辑，不撤销已经发生的文件操作。原生输入保存在服务端操作记录中，客户端不需要重新提交图片、文件或其他原始 input。新发送把 operation_id 用作 clientUserMessageId；该字段不构成普通 turn/start 幂等的承诺。

POST 返回 `{operation,history_changed,turn_id}`。HTTP 成功不等于重新发送成功；必须检查 `operation.phase === "completed"`。operation 公共字段包括 `id`、`message_id`、`text`、`expected_fingerprint`（同时以 fingerprint 提供）、`phase`、`stage`、`error`、`turn_id`、`retryable`、`input_types`、附件摘要。`history_changed:true` 表示原生回退已确认，客户端应丢弃旧投影并重读历史。原始输入和内部历史匹配数据不通过公共 operation 返回。

| phase | 含义与下一步 |
| --- | --- |
| prepared | 操作已保存，尚待回退前复查 |
| reverting | 原生回退已发起，结果尚未持久确认 |
| reverted | 回退已确认；只可在核对保留历史尾部后继续发送 |
| starting | 替代消息发送已发起，结果尚未持久确认 |
| completed | 新回合已确认，退出编辑 |
| failed | 回退前校验或明确的回退错误，历史未由该阶段确认改变；可修正后显式重试 |
| uncertain | 原生结果未知或观察到并发变更；先核对历史，不自动重发 |
| cancelled | 已取消本地恢复操作；不是原生撤销 |

重试沿用相同 operation_id、message_id、expected_fingerprint，并提交 `retry:true`。相同 operation_id 的普通重复请求返回已保存结果，不重新执行；ID 与消息或指纹不匹配返回 409。prepared、failed、reverted 阶段允许保存修订后的 text；正在确认结果的阶段不会擅自用新 text 重放。prepared/failed 会重新验证原生目标，reverted 只尝试发送；uncertain/reverting/starting 先核对真实历史，观察到替代输入可确认完成，不能证明发送结果时继续 uncertain 而不重发。服务重启将中断的 reverting/starting 标为 uncertain，不自动继续变更。

前端在 uncertain、starting、reverting 阶段将已提交文字保持只读，提供“核对发送结果”；核对沿用同一 input 和 operation_id。若返回的完成操作文字与当前草稿不同，客户端保留草稿并提示，不静默关闭编辑区。

`DELETE /api/sessions/{id}/edit/{operation_id}` 幂等返回 `{ok:true,operation?,history_changed?}`，只取消本地恢复日志。回退已成功而发送失败时，取消可能留下回退后的历史；不会恢复被移除消息、撤销工作区文件或自动恢复队列。浏览器中止 POST 或切换页面不等于取消服务端编辑任务；阶段写入由独立任务继续完成。

目标已变化、不可编辑、操作不匹配或另有未完成操作通常返回 409；请求格式、UUID、替换内容或原附件不可用返回 400。部分原生错误会作为 HTTP 200 的 operation.error 和 phase 返回，客户端必须按阶段处理。未完成编辑会阻止普通消息发送；前端保留失败草稿，并在原消息被回退移除后提供独立恢复编辑区。未提交或上次提交后未再次保存的文字不承诺跨刷新恢复。

AnyWork 锁只覆盖本服务的同一会话，fingerprint 和尾部复查均不是原子比较并交换。原生桌面端、CLI 或其他外部客户端仍可能在检查与 RPC 之间修改 thread；没有跨客户端 CAS 保证。回退与发送也不是原子事务，不能把结果未知的请求当作安全重发许可。本功能不表示原版全部编辑分支或富文本编辑器已经通过 1:1 验收；语音输入与朗读继续延后。

## 本地消息反馈

点赞、点踩和补充意见按 `session_id + message_id` 保存在 AnyWork SQLite 数据库，支持本服务会话及导入的原生会话。反馈不调用 Agent、不向厂商发送消息或诊断数据，也不改变原对话、权限、会话活动时间或侧栏排序。所有接口仍要求 Bearer 鉴权及当前工作区的会话边界。

`GET /api/sessions/{id}/feedback` 返回 `{feedback:[记录],tags:[按原应用顺序的六类标识],scope:"local"}`。当前界面按原应用使用单选：

| 标签标识 | 显示文案 |
| --- | --- |
| `incorrect-or-incomplete` | 不正确或不完整 |
| `not-what-i-asked-for` | 不是我想要的 |
| `slow-or-buggy` | 响应慢或有错误 |
| `style-or-tone` | 风格或语气 |
| `safety-or-legal-concern` | 安全或法律问题 |
| `other` | 其他 |

`GET /api/sessions/{id}/feedback/{message_id}` 返回 `{feedback:记录或null}`。消息标识使用稳定的原生 item ID 或 AnyWork 事件消息 ID，必须先 URL 编码；可以包含斜线、冒号和 Unicode，非空且最多 512 个字符，拒绝控制字符。

`PUT` 同一消息路径接受 `{"rating":"good"或"bad","tags":[允许的标签],"text":"可选意见"}`，返回 `{feedback:记录}`。记录含 `session_id`、`message_id`、`rating`、`tags`、`text`、`created_at` 和 `updated_at`，时间为 Unix 毫秒。标签接受上述六类标识，同时兼容旧版 `incorrect`、`incomplete`、`unhelpful` 及原有 `other`；旧记录保持原值，列表只公布六类新选项。接口为兼容旧版多选接受最多六项并去重，新界面提交零项或一项。意见最多 4000 个 Unicode 字符，去除首尾空白后为空则保存为 `null`。省略 `tags` 或 `text` 分别重置为 `[]` 和 `null`。重复保存覆盖同一记录，保留首次 `created_at`。写入请求体最大 64 KiB，可容纳 JSON 转义后的 4000 个 Unicode 字符。

`safety-or-legal-concern` 与其他类别一样只保存在 AnyWork 本地，不启动原应用的举报流程，不向供应商提交举报或发送诊断数据。

`DELETE` 同一消息路径幂等清除反馈，返回 `{ok:true}`。会话删除时反馈通过外键级联清除；反馈随本地数据库持久化，服务重启后恢复，并包含在会话 JSON 导出中。

## 二进制文档

`GET /api/sessions/{id}/document?path=...` 使用普通 Bearer 请求，成功返回原始字节，不返回 JSON。客户端先以鉴权请求取得 Blob，再创建临时 URL 预览或下载；不要把令牌放到 iframe、下载链接或 query 中。

PDF 要求真实 `%PDF-` 文件头，返回 `application/pdf` 和 `Content-Disposition: inline`。`.docx/.xlsx/.pptx` 要求 ZIP 本地记录、合法有界中央目录及各格式必要成员；`.odt/.ods/.odp` 检查 ZIP 目录及 `mimetype/content.xml`。这些包只校验容器结构和必要成员，不解压、不执行、不渲染其中内容。旧 `.doc/.xls/.ppt` 检查复合文件头，`.rtf` 检查格式头，均作为附件下载；不宣称浏览器内 Office 排版。加密、多卷、ZIP64 和损坏包不支持。

所有文档限制 20 MiB，响应使用 `Cache-Control: private, no-store`、`X-Content-Type-Options: nosniff`，文件名通过安全 ASCII 回退和 UTF-8 `filename*` 表达。其他格式或伪装文档报错，不按 HTML 或脚本返回。

允许读取当前会话 cwd 内文件、当前会话自己的上传文件，或者在该会话持久化事件/原生 Codex 历史里具有精确路径或 Markdown 文件链接的外部文档。先 canonicalize 再检查边界；其他会话上传文件始终拒绝，即使通过符号链接或历史文字引用。未引用的外部路径、路径穿越、越界符号链接、目录和超限文件均拒绝。


## 富文本输入与排队恢复

消息的 `text` 是交给 Agent 的实际文本；可选 `composer` 包含 `markdown:string` 和 `document:{type:"doc",content:[...]}`，用于编辑恢复。持久 Markdown 可以与实际文本不同，例如强制纯文本粘贴的字面星号。`composer` 不作为提示词或消息展示正文发送给 Agent；原生文本、上下文和最终 `display_text` 继续走原输入投影。

带编辑数据的原生提交使用新的 `clientUserMessageId`，本地只按原生 `userMessage.clientId` 和当前会话精确关联。实时事件和历史分页附加 `params.composer`；历史用户项还保留 `history_item_id`。没有客户端标识时不凭正文、相邻顺序或回合猜测关联。关联数据随服务重启保留，删除会话时级联清除。

`GET /sessions/:id/queue` 返回 `items`、`paused` 和可空的 `editing`。条目可携带相同的 `composer`。`POST /sessions/:id/queue` 的 `take` 将指定条目移到持久编辑事务，`restore` 按原序号放回，`replace` 接受 `{id,text,attachments,composer?}` 并保留原FIFO位置。失败保留编辑数据；前端在等待take期间检测新草稿并恢复原队列，避免覆盖新输入。关闭排队是前端偏好，只改变后续默认发送方式。

`GET /sessions/:id/composer?goal_editor=true` 额外返回 `goal_objective` 和可空的 `goal_objective_error`。只有此查询解引用当前目标的精确原生受控文件包装，普通轮询不读取大文件。缺失或不合法文件保留原目标并报告错误，不任意读取包装中的本地路径。


## 会话审阅差异

`GET /api/sessions/{id}/review` 沿用会话鉴权与workspace范围，只读。`source` 可为 `branch`（默认）、`uncommitted`、`unstaged`、`staged`、`last-turn`、`commit`；`base_branch`仅用于branch，`hide_whitespace=true`用于Git比较。branch从基准与HEAD的共同祖先比较，不等于直接比较两个分支tip。默认基准仅读取本地缓存的remote HEAD或已存在的remote main/master；没有可选默认时返回预期状态。

commit来源必须带`commit=<SHA>`，只接受7至64位十六进制对象前缀，先解析为确定的commit对象，再与第一父提交比较；根提交与空树比较。不混入暂存区、工作区或未跟踪文件；返回`commit`为完整解析SHA。

返回包含 `type: success|expected`、`source`、`diff: string|null`、`branches`；Git来源另有仓库`root`、`current_branch`和可用的`base_branch`，last-turn另有`turn_id`。`expected`的`reason`可为`not-a-repository`、`default-branch-unavailable`、`merge-base-unavailable`。success且diff空字符串表示比较成功且无变更；last-turn的null表示没有当前轮累计通知，不能解释为工作区无改动。branch/uncommitted/unstaged包含未跟踪文件，最多500项；省略数为`untracked_files_omitted`；嵌套仓库等目录项也计入省略数，不递归当作普通文件补丁。非UTF8文件名、输出超8MiB或单命令超15秒返回错误。

仓库root必须位于配置的workspace内；会话cwd在更大的父仓库内时拒绝暴露父仓库差异。last-turn按当前会话和最新轮次读取原始turn/diff/updated，执行中引导保持原turnId，history/reset或新轮次会清除旧轮展示。冷历史缺少聚合字段时不会从单项文件变更重建。此接口不执行Git写操作，也不读取文件内容替代协议补丁。


`GET /api/sessions/{id}/review/commits?base_branch=...` 返回只读分支提交列表，沿用同样鉴权、仓库root边界和默认分支规则。比较范围是`merge-base(HEAD, base)..HEAD`，最多100项、输出上限2MiB；只读本地引用，不连接远端。不具备基准或共同祖先时返回expected及空commits，不回落整个仓库历史。返回`type`、`commits`、`branches`、`root`、`current_branch`、可用的`base_branch`与`reason`；每项包含`sha`、`committed_at`（ISO8601）、`subject`与完整`message`。分支列表成功但无分支提交返回success/空数组；读取失败或超限返回错误供菜单重试。

## 外部会话读取与连接

外部会话的 GET models/composer 不隐式执行 thread/resume。未连接时 composer 可能返回 settings_available:false；这是设置暂不可修改，不是历史不可读取。已归档会话的元数据也可读。

POST connect 成功连接时返回 `{ok:true,connected:true,mode:"control"}`。外部会话的执行进程暂不可连接时返回 HTTP 200 与 `{ok:true,connected:false,mode:"history",reason:string,code:string}`；独立 writer 仍持有时 code 为 `owner_unavailable`，其他不可用情况为 `control_unavailable`。客户端应继续呈现历史，不能把 ok:true 等同于已控制执行。Web 自动连接重试间隔30秒，也可手动重试。外部会话发送前显式检查 connect；connected:false 时保留正文、附件和目标标记，不继续 POST messages。连接成功后立即更新控制状态和模型设置。用户主动发送/停止仍要求原执行入口，不支持的操作仍返回错误，不会另起执行进程。

`/api/info` 提供 codex_scope 与 agent_scope，均为 workspace 或 all。`--agent-scope all`（ANYWORK_AGENT_SCOPE）明确启用 Codex、Claude Code、Claude Desktop Code、dsh、WorkBuddy 跨项目历史；旧 `--codex-scope all` 仍仅影响 Codex。桌面管理服务显式启用通用 all。新建自管会话仍使用配置工作区，文件路径仍按当前会话 cwd 检查。

Claude 内置 Agent ID 为 `claude-code`、`claude-desktop`，通过同一插件清单、会话、消息、审批、历史和 composer API 使用。CLI 原生 JSONL 与桌面 Code 索引分别发现，明确选择原生会话身份；桌面控制需要有效本地桥入口。`available` 与 capability projection 表达当前入口状态，不能由历史可读推断原宿主可写。设置、目标、消息编辑及服务等级只按当前 Agent 实际支持显示；见 [Claude 接入契约](claude-integration.md)。

dsh 与 WorkBuddy 可从选定本机 profile 只读加载历史，原进程离线不阻止 `/history` 与按 seq 的工具详情读取。部分历史通过 history_notice 说明，旧缓存不因源暂不可读而清空；models/composer 无实时入口时返回 HTTP 200 与 settings_available:false。详见 [dsh 历史](harness-persisted-history.md) 和 [WorkBuddy 历史](workbuddy-persisted-history.md)。

## Local browser handoff

The RAM-only ticket, cookie and local PTY authentication boundary is defined in [local browser sessions](local-browser-session.md). Service-control routes remain bearer-only and are unavailable through the account remote gateway.
