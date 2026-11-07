# 部署与构建

## 本机服务

建议单独系统用户运行，工作目录设置为实际允许的项目父目录。新安装默认使用 `.anywork`；仅当已有 `.remote-agent` 目录且未显式指定数据目录时继续使用旧目录。保留实际数据目录及该用户的 Codex 登录目录。服务退出不自动重复执行请求；下次消息恢复同一 Codex thread。

生产命令：

```bash
npm ci && npm run build
cargo build --locked --release -p anywork
python3 scripts/source-archive.py
./target/release/anywork --workspace /srv/projects --data-dir /srv/anywork-data
```

Web 静态文件默认来自运行目录的 `web/dist`。`/source` 默认来自运行目录 `artifacts/anywork-source.tar.gz`。如果从其他目录运行，应使用绝对 `--web-dir`，并在运行目录提供对应源码归档。

## 反向代理

以已有 nginx 为例：

```nginx
location / {
    proxy_pass http://127.0.0.1:3210;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_buffering off;
    proxy_read_timeout 3600s;
    client_max_body_size 22m;
}
```

配置站点 TLS，关闭 SSE 缓冲，保留 WebSocket Upgrade。Web 与 API 同源时不需要放宽 CORS。通过其他域名单独部署 Web 时，将它加入 `ANYWORK_ORIGINS`；同一设置也用于终端来源验证。

## 容器

仓库提供 Dockerfile 与 compose.yaml。Rust 阶段仅构建 `-p anywork` 服务，不编译桌面应用，也不要求 GTK、WebKit 或桌面 UI 产物。容器以 UID 10001 运行，挂载的工作目录需对该用户可写。运行时默认固定 `@openai/codex@0.164.0`；可用 `--build-arg CODEX_VERSION=版本` 覆盖，但更换后需重新做对应 Codex 原生功能验收。

```bash
mkdir -p workspace
python3 scripts/source-archive.py
docker compose build
docker compose run --rm --entrypoint codex anywork login --device-auth
docker compose up -d
```

Codex 账号保存在独立命名卷中，数据和工作区分别挂载。compose 默认只发布到主机 loopback。外部 Agent 插件的可执行文件和运行依赖需要在镜像里安装，JSON 清单不是自动安装器。

容器中的 Codex 是独立 CLI 环境；容器镜像不代表宿主桌面会话共享已通过验收。无需登录或调用模型的隔离验收：

```bash
python3 scripts/source-archive.py
python3 scripts/container-smoke-test.py --build
```

该脚本进行无缓存镜像构建，使用唯一命名的容器和卷、随机 loopback 端口及本地 RPC fixture，检查 UID 10001、错误令牌 401、API 版本、Web 构建清单中的应用版本/源码 SHA-256/PWA 指纹及全部文件摘要、`/source` 与源码归档逐字节一致，以及重建容器后会话、工作区和访问令牌保留；退出时只清理本次创建的资源。`--image 镜像` 可检验既有镜像，要求源码归档与镜像对应；不会移除传入的镜像。

Checks 工作流中的 `container` job 会实际执行上述构建和验收，正式发布要求同一源码提交的完整 Checks 成功。2026-11-07 的[实际 CI 验收](https://github.com/ywateru/AnyWork/actions/runs/42372270797/job/128402662866)已在精确提交 `83eda6cc78d3171ee60f86a433cd857777ae306e` 通过干净服务端镜像构建、UID 10001、认证、源码绑定 Web 身份及文件摘要、对应源码与会话/工作区/密钥持久化，未调用模型。当前开发机仍无可用 daemon；该结果来自 GitHub Linux x64 runner，不代表所有架构、原生账号或桌面共享拓扑均已验收。后续源码提交仍需重新通过其对应 Checks，不能继承旧提交的发布许可。

## Android

使用 JDK 17、Gradle wrapper 8.14.2、Android API 36 和 Build Tools 36.0.0。Gradle wrapper 校验官方 SHA-256，不应删除校验以绕过下载失败。如果网络返回了错误页面，重新下载官方分发文件并核对 checksum。

先构建 Web，再运行 `android/gradlew :app:assembleDebug :app:lintDebug`。正式 APK 使用自己的 release 签名，仓库不存放签名密钥。Debug APK 的 WebView 调试仅在 debug 构建启用。应用关闭备份；原生 `ConnectionStore` 使用 Android Keystore 中的 AES 密钥加密连接资料，并保存于应用私有偏好设置，通过桥接提供给 WebView。Web 层仍有会话及兼容浏览器的本地状态，不能将其描述为整个令牌生命周期仅存在于 WebView 或从不进入 Web 层。

HTTP 支持用于用户配置的局域网服务；通过互联网请配置 HTTPS。Android System WebView 应保持更新，文本分享会填入当前会话草稿，发送仍由用户触发。


容器构建在 PWA 产物生成后写入 `/build-identity.json`，将应用版本、对应源码归档摘要、PWA 指纹及完整 Web 文件摘要关联。验收会拒绝缺失身份、错误版本/源码、旧页面和被替换的脚本；仅能下载任意非空 JavaScript 不算通过。使用 `--image` 验收既有镜像时也执行同样检查，所以旧镜像缺少清单会明确失败。

无缓存构建失败或超时时，脚本保留最多 8 KiB 的脱敏构建诊断到 `artifacts/container-build-diagnostics.log`，CI 在失败时上传该文件。不会打印或上传运行中容器日志，避免泄漏本次生成的测试访问密钥；卷部分创建失败也进入本次资源清理流程。
