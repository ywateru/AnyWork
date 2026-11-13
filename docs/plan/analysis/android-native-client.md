# Android 原生客户端：独立设计审查

审查基线：AnyWork `b7f13f1`，2026-11-13。范围为 Android 产品契约、原生接口、手机布局及任务门槛；不实现产品，不操作真实账号、在线手机或现有业务会话。本报告中的身份、设备和产品示例均为合成值。

结论：整体分层可继续实现，但**目录授权路径、登录 WebView 的存储/桥边界、回调生命周期和精确 origin 尚需冻结**，不能据当前文档认定端到端账号与目录可用。以下 P1 是合并验收门槛。尚未运行候选 Android APK，也未验证真实授权服务器中的回调注册。

## 证据与验证边界

- AnyWork：`docs/android-account-entry.md`、`docs/mobile-native-contract.md`、`docs/mobile-client-layout.md`、`docs/plan/tasks/android-native-client.md`，以及现有 Web AccountStore、Desktop gateway 配置和 remote JWT verifier。
- CyberGrid：以本仓库 `web/src/vendor/cybergrid/SOURCE.json` 固定的 **`f2a3961536e5c69b13c7dbc661953d9243becbae`** 为依据，不将本机其他上游提交当成已部署版本。
- 官方 Logto Kotlin/Android：**v2.0.3，`3efc22a59ecd9f020bf6af58bd47d6a4f292b140`**。这里的 2.0.3 是 Logto SDK 版本，**不是 Android System WebView 版本**。核对的是该 tag 的源码；尚未下载或核对 Maven 2.0.3 二进制与 tag 的一致性，构建 lane 应补精确依赖解析结果。
- Tauri：与现有依赖一致的 **tauri-v2.12.5** 官方源码。
- 只对公开 auth/config 做无 Authorization 的 GET；未提交 code/token、未发起登录、exchange、设备注册或远端写入。
- 独立执行了固定 CyberGrid 源码的隔离路由实验：官方 `createService` + `MemoryStore` + 官方合成 `FixtureIdentity`，动态目录与静态产品策略共 **14 项断言通过**。使用本机已有 TypeScript 仅转译所需源码，不做依赖安装或原生构建。临时 JS 约 157 KB，已在 finally 中删除。该实验验证路由/授权策略，不冒充真实 JWT、Logto 登录或云端部署验收。

## P1：Native token 不能直接换 console；必须选择能读到电脑的产品路径

位置：`android-account-entry.md:26-28`；`mobile-native-contract.md:7-15`。

“读取 customData 并合并 CyberGrid 目录”目前缺少可执行的授权路径。源代码已经明确限定角色，不能靠 DTO 或 SDK 方法名推断跨产品能力：

1. [service.ts:67-82](https://github.com/ywateru/CyberGrid/blob/f2a3961536e5c69b13c7dbc661953d9243becbae/server/src/service.ts#L67-L82)：`/console/auth/exchange` 对 token 的实际 client 调用 `browserProducts`；Native `/auth/exchange` 必须满足 `verified.clientId === body.appId`，再映射为产品。
2. [products.ts / ProductPolicy](https://github.com/ywateru/CyberGrid/blob/f2a3961536e5c69b13c7dbc661953d9243becbae/server/src/products.ts)：Native 与 browser client 集合不能重叠；一个 Native client 不能归属多个产品。同产品允许 Desktop/Mobile 两个不同 Native client 映射到一个 canonical product。
3. [service.ts:93-103](https://github.com/ywateru/CyberGrid/blob/f2a3961536e5c69b13c7dbc661953d9243becbae/server/src/service.ts#L93-L103)：`/console/devices`、`/console/directory` 只允许 console session；Native `/devices`、`/directory` 使用 `session.appId`，没有可请求任意目标产品的参数。动态模式中此值就是自身 Native app；静态模式中是 canonical product。
4. [sdk-rust/src/capabilities.rs:31](https://github.com/ywateru/CyberGrid/blob/f2a3961536e5c69b13c7dbc661953d9243becbae/sdk-rust/src/capabilities.rs#L31)、[devices:144](https://github.com/ywateru/CyberGrid/blob/f2a3961536e5c69b13c7dbc661953d9243becbae/sdk-rust/src/capabilities.rs#L144)：Rust `directory()` 请求 `/api/v1/directory`；`devices()` 使用它或退回 `/devices`。这两个方法没有提升为跨产品 console 的能力。

独立实验实际确认：Native console exchange 返回 401 `APPLICATION_MISMATCH`；Native session 调 console devices 返回 403；动态模式只看见自身 app 设备；静态策略把两个 Native client 映射到同产品后可以看见两者设备。上游 [api.test.ts:30-31](https://github.com/ywateru/CyberGrid/blob/f2a3961536e5c69b13c7dbc661953d9243becbae/server/test/api.test.ts#L30-L31) 和 [products-redis.test.ts](https://github.com/ywateru/CyberGrid/blob/f2a3961536e5c69b13c7dbc661953d9243becbae/server/test/products-redis.test.ts) 也明确覆盖相同角色边界；本轮未运行 Redis 测试。

当前默认公开部署的 GET 结果：console config 返回 200；附加 Native `clientId` 仍返回 200，**但返回的 client 仍是 SPA，并非所请求 Native**；Native auth/config 返回对应 Native client。均未返回新产品策略元数据或 endpointPolicy。故“config GET 200”不构成 Native console 兼容证据，也不能把本机上游的新静态产品能力当作当前云端已有能力。公开入口：[console config](https://anywork-cybergrid-selfhost.vercel.app/api/v1/console/auth/config)。响应未在本报告记录实际 client 标识或 coordinator epoch。

最小建议：冻结**同产品 Native device session**路径。当前动态部署若复用电脑的既有 Native client，目录自然同 app；若手机使用独立 Native client，必须先具备可信、已部署的静态同产品映射。若产品确实要求跨产品目录，则需要另行提供受支持的服务端授权接口；不得把 Native token 传 console、伪造 SPA client、移除 client 检查或读取目录失败后显示“没有设备”。同产品 Native 方案还应核对是否需要 registration/admission、RAM registrationKey、heartbeat 和 epoch 恢复，不能只实现 GET devices。

账号 token 也应区分用途：现有 `web/src/accountData.ts / AccountStore.call` 用无 resource 的 Account API token 请求 `/api/my-account`；CyberGrid/电脑网关需要固定 resource 的 connect JWT。契约应列出 issuer、Native client、resource、scope、Account API token 获取方式和目录注册方式的表，并以当前 subject 栅栏绑定两类 token。公开 config 的 scope 不含 `custom_data`，不能据其默认值认定 customData 读写权限已齐备。

验收：合成账号至少包含同产品电脑、同产品手机、其他产品设备及其他用户；断言实际目录过滤、401/403、目录未知态、首次注册失败、服务重启后的新 epoch 和重新注册；不得自动重放业务写入。

## P1：RAM-only 需要覆盖登录 WebView cookie，而不仅是 SDK token storage

位置：`android-account-entry.md:18-22`。

官方 [LogtoConfig.kt](https://github.com/logto-io/kotlin/blob/3efc22a59ecd9f020bf6af58bd47d6a4f292b140/android-sdk/android/src/main/kotlin/io/logto/sdk/android/type/LogtoConfig.kt#L13) 的 `usingPersistStorage` 默认 true，必须显式 false。[LogtoClient.kt:81-88](https://github.com/logto-io/kotlin/blob/3efc22a59ecd9f020bf6af58bd47d6a4f292b140/android-sdk/android/src/main/kotlin/io/logto/sdk/android/LogtoClient.kt#L81-L88) 在 false 时不构造 `PersistStorage`，符合不读取旧 SDK token 文件的方向；但这不控制 Android WebView cookie 数据。

SDK 登录 Activity 设置 `LOAD_NO_CACHE`，没有因此关闭 cookie；[LogtoClient.signOut:186-190](https://github.com/logto-io/kotlin/blob/3efc22a59ecd9f020bf6af58bd47d6a4f292b140/android-sdk/android/src/main/kotlin/io/logto/sdk/android/LogtoClient.kt#L186-L190) 另行调用进程级 `CookieManager.removeAllCookies` 和 `flush`。因此不能将 `usingPersistStorage=false` 或页面不缓存等同于所有登录材料均为 RAM。

最小建议：明确 RAM 承诺是否包含 IdP SSO cookie，以及登录 WebView 与业务 WebView 的存储隔离/清理策略；如允许 cookie 保留，必须在文档中明确其持久边界，重启仍不得自动恢复原生 grant。若要求严格无持久登录材料，需给出能跨异常进程死亡成立的实现证据，不能只靠正常 logout 时清理。清理不得读删旧加密文件/KeyStore，也不能误清业务端需保留的非秘密偏好。

## P1：SDK 2.0.3 有原生 JS interface；单说“无 Tauri IPC”不足以覆盖登录安全

位置：`android-account-entry.md:14,18`；`mobile-client-layout.md:35`。

官方 [LogtoWebViewAuthActivity.kt:33-54](https://github.com/logto-io/kotlin/blob/3efc22a59ecd9f020bf6af58bd47d6a4f292b140/android-sdk/android/src/main/kotlin/io/logto/sdk/android/auth/logto/LogtoWebViewAuthActivity.kt#L33-L54) 自带 `Polyfill` 与 `SocialHandler` 两个 `addJavascriptInterface`；[LogtoWebViewAuthClient](https://github.com/logto-io/kotlin/blob/3efc22a59ecd9f020bf6af58bd47d6a4f292b140/android-sdk/android/src/main/kotlin/io/logto/sdk/android/auth/logto/LogtoWebViewAuthClient.kt) 在每次页面开始时注入脚本，除回调识别外未提供产品 origin allowlist。

- [Polyfill](https://github.com/logto-io/kotlin/blob/3efc22a59ecd9f020bf6af58bd47d6a4f292b140/android-sdk/android/src/main/kotlin/io/logto/sdk/android/auth/logto/LogtoWebViewPolyfill.kt) 可写系统剪贴板。
- [SocialHandler.postMessage](https://github.com/logto-io/kotlin/blob/3efc22a59ecd9f020bf6af58bd47d6a4f292b140/android-sdk/android/src/main/kotlin/io/logto/sdk/android/auth/logto/LogtoWebViewSocialHandler.kt#L42-L79) 根据页面数据启动 social session，并在完成时加载继续登录 URL。这属于需要明示的 SDK 信任边界，不等于能访问 AnyWork token/transport。
- SDK Activity 隐藏 action bar，仅构造全屏 WebView；“原生关闭和来源提示”不是仅设置 SDK config 就已经具备的功能。该 Activity 为 Kotlin 默认 final 类，当前源码未展示可配置的 WebView factory/navigation policy。

最小建议：确认采用的官方 SDK 公共扩展点，列出实际存在的 SDK bridge、允许的授权/连接器导航和来源提示/关闭的实现机制；不得宣称登录页完全无桥。补隔离测试覆盖外部导航、子 frame/非信任页面不能调用 AnyWork IPC、social 回跳和业务 WebView 导航被阻止。若现有公共 API 无法满足约束，需先协调明确支持方案，不能依赖私有反射或静默替换 SDK 流程。

## P1：回调、取消与 Activity/进程重建需要独立于 Rust epoch 的协议

位置：`android-account-entry.md:20-22`；`mobile-native-contract.md:9-15`。

官方 [LogtoAuthSession.kt](https://github.com/logto-io/kotlin/blob/3efc22a59ecd9f020bf6af58bd47d6a4f292b140/android-sdk/android/src/main/kotlin/io/logto/sdk/android/auth/logto/LogtoAuthSession.kt#L24-L79) 在内存生成 state/verifier，调用 SDK WebView，按 redirect/state 解析回调并以 PKCE 换 token；[LogtoAuthManager](https://github.com/logto-io/kotlin/blob/3efc22a59ecd9f020bf6af58bd47d6a4f292b140/android-sdk/android/src/main/kotlin/io/logto/sdk/android/auth/logto/LogtoAuthManager.kt#L9-L29) 只有一个进程全局当前 session。Activity `onDestroy` 调用该全局 manager 的 `handleUserCancel`。进程重建后旧 WebView 的 intent 可以仍含授权 URL，但对应 session/state 已不存在；仅 UI epoch 无法重建这次授权。

最小建议：冻结精确、已注册的移动 redirect URI 与完成/取消确认协议；主授权回调由 SDK WebView 截获，不能假定添加任意 Android intent-filter 就完成注册。SDK manifest 另有 [social 回调 Activity](https://github.com/logto-io/kotlin/blob/3efc22a59ecd9f020bf6af58bd47d6a4f292b140/android-sdk/android/src/main/AndroidManifest.xml)，应与主 code callback 区分。并发 login 必须拒绝或串行；取消旧 Activity 未完成销毁前，不得让其迟到 onDestroy 取消新 session。Native owner 应在进程/授权上下文丢失时关闭旧登录 UI、结束 pending invoke、回 signedOut，而不是等待永不会完成的回调。

验收：取消 A 后开始 B，A 的旧回调/销毁/换 token 完成不得改变 B；错误 origin/path/state、重复回调、无当前事务回调均拒绝；旋转、后台、宿主 Activity 重建、登录中杀进程和重新启动均有终态。公开配置返回某 HTTPS redirect 也不证明所选移动 redirect 已在真实 Native client 注册；此项保留为部署配置证据门槛，未做真实登录。

## P1：精确 origin 与客户端组合必须冻结，不能只写“本地可信 Origin”

位置：`android-account-entry.md:28`；`mobile-native-contract.md:15`。

现有 AnyWork `crates/remote/src/gateway.rs / upgrade` 对缺失 Origin 立即拒绝，`crates/remote/src/auth.rs / JwtVerifier::check` 只接受既有单一 client；Desktop `accounts.rs` 当前构造 SPA verifier 与网站 origin。Native Rust WebSocket 不会自然带浏览器 Origin，必须由可信配置构造，不能由 JS 指定或遇错改为空/通配。

官方 [Tauri v2.12.5 webview 源码](https://github.com/tauri-apps/tauri/blob/tauri-v2.12.5/crates/tauri/src/webview/mod.rs#L1917-L1919) 说明 Android 本地协议表现为 `http://{protocol}.localhost`，配置 `use_https_scheme` 后可为 HTTPS。它不同于网站 HTTPS origin，也不同于 `tauri://localhost`。改变 scheme 还会改变存储分区；应以最终 builder/config 为准。

最小建议：落定以下四项：业务 WebView 实际 origin、Rust 发往电脑的固定 wire Origin、允许的 Native client 集合、开发/test origin 的独立开关。原生 HTTP 调 CyberGrid 是否不发送 Origin也应明确；其 console CORS 仅为受信浏览器来源开放指定 console 路由，不可把业务 WebView origin照搬到所有 Native API。

验收至少包含允许/拒绝的 client × Origin 组合、缺失/重复/null Origin、错误 audience/scope/subject、跨账号连接、旧电脑不支持时的升级提示。Origin 是额外浏览器边界，不是原生身份凭证；任何 Native 进程能手写它，因此保留 JWT owner 与 client 验证不可替代。

## P2：系统与恢复接口仍有几处实现者可能作出不同解释

位置：`mobile-native-contract.md:7,39-41`；`mobile-client-layout.md:35-40`。

- 上传由系统选择器提供，但 System 命令表只定义导出。明确采用 WebView 已验证的 file chooser，还是有界原生输入 handle；覆盖主输入/子代理/主题导入、content URI 读取取消及宿主重建。不要让两个 lane 各自实现不同入口。
- `insetsGet` 只有“逻辑单位”不足以区分 Android dp 与 CSS px；冻结转换、WebView scale、edge-to-edge、adjustResize 和 IME 重叠计算，避免二次缩小/留白。
- 返回事件应携带单调事件 ID 或明确单次消费规则，规定 JS 未响应/销毁时如何交系统，避免原生和 JS 各退一次。登录 Activity 的返回另外验收。
- `account.scopeId` 必须对同 issuer/subject 在 RAM 重启后稳定，或明确不恢复持久草稿；随机 epoch 不能同时充当稳定草稿命名空间。未重新核验账号前不显示旧草稿/可信设备；原生内部可使用 subject，JS 不必接触它。
- “退出取消待导出”要贯穿已打开的系统 chooser，后续 Activity result 不得恢复已撤销 handle。检查大小/顺序/期限、分享只报告 chooserOpened；进程死亡遗留临时文件应在下一次受控启动清理。
- 22 MiB 导出上限与 transport 有界响应上限应在 UI 给出明确限制；超限会话历史不可表现为导出成功或静默截断。

## 现有 AVD 与推荐顺序

只读检查配置、镜像文件及已运行进程的 executable 名称，没有执行 `adb devices`、启动 emulator、安装 APK 或改变账号。宿主为 arm64；四个 AVD 都配置 Pixel 4、Android 11/API 30 Google APIs、同一 ABI、2 GiB RAM、6 GiB data 分区。共享系统镜像目录存在，`kernel-ranchu/system.img/userdata.img/ramdisk.img` 及 package 元数据均存在，镜像实际分配约 **3.13 GiB**，不需要下载。

| AVD 本机配置名 | 数据目录实际分配 | quickboot snapshot | 备注 |
| --- | ---: | --- | --- |
| fitting_mirror_demo | 3.16 GiB | 有 | 其他用途，不优先占用 |
| hgdj_capture | 1.09 GiB | 有 | 其他用途，不优先占用 |
| nuva_mirror_isolated | 2.84 GiB | 有 | 名称含 isolated 不构成空账号证明 |
| v4_mirror_verify_1014 | 0.57 GiB | 无 | 空间上首选候选，仍需确认所有权与数据隔离 |

所有配置均有 lock 文件；盘点时没有运行中的 qemu/emulator executable，但有既存 adb 进程。不能仅据此删除 lock 或断定 AVD 无账号。建议 shell owner 先协调候选 AVD 的归属并确认无真实在线账号，然后对最后一个使用不载入/保存快照的隔离运行，必要时使用 emulator 支持的 read-only 数据 overlay；本轮未启动、未 wipe-data、未复制 AVD、未修改任何 lock。只安装授权候选 debug APK，测试后卸载/清理本任务数据与产物，保留他人数据。

四个 AVD 并非四种兼容矩阵：都只有 API 30，无法证明 minSdk 26、近期 Android 的通知/边到边/返回手势或 16 KiB 设备实际运行。镜像内 WebView provider 版本尚未读取；启动隔离候选后应先只读记录 provider/package 版本、ABI、API、density 与实际本地 origin，再开始 UI 验收。不能把 Logto 2.0.3 当作 WebView provider版本，也不因覆盖不足在本任务下载新镜像。

## 后续验证顺序与交付门槛

1. 账号 lane 回填目录路径和真实配置限制；优先以同产品 Native 方案消除 console 假设。shell/account 冻结 SDK 支持点、redirect、RAM cookie 边界；transport 冻结 wire Origin 与客户端验证。
2. Mendel 提交用户名实现后独立审查：已验证 subject 的 name/username/email、Account API/UserInfo、失败恢复、登出换号竞态、长名窄屏及合成身份组件测试；不与 Android 产品实现混改。
3. Rust core 使用隔离真实 gateway 验证授权续期、取消、账号 lifetime、未知结果不重放与 PTY；公共配置 GET 不代替此验收。构建 target 与作者协调复用，不重复构建大产物。
4. 复用现有 Playwright `android-web`（Pixel 7 Chromium 仿真）及真实 React/NativeTransport 适配器，覆盖会话控制、审批、子代理、文件/编辑冲突、图片编辑、导出、终端和 UI 返回。桥失败/取消/迟到响应必须进入真实组件状态。移动浏览器通过只能证明 Web 层。
5. 在获准隔离 AVD 上验收 APK 的包内本地 assets/native 库、文件选择/保存/外开、中文 IME、终端控制键、返回顺序、前后台/旋转/进程重建、真实 WebView origin 和无账号隔离夹具连接。单纯安装成功或网页 DOM 测试不能标记全功能通过。

本报告提交仅新增审查文档。未改主工作区、产品源码或原生 target；未读取真实会话正文、凭据和账号资料。目录实验临时产物已主动清理，其余 AVD/共享缓存保留。
