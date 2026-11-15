# v40 Clippy 最小修复独立审查

日期：2026-11-15。非作者 reviewer，精确审查作者提交 `84f48bdd1ecf02cb405363bf8e11f4109c93ea3d`，父提交为 v39 发布源码 `541f3ff1e3ae59968c90a8580c594de411f56ff7`。

**结论：接受（PASS），无源码阻断项。** 本结论接受测试语义、最小修改范围、格式及针对已知新增 lint 的修正方式；Rust 1.100 精确源码 CI、后续 v0.1.40/code42 正式发行与网站验收仍待完成，不记为通过。

## 失败基线

v39 [Checks 43689682124 的 server-web job](https://github.com/ywateru/AnyWork/actions/runs/43689682124/job/132737474168) 使用 Rust 1.100.0，在 `./scripts/check.sh` 的 `cargo clippy --workspace --all-targets -- -D warnings` 阶段失败，exit 101。

诊断唯一指向 `crates/mobile/src/account/tests.rs:660` 的 `observed.chunks_exact(2)`，lint 为 `clippy::chunks_exact_to_as_chunks`，原始编译器明确建议 `as_chunks::<2>().0`。这是确定性的测试源码 lint 失败，不是网络瞬时错误，不应重试相同源码绕过。

失败完整日志、步骤元数据、摘录及分析保留在 reviewer WT ignored `artifacts/v39-release-independent/`，分别为 `checks-server-web-132737474168.log`、`checks-43689682124-jobs.json`、`checks-server-web-failure-excerpts.log`、`checks-failure-analysis.json`。

## 精确修改与语义

完整提交仅两个文件：测试中一行迭代替换，以及 `docs/plan/reviews/v40-clippy-author.md`。未修改生产代码、依赖、版本、工作流或 lint 等级，没有增加 allow。

独立核对完整 `account_tls_rejection_finishes_loading_and_allows_another_refresh` 测试：

- 前置 `assert_eq!(observed.len(), 4)` 保留。`chunks_exact(2)` 原本遍历两组长度为 2 的切片；`as_chunks::<2>().0` 返回两个 `[T; 2]` 的切片，按相同顺序遍历同样四项。由于长度已严格断言为 4，余项必为空，`.0` 不会掩盖未检查的状态。
- 每组第 0 项 Loading、第 1 项 Unknown 的断言原样保留；两轮生产 refresh、每轮五秒超时、SignedIn、Unknown、`MOBILE_NETWORK_ERROR`、空设备列表及 TLS server 结束检查均未变。
- 仍由真实 loopback TLS 服务提供匹配主机名但不可信的证书，调用生产 reqwest/refresh 路径。没有替换为注入错误或取消第二轮刷新，因此普通 TLS 拒绝能结束 loading 并允许再次刷新的回归覆盖未被削弱。
- 新表达式与原 Rust 1.100.0 CI 的建议完全一致，移除了触发该 lint 的调用。作者报告在较早 Rust 1.97.1 上编译、Clippy 成功，说明该写法也被现有本地工具链接受；这不能代替 1.100 精确 CI 的实际结果。

## 格式与验证归属

独立执行 `git show --check 84f48bdd1ecf02cb405363bf8e11f4109c93ea3d` 通过。替换保持原有缩进和结构，无空白错误；作者 `cargo fmt --package anywork-mobile -- --check` 通过的记录已阅，没有把它描述为 reviewer 重跑。

只读核对作者 WT 的 `artifacts/v40-clippy/mobile-tests.log`：41 passed / 0 failed / 1 ignored；`mobile-clippy.log` 正常结束。作者说明工具链为 1.97.1、未安装或声称通过 1.100，边界准确。本 reviewer 按要求不重复这些测试、不启动 Cargo 或构建、不安装工具链。

## 隔离与后续门槛

本 reviewer WT 为 `.worktrees/v39-release-verify` / `codex/v39-release-verify`。审查通过 `git show` 读取作者提交，未 cherry-pick 修复，未修改 main、发布状态、tag 或远端任务；报告提交仅含本文件。v39 失败证据继续保留。

parent 可据此接受最小修复，再由既有 publisher 流程产生新版本与精确源码。后续必须核验 v0.1.40/code42 的版本一致性、精确 SHA 对应的 Rust 1.100 Checks 和全部发行平台；不能用作者 1.97.1 的本地成功取代这些门禁。TLS 初始化实体修复与剩余协调网络限制的既有验收边界不因本次测试写法调整而改变。
