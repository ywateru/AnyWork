# v0.1.43 官网人工恢复记录

2026-11-15，官网人工恢复成功。部署 READY 后于 `2026-11-15T12:33:05Z` 完成初步公开读回，完整读回完成于 `2026-11-15T12:35:58Z`。本报告只增加文档；生产网站和安装包的精确产品源码均保持 `417a67fb1ee743c2ef67f4e75dcd056355fb2e7b`，不包含此报告提交。

- 正式官网：<https://anywork.aixgg.com>
- 部署：<https://anywork-m15ojdwdk-yywater68-1778s-projects.vercel.app>
- Deployment ID：`dpl_9SphfUmfubzcC9pgg8gFPDTFbqMi`，既有 `anywork` 项目，状态 `READY`。
- 正式发行：<https://github.com/ywateru/AnyWork/releases/tag/v0.1.43>
- 版本：`0.1.43`；Android versionCode：`45`。
- 任务与既有 gateway 证据：[移动协调恢复任务](../tasks/mobile-coordination-recovery.md)、[route 与受控 wire 验收](mobile-coordination-route.md)。

## 自动流程与授权边界

[Build releases 43711399021](https://github.com/ywateru/AnyWork/actions/runs/43711399021) 在上述精确源码上完成成功。[官网 workflow 43712745935](https://github.com/ywateru/AnyWork/actions/runs/43712745935) 已失败在 `Pull production configuration`，只读日志确认 token 无效；同 source 的 push 官网任务也已失败。

正式 Release 发布后完成预构建，收到 parent 对精确候选的明确 GO 后才部署。部署前再次核对 source、447 个上传文件的 manifest、正式 latest v43、公开配置/CSP、当前生产与后端 alias；确认没有进行中的自动任务或项目部署。只提交了一次 production prebuilt 部署，CLI 退出 0，随后通过只读 API 和公开内容确认 READY 与生产 alias。

使用缓存 Vercel CLI `50.28.0` 和既有本机 OAuth，子进程移除 `VERCEL_TOKEN`，没有登录、退出或全局授权修改。没有修改 backend、env、DNS、repo secrets、issuer/resource/product/storage 绑定、正式 tag 或附件，也没有读出真实用户 token。canonical publisher 仍由 parent 独占；本 lane 未调用 `--site-only`、未编辑 publisher state 或将 `pages` 伪记为 complete。**人工官网恢复成功，原自动 CI token 失败仍未修复。**

## 精确预构建与发行绑定

- 网站和安装包 tag 均绑定上述完整 source，GitHub latest 为正式 v43；metadata 精确 23 assets，不含 universal 或旧 alias。
- `SHA256SUMS` 的 22 个条目逐项匹配 GitHub asset digest；五个 updater 目标的下载 URL、签名文件与版本绑定一致。这是 metadata/签名文件绑定核验，不声称完成安装包密码学验签。本 lane 没有重复下载大型安装包；parent 已报告独立 verifier 实际四 APK/source 验收 PASS。
- 五项公开账号配置与既有生产一致，portal 仍为 `https://anywork.aixgg.com/app/`。显式绑定 `SOURCE_COMMIT` 和 `VERCEL_GIT_COMMIT_SHA`，运行 `prepare-frontend.py` 后 prebuild；CSP 与公开配置派生结果一致。
- 依赖仅 symlink root `node_modules`，用本地 `installCommand: true` 避免安装或覆盖共享依赖。
- 上传共 447 文件、24,382,912 bytes；manifest SHA-256：`b950f1c2a99858a28d8def58f24a68e5045f3edf481951b97adada2c59174df9`。上传前移除 diagnostics、缩减 builds metadata，检查无 env、凭据/私钥文件、依赖目录或 symlink。
- 源码归档的 1063 个文件逐一匹配精确 Git blob，额外仅生成 `SOURCE_MANIFEST.json`；归档 SHA-256：`0fc260b3cb02b524114f4f47dbcc4a4de8a34f7cf6e6ef2c25c08b513f017cac`。
- 编译后的九条精确外部路径、缓存规则、CSP 与先前已验收的 40e 生产配置完全相同；负向 apps/console/admin/legacy auth/host-connect/WebSocket/额外路径不转发。未扩大为通配 `/api` rewrite，也不声称这些 pathname 规则是 method ACL。

## 公开读回与配置探针

以下八项均 HTTP 200，逐字节匹配已核验的 prebuilt：

| 路径                            |    bytes | SHA-256                                                            |
| ------------------------------- | -------: | ------------------------------------------------------------------ |
| `/build.json`                   |       73 | `93ebb42c1fccd1da88e693e580389be29b83443820a10d474656b5fa3e265d88` |
| `/release.json`                 |     3998 | `e00b96bdcacf7bf5a4975ebb1ee92ead237771d744d54791ddd56cd2c5420f00` |
| `/en/`                          |    30592 | `753a77235aa760d5c26392af31aa13b0bd497dd788d0efec7978c1931eee157d` |
| `/zh/`                          |    29702 | `c641fb8772b0d0138fc6625da1aa2cdac17035b2516d89b4c71b18b9a2de7cab` |
| `/app/`                         |      658 | `533b7433ba058e0fb1bdb2c76d7a11991c158f8ad36298e0b946c45a0fad025a` |
| `/app.js`                       |     5654 | `a34d42f486713a35351bae60bb5c711c775614f8b67b24cbd3f19226dcaf4753` |
| `/app/assets/index--z7fwJ2g.js` |  1198097 | `9e461f7ba7c2c96c056f21e1811d4e33580db21cd13e96b704a65cd159218525` |
| `/source`                       | 10708921 | `0fc260b3cb02b524114f4f47dbcc4a4de8a34f7cf6e6ef2c25c08b513f017cac` |

线上 `build.json` 精确返回：

```json
{ "source": "417a67fb1ee743c2ef67f4e75dcd056355fb2e7b", "version": "0.1.43" }
```

英中文各有四条正式 v43 ABI 下载，ARM64 排首且有推荐文字，无 universal 或旧 alias：

- [ARM64 · 推荐](https://github.com/ywateru/AnyWork/releases/download/v0.1.43/anywork-android-arm64.apk)
- [ARMv7](https://github.com/ywateru/AnyWork/releases/download/v0.1.43/anywork-android-armv7.apk)
- [x86](https://github.com/ywateru/AnyWork/releases/download/v0.1.43/anywork-android-x86.apk)
- [x86_64](https://github.com/ywateru/AnyWork/releases/download/v0.1.43/anywork-android-x86_64.apk)

`/app/` 返回的 CSP、app 模块内五项公开配置及既有中英文安全诊断文案匹配 prebuilt。匿名 Native config GET 返回 200，JSON 与原协调后端相同；`Cache-Control: no-store`、`x-vercel-cache: MISS`、`Age: 0`，没有发送账号凭据。`x-vercel-enable-rewrite-caching` 是内部控制头，未出现在公开响应中，不据此判失败。

既有 backend 兼容边界保留：部署后端没有 endpointPolicy，Native SDK 据此直接选择 `/devices`；既有 `/directory` 404 不冒记为新 capability，也不描述为 SDK 先请求 directory 再回退。本次没有重复合成登录/注册或手机测试；既有受控 wire 和 parent 的实体手机证据分别见关联任务，不把本次网站读回扩张为新的设备/真实账号验收。

`python3 scripts/publish.py --verify-existing v0.1.43` 退出 0：

```json
{
  "release": "https://github.com/ywateru/AnyWork/releases/tag/v0.1.43",
  "source": "417a67fb1ee743c2ef67f4e75dcd056355fb2e7b",
  "site": "https://anywork.aixgg.com",
  "verified": true
}
```

该调用只走公开只读核验分支，不更新 canonical publisher state。

## Rollback 与清理

最终只读复核于 `2026-11-15T12:36:38Z` 确认新 production alias 未漂移；原 40e deployment `dpl_97y1sK6c1fMDqHzRAwZAjsHdiCg1` 仍为 READY，保留供回滚：<https://anywork-l1jfwi8f4-yywater68-1778s-projects.vercel.app>。协调后端仍为 `dpl_7TSSCHxqypSjpvNmawUyyUYdaw1J`，未切换其 alias。

已删除本 lane pulled env、原始 pull/build/deploy 日志、`.vercel` 配置/缓存/输出、`site/dist`、`web/dist`、临时源码归档和两个依赖 symlink；派生 `vercel.json` 恢复为精确 Git 内容。真实共享 `node_modules`、root target、其他任务和宿主/设备均未动。构建、部署、公开读回和 verify-existing 会话均已退出，写报告前 WT 清洁。

小证据保留于 root 忽略目录 `artifacts/v43-site-recovery/`，包括 release-ready、prebuilt/compiled-route verification、upload-manifest、go-checks、immediate-production-result、production-readback、verify-existing-result、workflow 结论与 final-status。保留本 WT 和 report-only 分支供独立匿名读回/审查；该作者记录不替代非作者最终验收。
