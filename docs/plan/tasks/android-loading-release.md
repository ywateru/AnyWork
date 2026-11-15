# Android 加载修复发行

2026-11-15 用户要求更新 GitHub Release 并重新发版。本任务沿用[发布流程](../../releasing.md)，发布[设备读取修复](android-device-loading.md)与安全阶段诊断，不继续操作测试手机、电脑宿主或 Claude Desktop 会话。

## 版本与门禁

v0.1.39 的精确源码为 `541f3ff1e3ae59968c90a8580c594de411f56ff7`。其 [Checks](https://github.com/ywateru/AnyWork/actions/runs/43689682124) 中网页任务在严格 Clippy 阶段失败：CI stable 升至 Rust 1.100.0 后，测试中的 `chunks_exact(2)` 触发 `clippy::chunks_exact_to_as_chunks`。该版本没有创建 tag 或正式 Release；不重试相同源码绕过确定性错误。

作者在独立 worktree 做最小测试源码修正，保留原有长度与状态序列断言，经另一审查者验收后合并。发布器选择后续 v0.1.40 / Android code 42。

v0.1.40 精确源码 `4ab61ff9721267e0a5bf5533b0feda8a2d9bb745` 的 Rust 1.100 Clippy、mobile 41 项测试和 Web 446 项单测通过；[Checks](https://github.com/ywateru/AnyWork/actions/runs/43691054293) 在 `scripts/review-test.py::test_last_turn_is_not_a_git_comparison` 出现 `sqlite3.DatabaseError: file is not a database`。单次仅重试失败任务后同错重现，两轮均未授权 tag 或 Release。夹具使用 `glob("*.sqlite*")` 可能匹配 WAL/SHM，日志没有记录实际选中文件名，因此不将误选写成直接实证。作者改用与服务一致的精确数据库路径，独立审查后继续 v0.1.41 / Android code 43，不再重试同一失败源码。

## 验收范围

- 正式发行含 23 项附件、22 项摘要和五个平台的更新签名元数据。
- Android 为四个独立架构 APK；验证新版本、原应用标识和原签名身份，不替代实体升级或远程连接验收。
- 官网绑定最终发行源码，双语页面链接正确版本的四个 APK。
- 自动官网部署若仍因原有令牌失效而失败，可用既有本机授权恢复同精确源码，保留自动工作流的失败记录。
- 测试手机当前路线无法连接协调服务的限制继续明确披露，不声称本版已恢复真实远程工作区连接。

最小修正已由[作者验证](../reviews/v40-clippy-author.md)并经[独立审查](../reviews/v40-clippy-independent.md)接受：mobile 测试 41 passed / 1 ignored，本机严格 Clippy 与格式检查通过；Rust 1.100 门禁仍以新版精确源码 CI 为准。

SQLite 最小修正已由[作者验证](../reviews/v41-review-fixture-author.md)并经[独立审查](../reviews/v41-review-fixture-independent.md)接受，相关脚本 13 项通过；本机复用了旧版真实 binary，该结果只证明局部夹具兼容，精确新版仍须通过 CI。

状态：两项测试修正均已合并，继续 v0.1.41 的精确源码检查与全部发行平台构建，尚未完成新版发布。
