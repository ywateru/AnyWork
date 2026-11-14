# Android 分架构与连接修订交付

本轮包含用户要求的 Android 四架构拆包、桌面登录后远程开启故障调查，以及手机与电脑网页设备状态不一致调查。旧发行附件不可变；新版本须经精确源码 Checks 和全平台发行门禁。

## 已完成的源码与候选验收

- [拆包与候选 APK 独立验收](android-split-build-independent.md)：单 ARM64 测试签名 Release 为 39,192,755 bytes，相比 v0.1.34 通用包 204,082,412 bytes 减少 80.80%；原生库静态符号已移除，动态导出、实际随包资产、R8/lint/JVM、身份和 16 KiB 对齐通过。新发行四种架构各有一个 APK，23 附件／22 校验项；旧版 20／19 元数据仍兼容。
- [桌面独立审查](desktop-login-remote-independent.md)：接受合法 SDK 强制刷新、旧探针覆盖准备成功状态的竞态修复，以及前置失败诊断码。没有证据确认用户截图当次原因；未操作真实登录和服务。
- [Native 恢复独立审查](mobile-native-recovery-independent.md)：真实 SDK 到期恢复回归通过，不把该缺陷归因于手机网页截图。
- [网页安全诊断独立审查](mobile-web-presence-independent.md)：固定阶段／错误码、公开无凭据配置检查及持续门禁通过。手机截图确认为网页设备页；真实手机网络与账号仍待现场阶段码。

## 先行诊断网站

2026-11-14 已部署并公开读回 `477ae1f288871a9b40a65129edcef654f3764652` 到 `https://anywork.aixgg.com`，网页版本仍 0.1.34；当前 v0.1.34 的 20 附件／19 校验项和旧 universal 下载保持不变。手机刷新原设备页后可展开“查看状态查询详情”，不需要提交 HAR、凭据或业务会话。

部署使用既有本机 Vercel CLI OAuth、精确源码及显式五项公开配置；CSP、源码归档、生产目标和无凭据上传内容已核对。没有修改旧 tag/包、生产配置、DNS 或 GitHub secrets。此手动部署不表示已修复失效的 CI Vercel token。

## 发行门禁

v0.1.35 准备源码 `ecbce9ba3b274c265f8deae553a9957cba416e60` 的 [Checks](https://github.com/ywateru/AnyWork/actions/runs/43547818995)发现两项失败：Windows 测试引用 Unix-only 夹具，Linux Rust 1.100 严格 clippy 检查到新纳入 host 测试的 Android 协调代码。Android 与容器任务已通过；未推送 v0.1.35 tag、未发布该版附件。协调者停止了本地等待进程，保留私有发布进度及远端失败记录。

两项最小修复已获[独立接受](v35-ci-rootfix-independent.md)：`e0fa9f6` 仅限制 Unix 夹具调用，保留跨平台 manager 核心断言；`3901bad` 合并等价条件，不改变 owner/授权顺序。后续使用发布器 `--new` 开始新精确源码版本，不通过盲目重试或覆盖 tag 绕过失败。正式四 ABI 包、发行证书升级兼容、全部附件与官网最终版本仍待下一轮记录。

v0.1.36 准备源码 `6552b19e814984f215851f9f95816677c62501c4` 的 [Checks](https://github.com/ywateru/AnyWork/actions/runs/43549455074)中，Windows、macOS、Android 与容器全部成功；server-web 已通过 Rust/clippy、Web 单测及多项集成后，在 publisher 测试失败。其当前版本 fixture 随源码升到新 23 附件契约，一条缺件错误断言仍写死 20。该遗漏在旧 0.1.34 基线上不会失败，因此此前本地 33 passed 未能覆盖。没有创建 v0.1.36 tag 或发行附件。

修正仅调整测试：按 fixture tag 验证完整缺件错误，并在已有版本表中明确断言旧 20、新 23 两类缺件拒绝；不放宽生产附件、摘要或签名门禁。[作者验证](publisher-version-fixture.md)与[独立审查](publisher-version-fixture-independent.md)在真实 0.1.36 源码复现 before 唯一失败、after 33 passed；独立明确资产集合的额外探针拒绝全部 135 次缺件与 12 次错架构/重复附件。已接受 `e711994`，合入后开始新的精确源码 Checks。

v0.1.37 准备源码 `f3ac0db041ffdaaeeca8397bb08b9c154c8cd468` 的 [Checks](https://github.com/ywateru/AnyWork/actions/runs/43551761469)中，Windows、macOS、Android、容器及 server-web 前置检查通过；最后普通浏览器回归为 677 passed、1 skipped、2 failed。两项失败来自同一通知历史回放场景，分别在 desktop 等待回复和 android-web 等待审批按钮时超时。发布器已停止，未推送 tag 或发行附件。下一步以失败 trace 判断测试同步或产品回归，修复须经作者验证与非作者审查后再进入新精确源码门禁。
