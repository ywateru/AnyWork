# Mobile 文件布局与浮动菜单作者报告

2026-11-16。基线 `af03453`，分支 `codex/mobile-file-menu`。本报告是实现与作者验证记录，独立验收交非作者完成；未构建或安装 APK、未操作真实账号、Agent 或设备。

## 根因与修复边界

基线 production `mobile.html` 在 412×820 下，工作区 chrome 结束于 y=137，inspector 却从 y=180 开始。共享 `.anywork-workbench.has-inspector .workspace-inspector` 的选择器优先级高于旧 Mobile 覆盖，继承的 absolute/inset 43px 造成顶部空白。内部 tab 仍继承 210px flex-basis 与 32px 高度，尽管外栏已是 52px；第一个 tab 左端落到 x=-80（320px 窄屏为 -171）。文件工具栏为 62px。文档内容在 DOM 中先于文件树，Mobile column 没有排序，因此预览在上、目录在底。通用 Mobile button 的 justify-content:center 又覆盖树行左对齐。

修复仅在 Mobile 作用域覆盖这些属性：inspector static/inset:auto；tab 栏 56px、内部控件 48px，首个会话 tab 宽 48px，其他 tab basis 140px；文件工具栏 56px。目录通过 order:-1 排在内容前，独立 scroll 保留；目录行左对齐、48px、层级缩进不变，分隔线改为底部水平线。内容继续占用剩余空间，不修改共享文档 DOM 或桌面样式。

WorkspaceHeader 更多菜单与设备菜单原本没有 data-floating-menu，现复用既有 useFloatingMenus。设备页挂载唯一 owner，连接后的 App 仍是工作区唯一 owner；App 仅在 Mobile 的菜单 scope 加入 tab，切页清除旧菜单。普通诊断 details 不纳入浮动菜单。未更改原 hook、Native、账号语义或会话业务。

## 生产输出与实测

私有输出：`artifacts/mobile-file-menu-author/final/dist`。测试通过本地静态服务加载实际 bundled `mobile.html`，Tauri 账户/传输使用合成 fixture，不访问生产 host。根目录依赖仅 symlink 复用。

| 条件             | inspector/tab 顶部 | tab / toolbar 高度 | tree 高度 | preview 高度 |
| ---------------- | ------------------ | ------------------ | --------- | ------------ |
| 320×820，无 IME  | 137 / 137          | 56 / 56            | 218.80    | 328.20       |
| 412×820，IME 280 | 137 / 137          | 56 / 56            | 116.39    | 174.61       |
| 640×360，IME 180 | 137 / 137          | 56 / 56            | 116       | 92           |

短横屏沿用现有可滚动工作区，各控件逐项滚到安全区内验证，不假装所有内容能同时装入 IME 上方。所有矩阵均验证目录在预览之前、树行与筛选 ≥48px、层级缩进 24px、图标距行左端 ≤4px、justify-content:flex-start、无横向页面溢出、关闭/新增/tab 关闭 ≥48px。可信 CDP touch 将树 scrollTop 从 96 滚至 440，预览矩形保持不变。已查看 320px 文件页与短横屏 IME 的生产截图。

生产 bundle 绑定（产品文件在构建后未再修改）：

- `mobile-jIxSJsAS.js`，1,027,013 bytes，SHA-256 `966d9d42d637c666ffe8c363c05c38cad42aed880d38603b2a41e66f34ed8df3`。
- `mobile-kihiYbRI.css`，271,540 bytes，SHA-256 `46df56cfd165cfc129e0c978e99ed4aa6a0cb00ff319dca798982a3a200e3403`。

## 必要验证结果

- Vite production Mobile build PASS；`tsc --noEmit -p web/tsconfig.json` PASS。
- 9 项定向 production Mobile gates PASS：7 项布局/发送/停止/短横屏/触摸 gates，加最终两项菜单生命周期 gates。未扩大到全量浏览器矩阵。
- 新文件回归覆盖长 cwd、src/nested、长文件名、筛选与实际选中文档、独立可信触摸滚动、窄屏和 IME。
- 新菜单回归覆盖内部空白、外点可信 touch、Escape/焦点、菜单互斥、动作继续执行、切 tab/返回列表/账户页清理、重开；设备诊断普通 details 保持展开。合成重命名只发生一次 native fixture 调用；工作区菜单不产生业务 POST。
- 既有会话列表紧凑布局、send/stop 48px 方形与长模型/附件/IME、连接后文件/终端边界、640×360 短横屏 composer/terminal 可达、真实触摸滚动链均 PASS。
- 定向 Prettier 与 `git diff --check` PASS。

首轮 7 PASS / 2 FAIL 的原因没有删断言掩盖：6px 菜单内部 padding 的 touchscreen 探针被 Chrome touch adjustment 实际命中邻近 action（pointerdown/click 日志证实为 button），于是正常选中并关闭。内部非动作区域改用命中已确认的精确可信 mouse pointer 验证，动作与外点仍用真实 touch。另一个测试直接 tap 被已打开会话菜单遮住的更多触发器，无法命中；反向互斥改用原生 click 调用触发 toggle，不强制穿透遮挡，正向互斥与动作仍用 touch。最终两项菜单均通过，未修改产品来迎合探针。

证据在根目录 `artifacts/mobile-file-menu-author/`：baseline/metrics.json、final/results.json（首轮与 7 项已通过结果）、final/menu-results.json / menu-final.log（最终两项 PASS）、final/file-layout-*.json、final/results/ 下截图及 trusted-touch JSON。menu-probe.log 保留了触摸实际目标诊断；不含真实用户凭据。ADB 原图仅作为用户问题参考，本次未触碰手机。官方构建安装和独立最终验收仍由协调者推进。
