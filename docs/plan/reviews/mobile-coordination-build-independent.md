# Android ARM64 candidate workflow：独立源码审查

2026-11-15。审查对象为构建作者提交 `adb29d5251b7adafd37786e1b4df0ce66d4dbc50`，父节点 `40e0548431bc4467f5046a8334edaee685ce15df`。已确认作者WT HEAD为该精确提交且干净；修改仅 `.github/workflows/android-candidate.yml` 和作者报告 `docs/plan/reviews/mobile-coordination-build.md`。本审查者是Native入口代码作者，不是此工作流作者；Native与route代码由另一独立verifier审查。

**接受；无阻断发现。** 接受范围为新增手动候选工作流与来源记录的源码契约；尚未触发或观察此workflow实际构建，不宣称已有新的官方签名APK、可升级性实体结果或移动端同步恢复。

## 对照现有发行流程

- 工作流仅有无inputs的 `workflow_dispatch` 和单个ARM64 job；顶层 `contents: read`，没有job权限提升、publish/deploy/tag/version写入、release job或用于发布的token。checkout使用事件的 `github.sha` 且 `persist-credentials: false`；动态上下文仅经环境变量读取，未拼入shell代码。
- 前置gate要求branch dispatch、40位小写hex SHA及 `HEAD == GITHUB_SHA`，再执行既有 `scripts/check-release-version.py` 的本地一致性检查；不要求候选版本高于当前公开版本，也没有伪装成正式release。实际dispatch应选择包含最终已审源码的branch，不能将候选作者父节点或早先main SHA当成未来APK源码。
- 对比同一父系的 `.github/workflows/release.yml` Android job：Node22、Temurin17、Android/Gradle setup及SDK37.0、build-tools36.0.0、NDK27.2.12479018命令一致；Rust仅选择 `aarch64-linux-android`。唯一构建入口仍为 `scripts/build-android.sh --release --target aarch64`。
- 已追踪该canonical脚本：锁定Cargo、Tauri release split-per-ABI构建、对应variant lint、既有JVM tests，随后 `scripts/check-android-apk.py --profile release`。APK checker核对package/version/minSDK、单一目标ABI和ELF、16KiB对齐、本地UI asset keys/notice及与指定keystore一致的签名。候选workflow没有绕过这些步骤或另造debug签名路径。

## 签名、来源与上传边界

- 复用发行使用的Android signing secrets与alias；keystore写入runner临时路径，umask077，`always()`删除。上传使用两个固定文件路径，没有上传通配目录或keystore；artifact名称带完整source SHA，七天保留，缺文件失败。
- canonical检查后又执行 `apksigner verify --verbose --print-certs`，要求唯一signer且SHA256等于既有公开官方证书。正确的keystore一致性检查与固定官方证书检查都保留，因此错误配置的另一个签名key不会仅靠“配置自洽”被接受。
- metadata块再次核对HEAD与事件SHA，记录同一固定APK的SHA256/字节数、repository/run/attempt/URL、公开证书digest、package/version/code/minSDK/target，并标记 `published: false`。APK内upgrade字段由前一canonical checker核过，metadata再从同一源码配置投影；没有把config字符串本身当成已检查APK的替代品。
- JSON是本次run的来源与hash记录，不是额外的源码供应链签名证明。实际验收仍需匹配run head_sha、下载artifact中的APK hash/证书与JSON，并将官网gateway部署来源与APK来源分别记录。作者报告正确保留此边界，没有声称CI/设备已通过。

## 独立轻量验证

只读作者WT；使用本机既有PyYAML/Python/Bash，无Cargo、Gradle、Android工具、依赖安装、CI dispatch、远端写入或设备操作：

1. PyYAML BaseLoader解析后断言仅manual/no-input触发、单job/read-only权限、精确checkout、canonical构建命令、固定上传路径与always清理；对比现有release中四个setup action配置及sdkmanager命令，全部通过。
2. 所有run块通过 `bash -n`，两段嵌入Python通过AST解析。`actionlint`本机未安装，未为本轮安装；这些检查不替代GitHub Actions真实执行。
3. 在作者精确checkout执行未改写的source gate与既有本地version guard：branch/精确SHA接受；错误SHA、tag上下文及畸形SHA均拒绝。设置 `PYTHONDONTWRITEBYTECODE=1`，没有写入作者源码。
4. 在自动清理的临时目录，使用小型不可安装合成APK，运行原metadata逻辑，仅stub两个外部命令的输出。唯一官方signer接受，输出source/hash/size/package/version/code/target/published准确；错误checkout、外来signer、signer计数2和10、缺失signer均在记录写入前拒绝。没有调用实际签名器或下载APK。
5. `git diff --check adb29d5^ adb29d5`通过。作者WT保持干净；本审查只在独立Native WT新增本文。

下一步可将工作流合入默认分支后，对精确已审候选branch做manual dispatch；后续实际CI/产物/设备结果由各自负责者验收。此结论不授权或实施发布，也不复用本次合成夹具作为真实APK证据。
