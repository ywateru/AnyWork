# Android 加载修复发行

2026-11-15 用户要求更新 GitHub Release 并重新发版。本任务沿用[发布流程](../../releasing.md)，发布[设备读取修复](android-device-loading.md)与安全阶段诊断，不继续操作测试手机、电脑宿主或 Claude Desktop 会话。

## 版本与门禁

v0.1.39 的精确源码为 `541f3ff1e3ae59968c90a8580c594de411f56ff7`。其 [Checks](https://github.com/ywateru/AnyWork/actions/runs/43689682124) 中网页任务在严格 Clippy 阶段失败：CI stable 升至 Rust 1.100.0 后，测试中的 `chunks_exact(2)` 触发 `clippy::chunks_exact_to_as_chunks`。该版本没有创建 tag 或正式 Release；不重试相同源码绕过确定性错误。

作者在独立 worktree 做最小测试源码修正，保留原有长度与状态序列断言，经另一审查者验收后合并。发布器选择后续 v0.1.40 / Android code 42，继续等待精确源码 Checks、全部发行平台与官网核验。

## 验收范围

- 正式发行含 23 项附件、22 项摘要和五个平台的更新签名元数据。
- Android 为四个独立架构 APK；验证新版本、原应用标识和原签名身份，不替代实体升级或远程连接验收。
- 官网绑定最终发行源码，双语页面链接正确版本的四个 APK。
- 自动官网部署若仍因原有令牌失效而失败，可用既有本机授权恢复同精确源码，保留自动工作流的失败记录。
- 测试手机当前路线无法连接协调服务的限制继续明确披露，不声称本版已恢复真实远程工作区连接。

状态：最小 Clippy 修正与独立审查进行中，尚未完成新版发布。
