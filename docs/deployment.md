# 部署与构建

## 本机服务

建议单独系统用户运行，工作目录设置为实际允许的项目父目录。保留 `.remote-agent` 数据及该用户的 Codex 登录目录。服务退出不自动重复执行请求；下次消息恢复同一 Codex thread。

生产命令：

```bash
npm ci && npm run build
cargo build --locked --release
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

仓库提供 Dockerfile 与 compose.yaml。容器以 UID 10001 运行，挂载的工作目录需对该用户可写。

```bash
mkdir -p workspace
python3 scripts/source-archive.py
docker compose build
docker compose run --rm --entrypoint codex anywork login --device-auth
docker compose up -d
```

Codex 账号保存在独立命名卷中，数据和工作区分别挂载。compose 默认只发布到主机 loopback。外部 Agent 插件的可执行文件和运行依赖需要在镜像里安装，JSON 清单不是自动安装器。

当前开发机没有 Docker；Docker/compose 配置作为可审查部署配套提供，未声称已在本机实际构建镜像。

## Android

使用 JDK 17、Gradle wrapper 8.14.2、Android API 35 和 Build Tools 35.0.0。Gradle wrapper 校验官方 SHA-256，不应删除校验以绕过下载失败。如果网络返回了错误页面，重新下载官方分发文件并核对 checksum。

先构建 Web，再运行 `android/gradlew :app:assembleDebug :app:lintDebug`。正式 APK 使用自己的 release 签名，仓库不存放签名密钥。Debug APK 的 WebView 调试仅在 debug 构建启用。应用关闭备份，令牌保存在应用私有 WebView 存储中。

HTTP 支持用于用户配置的局域网服务；通过互联网请配置 HTTPS。Android System WebView 应保持更新，文本分享会填入当前会话草稿，发送仍由用户触发。
