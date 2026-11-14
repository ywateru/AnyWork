# Android v0.1.38 登录后设备读取卡住

状态：本轮原因调查完成。永久 loading 已在同签名 Release 候选上实机修复；后续 Unknown 的原生失败阶段已确认为协调配置读取，手机蜂窝路线到协调域名的 TCP 连接超时，工作区连接仍未通过。2026-11-14 用户明确授权用 ADB 操作已连接测试手机，并提供测试账号；本次真实账号/实体设备验收替代旧任务中不使用账号与手机的测试限制。既有电脑宿主和 Agent 会话保持运行。

## 现场证据

- ADB 检测 Samsung SM_G9500（Android API 28），已安装 `dev.remoteagent.app`，versionName `0.1.38`、versionCode `40`。
- 当前随包原生界面显示账号名称和“正在读取设备…”，对应 `MobileApp.tsx` 的原生目录 loading 状态；不同于此前网页“状态暂时未知”的截图。
- 应用进程日志两次记录 Tokio worker panic：`rustls-platform-verifier-0.7.1/src/android.rs:90`，`Expect rustls-platform-verifier to be initialized`。
- 初始截图、UI hierarchy 和日志存于 ignored `artifacts/android-reading-devices-live/`。凭据不进入文档、提交或测试报告。

## 交付与验收

1. 作者追踪 Android TLS verifier 的 Rust/JNI/Java 初始化链路，修复实际缺失路径，保留证书和主机名验证。
2. 构建 owner 从精确候选源码生成 ARM64 Release；优先使用与已安装包一致的证书覆盖安装，保留应用数据。不能静默卸载或清空数据来绕过签名问题。
3. 独立 verifier 先复现 v38，再检查源码与回归，独占 ADB 执行候选覆盖安装、实际设备目录与授权工作区连接检查；不向既有 Agent 会话发送提示。
4. 区分编译/包检查、真实登录、设备目录与工作区连接的结果，不以模拟测试替代现场结论。

作者 worktree：`android-loading-investigation`；构建：`android-loading-build`；独立审查：`android-loading-verify`。共享主目录依赖与 Cargo target，避免并行 Cargo 构建和复制缓存。

## 第一候选与独立源码审查

已定位源码链路：`refresh_inner` 先发布目录 loading，再由 `account_read` 使用 reqwest 0.13 请求 Account API；其默认 platform verifier 在 Android TLS 握手时需要 JVM 初始化。原入口只设置 rustls crypto provider，没有初始化 platform verifier，也未接入对应 JVM AAR。worker panic 跳过正常错误到 unknown 的收敛分支，与现场两次 panic 和永久 loading 一致；不据此宣称后续 coordination/工作区已通过。

候选在 mobile 入口启动任何 Tauri/账号网络前，用 Tao 的 Application context、JNI scoped attachment 与 borrowed global reference 调用官方初始化 API，接入 lockfile 绑定的 JVM AAR 与 Release R8 精确保留规则，保持系统证书与主机名验证。作者已通过真实 Android ARM64 release 编译检查、17 项账号测试、mobile all-targets 严格 Clippy 和 Gradle Release verifier 依赖解析；详见[作者证据及边界](../reviews/android-device-loading-author.md)。同证书 Release/R8、实体手机覆盖安装、实际登录/目录/工作区连接仍由构建 owner 和独立 verifier 完成，未以 host fixture 代替。

精确修复 `b00464a6df98e9ca61e526d89a332f0acd921b93` 已通过[独立源码与实体基线审查](../reviews/android-device-loading-independent.md)，合并为 `8cae9e8`。合并主分支实际执行 `cargo test --locked --offline -p anywork-mobile --lib`，40 passed / 0 failed，日志在 ignored `artifacts/android-reading-devices-live/merged-mobile-tests.log`。独立强停/正常 SSO 登录后，原版再次出现同一 panic 与 loading，确认不是仅有旧截图。

现有 Release workflow 以 `publish=false`、候选分支运行 [43570167244](https://github.com/ywateru/AnyWork/actions/runs/43570167244)，保持 `0.1.38/code40` 仅作同签名测试候选；没有创建 tag、更新现有发行附件或宣称实体修复已通过。

## 第一候选实体结果

[构建核验](../reviews/android-device-loading-build.md)和[独立实机记录](../reviews/android-device-loading-independent.md)已合入：同证书 `install -r` 成功，保留数据，正常 SSO 登录和 Account API 设备目录读取完成，手动刷新可用且能结束。旧 verifier panic、启动初始化失败、Java fatal 与 JNI 类错误均为 0。

随后界面显示电脑记录但在线状态 Unknown，连接按钮为“等待状态确认”。没有绕过在线状态/身份门禁，也未建立工作区连接。作者继续定位 Native SDK 配置、注册、presence 阶段；这是永久 loading 解除后才可观测到的后续失败，不将其混写成第一修复失败或已完整恢复。

## TLS 之后的 presence 阶段

当前 Release 无本应用 DevTools socket，原生日志也未记录 coordination 阶段码；此前 UI 只显示通用 unknown，不能凭无日志或旧 fixture 通过断定真实失败原因。

2026-11-14 父协调者授权最小安全诊断：先补契约，再在 unknown 卡片 details 中显示白名单固定错误码，并在原生刷新 unknown 终态记录固定码。不得记录 SDK 原始错误/响应/凭据，不增加调试桥、不启用 Release WebView debugging，不由作者操作 ADB；不先触发下一轮构建。当前公开 auth/config 主机侧只读检查 HTTP200、固定 issuer/client/resource/endpoints/scope/product/coordination 绑定一致，未提供 endpointPolicy 或 registrationAdmission，因此该服务当前走 SDK 旧 devices 路径；此公开检查不证明手机网络、账号授权或 Native registration 成功。

后续显式 host 探针通过真实 pinned SDK `auth_config()` 校验、typed `AuthConfig` 序列化和生产 `EndpointPolicy::parse`，且未创建 device session；该外网测试默认 ignored，不给常规 CI 增加公开服务依赖。独立 verifier 的有限手机探针显示 OIDC IPv4 HTTP200/TLS 验证成功，而 coordination IPv4 DNS 已完成、TCP 建立前超时，IPv6 也超时；这是网络可达性差异证据，尚不是应用内部失败阶段的实测。后续用诊断候选确认 native 固定码，不修改基础设施、endpoint 或信任策略。

## 最终原生阶段与交付

第二候选 `f5a0ae09aa2314e1519fcbb98ed7705c63200ee6` 经[独立审查](../reviews/android-device-loading-independent.md)和[正式签名包核验](../reviews/android-device-loading-build.md)，再次保留数据覆盖安装成功。正常 SSO 登录与随后手动刷新均在原生日志和 UI 详情显示 `MOBILE_COORDINATION_CONFIG_FETCH_FAILED`，没有 verifier/Rust panic 或 Java fatal。该错误边界为 SDK `auth_config()` 请求/解析/校验，尚未进入应用策略、Native 注册与 devices/presence；固定码本身不细分 TCP/TLS/HTTP。

结合同手机公开配置请求在 DNS 完成后、TCP 建立前超时，以及电脑端真实 SDK 配置检查通过，现有证据支持手机当前路线到协调域名的连接问题。不推断运营商或 Vercel 内部故障原因。临时开启 Wi-Fi 未自动连上已有网络，已恢复原关闭状态，未建立备用路线成功对照。后续恢复连接需要可达协调服务的手机网络或服务入口，再实际验证在线状态与工作区；本轮没有修改域名、DNS、代理/VPN、APN、桌面宿主或原有会话。

诊断增量合入主分支后，完整 mobile Native 测试为 41 passed / 1 ignored（显式公网探针），日志在 ignored `artifacts/android-reading-devices-live/merged-mobile-diagnostics-tests.log`。UI 白名单单测与 Chrome 诊断 E2E 已由独立 verifier 通过。

最终同签 ARM64 候选保留在 ignored `artifacts/anywork-android-arm64-loading-fix.apk`，39,274,111 bytes，SHA256 `106be0556f7cdb6f81823375f0656b287a301037b6bb968f63d1402698b8c736`，版本仍为 `0.1.38/code40`，已安装到测试手机。小型构建/作者证据另保留在 `artifacts/android-device-loading-evidence/`，实机证据为 `artifacts/android-loading-independent/`。两个候选 CI 均为 `publish=false`，ARM64 job 成功；其余非必要平台任务在所需 artifact 安全下载后主动取消，整轮不记为 success，没有新 tag 或发行。
