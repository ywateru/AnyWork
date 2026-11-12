# 登录设备修订与 CyberGrid：合并检查

日期：2026-11-12，Asia/Shanghai。此记录仍在交付中，不表示已经发布。

登录、设备命名与窗口候选通过[独立修正轮验收](ui-login-device-followup.md)后合入 main `37b5d4d`。独立审查接受源码修正和实际原生控件证据；真实拖动位移仍是输入环境限制，不能记为通过。真实 provider SSO 研究也不等于候选 Native 登录全 runtime 验收。

该合并状态执行：Web 353 项单测与 8 项 private-state 通过；Web typecheck、format、Web 与 desktop UI build、官方 SDK account-entry 检查通过。账号、desktop-login-device、desktop-tunnel、desktop-v2 的 Chrome desktop/Android Web 共 **56 项 E2E 通过**，耗时 1.4 分钟。使用隔离端口 3346、合成业务服务及 Native 边界，不操作用户账号、安装应用或运行服务。证据为忽略的 `artifacts/ui-login-merged-*`，没有重复生成 Cargo target。

随后合入已[独立接受的 Web SDK](cybergrid-v080-web.md) `a7fb33f`，四模块固定 CyberGrid v0.8.0 源码。合并树 `e900de6` 的 **397 Web 单测 + 8 private-state**、typecheck、format、Web build 全通过；6 项 account-unified desktop/Android Web E2E 通过。账号布局检查覆盖 1440/800/390、480 高度及 390×320：登录、设备目录、四类对话中心、滚动、焦点、取消与 touch shell 的 192px 历史列表通过。证据在忽略的 `artifacts/cybergrid-web-merged-*`。

布局验证第一次未启动 Vite 得到 connection-refused，第二次因给只支持根路径模块拦截的夹具传入 `/app/` Vite base 而找不到页面标题；修正为夹具要求的根路径开发服务后完整通过。没有修改产品或放宽断言。Vite 仅绑定 127.0.0.1:3347，外部认证/协调均由合成路由拦截；验证后已按核对过的 PID 停止。E2E 使用隔离 3348 服务。

Native SDK 候选 `d56532a` 通过[独立审查](cybergrid-v080-native.md)后合入 main。合并树 `deb52e5` 的 `cargo fmt --all -- --check`、全 workspace/all-targets Clippy `-D warnings`、`cargo test --locked --workspace` 和 `cargo build --locked` 均通过；workspace 共 **315 passed / 8 ignored / 0 failed**，其中 Native **77 passed / 3 ignored**。继续通过桌面更新 UI 检查、6 项源码导出测试和 3 项版本/签名元数据契约测试。证据为忽略的 `artifacts/ui-login-cybergrid-final/`，复用同一共享 Cargo target，没有启动用户安装的应用或改动其运行服务。

桌面更新 UI 首次启动时缺少 Playwright 自带 Chromium，未执行产品断言；改用现有系统 Chrome（`PLAYWRIGHT_CHANNEL=chrome`）后全通过，没有下载额外浏览器缓存或修改断言。Web 和 GUI 源码在已通过的合并验证后没有变化，本次 Native 合并不重复完整 Web/GUI 套件；精确发行 SHA 仍须经过远端完整 Checks。

服务端维持现有固定绑定及 TLS Redis，不把 SDK 更新写成服务端切换。已保存本次作者/审查证据后删除五个已结束工作树及已合入的作者分支，约释放 347MiB；保留正在开发的 Native SDK 工作树和共享 Cargo target，未清理用户数据或无关工作树。

源码及合并集成门槛已经完成；最终发行仍等待精确源码 CI、不可变发行和线上身份核验。本轮不以旧版本 v0.1.26 的成功记录替代这些门槛。

## v0.1.27 发行中止与修正门槛

发行源码 `37357859d0436b8d6b7efc9912715a30fee0b529` 的[完整 Checks](https://github.com/ywateru/AnyWork/actions/runs/43164129824)全部通过，首次网站部署和[独立线上第一阶段](ui-login-cybergrid-release.md)也通过。但[正式发行构建](https://github.com/ywateru/AnyWork/actions/runs/43166548130)的 macOS arm64 Native 测试有两项失败，其余六个构建目标成功。发行工作流和 publisher 均以 failure 结束，**未创建 v0.1.27 Release 或发布其安装包**；现有不可变 tag 不移动或复用。

两项均在 `Fixture::close` 对旧 gateway 地址的裸 TCP connect 断言失败，分别为 `disable_and_logout_fence_delayed_config_token_registration_and_index` 与 `failed_logout_retains_latest_grant_but_never_reopens_remote`。现有日志不足以区分真实 gateway 残留、端口被其他并行夹具重用或 socket 自连接；不能通过删除断言、盲目延迟或直接重试掩盖。作者在隔离分支诊断，保留原 gateway 退出和业务入口关闭的可验证断言；作者提交后由另一代理独立复核，再决定后续不可变发行。复用串行共享 Cargo target，不影响用户应用或正在运行的服务。原始日志保留在忽略的 `artifacts/ui-login-cybergrid-final/release-macos-arm64.log`。
