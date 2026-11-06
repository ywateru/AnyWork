# 安装与使用 AnyWork

[English](getting-started.md) · [项目首页](../README.zh-CN.md)

## 选择下载

从 [GitHub Releases](https://github.com/ywateru/AnyWork/releases/latest) 下载，使用随发行版提供的 `SHA256SUMS` 核对。macOS 执行 `shasum -a 256 <文件>`，Linux 执行 `sha256sum <文件>`，Windows 执行 `Get-FileHash <文件> -Algorithm SHA256`。

- **macOS 14+：** Apple Silicon 选 `macos-arm64`，Intel 选 `macos-x86_64`。打开 `.dmg`，将 `AnyWork.app` 拖入 Applications（应用程序）。磁盘映像内附 `INSTALL-macOS.txt` 中英文说明；打开安装后的应用前，在终端执行 `sudo xattr -cr "/Applications/AnyWork.app"`。请从应用程序目录运行，便于后续自动更新。目前是临时签名，尚未经过 Apple 公证。核对来源和校验值后，如被 Gatekeeper 拦截，可前往“隐私与安全性 → 仍要打开”。
- **Windows 10/11 x64：** 推荐使用当前用户 `-setup.exe` 安装版以支持自动更新。便携版需解压并保持 `anywork-desktop.exe` 和 `resources` 在同一目录。如缺少则安装 [Microsoft Edge WebView2](https://developer.microsoft.com/microsoft-edge/webview2/)。程序尚无发行商证书。本版不支持 Windows Codex 桌面进程热接入，可使用 Codex CLI 会话。
- **Linux：** 推荐从可写位置运行 AppImage 以支持自动更新（`chmod +x anywork-linux-*.AppImage`）。便携包解压后运行 `./anywork-desktop`。x64 基于 Ubuntu 22.04（glibc 2.35+），ARM64 基于 Ubuntu 24.04（glibc 2.39+）。安装运行库：`sudo apt install libwebkit2gtk-4.1-0 libgtk-3-0 libayatana-appindicator3-1 libsecret-1-0`。其他发行版使用等价软件包。
- **Android 8+：** 安装 `anywork-android.apk`，按系统提示允许所选来源安装。本包使用持久签名，不是 Play 商店发行。旧本地 Debug 版使用其他签名，相同应用 ID 会导致无法覆盖安装；请先导出需要保留的配置再卸载旧版。保持 Android System WebView 更新。

0.1.1 起支持桌面自动更新。Windows 推荐当前用户安装版，Linux 推荐 AppImage，并放在可写位置。较新 Ubuntu 可安装 `libfuse2t64`；无 FUSE 时可尝试 `--appimage-extract-and-run`。0.1.0 需先手动升级一次。[更新行为与支持的安装方式](updates.md)。

## 启动电脑端

先安装并登录 Codex，在同一系统用户下运行 `codex login status` 检查。如果桌面程序的 PATH 找不到 Codex，启动前设置 `CODEX_BIN` 为其可执行文件绝对路径。Codex 账号用于模型调用；AnyWork 访问密钥用于验证远程设备，两者互相独立。

打开桌面管理器，完成欢迎引导，选择允许操作的工作目录，启动服务。“服务”集中管理宿主和密钥设置；“连接”集中管理可以独立开启的连接方式及地址。将地址和访问密钥复制到可信设备。工作期间，电脑需要保持开机、联网且不休眠。

Android 新建连接配置，填写服务地址和密钥，验证后进入会话。浏览器直接打开服务地址并输入密钥。普通 HTTP 不能提供全部浏览器功能；通知权限通常需要 localhost 或 HTTPS。

## 选择连接方式

| 方式 | 配置 | 使用预期 |
| --- | --- | --- |
| 本机 | 默认回环地址 | `http://127.0.0.1:3210` |
| 可信局域网 | 在管理器开启局域网访问，放行系统防火墙 | 使用电脑局域网 IP；HTTP 不加密 |
| Cloudflare 临时隧道 | 开启开关，缺少 cloudflared 时确认下载 | 无需 Cloudflare 账号的临时 HTTPS 地址，重启可能换址 |
| Cloudflare 固定隧道 | 配置自有域名、路由和连接器令牌 | 域名固定，需要自己的 Cloudflare 配置 |
| WireGuard + TLS 中继 | 安装兼容的 `tunwg`，配置中继 | 需要自有兼容中继，AnyWork 不提供托管中继 |
| Android 私有 WireGuard | 导入配置，填写有效 HTTPS 地址 | 需要自行配置 peer 路由、DNS 与 TLS |

Cloudflare 临时隧道使用带游标轮询代替 SSE。进程存活时优先保留隧道和地址；进程退出后按退避间隔自动恢复，但 Cloudflare 不保证复用原域名。临时、固定和中继三种方式可同时开启。更多配置见[桌面与 Android 连接说明](desktop-manager.md)。

## 命令行服务

源码构建后：

```bash
./target/release/anywork \
  --workspace /absolute/path/to/projects \
  --codex-scope all
```

便携包先进入 `resources`（macOS 为 `AnyWork.app/Contents/Resources`）：

```bash
./bin/anywork --web-dir web --workspace /absolute/path/to/projects
# Windows PowerShell：
# .\bin\anywork.exe --web-dir web --workspace C:\Projects
```

默认令牌文件是相对运行目录的 `.anywork/access-token`。桌面管理器将配置保存在系统应用支持目录。不要在同一个端口再启动第二个服务。

| 参数 / 环境变量 | 默认 | 说明 |
| --- | --- | --- |
| `--bind` / `ANYWORK_BIND` | `127.0.0.1:3210` | 监听接口与端口 |
| `--workspace` / `ANYWORK_WORKSPACE` | 当前目录 | 允许访问的工作根目录 |
| `--codex-scope` / `ANYWORK_CODEX_SCOPE` | `workspace` | 设置 `all` 发现所有本机项目 |
| `--data-dir` / `ANYWORK_DATA` | `.anywork` | 令牌、数据库、附件 |
| `--web-dir` / `ANYWORK_WEB` | `web/dist` | Web 静态文件 |
| `ANYWORK_TOKEN` | 自动生成 | 自定义密钥，至少 16 字符 |
| `CODEX_BIN` | `codex` | Codex 可执行文件路径 |
| `--origins` / `ANYWORK_ORIGINS` | 本地开发与 Android 来源 | 自定义跨域白名单 |

覆盖来源时，为 Android 保留 `https://appassets.androidplatform.net`。兼容旧 `REMOTE_AGENT_*` 环境变量，新 `ANYWORK_*` 优先。未指定新数据目录、仅存在 `.remote-agent` 时继续复用旧目录。

## 功能与限制

- 当前内置正式适配器为 Codex。插件接口不代表已经实现 Claude Code、Cursor 等其他 Agent。
- 桌面协作依赖版本相关的 Unix 本地接口。发现历史不代表已有执行进程一定具备可控入口，以界面报告的能力为准。不要强行对执行中的会话建立第二个 writer。
- 桌面 follower 路径支持读取和暂停目标。创建、恢复、编辑、删除需要兼容共享引擎，见[共享启动说明](desktop-shared-start.md)与[宿主适配器说明](desktop-adapter.md)。
- 排队消息属于 AnyWork，尚未承诺原生桌面队列迁移。语音听写/朗读，以及关闭浏览器后的 FCM/服务器推送未包含在本版。
- 服务拥有系统用户的终端和文件权限，工作区边界检查不等同于多租户沙箱。仅向可信设备分享密钥，跨越不可信网络时使用 TLS/VPN。
- 第三方隧道与模型服务各自遵循其数据处理政策；AnyWork 不提供外部中继，也不意味着这些第三方服务从链路中消失。

## 常见问题

**没有模型或首条消息发送失败：** 检查宿主用户能否运行 Codex、是否登录，以及 `CODEX_BIN` 是否正确。GUI 的 PATH 可能与终端不同。

**历史可见但无法控制：** 检查共享能力与状态、版本兼容性和本地入口配置。不要反复重发同一条消息；结果未知时先核对历史。

**隧道无法启动：** 使用管理器下载 cloudflared，或指定正确程序路径。固定隧道检查令牌和源站 URL，中继检查 helper、认证、DNS 与 TLS。临时地址失效后无法承诺找回旧域名。

**Android 无法连接：** 先用手机浏览器测试同一 HTTPS 地址，再检查密钥和 Android 来源白名单；启用 VPN 时核对路由和 DNS。App 不会通过忽略 TLS 验证接受不可信证书。

**没有通知：** 授予浏览器与系统通知权限，使用 HTTPS，保持页面可用。本版浏览器关闭后不会接收服务器推送。
