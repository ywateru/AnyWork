# v43 网站 staging：独立元数据审查

2026-11-15，独立于网站构建及 Vercel 路由作者。审查对象是已准备的 `417a67fb1ee743c2ef67f4e75dcd056355fb2e7b` / v0.1.43（Android source versionCode 45），不是新构建或部署。本报告不更改冻结产品源码、版本或上传目录。

**结论：接受此次 staging/metadata，无阻断。** 协调者随后通知已依据另一验证者的 staging PASS 发出部署 GO；本审查不增加新的等待门槛。APK 正文及真机升级由另一个验证者负责。

## 独立完成的只读核对

- 匿名查询正式 GitHub Release、latest 与 tag：stable、已发布、非 draft/prerelease，tag 精确指向上述源码；正式资产与准备快照的 ID、size、digest、下载 URL 和 uploaded 状态一致。按仓库 canonical 定义复核资产集合共23项。
- 本地留存的 `SHA256SUMS` 共22个互异文件，覆盖除其自身外的全部资产，逐项符合正式 Release digest；7个小型文件（checksum、updater manifest、5个 signature）的实际字节亦符合正式 digest。5个平台名、对应 updater URL、signature 文件内容及签名中的版本标识均吻合 v0.1.43。本次复核签名绑定，没有重做安装包正文的密码学验签。
- 对实际 `.vercel/output` 全量重算文件路径、长度及 SHA-256，与准备 manifest 完全相同：**447文件，24,382,912 bytes**。manifest SHA-256 为 `b950f1c2a99858a28d8def58f24a68e5045f3edf481951b97adada2c59174df9`。`build.json` 精确为上述 source / `0.1.43`；`builds.json` 仅保留 production target。静态 `release.json` 的全部23项符合正式 Release。
- 内置源码包全部 **1,063个 Git blob** 与该提交逐项一致，另有精确的 `SOURCE_MANIFEST.json`；没有额外源码成员、symlink 或本机 owner 元数据。源码包 SHA-256 为 `0fc260b3cb02b524114f4f47dbcc4a4de8a34f7cf6e6ef2c25c08b513f017cac`。
- 英中页面均精确提供 v0.1.43 的 ARM64、ARMv7、x86、x86_64 四个 APK 链接，ARM64 在首，无旧单包或 universal 链接。构建后的 `/app` 含原有公开配置值，公开配置快照与已接受的40e部署一致。
- 编译后整个路由配置（含 CSP）与40e已部署制品逐项相同。9个精确 external path 为 `/api/v1/auth/config`、`/api/v1/auth/registration/challenge`、`/api/v1/auth/registration/admit`、`/api/v1/auth/exchange`、`/api/v1/directory`、`/api/v1/devices`、`/api/v1/devices/self`、`/api/v1/signals`、`/api/v1/session`，均绑定既有 coordination alias。每条对应的前置 `Cache-Control`、`CDN-Cache-Control`、`Vercel-CDN-Cache-Control` 均为 `no-store`，rewrite caching 为0；没有静态文件遮蔽。
- 编译规则不转发 console/admin/apps、auth login/register、connect、remote websocket、devices动态子路径、signals额外子路径或尾斜线变体。本审查没有将路径 allowlist 声称为 HTTP method ACL。
- 上传目录仅有配置文件及静态树，无 symlink、env、凭据文件、私钥/keystore、APK、日志、依赖目录或 build diagnostics；常见私钥及 GitHub token literal 扫描无命中。拉取产生的 `.env*` 已不存在。本次未读取私有 env 或凭据文件；该扫描也不被表述为对任意未知秘密的完备检测。
- `2026-11-15T12:29:53Z` 的只读核对确认正式域名仍为40e / v0.1.41，现有项目的 READY deployment 与准备的回滚绑定相同；原 coordination backend alias 的 deployment 未变。仅调用既有 CLI 的文档化 GET API，由 CLI 处理其已有认证，未提取、输出或持久化凭据。

## 源码包摘要边界

网站 `/source` 内置包与 GitHub Release 的 `anywork-source.tar.gz` **不是同一压缩字节制品**。既有 `scripts/assemble-vercel.py` 使用 `source-archive.py --revision <source>` 生成网站包；`.github/workflows/release.yml` 使用工作树导出路径，两者的 tar 元数据/生成方式不同。因此本审查直接验证网站包的每个 Git blob、文件集合及中性 owner，而不声称网站包符合 Release 附件的 checksum，也未下载正式源码附件来证明两包内容等价。正式下载元数据的 checksum 仍对应正式 Release 附件。未发现违反现有精确源码提供契约的错配。

## 证据与范围

小型独立脚本及结果留在本审查 WT 的 ignored `artifacts/v43-site-staging-independent/`，读取作者留存的 root `artifacts/v43-site-recovery/` 与40e已接受制品，并直接核对上传树及正式元数据。结果为 `ACCEPT_STAGING_METADATA_ONLY`。

没有测试、构建、Cargo、ADB、安装、部署、云端写入、网络配置修改或 APK 正文下载；本次不声称新增 wire、浏览器交互或设备验收通过，也不声称部署后的域名已经切换。主工作区在核对时保持 clean；只在作者自己的独立 WT 提交本文。
