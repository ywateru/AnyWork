# Mobile 集成周边专项验证（非 Android）

日期：2026-11-13。执行者在 `/Users/water/work/2026/any-work` 的 main 只读产品源码运行本次指定检查；本报告单独提交在 `mobile-ui-review` 树。本报告记录周边发布脚本及合成浏览器集成结果，**不是协调者的最终整体验收，也不替代 Android APK、真实账号、设备或 gateway 验收**。

## 结论

指定五个 Python 测试脚本 **56/56 通过**，必要 Mobile 合成集成 E2E **30/30 通过**，所有进程退出码为 0。没有本轮失败需要交作者修复；未修改产品实现。

未运行全量约 440 项单测、Cargo/Gradle/APK 构建、真实 Docker smoke、发布或部署；未占用共享 Cargo target，未安装依赖，未使用真实账号或设备。版本递增、源码导出、发布及 Docker 行为都发生在测试的临时仓库或模拟边界内，日志中的“Published and verified”来自离线 publisher fixture。

## 输入版本及并行状态

- 初次检查 main 为 `07b7f23b30d5e04ede501410ebec82a12bf2924c`；测试启动记录及结束记录分别为 ignored `start.json`、`end.json`。
- 执行期间 main 合入 `ea7b3c1a590a079834341b99a2eec2ccf01ea899`，只涉及 `web/scripts/account-identity.check.mjs`、`web/src/mobile/NativeTransport.ts`、`web/src/mobile/transportTypes.ts`。逐文件用现有 Prettier 及仓库配置格式化前一版本文本，结果与后一提交内容完全相等，三项均为 true；证据 `format-only-check.json`。没有因纯格式化重复整套测试。
- 最初工作区检查无修改；测试启动时已出现协调方的 `docs/release-notes.md` 修改，结束时另有 `docs/plan/tasks/android-native-client.md` 修改。本次没有编辑、还原或提交这些文件，也没有把并行文档改动声称为工作区清洁。

## 指定脚本

均在 main 工作目录执行 `python3 scripts/<脚本>`，使用 ignored 临时目录及 `PYTHONDONTWRITEBYTECODE=1`。最多三个独立进程并行；源码与版本等 fixture 自行清理其临时仓库。结果汇总为 `scripts-results.json`。

| 脚本 | 通过数 | 范围与证据日志 |
| --- | ---: | --- |
| `source-archive-test.py` | 7 | tracked public files、敏感/生成物排除、mobile plugin/wrapper、固定 revision、拒绝 symlink；`logs/source-archive-test.py.log` |
| `release-version-test.py` | 4 | 临时副本版本递增与一致性、Android config/tag fallback、数值排序、完整签名 manifest；`logs/release-version-test.py.log` |
| `publish-test.py` | 28 | 临时 Git 仓库及模拟 HTTP/network Git，发布恢复/幂等/歧义/来源与产物校验；`logs/publish-test.py.log` |
| `release-ci-test.py` | 10 | 精确来源、可信 workflow/event/tag、失败关闭、重试与脱敏、工作流静态门槛；`logs/release-ci-test.py.log` |
| `container-smoke-script-test.py` | 7 | 模拟 Docker 的资源生命周期与清理、诊断脱敏、Web identity 生成/校验；`logs/container-smoke-script-test.py.log` |

这些结果不代表实际构建容器、导出最终发布源码包、运行 GitHub Actions、上传 release 或变更线上版本。

## 必要 Mobile 集成 E2E

运行前读取并核对 `e2e/mobile.config.ts`、两个 spec、Vite mobile 配置及 fixture；先执行 Playwright `--list`，确认配置只有 **2 文件 / 30 项**，不是整个 Web E2E 或全量单测。使用现有 Chrome：

```sh
PLAYWRIGHT_CHANNEL=chrome node node_modules/@playwright/test/cli.js test \
  --config artifacts/mobile-final-integration/07b7f23/playwright-mobile.config.ts
```

ignored wrapper 直接导入 main 的原配置，仅将端口/baseURL 设为 `3272`，将 Vite cache、结果和日志隔离到本任务目录。产品 fixture、测试断言和 shared App/NativeTransport 均未替换；复用现有 node_modules，没有启动旧服务二进制或编译 Cargo。

**30/30 通过，用时 30.1 秒**，证据 `logs/mobile-list.log`、`logs/mobile-browser.log`、`browser-results/`。覆盖：

- 首启、取消登录/重试、账号摘要、目录未知、key 变化与剪贴板拒绝、桥缺失。
- shared App + 真实 NativeTransport TS，公开 Tauri IPC 合成边界上的 FormData、terminal Channel、文件保存/分享、PDF/取消、有界导出、迟到 chooser/export failure 的账号 epoch 隔离。
- native back 事件/ACK、脏文件和 tab close、焦点/Escape、旧文件草稿基线与显式 rebase。
- 消息与审批的 typed unknown、pending close/reload 回执保护、可信完成、明确 not_sent、刷新不重放、精确审批身份/问答答案、子会话 receipt。
- resolved theme 的 appearance IPC、四种模式/自定义背景的危险文字 contrast；图片 viewer/editor 的四边安全区、cutout、旋转、合成 IME、旧 revision、控件命中与关闭。

这里的 native back/insets/IME、保存/分享和登录均为公开 IPC 合成响应。它们验证真实浏览器组件和 TS adapter 集成，**不证明 Android 系统栏实际图标、真实输入法、Activity/lifecycle、chooser/content URI、原生登录、Rust 网络或设备连接已运行通过**。上述门槛继续由原生/协调集成验收提供证据。

## 日志位置及交付边界

所有执行记录位于 main 的 ignored 目录：

`/Users/water/work/2026/any-work/artifacts/mobile-final-integration/07b7f23/`

包括 `start.json`、`end.json`、`scripts-results.json`、`format-only-check.json`、`logs/`、配置 wrappers 和 `browser-results/`。报告提交不包含这些二进制或临时产物；本轮没有 push 或发布行为。既有 UI 独立发现及关闭过程仍保留在 `docs/plan/reviews/mobile-ui-independent.md`，本报告不重新作该项产品审查。
