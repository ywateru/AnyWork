---
id: android-native-client
scope: Android Rust Tauri 2 client and mobile experience
status: in-progress
---

## Objective

用户已授权完整 Android 重构、手机适配 UI 与引导、磁盘清理和完成后 GitHub 更新。替代 Custom Tab 旧契约，见[产品契约](../../android-account-entry.md)、[原生接口](../../mobile-native-contract.md)、[手机布局](../../mobile-client-layout.md)。不进行此前已后置的 Claude Desktop 真机测试。

## Independent lanes

| lane | 唯一文件边界 | owner |
| --- | --- | --- |
| shell/platform/build | crates/mobile Cargo/build/lib/config/capabilities、gen/android、mobile-system Kotlin/Rust、根 Cargo/lock/package/ignore、构建/CI/release/source archive/version tooling | Boole |
| account | crates/mobile/src/account/**、独立 mobile-auth plugin Kotlin/Rust、账号边界测试 | Bacon |
| transport | crates/mobile/src/transport/**、web/src/mobile/NativeTransport.ts 与 transportTypes.ts；remote verifier 与 Desktop gateway 构造处的精确兼容变更、对应测试 | Planck |
| UI | web/mobile.html、vite.mobile.config.ts、web/src/mobile（除 transport 两文件）、App/共享组件必要移动适配及浏览器用例 | McClintock |
| username | 现有独立任务，先审查后合入，不与 Android 混改 | Mendel |
| independent acceptance | 非作者审查、隔离 gateway/IPC/浏览器/Android APK 运行、集成缺口与最终审查记录 | Hilbert + 交叉审查 |

共享 Cargo/lib/依赖注册由 shell owner 统一维护；账号与 transport 作者以模块/DTO 协调请求，不编辑对方文件。各 lane 在隔离 worktree 提交后才独立审查。不能只写 UI mock 即标功能完成，不能以 Web 移动仿真冒充 Android。

## Gates

1. 精确接口、账号/client/origin兼容、应用身份/版本升级及手机布局落文档。
2. 实现本地资产、内嵌授权、完整原生数据连接、真实系统保存/分享与手机导航。
3. 非作者审查与缺陷闭环；真实隔离 gateway 覆盖请求/取消/续期/PTY，不使用真实账号。
4. 类型、Rust、浏览器、Android构建/lint/unit/安装运行验收。核查包内本地assets/native库、签名/versionCode/16KiB对齐和未知结果不重放。
5. 控制依赖/target复用，清理本任务临时构建/截图/工作树，保留独立审查文档；推送可审查源码和CI，记录APK及未测限制。

初次清理已移除上一轮七个干净 Claude 工作树及可重建增量缓存，保留分支和审查，回收约14GiB；不得扩大清理到未知工作区或用户资料。

## Current integration

网页账号修复已独立接受并合入，包含真实 SDK 跨标签旧 owner 缓存与迟到刷新写入的 P1 闭环。Android 分层实现已形成独立候选，尚在合并前审查与 APK 构建，不把已有提交视为完整验收。独立设计审查已明确 Native 同产品设备会话、SDK cookie/授权桥边界与已注册回调；见[设计证据](../analysis/android-native-client.md)。

Transport 独立审查覆盖真实隔离 Snow/Gateway 与 JS Request/Response/FormData 联合调用，已发现并修复总时限、pending connect 关停和超大正文编码前拒绝，WSS TLS provider 的复测仍是门槛。手机 UI 独立审查发现文件草稿基线恢复与发送等待回执时断线的 P1，作者已提交 follow-up，须待非作者复审关闭再合入。报告保留发现和闭环，不以删除失败断言或仅运行作者夹具替代复测。

账号 lane 发现原始 Logto JVM core 的内层 OkHttp POST follow-up 不受外层 owner fence 控制；采用固定上游 core 源码的公开、小范围 HTTP 策略 patch，保留原版 Android UI 和 OAuth/验证流程。此为完成原有不重放契约所必需的实现修正，不降级为“记录限制后默认通过”；源文件摘要/patch、single-attempt 网络回归与最终 Android 依赖解析均须核验。
