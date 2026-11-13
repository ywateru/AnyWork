# Android 原生账号：独立源码预审

本轮只读审查作者 `951c22c`（内部 Android auth plugin）及 `fc9f307`（account/directory 与后续生命周期调整）；使用 `git show <commit>:<path>`，没有将未稳定实现合入本 review 分支。审查分支另以 merge 保留历史，同步了包含用户名修复及移动骨架的 main。没有修改产品源码、执行真实登录或构建 Android 大产物。

**结论：尚不标记 accepted。已发现一项 P2 恢复性问题并直接交作者，随后独立只读复核其 `7d21a62` 修复，源码已回应，定向运行待稳定集成。另确认 SDK 内层可隐式重发 refresh POST，严格“未知结果不重发旧 grant”的承诺尚不成立，已交协调处理。** 编译、实际 Maven 依赖解析、完整 APK 和合并 shell 的信任提交时序仍是后续独立验收门槛，不因源码可读或作者夹具通过而自动成立。

## P2：纯 UserInfo GET 失败错误退休已验证授权

位置（均为 `fc9f307`）：`crates/tauri-plugin-mobile-auth/android/src/main/java/dev/anywork/auth/MobileAuthPlugin.kt:198-217` 的 `readProfile`，关联 `signIn:172-184` 及 `profile:243-251`。

`readProfile` 无条件调用 `fetchUserInfo`；即使 ID claims 已有可验证的 subject/name，资料 GET 暂时离线或 503 也会抛异常。登录路径把它转为 `invalidate(MOBILE_AUTH_SIGN_IN)`，已有资料的 profile 刷新则对任意异常执行 `invalidate(MOBILE_AUTH_REAUTH_REQUIRED)`。资料服务故障因此被误作授权失效，丢弃已验证展示并要求重新登录。

最小修正：区分 token/rotation/identity 错误与纯资料 GET 错误。后者保留同 owner 的已验证 claims 或同 subject 旧 profile，报告可重试的 `MOBILE_PROFILE_UNAVAILABLE`；subject 不匹配及未知 token rotation 仍须 fail closed。

作者修复 `7d21a62f53057a016b97b1fd6d7b9049c2c992c3` 已独立只读复核：新增 `VerifiedProfile.kt` 按官方错误类型名仅将 `UNABLE_TO_FETCH_USER_INFO` 视作 recoverable；合并已验证 claims/同 sub 旧 profile，其他 token/identity 错误仍使 owner 退休。登录改为读完 profile、再检查 generation 后同步发布 signedIn/profile，避免注销期间的迟到赋值；Rust refresh 重试资料，保留 warning 到 ready directory，登录则避免重复资料 GET。新增四项 Kotlin 用例和 Rust warning/retry 用例的断言与修正目标一致；这些是异常分类/reducer 与 fake backend 测试，不能称为真实 HTTP 503/native 验收，本轮尚未独立执行。源码层问题已回应，独立定向运行后再关闭验收项。

分类的公开依据是固定 Logto Android 2.0.3 源码 `3efc22a59ecd9f020bf6af58bd47d6a4f292b140` 的 [LogtoClient.fetchUserInfo:403-425](https://github.com/logto-io/kotlin/blob/3efc22a59ecd9f020bf6af58bd47d6a4f292b140/android-sdk/android/src/main/kotlin/io/logto/sdk/android/LogtoClient.kt#L403-L425)：其内部 getAccessToken 错误原样传出；仅 Core 资料请求错误包装为 `UNABLE_TO_FETCH_USER_INFO`。回归须覆盖 claims 可显示而 UserInfo 503、已有 profile 刷新 503、rotation 失败仍退休、UserInfo sub 不匹配仍拒绝。

## 已核对的源码边界

- `RamClient` 使用官方 SDK 的 protected `accessTokenMap`，未读取私有 manager 或反射；`usingPersistStorage=false`，refresh/ID token 留在 SDK 内存。原生 access-grant DTO 不实现 Debug/Serialize，仅供 Rust 使用。
- Kotlin `operation` 为进程级 mutex，sign-in、profile、token、logout 共用；logout 在排队前增 generation/清展示/取消本 attempt，已派发 rotation 独立于 Rust 等待 future 完成。未知 rotation 结果仍禁止复用旧 owner。
- `AuthLifecycle` 只追踪 SDK 登录 Activity，取消时 finish 自己的活动，等待销毁屏障后释放全局 operation。ContentProvider 在应用 Activity 恢复前安装 lifecycle callbacks，无 RAM attempt 的登录 Activity 会关闭。源码方向符合取消 A 后才能开始 B；当前三个 Robolectric 用例未完整运行真实 SDK manager 的 A→B 交接，本轮也未独立执行它们。旋转、迟到销毁、进程重建以及回调用例仍需验收。
- callback 固定为既有 Native 的 loopback scheme/authority/path，交官方 WebView client/manager 截获；没有监听 loopback HTTP 端口，没有新造 Android callback intent-filter。[SDK manager](https://github.com/logto-io/kotlin/blob/3efc22a59ecd9f020bf6af58bd47d6a4f292b140/android-sdk/android/src/main/kotlin/io/logto/sdk/android/auth/logto/LogtoAuthManager.kt#L27-L45) 匹配 redirect，之后 [CallbackUriUtils](https://github.com/logto-io/kotlin/blob/3efc22a59ecd9f020bf6af58bd47d6a4f292b140/kotlin-sdk/kotlin/src/main/kotlin/io/logto/sdk/core/util/CallbackUriUtils.kt#L22-L58) 核对 URI/state，拒绝重复 query 参数，code/verifier 由 SDK 换 token；不把这当成生产注册已验收。
- `scopeId` 由固定域分隔符、issuer、client、subject 的 JSON 数组作 SHA-256，未掺入随机 epoch/generation，符合重启后同身份稳定的要求。displayName 缺失时仅回退“已登录账号”，没有用设备名称/subject 冒充用户名；profile GET 恢复问题单列如上。
- plugin 的 build command 表为空，Rust builder 没有 guest invoke handler；当前 `mobile-main` capability 未授予任何 mobile-auth 权限。实际 Tauri 2.12.5 `webview/mod.rs` 在 mobile command fallback 前检查 plugin command ACL；Rust `PluginHandle::run_mobile_plugin_async` 直接走内部 native dispatch。因此内部调用路径无需给业务 JS 开 token/get/credentials 权限。合并后的 capability 和实际拒绝行为仍须再验。
- 登录窗口是官方 SDK Activity，只含 SDK Polyfill/SocialHandler interface，没有创建 Tauri 业务 WebView 或 AnyWork IPC；固定来源告知在启动前的原生 dialog，系统返回取消，不虚构授权窗口来源顶栏。已区分 SSO cookie 与 RAM application grant。
- `grid.rs` 创建 Native SDK client，绑定 auth provider 后走 `login_with_auth_provider`，校验 session subject、device purpose、app/product，再读 devices；不使用 console。保留同实例处理未知 registration outcome，避免另造 admission/registration key。heartbeat/recovery 依赖固定 SDK 实现，仍需与最终 Android 依赖和无账号协议夹具共同核验。
- directory target 只由 Rust ready directory 构造，限制 gateway policy，确认精确公钥/版本和 epoch/revision。prepare 不写 trust，`TrustCommit` 是 native-only 单次值，commit 再检查 epoch/revision/lifetime，文件仅保存 scope/installation hash 对应的公钥 pin。**当前模块不能独自证明“只在握手成功后持久化”**：必须继续审合并 shell 的调用顺序，失败握手不得 commit，commit 失败必须关闭连接；现有测试中的 drop prepared 不是执行真实失败握手的替代。

## SDK 默认日志与异常材料

独立读取固定 SDK 的公开请求/异常实现。[HttpRequest.kt:19](https://github.com/logto-io/kotlin/blob/3efc22a59ecd9f020bf6af58bd47d6a4f292b140/kotlin-sdk/kotlin/src/main/kotlin/io/logto/sdk/core/http/HttpRequest.kt#L19) 默认构造 `OkHttpClient()`，没有安装请求/body logging interceptor；所查生产 Kotlin 源码未发现主动 Log/println/printStackTrace 输出路径。不能据此承诺系统 WebView、依赖或崩溃工具在所有运行条件下均无敏感输出，最终 APK 还须做合成错误日志验收。

异常不是无敏感值容器：[ResponseException](https://github.com/logto-io/kotlin/blob/3efc22a59ecd9f020bf6af58bd47d6a4f292b140/kotlin-sdk/kotlin/src/main/kotlin/io/logto/sdk/core/exception/ResponseException.kt) 保存 responseContent，HttpRequest 的非 2xx 分支会将 body 存入其中；callback 错误还能带 errorDesc/cause。因此不得把 SDK Throwable、cause、response body 或完整 callback URI stringify、返回业务页或写日志。

当前 Kotlin `invoke.reject` 均为固定常量，Rust internal call 再统一映射固定错误；没有把这些异常 body 跨 JNI/IPC 返回。读取 `exception.message` 只用于比较官方枚举类型名，不将其原值输出。后续 profile 错误分类也须保持这一边界。实际 artifact 版本解析与最终日志夹具检查尚待完成，未声称 Maven binary 与 tag 已做一致性验证。

## 待协调：SDK 内层 refresh POST 隐式重发

“AnyWork 外层没有 retry、最终 SDK error 后退休 owner”只能限制外层后续操作，不能阻止同一次 SDK 调用内部的 HTTP 重发。源码证据如下，均为精确版本；没有发出真实 token 请求或注入网络故障：

- 固定 Logto 源码 [libs.versions.toml:17](https://github.com/logto-io/kotlin/blob/3efc22a59ecd9f020bf6af58bd47d6a4f292b140/gradle/libs.versions.toml#L17) 声明 OkHttp **4.11.0**；最终 APK 的 Gradle resolution 仍需单独核对。
- [Core.fetchTokenByRefreshToken:141-149](https://github.com/logto-io/kotlin/blob/3efc22a59ecd9f020bf6af58bd47d6a4f292b140/kotlin-sdk/kotlin/src/main/kotlin/io/logto/sdk/core/Core.kt#L141-L149) 把 client/refresh token/grant type 放进普通 `FormBody`，经 `httpPost` 直接进入默认全局 `httpClient`。没有 one-shot body 包装或每请求 retry policy。
- OkHttp 4.11.0 [Builder:475](https://github.com/square/okhttp/blob/parent-4.11.0/okhttp/src/main/kotlin/okhttp3/OkHttpClient.kt#L475) 默认 `retryOnConnectionFailure=true`；[RequestBody.isOneShot:78-95](https://github.com/square/okhttp/blob/parent-4.11.0/okhttp/src/main/kotlin/okhttp3/RequestBody.kt#L78-L95) 默认 false，普通 [FormBody](https://github.com/square/okhttp/blob/parent-4.11.0/okhttp/src/main/kotlin/okhttp3/FormBody.kt) 没有覆写。
- [RetryAndFollowUpInterceptor:87-95](https://github.com/square/okhttp/blob/parent-4.11.0/okhttp/src/main/kotlin/okhttp3/internal/http/RetryAndFollowUpInterceptor.kt#L87-L95) 明示 IOException 分支的原请求可能已发送。[recover:144-200](https://github.com/square/okhttp/blob/parent-4.11.0/okhttp/src/main/kotlin/okhttp3/internal/http/RetryAndFollowUpInterceptor.kt#L144-L200) 检查 retry 开关、发送后是否 one-shot、异常可恢复和是否仍有 retry route；没有 POST 幂等性检查。因此某些可恢复 IOException 且仍有路由时可重发已发请求。ProtocolException、发送后的 SocketTimeoutException、证书握手/校验错误等不重试；不能误写为所有失败都重试。
- [response follow-up:229-284](https://github.com/square/okhttp/blob/parent-4.11.0/okhttp/src/main/kotlin/okhttp3/internal/http/RetryAndFollowUpInterceptor.kt#L229-L284) 还包括：408 在 retry 开启、非 one-shot、前次非 408、Retry-After 无正延迟时重发；503 在前次非 503 且 `Retry-After: 0` 时返回原请求，这一分支本身不检查 retry 开关；421 在连接被 coalesce 且 body 非 one-shot 时可重试。主循环 118-122 对 body 的 one-shot 再统一阻止 follow-up。
- 默认 followRedirects/followSslRedirects 亦为 true；[buildRedirectRequest:291-330](https://github.com/square/okhttp/blob/parent-4.11.0/okhttp/src/main/kotlin/okhttp3/internal/http/RetryAndFollowUpInterceptor.kt#L291-L330) 对 307/308 保留 POST/body，跨 host 只移除 Authorization header，不删除 form body 内的 grant。不得将“Header 去掉”误作 token body 不会跟随重定向的保证。

公开配置点核对：Logto `LogtoConfig` 没有 HTTP client/factory 参数；`LogtoClient` 也不接受 requester。Core 暴露的是顶层只读 `val httpClient by lazy { OkHttpClient() }`，不是可替换属性或支持的 per-client 配置入口。调用 `newBuilder()` 只得到新 client，不会替换 SDK 正在使用的对象；本次没有采用反射、改私有字段或重写 OAuth。

因此“最终错误后不再重试”不等于 token POST 最多一次。若契约要求严格禁止未知 rotation 的再次发送，需要协调受支持的上游 HTTP 扩展或维护的最小 SDK 修正，并以合成服务实际验证；不能仅加外层 mutex 或 `retryOnConnectionFailure(false)`，后者单独也未覆盖 503 follow-up/redirect。本文准确记录条件与限制，不声称已发生真实 grant 重用、已核对最终二进制或已完成该修正。

## 运行与后续验收

AVD 隔离启动的独立结果见 [设计审查后续记录](../analysis/android-native-client.md#后续隔离-avd-准备结果)：初次临时元数据视图避开原锁但 Emulator SIGSEGV；后按用户授权改为 stock image 初始化全新任务 userdata/cache/sdcard，并禁止读取原 AVD，已用宿主沙箱及 lsof 证明隔离。但 guest 因早期 `/dev/block/by-name/super` 缺失而循环重启、ADB offline，尚无可用 APK 验收实例；自有进程与临时盘/overlay 已清理，原 userdata/锁未修改。没有访问物理手机或已有应用账号。

继续等待稳定修复及 shell 集成提交后，核验 P2 修复、真实依赖编译、Kotlin owner/生命周期夹具、merged capability 拒绝直接 auth command、业务请求日志脱敏，以及握手成功后才提交 trust 的调用链。编译 target 复用须先协调，不重复占用磁盘；真实生产账号验收与无账号合成验证分别记录。

## Base APK 的独立静态核验

用户后续提供以 shell `260c14a` 标记的 debug base APK，允许先验系统/UI，但禁止真实登录/refresh；它尚未包含用于关闭 SDK HTTP 重发 P1 的最终修正，不能发布。此 source hash 是提供方声明的构建基线，不等于本轮独立完成可复现构建或从 APK 验证 git provenance。

独立读取现有文件，没有重建、复制大产物或安装 APK。文件为 117,044,998 bytes，SHA-256 `e6a13fdb1af0002ff0b955c0b6d8a386d393a75ebc6637d2a362383a33e8e4b6`。独立运行 `python3 scripts/check-android-apk.py <base.apk> --profile debug`，exit 0：应用标识、versionName/versionCode/minSdk、构建的本地 UI asset keys、NOTICE、原生 ELF、debug 签名及 ZIP/ELF 16 KiB 对齐通过。名为 universal 的这个包实际仅包含 **1 个 ABI**；未把文件名当作多 ABI 证据。

APK 的 Tauri 配置指向本地 `mobile.html`，`useHttpsScheme=true`，没有远端首页 URL；UI asset keys 由脚本在 Rust 原生库中验证，因此 ZIP assets 下没有单独 HTML 并非缺少 bundled UI 的证据。真实离线启动、本地 Origin/IPC、系统保存/分享/back/insets、公开内嵌登录页和取消仍未执行，不能用配置值代替运行结果。

同时只读审阅 `260c14a` 的 `crates/mobile/src/lib.rs / mobile_transport_connect`：先等待 transport service connect/认证握手成功，接着检查 account epoch，再提交 trust；trust commit 或后置 epoch 检查失败均关闭已建立连接。该调用顺序回应先前模块级不能独自证明的约束；仍不代替失败握手与注销竞态的真实集成用例。

用户已以契约 `7b10e1f` 明确把 SDK 内层重发作为 **P1**，采用固定 2.0.3 JVM core 的公开 HTTP-only vendor patch：保留原版 Android AAR UI/OAuth/验证逻辑，要求来源/文件摘要/许可证/patch、retry/redirect 禁用、POST one-shot、有界超时及实际 single-attempt 网络回归，最终 Gradle 排除旧 core。此处不再把它当作可默认接受的已知限制；源码 patch、网络回归和最终依赖解析独立核验前保持未关闭。

运行阻塞仍为前述 fresh-data AVD 的 early partition mount failure。只读核对已安装镜像的 feature metadata 为 DynamicPartition 开启，上游 emulator 会据此生成 boot_devices 参数；未据这一线索推断确定根因，也没有修改镜像/原 AVD、猜测启动参数或无限等待 APK。当前没有运行中的 emulator 或未清理的本任务临时盘。

## 稳定账号源码与现有 harness 独立复核

后续固定审查对象为作者 `9c414c3cc23a331d90f80a07b2737a8886dfd5b2` 的 auth/account，以及前述 shell `260c14a`。HTTP vendor patch 的独立复审已由协调指定另一位 reviewer，本轮不重复其网络测试或 JVM 构建，也不自行替其关闭 P1。

本轮直接执行作者提供的既有预构建 `anywork_mobile_account_harness` 测试二进制，附 `--test-threads=1`，**14/14 通过**，没有调用 Cargo、安装依赖或重新构建。harness 通过 path 引入真实 account module、transport types 和 native auth Rust plugin；六个直接输入文件逐字节与 `9c414c3` 相同，二进制 mtime 晚于这些输入。该检查不等同于独立重建的二进制 provenance 证明。13 项 account 用例覆盖 snapshot 脱敏、retired owner 不被 snapshot 重开、cancel/迟到登录、未知 rotation 退休及 lifetime 取消、schema/endpoint policy、trust 范围及 stale commit、rename/remove 保留未知字段与写回冲突、profile warning 保留与下次刷新清除。另 1 项使用实际 Tauri mock IPC，逐一断言本地/授权站点/不受信 origin 对 auth configure/signIn/snapshot/profile/token/logout/get/credentials 的请求均以 `not allowed` 在 native dispatch 前被 ACL 拒绝。

另只读检查 Boole 提供的现有 Kotlin XML 结果，callback **1/1**、VerifiedProfile **4/4**、AuthLifecycle **3/3**，均无失败/错误/跳过。这是对其他执行者报告的核验，不冒充本 reviewer 独立执行 Gradle，也未从 XML 反推其最终 core 依赖解析已通过。对应测试源码已阅读：callback 用实际 SDK matcher 拒绝错误 port/path/fragment，正确 callback 缺失 state 在 token HTTP 前失败，重复 callback 不再次消费；profile 用例仅是公开错误 wrapper 分类和纯 reducer；lifecycle 用例验证 orphan、迟到 Activity 创建及 finish 不等于 destroyed，没有模拟完整的真实授权 A→B 交接或进程死亡。

源码再次核对的边界：

- `readClaims` 检查固定 issuer/aud/sub；UserInfo 前后重新读取 SDK claims，绑定相同 subject，包含资料 GET 失败但内部已 refresh 的分支。token 返回前还检查当前 generation、scope/validity 以及 profile subject；未把纯 UserInfo GET 失败混作未知 rotation。
- sign-in 在 profile 完成并再次检查 generation 后才同步发布 signedIn/profile。logout/取消立即 fence，mutex 等待已开始 rotation 与 SDK Activity 销毁；Rust apply 不允许已本地退休的 owner 被迟到 signedIn snapshot 重开。旧 grid cleanup 只清理 epoch 更早的实例，不关闭随后账号的新实例。
- 稳定 `scopeId` hash、RAM-only SDK storage、固定错误返回和无业务 JS token ACL 保持成立。合并 shell capability 没有 mobile-auth command 权限，登录 Activity 无 AnyWork 业务 IPC；SDK 自带 bridge 与 IdP cookie 仍按契约明示。
- shell 先认证握手、再检查 epoch/commit trust，commit 或后置 epoch 失败关闭连接的时序已在源码确认；上述 core 测试仍不能替代真实失败握手与系统运行集成。

**本轮账号源码/core 复核未发现新增阻断；原 P2 的 source/core 修正已核实。** Android 账号整体不因此标记已完成运行验收，SDK HTTP P1 的关闭依赖指定 reviewer 的结果及最终依赖接线，真实回调配置/登录/目录、Activity 完整交接和 APK 系统/UI 运行结果继续单列。没有真实账号操作，没有重跑 HTTP patch 测试或大构建，没有新增需清理的临时产物。
