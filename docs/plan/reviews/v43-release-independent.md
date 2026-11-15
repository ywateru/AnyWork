# v0.1.43 正式发行独立验收

2026-11-15，非作者reviewer，隔离WT `.worktrees/mobile-coordination-verify` / `codex/mobile-coordination-verify`。仅提交本报告，不修改main、产品源码、tag、Release、附件、部署或publisher状态。

**结论：PASS，无新增阻塞项。** 精确源/CI/tag、23附件/22校验项/五updater元数据、四实际APK、正式source、网站staging及线上读回均通过；实体手机已保留数据升级至正式0.1.43/code45，正常SSO及在线电脑发现通过。桌面正文密码学验签、全部压缩UI资源解码及全功能smoke不在本次通过范围。

## 固定源、版本与CI

- 正式源：`417a67fb1ee743c2ef67f4e75dcd056355fb2e7b`。对照版本前基线 `7f046353231c4ffa6d1d07c5e2cfcbdbd0640a87` 恰10文件变化，逆向归一0.1.43→0.1.42和Android/mac code45→44后，每文件逐字节一致；无依赖解析漂移，diff check通过。
- 相对已实际验收手机候选 `e4f3650890eb1e9e8010be29fca607a12302435a`，运行时代码及workflow不变，差异仅版本、文档和已接受测试。transport测试与 `b60b42a9757ab54cc9d394d364f92a1f09d89b5a` 完全一致，见[修复独立审查](mobile-renewal-check-independent.md)。notes新版43，上一正式41历史保留，恢复声明限定实际路线/只读范围。
- [Checks 43709434739](https://github.com/ywateru/AnyWork/actions/runs/43709434739) attempt1：精确源、main/push、五job全success。server-web job132797570853日志明确记录 `2026-11-15T11:37:47.0063103Z test transport::tests::renewal_preserves_existing_pty_and_later_http ... ok`，mobile 42 passed / 0 failed / 1 ignored；check.sh、format/site门禁成功。日志另有review13项、publisher33项通过，缺附件测试明确ok。
- annotated tag `v0.1.43` object `f921f2886f069587450d7ac56c61c432806abdbf` 独立剥离到正式源。[Build releases 43711399021](https://github.com/ywateru/AnyWork/actions/runs/43711399021) attempt1：push/v0.1.43/同一SHA，12/12 jobs全success，含全部发行平台、source-web和publish。
- [正式Release](https://github.com/ywateru/AnyWork/releases/tag/v0.1.43) id446036559，stable、非draft，published_at=`2026-11-15T12:13:33Z`；公开latest为同一Release。Checks/tag/构建/公开附件证据独立获取，未触发或重试CI。

旧v42源 `0a38dbb` 的失败、未创建正式tag/Release事实继续归档于[v42报告](v42-release-independent.md)，不被本次成功追认。修复独立正向及不延长租约负对照已在前述修复报告完成，本轮未重复Native测试。

## 发布集合与四实际APK

独立明确枚举23个唯一、已上传、非空附件，无universal/alias；SHA256SUMS有22条唯一项，集合恰等于附件减自身，各条与GitHub digest一致，校验文件正文亦匹配自身digest。五updater目标精确为darwin-aarch64、darwin-x86_64、windows-x86_64、linux-aarch64、linux-x86_64；URL绑定v43附件，签名字段与实际sidecar逐字一致、版本注释0.1.43，小文件正文摘要均匹配。latest与Release notes均与精确源正文一致。**此处是签名元数据/版本绑定，不是桌面大包正文密码学验签。**

四正式APK各实际下载一份，总计154,147,445 bytes，完整SHA256同时匹配SHA256SUMS及GitHub digest：

| ABI | 实际bytes | 实际SHA256 |
| --- | ---: | --- |
| arm64 | 39,274,015 | `f0404e404218d979bfcecaa6a9ac6b84fae1bcc37f5a9f7f3ed8e1cdf70620f0` |
| armv7 | 28,577,577 | `2e4fbfff94253a999cc907649a17e5c8b3b02a765924a8b0f92081cd0c7e193f` |
| x86 | 43,717,033 | `28f21da83945163efd0865eb12bcc52a037d65ead605167cf1339ba2dfa1970d` |
| x86_64 | 42,578,820 | `d37c9b395a7bb1227324885a32b631766c98a58a1e8b7c5a7ae8d433ea5e487a` |

- aapt及随包Tauri config均为 `dev.remoteagent.app`、0.1.43/code45、minSdk26、非debug。ZIP无重复项；每包全部JNI限于对应ABI，ELF bitness/machine依次64/183、32/40、32/3、64/62。
- apksigner实际验签全部成功，单一官方证书SHA256均为 `88b43f83632002fbeddd23a286eabee39c5ada0fa1b037d6ff32b9986a67acb8`，与既有正式发行记录一致。原appID、同证书及递增code满足升级身份条件。
- zipalign `-c -P 16 4`全部通过，stored JNI实际ZIP偏移均为16KiB整数倍；独立遍历全部ELF PT_LOAD，p_align≥16384且offset/vaddr对16KiB同余。无symtab/strtab/debug/zdebug sections，dynsym/dynstr保留。
- 实际DEX class definitions均包含rustls CertificateVerifier、StatusCode、VerificationResult，非仅搜索字符串；其余三ABI未在硬件运行。
- 四正式Android job日志独立确认精确源、`debug=0, strip=symbols`及官方ABI/native/signature/16KiB/随包UI checker通过。未独立解码全部Tauri压缩UI资源；未从本次输出提取UI文件名，不扩张checker证据范围。初始reviewer日志matcher误按环境变量名查找，已按实际build诊断修正。

正式source正文10,758,500 bytes，SHA256 `6f4b2137537d543f677258ddd356ce90e5814ba8922473743c869aad4dac94e8`；按固定导出契约对照精确Git tree，**1063文件的实际blob/可执行mode全部匹配**，集合与SOURCE_MANIFEST一致，无重复、额外或越界文件。旧v41不可变发行未被修改。

## 正式实体手机升级

获父协调者GO后，使用明确SDK adb，只选择唯一实体手机，先读现有UI/版本并重新核正式ARM64实际bytes/hash及官方单证书。12:31:38Z开始 `adb install -r`，12:31:52Z成功；PackageManager从候选0.1.41/code43读回正式0.1.43/code45。未卸载、wipe、清数据或改网络/宿主设置。

正常launcher启动显示预期signed-out onboarding（grant仅RAM），按实际可见“登录账号”和登录确认“继续”恢复现有SSO，无凭据重放。**12:35:36Z已显示我的设备、在线电脑及打开工作区入口，无固定错误码**。这证明正式Native登录/配置/登记/目录/presence路径通过，不以匿名HTTP200代替。手机留在正式v43设备页供用户使用，不重复历史读取；此前同运行时候选的完整公钥比较和授权工作区/既有历史证据另保留，见[恢复独立报告](mobile-coordination-independent.md)。

本次没有Agent提示、会话创建、终端命令、真实文件编辑、私有bridge或token导出。只留安全阶段/控件、版本及布尔结果，不保存账号身份、公钥、凭据或历史正文。

## 网站staging与线上匿名读回

12:28:21Z独立核447文件全部hash/bytes及文件集合匹配上传manifest，共24,382,912 bytes，manifest SHA256 `b950f1c2a99858a28d8def58f24a68e5045f3edf481951b97adada2c59174df9`。build为精确417a67f/v43；23项release表名称/URL/大小与公开正式Release一致，EN/ZH实际下载anchor恰为四APK、ARM64首位。compiled九条精确网关路由/CSP与已接受40e部署artifact完整一致，公开配置一致；无新增admin/console转发。staging source另核同一1063个blob/mode全部一致。

通用历史label map保留旧universal名称以兼容旧发行，v43实际anchor/发布表没有旧alias或fallback。初始reviewer整页禁止该字符串过严，已改核实际链接；不是产品回归。

网站由owner人工部署，父端提供deployment `dpl_9SphfUmfubzcC9pgg8gFPDTFbqMi` / <https://anywork-m15ojdwdk-yywater68-1778s-projects.vercel.app>。owner报告提交 `2fc73d0`，路径 `docs/plan/reviews/v43-site-manual-recovery.md`；本reviewer未上传或运行作者verify-existing。生产域 <https://anywork.aixgg.com> 的独立读回于 **2026-11-15T12:40:19.747609+00:00** 完成，13检查全部PASS：

| 线上范围 | 独立结果 |
| --- | --- |
| build/release | source精确417a67f、version0.1.43；23项release字段逐项匹配正式附件 |
| en/zh | 四正式APK链接精确、顺序正确；ARM64首位；无新版universal fallback |
| app及动态脚本 | app入口/JS/CSS/markdown等九个静态正文逐项匹配已接受上传manifest；site/app.js另与固定Git blob完全相同 |
| 动态下载契约 | 实际交付JS含拒绝版本回退、>=35完整四ABI及相同tag/URL约束；文本核对，未运行浏览器交互 |
| 公开配置与CSP | 实际production env匹配既有公开配置且被应用；所有11个已读响应均单一预期CSP、nosniff、no-referrer |
| Native匿名配置 | HTTP200，完整JSON SHA256 `bc1ac1ba9d3e77a62fa9fe14fb75b8e528daa175d722d6df764c803a99782bdc`，与既有同backend配置一致；no-store / MISS / age0 |
| /source | 完整HTTP200正文10,708,921 bytes，SHA256 `0fc260b3cb02b524114f4f47dbcc4a4de8a34f7cf6e6ef2c25c08b513f017cac`，匹配上传manifest，1063个blob/mode全部匹配精确Git tree |

匿名urllib未使用CookieJar、Authorization、浏览器缓存或CUA。线上source与正式附件gzip bytes不同，但两者逐blob/mode相同；不要求gzip容器摘要一致。447文件是独立staging全量核验范围，线上正文只覆盖上述九项静态响应及source/config，不声称线上全部447文件重下载。

## 保留边界、证据与清理

自动网站workflow `43709434756` 已独立观察failure；后续 `43712745935` 的无效token/失败状态由owner报告记录，本轮未独立下载该失败日志。人工恢复不代表自动workflow或CI credential已修复。父端publisher仍处pages的历史保持，本reviewer不将状态写成complete。runtime/installer精确源始终417a67f，后续root文档提交不替换正式source。

本轮没有本地Cargo/Gradle构建或Native/手机重复测试。未验证桌面安装包正文密码学签名、全部压缩UI内容或所有功能；正式手机本轮范围是保留数据升级、正常SSO和发现，既有候选只读业务通过不冒充再次执行。

ignored证据目录 `artifacts/v43-release-independent/` 保留source-bump、Checks/Release/API/tag、metadata/assets/native/source、四Android job、site-staging、`site/verdict.json`及`phone-official/phone-verdict-safe.json`。四正式APK唯一reviewer副本在其中 `apks/`（154,147,445 bytes），供父端接管复用；正式source gzip验证后移除，线上source正文仅在内存核验，保留摘要/blob证据。

所有本轮下载、工具和UI脚本均已结束，无自建后台进程、partial或临时依赖链接；未新建target/node_modules，先前只读模拟器已退出，ADB server及桌面会话保持。当前仅本review WT及小证据/四APK仍需父端归档后清理；作者WT/产物/共享缓存未动。
