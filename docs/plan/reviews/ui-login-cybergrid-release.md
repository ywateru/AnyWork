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
