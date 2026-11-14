# Android 分 ABI 构建与发行：独立审查

日期：2026-11-14（Asia/Shanghai）。角色：非产品代码作者的独立 reviewer；遵循 docs-sprint 的 committed-source verify 流程。此次只提交本报告，不修改产品源码、不合并其他 lane。

## 审查对象与结论

| lane | 基线 | 精确最终提交 | 结论 |
| --- | --- | --- | --- |
| build / APK checker | `bb75bf72e7495b07f9ff77c08d88cf3c5e55347e` | `e743029ea511e92847a886dd13a624a6bd58b030`，包含 `62086b6953cfb13f8373bc19c36dd881aa51dbbb` | **PASS：源码与针对性验证** |
| publisher / workflow / site | `1646430a8e7b14577227cdb8209199a92caebf4d` | `6c08d215404fac5ff72d04c7a3c494141702a4f2`，包含 `85764118fdd2b4f552b2c59012f5003662744314` | **PASS：源码与跨 lane 对接** |
| 最终四 ABI 发行二进制 | 待 mobile 修复合入后的统一精确提交 | 本次未构建 | **BLOCK：发行验收证据待补；不表示发现源码缺陷** |

最终两 lane 没有未关闭的 P1/P2 blocking 源码 findings，可以进入合并和用户已安排的最终构建。不能据此宣称新四包已经构建、减小到某个体积、通过 Release R8/lint 或完成实际安装验收。两 lane 必须配套集成：`6c08d215` 的持续门禁引用 build lane 新增的 checker 测试；其 workflow 也依赖新的分 ABI 构建入口。

读取了 `docs/INDEX.md`、`docs/plan/README.md`、Android 任务、产品/原生接口契约、`docs/mobile-build.md` 和 `docs/releasing.md`。用户本轮明确的四包命名优先于历史文档中的 universal 路径。

## Findings 与闭环

### R1 — P2，原 blocking，最终组合已关闭：checker 负向测试没有持续执行入口

`e743029e:scripts/test-check-android-apk.py:1` 的 8 项测试最初只有手动执行记录；当时 `scripts/check.sh` 和 `.github/workflows/ci.yml` 均未调用它。真实 APK 的 happy path checker 不能覆盖拒绝混包、重复条目及错误 ELF 的分支。发布基础设施的这组低成本回归应持续执行。

关闭证据：`6c08d215:scripts/check.sh:44`、`:45` 分别调用 `build-site-test.py`、`test-check-android-apk.py`；该脚本已有 `set -euo pipefail`，Checks 的 server-web job 调用它。`site-test.mjs` 同时删除重复静态测试调用。独立验证最终组合中的静态测试 **4/4**、checker 测试 **8/8**，均通过。此关闭依赖两 lane 一起集成，不追溯改变 `e743029e` 单独提交的状态。

### N1 — P3，non-blocking，继承限制：UI 路径存在检查不是内容或源码新鲜度证明

设计位置：`docs/android-account-entry.md:7`、`docs/mobile-native-contract.md:47` 的随包业务 UI；代码位置：`e743029e:scripts/check-android-apk.py:78`、`:88`。

checker 要求当前 dist 中的 html/js/css/txt 路径出现在主 Rust ELF，并要求本机 notice 包含 Logto。它没有比较随包文件内容、当前 commit 或构建批次。独立构造的微型 APK 仅有匹配的 ELF 头和当前资产路径字符串，没有完整 UI 内容；使用一次性测试证书签名、实际 zipalign 后，整个 release checker 返回 0。缺失 `mobile.html` 字符串时则确实拒绝。因此日志中的 “bundled UI” 只能理解为路径存在门禁，不能扩大成完整内容验证，也不能保证拒绝所有同 ABI、同版本、同资产名的陈旧 APK。

这是基线已有逻辑，本轮保留，未发现新增绕过。正常新鲜度来自成功的 Tauri/Cargo 构建链及最终精确源码构建证据。将来若要求 APK 单体证明源码/资产新鲜度，应另加可核对的构建身份或内容摘要。此次最终真实构建仍需检查实际随包 UI，不以合成夹具通过代替。

### N2 — P3，non-blocking：旧产品文档仍保留历史 universal 输出名

`docs/android-account-entry.md:53` 仍写 `release/anywork-android.apk`；本轮新的 `docs/mobile-build.md:16` 与 `6c08d215:docs/releasing.md:107` 已明确四包及 v35 分界。用户已明确覆盖旧路径，代码与新发行契约一致；建议协调者在后续统一文档时同步该历史入口。本 reviewer 未越过只写报告的文件边界。

## Build lane：独立证据

### CLI、真实 Gradle 输出与任务图 — PASS

不是依据作者日志判断 CLI 行为。实际执行安装的 `tauri-cli 2.12.4` 的 `--version` 和 `android build --help`，并独立下载官方 [tauri-cli 2.12.4](https://static.crates.io/crates/tauri-cli/tauri-cli-2.12.4.crate)、[cargo-mobile2 0.22.5](https://static.crates.io/crates/cargo-mobile2/cargo-mobile2-0.22.5.crate) 源码，核对 `src/mobile/android/build.rs`、`src/android/apk.rs` 和 target 映射：

- CLI 执行一次 beforeBuildCommand，再初始化首 target 的 Rust/plugins；split 模式传入各 `assemble<Arch><Profile>`，不会 assemble universal。
- 官方 `apks_paths` 为 `app/build/outputs/apk/<flavor>/<profile>/app-<flavor>-<suffix>.apk`。Release 可有 signed/unsigned 两个 suffix；canonical 入口强制签名配置，不能回退取旧 unsigned 包。
- 实际 Gradle 9.6.1 / AGP 9.3.1 配置解析并枚举 applicationVariants 的 outputFile，验证 signed 配置下四个路径如下。签名配置枚举只用虚设测试路径，不读取正式密钥，也不执行签名。

| CLI target | flavor / task arch | signed Release 源文件 | 最终文件 |
| --- | --- | --- | --- |
| aarch64 | arm64 / Arm64 | `apk/arm64/release/app-arm64-release.apk` | `release/anywork-android-arm64.apk` |
| armv7 | arm / Arm | `apk/arm/release/app-arm-release.apk` | `release/anywork-android-armv7.apk` |
| i686 | x86 / X86 | `apk/x86/release/app-x86-release.apk` | `release/anywork-android-x86.apk` |
| x86_64 | x86_64 / X86_64 | `apk/x86_64/release/app-x86_64-release.apk` | `release/anywork-android-x86_64.apk` |

对应位置：`scripts/build-android.sh:42`、`:57`、`:81`。脚本没有 universal/legacy release alias 复制逻辑。默认 arm64 debug 仍是 CI 所需的 `artifacts/anywork-android-debug.apk`；其他 debug 各自带架构名。

实际 Gradle dry-run，而非 mock task 名称：

1. 同时解析四个 `:app:assemble{Arm64,Arm,X86,X86_64}Release`，四项存在且没有 universal assemble。此处显式排除 Rust，所有 APK 任务 dry-run，不生成二进制。
2. 四个 Release lint + App UniversalDebug JVM + system/auth/core JVM 的完整后置命令成功解析，排除 Universal 与四 flavor 的 Debug/Release Rust 任务后，任务图中没有 `rustBuild*`。
3. 每个单 target 分别解析 Debug lint + 相同共享 JVM 命令，仅使用 canonical 对该 target 的排除集合，四次均成功，均没有 Rust build、APK assemble/package。
4. 实际任务枚举仅有五个 `test*DebugUnitTest`，没有 `test*ReleaseUnitTest`。当前共享 Debug task 合法；不能改为不存在的 Release UnitTest。

Gradle 验证使用从 `git archive e743029e` 导出的临时小型源码工程，复用本机 SDK、NDK 和 Gradle 缓存；按现有 tauri-build 生成器规则补入临时 settings/build include 和 version properties。未运行 Tauri 的完整生成/成包流程，这一差别保留在最终构建边界内。

### 真实 JVM 执行 — PASS

在上述精确源码临时工程中实际运行：

```sh
./gradlew --offline --console=plain \
  :tauri-plugin-mobile-system:testDebugUnitTest \
  :tauri-plugin-mobile-auth:testDebugUnitTest \
  :anywork-logto-core:test
```

Gradle `BUILD SUCCESSFUL`；JUnit XML：system **11**、auth **8**、core **7**，合计 **26 tests / 0 failures / 0 errors / 0 skipped**。App UniversalDebug task 只验证了任务图，未执行其 Kotlin 编译或测试；当前受控 App 源码没有独立 `src/test` 用例，不能把任务存在写成额外 App 覆盖。

### strip 环境与 Debug 兼容 — PASS（有明确实测范围）

`scripts/build-android.sh:27` 只在 release 分支 export `CARGO_PROFILE_RELEASE_DEBUG=0` / `CARGO_PROFILE_RELEASE_STRIP=symbols`。未改变 workspace profile、panic、codegen-units 或启用额外 LTO；前置 commit 的标题不能代替实际源码。Debug 未设置这两个变量。

固定 CLI 上游的 `src/mobile/mod.rs` 将 `CARGO_*` 加入 options，两个变量不匹配 secret 过滤项，`read_options` 在 Android Studio script 子进程中恢复它们；`android_studio_script.rs` 再执行 target build。实际 Gradle Exec 子进程探针看到了 release 的 `0` / `symbols`，第二次使用同一 Gradle daemon、未设置这些变量的 debug 探针得到两个 null，没有残留。

另建无外部依赖的极小 Rust cdylib，以 NDK27 / Android26 linker、`aarch64-linux-android` 实际编译 Debug 与 Release，检查 `llvm-readelf`：

| 样本 | bytes | .symtab / .debug_info | 动态 JNI 导出 | PT_LOAD 16 KiB |
| --- | ---: | --- | --- | --- |
| Debug | 4,314,624 | 均保留 | 保留 | PASS |
| Release（上述两个变量） | 306,056 | 均不存在 | 保留 | PASS |

该探针证明 Cargo/NDK 对配置的实际响应，不是 AnyWork 包体积、完整 JNI/TLS 功能或完整 Tauri→Gradle→Cargo 成包实测。完整链只做了源码追踪、Gradle 环境验证和任务图验证。

### ABI、所有 JNI ELF、对齐、身份、签名与 UI gate — PASS / LIMIT

`scripts/check-android-apk.py:49` 强制主库恰好一个，所有 `lib/**/*.so` 必须是指定 ABI 的单层库路径，并逐个验证 ELF class/machine 与所有 PT_LOAD 的 p_align。架构要求为 AArch64 64/183、ARM 32/40、x86 32/3、x86_64 64/62；不能靠目录改名冒充 ABI。

独立重跑作者的 **8 项**负向/正向测试，覆盖四种单 ABI、缺失主库、错误 ABI、多 ABI、外来依赖、重复主库、伪标 ELF、4 KiB ELF，全部通过。这些直接调用生产 layout parser，确实能捕获架构门禁回归；测试使用合成 ELF 头，不表示链接器/运行时接受这些 ELF，也未覆盖 shell wrapper 或完整 checker 外部工具。

因此另用真实 SDK36 的 aapt、zipalign、apksigner、Java17 keytool 和自有一次性证书执行完整 checker，得到：

| 探针 | 实际结果 |
| --- | --- |
| 单 x86，正确身份/证书、16 KiB ZIP 与 ELF、当前 UI 路径键 | exit 0 |
| 混入 x86_64 的依赖库 | exit 1，only the requested ABI |
| 同 x86 目录的依赖实际是 ARM ELF | exit 1，architecture mismatch |
| 同 x86 目录的依赖 PT_LOAD 为 4 KiB | exit 1，alignment smaller than 16 KiB |
| versionCode 错一版 | exit 1，upgrade metadata mismatch |
| 缺少 mobile.html 路径键 | exit 1，built local asset keys |
| APK 签名证书与配置 keystore 不同 | exit 1，configured upgrade certificate |
| 不传 --abi | exit 2，required argument |

两把独立测试密钥随后删除，无正式发行凭据参与。正确样本是 checker 边界夹具，不是可运行业务 APK；N1 已记录它暴露的 UI 内容验证限制。

还只读复核了作者已下载的公开 v34 原件：**204,082,412 bytes**，SHA-256 `3d5f47736b953e12a8d7423af60fb1cc34c7c0232a673f7b3557d8783854ea74`。新 layout checker 将其作为单 arm64 包检查时明确拒绝 foreign ABI；四个真实主 ELF 分别通过对应 machine/class/16 KiB 检查。没有重新复制或下载这份 195 MiB 包。

陈旧输出边界：脚本只读取当前 flavor 的精确 signed/debug 路径，不扫描“最新 APK”，也不回退 universal/unsigned；错误 ABI/旧 universal 不能通过。它不会删除工作目录原有 alias，也没有同 ABI 同版本的内容/构建批次新鲜度证明；应以命令成功退出及最终受控构建为准。复制发生在 checker 之前，失败后目录里残留的文件不能视为已验收。跨 lane workflow 的严格归档集合检查会拒绝混入 legacy alias，见下节。

## Publisher / site 跨 lane：独立证据

### 版本化发行集合与四矩阵对接 — PASS

核对 `6c08d215:scripts/publish.py:67`、`:469`，按数值版本分界：

- `<= v0.1.34`：20 assets、19 checksum entries，使用真实旧 universal 文件名。
- `>= v0.1.35`：23 assets、22 checksum entries，仅四个架构 APK。缺包、重复 asset、legacy/universal alias、错名替代均拒绝；checksum 缺失、重复或额外旧 APK 条目同样拒绝。
- 每个 asset 继续核对 state、非零 size、精确 tag/name URL 和 GitHub digest；五个桌面 updater 的签名文件/manifest/version 绑定仍保留。安装包只 HEAD，不 GET 大型包体。

`.github/workflows/release.yml:113` 四个 matrix 的 CLI target / Rust triple / 最终命名与 build lane 全部一致；单 target 调用 canonical 入口，每项完整 checker 后才上传指定 APK。`publish.needs` 包含整个 Android matrix，任何 ABI 失败不会发布部分集合。`:210` 在 sha256sum 和 `gh release create` 前核对精确集合；混入 `anywork-android.apk` / `anywork-android-universal.apk` 或缺任一 ABI 会失败。

独立运行 `publish-test.py`：**33/33 PASS**，包括执行 workflow 的内嵌 Python 集合检查，实际在临时目录添加 stale alias、删除单 ABI 后观察拒绝；不是只匹配 YAML 字符串。matrix 配置的文本断言同时核对了四项映射。最后补跑 `release-ci-test.py` **10/10**、`release-version-test.py` **4/4**。没有 dispatch Actions 或运行真实 publisher mutation。

### 真实旧 v34 核验兼容 — PASS

使用 `85764118` 的生产 `Publisher.verify_release('v0.1.34')`、`verify_site(release)`，仅将网络适配器替换为**无 token 的匿名 GET/HEAD**并拒绝其他 HTTP method。没有调用 publish/pages-only、没有创建 state、没有触碰账号授权。验证涉及的小 metadata/签名 GET 与安装包 HEAD 均成功：

- [真实 v0.1.34](https://github.com/ywateru/AnyWork/releases/tag/v0.1.34)：20 assets / 19 checksums / 五签名元数据绑定全部通过；tag 解引用源码 `fa166c41bcf9a30fc6027947e884802f4a6d06f8`。
- [当前官网](https://anywork.aixgg.com)：release.json 与 en/zh 静态页面的 v34 下载集合、尺寸及 URL 匹配，验证通过。

该次未要求官网 `build.json` 绑定本次 review SHA，不能称作新源码已部署。`6c08d215` 只改 check.sh 接线与 site-test 去重，已逐文件确认 publisher/build-site/app/workflow 及 publisher 测试与 `85764118` 完全相同，因此真实 v34 结果适用于最终 lane；未无故重复网络核验。

### 静态、动态单调性与标签 — PASS

`scripts/build-site.py:23` 在替换已有 dist 前校验精确版本化 Android 集合与 tag/架构 URL。新版本不会回退 universal；无 release 时四个按钮指向发行列表。`site/app.js:54` 从静态 body 读取已应用版本，以 BigInt 数值比较；较旧响应不能覆盖静态或动态新版本。Android 集合完整验证后才替换按钮，保留两种语言的四架构标签。

最终组合独立执行 `build-site-test.py` **4/4 PASS**；执行完整 `site-test.mjs` **PASS**，覆盖：

- en/zh × 1440/1024/768/390/320px，无水平溢出、脚本错误，链接及本地资源有效。
- 实际 build-site 输出的 v34/v35 无 JavaScript 页面；旧版一个 universal、新版四个精确 ABI URL。
- baseline/live 两种响应乱序；静态 v35 遇 v34、缺包、混包、重复、错 URL 的刷新均保留 v35。
- 下载按钮按 ARM64、ARMv7、x86、x86_64 排列；ARM64 标“推荐/Recommended”，其余明确 32/64-bit 与 ARM/Intel。另独立查看 en/zh 的 320px 截图，四按钮可读且完整显示。

本机 Playwright 默认 bundled browser 不在缓存，首次启动在执行页面前失败；随后设置测试已有的 `PLAYWRIGHT_CHANNEL=chrome`，使用已安装 Chrome 的临时隔离 profile 完整通过。未下载浏览器、未接触用户 Chrome profile、账号或会话。

## 验证可追踪性与资源边界

独立原始日志/JSON 保存在本 WT ignored `artifacts/independent-review/`：`gradle-*-dry-run.log`、`gradle-signed-outputs.log`、`gradle-app-unit-task-list.log`、`gradle-jvm-tests.log`、`jvm-test-counts.json`、`cargo-profile-results.json`、`apk-gate-results.json`、`public-v34-native-results.json`、`release-8576411-{publisher,static-site}.log`、`release-8576411-real-v34.json`、`final-composite-*.log` 和两张 320px 截图。日志不随此报告提交。

site/publisher 的初次测试在 `git archive 85764118` 的临时源码快照执行；最终将快照中的两个文件替换为 `6c08d215` 的精确内容，并叠加 `e743029e` 的四个 build lane 文件后验证持续接线与浏览器。没有将其他 lane 的未提交改动纳入审查，没有在真实 WT 中 cherry-pick/改源码。主仓库 node_modules 当时缺 Playwright；因此临时快照仅链接 build WT 已有 node_modules，未 npm install/ci、未复制依赖。Gradle/SDK/NDK 使用现有缓存，小型 Cargo 探针仅生成自己的小 target。

本 WT 的产品源码保持在 `e743029e`，只增加本报告；另一 lane 源码只读。未使用 adb、设备/模拟器、真实业务账号、正式 keystore、用户 Claude 会话或运行中的宿主服务。未发布、改 tag、修复线上站点或执行大型四 ABI build。

## 最终发行仍需补齐的 BLOCK 证据

以下是用户安排的最终构建/发行验收，不能由此次 source PASS 关闭：

1. mobile bugfix 与两 lane 合入后，记录精确源码 SHA；实际执行四个单 target Release canonical 构建（或本地一次四 target 的等价 split 流程），每包真实 R8、对应 lint、共享 JVM、checker 成功。
2. 列出四包的最终文件名、bytes、SHA-256、应用 versionCode/versionName、签名证书摘要；证明每包唯一正确 ABI，所有 JNI ELF 与 ZIP 16 KiB 对齐，正式发布时四包均匹配既有升级证书。此次未读正式 key，也未证明新包正式签名。
3. 实际检查四个新主库的 stripped sections、动态 JNI 导出、随包 UI/notice 与构建来源；需要用户可见业务运行时，按已约定的 Android 运行验收补充。tiny cdylib/合成 APK/旧 v34 原件都不能替代。
4. 新版发行实际 23/22 和官网精确源码/下载链接验收，必须基于未来真实 release；目前只有新版本离线夹具与真实旧 v34 的只读兼容验证。

结论：**两条精确源码 lane 独立审查 PASS；最终四 ABI 真包及新版本发行验收保持 BLOCK（有意后置，待统一构建），无未关闭源码阻塞发现。**
