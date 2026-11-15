# v40 Clippy 兼容修复：作者验证

基线为 `541f3ff`（Release v0.1.39）。本提交仅调整 mobile TLS 拒绝回归测试中的一处切片迭代，以处理 Rust 1.100 Clippy 的 `chunks_exact_to_as_chunks`；不改生产行为、依赖、版本、lint等级或发布配置。

## 最小变更

`crates/mobile/src/account/tests.rs::account_tls_rejection_finishes_loading_and_allows_another_refresh` 将 `observed.chunks_exact(2)` 改为 `observed.as_chunks::<2>().0`。保留前置 `assert_eq!(observed.len(), 4)` 和每组 Loading→Unknown 两个断言。长度严格为4，因此两种迭代都恰好覆盖两组状态，无余项被忽略；真实TLS拒绝、账号保留和第二轮刷新验证保持不变。

## 本机验证与边界

先检查工具链：当前可用默认 rustc/cargo/clippy 为1.97.1；未安装1.100。工具链列表中的1.98不完整（缺manifest及rustc driver动态库），不可用于验证。本任务没有安装、修复或切换默认工具链；因此不声称本机已复现或通过Rust1.100新增lint，最终以该工具链的精确源CI为准。

复用主工作区共享target，jobs=2，离线锁定依赖，串行运行以下检查，均成功：

- `cargo test --offline --locked -p anywork-mobile --lib`：41 passed / 0 failed / 1 ignored，运行29.07秒；ignored为显式公网配置探针，未访问真实账号或设备。
- `cargo clippy --offline --locked -p anywork-mobile --all-targets -- -D warnings`：通过，未增加allow或放宽warning。
- `cargo fmt --package anywork-mobile -- --check`、`git diff --check`：通过。

验证期间仅在本作者WT临时链接现有mobile前端资产以满足Tauri编译期路径，验证后已移除；未复制依赖、创建独立target或重建前端。小日志位于本WT ignored `artifacts/v40-clippy/mobile-tests.log`、`mobile-clippy.log`。没有运行完整构建、主分支写入、远端操作、发布、ADB或宿主操作。
