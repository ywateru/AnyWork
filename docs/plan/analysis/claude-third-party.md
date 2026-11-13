# Claude 会话第三方实现：历史、恢复、转交与原进程边界

调查日期：2026-11-13。范围限定为 Happy、Hapi、claude-code-ui 三个实际项目，另核查与本机注册表直接相关的 cc-peer。已阅读 [接入契约](../../claude-integration.md) 与 [既有 Claude 分析](claude.md)。本报告只增加研究证据，不修改适配器、原生 Claude、账号设置或用户历史。

## 结论与实现选择

1. **读取历史、按 ID 恢复、分叉都有具体第三方源码。** claude-code-ui 最直接展示 JSONL 索引、历史解析、SDK `resume` 与 SDK `forkSession`。Happy/Hapi 展示包装器拥有执行进程后，如何同步终端历史、转发远程消息、处理权限与切换执行模式。
2. **这些项目的“接管”不能证明事后加入任意原生 Desktop 执行器。** Happy/Hapi 的本地→远程切换会停止自己启动的本地子进程，再以原会话 ID 恢复到新的远程执行流。claude-code-ui 的运行控制属于其 SDK Query。远程客户端连接的是包装器的服务/RPC。
3. **存在向原活进程通信的第三方 peer 实现，但它是 mailbox 协议。** cc-peer 能投递消息、接收定向回复/送达回执、订阅空闲通知；另定义 artifact reply 的有限交接。没有 SDK stdin 的初始化、权限答复、模型切换、取消控制接口，也没有原会话全量事件订阅。不能把 peer socket 描述成完整 attach。
4. **截图目标已精确定位，原进程与 mailbox 均有只读证据。** “用户指定的截图会话”属于 `Claude-3p` profile，Desktop ID、CLI ID、注册表 `hostSessionId` 能对上；这仍不足以宣布 Desktop 原生控制验收通过。
5. **Desktop 下一步是正常 renderer 中的固定手动桥验收。** 先验证 LocalSessions 只读调用、事件订阅、outgoing loopback 连接，再验证原生写入。已有隔离 DevTools 实验被 self-XSS 粘贴防护阻挡，尚未执行桥；本报告不提供绕过方法。没有找到三项目或 cc-peer 提供已核实的 Desktop 原生 attach 方案。

| 机制 | 历史身份 | 执行进程/控制所有者 | 是否加入原 Desktop 活进程 |
| --- | --- | --- | --- |
| JSONL 发现、读取 | 原 CLI UUID | 不启动执行器 | 否，只读记录 |
| SDK/CLI `resume` | 通常沿用 UUID | 新启动的 Query/CLI | 否；活跃原会话不能据此开第二 writer |
| fork | 新 UUID，保留来源关系 | 新会话/后续新执行器 | 否 |
| Happy/Hapi relay | 包装器的会话映射 | 包装器自己启动的 CLI、SDK 或 hook | 不能推广到任意 Desktop；本地→远程通常切进程 |
| cc-peer mailbox | 接收者仍为原会话 | 原进程处理 peer message，第三方仅为另一个 peer | 可向原进程投递；没有完整控制权证明 |
| 官方 Remote Control | 原会话 | 原引擎 + Anthropic 服务路由 | 官方提供的继续操作通道；不是 AnyWork 的本地 socket API |
| Desktop LocalSessions 固定桥 | 原 `local_*` ID | Desktop 主进程继续拥有原 CLI | 设计方向可保持所有者；入口/运行验收未完成 |

## 固定来源与许可证

所有源码链接固定到本次取得的提交，未使用浮动 README 作为实现证据。Happy/Hapi 的大型浅克隆下载较慢，因此补用 GitHub commit/tree API 与该 SHA 的 raw 文件读取；两者随后克隆完成，HEAD 与 API 相符。claude-code-ui 与 cc-peer 同样核对了浅克隆 HEAD。三个项目的 CLI/server 源码目录搜索 `messagingSocketPath`、`peerProtocol`、`claude.web`、`LocalSessions`、`yield_artifact_replies` 均未命中；结论结合下文实际执行调用链。没有安装或运行这些项目。

| 项目 | 固定提交 | 实际核对的许可证 | 主要用途 |
| --- | --- | --- | --- |
| [slopus/happy](https://github.com/slopus/happy/tree/7452f3321fd7c5da6850f4dd4d7e53c0164b064d) | `7452f3321fd7c5da6850f4dd4d7e53c0164b064d` | [根 LICENSE：MIT](https://github.com/slopus/happy/blob/7452f3321fd7c5da6850f4dd4d7e53c0164b064d/LICENSE) | 包装器拥有的终端/远程模式交接 |
| [tiann/hapi](https://github.com/tiann/hapi/tree/6ea40f9e44679042ea4a590fc3973fb0a5c33843) | `6ea40f9e44679042ea4a590fc3973fb0a5c33843` | [cli/package.json：AGPL-3.0-only](https://github.com/tiann/hapi/blob/6ea40f9e44679042ea4a590fc3973fb0a5c33843/cli/package.json#L6)，根/cli 均有 AGPLv3 LICENSE | 自有 stream-json transport、fork、预装权限 hook |
| [siteboon/claudecodeui](https://github.com/siteboon/claudecodeui/tree/0d94dcc616acbb6b307dec11d8245d9b785bcb78) | `0d94dcc616acbb6b307dec11d8245d9b785bcb78` | [package.json：AGPL-3.0-or-later](https://github.com/siteboon/claudecodeui/blob/0d94dcc616acbb6b307dec11d8245d9b785bcb78/package.json#L170)，根 LICENSE 为 AGPLv3 | 被动索引、历史、SDK resume/fork |
| [ExaDev/cc-peer](https://github.com/ExaDev/cc-peer/tree/436c641aae3611d45c21f90914809664b07f8054) | `436c641aae3611d45c21f90914809664b07f8054` | [LICENSE：MIT](https://github.com/ExaDev/cc-peer/blob/436c641aae3611d45c21f90914809664b07f8054/LICENSE) | 非官方跨会话 mailbox/idle 协议 |

本次没有复制第三方实现代码。后续实现应优先使用官方 SDK/公开 CLI 协议；AGPL 项目的具体代码复用需按其许可证处理，不能当作 MIT 样例直接移入。

## Happy：终端镜像与切进程恢复

调用链均在 `packages/happy-cli/src/`：

- [`claude/utils/sessionScanner.ts` → `createSessionScanner`](https://github.com/slopus/happy/blob/7452f3321fd7c5da6850f4dd4d7e53c0164b064d/packages/happy-cli/src/claude/utils/sessionScanner.ts#L27)：按工作目录与 session ID 定位 JSONL，建立文件 watcher，跟踪新发现的 session；`readFile` 解析 transcript。`claudeLocalLauncher` 将本地 transcript 消息送至其 session client。这是历史/实时文件镜像，不是向原进程写 stdin。
- [`claude/claudeLocal.ts` → `claudeLocal`](https://github.com/slopus/happy/blob/7452f3321fd7c5da6850f4dd4d7e53c0164b064d/packages/happy-cli/src/claude/claudeLocal.ts#L310)：用 `crossSpawn` 启动自己的 Claude，继承终端 stdio，并传入自己的 AbortSignal。启动参数可添加 `--resume <UUID>`。不是查找外部 PID 后复用其 stdio。
- [`claude/claudeLocalLauncher.ts` → `doSwitch` / `doAbort`](https://github.com/slopus/happy/blob/7452f3321fd7c5da6850f4dd4d7e53c0164b064d/packages/happy-cli/src/claude/claudeLocalLauncher.ts#L75)：远程消息入队触发 `doSwitch()`，调用本地进程的 `AbortController.abort()`；launcher 退出后由 [`claude/loop.ts` → `loop`](https://github.com/slopus/happy/blob/7452f3321fd7c5da6850f4dd4d7e53c0164b064d/packages/happy-cli/src/claude/loop.ts) 切到 `claudeRemoteLauncher`。
- [`claude/claudeRemote.ts` → `claudeRemote`](https://github.com/slopus/happy/blob/7452f3321fd7c5da6850f4dd4d7e53c0164b064d/packages/happy-cli/src/claude/claudeRemote.ts#L131)：设置 `resume: startFrom`，随后 `query()`；[`claude/sdk/query.ts` → `query`](https://github.com/slopus/happy/blob/7452f3321fd7c5da6850f4dd4d7e53c0164b064d/packages/happy-cli/src/claude/sdk/query.ts) 映射至官方 `@anthropic-ai/claude-agent-sdk` 的 `sdkQuery`，包含 `resume`、model、permissionMode、abortController、canUseTool。
- [`api/apiSession.ts` → `ApiSessionClient`](https://github.com/slopus/happy/blob/7452f3321fd7c5da6850f4dd4d7e53c0164b064d/packages/happy-cli/src/api/apiSession.ts#L294)：Socket.IO `rpc-request` 交给自身 `RpcHandlerManager`；`update/new-message` 解密后交给自身消息队列。它是 Happy relay 的通信路径，不是 Anthropic Desktop IPC。

可借鉴：用 SessionStart 信息确认 UUID、把被动 transcript 观察与 writer 分开、显式模式交接。不能沿用其“停止旧子进程再恢复”的行为去接管用户原来的 Desktop；包装器拥有旧子进程是该设计的重要前提。

## Hapi：自有 transport、fork 与预装 TUI 权限桥

调用链均在 `cli/src/`：

- [`claude/claudeLocal.ts` → `claudeLocal`](https://github.com/tiann/hapi/blob/6ea40f9e44679042ea4a590fc3973fb0a5c33843/cli/src/claude/claudeLocal.ts#L134) 使用 `spawnWithTerminalGuard` 启动自己的本地 Claude，传 cwd、hook settings 与 AbortSignal。
- [`modules/common/launcher/BaseLocalLauncher.ts` → `BaseLocalLauncher.run`](https://github.com/tiann/hapi/blob/6ea40f9e44679042ea4a590fc3973fb0a5c33843/cli/src/modules/common/launcher/BaseLocalLauncher.ts#L72)：注册 abort/switch；队列收到消息即 `doSwitch`；标记 switch 并 abort 自己的 local launch。`claude/loop.ts` 以同一个 Session 在 local/remote launcher 间调度。
- [`claude/sdk/query.ts` → `query`](https://github.com/tiann/hapi/blob/6ea40f9e44679042ea4a590fc3973fb0a5c33843/cli/src/claude/sdk/query.ts#L371)：这里是项目自有实现，不能泛称“只调用官方 SDK”。第 424/425 行添加 `--resume` / `--fork-session`；第 445 行使用 stream-json 输入；第 468 行 `spawn(...)`，独立 stdin/stdout/stderr pipe。`Query.readMessages` 路由 `control_response`、`control_request`；`Query.interrupt` 第 174 行经自己的 `childStdin` 发控制请求。控制能力来自它拥有 pipe，而非 session UUID 本身。
- [`claude/claudeRemote.ts` → `claudeRemote`](https://github.com/tiann/hapi/blob/6ea40f9e44679042ea4a590fc3973fb0a5c33843/cli/src/claude/claudeRemote.ts#L326)：设置 `resume`、`forkSession`，调用上述 `query`；fork 的新身份由后续原生初始化/SessionStart hook 确认。这是新执行器/新分支，不能作为原 PID attach 的证据。
- [`claude/utils/sessionScanner.ts` → `createSessionScanner`](https://github.com/tiann/hapi/blob/6ea40f9e44679042ea4a590fc3973fb0a5c33843/cli/src/claude/utils/sessionScanner.ts) 观察 transcript；[`api/apiSession.ts` → `ApiSessionClient`](https://github.com/tiann/hapi/blob/6ea40f9e44679042ea4a590fc3973fb0a5c33843/cli/src/api/apiSession.ts#L382) 处理自己的 `rpc-request`。hub 的 [`socket/handlers/cli/rpcHandlers.ts` → `registerRpcHandlers`](https://github.com/tiann/hapi/blob/6ea40f9e44679042ea4a590fc3973fb0a5c33843/hub/src/socket/handlers/cli/rpcHandlers.ts) 注册 CLI 暴露的方法。

额外有价值的机制是 [`claude/utils/localPermissionBridge.ts` → `LocalPermissionBridge`](https://github.com/tiann/hapi/blob/6ea40f9e44679042ea4a590fc3973fb0a5c33843/cli/src/claude/utils/localPermissionBridge.ts#L49)：`request` 等待 PermissionRequest hook，`respond` 接收远程明确答复，`onHook` / `onTranscript` 撤销过期请求；代码明确说明本地原生对话框与 hook 会竞争，发出 verdict 不代表赢得决定权。[`localPermissionProtocol.ts`](https://github.com/tiann/hapi/blob/6ea40f9e44679042ea4a590fc3973fb0a5c33843/cli/src/claude/utils/localPermissionProtocol.ts) 规定无决定意味着保留 Claude 原生权限流程，不是 allow。

该桥在 [`claudeLocalLauncher.ts`](https://github.com/tiann/hapi/blob/6ea40f9e44679042ea4a590fc3973fb0a5c33843/cli/src/claude/claudeLocalLauncher.ts#L80) 启动时激活，并把 `session.localHookSettingsPath` 传给自己启动的 Claude。它证明“事先包装的 TUI 可保留本地权限对话框，同时接收远程审批”，不证明能不改配置地加入已运行的原生 Desktop；本报告未向目标 session 安装任何 hook。

## claude-code-ui：历史索引、SDK 恢复与分叉

源码根路径：`server/modules/providers/list/claude/`。

- [`claude-session-synchronizer.provider.ts` → `ClaudeSessionSynchronizer.synchronize` / `synchronizeFile`](https://github.com/siteboon/claudecodeui/blob/0d94dcc616acbb6b307dec11d8245d9b785bcb78/server/modules/providers/list/claude/claude-session-synchronizer.provider.ts#L24)：扫描 `~/.claude/projects/**/*.jsonl`，用 `history.jsonl` 的 sessionId/display 补标题，从 transcript 取 sessionId/cwd，保存自己的 DB 索引。明确排除 `subagents` 与 `tool-results`，避免重复 parent sessionId 覆盖主历史路径。
- [`claude-sessions.provider.ts` → `readTranscriptRows`、`getSessionMessages`、`ClaudeSessionsProvider.fetchHistory`](https://github.com/siteboon/claudecodeui/blob/0d94dcc616acbb6b307dec11d8245d9b785bcb78/server/modules/providers/list/claude/claude-sessions.provider.ts#L479)：通过文件流读取 transcript，构造可见历史；不是向原 CLI 查询活状态。
- [`claude-runtime.provider.ts` → `queryClaudeSDK`](https://github.com/siteboon/claudecodeui/blob/0d94dcc616acbb6b307dec11d8245d9b785bcb78/server/modules/providers/list/claude/claude-runtime.provider.ts#L1152)：构建 SDK options 时第 454 行 `sdkOptions.resume = providerSessionId`；第 1520 行以 held async prompt stream 调用 `createQuery`（默认官方 `query`）。`canUseTool` 将权限请求发到自己的 WebSocket，再等待明确 allow/deny。`abortClaudeSDKSession` 第 1878 行只中断自己 active map 中的 Query。
- [`claude-fork.provider.ts` → `ClaudeForkProvider.forkSession`](https://github.com/siteboon/claudecodeui/blob/0d94dcc616acbb6b307dec11d8245d9b785bcb78/server/modules/providers/list/claude/claude-fork.provider.ts#L16)：调用官方 SDK `forkSession(providerSessionId, {dir, upToMessageId, title})`，取新 sessionId，再 stat 新 JSONL。源码说明 SDK 负责 UUID 与 parentUuid 重写。不是让两个 UI 同时写原执行器。
- 同文件的 `reconnectSessionWriter` 是为其已经持有的 SDK session 重新绑定客户端输出。这个命名中的 reconnect 不表示连接任意外部 Claude PID。

可直接采用的设计是“被动索引 → 原生身份 → 显式受控恢复”的分层，以及排除 subagent 文件的规则。项目也有历史编辑/重跑逻辑，本轮仅调查没有复制，不能据此授权改写用户原 JSONL。

## peer registry/socket：有实际第三方实现，但不是通用控制 socket

固定来源：cc-peer [`README.md`](https://github.com/ExaDev/cc-peer/blob/436c641aae3611d45c21f90914809664b07f8054/README.md)、[`docs/PROTOCOL.md`](https://github.com/ExaDev/cc-peer/blob/436c641aae3611d45c21f90914809664b07f8054/docs/PROTOCOL.md)。作者声明 reverse-engineered，验证版本为 Claude Code **2.1.269**。本机 CLI 为 2.1.323，目标 Desktop 子进程注册版本为 2.1.321，因此源码的 live verification 是作者证据，不能当作本机兼容性通过。

| 字段/接口 | 精确源码 | 可以证明的语义 |
| --- | --- | --- |
| `~/.claude/sessions/<pid>.json` | [`src/adapters/node/fs-registry-store.ts` → `FsRegistryStore.list/read`](https://github.com/ExaDev/cc-peer/blob/436c641aae3611d45c21f90914809664b07f8054/src/adapters/node/fs-registry-store.ts)；[`src/schemas/registry.ts` → `RegistryEntrySchema`](https://github.com/ExaDev/cc-peer/blob/436c641aae3611d45c21f90914809664b07f8054/src/schemas/registry.ts#L26) | PID、sessionId、cwd、procStart、pidDomain、socket、版本、peer 功能等注册信息。不是历史记录 API |
| `messagingSocketPath` | [`src/domain/roster.ts` → `checkEntry`](https://github.com/ExaDev/cc-peer/blob/436c641aae3611d45c21f90914809664b07f8054/src/domain/roster.ts#L37) | 先验证 PID 存活与 procStart，另做 socket connect probe。**`roster()` 并非纯文件读取**，本轮未执行 |
| `peerProtocol:1` / `peerFeatures` | `src/schemas/registry.ts` | `notify_idle`、`reply_across_default_dirs`、`artifact_yield`；不代表 stdin stream-json 版本或完整运行时控制能力 |
| 活会话消息 | [`src/cc-peer.ts` → `CcPeer.send`](https://github.com/ExaDev/cc-peer/blob/436c641aae3611d45c21f90914809664b07f8054/src/cc-peer.ts#L209)；[`src/schemas/wire.ts` → `UserFrameSchema`](https://github.com/ExaDev/cc-peer/blob/436c641aae3611d45c21f90914809664b07f8054/src/schemas/wire.ts#L44) | peer 信封内正文，type=user，priority=next/later。它使原会话收到外部消息，不建立完整 UI writer 连接 |
| 回执/空闲 | `src/schemas/wire.ts` → `PeerMessageStatusSchema` 第 80 行、`NotifyWhenIdleSchema` 第 101 行、`PeerIdleNoticeSchema` 第 117 行；`CcPeer.subscribeIdle` 第 284 行 | held/delivered/denied/expired/dropped 与 idle/exited；不能用 idle 推断已获得 writer。作者文档还说明直接投递成功不一定产生回执 |
| `artifact_yield` | [`src/schemas/wire.ts` → `YieldArtifactRepliesSchema` 等](https://github.com/ExaDev/cc-peer/blob/436c641aae3611d45c21f90914809664b07f8054/src/schemas/wire.ts#L138) | 同会话特定 artifact slugs 的 reply generation 交接，reason resume/claim；不是一般 session claim、stdin handoff、工具审批或模型控制 |

`ControlFrameSchema`（wire.ts 第 192 行）的 union 仅包括 peer message status、idle 以及 artifact replies yield/unyield。虽然名称包含 `control`，它与 SDK 的 `control_request {request:{subtype:...}}` 不是同一控制协议。`CcPeer` 的公开主要方法为 create/start/roster/send/subscribeIdle/stop，没有 `interrupt`、`setModel`、`respondToToolPermission`、读取全 transcript 或订阅所有模型/工具输出的方法。模型可能自行回复某条 peer 消息，不等于 UI 已完整捕获该会话输出。

还有两个不能忽略的实现边界：

- `CcPeer.create()` 会启动监听、写自己的 key/registry 并维持 heartbeat，不是无副作用的 discovery。传输有本地鉴权与进程身份验证；本报告只读了源码及注册表普通元数据，未读取 key/token、连接 socket、创建 peer、发送消息或伪造身份。
- `CcPeer.send` 第 237–238 行在未指定 fromMode 时默认声明 **bypass**；`subscribeIdle` 第 304 行同样写 bypass。README 的 consent 描述不能代替检查该默认值。若以后做独立授权实验，应保留接收端审核与真实权限语义；本轮不采用该默认实现。artifact yield 的同会话检查也不能被解释为允许伪造注册项来获取控制。

官方文档核对范围：[Remote Control](https://code.claude.com/docs/en/remote-control)、[Desktop](https://code.claude.com/docs/en/desktop)、[Agent teams](https://code.claude.com/docs/en/agent-teams)，本日实际读取 HTML；三页均未出现 `messagingSocketPath` / `peerProtocol` / `peerFeatures`。这只能支持“本次检查的文档没有公开这些字段”，不声称穷尽全部厂商文档。已核实的第三方 peer 是非官方 mailbox 实现，未找到受支持的通用 local attach API。

## 截图 Desktop 会话：身份与已完成的只读确认

目标标题：**用户指定的截图会话**。不是默认 `Application Support/Claude` 下的 Code profile，而是 `Claude-3p`。

- 原生 metadata：`/Users/<user>/Library/Application Support/Claude-3p/claude-code-sessions/<accountUuid>/<orgUuid>/local_<desktop-session-uuid>.json`。
- Desktop ID：`local_<desktop-session-uuid>`；`cliSessionId`：`<cli-session-uuid>`；cwd/originCwd：`/Users/<user>`；isArchived=false。没有据持久 metadata 的缺失 running 字段判断空闲。
- 注册表：`~/.claude/sessions/<native-pid>.json` 的 `sessionId` 为上述 CLI UUID，`hostSessionId` 为上述 Desktop ID，entrypoint=`claude-desktop-3p`，kind=interactive，version=2.1.321，采样 status=idle，peerProtocol=1，三项 peerFeatures 齐全。
- 本报告独立读取了上述 metadata/registry 的精选字段，并 stat 确认注册 socket 是 Unix socket，原 JSONL `~/.claude/projects/<encoded-project-path>/<cli-session-uuid>.jsonl` 存在。未读目标 transcript 正文。
- 同轮 Desktop 调查者 Bacon 另已确认 PID `<native-pid>` 经 disclaimer 父进程 `<helper-pid>` 隶属 Desktop `<desktop-pid>`，lsof 显示原 PID 持有 `/tmp/cc-socks/<native-pid>.sock`；这些进程归属细节是其只读调查结果，本报告没有另行运行进程控制。

这条映射使 AnyWork 可将目标精确显示为 Desktop Code 历史，并检测原会话仍有原生 owner。不能因有 CLI UUID 就将其当成可以安全 `resume` 的已关闭会话；采样 status=idle 也不表示原 owner 已退出。没有运行 `--resume`、创建分叉或向该会话发送提示。

## Desktop 原生验收的具体剩余工作

现有分析已定位 `window["claude.web"].LocalSessions` 原生 preload：getSessionList、getSession、getTranscriptTail/Page、sendMessage、interrupt、respondToToolPermission、setModel 等。这是能维持 Desktop 所有权的候选边界；本报告不把静态方法存在等同于可调用。

**当前障碍是 renderer 承载入口，不是缺少第三方 JSONL/SDK 样例。** 同轮隔离运行结果：未修改的原包副本能打开正常 DevTools，但粘贴被 self-XSS 防护拦截；probe 未执行，因而 preload 可用性、原生只读调用与 WS CSP 均未验收。普通 CDP startup 参数另受厂商签名限制，不能用这些第三方项目替代授权。

后续验收按下面的停止条件进行，不向原会话发提示来“探活”：

1. **合法入口**：在用户自己正常打开且策略允许的 Code renderer 中，由用户审阅并按厂商正常方式执行固定桥。若 DevTools/self-XSS/组织策略不允许执行，停在“需要手动桥入口”；不改安全偏好、不发送绕过快捷键、不伪造 CDP 授权，也不改包。不能将本机已有候选 snippet 称为已连接。
2. **先验证 preload/IPC**：只检查 LocalSessions 方法类型，调用 getSessionList；getSession 精确匹配上述 Desktop ID、CLI ID、cwd，过滤 remote/SSH/WSL/cloud。未知 ID 应返回空/错误，不能创建或恢复执行器。只读历史须保持分页与身份，元数据查询不打印正文。
3. **再验证事件与承载**：订阅事件/权限监听并立即取消，确认有可撤销 listener；用服务专用随机有限作用域令牌向 loopback 发起 outgoing WS，验证首帧认证、来源检查、固定方法白名单与 generation。若 CSP 阻断，记录 blocked，不推断能放行。桥断开不应结束 Desktop。
4. **最后单独验收写入**：前面三项通过后，才对隔离新测试会话验证发送、审批、取消与模型变更，证明仍由 Desktop 主进程执行。目标截图会话继续保持只读，除非用户明确授权其写入。pending 权限只接受原请求与明确决定；重连事件有缺口先读快照，不重复发送未知结果。

Desktop 调查者另报告：实际 `Claude-3p/developer_settings.json` 不存在，原应用正常 DevTools 未打开，本轮未改设置；原主进程 argv 无开关，不能把 profile 名称推断为通过 `--third-party` 启动。原应用与隔离副本的 DevTools 状态必须分开记录。

同轮 Desktop 固定桥代码提交为 `ba0cdd0`，目标 metadata/限制补充为 `a25d527`；报告位于其 worktree 的 `docs/plan/analysis/claude-desktop.md`，由主编排合并后查看。旧 `<private-probe-dir>/` 只读 probe 曾用于源码检查；最新人工验收材料在 `<private-handoff-dir>/`。桥 snippet 含有限作用域本地令牌，不应打印或提交其内容。本报告未读取最新 snippet；调查者确认 broker 尚未握手、未生成 host descriptor。这些材料不是已成功执行的证据，人工步骤由主编排统一安排。完整 native 验收结果应写回独立 Desktop 调查；本报告的第三方证据可以先独立合入。

官方 [Remote Control](https://code.claude.com/docs/en/remote-control) 明确本机引擎只发 outbound HTTPS，在 Anthropic API 注册并轮询工作，服务将 web/mobile 与本地执行器连接；未提供让这些项目直接加入其 relay 的通用本地 API。官方 [Desktop 交接](https://code.claude.com/docs/en/desktop) 的 `/desktop` 保存后退出 CLI，`claude --desktop --resume <id>` 打开 Desktop 后命令退出，且不移动仍在别处打开/后台运行的会话；Desktop `/resume` 指导先关闭终端会话。这些是可用的官方替代交接机制，不能用作 AnyWork 已取得目标原进程控制权的证明。

## 交付与验证记录

本次完成源码路径/函数/固定提交/许可证交叉核查、目标 metadata 与注册表身份交叉核查、官方三页当前文档读取。所有第三方结论为静态源码审查；没有运行第三方服务、真实模型、peer SDK 或任何原生写入。报告没有记录凭据、socket 鉴权文件内容或目标会话正文。

可立即用于实现的决定：被动历史采用 JSONL/metadata 索引；关闭会话的显式恢复采用官方 SDK/CLI；只对自己持有的 Query 做权限/取消控制；活 Desktop 保留原生所有者并等待固定桥原生验收。peer messaging 如后续单独实现，只能标明实验性跨会话投递能力，不能替代 Desktop 完整控制能力。
