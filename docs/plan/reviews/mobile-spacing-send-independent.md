# Mobile spacing/send — independent review

2026-11-16。独立工作树 `mobile-spacing-review`，基线 `ac7c422`；依次取契约 `a73ac60`、`0f40187`，再仅 cherry-pick 精确候选 `587fcb7b68060f0b69a313751ad2ccd78eeacade`，本树对应 `aa816811f3dd07357408fa954e912e48f4d5dd77`。审查者未修改产品代码。

**结论：PASS，无本范围阻断 P1/P2。** 接受本候选的紧凑列表、48px 方形圆钮及既有短横屏触摸回归，可继续合并和独立 APK 安装手测。此结论为 production MOBILE browser/source 证据，不是 ADB、Android OS 键盘或真实业务验收。

契约：[手机布局](../../mobile-client-layout.md)、[本轮任务](../tasks/mobile-spacing-send.md)。本次按最新单行会话48–56px、触控≥48px审查，不沿用旧64px最低值。

## 独立根因复现

使用真实 `mobile.html` production build，经公开合成 Tauri IPC、真实 NativeTransport 和 React App 进入已连接工作区；不使用普通 Web 入口或 dev server。320/360/412宽的基线几何一致：

| 指标 | 基线 | 精确候选 |
| --- | --- | --- |
| root字号 | 16px | 16px |
| 新会话/搜索/Agent summary | 各48px | 各48px |
| navigation-actions | 113px | 96px |
| navigation-view | 72px，含上下padding共24px | 48px |
| 单行会话高度/相邻起点差 | 64px/66px | 52px/52px |
| 首会话距sidebar顶端 | 303px | 250px |
| send/stop实际尺寸 | 32×48px | 48×48px |

列表是64px像素最低行高、行margin与多层导航padding/margin叠加，不是剩余高度异常均分。按钮宽高来自共享窄屏32px规则，而Mobile通用button min-height48px只提高高度，造成32×48椭圆；基线flex-shrink已为0，未将flex压缩误写成已证实根因。

另做私有单变量对照：只注入 `:root { font-size:14px }`，确认computed root变14px，但row仍64、工具栏仍72、send仍32×48。故这些尺寸无rem根因证据。该注入仅用于基线诊断，最终候选验证没有CSS注入。

基线负对照：相同紧凑行高与≥48px方形按钮断言均预期失败；320px长模型+IME280的发送（含附件）/停止两态也分别在width32<48处失败，失败前已确认模型与IME状态。未将基线诊断用例通过误当成修复通过。

## 修复范围检查

产品diff只修改 `web/src/mobile/mobile.css`：会话52px并清行margin；导航移除已确认额外padding/gap及filter margin；send/stop min/max宽高48px、flex-basis48且不收缩；composer-left可内部换行。全部规则以mobile-workspace限定，不改root字号、共享Desktop/Web CSS或业务控制器。新收集测试保留既有筛选、列表滚动、图标/主题、文件、终端与短横屏真实触摸断言，仅按新契约收紧行高。

没有账号、Native、模型/发送语义、缓存或发行改动。没有读凭据、写真实Agent/业务、操作ADB或用户服务。

## 独立验证结果

| 检查 | 结果 |
| --- | --- |
| 独立production MOBILE构建 | PASS，JS/CSS哈希与作者一致 |
| 独立数值/稀疏列表/长模型IME探针 | **11 passed** |
| 原短横屏实际touch闭环 | **3 passed** |
| 收集的production相关回归 | **7 passed** |
| CSS与e2e定向Prettier、git diff --check | PASS |

11项独立探针包括320/360/412列表和send尺寸、独立最小方形目标、三宽长模型+IME280的发送/停止两态（发送含附件）、单会话短列表。实际均为52px行与48×48px按钮；短列表空白保留在末尾，未拉伸行。320×820 + IME280时send/stop均x251/y471/w48/h48，底边519≤可用540，中心命中。没有真实发送；本组上传只进入合成IPC。

3项独立触摸回归沿用此前P2关闭探针：640×360、left24/right12/bottom16，分别IME180/220，先在portrait填四段草稿后旋转，断言outer初始scrollTop0；之后只用trusted CDP touch上划，不设置scrollTop、不使用scrollIntoView或注入CSS，最终编辑/发送完整可见且中心命中、草稿/IME保持；tap各产生一次合成POST。终端在IME0/180/220下仅用touch遍历后tap Ctrl+C，合成PTY收到正确三次中断。终端用例仅在每轮初始位置归零outer，遍历阶段没有程序滚动。

7项收集回归在同一独立production bundle运行：connected列表、稀疏列表、send/stop长模型矩阵、connected会话/文件/终端、原short-height全部控制与原trusted-touch。长模型矩阵含三宽、IME0/280、按钮/模型/左侧不重叠和实际tap恰好一次合成messages/interrupt。主题与会话筛选/展开交互均保留。已视觉检查360px候选列表和320px长模型+附件+IME发送页，与基线截图对比，列表紧凑且圆钮不变形。

## 产物与重现

| 产物 | SHA-256 |
| --- | --- |
| `mobile-ChUsfSUT.js` | `9fe3b9c8778c82f80eaae2ccf891407599b9ccf5dd5171967df3f3d445d07c69` |
| `mobile-CiOZ3yhL.css` | `8a1cc133c856997854499e07d08cd4ab3d46f17f9442e548d37638ad92348764` |

本审查树私有证据位于 `artifacts/mobile-spacing-independent/`，复用root依赖，不安装/复制依赖，不占shared target：

- `baseline-results/`：三宽截图与computed CSS/rect/匹配规则；`root14-control/`：根字号单变量对照。
- `baseline-negative.log`、`baseline-long-model.log`：预期失败反例。
- `candidate-build.log`、`candidate-tests.log`（11pass）、`candidate-touch.log`（3pass）、`candidate-collected.log`（7pass）、`format-check.log`。
- `candidate-results/`：三宽列表/发送、六种长模型状态及短列表截图和几何；`candidate-touch/`：实际touch证据；`candidate-collected/`：收集的生产回归附件。
- `tests/spacing.spec.ts`、`tests/gesture-regression.spec.ts`：独立探针；`candidate-binding.json`绑定精确源码、bundle、探针及截图SHA-256。

```sh
# 从本树web/，仅构建真实MOBILE
node <root>/node_modules/vite/bin/vite.js build --config vite.mobile.config.ts --configLoader runner --outDir ../artifacts/mobile-spacing-independent/candidate-dist --emptyOutDir
# 从本树，私有loopback静态服务由Playwright管理
REVIEW_DIST=candidate-dist REVIEW_ASSERT_FIXED=1 node <root>/node_modules/@playwright/test/cli.js test --config artifacts/mobile-spacing-independent/playwright.config.ts spacing.spec.ts
REVIEW_DIST=candidate-dist node <root>/node_modules/@playwright/test/cli.js test --config artifacts/mobile-spacing-independent/playwright.config.ts gesture-regression.spec.ts --grep 'trusted touch'
REVIEW_DIST=candidate-dist node <root>/node_modules/@playwright/test/cli.js test --config artifacts/mobile-spacing-independent/collected.config.ts --grep 'connected workspace|sparse workspace|nonshrinking 48px circle|short landscape'
```

审查未merge/push、未改版本或安装应用；静态服务与测试均已结束。最终结论不替代用户在正常账号上的实际字体缩放、OS键盘与操作体验手测。
