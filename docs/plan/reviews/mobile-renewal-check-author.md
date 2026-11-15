# Mobile renewal CI：夹具时序调查与作者修复

2026-11-15。基线 `0a38dbb2230373884cc9872849c9bfffc9aaabc1`（v0.1.42），独立WT `codex/mobile-renewal-check`。调查输入为协调者留存 `artifacts/v42-release-independent/132789044862.log`：mobile库41 passed / 1 failed / 1 ignored，唯一失败是 `transport::tests::renewal_preserves_existing_pty_and_later_http` 的 `auth.tokens >= 2`。没有重跑远端Checks或更改已冻结发行源码；下一发行版本由协调者维护。

## 根因与边界

已复现**测试的三秒租期存在墙钟相位依赖**。不修改生产renewal逻辑，修复仅在 `crates/mobile/src/transport/tests.rs` 与本文。现有证据不能将此CI失败定为正常生产租期下的续租回归，也不能用本次修复宣称所有任意短租期/调度饥饿情形均可续租。

源码链路：

- 旧fixture Verifier给首个token返回 `now().as_secs()+3`，之后返回300秒；测试固定sleep4秒后仅检查取token次数，再检查HTTP/PTY。
- gateway `lease_duration` 用完整SystemTime计算到期：整秒expiresAt减含亚秒的当前墙钟。mobile `lease` 则先用整秒now计算TTL，形成Tokio单调deadline，`renewal_at` 在剩余TTL的三分之二处触发；maintenance空闲tick为100ms。Duration除3保留亚秒，问题不是整数除法直接把margin除成零。
- 在首个授权发生于秒末且握手同秒完成时，三秒fixture的真实剩余寿命可接近两秒，而mobile触发点也接近两秒；剩余网络/调度余量可逼近零。maintenance或CI调度稍迟，gateway/本地墙钟门禁就先到期，后续不会再取刷新token。正常较长租期的续租窗口远大于这一亚秒偏差，本轮没有修改其算法或放宽到期门禁。
- 原测试单跑通过（4.02秒）。为定向复现，只在测试Verifier前临时将初次验证对齐Unix秒末，保持三秒租期、生产路径及原断言不变；记录相位 `0.991949s` 时在同一个tokens断言失败（4.88秒）。这证明夹具失败模式；CI日志没有纳秒时序，不能倒推原runner恰为这个相位。

## 最小修复与保留的证明

首个合成授权改为12秒，仍明显短于刷新后的300秒；Verifier记录首次绝对expiresAt，并以Notify报告真实gateway收到后续token。Notify不意味着客户端已收到或接受auth.renewed。

测试不再以固定四秒sleep推断续租完成：以20秒有界通知等待检查续租路径确实运行，保留 `tokens >= 2`；之后等待已记录首次绝对到期加一秒，跨过gateway旧到期及客户端整秒换算的旧deadline，再执行HTTP和原PTY。到期等待每次醒来重新核SystemTime，并有独立20秒上限，避免单次timer唤醒与墙钟临界值再次产生假设。

保留全部原有断言，并加强：HTTP响应必须200且含完整fixture JSON；PTY必须使用原connection/generation和operationId，回显完整input JSON包。既有PTY夹具回显的是输入协议JSON而非裸文本，断言按其真实契约核对。没有skip、减少断言、宽松重试、自动重连或通过延长生产租约制造成功。临时相位注入和负对照均不进入最终源码。

## 定向验证记录

共享root target窗口经协调者授权独占；使用既有依赖、offline/locked、关闭incremental及debug符号。本WT临时链接主工作区既有 `web/dist-mobile` 满足Tauri context编译，不重建前端、不复制依赖。没有Cargo/lock、Android构建、设备、宿主或云操作。

基础命令：

```sh
CARGO_TARGET_DIR=<main-worktree>/target \
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 \
  cargo test --offline --locked -p anywork-mobile --lib \
  transport::tests::renewal_preserves_existing_pty_and_later_http -- --exact --nocapture
```

- 原样单跑：1 passed，4.02秒；不是将一次通过当作修复。
- 旧三秒fixture的秒末相位控制：预期复现原tokens断言失败，4.88秒。
- 修复fixture的同相位控制：`0.992704s`，1 passed，12.45秒；跨过旧租约后HTTP与原PTY均通过。
- 实施时新增的裸文本PTY比较及单次timer后整秒比较曾分别失败；按真实PTY封包与有界墙钟重核修正，未将中间失败记为通过。
- 不延长租约的负对照：临时让刷新token验证返回首次expiresAt，Notify仍触发且token次数仍达到要求；跨过旧租约后HTTP按预期以 `CONNECTION_CLOSED` 失败（12.39秒）。证明仅刷新回调不会令此测试通过；负对照已移除。
- 最终源码运行 `cargo test --offline --locked -p anywork-mobile --lib transport::`：21 passed / 0 failed / 0 ignored，22 filtered out，20.96秒。包括本续租回归、授权到期门禁、真实HTTP/PTY、TLS负向验证及22MiB完整往返。
- 本机工具链 `rustc 1.97.1` / `cargo 1.97.1`；`rustfmt --edition 2024 crates/mobile/src/transport/tests.rs`、最终 `git diff --check` 通过。不安装新工具链；跨平台及当前CI工具链由后续精确源码Checks覆盖。

所有Cargo进程均已退出，已移除本任务临时前端链接，共享target窗口释放。最终提交仅测试夹具及本报告；不包含相位/负对照注入、版本变更或运行时产品代码。保持v42冻结源码及协调者的下一发行版本计划。

小型安全log留在本WT ignored `artifacts/mobile-renewal-check/`，不含真实凭据或用户数据。本报告为作者结果，独立源码/验证接受由协调者指定审查者完成；不作为新发行成功证明。
