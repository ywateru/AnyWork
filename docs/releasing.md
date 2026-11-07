# 开源与发布

## 仓库内容

Git 只保存源码、自动化测试、依赖锁文件、配置模板、许可证与通用文档。界面图标及 Gradle wrapper 属于必要构建资源，保留在仓库中。

以下内容不提交，也不包含在对应源码归档中：

- 个人会话、工作目录清单、历史事件、上传附件、数据库及日志。
- 连接令牌、Codex 登录信息、环境变量文件、签名材料及机器专用配置。
- 开发截图、录屏、真实会话验收脚本和私人笔记。
- 依赖缓存、参考仓库检出、浏览器报告与构建输出。

`.gitignore` 默认忽略截图与录屏，仅精确放行应用图标、官网社交分享图和已核对来源的 Agent 标识。文档截图如需对外展示，应使用虚构数据制作并单独审查；不要直接使用真实会话截图。

## 一键发布 / One-command publication

在 `main` 上提交需要发布的源码和双语发行说明，保持工作区干净，然后只运行：

```bash
python3 scripts/publish.py
# 或 / or
npm run release
```

脚本默认递增 patch，统一更新所有应用版本及 Android versionCode，提交版本变更并推送 `main`。它等待**精确源码提交**的 Checks 成功后才推送不可变 tag，继续等待全部平台的 Release 与官网部署，最后核对发布文件、校验清单、更新签名元数据和中英文网页。无需在本机先跑一遍完整构建；相同提交已通过的远端检查会在续跑时复用。

Start from a clean, committed `main` checkout. The script advances every embedded version and Android versionCode, commits the version change, pushes main, waits for Checks for that exact SHA, then publishes an immutable tag and waits for installers and Pages. It verifies release assets and bilingual download metadata without repeating local builds or downloading every installer.

凭据优先读取 `GH_TOKEN`、`GITHUB_TOKEN`，否则读取已有的 `~/.ssh/ghp`；也可以使用 `--token-file PATH`。只需 Python 3 和 Git，不依赖临时脚本或 `gh`。发行签名继续使用 GitHub Actions secrets，脚本不读取本机签名私钥。GitHub Token 需要此仓库的 contents 与 actions 写权限。Fork 的仓库、签名和网站配置需要单独适配。

Authentication comes from `GH_TOKEN`, `GITHUB_TOKEN`, or `~/.ssh/ghp`, with `--token-file PATH` available. Only Python 3 and Git are required. Existing Actions secrets sign the builds; the local signing key is not used. Keep credentials out of commits and command arguments.

```bash
python3 scripts/publish.py --dry-run                 # 只预览；不改版本或远端
python3 scripts/publish.py --status                  # 查看本机进度
python3 scripts/publish.py --bump minor              # 新任务使用 minor；默认 patch
python3 scripts/publish.py --verify-existing v0.1.12 # 轻量核验现有发布和官网
python3 scripts/publish.py --retry-failed            # 显式重试失败的工作流并继续
python3 scripts/publish.py --pages-only v0.1.12     # 已发布安装包，只修复或核验官网
python3 scripts/publish.py --new                    # 修复源码并提交后，安全开始下一版
```

进度原子保存于 Git 私有目录 `anywork-publish/`，不进入源码包；进程锁阻止两个调用同时发布。Ctrl-C、终端关闭或网络暂时中断后，重新执行同一个命令会继续未完成步骤，不再次递增版本。完成且源码未变化时再次执行会直接结束。真正的测试失败会返回非零状态和 Actions 链接，不会把失败当成成功或无限重试。

Progress is stored atomically under Git's private common directory, protected by a process lock. Run the same command after interruption to resume. Completed work is reused; an unchanged completed source is a no-op. Failed workflows return a nonzero exit and a public Actions URL. `--retry-failed` explicitly requests a retry instead of silently looping failing tests.

如果失败来自源码，修复并提交后使用 `--new`；脚本会先确认旧发行构建已经结束，再归档旧进度并选择新的版本，不移动旧 tag。如果安装包已发布但 Pages 失败，使用 `--pages-only v版本号`，只核验已有发行并修复网站，避免重新构建或重复创建 Release。原工作流的失败记录仍保留。

After committing a source fix, use `--new` to start a fresh version once the previous release build is no longer active. Existing tags are never moved. If installers are already published but Pages failed, use `--pages-only vX.Y.Z` to verify the immutable release and repair the website without rebuilding or creating another Release. The original failed workflow remains visible.

轻量核验包括 20 个发行文件、19 个 SHA-256 条目与 GitHub 文件摘要、5 个更新目标的 `.sig`／清单一致性和版本绑定，以及官网静态内嵌版本和下载链接。它不把签名元数据检查描述为完整安装验收，也不默认运行需要下载大型更新包的可选真实升级测试。真实设备、网络和升级安装验收仍可按需单独执行。

Light verification checks all 20 assets, 19 checksum entries against GitHub digests, five updater signature-file/manifest/version bindings, and the website's embedded version and download URLs. It does not claim full binary signature or installed-upgrade testing without downloading the packages. Optional live-upgrade and hardware tests remain separate from publication.

## 手动排查检查 / Manual diagnostic checks

```bash
npm ci
npx playwright install chromium
./scripts/check.sh
npm run format:check
./scripts/build-android.sh
```

检查 `git status --short`、`git diff --cached`、提交作者信息和整个待发布历史，确认没有个人路径、真实会话标识、私有服务地址或凭据。更换远程地址或仓库可见性前，也应确认远程不存在需要保留的历史。此仓库不附带共享访问地址或可用的生产令牌。

Git 忽略规则不会删除已经提交的历史内容。如首次公开前需要清理历史，应在仓库外私下保留所需备份，从已审查的公开文件建立新历史；不要把旧历史 bundle 或备份分支放进待公开仓库。

## 生成发布包

先暂存新增文件与删除操作，使对应源码文件清单正确，再构建：

```bash
git add <reviewed-source-files>
./scripts/package.sh
sha256sum -c artifacts/SHA256SUMS
```

`artifacts/` 是本地输出目录，不进入 Git。Linux 包、APK 与源码包可作为发布附件单独上传。只有在完成 Android 构建后，打包脚本才会更新对应 APK；正式发行应使用自己的签名。Docker 构建前执行 `python3 scripts/source-archive.py`；镜像只接收该源码包，`.dockerignore` 排除其余工作目录。Linux 包归档使用中性所有者信息，并将编译路径映射到通用目录。

源码归档使用 Git 跟踪文件清单，再排除运行数据、凭据、截图等路径；不递归打包整个开发目录。归档文件头不包含本机账号名或 UID。归档内生成 `SOURCE_MANIFEST.json`，允许在没有 `.git` 的已导出源码中再次构建对应源码包；没有 Git 或该清单的任意目录会拒绝导出，避免意外包含私人文件。

建议从 Git clone 或项目生成的源码包构建。GitHub 自动生成的 ZIP 不包含上述清单；如使用 ZIP，可直接执行 npm/Cargo 构建，生成对应源码时应使用 Git checkout。`scripts/start.sh` 会生成源码包，因此需要 checkout 或项目生成的源码归档。

CI 仅上传明确列出的 Web 构建、源码包或 APK，不上传整个开发产物目录。测试自动生成的截图留在被忽略的目录中。

## 许可证

项目采用 AGPL-3.0-only；保留 `LICENSE`、`NOTICE` 和 `licenses/`。复用来源的版权、公开上游链接与版本记录不是私人开发数据，发布时应保留。运行修改后的网络服务时同步更新对应源码；服务通过 `/source` 提供源码下载。

## GitHub Actions 发行 / Automated releases

公开仓库为 `ywateru/AnyWork`，默认分支为 `main`。发布 `v*` tag 后，`Build releases` 工作流并行构建 macOS arm64/x86_64、Windows x64、Linux x64/ARM64、Android，以及 Web/对应源码。只有全部构建和打包成功才创建 GitHub Release，并为完整产物生成 `SHA256SUMS`。手动运行默认只生成 Actions artifacts；勾选 publish 时必须先存在一个版本和实际提交均匹配本次源码的 tag。工作流不自动创建缺失 tag，也不移动冲突 tag；全部平台通过后才为该已验证 tag 创建发行版。

Push a version tag to run the release matrix. Only after every platform succeeds does the publish job create a release. Manual dispatch builds Actions artifacts by default. Enable `publish` with a tag matching the source version to publish from that exact workflow commit after all platforms pass. Linux x64 uses Ubuntu 22.04; Linux ARM64 uses Ubuntu 24.04. Neither the Windows portable nor macOS app has a paid publisher/notarization certificate. Do not describe successful compilation as full hardware validation.

```bash
git tag v0.1.0
git push origin main v0.1.0
```

Android 使用 GitHub Actions secrets：`ANDROID_KEYSTORE_BASE64`、`ANDROID_STORE_PASSWORD`、`ANDROID_KEY_PASSWORD`。别名为 `anywork`。签名材料必须持久备份且不提交；换密钥会影响覆盖安装。Fork 仓库请自行配置自己的签名 secrets。普通 CI 只构建 Debug APK，不使用发行签名。

Android release signing uses the three secrets above and the `anywork` alias. Back up the signing identity privately. Forks must supply their own key. Pull-request checks do not receive release credentials and only build debug APKs.

## 双语官网 / Bilingual website

官网源文件在 `site/`。`python3 scripts/build-site.py` 输出英文 `/en/`、中文 `/zh/`、默认英文首页、SEO 元信息、sitemap 与下载元数据。使用 `--fetch-release` 将真实的最新 Release 附件写入静态页面；尚无 Release 时链接到发行列表，不生成假下载地址。浏览器可进一步刷新最新元数据，API 不可用时保留静态下载。

The website builds without npm dependencies. `Publish website` deploys `site/dist` with the official Pages artifact/OIDC workflow. Configure the repository's Pages source as **GitHub Actions**. After publishing a release, the release job explicitly dispatches `pages.yml` to refresh static download links. This uses the workflow-dispatch exception because a release event emitted with `GITHUB_TOKEN` does not trigger another workflow by itself. Site pushes and manual deployments also refresh metadata.

```bash
python3 scripts/build-site.py
node scripts/site-test.mjs
# Use PLAYWRIGHT_CHANNEL=chrome locally if only system Chrome is installed.
```

公开社交分享图 `site/assets/social.png` 使用原创示意界面，不包含真实用户会话。它连同应用图标和 `web/public/agents/` 下精确放行的 Codex PNG 标识进入对应源码包，其他截图仍被排除。参考应用提取头像已由原创几何 SVG 替换；公开历史从已审查文件建立，不推送私人开发备份。


## Signed desktop updates / 桌面签名更新

See [updates.md](updates.md) for the update lifecycle and key requirements. Configure `TAURI_SIGNING_PRIVATE_KEY` before running the release workflow. All five native desktop targets are required to publish `latest.json`. Windows now also builds a per-user NSIS installer; Linux builds AppImages. Portable downloads remain available for manual updates.

Use `python3 scripts/publish.py` for normal releases; it waits for exact-SHA Checks before tagging and verifies the website afterward. The older **Release new version** Action is retired and fails with migration instructions without checking out code or mutating tags/branches. Manual version/tag or Release dispatch remains advanced maintenance only and must pass the same workflow-enforced Checks gate. Never reuse a published tag or overwrite its artifacts: the preflight rejects duplicate/backwards releases. The signing CLI binds each signature to its application version.

正式发布需要先配置 `TAURI_SIGNING_PRIVATE_KEY`。五个原生桌面目标全部成功后，才发布 `latest.json`；签名绑定应用版本。常规发布使用 `python3 scripts/publish.py`，自动等待检查、构建、官网与轻量核验；旧的 **Release new version** Action 已停用，只返回迁移提示；它不再推送分支、创建 tag 或分发构建。手动维护版本或调用 Release 工作流也不能绕过下面的检查门禁。不复用已发布版本，不覆盖旧附件。保管好 Git 之外的发行私钥。


## Release 工作流的独立 Checks 门禁

发布脚本的检查之外，`Build releases` 自身在公共预检和实际创建 Release 前两次执行 `scripts/check-release-ci.py`。只接受仓库自身 `.github/workflows/ci.yml` 的 active workflow ID、精确 40 位源码 SHA、`main` 分支、`push` 或显式 `workflow_dispatch` 事件，并要求该运行 completed/success。PR、fork、相似名称、不同 SHA、失败、取消或缺失的运行均不能授权发布；已有精确成功记录可以复用。等待有上限并返回 Actions URL；API 只读、不转发重定向、失败关闭，不输出凭据。

所有 tag 发布和手动 publish 均使用同一预检，创建 Release 前再核对一次。仅构建 artifacts 的手动运行不要求发布授权。Checks 对所有 main 提交运行，包括仅修改文档的提交，避免发布源码 SHA 没有对应检查。容器实际构建验收也是 Checks 的组成部分。

GitHub 的 `GITHUB_TOKEN` 推送不会触发普通 on-push Checks，所以旧 prepare shortcut 已停用。高级自动化若用该令牌推送，必须显式对 main 分发 Checks，并确认其 `head_sha` 等于发布源码；若 main 已前进，应停止并重新选择源码。不得使用 PR 成功记录或另一提交的成功记录替代。普通发布仍使用 `python3 scripts/publish.py`，不可变发行与单独 Pages 恢复流程不变。

The Release workflow independently verifies trusted, successful Checks for the exact source SHA both before builds and immediately before publication. Tag/manual publishing cannot bypass it; build-only dispatch remains available. The retired preparation Action has no write permissions or mutations. Token-generated pushes require explicit source Checks dispatch because GitHub does not trigger normal push workflows from `GITHUB_TOKEN` pushes. No real Actions, tags or releases are created by the offline gate regression tests.


正式预检和创建 Release 前均通过 GitHub 只读 API 解析远端轻量或附注 tag（有界处理附注链），要求最终 commit 等于本次 `github.sha`。缺失、格式异常、循环、不同源码或构建期间被移动的 tag 均拒绝；手动 publish 与 tag 触发共用该策略。普通发布脚本已负责建立对应不可变 tag；高级手动运行也需先准备正确 tag。工作流只接受已有 tag 并使用 `--verify-tag`，不再借 `--target` 隐式创建。检查与创建发行版之间无法用分开的 GitHub API 实现原子锁；仓库应配置 tag 保护来禁止其他写入者在最后读检查后移动 tag，这属于额外仓库权限控制，离线测试不声称已检查实际仓库配置。

Publishing preflight and final authorization both peel the existing remote tag and require the exact workflow source commit. Manual publishing no longer creates a missing tag implicitly. Missing, moved, malformed or wrong-source tags fail closed without mutations. Repository tag protections are still needed against an external writer racing the final read/create boundary.
