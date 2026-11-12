# 登录设备修订与 CyberGrid：独立发行预检

日期：2026-11-12，Asia/Shanghai。状态：**source accepted / publication pending**。

## 发行前结论

**未发现必须阻止 v0.1.27 的源码范围或双语发行叙述错误。** 只读审查 root main `deb52e58f136349665fba0b9c8233fb6a372205c`，产品路径 `Cargo.lock`、`crates/desktop`、`desktop/ui`、`web/src`、`web/scripts`、`e2e` 与独立接受的组合 `11d8b81328840a990a3a13f9718ddc949bfc80ce` 无差异。此前 [UI 修正验收](ui-login-device-followup.md)、[Web SDK 验收](cybergrid-v080-web.md) 与 [Native SDK 验收](cybergrid-v080-native.md) 的结论和限制继续适用。

本报告没有代替 root 正在执行的最终 merged checks，也没有宣布发布完成。预检 SHA 不是最终发行 SHA；当前 workspace/app 元数据仍为 0.1.26，发行说明已准备 0.1.27，版本递增与不可变源码身份由既有 publisher 在正式流程中准备并检查。

## 发行说明与已接受范围

双语 `docs/release-notes.md` 的六组陈述语义一致，并能对应到已接受实现：

| 范围 | 叙述核对与边界 |
| --- | --- |
| 账号弹窗 | 浏览器 viewport 居中及窄/短屏适配有独立几何、滚动和焦点证据；不改变会话内部交互。 |
| Native loopback 回调 | 使用品牌 HTML，区分接收结果与完成验证；没有把收到 callback 写成登录成功。安全正文/CSP/异常及竞争回调已有独立测试。 |
| 桌面 SSO | 明确同一系统浏览器/profile、有效 provider session、独立 Native grant 和可能仍需 consent；保留过期/策略导致重新认证的条件。没有宣称共享 Web token。真实 provider 研究不被冒充候选 Native listener/commit 全 runtime。 |
| macOS 控件和账号标签 | 普通交通灯/连续侧栏布局有实际截图与控件证据，可信 profile/邮箱及匿名回退有来源检查；没有宣称真实拖动位移已通过。拖动仍保留既定输入权限限制。 |
| 稳定设备名称 | 持久生成、编辑及已有 Web 名称优先可对应本地文件/Native IPC/目录 readback；名称编辑保留身份、密钥与连接。不声称云端原子 CAS、真实生产改名或不同设备名全球唯一。 |
| CyberGrid SDK | 准确区分上游 release v0.8.0、Rust SDK 0.3.0、JS 源码 metadata 0.2.0；宿主绑定/新鲜度与原远程意图/加密传输保留，不声称 npm 已发布或自动启用 bridge/finite-v2。 |

## 来源、公开绑定与服务端决定

Rust manifest/lock 和 Web SOURCE.json 均固定 `f2a3961536e5c69b13c7dbc661953d9243becbae`。实际 Rust checkout、四个 JS 模块以及原始 LICENSE/notices 的独立来源核验仍成立；本次版本更新没有重授第三方许可。source archive 按受控 tracked-public 文件名单导出，包含新增四模块、SOURCE.json/notices、Native notice 与 lock；私有 artifacts、工作树和凭据不进入 source offer。正式打包后仍需核对下载资源及归档实际字节，预检不将脚本设计当作产物通过。

Native/Web 的既有 self-hosted endpoint、issuer、SPA/Native ID、resource 与协调 URL 保持一致；正式 frontend origin 仍为 `https://anywork-tau.vercel.app`。没有改生产账号字段、Management 权限、Redis 或业务网关。

本轮明确 **SDK-only，协调服务保持现有 adapted server**。新 SDK 对 legacy memory-v1 的真实 HTTP 与当前公开 auth/config 读取已分别通过；这不宣称协调服务已升级到 v0.8.0/static products，也不宣称旧 session/receipt 可透明升级。单 SPA/单 Native allowlist 不变时无必须立即切服的实证，未来策略变化/服务端迁移仍需独立旧→新→旧 Redis/receipt/session 与回退验证。原 TLS/prefix/epoch/seed/limits、部署保护及历史 helper/provenance 不在本轮改动范围。root 提供的旧 immutable URL Protection 结果仍注明为 root 证据；本轮没有独立重新请求这些 URL。

## 发布后独立验收待办

仅在 root 通知 publisher/发行完成并给出最终 source SHA 后开始，不自行 publish、重试 workflow 或修改远端配置，也不无限轮询旧版本。

- 正式 `/build.json` 精确 source/0.1.27、缓存语义及 coordinator `/healthz`；公开 auth/config 固定绑定，不取 token。
- 新 Chrome context 的 1440/390 登录入口、canonical logo、单列/无重复栏和公开 OAuth hosted entry；不输入真实用户凭据、不登录或修改真实账户，不将公开入口当设备目录/跨设备连接验收。
- 不可变 v0.1.27 tag 与最终 source、20 assets/19 checksums/5 updater targets、签名元数据及双语下载链接；可在发行完成后使用既有只读 `--verify-existing v0.1.27`。
- 正式 source 路由/归档与最终 commit 的 public source 对应，新增 SDK 模块/notice/锁定来源完整。明确区分下载元数据/HEAD 核对与逐个大型安装包重算、实装升级或硬件验收。

现有 review 工作树保留以便继续补 live。预检证据：主树忽略目录 `artifacts/ui-login-cybergrid-release-independent/preflight.json`。本轮没有 Cargo、重复完整 Web 测试、线上请求、远端写入、产品改动或用户 app 操作。

## 第一阶段线上检查：2026-11-12

**第一阶段通过，未发现新的发行阻塞；状态仍为 source accepted / publication pending。** root 通知正式源码为 `37357859d0436b8d6b7efc9912715a30fee0b529` / `v0.1.27`、同 SHA 网站初次 workflow 成功后开始本阶段。CI/tag/release/publisher 尚在进行，本节不宣布最终发行资产通过，也不主动重试发布。以下证据位于主树忽略目录 `artifacts/ui-login-cybergrid-release-independent/live/`。

| 检查层 | 独立结果与证据 |
| --- | --- |
| 正式身份 | `https://anywork-tau.vercel.app/build.json` HTTP 200，source 精确为 `37357859d0436b8d6b7efc9912715a30fee0b529`，version `0.1.27`，Cache-Control `no-store`。`build.json`、`phase-one.json`。 |
| 公开入口与品牌 | 新 Chrome context 在 1440×960、390×844 的真实 `/app/` 均为单一登录入口、无 sidebar/manual URL 输入、无横向溢出、无 page error；点击登录到 `https://auth.x.aixgg.com/sign-in`。未输入凭据。补等图片 decode 后，实际入口及 hosted 登录页均显示 canonical 图标，图片 naturalWidth > 0；入口图标字节与最终 SHA 的 `web/public/icon.svg` 相同。`visual-entry.json`、`entry-loaded-*.png`、`hosted-loaded-*.png`。初次未等待图标加载的旧截图保留但不作为最终视觉证据。 |
| 在线新资源 | 实际 `/app/` 引用 `index-Bg-OTasz.js`、`index-B168KQ67.css`；下载的正式 JS 包含 `exchange-outcome-unknown`、`authorization-rejected`、`coordination-recovery`、`INVALID_TOKEN_REQUEST`、`minValidity`、`policyVersion`，CSS 的 `.account-dialog` 实际为 `position:fixed;inset:0;margin:auto` 并有窄/短屏尺寸限制。`phase-one.json`、`production-app.js`、`production-0.css`、`resource-hashes.json`。字符串/资源检查不单独证明真实账号 token 生命周期。 |
| 账号 shell/弹窗 | 对已下载的正式 HTML/JS/CSS/静态依赖原字节，在原 origin 做隔离回放；官方 Logto storage 只放合成 grant，Account/Grid 请求全部在 browser route 本地拦截。1440×960、390×844、390×480 各四种弹窗（添加、改名、移除、首次密钥确认）通过几何及焦点检查；水平中心误差 0、垂直最大误差 0.0078125px，左右至少 16px、上下至少 19px，Escape 关闭。设备 shell 单一 h1、无横向溢出，无 page error。没有确认改名/移除/连接。`dialog-fixture.json`、`dialog-fixture.mjs`、`synthetic-*.png`。这是 deployed bundle + 合成边界的布局证据，不是生产身份认证、真实目录、实际改名或端到端连接证明。 |
| 公开协调绑定 | 实际 GET 公开 auth/config，issuer、SPA clientId、resource 与最终源默认值一致；协调仍为 legacy `memory-v1`，没有 `policyVersion`，符合本轮 SDK-only/不切服务的决定；实际 `/healthz` HTTP 200，正文 `ok`。`public-binding.json`、`phase-one.json`。未 exchange token、未登录真实账号、未读写 Redis。 |
| 对应源码 | 正式 `/app/` 的“对应源码”确为 `/source`。完整下载 `/source` 10,115,157 bytes，SHA-256 `e94f233691ef615cf3e62518f0bd73b3c4bc1489303e16fef483427f8e728a96`；tar 内 811 个 public files 与最终 commit 的不可变 Git blobs 全部逐字节匹配，manifest 一致、无额外/缺失条目及非普通文件。包含新 SDK 四模块/SOURCE.json/notices/lock，Native 正常登录实际源为 `prompt: [Prompt.Consent]`。`source-compare.json`、`source-route.tar.gz`、响应 headers。Native SSO 的线上来源证明来自此归档，不把 Web bundle 冒充 Native OAuth 全 runtime。 |
| 双语网站 | EN/ZH 页面均有 `/app/` 入口，Web client/source 链接当前指向 GitHub latest release；此刻内嵌下载仍为 v0.1.26，按 root 说明属于 publisher 未完成时的预期状态。此项只记 pending，最终 release 信号后再核对 v0.1.27 链接和下载元数据。`en.html`、`zh.html`、`phase-one.json`。 |

### 第一阶段实证边界及恢复记录

- 合成夹具最初未暴露跨域 `X-CyberGrid-Epoch`，导致 SDK 正确拒绝缺 epoch 的配置响应，设备按钮禁用。补齐夹具 CORS expose header 后，真实下载 bundle 正常进入 ready 并通过全部 12 个弹窗检查；未更改产品资源、放宽 SDK 校验或强行 enable 控件。
- 独立 Chrome 和一次静态资源 curl 曾遇到 `ERR_CONNECTION_RESET`；后续真实公开入口补截图成功。账号弹窗最终采用下载的正式字节隔离回放，以避免将网络波动混入布局检查。回放没有网络写入：合成 exchange/delete 全部由本地 route fulfill，不向生产提交。
- `/anywork-source.tar.gz` 的另一次完整下载在 120 秒内仅收到 3,087,908 / 10,115,157 bytes，保留 `source-download.json`，未声称第二 URL 的完整包已重算一致。`/source` 完整包及全部 811 个源码文件的精确匹配不依赖此次部分下载。发行最终阶段再核对 release source/metadata，避免无限重传。
- 本阶段没有验证安装包升级、原生全 Runtime OAuth、真实设备改名/连接或物理鼠标拖动；此前 UI/SSO/Native review 的限制继续适用。没有 Cargo、产品修改、用户应用生命周期操作、权限修改或真实远端写入。

待 root 给出 tag/release 完成信号后，继续核对最终 20 assets / 19 checksums / 5 updater targets、tag 精确 source、双语下载链接及最终元数据，再给最终发行结论。

### 发行进展更新：资产验收暂停

root 随后通知 v0.1.27 release 的 macOS arm64 Native job 有两项失败：`default_tests::disable_and_logout_fence_delayed_config_token_registration_and_index`、`default_tests::failed_logout_retains_latest_grant_but_never_reopens_remote`，涉及 fixture 关闭后旧 gateway port 应拒绝连接的断言。精确源码 CI 先前成功不能替代此发行 job；本报告仅确认上述第一阶段线上源码检查通过，**不确认 v0.1.27 已完成发布，不验收或推断最终资产齐全**。日志位置为 root 的 `artifacts/ui-login-cybergrid-final/release-macos-arm64.log`，作者另树诊断，修复须提交后独立复核。本 verifier 未重跑 Cargo、抢占作者共享 target 或重试远端发行；等待 root 提供修复候选及发行状态。
