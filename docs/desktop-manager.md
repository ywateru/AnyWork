# AnyWork 桌面管理与 Android App

桌面应用保留命令行启动方式，另提供 Rust + Tauri 2 管理窗口，界面位于独立的 desktop/ui 工作区；Android 使用原生欢迎、配对与连接界面，会话部分在 App 内复用同一套界面。

## 构建

macOS 14+：Apple Command Line Tools、Rust、Node.js。Linux 需 WebKitGTK 4.1/GTK3 与 secret-service/dbus 开发依赖；Windows 需 MSVC C++ 构建工具与 WebView2。当前本地已验证 macOS，其他平台由 CI 构建配置检查：

```sh
npm ci
npm run build
bash scripts/build-desktop.sh
open artifacts/AnyWork.app
```

macOS 输出本机架构的 `.app`，Linux/Windows 输出包含资源的便携目录，内置 Server 和 Web 资源。脚本先构建管理界面，再构建 Rust/Tauri 程序。构建脚本可以内置当前机器已安装的 cloudflared；tunwg 使用单独的固定版本下载与校验脚本准备。面向其他用户分发需要开发者签名和公证，本地构建使用 ad-hoc 签名。

Android（JDK 17、Android SDK 36）：

```sh
bash scripts/build-android.sh
```

输出 `artifacts/anywork-android-debug.apk`。调试 APK 使用 Android 调试签名，正式分发应使用自己的发行签名。`ANYWORK_ANDROID_WEB_DIR` 可指向已验证的候选 Web 资源，构建验证不会覆盖正在提供服务的目录。

## 首次打开

默认窗口 960 × 720，最小 800 × 620，正常 DPI 适配；没有整体缩放。页面标题 28px、分区标题 18px、正文 15px、说明 13/14px，欢迎页标题 35px。左侧只保留「服务与连接」「在线设备」。必要设置在服务或对应连接项内展开，程序路径位于高级选项。

欢迎页说明本机 Agent、跨设备继续工作和加密连接。进入「服务与连接」后，可启动/关闭应用自己持有的 Server、复制本机/LAN 地址、配置访问密钥和查看在线设备。三种远程连接各有独立开关，可以同时开启；关闭或重新配置某一路不影响其他连接。

macOS 设置保存在 `~/Library/Application Support/AnyWork/manager.json`，其他平台使用系统应用数据目录。访问密钥文件为服务数据目录中的 `access-token`；Unix 文件权限 0600，目录 0700。Cloudflare 连接器令牌和 tunwg 中继密钥保存于系统 keyring，不放入进程参数或配对二维码。配对码包含 AnyWork 地址和访问密钥。已有 CLI 服务使用不同密钥时，可填入对应密钥或通过原生选取器读取指定 access-token 文件；应用不会覆盖外部服务的密钥。

已由命令行启动的 Server 显示为外部服务。选择它的数据目录或填写匹配的密钥后，可以查看设备并使用隧道；应用不会通过猜测 PID 停止这类服务。退出桌面应用会向自己创建的 Server 和隧道发送关闭信号，独立 Codex 执行进程不属于其进程所有权。

## 三种外网连接

### Cloudflare 临时隧道

开启匿名隧道时，应用先检查 cloudflared。缺少程序或配置的程序位置已经失效时，显示「需要安装 cloudflared」对话框；选择「下载并开启」后，从 Cloudflare 官方 GitHub 发布下载对应系统架构的程序，核对发布提供的 SHA-256 和文件大小，通过运行验证后安装到 AnyWork 用户数据目录的 `bin`，保存程序位置并继续开启原来选择的隧道。无需管理员权限；失败可重试，取消不会开启连接。固定隧道使用同一安装流程，其他已经开启的连接继续运行。自动下载支持 macOS arm64/x86_64、Linux arm64/x86_64 和 Windows x86_64/x86；其他架构可在高级选项中手动选择程序。

匿名隧道获得 `https://…trycloudflare.com` 地址，无需账号。匿名连接明确使用 TCP 上的 HTTP/2，以适应 UDP/QUIC 不稳定的网络；应用用独立的空配置文件启动，避免用户默认 cloudflared 配置干扰临时隧道。取得地址后，验证 HTTPS 信任链和远端 AnyWork 身份再显示可连接。新域名可能暂时无法完成 TLS 握手；远程验证遇到连接或超时错误时，尝试一次不经过系统代理的直连，保留证书验证、Bearer 认证和服务身份匹配。HTTP 认证失败和身份不匹配不会因此被放行。临时隧道不支持 SSE，Web 客户端在此域名使用有游标的 JSON 轮询。错误只显示归纳过的原因，不输出可能包含凭据的原始日志。

匿名隧道开启期间会持续自动恢复。每 15 秒执行一次经过认证的远程健康检查，失败后约 5 秒再次检查（不含网络请求自身超时）；断网、休眠恢复、本地服务短暂不可用和远程 TLS 暂未就绪时保留存活的 cloudflared 进程，让其内部连接监督器重连，尽量保持原地址。已申请到地址的进程不再受原先 120 秒启动超时的限制。只有进程退出、启动失败，或 120 秒仍未申请到任何地址时才重建进程，退避间隔为 2、4、8、16、32、60 秒，上限 60 秒并持续重试；连接连续健康 5 分钟后重置退避。重启需本地服务通过认证且身份与开启时相同。明确的 HTTP 401/403 或服务身份变化会停止自动恢复。

恢复中开关保持开启并可随时关闭，显示恢复状态、进程重试次数及倒计时；上次验证过的地址保留显示为「上次连接地址 · 正在恢复」，暂时禁用网页打开和 Android 配对。新进程的地址通过 TLS、访问密钥和本机身份验证后才替换旧地址，发生变化时提示远程设备重新连接，并关闭旧配对二维码。关闭该连接、关闭本地服务或退出管理器会取消所有自动重试与待完成验证。上述恢复状态只在当前管理器运行期间保留，不在重新打开应用时擅自启用隧道。

Cloudflare 的匿名地址绑定临时 cloudflared 生命周期，停止进程后原 URL 会失效；新进程重新申请临时隧道，无法保证原地址。需要长期固定入口时使用固定域名隧道。官方依据与验证细节见 [对话定位与匿名隧道恢复](conversation-history-and-tunnel-recovery.md)。

使用命令行启动的已有服务时，桌面管理器的数据目录应对应该服务的实际数据目录，或在「已有服务访问密钥」中输入该服务的密钥。另一个数据目录中的密钥无法通过验证；隧道开关在本地服务尚未验证时不可用。修改管理器的数据目录不会更换已有服务的密钥。

Cloudflare 会在其网络边缘处理 HTTPS；需要由自己的基础设施承载整条链路时，选择自有 tunwg 或私有 WireGuard 网络。

### Cloudflare 固定域名

在 Cloudflare One 创建 Cloudflared 隧道，添加已发布应用路由，域名指向你自己的域名，服务地址填写 `http://127.0.0.1:端口`。把 HTTPS 域名和连接器令牌填入 AnyWork。应用用 `TUNNEL_TOKEN` 环境变量启动连接器，令牌不出现在命令行中。

此路线需要自己的 Cloudflare 账号、可配置的域名与隧道令牌。应用提供配置引导，不会在缺少账号凭据时虚构已创建的域名/路由。

### WireGuard + TLS（Hapi 式 tunwg）

```text
AnyWork Android App
      │ HTTPS / TLS（由系统验证域名与证书）
      ▼
自有 tunwg 中继（转发 TLS 字节流）
      │ WireGuard；UDP 受限时可选 HTTPS relay
      ▼
桌面 tunwg（TLS 终止和本机转发）
      │ http://127.0.0.1:端口
      ▼
AnyWork Server → 原有 Codex 会话
```

这条路线不要求 Android 本机安装独立 VPN App。桌面运行兼容 Hapi 的 tunwg，配置自己的中继 API 域名和授权密钥；使用独立密钥目录。仅识别 JSON `listener started` 事件返回的 HTTPS 地址。桌面验证 TLS 和原服务身份后生成 Android 配对码。不默认占用 Hapi 官方中继或复用其注册凭据。

### Android 本机 WireGuard 私有隧道

Android App 同时内置官方 `com.wireguard.android:tunnel:1.0.20260102`，在「WireGuard + TLS · 私有隧道」模式导入服务端签发的 `.conf`。Android 首次要求系统 VPN 授权；App 调用 GoBackend 建立真实 WireGuard 隧道，随后以系统 TLS 校验访问桌面 HTTPS 地址。连接失败会关闭本次建立的隧道；页面提供断开入口。配置含私钥，因此用 Android Keystore AES-GCM 加密保存，禁止备份。

私有模式需要已有可达的 WireGuard 服务端/对等路由，以及桌面 HTTPS 地址与可信证书；它不会仅凭桌面本机回环 HTTP 地址自动生成公网网络和有效证书。直连桌面场景可以在现有 WireGuard 网络中为桌面配置 HTTPS 反向代理；Hapi 式中继则由桌面 tunwg 管理证书。

Android 会先校验配对格式、TLS 和 `/api/info` 的访问密钥，再进入 App 内会话。配对链接通过 `anywork://connect` 打开原生连接页，由用户点击连接；链接本身不触发命令执行。外部网页不会获得应用的原生连接桥接能力。

## 在线设备与地址

`POST /api/clients/heartbeat` 和带 `X-AnyWork-Client-Id` 的已认证请求刷新设备活动；`GET /api/clients` 返回最近 90 秒有活动的客户端、地址、User-Agent 和时间。最多保留 256 个设备，重启后清空，不保存访问密钥。它是活动记录，不等价于 TCP 永久连接数。

默认地址使用真实 TCP 对端。`--trust-local-proxy` 仅在 TCP 对端为回环地址时接受 Cloudflare 的 `CF-Connecting-IP`；桌面管理的 Server 启用该选项。自有 tunwg 未提供可验证源地址时显示回环转发地址，不把客户端自行声称的地址当成公网身份认证。

## 调研依据（2026-11-05）

- Hapi 官方 `hub/src/tunnel/tunnelManager.ts`：`TUNWG_API`、`TUNWG_AUTH`、`TUNWG_PATH`、`TUNWG_RELAY` 和 JSON 日志协议；`tlsGate.ts`：隧道证书就绪检测。源码仓库：<https://github.com/tiann/hapi>。
- Hapi 官方 Android README：原生 Android 客户端。AnyWork 本次复用自己的会话界面，不宣称已迁移 Hapi 的 Compose 界面。
- tunwg 上游隐私与部署文档：<https://github.com/tiann/tunwg/tree/master>。本次固定发行版 `v26.08.03+122a6d0`，平台资产的 SHA-256 由 GitHub release metadata 校验。
- Cloudflare 临时隧道限制：<https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/>。
- WireGuard Android 官方源码：<https://git.zx2c4.com/wireguard-android/>；发行版本来自 Maven Central 的官方 group `com.wireguard.android`。

本地/隔离检查与真实外网验收分别记录；没有中继授权、固定域名凭据或真机网络时，不以进程启动成功替代跨网握手成功。

## 本次验证结果（2026-11-05）

- Rust 工作区 77 项测试、格式与 Clippy 检查通过。
- Web 251 项单元测试、类型检查，以及桌面/移动视口的 22 项加载和会话访问回归通过。
- 原生 macOS 配置、密钥、启动参数测试通过；隔离集成验证了启动内置 Server、认证、读取 Android 设备活动与停止自有进程。已实际打开并检查缩小后的欢迎页。
- Android Debug APK 编译、5 项配对参数测试和 Lint 通过（0 错误，7 项本地化/偏好存储建议）。专用模拟器验证欢迎页、原生配对、认证和会话入口；未向真实会话发送消息。
- Cloudflare 临时隧道对隔离固定响应服务的真实 HTTPS 往返验证通过；未发布用户会话数据。
- 自有 tunwg 中继与 Android 私有 WireGuard 的跨公网握手仍需真实中继/对等配置和设备验收；不以本地构建代替该项结论。
