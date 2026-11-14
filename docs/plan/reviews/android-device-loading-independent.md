# Android 设备读取卡住：独立源码审查与实体基线

## 结论与边界

独立审查接受修复提交 `b00464a6df98e9ca61e526d89a332f0acd921b93` 的源码。审查覆盖该提交全部十个文件；未修改产品源码，未运行并发 Cargo 构建。该轮源码接受时，同签候选尚在构建，不代表 Release APK 或实体修复通过。后续实际运行结果见文末；完整工作区连接仍未通过。

实体基线为 Samsung SM_G9500 / API 28，已安装正式 v0.1.38 / versionCode 40。独立保留应用数据强停并重启后，RAM 登录态按契约失效；通过应用正常登录入口和已有 SSO Cookie 完成登录，无需输入凭据。设备页再次停在“正在读取设备…”，刷新不可用，新进程再次报告 `rustls-platform-verifier-0.7.1/src/android.rs:90`、`Expect rustls-platform-verifier to be initialized`。因此不只依赖原始截图：重启、正常登录、真实账号请求与同一 panic 已独立重现。

未卸载、清数据、修改桌面宿主或向既有 Agent 会话发送提示。无账号凭据或 token 写入本报告。小型截图、UI 和脱敏计数 JSON 仅存根目录 ignored `artifacts/android-loading-independent/`，其中 `baseline-reproduced-summary.json` 记录新进程 panic 与重启/SSO边界；不公开原始私人 UI 或日志。

## 精确源码核对

- `crates/mobile/src/lib.rs::run` 在 ring provider 安装后、Tauri Builder/插件和账号 HTTP 请求前调用 Android 专属初始化；失败在启动边界终止，不继续展示一个已经开始但永不结束的目录请求。
- `crates/mobile/src/android_tls.rs::init` 取 Tao 已准备的 JVM/Application context，先 `attach_current_thread_for_scope`，再用 `as_cast_raw` 借用 Tao 拥有的 global，并创建独立 local ref 后交官方 `init_with_env`。不接管原引用，不持有 Activity，不假定 Rust 入口线程已附加 JVM。草稿阶段指出的“未附加线程便使用 local frame”和“把 global 包成 owning local”两点已在该精确提交修复。
- Tao 0.37.2 `platform_impl/android/ndk_glue.rs::onCreate` 在启动 Rust main 前取得 Application global 并初始化 ndk-context；宏注释明确 main 在 onCreate/on_activity_create 后调用。verifier 0.7.1 `android.rs::init_with_env` 通过 OnceCell 保留自身 JVM/context/classloader globals，重复初始化不会替换现有状态。该顺序不依赖 Tauri setup 已执行。
- `Cargo.lock` 只增加 mobile 到既有锁定 JNI 0.22.4、ndk-context 和 verifier 的直接依赖边；Gradle 从唯一 `rustls-platform-verifier-android` lock 项读取 shim 版本，当前为官方 `org.rustls:rustls-platform-verifier:0.2.0`。仓库内容限定该模块，lockfile 相对路径确实指向仓库根。
- 官方 AAR manifest 最低 API 为22，包含 CertificateVerifier、StatusCode、VerificationResult 类，API28满足其声明。`proguard-rules.pro` 按上游保留该包及 descriptor classes；最终优化 APK 的类存活和 API28运行必须另验，不能由 AAR清单或 host 测试替代。
- 官方 AAR 的 network-security-config 以禁止 cleartext 为默认，并为证书撤销检查的指定 CRL host 声明 HTTP 例外。未发现业务 HTTPS、系统证书链或主机名校验被放宽；作者文档准确保留这个边界。
- `account/tests.rs::account_tls_rejection_finishes_loading_and_allows_another_refresh` 使用真实 loopback TLS 和匹配主机名但不可信的证书，通过生产 reqwest/refresh 路径验证两轮 Loading→Unknown、固定网络错误和再次刷新。它检验普通 TLS 错误的收敛，不证明 Android JNI 初始化，也不是捕获任意 worker panic 的测试。

独立核对上游本地锁定源码及官方 shim；作者的 ARM64 release cargo check、17项账号测试、严格 Clippy 和实际 Gradle依赖解析证据已阅，未将这些作者执行结果写成独立重跑结果。独立 `git show --check` 通过。

## 因果与后续验收

`account/mod.rs::refresh_inner` 先发布 Loading，随后 `account_read` 对 Account API 发起 reqwest HTTPS；此时 Android verifier 的未初始化 panic 跳过正常 Result→Unknown 收尾，符合已复现的永久 loading。该位置在 records 解析和 SDK presence 查询之前，足以解释此次实体故障的首个阻塞，不证明后续服务或工作区连接没有其他问题。

下一门槛是对候选校验相同签名，使用保留数据的覆盖安装；确认优化包中的 JNI shim及 manifest，API28启动无初始化失败，正常登录后目录退出 loading、刷新可完成，并在可用的授权工作区中只读验证连接。实机结果将单独追加，未完成前不宣称“实体修复通过”。


## 同签候选实体结果

本轮候选为 CI run [43570167244](https://github.com/ywateru/AnyWork/actions/runs/43570167244) 的 ARM64 Release artifact，精确来源仍为 `b00464a6df98e9ca61e526d89a332f0acd921b93`，版本保持 v0.1.38/code40、`publish=false`。APK SHA256 为 `2b9fdcdfe5f4e7a39e20058876061e98513e8428ebd845f555b1c1b6c32da4d7`。独立重新计算哈希、执行 apksigner 验签并比对现装正式包 signer，一致后才执行 `adb install -r`；安装返回 Success，未卸载或清除数据。

构建 lane 提供并已阅的下载后包检查包含优化 DEX 的 verifier 三类及 JNI 签名/字段、manifest、官方 AAR network-security-config 精确匹配、签名、单 ARM64 ABI、strip 与 ELF/ZIP 16 KiB。此包检查由构建 lane 执行；独立 reviewer 没有把它写成自己重跑全部包门禁。

Samsung API28 实际结果：

- 覆盖安装后应用启动成功，通过正常登录入口及现有 SSO 完成登录，无需输入凭据。账号请求实际返回设备记录，页面从 Loading 收敛为 Unknown；刷新按钮恢复可用。
- 随后通过现有 UI 手动刷新一次，再次完成并收敛至 Unknown，刷新仍可用；没有原先无法返回的永久 Loading。可访问性树确认“等待状态确认”连接按钮禁用，没有绕过它发起连接。
- 新候选进程日志计数：原 verifier 未初始化 panic、启动初始化失败、Rust panic 和 Java fatal exception 均为零；未发现 verifier JNI 类相关错误。结合实际 Account API 返回设备记录，已证明该 API28 运行使用的 JNI/TLS 初始化路径能够执行，不只是启动画面正常。
- 仍显示“暂时无法确认设备状态／状态未知”。**原 TLS panic 与永久 Loading 的实体修复通过；设备在线状态及授权工作区连接未通过。** 未向任何 Agent 会话发送提示，未修改桌面宿主或关闭检查来尝试连接。

此后续 Unknown 不再归因于已经消失的未初始化 panic。Account API records 已返回，只能证明账号读取阶段已过；不能证明 SDK auth_config、策略解析、Native registration 或 devices/presence 哪一步成功。现有 Release UI 不展示 AccountSnapshot.errorCode，现有日志没有安全固定阶段码；没有调用隐藏 IPC、读取 token 或开启调试入口提取状态。故本轮未确定下游根因。额外调用 snapshot 还可能覆盖原 errorCode，不建议以该方式补采阶段证据。

后续最小定位需要受控刷新终态的安全投影，仅含 phase、directoryState、固定 errorCode 与 deviceCount；不能输出完整账号、设备标识、URL、凭据或服务响应。若需产品诊断改动，应由作者独立提交后审查，不以此次已接受 TLS 修复冒充端到端完成。

运行小证据仍仅在根目录 ignored `artifacts/android-loading-independent/`：candidate-admission.json、candidate-start.png、candidate-directory-current.png、candidate-refresh.png、candidate-refresh-summary.json 及必要 UI dump。公开报告不包含账号/设备身份或原始私人日志。当前应用保持候选已登录的 Unknown 页面，ADB 测试命令均已结束；独占所有权保留至协调者明确接管。
