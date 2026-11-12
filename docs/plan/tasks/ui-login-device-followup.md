---
id: ui-login-device-followup
scope: dialog, callback, desktop SSO, native titlebar and device naming
status: in-progress
depends-on: [ui-refactor-v2]
---

# 登录与设备体验修订

## objective

完成用户 2026-11-12 的五项截图反馈。沿用已发布 v0.1.26 的 v2 界面，实施后独立验收并按现有流程更新。用户已明确授权上述行为调整，无需为同一修订重复确认。

## context

- `docs/design/desktop-refactor/login-device-followup.md`（本轮权威修订）
- `docs/design/desktop-refactor/{shell,desktop,web-entry}.md`
- `docs/account-unified-experience.md`、`docs/account-remote-protocol.md`
- `docs/desktop-onboarding-layout.md`、`docs/releasing.md`
- `docs/INDEX.md`

## path

| lane | 归属 | 交付 |
| --- | --- | --- |
| native | `crates/desktop/**`，Native 相关测试脚本；不改 `desktop/ui/**` | loopback 回调页面、安全资料映射、稳定设备名/目录改名 API、macOS 原生标题栏设置 |
| UI | `desktop/ui/**`、`web/src/account.css`、`web/scripts/**`、`e2e/account-unified.spec.ts`、`e2e/desktop-fixture.ts`、新增本轮 UI E2E；不改 Rust | dialog 居中、普通登录复用 SSO 参数、名称编辑与可信显示名、标题栏安全布局 |
| root/review | `docs/**`、发行说明 | 契约/协调/独立审查/合并/发布 |

作者须在实现前对齐新增 snapshot 字段/IPC 参数和 macOS chrome 标记；不得在 UI 使用临时假字段掩盖未接通的 Native API。原 `e2e/sidebar-scroll.spec.ts` 不改。保留默认远程一次、手动关闭、RAM-only grant、外部服务所有权、dirty draft 和任务安全停止门禁。

## integration

1. 官方 Logto SDK → Native account_open → 系统浏览器 → 已有 issuer cookie → Native callback → 校验/commit：去强制认证，保留新 Native grant 和 consent。
2. Native account profile / 已验证 UserInfo → account snapshot → 所有桌面账号标签：展示用户名，无 profile 时明确匿名显示，subject 不用于标题。
3. 首次安装名称生成/磁盘快照 → 工作区编辑 → Native 目录事务 → readback → 本地 UI/Web 目录；改名不变身份/服务/现有连接。
4. macOS 原生窗口配置 → 内容安全区域/拖动区 → 真交通灯；Chrome fixture 只证明布局，不替代实际窗口。
5. 合并精确提交 → CI → 不可变发布 → Web/桌面包和 source 对应。

## verification

作者提交后再交独立验收。UI 用独立端口 3341，Native 相关本机回调测试避免碰用户正在登录的 17897 端口，使用隔离 listener/测试配置。共享主树 Cargo target 仅在串行锁/无并发写冲突下复用，禁止再生成多份几十 GB 旧缓存。独立浏览器验收端口 3342/3343。覆盖 dialog 中心/滚动/手机高度、回调成功/取消/无效与内容安全、SSO URL/refresh 所有权、用户名来源、设备持久化和目录错误/保持其他数据、原生 macOS titlebar。真实 SSO 仅使用已授权隔离测试账号，不操作真实业务数据，不将合成 provider 当线上 SSO 验收。
