# Mobile saved-login UI — independent review

2026-11-16。独立工作树 `mobile-layout-review` / `codex/mobile-layout-review`。审查者未修改产品代码，使用真实 production MOBILE entry 与合成公开 Tauri IPC，不使用普通 Web 入口代替。

**结论：PASS，未发现本范围内需阻断的 P1/P2。** 接受精确 `6ac8b4708e6344c5c02765703f3c7664a2299b81` 的恢复 UI，以及依赖 `8e8a77c80be8f8e9765c8d4d35be971fa7708334` 的公开 phase/message 定义。布局精确 `0f7d5a43b21d2ac2695ec86c929cf2f1e1d9c57f` 的两项 P2 已由独立报告 `17e6558` 关闭。可据此关闭浏览器 UI/source gate，继续 Android 子集冻结与正常 SSO/重启验收；本报告不声称 APK 或原生安全存储实测通过。

## 候选与范围

| 作者精确提交 | 本审查树 cherry-pick | 范围与状态 |
| --- | --- | --- |
| `f92061a` → `15c975e` → `0f7d5a4` | 最终布局 `31b506f` | 已审共享样式、短横屏 composer/terminal 与实际触摸链路；PASS，见[布局报告](mobile-workspace-layout-independent.md) |
| `8e8a77c`，作者 UI 分支中同 patch 为 `e2044c0` | `ba4b198` | AccountSnapshot 两种恢复 phase、五个固定友好消息；仅取一次 |
| `6ac8b4708e6344c5c02765703f3c7664a2299b81` | `8fda7123c2c2c5d00b8cdb781bcfcddfc9482046` | MobileApp、收集的 browser fixture/tests、作者报告；本次 PASS |

契约：[登录恢复](../../login-session-persistence.md)、[Mobile 布局](../../mobile-client-layout.md)及[协调任务](../tasks/desktop-mobile-session-recovery.md)。Native `81cee2f` 由另一位审查者负责，本树未为 browser 验证取入其实现。没有修改 Native persistence、transport、server/cache、网站或发行代码，也没有合 root/main。

## 源码与行为结论

```text
启动 restoring（未显示登录/设备）
  ├─ Native signedIn → 我的设备
  ├─ Native signedOut → 显式登录/注册
  ├─ restoreRetryable → 手动 refresh / 退出清除
  └─ reauthRequired
       ├─ invalid / uncertain → 显式登录
       └─ CLEAR_REQUIRED → 只允许重试退出清除
```

初态为 restoring / epoch0 / revision0。Native 初始投影返回前保留恢复界面；收到 Native 事件后不让迟到初始 snapshot 覆盖它。ready 后仅在 restoring、无 busy 且无上次 poll IPC 失败时，每次 snapshot 完成后约一秒再读一次，不自动调用 login 或 refresh。挂起的 poll 不继续堆积；phase/epoch/busy/unmount 清理 timer，并丢弃过期 callback。poll IPC 失败停止自动读，提供手动重新检查，不把故障展示成已退出。

手动重试调用现有无参数 refresh，不发起 SSO。invalid/uncertain grant 的登录需要显式点击；CLEAR_REQUIRED 隐藏登录、注册及重试恢复，只保留再次清除授权。失败 clear 不宣称 signedOut。logout 提示明确清除此应用保存的授权并断开手机连接，电脑 Agent 继续；旧操作结果由 operation ticket 与 epoch/revision 栅栏拒绝。重复同 owner restoring snapshot 不会每秒关闭退出确认框。

账号说明已准确区分 Native 保护的恢复授权、重新打开尝试恢复，以及登录服务/WebView cookie 边界。恢复错误只通过固定公开码映射；未知 snapshot 错误内容不直接显示。没有新增 invoke 名或请求字段；snapshot/refresh/logout 仍无参数，login 保留既有 request envelope。

## 独立执行

私有输出均位于本工作树 `artifacts/mobile-layout-independent/`。复用 root node_modules，未安装/复制依赖，未运行 Rust/Android build 或占用 shared target。Vite 使用 runner loader 与私有 outDir，Playwright 使用私有静态服务 `127.0.0.1:3259/mobile.html`。全部账号、设备、业务内容均为 synthetic，无真实凭据、Gateway、Agent 或生产进程操作。

| 检查 | 结果 |
| --- | --- |
| 独立构建 `vite.mobile.config.ts` production MOBILE | PASS；JS/CSS SHA-256 与作者完全一致 |
| 作者收集用例在独立 production dist 执行 | **15 passed**；新恢复七项，加短横屏两项、首启取消登录、目录/公钥、完整 App 文件操作、迟到 chooser、审批返回、无 Native bridge |
| 独立追加初始 snapshot 慢于 Native 事件 | **PASS**；恢复页无 welcome 闪现；较早到达的新 Native signedIn 事件不会被迟到旧 signedOut snapshot 覆盖 |
| 独立追加挂起 poll 与新 epoch | **PASS**；挂起十秒无重复 poll；新 epoch retryable 后旧 signedIn 结果被拒绝，之后无自动 snapshot/refresh/SSO，未知原始错误字符串不显示 |
| 独立追加手动 refresh 慢于 logout | **PASS**；显式退出完成后旧 refresh 的 signedIn 成功不能重新打开设备页，未调用 login |
| `tsc --noEmit -p web/tsconfig.json` | PASS，日志空，无诊断 |
| `git diff --check` | PASS |

追加三项合计 **3 passed**。独立 fixture 对初始慢响应及 poll 期间的 UI 使用 MutationObserver 记录 welcome 出现，确认没有误闪已退出入口。已视觉检查恢复失败页与 CLEAR_REQUIRED 页：布局正常、操作清楚，后者只有清除重试按钮。账号说明与退出确认亦有 production 用例断言。

| 独立产物 | SHA-256 |
| --- | --- |
| `mobile-B6tbbjYu.js` | `cb7ac388e3ae3d138a88551afd562a4768d656b6060825ed085af9ab5c8431de` |
| `mobile-BdM7bMIa.css` | `d872ce01a599ab5fe58b04ac8466a860d82066cd2b2157a9d848fe3d65b01765` |

## 重现与证据

```sh
# 从本审查树 web/，仅构建 MOBILE
node <root>/node_modules/vite/bin/vite.js build --config vite.mobile.config.ts --configLoader runner --outDir ../artifacts/mobile-layout-independent/restore-ui-dist --emptyOutDir
# 从本审查树
REVIEW_DIST=restore-ui-dist node <root>/node_modules/@playwright/test/cli.js test --config artifacts/mobile-layout-independent/author-built.config.ts --grep 'saved login|first run|directory unknown|full App uses|late chooser|missing native bridge|native back leaves approval|short landscape'
REVIEW_DIST=restore-ui-dist node <root>/node_modules/@playwright/test/cli.js test --config artifacts/mobile-layout-independent/playwright.config.ts restore-ui.spec.ts
node <root>/node_modules/typescript/bin/tsc --noEmit -p web/tsconfig.json
```

证据文件为 `restore-ui-build.log`、`restore-ui-production.log`、`restore-ui-independent.log`、`restore-ui-tsc.log`；`restore-ui-production/` 含 retry、clear-required、account、reauth 等截图；`restore-ui-independent/` 含 no-welcome-flash、epoch-fenced-retry、logout-refresh-fence 截图。`tests/restore-ui.spec.ts` 保留独立可控 pending snapshot/refresh 夹具；`restore-ui-binding.json` 绑定候选、产物及截图 SHA-256。

本报告关闭浏览器恢复 UI 与此前布局 gate。真实 Android Keystore/SDK、正常 SSO 后进程重启、原生授权轮换和 APK 装包属于后续独立验收，不能由这些 browser 结果推导。所有私有验证服务已退出，tracked 工作树无未提交产品变更。
