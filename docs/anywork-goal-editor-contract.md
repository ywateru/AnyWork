# AnyWork 目标侧栏编辑契约

参考日期：2026-11-05。目标包身份沿用 `docs/anywork-reference-contract.md` 的 Codex `26.1027.51404`，ASAR SHA-256 为 `52e0a65f9fea51f4287bbd98c63343761f9424517bb793652bb554764bc0bcc8`。原包只读，原应用未运行、未控制、未修改。分析针对 `/private/tmp/anywork-reference` 的惰性 JS 文本；缺少的保存快捷键和工具栏成员按 ASAR offset/size 只读复制到该临时目录。原模块不随 AnyWork 发布。

## 证据与边界

本轮 REA `analyze_javascript_application` 父 Evidence：`ev_c23cf4690bfb9a7452a03430fc3742e66f6be0f8fc1559ded5d12122a5022cac`；summary Evidence：`ev_124d4d8f12b019c6f0fb618748f1302b7089ce965ce1c4f65f83598be9807752`。明确选择 `thread-goal-side-panel-content-295a62659cca.js`、`thread-goal-side-panel-state-f90ddde8d944.js`、`composer-content-96b7e1cbf204.js`，读取 548,693 bytes，3 个 JS 均解析成功；273 个相关文件未选择，语义 unknown 达 1,000 的显式上限，应用与语义覆盖均为 partial。完整本次会话证据导出到 `/private/tmp/anywork-goal-editor-rea.json`。这证明本次静态分析的来源与范围，不证明桌面运行时可达性。

下表范围为原文件 UTF-8 bytes，零起点 `[start,end)`。除上述三个 REA 选择成员外，`app-initial`、快捷键、工具栏、语言包、CSS 使用有界只读文本追踪，未声称它们全部进入本轮 REA 图。

| 成员                                           | SHA-256                                                            | 重点范围                                                                                                                           |
| ---------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| composer-content-96b7e1cbf204.js               | `3b2de4c008809246d38deb7732b9a13a250ccbb0be1a8f0687bfa86a2880329b` | 30997–31345 tab 注册；31945–33299 打开/关闭/同步；33436–42389 目标行与保留旧对话框                                                 |
| thread-goal-side-panel-content-295a62659cca.js | `131191c7abf9137654dc6eb299fb5bd1081f4342aa49cea97fe523e99496dbd3` | 1314–1606 controller；2267–3723 保存；3723–6507 还原、工具栏与正文                                                                 |
| thread-goal-side-panel-state-f90ddde8d944.js   | `cd44156a40c687f8b9c14606e5d6fb417896e5bb9a5e8cf33fae309e9c7f7e30` | 全文件 623 bytes，双容器 tab 与全局保存状态                                                                                        |
| handle-save-shortcut-8bbde09565b2.js           | `4a30e9faca900bd2bf122be667d16d34f2f0d3e32052f94712e51cd27ddc064c` | 113–299，CmdOrCtrl+S、defaultPrevented/target/repeat 边界                                                                          |
| toolbar-row-c3659df0e2ed.js                    | `1679c3e3df245cf833c008709b47a0ab058be257e097b974a15bba3e1b69f216` | 133–453，flex、gap1、px2 的工具栏行                                                                                                |
| app-initial-61c1d0e6137e.js                    | `7a8d8b711bf2eb1adbfab04818a63bf6517935d11bb4d0d4c9d6602d1e3fe6f2` | 2691968–2692711 Fen 请求；5323665–5324114 nxi 保存包装；5325454–5329793 cxi/fxi 长目标与读取；2829328–2830459 xin 受控目标附件目录 |

## 从主输入框创建目标

2026-11-05 补充：创建目标复用主消息输入框。添加菜单“目标”只切换当前服务器、当前会话的草稿模式，在输入框底部显示 Target 图标和“目标”标记；点击标记退出模式，富文本、图片、文件保持原样。此模式随会话草稿恢复，和已持久化的目标状态分别保存。它不是新的目标正文输入框，也不使用“设置目标”创建对话框。既有目标条和下面的目标详情分屏继续用于查看、修改、暂停、恢复和清除已经启用的目标。

本次追踪原惰性资源的 `cxi`（`app-initial` UTF-8 bytes 5325448–5327511）、`nxi`（5323659–5324114）、`lxi`（5327511–5327631）和 `P_t`（`app-shared-e711d01481fb.js` bytes 1912839–1913096）。提取绑定的 SHA-256 分别为 `ff1c2895a476efff6495e564e9df9093d7f48663a735ad06333ed59c4795b05b`、`e7083d1ce640962ffba7cdccaa2a93e66341332d62eee95ab9345eac0043c068`、`3dc8c5bd0434fef05ab69b427bd07ec1b192ff168af785b19c737f62f7a0cb0a`、`93b465024d9ae67ca8f9fdedc7c96027c83169377a946fc373e354c9cca1fb35`。本地证据账本为 `/private/tmp/anywork-reference/app-initial-61c1d0e6137e-binding-evidence-cxi.json`、`app-initial-61c1d0e6137e-binding-evidence-Exi-nxi-lxi.json`、`app-shared-e711d01481fb-binding-evidence-P_t.json`。提取文件名末尾数字为 JS 字符偏移，不能当作 UTF-8 byte offset。

原 `cxi` 允许没有文字但有图片或粘贴文本附件的目标草稿；本地图片复制到 `<Codex home>/attachments/<UUID>/image-N.ext`，并在 objective 追加 `Referenced image files:` 引用，超过 4000 Unicode scalar 继续使用下文的文件包装。主 composer 的静态分支在第一次输入被接收后才调用目标持久化，不应先设置目标再发送消息；`P_t` 为实际 prompt 加上 `/goal `。AnyWork 采用相同顺序：验证会话附件边界、准备持久图片引用、发送普通 `turn/start` 或已有回合 `turn/steer`，成功后再以 `status=active, origin=user` 调用 `thread/goal/set`。图片同时保留实际 `localImage` 输入，富文本编辑元数据继续用 `clientUserMessageId` 关联，历史展示恢复原输入文字而非内部 `/goal` 前缀。

目标加入排队时仅保存 `goal=true` 与原文本/附件，不立即改变当前目标；实际投递时才执行上述流程。编辑排队消息恢复原模式，撤销恢复此前草稿的模式；移除目标标记后重新排队明确保存 `goal=false`，刷新不会重新加回标记。

消息发送失败时浏览器保留草稿、附件及目标模式。若消息已接收但目标启用返回错误，接口仍返回成功和 `goal_error`，明确提示“无需重发消息”，并清空已发送草稿；队列同样记录可见警告。已被发送或接收结果不明的输入可能引用新文件，因此该路径保守保留本次附件目录，不能套用“未发送且明确拒绝的目标编辑请求”的清理策略。普通目标详情保存仍按原逻辑清理明确拒绝的新目录。

AnyWork 当前支持上传或工作目录内的图片及通用文件。通用文件在 objective 追加 `Referenced files:` 原路径引用，这是 AnyWork 扩展；原 `cxi` 分支明确复制的是图片及粘贴文本，不能据此声称通用文件分支完全等同。云端图片 URL、原生粘贴文本附件的独立上传对象不在本轮实现范围。持久图片使用目录 0700、文件 0600，限制单张 20 MiB；限制属于 AnyWork 的服务边界。

## 实际编辑入口

`hN` 的目标行正文与展开图标均调用 `N/P`。这个函数先经过 `oN`：如果目标 tab 已聚焦就关闭；否则解引用目标正文 `by/fxi`，即使失败也保留原 objective，然后通过 `aN` 注册、显示并聚焦 `GOAL` 侧栏 tab。`aN` 仅在旧草稿与保存值相同的时候刷新 tab 状态，避免重开覆盖脏草稿。

`hN` 内还保留 compact 模态框、12 行 textarea、Cancel/Save 的旧代码，但此函数内可见 `v=false` 及 `y(false)`，未见设置 `y(true)` 的活动入口。因此本次实现以明确连接的侧栏为准；“旧模态框没有活动入口”是这段静态范围内的推断，不是全应用运行证明。

侧栏使用现有 `SplitPane`，保持主对话、滚动位置和输入草稿挂载。AnyWork `GoalBanner.onEdit` 交给 App 打开/关闭目标 tab；没有提供回调时保留独立侧栏作为组件退化路径。目标侧栏不使用模态背景、焦点陷阱或底部“完成/取消”按钮。

## 编辑器、工具栏与保存

原 controller 明确采用 `defaultTextKind=prompt`，rich text/code blocks/selected text links 开启，file/skill/slash mentions 关闭，Enter 换行，Markdown 链接恢复为 text links，路径链接不恢复为 file mentions。AnyWork 复用 `PromptEditor` 的 rich schema，`enterBehavior=newline`、`restorePathLinksAsFileMentions=false`，普通 Enter 保留编辑；修改不会进入主输入草稿。

工具栏左侧时间为 `max(0,floor((now-savedAtMs)/60000))`，中文资源为“刚刚更新”或“# 分钟前更新”。右侧为图标“还原”和主按钮“保存”。还原的脏值条件是 raw draft 与 savedObjective 不等；保存条件则是非保存中、trim 后非空，且 trim 后与 savedObjective 不等。两者不能混为一个条件。AnyWork 另外以编辑器实际文本语义排除纯空白，避免持久 Markdown 的空白实体转义被误判为非空目标。保存中编辑与还原禁用；按钮与快捷键共用同一同步 in-flight 守卫，目标行清除/暂停与编辑器共享保存状态，关闭 tab 后也直到该请求结束才释放。

保存时通过 `getSubmission().composer.markdown` 重新读取编辑器持久化文本并 trim；不能改用主输入框发送用的 actual prompt `getText()`。成功后更新 draft/savedObjective/时间，保持目标 tab 打开；失败保留原草稿供重试。`CmdOrCtrl+S` 只在目标面板内消费，已取消事件、重复按键和输入法合成不触发重复保存。Ctrl/Meta+Enter 通过同一个保存函数；普通 Enter 不提交。

2026-11-05 粘贴补充：rich 字面多行粘贴为 paragraph+hard_break，目标 API 保存的 Markdown 以反斜线加 LF 表示硬换行，重开后显示为原可见 LF；最终 trim 只裁剪空白，不改写内部硬换行。测试分别断言文件/请求中的 Markdown 和编辑器中的可见正文。

原 `nxi → setThreadGoal → Fen` 明确发送 `thread/goal/set`，参数包含新 objective、`status=active`、`origin=user`。`appendTranscriptItem=false` 仅更新目标状态，不追加目标历史气泡。AnyWork 继续使用 composer `action=goal`，保留同一请求与重新启用行为；目标保存不是暂停状态的原样保留。服务已接受保存后使用返回的 goal 更新侧栏，后续模式轮询失败不会反向抹去已保存状态。

## 长目标与受控读取

原 `cxi` 按 Unicode scalar 数量判断是否超过 4000。超出则在 `<Codex home>/attachments/<UUID>/goal-objective.md` 写入完整正文，目标 objective 替换为精确包装：

```text
Read the Codex goal objective file at <absolute-path> before continuing.
```

原 `fxi/dxi/hxi` 只在包装首尾精确匹配、UUID 形状与 Codex home 下路径精确一致时解引用；其他正文仍按普通文本展示。AnyWork `goal_objective.rs` 实现同样的 4000 scalar 阈值、UUID 文件和包装，在本地服务的 Codex home 下保存；常规 `GET composer` 保留原生 objective，只有 `GET composer?goal_editor=true` 读取正文到 `goal_objective`。不存在或不可读时仍返回原目标，`goal_objective` 回退原包装，另给出 `goal_objective_error`。输入目标文字不能指定任意文件读取入口。

AnyWork 对文件增加 canonical 边界校验，拒绝附件根、UUID 目录及正文文件的符号链接；接受 Codex home 的原字符串或其 canonical 别名（兼容 macOS `/var` 与 `/private/var`）。新目录为 UUID，Unix 下目录 0700、文件 0600，create_new 不覆盖原文件。RPC 拒绝保存时只清理本次新建目标文件；已接受的历史目标文件不会被编辑、清除或回退动作删除。正文读取/写入限制为 20 MiB，与 22 MiB HTTP 正文上限保留包络空间；此限制是 AnyWork 的服务边界，不能声称来自原版 cxi。

## 验证与明确范围

2026-11-05会话子窗口重构补充：Web共享保存状态现按服务器地址与会话ID隔离。同会话目标条和编辑器在标签关闭期间仍共享请求锁；另一会话不再被该保存禁用。原文“全局保存状态”描述原版静态模块，不能据此要求Web全部会话共用一把锁。切换到未打开目标标签的会话时先显示该会话已保存视图；刷新已打开的目标标签时直接恢复。迟到响应过滤及防重保存继续保留，验证入口和当前运行结果见[会话子窗口契约](conversation-panels.md)与[验证记录](validation.md)。

后端单元测试覆盖 4000/4001 Unicode scalar 边界、目标 round trip、精确包装、任意路径/穿越字面保留、缺失文件、符号链接拒绝和失败替换清理。隔离真实 HTTP 测试使用临时 Codex home，覆盖暂停后保存恢复 active、目标超过 20000 字、editor query 解引用、普通 query 不返回正文、旧文件保留、认证与加载失败 fallback。

浏览器测试位于 `e2e/goal-editor.spec.ts`：正文进入实际分屏、保存后保持侧栏、还原、主草稿保留、富文本格式、空值禁用、快捷保存、重复和 in-flight 防重、保存失败保留、长目标重开，以及桌面/Android 截图。本轮验证结果：4 项 Rust 单元测试通过；3 项隔离真实 HTTP 测试通过；浏览器桌面 5/5 通过，Android 的 3 项主体检查通过后，针对主输入框隐藏时的读数定位修正又有 2/2 通过，10 个场景均完成。共享输入框已通过 TypeScript 检查，临时预览 Vite 构建成功。浏览器 trace 分别保存在 `/private/tmp/anywork-goal-editor-results-r2` 与 `/private/tmp/anywork-goal-editor-results-r3`；桌面/手机截图为 `artifacts/anywork-goal-editor-desktop.png`、`artifacts/anywork-goal-editor-android-web.png`。

本次没有运行原应用，因此不声称桌面目标 tab 的像素截图已逐点验证；面板外壳沿用已重建的 AnyWork 分屏。AnyWork 的保存错误详情可在编辑器内访问，同时交给应用统一提示；原包采用 toast。目标附件粘贴被原侧栏禁用；带附件创建目标使用上文主输入模式，不经过该侧栏。外部同时修改目标时的 tab 关闭和焦点分发由 App/Composer 集成负责。

目标创建专项验证：隔离 HTTP `scripts/goal-mode-test.py` 6/6 通过，原目标编辑 HTTP 3/3、现有通用 HTTP 24/24 通过；Rust workspace 57 项、Web 248 项通过，Clippy 与 TypeScript 通过。候选 `anywork-0fff7e625eefbeb8` 位于 `/private/tmp/anywork-goal-mode-candidate`，没有替换在线资源。`e2e/goal-mode.spec.ts` 在桌面与 Android Web 共 10/10 通过，覆盖共享富文本和附件、取消保留、图片单独创建、发送失败恢复、接收后启用失败不重发、刷新和会话隔离、队列编辑/撤销及刷新后取消目标属性。首轮三个测试因定位过宽失败，收窄到主 composer 与队列 summary 后全量复测通过；未把首轮计作通过。截图为 `artifacts/anywork-goal-mode-desktop.png` 与 `artifacts/anywork-goal-mode-android-web.png`，已人工查看，主输入及目标标记未横向溢出。

同候选补充回归：现有目标分屏编辑桌面/Android 共 10/10、添加菜单含计划模式和目标附件共 2/2、目标条暂停/恢复/查看/清除共 2/2 通过；与新目标模式 10 项合计 24 个浏览器场景在分批运行中通过。旧目标条场景首次仍等待已移除创建弹窗，更新为主输入创建后单独 2/2 复测通过。混合通用文件与图片时，图片单独从 1 编号，以匹配原 `cxi` 的 `imageAttachments.entries()`，不因前置通用文件跳号。
