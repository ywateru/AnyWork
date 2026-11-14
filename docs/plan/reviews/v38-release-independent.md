# v0.1.38 正式发行与网站独立验收

验收日期：2026-11-14（Asia/Shanghai）。角色：非作者 reviewer，直接读取精确提交、官方构建日志、正式附件与匿名线上响应。结论：**本次四 ABI 正式 APK、发行集合与生产网站验收 PASS，无新增阻断发现**。自动网站部署凭据仍有已知阻断，手动部署恢复不等于工作流修复；真机安装、账号登录与现场连接问题不在本次通过范围。

本报告只归档最终 v38 实物验收，承接之前 Android split/build、publisher 与版本夹具审查；没有重复构建或重跑这些测试。

## 1. 精确身份与证据位置

| 对象 | 独立读回结果 |
| --- | --- |
| 源码 | `ef0a7140e420888ea38959fa60cbef4f2a2e84f8`，版本 `0.1.38` |
| Checks | [43555523286](https://github.com/ywateru/AnyWork/actions/runs/43555523286)，精确源码、completed/success |
| 正式发行构建 | [43557871642](https://github.com/ywateru/AnyWork/actions/runs/43557871642)，四个 Android job 均 success |
| 正式 tag | `v0.1.38`；annotated tag object `92e19cfed3be87968777d7dbc38e4b03116146e0` peeled 到上述源码 |
| 正式 Release | [v0.1.38](https://github.com/ywateru/AnyWork/releases/tag/v0.1.38)，API published_at `2026-11-14T04:57:52Z` |
| 生产站 | [anywork.aixgg.com](https://anywork.aixgg.com)，匿名读回 `build.json` 为精确源码 / `0.1.38` |
| 报告工作树 | `.worktrees/notification-replay-check`，写报告前 clean，HEAD `954aa3ba00c9c35a3e1dc5b52985c343fedf5dde` |

独立原始证据位于仓库根目录 ignored 的 `artifacts/android-v38-independent/`（下称 `E/`）。没有把 APK、日志或下载响应提交到 Git。主要汇总：`public-release-verdict.json`、`package-verdict.json`、`ui-source-binding.json`、`job-source-ui-binding.json`、`updater-metadata-verdict.json`、`site/verdict.json`、`site/source-blob-verification.json`。各 ABI 的签名、badging、manifest、zipalign、readelf、导出符号和随包资源清单均单独保留。

`package-verdict.json` 保留取得 artifact 时的保守状态文案；最终是否正式发行及与公开附件的关联以随后生成的 `public-release-verdict.json` 为准。

## 2. 正式集合与获取链：PASS

独立匿名读回 Release API 与 `SHA256SUMS`：恰好 **23 个唯一、非空、uploaded 资产和 22 条唯一 checksum**，校验项集合等于资产集合去掉 `SHA256SUMS`，全部与 GitHub SHA-256 metadata 一致，checksum 文件本身的完整内容摘要也匹配 GitHub digest。Android 恰好四个文件：

- `anywork-android-arm64.apk`
- `anywork-android-armv7.apk`
- `anywork-android-x86.apk`
- `anywork-android-x86_64.apk`

没有 universal 或 alias。全部使用精确 v38 官方下载 URL。

ARM64、ARMv7 从本轮官方 Actions artifact ZIP 取得；完整 ZIP SHA-256 分别匹配 API digest，再解出 APK。现有 APK 的全文哈希、大小匹配公开 Release 的 GitHub asset digest、`SHA256SUMS` 和 HEAD 长度，因此复用已有文件，没有再次下载 APK body。artifact ID 分别为 `14100045388`、`14099860309`，ZIP SHA-256 分别为 `bf60506d2cf46ea28e0e7057a27fc54f2d258d11ad04c94e4e8d6ff52c4bb560`、`85123be4cf7ab58c7e318800f006ea3348519e05bfeae3a887d46d77243d76a2`。

x86、x86_64 各自只完整下载一次正式公开 APK body，全文哈希同时匹配 GitHub digest 与 `SHA256SUMS`。未完整取得这两项 Actions ZIP，不声称独立比较过它们的 artifact body；其构建关联依据精确 tag/run/job 日志及正式附件元数据。

ARMv7 的首次传输 180 秒超时后经 Range 续传完成，最终完整 ZIP digest 通过，是网络传输瓶颈。公开附件可用后停止自建 artifact 下载进程，删除未完成 x86 ZIP。最终每 ABI 只保留一份完整 APK，无下载阻塞。

## 3. 四包大小、ABI、签名与对齐：PASS

旧 v34 universal APK 基线为 **204,082,412 bytes**，SHA-256 `3d5f47736b953e12a8d7423af60fb1cc34c7c0232a673f7b3557d8783854ea74`，只读使用 `.worktrees/android-size/artifacts/anywork-v0.1.34.apk`。

| ABI / 正式文件后缀 | APK bytes | MiB | 相对旧 universal 减少 | 唯一 JNI ELF bytes | ELF bits / machine | dynexports：v38 / v34 |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| arm64 | 39,251,019 | 37.43 | 80.767% | 37,408,080 | 64 / 183 | 25 / 25 |
| armv7 | 28,558,341 | 27.24 | 86.006% | 26,715,400 | 32 / 40 | 24 / 24 |
| x86 | 43,714,429 | 41.69 | 78.580% | 41,871,496 | 32 / 3 | 24 / 24 |
| x86_64 | 42,539,280 | 40.57 | 79.156% | 40,696,344 | 64 / 62 | 24 / 24 |

| 正式 APK | 全文 SHA-256 |
| --- | --- |
| arm64 | `aaad83914bbfaedf2105977ec7129651f7fcbe66c23dadfaddff41b5973e49ae` |
| armv7 | `22b51e4399183229464337e056fa35b31f08cb679b5e2c8cfd182b7066eb35c4` |
| x86 | `6418df1cc7e22fcd083d44479a5a6a271abe974494d8e4f4cf508338953c1540` |
| x86_64 | `8b6b27dff2e2329688b84b274722ba32b0f9d892d3edf15fcbd2ced7e9905317` |

逐包独立使用 SDK 36 的 `apksigner`、`aapt`、`zipalign` 和 NDK ELF 工具，并解析 ZIP/ELF 内容：

- 应用 ID 均为 `dev.remoteagent.app`，versionName `0.1.38`、versionCode **40**，minSdk 26、targetSdk 37；`debuggable=false`、`extractNativeLibs=false`。源码 mobile 配置同为 code 40。
- 各包仅含对应的一个 ABI、一个 JNI `.so`；枚举检查全部 JNI ELF，而非只按主库文件名抽查。ELF bitness/machine 与路径、声明 ABI 一致。
- 所有 ELF 无 `.symtab`、`.strtab`、`.debug*`、`.zdebug*`，保留 `.dynsym`/`.dynstr`；每 ABI 动态导出集合与 v34 完全相等，新增/删除均为空。
- 全部 `PT_LOAD` 的 `p_align=16384`，offset/vaddr 满足 16KiB 同余；JNI ZIP entry 为 stored，实际 data offset 均为 933,888（16KiB 对齐）。四包 `zipalign -c -P 16 4` 均 exit 0。
- 四包 `apksigner verify --verbose --print-certs` 均 exit 0，单 signer、APK Signature Scheme v2 通过。证书 SHA-256 均为 `88b43f83632002fbeddd23a286eabee39c5ada0fa1b037d6ff32b9986a67acb8`，与此前独立验证的 v34 正式证书一致。
- v34 badging 本轮只读复核为 `0.1.34` / code 36，同 ID、相同 min/targetSdk；因此满足同证书、同应用 ID、递增 versionCode 的升级身份条件。没有执行真机覆盖安装或数据保留验证。

上述减少比例是 APK 下载文件相对旧 universal 的比较；不是安装占用测量。每 ABI 原生库相对 v34 同 ABI 分别减少约 30.974%、33.715%、22.565%、24.149%，但源码也有变化，不能把所有差值归因于 strip。

## 4. 随包 UI 与精确构建关联：PASS

为补足原 checker 只验证 key/marker 的继承边界，本次直接从每个 ELF 的 Tauri PHF 资源表及 relocation 提取资源，**实际 Brotli 解压每包全部 422 项**，逐项记录压缩/解压 SHA-256。四 ABI 的完整资源清单及内容完全一致；不是只搜索二进制字符串。

实际解析 `mobile.html` 及其 entry JS、CSS、preload，所有引用目标随包存在。主 JS 为 `assets/mobile-YW2D0UpJ.js`，解压后 1,023,824 bytes，SHA-256 `b1f09c7000c3f045a9b4db7be1a3031e8b0aa06014d1d01529276c28388bcf3c`；CSS 为 `assets/mobile--F7r0Gin.css`，另有 `assets/markdown-PPMuno5o.js`。随包 THIRD_PARTY_NOTICES 包含 Logto。

包内 Tauri 配置确认本地 `mobile.html` 入口、`../../web/dist-mobile`、`useHttpsScheme=true`、正确应用身份与版本。四包均包含 `MOBILE_COORDINATION_CONFIG_FETCH_FAILED`、`MOBILE_COORDINATION_REGISTRATION_FAILED`、`MOBILE_COORDINATION_DIRECTORY_FETCH_FAILED` 三项 Native 阶段码。

此外，12 个 tracked `web/public` 文件的解压内容逐一匹配精确源码 Git blob。四个官方 Android job 日志均确认相同精确 checkout、`debug=0, strip=symbols`、相同 Vite mobile main/CSS 及 APK checker 成功；各 job 中全部 Vite 输出路径均存在于实物资源表。对应 job ID 为 armv7 `132334753467`、arm64 `132334753470`、x86_64 `132334753493`、x86 `132334753507`。

日志表明真实 release 构建及后续 Gradle/lint/shared JVM 流程成功；其中 `:app:testUniversalDebugUnitTest` 明确是 `NO-SOURCE`，不能记作 App 单测覆盖。本轮未启动本地 Cargo/Gradle、未复跑小测试；真实四包产物与官方日志补足此前没有实际新 build 的验收边界。没有独立重建，也不声称已取得可复现构建证明或完整源码到机器码的独立证明。

## 5. 生产网站匿名读回：PASS

使用无 cookie jar、无 Authorization 的独立 HTTP GET/HEAD，未使用浏览器、缓存 profile、登录或真实账号。`E/site/verdict.json` 的 14 项检查均 PASS，保留原始响应及 HTTP header/digest：

- `/build.json` 精确绑定 ef0 / `0.1.38`；`/release.json` 的资产名称、大小、官方 URL 与正式 v38 的 23 项集合一致。英中页面、`/app/`、实际公开模块及公开配置端点均 HTTP 200。
- 英中静态页各有四个正确 v38 APK 链接，ARM64 排首并标注推荐；ARMv7 / 32 位 ARM、x86 / 32 位 Intel、x86_64 / 64 位 Intel 标签清楚，没有 universal 回退链接。
- 实际 live `site/app.js` 与精确源码 Git blob 相同；下载逻辑中的版本单调性、`>=35` 四架构集合要求及无新版 universal fallback 已检查。这里是响应/源码检查，没有执行浏览器动态交互。
- 每个受检站点响应仅一份 CSP，绑定精确源码 public defaults，并有 `nosniff`、`no-referrer`。检查实际 materialized bundle 的生产值，避免把 fallback 字面量当作真实配置：auth=`https://auth.x.aixgg.com`，grid=`https://anywork-cybergrid-selfhost.vercel.app`，resource=grid + `/api`，portal=`https://anywork.aixgg.com/app/`；public IDs 与源码及公开配置一致。
- live 模块存在双语五阶段诊断详情及安全显示/外链约束。公开检查链接仅携带编码的 public clientId，`target=_blank`、`rel=noreferrer`；公开端点 200，issuer/resource/clientId 一致。未提交令牌或业务内容；`noreferrer` 本身不承诺阻止目标域已有浏览器 cookie。
- 独立取得的 9 个 live 文件与站点 owner upload manifest 的 digest 一致。owner 手动部署说明仅作旁证，线上内容以上述独立读回为依据。

公开 `/source` 本轮也完整匿名取得并核验：**10,612,099 bytes，1,038 个源码文件全部匹配精确提交的 Git blob 和文件模式**，SOURCE_MANIFEST 匹配 Git public export 契约，mismatches 为空。归档 SHA-256 为 `ebafd3e1bfc52508db102812100aa92300025213a80b99bf72bda5057e8becdc`，与 owner 记录相同；完整 gzip body 不保留，仅保留逐文件证据 `E/site/source-blob-verification.json`。

另匿名读取 GitHub latest、`latest.json` 与五个 updater `.sig`：latest 指向正式 v38，五平台 URL/签名文本绑定一致，sidecar body digest 匹配正式资产 digest，解码版本注释为 `0.1.38`。未下载桌面 installer body，因此没有独立进行桌面更新包内容的密码学签名验证。

## 6. BLOCK 与未测边界

| 状态 | 事项与证据边界 |
| --- | --- |
| PASS | 四个正式 APK 的单 ABI、全文摘要、身份、正式证书、strip、动态导出、所有 JNI ELF / ZIP 16KiB 对齐与随包 UI 实物验收 |
| PASS | 正式 v38 23 assets / 22 checksums、latest 元数据、生产站精确源码及下载链接、公开源码归档绑定 |
| BLOCK（既有，自动部署恢复） | publisher 因 Vercel token 失败 exit 1 / `phase=pages`；owner 记录的网站工作流 `43559186736` 失败。生产站已手动恢复且独立验收通过，不能据此把 CI token、工作流或 publisher 状态记为已修复 |
| 未测 | 真机安装/覆盖升级、16KiB 设备实际运行、真实账号登录/授权、手机现场故障根因及远程连接；匿名公开端点通不等于这些流程通过 |
| 未测 | 独立可复现构建、桌面 installer 全文下载/安装及密码学内容签名复验、浏览器执行/截图；不把官方 CI 成功扩大为本地独立执行 |

v35/36/37 的失败与候选历史不构成正式发行通过证据；本次结论固定在 v38 / ef0。没有新发布、部署、修改源码或调用真实设备/Claude 会话。

## 7. 归档与资源清理

四个正式 APK 仅各保留一份，位于根目录 `artifacts/android-v38-independent/apks/`，合计 **154,063,069 bytes**，供 parent 复用；小日志、manifest、响应及验证脚本保留于同一 ignored 证据目录。Actions ZIP、未完成下载、自建 Python cache 和过期 partial verdict 已清理；重复解压的 main JS 仅保留 `arm64-mobile-entry.js` 一份，四 ABI 内容相等的证据保留于清单。

本 reviewer 无存活构建、下载、浏览器或临时服务进程。没有新建 node_modules 链接、复制大型依赖或创建 Cargo/Gradle target/cache；只使用已有 SDK 36、NDK 27、Java 17 和 Node 22（Brotli 解压）。无需为本报告保留这些依赖。收尾时磁盘可用约 11.4 GiB。

`notification-replay-check` 仅用于报告提交，parent 集成后可清理。`android-size` 的旧 v34 APK/先前证据只读使用；其为作者工作树，不由 reviewer 删除。其他作者工作树与部署资源未改动。四份正式 APK 的保留或后续清理由 parent 决定。
