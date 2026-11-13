# Mobile UI 与共享 App：独立审查

审查日期：2026-11-13。作者候选 `062130dab8df4782becaf703180eb50a28205239`；transport TS 依赖 `d8afd9e` 和 `8cb5eb6`。独立工作区 `mobile-ui-review` 先快进至 main `a690d26`，再取入上述依赖和 UI，分别对应本分支 `b9c114d`、`5535fd1`、`6e2ba27`。第二个依赖的 modify/delete 冲突仅保留作者原始 adapter harness，没有改动产品实现。

follow-up 作者提交 `eb49378ab21740ca02b668396d84e156c1d50da2`、`74698d2`、`8a1f554`，本分支分别为 `8fa4de0`、`be13446`、`dd1f7dd`。图片 portal 追加候选 `df6ec905e1cd116d490e4600c551a08d2350ab6b` 对应本分支 `a60a0bf`。审查者只取入稳定提交，没有修改产品代码。

**当前结论：本次发现的原两项 P1、Web PDF 回归、审批未知结果呈现 P2、图片浮层安全区 P2 均已独立复验关闭。`8a1f554` receipt/contrast 与 `df6ec905` portal 的源码及 browser 审查范围通过，没有遗留的已知源码阻塞项。系统栏实际图标、IME、chooser 等 APK 门槛仍待验证，不能据此宣称移动 UI 全功能/原生外观全部验收。** 本报告不验收审查者本人编写的用户名组件；该项由 Hilbert 独立验收并已合入 main。

## 已关闭 P2：审批的未知结果被呈现为一般失败并提示重试

在真实 App、RequestCard 和 NativeTransport 下，仅在公开 `mobile_transport_http_finish` 边界对 `/respond` 返回 `{code: "CONNECTION_LOST", delivery: "outcome_unknown"}`。审批区实际显示 `CONNECTION_LOST。请重试。`，全局仅显示 `CONNECTION_LOST`，允许/拒绝按钮重新启用。未向用户说明电脑可能已收到审批，也没有核对入口。证据 `approval-outcome-unknown.log`、`approval-outcome-unknown.png`。

错误返回和页面 reload/reconnect 后没有自动重发 `/respond`，所以本项没有声称存在自动重放。需要修复的是用户要求的未知结果可见、先核对再显式处理的语义；待回执时断线/reload 也不能丢失该状态。

`8a1f554` 复验关闭：真实 RequestCard 在 POST 前持久化 scope/session/method/request_id/seq 对应 ticket；typed unknown、挂起审批时 native close/reload 后，均显示“上次回应结果未知，电脑可能已经收到”，允许/拒绝禁用。刷新只查询、不会回应，显式解锁确认也不提交决定；只有再点回应按钮才发原 request_id/result。独立补验取消解锁保持禁用、确认解锁后无自动 POST、明确 not_sent 清除预派发保护、可信成功清除自己的 ticket。没有改 getter 或 React/controller，仅合成公开 IPC。

移动问答用例验证原 request_id 与 answers 结构精确回传；子会话 composer 使用同一 session receipt，不另造 controller。Web 的一般错误重试与子会话隔离另做定向回归通过。

## 已关闭 P2：图片 portal 绕过 native 安全区并覆盖系统栏底色

`ImagePreview` 将 `.image-viewer` portal 到 document.body，fixed inset:0；移动 CSS 未约束它。真实 App/NativeTransport 的图片浏览界面，在 OS/app light 时 native appearance 请求为 `{dark:false}`（黑色图标），但浮层实际 top/bottom 为 0、背景 rgba(0,0,0,.9)，header 从 y=0 到 64；`elementFromPoint(20,5)` 已落在 viewer 内。它覆盖原本浅色的系统栏安全区带，且标题/操作进入 native top inset。

这证明页面覆盖范围与 icon 请求不匹配，不冒充 Android 实际截图。证据 `image-viewer-native-insets.log/png`；已直接发送作者。最小修复应让 mobile 图片 viewer/editor 等 portal 遵守 native insets，保留可读背景带，并保留 Web 默认行为。该项没有纳入 `8a1f554`，在报告 `749a668` 时仍为 open；本次仅追加已提交的 `df6ec905` 定向复审。

`df6ec905` 复验关闭：仅 mobile.html 增加 mobile marker，mobile.css 对该 marker 下的 viewer/editor 应用 native 四边 insets 与 max(bottom, IME)，去除重复 env padding，短 viewport 内滚动、header/tools/footer 不收缩。未改共享图片组件、controller、transport 或 native，Web index 无该 marker。

- 独立工作区重跑作者新增用例 **2/2 通过**（`portal-browser.log`）：真实附件打开 body portal；浅/深色与反向自定义背景；四边 systemBars/cutout；portrait → landscape → portrait；IME 180；zoom/画笔重绘；旧 revision 不能恢复旧边界。close/download/edit/zoom/pen/done 控件均经 bounds 和 elementFromPoint 命中检查，实际执行取消编辑与关闭 viewer。
- 原独立反例转为修复断言 **1/1 通过**（`portal-independent.log`）：同一真实 App/NativeTransport 图片查看器 top/bottom 从 0 变为 24 cssPx，headerTop=24，系统带采样点不再命中 viewer；IME 300 后 bottom=300。截图 `image-viewer-native-insets-fixed.png`。
- 已视觉检查独立运行生成的浅/深色横屏+IME editor 截图，目录 `portal-results/mobile-native-mobile-image-{73d30,6a44d}--rotation-IME-and-rerenders/image-editor-landscape-ime.png`。极短视口内通过滚动到达控件，不要求所有控件同时常驻。
- 只运行上述 **3 项**；`git diff --check` 通过。未重复既有 Web/receipt/contrast 绿套件，未扩展审计、重跑原生构建或把合成 IME 当作真实输入法证据。

## 已关闭 P1：恢复手机文件草稿会静默采用最新远端 revision

位置：`web/src/components/Workspace.tsx:363-377`，关联持久草稿写入 `250-267` 和 `save()`。

草稿虽然保存了 revision，恢复时却只读 `draft.content`，随后将编辑器的 original/revision 设置为最新 GET 的远端内容和版本。若离开编辑器期间远端文件改变，旧草稿就被静默放到新 revision 上。下一次保存可以通过服务端 expected_revision 校验，覆盖别人刚写的内容，绕过已有的比较及显式重设保存基线流程。

独立组件复现使用真实 App、Workspace 和 NativeTransport，只合成公开 Tauri IPC/文件响应：

1. README 的版本为 `sha256:aaa…`，编辑成 `old mobile draft`，原生返回后确认保留手机草稿。
2. 离开时模拟远端另一个客户端把内容改成 `another user changed this file`，revision 改为 `sha256:ccc…`。
3. 重开 README，编辑器恢复旧手机草稿；未执行比较、rebase 或丢弃。
4. 点击保存，实际经过 NativeTransport 的 PUT 已携带 `expected_revision: sha256:ccc…`，内容是旧草稿。合成远端确认被覆盖。

验收要求：保存并恢复原始基线内容和 revision；与最新远端不符时进入可见冲突/比较，必须显式采用新基线或丢弃后才能覆盖。不能只保存草稿文本，也不能恢复时自动 rebase。

`eb49378` 复验：同一独立夹具重新执行上述步骤，保存按钮禁用，显示最新远端比较，实际 PUT 数量为 0。只有显式点击“使用此版本作为保存基线，保留草稿”后才能保存，发出的 expected_revision 才为最新远端 revision。原 P1 关闭。

## 已关闭 P1：发送等待回执时断线，重连后丢失未知结果保护

位置：`web/src/App.tsx:1081-1089`、`web/src/mobile/uncertainSend.ts`；关联 `NativeTransport.ts:230-233,311-316` 的 close/abort 语义。

当前仅在捕获带 `delivery: outcome_unknown` 的错误后记录保护。真实连接结束会 abort 等待中的 HTTP，NativeTransport 将错误转为 DOM AbortError；同时 MobileApp 关闭并卸载 App。请求可能已被电脑执行，但尚未记录 uncertain marker。重连后同一草稿仍在，发送按钮已启用，缺少核对提示。

独立组件复现：

1. 真实 App 通过真实 NativeTransport 发出 POST `/messages`，公开 IPC 的 `http_finish` 保持等待；body 已交给原生边界。
2. 发出当前 ConnectionRef 对应的 `mobile-transport-closed` 事件，不主动返回 typed outcome_unknown。
3. 等待回到设备页并重连同一会话。
4. 草稿 `may already be executing` 仍在；发送可用，sessionStorage 中没有 `mobile-uncertain-send`，也没有未知结果提示。

作者原用例是在显式未知错误已经返回并记录保护之后才 reload，不能覆盖上述窗口。验收要求：在实际业务 POST 前建立持久且按 scope/session 隔离的 receipt ticket；可信完成或明确 not_sent 才能解除。AbortError、卸载、reload、连接结束不能把尚未取得可信结果的请求当成未发送；迟到旧响应也不能解除新的 ticket。刷新只能查询，不能重发。

`eb49378` 复验：独立夹具分别在 POST 等待回执时发真实 closed event 和 reload，再重连同一会话。两条路径均保留草稿、持久 receipt、可见未知提示和禁用发送；刷新只查询、不新增消息 POST。原 P1 关闭。作者新增可信完成与明确 not_sent 用例也在独立工作区通过。

## 已关闭共享 Web 回归：PDF 下载控件语义改变

`DocumentPreview` 将 Web 的 `<a download>` 也换成了按钮。独立运行既有 `e2e/conversation.spec.ts:78`，desktop 和 android-web 都因找不到“下载文件”链接及 download 属性失败，其后步骤未执行。

这证明既有检查未绿，不等同于已经证明按钮下载字节错误。作者应保留 Web 原有链接语义，或同步提供等价的真实 download 事件、文件名和内容断言；不能仅删除断言。其余消息 Markdown 下载、prompt 外链等 Web 回归通过，见下方证据。

`eb49378` 恢复 Web 原有 `<a download>`，移动原生仍经 Blob 保存/分享。重新构建该候选 Web assets 后，仅重跑原失败用例，desktop 和 android-web **2/2 通过**，见 `followup-web-pdf.log`。没有为此次小修重复整套已绿 Web 用例。

## 系统栏：源码与 browser 已覆盖，APK 门槛保留

初查 native shell `1dd7467` 仅有 `enableEdgeToEdge()`，DayNight 主题，没有由 Web 主题驱动的图标 appearance 接口。已直接向 Mc 和 Boole 对齐，冻结 `plugin:mobile-system|appearance_set {request:{dark:boolean}} -> {dark:boolean}`，dark=true 表示白色图标，同时覆盖状态栏和导航栏；native 应保存并在 resume 重设。

UI `74698d2` 已增加初次同步、监听 resolved `data-theme`、串行调用与 ACK 校验、cleanup 断开 observer。独立重跑作者 OS-light → app-dark → system 用例通过。另用真实组件加载 dark 模式与自定义白色内容背景，核对 `.mobile-client` 的安全区带仍为深色、top/bottom 各为夹具的 24 cssPx，IPC 发 dark:true；切回 system 后发 false、安全区带为白色。自定义内容背景未覆盖安全区带。

Boole 提供稳定 shell 集成 `260c14a` 后，本审查仅经 git show 只读核对：Rust Appearance DTO 的 bool 和 deny_unknown_fields、forward/handler、build.rs 命令清单、生成的 allow/deny 权限、local main exact ACL 均存在；Kotlin 严格检查 bool，在 UI 线程设置两个 bars 的 `isAppearanceLight… = !dark`，保存该值并在 onResume 重新应用。未把该集成提交的 Rust/Kotlin 修改取入 UI review 分支，也没有在此编译原生包。Boole 自报 Android Rust 增量检查通过，不记为审查者独立执行。

这些只证明源码和 CSS/IPC 意图，不证明 Android window 实际图标。真机/模拟器必须核对 OS 浅色 + App 深色/自定义、切回 system、图片浮层、后台 resume、状态栏和导航栏两者可读性；APK 证据仍待原生 owner 提供。本审查不以浏览器截图关闭该门槛。

## 独立执行的检查

所有命令复用主 node_modules 的 ignored symlink；生成物放在本 review WT 的 ignored `artifacts/mobile-ui-review`。Vite 使用该目录内独立 cache/config，不复用作者服务或修改共享依赖缓存。没有运行 Cargo、Gradle、APK 构建或安装。

- TypeScript：`node node_modules/typescript/bin/tsc -p web/tsconfig.json --noEmit` 通过。
- 共享单测：sessionHistory、requests、sessionNotifications、imageAnnotations、remoteTransport、fileLinks、threadLinks，**7 文件 / 66 项通过**。
- 作者 mobile browser 夹具在本独立 WT 重跑 **9/9 通过**：真实 React App/NativeTransport，公开 `window.__TAURI__` 合成 IPC。命令基于 `PLAYWRIGHT_CHANNEL=chrome playwright test --config e2e/mobile.config.ts`，仅用 ignored config wrapper 将 cache/results 放入本任务目录。
- 独立反例 **2/2 复现**：ignored `independent.spec.ts` 从稳定夹具取出 setup，仅增加远端文件修改接口及挂起 send 的 IPC 边界。没有改 React、token getter、NativeTransport 或作者 WT。日志 `independent-browser.log` 记录两个 REPRODUCED 结果。
- 当前 Web production assets 构建通过，使用既有 `/Users/water/work/2026/any-work/target/debug/anywork` 跑隔离 fixture，明确没有声称该服务二进制由 UI 候选重建。
- Web desktop + android-web 七个文件共 **64 项：61 通过、1 既有跳过、2 失败**。范围为 approval-protocol、conversation、file-consistency、message-actions、notifications、prompt-links、subagents；两失败均为上述 PDF 下载断言。详情 `web-browser.log`。
- 追加有针对性的 Web desktop + android-web 回归 **22/22 通过**：完整认证/对话/审批/问答/文件/PTY/归档、模型保存与触摸滑块及迟到错误、队列编辑/关闭/未知记录、图片标注与触摸/取消/失败、IME composition。详情 `web-extra-browser.log`。这些仍是 Web transport 证据，未冒充 native IPC 或 APK。

follow-up 独立检查：

- `eb49378`：TypeScript 通过（`followup-typecheck.log`）；相同 7 文件 / 66 共享单测通过（`followup-unit.log`）。
- 更新后的 mobile 夹具 **18/18 通过**（`followup-browser.log`）：新增桥缺失、native PDF 保存/分享取消、迟到 export failure 跨账号抑制、dirty tab close/焦点与 Escape、恢复文件基线、pending send close/reload、可信完成和明确 not_sent。
- 独立原反例修复验证 **3/3 通过**（`followup-independent-browser.log`），与作者用例独立。
- Web production assets 重建通过（`followup-web-build.log`），原 PDF 失败用例 **2/2 通过**（`followup-web-pdf.log`）。服务仍使用既有二进制，未声称重建后端。
- `74698d2`：TypeScript 通过（`appearance-typecheck.log`）；作者新增系统栏 browser 用例 **1/1 通过**（`appearance-browser.log`），独立自定义背景安全区带用例 **1/1 通过**（`appearance-independent.log`）。
- 独立迟到回执用例 **1/1 通过**（`late-receipt-independent.log`）：等待旧消息回执时经真实列表导航返回、显式核对解锁、发送新消息；旧成功返回不能清除新 ticket 或新草稿，新消息自己的可信回执才清除 ticket。
- 审批未知结果的独立探测确认上述 P2；没有自动重放（`approval-outcome-unknown.log`）。第一次探测曾等待错误的 poll 路径计数而超时，修正夹具后以实际错误呈现与 reload/reconnect 验证，不将该超时列为产品失败。

最终 `8a1f554` 只对变化做定向复验，没有重跑已绿大套件：

- 作者新增 mobile 用例 **9/9 通过**（`receipt-browser.log`）：审批 typed unknown/native-close/reload、问答精确结果、子会话发送保护，加浅/深色与两种反向自定义背景的 4 项 contrast。
- 独立审批组件验证 **2/2 通过**（`receipt-independent.log`）：精确隔离 key、可见未知解释、禁用允许/拒绝、刷新与 reload 不重放、显式解锁取消/确认不提交、随后手动回应才提交；预派发已有 ticket，明确 not_sent 安全解除。
- TypeScript 通过（`receipt-typecheck.log`）；最终源 Web 与 Mobile Vite production assets 均构建通过（`receipt-web-build.log`、`receipt-mobile-build.log`），输出仍在本任务 ignored 目录。构建仅有既有大 chunk 提示。
- 最终 assets 的 Web desktop + android-web 审批一般错误重试与子会话生命周期隔离 **4/4 通过**（`receipt-web-browser.log`）。此前 PDF **2/2** 和其余 Web 绿套件不重复跑。
- CSS 的危险文字 token 为浅色 `#b42318`、深色 `#ff8a80`；浏览器取实际 computed text/page/surface 后，浅色对比度分别 **6.57/6.03:1**，深色 **7.85/6.71:1**，均高于普通文字 4.5:1。反向自定义内容背景不会改变这两处手机壳底色。已视觉检查深色自定义背景截图和修复后审批未知截图。

截图及日志均保存在 `/Users/water/work/2026/any-work/.worktrees/mobile-ui-review/artifacts/mobile-ui-review`，不提交二进制产物。关键截图：`approval-outcome-unknown-fixed.png`；`receipt-results/mobile-contrast-mobile-des-66abb-contrast-dark-custom-ffffff/dark-destructive-custom-background.png`；portal 初始反例 `image-viewer-native-insets.png` 与修复后 `image-viewer-native-insets-fixed.png`。报告 `42b1f60` 的审批 P2 已由 `749a668` 复验关闭；本次再追加 portal 关闭证据，保留原始发现记录。

## 全功能验收映射与证据边界

| 功能 | 已有证据 | 后续门槛 |
| --- | --- | --- |
| 首启、账号、目录、key | mobile browser 覆盖登录取消/重试、unknown 与空态、online:null、完整旧/新公钥、revision 失效、clipboard 拒绝 | 真 SDK 登录、取消 Activity 和进程重建由 account/shell APK 验收；用户名变化不由本人自验 |
| 导航、返回、insets | 原生 back event 去重/ACK，审批返回不代答，脏文件返回与 dirty tab close 确认、对话框焦点/Escape；安全区 cssPx 与旧 revision 丢弃 | 实际 IME/edge-to-edge、手势返回、系统栏图标仍需 APK |
| 会话、审批、问答、队列、模型 | App 复用同一业务控制器；mobile browser 覆盖会话、request_id/result 审批、问答精确答案及未知回应保护；Web requests 单测及 approval-protocol 浏览器通过 | 原生 IPC 队列/模型组合未因 browser 个案全部验收；APK 与真实 gateway 仍需对应 owner 验收 |
| 子 Agent、文件、图片、变更与目标 | 共享 Web 子 Agent、冲突/未知保存/迟到响应通过；mobile 有子会话 receipt、文件和中文 FormData 上传，恢复文件基线 P1 与图片 portal 安全区 P2 已关闭 | 原生图片编辑/大型变更/目标组合仍不能由 Web 结果冒充 |
| 文件、回答、会话、主题导出 | mobile 覆盖桥缺失、分块累计 ACK、保存/分享、22 MiB、PDF/cancel、迟到 chooser/export failure 跨账号无错误提示；Web 下载回归已关闭 | Android chooser/content URI/分享权限需 APK |
| Terminal 与输入 | mobile 使用真实 NativeTransport Channel，ready 后输入；共享 Web PTY/快捷键路径另有既有用例 | 真实 PTY 流控/粘贴、中文 IME、后台与旋转不可凭浏览器判定 |
| 未知结果与生命周期 | 消息 pending close/reload 的 P1 已独立关闭；回应 typed unknown/close/reload、not_sent、显式核对解锁通过；refresh 不重发 | APK/真实 gateway 生命周期仍需证据；前台核验不得自动重放写入 |

上述为源码与组件/browser 审查，不是 Android APK、真实 gateway 或真实账号验收，不能写“全功能已验收”。报告只依据已取入的稳定提交，不读取作者未提交树。原生外观门槛已与 Boole 直接对齐；portal 源码 P2 已关闭，实际系统栏像素/IME/lifecycle 与 chooser 等 APK 证据继续保留为集成验收门槛。
