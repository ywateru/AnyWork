# Published desktop update validation / 正式版本更新验收

Date / 日期：2026-11-06

## Published builds / 正式构建

- `v0.1.1`: source `40a4297`, [successful release workflow](https://github.com/ywateru/AnyWork/actions/runs/42168410819).
- `v0.1.2`: source `c248fd7`, [successful release workflow](https://github.com/ywateru/AnyWork/actions/runs/42170032911).
- Each release contains 20 assets: desktop packages for five targets, signed native update artifacts, Android APK, source/Web archives, `latest.json`, and `SHA256SUMS`. Both release workflows completed their platform build/test/bundle jobs before publishing.

两次正式发行均构建成功。最新版本为 [v0.1.2](https://github.com/ywateru/AnyWork/releases/tag/v0.1.2)，包含 macOS ARM64/Intel、Windows x64、Linux x64/ARM64 及 Android 附件。官网发布任务 [42171332025](https://github.com/ywateru/AnyWork/actions/runs/42171332025) 成功，公开 `release.json` 已确认为 `v0.1.2`。

## Real package upgrade / 真实更新包升级

The ignored integration test `updates::tests::published_update_installs_into_isolated_app` passed using the published **0.1.1 → 0.1.2** packages. The baseline ZIP was checked against published SHA256SUMS, then copied to a disposable application directory. Only that copy was replaced. The test uses the production update core, embedded public key and public release endpoint, with a Tauri MockRuntime driver and an isolated manager with an empty secret store.

真实跨版本测试使用公开发行包、生产验签公钥和更新核心，基础 ZIP 经过 SHA 校验后复制到临时应用目录，再执行更新。后台下载约 28 MiB，整项测试 288 秒通过。验收包括：

- Background download leaves the baseline application unchanged until installation / 后台下载期间基础应用保持旧版。
- Version-bound signature verification / 绑定版本号的签名校验。
- Tampered cache rejected before any service stop / 被篡改缓存会在停止服务前被拒绝。
- Complete cache restored by a new updater handle without network access / 完整缓存跨实例恢复，无需再次联网。
- Stale version confirmation rejected / 拒绝过期版本确认。
- Real application bundle replacement in the disposable copy / 实际替换临时应用包。
- New desktop executable and embedded server both report 0.1.2 / 新桌面和内置服务程序均报告 0.1.2。
- macOS code signature verifies / macOS 代码签名验证通过。
- Updated GUI launches in inert preview mode and completes frontend-to-Rust IPC / 更新后的 GUI 以隔离预览模式启动并建立前端到 Rust IPC。
- Original baseline executable hash remains unchanged / 原始基础应用的可执行文件摘要保持不变。

The local report is `artifacts/update-smoke-result.json` (generated, not committed). The smoke test accepts `ANYWORK_UPDATE_SMOKE_BASE_APP`, `ANYWORK_UPDATE_SMOKE_FROM`, `ANYWORK_UPDATE_SMOKE_TO`, and `ANYWORK_UPDATE_SMOKE_REPORT`; see its preconditions in `crates/desktop/src/updates.rs`. Run it explicitly:

```sh
cargo test --locked -p anywork-desktop \
  updates::tests::published_update_installs_into_isolated_app \
  -- --ignored --exact --nocapture
```

## Other checks and limits / 其他验证及边界

Workspace Rust tests: 109 passed; four opt-in tests remained ignored in the ordinary suite. Desktop/server Clippy with warnings denied passed. Browser fixtures passed for silent progress/errors, deferral, preference changes, version-bound confirmation, Escape focus restoration and one installation request per confirmation. Readiness tests cover busy/idle/unauthenticated/unknown state, older-host fallback and ownership distinctions. Release guard/signature tests and desktop/Web builds passed.

普通 Rust 套件 109 项通过；桌面和服务端 Clippy 通过；浏览器隔离 fixture 覆盖静默下载、轻提示、稍后提醒、自动检查开关、确认、Escape 焦点恢复和防重复安装请求；服务状态测试覆盖忙碌、空闲、未知状态、旧主机兼容及自有/外部会话区别。

**Boundary:** the real package smoke driver invokes the production update core using MockRuntime. It does not click Install inside a running published 0.1.1 GUI or invoke `app.request_restart()`. Confirmation is tested separately in the browser fixture; the updated executable and GUI startup are actually exercised. Windows/Linux packages build and test in CI, but their cross-version GUI installations were not dynamically exercised on this macOS host. Do not describe these as a fully clicked-through GUI restart test on every platform.

**边界：**真实包测试使用 MockRuntime 驱动更新核心，没有在运行中的正式 0.1.1 GUI 内手动点击安装并观察自动重启。确认交互另由浏览器 fixture 验证；新版程序及 GUI 启动经过实际运行。Windows/Linux 的跨版本 GUI 安装未在本机实测。测试未修改或重启原 Codex，也未停止真实 3210 服务；所有测试服务和 GUI 均使用独立临时目录。
