# 移动端协调配置恢复：独立现场基线

2026-11-15，非作者 verifier。工作树 `.worktrees/mobile-coordination-verify`，源码基线 `b110681ad451754b5e1be6b59833fee5771a3d4c`。按[恢复任务](../tasks/mobile-coordination-recovery.md)独占 ADB；作者 Native/route 调查与本 lane 分开，探针建议通过父端协调。

**当前结论：失败基线已复核，恢复验收尚未通过。** 一次正常 UI 刷新再次结束于 `MOBILE_COORDINATION_CONFIG_FETCH_FAILED`。本次手机到 coordination 的 IPv4 TCP 能建立、TLS 握手失败，IPv6 TCP 超时；官网和 auth 的 HTTPS 成功。因此不沿用此前“当前 TCP 一律不通”的表述，也不将 curl 结果直接认作 Native 请求内部错误。

## 当前应用与一次正常刷新

- 使用明确路径 `/Users/water/Library/Android/sdk/platform-tools/adb`，发现一台已授权实体设备，无运行中的 emulator。只输出 API28 等安全投影，不记录序列号、账号或设备身份。
- 当前应用实际是 **v0.1.38/code40 诊断候选，并非 v41**。在设备上只读计算已安装 base.apk 摘要，得到 `106be0556f7cdb6f81823375f0656b287a301037b6bb968f63d1402698b8c736`，与此前已验签的阶段候选完全相同，绑定来源 `f5a0ae09aa2314e1519fcbb98ed7705c63200ee6` / CI `43573253953`。本轮没有复制 APK 或重跑验签，没有安装新包。
- 现有登录态可用，无需登录或密码。初始 UI 为“暂时无法确认设备状态”，刷新可用，“等待状态确认”连接禁用；展开诊断详情显示上述固定码。
- 只点击一次正常 UI“刷新设备”。开始后刷新变为禁用；旧错误卡片在忙碌时仍可能显示，不能以它认定新刷新完成。随后观测到刷新重新启用，并重新展开详情确认同一固定码。
- 该应用进程的新固定日志在设备时间 `17:26:01.365` 记录 `AnyWorkDirectory: MOBILE_COORDINATION_CONFIG_FETCH_FAILED`。最终安全 UI 快照为 `09:28:12Z`：固定码相同、刷新可用、连接禁用。只读取日志有限窗口，未见 verifier 未初始化 panic、Rust panic 或 Java fatal；不声称整段进程生命周期绝无异常，也不以 UI 采样间隔计算单次 SDK 请求耗时。

固定源码及锁定 SDK 核对：mobile `grid::devices` 调用 `auth_config()`，失败映射该固定码；其后才是应用 EndpointPolicy、Native registration 与 devices/presence。该码覆盖 SDK 请求、反序列化和 SDK 配置校验，不能独自细分 DNS/TCP/TLS/HTTP，也不能证明后续阶段已执行。未触发连接、读取隐藏 IPC、导出 token 或调用调试桥。

## 同手机公开无账号探针

使用手机已有 curl 7.58.0/BoringSSL；每项为无认证 GET、丢弃响应正文，不输出原始 curl 错误或服务响应。请求使用系统现有解析与路线，进程级 `--noproxy '*'`，保留证书/主机名校验，connect timeout 8 秒、总上限12秒，无 redirect 跟随；没有修改系统代理设置。

coordination 请求为 `https://anywork-cybergrid-selfhost.vercel.app/api/v1/auth/config?appId=<公开应用ID>`。参数名 **appId** 已核对锁定 SDK `f2a3961536e5c69b13c7dbc661953d9243becbae` 的实际实现，值取当前源码默认 client ID；不是 console 的 clientId 路径。未传账号、设备或 grant。

| 端点 / 地址族 | DNS | TCP累计秒 | TLS累计秒 | HTTP / exit | 判断 |
| --- | --- | ---: | ---: | --- | --- |
| coordination，默认 | 已解析并尝试地址 | 1.464 | 未完成 | 000 / 35 | TCP建立，TLS握手失败 |
| 官网 `/build.json`，默认 | 已解析 | 1.642 | 2.005 | 200 / 0 | TLS证书验证成功 |
| auth `/oidc/.well-known/openid-configuration`，默认 | 已解析 | 0.256 | 0.828 | 200 / 0 | TLS证书验证成功 |
| coordination，显式 IPv4 | 已解析 | 0.077 | 未完成 | 000 / 35 | 固定错误标记 `SSL_ERROR_SYSCALL` |
| coordination，显式 IPv6 | 已解析 | 未完成 | 未开始 | 000 / 28 | 总8.004秒，固定标记 `Connection timed out` |

默认三项采集于 `09:26:52Z–09:26:56Z`，coordination 两个显式地址族对照采集于 `09:27:47Z–09:27:55Z`。表中 curl 时间是自请求开始的累计值，不是各阶段独立耗时。DNS成功以解析后已尝试地址为依据；未完成TLS的请求不把默认 ssl_verify_result=0 当作证书通过证据。

安全系统投影确认默认网络为 MOBILE、Wi-Fi关闭、没有全局HTTP代理。未改 APN、代理、VPN、DNS 或 Wi-Fi。没有根据原始连接错误臆断网络供应商、SNI拦截、远端基础设施根因或证书拒绝；`SSL_ERROR_SYSCALL` 也不等于已采集服务端TLS拒绝原因。shell curl 与应用 Native/系统证书路径不同。

## AVD 就绪与建议对照

只读 SDK 清单发现4个现有AVD，均已有 API30 ARM64 google_apis system image（2 GiB配置）；Hypervisor.Framework 加速可用。磁盘可用约54.3 GB。未启动模拟器、下载镜像、创建依赖副本或并发编译，不碰已有AVD数据。

下一轮有区分力的对照建议由父端协调：

1. route lane 提供同一公开端点的电脑直连/既有代理证据，分别保留DNS、TCP、TLS、HTTP结论，避免将电脑既有代理路线当作手机直连成功。当前手机IPv4已有TLS失败证据，不用继续无差别重复默认请求。
2. 若 route lane 找到同后端受控HTTPS入口，先审查与精确源码/部署绑定及 issuer/resource/product/命名空间保持，再对手机做无账号证书/HTTP对照；不能仅凭入口HTTP200宣称身份策略和业务同步恢复。
3. 必要时用现有AVD的只读运行模式做Android栈/电脑出口对照，无需下载system image。AVD通过只说明该Android环境及出口可用，不替代蜂窝实体机；开始模拟器操作时不并发操作phone。
4. 后续作者提交及获准使用的同签包须另行精确审查/准入，再通过正常UI、现有授权完成真实config、设备目录及授权工作区只读读取。当前不安装新包；不绕过unknown门禁、不向Agent发prompt或编辑真实文件。

## 证据与所有权

小型脱敏证据在本WT ignored `artifacts/mobile-coordination-independent/`：`baseline-safe.json`、`installed-apk-binding.json`、`refresh-safe.json`、`final-device-safe.json`、`public-network-safe.json`、`avd-inventory.json`，以及无账号probe复核脚本。未保存原始私人UI树/截图、原始logcat、connectivity dump、地址标识或服务正文。

手机停在现有应用已登录、诊断详情展开的Unknown页面；刷新可用、连接禁用。所有本轮有限命令已结束，无自建模拟器、探针或监控后台进程；既有ADB server保留。ADB独占继续由本lane持有，后续通过父端接收作者commit或明确probe建议。该报告是基线与验收计划，不是协调配置、设备发现或工作区同步恢复完成声明。

## 后续：正式 v41 模拟器登录前对照

父端接受基线后授权启动现有模拟器。选用 `nuva_mirror_isolated` API30 ARM64 AVD，以 `-read-only -no-snapshot-load -no-snapshot-save -no-window -no-audio` 运行，不 wipe、不下载镜像、不改原 AVD 既有数据。所有命令显式选择 emulator，真实手机完全未操作。原 AVD 没有 AnyWork 安装；模拟器临时运行层安装了 root 保留的正式 v41 ARM64 APK，未复制或重建包。

实际安装前再次计算 APK SHA-256 为 `a31c8cc1404b9efa4ebfb4cfab526c85edc3397c28242e74910053cc5f07e434`，39,274,111 bytes，绑定正式源 `f669ef59bde7cb70bbe98fd59592b6f87e93698b`。安装成功耗时8.0秒，实际 package 为0.1.41/code43。`09:32:31Z` 已观测boot complete（不是从进程启动精确计时），正常启动应用后有限日志窗口未见 verifier/Rust panic 或 Java fatal。

`09:34:00Z` 通过正常 UI 点击“登录账号”，核对应用内来源确认弹窗并点击“继续”；`09:35:50Z` 观测到正常 Logto Username/Password/Sign in 页面。两时刻相差约110秒，包含人工检查和弹窗停留，**不是认证HTTP耗时**。该AVD无现成AnyWork SSO，用户名/密码字段为空，没有提交凭据。当前lane上下文缺少此前授权凭据的具体值或安全读取位置，待父端提供后才能继续正常UI登录；未从私人文件或进程中搜寻凭据。

| 阶段 | 实际证据 |
| --- | --- |
| 应用启动/登录来源确认 | 正式v41在API30启动，来源弹窗及auth登录表单正常加载 |
| 账号读取 | 未到达：等待正常UI登录；页面加载不等于Native账号API请求成功 |
| config / registration / presence | 均未到达，不能与手机Native失败作成功对照 |
| 授权工作区读取 | 未到达；未发送Agent prompt或改动真实文件 |

模拟器已有nc，无curl/wget/openssl；未推送额外工具或借私有bridge/隐藏IPC补做Native结果。小证据位于同ignored目录 `emulator-v41/` 的 launch/login/prelogin安全JSON。模拟器保留在登录页，唯一自建后台进程为本次emulator，ADB独占仍由本lane持有；没有监控或重复探针循环。这是等待授权凭据输入材料的中间记录，尚非模拟器业务验收通过。
