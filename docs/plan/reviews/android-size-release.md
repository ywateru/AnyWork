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
