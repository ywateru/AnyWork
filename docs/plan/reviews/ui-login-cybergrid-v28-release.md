# 登录设备修订与 CyberGrid v0.1.28：独立发行验收

日期：2026-11-12，Asia/Shanghai。最终状态：**PASS，两阶段独立验收通过，无新增发行阻塞。** 正式发行 [v0.1.28](https://github.com/ywateru/AnyWork/releases/tag/v0.1.28) 对应精确源码 `b750756876369b435d8827e8165af6c64a64bac0`；以下限制仍适用，不将元数据通过表述为全平台实装或真实账号业务验证。

## 固定来源与第一阶段结论

最终发行源码固定为 `b750756876369b435d8827e8165af6c64a64bac0` / `v0.1.28`。独立 review 树已 merge 该 main 来源并保留既有报告。此前 [UI 修订](ui-login-device-followup.md)、[Web SDK](cybergrid-v080-web.md)、[Native SDK](cybergrid-v080-native.md)、[gateway 关闭修正](ui-release-gateway-close.md) 的结论及实证限制继续适用。

**新部署第一阶段通过，无新增阻塞。** 本阶段只读核对真实线上来源、匿名入口与保留配置，没有启动 publisher、重试 workflow、运行 Cargo、输入账号凭据或修改真实业务数据。证据位于主树忽略目录 `artifacts/ui-login-cybergrid-v28-release-independent/`。

| 检查 | 新版本独立结果 |
| --- | --- |
| 正式身份 | `/build.json` HTTP 200，source 精确为 `b750756876369b435d8827e8165af6c64a64bac0`，version `0.1.28`，Cache-Control `no-store`。`build.json`、`phase-one.json`。 |
| 在线资源 | 实际 `/app/` 的 `index-CQfM5BwF.js` 包含已验新 SDK 的 binding/freshness/recovery 特征；实际 `index-B168KQ67.css` 的 dialog 使用 fixed/inset:0/margin:auto 与窄/短屏限制。下载的 CSS 字节与前轮一致。`production-app.js`、`production-0.css`、`stage-one-summary.json`。资源特征检查不冒充真实 token 生命周期测试。 |
| 真实匿名页面 | 新 Chrome context 分别在 1440×960、390×844 检查登录页：单一入口、无 sidebar/manual URL 输入、无横向溢出、无 page error。点击登录到正确 `https://auth.x.aixgg.com/sign-in`，未提交凭据。等待 image decode 后，入口和 hosted 页均实际显示 canonical logo；线上 SVG 与最终 SHA 的源字节相同，图片 naturalWidth > 0。独立查看全部四张最终截图。`visual-entry.json`、`entry-loaded-*.png`、`hosted-loaded-*.png`。 |
| 原 GUI 证据复用 | `37357859…` 到本轮 source 的 `web/src`、`desktop/ui/src`、`web/scripts`、`e2e` 均无变化；本轮不重跑未变的完整 GUI。前轮正式 bundle 隔离回放的 1440×960/390×844/390×480 共 12 个弹窗几何/焦点检查继续作为原 UI 证据，路径见 `stage-one-summary.json`。它仍只是合成 account/storage/HTTP 边界，不是生产登录、真实目录或跨设备连接验证。 |
| 协调与服务决定 | 实际 `/healthz` 200/`ok`；实际公开 auth/config 的 issuer、SPA clientId、resource 与本轮默认配置精确一致，继续为 legacy `memory-v1`、无 `policyVersion`。`public-binding.json`。本轮仍 SDK-only，未切换协调 server/static products，未读写 Redis 或 exchange token。 |
| 正式对应源码 | 真实 `/app/` 的“对应源码”仍为 `/source`。完整下载 10,121,893 bytes，SHA-256 `50a5ff8996cd13ebaf3f9d22c299519c56a0f80ed65b52dfd118a2a85f5f468f`；tar 内 **812 个 public files 全部逐字节匹配最终 SHA 的 Git blobs**，manifest 相同，无额外/缺失或非普通文件。归档包含新 `GatewayShutdown`、test-only capture/provider 同步、foreign-listener 测试、新 SDK 四模块/SOURCE.json/notices/lock，以及 Native `prompt: [Prompt.Consent]`。`source-compare.json`、`source-compare.py`、`source-route.tar.gz` 及 headers。Native SSO 的来源证明来自此包，不把 Web bundle 当成 Native runtime。 |
| 双语下载的中间状态 | 第一阶段 `/en/`、`/zh/` 均有 `/app/` 入口，内嵌下载为 v0.1.26。root 已说明此时 publisher 尚在运行，故只记 pending，不作产品阻塞或假称已更新。`en.html`、`zh.html`、`phase-one.json`。 |

## 第二阶段：正式发行与最终网站

root 通知 release workflow 成功、随后 publisher complete/exit 0 后收敛本阶段；独立执行既有只读 `python3 scripts/publish.py --verify-existing v0.1.28`，结果 `verified: true`，返回 source 精确匹配。另用只读 GitHub/public GET 保存 tag、清单和最终双语页面明细，没有启动新的发布或远端变更。

| 检查 | 独立结果与证据 |
| --- | --- |
| 不可变 tag/source | v0.1.28 为附注 tag，ref object `00a21995464e1b3a55ef4e405c3fe9eabbb107a5` 解引用到 commit `b750756876369b435d8827e8165af6c64a64bac0`，与本轮最终源码一致；release 为已发布 stable，非 draft/prerelease，published_at `2026-11-12T07:58:10Z`。`tag-ref.json`、`tag-peel.json`、`release-metadata.json`。不把 tag 精确来源检查写成 tag GPG 签名验证。 |
| 精确源码 workflows | 独立只读 API 核对 [Build releases 43176689369](https://github.com/ywateru/AnyWork/actions/runs/43176689369) 和 [最终 Vercel 43179175665](https://github.com/ywateru/AnyWork/actions/runs/43179175665)，二者 head_sha 均为最终 source，状态 completed/success。`final-workflows.json`。 |
| 资产与校验清单 | **恰好 20 assets / 19 checksum entries**，名称集合精确、无重复/缺失，资产 uploaded、size 非零、URL 指向 v0.1.28；所有 19 项 checksum 与 GitHub asset SHA-256 digest 一致，小型下载元数据自身重算 digest 一致。`verify-existing.log`、`release-metadata.json`、`SHA256SUMS`、`stage-two-metadata.json`。没有逐个大型安装包重新下载重算。 |
| updater 绑定 | **5 targets**：darwin-aarch64、darwin-x86_64、windows-x86_64、linux-x86_64、linux-aarch64；manifest version 为 0.1.28，URL 与对应 v0.1.28 资产一致。只读 verifier 下载并核对五个独立 `.sig` 文本与 manifest signature 相同，trusted-comment 的单一 version 字段均为 0.1.28。`latest.json`、`verify-existing.log`。此处验证签名文件/版本元数据一致性，未下载全部 updater 包进行完整 payload 密码学验签或实装。 |
| 安装器入口 | 既有 verifier 对 macOS 双架构 DMG、Windows setup、Linux 双架构 AppImage、Android APK 六个正式安装器做 HEAD，响应 Content-Length 与 GitHub asset size 一致。`verify-existing.log` 通过。可达/size 核对不等于系统安装、notarization 或硬件验证。 |
| 最终网站与双语下载 | 最终 `/build.json` 仍精确 source/0.1.28；`/release.json` 为 v0.1.28，20 项资产的 size/URL 与发行一致。EN/ZH 内嵌版本均为 v0.1.28，installer/portable/checksum 链接均指向同一发行真实资产，第一阶段的 v0.1.26 中间状态已消除。`final-build.json`、`final-release.json`、`final-en.html`、`final-zh.html`、`stage-two-metadata.json`。 |
| 最终对应源码 | 在最终网站刷新后重新完整读取 `/source`，**812 个 public files 再次全部逐字节匹配同一最终 commit**，manifest/文件类型检查通过，包含 gateway 关闭修正、新 SDK、Native consent-only。最终包 10,121,893 bytes，SHA-256 `b7e711ae522dba666c5768194619ae8615f189395b08e1b357b20a3b52e7305c`；gzip 字节因重新打包与第一阶段不同，源码内容匹配。`final-source-compare.json`、`final-source-route.tar.gz` 及 headers。GitHub release source asset 的 checksum/metadata 检查同上；该资产没有另行解包逐文件比对，不能混同于已完整比对的正式 `/source`。 |

最终源码传输曾在 150 秒及一次 90 秒续传预算到期，并遇一次连接重置；通过同一 ETag `acd365928e1cae5643d8c02822ef669c` 的 206 Range 续传完成，最后完整 gzip/tar 读取及源码比对均通过。各段 Content-Range、ETag 和最终 byte count 留存于 `final-source-route.headers`、`final-source-resume*.headers`；这属于下载取证网络限制，未重试 publisher。最终 `/app/` 一次额外小页面重读也遇连接重置，未据此重复完整 GUI；真实入口/在线资源检查采用本报告第一阶段的同一精确 source 证据，最终 build 与源码已重新核对。

## 保留的实证边界

前轮真实 provider SSO 研究与 Native 全 runtime 的区别、缺有效 held-mouse 权限导致真实拖动位移未验证、平台硬件/安装升级支持边界继续保留。Gateway 修正证明原任务关闭与受控端口误报条件，**没有证明原 v0.1.27 release 失败必然由端口重用引起**；v0.1.27 失败历史与 tag 不改。最终资产检查属于元数据、签名版本绑定及下载响应核对，除非另有记录，不宣称逐个大型安装包重新下载重算、实装升级或全平台硬件验收。
