# 桌面父宿主适配的验证范围

2026-11-05 的验证分为隔离 HTTP、自建宿主加真实 CLI、原桌面实机三个层次。前两个层次仅使用临时目录、自建宿主和测试会话，下面保留各自证据；原桌面结果单列，不能互相替代。

## 原桌面实机：只读加入与单条引导

通过已存在的 owner/follower IPC 连接未修改的原应用：先核实入口属主、目录权限和 socket 权限，再由 Python 协议客户端及真实 Rust HTTP 适配器分别核对当前任务的 thread/cwd/status/settings/history。随后在线 AnyWork 仅发送一次有明确验收标记的 steer，原执行回合确认接收，原桌面对话中也收到了该消息。thread、turn、开场 input、model、effort、owner 均保持；前后观察到的原应用和 Codex 进程 PID/启动时间均保留。该进程检查不等于逐个证明 owner 到每个系统进程的映射。

仅重启 AnyWork 后，使用数据目录 desktop-host.json、清除进程的临时入口环境变量，成功重新连接仍在执行的原任务；访问令牌未变，未再发送消息。真实网页显示执行动画、当前会话子窗口标签及模型/强度菜单，旧连接错误提示消失，外部点击关闭菜单。

当时原 pending 为空，因此未用原任务测试审批；也未中断当前工作或测试空闲下一回合。原队列、完整恢复上下文、目标修改及所有动态工具分支尚未通过原桌面验收。安装包保持只读，未重启、注入或修改原桌面应用。

## 真实 HTTP 服务与模拟 framed IPC owner

```sh
python3 scripts/desktop-host-http-test.py
```

脚本启动真实 AnyWork debug 服务，设置显式的临时 `ANYWORK_DESKTOP_IPC_SOCKET`，由自建宿主提供长度前缀 JSON 帧。会话目录、Codex home、catalog、writer lock 和审批请求均为测试数据；catalog 由假 CLI 提供。HTTP 请求强制绕过主机代理，只访问回环地址。

八项测试覆盖：

1. 连接原 owner，在原执行中发送引导，空闲后在同一会话开始下一次执行，并更新思考强度；两次发送都携带本地图片，核对原生 input、可恢复图片草稿和附件路径描述。
2. 数字 `17` 与字符串 `"17"` 两个原生审批 ID 分别经独立 Web ID 返回，不发生类型转换或重复提交。
3. 原宿主确认收到审批后，Web 等待原快照移除 pending 才显示 resolved。
4. owner 断线后关闭旧 epoch；重连创建新的 Web 审批 ID，旧 ID 被拒绝且不发送命令。
5. 停止请求使用原 turn ID 与 v4 `user-stop` 协议。
6. 快照 revision 缺口期间拒绝写入，完整快照重同步后恢复。
7. 错误 owner 的确认被拒绝，不自动重发，也不更换目标 owner。
8. 将已保存历史与 canonical/live 状态合并，保留最新文本、未持久化工具输出和原输入图片；验证稳定 history ID、分页、9KB 工具详情、目录外被引用图片，以及并发读取历史和修改模型设置。

每项清理时都会检查 catalog 的全部调用，确认它没有收到 `thread/resume`、`thread/start`、`thread/fork` 或执行、引导、停止、设置等写操作。所有 follower mutation 的目标 owner 与会话身份必须保持。八项已全部通过。

## 真实独立 CLI 经父宿主与 HTTP 协作

```sh
python3 scripts/desktop-host-real-engine-probe.py
```

可通过 `--cli /absolute/path/to/standalone/codex` 指定独立 CLI，通过 `--binary /absolute/path/to/anywork` 指定已编译的 AnyWork。脚本拒绝 `.app/Contents/` 内的 CLI，默认使用 PATH 的独立安装版本和 `target/debug/anywork`。

这项实验启动真实独立 CLI 0.164.0，以纯 stdio 连接由测试控制的原父进程，模型为本地确定性 SSE 服务。在原 turn 已经等待真实命令审批之后，才给这个可配合的父进程添加 framed IPC listener，再启动 AnyWork HTTP 服务连接它。引擎没有预先建立共享 Unix/WebSocket 传输。

七项检查已通过：

1. 原 stdio 引擎先开始执行并产生真实 pending，之后才创建父宿主 listener。
2. 真实 AnyWork HTTP 经这个晚创建的父宿主接入原会话与原审批。
3. HTTP 修改真实引擎思考强度，并给原 turn 发送引导。
4. HTTP 回答原生审批 ID，原父进程通过原 stdio 收到同一 turn 的终止事件。
5. Web 在同一引擎与会话启动下一 turn，正常完成。
6. Web 断线期间，原父进程开始另一个被假模型挂起的 turn；Web 重连后停止的正是这个 turn。
7. AnyWork 退出后，原父进程仍能通过原 stdio 开始并完成下一 turn；原引擎 PID 与 thread ID 保持，没有第二次 resume 或 fork。

真实 CLI 的该命令审批公布的选项包含 `cancel`，没有 `decline`。探针尊重公布的选项，选择 cancel，命令不执行，原审批所在 turn 的最终状态为 **interrupted**。输出中保留 `original_approval_decision` 与 `original_turn_final_status`，不能将它写成审批后原 turn 正常完成。随后 Web 与父端开始的普通 turn 都正常完成。

本次真实 CLI 实验共四次本地假模型请求，`engine_restart_count` 为 0，最后正常关闭 stdin，启动进程退出码为 0，清理没有使用终止引擎的手段。

## 不能据此声称的能力

真实 CLI 实验的父进程从开始就由测试代码控制，能够在运行中扩展它已持有的 stdio 路由。实验验证了这个可配合父进程的端到端路径，**没有证明一个已经运行、没有共享入口、未修改的桌面实例可以从外部无损接管**。两个脚本验证的是自建 framed host 的适配，不等于原桌面运行时的兼容性认证。

`scripts/stdio-hot-attach-probe.py` 另有六项较小的父进程热加桥接实验，范围见 [stdio-hot-attach.md](stdio-hot-attach.md)。它不经过 AnyWork HTTP，与这里的真实 CLI 七项实验应作为不同证据保留。
