# 桌面与 AnyWork 共用执行引擎：优先调研

日期：2026-11-05。目标是原桌面客户端与 AnyWork Web 同时连接同一个执行引擎，保留同一个 thread/turn、工作目录、工具与审批，随时切换。本文区分原包静态观察、独立引擎实测和仍未验证的桌面行为。当前已通过原桌面既有宿主入口加入正在执行的会话并投递单条引导；这不等于任意无入口 stdio 进程均可接管。

## 已运行桌面宿主的新候选

进一步静态追踪发现，桌面自身在 Codex home 的 `ipc/ipc.sock` 上有 owner/follower 协调协议，可以把操作转发给已持有 stdio 的原 manager；这条宿主路径不要求引擎本身新增 listener。详见[宿主 IPC 协议与验证边界](desktop-host-ipc.md)。独立传输客户端及临时宿主的11项隔离检查已通过。Rust 宿主适配现已接入后端，由显式配置启用，真实 HTTP 的8项临时宿主检查已通过；随后原桌面只读连接及在线 AnyWork 单次 steer 实机通过，保留原 thread/turn/input/settings/owner 与观察到的原进程；完整一致性仍待验收。详见 [适配实现与边界](desktop-adapter.md)。

## 决策

优先采用“原执行引擎 + 多客户端”，将注入进程放在不推荐的研究备选中。已存在控制入口时，AnyWork 应连接真正的 owner；启动后的新拓扑，应让桌面和 Web 一开始就连接同一引擎。历史扫描、释放写锁、复制会话或 fork 都不能替代这一拓扑。

在本机安装包中找到直接 WebSocket 地址覆盖，且其客户端支持 Unix WebSocket。候选启动环境是 `CODEX_APP_SERVER_WS_URL=ws+unix://localhost/绝对路径/app-server-control/app-server-control.sock:/rpc`。这里的 `localhost` 使已观察到的桌面代理选择分支走本地路径，传输仍经 Unix socket，不需要开放 TCP 端口。AnyWork 已有的 Unix 连接能继续连接这个 socket。

这条路线目前有两层证据：安装包的静态路径，以及独立标准 ws 客户端对真实 Codex 引擎的连接实测。原桌面应用未启动或注入；桌面实际选择该路径、完整工具能力及配置继承仍需单独验收，不能称为已完成桌面无缝切换。

## 实测结果：真实引擎，两个协议客户端

新增 `scripts/shared-engine-probe.py`。它使用独立安装的 CLI 0.164.0、临时 CODEX_HOME/工作目录、一个真实 app-server 和本地确定性 Responses 模型夹具，不使用真实账号或模型服务，不运行原桌面应用。两个协议客户端模拟桌面传输与 Web 传输，而不是两个实际 UI。

十项检查通过：

1. A 发起回合并等待动态工具；B 在执行中 `thread/resume` 同一个 thread，收到相同 request ID/turn ID/参数，并由 B 完成工具响应。两端观察到同一回合完成。
2. `thread/goal/set` 的同一个目标变化通知到达两端。
3. B 发起回合，两端收到同一个命令审批；A 拒绝后两端收到 resolved 与完成。测试拒绝该命令，没有执行它。
4. B 断开重连后恢复原 thread 与同一个目标。
5. B 发起挂起的本地模型回合，A 用原 `expectedTurnId` 引导、停止；两端观察到同一个 interrupted 回合。
6. A 创建原生队列消息，B 可以查询并修改，A 查询到相同 ID 和更新后的正文。
7. A/B 并发 `thread/queue/start` 同一条目，恰好一个被接受，另一请求被拒绝；只有一个回合，发送后队列为空。
8. 全部客户端断开后，原引擎仍运行；第三个客户端可重新读取原 thread。
9. 正常安装的 ws 客户端用 `ws+unix://localhost...:/rpc` 直接连接同一个 Unix 引擎并完成 initialize/thread/read。该检查没有执行从原应用抽取的代码。

10. 原动态工具仍挂起时，B 单独更新 effort=high，A/B 都收到相同 thread/settings/updated，thread/read 仍是 active；随后 B 回答原 pending request，原回合完成。

本次模型夹具共收到6个请求。此前探索时暴露的两项边界已保留：新 thread 在第一条消息持久化前，另一个连接立即 resume 可返回 no rollout found；`app-server proxy` 不能直接当作 JSONL 转 WebSocket 适配器，发送 JSONL 而不做 Upgrade 握手会等待。最终测试在首条消息已进入原引擎并等待工具时加入，不通过重试新建 thread 掩盖问题。

复现：先安装项目 Node 依赖及独立 Codex CLI，再执行 `python3 scripts/shared-engine-probe.py`。脚本拒绝执行 `.app/Contents/` 内的二进制；用完关闭自己创建的进程并清理临时目录。它不是完整 Codex 协议实现，也不证明真实桌面工具、逐 token 镜像、端到端手机 UI 或所有断线竞态。

真实纯 stdio 引擎在回合开始后由协作父进程临时增加桥接的专项见 [stdio 热加桥接实验](stdio-hot-attach.md)。这与从启动时就有 Unix listener 的上述十项检查不同；仍不能证明未修改桌面宿主的实际热接管。

## 原包静态路径

安装包为 `26.1027.51404`，build `23880`，bundle ID `com.openai.codex`。ASAR SHA-256：`52e0a65f9fea51f4287bbd98c63343761f9424517bb793652bb554764bc0bcc8`。只读抽取 `.vite/build` 下27个JS到临时目录，未修改安装包。

REA 精确分析 `early-bootstrap-824-3c24dda6dba622ec.js`：289705 bytes、81398 AST节点、1个JS成功、0 parse failures；另26文件未选择，语义unknown达到1000上限，应用与语义覆盖均partial。父Evidence `ev_39a38da4f407716cc87d0ee6d5c541e20a3633229611a1d441e2d401056a234c`，summary `ev_4d08f89afc1d8a3e37050f27361e33efffee084ee4ee04ce132f1b4b0c161480`。目录digest仅代表该抽取目录，不替代ASAR身份。

另用独立 Babel AST 解析完整文件，按绑定和源UTF-8 bytes `[start,end)`记录：

| 文件/绑定 | 字节范围 | 观察 |
| --- | --- | --- |
| `early-bootstrap-824... / V` | 157536–158577 | stdio 与 Unix daemon连接选择；配置覆盖必须为空 |
| `early-bootstrap-824... / W` | 158577–158795 | 调用daemon version，并检查版本兼容；不负责启动daemon |
| `early-bootstrap-824... / Q` | 166142–166415 | 默认独立app-server启动参数 |
| `early-bootstrap-824... / f` | 169540–169709 | FORCE_CLI为1时忽略WebSocket地址；否则优先环境地址 |
| `early-bootstrap-439... / s6` | 159173–159404 | local host构造桌面工具插件配置覆盖 |
| `early-bootstrap-439... / eTg` | 4020537–4020662 | 按host及强制CLI条件选择WebSocket地址 |
| `early-bootstrap-439... / eTw` | 4020698–4023395 | SSH、managed remote-control、WebSocket及stdio路径选择；loopback代理分支 |

824文件SHA-256 `c387296475ca0729e4be35c4831b512d39316e0f7e24fe4d631ad0d96ec8e13f`；439文件SHA-256 `c23f63f8ff156b2a92a81ee2870d80ab959ced6ce6232d6fe7e54bbefe11d333`。直接地址绑定 `f` 范围SHA-256为 `8c2c9ff0aba3c7fc26236624d1fe7d623b95572445fb318c76d8ab28d7dc9f51`。

**仅设置 `CODEX_APP_SERVER_USE_LOCAL_DAEMON=1` 不足以保证共享。** V还要求非Windows、local host、无配置覆盖、未强制CLI、没有CLI路径或命令覆盖、版本检查通过。已观察到标准local路径的s6生成一项桌面工具插件配置；因此不能未经运行态确认，就把这个开关当作通用修复。直接WebSocket覆盖在eTw的stdio构造之前选择，是更值得优先验证的候选；它也绕开了原stdio启动时的部分配置注入，需要补齐工具宿主契约。

Unix URL也不能盲目拼接任意路径。当前ws客户端以冒号分割socket路径与HTTP路径，不假定percent编码会还原文件路径。带空格、冒号等特殊字符的路径需另行适配。新增 `scripts/desktop-bridge-plan.py` 只读检查版本、原包候选字面量、Unix socket元数据与环境冲突并输出候选计划；不启动、停止、附加或重配桌面应用。它的字面量检查不证明完整调用关系。

## 技术路线比较

| 路线 | 可接入正在执行的独立stdio会话 | 适用条件与选择 |
| --- | --- | --- |
| 桌面宿主既有 owner/follower IPC | 静态链路支持原 manager，无需重启引擎 | 当前已采用；原桌面只读加入与同回合 steer 已实机通过，原生队列/审批/停止等仍分别待验收 |
| 连接原owner现有Unix/WebSocket入口 | 有对应入口即可，不用重启 | 第一优先；先查询loaded thread并核实身份，不能只试默认socket |
| 引导程序让桌面直连共享Unix引擎 | 无法凭环境变量追溯转换已有进程；适用于后续启动/受控重连 | 推荐验证，安装包已有地址覆盖与Unix客户端路径；原应用保持原样 |
| 桌面SSH host连接共享后端 | 仅覆盖该host拥有的会话 | 官方存在SSH路径；本机别名仍会改变host/project归属，需要验证，不假装自动接管所有local thread |
| CLI路径shim，JSONL与共享WebSocket互转 | 需要从启动时位于stdio通道中 | 备选；必须保留命令配置、工具宿主、请求ID、连接生命周期；不是简单exec官方proxy |
| 从启动时代理独立stdio，公开AnyWork控制通道 | 可控制由代理启动的原引擎 | 备选；代理是唯一上游，需请求ID映射、初始化合并、事件广播、审批单次解决与断线持久化，复杂度较高 |
| 动态注入原进程/调试器/Inspector | 理论上依赖可注入点与目标权限，未验证 | 不作为默认架构；版本、签名、进程稳定性及私有内存对象耦合显著，本轮未尝试 |
| 读日志、删除writer锁、另起引擎resume | 不提供原执行内存与控制权 | 日志仅补历史；删除锁或强行双写不能解决控制链路，不采用 |
| 屏幕/键盘/远程桌面操作 | 可操作前台界面，无法替代稳定协议 | 故障兜底方向，不满足Web原生结构化审批、并发与后台协作验收 |

官方文档确认app-server的Unix/WebSocket、thread/resume、turn/start/steer/interrupt及审批机制；官方远程连接还包含账户配对/relay和SSH路径。前者适合本地产品集成，后者不等价于AnyWork所需的纯本地Web连接。官方文档未承诺本机这些私有环境变量或任意既有stdio进程的热接入。WebSocket transport仍标为experimental，版本/能力检测应作为实现的一部分。

## 注入路线的具体边界

REA只读检查真正的 `Codex Framework` 文件，Evidence `ev_832757612313a4f2f66c8029c2787f27a746d7ff8af9f74031c9840b88132d88`。框架SHA-256 `3f089a2d5e789eb3f694a09c0c6e86f2ff82edffc895379b683ba1df17fbd5c6`，arm64，277442224 bytes。RunAsNode、EnableNodeOptionsEnvironmentVariable、EnableNodeCliInspectArguments均disabled；EmbeddedAsarIntegrityValidation与OnlyLoadAppFromAsar为enabled。

这排除了把 `NODE_OPTIONS=--require`、`ELECTRON_RUN_AS_NODE` 或普通 `--inspect` 参数当作当前包的已可用注入方案。fuse状态不证明应用绝无其他调试入口，也不证明所有系统层注入理论上不可能；没有进行Frida/LLDB附加、改fuse、重签名或改ASAR。已有可复用传输入口的情况下，先改变启动连接拓扑，比依赖进程内私有对象更适合产品化。

## 实施顺序与验收

1. **owner路由与只读诊断。** 为每个运行时记录socket/host身份、CODEX_HOME、引擎版本、能力及loaded threads；thread路由先看实际owner，不能把一个进程的notLoaded当成全局空闲。同一thread在多个host有歧义时明确报出，不猜测。
2. **只读引导计划到真实桌面验收。** 在独立测试profile中让原桌面连接候选Unix URL，核验所连引擎身份、同thread双端发送/steer/interrupt/审批，及目标、图片、插件、浏览器、Computer Use、MCP和动态工具。不能只以“聊天可以发送”验收桌面能力。
3. **将支持的外部会话切换到原生队列。** `thread/queue/add/list/update/delete/reorder/start`和`thread/queue/changed`已存在于本机生成schema，跨端及并发start已实测。当前AnyWork SQLite队列尚未迁移；两套私有队列不能声称同步。迁移需逐条身份、clientUserMessageId、目标模式元数据、附件、编辑撤销及uncertain状态保护。能力不足时明确回退，不能让两套调度器发送同一条消息。
4. **真实事件与pending请求。** 一个owner的事件只进入匹配thread；审批用owner连接代际+request ID去重，收到resolved两端关闭。断线后重建订阅与pending快照，不能拿新连接同数值ID回答旧请求。现有AnyWork审批/事件路径仍需用原桌面UI做端到端验证。
5. **旧独立进程迁移。** 有隐藏但可验证入口则直接接入；确认无入口的既有stdio进程继续保留历史观察，等待当前工作自然结束后由引导拓扑加载原thread。不能承诺将任意正在执行的进程无损迁移，也不因迁移主动停止用户任务。

验收最低标准是：桌面开始、Web加入；Web引导、桌面继续；任一端审批另一端立即消失；任一端停止后可由另一端续聊；同一排队条目不会双发；关闭任一UI不停止任务；图片与工具宿主不丢失；原thread不变且不fork。当前十项独立协议检查通过，原桌面UI完整验收尚未执行。

官方资料：

- [Codex App Server](https://learn.chatgpt.com/docs/app-server)
- [Remote connections](https://learn.chatgpt.com/docs/remote-connections)
- [CLI reference](https://learn.chatgpt.com/docs/cli/reference)

此文补充并收紧[会话同步调研](session-sync-research.md)的连接拓扑结论；此前“默认daemon可连接”的实现能力不等价于“所有桌面/CLI独立进程都已由它拥有”。
