# Android shell 与构建

唯一移动包为 `crates/mobile`（library `anywork_mobile`），工程为 `crates/mobile/gen/android`。旧 Java Custom Tab 工程已从当前源树移除，Git旧tag仍完整保留，发布守卫仅在新路径404时读取旧tag Gradle versionCode。applicationId固定 `dev.remoteagent.app`、minSdk26，versionName暂为0.1.30、versionCode32；发布时由版本脚本同步更新，不能复用31。

```sh
npm ci
bash scripts/build-android.sh                         # debug/aarch64
bash scripts/build-android.sh --debug --target x86_64
bash scripts/build-android.sh --release --target aarch64,armv7,i686,x86_64
```

统一入口不运行adb、安装或选择设备。NDK固定27.2.12479018（r27c），从ANDROID_HOME/ndk读取，覆盖可能指向未安装r28的继承NDK_HOME；Java17、SDK37.0/build-tools36、Rust Android target及根npm依赖需预装。默认本机SDK位置为 ~/Library/Android/sdk，Linux/CI应显式设ANDROID_HOME。不复制node_modules或target；worktree可链接主node_modules，Rust由协调者通过CARGO_TARGET_DIR共享主target、CARGO_INCREMENTAL=0复用。

Tauri CLI2.12.4构建先执行 `npm run build:mobile-ui`；真实 `web/mobile.html` 经Vite到 `web/dist-mobile`，由Tauri macro嵌入Rust库。`scripts/check.sh`及Checks workspace前置也构建mobile assets，host插件明确报SYSTEM_UNAVAILABLE，不伪造Android成功。Android build后运行当前variant lint/unit及 system/auth plugin 单元测试，不重复启动设备。稳定debug输出为 `artifacts/anywork-android-debug.apk`，Checks成功后公开CI artifact保留7天；release为 `release/anywork-android.apk`。

签名兼容旧应用：release要求 ANYWORK_ANDROID_KEYSTORE、ANYWORK_ANDROID_STORE_PASSWORD、ANYWORK_ANDROID_KEY_PASSWORD，alias默认为anywork，可用 ANYWORK_ANDROID_KEY_ALIAS覆盖。凭据仅由环境交Gradle，不写入仓库。APK验证工具检查package/version/minSdk、Rust native lib与所有已构建HTML/JS/CSS资产key、签名证书、ELF PT_LOAD 16KiB及zipalign16KiB。release证书必须与配置keystore一致；是否与历史已安装包同证书还需核对历史APK证书，不能单凭applicationId宣称可升级。

system/auth独立path插件通过各自build.rs的tauri-plugin Builder android_path生成Cargo links元数据，再由tauri-build写入tauri.settings.gradle / tauri.build.gradle.kts合并Android library。生成source/template/wrapper受版本控制；本机路径、generated JNI/Kotlin、.so、Gradle/Rust缓存、tauri.properties和动态Gradle include文件不归档。source archive包含插件源码、manifest、license说明和Gradle wrapper，排除dist-mobile及产物；无需依赖作者未跟踪文件。

本地配置不设置devUrl，验证打包Origin固定为 https://tauri.localhost，入口mobile.html；Android真实WebView provider、选择器、分享接收者、中文IME、生命周期和隔离网关仍以APK独立验收为准。build/lint/unit成功不等于已执行这些运行验收。


## 本机集成记录（2026-11-13，尚非运行验收）

使用 NDK27.2.12479018、Java17、真实 Android `aarch64-linux-android` target。独立 SDK cross-check 实际通过（44.55秒），首次完整 mobile Rust 编译通过（1分54秒），包含真实 account/transport/auth/system 及生成 ACL；本地 path 插件自动写入 Gradle，auth 与 system 均实际被包含。首次 Kotlin 编译暴露两个插件都需要直接 AppCompat 依赖，现已分别由各 owner 修复；system Kotlin 与7项 ExportStore JUnit 已通过。

集成后的最终 canonical APK build、lint、auth JUnit 及 APK 内容/签名/alignment 检查还在执行，完成结果另行记录。运行中的测试依赖由 Gradle 正常下载，未借用真实账号或任何设备。Logto2.0.3 内部 OkHttp refresh POST 可能重试/保留 body 重定向的限制由 auth owner README 明示，不能因 Rust 或 APK 编译通过而宣称已满足严格不重放。

transport 的显式 ring Connector 在双 provider、未初始化 global provider 的独立进程中通过6项真实 loopback WSS测试，包括可信CA exchange、生产WebPKI拒绝未知CA、可信CA但主机名错误拒绝。shell 在原生入口安装 ring 默认 provider 保护其它SDK调用；transport 不依赖该全局初始化。没有禁用证书或主机名验证。
