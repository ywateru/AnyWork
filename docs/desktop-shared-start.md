# 桌面共享启动与连接恢复

日期：2026-11-05。共享启动工具是 `scripts/desktop-bridge.py`，补充之前只生成只读计划的 `desktop-bridge-plan.py`。原应用安装目录保持只读。

## 当前独立进程为什么仍不能发送

当前桌面主执行引擎使用stdio通道，默认共享daemon是另一个进程。本次只读进程参数和Unix描述符检查没有发现该主引擎可供Web连接的Unix监听入口。默认daemon返回notLoaded，只说明它没有加载该thread；原writer锁仍被桌面持有，不能由第二引擎强行恢复。

新路由会先检查显式配置和本地注册的全部入口，再检查writer锁。已连接的原owner用于状态刷新，不再让默认daemon的notLoaded覆盖它。仍找不到入口时保留历史、富文本、图片和目标草稿，返回 `owner_unavailable`；发送前也会重新检查连接，无法连接时不投递消息。网页提供“重试连接”，而不是要求用户反复发送同一条消息。

这修复了“已注册的另一入口可以控制，但仅检查默认入口而错误拒绝”的情况。它没有把没有入口的既有stdio进程转换成共享进程。已运行桌面还可研究[宿主现有 IPC](desktop-host-ipc.md)转发原 manager；共享启动是后续启动的一条备选，不应据此要求用户重启，也不能算作热接管完成。

## 使用现有共享引擎打开桌面

先做只读检查：

```bash
python3 scripts/desktop-bridge.py plan
```

在当前桌面工作自然完成、退出桌面应用后，执行：

```bash
python3 scripts/desktop-bridge.py launch
```

工具会检查已观察到的安装包传输候选、桌面是否仍运行、socket是否归当前用户所有、以及共享引擎能否完成初始化和只读查询。成功后把同一个Unix入口注册到AnyWork的数据目录，再直接启动未修改的桌面可执行文件，并传入本地 `CODEX_APP_SERVER_WS_URL`。默认不启动任何进程；只有显式launch会请求启动桌面。桌面已打开时拒绝操作，不退出、不停止任务，也不会另起执行引擎。

自定义共享入口和数据目录：

```bash
python3 scripts/desktop-bridge.py launch \
  --socket /absolute/path/engine.sock \
  --data-dir /absolute/path/anywork-data
```

`--codex-home`必须与发现历史时所用Codex home一致。URL使用 `ws+unix://localhost...:/rpc`，不开放TCP端口；socket路径中的空格、冒号及URL分隔符目前拒绝。目录注册文件为数据目录下的 `codex-runtimes.json`，权限0600；按socket去重并保留其他条目。注册过程不改变原应用文件或用户Codex配置，也不自动删除旧入口。

仅做以上启动，并不证明原桌面工具能力完整。当前已完成真实独立引擎的共享协议验证，以及启动器的隔离替身验证；没有在本轮启动原桌面应用。首次真实桌面验收仍须核对同thread双端发送/引导/审批、图片、插件、浏览器、Computer Use及MCP。默认daemon与原桌面的配置和版本也需兼容。原生共享队列迁移尚未完成，两端各自的排队列表还不能声称同步。

## 多入口配置

可以设置 `ANYWORK_CODEX_SOCKET` 指定一个优先入口，或以系统路径分隔符提供 `ANYWORK_CODEX_SOCKETS`。也可以由启动器写入以下注册文件：

```json
{
  "version": 1,
  "runtimes": [
    {
      "socket": "/absolute/path/engine.sock",
      "codex_home": "/absolute/path/codex-home"
    }
  ]
}
```

显式入口和注册入口先于默认daemon检查，最多16项，总连接预算10秒。不扫描无关临时目录或未知进程的socket。接入前校验Unix端口属主、initialize返回的Codex home（版本提供时）、准确thread ID、工作目录和用户会话类型；之后才在选中的同一连接上resume，不改变模型、审批或权限。没有加载原thread的候选只允许在writer锁空闲时冷恢复。

模型/思考强度仍按真实控制能力提供：成功连接后主动重读设置，任务结束后重新读取；确实不可控或已归档时明确保持只读。已连接的执行中会话允许单独调整 effort；模型、服务等级和计划模式仍受空闲门禁保护。

实现证据与技术路线比较见[桌面协作调研](desktop-collaboration.md)，运行结果见[验证记录](validation.md)。
