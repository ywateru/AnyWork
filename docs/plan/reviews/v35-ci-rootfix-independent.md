# v35 CI 根因修复：独立增量审查

结论：**接受以下两份精确提交，无阻断发现，可合入后对新精确 source 执行 CI**。此结论是最小源码修复的独立审查，不表示原失败 workflow 已通过，也不替代 Windows / Rust 1.100 上的新 CI。

失败候选为 `ecbce9ba3b274c265f8deae553a9957cba416e60`，[Checks 43547818995](https://github.com/ywateru/AnyWork/actions/runs/43547818995)。两项失败都发生在测试执行之前，不能归因为账号服务或浏览器诊断测试失败。

## Windows：仅隔离 Unix 账号集成夹具

接受 `e0fa9f661c2949d1fba89eb4ff329b7b2314a02c`，单文件 `crates/desktop/src/manager.rs` 增加三行。

核对作者报告 `107ee812497eec8ba60c3c9f28a2c49edfdc8119`、模块选路及实际调用位置：[Windows job 132303393255](https://github.com/ywateru/AnyWork/actions/runs/43547818995/job/132303393255) 的失败为测试编译 E0433，找不到 `accounts::default_tests`。`lib.rs` 在 Unix 选择 `accounts.rs`，非 Unix 选择没有该 helper 的 `accounts_unsupported.rs`；manager 测试此前无条件引用了 Unix 账号/provider 夹具。

修复只给该 helper 的集成调用加 `#[cfg(unix)]`，与模块平台条件一致。整个 manager 测试继续跨平台编译，保留以下三项核心断言：旧失败探针不能擦除成功准备的 authorized/Running；新失败仍撤销 readiness；旧 host 的成功不能授权新 host。Unix 上仍执行真实账号/provider 集成调用。没有扩大 Windows 账号支持或改动产品行为。

独立查看提交 diff，并比较正式候选与修复后的 `lib.rs`、`manager.rs`、`accounts_default_tests.rs`，确认仅有上述差异。复用作者定向证据：manager 回归 1 passed；desktop all-targets Clippy `-D warnings`、格式及 diff 检查通过。未重复构建。

## server-web：保持旧 owner 关闭语义的 let chain

接受 `3901bad4272462dfb03ef49482e20f72475ffdcb`，单文件 `crates/mobile/src/account/grid.rs` 两行新增、三行删除。

独立读取保留的原始 [server-web job 132303393556](https://github.com/ywateru/AnyWork/actions/runs/43547818995/job/132303393556) 日志：Rust 1.100 的 `clippy::collapsible_if` 在 `grid.rs:119` 被现有 `-D warnings` 提升为错误，`scripts/check.sh` 因而在 workspace all-targets Clippy 阶段结束，尚未执行测试或浏览器门禁。其后的 unused-dependency 警告不是此次致命错误。

修复与日志建议一致，将嵌套 `if let Some(old) = slot.take()` 合并为短路 let chain。独立核对求值和生命周期：先判断 epoch/subject 是否过期；仅在过期时取出 slot；同一 mutex guard 持有期间 await 旧 owner 的 close；结束后才重建 owner。前置 `ensure_epoch`、其余授权 guards、初始化和错误映射均未改变。工作区 edition 为 2024，语法适用。

独立查看精确提交，并与正式失败 source 比较该文件，确认只有上述 diff，无 warning suppression、版本或 Web 改动。读取作者完成日志：mobile all-targets Clippy `-D warnings` 通过；现有 account 定向测试 **16 passed**，包括三个实际 pinned SDK 的 Native 目录/失败/会话恢复用例；格式及 diff 检查通过。未新增测试或重复 Cargo。

## 验证边界与交接

作者本机检查使用 macOS / Rust 1.97.1，失败 CI 使用 Rust 1.100；本次独立审查未进行 Windows 本地编译、工具链升级、广泛测试、APK 构建或远端重试。Windows 测试编译和 server-web 完整门禁都仍须由合并后的新精确 source CI 验证。

审查过程中未修改产品源码、main、版本或 workflow，未访问真实账号、凭据、原会话或设备。两位作者已收到精确提交接受结论，共享 target 未被本审查占用。原失败证据应保留；协调者可据此生成新发行候选，尚未创建的 v35 tag 不属于本次审查操作。
