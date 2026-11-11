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

- 设计 v2：独立核验通过，见 `docs/design/desktop-refactor/review.md`。
- 实施：准备两个隔离工作树。
- 独立实现验收、合并、发行、线上检查：待完成。
