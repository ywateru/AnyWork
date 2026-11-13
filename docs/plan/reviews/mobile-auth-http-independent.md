# SDK HTTP single-attempt 独立审查

2026-11-13，非实现者审查。结论：**本轮 HTTP patch 与必要 Gradle 接线通过审查，原始 SDK 内层 POST 重放 P1 在此范围内关闭，无剩余 P1/P2。可推进 main 集成和 patch 后 APK 验收。** 这不是完整 Android 客户端或真实授权服务器验收；本报告完成时尚无已供核验的 patch 后 APK。

## 精确候选与工作边界

| 项目 | 提交 / 来源 |
| --- | --- |
| review WT / branch | `.worktrees/mobile-auth-http-review` / `codex/mobile-auth-http-review` |
| review base | `eba7be6` |
| 冻结契约 | `7b10e1f150e120e4dde18c9342d182054332161a` |
| Bacon HTTP patch | `9c414c3cc23a331d90f80a07b2737a8886dfd5b2` |
| review WT cherry-pick | `b420d79` |
| Boole Android 接线，只读核对 | `e13b5f4f5ecbbfbccc2d5786250a354bd199081f` |
| 上游 Logto core 2.0.3 | `3efc22a59ecd9f020bf6af58bd47d6a4f292b140` |

已读 `docs/android-account-entry.md`、`docs/mobile-native-contract.md`、`docs/plan/tasks/android-native-client.md`、`docs/plan/analysis/android-native-client.md` 及契约提交；指定 WT 的上级与相关文档目录未发现适用 AGENTS.md。base 尚无 auth plugin README 与 Android build 文件，cherry-pick 出现两处 modify/delete 冲突；均保留作者候选完整版本，未另写产品修复。Boole 的生成工程接线通过 `git show` 核对，未搬入缺少其构建基线的 review WT。

审查者仅新增本文档。未修改 main、作者 WT、共享 Cargo/lib/lock；未运行 Cargo、安装依赖、复制依赖缓存、读取真实账号/凭据、操作在线手机/授权服务或下载镜像。JVM 测试使用已缓存依赖和 loopback 合成数据；Gradle 使用窗口与 Boole 协调，使用 core 自带 standalone settings，未争用 gen/android configuration cache。

## P1 的独立闭环证据

原版 core 的公开 `Core.fetchTokenByRefreshToken` 使用普通 FormBody 和默认 OkHttp。审查者以旧官方 jar 编译 Java probe，再分别加载旧 jar 和候选本地 jar；真实 MockWebServer 返回 `503 Retry-After: 0` 时，**旧 jar 收到 2 次 POST，候选收到 1 次**。均实际收到完整 refresh 表单并等待 SDK callback 终结，非仅断言配置字段。

候选 `HttpRequest.kt` 保留全部公开入口，仅改变以下策略：

- `retryOnConnectionFailure(false)`、`followRedirects(false)`、`followSslRedirects(false)`。
- connect/read/write/call timeout 为 15/30/30/60 秒；whole-call 上限不因 I/O 活动延长。
- 全部非空 POST body 用私有 OneShotBody 包装；`isOneShot()` 为 true，content type、content length、duplex 属性和写入字节均委托原 body。

固定 [OkHttp 4.11.0 拦截器](https://github.com/square/okhttp/blob/parent-4.11.0/okhttp/src/main/kotlin/okhttp3/internal/http/RetryAndFollowUpInterceptor.kt) 已只读核对：I/O recover 与 408 会检查 retry policy；503 Retry-After 0 本身不检查该 flag，但主 follow-up 循环拒绝 one-shot body；421 在 coalesced-connection 条件之前先检查 one-shot；307/308 由禁重定向阻止。因此没有把单独 retry=false 当成充分修复。

未改 OAuth、PKCE/state、ID token 验证、表单构造、JSON 序列化或 owner 串行逻辑，没有反射或修改私有 SDK 字段。另只读检查作者候选的 `MobileAuthPlugin.token`：SDK 获取失败进入当前 generation 的 invalidate，不能继续使用旧 owner；既有 `unknown_rotation_retires_targets_and_blocks_old_owner` 回归仍在。作者报告 Rust 14/14 通过；**审查者未重跑 Rust，不将该结果计入独立运行数量**。本 patch 的网络实验不表示服务端在断线后回滚 rotation。

## 独立执行结果

所有命令 cwd 均为指定 review WT。

```sh
JAVA_HOME=/opt/zerobrew/opt/openjdk@17 \
  /Users/water/work/2026/any-work/.worktrees/mobile-shell/crates/mobile/gen/android/gradlew \
  -p crates/tauri-plugin-mobile-auth/android/logto-core/test-support \
  :anywork-logto-core:test --offline --no-configuration-cache --console plain
```

exit 0，`BUILD SUCCESSFUL in 4s`，4 tasks executed；JUnit XML 为 **7 tests / 0 failures / 0 errors / 0 skipped**。core 与测试均在此 WT 编译执行，非引用作者已生成的测试结果。

| 场景 | 独立重跑作者 JUnit | 审查者另写 probe，调用公开 refresh API |
| --- | --- | --- |
| 完整请求 body 后 EOF | 1 POST / 目标 0 | 1 POST / 目标 0；IOException callback，无 token 结果 |
| HTTP 408 | 1 / 0 | 1 / 0；保留 408 错误 |
| HTTP 503，Retry-After: 0 | 1 / 0 | 1 / 0；保留 503 错误；旧 jar 负对照为 2 POST |
| HTTP 421 | 1 / 0；实际 body one-shot | 1 / 0；保留 421 错误 |
| HTTP 307，有效 Location | 1 / 0 | 1 / 0；保留 307 错误 |
| HTTP 308，有效 Location | 1 / 0 | 1 / 0；保留 308 错误 |
| 成功 JSON 响应 | — | 1 / 0；token response 正常解析 |
| 显式策略与 15/30/30/60 秒配置 | 通过 | — |

Java probe 使用 JDK17 的 `javac -classpath <官方旧core及缓存依赖> -d <临时目录> RefreshProbe.java` 编译；以 `java -classpath <probe目录>:<旧或候选core>:<相同缓存依赖> RefreshProbe old|patched` 分两个进程执行，全部 exit 0，共 **1 个旧版负对照 + 7 个候选用例**。依赖为 OkHttp/MockWebServer 4.11.0、Okio JVM 3.2.0、Gson 2.13.2、Kotlin stdlib 2.2.10、JUnit 4.13.2、Hamcrest 1.3；Gson 使用 Android 已有解析版本。

probe 实际调用 `Core.INSTANCE.fetchTokenByRefreshToken`，校验 method、Content-Type、完整收到的五个字段 client_id/refresh_token/grant_type/resource/scope（含 `+/?` 编码保真）、错误状态和成功 JSON；等待 callback 后检查源/目标 request count。两台 server 均预放第二个成功响应，错误重发能显式失败而非因夹具无响应挂住。未打印真实凭据；所有值为固定合成字段。EOF 用 DISCONNECT_AFTER_REQUEST，服务端收到完整 body 后关闭。一次 MockWebServer 日志提示连接未形成请求，最终完整 POST 数与 callback 断言均通过，未当成第二次 POST。

**421 的运行夹具为 HTTP/1，不是 HTTP/2 coalescing 实测。** 关闭该重发分支的依据是实际 outgoing body one-shot 断言及固定 OkHttp 中先于 coalescing 的检查。超时值有独立断言，本轮未故意等待 60 秒做耗时实验。未为这些边界追加依赖或大型编译。

## 来源、patch 与 ABI

独立通过 GitHub fixed-revision tree 核对上游目录含完整 **33 个 Kotlin 文件**（tree 未截断），再并行只读获取固定 revision 的 raw 文件，逐项计算 SHA-256：**33 source + LICENSE + 原始 catalog/build 共 36 项**的 upstream/local 摘要全部匹配 `SOURCE.json`。以下载内容自行生成 unified diff，唯一变化为 `HttpRequest.kt`，且与 `source.patch` 逐字一致；不是仅信任作者生成的 manifest 或 verifier 结果。archive 本体未重新下载，`archive_sha256` 未独立复算。

保留的 catalog 为 OkHttp 4.11.0、Gson 2.10.1、jose4j 0.9.6；本地 module 严格固定 OkHttp 4.11.0，保留 jose4j 的 `api` 范围，Gson 允许 Android 现有 2.13.2 向上解析。JVM17/Kotlin2.2.10 与宿主构建匹配。根 LICENSE 原文为 MIT，原 Maven build 声明 MPL-2.0 的差异已如实记录并保留原文；本轮未另行进行许可证法律判断。

对缓存官方 2.0.3 jar 与此 WT 编译 jar 执行 `javap -public -s`：**49 个公开 class 的既有方法、字段与 JVM descriptors 均保留**，包括公开嵌套类和三个 makeRequest overload。36 个顶层 class 也单独比对通过。首次扩大到所有 52 个编译 class 的比对发现两个 package-private lazy lambda 实现类不再生成，属 Kotlin2.2 编译器实现差异；更正为公开 ABI 比对后通过，未将该次全 class 比对声称为通过。公开 refresh probe 本身先链接旧 ABI，再加载新 jar 成功。

官方缓存二进制 SHA-256：

- `io.logto.sdk:kotlin:2.0.3` jar：`3430053de8c7004eb47921070c53ec15d4d9697505be4236da77373c64c912f6`。
- `io.logto.sdk:android:2.0.3` AAR：`5812530695ea074885314c05bdd1e04ea81e9fab683848f80c2e8ab1eb8b402b`；独立检查其 classes.jar 内无 `io/logto/sdk/core/` class。

## Android 接线证据：Boole 执行，审查者读取

`e13b5f4` 只新增 core settings include/projectDir 与 JVM plugin 注册。路径从 gen/android 正确指向 `../../../tauri-plugin-mobile-auth/android/logto-core`；JVM plugin 由已有 `kotlin-gradle-plugin:2.2.10` buildscript classpath 注册 apply false，没有重复指定 DSL version。auth build 排除 `io.logto.sdk:kotlin` 并明确 implementation 本地 module，仍使用官方 `io.logto.sdk:android:2.0.3`。

亲读以下真实 gen/android Gradle 日志，并核对稳定接线提交；**这些 Android 任务由 Boole 运行，非本审查者重跑**：

| 任务 / 配置 | 结果 | 日志 |
| --- | --- | --- |
| `:app:dependencyInsight`，`universalDebugRuntimeClasspath`，Android SDK artifact | `io.logto.sdk:android:2.0.3`，AAR runtime variant；exit 0，4 秒 | `/tmp/anywork-logto-android-insight.log` |
| 同配置，本地 core；`:tauri-plugin-mobile-auth:testDebugUnitTest` | `project ':anywork-logto-core'` 经 auth 接入；core/auth 编译与 JUnit task BUILD SUCCESSFUL，10 秒；Boole 报告 auth 8 项 | `/tmp/anywork-logto-patched-auth.log` |
| 同配置，旧 core 精确查询；`:app:checkUniversalDebugDuplicateClasses` | `No dependencies matching given input`；duplicate class task BUILD SUCCESSFUL，963ms | `/tmp/anywork-logto-duplicate-check.log` |

日志取证时 SHA-256 依次为 `52c827b4f82d0085b38e6698cffb662490c099ea70474dab395965ac4ffcfce1`、`1f9ec6fc3d1d3772bf79ec7161cd77b5a5f379e9ca42a0715492a528f16105dc`、`9a7aa56d74bee233b439e351d2f494ebe4404c96a71d7231432d670d72751656`。

这证明当前 debug runtime 依赖图和重复类检查符合替换要求；并不等同于已核验最终 APK 的 dex/metadata。未 patch 的旧 base APK 即使可用于隔离系统 UI 测试，也不能作为本 P1 已集成的交付证据。

## 剩余边界与交接

本轮无未闭环 P1/P2，不要求额外扩展审计或等待全客户端验收后才合入。后续由集成/APK lane 核验 patch 后 APK 的来源 hash、包内 metadata/dex 与实际依赖对应关系；本轮未验证 APK、真机/AVD、生产登录、真实 refresh 丢响应或授权服务器行为，也未运行 release 变体/R8。HTTP/2 coalescing 与真实 60 秒耗时实验的未测边界如上，不冒充通过。

独立 Gradle 和 Java fixture 已结束，无运行测试 session；review WT 自建 build/.gradle 与临时 probe 清理，共享 Gradle 缓存、作者日志、他人 target/WT 保留。报告交回 Bacon、Boole 与协调方，审查者不实现产品或执行 main 合入。
