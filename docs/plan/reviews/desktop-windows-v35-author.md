# v35 Windows native 检查失败：作者定位与修复

正式候选 source：`ecbce9ba3b274c265f8deae553a9957cba416e60`。
失败证据：[Checks 43547818995 / windows-native job 132303393255](https://github.com/ywateru/AnyWork/actions/runs/43547818995/job/132303393255)。公开 job 日志通过 GitHub API 只读取得，未重跑 workflow。

## 确切原因

`Build native applications` 成功；`Test native applications` 在编译 Desktop lib test 时失败，尚未执行测试：

```text
error[E0433]: cannot find `default_tests` in `accounts`
  --> crates\desktop\src\manager.rs:921:26
```

`lib.rs` 仅在 Unix 上选择 `accounts.rs`，非 Unix（包括 Windows）选择 `accounts_unsupported.rs`。新增 manager 竞态测试无条件调用前者的 `default_tests` helper；该 helper 需要 Unix shell/provider/权限夹具，Windows 模块没有它。此前 macOS 作者测试与独立审查没有覆盖 Windows 测试编译边界。这是作者新增测试漏平台条件，非远程账号故障、网络失败或产品构建失败。

## 最小修复

`e0fa9f6` 仅在 manager 测试内为这一个账号/provider 集成 await 添加 `#[cfg(unix)]` 和说明。完整 manager 测试仍在所有平台启用，保留旧失败探针不能覆盖成功准备、新失败仍关闭 readiness、旧 host 成功不能授权新 host 的断言。Unix 上继续运行实际账号集成 helper；未扩大 Windows 账号支持，没有修改产品运行行为。

工作在原 `codex/desktop-login-remote` worktree；未改 main、版本或 workflow。正式候选与原 worktree 的 `lib.rs`、`manager.rs`、`accounts_default_tests.rs` 在修复前一致，因此可单独 cherry-pick 此提交。

## 验证及边界

复用 root target，`CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 CARGO_BUILD_JOBS=2`：

- `cargo test --offline --locked -p anywork-desktop --lib workspace_preparation_fences_older_probe_results_before_remote_enable -- --nocapture`：1 passed，含 Unix 账号集成。
- `cargo clippy --offline --locked -p anywork-desktop --all-targets -- -D warnings`：通过。
- `cargo fmt -p anywork-desktop -- --check`、`git diff --check`：通过。

本机为 macOS / Rust 1.97.1；失败 CI 为 Windows MSVC / Rust 1.100.0。没有本地 Windows runtime/目标验证，以上不能替代 Windows CI。Hilbert 对精确 `e0fa9f661c2949d1fba89eb4ff329b7b2314a02c` 完成独立增量源码审查：接受、无阻断，并核对相对正式 source 仅此差异；复用上述作者测试证据，未另行构建。最终 Windows 检查应由协调者在候选决策后执行，作者未盲重试。没有重复全 workspace、Android 或发行构建，Cargo target 已释放给 server-web 修复作者。
