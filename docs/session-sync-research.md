# 普通 Codex 会话同步调研

## 2026-11-05：原桌面热加入已验证

已通过原应用现有 owner/follower IPC 接通正在执行的桌面会话。在线 AnyWork 发出的单次引导进入原回合，并在本桌面对话中收到；原会话、回合、开场输入、模型、强度和观察到的原进程均保持。仅重启 AnyWork 后，持久化入口配置也能恢复连接。此前“原桌面未连接”的结论仅反映早期阶段。原生队列、原桌面审批/停止/下一回合及完整工具继承仍需专项验收，参见 [桌面适配说明](desktop-adapter.md) 和 [分层验证](desktop-host-tests.md)。

## 2026-11-05：桌面协作早期调研结论

后续深入调研与真实独立引擎的九项双客户端协议检查见[桌面与 AnyWork 共用执行引擎](desktop-collaboration.md)。原包中已找到直接 Unix WebSocket 地址覆盖，标准客户端连接该地址的实测也通过；但原桌面 UI、工具宿主和完整配置继承尚未运行验收。单设 local-daemon 开关不保证选中共享路径，官方 proxy 是原始字节转发，也不是现成 JSONL/WebSocket 适配器。当前 AnyWork 私有 SQLite 队列尚未迁移至已验证的原生共享队列；不能把历史可见或独立协议成功等同于桌面无缝切换已经交付。

## 2026-11-05：全部历史与执行进程分离

结论：AnyWork 应把“会话发现与历史读取”作为独立服务，再把控制请求路由到实际持有该 thread 的执行引擎。独立进程没有共享入口时，仍应加载它的持久化记录。为展示历史而恢复线程，会引入写锁冲突，也会把可读历史错误地呈现为不可访问。

本轮已实现：

- 持久化 app-server 索引与现有共享 daemon 索引分别完整分页，再按原 thread ID 合并；共享索引提供其实际知道的运行状态。一个索引不再遮蔽另一个来源。
- 两个索引都查询普通/归档及完整来源/provider 过滤。持久化扫描失败而共享查询成功时，保留之前发现的历史，并返回部分发现错误；不删除独立进程历史。
- 新增 `--codex-scope all` / `ANYWORK_CODEX_SCOPE=all`，发现当前 CODEX_HOME 中所有本机项目，不受新建会话默认工作区限制。默认 `workspace` 保留原有受限部署行为；该选择通过 `/api/info.codex_scope` 可检查。
- `all` 范围保留 cwd 已被删除的历史；历史读取仍可用，文件/执行操作因目录不存在而失败。每条会话的文件读取仍以该会话 cwd 为边界，并不因全项目发现而变成任意路径读取；全项目模式的原生会话审阅按实际 Git 仓库根目录读取差异，新建自管会话仍受配置 workspace 限制。
- 外部会话的 GET models/composer 不调用 `thread/resume` 或取得写锁。未连接的 composer 返回真实可得元数据和 `settings_available:false`，未知设置保持未知；归档可读。
- POST connect 对暂不可控的外部会话返回 HTTP 200 和 `{connected:false,mode:"history",reason}`，明确这是已加载历史的观察状态。Web 继续刷新历史，连接重试最多每30秒一次；历史更新仍约5秒一次。只有 connected 为 true 才轮询控制通知。
- 初次会话对象尚未加载时不请求 models，避免尚未确定外部属性就调用不适用接口。
- Markdown 的渲染组件类型固定，动态数据通过 React Context 更新。历史快照/侧栏刷新/回复继续增长不会因此卸载图片预览，缩放与 Blob 缓存保持。

### 接入能力矩阵

| 会话类型 | 发现/历史 | 实时内容 | 原地续聊、停止、审批 |
| --- | --- | --- | --- |
| 当前共享 daemon 所拥有的会话 | 合并索引、分页读取 | 共享控制事件及历史快照 | 已支持，保持原 thread |
| 无活动 writer 的已保存历史 | 持久化目录可读 | 无正在执行的内容 | 可通过原 daemon 冷恢复；目录/provider/版本仍须兼容 |
| 另一个独立 stdio 进程正持有 writer | 已保存内容可读 | 周期读取已持久化内容，不保证未保存的 token | 没有可连接入口时不支持；不会双开执行 |
| 已归档或 cwd 已删除 | 仍展示并加载历史 | 只读历史 | 需要先恢复归档/目录等条件 |
| 其他 CODEX_HOME 或另一台机器 | 当前配置不能自动跨越 | 需要独立 Host/Runner 连接 | 后续多运行时路由工作 |
| 仅存在于未知进程内存且从未持久化 | 当前索引不能凭空发现 | 需要拥有者公开入口 | 无通用跨进程接管接口可供当前实现使用 |

### 最佳实现路径与后续工作

1. **保留官方协议作为历史入口。** 当前版本同时存在 JSONL 与 paginated history，直接解析某一种日志格式会遗漏另一种。官方方法已经提供无恢复的分页读取，优先通过版本匹配的 app-server 使用它们。文件索引可在未来用于诊断/补充发现，不能替代消息协议和活动进程状态。[官方 App Server 文档](https://learn.chatgpt.com/docs/app-server)。
2. **未来终端与 Web 共用执行引擎。** 本机已安装 CLI 0.164.0 的帮助明确支持 `codex --remote unix://`；官方也记录 Unix/WebSocket TUI 连接方式。让新终端会话连接同一个共享 daemon，是本地直连且可双端控制的适配路径。无需让 Web 经厂商远控中转；模型调用仍沿用 Codex 的原有模型服务。[官方连接方式](https://learn.chatgpt.com/docs/app-server#connect-the-cli-terminal-ui)。本轮未修改用户的 CLI 配置，也没有重启已有 Codex 任务。
3. **多执行进程按 owner 路由。** 未来增加显式运行时注册表，记录受信任的本机 Unix 入口、CODEX_HOME 与实例身份。先查询该入口的 loaded threads，再验证 thread/cwd/能力后连接拥有者；失效入口从 registry 移除。当前仍只连接一个默认共享入口，不能声称多 owner 路由已经完成。
4. **旧独立 stdio 进程保留观察能力。** 标准输入输出属于启动它的宿主，不能通过启动第二个 app-server 获得原内存执行状态。根据已确认的写锁与可用入口，本项目采用“历史可读、控制可用性单独显示”；执行者退出后可恢复原 thread。这个边界是当前协议与本机拓扑的工程判断，不是宣称所有未来 Codex 版本永远没有其他机制。
5. **控制能力按方法检测。** 模型/provider 不一致、无 goal API、无分页 API、审批连接归属等应单独回退。不能把 notLoaded 当作所有进程均已停止，也不能把没有控制能力当作历史不存在。

本轮证据：本机 CLI 0.164.0 帮助与既有生成 schema、现有服务配置、Rust 调用路径，以及隔离 HTTP/浏览器回归。没有运行或修改原 ChatGPT 应用，也没有向私人会话发送任何测试消息。下方较早的开源项目比较保留其已记录固定版本；本轮未重新宣称已核对这些项目的最新版本。


下表按固定源码版本对比实现方式。参考仓库不随发布包分发；本项目的同步代码以 Rust 独立实现。

| 项目 | 已核对版本 | 历史发现 | 实时机制与边界 |
| --- | --- | --- | --- |
| [HAPI](https://github.com/tiann/hapi) | `fa02830a60c2e29c20b1de94f8645174b06492ec` | Desktop direct-import 扫描原生 JSONL 与 session index，解析 cwd/title | shared runtime 让 TUI 与 Web 连接同一 app-server；注册私有 endpoint/owner。不是启动一个新进程就能接管所有现有 CLI 执行 |
| [CodexMonitor](https://github.com/Dimillian/CodexMonitor) | `dd61b9abd37de5ded86e82b9fe8a83fd49d46fa5` | `thread/list` 与 `thread/read`，按工作区路由 | Rust 子进程 stdio app-server，接收自身执行引擎通知；`thread_live_subscribe_core` 仅验证已有工作区连接，不能视为跨进程实时订阅 |
| [Happy](https://github.com/slopus/happy) | `b12e741aa5c8f9860e761844c238811e51ead1f8` | Codex adapter 恢复原生 thread；其他 provider 另有日志 watcher | Codex app-server stdio 子进程，处理 turn/item/status 通知、重连和请求 epoch；Claude 的 JSONL watcher 不是 Codex 实时事件源 |

对应源码入口：

- HAPI：`docs/guide/codex-shared-sessions.md`、`cli/src/codex/shared/runtime.ts`、`shared/registry.ts`、`cli/src/modules/common/codexSessions.ts`。
- CodexMonitor：`src-tauri/src/backend/app_server.rs`、`src-tauri/src/shared/codex_core.rs`。
- Happy：`packages/happy-cli/src/codex/codexAppServerClient.ts`、`packages/happy-cli/src/claude/utils/sessionScanner.ts`。

## 本项目采用的方式

原先查询进程是独立启动的 app-server，导入会话全部显示为历史。独立进程的 `notLoaded` 仅表示此进程没有加载会话，不能证明桌面里的任务已停止。

现在优先只读连接本机当前 Codex 用户的 `$CODEX_HOME/app-server-control/app-server-control.sock`，默认 `$HOME/.codex`。连接使用 WebSocket upgrade、initialize 和只读 thread 查询。共享查询能返回实际执行进程的 active/idle 状态。协议依据：[OpenAI 官方 App Server 文档](https://learn.chatgpt.com/docs/app-server) 的 Unix/WebSocket 传输、thread 状态与只读查询说明；默认入口路径仍是本机实现细节，不承诺跨版本固定。

索引 observer 只允许调用 `thread/list`、`thread/read`、`thread/items/list`、`thread/turns/list`。单纯索引 observer 不控制执行。用户选择普通会话后另建共享控制连接，以 thread/resume(threadId, excludeTurns:true) 订阅原线程，不覆盖原模型/权限。消息与停止通过该连接执行，不调用 fork，也不在连接关闭时结束外部进程。

- `active` → 执行中；`waitingOnApproval` / `waitingOnUserInput` → 等待回应；`idle` → 待命；`systemError` → 异常。
- `notLoaded`、缺失或未知状态 → 运行状态未知；不根据文件修改时间、writer lock 或最近一条消息猜测运行状态。
- 目录仍来自真实 cwd，限定允许工作区。内部审批审查会话不进入用户列表，重复 thread ID 去重。
- 最近内容约每 5 秒查询最新页；索引缓存为 2 秒，当前会话状态约每 2.5 秒独立刷新。历史仍采用快照同步，尚非逐 token 镜像；共享控制连接接收并存储当前会话的审批和生命周期通知，Web 可直接回应。
- 连接失败、无共享 daemon 或不支持的查询回退至独立 app-server 的持久化历史。另一个独立 CLI 引擎可能不属于桌面 daemon，这时只显示已保存内容与未知状态。
- 当前自动观察支持 Unix。`CODEX_HOME` 决定连接的桌面 daemon，`CODEX_BIN` 仅指定独立查询/自建任务的执行文件。定制安装应同时设置对应 CODEX_HOME。未来可增加明确的多运行时注册/连接设置。

## 更新提醒原因与修复

旧实现每次发现 waiting worker 都调用阻塞式 confirm，没有按版本记录“稍后”。开发发布确实会改变内容版本，但并非构建时间戳导致不断变化。还有一种情况：导航已从网络加载新版页面，旧 worker 仍等待激活，此时也不该要求再次更新页面。

现在以内容版本为标识：页面携带 app-version，waiting worker 回复自己的缓存版本；同版页面不提醒，已忽略版本不重复提醒，新版以非阻塞通知显示，只在用户点击时激活并重新加载。保留离线 shell 与 API 不缓存规则。多标签页中其他页面的更新不会强制重载当前会话。


## 原会话直接控制

普通会话支持无需 fork 的直接控制：

- 空闲发送使用 `turn/start(threadId,input)`，正在执行时使用 `turn/steer(threadId,expectedTurnId,input)`；先查原引擎当前 turn，避免根据缓存状态误发。停止使用 `turn/interrupt(threadId,turnId)`，等待原任务结束后释放操作门锁，避免立即续聊被旧取消信号影响。
- 每个普通会话独立共享 WebSocket 连接；只转发匹配 threadId 的事件。索引刷新 upsert 外部会话，保留审批/控制事件，不再删除重建全部外部行。
- 模型和审批策略沿用原客户端，界面禁用误导性的本地修改；不会因本服务保存的 auto 标记自动批准外部请求。
- Unix 连接不拥有原 daemon 子进程；服务退出只关闭连接。控制失败不自动重试消息，不回退到另起 app-server 执行，不创建新 thread。
- 冷恢复前核验当前 thread cwd 仍在允许工作区，并检查原生 thread-writer-locks。其他独立 CLI 正持有写锁则拒绝控制，避免双写；这类进程需要原本提供共享控制入口，无法通过历史文件实现远程停止。
- `scripts/shared-control-test.py` 覆盖同 ID 的 steer/interrupt/start/审批、跨会话事件隔离、重复审批拒绝及原进程生命周期。真实 Codex 隔离验收也验证了同 ID 补充、停止、停止后回复及远程服务退出后原引擎仍 active。

## 执行中输入与队列

`turn/steer` 是对当前 `expectedTurnId` 的补充输入，不等价于等待下一轮。AnyWork 因此通过 SQLite 持久化 FIFO 队列，在原引擎确认 idle 后发送下一轮，显式“引导 / 立即发送”才调用 steer。普通会话发送不覆盖模型、权限或审批选项，不 fork。自建会话的新 turn 继续使用会话配置。队列发送前持久化 sending；异常或重启中断的发送标记 uncertain，禁止自动重试。停止任务及服务重启暂停队列，恢复需用户明确操作。
