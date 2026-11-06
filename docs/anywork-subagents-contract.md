# 子 Agent 面板还原契约

本轮按用户于 2026-11-06 提供的截图补充子 Agent 界面。目标应用保持只读，没有运行目标模块、修改安装包、连接供应商服务或向实际会话发送验证消息。截图说明可见结果；下面的条件、结构和尺寸以当前安装包静态成员为依据，不能据此声称完成原应用动态像素验收。

## 目标身份与证据边界

当前 `/Applications/ChatGPT.app/Contents/Resources/app.asar` 的 SHA-256 为 `5ddc4e48259aa6f979e04529b1a5a4ae54b0f5c4ad6db5c6e004924c10916ddb`，包内身份 `openai-codex-electron`、版本 `26.1013.40934`。它与既有 `anywork-reference-contract.md` 的 `52e0a65f…bcc8` / `26.1027.51404` **不是同一份原包**；本轮没有沿用旧模块哈希假装当前路径。第一次请求旧路径被 REA 的 exact inventory 校验拒绝，随后读取当前 ASAR header 定位以下真实成员。

REA 父 Evidence：`ev_ca057aa2a32888445515c1781d901f4b191a0097cd818eca98f65af25eb14d3b`；摘要：`ev_6609b2abd90951b9c6e3edc2c71a012244b2ef115724ff2b6d41fb44121724f5`。定向选择 5 个 JavaScript 成员，20,985 bytes、5 parsed、0 parse failures；16,318 个库存文件未选择。application / semantic graph 为 partial，semantic unknown retention 到 1,000 上限。7 个无关 unpacked native 的声明 hash 与实际字节矛盾，以 record-and-continue 记录；未执行它们。不能由局部静态观察推定全应用控制路径完整。

| ASAR 内相对 `webview/assets/` 的路径 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `subagent-panel-e9d5ac5a8766.js` | 6,090 | `5a65b0111e5441c116f2d1e40aaef2c8ae56f05f241acade569025bc38fbcac0` |
| `subagent-row-df679decb133.js` | 883 | `f03b33b2b3f867df17ed67e8b53469ab0b37b39a5989f2ae8b7561d246a57681` |
| `local-conversation-subagents-panel-tab-33b5e3e9938b.js` | 7,483 | `a7b742f31e87f339bff39ecfc91816d90987b0eccc88330454c60f0d18dead4d` |
| `subagents-1b4a487b068b.js` | 2,821 | `7541c5582f62e1a3d993993ba658bbda7863bde07d97f6d5c377d5ee87bb6f03` |
| `subagents-204a0bfeaba2.js` | 3,708 | `a72d7b94ea4f8f77db3864f6a3db701191d5d58700a6b879b08f3d1255472edb` |

包内成员按 ASAR header 的 offset/size 静态读取到 `/private/tmp/anywork-subagents-20261106`。下面额外引用的 `app-primary-b4ce9e46e8cf.js`、`app-initial-90eb42395b7d.js` 和 `task-elapsed-time-a3ac6b69c4de.js` 是**额外的静态逐段读取**，不属于以上 REA 的 5 模块选择。

## 面板列表与导航

`local-conversation-subagents-panel-tab` 的 `I` 组件：先经 imported `D` 排序，再分 `status !== 'done'` 和 `status === 'done'`。`app-primary.Mat` 的实际排序为复制数组后按 `recencyAtMs ?? 0` 降序。Active 初始 4 条、Done 初始 10 条；展开增量为该组总数，因此一次显示剩余全部。Active 无条目时仍显示标题和 No active subagents；Done 无条目时不占空间。waiting 属于 Active，组标题右侧可显示等待数量。

`V` 映射行：以 conversationId 为 avatar seed 和唯一 ID，displayName 为标题。预览优先 objective 的纯文本摘要，最长约 60 字符；其次 statusSummary；非 done 且无预览时显示 Working。`W` 右侧内容：waiting 标签，非 done 且有 startedAtMs 时的实时运行时长；done 且有 lastAssistantMessageAtMs 或 recencyAtMs 时使用 relative 时间。运行时长来自 `task-elapsed-time` 每 1 秒刷新，不是每次收到事件才刷新。

`F` 的 selected 分支仍在当前 Subagents 侧面板中渲染子会话 transcript，增加一个详情头。`B` 头部有返回按钮、同一个头像、名称，以及模型/思考强度；返回把 selected conversation/name 清为 null。原实现也允许从子会话继续打开它的子 Agent。详情是现有会话视图，点击列表不等于启动新 Agent。AnyWork 使用 `onOpenAgent(entry)` 进入同面板详情；`onOpenSession` 是可选的显式完整会话入口，只有发现真实 session ID 时出现。

`subagents-1b4a487b068b` 是标签缩略图路径，仅显示内存已加载条目数以及最多 4 个 agent；不能将这个缩略图限制误用为完整列表。`subagents-204a0bfeaba2` 是 ChatGPT Work 的独立数据模型，waiting/working/done/failed，不能直接当成本地 Codex status 枚举。

## 精确布局

`subagent-panel` 的 `w / y / h / T` 是当前本地面板共享布局：

| 区域 | 包内布局 | AnyWork 实现 |
| --- | --- | --- |
| 可滚动根容器 | `h-full min-h-0 overflow-y-auto px-3 py-5` | 高度 100%，左右 12px，上下 20px |
| 内容宽度 | 居中、`max-w-[var(--thread-content-max-width)]` | 居中，760px 上限，随 split pane 收缩 |
| 分组标题 | `mb-2 gap-3 px-2 text-sm text-tertiary` | 14px/20px、常规字重、左右 8px、底部 8px |
| Done 组间距 | `mt-6` | 24px |
| 列表 | `flex flex-col gap-1` | 行间 4px |
| 可点击行 | `min-h-10 gap-3 rounded-lg px-2 py-2` | 最小 40px，图标到正文 12px，圆角 8px，内边距 8px |
| 头像 | `size-6` | 24×24px，不收缩 |
| 标题行 | `min-h-6 gap-2 text-sm` | 最小 24px，14px，间距 8px |
| 标题 | `min-w-0 flex-1 truncate` | 单行截断；不挤掉时间 |
| 时间 | `text-xs whitespace-nowrap text-tertiary tabular-nums` | 12px，等宽数字，不换行 |
| 预览 | `block text-sm leading-5 text-secondary truncate` | 14px/20px，单行截断 |
| 展开按钮 | `ms-11 mt-2` | 左 44px、上 8px |
| 详情标题头 | `gap-2 px-4`，返回 size-6，标题 text-sm font-medium，模型 text-xs max-w-1/2 | 由父层同面板详情组件复用 |

截图整体有缩放，不能直接把截图的 24 像素头像换算成 CSS 24 像素；本实现直接采用成员给出的 CSS 逻辑尺寸，遵循既有 AnyWork 字体/配色变量和明暗主题。

## 头像资源

`app-initial.pTu` / `mTu` 使用 UTF-16 code unit 迭代，`hash = (hash * 31 + codeUnit) % 2147483647`，最后 `% 28` 选择本地 Codex `_Tu` 调色板；暗色选择 dark，亮色选择 light。不能用随机 emoji 或按列表位置分配头像，否则状态重排会变脸。

公开发行中的 `web/src/subagentAvatars.json` 使用 AnyWork 原创几何头像，共 28 对明暗主题 SVG，继续按照稳定 seed 选择。开发时只读分析的原应用头像不包含在公开源码和发行产物中。公开图形采用 XML 安全内容，仅有基础图形与填色，不执行脚本、不引用外部资源。

## AnyWork 数据投影

`projectSubagents(events, sessions, parentSessionId?)` 只读处理以下明确的成员来源：

- `collabAgentToolCall`：receiverThreadIds / receiverThreads / agentsStates；tool spawnAgent 建立成员、wait / sendInput 更新状态、closeAgent 隐藏。
- `subAgentActivity`：agentThreadId / agentPath / kind。未知成员上的 interacted 不自行创建一个条目。
- `dynamicToolCall` 中明确的 spawn_agent 结果建立成员，已知成员的 read_thread / send_message_to_thread 更新。普通 create_thread 创建的是 Created chats，并不进入 Subagents；普通工具任意 JSON 里的 threadId 也不会被当作子 Agent。

`app-primary.Nat / Iat / Rat / Jat` 的原状态链确认：**工具调用完成不意味着子 Agent 完成，父 turn 完成也不意味着子 Agent 完成。** latest-reference 与子会话 runtime 分离，源状态 running→active、pendingInit→waiting、completed→done；close、interrupted、errored 等不作为普通 Done 行。AnyWork 有已发现的子 session 时，用其实际 runtime status 校准旧父事件，并保留可导航的真实 session ID；未知 ID 绝不启动新执行。导入历史事件 created_at 是索引时间，运行计时只取显式 history_item_started_at_ms / history_work_started_at，缺失就不编造时长。

AnyWork 当前 Session 协议不公开全部原客户端的 descendant/source membership 图；因此只有已加载父事件明确建立的子 Agent 可被这层识别，不能把任意 auxiliary 会话都归到当前父会话。原包的多层来源图、尚未下发的历史分页和远端未发现 session 的实时详情仍依赖后端发现能力，面板不会假装这些数据已存在。

## 验证

`web/src/subagents.test.ts` 验证：父 turn/工具完成后子 Agent 继续运行，wait 状态合并与 recency 排序，真实 session 的状态优先与导航 ID，关闭/中断隔离，read/send 不建立无关成员，spawn_agent JSON 结果、create_thread 不混入成员，历史时间来源，subAgentActivity 成员规则，畸形数据/父会话隔离，初始 4/10 限制，Loading 与空态区分，头像 hash、Unicode 预览和时间格式。以局部组件 SSR 确认 HTML 结构，不将其称为浏览器交互或像素验收。

## 详情的输入器与交互能力

详情复用输入器的补充定向 REA：父 Evidence `ev_99e8707e5c7838983913668dabbce4875c440eac7f3f5ff107cddf7281bcb497`，摘要 `ev_0282ee8be0192e3655c9d96390f3cae39184561572e8015413ecda9b986838a3`，只选择 `webview/assets/local-conversation-thread-845836667d0b.js`。成员 344,921 bytes、SHA-256 `10dd005d42f35d613bcf7038a2bf7fa8ca40fd6bfda864d57ba02409b80de066`，1 parsed、0 failures；其余 16,322 文件未选择，application / semantic coverage 为 partial，semantic 6,000 nodes / 500 unknown 上限。同一原包前述 7 个无关 native integrity 矛盾仍保留，未运行它们。

`local-conversation-subagents-panel-tab.F` 显式以 `selectedAgent?.canInteract === true` 调用详情；找不到成员、能力未知均传 false。它导入的 `t` 实际是 `local-conversation-thread.UA`（原字节字符偏移约 328,431）。`UA` 的通用 prop 默认 canInteract=true，但这个调用者不会依赖默认值。UA 传给 `kA` 的有效条件是：`isReadOnly = !canInteract || isWriterConflict`，`showComposer = canInteract && !isWriterConflict`，`showUtilityBar = false`；自动 resume 还要求 shouldResume、canInteract 以及已加载或 shared 状态。因此不能把所有详情强行做成可写，也不能把全部子 Agent 详情永久设为只读。

`kA`（约 306,359）在 showComposer 时渲染 `PE`（约 190,282）。PE 把 conversationId / hostId、isResponseInProgress、submitDisabled、isThreadResuming、composerPresentation 等交给 `app-primary.Kc`，实际 `MZ / Cpt`；这是通用主输入器。该 app-primary 身份通过额外静态读取核对，不属于本次单模块 REA 的完整语义覆盖。详情并没有一个精简且不同规则的子 Agent 文本框。

`app-primary.Iat` 的 canInteract 来源同样由静态函数体核对：原生 collab spawnAgent 置 true，后续 wait/sendInput/resume 等保留既有 true；仅 subAgentActivity 建立的成员初始 false；source membership 只有找到对应 collab 引用且其 canInteract===true 才保留交互。active / done 不直接决定能力。AnyWork `SubagentEntry.canInteract` 默认为 false，显式 spawn_agent 作为兼容协议保留，普通 create_thread 不建立 Subagents 成员。

权限请求没有子 Agent 专属审批分支。`kA → cA → Sy` 使用通用 transcript pipeline，cA 把 isReadOnly 下传，turn entries 同时携带 requests。其额外静态成员为 `local-conversation-thread-turn-entries-c06ae33db7b8.js`（20,343 bytes）。这能确认复用同一请求呈现链；未运行原 UI，因此不能由这个局部成员声称已验证所有审批按钮的运行状态。AnyWork 复用现有 Composer / RequestCard，绑定真实子会话 ID；仅显式可互动且实际控制能力允许时呈现输入和可操作审批，未知默认只读。普通浏览历史不会启动新的执行进程。

## 最终父层接线验收

`SubagentConversation` 在当前右侧面板读取真实 child history，独立分页与刷新；可互动成员复用通用 Composer、RequestCard 和按子会话保存的草稿。发送、引导、停止、上传与队列编辑均使用 child ID。父会话仍是选中项，返回列表、关闭面板和打开子文档不改写父草稿。文件标签携带 sourceSessionId，标签存储归父会话所有，文件 API 与 cwd 使用来源子会话，切回 Subagents 保留已选成员。

`e2e/subagents.spec.ts` 在 desktop/android-web 验证列表分组和展开、生命周期行到同面板详情、child 引导的真实请求 ID、父 URL/草稿保留、返回和关闭刷新、未知历史只读且零执行写入，以及图片查看器跨刷新和子文档来源。与菜单专项合计 18 项通过，页面数据来自隔离 fixture；完整验证边界见 [2026-11-06 验收记录](validation-2026-11-06.md)。
