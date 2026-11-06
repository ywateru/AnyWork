# 桌面宿主适配器：当前实现与验收边界

日期：2026-11-05。此适配器连接已经存在的宿主协调通道，由原宿主操作自己持有的引擎。不会向该会话启动第二个执行引擎。协议依据见 [宿主 IPC 静态契约](desktop-host-ipc.md)。

## 启用与路由

入口可由 `--desktop-ipc-socket`、`ANYWORK_DESKTOP_IPC_SOCKET` 或数据目录的 `desktop-host.json` 提供，优先级依次降低，值必须是 socket 绝对路径。本机服务已启用并通过重启后的只读重连。未配置时关闭，不自动扫描入口。配置文件格式为 `{"version":1,"socket":"/absolute/path/to/ipc.sock"}`，属于本机运行数据，不打进源码包。

初始化、传输、版本、身份或快照失败时停止连接。只有 owner discovery 明确返回 `no-client-found` 才继续查找已有共享引擎；冷恢复仍检查 writer lock。适配类型来自实际连接结果，不能根据是否配置桌面入口推断。没有宿主 owner 的纯 stdio CLI 不会因此自动获得控制入口。

适配器检查 endpoint 类型、属主、目录和 socket 权限及连接对端 UID，然后执行 initialize → owner discovery → follow。后续请求固定到该 owner；响应的 handledByClientId 也必须相同。不会自动创建 router、扫描其他 socket、启动桌面应用、附加进程、删除写锁或修改安装包。

内部使用原生 RPC 外观接入现有 HTTP 接口。这里的 thread/resume 仅返回已收到的桌面快照，供 AnyWork 初始化会话；不会给另一个原生引擎发送 resume。

## 已实现的接口路径

| AnyWork 功能 | 宿主路径与约束 |
| --- | --- |
| 原会话连接 | owner/thread/cwd 固定，等待 v11 完整快照后才报告成功 |
| 空闲时发送 | follower start-turn v2，保留原设置，不添加审批或权限覆盖 |
| 执行中引导 | follower steer-turn v1，原 input 不变；提供文字及基础图片 restoreMessage、附件路径描述和 clientUserMessageId |
| 停止 | follower interrupt-turn v4，user-stop 与 expectedTurnId；目标暂停部分失败另行提示 |
| 模型设置 | follower update-thread-settings v2；执行中仅允许 effort，其他变更等待空闲 |
| 审批/问答 | 原 command/file/permissions/user-input/MCP elicitation 操作；数字和字符串 pending ID 严格区分 |
| 历史显示 | 桌面快照与持久化历史按 turn/item 身份合并；当前未落盘文本、图片和累计工具输出也可读取 |
| 大工具详情与外部文件 | 从该会话的 live 快照核对引用；不能因连接宿主就访问任意文件 |

原始快照保留未知字段。Immer patches 在副本上全部应用并校验后才提交；acceptedTextChanges 已包含在 patches 中，不再重复追加。revision 缺口时暂停操作并重新请求快照。已知搜索岛缺少 live tail 时不能生成一个可执行的当前回合 ID。

canonical 与 legacy/optimistic 合并按原模块默认参数实现，保留 ID 锚点和相对顺序、分页与完成元数据，并依据 client/server message ID 协调 steering 消息。automation policy 与 resume-snapshot 专用合并分支尚未覆盖，不能称所有状态都已 1:1 复刻。

历史页使用 item 身份，桌面分页游标绑定前一 turn ID，避免新回合追加导致 offset 漂移。刷新时明确替换已合并回合中的旧投影，保留更早页；历史不完整或持久化读取失败会在界面提示。原命令输出更新可能关闭 follower patches，因此执行中每秒请求快照补齐累计输出。Web 端仍按现有周期刷新历史，不能承诺桌面的逐帧输出时延。

## 审批、断线与不确定结果

Web 的审批 ID 包含连接代际及随机标识，内部保存原始请求 ID 类型。断线使旧 ID 失效。提交前重新确认原请求仍在当前 snapshot 中；一次已提交的响应不能重复发出。

宿主 ack 仅证明已受理派发；只有后续状态真正移除原 pending，AnyWork 才发送 resolved。若另一端已处理，请求同样从 Web 消失。响应等待不会持有状态锁或 RPC 传输锁，避免与状态更新、模型读取互相阻塞。

网络断开、超时、错误 owner 或无法解释的回复属于送达结果未知，不自动重试。该连接停止后续操作，保留只读状态供核对。只有明确未进入 handler 的路由/版本拒绝才允许重新提交审批；不能把一般 handler 错误当成未执行。

## 验证与尚未完成的部分

`python3 scripts/desktop-host-http-test.py` 通过真实 Rust HTTP 服务连接临时 framed IPC 宿主，使用临时 home、工作目录、假 catalog 和 writer lock。8 项通过：原回合引导/下一回合、执行中 effort、数字/字符串审批、owner 断线与跨代际保护、停止、revision gap 重同步、错误 owner 不重发、历史与图片/大工具详情/并发设置。测试断言只读 catalog 从未收到 thread/start、resume、fork 或 turn 变更。SDK 的 3 项 bridge 测试另外覆盖等待锁、审批拒绝和关闭时 pending 失败。

2026-11-05 随后完成原桌面实机验证：当前审核允许了限定范围的只读连接与单条协作验证消息。真实 Rust HTTP 适配器读到了同一会话和目录的执行状态、设置及桌面历史；在线 AnyWork 的一次 steer 被原桌面同一执行回合接收，该消息也进入当前桌面对话。原 thread、turn、开场 input、model、effort 和 owner 保持一致；比较前后的全部已观察原应用/Codex 进程 PID 与启动时间也保持。没有修改、重启或注入原应用。此结果取代此前“原桌面连接尚未验证”的阶段结论，不代表所有协议分支已通过实机验收。

持久化配置及路由修正后，Rust 73 项检查、Clippy 和 debug/release 构建通过；8 项桌面 HTTP 测试改为直接读取配置文件，无需环境变量；10 项共享控制测试通过，新增桌面明确无 owner 时路由到已有引擎且不误标桌面适配的场景。

基础本地图片和 URL 图片的草稿恢复已按静态契约补齐，start/steer 同时携带本地图片路径描述，原 input 保持不变。当前仍有明确缺口：真实原桌面的审批、停止及空闲下一轮尚未做变更验收；完整 rich/file attachment restoreContext 仍未复刻；目标修改、历史编辑、原桌面共享队列和部分动态工具没有对应适配。遇到未支持操作时明确报错，不向第二引擎尝试执行。语音按用户选择继续保留差距。

## 侧栏执行状态

运行和启动状态在会话右侧显示旋转细环，等待审批或用户输入时显示“回应”，空闲显示时间；系统减少动态效果偏好会停止旋转。

2026-11-05 补齐未打开会话的只读观察器：显式配置桌面入口后，用独立连接对目录范围内的外部会话发现 owner 并订阅快照和补丁，不创建控制 runtime、不 resume、不发送、不回答审批。侧栏列表和单会话状态都使用新鲜的观察结果；已建立控制 runtime 时仍由它提供状态。观察状态只保存在内存，不修改历史时间或写入持久状态。

每批最多8个 owner 查询，失败按10秒间隔重试，优先尚未查询的会话以防历史较多时饥饿。收到连续更新时不重复索取完整快照；无更新时按心跳核对，包括空闲会话，以发现从桌面开始的下一轮。每个连接最多等待一份完整快照，控制连接同样增加此限制；原控制连接等待10秒无快照便断开，防止慢宿主积压请求。观察数据12秒过期，owner/连接断开、版本或 revision 异常立即使对应缓存失效，并自动重新发现或同步。退出时主动取消订阅。

原桌面的 resuming 和尚未确认提交，在 native idle 尚未切换时也显示活动状态；同一快照里的真实待回应请求会补齐等待标记。未连接的历史、写锁和单独进程的 notLoaded 均不作为运行证据。没有可用协作入口的纯 stdio CLI 仍不能据此获得准确实时状态。

本次状态修复的隔离验证通过，实机检查仍遇到原桌面宿主初始化及owner查询超时。另行只读连接共享引擎成功，但其loaded列表为空，当前会话为notLoaded，无法代替原桌面的运行证据。因此当前机器上全部会话的状态恢复仍待入口恢复后验收，详见验证记录。本次未重启或修改原应用。
