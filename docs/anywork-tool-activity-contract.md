# 会话工具与子 Agent 活动契约

记录日期：2026-11-06。参考为用户提供的 `codex-clipboard-e773d23f-06d0-443c-bdb8-a857387a4fd3.png` 和用户指定的安装包 `/Applications/ChatGPT.app/Contents/Resources/app.asar`。本轮包内身份为 `openai-codex-electron` / `26.1013.40934`，ASAR SHA-256 为 `5ddc4e48259aa6f979e04529b1a5a4ae54b0f5c4ad6db5c6e004924c10916ddb`。它与较早参考契约的包摘要、版本不同；不能把旧包 Evidence 当作本轮的当前包证据。

仅以只读方式解析 ASAR header、成员 offset/size 和 UTF-8 文本，并把所需成员复制到 `/private/tmp/anywork-reference/`。没有运行原应用、执行 bundle、注入进程或修改安装包；临时目录中新旧文件名共存，以本文所列摘要界定本轮证据。

## REA 证据与覆盖范围

- 四个成员分析父 Evidence：`ev_32111d9a28a2f08e0deb8fd999ca5fb40c867fac4d095b6695f719bf85a7a395`；摘要 Evidence：`ev_6bc12ae88a5854ac0dc4920f7891c3387c9a7ad9e92c150317849967cc3e1c96`。选择 `agent-activity-item`、`mcp-tool-activity-label`、`mcp-tool-item-content`、`subagent-row`。
- 实际会话活动渲染模块 `sites-end-resource` 的独立分析父 Evidence：`ev_58d9d1e24362032ae6fe30f34877c43675d919a8d3c80266e810fb03e9f3ba8f`；摘要 Evidence：`ev_273035e3cf42fd5f2a2261705eed379fbfab19bfda10ef2f9cec2ee60f1c34bf`。该成员417582字节，解析1个JavaScript文件、0个parse failure，AST访问130539节点。
- REA 语义图因每文件3000节点/unknown上限而不完整。应用其他成员不在所选分析范围内，不能据此断言不存在其他布局或调用分支。七个与本UI无关的native成员存在包完整性元数据矛盾，REA以record-and-continue保留限制；没有用这些成员推断UI行为。
- 以下函数规则来自对应原成员字节及惰性静态语法阅读。`app-primary` 的布局函数、`app-initial` 的事件投影为补充字节观察，没有声称本轮REA完整语义解析了这两个大型模块。用户截图证明其可见外观分支；任何静态结果均不等同于原应用运行记录。

| ASAR相对成员（均在webview/assets/）     |  字节数 | SHA-256                                                          |
| --------------------------------------- | ------: | ---------------------------------------------------------------- |
| agent-activity-item-52caeab690d6.js     |   22818 | 3db7d74b7fc7348c05187967b9dd2c13877109220aeccc25a3cad4c15af2b882 |
| mcp-tool-activity-label-e8f126d29d57.js |  478514 | d6faa3aeac1f66f7456d797333b7cab9389ffa909a91e840becdf55d1adb0266 |
| mcp-tool-item-content-2a8a0f3f9d98.js   |   61725 | 6d248410107722767ceea789529da7cc447560a31c8ade48a1fef0df6996d6b3 |
| subagent-row-df679decb133.js            |     883 | f03b33b2b3f867df17ed67e8b53469ab0b37b39a5989f2ae8b7561d246a57681 |
| sites-end-resource-8a7a3656de67.js      |  417582 | 9555d47e164354901241b4ce20f8bfc4ca2abbabc7fccf907e0370cab08b6eb1 |
| app-primary-b4ce9e46e8cf.js             | 2435976 | 4d70785315494e1be83d5c4b47ac0a45dcfedde43f2d25ce0f111aedf7ae2350 |

以下为 `sites-end-resource` 的UTF-8半开字节范围，并非源码行号或屏幕坐标：

| 函数 | 范围            | 观察内容                                              |
| ---- | --------------- | ----------------------------------------------------- |
| wv   | [39681,40820)   | 聚合活动的分段类型及首段/后续段文字                   |
| Ev   | [40924,41183)   | provider去重、conjunction格式及integration/source分支 |
| nT   | [202639,204984) | multi-agent折叠标题、计数、动画和展开body             |
| aT   | [205126,205281) | receiverThreads与agentsStates的thread id并集          |
| sT   | [205376,207743) | 按Agent的动作行、创建指令、发送prompt                 |
| uT   | [208150,208322) | 多动作聚合状态优先级                                  |
| dT   | [208322,208848) | Agent名称、角色、可打开条件及模型tooltip              |
| WE   | [254649,256446) | 子Agent消息活动与生命周期行的分支及点击               |

## 布局与顺序

用户截图中的工具调用不是独立卡片流。会话正文与活动组交替出现，活动标题由灰色图标、灰色单行摘要和hover/focus时出现的右箭头构成；展开后箭头转90度。

`app-primary` 的 `GL` 行为 `inline-flex min-w-0 gap-1.5`（6px），垂直居中；`EYe`标题为`inline-flex min-w-0 max-w-full self-start items-center gap-1 p-0 text-start`。图标和文本由内层行的6px间隔连接，标题与disclosure额外间隔4px。文本使用`text-size-chat`，单行ellipsis，色彩为主题secondary/tertiary，hover变主文字；disclosure的点击区覆盖标题且保留内部链接/按钮的指针事件。外层`kYe`是无背景的flex列，通过`padding:offset`对齐正文。这里不添加任意圆角卡片、竖色条或粗体角色标签。

`xYe`箭头默认`opacity-0`，hover、focus-visible或expanded时可见；展开使用`rotate-90`。减少动态效果需要保留。AnyWork使用原生details/summary获得键盘与展开语义，保持上述视觉，而不是直接拷贝原React运行时。

聚合摘要`wv`包含命名MCP来源、未命名工具、loaded tools、文件修改、探索、命令、网页搜索等不同segment；命名provider由`Ev`去重，以语言conjunction连接。包内有“Used {sources} integrations”“read files”“ran commands”等独立片段，不能把它们无间距字符串拼接。AnyWork按首次出现顺序输出中文片段，以中文逗号连接。仅相邻成功完成的exec/MCP/dynamic/webSearch合并，正文、失败、正在运行以及独立子Agent活动保持原序。这个合并范围是当前协议下的实现选择；原包还支持可视化、插件专门标签、外部事件、自动审批等更复杂的分组门禁，未在此宣称全部等价。

## MCP标签与展开内容

原`mcp-tool-activity-label.xa`优先使用特定工具renderer，其次toolDisplay或`openai/toolInvocation/invoking`/`invoked`元数据，再title及provider专门formatter。未知工具最后才由名称生成可读文字。AnyWork已接入可获得的invocation、appContext/provider、toolDisplay及元数据生命周期标签；不会从shell文字猜测读取行为。

原`mcp-tool-item-content.va`把结果分成content blocks、structuredContent、error和无结果；图片最多48spacing高度并支持查看器；文本保留换行；resource_link与resource单独显示。原`Ta`识别唯一、无annotations、内容是JSON对象/数组的text block，避免与structured JSON重复。原raw output入口独立，展开/打开后才构造`{callId, invocation, durationMs, result}`，普通结果不直接显示整个事件对象。

AnyWork保留history/item按需加载与取消/重试，展开后显示真实content block或错误；JSON单文本去重、纯文本、图片、音频、可打开的本地资源/HTTP链接及structured JSON已实现，raw output另有独立disclosure。原包raw使用模态dialog；当前Web使用内联details。这是明确的交互适配差异。未知MCP自定义URI只显示资源引用，不发起伪造文件读取；未知block显示其结构。MCP App iframe/widget、provider专门输出及全部annotations未在本轮完整移植。

## 子Agent调用与活动行

原app-server投影在`app-initial`把`collabAgentToolCall`映射为`multi-agent-action`，带action/status/senderThreadId/receiverThreads/prompt/model/agentsStates，`wait`不进入正文，避免轮询噪声。`subAgentActivity`映射为`subagent-activity`，`kind=interacted`单独标记为消息。

原`A0n`读取agentPath最后一个非root路径段，把下划线/连字符和多余空白转为空格并使用句首大写。`n4n`把started/interacted/interrupted/completed分别转为active/updated/interrupted/completed。`WE`对消息使用普通message图标加“Sent message to …”，父Agent无名时明确使用parent；生命周期使用确定性彩色头像与“name started working/updated/interrupted/finished”。只有opener.canOpen为true时整行才是按钮，点击打开对应子会话，不能把全部行都导航为主会话。

`nT`是multi-agent动作摘要，展开后`sT`按Agent显示动作和名称；创建可附instructions，发送可附prompt；`dT`附非default角色及模型tooltip。receiverThreads与agentsStates按thread ID合并，同名不合并。AnyWork已接入这些原始字段；Agent名称不可得时用Agent，始终保留真实thread ID作导航身份，不从显示文字反推ID。正文头像与Subagents面板共用同一个`SubagentAvatar`及seed映射。

AnyWork的`ActivityNavigationContext`由主界面提供可打开条件与打开方法，保证点击进入当前会话的子Agent面板。活动行自身不发送消息、不创建新执行进程、不通过名字查找或伪造子会话。

## 验证与剩余范围

`web/src/toolPresentation.test.ts`包含相邻分组、prose隔断、live/error分离、provider去重和参数不进入摘要、声明标签、同名Agent身份、路径名称、structured JSON去重、错误和command output检查。`e2e/tool-activity.spec.ts`在隔离fixture中拦截所有API，对任何非heartbeat POST直接失败，验证桌面与移动视口下的聚合摘要、history详情只在展开时加载、JSON无重复、子Agent完成/发送活动、动作展开、错误展示、flat样式与横向不溢出。

验证通过描述仅适用于AnyWork的fixture，不代表原应用运行态或真实provider端到端行为。原包所有provider定制文本、MCP App/widget、工作过程全部自动折叠时序、动画滚动锚定、全部附件annotation、原raw dialog及真实账号对应显示偏好仍是剩余差距，不能把这一轮称作全量1:1验收。

2026-11-06 本轮实测：TypeScript typecheck通过；工具与transcript专项16条Vitest通过；使用本机已安装Chrome、隔离网页构建与fixture Server的6条Playwright通过（desktop/android-web各覆盖新工具活动、既有历史分页/懒加载、既有工作过程平面分组）。默认Playwright headless缓存不存在，因此没有下载浏览器，改用`PLAYWRIGHT_CHANNEL=chrome`。截图存于`/private/tmp/anywork-tool-activity-desktop.png`及`/private/tmp/anywork-tool-activity-android-web.png`，均为AnyWork fixture，不含真实会话数据。
