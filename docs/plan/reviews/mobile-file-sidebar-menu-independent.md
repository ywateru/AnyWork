# Mobile 文件侧栏与菜单 — 独立审查

2026-11-16。审查树 `mobile-file-menu-review` / `codex/mobile-file-menu-review`，基线 `af03453`，仅 cherry-pick 作者精确候选 **`bc649b3ae8ace7d691b4fab54ca766d9d63dd8e6`**，本树对应 `275475cdf71b49dbac95dae9c39c918da7701868`。报告提交前两者 tracked tree diff 为空。审查者未改产品或收集的 e2e 源码。

**结论：产品 PASS，本范围无阻断 P1/P2。** 顶部43px空白、目录顺序/对齐及菜单触摸问题均在独立 production MOBILE 中复核通过，可以继续合并与独立 APK 手测。收集测试存在一项非阻断的程序点击时序观察，见下文；没有把失败后的重复通过写成首轮全绿。

契约：[任务](../tasks/mobile-file-sidebar-menu.md)、[手机布局](../../mobile-client-layout.md)。本次仅检查文件布局、顶部控件、浮动菜单与相关移动端回归。

## 证据来源与边界

协调者提供的真实 ADB 截图 `artifacts/mobile-sidebar-followup/phone-before.png`、`phone-outside-tap.png` 显示目录在预览下方、树项居中及更多菜单外点后保持展开。审查者只读查看这些既有图片，没有操作 ADB、设备、用户账号或真实会话。

以下运行证据来自本树独立构建的 **production `mobile.html`**，通过 loopback 静态服务与公开合成 Tauri IPC 进入真实 MobileApp、NativeTransport、共享 React App。没有普通 Web 入口替代、dev server、产品 CSS 注入或真实 Agent 请求。文件、重命名和 PTY 均为合成边界；本结论不替代 Android WebView、OS 键盘及 APK 覆盖安装验收。

## 同组基线与候选

320/412×820，合成系统上/下 inset 各24px。原基线的3项目录/外点负对照与2项顶部负对照均预期失败。

| 指标                      | 基线 af03453                   | 精确候选 bc649b3               |
| ------------------------- | ------------------------------ | ------------------------------ |
| nav 底部 / workbench 顶部 | y136 / y137                    | y136 / y137                    |
| inspector 顶部、定位      | y180，absolute                 | y137，static / inset:auto      |
| panel-tabs / toolbar      | 52 / 62px                      | 56 / 56px                      |
| close panel / launcher    | 28×48px                        | 48×48px                        |
| 320首个会话标签           | 按钮x=-171，被挤出             | 外框x4、宽48，按钮x5，完整可见 |
| 目录 / 预览               | 预览294..595.2，目录595.2..796 | 目录249..467.8，预览467.8..796 |
| 树行高度 / 图标距行左端   | 48px / 118.875px（320）        | 48px / 3px                     |
| 更多外点真实触摸          | 保持open                       | 关闭，页面动作继续执行         |

候选的 header→nav→panel-tabs→toolbar→tree→preview 连续排列，除既有1px边线没有异常顶部空白；320px关闭标签、关闭面板和launcher均中心命中，无页面横向溢出。已查看320px文件页及三宽长路径截图。首个标签外框48px、内部按钮因左右边框实际46×48px；本轮明确要求的关闭/launcher为48×48px，首项不出界且实际可达，因此没有把内部边框差异判为本轮阻断。

## 独立验证

| 检查                                                | 结果                                     |
| --------------------------------------------------- | ---------------------------------------- |
| 独立 production MOBILE build、TypeScript            | PASS                                     |
| 独立文件/菜单/顶部几何探针                          | **10 passed**                            |
| 320px launcher→终端→关闭标签→文件→关闭面板实际touch | **1 passed**                             |
| 原短横屏 composer/terminal trusted-touch 回归       | **3 passed**                             |
| 候选自带9项相关 production e2e                      | 首轮 **8 passed / 1 failed**，见时序观察 |
| 原失败用例定向重复                                  | **2 passed**，只用于诊断，不覆盖首轮结果 |
| 独立等待确切toggle投递的反向互斥探针                | PASS，保留双断言，无sleep                |
| 产品/e2e定向 Prettier、git diff --check             | PASS                                     |

独立文件探针覆盖320/360/412，包含dark：目录展开到两层、层级缩进、选中文档、很长无空格路径筛选及预览、48px树行、无横向溢出。真实 CDP touch 将独立目录 scroller 从0滚到111，目录与预览矩形均保持不变。候选自带文件测试另在320 portrait、412+IME280、640×360+IME180检查布局和控件逐项可达；该测试短横屏的几何检查使用scrollIntoView，不冒充实际手势证据。

原短横屏手势探针使用640×360、left24/right12/bottom16；portrait先填草稿再旋转，在IME180/220下从outer scrollTop0开始，只用trusted CDP touch遍历history/editor/outer，最终编辑器与发送完整可见、中心命中、草稿/IME保留，tap各产生恰好一次合成messages POST。终端在IME0/180/220下用trusted touch遍历后tap Ctrl+C，得到正确三次合成PTY输入。遍历阶段未设置scrollTop、scrollIntoView或注入CSS；终端各轮仅在初始位置归零outer。

菜单独立探针验证更多外点touch、内部非动作区保持open、动作选中与实际切页、Escape、正向互斥、重开、tab与页面清理；设备菜单验证外点、互斥、打开名称对话框及取消、账户页导航。候选自带设备测试还验证未标记的普通诊断details保持展开、合成重命名恰好一次。内部6px空白使用预先确认elementFromPoint命中popup的可信mouse pointer；外点与动作保持真实touch，没有强制穿透其他菜单遮挡。

## 非阻断测试时序观察

收集的 `e2e/mobile-native.spec.ts:1115` 用例反向互斥使用 `HTMLElement.click()`：tap会话菜单后只等待More关闭，尚未等待会话菜单原生open toggle送达，立即程序打开More。首轮失败在1118：会话菜单仍open。后续原样两次重复均通过。

源码行为解释该竞态：pointerdown outside可同步关闭More，使前一断言立即通过；随后会话菜单queued open toggle若晚于程序click，将新开的More关闭；More自己的toggle因已经不open而返回。真实触摸路径先处理outside，因此不依赖这条程序调用时序。独立私有探针在tap会话菜单前挂载监听、等待其确切open toggle后再程序click，并同时断言“会话菜单关闭、More打开”，通过且保留事件日志；没有sleep或产品改动。真实外点、动作与正向互斥均通过，故本轮不判为产品P1/P2。建议作者另以test-only提交等待该事件，消除收集测试偶发失败；这是测试稳定性观察，不是声称原测试首轮PASS。

另有独立私有初轮 `.git-view` / `/git` 误选：实际目标是“变更面板”和`/review?`，页面已经正确切换。修正私有定位后完整10项通过；初轮日志保留。顶部探针也区分首标签外框与关键关闭/launcher的实际按钮，不改变产品来迎合断言。

## 源码核查与复现

Mobile高特异性选择器覆盖共享inspector窄屏absolute规则；tab尺寸与toolbar只作用于mobile-workspace。树通过Mobile order:-1调整视觉顺序，保留共享DOM、Desktop和文件控制器。Mobile More/device仅补浮动菜单标记；设备页独立owner随页面挂载/卸载，连接后仍由App唯一owner处理，未双挂全局监听。App仅在Mobile菜单scope加入tab，普通Web scope不变。原hook未改动，不对外点preventDefault，也不折叠未标记普通details。

独立产物与作者报告哈希一致：

| 文件                | SHA-256                                                          |
| ------------------- | ---------------------------------------------------------------- |
| mobile-jIxSJsAS.js  | 966d9d42d637c666ffe8c363c05c38cad42aed880d38603b2a41e66f34ed8df3 |
| mobile-kihiYbRI.css | 46df56cfd165cfc129e0c978e99ed4aa6a0cb00ff319dca798982a3a200e3403 |

私有证据位于审查树 `artifacts/mobile-file-menu-independent/`，没有写共享dist或target：baseline-negative、baseline-top/negative保留原反例；candidate-final保留10项截图/几何/可信pointer与scroll；candidate-touch保留原IME手势；candidate-event-actions保留顶部实际动作；candidate-collected保留原8/1失败与trace；menu-race-repro保留两次定向结果；candidate-event-order保留等待事件的独立闭环。`candidate-binding.json`绑定源码、bundle、私有探针和证据哈希。

```sh
# 从本树web/构建，只复用root node_modules
node <root>/node_modules/vite/bin/vite.js build --config vite.mobile.config.ts --configLoader runner --outDir ../artifacts/mobile-file-menu-independent/candidate-dist --emptyOutDir
# 从本树，静态服务由私有Playwright config管理；各组顺序运行
REVIEW_DIST=candidate-dist REVIEW_ASSERT_FIXED=1 node <root>/node_modules/@playwright/test/cli.js test --config artifacts/mobile-file-menu-independent/playwright.config.ts files-menu.spec.ts
REVIEW_DIST=candidate-dist node <root>/node_modules/@playwright/test/cli.js test --config artifacts/mobile-file-menu-independent/playwright.config.ts gesture-regression.spec.ts --grep 'trusted touch'
REVIEW_DIST=candidate-dist node <root>/node_modules/@playwright/test/cli.js test --config artifacts/mobile-file-menu-independent/playwright.config.ts menu-event-order.spec.ts
REVIEW_DIST=candidate-dist node <root>/node_modules/@playwright/test/cli.js test --config artifacts/mobile-file-menu-independent/collected.config.ts --grep 'connected workspace|nonshrinking 48px circle|mobile files|mobile More|device menus|short landscape'
```

未merge/push、未修改版本、未构建安装APK；未读取凭据或连接真实业务。最终提交仅新增本独立报告；静态服务及测试进程已结束。
