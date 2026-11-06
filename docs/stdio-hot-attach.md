# 已运行的 stdio 会话：热加控制桥接实验

2026-11-05 使用独立安装的 Codex CLI 0.164.0、临时 `CODEX_HOME`、临时工作目录和本地假模型完成验证。没有启动、连接、注入或修改桌面应用，没有使用真实账号或真实会话。

结论：**已经持有原 stdio 连接的父进程如果能够配合，可以在执行开始后动态开放控制桥接；原引擎、原会话、原 turn 和原 stdio 通信可以保持。** 这不是对未修改桌面进程的热接管证明，也没有给 stdio 引擎动态添加第二个原生传输入口。

## 如何复现

```sh
python3 scripts/stdio-hot-attach-probe.py
```

也可使用 `--cli /absolute/path/to/standalone/codex` 指定独立 CLI。脚本拒绝 `.app/Contents/` 下的可执行文件。测试需要允许回环网络监听，所有模型请求只发送到临时本地 HTTP 服务；认证环境变量不会传给引擎。脚本与 `shared-engine-probe.py` 共用假模型和协议辅助方法。

脚本创建自己的 stdio 引擎和一个模拟原桌面父进程的客户端。先开始执行，并停在本地假模型产生的动态工具请求上；此时再由原父进程开放一个 Unix socket，让模拟 Web 客户端通过它控制原连接。这个 socket 属于父进程桥接，协议为本实验的单次 JSONL 请求，不是 Codex 原生 Unix WebSocket 传输。

## 已验证的六项行为

1. 引擎以 `--listen stdio://` 启动，在本地工具请求待响应时仍处于执行状态，临时 home 内没有控制 socket，远程控制状态为 disabled。
2. 执行已经开始后，原父进程才开放桥接 listener，没有重启引擎。
3. 模拟 Web 客户端经父进程读取执行状态，确认 engine PID、thread ID 和 turn ID 全部保持。
4. 通过桥接将思考强度改为 high，收到原连接的更新通知，并给同一个 turn 发送引导消息。
5. 通过桥接回答原来挂起的动态工具请求，原 turn 正常完成。
6. 模拟 Web 客户端断开后，原父进程继续使用原 stdio 连接，成功开始并完成下一次执行；引擎 PID 保持。

输出包含 `checks_passed: 6`、`engine_restart_count: 0`、`desktop_app_used: false`、`real_account_used: false`。测试产生的 PID 与 thread/turn ID 只属于临时测试，不能用于选择真实进程。`unmodified_desktop_hot_takeover_verified` 明确为 false。

本次公开脚本使用 PATH 中的独立 CLI 执行成功，六项全部通过，共发送三次本地假模型请求。执行期间没有发送进程信号，结束时原 stdin 正常关闭，启动进程退出码为 0，清理不需要终止进程。

## 官方实现解释了哪些边界

以下内容已与官方 `rust-v0.164.0` 标签的原文核对；源码标签与本次测试 CLI 版本对应，不表示已与桌面内置版本逐字等同。

- [app-server/src/lib.rs](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/app-server/src/lib.rs#L815-L861) 的 815–861 行在启动时选择 stdio、Unix socket、WebSocket 或 off。该分支没有给 stdio 同时建立本地 Unix listener。
- 同一文件的 [1196–1218 行](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/app-server/src/lib.rs#L1196-L1218) 在 stdio 连接关闭后退出单客户端处理循环。关闭原 stdin 再换连接不能被当作无损切换方案。
- [transport/stdio.rs](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/app-server-transport/src/transport/stdio.rs#L33-L50) 的 33–50 行处理 SIGTERM；125–133 行处理 EOF；153–161 行说明 SIGTERM 会关闭 stdio 连接。这些是关闭逻辑，不能据此发送信号期待它开启 listener。本实验没有在执行期间发送信号。
- [lib.rs 的 888–899 行](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/app-server/src/lib.rs#L888-L899) 把 `config.chatgpt_base_url` 与认证管理器交给 remote-control 传输；[remote_control/mod.rs 的 401–421 行](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/app-server-transport/src/transport/remote_control/mod.rs#L401-L421) 在持久化远程控制设置时加载认证并使用 account ID。这个能力不能直接等同于 AnyWork 所需的纯本地动态控制入口。

对本地生成的 0.164.0 客户端请求 schema 的检查没有发现明确的动态添加本地 listener 的 RPC。这个有限范围的负面结果不能证明所有版本、私有接口或注入技术都不存在这种能力。

## 对 AnyWork 实现的含义

要在已有 stdio 执行过程中热加 Web 控制，最直接的可行条件是：原父进程已经提供可调用入口，或能够安全地扩展它现有的连接路由。父进程必须继续作为 stdout 的唯一读取者，将 Web 请求加入原有 RPC 调度，再将对应响应、通知和待确认请求发回 Web。直接复制读取端并让两个客户端各自读取，会引入消息被任一读取者消费的问题，不能充当可靠的广播与请求路由。

本实验的父进程从开始就由测试代码控制；热加的是它的 listener，不是向不可访问的父进程安装新代码。实验串行分派 RPC，用于确认同一引擎的状态连续性。生产桥接还需要并发请求 ID 路由、通知分发、待确认请求的唯一处理、断线恢复和权限边界，不能直接将本实验 socket 当作生产接口。

对于已经运行、只有原父进程持有 stdio、且父进程没有可调用入口的未修改桌面实例，目前这组证据没有证明 AnyWork 能无损接管。另起引擎恢复历史、预先用共享 daemon 启动、启动参数切换传输，都不能替代这个尚未满足的条件。后续应继续确认原父进程是否有安全的现有连接调用入口；不能仅根据匿名 socketpair、PID、历史文件或远程控制菜单就声称已取得控制权。
