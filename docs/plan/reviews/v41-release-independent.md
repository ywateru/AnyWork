# v0.1.41 正式发行独立验收

日期：2026-11-15。非作者 reviewer；隔离 WT `.worktrees/v39-release-verify` / `codex/v39-release-verify`。只提交本报告，不修改 main、源码、tag、附件、部署或 publisher state。

**结论：正式资产 PASS；官网已完成的匿名响应检查 PASS，无新增资产阻断项。** 官网 `/source` 独立正文下载超时，未完成线上归档逐 blob 核验；该项不能记为独立 PASS。自动网站 workflow 仍失败，人工恢复不改变该事实。

## 固定身份与 CI

- 精确源码：`f669ef59bde7cb70bbe98fd59592b6f87e93698b`；版本 `0.1.41`，Android code `43`。
- annotated tag `v0.1.41` 的 object `832ecae86680d3c54edab110180c33c694dfb528` 独立剥离到上述源码。
- [Checks 43693890505](https://github.com/ywateru/AnyWork/actions/runs/43693890505)：attempt 1，正确 main/push、active CI workflow，5/5 jobs success。
- [Build releases](https://github.com/ywateru/AnyWork/actions/runs/43695877532)：attempt 1，精确源码，12/12 jobs success。
- [正式 Release](https://github.com/ywateru/AnyWork/releases/tag/v0.1.41)：stable、非 draft，`published_at=2026-11-15T09:00:18Z`，公开 latest 同一 release。

结论来自独立读取的 API、tag 和日志。精确源码 server-web job `132750097101` 完整 `check.sh` 成功：日志含 Rust 1.100，严格 workspace/all-targets Clippy 在第 4497 行完成；review suite 在第 6365–6367 行显示 13 tests / OK / 1.340s。默认 unittest 未逐项打印名称；固定源码脚本有 13 项并包含此前失败项，补全旧 binary 局部验证边界。

历史失败继续保留：v39 Checks `43689682124` 是确定性 Clippy `chunks_exact_to_as_chunks` 失败，修复 `84f48bdd1ecf02cb405363bf8e11f4109c93ea3d` 已独立接受；v40 Checks `43691054293` 两次 attempt 的 review fixture 均在第 221 行 INSERT 报 `sqlite3.DatabaseError: file is not a database`，13 项中 1 error。旧 `*.sqlite*` glob 有主库/WAL/SHM 选择歧义，**日志未捕获实际选中文件名，不能宣称直接观测到误选 sidecar**。精确主库路径修复 `9398398c269bd10f8207094ef3a3fcf0e4ad5124` 未削弱断言，本版精确 CI 已通过。此前独立报告见 `v40-clippy-independent.md`、`v41-review-fixture-independent.md`。本轮未重复本地测试、构建或重试远端任务。

## 资产与四 APK

独立明确枚举预期集合：23 个唯一、已上传、非空附件；`SHA256SUMS` 有 22 个唯一条目，集合精确等于附件集合减去自身，每项匹配 GitHub asset digest，校验文件正文也匹配自身 digest。Android 恰为 `anywork-android-{arm64,armv7,x86,x86_64}.apk`，无 universal/alias。

`latest.json` 为 `0.1.41`，五目标集合为 darwin-aarch64、darwin-x86_64、windows-x86_64、linux-aarch64、linux-x86_64；URL 绑定正确 tag/附件，签名字段逐字匹配对应 `.sig`，base64 解码后版本注释绑定 `0.1.41`。小文件均验证正文摘要。**这是五项签名元数据/版本绑定验证；未下载桌面大包或执行其正文密码学签名验算。**

四个正式 APK 各下载一份，实际完整 SHA-256 同时匹配校验文件与 GitHub digest，总计 154,148,309 bytes：

| ABI | bytes | SHA-256 |
| --- | ---: | --- |
| arm64 | 39,274,111 | `a31c8cc1404b9efa4ebfb4cfab526c85edc3397c28242e74910053cc5f07e434` |
| armv7 | 28,574,769 | `f54c54917cceccf0b54d846f79cc6a5d4eacecadd6ef0de9e7d7d3c3da378cdd` |
| x86 | 43,721,441 | `0788e2b04ef6670dbdbd93170ba656fe713ee591c98ff731bb61b1298f5d43e1` |
| x86_64 | 42,577,988 | `4687fe0780880d095333f513c300f3713b6d662fc6d8e9ee942c4b0c4d2b42bc` |

既有 SDK 36 的 aapt/apksigner/zipalign 和实际 ELF/DEX 解析结果四包均 PASS：

- manifest/随包 Tauri config 均为 `dev.remoteagent.app`、`0.1.41`、code43；minSdk26，非 debuggable。全部 JNI/ZIP 条目枚举无混 ABI 或重复，目标 ELF bitness/e_machine 依次 64/183、32/40、32/3、64/62，每包仅对应 ABI 的 `libanywork_mobile.so`。
- `apksigner verify --verbose --print-certs` 实际通过，单一官方证书 SHA-256 均为 `88b43f83632002fbeddd23a286eabee39c5ada0fa1b037d6ff32b9986a67acb8`，与既有 v34/v38 正式包记录一致；相同 appID/证书及递增 code 满足升级身份条件，未做设备安装/升级。
- `zipalign -c -P 16 4` 通过，stored JNI 数据偏移为 16 KiB 整数倍；所有 ELF PT_LOAD 的 p_align≥16384，offset/vaddr 对16 KiB 同余。无 symtab/strtab/debug/zdebug sections，dynsym/dynstr 保留；未重做旧版 dynexports 全量比较。
- 实际 DEX class definitions 均包含 `org.rustls.platformverifier.CertificateVerifier`、`StatusCode`、`VerificationResult`，不是仅搜索字符串；不代表本版 JNI/TLS 已在设备运行通过。

正式 Android jobs x86 `132756196862`、armv7 `132756196879`、x86_64 `132756196896`、arm64 `132756196941` 的日志均独立读回：checkout 精确源码，Release `debug=0, strip=symbols`，官方 checker 的 ABI/native/signature/16 KiB/随包 UI 门禁通过；四 job UI 输出同为 `assets/mobile-DY-FZKUk.css`、`assets/mobile-CUUO_t6s.js`。本轮未重新独立解码全部422个 UI 资产，随包 UI 证据来自正式 checker/构建日志；app `testUniversalDebugUnitTest NO-SOURCE` 不计为有效 app 单测数量。

## 源码与网站上传边界

正式 `anywork-source.tar.gz` 实际完整正文独立验证 PASS：10,697,188 bytes，SHA-256 `af5f4e5605a57b9ee3fd6e28379e3263aedd95e69027dcd403b1a948f2d70baf`。按固定源码公开导出契约选择文件，逐项计算实际 tar 文件 Git blob ID，并与精确 tree 的 blob ID/可执行 mode 比较：**1050 文件全部一致**，集合匹配 SOURCE_MANIFEST；无重复/越界/额外源文件，仅生成 manifest。

网站作者 report-only commit `eec543eb03b7894040ad1337584a0956ada86271` 已独立读取，路径 `docs/plan/reviews/v41-site-manual-recovery.md`。作者记录精确源码本机 OAuth 人工上传447文件，部署 <https://anywork-r44p9fjfo-yywater68-1778s-projects.vercel.app>，作者读回时间09:06:35Z。本 reviewer 未部署、重建或重跑作者 `--verify-existing`。

独立取得的9个线上正文逐项匹配作者 root `artifacts/v41-site-final-deploy/upload-manifest.json` 摘要，动态脚本另直接匹配固定 Git `site/app.js`；**没有独立复核全部447上传文件或复现网站构建**。build 标记、公开配置和这些摘要提供明确的绑定证据，其范围不扩张到所有构建输入/输出。

`/source` 独立 HEAD 200、application/gzip、Content-Length 10,649,422、安全头正确；一次独立正文 GET 发生 `socket.timeout: The read operation timed out`，未取得完整正文/摘要/blob结果，未重试。作者报告其线上归档 SHA-256 `2f9fc18e6286237aa046365775a6e6e628f3744f8d14316d5fad14d8c8c19a84`、1050 blob 与精确源一致及公开读回一致，**仍属作者证据，不写成独立正文 PASS**。网站与正式归档大小/摘要不同，未要求或宣称 gzip bytes相同，未独立确认差异具体原因。

## 官网匿名响应验收

2026-11-15T09:10:36Z 快照，无 CookieJar、Authorization、浏览器 profile、CUA 或登录。对既有响应核对14项，全部 PASS；未重复作者测试套件。

| 范围 | 独立结果 |
| --- | --- |
| `/build.json` | 200，精确 source f669ef59… / version0.1.41 |
| `/release.json` | 200，23项暴露的名称/URL/大小等字段逐项匹配正式 Release |
| `/en/`、`/zh/` | 200，v41四个正式 APK URL；ARM64首位且明确推荐，ARMv7=32位ARM、x86=32位Intel、x86_64=64位Intel，无旧alias |
| `/app/`、`/app.js` | 200；官网动态脚本与固定 Git blob 完全相同 |
| app entry/markdown/CSS | 200；实际入口 `/app/assets/index-BVAcaOfc.js`，连同上述响应共9正文匹配上传清单 |
| 公开配置 | 实际 materialized production env 与固定源码 `web/src/accountConfig.ts` 默认值一致，portal=`https://anywork.aixgg.com/app/`；不是仅凭 fallback 字符串判断 |
| 诊断/外链 | 五阶段中英详情、允许错误码及整数400–599状态守卫；外链clientId公开config路径，target=_blank/rel=noreferrer；匿名GET200且clientId/issuer/resource正确 |
| 动态下载 | 交付脚本拒绝版本回退，>=35要求完整四ABI且URL绑定相同tag；文本核对，未运行浏览器交互 |
| `/source` | HEAD200/gzip/安全头通过；正文独立核验未完成 |

五阶段为账号设备资料、在线状态服务配置、在线状态授权、在线状态服务会话、设备在线状态查询，保留“匿名可达不代表账号授权”提示。外链未带本次匿名客户端账号凭据；noreferrer不保证浏览器不发送目标站已有cookies。

10个本站响应（含source HEAD）均只有一条预期CSP，并有nosniff/no-referrer；公开绑定auth=`https://auth.x.aixgg.com`、grid=`https://anywork-cybergrid-selfhost.vercel.app`，connect-src另保留self/GitHub API/`wss://*.trycloudflare.com`，form-action仅self/auth；公开config issuer为auth的`/oidc`、resource为grid的`/api`。

## 保留边界与清理

[官网workflow43697104748](https://github.com/ywateru/AnyWork/actions/runs/43697104748) 同源仍为 **failure**；独立日志确认 Pull production configuration 报 `The token provided via --token argument is not valid`、exit1。父端报告publisher session61058 exit1 / `phase=pages`。人工站点恢复不代表CI token/workflow/publisher已修复，本 reviewer未修改状态。

本次无ADB/设备/真实账号/会话/远程工作区操作，无本地Cargo/Gradle构建。SM-G9500此前候选实机证据不转写成本版正式包设备验收；TLS初始化/loading修正不等于剩余蜂窝协调网络或工作区连接已解决。线上source正文独立验证、桌面正文签名及设备运行继续保留上述边界。

证据位于本 reviewer WT ignored `artifacts/v41-release-independent/`：assets/source/native-details/android-job-source/checks-final verdict、各ABI工具日志、API/tag/CI日志、`site/http-readback.json`、`site/verdict.json`、`site/source-download-boundary.json`。v40两次失败证据仍保留于 `artifacts/v40-release-independent/`。

四APK唯一reviewer副本保留在 `artifacts/v41-release-independent/apks/`（154,148,309 bytes）供父端复用。已移除核验后的10,697,188-byte正式source gzip，保留blob/摘要；无partial/自建Python cache，网站失败下载未落盘。未新建target/node_modules/依赖副本/服务/监控，所有本次命令结束后无自建后台进程，无运行中的共享缓存依赖。父端整合报告并接管所需APK/日志后可清理reviewer WT；作者WT/产物及共享依赖未动。
