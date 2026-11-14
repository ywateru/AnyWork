# Android APK 体积优化

状态：源码已独立接受并合入 main，等待账号/连接修复后的统一成包及发行验收。用户反馈 v0.1.34 的公开 APK 过大，要求优化安装包。

基线：main `bb75bf7`，v0.1.34 APK 为 204,082,412 bytes。先测量正式包 ZIP 条目、原生 ELF、DEX 和随包界面的实际占用，再选择优化，不把压缩后的下载大小等同于安装占用。

测量：正式包的四份 `libanywork_mobile.so` 合计 202,223,752 bytes，约占 APK 的 99%；classes.dex 压缩后 925,494 bytes。

用户后续明确要求四种架构拆开编译。新发行交付 `anywork-android-arm64.apk`、`anywork-android-armv7.apk`、`anywork-android-x86.apk`、`anywork-android-x86_64.apk`，各包恰好包含对应 ABI。官网静态下载与动态刷新均显示架构并优先推荐 ARM64；旧版 universal 发行元数据仍可正确读取和下载。新发行共 23 项附件、22 项校验条目，旧版保留 20/19 契约；不发布混合架构包或重复别名。

交付约束：保留完整 Rust/Tauri 2 客户端、随包 UI、内嵌登录、原生连接及系统功能；保留四 ABI 的分别支持、applicationId、minSdk、发行证书和 ELF/ZIP 16 KiB 兼容。优先限定 Android 构建的优化，不无意改变桌面 release 配置。旧 tag/附件不可覆盖；新发行遵循精确源码 Checks 和完整发行门禁。

作者 Boole 在隔离工作树完成测量、构建/checker 实现及实际 Release 构建；McClintock 负责发行/官网接线与相应测试；Mendel 独立审查精确提交与包内容。验收需包含具体前后字节数、各 ABI 库占用、签名/身份/随包资产/对齐、R8/lint/JVM 检查，明确测试签名候选与正式发行的区别。无需真实账号、物理设备或 Claude Desktop 真机测试。

交付记录与证据待验收后补充；构建缓存、下载包、签名材料不提交。

源码验收：[独立审查](../reviews/android-split-build-independent.md)接受 build `e743029` 与发行/官网 `6c08d21`。实际 Gradle flavor/输出/任务解析、26 项 JVM 测试、checker 8 项、静态下载 4 项、publisher 33 项及双语浏览器检查通过；真实旧版 v0.1.34 的 20/19 附件契约只读核验通过。小型 Android cdylib 验证 release strip 保留动态 JNI 符号及 16 KiB 对齐。以上不等同于最终四包实际构建或真实账号验收；最终体积待统一 Release 构建后记录。
