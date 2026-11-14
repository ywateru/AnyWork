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
