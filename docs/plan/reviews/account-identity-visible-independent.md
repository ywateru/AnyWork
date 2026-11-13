# 网页账号身份展示：独立审查

审查对象：作者提交 `5462fe4ac3f5227cb8f09f57581079d4060e362e`，已 cherry-pick 至独立 review 分支为 `c3a78362a7e666111cc5b6c5881aebdd35a2198a`。设计基线 `b7f13f1`；本次只审作者十二个 Web 文件，不实现产品、不操作真实账号或会话。

**当前结论：P1 已经独立复审关闭，用户名改动可以合入。** 修复对象为作者 `e501d220daaffed30796278779596bfb16ef085a`，在 review 分支对应 `7cb8232`。独立类型检查、五文件 84 项测试、真实 SDK 双标签浏览器检查及原身份展示浏览器检查全部通过。下文保留初次发现，修复验证见文末；本结论不代表 Android 原生账号或 APK 集成已经通过。

## 初次 P1（已关闭）：跨标签账号切换继续复用旧 SDK 的 accessTokenMap

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

设计审查另见 `docs/plan/analysis/android-native-client.md`，原报告提交 `43b6d9d`。协调契约 `80b32a5` 已作同既有 Native app、IdP cookie 与 RAM grant 区分、SDK 桥/来源提示及 `https://tauri.localhost` 的决策；实际账号/回调/Android 集成仍待验收。

所有独立 SDK 复现临时目录均在 finally 中删除。组件浏览器只生成合成身份截图及 Vite cache，位于本 review WT 的 ignored artifacts；核验后清理，不删除作者证据或共享依赖。初次用户名验证未运行 Cargo/Gradle、启动模拟器、读写真实账号、push 或部署。

## 修复复审：真实 SDK owner 重建与旧 storage 写入栅栏

独立审阅了 `e501d22` 的全部五个修改文件。`AccountApp.tsx / AccountOwner` 在 storage 事件中同步退休旧 client、清空身份并关闭连接，等待旧 token 队列结束后通过 provider generation 重建整个 owner；不对替换后的 grant 调用旧 client 的 sign-out 或清理操作。真实卸载时延后到 microtask 退休 owner，避开 StrictMode 同实例的 effect replay。

`accountAuth.ts / retireAccountOwner` 在 await 前递增 epoch 并禁止 token 访问。`accountGrantStorage.ts / AccountGrantStorage` 在实例构造时捕获 ID/refresh/access-token storage 快照，在每次读写之前检查持久值；任何外部变更都会永久退休该实例。除已送达的 storage 事件外，这也覆盖事件尚未送达时旧请求完成的窗口。已对照实际安装 `@logto/browser/lib/storage.js`：其 `setItem/removeItem` 在返回 Promise 前同步完成 localStorage 写入，因此 adapter 同步更新自身 expected 值的前提在当前版本成立；后续升级 SDK 应重新核对这一前提。

独立执行结果（复用既有依赖，不安装、不进行真实登录）：

- `tsc --noEmit -p web/tsconfig.json`：exit 0。
- `vitest run --root web src/accountOwner.sdk.test.ts src/accountIdentity.test.ts src/accountAuth.test.ts src/accountAuth.sdk.test.ts src/accountGrid.integration.test.ts`：**五文件 84/84 通过**。
- `PLAYWRIGHT_CHANNEL=chrome node web/scripts/account-owner.check.mjs`：exit 0。实际 AccountApp、同源双标签和实际 storage 事件；使用安装的真实 SDK token cache/refresh/storage，仅 HTTP、持久 grant 与目录服务使用合成夹具，没有覆盖 claims/token getter。A 的 opaque/resource 缓存加载后切换 B，旧 owner 均拒绝 token，新 owner 的 UI、目录请求和两类 token 均为 B。分别挂起 A refresh 后换 B、注销、A→B→A，再释放旧响应，替换 storage 保持不变，且没有自动登录或意外授权导航。
- 真实 SDK 单测另外覆盖 storage 事件尚未送达的相同竞态、旧 owner forced clear 不得删除新 storage、正常同 owner rotation 可落盘，以及 storage denied 时安全失败。
- `PLAYWRIGHT_CHANNEL=chrome node web/scripts/account-identity.check.mjs`：exit 0。1440/390px、中英文、设备页及已连接 workspace 菜单、长名称与邮箱、键盘、资料回填与失败重试、换号与注销迟到资料均通过。浏览器仍为桌面 Chrome，不能代替 Android WebView 实测。
- 独立查看真实 SDK 换 B 后的合成目录截图，目录及账号菜单身份一致；源码差异检查通过。

行为边界：当前监听器对同命名空间的任意跨标签 storage 变化均采取退休/重建并关闭既有 workspace 连接，包括其他标签的正常同账号 grant rotation。这是保守失效策略，未声称多标签正常刷新可以保持连接不断；不影响本次 P1 隔离修复的成立。跨进程原子 refresh owner 协调及无缝多标签续连不在本次验证结论内。

本轮没有新增阻断发现，P1 关闭。仅提交此审查文档；所有本轮自产合成截图/Vite cache 在检查后删除，保留作者独立证据。AVD 的单独隔离启动曾被原始 snapshot 锁阻止，已退出并清理自产临时目录，未删除原始锁；没有可用于声称 Android 实测通过的运行实例。
