# 开源与发布

## 仓库内容

Git 只保存源码、自动化测试、依赖锁文件、配置模板、许可证与通用文档。界面图标及 Gradle wrapper 属于必要构建资源，保留在仓库中。

以下内容不提交，也不包含在对应源码归档中：

- 个人会话、工作目录清单、历史事件、上传附件、数据库及日志。
- 连接令牌、Codex 登录信息、环境变量文件、签名材料及机器专用配置。
- 开发截图、录屏、真实会话验收脚本和私人笔记。
- 依赖缓存、参考仓库检出、浏览器报告与构建输出。

`.gitignore` 默认忽略截图与录屏，只例外保留 Web 的两个应用图标。文档截图如需对外展示，应使用虚构数据制作并单独审查；不要直接使用真实会话截图。

## 发布前检查

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

公开仓库为 `ywateru/AnyWork`，默认分支为 `main`。发布 `v*` tag 后，`Build releases` 工作流并行构建 macOS arm64/x86_64、Windows x64、Linux x64/ARM64、Android，以及 Web/对应源码。只有全部构建和打包成功才创建 GitHub Release，并为完整产物生成 `SHA256SUMS`。手动运行默认只生成 Actions artifacts；勾选 publish 并填写与源码匹配的 tag，全部平台通过后会从本次精确提交创建发行版。

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

公开社交分享图 `site/assets/social.png` 使用原创示意界面，不包含真实用户会话。它是唯一新增的公开 PNG 例外，连同应用图标显式进入对应源码包。参考应用提取头像已由原创几何 SVG 替换；公开历史从已审查文件建立，不推送私人开发备份。
