# 网页账号身份展示：独立审查

审查对象：作者提交 `5462fe4ac3f5227cb8f09f57581079d4060e362e`，已 cherry-pick 至独立 review 分支为 `c3a78362a7e666111cc5b6c5881aebdd35a2198a`。设计基线 `b7f13f1`；本次只审作者十二个 Web 文件，不实现产品、不操作真实账号或会话。

**结论：需要修复，暂不合入。存在一项已独立复现的 P1 账号隔离问题。** 类型检查、75 项测试和合成组件浏览器核验均通过，不能覆盖掉下述真实 SDK 缓存反例。已将发现、复现和最小修复建议直接发送作者 Mendel。

## P1：跨标签账号切换继续复用旧 SDK 的 accessTokenMap

位置：`web/src/AccountApp.tsx:667-689`，尤其 `setSubjectRevision`；关联 `AccountProvider` 的 client 实例与 `web/src/accountAuth.ts / accountToken`。

这次改动把 storage change 后原先的整页重载改为清理显示状态并重读 subject，但 `AccountProvider` 没有被换新，`AccountLogtoClient` 仍是旧实例。实际安装的 `@logto/client` 在首次 token 请求时仅加载一次 `accessTokenMap`；`getIdTokenClaims()` 则每次从 adapter storage 读取当前 ID token。两者因此可能属于不同账号。

触发流程：

1. 标签页 A 以合成账号 A 获取过 opaque 或 resource token，SDK 已将 A 的 token 载入内存 map。
2. 另一个标签页完成账号 B 登录，更新同命名空间的 ID token/access-token storage。
3. 当前 storage listener 清空页面并执行 subjectRevision 局部刷新；新 claims/菜单身份读取为 B。
4. 新目录请求通过 `withAccountSubject` 的前后检查，因为两次 claims 都是 B；但 SDK 从旧 map 返回尚未过期的 A token。Account API 可能按 A 返回目录，而 UI 显示 B。resource token 同样存在旧缓存路径。

独立复现使用当前产品 `AccountLogtoClient`、真实安装 SDK、合成 adapter storage 和合法形状的合成持久 claims；未将它们当成真实 JWT 验证，未进行任何网络请求。先调用 token getter 载入 A，随后将 ID token 与 access-token storage 同时改为 B，再通过真实 `withAccountSubject` 调 token getter，结果为：

```json
{
  "installedSDK": true,
  "storageSubjectChanged": true,
  "subjectFencePassed": true,
  "returnedPreviousAccountCachedToken": true,
  "expectedNewAccountToken": false,
  "networkRequests": 0
}
```

源码依据为实际安装的 `@logto/client/lib/client.js`：`getIdTokenClaims` 直接读取 storage；`ensureAccessTokenMapLoaded` 只执行一次；`#getAccessToken` 先返回内存中未过期的 token。测试环境精确版本为 `@logto/browser 3.1.2`、`@logto/client 3.2.2`。

最小修复方向：账号/grant 变化时应终止旧 owner 并使用新 SDK 实例，或恢复安全的整页重载。必须同步栅栏旧 token 请求，避免已开始的 A rotation 在 storage 已属于 B 时把旧材料写回。不能仅清 `subjectRef/displayIdentity`，也不能无协调地调用 `clearAccessToken()` 删除 B 的新 storage。若要避免每次正常 token storage 更新均重载，需要按真实 owner/grant 变化处理，且保留该隔离保证。

所需回归：真实 SDK 先加载 A 的 opaque/resource cache，再经实际 storage 事件切换至 B，验证 token 取得与目录/UI 都属于 B；另覆盖 A rotation 正在等待时换 B、跨标签登出以及 A→B→A 的迟到响应。组件级可合成 HTTP/OIDC，但不应替换被验证的 SDK token cache。

## 已通过的独立检查与其边界

- `tsc --noEmit -p web/tsconfig.json`：exit 0，复用主工作区已有依赖，未安装依赖。
- `vitest run --root web src/accountIdentity.test.ts src/accountAuth.test.ts src/accountAuth.sdk.test.ts src/accountGrid.integration.test.ts`：四文件 **75/75** 通过。
- `PLAYWRIGHT_CHANNEL=chrome node web/scripts/account-identity.check.mjs`：exit 0；实际 AccountApp/AccountHome 与 connected workspace 菜单，中英文、1440/390px、长 Unicode 名称/邮箱、键盘打开、username/preferred_username/email fallback、UserInfo 缺失/失败/重试、subject mismatch、迟到换号/登出结果均通过。
- 独立查看了 390px 中文设备菜单及英文 workspace 菜单截图，长名称和邮箱可换行，无页面横向溢出。此项为桌面 Chrome 组件验证，不是 Android APK 实测。
- `git diff --check` 通过。作者代码之外没有产品修改。

现有浏览器夹具在 `web/scripts/account-identity.check.mjs:50-65` 替换 `getIdTokenClaims`、`getAccountAccessToken` 和 `getCyberGridAccessToken`，故其 storage/账号切换结果不能证明真实 SDK access-token cache 已重建。实际 SDK 单测验证了默认 profile scope、显式 email scope、PKCE 及 fetchUserInfo 调用形状，但没有覆盖本条跨标签缓存反例。

其余本次审查结论：

- 默认 profile scope 的说法已按真实 SDK 核对；明确请求 profile/email/custom_data/connect 合理，未将“原配置没写 profile”误作唯一根因。
- 名称顺序为 name、username/preferred_username、email；不以 subject、设备名或 customData 冒充身份。完整名称与邮箱保留到菜单，侧栏只做显示截断。
- UserInfo 使用官方 API，前后检查 subject、账号 epoch 与 AbortSignal；其 token 获取经捕获的 SDK 字段进入同一串行 owner，避免队列递归。UserInfo HTTP 失败不会直接毒化 refresh owner；未知 token rotation 仍保持禁止重用的既有栅栏。
- logout/sign-in 在 await 前清理显示并阻止迟到资料恢复；上述逻辑对单实例内的 owner 操作有效，不能替代跨标签 SDK owner/cache 的失效处理。
- 资料缺失与网络失败提供可见重试/重新登录入口，未自动发起登录。

## 交付及清理

设计审查另见 `docs/plan/analysis/android-native-client.md`，原报告提交 `43b6d9d`。协调契约 `80b32a5` 已作同既有 Native app、IdP cookie 与 RAM grant 区分、SDK 桥/来源提示及 `https://tauri.localhost` 的决策；实际账号/回调/Android 集成仍待验收，本次用户名阻断不因此消失。

所有独立 SDK 复现临时目录均在 finally 中删除。组件浏览器只生成合成身份截图及 Vite cache，位于本 review WT 的 ignored artifacts；核验后清理，不删除作者证据或共享依赖。未运行 Cargo/Gradle、启动模拟器、读写真实账号、push 或部署。等待作者修复 hash 后更新复审结论。
