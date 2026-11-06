# AnyWork 会话区域参考契约

顶部标签与浮动菜单的后续校准见[会话子窗口与菜单契约](conversation-panels.md)；目标创建复用主输入器的后续规则见[目标编辑与输入契约](anywork-goal-editor-contract.md)。桌面原执行进程协作的独立研究见[共享执行引擎调研](desktop-collaboration.md)。

参考日期：2026-11-04。目标为用户指定的 `/Applications/ChatGPT.app/Contents/Resources/app.asar`，包内身份是 `openai-codex-electron` / Codex `26.1027.51404`。ASAR SHA-256：`52e0a65f9fea51f4287bbd98c63343761f9424517bb793652bb554764bc0bcc8`。

仅读取安装包；参考模块按原 ASAR offset/size 读取到临时目录分析，没有运行或修改应用。首次 REA Evidence `ev_c25ec73c6d394502ab407e29b70c89987537d476df78788d742e061f6e8b12ea` 选择含转发 stub；后续改为实际页面、thread、turn、composer、用户气泡和 split-view 模块，父 Evidence 为 `ev_b5048bd0580418aefcd592adc875aaec09d617d5035ee6a9d8ad3c8e44e537ab`。下列包内规则来自实际编译后的 CSS/JavaScript 静态观察。原应用 UI 的计算机控制接口禁止访问，因此没有绕过此限制。用户随后提供了三张原应用实际远程会话截图，可校对可见分支，但没有提供 DPR、缩放及字号设置。原应用 bundle 不随项目分发。

## 用户提供的实际截图基准

三张原图都是 2204×1792 物理像素。本地 `artifacts/reference/` 保留左侧会话部分的无缩放裁切（x=0…963），便于后续比较；完整来源名称、原图 SHA-256、裁切坐标保存在该目录的 `codex-session-sources.json`。截图属于个人会话资料，不纳入源码发布归档。这是用户提供的图像，不是通过受限应用控制接口重新抓取的图像。

| 参考 | 可见状态 | 重点 |
|---|---|---|
| 01（本地 `artifacts/reference/codex-session-01.png`） | 工作过程折叠/展开、用户消息、助手回复、空输入框 | 普通消息宽度、过程分隔线、底部回复动作 |
| 02（本地 `artifacts/reference/codex-session-02.png`） | 工作进行中、排队消息、目标条、输入框 | 顶部单行结构、堆叠条、停止按钮、权限图标 |
| 03（本地 `artifacts/reference/codex-session-03.png`） | 输入框有两张图片和草稿、目标条 | 附件尺寸、草稿布局、发送按钮 |

原图 SHA-256（按01/02/03顺序）：

- `e14bb597c0769623fa2a866b19a88b617c8376dd2f8fe0f164862401dde0aad8`
- `afeec1bd85e1f95eb0024f8b11332868418d7db9ac9a0bed60dea08c5c81742a`
- `5309f0d70347ee3089ef243fa624811ec548cbf1274acb25f8b9bc4a2454b206`

以下 CSS 数值按 2 个物理像素对应 1 CSS px **推定**；2×与包内圆角/按钮等尺寸吻合，但没有运行时 DPR/浏览器缩放读数，不应把推定写成测得的环境事实。坐标均为原图左上角起点，允许边缘抗锯齿造成约 1–2 个物理像素误差。

| 区域 | 原图物理像素观察 | 推定 CSS 几何 |
|---|---|---|
| 顶栏 | y=0…85；聊天标题、右侧文档 tab 处于同一行 | 高约43px；没有会话第二排工具栏 |
| 左会话 pane | x≈2…961 | 宽约480px |
| 左会话内容 | x≈34…930 | 两侧约17px；可用宽约448px |
| 空输入框 | x≈34…930，y≈1556…1754 | 448×99px；圆角22px；底部余量约19px |
| 输入框底部控制 | 中线y≈1707；发送/停止直径约56px | 控制按钮28px |
| 发送前附件 | 第一张x≈59…303、第二张x≈319…563；y≈1321…1565 | 122×122px，间隔8px，圆角约7px |
| 用户消息01 | x≈351…930，y≈778…864 | 宽约290px、高43px；右对齐 |
| 排队/目标条 | x≈61…904；主输入框x≈34…930 | 堆叠条比主输入框左右各缩进约13.5px；前后有覆盖关系 |

可见会话正文字形高度及行距更接近14px CSS，而包内默认回退为13px；这是截图视觉推定，可能来自用户字号设置，需作为截图匹配值与包内默认值分别记录。AnyWork 本次默认使用14px匹配用户截图；原应用运行时字号偏好仍未知。标题字号约15px。无角色名称或头像列；工具/工作活动用灰色图标和普通行。最终回复操作区可见复制、评价、朗读、更多图标。

截图01中大块区域的实际 RGB 采样：会话和输入框内部 `#ffffff`；用户气泡 `#f3f3f3`；主要文字 `#0d0d0d`；输入占位文本主要为 `#c3c3c3`；禁用发送按钮为 `#868686`。顶栏主体为 `#f3f3f3`，边缘存在渐变/系统材质，不能等同于整条纯色背景。上述采样只描述这张浅色截图，不覆盖主题映射规则。

输入框底部从左到右为：加号、**仅图标的权限盾牌**、弹性空白、活动环、模型名称 `6.1 Sol`、思考强度 `中`/`高` 和下箭头、麦克风、发送/停止。截图未显示权限文字；模型与强度紧邻且共享下拉区域。左侧盾牌不是常驻审批说明卡。输入框没有额外的顶部分隔线或第二层独立控制卡片。

完整截图右侧文档区域还有面包屑胶囊、显示更改按钮和文件树；文件标签与会话标题在同一个顶栏。文档区域内容从其 pane 内部开始，其内部面包屑不是全局的第二排工具栏。由宽屏截图无法验证移动端抽屉分支；移动端交互以包内 split-view 规则及 AnyWork 实测为准。

## 基础值与排版

| 项目 | 包内观测 | 位置 |
|---|---|---|
| spacing | `.25rem`（默认根字号下 4px） | `webview/assets/fd9b7fd80db1.css` |
| 对话字号 | `var(--codex-chat-font-size-override,var(--font-ui-size,13px))` | 同上 `:root` |
| 代码字号 | `var(--codex-chat-code-font-size-override,var(--font-code-size,12px))` | 同上 |
| 正文字体 | `var(--codex-content-font-family,var(--font-sans))` | 同上 |
| 正文行高 | 字号 × `1.625` | 同上及 `b74e19ff7ff4.css` 的 `._MarkdownRoot_xjxw3_2` |
| 相邻会话内容块间隔 | 16px；分组内部 4px | `--conversation-item-gap` / `--conversation-grouped-item-gap`、`conversation-gap-33a111a3a1dd.js` |
| 通用内容宽度 | 根为 `none`，局部有 42rem/48rem/100% 等变量覆盖；不可仅凭全局规则断言运行值 | `fd9b7fd80db1.css` |

Markdown 根 `._MarkdownRoot_xjxw3_2` 设置 `overflow-wrap:anywhere`、字号取对话字号、`--markdown-space = font-size / 4`。普通段落底边距为 `space`；相邻顶层段落 `margin-block:4*space`。h1 为 1.5em、行高 8*space、上下边距 4*space/2*space；h2 为1.25em、行高7*space、上下4*space/space；h3为1.125em、行高7*space、上下4*space/space。列表缩进为正文行高；引用透明背景、左缩进6*space、竖线宽space/圆角space/2。行内代码圆角6px、padding1px 6px、字号.92em。代码块上下间隔5*space。以上来自 `b74e19ff7ff4.css`。

## 用户消息

实际组件 `user-message-2c7dafc6a971.js` 外层：

- `group/user-message flex w-full flex-col gap-1`；普通分支 `items-end`。
- 气泡 `user-message-bubble-69113155ff5a.js`：`div[data-user-message-bubble=true]`，类为 `bg-user-message text-user-message min-w-0 max-w-(--user-chat-width) overflow-hidden break-words px-(--thread-content-margin)`，加 `py-2.5 rounded-2xl relative text-start`。
- `d754c8cd8b21.css` 的 `._bubble_nu8ad_1` 设置 max-width70%、圆角22px、横向padding16px；`py-2.5`=纵向10px。
- 文本由 `user-formatted-text-9c067d7eaaf3.js` 处理：外层 `text-size-chat whitespace-pre-wrap`，内层 `rich-text-user-turn`；直接段落margin0，连续段落顶部20px，列表缩进24px。序列化文本使用专门 blank-lines span 保留换行。
- 消息操作行 `flex turn-action-controls items-center gap-0.5`；时间/操作正常隐藏，组 hover 或 focus-within 显示。气泡到操作行间距4px。
- compact/Aeon 分支不是本地普通对话：max-width `min(456px,100%)`、圆角16px、横padding12px。不能与普通分支混用。

## 工作过程、折叠和回复顺序

`local-conversation-turn-38748c1efdd4.js` / `subagent-activity-chip-group-2fb46825e7e8.js`：

1. 用户消息。
2. 可折叠工作过程；最终回复开始且未取消时允许自动折叠，显示总耗时或历史消息数。用户展开状态优先于默认自动折叠。
3. 最终助手回复和产物。

`collapsed-turn-disclosure-c085a229d2d0.js`：折叠标题使用 `ghostTertiary`、`small`圆角、`inline`尺寸按钮，`inline-flex max-w-full flex-wrap text-size-chat`，`aria-expanded` 为是否展开。文本后跟小箭头，折叠rotate0、展开rotate90。标题后总有 `pt-1` 容器里的1px分隔线。无耗时则回退为 previous messages 数量；存在拒绝动作时右侧显示历史拒绝计数。

`gM()` 渲染顺序为标题、持久显示内容、可展开内容。展开内容前插入标准16px间隔；展开动画 height:auto、opacity1、translateY0；收起 height0、opacity0、translateY(-8px)，收起150ms；减少动态效果时禁用位移。工作活动本身用普通行、细分组和独立 disclosure，不应给每条思考加卡片。

`worked-for-item-content-1c81eeafcebe.js` 明确区分 loading/unknown/paused/working/worked/stopped，working1秒后开始显示时长，每秒更新；completed耗时以completedAt-startedAt计算，负数钳为0。worked区行列 `flex min-h-0 flex-col items-start gap-2 text-size-chat text-secondary`，下面全宽分隔线。

## 输入框

`b74e19ff7ff4.css` 的 `._ComposerLayoutRoot_1hyg8_2` 是布局根，包含 Body、Attachments、Input、Footer；不要把 input 与底部控制条作为无关联卡片。

| 项目 | 普通默认分支 |
|---|---|
| 圆角 | `--composer-radius:spacing*5.5`=22px；round |
| 到视口底部 | `--thread-composer-bottom-inset:spacing*4`=16px |
| 编辑器行高 | 20px |
| 最小编辑器高度 | 44px；compact分支20px |
| 输入内边距 | 默认0 12px；活动线程footer覆盖为0 18px |
| 输入到footer间距 | 4px |
| footer | grid；multiline列为 `minmax(0,auto) auto minmax(0,1fr)`，列间距5px；横padding8px、下边距8px |
| 无附件时顶部槽 | padding8px 8px 6px |
| placeholder | opacity .5 |
| 附件槽 | inset8px，下padding6px，内圆角 `max(0px,border-radius-inset-spacing)` |
| 编辑器最大高度 | 常规上限 `min(25dvh,var(--composer-editor-max-height,25dvh))` |
| 普通控制按钮 | 28px；comfortable32px、dictation36px等条件覆盖 |

默认/opaque surface取`--color-surface-elevated-secondary`，深色通常取`--color-background-composer-surface`；border0。全局有elevation定义，但浏览器/electron分支另有outline规则，且高对比模式等条件必须保留原CSS语境，不能只取字符串就推断真实显示。单行+无附件/无堆叠footer允许全圆角，出现附件或堆叠控制后回到22px。

### 模型与思考强度菜单

后续聚焦读取 `app-primary-1309b9ae7c5f.js` 与 `59ad52d5aa88.css`：触发器 `._ModelPickerTriggerContent_1sfbj_2` 最大宽度256px，flex居中；模型和强度所在的 label/group 是 inline-flex、垂直居中、gap4px。模型名称用主文字色并允许 ellipsis，强度用 tertiary 色，模式图标14px。触发器中的模型、强度、下箭头是一组，不能拆成两颗独立的原生 select。

`._ModelPickerDropdownContent_1sfbj_2` 的内容宽为 `spacing*63.5`=254px，菜单gutter0、ring默认0.5px、阴影为`shadow-xl-spread`；browser分支translateY(-4px)。动态展开用opacity/filter/scale过渡，减少动态效果时关闭动画。`._ModelList_5d7qv_2` 最大高度 `min(316px, availableHeight-4px)`、左右padding4px，可纵向滚动。

静态组件支持 simple 与 advanced 两种分支：simple 显示 power slider，可以从标题切换至模型列表；advanced 显示菜单选择。模型列表使用 menuitemradio、aria-checked 和选中勾选；模型名称与描述来自运行时模型数据，不能把截图中的 `6.1 Sol` 固定为唯一模型。菜单头 ViewControls 最小高36px、横padding8px（含fast toggle时16px，显式模型32px）；标题 ViewToggle 最小高32px、padding4px、圆角8px；内层padding2px4px、圆角6px、gap2px。三张用户截图均没有打开该菜单，因此不能确定截图实例实际进入 simple 还是 advanced 分支。后续已追通普通本地 Codex 的档位算法、显式模型分支、速度入口及提交时机，见下文“模型菜单完整可执行契约”；未知范围限于实际账户配置及运行时取值。

## 审批

`composer-approval-request-card-4ca3a5a5aa1a.js`：审批卡为命名容器 `@container/approval-card`。body是列布局，gap8px，padding16px 16px 12px；动作区横向gap8px、padding8px 16px 16px。Approve默认英文为`Allow once`，另有scopedApproveAction和leadingAction（可菜单）。拒绝动作独立存在。快捷键仅当卡活跃、未禁用、非loading且焦点不在input/textarea/contenteditable时启用，不能在打字时触发批准。

容器宽小于28rem时动作区变列布局、按钮全宽、隐藏快捷键提示。不能用页面宽度代替审批卡宽度；分屏变窄时同样适用。

### 本地审批决策、会话范围与规则修订

2026-11-04定向核对 `pending-request-item-panel-7bd97b9a7e39.js`。`Wr` 按pending request类型分派：`approval → Jr`（命令/文件/托管网络），`permissionRequest → cr`（显式权限请求），`mcpServerElicitation → Sn`（另一模块）。以下只描述前两条本地链路；**MCP elicitation、managed worktree权限设置、自动审查偏好提示均不是这些批准动作的替代接口。** 所列位置为临时副本中的近似字符位置，不是原始源码行号。

| 位置 | 证据范围 |
|---|---|
| `pending-request-item-panel-7bd97b9a7e39.js` `Wr`，约64237 | pending类型分派 |
| 同模块 `Jr`，约73100；`$r/ei`，约84700 | command/file/network按钮、条件、实际reply决策 |
| 同模块 `cr/lr`，约28800 | permissions turn/session回复、strictAutoReview与宿主过滤 |
| 同模块 `Yr/Xr`，约82661 | 首个allow网络提案、exec前缀的换行检查 |
| `permission-request-model-48b92aef39fa.js` `t/n/r` | filesystem entries与network显示模型 |
| `composer-approval-request-card-4ca3a5a5aa1a.js` `G` | 通用split-button、下拉菜单、默认标签和布局 |
| `app-initial-61c1d0e6137e.js` `OCn/kCn`，约3351000 | 原始request到UI活动项的转换、同item文件diff |

所有分支默认primary为“允许一次”，拒绝为“拒绝”。有scope动作时primary变成split-button，箭头无障碍标签“审批选项”，下拉顺序是“允许一次”、该scope项；scope项存在说明时显示信息图标/tooltip。leading action是主按钮之外左侧的独立outline按钮，不能误放成另一个primary。提交通过原始requestId关联宿主reply；请求中的itemId用于匹配活动项，不能替代reply id。组件使用ref避免同一request重复发送，失败清除ref允许重试。

| 请求与条件 | 可见操作/说明 | 原包实际reply内容 |
|---|---|---|
| 普通命令 | 允许一次 | `"accept"` |
| 普通命令 | 拒绝 | `"decline"` |
| 普通命令，非 `STEPS_PROSE`，`Xr(proposedExecpolicyAmendment)` 非null | scope“允许类似命令”；tooltip“允许在此对话中使用以 {command} 开头的命令” | `{acceptWithExecpolicyAmendment:{execpolicy_amendment:原提案数组}}` |
| 文件变更 | scope“允许所有修改”；tooltip“允许在此对话中进行本次及后续文件编辑，无需再次询问” | `"acceptForSession"` |
| command附 `networkApprovalContext` | scope默认“允许此对话” | `"acceptForSession"` |
| 同上，`proposedNetworkPolicyAmendments` 存在 `action==="allow"` 的项 | leading“始终允许” | `{applyNetworkPolicyAmendment:{network_policy_amendment:首个allow提案对象}}` |
| permissions请求，允许一次 | 授予本轮 | `{permissions:effectivePermissions,scope:"turn",strictAutoReview:H}` |
| permissions请求，详情等级非 `STEPS_PROSE` | scope默认“允许此对话” | `{permissions:effectivePermissions,scope:"session",strictAutoReview:H}` |
| permissions请求，拒绝 | 拒绝 | `{permissions:{},scope:"turn"}` |

命令/文件通过 `replyWithCommandExecutionApprovalDecision` / `replyWithFileChangeApprovalDecision`；permissions通过 `replyWithPermissionsRequestApprovalResponse`。`applyNetworkPolicyAmendment` 是此版本实际网络决策名，不能误写为 `acceptWithNetworkPolicyAmendment`。`$r` 在缺少对应提案时抛错；`ei` 只映射accept、acceptForSession、decline。原包通用网络按钮并不让用户任意编辑host/action，且只选择首个allow提案；未观察到对deny网络提案的同类按钮。

`Xr` 对exec提案仅检查null，或将数组以空格连接后是否包含CR/LF；含换行则返回null，其余返回原数组。**它没有显式检查数组非空**，不能把“原包已验证非空”写成证据。tooltip用 `uCn` 对每个参数shellquote后以空格连接，回复仍使用原始数组；不要把显示字符串重新拆成规则，也不要自己推导命令前缀。scope的“会话允许”语义必须由该reply实现，不能通过把全局审批改为never、修改worktree或永久持久设置冒充。

`STEPS_PROSE` 是原包的隐藏命令详情模式：普通exec不显示“允许类似命令”，permissions不显示scope=session；文件的“允许所有修改”以及network-context的“允许此对话”没有同样的隐藏条件。不能对四类请求统一套用同一个scope可用性开关。普通exec没有无条件的acceptForSession按钮；原包已有的桌面通知处理可以发送acceptForSession，但不能据此声称正文卡片常驻这个动作。

### 审批标题、请求内容与权限显示

`Jr` 的普通exec身份为“终端”，无reason时标题“允许 ChatGPT 运行此命令？”，有非空reason时直接以reason为标题；`STEPS_PROSE` 身份为“请求权限”，若有reason则隐藏命令body，没有reason仍可显示命令preview。命令preview用 `item.cmd.join(" ")`，代码字体，默认折叠3行，可“展开/折叠”，最大高度20rem。网络context分支用“互联网访问”身份，标题“允许 ChatGPT 与 {destination} 建立连接？”，副标题“{host} 不在当前网络允许列表中”；http/https destination显示为链接，其他协议只显示host，不混入普通命令preview。

fileChange身份“编辑文件”，标题按文件数量渲染“是否允许 ChatGPT 编辑以下文件？”。`OCn/kCn` 在同turn.items逆序查找 `type=fileChange && id===request.params.itemId`，从该item的changes构造UI数据；请求没有直接携带diff时不能虚构。`Yn` 遍历 `item.changes`，普通模式提供diff preview tooltip及增删计数，最大200px滚动；预览太大则显示相应提示。`STEPS_PROSE` 隐藏diff详情但仍显示路径、rename/move的源目标。grantRoot来自request参数，不替代同item changes。

`cr` 的permission详情先经 `permission-request-model` 转为显示组：network字段非null即加入网络详情；filesystem遍历 `entries`，按read/write分别去重，同显示路径同时出现读写则合并readWrite，再输出read、write组。这个合并只用于文字展示；实际授权回复必须保留有效权限对象的结构与范围，不能把basename或合并后的字符串当作授权payload。

| permission entry path | 显示路径 |
|---|---|
| `{type:"path",path}` | `path` |
| `{type:"glob_pattern",pattern}` | `pattern` |
| special root | `/` |
| special minimal | `:minimal` |
| special project_roots | `:project_roots`，有subpath时追加 `/subpath` |
| special tmpdir | `:tmpdir` |
| special slash_tmp | `/tmp` |
| special unknown | 原path，有subpath时追加 `/subpath` |

paths以图标+basename显示，完整路径在tooltip，多路径用本地化conjunction连接。纯网络标题“允许 ChatGPT 连接互联网？”；单一文件权限分别为“允许 ChatGPT 查看 {paths} 的内容吗？”、“允许 ChatGPT 编辑 {paths} 的内容吗？”、“允许 ChatGPT 查看和编辑 {paths} 的内容？”。多种权限合成“允许 ChatGPT {actions}？”。有actor时使用对应子代理标题，不能把子代理名丢失。纯network身份为“互联网访问”，含filesystem时为“权限”，reason作为subtitle。

permission有效payload存在两个原生条件：flag `1378180112` 开启、filesystem存在且详情等级为 `STEPS_PROSE` 时，先等待宿主 `permissionPolicy.filter({hostId,permissions,threadDetailLevel})`，其返回permissions用于展示和授权；等待期间不显示卡片。过滤完成无可展示权限时原包自动回复 `{permissions:{},scope:"turn"}`。无该宿主能力时AnyWork不能伪装过滤结果，也不能为未知权限结构臆造授权。

允许时 `strictAutoReview` 的实际布尔值 `H = flag("1258561229") && detailLevel==="STEPS_PROSE" && effectivePermissions.network.enabled===true`；一次/会话都发送H，拒绝不含此字段。此值不是scope=session的同义词，也不是用户选择“始终允许”。原包外围manual-approval nudge可在满足条件时另外建议切换自动审查，但不改变本次reply的决策对象，不属于本节scope动作。

### 协议版本边界与审批取证记录

本次选定版本的pending panel及 `OCn` 转换没有使用 `availableDecisions` 或 `additionalPermissions` 字段，不能据此忽略AnyWork当前宿主schema的约束。`writeStdin` 在pending panel没有专门渲染分支；app-initial另有tool-call分析数据转换为 `{type:"write_stdin",approval_id,process_id,stdin,cwd}`，这不是该审批卡片的UI证据。当前新schema提供的额外动作、明确空availableDecisions、additionalPermissions、writeStdin命令来源等须按真实协议实施并另记验证，不能补写成此旧UI已观察到的行为。`cancel` 的协议能力同样不能证明原卡片存在独立取消按钮，原“拒绝”按钮明确发送decline。

父任务对副本目录的单模块REA：父Evidence `ev_d684c44062e2591602377d2f06c171bdfdda420c75f2f912fc103e7cbcfc93ae`，摘要 `ev_ea1422a0f846cdb334137eafc418098bca299e35aca8d8b78513d90a7ae36caf`；目录digest `df31398bcef81a08159e76eacf90335973916e839bda8abe04097ab91bd1a99d`；只解析pending panel共86399字节、0失败，248其他文件未分析，关系partial。

本节另一次原始ASAR定向REA选择pending panel、composer card、permission model三个模块：父Evidence `ev_46922f7e9d8a1e18fe85c9fdbcedf8bb0d2e111d99b3f3636611a9493c7a5dcc`，摘要 `ev_2c3c57f6dcaa4e51c058eb7dc5a0a1036ae539f66ff1c05f59fb86e311bff028`；3文件96206字节、0解析失败，17531文件未分析，关系partial，semantic unknown达到配置上限。若干旁置原生依赖完整性元数据与字节矛盾，以record-and-continue保留限制；没有运行这些依赖，也没有启动/控制原应用。静态关系不证明完整产品或所有审批运行行为等价。

| 模块 | SHA-256 |
|---|---|
| `pending-request-item-panel-7bd97b9a7e39.js` | `80e85c67a3dcd250ede91234fd5448ca8ba5b32c751a027eab281c54371b8597` |
| `composer-approval-request-card-4ca3a5a5aa1a.js` | `dc6d0ded723d8231025bab0c57ff14fee35e30c83d277b07295dfa3478ebce62` |
| `permission-request-model-48b92aef39fa.js` | `01dd7fa1625a5e1cf0e149f42311fc5cb960d73d9b3e952e53f436a704c0cf4c` |

## 分屏

`split-view-eadee9d94156.js`：

- 原组件默认左右最小160px、分隔条交互宽12px、左右初始比例50%，调用方可覆盖。
- 用容器ResizeObserver计算宽度，保存`${id}:split-left-width`比例，重新打开时恢复；容器尺寸变化重新钳位。
- 分隔条中线宽1px，hover增强颜色；pointer capture及touch-none避免触屏拖动变为滚动。
- 键盘ArrowLeft/ArrowRight每次10px，Home到左最小、End到右最小。separator暴露aria-orientation、aria-controls、aria-valuemin/max/now。
- 容器<=720px转drawer模式，宽为容器90%再经drawerMaxWidth/minRightWidth/visibleInset限制，向右平移开合。该值是组件默认，具体thread调用参数需要进一步核对。
- 分屏左右内容绝对定位且各自contain:strict；拖动时禁用宽度/位移过渡，普通展开时恢复过渡。不能把整页window.innerWidth当作可分配区域（侧栏/其他面板会占宽）。

## 验收边界

静态规则与三张用户截图足以建立可测试的可见组件契约，尚不能据此宣称所有状态已完成逐像素1:1。截图明确了当前浅色、窄聊天 pane、普通输入框/附件和堆叠条的外观，但原图未提供字号偏好、DPR和缩放；未展示审批卡打开状态、模型菜单、移动抽屉、深色主题及全部动态分支。AnyWork应把自己的桌面与移动端真实流程回归（审批、问答、消息排队、图片、文档、分屏、断线恢复）与参考应用静态取证、截图观察分别记录。

## REA 复核记录

2026-11-04 对实际页面、thread、turn、composer 内容、用户气泡和 split-view 六个模块进行补充分析，父 Evidence `ev_b5048bd0580418aefcd592adc875aaec09d617d5035ee6a9d8ad3c8e44e537ab`，摘要 `ev_00e1006b7941234dc6d7269bdfe8811ce307fcfa8a43f89eed64e27da25fac3d`。六个模块均解析成功（1,154,545 字节）；静态关系覆盖仍为部分，不能证明运行行为等价。ASAR 内若干旁置原生依赖的完整性摘要不一致，以 record-and-continue 保留该限制；这些依赖不参与所选 UI 还原。应用目录保持只读。


## 语音与评价的后续聚焦静态核对

同一参考包的 `app-initial-61c1d0e6137e.js` 显示普通听写 POST `/transcribe`，流式听写先 POST `/codex/dictation-stream-connect-info` 后连接返回的 WebSocket 或宿主 `dictationStreaming`；所读渲染器没有本地识别算法。`app-primary-1309b9ae7c5f.js` 的回答朗读调用 GET `/synthesize` 或 POST `/pronunciation/synthesize`。逐条评价使用 `/conversation/message_feedback` 或 `/unified_user_signals`，不是 app-server 诊断反馈接口。这些是对同一包的后续定向源码读取，**不属于前述六模块 REA 批次覆盖范围**；未执行语音服务或发送录音。

两套本机生成的 ClientRequest 方法枚举分别有175和179项，没有独立 dictation/transcribe/synthesize/readAloud/messageFeedback/rating RPC。两份 schema SHA-256 分别为 `503d09a12ae36fca152e044877d22e93b0094c2d08c3a53ed731f3c8cf33b9ce`、`7a671e8037fa2f5173ec49d2463e0080553bd284e640074a656504f541eab8e7`。存在实验性 `thread/realtime/*`，但其线程上下文、委派与启动结束指令意味着它不能直接当作已验证无副作用的草稿听写或回答朗读。`feedback/save` 保存本地诊断 ZIP，`feedback/upload` 上传诊断，均不能冒充逐条回答评价。

`app-initial` SHA-256 为 `7a8d8b711bf2eb1adbfab04818a63bf6517935d11bb4d0d4c9d6602d1e3fe6f2`；`app-primary` 为 `13d4eaac047bffc5a99d5f2207db7d646a9dc26c5bd259ee707653897a1691f7`。上述结论仅覆盖选定版本及协议，不能证明未来版本或未公开宿主接口不存在其他实现。AnyWork 的逐条评价应使用明确的本地保存语义；浏览器平台或本地语音引擎需要独立验证。用户本轮选择保留语音能力差距，先审阅当前会话界面。

## 回复操作、反馈详情与高级模型的补充契约

以下为2026-11-04对同一只读 ASAR 的进一步定向静态读取，临时副本位于 `/private/tmp/anywork-reference`。没有操作参考应用运行时，没有调用供应商反馈或语音服务；这些模块不属于前述六模块 REA Evidence 的覆盖范围。中文文案直接来自 `zh-CN-88ebb426d686.js`，组件结构与条件来自下面所列原始模块。

### 标准回复操作区

用户截图01可见的顺序为复制、评价、朗读、更多。`response-rating-control-59cdc0902cc2.js` 的标准 `response` 变体使用**一个组合赞踩触发器**，`ghost`、`icon`，默认提示和无障碍标签均为“评价回复”。它向上打开菜单，仅有“回复优秀”和“回复不佳”两项，分别带轮廓赞/踩图标。选中后变为单个实心赞/踩图标，`aria-pressed=true`，提示变为“移除‘回复优秀’反馈”或“移除‘回复不佳’反馈”（实际翻译使用中文双引号）；再次点击清除该项评分。评分改变后恢复触发器焦点，负反馈打开详情窗时除外。独立双赞踩以及 `Show more` 属于图片相关变体，不应套入标准回复工具栏。

`chatgpt-conversation-turn-content-2af534598528.js` 中 `More actions` 的可选内容包括时间、查看来源、`Continue in new chat`、页面/项目保存和收藏，各项由调用方回调与条件决定；不能把所有静态分支当作本实例常驻可用功能。菜单向上打开。截图能确认图标顺序，尚未取得足以独立证明标准助手工具栏整体间距的运行时读数。

`chatgpt-audio-playback-button-5428230e8262.js` 使用 `ghost`、`icon` 按钮，默认图标 `icon-xs`。空闲为扬声器、`Read aloud`；加载为 spinner、`Loading audio…`，禁用且 `aria-busy`；播放中为圆内停止方块、`Stop reading aloud`，`aria-pressed=true`。按钮可受 `audio.read-aloud` 能力开关隐藏，静态分支不能证明当前账户可用。

### 负反馈详情窗与本地保存差异

`message-rating-924f12f4475e.js` 的 `R` 组件标准 `response` 变体是单选 `radiogroup`，标题“提交反馈”，组标签“反馈选项”。标签的原始标识、原顺序与精确中文如下：

| 原始 tag 标识 | 中文文案 |
|---|---|
| `incorrect-or-incomplete` | 不正确或不完整 |
| `not-what-i-asked-for` | 不是我想要的 |
| `slow-or-buggy` | 响应慢或有错误 |
| `style-or-tone` | 风格或语气 |
| `safety-or-legal-concern` | 安全或法律问题 |
| `other` | 其他 |

`hasModelWrittenDil=true` 时还会在前面加入 `visual-quality`（英文 `Visual is unhelpful or broken`）；该条件不应无依据加入普通文本反馈。标准 response 选择一个标签后替换为 `[tag]`，图片变体才支持多选。详情回调结构为 `{details,tags,tagChoices}`，其中 `tagChoices` 是实际显示的全部原始标识。

弹窗尺寸由 `app-shared-e711d01481fb.js` 的 `LSn` / `HSn` / `ISn` 决定：`size=feedback` 映射 `w-xl`，CSS `fd9b7fd80db1.css` 的 `--container-xl:36rem`，即默认根字号下576px；最大宽92vw，视口居中，`variant=chatgpt` 取 surface 背景与 `shadow-lg`、16px圆角，深色覆盖 surface-tertiary。关闭按钮32×32px、8px圆角，顶部及右侧各12px。外层没有额外公共 padding。

| 区域 | 原包结构与尺寸 |
|---|---|
| 表单 | `flex max-h-dvh flex-col` |
| 标题 | `shrink-0 p-4 pe-14 text-lg font-normal select-none`，18px常规字重 |
| 可滚动正文 | `min-h-0 overflow-y-auto p-4 pt-1` |
| 标签容器 | `flex flex-wrap gap-3 select-none`，间距12px |
| 标签 | `inline-flex items-center justify-center gap-2 rounded-full border px-3 py-2 text-sm`；选中为primary实色，未选中为普通文字、hover次级surface；`role=radio`、`aria-checked` |
| 文本框 | 外层 `mt-6`；`variant=feedback`，`name=feedback`，autocomplete关闭；placeholder“填写详情（选填）”，无障碍标签“其他反馈” |
| 披露说明 | `mt-4 rounded-lg bg-surface-secondary p-3 text-xs text-secondary` |
| 提交行 | `mt-5 flex justify-end sm:mt-4`；primary、dialog尺寸、submit按钮，文案“提交” |

至少选择一个标签或输入非空详情才允许提交；请求期间禁用，成功后关闭，失败保留弹窗。Enter在未按Shift/Meta/Ctrl/Alt且不处于输入法组合状态时提交；Shift+Enter换行。业务账户开关可能隐藏自由文本输入，此分支不能推定当前实例启用。

原应用先提交基础赞/踩，再按条件打开负反馈详情；点击同一评分调用清除反馈。消费者披露文案说明会随反馈附上对话以改进ChatGPT，业务版本也保留改进ChatGPT的供应商语义。**AnyWork 使用本地逐条反馈存储时必须替换为真实的本地保存说明，不能保留上传ChatGPT或改进供应商模型的承诺。** 原应用选择 `safety-or-legal-concern` 会进入独立举报流程；AnyWork 保留该标签并本地保存时，应明确这一语义，不得暗示已向供应商举报。诊断 ZIP 的 `feedback/save` 与逐条回复评分仍是不同接口。

### 模型菜单完整可执行契约

2026-11-04继续定向读取同一包的临时副本，定位普通本地 Codex 链路为 `app-primary-1309b9ae7c5f.js` 的 `S8r → Y6r → ZGr → jWr → WUr → NHr`；档位算法位于 `app-initial-61c1d0e6137e.js` 的 `bfo/Cfo/Dfo`（约字符位置7478176起）。前面较早的 `vqr` 是 ChatGPT 选择器，不能把其 `slug/thinkingEffort` catalog直接当作本地 Codex 的 `model/supportedReasoningEfforts`。本节是对既有原包副本的静态源码核对，不声称参考应用已执行过这些分支，也不扩大前述六模块 REA Evidence 的范围。

#### 档位数据、默认与显式模型

每个本地滑杆档位含 `{id,model,modelLabel,reasoningEffort,powerSettingIndex}`，`id` 为 `${model}:${reasoningEffort}`。选择档位直接提交其模型和推理强度。**`serviceTier` 是独立状态，不与档位固绑，也不通过修改模型ID冒充速度模式。**

| 分支 | 档位构造与回退 |
|---|---|
| 默认动态配置 | 按 `sliderModelsConfig.presets` 顺序逐组尝试。每组为有序 `{model,reasoning_effort}[]`，逐项与可用catalog的模型及 `supportedReasoningEfforts` 精确匹配，按id去重；第一组过滤后至少3档即使用 |
| 默认fallback A | `gpt-5.6-terra:low`，然后 `gpt-5.6-sol:low/medium/high/xhigh/ultra`。仍按catalog实际支持过滤，至少3档才采用 |
| 默认fallback B | `gpt-5.6-terra:low/medium/high/xhigh`。仍按catalog实际支持过滤，至少3档才采用；不足则默认档位数组为空 |
| 显式模型 | `Cfo` 展开当前模型的 `supportedReasoningEfforts`，排除 `persistent`，按catalog顺序构造档位，不需要跨模型preset。若没有有效effort则内部回退medium；正常实现应优先使用catalog实际声明 |

`Dfo` 使用catalog的 `displayName` 生成显示名，显示时按条件格式化/去除GPT前缀。不能把包内5.6 fallback擅自替换成6.1后声称是原生默认组合；用户截图中的6.1可以来自动态配置。

动态preset配置编号为 `423260384`，结构 `{presets:Array<Array<{model:string,reasoning_effort:string}>>}`。账户认证要求ChatGPT方式、token/account/user就绪；普通本地选择器还检查local host、OpenAI provider、非自定义catalog等。实际配置值没有读取或执行验证。模型目录自身还受宿主、模型供应商、禁用原因、额度与模式策略过滤；应使用最终可用catalog，而不是绕过目录筛选。

`S8r` 的默认/模型模式判定会检查当前 `{model,effort}` 是否存在于默认档位中：不在时可自动推导为model模式，再改用当前模型的全部支持档位。因此“无动态preset就必然先进入advanced”不是原包的普遍事实。默认fallback是否适用、当前选项是否能自动归入显式模型、档位数等都会影响初始页。

**AnyWork本轮采用原包真实的显式模型分支：不捏造跨模型preset，默认档位数组为空时当前选择不属于默认数组，自动进入model模式，直接按当前模型的真实 `supportedReasoningEfforts` 展示slider。** 显式模型至少2个可用档位并有匹配的当前选择即可用simple；不是至少3档，3档门槛属于默认preset算法。原包先用 `LB(ce.reasoningEffort,IB(models,model))` 归一化当前effort，因此缺省或无效effort可先回退为模型支持值；归一化后仍无匹配、单档或目录未就绪时显示advanced。AnyWork不添加缺乏真实默认组合的“默认/推荐模型集”假选项。用户选择模型后继续使用同一显式分支，当前模型/强度已有效时无需额外要求用户先选一次模型。

默认恢复 `wfo` 优先顺序为：精确默认id、同强度的Sol模型、Sol medium、任一Sol、任一medium、首档。原包“默认”动作切回default模式并提交恢复的档位；缺少真实默认组合时AnyWork不能伪造该动作的结果。

#### simple、advanced与确认行为

simple主视图依次为标题行、滑杆、条件footer；**没有默认常驻的effort.description段落**，强度说明只可通过条件tooltip等实际传参显示。advanced是同一菜单里的模型列表。初始视图状态为simple，本地 `S8r` 在不足2档时强制advanced。共享 `ZGr` 另检查有效档位/当前选择及速度选项，不能仅凭simple字符串强制显示空滑杆。

主视图中央标题整体可激活，`aria-label=选择模型`，点击切换advanced。显式模型标题为两行：强度在第一行，次要模型名称在第二行；默认分支可为模型名与强度同排。下箭头属于标题内容。条件性“重置为默认”按钮在标题右侧，速度入口在左侧。

advanced结构依次为：条件模式/账户说明，“选择模型”分组标题，条件“默认”（副标题“推荐模型集”），动态模型项，调用方额外内容。模型项 `role=menuitemradio`、`aria-checked`、选中勾选；描述来自catalog，锁定或额度不足有独立无障碍说明/图标与禁用原因。模型列表max-height为 `min(316px,availableHeight-4px)`，横padding4px，支持纵向滚动。

选择新模型 `preventDefault` 保持菜单打开，切回simple；若新模型支持当前强度则保留，否则用该模型 `defaultReasoningEffort`。选择“默认”也切回simple。点击已选同模型可以执行确认回调关闭菜单。切换视图后优先聚焦选中radio，否则首个可用菜单项；从列表返回simple可聚焦滑杆。菜单关闭350ms后内部视图重置simple。**simple切advanced时整个simple ViewTrack被设为aria-hidden/inert，标题与左侧速度按钮一起隐藏**；advanced没有无条件插入的常驻“速度”行，也没有静态证据支持的额外“返回强度”按钮。

#### slider DOM、几何与提交时机

| 部分 | `59ad52d5aa88.css` 的原包规则 |
|---|---|
| 菜单内容 | 254px宽；动态高度过渡320ms，减少动态效果时关闭 |
| simple滑杆行 | `SimpleView` 最小40px、纵向padding4px；键盘菜单项margin/padding0 |
| `Container_d3rbc_1` | 高32px，横margin2px，纵padding2px，横padding6px，flex列居中 |
| `Root_d3rbc_19` | 宽100%、高28px、`touch-action:none` |
| Track | 高24px、圆角12px，文字色10%混色背景，inset 0.5px边框，裁切溢出 |
| Range | chart-blue、圆角 `12px 0 0 12px`，轨道内裁切 |
| Thumb | 28×28px圆形白底，0.5px strong-border，阴影 `0 0 2px #0000001a` |
| Thumb hover/drag | 视觉比例 `32/28`；实际语义输入仍28px，伪元素命中向外扩3px |
| Tick | 4×4px圆点，伪元素命中向外扩6px，普通hover放大2倍 |
| 标题行 | min-height36px，横padding8px；有速度入口16px，显式模型32px |
| 标题动作 | min-height32px，padding4px，圆角8px；内部padding2px4px、圆角6px |

`NHr` 使用slider `min=0,max=max(档位数-1,1),step=1,dir=ltr`，外层有 `data-reasoning-slider` 的键盘菜单项、隐藏状态播报与左右键说明。可视thumb与实际输入分离，tick与range为装饰。减少动态效果时关闭高度、滑块、粒子等动画。

普通无锁定档位时，`onValueChange → Fe → onSelectOption → WUr/jWr.onSelectPower → Y6r.be → S8r.un → selectComposerModelAndReasoningEffort`：**拖动每越过一个新档即选择并保存模型和强度，不是等pointerup才提交。** `onValueCommit` 在普通本地分支执行中途换模型提醒等附加动作，不重复选择。存在任意锁定档位时，`jWr` 切换为先预览，commit才实际选择非锁定项；取消清除预览。键盘左右每按一次选择并commit，Enter确认当前项并关闭；滚轮累计30px阈值切换一档，160ms无事件或方向改变会重置累计。拖动超过4px或按住150ms触发端点提示/拖动视觉；触屏须保留pointer capture与禁止滚动规则。

#### 速度入口、服务等级与access过滤

服务等级选项来自 `[标准(value:null),...当前模型.serviceTiers]`，目录项保留真实 `tier.id`，不得硬写fast/priority或靠修改model标识选择速度。显示层把id为priority/fast或name为fast（trim/lowercase）的项识别为fast，id/name为ultrafast识别为超快；其他opaque项保留目录名称。标准项label“标准”、description“默认速度”；fast本地化“快速”，当前倍率函数固定1.5，字幕“1.5倍速度，用量更多”；超快label“超快”、description优先目录原文，缺省“为时延敏感型任务提供最快响应”。这些倍率是参考版本固定文案，不是实测承诺。

普通本地 `Y6r/jWr` 仅在access可用且可选等级超过1项时传入速度回调。主视图标题左侧的32px按钮（内部26×26px、圆角7px）在只有标准/fast时是闪电 `menuitemcheckbox`，点击在null与实际fast `tier.id`之间切换。**存在任意非fast且非null等级时改为233px宽flyout**，例如ultrafast、flex或自定义tier；每项含label、description和选中check。选择保持父模型菜单打开、关闭flyout并回焦入口；超快显示双闪电。共享 `yWr` 还有独立“速度”行形式，但普通本地分支采用标题左侧入口，不能把其他调用形式推定为当前界面布局。右侧“重置为默认”按钮同为32px、内部26px。

access由 `requirements.featureRequirements` 与 `supportsIndependentSpeedModes` 得到，shared源码规则为：

```ts
const fast = requirements?.featureRequirements?.fast_mode !== false;
const ultrafast =
  (supportsIndependentSpeedModes === true || fast) &&
  requirements?.featureRequirements?.ultrafast_mode !== false;
```

等级过滤 `nht`：null或`default`允许；无access时其余拒绝；`flex`允许；`priority`/`fast`按fast gate，`ultrafast`按ultrafast gate，其他opaque id按fast gate。gate判断只传id，显示层可以同时使用name识别图标，两者不能混同。缺省flag用 `!==false`，不要求显式true；明确 `supportsIndependentSpeedModes===true` 时超快才能独立于fast关闭状态。旧服务没有该字段且fast=false时，即使ultrafast未显式关闭也不允许超快。

两套本机schema的 `ThreadSettingsUpdateParams`、`TurnSettingsUpdateParams` 支持 `serviceTier:string|null`，null清除、省略不改。原本地UI使用独立 `setServiceTier(value,"composer_menu")`，内部可调用 `updateThreadSettingsForNextTurn({serviceTier})`，不修改model/effort。标准null、继承配置、目录 `defaultServiceTier` 是不同状态，必须遵守实际协议归一化；不可把目录默认项无条件写成用户显式选择。账户/模型是否允许某个tier仍依赖最终目录与access。

#### 中文、条件开关与未知范围

| 含义 | 原包精确中文 |
|---|---|
| Power | 强度 |
| Select model / Select effort | 选择模型 / 选择推理强度 |
| Default / description | 默认 / 推荐模型集 |
| Reset to default | 重置为默认 |
| none/minimal/low/medium/high/xhigh | 无 / 极低 / 轻度 / 中 / 高 / 极高 |
| max/ultra | Max / Ultra |
| slider无障碍medium/high | 标准 / 深度 |
| Standard/Fast/Ultrafast / Speed | 标准 / 快速 / 超快 / 速度 |
| 速度开关aria | 启用标准模式 / 启用快速模式 |
| 速度tooltip | `{speedMultiplier, number} 倍速度`，第二行“用量更多” |
| Ultra warning | 使用额度消耗更快 |

显示GPT前缀受 `3849065407` 控制；simple中的xhigh受实验 `4038208412` 的 `show_xhigh_in_simple_picker` 控制，默认true，只有条件满足且移除xhigh后仍至少3档时参与。当前选中xhigh、回退档位等还参与是否重置的判断，不能无条件隐藏xhigh。普通本地调用中的 `3067755757` 以false条件读取，不应凭字符串存在声称它启用。

已定位的是选择算法、组件布局、交互及协议；仍未知的是当前账户的preset实值、功能开关取值、实时锁定/额度状态、最终可用服务等级与初始运行时选择。用户三张截图未打开菜单，不能拿静态分支替代运行观察，也不能据此把特定账户的档位写死。AnyWork本轮可以忠实实现真实的显式模型分支，同时保留默认跨模型preset与账户实验的已知限制。

补充模块 SHA-256：

| 模块 | SHA-256 |
|---|---|
| `response-rating-control-59cdc0902cc2.js` | `64ee730c7cddf79a3f4218303a5359665cc74583b791702c4b038b37dd0b821d` |
| `message-rating-924f12f4475e.js` | `3d2b7dcdf13e23eb182fdc1a7849d558f64d5b9fedbd64b5a759ebc4a0ccdfab` |
| `chatgpt-audio-playback-button-5428230e8262.js` | `aa8c8a24edb6804df3ac2ab87e5a87574925eaa623eb70d4ab81cc17ef0e314f` |


### 用户消息：时间、悬停动作、文本格式与折叠（2026-11-04 补充）

本节只读核对原始 ASAR，未运行或修改桌面应用。既有六 UI 模块 REA 证据包含 `user-message-2c7dafc6a971.js`；本次仅新增选择 `timestamps-470e1b100746.js`、`user-message-markdown-6752d07cc4c3.js`，REA parent `ev_763507c3f11a4ec5f4ca22764d260b3f805bd027ccaf987204a8b8b0769361d8`、summary `ev_a0e2e299f43cba0c77f841fd45d5e40e91d1635f2ec973659499d6d140cfdd7f`。两文件共 3,274 bytes、2 parsed、0 parse failures；17,532 files 未选择、整体 graph partial、semantic unknown retention 达上限，不能用该局部证据推定完整应用行为。既有原包 native sibling integrity contradictions 仍由 record-and-continue 记录，不影响本节对选定 JS 原字节的定位。下述 caller、separator、共享渲染器结论另外来自同一 ASAR 已提取文件的只读逐段检查；不能把这次两模块 REA 声称为已分析所有 caller。

#### 必须区分的三种时间

| 时间形式 | 来源与条件 | 显示 |
|---|---|---|
| 普通用户消息 footer 时间 | `user-message` 的 `dt/lt`，只有传入真实 `sentAtMs` 才存在 | 与复制动作同排，但时间有自己独立的 hover/focus opacity，不能常驻 |
| 用户消息上方简短时间 | `subagent-activity-chip-group` user 分支收到 `showTimestampHeader=true` 时，在气泡前渲染 `dt` 并给气泡 `sentAtMs=null` | 使用同一 `lt` 日期算法，class `select-none`；不会额外加入“今天” |
| 居中回话时间分隔符 | `timestamp-separator-b64c9c6c8abb.js`，由 thread entry 的 `timestampSeparatorAtMs` 驱动 | 截图 01 的“今天 14:26”与此组件相符；包含相对日期与时间，不应复制到每条用户 footer |

`lt` 的 footer/header 日期算法以本机时区比较自然日：同天 `formatDate({hour:'numeric',minute:'2-digit',timeZone:localTimezone})`；过去 1～6 天加入 `weekday:'long'`；其余加入 `month:'short',day:'numeric'`。原比较是 `dayDifference < 0 && dayDifference > -7`，所以第 7 天进入月/日分支。普通 `dt` 是 `text-xs text-tertiary`，未传 `sentAtMs` 返回 null。`nowMs` 不传时使用渲染时的新 Date。不要用额外手写“今天”替代 locale 格式。

居中 separator 的数据路径与 footer 不同：`local-conversation-thread-turn-entries-a3aab3f17702.js` 的 `pe=re(V.map(...))` 对普通 local turn 以 `turn.turnStartedAtMs` 构造 user 时间、以 `turn.finalAssistantStartedAtMs` 构造 assistant 时间；有用户输入或适当 summary preview 才构造 user，存在 agentMessage 才构造 assistant。这里明确有回合时间作为分隔符依据，**没有因此证明所有独立用户消息 footer 可以用回合开始时间代替消息发送时间**。Aeon、preserveServerUserMessages、缺 turn 等 entry 返回 null，并中断相邻判定。

`timestamps` 的分隔符选择先过滤非有限 sentAtMs：首个 user 只有距 now 严格超过 1 小时才显示；其他情况要求前项是有有效时间的 assistant，当前 user 距前 assistant 严格超过 1 小时，或当前 assistant 距前 assistant 严格超过 10 分钟。每个 entry 只取首个命中的时间，之后仍更新相邻项；显式 `breaksPreviousAdjacency` 重置 previous。null entry 重置 previous，并将 isFirstUserTurn 检查关闭。`local-conversation-thread-ced381ec19c9.js` 的 `IP` 在 `useContext(Iv)==='activity'` 时抑制普通 separator，其他情况下才为非空 `timestampSeparatorAtMs` 渲染 `jS`。

`timestamp-separator` 的普通容器是 `flex justify-center py-4`；`time` 是 `text-sm leading-5 font-normal text-tertiary select-none`、带 ISO `dateTime`，日期子 span 是 `font-medium`；外层 `role=separator`、完整 `aria-label`、`data-markdown-copy=exclude`。同模块 compact 形式是 `py-2` / `text-xs`，不能无条件用于普通 conversation。日期算法 `max(localCalendarDayDifference(now,sent),0)`：0/1 天用本地化今天/昨天；2～7 天 `weekday:'long'`；8～365 天 `weekday:'short',month:'short',day:'numeric'`；超过 365 天 `month:'short',day:'numeric',year:'numeric'`。时间 `formatTime({hour:'numeric',minute:'2-digit'})`。中文 recent 与 older 都是 `<day>{date}</day> {time}`，英文 older 才加 at；不能为中文硬加英文介词。

#### 普通 footer 的显示条件与几何

`user-message` 的普通 footer 动作组条件是 `(hasVisibleText || editEligible || additionalActions != null) && !editing && !compactActions && !hideActions && !isAeonFormatted`。外侧 footer 是 `flex flex-row-reverse items-center gap-1`，并保留状态/模式等 chips；普通动作组 class `isolate me-1 ms-1 flex items-center gap-2`。默认 `opacity-0`，在 `group-hover/user-message` 或 `group-focus-within/user-message` 时变为 1；`@media(hover:none)` 下该动作组可见。调用方 `alwaysShowActions=true` 移除动作组的 opacity 规则。

**时间另有一层 `flex opacity-0 group-focus-within/user-message:opacity-100 group-hover/user-message:opacity-100`，既不跟随 alwaysShowActions 变成常驻，也没有 hover:none 常显规则。** 时间左侧、动作右侧由内部正常 flex 顺序形成；动作容器是 `flex turn-action-controls items-center gap-0.5 browser:gap-0`。原组件外层 `group/user-message flex w-full flex-col gap-1`，默认 `items-end`。这些间距与布局来自源码 class，具体 token 尺寸继续沿用既有 CSS token 表。

compactActions 时复制按钮移动到气泡旁：`flex w-full items-center gap-1 justify-end`，按钮外层 hover/focus 才显示；此分支不渲染普通 footer 时间与编辑按钮。Aeon 有单独布局。应依据实际会话呈现模式选择分支，不能在普通 local 模式套 compact 动作。

普通本地 caller 的常显动作并非全局：`local-conversation-turn` 的 turn-user 列表对最后用户消息传 `alwaysShowUserMessageActions: !isTurnInProgress && previousTurnNumber==null && isMostRecentTurn && isLastUserMessage && !ri`（`ri`：voice/terminal 工作分支取 `activitySummary.status!==working`，普通分支取 `!qr && assistant!=null && (assistant.completed || assistant.content.trim().length>0)`，即已有可显示回答或相应工作已离开 working 状态；不能忽略其存在）；中间 renderer 还要求 `previousTurnNumber==null` 才透传。由 caller 条件驱动，不能让所有消息按钮永久可见。

#### 复制：内容来源与成功反馈

复制按钮为 ghost/icon，内部 icon-xs，focus-visible ring 2。精确中文是“复制消息”，成功后为“已复制”，图标切换 check；成功状态持续 1,500ms，期间不重复调用复制处理。失败不会伪装成成功。函数防止并发复制，成功后才调用 `onCopySucceeded`。

默认优先从 `copyContentRef ?? internalContentRef` 收集 DOM 的 `{plainText,htmlText}`，支持富文本与纯文本两个剪贴板格式；有源文本强制选项时使用源文本转换而非 DOM plainText。对于折叠消息，copy extractor 使用 `includeCollapsedContent:true`；遇搜索结果裁切可临时 reveal 后提取并复原，因此不能仅复制当前截断可见的若干行。“实现此计划”的合成提示有单独 copy 分支，不应把内部提示原样暴露。

#### 编辑：共享能力不等于每条消息可编辑

共享 `user-message` 的 `editEligible = onEditMessage != null && turnId != null && !syntheticImplementPlan`。编辑按钮还要求 `!globalBusy`；进入编辑后，普通 footer 消失。原本地 caller 只向当前 turn 用户消息列表的最后一个传 `onEditMessage`，另一路 transcript caller 同样只向 `isLastUserMessage` 传；中间 renderer 还要求无 externalSurface、非 isToolOutput、当前 route 不为 `local placement='side'`，以及消息非空或不存在 empty override。最终按钮仍依赖外层是否实际提供 callback 与 turnId。

AnyWork 的编辑入口现由服务端实时能力查询决定，仅支持空闲、持久化 paginated 原生会话的最新且唯一用户项，并已接入同 thread revert 再 send。不能把共享 callback 的存在扩大为更早消息、steer、多用户项或全部原生编辑器分支均已实现。

共享编辑器是 composer rich editor。容器 `relative flex w-full flex-col rounded-3xl bg-text/5 dark:bg-primary-soft`；编辑区 `mb-2 flex-grow overflow-y-auto px-3 pt-3`；按钮行 `flex justify-end gap-1.5 px-3 pb-3`，取消 outline toolbar、发送 primary toolbar。精确中文“编辑消息 / 取消 / 发送”。Escape 取消；空消息默认不能发送，带附件等 caller 可显式允许空内容；提交期间 disable、发送显示 loading。异常时保留草稿，只有实际 onEditMessage 成功后才清除草稿。AnyWork 当前已实现受限文本编辑事务和失败恢复，普通历史编辑区已采用独立 ProseMirror PZ 文档；主 composer rich schema 与显式富文本历史模式仍未完整复刻。

#### 普通 local 用户文本采用的渲染方式

`subagent-activity-chip-group` 普通 user 分支不覆盖 messageContent（仅 questionReplies 有独立内容）；因此进入 `user-message-bubble` → `collapsible-user-message-content` → `user-formatted-text variant='user-message'`。后者调用 `app-initial` 的 `Dtc/ktc`，错误边界名称明确为 Markdown，内部经 `Qw` parse 后交给 token renderer。`app-shared` 的 `AA=bNn` 只把 `](codex-text-link://` 归一为 `](`，没有整体转义 Markdown。因此本地普通用户文本不是统一 literal text：应支持原 renderer 的段落、标题、粗体、列表、行内与围栏代码等 Markdown，而非直接套 assistant 的所有扩展。

用户专用扩展 `user-message-markdown` 进一步规定：

- `$sites` 在允许位置被转换为 Sites 链接。
- `![label](target)` / reference image 不直接嵌图，转换为普通文本 `!` 加 label 链接；真正上传图片由 message attachments/images 区域单独渲染。
- composer authored link 通过用户专用路径与 label 处理，避免把无效/未完成的一行 `](...` 不加判断地吞掉；已处于 link 内时不递归制造链接。
- `repairOrderedLists:false`；默认 `renderMath` 由共享 Markdown renderer 决定，普通 local 此调用不显式关闭（共享缺省 true）。ChatGPT serialized-rich-text 分支可以另传 `renderMath:false`，不能混同。

`user-formatted-text` 外层 `text-size-chat whitespace-pre-wrap`，user-message 类 `rich-text-user-turn`，列表 indent 24px；非 serialized paragraphs 时 direct p margin 0、相邻 p 上间距 20px。serialized paragraphs 有专门 blank-lines span (`data-markdown-copy=blank-lines`) 保留空行；不能仅用一个 assistant markdown 默认容器代替。`chatgpt-user-message-content` 另有 `hasRichText` 的 false 分支，主要 literal text 加少量代码/链接扫描；这不是普通 local caller 的默认路径。

AnyWork 的用户专属 Markdown 现已接入 composerLink 与 AA/bNn：含空格路径、标签格式、原生标点转义及第一处未转义右括号边界；标准非空 title 交回基础语法，代码、图片与已有链接保留作用域，未完成链接只保留当前行。codex-text-link 前缀按原源字符串规则处理，包括代码字面量；助手消息不经过此规范化。实现位于 `web/src/userMessageMarkdown.ts`，已覆盖桌面/手机渲染、富文本复制与本地文件打开。`$sites`、完整数学及 serialized-rich-text 条件尚未全部实现，不能据此宣称所有用户 Markdown 分支等价。

#### 长消息折叠

`collapsible-user-message-content` 默认 `collapsedLineCount=20`，默认 ellipsis。每行预取上限常量512，长度与切片单位均为 JavaScript UTF-16 单元；非打印、函数 children 且 `text.length > lineCount*512` 时走强制折叠与 `text.slice(0,lineCount*512)`，不修补单词、Markdown 或代理对。此分支跳过实际测量及跨代码块增高；其余使用实际测量（fallbackFontSizePx 13），跨越截断线的代码块才扩展到完整块边界。collapsed 且 lineCount>2 时为单独末尾 `…` 预留一行，即内容 max-height `(lineCount-1)lh`；不是固定截断20个换行。展开及打印使用全文。

按钮 `mt-1.5 self-start text-size-chat`，user tone 用 ghostUserMessage，精确中文“显示更多 / 收起”，小 chevron 展开旋转 180°；`aria-expanded`、`data-thread-find-skip=true`、`data-markdown-copy=exclude`。不可见的交互内容被 inert / aria-hidden，展开恢复；打印时强制完整显示。copy 必须能包含折叠全文。特定 delegated/labelled user 样式 caller 将 lineCount 设为 2，不可用它覆盖普通默认 20 行。

AnyWork 当前普通用户文本已实现20行测量与严格超过10,240 UTF-16 单元时的预切分支；预切折叠态仅挂载前段，展开和打印恢复全文。复制通过同步临时挂载完整正文、读取纯文本/HTML 快照后还原状态，不能再把此项列为“始终保留全文 DOM、未实现预切”的差距。普通 text wrapper 的两次 Woe 提取与首 text 的一次 Ooe 重建亦已接入；本轮补充 native input 投影、文件提及恢复和严格 app-input 识别，规则与限制见后文。历史编辑已移除首 text 为有效 app-input/library placeholder 时的额外禁用条件：编辑描述提供显示Markdown，用户在普通 PZ 文档中修改后序列化提交，按Ooe重建原首text并清空其text_elements；沿用其余目标身份、回合状态和历史能力校验，不调用YEe/rDe。普通 mention 节点与 URI 重编码已接入，完整 rich/literal occurrence 模式尚未实现，不能声称所有提交字符串逐字符等价。本说明不代表原应用运行对照或全部1:1验收完成。

本节额外原模块摘要：

| 模块 | bytes | SHA-256 |
|---|---:|---|
| `timestamps-470e1b100746.js` | 1,333 | `9773d23deb895ddfadc0b60c8f09443b3b8eba272628dcf0443393d259e1b555` |
| `user-message-markdown-6752d07cc4c3.js` | 1,941 | `48376076549b3a626e9e70f2e1f48d5ec248ad5551dc2ea75b6bc553c1bf13d9` |
| `timestamp-separator-b64c9c6c8abb.js` | 2,750 | `7c7c960d4bf54d2d396fc40a16a4f7be8950135c5a3270a64df6209132bc4458` |

定位均为 minified 原模块，主体位于第 1 行；可按函数和独特属性精确搜索：`user-message.wt` / `dt` / `lt` / `Et`，`user-formatted-text.f/p`，`collapsible-user-message-content.S`，`subagent-activity-chip-group` 的 `case user-message` 与 `onEditMessage:i?ne:void 0`，`local-conversation-turn.Kc`，`local-conversation-thread-turn-entries` 的 `pe=re(V.map`，`local-conversation-thread.IP`，`timestamp-separator.u/m`。时间 separator 与复制反馈已由静态路径支撑；截图没有显示 hover/编辑，原应用没有运行，无法声称已完成这些动作的原应用动态像素对比。


### 编辑后重新发送：本地回话的真实事务与能力边界（2026-11-04 补充）

本节延续只读原包检查。新增 REA 仅选择 `webview/assets/start-turn-e9a3bd89232f.js`：parent `ev_3a8360291c965800bc623545be8e0a6ecc6c5f413a65edb3025cd7cbebeb107c`，summary `ev_fd11b0e45f8e042292e6121fa9a711bdfa6e7cfe7b3df812463b1acf6d550211`；1 个文件 1,732 bytes，SHA-256 `69b70b12b4b935163912b6de71abcd5719eaf54239f5e52e9a4e7fbd67f409ab`，467 AST nodes、0 parse failures。其余 17,533 文件未选择、关系 partial、unknown retention 达上限。下游 `app-initial` 和 `app-shared` 已提取模块的函数体通过只读文本检查定位，没有重新对它们运行宽泛 REA。本轮未启动原应用，也未修改其内容。

#### 调用链及可编辑范围

普通 local 链路是：`user-message.wt` 的提交代理 → `local-conversation-turn.Dl` 绑定 `turnId` 与原 `params.model` → `local-conversation-thread.SI` 的 `zt` → `start-turn.m` → manager `editLastUserTurn` → `app-initial.jun` → 同 thread 的历史回退与 `executeTurnStart`。此链路没有调用 `thread/fork`；旁边独立的 `Bt/Vt` 才负责“从此处分叉”。

thread `SI` 只有非 read-only、conversation 可用、非 cloud-host 分类、history 能力可用且其他生命周期条件允许时传 callback。对于 paginated history，还要求 app-server `threadRevert` 能力；原能力表最低版本 `0.148.0-alpha.13`。保留这些能力条件，不可只因本地存在消息而显示按钮。

`Dl` 的编辑门槛还要求 callback、真实 turnId、target.status 不是 `inProgress`。实验 gate `1937538638` 为 false 时，只允许 `latestLoadedUserTurnId` 对应 turn（缺该 ID 则退至 isMostRecentTurn）；为 true 时放开更早 turn，并在请求里传 `allowEarlierMessages=true`。每个 turn 的用户消息列表/对应 transcript caller 仍只给最后用户消息传 callback。其他 externalSurface/tool-output/side-placement/合成计划等限制沿用前节。

后端 `jun` 再校验：目标 turn 必须存在；找到目标在规范 turn 序列中的 index；`allowEarlierMessages` 不为 true 时，目标之后只要存在 `params.input.length>0` 的 turn 就报 `Only the most recent message can be edited.`；从目标起任意 turn 仍为 `inProgress` 则报 `Cannot edit a message while a turn is in progress.`。目标或 index 无效同样拒绝。不是只检查当前目标自己的状态。

**该 API 是 turn 级，绝非任意 user-message item 编辑。** caller 只 bind turnId，`jun` 读取 `target.params.input`；没有接收 user itemId、steer clientId 或某个文本 segment ID。对同 turn 后续 steer / hook follow-up / request-user-input 生成的独立用户消息，不能因 UI 有通用 callback 就假定它们都能精确重写。AnyWork 至少要确认目标显示文本对应原回合输入，才能接入此链路；无法证明时不显示编辑入口。

#### 输入与附件保留

`jun` 克隆目标 input，替换**第一个** `type:'text'`，同一 input 中其余元素保持不变。没有 text 时在原 input 前添加新 text。被替换 text 的 `text_elements` 置空；原 text 其他字段由 spread 保留。不会删除图片、文件、音频、skill 等其他 input 元素，也不会把剩余多个 text 合并成新字符串。

文本不是简单覆盖完整 prompt：`app-initial._Ce` 实际 import 对应 `app-shared.Ooe`，保留已有上下文 wrapper。若原内容是 `<page-comment-context>...` 后接 `## My request:`，保留到请求正文前的 prefix 再加新文字；否则找到最后一处 `## My request(?: for Codex)?:`，保留前缀并重建 `## My request:\n{edited}\n`。没有这些结构则直接使用 edited。这是保留文件提及、评论、选中文本等上下文的一部分，不能把 UI 提取的纯显示文字当完整原始 input。

##### Library 行内文件提及与网页打开（2026-11-04）

展示使用原包 app-shared 的 `_pn → vpn → F4/Zfn → Xfn/Ydn`：精确小写 scheme、decode 后 trim 非空 library ID、首个 asUrl 为 1、首个 sourceUrl；来源须符合 Google Drive 文档/文件、Box file、Dropbox file/preview、SharePoint/OneDrive 文件 URL 语法。这一展示门槛比 QEe 的通用 HTTP 恢复更严格。AnyWork 的 `libraryFileLinks.ts` 分别实现这两类边界中的展示分类，不将任意来源链接伪装为原生文件提及。

app-initial 的 `Ims → ABo` 展示 trim 后纯 label，经 SNn 保留 `data-prompt-link-href/label`，实际 href 为 sourceUrl。点击链为 `ABo → OBo(i,file,event) → CL → CNr`；未传第四参数时不走额外 restricted override。AnyWork 保留标识和真实 href，并在浏览器新标签打开；桌面 CNr/TNr/wL 的内置浏览器 disposition/onOpen 分发没有 Web 本地等价服务，不能宣称窗口路由一致。

B2 默认 inline-flow/medium/file-reference：16px 图标槽、3px 尾间距、1em 高、translateY(.5ex-.5cap)、可换行 label、hover 0.5px 虚线下划线。静态提取了 23 个常见文件/品牌及 Google 文档 SVG 数据，未执行原应用代码。图标分类支持 common pgn/Omn 路径，Figma/泛 Office 特殊图标、少见 MIME 别名及罕见 provider 组合尚未穷尽。

依据为已核对 SHA 的 app-initial/app-shared 与 fd9b7fd80db1.css 只读静态追踪。辅助定位为 JS 字符位置（不是 UTF-8 byte offset）：app-initial Ims 8972409、ABo 7978435、OBo 7978255、CL 4545890、CNr 4545957；app-shared _pn 3774351、vpn 3774840、Zfn 3771110、Ydn 3754917、M4 3754803、SNn 4468207。既有 child REA retained graph 只覆盖六个 user 模块及 approval 模块，不将这些旧 evidence 说成对上述大模块的语义图覆盖。42 个分类/图标单元检查与桌面、手机 6 个浏览器场景覆盖身份、点击、无越界文件读取、复制与几何。

##### 富文本发送、队列恢复与历史编辑的真实 caller（2026-11-04）

本轮只沿既有原字节扩查调用点，没有运行原应用。搜索完整 app-initial：`rDe` 除定义外只有 `o8t` 一个 caller；`YEe` 的直接 caller 是 `tDe`、`rDe` 和 `o8t`。**历史编辑 jun 没有调用 YEe、rDe 或 tDe**，不能根据 helper 的功能把它们直接串接。

| 路径 | 已观察的重建顺序 | app-input 与附件行为 |
|---|---|---|
| 新发送 `a8t → tDe` | `gT` prompt → pDe校验 → YEe → 条件 envelope前置text element | 条件生成 untrusted_input responseItems；其他 input、展示 attachments 与 comments 分别返回 |
| prepared composer/队列 `o8t` | 对满足条件的新text：XEe → sender拆解/Woe → Ooe → 条件sender重包 → `rDe(新text,d) ?? YEe(d)` | 要求 preserveSerializedContext、音频集合未改、旧首text存在且 nDe为null；旧首text是任意有效app-input时不进入这个保留分支 |
| 历史编辑 `bt → St → onEditMessage → zt → start-turn.m → jun` | 编辑器序列化 → trim → `Ooe(原首text,提交字符串)` → `text_elements:[]` → executeTurnStart | 没有YEe/rDe；保留其他原input和独立附件；不重新创建 envelope 或 untrusted_input responseItems |

**tDe 的新发送规则。** message为null、两个附件数组为空且promptContext为null时，直接返回YEe(prompt)、空responseItems；sender单独存在不触发envelope。其他情况经完整pDe校验，去掉message/附件的widgetSource，model context强制untrusted=true。context-only对prompt做YEe，含message则对iDe(sender,source)的boilerplate做YEe，再在text_elements最前加全范围envelope placeholder。工具输出来自modelContextAttachments和message：内容为JSON input_text，图片另为input_image，再组成untrusted_input的function_call/function_call_output；reviewed附件不进入这组工具材料。没有输出项就不生成两个tool items。

a8t另外返回图片/文件等input、展示attachments、commentAttachments与fileAttachmentCount；untrustedAppMessage还可伴随独立的首text appTaskInstruction。Hfn仅在本次context显式有responseItems时，等待idle后先thread/inject_items再发turn/start或turn/addUserMessage。保留mcpAppModelContextAttachments字段不表示会自动重新生成工具输出。

**rDe 保留新输入里的 context-only envelope。** nDe(e)必须有效且没有message；随后YEe(t)，把e.text_elements[0]原样spread、仅更新byteRange至序列化后text的全范围，再接YEe的链接text_elements。placeholder JSON不重新编码，旧的其他text_elements不保留，返回新YEe的三个字段。含message明确返回null。o8t传入的e是**新prepared input元素**，previousSubmission的首text是另一变量，不能写成“rDe保存旧首text的envelope”。

o8t另有相同正文的快速路径：sender相等、原sender格式与durable条件匹配、新text_elements为空、context.prompt等于原提取正文且新正文等于prompt或prompt+LF时，返回`{...新text,text:原text.text}`而不走Ooe。其余情况对旧原文XEe/sender拆解后的o和新正文l做Ooe；durable sender在Ooe前VEe包装，非durable在Ooe后BEe包装。音频集合改变跳过该保留分支，后续还有旧图片对象复用、条件本地音频重建和其他非text保留，不能压成无条件文本拼接。

队列vhn显式从el首appInput恢复untrustedAppMessage、sender、promptContextWithoutReviewedMessages与两种附件，正文优先appInput.message.text，否则普通提取；yhn通过a8t重新构造，再可选o8t。旧首text为app-input时o8t不复用旧serialized context，不等于丢弃新构造的envelope。此路径与已完成历史回合的jun不同。

**历史编辑器没有通用 library sourceUrl 降级。** bt初始化Gac editor，开启selected-text links、禁用slash commands，按renderFormat/富文本开关选择plain/literal/prompt/literal-prompt模式。提交为`St(editor,authoredOccurrences,editor.getText(),hintsEnabled)`后将message.trim()传onSubmit；空消息另需allowEmpty。St在literal links不可用时用AA(getPlainText())；可用时先getPlainText({preserveLinkMarkers:true})，仅有非链接格式、存储标记链接或作者literal occurrence等条件时进入markdown，并用bla(getText(),literalSources)恢复可验证的literal来源，否则提交plain字符串。AA仅去除`](codex-text-link://`存储前缀，不替换library sourceUrl。

controller的getPlainText → KX → qX对chatGptLibraryFileMention生成Ame({sourceUrl,serializeAsUrl,...})的chatgpt-library-file地址；markdown serializer Ega也先经KX再生成该mention link。只有独立richLink节点的Ila/serializeAsUrl分支直接返回验证过的HTTP地址，不能混同library mention。线程zt接受绑定后的(turnId,model,message)，只把message交start-turn.m；编辑器额外renderFormat和inlineSystemHints参数未在该回调消费。该链路没有QEe/YEe补偿：textarea中的library Markdown若跟随原生历史编辑，需提交编辑器等价字符串，再Ooe并清text_elements；直接降级sourceUrl再加placeholder是另一行为。

**普通 local 历史的 library 初始化分支已追到确定值。** 中间Pv caller没有传editMessageFormat或enablePlainMessageRichTextEditing；wt的后者默认false。bt中`n = f==='markdown' || re && !rua(c)`为false，literal sources参数为null；tua/rua在有效library链接上经PCe识别为mention，所以defaultTextKind取prompt。Gac → Tac在enableRichText=false时没有markdown editor S，走ZX → iua，创建chatGptLibraryFileMention。Tac公开的getLiteralMarkdownLinks在初始化literalMarkdownLinkSources参数f为null时直接返回null，故St明确走AA(getPlainText())。KX对该节点调用qX，最终nr别名shared B4生成`[label](chatgpt-library-file://...)`。**回调值是Markdown链接，不是裸library URI，也不是sourceUrl。** Ame/gpn会按固定字段顺序用URLSearchParams重建地址，B4重新转义label及目标反斜杠/右括号，故并不保证逐字符保留原placeholder的查询顺序、百分号编码或转义形式。显式markdown编辑分支以及其他类型链接应分别按前述St条件验证，不能用它们覆盖这个普通local默认值。

**含message的app-input没有专门历史编辑保护。** Ggn投影为普通user-message；shared gate检查callback、turnId、非合成计划及中间caller的externalSurface/isToolOutput/side等条件，jun本身没有nDe条件。若满足其他门槛进入历史编辑，首text的envelope marker被清空，字符串按Ooe重建；不能声称保存message envelope。manager只将原params.attachments、params.commentAttachments和turn.mcpAppModelContextAttachments带入executeTurnStart context，没有responseItems；能保留本地展示/回合上下文，不能证明不可信工具材料已再次注入。若首text是appTaskInstruction，jun仍只替换该首text，其余envelope元素不动。多text/合成项仍需确认显示目标与原回合输入的唯一对应关系。

**Reference link不属于YEe/XEe范围。** `$Ft`是shared gfe的直接CommonMark fromMarkdown parser，没有reference resolution。link exit M在inReference时令type加Reference并删url/title，full/collapsed/shortcut reference不变为ZEe收集的type:link。ZEe遇link不再递归children；image/linkReference/definition/code不作为普通library链接序列化。不能为适配另一parser而接纳其Reference类型。

下列为同一已核对原成员的UTF-8 `[start,end)`，不是JS字符位置；本轮未扩大REA生产批次，也未运行原应用：

| 成员及范围 | 内容 | SHA-256 |
|---|---|---|
| app-initial `[2547979,2550712)` | a8t/o8t | `f88feb7f91ab63331757f167ee12ef67c42ce5bd4a68529a39a3e5bce83d76f9` |
| app-initial `[3000003,3002600)` | jun | `3425b72ad7032b8f2bb09ad6a3ae7037069d89aa341bcf8886845bc54cc56172` |
| app-initial `[6212597,6215753)` | Ila/KX | `637c781cd9fa4eaa92827a9a2f9c3824568fbf8fdd053e90c2f1488b8ad13639` |
| app-initial `[6215753,6218002)` | qX | `a4c9baf66fdc411f8536a1ad2066689e9c84a5bb7fb441d930799ddff2675943` |
| app-initial `[6222500,6222964)` | tua/nua/rua初始化检测 | `94d1dd244abc53ccd8f043abe173ac146e74cb5ce327051d8da178b2ded62979` |
| app-initial `[6401670,6403046)` | Ega serializer | `9a6ca0708631ff909e6fd6b8c2dbeb3335e2b1a0409146e3cfc6cda97e1700df` |
| app-initial `[10140171,10141736)` | Tac初始document选择 | `e4396a4ef25c69f37d143f04263cb62ee23b2e4fa6a8c24963ad9133245dcfcc` |
| app-initial `[10152769,10153082)` | literal links读取门槛 | `bc8d255c73e7cd7af0a8e50d8962752a42ac95ff79f959d5f6614d0adc9a7fe5` |
| app-initial `[10163521,10164601)` | controller文本读取 | `3ca6ed7e47195af93925f5c27783da1794f6087a6e1a068c4759beb56d564578` |
| app-initial `[3281111,3282367)` | vhn/yhn | `b5472c2d12409ef4f2a6754626245b8e51ffc473f7dee1d4c8611d2530bd5e2e` |
| user-message `[4980,12215)` | bt编辑器 | `68101a1391939c25567b5650c63156801c4ee07b36726503561938d5deee4e30` |
| user-message `[12215,13089)` | xt/St | `db3b352010d490fef755560f130fc17777824f1dfd06b4a2b090271d87110545` |
| local-conversation-thread-ced381ec19c9 `[370107,370565)` | zt | `81dc522d9431a48f06dc11a0835824f6c0a923e83f5eea2f9e932ab0f7b0c7e8` |
| app-shared `[510672,520057)` | gfe/reference AST | `5739939ea749547c5d11c791093f77e4332b9927ba428afc8f35cbe245120c42` |

local-conversation-thread-ced381ec19c9全文件SHA-256为`64419278b7b0934b32913938ec47bb2821c093c633ad8f7f543e61403a97f23b`，其他全文件摘要见相邻证据表。上述是选定版本的静态结果，未证明历史编辑清marker后的agent语义与首次发送相同，也未覆盖cloud/voice等特化caller。额外保留envelope属于AnyWork行为扩展，需验证实际工具材料投递，不应称作jun原样复刻。

##### 主输入器与历史输入器的模式契约（2026-11-04）

本节只读追踪原 ASAR 字节，没有运行原应用或执行抽取代码。**主 Codex composer 默认启用富文本；普通 local 历史编辑默认使用 PZ prompt schema。** 不能从 Tac 的默认参数 `enableRichText=false` 推断主输入框，也不能把主输入框的富文本能力无条件套给历史编辑。

本轮父代理重建的 REA evidence 为 `ev_29bda24a0045f98971a718cbd2a4c279f667e99d8eb155c369f47585b4a36759`，summary 为 `ev_973bf86cfc5031816d0ebbe7b1d3f7edf430398bbe2a8681daf9557162224fe1`。其 source_paths 仅 user-message 与 user-message-markdown：读 28,185 bytes、2 个 JS、无 parse 失败，17,532 个文件未选择，semantic unknown 达 100k 上限，coverage 为 partial。新 inventory 按 record-and-continue 记录 7 个 unpacked native 声明 hash 不符；原 ASAR SHA 仍为 `52e0a65f9fea51f4287bbd98c63343761f9424517bb793652bb554764bc0bcc8`，未执行这些 native。本节 Tac/PZ/主 composer 大模块结论来自静态源字节和 AST 阅读，**不是这批 REA semantic graph 的覆盖声明**，也不使用已丢失旧 session 的 ID 代表当前 session。

**已闭环的主 local caller。** local-conversation-thread 的 `se` 对象没有 composerController 字段，默认 render 路径为 `Mv({...se})`。Mv 导入自新定位成员 `codex-composer-adapter-475ca25452c0.js` 的 Q。adapter 将 `composerController:Ie`（此默认 caller 为 undefined）、defaultText、defaultTextKind、initialDocument 和 change/dispose callbacks 交 `pn=Okc`，没有传 controllerOptions。Okc 创建 Gac 时先设 `enableCodeBlocks:true, enableRichText:true, enableSelectedTextLinks:true` 再展开 controllerOptions；此路径没有覆盖，三个开关均为 true。shared 设置的 composerPlainTextMode 默认 false，composerEnterBehavior 默认 enter。

adapter 初始正文优先显式 defaultPrompt，否则取 scope 的 persisted prompt；若复用 draft 的 plainTextMode 与当前设置不同，先 `KX(draft.document,{preserveTextLinkMarks:true,preserveUnresolvedSkillMentions:true})`。defaultTextKind 为 `rua(initialText) ? 'prompt' : 'plain'`，同 mode 的 draft 文档可直接复用。Tac 在 rich 且非 plainTextMode 时：prompt 使用 `aga(S.pmu,text)`；plain 且 Rye 判断有 Markdown 格式则用 S.pmu.parse；否则 XX。aga 保留末尾空格/tab，仅在最终 paragraph 且末节点不是 hard_break 时补回。按键 transaction 直接更新文档，**不会每次输入后把全文重新 ZX 或 Markdown parse**。

| 层/调用点 | rich / code / selected URL paste | 默认文本模式及作用 |
|---|---|---|
| Tac 裸默认 | false / false / false | PZ；plain 初始走 XX，prompt 初始走 ZX |
| 普通 local 历史 bt | false / false / true | 依链接检测选择 plain/prompt；library 为 prompt；St 用 AA(getPlainText()) |
| 主 local adapter → Okc → Gac | true / true / true | 非 plainTextMode 时使用 iga 创建的 Markdown editor；与历史编辑区分 |
| vsc 注释编辑器裸默认 | false / false / true | 调用方可显式启用 rich；不是主会话默认值的证据 |
| ChatGPT 会话页 H_ → Okc | rich 继承 true / false / false | 另一个 surface；不能代替 local Codex caller |

**PZ 是受限 prompt schema。** doc=`block+`；paragraph=`inline*`、group=block、toDOM 为带 dir=auto 的 p；text=inline；另有 code_block 和下表 16 个 mention 节点。code_block 的 text*、code=true、defining=true、marks=''，attrs autoDetectLanguage=true、language=null；默认无 code plugins，因为 Tac 需 `enableRichText && enableCodeBlocks` 才启用。PZ 唯一 mark 为 link，没有 strong/em/code mark，也没有 hard_break、heading、list、blockquote、table。默认 XX/ZX 的 sua 按字面 LF 拆 paragraph，连续/结尾 LF 产生空 paragraph；空字符串仍保留一个空 paragraph。普通 Markdown 的 `**bold**`、标题、列表、行内/围栏代码不能在此模式下自动变格式。

下表 `!` 为无 default 的 required 属性；其余写明 default。全部 mention 为 inline/group=inline、selectable=false、draggable=false，无 content 因而是 ProseMirror leaf/atom。仅 richLink、chatGptSystemHint、chatGptReferenceImageMention 显式设置 spec.atom=true；不能把其他节点的 spec.atom 缺失解读成可编辑文本。library 节点没有 inlineMention 标志，由 Drc 专用 node view 处理。

| 节点 | attrs |
|---|---|
| atMention | label!, path!, fsPath! |
| agentMention | name!, path!, displayName='', conversationId=null |
| skillMention | name!, path!, description!, displayName='', iconSmall='', brandColor='', promptLinkLabel='', skillIcon=null |
| browserSkillMention | name!, path!, description!, displayName='', iconSmall='', brandColor='', skillIcon=null |
| appMention | name!, path!, description!, displayName='', iconSmall='', brandColor='' |
| pluginMention | name!, path!, description!, displayName='', iconSmall='', brandColor='', computerUseAppMentionPath='' |
| chatGptSystemHint | label!, systemHint!（CP 校验） |
| richLink | displayText!, href!, sourceAppId!, isLoading=false, loadingDisplayText=null, literalMarkdownOccurrenceId=null, literalMarkdownSource=null, markdownSourceStart=null, markdownSourceEnd=null, serializeAsUrl=false, libraryFileId=null |
| resourceMention | resourceUri!, server!, title!, connectorId='', linkId='', brandColor='', iconSmall='' |
| browserTabMention | path!, faviconUrl='' |
| chatGptConversationMention | conversationId!, path!, title! |
| chatGptLibraryFileMention | libraryFileId!, title!, entrypoint=null, fileId='', libraryArtifactType='', mimeType='', serializeAsUrl=false, sourceUrl='' |
| chatGptReferenceImageMention | referenceImageId!, title!, assetPointer=null, thumbnailAssetPointer=null |
| sitesProjectMention | path!, title! |
| pageReferenceMention | path!（Ta 校验）, title!, projectId='', spaceId='' |
| pageTaskMention | path! |

link mark 继承 shared Mkn 的 title=null、disabled=false、isAutolink=false 与 inclusive=false；ula 覆盖/追加 href=null、literalMarkdownOccurrenceId=null、literalMarkdownSource=null、sourceAppId=null、isGeneratedAutolink=false。常规 href parse 需 BX 校验。selected-text URL paste 要显式 enableSelectedTextLinks=true、非空文本 selection、无 inline leaf，并验证 URL 后才 addMark；Tac 裸默认没有启用，历史 bt 与主 local 启用。sla/Xca 即使在非 rich PZ 模式也可启用（plainTextMode 移除）；输入空格时可识别先前有效 URL 变 richLink，**这不是完整 Markdown input rules**。

**主 rich schema 由 iga → shared zkn 构造。** 默认节点为 doc、paragraph、blockquote、hard_break、code_block、heading、horizontal_rule、regular_list_item、task_list_item、ordered_list、list、text、table、table_row、table_cell，再追加 PZ 的 16 个 inline mention；marks 为 code、strong、em、link、strikethrough、startend、literalPaste。zkn 默认 task list 支持 true、rich table cell 支持 false、tablePipeAlign=true；iga 设置 collapseNestedSeparatorParagraphs=true，并用 wga 替换 code block、bga 替换 inline code、Tga/ula 替换 link，追加 Cga paragraph、xga serializer、tde literalPaste。Cga 的 paragraphGap 默认 false；wga 将原 rich code_block 的 lang/isDarkMode attrs 与 PZ 的 autoDetectLanguage/language 合并，保持 rich marks。schema builder 为非 text 节点补 start/end（default undefined）。表格默认 table_cell 为 inline*，并非 block cell；heading 为 text*。不能用未经核对的通用 Markdown schema 假定这些名称、内容约束、gap 和序列化一致。

**读写与提交区分。** setText 用 XX；restoreText 用 ZX，传 controller 的 path restoration 与 restoreRichLinks，但没有传 restoreMarkdownLinksAsTextLinks（回落 false）。parsePromptText 在 rich 非 plain 模式用 aga，否则 ZX 并传 controller 的 restoration flags。setPromptText 使用 parsePromptText；restoreDraft 优先复用同 schema/mode 文档，否则 parsePromptText。全文更新后 selection 在末尾；初始内容默认不进入 undo history。getPlainText 固定 `KX(doc,{preserveLinkMarkers:false,preserveTextLinkMarks:true})`；getText 用 oga，只有 rich serializer 存在且 sga 判断格式/mention/link 才走 serializer，否则 KX 默认选项。getPersistedText 在 rich 非 plain 时始终用 serializer，persistedTextFormat 返回 markdown。iga 对全 paragraph 文档逐段 serialize 后用 LF 拼接，其他块序列化整个 doc，移一条末尾 LF；不是把 paragraph 无条件隔成双 LF。

主提交分别计算 getText 的发送文本、getPersistedText 的历史文本和当前 PM document。正常非 override 提交若 persistedTextFormat=markdown，历史对象带 `{markdown:persistedText,document:doc.toJSON()}`；实际 context prompt 从 getText 路径构造。getPlainText 另用于 local context/本地提交恢复材料，不可因此替代实际 agent prompt。历史编辑 St 的 AA 是 shared bNn，仅 `replaceAll('](codex-text-link://','](')` 去 storage 前缀，不把 library 节点改 sourceUrl；序列化与提交边界应分开。

**键盘行为在两种 schema 上共享 Tac 覆盖。** 其键盘 plugin 先拒绝 event.isComposing、view.composing、keyCode=229；更早的 W8s 自定义 handler 仍独立存在。用户未配置自定义 composer.submit，或唯一有效绑定仍是 Enter 时，submitShortcutOverride 返回 undefined，交 Tac 默认逻辑。Ihi 读有效绑定，zhi 检查用户 keymap bindings 中是否显式存在该 command，xhi 判断是否仅 Enter；只有显式非默认 submit binding 才返回强制 true/false。

| 按键 | 普通 paragraph 的行为 | 特殊上下文 |
|---|---|---|
| Enter | 默认 enter 提交；newline/cmdAlways 换段；cmdIfMultiline 已多段时换段 | suggestion active 消费；code 计入 multiline，需换行时用 newlineInCode；默认 enter 仍提交；非 Windows 且 pointer:coarse 强制换段；regular/task list 分支另处理 |
| Shift+Enter | `chain(createParagraphNear,liftEmptyBlock,splitBlock)`，新增 paragraph | 先 newlineInCode，再 rich list 条件处理；即便 rich schema 有 hard_break，Tac 此 handler 早于 extensionKeymap |
| Alt+Enter | 同上换段 | 先 code，再 rich regular-list 分支 |
| Mod+Enter | 默认提交 | code_block 内默认 enter 模式转到后续 paragraph，无则创建；override=false 则换段 |
| Mod+A | 全选 | code_block 内首次选该 code 内容，再次落全文 selectAll |
| Mod+Z / Mod+Y / Mod+Shift+Z | undo / redo / redo | history 默认 depth=100、newGroupDelay=500ms；beforeinput historyUndo/Redo 也支持 |
| Backspace / Delete | shared base keymap 的 deleteSelection → joinBackward/Forward → selectNodeBackward/Forward | mention 为不可选 leaf；不应凭空增加“双次退格确认” |

默认 PZ 不安装 rich list/table/format input rules，也不安装 rich Tab/ShiftTab；主 rich 安装相应插件，更早的 tabIndent 先消费列表上下文（包括列表中的代码）；未被其捕获时 Tac Tab/ShiftTab 处理 code indent。粘贴路径会把 CRLF/CR 转 LF；这属于 paste normalization，不应声称 ZX 通用 parser 会归一所有 CR。粘贴文件/图片、5000 字以上 pasted text 附件与 100000 字以上 HTML 处理有额外事件路径；本节没有宣称 voice/dictation 或所有特化 caller 已复刻。

本节新增原始成员全文件 SHA-256：codex-composer-adapter（35,461 bytes）`f40cf6b29a30d4287ef0da9feba568638cceb96b465e8fc109da3a39e8852d53`；composer-content-96b7e1cbf204 与 composer-controls-2591b0f7e400 的局部范围如下。下表全部为 UTF-8 `[start,end)`，可直接在原 ASAR 同名 webview/assets 成员中复验，不是 JS 字符位置：

| 成员及范围 | 内容 | SHA-256 |
|---|---|---|
| app-initial `[6388744,6390126)` | rga/PZ schema | `cea1b7f5e141044deca6f19cb6cc37fa056317d5008ba5587d714d23d6ac6bf6` |
| app-initial `[6390126,6392335)` | iga/aga/oga/sga | `082600efccc28eb2c1a627072eeac80046ee5356923199f3175dbac70f5d8413` |
| app-initial `[10140171,10153275)` | Tac 初始化、插件、键盘、paste、模式切换 | `3c53382ee20329703699ed82b59bd77f4f10e902025079fb251bde3d3c557ddd` |
| app-initial `[10163521,10164601)` | controller 读出方法 | `3ca6ed7e47195af93925f5c27783da1794f6087a6e1a068c4759beb56d564578` |
| app-initial `[10169478,10170619)` | setText/updateLiteralText/restoreText | `1239ba72b4982b4f0b903bd7b4d180d86ced5cd2fce67091c9bfdcd6da7a81c7` |
| app-initial `[10104259,10104783)` | Vrc/Hrc code ModEnter/ModA | `9cd6ddda9258a520244adb7e43d9335d70e435cda059ffede9b39d71005749e8` |
| app-initial `[10730067,10734306)` | Okc 默认 rich/code/selected-text 与设置绑定 | `54990e10af80b7de3aaf99e429f96a16ff8bf52bfdc2200acd9bc306e663e77b` |
| app-initial `[5265788,5265840)` | xhi 默认 Enter 检测 | `792a76018c8edf17cd82385b6b422eb5a86215728de6c95bfdc5ff4133a4b4f9` |
| app-initial `[5268960,5269335)` | Ihi/zhi 有效/自定义绑定 | `100a393ef2ee02787ddd2b08eb4bb85478216a2f923d01796019ab0cdafd3df7` |
| app-shared `[4444096,4447108)` | zkn 默认 rich extensions 与 overrides | `e583f76eea2bccb05c22603b25ca26d40c981f74c3cdac96ae2161720db29c93` |
| app-shared `[4511997,4512050)` | bNn/AA 去 storage 前缀 | `cedd0d0677df076ad9eca706d7432800a750414a0d877bd4b6aae96356109253` |
| app-shared `[1894669,1895084)` | enter/plainTextMode 设置默认 | `ae7f6f172f724743b2684fcb3ad87ff4b25ea7f780d29ab19126f842afc8bec3` |
| local-conversation-thread-ced381ec19c9 `[227280,228377)` | se → 默认 Mv 调用，无外部 controller | `fbeca8fca036f943b5b586e98dd5be1bb755c4a15ed90344d9816f49fa11ed65` |
| codex-composer-adapter-475ca25452c0 `[28229,28606)` | 初始 kind/document/change | `6a0aba8d724df2bbd7a253dca7a87ead23cdcde0decb79a7cd31d10ab80bfdbb` |
| codex-composer-adapter-475ca25452c0 `[33797,34106)` | pn/Okc 参数 | `58049fb24a13f0c966d80d1255cfb5349418eba92044761d1f885d6253fc0196` |
| composer-content-96b7e1cbf204 `[378576,378855)` | 发送/持久化/PM doc 双路径 | `06c5a8306cc9130bd3dd670efd410bced7cd1d3a3d90777039a0122fd3e8cef1` |
| composer-content-96b7e1cbf204 `[381317,381537)` | history markdown/document 保存条件 | `80dcc309edb9f20802d3d311d037bfe33cd1dfbb74d5c9c206372a497cf6f68c` |
| composer-controls-2591b0f7e400 `[214878,215338)` | submitShortcutOverride 注册与返回门槛 | `90fd7188ae61ef8f55c9fb04bfe8b3081ddec83f6d35fa91ed524ab26a7fafce` |

本节不改变后文 AnyWork 当前实现状态；用上述契约完成 ProseMirror 输入器后，需要按主/历史各自模式重新记录验证结果，不能把这份原版行为研究作为实现已完成的证明。

##### PZ 引用 NodeView、HTML 剪贴板与代码块补充（2026-11-04）

这是对上节既有 ASAR 临时副本的独立只读复核：使用静态 AST 和原 CSS，不执行抽取代码，不启动或修改原应用，也没有扩大本轮 REA semantic graph 的覆盖范围。以下结论是打包实现的静态规则；实际浏览器字体、剪贴板和原生选择显示尚未做原应用运行时对照。

**四种引用的可见标签与 DOM。** `Ia` 是 shared `bO=QIn`。它创建根 span、icon container 和 label span，label 用 `textContent` 写入；设置 data-appearance、data-layout、data-font-weight、data-tone，并按参数设置 interactive、underline-on-hover、brand-color、title。icon container 为 contentEditable=false；ProseMirror leaf 另负责节点不可编辑语义。不可用“任何非空 label/title/displayText/name/path”代替节点自己的标签规则。

| 节点 | 标签/状态 | 布局与 DOM 恢复入口 |
|---|---|---|
| atMention | `attrs.label` 原值 | `Zbe(path)!=null` 的 selection 引用使用 selection-pill + label tooltip；其他 inline-flow。输出并读取 at-mention-label/path/fs-path；同时写 data-prompt-link-href/label |
| richLink | loading 时 `loadingDisplayText ?? displayText`，其他 `displayText` | inline-flow；loading 采用加载图标、aria-busy=true，无 interactive/hover underline；loaded 为 link 或 button、tabindex=0，button 有 aria-expanded=false/aria-haspopup=dialog。输出 rich-link-display-text/href/source-app-id/loading；parseDOM 只读前三项，loading 不从 HTML 恢复。此 toDOM **不**写通用 data-prompt-link-href |
| resourceMention | title；leafText 也是 title | inline-flow；支持 brandColor 和 connector 图标。输出 resource-mention-brand-color/icon/resource-uri/connector-id/link-id/server/title，并写通用 prompt href/label。parseDOM 读这些 span 属性，另接受 ce 可识别的 a[href]，title 来自 textContent |
| chatGptLibraryFileMention | title | toDOM 默认 selection-pill、file-reference tone、tooltip/aria-label=title、interactive=true、underlineOnHover=false，默认 role=button/tabindex=0。输出 chatgpt-library-file-mention-entrypoint/artifact-type/file-id/id/mime-type/title 与通用 prompt href/label；serializeAsUrl 还写 data-library-provider-file |

library 的 parseDOM 顺序包括 priority=60 的通用 prompt href/label（PCe 成功才返回 attrs）、priority=60 的旧 documentReference selection pill（data-id 以 file-library: 开头且含 keyword），再到指定 library id/title 的 span。最后一支 sourceUrl 从 prompt href 的 PCe 结果恢复；不能仅从显示标题猜文件标识。PZ 的 rga 还给全部 16 节点追加通用 `span[data-prompt-link-label][data-prompt-link-href]` 规则：gee/CNn 将这两个属性还原为 Markdown，ZX 后取首 paragraph 的首 child，**只有类型正好与当前节点相同才取 attrs**。

inline-flow 的图标槽为 16px，height=1em，右间距 3px，纵向 translateY(.5ex - .5cap)；根为 inline/nowrap，label 可换行。selection-pill 为 inline-flex，gap 与两侧内边距各 4px，icon slot/icon 20px，label 最大宽 256px、nowrap/ellipsis、baseline 对齐，font-weight=inherit。selection-pill 和 appearance=pill 是不同属性，前者不自动意味着圆角底色。

library live NodeView 由 Drc 额外调用 Crc：完整 title 保留在外层 aria-label/title，label 内使用隐藏 full text、display、measurement span，ResizeObserver/字体加载后按 grapheme 测量并中间截断，尽量保留末尾扩展名。schema toDOM 用于复制，不使用这套 live 截断 DOM，因此 HTML 剪贴板保留完整 title。Mrc 的普通 NodeView 与 Drc 都明确 **不忽略 selection mutation**；只忽略内部 icon/label 改动及限定的选择属性。Mrc 根据 DOM Range 给完整引用或 icon 加 data-inline-mention-selected；inline-flow 整体选择还测量选区上下 padding。统一 `ignoreMutation:()=>true` 或只依靠浏览器原生文字高亮不等价。

**剪贴板文本与原 HTML 粘贴入口。** Tac 的 HTML serializer 从 DOMSerializer.fromSchema 取得 schema toDOM；非 autolink 的 link mark 输出普通 a[href,title]。clipboardTextSerializer 先依据 openStart/openEnd 解包；openStart>0 且唯一节点为 code_block 时直接复制代码 textContent，否则 KX(fragment,{forClipboard:true})。KX 的四类引用分别复制 label、canonical displayText、title、title；不会复制 loadingDisplayText。richLink 的 Ila 会更早返回 URL，但要求 serializeAsUrl=true、href 为原样有效 URL 且 oce(href)!=null，不能把 serializeAsUrl 单独视为充分条件。普通显式文字链接可复制 Markdown；autolink 或显示文本等于无 title 的 href 时复制文字/URL。

`Cxe=shared qA=mMn` 是实际 HTML parse 入口，未依赖任何 AnyWork 私有 JSON 属性：

```js
const transformed = view.someProp('transformPastedHTML', fn => fn(html, view)) ?? html;
const dom = new DOMParser().parseFromString(transformed, 'text/html');
// 遍历文本，PRE、特定 data-pm-slice、保留空白样式等容器以外的 CR/LF 改为空格。
const rules = DOMParser.fromSchema(schema).rules.map(rule =>
  rule.node != null && schema.nodes[rule.node].isTextblock
    ? {...rule, preserveWhitespace: 'full'} : rule);
const document = new DOMParser(schema, rules).parse(dom.body, {
  preserveWhitespace: true, context: view.state.selection.$from
});
return Slice.maxOpen(document.content);
```

上例是恢复可读名称的等价静态摘录，DOMParser/Slice 指 ProseMirror 类型；HTML 的原生 DOMParser 是浏览器类型。Tac 的 transformPastedHTML 先 lga/cga 清理隐藏元素、脚本、媒体等；普通 PZ 还给 li 前置字面列表标记，而不是创建 schema 不支持的 list。HTML 超过 100000 字符不进入此路径。PZ candidate 的 leaf text 用 spec.leafText 或 qX.text，压缩空白后应与 text/plain 相等；小于 5000 字符时也可通过 cde/hMn 的结构化 HTML 判断。最终需要通过 mte 尺寸检查才替换为 Slice。普通纯文本 fallback **Bla 只按 LF 建 paragraph，首行保留 storedMarks 或 selection marksAcross，后续行无 marks**；不对任意粘贴文本做 ZX 引用恢复。故只识别私有 JSON HTML、或把任意 plain paste 都交 prompt parser，都与原入口有差距。

**历史代码块。** code_block.attrs 保留 autoDetectLanguage=true/language=null；parseDOM 的 pre 必须包含直系 code，否则拒绝。zhe=shared EFn 的 language 优先级为 code[data-language] → code[data-lang] → pre[data-language] → pre[data-lang] → code/pre class 中首个 language-/lang- 前缀；wFn 只接受非空且无空白/反引号的字符串，不做语言别名归一。Vme/TFn 读取 language；autoDetectLanguage 不为 false 且 language=plaintext 时输出 null。toDOM 为 `pre[data-composer-code-block][dir=ltr] > code.hljs[spellcheck=false]`，可选 data-language。

需精确区分“选择了换行 command”和“最终是否提交”：Tac 默认 enter 模式、非 coarse/mobile 且 override 未 false 时，即使处于 code_block，Enter 仍 emit submit；只有 newline/cmdAlways、cmdIfMultiline（code 算 multiline）、移动触摸条件或 override=false 才调用 newlineInCode。Shift/Alt+Enter 总先试 newlineInCode。Mod+Enter 默认 enter 模式的 Vrc 要求 selection 两端在同一 code_block，随后选择块后的 paragraph，没有则插入；跨块 selection 不走该分支。Mod+A 的 Hrc 同样要求同一 code_block：先选该块完整内容，已精确全选块内容则返回 false，由下一 command 全文全选。普通 PZ 不应因此额外启用 rich Tab 缩进或 rich 箭头退出插件。

下列是本次复核新增 UTF-8 `[start,end)` 证据；完整成员身份与 REA 覆盖限制沿用上节。每个区间均直接从临时副本 byte buffer 重新校验；AST 区间只用于定位，没有执行目标 JavaScript。

| 成员及范围 | 内容 | SHA-256 |
|---|---|---|
| app-initial `[6203991,6205597)` | fla | `7b9b9586c279de817e40f82d924c7e9624541ac85447bcc5f721477721e460df` |
| app-initial `[6248771,6251450)` | dda | `1c360a7a4f54d0cf672cb0b998f5bb85930177fb05faee4568a90b98d4033b3c` |
| app-initial `[6377947,6378756)` | zha | `3389f2dda70f8e2028abbdfb8dcaeb5875853bfc20627191f3e83fc33fec9ed0` |
| app-initial `[6379701,6381711)` | Vha | `4e2c4773fe1a86e98390e42316559f78ca82760ced5b1fe31fe00ada746c9ff3` |
| app-shared `[4603199,4604430)` | QIn | `4c27465be80ad4c52b5d7fc4edc0c28e82c775453252eb84b7e0a06e241bca86` |
| app-shared `[4512164,4512242)` | SNn | `864673137748fe37e98909c734b1fc0f338023b4c701439d4790a334147546f2` |
| app-shared `[4512242,4512355)` | CNn | `2caa03a2e3261488501d37d10fca04cce1e962533175c16bfd32589673a52d47` |
| app-initial `[10095552,10096458)` | Crc | `2b603a5bede0225ee6c4c8b81c4b24d70e3813af7f69268802a08db4ed7e2b65` |
| app-initial `[10096458,10096961)` | wrc | `34614939e10f5a3457680ee365f538ab102c57aabd596c0cdd6a2726d263f97f` |
| app-initial `[10097035,10097446)` | Drc | `aa37cd3acecda9d8de90d39528cd9aaf7a8fe5447cb557c3bf2a8fa688baab8d` |
| app-initial `[10098809,10101997)` | Nrc | `1ff1f03940af0b5dabe87f13beccb1de757e212accceed778441db557af903e4` |
| app-shared `[4494163,4495319)` | mMn | `c98186750c0443bcddc1118d603da58c0b7d92457987e072b12a40e4fd1b47fd` |
| app-shared `[4495319,4495809)` | hMn | `e76f055b80025a986c90390863c4112f937ceb922b9d89d9c0a3a21a90e025e4` |
| app-initial `[6392374,6394477)` | lga | `6bbd689e69dd1913584dc4c3f295e3b0f1946a02a944da00fcf93b30ffa7b594` |
| app-initial `[6218002,6218316)` | Bla | `3e4847ab248fdb6beb9ee62d7bf7dff7e699777f8e77b4aa8ae606c9956f60bb` |
| app-shared `[4589296,4589609)` | EFn | `aaf6ae54672720094c9091fe9f04f2330a4f0079ae149356492bb040b5131898` |
| app-shared `[4589189,4589296)` | TFn | `573e97cd1262427b434d2f854ae4a16f7392319b67b5bf7a5eae7969756408a9` |
| app-shared `[4589118,4589189)` | wFn | `8ddd03eedbd050d9ca08fd6dcc632c9c922ec6e0707604eaaaa23708b846fa06` |
| fd9b7fd80db1.css `[76387,83133)` | InlineMention CSS | `dfde866d04b105f23e7a1f26ca2759d940bd4637cd017534a4730993be5c571e` |
| b74e19ff7ff4.css `[138367,138797)` | Library truncation CSS | `80537ca5c781bd7ef07292067f0a6fdecbf7bb2629ac7ec700181a12d162d9d0` |
| b74e19ff7ff4.css `[176727,177469)` | Inline selection CSS | `e482a4885d7be09d086b20e1dfd10c42ef4aa1a630da4a8705765f4f2f6efc2a` |

本节只补充原版契约，不声明 AnyWork 已完成以上差距。后续实现应分别验证原 DOM 属性粘贴、长文件名、加载态标签、跨代码块选择及移动端输入。

当前实现进度（2026-11-04）：普通历史编辑已接入独立 ProseMirror PZ 文档，主 composer 仍未替换。初始化与 KX 提交/剪贴板由 `promptText` 处理；`promptFileName` 对应 library live 字形测量中截，复制使用完整标题。原生 library/richLink/atMention/resource HTML 属性可恢复，普通纯文本粘贴走 Bla 首行 marks 规则。代码块保留语言、代码内换行/退出与两阶段全选。忙碌/待确认只读阶段拒绝键盘和粘贴改稿。Escape 保留输入法和弹层保护，由外层 capture 先于 PM baseKeymap 处理。键盘命令前按实际 DOM 文本选区同步，避免原生光标导航先于 selectionchange 时在旧位置执行；Android Chrome 修饰 Enter 由 Web DOM handler 补走 keymap。这些是浏览器适配，不冒称原 macOS 应用的 Android 运行证据。

当时未完成的主rich composer已在后续接入，行内richLink/文字链接动作浮层也已补齐；当前实现、静态证据与边界见富文本契约第15节。其他引用的完整图标/交互、跨host/原生窗口thread分发、全部HTML归一分支及原DOM Range细粒度选择几何仍有差距。当前静态对照和AnyWork浏览器验收不等同于全会话1:1；最新测试结果以validation.md为准。

###### PZ HTML 候选的验收与提前分支（2026-11-04）

继续只读复用本节原始字节，补齐尺寸与身份门禁。这里的 length 均为 JavaScript UTF-16 string.length，阈值比较不可改成 UTF-8 bytes。

普通 Tac PZ candidate 的有限算法为：

1. 非 plainTextMode、非强制纯文本，HTML 非空且 length<=100000 时，先 mMn/Cxe；主 rich 另有不同入口条件，不能套用此 PZ 分支。
2. 令 f 为 parsedSlice.content.textBetween，block separator=LF，leafText 使用 spec.leafText(node) 或 qX(node).text 或空串。令 norm(s)=s.replace(/\s+/g,' ').trim()。
3. 只有 `norm(f)===norm(plain)`，或 `plain.length<5000 && f!=='' && hMn(schema,html)`，才将 slice 内容包装为 doc candidate；第二项只在 S==null 的 PZ 路径成立。
4. 之后仍有文件、超长 pasted-text、code/plain、特殊引用和 URL 等提前分支；到最终 candidate 替换前再做 `_Mn(candidate,max(plain.length,candidate.textContent.length),qX)`。仅结果为 false 才接受，否则 Bla 纯文本 fallback。不能把“存在某个 HTML 标签”作为通用验收。

`cde=shared hMn` 先拒绝 html.trim()===''；对 BAn(html) 创建 HTML DOM 后，原字符串含 `/\bdocs-internal-guid/i` 或存在相邻元素 `:is(p, ul, ol) + :is(p, ul, ol)`，立即 true；否则按当前 schema parse，再找任一非 paragraph block、非 text/hard_break 的 inline atom，或带非 startend/literalPaste mark 的 text，存在才 true。它依赖 schema 的实际 parse 结果；PZ 不支持的 strong/list 等标签本身不足以证明格式化节点存在。BAn 的 FDn 仅对 docs-internal-guid 输入执行 GoogleDocs HTML 归一；同类输入还做代码段、blockquote、inline-code、table-cell 处理。所有输入随后 JAn 清除 color/backgroundColor/fontFamily/fontSize/lineHeight/textDecoration/textShadow，heading 内 fontWeight 也清除；空 style 移除后无 attrs 的 span/font 解包。这里没有发现 Word 专属处理，不能据 helper 名推断。

**mte=shared _Mn 检查隐藏链接材料，不是正文总长度上限。** vMn 跳过 spec.code 子树；相邻、同 href/title 的 text link 合并，title 为空且 display text 已包含 href 的普通链接不计。inline atom 使用传入 qX 回调的 text/href，显示 text 则优先 spec.leafText；hiddenLabelLength=max(0,qX.text.length-display.length)。令 h 为所有记录的 `(display.includes(href)?0:href.length) + title.length + hiddenLabelLength` 总和；`_Mn(doc,baseline,qX) = h>=5000 && h>=baseline`。因此刚好 5000 也达到阈值，普通很长的无隐藏链接文本不会仅因字数多而被它拒绝。

**uga 是 library/reference-image 专用提前粘贴。** 它位于 CRLF 归一之后、超大 HTML 分支之后、URL 处理之前，需同时满足：HTML 非 null；Afe(view)=false；原 HTML 字符串命中 `/chatgpt-library-file-mention-id|data-inline-selection-pill|data-prompt-link-href/`。再用 pga parse，parsed content 内必须实际存在 chatGptLibraryFileMention 或 chatGptReferenceImageMention，才交 dga。仅正则命中不能接受任意 HTML。此专用分支没有与 text/plain 一致性的比较；原实现允许经过身份验证的引用 HTML 保留节点。

Afe=shared m5：selection 两端不同 parent 时 false；相同 parent.spec.code 时 true。否则需存在 code mark；空 selection 检查 storedMarks 或当前 marks，非空 selection 需至少一个 inline 且选中的 inline 全都含 code mark。普通 PZ 无 code mark，因此只会被同一 code_block 上下文阻挡；跨 parent selection 不被这一 guard 阻挡。

pga 使用 Cxe/mMn 后，移除 qX 可识别节点范围的 link mark；保留原 slice 开口。原 HTML 含合法 `data-pm-slice` 格式 `/^\d+ \d+(?: -\d+)? /` 时直接使用该 slice，否则 cue/SMn 以 preserveBlankLines=true 归一。dga 在空 content 时 false；其他先计算 leaf-aware 可见文本 a，检查 `_Mn(doc,max(plain.length,a.length),qX)`：超限则 xo literal 或 Bla fallback，返回 true；通过才 replaceSelection。library/reference 的 uga 调用令 scrollIntoView=true。尾部 table 的段落处理仅是通用 dga 的额外分支，普通 PZ schema 不含 table。

**fic 不是 handlePaste 门禁。** 它仅被 Tac handleDrop 最后分支使用：此前 files 与 plain-mode drop 已处理；S==null、HTML 非空且 template.content.querySelector('pre > code') 命中时，调用 Bla(text/plain) 并消费 drop。不得因为 fic=true 就让 paste 接受任意 HTML 或直接恢复 code block。

下表为补充静态证据，仍沿用上节身份与覆盖限制；UTF-8 `[start,end)` 与字符串 length 阈值是不同单位。

| 成员及范围 | 内容 | SHA-256 |
|---|---|---|
| app-shared `[4495875,4495930)` | _Mn | `e2b698c7ef5f1de8e20ded51934bc72e1c0aef513f16254f056ae1f95d6ed8a9` |
| app-shared `[4495930,4496630)` | vMn | `16d9932a80e1619905adf16ba5d13faede3e3beb6ff3605c837297a96fc0e39b` |
| app-shared `[4496630,4496771)` | yMn | `4a49df0e5c1f61ea5677300a706258df932ced54f8f4154158e4a2c2016bd637` |
| app-shared `[4496801,4496823)` | xMn | `1dcfae50ad0ed96f13baed33cae5c689d9b20025d46f16ce0bff945307ac57b5` |
| app-shared `[4495319,4495809)` | hMn | `e76f055b80025a986c90390863c4112f937ceb922b9d89d9c0a3a21a90e025e4` |
| app-shared `[4465570,4465771)` | BAn | `670c5a55f0b3ee99084f20ceb8ece108a42bf756098071882f7005200eec2cb6` |
| app-initial `[6394477,6394786)` | uga | `9a592bbda0cf1c3466ea261dae0fd21d0ba510e189d555a23d11afaabb98d979` |
| app-initial `[6395693,6396146)` | pga | `a23e49c7d38ebc1d18395b98eb56f0d7f5bbfa40b2a23e112c1cc273c6e0d471` |
| app-initial `[6394786,6395599)` | dga | `140e07fc9dccd5958aa56a15473ddbebe4ce37cda5acaf643b5539f0bc89afab` |
| app-shared `[4475441,4475805)` | m5 | `c84fc98e250bba41e98798a5b5d8b3656c35ab4ed5ddae4925efb7249218aea0` |
| app-initial `[10110967,10111089)` | fic | `95de70f90dcfc0ceb161ae0ea32859ea0afab6b7709e047c9e94eae8c19d702f` |

##### 正文提取与首 text 重建的精确规则

2026-11-04 继续只读核对既有提取模块，并从原 ASAR header 的 offset/size 重新读取下列四个成员确认临时副本逐字节相同。本次没有扩大前述 REA 分析批次，也没有启动原应用。路径均相对于 `/Applications/ChatGPT.app/Contents/Resources/app.asar`：

| 原始成员 | bytes | SHA-256 |
|---|---:|---|
| `webview/assets/app-shared-e711d01481fb.js` | 6,213,809 | `b57a5332480b033f54945bfa155cf5b152e0b8486a812192b0913f1d0753a580` |
| `webview/assets/app-initial-61c1d0e6137e.js` | 10,859,750 | `7a8d8b711bf2eb1adbfab04818a63bf6517935d11bb4d0d4c9d6602d1e3fe6f2` |
| `webview/assets/user-message-2c7dafc6a971.js` | 26,244 | `96e67fd2f531545d70d63cde373d97181c61c1b996f656b025c694a6427eec0e` |
| `webview/assets/subagent-activity-chip-group-2fb46825e7e8.js` | 450,047 | `6a22f24b5e792a7e68c003abf3d607ff1b1188761430449694e54a7ea19862c4` |

`Woe` 接收 **string**，不是 userMessage/input 对象。核心函数的短摘录如下；变量名来自原 minified 模块，换行仅为阅读：

```js
ev = `## My request:`;
tv = `\n</page-comment-context>\n`;
nv = `${ev}\n`;
rv = /## My request(?: for Codex)?:/g;
function koe(e) {
  if (!e.startsWith(`<page-comment-context>\n`)) return null;
  let t = e.indexOf(tv, 23);
  if (t === -1) return null;
  let n = t + 25;
  return e.startsWith(`## My request:\n`, n) ? n + nv.length : null;
}
function Soe(e) { let t = koe(e); return t == null ? null : e.slice(t); }
Woe = e => {
  let t = Soe(e);
  if (t != null) return t.trim();
  let n = e.split(rv);
  return n.length <= 1 ? e : n[n.length - 1].trim();
};
function Ooe(e, t) {
  let n = koe(e);
  if (n != null) return `${e.slice(0, n)}${t}\n`;
  let r = Array.from(e.matchAll(rv)).at(-1);
  return r == null ? t : `${e.slice(0, r.index).trimEnd()}\n${ev}\n${t}\n`;
}
```

`koe` 只接受字符串开头的精确 LF `<page-comment-context>\n`，从其后找首个精确关闭标记，并要求关闭标记后紧接 `## My request:\n`；不宽容前导空白、CRLF 或 `for Codex` 专用 page 头。匹配成功时优先走 page 分支，单次 `Woe` 不再扫描正文内部的请求标记。其他情况回退至 `rv`：区分大小写、未锚定行首，任意位置的最后一处 `## My request:` 或 `## My request for Codex:` 都能命中。提取后正文用 JavaScript `trim()`；完全没有标记则返回原字符串，包括其首尾空白。

`Ooe` 的 page 分支逐字节保留直到正文起点的原前缀，直接追加 edited 与一个 LF；普通标记分支仅将最后匹配之前的前缀 `trimEnd()`，然后统一重建 `\n## My request:\n{edited}\n`。即使该前缀为空仍有首个 LF，原 `for Codex` 会改成普通头。没有标记时直接返回 edited，不补 LF；三个分支都不自行 trim edited。提交层的 trim 是独立行为。

原生 input 到显示字符串还有前置层：`app-initial.el`（约字符 39,161）遍历 input，排除 `MDe` 确认的标注辅助 text，令 `rawText = texts.join('\n')`、`displayRawText = displayTexts.join('\n')`；后者逐项用 app-input 的 `message.text` 或 `XEe(text)`。`XEe`（约24,162）只在 byteRange 和 placeholder 均有效且链接内容吻合时恢复 `chatgpt-library-file://` 提及显示，不能把 text_elements 一概删掉后假定显示等价。图片辅助文案及特定 app-input 另有条件分支。

##### 原生 input、辅助图片文本与 text_elements 的精确前置层（2026-11-04）

本次复用既有 REA 记录，继续只读检查同一 `app-initial-61c1d0e6137e.js`，没有重新进行全模块分析或启动原应用。重新按原 ASAR header 读取整个成员，10,859,750 bytes，SHA-256 `7a8d8b711bf2eb1adbfab04818a63bf6517935d11bb4d0d4c9d6602d1e3fe6f2`，与临时副本逐字节相同。该成员在 ASAR 的绝对起点为169,973,905；以下是**成员内 UTF-8 字节范围，终点不含**，可独立复查：

| 范围 | 内容 | SHA-256 |
|---|---|---|
| `[23800,25260)` | JEe / YEe / XEe / ZEe / QEe | `96f434193d49e0cd166667f4bce48cbc41464e8cac7e19f133a730d7e46874c4` |
| `[25305,29588)` | app-input 构造、识别、schema | `2f85d7c03f2a30570b2cfcb16bbd294571a16f3c3342d672f638e061adbc92b5` |
| `[29740,39871)` | 图片辅助文案、MDe、清理及 el | `7b7f4e73ed457d59f54ddc97c923f9c40307071b2ec15a70a82c09abc8432733` |

少量 imported 常量、Markdown parser 与 schema alias 从既有 `app-shared-e711d01481fb.js` 精确定位，仍为前表 `b57a5332…` 的同一原字节，未扩展为全依赖分析。`$Ft as h` 是共享 `gfe` 的 CommonMark mdast parser；`dHt as Qa` 是 `Om`，其 object `catchall` 为 never，所以 app-input 的 Qa envelope 不能仅按“JSON 可解析”识别。

**el 是 pre-Woe 投影，不包含请求包装提取。** 输入为 `input` 数组、可选 `commentAttachments=[]`、`shouldStripAdjacentImageDisplayPlaceholders=false` 和 `shouldStripImageDisplayPlaceholderLines=false`。先计算 `skip = MDe(input,commentAttachments)`，按原顺序遍历：

1. 每个 image/localImage 对 imageCount 加一，其他非 text 不加入文本。
2. 被 skip 标记的 text 完全跳过。对其余 text 执行 nDe；保存**第一个**有效 appInput 和它的首 placeholder，且每个有效 appInput.message.imageUrls 的长度都加到 imageCount。
3. `rawTexts.push(part.text)`；`displayTexts.push(appInputForThisPart?.message?.text ?? XEe(part))`，两组分别用 LF 连接。
4. `imageCount > 0 && firstAppInput?.message == null` 时，仅对 displayRawText 执行 NDe 图片说明句清理。注意条件取第一个 appInput，不是数组中任意一个。
5. 显式开启 stripLines 且第一个 appInput 无 message 时，rawText 与 displayRawText 都执行 rOe；allowAdjacent 参数只控制这一步。

输出 `{rawText,displayRawText,imageCount,appInput,appInputPlaceholder}`。这里的 rawText 已排除 MDe 确认的辅助项，并不等于完整原始 input；完整 input 仍应单独保留用于编辑、指纹和恢复。

**XEe 只恢复可验证的文件提及链接。** JEe 以 JS for-of 遍历字符：ASCII计1字节、低于0x800计2、其他单 UTF-16 单元计3、代理对计4。XEe 建立 UTF-8 byteOffset 到 UTF-16 索引的字符边界 map，含 `0→0`，中间字节或代理对中间没有条目；随后按 byteRange.start 稳定降序处理 text_elements。核心原文：

```js
let r = offsets.get(element.byteRange.start);
let o = offsets.get(element.byteRange.end);
let s = element.placeholder;
if (s == null || r == null || o == null || r >= o || o > remainingEnd) continue;
let links = ZEe(s);
let link = links.length === 1 ? links[0] : undefined;
if (link?.start === 0 && link.end === s.length && link.href === part.text.slice(r,o)) {
  tail = s + part.text.slice(o,remainingEnd) + tail;
  remainingEnd = r;
}
```

摘录仅将局部变量改为说明性名称；算法来自上述原字节。最终返回原文 `[0,remainingEnd)` 加 tail。空元素列表直接返回原文；无效字节边界、空范围、超界、重叠、缺 placeholder 或地址不相等均不替换。已接受的右侧范围收紧 remainingEnd，故重叠元素不会被全部套用；同起点排序保留输入顺序。普通 Unicode 标量的字节长度不能误当 UTF-16 长度；原 JS 也将孤立 surrogate 计3，但 Rust 合法 UTF-8 字符串不保留该种原始 JS 字符串，不能假称此畸形输入边界已完全等价。

ZEe 用 mdast 仅收 `type:'link'`，不把 image、linkReference 或代码里的文本当链接。QEe 要求链接地址以大小写精确的 `chatgpt-library-file://` 开头，WHATWG URL hostname 非空，首个 `asUrl` 查询参数精确为 `1`，首个 `sourceUrl` 非 null、符合大小写不敏感的 `^https?://`，且其 URL hostname 非空。返回查询参数解码后的 sourceUrl 原字符串；与范围内原文严格相等，不将 URL 另行规范化后比较。placeholder 必须恰好包含一个这种有效链接，且该 link AST offset 覆盖 placeholder 全部 UTF-16 单元。原始 Markdown label、转义和链接写法由 placeholder 原样恢复；仅用简单正则识别 `[label](url)` 不能证明 CommonMark autolink、嵌套、转义等全部等价。YEe 是对应发送序列化：将这些 library 链接替换成实际 sourceUrl，并记录实际地址的 UTF-8 byteRange 及完整原 Markdown placeholder。

**nDe 识别的是受验证的 app-input envelope。** 它只检查 text_elements 的**第一项**：start必须为0、end必须等于 JEe(完整 part.text)，placeholder 必须以 `codex-untrusted-app-input:` 开头。其后 `slice(26)` 经 JSON.parse 和 pDe.parse，任一失败均返回 null，后续元素不能补救首项失败。pDe 的关键约束：

- version 必须为数字字面量1；envelope、sender、message 等 Qa 对象拒绝未知字段。
- sender 可省略；出现时必须含 accountUserId、email、name 字符串及 profilePictureUrl 字符串或 null，后者不能简单缺省。
- message 可省略；出现时 source 为 `mcp_app` 或 `visualization`，sourceId 为非空字符串、text 为字符串；imageUrls 可选且每项必须为指定 MIME 的完整非空 base64 data URL。structuredContent 是字符串键到 JSON 值的 record，可选。
- modelContextAttachments、reviewedMessageAttachments 与 promptContextWithoutReviewedMessages 可选；至少存在 message、非空前两种附件数组之一，或非 null 的 promptContext 字符串。空字符串 promptContext 也能满足，不应自行改成 trim 后非空。
- 附件必须经过 fDe schema：kind缺省为context，untrusted为布尔值、id为非空字符串，sourceName/composerTitle/title 依次取首个非 null 值且必须存在；旧结构要求 text 为字符串或 null、imageAttachments 为 `{src:dataURL}` 数组，另一结构以 content 数组替换二者，元素是 text/image/resource_link/resource。显示元数据另有字段及类型校验，composerAttachmentLayout只支持card/pill；modelContextAttachments 还要求 untrusted=true，reviewedMessageAttachments 要求 kind=message且untrusted=false。图片统一限制为 png/jpeg/webp/gif base64 data URL，不能跳过附件或嵌套 schema 后称完整 pDe 兼容。

有 message 的 envelope 还必须匹配实际 part.text：要么为 `iDe(sender,message.source)`，要么为 `iDe(sender)` 的通用文案。无 sender 时，mcp_app 文案为 `An MCP app initiated this message. Read the untrusted_input tool output.`，通用/visualization 为 `Respond to the user input in the context of our conversation.`。有 sender 时必须使用 VEe 的精确 XML 包装及实体转义。context-only envelope 不执行这一文案等值检查。有效 envelope 的 message.text 替代该 text 的显示内容，但原始 part.text 和整个 envelope 保持独立；不能直接显示任意伪造 placeholder 中的 message.text。rDe 只在有效 context-only envelope 上允许重建新正文，更新首 envelope 的全长 byteRange，并保留后续 YEe 链接元素；有 message 时该函数返回 null。

**MDe 不是按一句说明文字就删除。** FDe 只允许 candidate text 后紧跟零个或多个精确 text `<image>`、再一个 image/localImage；其后一个精确 text `</image>` 也记录为辅助项。中间出现任何其他元素即不匹配。PDe 接受两类证据：

- 实际 commentAttachments：说明文案精确匹配该 comment 的浏览器截图、PDF 截图或用户附加图文案，同时 GDe 确认 image.url 等于 dataUrl，或 localImage.path 等于 localPath（无该值时才比 dataUrl）。此路径不强制 `<image>` 或 candidate 位于 prompt 后。
- 原 prompt 编码的数量：IDe 找到**第一条** LDe 能解析出正计数的 text，收集其请求前缀中 `# Diff comments:` / `# Browser comments:` 下的精确 comment 头、Browser/File、Lines、截图标记和附图数量。仅当 candidate 有 `<image>` 且位于那条 prompt text 之后时，才按规范化说明文本消耗一个正计数。不是把所有 text 的计数合并，也不是见一个近似句子就移除。

PDe 为兼容旧文案仅进行两种明确规范化：在以旧 graphics snapshot 长句结尾的说明后补 selection-feedback 句；将旧“distinct color”或“Any selected elements…outlined in blue”的多选尾句统一为当前颜色匹配句。PDF 和用户附图的显式 metadata 路径仍比较原文。匹配成功后跳过 candidate 及 FDe 收集的开闭 text 标记，实际图片元素保留并计数。

NDe 是另一步仅作用于显示字符串的全局正则清理：覆盖已知浏览器旧/新说明前句与 graphics、多选、带/不带目标元素、region、text 六种尾句，以及已知附加图/PDF说明句；不是通用“删除下一张图片”规则。el 只在存在图片且首 appInput 无 message 时调用。rOe 默认只移除整行、忽略大小写和首尾空白的单个 `<<ImageDisplayed>>`；allowAdjacent=true 才允许一行多个连续占位符。只有实际移除过至少一行时，才同时移除结果尾部空白行，其他首尾空白不改。普通 el 的两个开关均缺省false，不能无条件启用此行删除。

**caller 与两次 Woe 的适用边界。** 普通历史/实时原生 input 通过 Wgn→Ggn→el；其 rawText/imageCount 用于 compareKey，displayRawText 用于展示。Ggn 遇到第一个有效 appInput 含 message 时提前返回，message为整个 displayRawText，直接保留 sender、message图片与上下文附件，**跳过普通 Ggn 的第一遍 Woe**；共享 user-message 仍会再执行一次 Woe。第一个 appInput 仅含context时不提前返回，即使更后 text 含app message，也继续普通路径。普通无 app message 的输入才适用已实现的“两次 Woe”。队列恢复 `vhn` 另会优先取 firstAppInput.message.text，并恢复 reviewed/context 附件，不等于普通 Ggn 的合并字符串；steer 的 sOe/cOe 还通过 el 构造/比较 rawText 与 imageCount，不能将显示清理后的字符串用作原始输入身份。只拿本服务用户直接提交的裸 text 作本地 echo，缺少原生输入数组及附件元数据时，不能凭文字猜测这些分支。

AnyWork 本轮将显示前置层拆为 `user_text::display_input`、`restore_library_placeholders`、`native_app_input::parse` 与 `native_image_context::auxiliary_image_indices`，完整原始 input 另行保留。`native_app_input::parse` 实现上述严格 pDe/fDe envelope、发送者包装、两种附件结构、四种 MCP content、嵌套 metadata、日期与图片地址语法；原生 Qa 的未知字段拒绝，普通 MCP content object 的未知字段剥除，附件的 sourceName 别名转换后返回。其8项定向测试覆盖首元素及UTF-8 span、严格字段与必需上下文、发送者转义、附件转换、四种content、图片base64、嵌套类型以及任意长度时间小数。图片校验遵循原正则而不增加文件签名要求，resource blob 遵循 atob 宽松base64语法而不误用图片限制。

文件提及恢复使用 CommonMark parser `pulldown-cmark` 做完整链接边界检查，再校验byteRange与URL；它与原包的 mdast parser 仍是不同实现，复杂语法的等价范围应以回归样例逐项验证。历史编辑已移除有效app-input/library首text的额外409门槛；编辑描述返回最终显示Markdown，用户以普通 PZ 文档序列化后的字符串进入Ooe，重建原首text并清空其text_elements，其余input元素保留。该历史路径依已核对的jun不调用YEe/rDe，与新发送/队列的序列化分别处理；不能再把未调用这两个helper列为历史编辑缺失。原始事件、目标指纹和编辑恢复记录仍基于原input，而非显示文字。

当前普通 PZ 已实现 chatGptLibraryFileMention 节点的 Ame/B4 对应重编码及 KX 序列化，含 URI 参数排序、编码和剪贴板分支；完整富文本编辑器的 St/bla literal occurrence 语义仍未接入。原生存储标题使用替代 parser，所有异常语法及 rich 模式尚未证明逐字符等价。含message app-input按历史编辑清首text marker的行为处理，不额外宣称重建envelope或再次注入不可信工具材料。多text/合成输入继续受目标唯一映射限制。

后端 `display_text` 是已完成本路径 Woe 次数的最终显示正文，前端直接显示该字段；缺字段的兼容数据才执行既有两次 Woe。显示正文用于编辑器初值，提交值经用户修改和Ooe重建；它不直接覆写envelope，也不作为原始输入身份。

上述测试未运行原应用、未做动态对照；JSON中的孤立UTF-16代理单元不能由Rust字符串完整表达，各历史caller、队列附件恢复和特化输入路径也仍需独立核对。当前实现和证据不能据此宣布完整1:1验收。

普通本地 `app-initial.Ggn`（约3,273,041）从 `displayRawText` 去发送者包装、处理可识别的自动化消息，再 `B = zs(g)`；import `qLt as zs` 实际是 `app-shared.Woe as qLt`。普通 `item.message` 以 B 为基础；问答回复、heartbeat、delegation、goal、appshot 等另有专门呈现。中间 `subagent-activity-chip-group` 普通 `case user-message` 传 `Pv({message:e,...})`，没有传 `initialEditMessage`。共享 `user-message.wt` 又令 `He = Se(message)`（`Se` 仍是 `Woe`）、`L = He.trim()`，显示 He，默认编辑初值 `_e?.trim() ?? L`，提交编辑器还会 trim 序列化结果。因此普通分支显示与默认编辑共享最终提取结果，编辑另去首尾空白；不能把所有特化或显式 initialEditMessage 分支说成相同。Ggn 与 wt 的两次提取也意味着 page 正文内再含普通请求标记的边界不能用“只提取一次”概括。

文件提及附件识别来自 `app-initial.sT → $4t`（约2,483,707），后者用 `app-shared.xoe` 导出的 `KLt`（import 为 `xr`）取得请求前缀，识别 `# Files mentioned by the user:` / `# Files pasted by the user:` 及相关 metadata；正文则由 Woe 分离。编辑的 Ooe 保留首个 text 中这一前缀，其余 input 逐项保留，附件展示与原始上下文不能互相替代。显示层可能合并多个 text，但 `jun` 仍只重建首个 text，不能把合并显示文字无条件写回完整 input。所查两大模块没有 `Attached local file` 字面量，Woe 无标记分支也没有通用附件句过滤；没有证据支持仅凭这个句式删除任意独立 text。

本节结论限于上述原字节、函数与普通 local caller。未观察原应用运行态，没有证明所有文本元素、异常包装、各历史来源或特化输入的完整等价，也不据此宣布 1:1 验收完成。核心定位为 `app-shared.Soe` 405,947、`Ooe` 406,599、`koe` 406,777、`Woe` 407,931（字符位置，非源码行号），`user-message.wt` 的 `He=Se(n)` 与编辑代理，及中间 renderer 的 `Pv({message:e,...})`。

manager 调用 `executeTurnStart` 时还单独带回原 `params.attachments`、`params.commentAttachments`、`mcpAppModelContextAttachments`，以及新的 `writingBlockContextPrepared`。图片等既有 input 仍留在 input；附件显示信息和上下文不可只靠纯 prompt 重建。此路径没有提供附件增删表单或独立重新上传步骤，不应将它扩张为未经证据支持的附件编辑能力。

`start-turn.m` 先取得可释放的 `getFollowUpContext(threadId,true)`，加入 writing-block additionalContext；提交前若全局 stale-submission gate 为真则抛 `StaleComposerSubmissionError`，不开始编辑。成功或失败均释放该 context。原 UI 允许有外部附件时发送空 edited text，但仍必须保留附件和原非文本 input。

#### 回退、重新发送与设置

校验与等待 pending thread settings 完成后，原版先完成历史回退，再发送：

| history / capability | 请求 | 本地应用结果 |
|---|---|---|
| paginated 且支持 threadRevert | `thread/revert {threadId,beforeTurnId:target.turnId}` | `applyRevertResponseToConversation` 删除目标及之后的已知回合，更新分页 cursor/session/runtime metadata |
| 其他可编辑 history | `thread/rollback {threadId,numTurns:target及之后非空turnId的回合数}` | `applyRollbackResponseToConversation` 用返回 thread 重新归一历史、清请求、更新 session/path/cwd 等 |
| paginated 但不支持 threadRevert | 无回退请求 | `Aun` 拒绝 Editing messages，不能拿不完整历史猜 numTurns |

回退之后在**同一 threadId** 以 `turnTrigger:'edit_user_message'` 重新发送新 input；cwd 优先回退返回 thread.cwd，再当前 conversation.cwd。request 并未 spread 原 target.params，所以不会无条件重放旧 model/effort/collaborationMode、旧 clientUserMessageId。通用 `wfn` 的 `inheritThreadSettings` 默认 true，读取当前 `latestThreadSettings`、`latestCollaborationMode`、`latestModel`、`latestReasoningEffort`；因此编辑重新发送可使用当前设置。caller bind 的原 model 用于 `ec/Fzs` 查询 serviceTier 的模型提示，不能误当作强制恢复原模型。

当 `shouldSendPermissionOverrides` 为 true 时，在回退前 `config/read {includeLayers:false,cwd}` 读取权限 config；回退后用当前 agentMode/cwd 生成权限，并保留 latestThreadSettings/currentPermissions 的 activePermissionProfile。没有覆盖时让通用 start 路径使用 app-server/default permission 逻辑。serviceTier 由 caller 实时解析并显式传入。不要为了编辑把权限硬设成全访问。

`Bfn` 为重新发送创建新 clientUserMessageId（`request.clientUserMessageId ?? createId()`）；`jun` 未填旧 ID。`Nfn` 将它放入 request；`Rfn` 用 turnId，或 pending turn.params.clientUserMessageId，关联乐观本地回合与接受结果。已观察到 `turn/addUserMessage` 的 duplicate/started/steered admission 处理，但**没有证据证明普通 `turn/start` 的 clientUserMessageId 等于 server userMessage item.id 或提供通用服务端幂等保证**。不能用两者相等作为编辑定位/去重前提。

#### 失败、草稿与恢复范围

原 UI 的中文失败提示为“无法编辑消息”。`SI.zt` 除 `StaleComposerSubmissionError` 外展示该 toast，再抛错；`user-message` 的提交代理捕获失败并保留编辑草稿，只有 callback 完成成功才清除。编辑器提交时 loading/disabled，结束后解除。

历史回退与重新发送是顺序的两个请求，`jun` 没有把它们包成原子事务，也没有在 start 失败时自动补回被回退的历史。回退失败则不执行 start；回退成功、start 失败时，通用 `Hfn` 会移除尚未被接受的空 pending 回合，或记录 failed 回合及错误，结果未知则保留 unconfirmed submission，并继续抛错。它不会凭旧 UI 缓存假称历史已经恢复。

AnyWork 若接入编辑，必须在服务端校验并保留原始输入与附件、区分历史回退/发送阶段、重新获取实际 thread 状态、保留失败草稿。网络结果未知不能直接重复 `rollback + start`，否则可能再次回退真实新回合；普通 start 的幂等仍需单独证明。不能把仅修改浏览器消息文字、把 edited prompt 普通追加、或无条件 fork 当作已完成此原版行为。

关键定位均是同版本 minified 文件第 1 行：`start-turn.m`（完整模块）；`app-initial.jun`（约字符 2,971,735）、manager `editLastUserTurn`（约 3,202,079）、`Bfn/Nfn/Hfn`（约 3,046,931～3,057,550）、`wfn`（约 3,034,469）、`Bin/Vin`、`Aun`；`app-shared.Ooe/koe/Woe` 与 threadRevert 能力表；`local-conversation-thread.SI.zt`（约 370,073）、`local-conversation-turn.Dl` 的 `Ve`。字符位置用于只读核对原提取文件，不是未格式化模块的稳定源码行号。

##### 运行中队列与目标条：截图对应原版契约（2026-11-04）

依据用户提供的截图，只读复核原 ASAR 中 queued-message-list、composer-content、FCc rail、计时 helper 和相关 CSS。没有启动原应用或执行抽取代码。临时副本的静态源码、布局规则和截图观察分别记录；以下不是原应用运行时测量，也不声明 AnyWork 已实现。新补取的四个小成员直接按 ASAR offset/size 读取到临时目录，原包只读。

**默认发送与引导。** use-follow-up-queue-mode 的设置未赋值时回落 queue，旧 interrupt 值迁移为 steer。主 local composer 的 queue eligibility 为 followUp.type=local、queue 偏好开启、canQueueFollowUp=true；有正在编辑的 queued message 时也保留 queue 提交，另有 guarded-turn 强制排队分支。普通 Enter/发送使用当前默认 action，不需要先弹出排队/引导选择框。队列行“引导”的原 Tooltip 是 Submit without interrupting the model；这是不中断当前模型运行的 steer 提交。

原主 composer 的 send/stop 是同一个 action slot 的 submitButtonMode。除其他 surface/policy 特化外，运行中无内容显示 stop，填入内容后变 submit。原式为 `ll!=null || (!isGoalContinuation && isResponseInProgress && (busy || !hasMessageContent)) ? 'stop' : 'submit'`，ll 为 compact surface 的额外 turn target。不能同时把主按钮当作发送和停止。GW 还提供临时反向操作：默认 enter 模式且 local 运行中，Mod+Enter 在默认 queue 下选择 steer，在默认 steer 且允许 queue 时选择 queue；cmdAlways/cmdIfMultiline 使用 Mod+Shift+Enter 这条反向操作。

**队列行。** ze 渲染 `max-h-[30dvh]`、overflow-y-auto 的队列，行间 gap-px；空队列不渲染。Ue 使用共享 FCc.Row，正文单行 line-clamp-1/max-h-lh，附件缩略图为24px，图片圆角和边框。左侧是 queued-message 图标；正在 pending/sending 且非 paused 时换 spinner，行 opacity=.6，并隐藏引导与更多菜单。操作从左到右是引导、删除、更多；引导 disabled 条件包含 isSendNowDisabled 或 submission 已非 queued，删除只在 status=sending 时禁用。更多菜单为 Edit message、可选 Open in side chat、Turn off/on queueing。正文可在溢出或完整文本与摘要不同时打开可复制的完整预览，原延迟700ms，点击支持打开。

队列暂停状态可能显示失败警告；outcome-unknown 特别提示先检查会话，避免不安全自动重试。用户中断会额外出现 Queue paused because you interrupted 与 Resume 行。拖拽仅在未禁用、至少两条、所有 submission 为 null 或 status=queued 时开启，activation distance=6px。以上是状态语义；不能把 sending 删除和 outcome-unknown 重试当作普通 queued 处理。

**共享行尺寸与附着布局。** FCc.Row 外层 px-2.5/py-.5/gap-2，即横向10px、上下2px、主区与操作区间距8px；主区 min-h-token-button-composer，icon与title gap8px；title py-1、leading-5，即上下4px、20px行高；操作区 gap4px、shrink0。原 desktop token=28px，单行最低32px；browser surface token=36px，最低40px。图标使用 icon-2xs，实际由 --icon-secondary-size 控制，原 root=16px（CSS fallback14px不代表最终值）。FCc.IconAction desktop compact、embedded composer 尺寸，均 ghost/uniform；普通文字 Action 为 ghost/default。

rail 横向 inset 是 --home-composer-inline-inset=13px。附着上方的 rail 用 radius-2xl 顶角，1px轮廓与border色80%混色、底部4px tuck与composer重叠；不是上下各自悬浮卡片间留gap。默认 item 背景为 surface-elevated-secondary。embedded surface 用内缩8px的底部分隔，末项分隔铺满。item 高度/透明度动画150ms，队列具体行退出height/opacity动画180ms，reduced motion另处理。默认非Qe surface 顺序是 queue在goal上方；Qe特化会先goal再queue。

**目标行。** goal 非空且 status!='complete' 才渲染完整 hN 行。LeadingIcon 为 goal 靶心类图标；标题包含不收缩的状态文本、ms-1（4px）的截断objective（末尾追加 aria-hidden 的 ` •`）、ms-1.5（6px）的不收缩elapsed/token文本。状态分别为 active=Pursuing goal、paused=Paused goal、blocked=Goal stalled、usageLimited=Goal usage limited、budgetLimited=Goal limited、complete=Goal achieved。

操作顺序固定为 Clear goal（trash）→Pause/Resume goal（pause-circle/play-circle）→Edit goal（expand）。第三项虽然使用展开图标，语义是打开目标编辑器；点击目标正文同样编辑。active 的下一状态为 paused，paused/blocked/usageLimited 的下一状态为 active，budgetLimited/complete 无切换按钮。任一目标请求进行时禁用其余目标操作；clear/status有各自loading。pause是目标状态更改，不能仅换按钮图标。

**计时与预算字段。** bN 接收 goal.timeUsedSeconds、updatedAt（Unix秒）、status、tokensUsed、tokenBudget。active 每1000ms刷新now；elapsedMs=max(0,timeUsedSeconds*1000+now-updatedAt*1000)，其他状态elapsedMs=max(0,timeUsedSeconds*1000)。暂停后不继续加墙钟。active或budgetLimited且tokenBudget非null时，显示Intl compact格式、最多1位小数的 `used / budget`，优先于elapsed；其他状态仍显示elapsed。

twc调用QCc，默认locale='en'，underOneSecond='zero'、trimZeroUnits=true。先floor(max(ms,0)/1000)，小于1秒显示0s；不足1分钟显示整数秒；不足1小时显示分/秒，整分省略0秒；达到1小时则按day/hour/minute/second分解并略全部零单位，单位用Intl.NumberFormat(unitDisplay='narrow')，单位之间空格。因此有 `6h 21m 6s`、`1h`、`1m`、`1d 2s`，不是四舍五入，也不是固定两位 `HH:MM:SS`。原goal调用未传locale，时长默认使用en；token数量则使用当前intl。

本节所有范围为原成员 UTF-8 `[start,end)`；不等同于计时单位或CSS像素。相关静态函数另保存在临时目录 queue-focus-*.txt，证据清单 queue-goal-evidence.json。

| 新补取的原 ASAR 成员 | bytes | SHA-256 |
|---|---:|---|
| webview/assets/thread-goal-summary-status-label-179d08155562.js | 1916 | `e1294ecc75582366d73aeb3c9ecc85ae3cadede9dc26d398ab194cca1e69e61d` |
| webview/assets/use-follow-up-queue-mode-a0800e858d38.js | 720 | `429bc386535a2c1e0eb5ef466dd438677a95836674d5d1fb1a08ccdd1b1cae02` |
| webview/assets/play-circle-f0fed8c10fa8.js | 2243 | `d90b771b58c3b437fac0a647aa251133622415082219c0bdecdbacff7309c0d1` |
| webview/assets/followup-analytics-75ec9d87a275.js | 11947 | `3729e6946a5b15d8c55ac186c85d74a07a029db2639f86adfbf671dc0963eef0` |

| 成员及范围 | 内容 | SHA-256 |
|---|---|---|
| queued-message-list `[4597,8752)` | ze | `c8bb7b464fb1c10a221adc26a89dd2078fa9cd5303fb1d10509fad897ee32cd2` |
| queued-message-list `[8896,19124)` | Ue | `d72a07c34a3d0b8e03d88cee740c5ebfe3cf506ad2ad11a2f111e01dbcabfdfe` |
| queued-message-list `[19273,19916)` | Ke | `1d7adec77583cd962d3730401d1a08c627383e74509368ac277d3baccc6431d1` |
| composer-content `[33436,42389)` | hN | `1f4815fd2cee185718b6773d7872690b156cbac5ee407d83f2e443f7d6c04ef5` |
| composer-content `[42561,42936)` | vN | `7eebb1b884715bd2687918af9e9044f974677882c70503d01c11cbb69de398e0` |
| composer-content `[42936,43430)` | yN | `9dfc21858e9015853f3670a0ff8d0b0f781a1e3df40eded6b18fc72caa415b1a` |
| composer-content `[43430,44459)` | bN | `cf4f3d3c4ef1d4a5436f894152a6f3df966957cac3a096c95407e38afc0fadeb` |
| composer-content `[354047,358037)` | GW | `9e5299ff1c54988a8697d617eac711a338b9aa3a525bb7e2e717ae03d9309572` |
| composer-content `[358037,359874)` | KW | `b342a9fcb9bc8087b533d8296c3961769a0c1daf213d865a6ff7e3fa759ce04f` |
| app-initial `[2913314,2913477)` | hsn | `cb62e45bceaf00a214a1959eabd06c658338165a2a051967830de68c4bfcb56f` |
| app-initial `[10576282,10578904)` | hCc | `fc21313d36d42e3af763dcd35bd36aa30e553fe5bf92dcec8803a6f9f7f4eaae` |
| app-initial `[10578904,10580030)` | gCc | `ee80ee46c6568c80eb07b9191494c9f116655e75caf112171bfa5d4f51bffb54` |
| app-initial `[10581056,10583753)` | SCc | `607e60ff62431ae5589b4ca662764c8ba0db438a54d5dbd9bb8d73d9f94899c5` |
| app-initial `[10583753,10584021)` | CCc | `a291c52e2a38033a5844d21fca2c7419348c8e631288621aaf7e23fcfd0de263` |
| app-initial `[10586839,10587076)` | kCc | `56b36a79ad55c4a53b607c7655c521542bf542acf3ed9b429f40966d36ddd8f7` |
| app-initial `[10587076,10587519)` | ACc | `2ea653c6825b86c2ad378c9d57a7e6729b61c015ae23a13e5f4d618fed6431aa` |
| app-initial `[10598802,10599331)` | QCc | `b862e40b333581c47267ea378f849eac77861b0de6411beecb5c826a92649918` |
| app-initial `[10599331,10599599)` | k9 | `8343900156bf6f6442b20d0059c485b56503ba3ce07ac2a66819007c0d6edd64` |
| app-initial `[10599659,10599747)` | twc | `f2186a665ef9a93c04cacf7118e97e4deb839b707daa62d5b497949403ff5364` |
| b74e19ff7ff4.css `[149236,153587)` | rail CSS | `760f6f5fe842f092259e8528c0a95ffeb38092edb1615915d34f2e62173f452e` |
| composer-content `[471899,471934)` | default queue eligibility | `4de1fb68c69f4ca4f02b82f5b3a792ce89a7708f04eea41260c1bb601e000957` |
| composer-content `[496925,496986)` | default action | `95704577b8798b4b2f47a6cac34e777431a90a97e9fbedf0d996f413bb3a4bae` |
| composer-content `[486603,486695)` | send-stop mode | `7e8d994f17708b900201569f59356424a8bd7327c6ce1c05d1c2bdc1d3091999` |
| composer-content `[530405,531025)` | rail order | `db71f562362fd3f8cc093400f5f2af87518aa273a50de89c9fccec2bb9478570` |

###### 队列“编辑消息”回到主输入框与关闭排队（2026-11-04）

用户进一步澄清：目标surface的更多菜单只保留编辑消息/关闭排队，编辑后回主输入框。原 Ue 的 side-chat 项由 onOpenInSideChatMessage 是否存在控制，是可选caller能力，不能因为打包代码存在它就强制加入此surface。以下只读追踪 ze/Ue → ZU → QU → queued actions，没有运行原应用。

原编辑不是队列行内编辑。ZU 从 QU 获得 handleEditMessage，并将异常交 onError(error,undefined,'queue_edit')。WHn 定义 `beginEdit=remove`、`restoreEdit=restore`；UHn 的 remove 通过 turn coordinator 的 removeQueuedMessage 执行异步队列移除。QU 执行顺序为：

1. 快照主输入框 getPersistedText() 为 s，以及 presentationSuggestionDraft 状态 d。
2. 在带 transitionQueueKey 的 app undo 事务中，先 await beginEdit(messageId)。null 则不修改主框。
3. 等待期间若当前prompt不再等于s，或presentation状态不再等于d，先await restoreEdit(removed)，清除本次移除结果，再返回null；因此不会覆盖用户在等待时的新输入。
4. 通过guard才记 editingMessagePosition，包括messageId、previous/nextMessageId、serverSubmission、serialized context等；增加附件generation，restoreText(message.text)并恢复原队列上下文。提交后清editing position；重新发送保留原queue位置材料。
5. 事务commit后注册原prompt/恢复后prompt的undo关系并focus主框。原主草稿被完整队列消息替换，但其原文本及字段变更快照保留在本次undo事务里；没有发现这里另存一个可自动返回的独立主草稿槽。

QU 的文字恢复调用controller.restoreText，使用原消息text而非预览摘要。附件恢复包括 imageAttachments、兼容单个draft的imageCommentDrafts、appshotContexts、fileAttachments（过滤生成的pasted-text路径与sharedThread）、单独的sharedThread文件归因、pastedTextAttachments（旧file路径可重建）、uploadedFileAttachments、addedFiles、attachmentOrder、selectedTextAttachments、responseTextAnnotations（重建id）、pullRequestMergeConflict、priorConversation。commentAttachments按Du去重合并到当前comments；这不是把所有旧comments无条件覆盖。另恢复MCP模型上下文、usedDictation、worktreeRecovery、messageThreadId、aeonReplyQuote、artifactFollowupAttributions、pullRequestChecks、presentationSuggestionDraft。

undo的顺序是先await restoreEdit回队列，再反向应用附件/字段changes，清editing position，恢复原priorConversation、原prompt s、其他状态及presentation。redo重新beginEdit；消息已不存在时抛Queued message is no longer available。删除操作也使用异步remove及独立undo事务；canRestore=false的条目不会注册可恢复undo，并执行相应附件释放。

失败边界需按证据区分：beginEdit拒绝时尚未覆盖主草稿，null静默退出；guard restoreEdit失败会向上报queue_edit。iv=ZM只是perform成功且shouldCommit后commit，异常时discard undo记录并继续throw，**没有通用自动rollback的finally**。因此不能宣称原版移除后任意恢复异常都会自动把队列放回；实现可增加稳健性，但须标作AnyWork处理。

关闭排队的本地UI回调只写followUpQueueMode='steer'；Ue菜单只调用onQueueingChange(!enabled)，没有clear/remove/start/drain已有条目的动作。renderer adapter后续readFollowUpQueueMode读该偏好，对queue返回queue，其他值返回send-now。此点击本身不清空已有队列，也不把每条现存消息立即引导；已有队列后续仍由coordinator的状态/执行生命周期调度。本次没有据此证明任意host的所有后台调度效果。

| 成员及 UTF-8 范围 | 内容 | SHA-256 |
|---|---|---|
| composer-content `[329918,332391)` | ZU | `e7dcb6e65a4fc6cfca125f263adff757a891347471555b97acac911df8ec95fb` |
| composer-content `[332391,337442)` | QU | `079aa3093236e1de58c35aeb2c4f674e53e39f5a1fc95dbc91b115bbe33eb4ea` |
| app-primary `[2161593,2163342)` | UHn | `b64f8037951aed9c93f8a07f0e911c29098047690b5934731f57c5eb3c20aa00` |
| app-primary `[2164214,2164450)` | WHn | `f6c51580acfc0f00d6c845903c733676758bd9b26ab7f69ab249c75d9f8ab44d` |
| app-initial `[3898299,3898801)` | ZM | `26cdd6fb6cebadbd54b193a6106691ea836a6b38e0a3ade997eb29d21d9d1feb` |
| app-initial `[6155533,6155894)` | Via | `483b4d0c5be4bf7e3a4e248fb4a14f0d55ca93509f8cd422e3f56ec06a87dd4f` |


###### 主输入框 rich 与目标侧栏实现更新（2026-11-05）

本轮已接入主输入框rich schema、原生式输入规则/快捷键、格式/列表/任务/代码/表格、PM文档与Markdown恢复，并区分实际getText和持久化getPersistedText。发送后的用户消息继续按原生正文渲染，不把草稿escaped Markdown冒作display_text。外部会话编辑数据仅按原生clientId关联；无标识不猜。旧版AnyWork纯文本草稿使用兼容恢复，未宣称它与原XX的所有块识别等价。

目标展开使用原活动目标tab，已替代只读详情：保存不关闭、还原、更新时间、快捷键、全局保存期间禁用状态/清除，以及超4000 Unicode scalar的原生文件包装。详细静态来源、成员范围、调用优先级、CSS和剩余边界见 [主rich契约](anywork-rich-composer-contract.md) 与 [目标编辑契约](anywork-goal-editor-contract.md)。上文较早“尚未实现主composer/目标编辑”的进度记录属于其记录日期，不代表当前状态。


###### 队列全文预览、状态与快捷键复核（2026-11-05）

复用已有 ASAR 静态证据，REA 新增限定两个原成员的分析：`ev_607249c0781351f7b6e98f7f50768b0527763660da6f5b8bf9ed4efaf6c37b77`（摘要 `ev_cf62f8b9e01a99e47c60f22f553a51c1c03f0e50be6b08f13005a9e2dab07de9`）。只读解析 queued-message-list 和 tooltip，未执行原应用；没有扩大为全部依赖的完整调用图。原包中与本功能无关的七个 native addon 完整性矛盾继续保留在 REA 限制中，不拿它们推断此 UI。tooltip 成员1836字节，SHA-256 `f938923bbd8728ea2306c9caaf5ec7dec4d10c072ca9ab774f74a72d8d4c62b9`。

**修正此前的剩余差异判断。** 原提交函数 `xG` 对 `editingQueuedMessagePosition` 使用 `x!=null||ye===`queue`?We=`queue`:...`，随后将 `We` 放入 local `queueModeOverride`，并传 `editPosition:x`。因此编辑中的条目即使触发反向快捷键，也保持重新入队及原位置；不能把“编辑态直接引导”当成缺失功能。`GW` 的反向快捷键仅 local 且 response in progress 时生效，依当前排队偏好和可排队能力选动作；编辑态的最终 queue override 仍有效。AnyWork 保留该行为，并修正空闲时误用反向 queue 动作的问题。后续只读复核确认：空输入的 `mp` 发送队首，队尾由独立 `Ld` 取回编辑；此前“发送最后排队项”的描述有误。两项键盘入口现已补齐，详见主富文本契约第13节；主输入历史↑/↓现已按第14节接入，含提交尝试记录、20条/100会话容量、Markdown/JSON恢复及改稿退出；后台/opening prompt的first插入、旧引用lexer全部边界及cmdAlways/cmdIfMultiline设置分支仍未全部接入。

**正文与编辑分离。** `Ue` 正文是可聚焦的 group，label 含一基位置及压缩到80字符的摘要，点击打开全文预览；不调用 `onEditMessage`。只有菜单调用编辑。预览是可选择文本的非模态 dialog，700ms hover、点击与键盘聚焦可打开；完整正文与摘要不同时/缩进代码时始终允许打开，否则仅正文溢出时打开。原 tooltip 默认宽432px、距触发器14px、24px圆角、20px内边距与0.5px边框，按可用视口约束。Tab进入正文，Shift+Tab回触发器，正文末尾Tab走后续操作；Escape返回触发器并关闭。AnyWork 已接入这些基本分支及视口边界、正文独立滚动与选择，不复刻共享tooltip provider完整的指针三角形handoff、全局延迟锁和缩放全部分支；当前正文摘要还未完全接入原版Markdown/附件专用摘要。

**发送状态。** `Ue` 的 sending/pending admission 状态非 paused 时使用spinner、行opacity .6、隐藏引导及更多；sending禁止删除。结果未知的 submission 不属于 queued，因此引导和更多菜单禁用；仍可读全文及删除。AnyWork 的 pending 表示未投递队列，sending 表示已开始投递，uncertain 表示结果未确认；已按对应意义接入视觉/操作和后端状态校验。未知项不能通过旧接口重置成pending或再投递；用户确认对话后仍可删除保存项。当前后端保守地将所有投递错误保存为uncertain，未区分原版明确rejected可重试状态，不宣称失败分类完全等价。

新增范围均是 UTF-8 `[start,end)`；数字不代表源码行或CSS像素。

| 原成员及范围 | 内容 | SHA-256 |
|---|---|---|
| composer-content-96b7e1cbf204.js `[496925,496980)` | 默认动作 | `a3131081361ed7c2b4c2e255fe35a3862ab8b8232a33f434b8216ce485af1c65` |
| composer-content-96b7e1cbf204.js `[379278,379394)` | 编辑态queue override | `d8a5d25f74a64a9efc1b32327715f3cec33c30f16b800a813bc9001deffef7b2` |
| composer-content-96b7e1cbf204.js `[386154,386230)` | local提交editPosition | `a75921049f0cbab9c4e98eb8a63bc8c149f2e68447b1f3b6a7cf91c55b00684d` |
| queued-message-list-1d2a79eb7a09.js `[8896,19137)` | Ue完整行/预览/状态 | `774bd29d006f2f6a3f01fbad92cae970114a353f4520f5b61254e78c54246f6b` |
| tooltip-55ff0d4277f3.js `[240,1705)` | tooltip外观与宽度 | `a1547b71441120d41d8e9073c9e212db6be35459a40ca282b1e0496eca9dc044` |

###### 主 rich 粘贴实现更新（2026-11-05）

已分离主 rich preferredHTML 与历史 PZ candidate 门禁；主 rich 字面粘贴为一个 paragraph 加 hard_break，并保持完整选区 marks。补齐外部段落间距、合法内部 slice marker、空白段落归一、行内代码上下文、MathML/媒体与隐藏元素清理、引用外层 link mark 移除、末尾 table 后段落及光标。目标继续保存持久化 Markdown，消息继续投递独立 actual text。详见 [主富文本契约第8节](anywork-rich-composer-contract.md)，该节列出原版 inline lexer 替代解析、Google Docs 特化、超长 pasted-text 等尚未证明的分支。原安装包与抽取成员 SHA 再次校验一致；未执行原应用。


## 行内链接浮层补充（2026-11-05）

主输入和普通历史编辑共用链接动作：横向“打开链接/编辑文字/编辑链接”，并在同一浮层切换文字或网址输入；空网址移除链接、非法网址保持草稿、两阶段Escape、输入法确认和焦点恢复均已接入。保留格式/链接元数据、library身份、serializeAsUrl及正常撤销历史；通用原包URL图标只作装饰，不进入复制或实际发送。详细只读字节依据、REA分析worker内存耗尽的限制和仍未对齐的provider/thread/选择几何见 `anywork-rich-composer-contract.md` 第15节。本节不将不完整REA语义图或AnyWork浏览器截图声明为原应用运行证据。


## 输入器内会话引用导航补充（2026-11-05）

richLink的严格Codex thread URI现已按原lsc分支跳转本地会话，普通文字链接仍打开编辑浮层。解析、原CL/TNr/wL分发与导出别名证据、REA覆盖限制，以及AnyWork单服务器映射/新Web标签页/草稿和并发保护见富文本契约第16节。只有hostId缺省或local可映射到当前服务器；跨host自动切换、消息正文通用链接和桌面窗口焦点控制不计为已完成。


### 消息正文会话链接补充（2026-11-05）

用户与Agent正文现在保留合法Codex threads地址，按当前服务器原thread_id跳转，支持Enter、中键、平台修饰键和Shift新Web标签页，保留原稿及正文复制地址。正文使用独立通用a9e规则，输入器继续严格tla；用户codex-text包装仍不扩展到Agent正文。review地址能识别但尚未接入原生branch/last-turn审阅面板，点击明确提示并保留草稿；跨host切换、agent提及、HTTP内嵌浏览器与原生窗口焦点仍未完成。函数绑定、正文schema、只读REA证据、适用范围和字节依据见富文本契约第17节。上一节所列“消息正文通用链接未完成”现缩小为此处明确的分支缺口。


### 审阅分屏实现补充（2026-11-05）

上一节review链接的未支持分支已接入独立会话审阅面板，包含branch/last-turn目标文件路由、Web刷新/新页/返回、五类来源与真实Git共同祖先比较。最后一轮仅使用同会话/同轮累计通知，不将冷历史单项diff或工作区Git拼成聚合补丁。原生source controls、initial/primary绑定、worker比较与默认分支证据，以及Pierre视图/commit来源等剩余差距见[富文本契约第18节](anywork-rich-composer-contract.md#18-会话审阅分屏与差异来源)。本节替代上一节对应的当前进度说明，不代表整套1:1已验收。


### 提交来源实现补充（2026-11-05）

审阅来源现已包含commit，通过分支相对共同祖先的最近100条提交子菜单选择，不直接显示整个仓库历史；指定提交比较第一父提交，根提交比较空树，与工作区/暂存区/未跟踪文件隔离。提交选择只在当前审阅面板内保留，不覆盖上次明确常规来源；刷新恢复常规偏好。菜单含完整说明tooltip、时间、选中态、加载/失败重试/空态、键盘子菜单返回、手机适配和迟到取消。REA/AST证据、原包legacy/V2分组差异及剩余差距见[富文本契约第19节](anywork-rich-composer-contract.md#19-提交来源与分支提交子菜单)。第18节与本节替代此前将commit列为全部缺失的当前进度；完整Pierre主题/语法/词级高亮、全文件上下文、评论/搜索与全部原生flyout几何/时序仍未达到1:1。

### 审阅悬停与提示补充（2026-11-05）

提交菜单已增加原静态实现中的200ms鼠标展开、键盘取消悬停、指针与键盘焦点分流，以及与提交行对齐和边缘约束；完整message提示改为保留换行的portal，列表只在标题截断时显示，键盘聚焦立即打开，支持关闭与卸载清理。所选标题的键盘入口及手机覆盖页焦点为Web可访问性适配。队列可选择全文预览独立保留。REA此次app-shared分析耗尽heap，具体行为由独立Babel AST与原字节摘要提供，不宣称该次REA完整解析；证据和provider/RTL/缩放/斜向grace剩余边界见[富文本契约第20节](anywork-rich-composer-contract.md#20-审阅子菜单悬停与提交说明提示)。

### Pierre 正文实现补充（2026-11-05）

审阅正文已由手写表格改为真实Pierre FileDiff，固定依赖1.6.2；原应用的确切依赖版本仍未知。静态提取的Codex Light/Dark主题各含245条语法规则，支持真实词级高亮、主题切换、统一/左右对照、换行、缺少末尾换行标记、原补丁回退和语法资源不可用时的纯文本降级。PWA改为按需缓存语言与可选主题，避免首屏加载整个语法库。REA精确四文件成功解析的范围、独立AST主题提取、字节依据和Web适配见[富文本契约第21节](anywork-rich-composer-contract.md#21-pierre-差异渲染codex-语法主题与按需缓存)。全文件上下文、虚拟化、评论/搜索、全部偏好与原运行态像素对照仍未完成。
