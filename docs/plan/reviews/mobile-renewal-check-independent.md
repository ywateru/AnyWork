# Mobile renewal 测试修复独立审查

审查日期：2026-11-15。独立 reviewer，非作者。精确作者提交 `b60b42a9757ab54cc9d394d364f92a1f09d89b5a`，父提交为冻结的 v42 源 `0a38dbb2230373884cc9872849c9bfffc9aaabc1`。范围仅 `crates/mobile/src/transport/tests.rs` 和作者报告；无运行时、依赖、版本、workflow或生产到期门禁修改。

## Findings 与语义审查

无 blocking findings。测试符合 `docs/mobile-native-contract.md` 的 connection/generation 边界及 `docs/account-remote-protocol.md` 的旧租约保持、匹配 ACK 后续期、HTTP/PTY 存续契约。

- 原3秒fixture有墙钟相位敏感性：gateway按完整SystemTime计算剩余租期，mobile按整秒TTL建立单调deadline并在剩余三分之一处续期，另有100ms maintenance tick。秒末相位会压缩实际余量；作者的相位复现与源码一致。原CI没有亚秒记录，不能将作者复现相位写作原runner已证实的时间线，也不据此宣称生产短租约算法已修复。
- 12秒只是合成fixture首租期；刷新后仍为300秒。Notify由真实gateway的Verifier接到新token时发出，`notify_one`许可可保留，避免订阅先后丢信号；20秒有界等待及原 `tokens >= 2` 条件保留。该通知本身不冒充客户端ACK成功。
- 记录的初始绝对expiresAt加1秒，跨过gateway旧到期和mobile整秒换算最多不足1秒的偏差；有界循环重核墙钟，避免单次timer提前醒来的边界假设。之后的成功业务必须依赖续期后的租约。没有放宽运行时到期或ACK关联检查。
- HTTP要求200、完整fixture JSON，读函数还核对响应长度。PTY复用同一op发送独特输入，回显必须匹配完整connection（含generation）、operationId及解码后的完整input JSON；首次ready/data已读取并ACK，没有用旧初始化事件充当续期后回显。测试没有重连、重开PTY或重放业务。

## 独立执行

在独立临时detached WT检出精确提交，共享既有root target及依赖，仅临时链接既有 `web/dist-mobile`；未修改作者WT。Rust/cargo 1.97.1，offline/locked，关闭incremental与dev/test debug符号。执行命令：

```sh
CARGO_TARGET_DIR=<root>/target CARGO_INCREMENTAL=0 \
  CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 \
  cargo test --offline --locked -p anywork-mobile --lib \
  transport::tests::renewal_preserves_existing_pty_and_later_http -- --exact --nocapture
```

- 精确提交正向：1 passed / 0 failed / 0 ignored，42 filtered out；测试12.55秒。实际跨旧到期后的HTTP及原PTY断言全部执行通过。
- `rustfmt --edition 2024 --check crates/mobile/src/transport/tests.rs`、提交 `git diff --check` 均通过。

- 独立负对照：仅在临时WT让Verifier对刷新token返回原 `initial_expires`，保留Notify、计数条件、到期等待和全部业务断言。预期失败实际成立：13.01秒，HTTP begin在 `tests.rs:229` 返回 `CONNECTION_CLOSED` / `NotSent`；0 passed / 1 failed。执行已越过Notify和token计数检查，证明仅收到刷新token不足以使门禁通过。该负对照由gateway拒绝不递增租期触发关闭；它不单独模拟“gateway已延长但客户端丢ACK”的另一故障，客户端仅在匹配ACK后延长deadline另经源码核对。

结论：**PASS，接受精确提交 `b60b42a9757ab54cc9d394d364f92a1f09d89b5a`，无阻塞发现。** 原到期边界未弱化，续期后的HTTP与原PTY证明更强。作者21项transport通过为作者证据，本lane不将其记为独立重跑；本lane也不重复旧3秒相位注入或全量Checks。

## 发行边界

v42精确源Checks失败与未发布状态保留于 [v42报告](v42-release-independent.md)。接受测试修复不追认失败的旧源或替代后续精确源CI；后续发行版本/source由协调者冻结。实体手机已通过的候选只读业务验收保持有效，本次没有设备、账号、桌面会话、部署或CI操作。

小证据保留在review WT ignored `artifacts/mobile-renewal-independent/`，含正向日志/结果和负对照差异/日志/结果；不含真实账号或凭据。

负对照已恢复并核对临时源码干净，临时前端链接及detached WT已清理。两次执行均退出，共享target窗口释放；无本lane遗留测试/监控进程，不清理作者或共享target缓存。
