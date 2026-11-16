# 登录持久化独立审查

## Android 候选与结论

审查对象为 `81cee2fce6b88799801ec05fe4a45fa114e05f97`，前置桥接状态与固定消息提交为 `8e8a77c`。独立树 cherry-pick 为 `00bc6fd` / `c3c2da6`；测试前执行 `git diff 81cee2f HEAD --exit-code`，完整源码树相同。依据当前 `docs/login-session-persistence.md`（协调提交 `7353492`、`e118ee6`）审查，不沿用此前仅内存授权的约定。

结论：Android 原生源码候选 **PASS，可合入**，未发现尚未关闭的源码阻断项。桌面独立结论见后文。集成 UI、Release 包与实际登录验收仍按后文边界单独进行。

## 源码核对

- SDK 默认明文 SharedPreferences 持久化继续禁用。新记录只保存 refresh token、ID token 和已验证 subject；不保存 access token、Noise/协调私钥或业务资料。AES-GCM 的 AAD 与记录绑定包括 endpoint、issuer、client、resource、grid URL、product、callback、scopes，配置变更不能采用旧授权。
- 冷启动从无 access-token 缓存的 SDK 刷新，再比较 subject；新 ID 仍由实际 SDK 校验。合法刷新未返回新 ID 时，仅采用安全记录保护的原身份；这不声称旧 ID 刚通过新的签名/有效期验证。仅纯 UserInfo GET 失败可退回该身份，嵌套刷新错误、无效新 ID/JWKS、成功 UserInfo 的不同 subject 均不能变成已登录。
- 每次刷新 enqueue 前先持久化 `pending`。实际 OkHttp 4.11.0 的 `requestHeadersStart` 先于 HTTP/1 和 HTTP/2 codec 写请求头；只有该事件之前失败才允许恢复 `ready`。标记是每调用单独且只增不退，不按异常类型猜测是否发送。此边界不声称 DNS/TCP/TLS/代理 CONNECT 尚未发送网络字节。
- 操作共享单调 90 秒网络预算，每个 GET/POST 最多使用剩余预算与普通 60 秒上限的较小值；过期后在 enqueue 前失败。预算通过 OkHttp call timeout 覆盖响应体读取，异常进入原 SDK completion。没有外层 `withTimeout`、提前取消协程或提前释放 SDK mutex；process owner 的互斥锁仍等待真实 SDK 回调及保存完成。丢失 guest invoke/Activity 不撤销已发送的轮换。
- configure 及显式重试先返回 `restoring`，后台使用同一 process owner/SDK 锁；snapshot 可查询，恢复重试调用 `restore`，不调用交互 `signIn` 或打开 SSO。普通业务 Activity 销毁保留已完成授权；未完成登录仍受 PKCE attempt/Activity 清理栅栏约束。
- 注销同步增加运行期与存储 generation，再排队清理 SDK。configure 之前注销直接擦除本应用新 schema，随后 configure 不读旧授权并重做注销栅栏。tombstone 写失败时独立尝试密钥删除与密文删除；两条均失败则 `reauthRequired` / `MOBILE_AUTH_CLEAR_REQUIRED`，不报告已退出，不允许 restore，用户可再次退出重试。
- Rust 在调用 native logout 前清除账号、目录、目标及运行期权限，持久清除未确认前保留 `MOBILE_AUTH_CLEAR_REQUIRED`。恢复采用新 epoch；较旧 configure/restore/snapshot/登录结果受 epoch 与 phase 双重检查，不能恢复已退役 owner。返回 guest 的错误为固定允许码，grant 不进入公开 DTO。

## 独立执行证据

证据保存在本审查树 ignored `artifacts/login-restore-review/`，不包含用户 grant 或生产账号读取。

| 验证 | 结果与边界 |
| --- | --- |
| 实际 SDK 的 auth JVM 测试 | 30 passed，0 failed/error/skipped；含 AuthOwner 3、GrantStore 11、SdkGrantRestore 8、既有生命周期/回调/资料测试 |
| 实际 OkHttp 的 core JVM 测试 | 13 passed，0 failed/error/skipped；含无发送失败、发送后丢响应、pending 写失败、预算过期/响应体超时及单次发送 |
| Android `lintDebug` | PASS；0 Fatal/Error，11 Warning；未将有 warning 记为零 warning |
| 上游来源核验 | `verify-source.py` PASS：33 个完整 Kotlin 文件、license/catalog/build 哈希与精确 HTTP-only patch |
| Rust account 状态 | 24 passed，0 failed，1 existing ignored（显式公网探针，未运行）；不是全 workspace 测试 |
| Rust guest 边界 | 1 passed，guest 不能直接调用 native auth/credential 方法 |
| Web 桥接状态/固定消息 | 2 passed，精确前置 `8e8a77c` 中的 account 定向用例 |
| 隔离 Android Keystore 平台夹具 | 19/19 步、19 个不同进程全部 PASS；精确绑定如下 |

独立 Gradle 使用已有 JDK 17 与 Android SDK，不构建 Rust/APK：

```sh
JAVA_HOME=/opt/zerobrew/opt/openjdk@17 \
ANDROID_HOME=/Users/water/Library/Android/sdk \
crates/mobile/gen/android/gradlew -p crates/mobile/gen/android \
  :tauri-plugin-mobile-auth:testDebugUnitTest :anywork-logto-core:test \
  :tauri-plugin-mobile-auth:lintDebug --console plain \
  --no-configuration-cache --max-workers=2
CARGO_TARGET_DIR=/Users/water/work/2026/any-work/target CARGO_INCREMENTAL=0 \
  CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 CARGO_BUILD_JOBS=2 \
  cargo test --offline --locked -p anywork-mobile --lib account::
# 同一组 Cargo 环境；等待前一命令退出后执行：
cargo test --offline --locked -p tauri-plugin-mobile-auth --lib boundary_tests
# web/ 内，复用主工作区已有依赖：
node_modules/.bin/vitest run src/mobile/account.test.ts
```

Cargo 与桌面作者协调后串行使用共享 target，未并发 Cargo，未运行设备/原生包构建。host Tauri macro 所需的既有 assets 和 Web 依赖仅临时链接，完成后移除，未提交。结果日志为 `candidate-81cee2f-gradle.log`、`candidate-81cee2f-rust-account.log`、`candidate-81cee2f-rust-boundary.log`、`candidate-81cee2f-web-bridge.log`、`candidate-81cee2f-provenance.log`；测试 XML 与 lint XML 保存在 `retained/`。

实际 AAR `io.logto.sdk:android:2.0.3` 与 vendor core 在 loopback 合成 IdP 下执行，覆盖重启后刷新/轮换、丢响应、invalid_grant、坏 JWKS/ID、不同 subject、真实 refused connection、注销时迟到响应、无新 ID 加 UserInfo 503、UserInfo subject 不符及嵌套刷新失败。没有替换 SDK getter，也没有真实登录。

## 实际 Keystore 证据绑定与清理

平台夹具使用临时 API 30 `google_apis` 模拟器 `emulator-5560`，独立包/UID `dev.anywork.loginrestore.review`，无网络权限，仅合成授权字符串。直接编译未经改动的候选 `GrantStore.kt`：7706 bytes，SHA-256 `1e0f028028fc15ade2b5ad041bc9aab2dd8f587cac26c42430f3cfd814025c49`。候选提交中的源文件哈希再次匹配，故平台结果可绑定此候选，无需重复运行。

夹具 APK：894530 bytes，SHA-256 `98a434979f7215133b0674cf002f09b8844430eed35ce4c38bb4f5cf72395386`。私有夹具 minSdk 26 / targetSdk 35，assemble + lint PASS。证据：`platform/platform-summary.json`、`platform/platform-results.json`、`platform/probe-source.json`、逐步 `probe-*.log`、`probe-build-final.log`、夹具源码与小 APK。

19 个动作每次均结束包进程后重新启动：seed、load1、rotate、load2、pending、pendingRejected、logout、loggedOut、tamper、tamperRejected、wrongBinding、removeKey、missingKeyRejected、orphanTemp、loadAfterOrphan、fileBlockedLogout、blockedLogoutRejected、cryptoErase、loggedOut。检查实际 AndroidKeyStore 非导出密钥、noBackup 存储、0600 密文、不含明文、轮换跨进程持久化、pending 重启拒绝、篡改/AAD/密钥缺失拒绝及孤立临时文件处理。将夹具目录改成 0500 后 tombstone/unlink 失败，实际 Keystore 删除仍使旧密文在下一进程不可解密。

仅本任务模拟器已正常停止、PID 退出；私有 AVD、userdata、registry、临时 Gradle 构建缓存及夹具签名文件已删除。保留小 APK/源码/日志。未停止共享 ADB、未使用物理手机、未碰既有 AVD 或真实凭据。

## 早期发现的关闭记录与验收边界

早期草稿的删除步骤曾可能因 Keystore 删除失败而不执行文件删除；当前候选独立执行两条删除路径，测试与真实 Keystore 夹具覆盖关闭。早期双删除均失败仍可能报告 signedOut 的问题，当前候选通过 `MOBILE_AUTH_CLEAR_REQUIRED`、禁止 restore 和可重试注销关闭，Invoke 层 AuthOwner 及 Rust 状态测试覆盖。

API 30 平台执行不等于 API 26 运行验收；进程重启不等于断电耐久性；OS Keystore 结果不宣称每台设备硬件背书。以上是 Android 原生源码/合成授权/安全存储验收，集成 UI、Release R8 包、真实 SSO 与用户设备重启测试仍属后续集成验收。没有用旧 ID 解码或 SSO cookie 代替新的授权恢复。

## 桌面

精确候选为 `86737717d247a8c3322e0462c608d904859d2759`，**PASS，可合入，未发现尚未关闭的源码阻断项**。独立树保留其已审远程基线 `68364ff` / `cbcfc36` 及文档前置，候选 cherry-pick 为 `58ae587`；`git diff 8673771 HEAD -- crates/desktop desktop/ui Cargo.lock --exit-code` 确认桌面源码、UI 与依赖锁一致。Android 结论仍绑定前述独立 SHA，没有把两个平台冒充为一个最终集成提交。

### 源码门禁

- 最终依赖是明确平台 backend：`keyring-core =1.0.1`、macOS `apple-native-keyring-store =1.0.2`（仅 keychain）、Linux `zbus-secret-service-keyring-store =1.0.1`（crypto-rust）。没有全局默认 backend、明文文件、mock/noop 或仅会话 keyring 回退。早期 `keyring 4.2/v1` 选择因首次初始化错误永久缓存而被作者改为每次显式创建 store；本报告以最终依赖为准。Windows Native 账号仍 unsupported。
- 精确 service 下的 key 与记录均绑定完整 PublicConfig/support namespace，记录只接受当前 schema、UUID owner 和已验证 subject，拒绝未知字段/版本/配置。只保存 refresh grant 与 journal，不保存 access token、profile、Noise/协调密钥。
- 初次 broker 的 pending/provisional 永不恢复；完成原 JWT/JWKS、账号和配置验证后才写 ready，并在成功写入/读回后返回 `OwnedSecurely` ACK。后续刷新先保存 pending；新轮换先进入唯一 Native owner，再安全保存并确认后返回。HTTP 明确关闭自动 retry 与 redirect，未知结果不能当作离线而重放。
- 恢复先进行无凭据公开 OIDC GET 绑定预检，再刷新并调用既有 `JwtVerifier` 检查 resource/issuer/client/subject/connect/signature。候选 owner 保留在私有 `restoring_owner`，只有验证完成才放入公开 owner。profile GET 失败可保留已验证登录；不同账号 id 拒绝，无 id 的资料不作为姓名采用。恢复不创建旧的 Noise/设备会话。
- 明确收到最新轮换但保存失败时，RAM 留存最新 grant 并暂停使用；显式重试先修复该最新值的保存，再允许新刷新。重启不能从旧 pending 恢复。invalid_grant、未知派发或身份错误要求重新授权；存储/预检临时失败返回 retry 状态，不启动 SSO。
- OS I/O 在 blocking task 自己持有的同步锁内执行，15 秒 async 等待上限不会解锁底层 I/O。checkpoint/delete 推进 generation，retire 在等 async state 锁前推进 generation，阻塞任务在 I/O 锁内核对 generation。已取消或超时的旧写入不能在后续 pending/retired/新 owner 之后覆盖记录。没有因 timeout 取消已派发 OAuth 后立即开始另一轮刷新。
- 注销先使公开/私有 owner 和远程门禁失效、持久 retired，再等待已派发请求与精确删除确认；存储失败明确报告，不声称清除完成。远程撤销失败仍清除本地授权，固定返回 `ACCOUNT_REVOCATION_PENDING`。普通关闭只关闭连接；恢复后沿用已有本地准备与 default-once 规则。UI 区分 restoring、restoreRetry、reauth，明确保存与退出语义。

### 独立执行

| 验证 | 结果与边界 |
| --- | --- |
| 桌面账号测试 | 独立执行精确候选已有 test binary：69 passed、0 failed、1 existing ignored 公网探针；包括全部 12 个新增 saved 测试 |
| UI production build | review 树独立执行 `npm run build -w anywork-desktop-ui`，PASS |
| 实际 Chromium + 合成 Tauri bridge | review 树独立执行 `account-entry-check.mjs`，PASS；恢复/重试不触发登录或默认启用，保留账号、注销、取消、诊断回归；外部请求全部拒绝 |
| macOS 实际 Keychain backend | 新 review service/key，6 个独立进程写入/读取/轮换/读取/删除/确认不存在，6/6 PASS |
| 编译/clippy 边界 | 作者的精确候选 `--all-targets -D warnings` PASS，包含生产 main/实际 macOS backend；本审查不把该作者证据记作独立重复编译 |

账号测试执行 `/Users/water/work/2026/any-work/target/debug/deps/anywork_desktop-0f3c626b2faf477c accounts:: --test-threads=2`。这是作者在精确候选源文件上编译的已有二进制，由审查者独立执行；为避免与 Nash 的共享 target Cargo 冲突，本次没有重新 codegen，也未并发 Cargo。记录二进制 SHA-256、候选源文件哈希及路径比对于 `candidate-8673771-source-binding.json`。没有用本机编译推断 Linux CI 或运行成功。

独立结果日志位于 `artifacts/login-restore-review/candidate-8673771-{accounts,ui-build,ui-check}.log`，UI 末态截图保留在该目录。上述状态测试使用注入安全存储与 loopback HTTP；身份错误分别覆盖验证拒绝和 wrong subject，不声称真实 IdP 签名链端到端登录通过。

### 实际 macOS backend 小夹具

使用已有候选依赖 rlib，通过 `rustc` 链接独立可执行文件，没有运行 Cargo 或写共享 target。API 与 `SystemStore` 相同：`apple_native_keyring_store::keychain::Store::new()` → `build(service, account, None)` → `set_secret/get_secret/delete_credential`；service 唯一改为新建 review 专用随机名称，account 是夹具专用常量。只操作该精确条目，不枚举、不访问生产 service，不使用真实 OAuth。

6 个不同进程分别执行 write、read、rotate、read_rotated、delete、absent，全部成功。删除后由新的第六进程确认 `NoEntry`，无残留测试凭据。没有触发或绕过系统解锁/授权失败；OS 锁定情形仍由故障注入测试覆盖，不能把这次正常 Keychain 执行说成实际锁屏失败验收。

证据在 `macos-platform/fixture.json`、`summary.json`、逐步日志、源文件及 compile log。夹具源 SHA-256 `951315081e57f30ab032a88d209144c13a7540c3c491602b539ed5c2ad70f449`，可执行文件 SHA-256 `9b25a4bc300125b35f966b8638a099f2cce8c9c5ef13182f4b915dd521182a90`。候选 dependency/API/source 绑定另保存在同目录摘要。此证据证明实际 macOS backend 跨进程持久化，不等于完整应用真实 OAuth 重启恢复。

### 早审关闭与后续边界

最初 P1：草稿把待验证 owner 提前安装到公开 state，验证拒绝后 snapshot 可能重新变成 signedIn。当前候选用私有 `restoring_owner` 隔离；分别注入验证失败/wrong subject 后反复 snapshot、default-enable、再建 Handle 均不能重开或发送刷新，已关闭。

另一个早审问题是丢弃 async future 后仍在运行的阻塞写可能失去串行保护；当前由 task-owned I/O 锁、每次状态推进的 generation 及 retire 的提前 fence 修正，取消阻塞写/注销迟到结果/存储 deadline 测试通过。保存失败的最新已知轮换只允许当前 process owner 修复，不能从重启旧 pending 或已退出 owner 修复。

本次不操作安装中的桌面应用、用户 host、账号或浏览器会话。Linux Secret Service 的实际编译/运行、系统锁定现场、Release 安装包以及真实登录后退出/重启，仍待后续对应平台验收，不作为源码接受的已执行证据。
