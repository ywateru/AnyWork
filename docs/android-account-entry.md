# Android 原生客户端

2026-11-13 用户要求替代旧 Custom Tab 入口：Android 是 Rust + Tauri 2 客户端，安装包携带完整界面，账号登录在应用内独立 WebView 中完成，业务连接、设备目录和凭据由原生层管理。手机连接电脑上的 Agent，不在手机运行电脑后端。实现状态与验收见[任务](plan/tasks/android-native-client.md)；本契约不代表已经通过真机验收。

## 结构与边界

`crates/mobile` 是独立 Tauri library crate，Android 工程位于 `crates/mobile/gen/android`，本地界面由 `web/mobile.html` 构建至 `web/dist-mobile`。不打包桌面服务管理器、cloudflared 或桌面工作区托管逻辑，不在启动时加载远程 `/app/` 作为应用主界面。

- `account`：单一原生授权 owner、账号摘要、目录、可信设备及已核验连接目标。
- `transport`：Rust Noise IK、HTTP 分块、事件轮询与 PTY；前端只持有不透明句柄。
- `mobile-system`：系统保存、分享、受控外链、安全区、键盘和返回事件。
- `mobile` UI：手机引导、设备/账号页与现有完整会话功能；所有业务 API 经过原生 transport。

业务 WebView 仅加载随包本地资产，登录 WebView 无 Tauri IPC 权限。官方登录 SDK 自带的剪贴板 polyfill 与 social connector 桥属于 SDK 的授权页面信任边界，不是 AnyWork 业务桥，不授予 token、文件或 transport 访问。远程内容不能导航业务 WebView 到任意站点并保留原生权限。使用公开 Tauri API，不依赖 `__TAURI_INTERNALS__`。

## 账号与生命周期

使用内嵌登录能力的官方 Logto Android SDK 2.0.3；3.x 已改用 Custom Tabs，不能静默升级。原生层为唯一 grant owner，显式设置 usingPersistStorage=false，应用 token 与协调材料仅保留于内存；这不表示 IdP SSO cookie 也只存内存。SDK/Android WebView 管理授权页 cookie，可能跨进程保留，显式注销走 SDK 的 cookie 清理；进程重启不能据 cookie 自动恢复应用 grant，仍回到登录入口。不读取、迁移或删除旧 Android 加密文件及 KeyStore。信任与偏好可保存非秘密资料，必须按 issuer、subject、设备及密钥版本隔离。授权开始前提示固定登录站点来源，SDK 登录窗口使用系统返回取消，不承诺 SDK 不提供的来源顶栏。登录/注册、取消、失败重试均有应用内路径；第三方身份提供者拒绝嵌入时准确报告，不绕过其限制。

固定产品配置、Native client、合法已注册回调及 PKCE/state，由原生授权 owner 核验。移动端复用该 Native client 既有的 `http://127.0.0.1:17897/callback`，由 SDK 登录 WebView 截获，不启动手机 loopback listener，不为该导航开放任意明文流量或新 deep link。精确匹配与 state/PKCE 仍须验证；不能仅凭 Android manifest 认定新 URI 已在授权服务器注册。账号名称使用当前已验证 subject 的 name、username/preferred_username、email，绝不以 subject 或设备名代替。前端不接触 access/refresh token、授权 code、PKCE verifier 或设备私钥。

每次登录、退出、连接和目录修订都有 epoch/generation 栅栏。退出先阻止新操作并取消 HTTP/轮询/PTY；已开始的 token rotation 由唯一 owner 收尾，未知结果不重用旧 grant。旧异步响应不能恢复账号或写入新账号页面。恢复前台重新核验授权和连接期限；重新连接不重放业务写入、审批或终端输入。需要重新登录时保留身份隔离的草稿，显示准确状态。

## 设备和远程协议

目录合并 Logto customData 中的安装身份、公钥及 CyberGrid 在线/端口资料；离线、目录未知与空列表分开显示。当前部署采用与电脑相同的既有 Native client，通过 Native registration/device session 获取同应用设备；不得把 Native token 发往仅支持 SPA 的 console exchange，也不得假设有未部署的跨产品映射。注册/admission、RAM registrationKey、heartbeat 与协调 epoch 恢复必须完整实现。目录 schema、大小上限与保留未知字段行为沿用 Web 契约。修改名称/移除目录记录必须核对写后结果，移除记录不等于撤销电脑远程权限。

| 用途 | 原生授权边界 |
| --- | --- |
| 登录与账号资料 | 固定 issuer 与现有 Native client；openid/profile/email/custom_data，SDK PKCE/state 与已注册 callback |
| Account API customData | 不带 resource 的 Account API token；固定 issuer 的 /api/my-account；subject 与当前 epoch 栅栏 |
| CyberGrid/电脑业务证明 | 固定 resource 的 connect JWT；Native session 和短期 gateway 授权，不使用 SPA client 冒充 |
| 本地业务 Origin | Tauri useHttpsScheme=true 对应 https://tauri.localhost；Rust wire Origin 同值，可信常量，不来自 JS |

首次公钥和密钥变化均需明确核验；确认绑定账号、设备、目录 revision 与公钥快照，成功握手后才保存信任。Rust 从已核验目录构造连接目标，JS 不提供任意 URL/token。网关精确增加配置中的 Native client 与本地可信 Origin，仍校验签名、issuer、audience、scope、owner、期限及 client；不删除 Origin/client 检查。协议继续使用[remote v1](account-remote-protocol.md)。旧版电脑需要升级后才能接受移动 Native client。

完整会话组件通过 `BusinessTransport` 使用 Rust：会话与历史、发送/队列/中断、模型、审批/问答、子 Agent、文件与编辑冲突、图片、变更审查、目标、归档、导出和终端均保留；能力以电脑后端实际声明为准。已有事件接口走 JSON poll，保持 cursor/has_more，不宣称 SSE。

## 文件与系统

上传由系统文件选择器提供选中文件，支持多选、取消、中文名及 content URI；保留单文件 20 MiB、整个请求 22 MiB 上限。JSON、FormData、Blob 必须正确编码，不把 FormData 直接 JSON 化。文件取回仍经过鉴权与会话路径隔离。

保存/分享采用有界原生临时 handle：begin、顺序分块 write、finish、abort。单块最多 64 KiB，最多两个活动导出、单文件最多 22 MiB；不通过一次整文件 base64 IPC 或任意路径写入。save 使用 ACTION_CREATE_DOCUMENT，报告 saved/cancelled/failed；share 使用 FileProvider 的临时 content URI，最多报告 chooserOpened。无全盘存储权限。临时文件有期限，取消/失败清理，分享后延迟清理，不删除用户目标文件。

Blob 下载链接与会话/Markdown/图片/文档/主题导出均接原生保存桥。PDF WebView 不支持时提供保存/外部打开路径。外部链接仅允许合法 HTTPS 并交系统处理；内部会话链接留在当前账号、设备范围。不得打开任意 intent/file/javascript URI。

安全区和 IME 以原生 inset 为权威来源，避免双重 padding。返回顺序为键盘、浮层、子页面、列表、系统；审批返回不等于拒绝，未保存编辑需保护。应用内提醒保留；未实现原生系统通知时不能宣称支持或显示无效的授权入口。

## 构建、升级与验收

保持 applicationId `dev.remoteagent.app`、minSdk 26 与既有签名 alias；显式维护 versionCode 并大于已发布的 31。`scripts/build-android.sh` 默认 debug/aarch64，支持 release 与目标 ABI，构建随包 mobile assets，运行对应 lint/unit，稳定输出 `artifacts/anywork-android-debug.apk` 或 `release/anywork-android.apk`。CI/release 使用同一入口，保留签名 secrets 与 source archive 对应源码能力。

验收分三层：Rust 对隔离真实 gateway、完整 React/IPC 浏览器集成、实际 Android APK。网页移动仿真不能冒充 Android 实测；不操作用户真实账号或现有会话。优先使用现成模拟器，不下载新镜像、不复制依赖和 target；清理本任务可重建缓存/临时产物，保留源码、凭据及他人工作区。完成后记录准确源码、构建、测试和未覆盖边界，再更新 GitHub。
