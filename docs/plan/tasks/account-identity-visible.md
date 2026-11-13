---
id: account-identity-visible
scope: Web current-account display and verified profile loading
status: independently-accepted
depends-on: []
---

## objective

修复用户截图中的设备页只显示“当前账号”，使侧栏、账号菜单及连接后的工作区显示当前已验证账号的可读身份。不得从设备名、目录 customData 或未验证的缓存猜测用户名。

## context

- `docs/design/desktop-refactor/login-device-followup.md` 的账号显示约定
- `docs/account-unified-experience.md`、`docs/account-remote-protocol.md`
- 用户 2026-11-13 截图：侧栏与菜单均缺失用户名

## path

`web/src/AccountApp.tsx`、`web/src/accountAuth.ts`、必要的新账号展示辅助模块及对应 Web 单测/定向浏览器用例。不得修改 Android、Rust、Cargo 或发布版本文件。

## contract

- 账号授权请求应包含实际所需的 OIDC profile/email scopes，使用官方 SDK 的 claims/UserInfo 接口核对真实字段结构。
- 展示选择顺序：非空可读 name、username/preferred_username、email。仅使用当前已验证 subject 对应资料，不能暴露 sub/ID 冒充用户名。
- 当前已登录用户缺少 ID token 中的展示字段时，应在既有授权允许下读取 UserInfo；不能要求所有既有用户退出重登才能修复。资料缺失/网络失败有准确的身份不可用状态及明确可恢复方式，不自动发起新的登录授权。
- profile 读取得到不同 subject、账号切换、登出、卸载或过期异步结果时立即丢弃，不得让旧账号名称留在下一账号界面。名称仅为显示，subject 仍是权限隔离边界。
- 侧栏可截断长名称，账号菜单显示完整且可访问的名称/邮箱；保留窄屏、键盘与双语可读性。

## verification

覆盖 username-only、name、email、空白字段、UserInfo 回填、subject 不符、延迟请求与登出/账号切换、网络失败及长名称。通过类型检查、相关单测和使用合成身份的实际组件浏览器核验，不使用真实账号截图作公开测试资产。实现提交后由非作者独立审查。

## Acceptance

作者提交 `5462fe4` 与跨标签 owner 修正 `e501d22` 已通过[独立复审](../reviews/account-identity-visible-independent.md)并合入主分支。84 项定向测试、真实 SDK 多标签合成授权实验、中英文 1440/390px 组件浏览器检查通过。最初 P1 与关闭证据保留，不用 mock getter 替代真实 SDK 缓存验证。其他标签 grant rotation 会保守关闭当前 workspace 并重建 owner，不承诺无缝跨标签续连；真实账号登录、GitHub 发布和最终合并全量检查另记。
