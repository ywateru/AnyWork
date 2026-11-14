# Android 设备读取卡住：作者修复与验证

基线 `9f80b9e`，任务见 [android-device-loading](../tasks/android-device-loading.md)。此记录是作者证据，不是独立验收或发行声明。未修改版本、桌面宿主、真实会话或账号凭据；ADB 由 Hilbert 独占，作者未操作设备。

## 根因与修复

父协调者采集的 Samsung SM_G9500 / API 28、正式 v0.1.38/code40 日志在 14:43:23 和 14:44:07 两次报告 `rustls-platform-verifier-0.7.1/src/android.rs:90` 未初始化 panic。`refresh_inner` 已发布 loading，随后 `account_read` 的 reqwest 0.13 HTTPS 握手调用 Android verifier；panic 使正常 `Result` 错误到 unknown 的分支没有执行，IPC 无法返回。此阶段发生在解析 Account API records 和查询 SDK presence 之前。

原 `run()` 只安装 ring crypto provider；这解决 crypto provider 选择，不会初始化平台 verifier。修复在该入口、Tauri Builder/账号 HTTP client/后台请求之前，通过 `ndk-context` 取得 Tao 已保存的 JVM 与 Application context。Tao 0.37.2 `ndk_glue::onCreate` 在运行 Rust main 前初始化此 process-lifetime global。JNI 0.22 使用 `attach_current_thread_for_scope`，不假设 Rust main 线程已 attach；`as_cast_raw` 借用原 global，`new_local_ref` 创建本地引用，再交官方 `init_with_env` 保存自己的 JVM/context/classloader globals。不接管 Tao 引用，也不保留 Activity。官方初始化内部幂等；初始化错误在启动边界明确终止，避免界面先进入 loading 后才触发此未初始化 panic。

Gradle 使用 `ValueSource` 从 workspace Cargo.lock 精确读取 `rustls-platform-verifier-android` 版本，接入官方 Maven AAR `org.rustls:rustls-platform-verifier:0.2.0`，并按上游要求保留 `org.rustls.platformverifier.**` 及 descriptor classes。Cargo.lock 仅增加 mobile 对已锁定的 JNI 0.22.4、ndk-context 与 verifier 的直接引用；未升级现有依赖版本。未绕过系统 trust manager、证书链或主机名验证，也未改 iroh 或桌面网络行为。

上游 AAR 有自己的 network security config：base 禁止 cleartext，并为证书撤销检查的特定 CRL 域声明 HTTP 例外。此修复不将业务服务改为 HTTP，不声称最终 merged manifest 绝无任何 HTTP 例外。最终 manifest/DEX/R8 结果须随实际 APK 复核。

## 已完成验证

本机 rustc 1.97.1；复用主 target，jobs=2，未安装新工具链、复制 target 或并发 Cargo。

- `cargo check --locked --offline --release --target aarch64-linux-android -p anywork-mobile`：修订后真实 Android 编译通过，包含 JNI scoped attachment/borrowed global 路径；增量 5.26 秒。release debug=0、strip=symbols、链接 16 KiB 参数沿用构建约束。
- `cargo test --offline --locked -p anywork-mobile --lib account::`：17 passed / 0 failed，另 23 项非账号测试未运行。新增测试启动真实 loopback TLS server，以匹配 localhost 但不可信的证书走生产 reqwest/refresh 路径，两次均按 loading → unknown 收敛，固定 `MOBILE_NETWORK_ERROR`，账号保留，第二次刷新可完成，未发送 Account API HTTP 请求。此 host 测试证明普通 TLS 错误的安全收敛，不证明 Android JNI 初始化已在手机运行。
- `cargo clippy --offline --locked -p anywork-mobile --all-targets -- -D warnings`：通过。
- 实际 Gradle `:app:dependencyInsight --dependency org.rustls:rustls-platform-verifier --configuration arm64ReleaseRuntimeClasspath`：成功解析官方 `0.2.0` Release runtime 依赖；仅任务图/依赖解析，不冒充 assemble 或 R8。离线首次依赖报告曾显示 FAILED，因此没有将其 exit 0 当成功；联网定向解析后已确认版本和实际依赖选择。
- `cargo fmt --package anywork-mobile -- --check`、`git diff --check`：通过。

小日志保存在作者 WT ignored `artifacts/android-loading/`：`android-check-final.log`、`account-tests.log`、`mobile-clippy.log`、`gradle-verifier-resolution.log`。临时 Gradle generated include 文件已删除，未提交本机绝对路径。

## 待独立完成

固定候选源审查后，构建 owner 从该精确提交运行既有 Release workflow 的 `publish=false` 候选，不改 tag/版本；官方证书须与已安装包相同。必须检查最终 R8 后 verifier JNI 类、merged manifest、签名和原有 16 KiB/包内容门禁，再由 Hilbert 覆盖安装验证实际登录、目录返回及授权工作区连接。不卸载/清数据绕过签名，也不向 Agent 会话发送提示。原 v38 的 RAM 登录态和现场证据由独立 verifier 管理。

当前修复针对已证实的未初始化 TLS panic，不把此前 Native refresh 缺陷、旧网页 unknown 截图、普通网络不通或未知 Android provider 版本归为同一根因；后续阶段仍按实际设备结果记录。
