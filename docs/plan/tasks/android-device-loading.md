# Android v0.1.38 登录后设备读取卡住

状态：现场调查与修复中。2026-11-14 用户明确授权用 ADB 操作已连接测试手机，并提供测试账号；本次真实账号/实体设备验收替代旧任务中不使用账号与手机的测试限制。既有电脑宿主和 Agent 会话保持运行。

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

## 作者候选（待独立审查及同证书真机验收）

已定位源码链路：`refresh_inner` 先发布目录 loading，再由 `account_read` 使用 reqwest 0.13 请求 Account API；其默认 platform verifier 在 Android TLS 握手时需要 JVM 初始化。原入口只设置 rustls crypto provider，没有初始化 platform verifier，也未接入对应 JVM AAR。worker panic 跳过正常错误到 unknown 的收敛分支，与现场两次 panic 和永久 loading 一致；不据此宣称后续 coordination/工作区已通过。

候选在 mobile 入口启动任何 Tauri/账号网络前，用 Tao 的 Application context、JNI scoped attachment 与 borrowed global reference 调用官方初始化 API，接入 lockfile 绑定的 JVM AAR 与 Release R8 精确保留规则，保持系统证书与主机名验证。作者已通过真实 Android ARM64 release 编译检查、17 项账号测试、mobile all-targets 严格 Clippy 和 Gradle Release verifier 依赖解析；详见[作者证据及边界](../reviews/android-device-loading-author.md)。同证书 Release/R8、实体手机覆盖安装、实际登录/目录/工作区连接仍由构建 owner 和独立 verifier 完成，未以 host fixture 代替。
