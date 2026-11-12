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

阶段诊断没有复现原发行的两项失败：80 轮中 37 轮全绿，43 轮均为另一个 provider 就绪文件等待超时；2,197 次已记录关闭任务全部正常完成，不能将这些日志写成原错误已复现。作者随后构造原 gateway 任务结束、原端口重新绑定并接受其他 TCP 连接的确定性用例，证明裸端口断言存在误判条件，但仍不证明原 CI 当时确实端口复用。候选方向是观察原 gateway 任务身份及完成状态，保留 Native disabled、无 remote/clients、provider 退出等原有断言，不改变 production 关闭流程；另以明确阶段同步定位就绪夹具，撤回未证实的 sleep 调整。完成候选及独立验收前不放行发行。

## v0.1.28 修复验收与合并复检

作者 `da043f04404feadae4d18a0db62650b644941b23` 已通过[独立复核](ui-release-gateway-close.md)，无 blocking finding，合入 main；独立报告为 `d761f7e`，主树对应 `aee2d7d`。只读 observer 识别原 gateway task 的完成状态，测试专用 oneshot 同步实际子进程创建。production 关闭顺序、取消及超时不变；受控替代 listener 用例不用于推断原事故根因。

主树 `aee2d7d` 执行 `cargo test --locked --workspace --release` 全部通过：**316 passed / 8 ignored / 0 failed**，含服务端 193、Native 78、remote unit 5 与真实 Noise/WS 8。未改变此前已经验收的 Web/GUI 源码；完整精确发行 SHA 的远端 Checks 仍是后续门禁。证据在忽略的 `artifacts/ui-login-cybergrid-final/merged-v28-workspace.log`；作者及独立证据已保存至主树，复用共享 target，无用户服务操作。

双语发行说明准备为 v0.1.28。v0.1.27 构建已经终态失败，后续使用 publisher `--new` 保留旧 tag，发布新精确源码；本节仍不表示新版已发布。
