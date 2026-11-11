---
id: ui-refactor-v2
scope: desktop console and Web account/device/connection UI
status: in-progress
depends-on: []
---

# 统一界面 v2 实施与发布

## objective

按已完成独立设计核验的 v2 框线稿实施桌面控制台和 Web 登录、连接、设备页面，统一现有六角标志并减少重复元素。保留 Web 对话内部、授权协议和服务生命周期。完成独立验收、合并检查后，按现有不可变发行流程发布并核验正式网站。

## context

- `docs/design/desktop-refactor/{README,shell,desktop,web-entry,review}.md`
- `docs/desktop-onboarding-layout.md`（2026-11-11 默认远程一次为准）
- `docs/desktop-workspace-layout.md`
- `docs/account-unified-experience.md`
- `docs/account-remote-protocol.md`
- `docs/account-web-layout.md`
- `docs/brand.md`、`docs/releasing.md`

## path

两个互不重叠的开发分支，以提交后的候选供独立核验：

| 开发范围 | 归属路径 | 验收 |
| --- | --- | --- |
| desktop | `desktop/ui/**`，`e2e/desktop-*.ts`，`scripts/desktop-updater-test.mjs` | 原生桥接合成边界、默认远程一次/手动关闭、草稿保护、地址和布局 |
| web | `web/src/**`、`web/scripts/**`、`e2e/account-*.ts`、`e2e/local-*.ts` | OAuth/本机入口、设备目录、身份核对、连接取消、外层设备入口 |
| 协调/契约 | `docs/**`、发行说明 | 根代理维护；独立审查写入 review |

Web 不重做消息、输入框、审批与工具面板；必要外层属性可接入 `App`，不得顺带改变内部交互。Logo 使用 `web/public/icon.svg`，不可采用形似占位符。

## integration

1. 桌面引导控制器 → Native 账号/服务快照 → 本地面板 → `desktop_open`：仅已保存合法 loopback 地址可复制，打开仍由一次性交接完成。
2. 桌面 Native 默认远程消费状态 → UI 导航/远程控制：只按 grant 自动一次；远程失败不阻断本地；未知不伪造开启或零连接。
3. Logto → 回调 → AccountHome → 设备目录 → 首次/换钥确认 → 连接 → App 外壳：授权 owner、迟到结果与取消保持隔离。
4. LocalApp ticket/cookie → App 外壳：本机来源快照不冒充 Web 登录；退出只结束本机网页授权。
5. 精确合并提交 → Checks → 不可变 Release → Vercel `/app/` 和 `/build.json`：版本和源提交必须对应；保留 `/source`。

## verification

作者在各自工作树运行 typecheck/build、相关行为脚本与 UI E2E，使用不同端口/输出目录。作者必须提交后才独立审查。独立审查包含源码、实际浏览器中的 960/800px 桌面、1440/390px Web、键盘与错误/空/未知状态，并核对上述真实控制器调用路径。合成测试不代表真实账号、安全传输或硬件验收。

合并后运行 Web typecheck/unit/build、桌面 build/updater tests、format check 和相关 E2E；必要时按失败扩大检查。发布使用 `scripts/publish.py` 的既有恢复机制，不覆盖版本、tag 或产物，不改云服务方案。托管账号品牌需要单独读取当前服务支持的配置后实施，不能把原型页当成真实托管登录已交付。

## progress

托管登录品牌实施范围：实际 Logto 仅支持 third-party 的应用级体验，而当前库存仅 AnyWork SPA、Native 与协调 M2M。独立只读核验允许本轮在已授权登录重设计内，仅 PATCH 共享 `/sign-in-exp` 的 `branding` 与 `color`：正式 canonical 图标用于明暗 logo/favicon，主色 `#171717`/`#FFFFFF`，保持禁用暗色。账号方法、注册规则、授权、连接器、terms 等其余字段必须深度相等。私有保留 before/payload/readback，提交前重读并拒绝并发差异；响应未知只读对账。现有配置工具仍不改共享体验，不为品牌把应用改成 third-party。品牌与中性色配置不代表重写 Logto 托管布局。

- 设计 v2：独立核验通过，见 `docs/design/desktop-refactor/review.md`。
- 实施：Web `81a97709e37d3a1df5cd6b592caad1d65bbdb654`、Desktop `4be6ef378074487d8c2736f2f63a01eb4a36b899` 已分别独立 pass 并顺序合并。见 [Web 独立审查](../reviews/ui-v2-web-independent.md) 与 [桌面独立审查](../reviews/ui-v2-desktop-independent.md)。
- 托管品牌：一次窄范围 PATCH 已提交且独立验收 pass，见 `docs/plan/reviews/ui-v2-hosted-branding.md`。正式页 1440/390 图标加载与黑色主按钮通过；Logto 原有背景和页脚保留。
- 合并后的 Web typecheck、353 unit + 8 private-state、build，以及两端格式检查通过；桌面 build、根目录 account-entry 与 updater 脚本、96 E2E 通过。初次 updater 调用未指定本机 Chrome 而缺少 Playwright 自带浏览器，改用 `PLAYWRIGHT_CHANNEL=chrome` 后通过，不是产品失败。
- 完整 Web 574 E2E：572 pass、1 条件 skip、1 blocking（390×480 侧栏列表只剩 67px，真实触摸长列表超时）。按门禁已在 main 撤回 Web merge，并在 `codex/ui-v2-web-fix` 重应用候选后修复；不得以加大超时、跳过或削弱真实触摸断言放行。见[合并记录](../reviews/ui-v2-merged-release.md)。
- 发行、线上检查：待短高度修复验收后进行，发布预检为下一版 `0.1.26`；尚未更新应用网站。
