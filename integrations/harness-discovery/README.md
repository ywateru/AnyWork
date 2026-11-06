# AnyWork Harness discovery companion

[中文](#中文) · [English](#english)

## 中文

这个本地 Cordis 组合包把**已经运行的同一个 Harness Host** 的认证地址写入私有描述文件，供 AnyWork 发现桌面端或 `dsh web` 的动态端口。它只调用官方 `webServer.getOrigin()` 和 `connection.authenticatedUrl()`，不启动监听器、Agent、会话或第二套执行引擎。

兼容并核对的官方版本：DeepSeek Harness `0.2.2-rc.1`，源码 `fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159`。此包没有 npm 发布，不需要编译或依赖安装脚本。

### 安装到 CLI Web profile

从 AnyWork 源码的绝对路径安装。请将示例路径换成实际位置：

```sh
dsh plugin --profile web add /absolute/path/to/AnyWork/integrations/harness-discovery
dsh web
```

官方插件管理器识别 `dsh.bundle.patch`，安装后自动把本组合包加入选定 profile，随后按 `cordis.patch.yml` 注入插件。已有 Host 未开启配置 HMR 时，在官方界面保存当前工作并重启该 Host 后生效。单纯的 TUI/headless profile 若没有 `webServer` 与 `connection`，插件保持等待，不能凭空接管没有共享入口的独立进程。

需要离线携带时可先在本机打包，再把**绝对路径**交给同一安装命令：

```sh
npm pack /absolute/path/to/AnyWork/integrations/harness-discovery --pack-destination /absolute/path/to/output
dsh plugin --profile web add /absolute/path/to/output/anywork-harness-discovery-0.1.0.tgz
```

### 安装到 Harness Desktop

使用 **Harness 自己**侧边栏的「插件」页，选择安装外部组合包，并输入上面本地目录或 `.tgz` 的绝对路径。确认显示的包名为 `@anywork/harness-discovery`。安装并启用此组合包；如界面报告需要重启，保存工作后使用 Harness 的正常退出/启动流程。普通 `dsh plugin --profile desktop` 被官方启动器保留给 Desktop 自己，不应绕过该限制。

插件不修改已安装应用文件，不读取用户会话，不打印含令牌的 URL。不要把生成的描述文件加入源码、诊断包或公开截图。

### 连接 AnyWork

默认文件：`~/.anywork/harness/host.json`。AnyWork 新版默认检查这个路径，也可以显式指定：

```sh
anywork --harness-discovery-file /absolute/path/to/.anywork/harness/host.json
```

然后在 AnyWork 新建会话中选择 **DeepSeek Harness**，或打开自动发现的同一个 Host 的历史会话。该描述文件的 `url` 含本机认证令牌，读取它等于获得该 Host 的本地控制凭据。

多个 Host 应分别使用不同描述路径。在选定 profile 的 `cordis.patch.yml` 添加覆盖：

```yaml
- id: anywork-harness-discovery
  config:
    descriptorPath: /absolute/private/directory/host.json
```

插件创建私有目录（Unix `0700`），原子发布文件（`0600`），并拒绝符号链接目标及不属于当前用户的目标。已有父目录必须为私有目录；插件不会更改共享目录的权限。请使用专门的子目录，不能直接写到 `/tmp/host.json`。Windows 使用当前用户 profile 目录及其操作系统访问控制。

插件停用时只删除自身激活生成的描述文件；后启动 Host 替换的地址保留。写入与清理通过独占事务锁串行化。若进程恰好在短暂文件事务中被强制结束，重启可能报告遗留锁；仅在确认相关 Host 全部停止后，删除描述文件旁的 `.lock` 文件再启动。

运行生命周期测试：

```sh
node --test integrations/harness-discovery/descriptor.test.js
```

### 上游 API 依据

- `packages/host/webserver/src/index.ts`：`webServer.getOrigin()`，服务就绪后读取已绑定端口。
- `packages/client/connection/src/rpc-host.ts`：`connection.authenticatedUrl()`，由原 Host 认证所有者生成启动 URL。
- `packages/boot/plugin-manager/src/operations.ts`：本地组合包安装与自动 profile 激活。

## English

This local Cordis bundle publishes the authenticated address of the **existing Harness Host** into a private discovery descriptor. It reads the official `webServer.getOrigin()` and `connection.authenticatedUrl()` services; it starts no listener, agent, session, or additional execution engine.

Supported source contract: Harness `0.2.2-rc.1`, commit `fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159`. The package is distributed locally with AnyWork source, not through npm. It needs no build step or dependency scripts.

Install the absolute package directory or a locally packed tarball into the intended Web profile:

```sh
dsh plugin --profile web add /absolute/path/to/AnyWork/integrations/harness-discovery
dsh web
```

For Desktop, use Harness's own sidebar **Plugins** page to install an external bundle from that absolute directory/tarball path, enable `@anywork/harness-discovery`, and follow the application's restart prompt if HMR is unavailable. Desktop owns its reserved profile; the ordinary CLI intentionally refuses to manage it. Do not edit the installed application or use another profile as a substitute for the Desktop host.

The default descriptor is `~/.anywork/harness/host.json`, automatically checked by recent AnyWork versions. An explicit connection uses:

```sh
anywork --harness-discovery-file /absolute/path/to/.anywork/harness/host.json
```

Choose **DeepSeek Harness** in AnyWork or open a discovered historical session. The descriptor contains a local control credential and must remain private.

Set a different absolute `descriptorPath` in the profile override shown above for each independent Host. The plugin creates owner-only directories/files (`0700`/`0600` on Unix), publishes atomically, rejects symlink targets and insecure existing parent directories, and never changes permissions on shared directories. Windows uses the current user's profile directory and OS access controls. Disposal removes only its own activation; a successor Host's replacement remains intact. If forced termination leaves a transaction lock, stop the relevant Hosts before removing the adjacent `.lock` file.

Hosts without the official HTTP carrier, including standalone TUI/headless compositions without `webServer` and `connection`, cannot be controlled by discovery alone. The plugin waits for both services and never starts them. Tests use temporary directories and isolated hosts; they must not be installed into a real user's profile during verification.
