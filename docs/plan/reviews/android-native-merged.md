# Android 原生重构与网页账号合并验收

日期：2026-11-13。范围为网页账号显示与隔离修复、Rust/Tauri 2 Android 客户端、手机界面和系统能力、电脑宿主移动 Native client 授权。此前 Claude Desktop 真机桥连接及写入测试仍由用户后续手动执行。

## 源码与独立门禁

账号显示、Android 账号、HTTP patch、transport、手机 UI 和系统壳均有非作者报告，发现与修复过程保留于各报告：

- [网页账号](account-identity-visible-independent.md)：真实 SDK 的 UserInfo、跨标签账号切换、旧 owner cache 和迟到刷新写入。
- [Android 账号](mobile-account-independent.md)与[HTTP patch](mobile-auth-http-independent.md)：官方内嵌 WebView SDK、授权生命周期、固定上游 core 来源与单次 POST。
- [原生传输](mobile-native-transport-independent.md)：真实隔离网关、JS/Rust 联合调用、WSS TLS provider、超时与取消。
- [手机 UI](mobile-ui-independent.md)：草稿 revision、未知回执保护、审批/子会话不重放、预览安全区。
- [系统壳](mobile-shell-independent.md)：满队列关闭通知及慢 provider 取消。

`6554d0c` 的模板 TV 声明删除由非作者确认符合手机产品范围，保留手机 MAIN/LAUNCHER、权限和 FileProvider；主线对应提交为 `5487218`。没有通过关闭 lint 或增加 baseline 忽略该问题。

## 合并检查

| 检查 | 结果与边界 |
| --- | --- |
| Web、mobile、desktop UI 生产构建 | 全部通过，包含 TypeScript |
| Web 单测 | 43文件、440项通过；private-state 8/8 |
| Rust 工作区测试 | 376通过、0失败、8忽略；真实历史、显式联网诊断与实际升级等 opt-in 项保持忽略 |
| Rust 工作区 build、fmt、全 targets 严格 clippy | 通过；clippy以最终lint修复后的完整产品树执行 |
| 前端格式、双语网站构建与响应式检查 | 通过 |
| 源码归档/版本/发布器/Release CI/容器脚本守卫 | 56/56，通过的是隔离 fixture，未冒充真实发布或 Docker 构建 |
| 手机浏览器集成 | 30/30；公开 IPC 合成边界，见[专项记录](mobile-final-integration.md) |
| Android canonical 构建 | arm64 debug assemble、lint（0 error、38 warning）、system/auth/core 11/8/7单测及 APK checker通过 |

严格 clippy 初次发现 host 未使用的 Android parser 和三处嵌套条件；`3561a93`（主线`8c4baab`）限定parser为Android与测试使用，保留Android真实grid校验，三处let-chain保持短路/错误传播/清理顺序。非作者复核通过，mobile36/36回归通过。后续暴露的auth测试`.err().expect()`改用固定失败信息match，不给敏感成功DTO新增Debug（`fae916e`，主线`543ff88`）；非作者复核、auth库测试及完整workspace全targets严格clippy与fmt通过。最终验证产品树与主线零差异，故不重复已绿全量测试，也不为这些等价或仅host/test修正重建APK；正式发行CI仍从精确源码重新构建。未使用整体 allow 或删除验证断言规避门禁。

## APK 来源

产品候选源码 `1ebe60ae63bd7be8c88e250f53a771332cf134bf` 与主线 `5487218` 产品零差异，包含用户名、portal、core、receipt和系统取消/关闭修复。debug APK 为117054564 bytes，SHA-256：

```text
0c24ca3d01738e85ab3397555fc65fbd401b577f0f5891612948b34f77b75f51
```

包名 `dev.remoteagent.app`、versionName0.1.30、versionCode32、minSdk26；包内 Rust arm64库、全部本地HTML/JS/CSS资产及NOTICE、debug证书、ELF/ZIP16KiB检查通过。此为隔离运行候选，正式发行版本、四ABI与签名由 GitHub Release 完成。

## 运行与发布门禁

隔离官方 API35 Google APIs arm64 模拟器的[无账号 APK 独立运行验收](mobile-apk-runtime-independent.md)通过，实际安装字节的 guest SHA-256与上述候选一致。真实本地 Origin/IPC/ACL、离线启动、DocumentsUI 保存并读回、取消、系统分享面板、图片选择器、IME/insets、Back、系统栏深色图标、HTTPS外链、公开内嵌登录页及两次取消、强停后离线重启均已验证。临时输入控件和系统桥合成内容只证明相应原生边界，不冒充远程业务。

没有使用真实账号、旧 AVD 用户数据或在线手机。实体设备、真实账号登录/refresh及目录、真实远程电脑业务、中文 IME、持续后台连接及正式包覆盖安装仍未实测。官方临时镜像/SDK/AVD、自己的 emulator与overlay已全部清理，原SDK和用户资料保留；清理后的可用空间以后续交付记录为准。

发布使用既有一键发布器，只推主线与对应不可变版本tag，不推私人分支。精确源码 Checks、全平台 Release、正式官网与轻量产物核验均是后续发布门禁；当前报告不把旧 v0.1.30 的线上结果计作本轮发布。

首次v0.1.31候选等待远端Checks期间发现浏览器配置接线问题：普通Playwright配置误收集两份手机spec，其服务只提供Web产物，缺少`/mobile.html`。正确手机专项配置的30项已通过，但这不等于主CI接线正确。候选未创建tag或Release；取消被替代检查后，按契约修正普通配置精确排除并在完整检查显式运行手机专项，复核后以新的递增版本重新提交精确Checks。此处明确记录配置缺陷，不在缺少日志证据时将此前所有远端等待归因于手机用例。产品源码与APK运行结论不因此扩大，原运行记录保留。

非作者随后核对取消运行`43416531358`的server-web日志：普通E2E实际收集740项；取消前已观察到desktop项目下30项手机spec失败，其中26项耗时30.0–30.1秒，另4项约5.3–5.4秒。android-web当时仍在运行普通spec，不能记为60项全部超时；日志未给详细失败栈或404，具体错误类型亦不扩大推断。后续远端format/site步骤被跳过，本机相应通过记录仍独立有效。

CI接线修复`a116f31`（主线`b484b52`）经非作者独立复审通过：普通配置680项/44文件、mobile配置30项/2文件，无重叠、未新增skip；完整脚本无条件先运行专用mobile，再运行普通Web。专项30/30再次通过，未修改spec或断言、未改变产品行为及APK。列表收集与实际执行时的既有project skip分开统计，见下文。检查日志和独立摘要保留于ignored `artifacts/mobile-ci-independent/`，不把离线核对当作新版远端Checks成功。

## v0.1.32 精确检查与 Release 失败记录

源码`8c3cf123fbccfb43efb2c2f095f1978d9be02b1c`的[Checks 43421353163](https://github.com/ywateru/AnyWork/actions/runs/43421353163)五项全部成功。远端日志确认mobile30 passed/0 skipped/0 failed；普通Web收集680项，其中679 passed、1 skipped、0 failed。唯一skip为android-web下只适用于桌面参考截图的既有用例。另有前置sidebar/model-picker42 passed，不与680重复计数。format及中英文各5视口的site-test均实际执行并通过。

该tag的[Release 43424798695](https://github.com/ywateru/AnyWork/actions/runs/43424798695)五个桌面目标及source-web均成功；Android四种ABI的Rust release库亦完成编译，但R8报`Missing class org.slf4j.impl.StaticLoggerBinder`，在`:app:minifyUniversalReleaseWithR8`失败。Android artifact未上传，publish跳过，未创建公开Release。不可将桌面包成功推广为本轮发布成功，也不改动已有v0.1.32 tag。

依赖为jose4j0.9.6经slf4j-api1.7.36使用可选binding；实际LoggerFactory字节码在缺失binder时捕获错误并回退NOP。最小修复`26413eb`（主线`b21449f`）精确忽略该可选类的R8缺失诊断，保留现有fallback，不关闭优化、不使用包级或全局忽略，不改变认证校验。非作者重新核对真实JAR字节码、Release规则加载和唯一变更后接受；新版本实际R8结果仍须作为发布门禁。原日志与证据保存在ignored `artifacts/release-android-failure/`。

## v0.1.33 实际 R8 与后置任务修复

源码`37d901a33c34c5be846b03266626bbe4213a6c32`的[Checks 43428936228](https://github.com/ywateru/AnyWork/actions/runs/43428936228)五项全部通过，非作者核对mobile30 passed，普通Web679 passed/1既有skip，format/site均实际执行成功。

[Release 43432444934](https://github.com/ywateru/AnyWork/actions/runs/43432444934)五个桌面目标及source-web成功；Android四ABI release编译、R8与APK assembly已完成并输出APK路径，因此前述SLF4J修复已通过实际R8。失败转到后置脚本，调用了当前AGP未提供的`:app:testUniversalReleaseUnitTest`。APK checker与artifact上传尚未执行，仍未创建公开Release；v0.1.33 tag保留。

修复`44eab4c`（主线`a77af19`）保留当前variant lint，App JVM使用真实存在的Debug unit任务，system/auth/core单测全部保留，并排除两profile的Rust任务以避免后置重复编译。非作者复核真实任务枚举及完整Debug/Release dry-run：分别201/243个任务，Release lintAnalyze/report/总任务均存在，四组JVM任务及编译依赖保留，任务图零Rust。dry-run标记SKIPPED不是单测执行成功。本机另以独立临时测试keystore运行完整单ABI canonical Release，实际结果完成后单独记录；不将测试签名APK作为公开发行包。

### 本机实际 canonical Release 闭环

修复源`44eab4c981a62f61cb252f7b219b1c91c6551bc5`与主线`a77af19`产品代码零差异。本机使用新建的临时测试keystore运行`build-android.sh --release --target aarch64`，实际完成Rust Android release、R8/assemble、Release lint、App Debug JVM任务及system/auth/core回归，最后APK checker通过版本/本地资产/原生库/测试签名证书及ELF/ZIP16KiB验证。App unit为NO-SOURCE，不把空任务记作测试用例；未删除任何现有JVM测试。后置Gradle实际205任务（100 executed、105 up-to-date），无额外Rust编译。

测试APK SHA-256为`6d8870644fd807ea6a8505916d594cfb18e1981da23ba7e318fedccee685f47a`。这是单arm64、临时测试签名的Release验证，不使用生产签名、真实账号或设备，不安装、不上传为正式发布。日志保留于ignored `artifacts/release-android-failure/v34-canonical-aarch64-release.log`。正式四ABI与既有生产签名仍由新版本精确源码Checks和Release工作流验证，不改动旧失败tag。
