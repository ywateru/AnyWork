# Mobile connected workspace layout — independent review

2026-11-16。独立 WT `codex/mobile-layout-review`，基线 `7353492`；只 cherry-pick 作者候选 `f92061a4943517b1153bec4b82b88820ab98147e`，本分支对应 `2be4c66de5c1c904a9431c69c787a2cc833b7b1c`。审查者未修改产品代码。契约为 [mobile-client-layout](../../mobile-client-layout.md) 与 [本轮任务](../tasks/desktop-mobile-session-recovery.md)。

**当前结论（精确 followup `0f7d5a4`）：PASS，原两项 P2 均已关闭，接受本轮 MOBILE production browser/source 布局 gate。** 共享样式缺失、短横屏发送区及终端均已独立复核；发送区额外要求真实触摸遍历和 tap，而不是只靠程序滚入。下面保留 `f92061a` / `15c975e` 的历史发现、负对照与修复验证。未进行 APK 或真实键盘验证；saved-login restore UI 不在此结论内。

## 已确认的修复与范围

Mobile 的真实入口 `mobile.html` → `mobile/main.tsx` → `MobileApp` → `App` 此前漏载 `desktop.css`。该文件尽管名为 desktop，实际包含共享导航、会话行、Agent 图片尺寸及主题选择。使用公开 Tauri IPC 合成 signed-in account / connection，保留真实 NativeTransport 与 React 组件，在原基线 production MOBILE build 重现新会话竖排、搜索图标和输入堆叠、Codex 两套图片同时以原始尺寸显示。没有用普通 Web 入口代替。

候选只增加此共享导入并在既有 Mobile scope 修正对齐、真实 `.session-row` 和触控尺寸。未改共享 App/controller、desktop.css、账号/transport/native 或普通 Web 入口；没有引入新的全局 Mobile 覆盖。独立 production build 的 CSS/JS 与作者报告 SHA-256 完全相同：

| Asset | SHA-256 |
| --- | --- |
| `mobile-DJgsUBCs.css` | `da26c24bc67631305be0d7ae173f917e9138fb95e8b9ee63f1da0e4567f9339a` |
| `mobile-CKzmDhlQ.js` | `b59177689376947854a47a1aa2e1ba52b5e12e2ac0d08b65390a04108f5e5921` |

320/360/412/480 portrait 下新会话按钮宽分别为 288/328/380/448px，会话行 64px，Agent 容器 18×18px；844×390 landscape 加 left32/right16/top0/bottom16 后导航与工具界面仍在可用区。列表、长标题省略、长历史、草稿保持、文件阅读/选项、终端状态及快捷键、列表返回均经实际控件操作。截图已视觉检查。

## P2-1：短横屏 IME 下发送控件完全被裁剪

定位：`web/src/mobile/mobile.css` 的 `.mobile-workspace .main`、`.mobile-workspace-chrome`、composer 高度分配；关联共享 `.anywork-workbench .composer-area { flex-shrink: 0 }`。不是账号或 Native inset 值错误。

独立精确复现：

1. 构建候选 MOBILE production bundle，公开 Native IPC 夹具连接会话。
2. viewport 640×360；native cssPx systemBars 为 top0/left24/right12/bottom16。
3. 在真实消息编辑器输入草稿，不发送；发 `mobile-system-insets` 新 revision，IME.bottom=180、imeVisible=true。
4. shell 可用底边 y=180；chrome 高 113，main 仅 67px，chat-scroll 变成 0px。
5. composer 仍为 y=123..242，发送按钮为 y=185..233，整个按钮落在 shell 可用区之外。其中心 `elementFromPoint` 命中 `.mobile-client` 背景，而不是按钮或后代。

IME140 时按钮下缘已超可用底边 13px；IME180/220 时中心均不可点。初次私有矩阵在此失败后，独立定向用例等待布局稳定并分别记录 0/140/180/220，确认不是瞬时测量。需 Mobile scope 内保证短高度+IME 的输入及发送可见且可操作，可通过合理压缩或可滚动区域实现；不能只以 `toBeVisible()` 通过，也不能删除 bounds/hit-test 断言。

## P2-2：短横屏终端的第二排快捷键与 Ctrl+C 不可达

定位：`web/src/mobile/mobile.css` 的 terminal 短高度适配；关联共享 terminal footer 的不可收缩尺寸及父层 overflow。

同一 640×360 和四边 inset，**IME 未显示**，真实会话切换到终端。默认快捷键开启：

- terminal panel：y=208..344，高 136px，实际内容 scrollHeight=239。
- footer：y=277..447，高 170px。
- 第二排快捷键：y=338..386，中心命中均失败。
- Ctrl+C：y=392..440，完全超出可用底边344，中心命中失败。

工具栏仍显示“已连接”、terminal-view 仍满足可见，所以原作者状态/可见性断言不能检测本项。需让键区在短高度下可实际滚达/操作，保留正常屏幕触控目标；不能仅以隐藏控制或将状态可见作为验收。

## 独立执行结果

所有 browser 用例访问私有 production MOBILE dist。原生边界只合成账号/业务回复及 inset 事件；业务请求经真实 NativeTransport 分块 API，外网请求被 route 拒绝。无真实账号、Gateway、Agent 写入、生产进程或 credentials 操作。

| 检查 | 结果 |
| --- | --- |
| `tsc --noEmit` | PASS |
| 独立 MOBILE production build | PASS；bundle hash 与作者一致 |
| 作者两项新增 connected-workspace + 首启/设备两项 + contrast 四项，全部在 production bundle 执行 | 8 passed |
| 独立长标题/长历史/草稿/文件/终端矩阵：320×740 light、360×800 dark、412×915 light、480×900 dark、844×390 light、640×360 dark；四边 inset、portrait IME280 / landscape IME140 | 5 passed / 1 failed；640×360 在 P2-1 失败，其余完成所有界面与草稿返回断言 |
| 定向 640×360 IME0/140/180/220，发送中心命中 | 确认 P2-1；IME180 断言预期失败 |
| 定向 640×360 无 IME，终端全部快捷键中心命中 | 确认 P2-2；断言预期失败 |
| 单变量负对照：精确候选 private Vite transform 仅去除 desktop.css import，保留全部 Mobile CSS 修改 | 同一列表断言失败：新会话宽44px，期望>180；恢复原候选后通过 |
| `git diff --check` | PASS |

私有验证脚本最初使用 Escape 关闭 create dialog，但该界面实际提供“关闭”按钮；已改用真实关闭按钮后重跑，没有将这个夹具步骤失误报为产品问题。上述矩阵与诊断来自修正后的执行。

## 复核方式与证据

私有证据均在本 WT 的 `artifacts/mobile-layout-independent/`，没有写入 root dist、安装依赖、运行 Rust/Android build 或使用共享 target。复用 root node_modules 只读。configLoader runner 避免在共享 node_modules 写 Vite config 临时文件。

```sh
# 从本 WT web/，仅构建 MOBILE
node <root>/node_modules/vite/bin/vite.js build --config vite.mobile.config.ts --configLoader runner --outDir ../artifacts/mobile-layout-independent/candidate-dist --emptyOutDir
# 从本 WT；配置启动独立 127.0.0.1:3259 静态 server，结果也在本 WT
REVIEW_DIST=candidate-dist node <root>/node_modules/@playwright/test/cli.js test --config artifacts/mobile-layout-independent/author-built.config.ts --grep 'connected workspace|first run,|directory unknown|mobile destructive contrast'
REVIEW_DIST=candidate-dist node <root>/node_modules/@playwright/test/cli.js test --config artifacts/mobile-layout-independent/playwright.config.ts layout.spec.ts
REVIEW_DIST=candidate-dist node <root>/node_modules/@playwright/test/cli.js test --config artifacts/mobile-layout-independent/playwright.config.ts keyboard-diagnostic.spec.ts
```

- `bundle-binding.json`、`evidence-index.json`：精确 bundle 和所选截图的 SHA-256。
- `candidate-build.log`、`author-built-tests.log`、`candidate-tests-2.log`：独立构建、8项production回归和矩阵日志。
- `candidate-results-2/layout-portrait320-light/01-connected-list.png`：修复后列表；同目录有历史、IME、文件、终端及 metrics。
- `candidate-results-2/layout-landscape844-light/`：可用横屏各界面和 metrics。
- `keyboard-diagnostic/keyboard-diagnostic-small--8b743-e-keyboard-exact-diagnostic/keyboard-180.png`、`keyboard-metrics.json`：P2-1 的裁剪及命中证据。
- `terminal-diagnostic/keyboard-diagnostic-small-landscape-terminal-bounds/terminal-small-landscape.png`、`terminal-metrics.json`：P2-2。
- `vite.negative.config.mts`、`negative-control.log`、`negative-control/layout-portrait360-dark/01-connected-list.png`：只移除 import 的负对照。transform 仅作用私有 build 内存，没有改产品源码。
- `tests/layout.spec.ts`、`tests/keyboard-diagnostic.spec.ts`：独立反例，沿用真实公开 IPC fixture，扩充合成数据量及 bounds/center-hit 检查。

这里的 IME、安全区与 PTY Channel 均为浏览器夹具证据，不能推导真实 Android WebView/OS 键盘或原生连接已验收。没有用发行历史或普通 Web mobile 模拟替代本次 MOBILE bundle 验证。


## 15c975e 独立复核：终端关闭，发送区需补滚动链路

精确作者提交 `15c975e4e2ba127f0c18592ce9ae43453b16ceb9` 只 cherry-pick 到上述上下文，本分支为 `ec5104f55fd6d2ffd8eede413c78948cf1f0d93b`。没有取后续 restore UI，更未合 root/main。重新构建真实 MOBILE production entry，产物与作者相同：

| Asset | SHA-256 |
| --- | --- |
| `mobile-BP_3ZqGl.css` | `46ce5bc067dc418a869722c593a7014d81fac4fd31986583414f7557bccb7e45` |
| `mobile-Cmx7-Z1-.js` | `0662e86629241ca44bf336244e22d274ec166ebbcb5698b4d37b298c84d6bab1` |

独立结果：

- 原 P2 composer，640×360 / left24 / right12 / bottom16，IME140/180/220：滚动后 editor/send 完整 bounds 和中心命中通过；editor 高48px，四段内容保留并内滚。恢复360×800后 min-height 回0、shell overflow hidden，草稿保持。
- 原 P2 terminal：IME0/180/220，全部15个控制逐一滚动后 bounds / center-hit / 高度≥48通过，三次 Ctrl+C 对应合成 PTY `\u0003`。
- 独立320/360/412 portrait、IME280正例通过。上述共5项通过。
- 作者 production connected-workspace 两项、short-landscape 一项、native Channel/settings 一项：4 passed。
- **额外 actual trusted-touch 终端复核通过**：保持精确未注入样式的 production bundle，IME0/180/220，每轮仅设 outer 初始 scrollTop=0，后续只用真实 CDP touchStart/move/end 上划，Ctrl+C 完整位于可用区、中心命中并实际 tap；合成 PTY 收到三次 `\u0003`。P2-2 关闭。

P2-1 尚不能由 `scrollIntoView` 通过直接关闭。长历史、四段草稿、IME220 时，从 outer 顶部以 x330/y105→12 连续真实触摸上划：首次 outer 从0到78；之后手势命中 `.chat-scroll`，其 `overscroll-behavior:contain` 阻止链到 outer，editor/send 仍低于可用底边140。不是缺少实际 touch 事件：证据包含 trusted touchmove、pointercancel、scroll。右边缘 x625 的追加探测同样未通过。

私有诊断只注入媒体查询样式，未改产品，不作为候选接受：

| 单变量链路对照 | outer scrollTop（max293） | 发送可达 |
| --- | --- | --- |
| 精确15c，无注入 | 78 | 否 |
| 仅 `.chat-scroll { overscroll-behavior-y:auto }` | 234 | 否，send底178 > 可用140；随后手势进入 `.prompt-editor` 的第二层contain |
| 再加 `.prompt-editor { overscroll-behavior-y:auto }` | 293 | 是，editor/send完整bounds+中心命中；四段草稿、IME保持 |

后二者均为 max-height480 且 mobile-session-mode 内局部覆盖；每轮16次相同手势，无 scrollIntoView/手动推进 scrollTop。双层对照 PASS 的截图已视觉检查。shared 根因对应 `web/src/components/conversation/conversation.css` 的 chat-scroll 与 composer prompt-editor 两处 contain，作者已收到具体证据，拟出独立 layout followup，不混 restore UI。

证据根目录仍为 `artifacts/mobile-layout-independent/`：`followup-build.log`、`followup-tests.log`（5pass/1真实touch失败）、`followup-author-tests.log`（4pass）、`followup-terminal-touch.log`（1pass）、`followup-touch-chain-auto-16.log`、`followup-touch-both-auto.log`（1pass）、`followup-touch-right-edge.log`。各对应结果目录含截图、touch-evidence.json、失败trace；`tests/followup.spec.ts` 为独立探测。所有静态服务由 Playwright 管理并退出；仍没有真实账号、Agent 写入或 Android/生产进程操作。


## 0f7d5a4 最终增量复核：两项 P2 均关闭

按协调者指定，只 cherry-pick `0f7d5a43b21d2ac2695ec86c929cf2f1e1d9c57f` 的布局 patch 到已审上下文，本分支对应 `31b506f`，没有取其父提交中的 restore DTO 或后续 MobileApp。作者先发的 `6fc9311` 与指定 `0f7d5a4` 的三个修改文件完全相同；本分支替换前后完整 tree 同为 `6aba458770b6be32c12ab2b7deba755870dbb644`。因此独立构建的私有 production dist 绑定精确相同源码树，未重复构建无变化内容。

CSS diff 仅在现有 max-height480 / mobile-session-mode 内，将 history 与 composer editor 两条内层 vertical overscroll 设为auto；outer 仍contain，内部滚动保留，portrait及共享Desktop样式不变。无restore/cache/native代码混入。

| Asset | SHA-256 |
| --- | --- |
| `mobile-BdM7bMIa.css` | `d872ce01a599ab5fe58b04ac8466a860d82066cd2b2157a9d848fe3d65b01765` |
| `mobile-DxwBqYX7.js` | `df2c91cf2c6d2d7dbfb9dadb70a47d9822c6478c82c0bef55a5fcc8895ff6b80` |

独立私有production构建成功，hash与作者一致；**没有 addStyleTag 或额外CSS注入**。

| 复核 | 结果 |
| --- | --- |
| 原composer IME140/180/220，原terminal全部15控制 IME0/180/220，portrait320/360/412和旋转后草稿恢复，另含真实touch | 7 passed |
| 追加实际手势发送，分别IME180和220 | 2 passed；详见下面 |
| 追加实际手势终端，IME0/180/220并实际tap Ctrl+C | 1 passed；三次合成PTY输入正确 |
| production已收集回归：connected两项、旧short controls、new trusted-touch、native terminal/settings | 5 passed |
| `git diff --check` | PASS |

发送实际手势用例从360×800中填四段草稿，再旋转640×360并发布当前native inset revision（left24/right12/bottom16）。断言outer初始scrollTop为0；之后最多16次trusted CDP touchStart/move/end，x330/y105→12。**遍历不赋值scrollTop、不调用scrollIntoView、不使用wheel或DOM-dispatched touch**。IME180时outer到253=max(433−180)；IME220时到293=max(433−140)。两轮editor/send完整位于可用区且中心命中、四段草稿保留、IME标记仍true。随后真实 `send.tap()` 各使合成IPC观察到恰好一次POST `/messages`；不接触真实Agent。截图已视觉检查。

终端实际手势用例每轮只归零outer以建立原始反例初态，遍历阶段仅touch，分别达到89/253/293的scrollTop，完整命中Ctrl+C并tap；NativeTransport公开PTY IPC收到恰好三次 `\u0003`。配合前述全部15控制bounds检查，P2-2维持关闭。前述精确15c负对照与单变量链路诊断保留，P2-1在本候选实际触摸通过后关闭。

最终私有证据：`touch-fixed-build.log`、`touch-fixed-independent.log`（7pass）、`touch-fixed-exact-gestures.log`（3pass）、`touch-fixed-production-regressions.log`（5pass）。`touch-fixed-exact-gestures/` 含两个IME发送的 `touch-evidence.json` / `touch-final.png` 及终端三组JSON/截图；`touch-fixed-binding.json` 绑定源码树、bundle和这些证据的SHA-256。`tests/followup.spec.ts` 保留独立手势、边界及合成调用检查。没有安装/复制依赖或使用共享target；root/main未修改。此PASS只关闭布局浏览器与源码门槛，不推导真实Android OS键盘、安全存储或saved-login UI已通过。
