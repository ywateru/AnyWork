# 安装与使用 AnyWork

[English](getting-started.md) · [项目首页](../README.zh-CN.md)

本页描述当前源码的统一账号流程；已发布安装包以对应发行说明为准。账号远程宿主首先验收macOS，其他平台范围见[支持矩阵](support-matrix.md)。

## 选择下载

从 [GitHub Releases](https://github.com/ywateru/AnyWork/releases/latest) 下载，使用随发行版提供的 `SHA256SUMS` 核对。macOS 执行 `shasum -a 256 <文件>`，Linux 执行 `sha256sum <文件>`，Windows 执行 `Get-FileHash <文件> -Algorithm SHA256`。

- **macOS 14+：** Apple Silicon 选 `macos-arm64`，Intel 选 `macos-x86_64`。打开 `.dmg`，将 `AnyWork.app` 拖入 Applications（应用程序）。磁盘映像内附 `INSTALL-macOS.txt` 中英文说明；打开安装后的应用前，在终端执行 `sudo xattr -cr "/Applications/AnyWork.app"`。请从应用程序目录运行，便于后续自动更新。目前是临时签名，尚未经过 Apple 公证。核对来源和校验值后，如被 Gatekeeper 拦截，可前往“隐私与安全性 → 仍要打开”。
- **Windows 10/11 x64：** 推荐使用当前用户 `-setup.exe` 安装版以支持自动更新。便携版需解压并保持 `anywork-desktop.exe` 和 `resources` 在同一目录。如缺少则安装 [Microsoft Edge WebView2](https://developer.microsoft.com/microsoft-edge/webview2/)。程序尚无发行商证书。本版不支持 Windows Codex 桌面进程热接入，可使用 Codex CLI 会话。
- **Linux：** 推荐从可写位置运行 AppImage 以支持自动更新（`chmod +x anywork-linux-*.AppImage`）。便携包解压后运行 `./anywork-desktop`。x64 基于 Ubuntu 22.04（glibc 2.35+），ARM64 基于 Ubuntu 24.04（glibc 2.39+）。安装运行库：`sudo apt install libwebkit2gtk-4.1-0 libgtk-3-0 libayatana-appindicator3-1 libsecret-1-0`。其他发行版使用等价软件包。
- **Android 8+：** 安装适用发行版的APK，或直接用手机浏览器打开[我的设备](https://anywork-tau.vercel.app/app/)。新版Android账号入口优先使用系统浏览器Custom Tabs，不保存桌面地址/访问密钥。签名不兼容时不要自行卸载以免删除旧数据，应使用匹配签名的安装包。保持浏览器更新。

0.1.1 起支持桌面自动更新。Windows 推荐当前用户安装版，Linux 推荐 AppImage，并放在可写位置。较新 Ubuntu 可安装 `libfuse2t64`；无 FUSE 时可尝试 `--appimage-extract-and-run`。0.1.0 需先手动升级一次。[更新行为与支持的安装方式](updates.md)。

## 启动电脑端

先安装并登录 Codex，在同一系统用户下运行 `codex login status` 检查。如果桌面程序的 PATH 找不到 Codex，启动前设置 `CODEX_BIN` 为其可执行文件绝对路径。模型账号与AnyWork设备账号用途不同，模型调用仍使用你原来的账号。

打开AnyWork，按需选择允许操作的工作目录，点击“打开工作区”。桌面准备本地服务后，在浏览器进入同一工作区；无需复制访问密钥。本地使用不要求先登录云账号，云服务暂不可用时仍可工作。

已有独立启动的服务会在身份验证后复用；需要在设置中选择匹配的数据目录，不要在同一端口另起第二个服务。旧服务不支持本机交接时，界面会提示升级，不会改成把长期令牌放进地址栏。

## 从网页或手机继续

1. 在工作电脑的AnyWork中注册或登录，明确开启“允许我的其他设备访问”。
2. 在其他电脑或手机打开[我的设备](https://anywork-tau.vercel.app/app/)，登录同一账号。Android App打开同一个正式HTTPS账号入口，无需配置VPN或导入配对链接。
3. 选择已就绪的电脑。首次连接或公钥变化时，与工作电脑核对设备身份，确认后打开工作区。
4. 返回“我的设备”可以切换电脑；退出远程账号会结束当前远程连接。关闭工作电脑的远程访问后，本地仍可继续使用。

工作电脑需要保持开机和联网。Native账号凭据与端点私钥仅存内存；退出客户端后需重新登录、开启远程访问并确认新公钥。正常短期授权更新在加密通道内完成，不应要求每隔几分钟手动连接。断线不会自动重发业务写入；结果未知时先核对历史。

新版不提供独立匿名/固定隧道、WireGuard及手动地址/令牌连接。旧配置保留用于明确回滚，但不会自动运行。更详细的本地交接、远程授权及迁移边界见[桌面和Android说明](desktop-manager.md)。

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

CLI bearer供内部桌面/API认证使用，Web不再提供粘贴密钥表单。Android账号入口使用正式HTTPS前端，不需要旧appassets来源访问本地业务API。兼容旧 `REMOTE_AGENT_*` 环境变量，新 `ANYWORK_*` 优先。未指定新数据目录、仅存在 `.remote-agent` 时继续复用旧目录。

## 功能与限制

- Codex、Harness 的受支持拓扑、WorkBuddy 被动历史及实验写入统一见[支持与验收矩阵](support-matrix.md)。插件接口不代表已经实现 Claude Code、Cursor。
- 桌面协作依赖版本相关的 Unix 本地接口。发现历史不代表已有执行进程一定具备可控入口，以界面报告的能力为准。不要强行对执行中的会话建立第二个 writer。
- 桌面 follower 路径支持读取和暂停目标。创建、恢复、编辑、删除需要兼容共享引擎，见[共享启动说明](desktop-shared-start.md)与[宿主适配器说明](desktop-adapter.md)。
- 排队消息属于 AnyWork，尚未承诺原生桌面队列迁移。语音听写/朗读，以及关闭浏览器后的 FCM/服务器推送未包含在本版。
- 服务拥有系统用户的终端和文件权限，工作区边界检查不等同于多租户沙箱。远程账号应由本人使用；端到端加密不消除设备、首次目录及托管前端的信任边界。
- Logto保存账号及最少设备配置，CyberGrid/Upstash保存必要协调元数据；业务正文、文件和终端内容留在设备。第三方中继仅传输业务密文；模型服务仍按原账号约定处理请求。

## 常见问题

**没有模型或首条消息发送失败：** 检查宿主用户能否运行 Codex、是否登录，以及 `CODEX_BIN` 是否正确。GUI 的 PATH 可能与终端不同。

**历史可见但无法控制：** 检查共享能力与状态、版本兼容性和本地入口配置。不要反复重发同一条消息；结果未知时先核对历史。

**远程访问无法开启：** 查看电脑端固定的失败阶段提示，确认本地服务已就绪、账号有效和网络正常。暂时服务故障可重试，配置绑定错误需维护者修正，不能跳过验证。

**手机看不到电脑：** 确认同一账号、电脑端仍在运行且远程已开启；协调故障可能显示状态暂时未知。Android优先通过系统浏览器打开账号页，不忽略TLS错误，不导入旧WireGuard配置。

**本地浏览器会话已结束：** 回到桌面点击“打开工作区”重新建立本机会话；无需输入服务令牌。服务重启后旧本机会话失效。

**没有通知：** 授予浏览器与系统通知权限，使用 HTTPS，保持页面可用。本版浏览器关闭后不会接收服务器推送。
