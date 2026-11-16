# v0.1.43 桌面远程、手机工作区与登录恢复

状态：修正与独立审查完成，已合入 main；0.1.44 / Android code46 测试候选等待构建、启动及保留数据安装。基线 main `15f5c3f`，2026-11-16。

用户报告桌面更新后远程启用错误 `REMOTE_ENABLE_GRID_CONFIG_UNAVAILABLE`，本地“已就绪 · 复用已有服务”仍无法打开；追加 Android 连接后样式严重异常，以及桌面和手机应保存登录、重启无需二次登录。后者明确替代历史仅内存授权要求，契约见[登录恢复](../../login-session-persistence.md)。

## 分工

- `codex/desktop-v43-remote`：调查协调配置请求、启动登录时序和本地服务复用；有证据后修正。随后实现桌面安全保存登录和恢复，负责对应 UI 状态。
- `codex/mobile-workspace-layout`：定位连接后 App 样式加载/作用域，修正已有手机布局，连接工作区截图回归。
- `codex/mobile-login-restore`：Android 安全存储、官方 Logto owner 恢复、轮换和退出生命周期。
- `codex/desktop-v43-review`：独立、只读核对本机安装/服务版本、归属和能力；审查桌面候选及手机布局。
- `codex/login-restore-review`：独立审查桌面/Android 安全保存与恢复，验证实际提交。
- Root：契约、调度、合并、综合检查与交付记录。

## 约束与门禁

区分协调网络失败、本地服务兼容性和登录时序，不因复用就终止服务；不猜 PID，不杀原生 Agent，不中断真实会话。公开探测不含凭据，日志仅固定错误类别，不输出原始 argv、token 或账号资料。协调入口调整须先核对全部 Native 所需路由并保留 issuer/resource/client/product 绑定；不改 DNS、代理、TLS 校验或服务 namespace。

手机沿用[现有布局](../../mobile-client-layout.md)：窄屏全屏工作区及可收起会话列表，工具行和图标保持正常尺寸，正文不逐字竖排。验收必须覆盖已连接会话/文件/终端界面，不能以设备列表正常替代。Claude Desktop 真机执行仍按用户要求后置。

每项候选提交后独立审查，阻断发现交作者修正；仅合并通过项，分别记录源码测试、浏览器截图、平台构建与真实设备未覆盖边界。不把历史发行成功当成本轮通过。

## 2026-11-16 初步调查与修正范围

只读现场确认安装应用和包内服务为43，端口3210上的 PID28102 健康接口仍报告13。该进程对应此前自定义构建，历史记录曾通过安全浏览器交接，不能因其版本号推断缺少能力或可以结束。当前是否仍支持交接、浏览器失败原因和远程配置瞬时失败仍需现场证据。公开配置两个入口当前均200不代表运行中 Native 请求也成功。

已确认独立源码缺陷：后台“已就绪”条件没有检查真实 `local_browser_session`，而 prepare/open 必须检查。统一 readiness 需要认证、Running 和显式安全交接能力；不按版本号硬编码。未经认证显示待验证；缺能力显示需要升级并保留操作说明，不开放工作区或远程。prepare 失败应保留安全且可操作的原生错误信息。合成不兼容服务验收不能冒充用户现场根因。

协调配置错误继续保留阶段码及既有有界 GET 重试；允许增加固定 allowlist 分类、HTTP状态和尝试次数用于区分超时、连接和临时服务错误。不得投影 URL、原始错误链、响应正文或凭据。当前不修改桌面协调默认入口及身份 namespace。

实际正常 UI 打开后白屏：文档引用的旧入口模块在当前资源树已不存在，返回404/HTML；当前首页引用的新入口可200加载。旧HTML来源的具体浏览器缓存/恢复机制尚未捕获，不能写成已证实的304或PWA故障。修正需确保桌面每次交接取得当前HTML（可用不含秘密的一次性导航query，ticket仍只在fragment），新版服务的启动HTML及SW不得以陈旧缓存造成新旧资源混用。哈希资源与API保持各自缓存边界；不得全量清空用户缓存、丢失草稿、循环刷新或重放旧ticket。独立验收用真实有缓存的浏览器、两套入口和已删除旧资源复现升级前后行为。

## 分项进度

- 桌面入口/能力判断/固定配置诊断候选 `68364ff` 经[独立审查](../reviews/desktop-v43-remote-independent.md)接受，合并 `a1e98ac`。私有双版本真实 Chromium 复现缓存旧入口白屏，新query取得当前入口；HTTP无ticket、无自动重放。合并后完整 Desktop lib **87 passed / 3 ignored**，没有操作实际服务或安装候选。缓存回归接入CI另行收口，现场历史协调失败仍未重现。
- 手机基础样式候选 `f92061a` 在手机生产入口已复现并修正原截图问题；独立复核要求补修短横屏IME发送与终端快捷键可达性，尚未合并。
- 两端安全保存登录与恢复实现、审查中；不宣称已交付或已完成真实安全存储/进程重启验收。

## 2026-11-16 合并与本机交付安排

用户最新要求：修正后合并代码，启动新版桌面，并以同签名 APK 保留数据安装到 ADB 设备，随后通知用户手测。先交付可运行测试候选，不将候选装包或浏览器夹具称为正式 Release/正常账号全流程验收。

- Desktop 保存登录候选 `8673771` 已由独立报告 `2a1d9e3` 接受，合并 `016ed8b`；Android Native `81cee2f` 已由 `12f3843` 接受，合并 `1a3b0e5`。包括实际 macOS Keychain 六进程及 Android Keystore 十九进程的隔离合成授权验证，没有读取用户凭据。
- Mobile 布局 `f92061a` → `15c975e` → `0f7d5a4` 与恢复 UI `6ac8b47` 均已合并；[布局独立记录](../reviews/mobile-workspace-layout-independent.md)关闭两项 P2，包含真实触摸滚动和合成发送；[恢复 UI 独立记录](../reviews/mobile-login-restore-ui-independent.md)接受启动、重试、退出和迟到结果栅栏。
- 合并后 Desktop 完整 lib 测试 **99 passed / 3 ignored / 0 failed**。静态 HTML/SW 缓存候选仍须独立接受；安装、启动及最终候选 SHA 在完成后追加。
- 本轮不因历史服务版本号停止外部宿主，不终止 Agent；桌面 GUI 正常退出后启动新版，Android 使用 `adb install -r`，不卸载、不清数据。旧版本未保存 grant，升级后需先登录一次；后续普通重启才可验证恢复。

- 静态缓存候选 `e420d1a` 由[独立审查](../reviews/workspace-static-cache-independent.md)接受，合并 `ffd30c7`：HTML/SW 不存储、在线导航绕过 HTTP 缓存，保留用户确认更新、旧离线 shell 与草稿。Rust HTTP 2/2、既有浏览器 8/8、追加 4/4 通过；编码 HTML 别名/非入口子目录条件请求为已记录 P3，不影响固定入口和正常导航。
- 合并后 Web TypeScript、**45 files / 447 tests** 与 **8 scripts** 通过；Desktop production UI build、账号恢复 UI 检查、真实 Chromium 缓存入口负对照通过。准备统一版本 **0.1.44 / Android code46**；正式签名 ARM64 candidate 与本机 Desktop 构建绑定冻结提交，不创建 tag 或公开 Release。
