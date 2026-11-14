# Publisher versioned fixture independent review

2026-11-14，非作者独立审查。结论：**PASS，无 BLOCK；可合并此测试修复后重跑新精确源码 CI。** 这是 publisher 离线测试修复验收，不是正式发布或四 APK 成包验收。

## 精确范围

- 基线：`6552b19e814984f215851f9f95816677c62501c4`，实际源码版本 **0.1.36**。
- 作者最终提交：`e711994404770e9ecf015d38dd674996fb50fdbc`，父提交即上述基线。
- 作者 WT：`.worktrees/publish-version-fixture`；reviewer 未修改该 WT。
- 提交只改 `scripts/publish-test.py` 和作者报告 `docs/plan/reviews/publisher-version-fixture.md`。`scripts/publish.py`、版本文件、workflow、`scripts/check.sh` 均无改动；独立 `git diff --check` 通过。
- 本报告在 reviewer WT `.worktrees/android-size` 独立提交，仅含文档；该 WT 较旧，不以它的工作区版本运行测试。以下测试全部从精确 git SHA 导出必要文件运行，版本确认来自实际 0.1.36 源码。

## 根因与修复评价

此前在实际 v34 源码下得到的 33 pass，不能证明 current-version fixture 进入 >=35 契约后仍正确；这是之前验证版本范围的遗漏。本次先独立复现，再检查修复后表现。

缺附件用例在 `publish-test.py:510` 从 fixture 当前源码生成 tag；生产 `verify_release()` 依据 tag 正确选择 v34 的 20 项或 >=35 的 23 项。原用例第 516 行却固定匹配 `20 assets`，导致实际 0.1.36 fixture 下，产品正确拒绝缺附件，测试因错误文案预期失败。

最终提交在破坏 fixture 前通过 `len(publish.assets_for_tag(tag))` 取得 generic 用例的预期数量，并完整锚定预期异常文本（第 511、521–523 行）。这是验证“缺附件应被拒绝”的测试，允许依 fixture 契约确定报错数量；没有将测试修成固定 `23`，没有放宽异常捕获，也没有改产品门禁。原先 digest 与 website 错误反例仍保留；单独的 manifest/signature/version/url/platform 反例也仍在全套中执行。

持久化版本表（第 403–418 行）另保留显式数值：13/34 为 20、35/100/0.2.0/1.0.0 为 23；清单数量为 count−1，旧 APK 集合为 universal，新集合与 `publish.ANDROID_APKS` 常量比较。此次增加每个版本的缺件拒绝反例，以表中显式数量匹配完整异常。既有混包、缺 ABI、重复、旧 alias、checksum 和网站反例未删。

不能把全部预期都从生产 helper 反推后称为独立 schema 证明。因此本轮 reviewer 在额外探针中**直接写明** 20/19、23/22 和四个具体文件名，不从 `assets_for_tag()` 或 `ANDROID_APKS` 生成期望集合；同时逐个移除所有附件并测试保持数量但替换架构身份/重复条目，见下表。该探针是 reviewer 证据，未加入产品源码或伪称为 CI 新测试。

## 独立执行结果

运行方式：从每个 SHA 用 `git show` 导出 16 个必要源码/配置文件到 `TemporaryDirectory`，约 544 KiB；不复制 node_modules、APK、target 或大型缓存。使用 Python 标准库和现有测试的临时 Git repo / FakeGitHub / mocked HTTP；移除 GH_TOKEN/GITHUB_TOKEN 等凭据环境，禁用 global/system Git config，未使用真实账号或触发真实发布。原测试 stdout 的 “Published and verified” 是 mock pipeline 输出。

| 项目 | 独立结果 | 判定 |
| --- | --- | --- |
| 精确基线回归失败 | `6552b19e…` / 实际 0.1.36，仅执行 `PublisherTest.test_verification_rejects_digest_signature_site_and_missing_asset`；1 test，唯一失败为 `20 assets` 不匹配生产门禁的 `23 assets` | PASS：复现指定根因 |
| 最终提交全套 | `e7119944…` / 实际 0.1.36；`python3 scripts/publish-test.py`，**33 tests / 0 failures / 0 errors，14.317s** | PASS |
| 独立旧版本边界 | v0.1.34：20 assets、19 checksums、APK 集合严格为 `{anywork-android.apk}`；完整 release/site 接受 | PASS |
| 独立新版本与跨位数边界 | v0.1.35、v0.1.36、v0.1.100、v0.2.0、v1.0.0：各 23 assets、22 checksums；集合严格为 arm64/armv7/x86/x86_64 四个指定 APK，完整 release/site 接受 | PASS |
| 每个附件缺失反例 | 上述六 tag 逐个删除其所有附件：20 + 5×23 = **135 次**，每次都匹配相应显式 20/23 数量的完整拒绝文本 | PASS |
| 同数量错误集合反例 | 每 tag 将一个正确 Android APK 换成另一契约的 APK，及将一项替换成重复项；六 tag 共 **12 次**；资产总数仍正确，全部被拒绝 | PASS |
| 产品门禁不变 | 比较 base→final 的完整文件变更列表，及 publish.py/workflow/check.sh diff；仅上述测试+报告 | PASS |
| 持续接线 | `scripts/check.sh:46` 已调用 `python3 scripts/publish-test.py`，此修复进入已有全套门禁 | PASS |

独立探针中四个明确文件名为：

- `anywork-android-arm64.apk`
- `anywork-android-armv7.apk`
- `anywork-android-x86.apk`
- `anywork-android-x86_64.apk`

## 边界与后续

- 未重跑 Rust、Clippy、Web、容器或大型 Android 构建；未替未运行的平台 CI 作通过声明。
- 未打 tag、发布 release、上传产物或修改网站；当前修复通过不代表 v35/v36 已发行。父协调者需合并后在新的精确 source 上重跑 CI，再按最终版本与发布 URL 验收正式 23 assets / 四 APK。
- 本次检查的是 fixture 与 publisher 验证语义，未下载/运行实际发行包，未代替 ABI、所有 JNI ELF、16 KiB、正式签名、实际源码绑定和随包 UI 的成包门禁。
- 所有自建测试快照和临时 Git repo 已自动删除；保留小证据于 root ignored `artifacts/publish-version-fixture-independent/`：`baseline-v36.log/.json`、`final-v36-publisher33.log/.json`、`final-v36-boundaries.log/.json`、`run-exact.py`、`boundaries.py`。JSON 包含 SHA、实际版本、每个导出文件 SHA256、命令与退出状态，边界日志包含明确预期集合和拒绝计数。
