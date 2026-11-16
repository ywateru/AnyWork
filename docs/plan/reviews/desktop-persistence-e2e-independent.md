# Desktop 持久化文案 E2E 独立审查

2026-11-16，独立 reviewer。基线 `0f4018782f952ce4a006546c711c02106a496ed0`，精确作者候选 `8fd1dbb4d92601affa6d62b80edc1e4856d73cc1`。复用干净 `login-restore-review` WT 后切换新分支 `codex/desktop-persistence-e2e-review`；候选 cherry-pick 为 `7346dc3`，测试前完整源码树与作者候选相同。

结论：**PASS，可合入**。仅修复与已接受契约不符的测试文案定位，没有弱化行为 gate 或修改产品。

## 变更核对

两份 spec 共四处 locator，从旧的“账号凭据和设备私钥只留在内存”更新为同时包含以下四项的完整说明：系统安全凭据存储保留登录、关闭应用后恢复、显式退出删除授权、设备连接私钥仅内存。这与 [登录持久化契约](../../login-session-persistence.md) 及当前 `desktop/ui/src/main.tsx` 一致。

`desktop-overview.spec.ts` 的四个 viewport、准备/失败重试/默认启用调用、溢出与设置检查保留；`desktop-tunnel.spec.ts` 的键盘 Enter/Space、只读公钥、连接详情与原 IPC 调用检查保留。两者仍要求控制台没有该说明（`toHaveCount(0)`），设置展开后完整说明可见（`toBeVisible`）。没有删测试、skip/only、延长 timeout、增加 retry、放宽 project 或改变 fixture/CI 配置。候选另外仅增加作者报告。

## 独立验证

- review WT 独立 Desktop production UI build：PASS，复用主工作区已有 node_modules，不安装依赖。
- 原失败对应场景：**10 passed，0 failed/skipped**，即四个 onboarding viewport 与 keyboard disclosure 场景，各在原 `desktop` / `android-web` project 执行一次。使用现有 Chrome、单 worker、`--max-failures=1`，没有重试。
- 两份 changed spec 的 Prettier 与 `git diff --check`：PASS。

命令：

```sh
PLAYWRIGHT_CHANNEL=chrome node_modules/.bin/playwright test \
  --config artifacts/desktop-persistence-e2e-review/playwright.config.ts \
  e2e/desktop-overview.spec.ts e2e/desktop-tunnel.spec.ts \
  --grep 'onboarding and console|disclosures support the keyboard' \
  --max-failures=1
```

ignored 本地配置继承原项目矩阵，仅去掉这两份 spec 不使用的 Rust webServer，并指定独立 output/reporter 路径。测试用生产静态文件和 `desktop-fixture.ts` 的合成 Native IPC；不启动 AnyWork 后端、不使用 Cargo/shared target、不访问真实账号、安装应用、设备或 Agent。该配置最初用 `import.meta` 遇到 CJS 加载错误，发生于测试发现前；只修正本地 ignored 配置为 `__dirname` 后执行上述定向测试，未修改产品或测试断言。

证据保留在本 WT ignored `artifacts/desktop-persistence-e2e-review/`：`ui-build.log`、`tests.log`、`results.json`、`format.log`、配置与各 viewport 合成截图。作者另有两份完整 spec 的 56/56 通过证据；这里不将其记为独立重复运行。此测试维护补丁不替代最终冻结源码 CI，也不新增真实登录重启验收声明。
