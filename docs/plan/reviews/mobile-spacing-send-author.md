# Mobile 会话间距与发送圆钮：作者记录

2026-11-16。实现 lane `codex/mobile-spacing-fix`，工作树 `.worktrees/mobile-spacing-fix`，基线 `ac7c422`。已依次 cherry-pick 契约 `a73ac60`、`0f40187`，本地对应 `1b071e0`、`772cf3d`；主协调已拥有这两项契约，合并时仅需本实现提交，不重复合入契约。本报告随代码/测试原子提交，精确候选 SHA 以本报告所在提交为准；作者不作独立接受结论。

## 根因与修复

以真实 `web/mobile.html` 生产构建（不是 Web `/app`、Vite dev 或设备页）和合成 NativeTransport 已连接工作区，复测用户 screenshot 对应区域。baseline 在 320/360/412 CSS px 宽均为：

| 区域                           | 修复前                                 | 修复后                                        |
| ------------------------------ | -------------------------------------- | --------------------------------------------- |
| root 字号                      | 16px                                   | 16px，不修改                                  |
| 新会话/搜索/Agent summary      | 各48px                                 | 各48px，不缩触控或字体                        |
| navigation-actions             | 113px（两行48 + gap1 + 上下padding16） | 96px，内容排布，无额外padding/gap             |
| Agent filter 外 margin         | 3px 0 8px                              | 0                                             |
| 会话标题工具行 navigation-view | 72px（48px控件 + 上下padding24）       | 48px，无额外padding                           |
| 单行会话/相邻行top差           | 64px / 66px（上下margin各1）           | 52px / 52px，margin0                          |
| 首会话距 sidebar 顶部          | 303px                                  | 250px                                         |
| send / stop                    | 32×48px                                | 48×48px，min/max宽高48、flex-shrink0、圆角50% |

共享 conversation.css 的窄屏规则把发送/停止 width/height/min-width 设为32px，而 `.mobile-client button` 把 min-height 提升到48px，实际宽高冲突导致椭圆。baseline 的 flex-shrink 已为0，因此没有把 flex 收缩写成已证实根因；新规则显式固定 flex-basis 48 保证不退化。列表问题是 Mobile64px像素最低行高、行margin，以及多层导航padding/margin叠加，不是异常均分剩余空间。共享 desktop.css 本身没有 rem 尺寸规则；独立 reviewer 的 root14px 单变量探针也未改变三项问题尺寸，本实现保持16px，不以缩字掩盖间距。

产品仅修改 `web/src/mobile/mobile.css`：移除已确认多余间距、单行会话52px，并用 Mobile 限定选择器覆盖共享按钮尺寸；composer-left 允许内部换行，使窄屏模型/附件内容不挤占圆钮。没有改 Desktop/Web共享CSS、App/controller、账号、Native、模型或发送语义。短列表留白仍在列表末端；不把会话控件高度降到48以下。

## 针对性验证

baseline 私有生产构建两项布局/会话夹具通过并采集原始 computedCSS/rect；它只说明原断言无法排除64px/32×48的旧行为，不作为修复验收。修复后同样构建 Mobile production，并运行以下7项，**7/7 PASS**：

1. 已有品牌/导航/会话列表夹具，在320light、360light、412dark断言48–56行高、标题行48、首行偏移≤256px、横排搜索、Agent图标/主题、滚动/筛选/展开/新建对话；用新契约替代旧64上界，未减少交互断言。
2. 新增稀疏单会话夹具，在320/412验证52px行、不拉伸、目录标题后紧接会话，空白留在列表尾部，根字号16px。
3. 新增 send 长模型夹具，在320/360/412分别无IME和IME280，保留真实模型长标签、合成附件与草稿，断言48square、computed min宽高48、flex-shrink0、圆角50%、中心实际命中、按钮/模型/左侧区域不重叠、不横溢、编辑和发送在安全区内。最后 trusted tap 恰好产生一个合成 `/messages` POST。
4. 同样矩阵的 running stop 夹具，真实渲染 stop 状态并 trusted tap，恰好一个合成 `/interrupt` POST。
5. 已有会话/横屏/键盘/文件/终端 mobile bounds 回归。
6. 已有640×360短横屏 IME140/180/220输入/发送可达与终端Ctrl+C回归，保留原断言，Ctrl+C合成请求三次。
7. 已有640×360 + IME220真实CDP touch滚动链回归；保留只由可信touch滑动、输入/发送均可达的门槛，不以DOM滚动或隐藏键盘替代。

320×820 + IME280 + 长模型时，发送和停止矩形均为 x251/y471/w48/h48（bottom519≤540），模型right247 < 圆钮left251，center hit=true，无横向溢出；输入top419/bottom463。截图已人工查看，列表更紧凑，圆钮无椭圆变形。测试均访问合成 fixture，未写真实 Agent、主机或业务会话。

执行：`tsc --noEmit -p web/tsconfig.json` PASS；`vite build web --config web/vite.mobile.config.ts --configLoader runner --outDir <private>/final/dist` PASS；以该dist的私有loopback静态服务，使用安装的Chrome、Pixel7触控环境、生产资源运行上述 `e2e/mobile-native.spec.ts` 精确grep7项；定向Prettier和diff-check PASS。没有执行全量测试，没有构建/安装APK或操作真实设备。

私有证据：root `artifacts/mobile-spacing-author/`，含baseline/final生产包、build/run日志、Playwright JSON、computedCSS/rect、截图与 `bundle-binding.json`。最终包绑定：

| 生产文件            | SHA256                                                             |
| ------------------- | ------------------------------------------------------------------ |
| mobile.html         | `cee7c0831ec383736a65feffd731ff379ff448b355e7e4f7592c826d3ebc4f7e` |
| mobile-ChUsfSUT.js  | `9fe3b9c8778c82f80eaae2ccf891407599b9ccf5dd5171967df3f3d445d07c69` |
| mobile-CiOZ3yhL.css | `8a1cc133c856997854499e07d08cd4ab3d46f17f9442e548d37638ad92348764` |

## 交付边界

代码提交后立即通知独立 reviewer `01a1d33b-b2f1-70f1-9fdd-4cae838013e0` 与 parent，等待精确候选审查；不自行merge/push、改版本或构建安装。复用root依赖链接，未复制或安装依赖。自有loopback服务/测试进程已结束；源码提交仅选上述CSS、相关e2e及本报告，不提交依赖链接、生产包或截图。
