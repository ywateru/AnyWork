# WorkBuddy desktop launcher / 桌面连接引导

This source launcher supports the official macOS WorkBuddy Desktop **5.9.3** bundle. It launches the original installed executable using its built-in `WORKBUDDY_REMOTE_DEBUGGING_PORT=0` setting. It does not patch the application, start a separate Agent engine or read model account credentials. AnyWork’s adapter still validates the native renderer and supported capabilities before connecting.

本引导目前支持官方 macOS WorkBuddy Desktop **5.9.3**。使用应用自身的本机调试入口，启动安装包内原始可执行文件；不修改应用，不启动另一套 Agent 引擎，不读取模型账号凭据。AnyWork 后端仍会独立验证原生页面和接口能力。

The integration is experimental. Actual installed preload/list/model reads have passed isolated checks; native creation and message delivery still require acceptance with a normally configured desktop. WorkBuddy's local repository requires its account user ID even when using a custom local model. Complete WorkBuddy's normal account setup first; a fresh signed-out profile returns an initialization/account error. AnyWork does not fabricate identity or provide an authentication bypass.

本接入仍为实验实现。安装版原生连接、会话列表和模型公开信息读取已通过隔离验证；真实创建与消息收发仍需在正常配置的桌面上验收。WorkBuddy 的本地会话库即使用自定义本地模型，也要求账号用户 ID。请先完成 WorkBuddy 自身的正常账号设置；全新未登录配置会返回初始化/账号错误，AnyWork 不会伪造身份或绕过认证。

## Start / 启动

Quit WorkBuddy normally first, then run from the AnyWork source directory with Python 3:

先通过 WorkBuddy 菜单正常退出桌面应用，然后在 AnyWork 源码目录执行：

```sh
python3 scripts/workbuddy-launch.py
```

Keep the launcher running while AnyWork uses this entry. The default WorkBuddy configuration is `~/.workbuddy`, its Electron profile is `~/.workbuddy/app`, and the private discovery file is `~/.anywork/workbuddy/host.json`. AnyWork auto-discovery reads that descriptor; it contains a local endpoint and browser identity, not an account token. Do not upload or publish this file.

使用时保持引导程序运行。默认沿用 `~/.workbuddy` 配置和 `~/.workbuddy/app` 桌面资料目录，连接描述文件为 `~/.anywork/workbuddy/host.json`。该文件只供本机 AnyWork 发现桌面，包含本机连接入口与浏览器身份，不包含账号令牌。请勿上传或公开该文件。

The debugging port is privileged local access to the desktop application. It listens on loopback; do not forward it through a tunnel or bind it to a public interface. Only AnyWork’s authenticated application API should be made remotely accessible.

调试入口拥有访问桌面应用的本机权限。请勿将它转发到外网或隧道。远程使用应通过 AnyWork 的认证接口。

## Lifecycle / 生命周期

- Ctrl-C or terminating the launcher removes **only its own** discovery file. WorkBuddy stays open, and native work continues. Quit WorkBuddy normally to close its debugging listener.
- If WorkBuddy quits, the launcher removes its own file and exits.
- An existing profile lock, existing descriptor, unsupported bundle, stale discovery file or mismatched endpoint produces setup guidance. The launcher never deletes a profile lock, replaces another launcher’s descriptor or terminates an existing desktop process.
- If a stale descriptor remains after a forced kill, first confirm its old launcher is stopped and the desktop is closed, then remove that descriptor manually. The launcher intentionally does not guess ownership of old entries.

按 Ctrl-C 只移除当前引导的连接描述，不关闭 WorkBuddy，也不取消原任务。正常退出 WorkBuddy 后，引导会退出并清理自己的描述文件。已运行的资料目录或陈旧锁需要先由用户正常退出/确认状态，引导不会抢占或删除。强制结束引导留下的描述文件也需要确认旧引导与桌面已关闭后手动清理。

## Explicit isolated configuration / 显式隔离配置

```sh
python3 scripts/workbuddy-launch.py \
  --app /Applications/WorkBuddy.app \
  --config-dir /absolute/private/workbuddy-config \
  --user-data-dir /absolute/private/workbuddy-profile \
  --descriptor /absolute/private/anywork-workbuddy/host.json
```

The descriptor’s parent must be owned by the current user with mode **0700**; the descriptor is atomically published with mode **0600**. Paths containing symbolic links are rejected. Existing directories are not silently chmodded. `--user-data-dir` defaults to `CONFIG_DIR/app`; use explicit directories to isolate a profile. The launcher preserves inherited OS settings, including `MAC_CHROMIUM_TMPDIR` when provided by the caller. Custom descriptor locations must also be configured in AnyWork.

连接描述目录必须由当前用户所有且权限为 **0700**，描述文件原子写入并保持 **0600**。路径不能包含符号链接；引导不会擅自更改已有目录权限。参数帮助：

```sh
python3 scripts/workbuddy-launch.py --help
```

## Isolated verification / 隔离验证

```sh
python3 scripts/workbuddy-launch-test.py
```

Tests use a temporary fake application bundle and loopback HTTP fixture only. They never launch installed WorkBuddy, send real prompts or access real user configuration. Runtime interoperability remains pending independent verification against the supported desktop boundary; fake fixture tests alone do not establish native compatibility or support for other WorkBuddy versions.
