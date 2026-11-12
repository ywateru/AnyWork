# 登录与设备体验修订：独立验收

日期：2026-11-12，Asia/Shanghai。

## 结论

**修正轮 accepted，可合并：固定候选 `e42eba5015e1d3c43b9ea15cb9a50b094fa98268` 包含修正 `3e155cce0fce53805397395dd548dc854bb342af`。源码与针对测试通过，常规原生交通灯及 800×620 窗口证据成立；真实拖动位移仍未验证，按明确的验收澄清记录为输入环境限制，不记 drag pass。初轮 blocked 历史保留如下。**

审查的组合提交为 `918c3ac9fd0b71b198f2454107fe77be684c6d49`，包含 Native `aa725917737e9bb506e712b535db0a3a9801ceb5`、UI `3cf36e11041892d8284d07a6e17045435ba94e4c` 和 main `c3f4074` 设计文档。另外只读核对 main `7e24dab` 的文档澄清。未审未提交作者修改，未改作者代码，未认可后续 CyberGrid v0.8.0 候选。

证据目录：`artifacts/ui-login-independent-review/`。真实 provider SSO 研究另存于 `artifacts/ui-login-independent-sso/`，其通过不等于候选 Native 全链路通过。

## 待解除的实窗门禁

1. **真实拖动仍 pending。** 新构建候选的空白顶区及标题区收到 CUA 拖动手势后出现文本选区，没有观察到窗口位移。独立读取的 CGWindow 几何前后均为 `(383,133), 961×721`；`native-geometry-before.json`、`native-geometry-after.json` 和 `native-after-drag.png` 留存了观察。随后仅附加候选 PID22315 的 LLDB 断点，确认手势实际进入 `anywork_desktop::bridge::desktop_drag`、`bridge.rs:38`，所以不能只用 Chrome fixture 的 IPC 调用计数关闭此项。调试已 detach。此证据仍不能排除输入工具的事件时序限制；不能仅据此断言真实鼠标必然失败，也不能给拖动 pass。需要作者修复或在同一提交的真实原生窗口取得可复核位移证据。
2. **常规交通灯可见性未成立。** CUA 与指定窗口 ID 的独立截图均有紫色 macOS 共享徽标覆盖左上角原生按钮区域。CGWindow 列表也记录了该区域的小型 `Window`。这不是独立 AnyWork 标题条，主 UI 背景连续、品牌位于预留区域下方；但是当前图片不能证明三色按钮本身可见。Accessibility 中有真实 close/full-screen/minimize 按钮，实际 full-screen AX 按钮将窗口变成全屏，实际 close AX 按钮关闭了候选进程。最小化激活使 CUA 目标状态变化，重新绑定后恢复，但未留存充分状态证据，不将最小化完整验收记为 pass。需补不受共享徽标遮挡的常规窗口可见性证据及完整控制验证。

`native-default.png`、`native-fullscreen.png`、`native-window-only.png`、`native-ax.txt`、`native-after-close.json` 为上述证据。未执行 800×620 原生最小尺寸窗口验收，不能以 Chrome 800×620 图替代。

## 独立源码审查

- 普通桌面登录由 `[Prompt.Login, Prompt.Consent]` 改为 `[Prompt.Consent]`；仍由官方 SDK 生成独立 Native PKCE/state，仍由 Native 事务 broker 持有刷新所有权。未复制 Web token 或 Cookie。
- 可信显示名称从 Account API 顶层或嵌套 profile 的 name/username 优先取值，再回退邮箱。必要时访问固定 issuer `/me`，校验 `sub` 与已验证身份一致。没有扩展任意 URL/header IPC 代理；缺资料显示“已登录账号”，不把 subject 当名称。
- 回调使用内联品牌 HTML，区分收到结果、取消、provider 错误和无效链接。正文不反射 code/state/error_description；CSP 只允许精确哈希的 query 清理脚本及内联样式，具备 no-store/no-referrer/nosniff。单一 state 和单一 code/error 结果校验保留，异常 state 不消耗事务。
- `device-name.json` 只保存非敏感名称，首次生成平台名和随机短后缀；正常重载不重新生成。UTF-16 长度、trim、控制字符、symlink/非文件/超长存储边界有检查。Native 和不支持账号的平台均接通 snapshot/rename IPC。
- rename 携带 `expectedName`，操作前核对本地基线，并在固定账号目录 GET 后比较当前 label，保持其他字段，再 PATCH/GET 核对。冲突更新观察并拒绝旧草稿覆盖。失败不声称同步；不存在目录记录时仅保存本地名称，不启动远程、不创建身份、不重启服务。云端没有原子 CAS，读写间竞态仍是已记录接口限制。
- macOS 配置使用 Overlay/hiddenTitle，保留系统 decorations；renderer 只在 Native 返回 `macos-overlay` 时启用安全区和自定义拖动 IPC。按钮与空白拖动区域分离。源码连接正确不替代上述实窗门禁。
- Web 对话内部未改；Web 样式修改只给 account dialog 显式 fixed/inset/margin 居中。原 `e2e/sidebar-scroll.spec.ts` 在本轮与 main 设计基线之间逐字不变。

## 独立执行结果

| 检查 | 结果与边界 |
| --- | --- |
| `cargo test -p anywork-desktop -- --test-threads=1` | **66 passed / 3 ignored**，无失败；ignored 是显式网络/环境诊断，不等于已覆盖真实账号业务。`native-all.log` |
| 新 Native 构建 | **pass**，独占复用主树 Cargo target，`CARGO_INCREMENTAL=0`。`native-build.log` |
| 新 desktop UI 与 Web dist | **pass**，各自 tsc 和 Vite build 成功；Native 实窗嵌入本轮新 dist。`native-window-provenance.json` 记录源 SHA、二进制及 UI JS/CSS SHA-256 |
| 官方 SDK 账号入口检查 | **pass**，从仓库根运行 `node desktop/ui/scripts/account-entry-check.mjs`，包含 consent-only URL、独立官方注册/登录、取消竞态和 RAM-only 提示。`sdk-consent.log` |
| 桌面针对 E2E | **25 passed / 45.3s**：`desktop-login-device` 5、`desktop-tunnel` 14、`desktop-v2` 6。覆盖 overlay 安全区/拖动 IPC 边界、Unicode 改名、失败草稿、fresh-name 冲突、缺资料匿名显示，以及默认远程、manual-off、连接关闭确认、dirty draft、外部服务所有权。使用 Chrome、独立服务器 3342。`browser.log`、`browser/` |
| Web 真实浏览器几何 | **pass**：1440/800/390，另 1440×480、800×480、390×480、390×320；add/rename/remove/key 对话居中，滚动后定位、内部溢出、焦点恢复通过。390×480 touch shell 历史列表 **192px**，设备切换/取消/回首页/退出门禁通过。服务/认证边界为隔离 fixture。`web-geometry.log`、`web-geometry/` |
| 附加真实 loopback HTTP | **3 passed**：异常 state、重复 state/code/error、混合结果、空值、错误路径和 POST 不消耗事务；正文不反射 canary 或注入文本；取消/部分请求不交付；8 轮竞争回调最多一次成功，listener 关闭后不能重放。全部使用 `127.0.0.1:0`。`callback-independent-tests.rs`、`callback-independent.log` |

附加回调测试只追加到 `git archive 918c3ac9` 的临时副本，没有改 review 工作树；仍复用同一主树 Cargo target。首版竞争测试错误地假定 listener 首次成功关闭后第二次 connect 必须成功，收到预期 connection-reset；修正测试以先建立两个连接后，三项全部通过。此驱动修正不是产品修复。

## 实窗隔离与用户进程观察

实窗来自本轮新二进制的独立临时 `.app`，路径 `/tmp/anywork-login-independent-native/AnyWorkIndependentReview.app`、bundle ID `dev.anywork.independent.loginreview`，明确区别于用户 `/Applications/AnyWork.app`。实际操作 PID22315，参数 `--preview workspace`，独立 `ANYWORK_MANAGER_HOME=/tmp/anywork-login-independent-native/preview-home`。preview 拒绝账号写入且不启动 updater/manager lock。初次 Python 子进程21916在 CUA 绑定前已退出，后改用持续 exec session 启动22315，provenance 已区分两者。

CUA 所有目标返回的名称均为 `AnyWorkIndependentReview`；没有调用用户 bundle `dev.anywork.desktop`，没有对用户应用发出 close/quit/kill、替换、安装或重新登录指令。root 在本轮观察到先前用户应用 PID7444 不再存在，其原因无法从本轮证据确定，不能声称已建立因果。未自动重启用户应用。独立检查时用户外部服务 PID28102 仍运行，未触碰。

本轮最后通过候选真实 AX close 按钮关闭22315；随后进程已退出，`native-after-close.json` 无窗口。3342 E2E 服务随测试结束，3343 Vite 已仅对核对过命令的测试 PID21442 发送 TERM。没有监听或请求用户 Native callback 17897。

## 与真实 SSO 研究的区别

此前已获授权的合成账号在真实 self-hosted issuer、同一新 Chrome context 中完成 SPA→Native consent-only 授权：仅 SPA 输入一次密码，Native 无第二次密码页；各自 code exchange、PKCE/state、JWKS 验签、subject 与可信 profile 核对通过，临时 grants 已撤销，零业务/customData 写入。证据 `artifacts/ui-login-independent-sso/readonly-sso-result.json`。

该研究使用真实 provider callback Location 交给官方 SDK，绕过机器代理对 loopback 的 502；没有经过候选 Rust listener/commit/真实桌面登录全链路。本轮 preview 同样没有完成真实候选登录或云端改名，不能把 provider 研究、合成目录边界或 Chrome renderer fixture 描述为候选全 Runtime 的真实账号验收。原生实窗门禁解除后仍需按接受范围明确这些限制；后续 SDK 修改须另做增量独立审查。

## 修正轮前的只读研究

详细建议保存在 `artifacts/ui-login-independent-review/native-driver-research.md`，未使用 Cargo 或操作窗口，不构成修正候选验收。

- 锁定的 Tao 0.37.2 在 macOS `drag_window` 发现 `NSApp.currentEvent` 缺失时，会记录 warning 并返回 `Ok(())` 而不拖动，源码明确列举了 mouse-down 已处理后的异步请求。Tauri 运行时也不把实际位移作为 IPC 返回值。因此应检查真实事件类型/按钮状态和前后 frame，而不能以“调用成功”关闭门禁。参见 [Tao 发布记录](https://github.com/tauri-apps/tao/releases) 的 `19a43d27` / #1372。
- 同一 Tauri 版本自带 drag.js 在 invoke 前调用 `preventDefault()` 和 `stopImmediatePropagation()`，当前 React 自定义 handler 没有这两步；文本选区可能是浏览器默认行为，不能单凭选区断言 Native 未执行。补事件抑制也不等于证明已修复 Native 事件时序。
- [Firefox/macOS 实际报告](https://bugzilla.mozilla.org/show_bug.cgi?id=1948100) 确认共享 stream 可在交通灯位置出现系统紫色徽标，点击后出现关闭/最小化等菜单。没有证据保证 hover 恢复三色按钮。较窄的取证路径是新进程启动后、绑定 CUA/开始该窗口 stream 前先按精确 window ID 截取常规窗口，再做无调试暂停的几何位移、按钮和 800×620 检查。不得把 AXSetPosition 等直接改 frame 的操作当作拖动证明。


## 修正轮独立复核：2026-11-12

复核 clean review HEAD `e42eba5015e1d3c43b9ea15cb9a50b094fa98268`，修正提交 `3e155cce0fce53805397395dd548dc854bb342af`。该修正只涉及 renderer 两处拖动 handler、WebKit user-select 样式和针对 E2E；Rust、Tao/Tauri、服务所有权及凭据路径未改。独立构建 desktop UI，并以隔离 Chrome、无 Native/云端真实账户边界重跑 `desktop-login-device.spec.ts`：**5 passed / 14.4s**。空白区和标题子节点左键取消默认事件，右键不取消；交互控件不调用拖动 IPC。证据：`artifacts/ui-login-independent-review/corrective/`。

独立检查作者的 `artifacts/ui-login-native-drag-author/provenance.json`，现存 UI HTML/JS/CSS 与两份最终原生可执行文件的 SHA-256 全部匹配。逐图查看 `final-960-before-sharing.png` 与 `final-800-before-sharing.png`：红黄绿原生控件在普通窗口左上预留区内直接可见，背景与侧栏连续；没有独立应用标题栏，也没有共享徽标遮挡。它们为作者精确窗口截图，本轮未冒称是独立重新截取。

复核作者逐状态 CGWindow 记录：PID29755 普通窗口 `(264,121),961×721`，实际 AX 最小化后 onscreen=false、恢复后同 PID/同 frame onscreen=true，全屏后 `(0,29),1440×903`，关闭后无候选进程/窗口；PID30425 对应真实 `800×620` 窗口，同样最小化隐藏、恢复同 PID/frame、关闭后无候选窗口。结合初轮独立 AX full-screen/close 结果，常规控件与最小尺寸缺口可以关闭。新增实际控件操作由作者执行，本轮为独立来源/几何/截图复核，不能写成独立重新操作。

拖动仍**没有位移实证**。作者修正后没有文本选区，但 frame 仍不变；临时诊断记录 Native handler 收到 MouseMoved 或 MouseDown 时 `pressedMouseButtons=0`。本轮独立只读执行 `CGPreflightPostEventAccess()` 得到 **false**，存于 `corrective/input-access.log`。这证明当前终端 CGEvent 替代驱动缺少投递权限，并支持现有合成手势不能作为有效 held-mouse 验收的判断；它不能证明真实鼠标必然成功，也不能完全排除真实输入/IPC 时序缺陷。没有修改隐私权限、制造按键状态、用 AXSetPosition 改 frame 或继续无效手势。按 root 明确允许的“源码事件抑制修正 + 原生控件实证 + 诚实输入环境限制”门槛接受合并，后续由有有效 held-mouse 输入的环境或人工确认两处拖动区位移。报告结论不是全功能无条件实窗 pass。

本轮未启动/关闭用户安装应用，未用 Cargo、未改作者代码、未启动新的 Native preview；只运行隔离 renderer 测试。先前 PID7444 消失仍原因不明，历史表述不变。真实 provider SSO 与候选 Native 全 Runtime 的边界同前，CyberGrid 增量另行验收。
