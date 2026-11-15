# v0.1.41 官网人工恢复记录

2026-11-15，官网人工恢复成功。公开读回完成时间为 `2026-11-15T09:06:35Z`。

- 正式官网：<https://anywork.aixgg.com>
- 本次部署：<https://anywork-r44p9fjfo-yywater68-1778s-projects.vercel.app>
- 不可变发行：<https://github.com/ywateru/AnyWork/releases/tag/v0.1.41>
- 精确产品源码：`f669ef59bde7cb70bbe98fd59592b6f87e93698b`
- 版本：`0.1.41`；Android versionCode：`43`。

本报告提交只增加文档，不改变已发布或已部署的产品源码。未改 main、tag、Release 附件、secrets 或 publisher state。

## 原自动流程与恢复边界

[Build releases](https://github.com/ywateru/AnyWork/actions/runs/43695877532) 在上述精确源码上成功，正式 Release 于 `2026-11-15T09:00:18Z` 发布，包含 23 个附件。收到正式发布信号前，本 lane 没有获取发行附件、构建或部署。

[官网 workflow 43697104748](https://github.com/ywateru/AnyWork/actions/runs/43697104748) 在同一精确源码上失败。只读日志确认 `Pull production configuration` 返回：

> The token provided via `--token` argument is not valid.

协调者报告 canonical publisher session `61058` 已退出 1，私有阶段为 `pages`。本次没有重试失败 workflow，没有调用 `--site-only`，也没有修改 publisher 脚本或私有状态。人工部署成功不代表原 workflow 成功；自动 CI token 仍未修复，publisher 的失败和 `pages` 状态保持原样。

## 发行与预构建核验

构建前及上传前均通过 GitHub 公开只读 API 核对：正式稳定 Release、latest 为 v0.1.41、远端 tag 解析后的 commit 等于精确源码；附件集合精确为 23 个，全部已上传、非空且具备 SHA-256 digest。`SHA256SUMS` 的 22 个条目逐一匹配 GitHub digest；五个更新目标的清单 URL、签名文件与版本绑定一致。没有下载大型安装包，也没有重新发布或覆盖附件。

使用缓存 Vercel CLI `50.28.0` 与既有本机 OAuth，对既有 `anywork` 项目执行 production pull、预构建和 `deploy --prebuilt --prod`。Vercel 子进程移除 `VERCEL_TOKEN`，未进行登录、退出、token 创建或全局授权修改。未检查或输出凭据内容。

五项公开账号配置均从精确源码的 `web/src/accountConfig.ts` 默认值提取，核对与既有配置相同；portal 为 `https://anywork.aixgg.com/app/`。明确绑定 `SOURCE_COMMIT`、`VERCEL_GIT_COMMIT_SHA`，先运行 `scripts/cloud/prepare-frontend.py` 再构建。通过本地 `installCommand: true` 覆盖避免安装，依赖仅链接 root `node_modules`，未复制依赖、target 或设备缓存。

预构建检查通过：

- `build.json` 精确等于本次源码与 `0.1.41`，release metadata 为正式 v41 的 23 个附件。
- 英中文下载页各有四个正式 v41 ABI 链接，ARM64 位于首位且有推荐文字；没有 universal APK 或旧 alias。
- `/app/` 入口、构建模块、五项公开配置及已有安全诊断文案匹配。
- CSP 与公开配置派生结果一致。
- 源码归档中的 1050 个文件逐一匹配精确 Git blob，包含本版 release notes；额外文件仅为生成的 `SOURCE_MANIFEST.json`。
- 上传目录共 447 个文件，移除 diagnostics、将 `builds.json` 缩减为 production target，并检查无 symlink、env、凭据文件、私钥或依赖目录。

## 公开读回与最终只读验证

以下路径均 HTTP 200，内容逐字节匹配已核验的 prebuilt 输出：

| 路径                            | 核验结果                                                                                 |
| ------------------------------- | ---------------------------------------------------------------------------------------- |
| `/build.json`                   | 精确 source `f669ef59bde7cb70bbe98fd59592b6f87e93698b`，version `0.1.41`                 |
| `/release.json`                 | 正式 v0.1.41，23 个附件，与构建前固定的发行元数据一致                                    |
| `/en/`、`/zh/`                  | 各四个 v41 ABI 下载，ARM64 优先且明确推荐，无旧 alias                                    |
| `/app/`                         | 入口正确，公开返回的 CSP 与预构建一致                                                    |
| `/app.js`                       | 官网刷新模块匹配预构建                                                                   |
| `/app/assets/index-BVAcaOfc.js` | 精确 app 模块、公开配置与安全诊断文案匹配                                                |
| `/source`                       | 精确源码归档；SHA-256 `2f9fc18e6286237aa046365775a6e6e628f3744f8d14316d5fad14d8c8c19a84` |

四个 Android 下载为：

- [ARM64 · 推荐，多数手机适用](https://github.com/ywateru/AnyWork/releases/download/v0.1.41/anywork-android-arm64.apk)
- [ARMv7 · 32 位 ARM](https://github.com/ywateru/AnyWork/releases/download/v0.1.41/anywork-android-armv7.apk)
- [x86 · 32 位 Intel](https://github.com/ywateru/AnyWork/releases/download/v0.1.41/anywork-android-x86.apk)
- [x86_64 · 64 位 Intel](https://github.com/ywateru/AnyWork/releases/download/v0.1.41/anywork-android-x86_64.apk)

公开 CSP：

```text
default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https://api.github.com https://auth.x.aixgg.com https://anywork-cybergrid-selfhost.vercel.app wss://*.trycloudflare.com; worker-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://auth.x.aixgg.com
```

`python3 scripts/publish.py --verify-existing v0.1.41` 退出 0，返回：

```json
{
  "release": "https://github.com/ywateru/AnyWork/releases/tag/v0.1.41",
  "source": "f669ef59bde7cb70bbe98fd59592b6f87e93698b",
  "site": "https://anywork.aixgg.com",
  "verified": true
}
```

该调用仅进入只读核验分支，不更新 canonical publisher state。

## 清理与验收范围

已移除本 lane 的 pulled env、`.vercel` 配置/缓存/输出、`site/dist`、`web/dist`、生成的源码归档及两个依赖 symlink；派生 `vercel.json` 已恢复为精确 Git 内容。真实共享依赖保留，root target 未动。构建、部署、公开读回和只读验证进程均已结束。保留本 WT 与 report-only 提交供审查。

本机小证据保存在忽略目录 `artifacts/v41-site-final-deploy/`：`release-ready.json`、`prebuilt-verification.json`、`production-readback.json`、`four-abi-labels.json`、`release-notes.json`、`verify-existing.log`、`upload-manifest.json`、workflow 结论与 `ci-failure.json`。这些文件不进入产品源码归档或本报告提交。

本报告证明官网人工恢复及作者公开读回通过，不替代非作者的独立资产验收，不新增实体设备、真实业务账号或远程工作区的验收结论。可匿名复核 build/release、双语下载页、app、CSP 与 `/source`，无需账号或重新下载所有安装包。
