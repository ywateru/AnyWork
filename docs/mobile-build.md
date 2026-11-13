# Android shell 与构建

唯一移动包为 `crates/mobile`（library `anywork_mobile`），工程为 `crates/mobile/gen/android`。旧 Java Custom Tab 工程已从当前源树移除，Git旧tag仍完整保留，发布守卫仅在新路径404时读取旧tag Gradle versionCode。applicationId固定 `dev.remoteagent.app`、minSdk26，版本由 `tauri.conf.json` 和发布版本脚本同步管理；Android versionCode必须高于旧公开 APK 的31与本轮debug候选的32。

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


## 本机集成记录（2026-11-13）

使用 NDK27.2.12479018、Java17、真实 Android `aarch64-linux-android` target。独立 SDK cross-check 实际通过（44.55秒），首次完整 mobile Rust 编译通过（1分54秒），包含真实 account/transport/auth/system 及生成 ACL；本地 path 插件自动写入 Gradle，auth 与 system 均实际被包含。首次 Kotlin 编译暴露两个插件都需要直接 AppCompat 依赖，现已分别由各 owner 修复；system Kotlin 与7项 ExportStore JUnit 已通过。

后续 canonical 构建已完成 Rust Android 编译、assemble、variant lint（0 error、38 warning）、system 11项、auth 8项、patched core HTTP 7项单测，以及 APK 内容/签名/ELF与ZIP16KiB检查。运行中的测试依赖由 Gradle 正常下载，未借用真实账号或任何设备。官方 Android AAR 固定2.0.3，JVM core 使用附带来源摘要与小范围 HTTP patch 的本地模块；独立验收确认 refresh POST 单次请求、禁自动重试与重定向，见[HTTP独立审查](plan/reviews/mobile-auth-http-independent.md)。

首个完整 patched 候选 `cb20de40` 包含 core、receipt、portal 与系统取消/关闭修复，但与主线后续用户名代码存在差异，因此仅作为构建证据；交付 APK 另从主线完整产品源码增量重建。编译、lint、单测和包内容验证与实际运行验收分别记录，不把旧基包或浏览器手机仿真视为最终 APK 验收。

主线产品候选由 `1ebe60ae63bd7be8c88e250f53a771332cf134bf` 构建，主线 `5487218` 与其产品代码零差异（文档可不同）；包含 `ea7b3c1` 的用户名与 WorkspaceContext 更新，以及移除不支持 TV 声明的 lint 修复。canonical Android Rust 编译与 assemble/lint/unit/checker 均通过。候选为 arm64 debug、117054564 bytes，保留在 ignored `artifacts/anywork-android-native-candidate.apk`，SHA-256：

```text
0c24ca3d01738e85ab3397555fc65fbd401b577f0f5891612948b34f77b75f51
```

该候选用于隔离 APK 运行检查；正式四 ABI、发行签名与版本递增由精确源码 GitHub Checks 和 Release 工作流完成，不将 debug 候选当正式下载包。

[最终无账号 APK 独立运行验收](plan/reviews/mobile-apk-runtime-independent.md)已通过，实际安装字节与该 hash一致。API35官方fresh guest验证真实Origin/IPC/ACL、离线启动、保存读回与取消、分享面板、图片选择器、IME/insets、Back、系统栏、外链、公开内嵌登录及取消、强停后重启。未使用真实账号，实际登录/refresh、设备目录、真实远程电脑工作区、实体中文IME及发行覆盖安装仍不作已测声明。临时镜像/SDK/AVD、emulator及其overlay已回收。

transport 的显式 ring Connector 在双 provider、未初始化 global provider 的独立进程中通过6项真实 loopback WSS测试，包括可信CA exchange、生产WebPKI拒绝未知CA、可信CA但主机名错误拒绝。shell 在原生入口安装 ring 默认 provider 保护其它SDK调用；transport 不依赖该全局初始化。没有禁用证书或主机名验证。
