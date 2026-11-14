# Android shell 与构建

唯一移动包为 `crates/mobile`（library `anywork_mobile`），工程为 `crates/mobile/gen/android`。旧 Java Custom Tab 工程已从当前源树移除，Git旧tag仍完整保留，发布守卫仅在新路径404时读取旧tag Gradle versionCode。applicationId固定 `dev.remoteagent.app`、minSdk26，版本由 `tauri.conf.json` 和发布版本脚本同步管理；Android versionCode必须高于旧公开 APK 的31与本轮debug候选的32。

```sh
npm ci
bash scripts/build-android.sh                         # debug/aarch64
bash scripts/build-android.sh --debug --target x86_64
bash scripts/build-android.sh --release --target aarch64,armv7,i686,x86_64
```

统一入口不运行adb、安装或选择设备。NDK固定27.2.12479018（r27c），从ANDROID_HOME/ndk读取，覆盖可能指向未安装r28的继承NDK_HOME；Java17、SDK37.0/build-tools36、Rust Android target及根npm依赖需预装。默认本机SDK位置为 ~/Library/Android/sdk，Linux/CI应显式设ANDROID_HOME。不复制node_modules或target；worktree可链接主node_modules，Rust由协调者通过CARGO_TARGET_DIR共享主target、CARGO_INCREMENTAL=0复用。

Tauri CLI2.12.4构建先执行 `npm run build:mobile-ui`；真实 `web/mobile.html` 经Vite到 `web/dist-mobile`，由Tauri macro嵌入Rust库。`scripts/check.sh`及Checks workspace前置也构建mobile assets，host插件明确报SYSTEM_UNAVAILABLE，不伪造Android成功。Android build后运行每个所选ABI flavor当前variant的lint，以及实际存在的App Debug JVM、system/auth Debug与core单元测试；优化Release不提供App Release UnitTest component，不能拼接不存在的任务名。后置检查排除两种profile的Rust构建任务，不重复编译原生库或启动设备。默认arm64 debug输出为 `artifacts/anywork-android-debug.apk`，Checks成功后公开CI artifact保留7天。构建统一使用Tauri CLI `--split-per-abi`，每个APK仅包含所选ABI对应的Rust库，不生成universal发行包。一次四target调用只执行一次前端构建，再由Gradle分别assemble四个ABI flavor。

| CLI target | Android ABI | Gradle flavor | Release输出 |
| --- | --- | --- | --- |
| aarch64 | arm64-v8a | arm64 | `release/anywork-android-arm64.apk` |
| armv7 | armeabi-v7a | arm | `release/anywork-android-armv7.apk` |
| i686 | x86 | x86 | `release/anywork-android-x86.apk` |
| x86_64 | x86_64 | x86_64 | `release/anywork-android-x86_64.apk` |

单target调用仅交付该行的包；四target调用生成四包，不生成`anywork-android.apk`或重复alias。非arm64 debug包命名为`artifacts/anywork-android-{armv7,x86,x86_64}-debug.apk`。脚本逐包调用`check-android-apk.py --profile <profile> --abi <Android ABI>`，要求该包恰好包含对应的`libanywork_mobile.so`，所有native库均来自该ABI且ELF class/machine相符。即使本地JNI目录有其他ABI旧库，foreign ABI若进入APK也会使检查失败。

浏览器回归使用两个明确服务：普通 Web 配置由 `scripts/e2e-server.py` 提供 `web/dist`；手机专项配置 `e2e/mobile.config.ts` 启动 mobile Vite 入口。普通配置必须精确排除两份手机 spec，完整检查脚本再显式执行手机专项全部用例。不能把 `/mobile.html` 用例交给没有该入口的普通 Web 服务，也不能仅排除而漏掉 CI 中的手机回归。

签名兼容旧应用：release要求 ANYWORK_ANDROID_KEYSTORE、ANYWORK_ANDROID_STORE_PASSWORD、ANYWORK_ANDROID_KEY_PASSWORD，alias默认为anywork，可用 ANYWORK_ANDROID_KEY_ALIAS覆盖。凭据仅由环境交Gradle，不写入仓库。APK验证工具检查package/version/minSdk、Rust native lib与所有已构建HTML/JS/CSS资产key、签名证书、ELF PT_LOAD 16KiB及zipalign16KiB。release证书必须与配置keystore一致；是否与历史已安装包同证书还需核对历史APK证书，不能单凭applicationId宣称可升级。

Release启用R8优化。官方Logto Android AAR保留core.type的反射字段；jose4j经SLF4J1.7使用的可选StaticLoggerBinder缺失时，库本身回退NOP logger。应用规则仅精确忽略该可选类的缺失诊断，其他缺失类继续失败；不能用debug成功替代实际Release R8验证。v0.1.32曾在该步骤失败且未发布，详见[合并记录](plan/reviews/android-native-merged.md)。

### Android Release 体积策略

canonical `scripts/build-android.sh --release` 在该进程及其 Tauri/Gradle/Cargo 子进程内固定 `CARGO_PROFILE_RELEASE_DEBUG=0`、`CARGO_PROFILE_RELEASE_STRIP=symbols`。保留 Cargo release 默认的 opt-level=3 与 panic=unwind，不改工作区/桌面的 release profile，也不改 debug 构建。直接运行 Gradle/Tauri 而绕过 canonical 入口不保证使用这一体积策略。四 ABI、JNI 动态导出、SDK/TLS 功能及 native 库未压缩的 16 KiB 对齐打包保持原有契约；不以压缩 ZIP 或删 ABI 代替库本身优化。未启用额外LTO或改变codegen-units；仍须走完整 R8、lint/JVM 和 APK checker。

公开 v0.1.34 APK 的实测基线为 204,082,412 bytes，SHA-256 `3d5f47736b953e12a8d7423af60fb1cc34c7c0232a673f7b3557d8783854ea74`。其中四 ABI `libanywork_mobile.so` 合计 202,223,752 bytes（99.09%），DEX 压缩后 925,494 bytes、APK assets 3,160 bytes（业务 UI 嵌入 Rust ELF）。四个 ELF 均还含 `.symtab`/`.strtab`，没有 `.debug_*`。对下载包的库副本执行 NDK27 `llvm-strip --strip-all`，合计减少 55,516,600 bytes，保留全部 25/24/24/24 个动态导出；这是离线实验，不能替代优化源码的实际成包结果。

| ABI | v34 ELF bytes | 离线 strip 后 bytes |
| --- | ---: | ---: |
| arm64-v8a | 54,194,168 | 37,382,072 |
| armeabi-v7a | 40,303,804 | 26,709,156 |
| x86 | 54,073,036 | 41,894,076 |
| x86_64 | 53,652,744 | 40,721,848 |

本轮测量和测试签名候选仅保存在作者 worktree 的 ignored `artifacts/` / `release/`；候选不公开、不覆盖旧 tag 或附件，不使用正式发行私钥或真实账号。

2026-11-14 按协调者安排，以 main `acd16b6502e521685794fbfad6e10075950d3fd7` 合入 mobile SDK admission 恢复候选 `fa47cc5bb5a76c9889845af8d89d1bf3160cef49`，得到构建源码 `94609a70b0dd7d94101aa98f3cd3d5bdecca4b13`。实际执行 `bash scripts/build-android.sh --release --target aarch64`，398.19 秒退出 0，得到唯一的 `release/anywork-android-arm64.apk`：

| 项目 | 实测结果 |
| --- | --- |
| APK bytes | 39,192,755；比 v34 四 ABI APK 减少 164,889,657 bytes（80.7956%） |
| APK SHA-256 | `a155d3e53e4d0aca172d2bf6f040dd7404edc5b40ae48620ad4294e73365a0fd` |
| ARM64 native bytes | 37,349,816；比 v34 同 ABI 库减少 16,844,352 bytes |
| ELF 符号 | 无 `.symtab`、`.strtab`、`.debug_*`；保留基线全部 25 个动态导出名称 |
| native 打包 | 唯一 ARM64 库、ZIP method=0、`extractNativeLibs=false`；ELF/ZIP 16 KiB 通过 |
| 身份 | `dev.remoteagent.app`、versionName `0.1.34`、versionCode `36`、minSdk `26` |
| R8 / lint | 实际 split assemble 生成 R8 9.3.16 mapping；ARM64 Release lint 0 error / 23 warning / 1 hint |
| JVM | system 11、auth 8、patched core 7，共 26 tests / 0 failure / 0 error / 0 skipped；App UniversalDebug JVM 为 `NO-SOURCE` |
| canonical APK checker | 精确 ARM64、身份、当前本地 UI asset keys/NOTICE、测试证书及 ELF/ZIP 16 KiB 全通过 |

该 APK 使用新建 RSA2048 临时测试证书（SHA-256 `d0bf4441e55318f2a9e632f85e0f666b73412b1f0b015ddb313c4cb3a51e31da`），完成后已删除临时 keystore。未安装、上传或作为正式下载，未读生产私钥、真实账号或设备。保留的 0.1.34/code36 只是本次构建身份，不是新发行版本；测试证书不证明正式覆盖升级。

原始日志 `artifacts/arm64-split-strip-release.log`、`arm64-build-status.json`、`arm64-release-verification.json` 和 `arm64-candidate/` 的 ELF/manifest/签名明细均为 ignored 证据。此体积下降包含按 ABI 分发和 strip 的共同收益，不能把单 ABI 下载包与四 ABI 安装占用混为一谈。该轮仅验证实际 ARM64 包，其他三 ABI、正式证书和最终版本由后续发行 matrix 分别构建与验收。本次 mobile 候选只修已复现的 SDK admission 恢复问题，不宣称已闭环用户首次 presence 状态未知或完成真实账号运行验收。

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

v0.1.32的实际Release发现可选SLF4J binding诊断，修复后v0.1.33已通过真实四ABI编译、R8与assemble，但后置脚本引用不存在的Release app unit任务。任务修复经真实Gradle枚举及双profile dry-run独立接受后，本机用临时测试签名实际跑通完整单arm64 canonical Release、Release lint/JVM与APK checker；证据见[合并记录](plan/reviews/android-native-merged.md)。测试签名包不作为公开发行；正式包仍须完整远端四ABI、发行证书与发布门禁通过。

正式[v0.1.34](https://github.com/ywateru/AnyWork/releases/tag/v0.1.34)现已完成精确源码Checks和全部Release目标，Android四ABI、R8、Release lint/JVM及完整APK checker实际通过。公开APK为versionName0.1.34、versionCode36；下载、摘要和官网恢复证据见[最终交付记录](plan/reviews/android-native-merged.md)。这不扩大此前隔离候选的运行验收范围；真实账号业务和正式覆盖安装仍另行验收。

后续正式 [v0.1.38](https://github.com/ywateru/AnyWork/releases/tag/v0.1.38) 已按 ARM64、ARMv7、x86、x86_64 分别提供 APK，versionCode 40，四个 Release 任务及统一发行门禁全部通过；不再生成新 universal 或重复 alias。实际下载大小、逐包独立验收与官网恢复见[分架构交付记录](plan/reviews/android-size-release.md)，旧 v0.1.34 原通用包保持不变。包身份/证书升级条件验证与实际实体设备覆盖安装分别记录。

transport 的显式 ring Connector 在双 provider、未初始化 global provider 的独立进程中通过6项真实 loopback WSS测试，包括可信CA exchange、生产WebPKI拒绝未知CA、可信CA但主机名错误拒绝。shell 在原生入口安装 ring 默认 provider 保护其它SDK调用；transport 不依赖该全局初始化。没有禁用证书或主机名验证。
