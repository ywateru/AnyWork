# AnyWork 项目说明

## 项目用途与范围

AnyWork 将开发机器上的编程 Agent 接入 Web/PWA 和 Android，任务继续在开发机器运行。服务端使用 Rust，界面采用 React + TypeScript，Android 使用原生 WebView 宿主复用 Web 构建。

当前已接入 Codex、受支持的 DeepSeek Harness gateway 与本机历史；WorkBuddy 历史可读，共享写入仍属实验。Claude Code、Cursor 尚无内置生产适配器。版本、拓扑和原生验收边界统一见[支持矩阵](support-matrix.md)。服务面向个人或可信设备，不提供多租户权限隔离。

## 主要能力

- 从真实 Codex 会话读取工作目录，按目录默认分组，展示同目录下多个会话与归档历史。
- 支持创建及管理会话；普通会话在原引擎支持共享控制时直接对话、引导、停止及审批，无需 fork。
- 执行中发送后选择排队或引导；队列持久化，支持编辑、删除、暂停和恢复，停止或服务重启后暂停自动出队。
- 最新历史优先展示，向上分页；大工具结果按需读取。当前状态来自引擎快照与通知，执行、等待回应、连接中分别展示。
- 输入栏通过“添加”菜单上传文件、选择远程文件、管理原生持续目标和切换计划模式，仅提供这四项菜单功能。
- 支持图片粘贴、上传时本地缩略图；历史图片、imageView 和已提交队列默认折叠，点击后加载，支持缩放与手机手势。
- 提供文件浏览与编辑、Git 差异、PTY 终端、六种颜色主题及深浅外观。

无法连接原引擎时不会静默启动竞争执行进程；任务状态无法确认时显示未知，不根据旧历史猜测运行中。

## 本地启动

依赖 Rust stable（edition 2024）、Node.js 22+、npm，以及所选 Agent 已初始化的原生入口。Harness 的 pinned 版本另需 Node ≥24.9。Android 构建另需 JDK 17、Android SDK API 36 和 Build Tools 36.0.0。

在仓库根目录执行：

```bash
npm ci
npm run build
cargo build --locked --release
python3 scripts/source-archive.py
./target/release/anywork --workspace /absolute/path/to/projects
```

浏览器打开 `http://127.0.0.1:3210`，使用本机 `.anywork/access-token` 登录。连接令牌用于访问 AnyWork；Codex 沿用运行服务的系统用户已有的登录凭据，两者不同。

旧部署默认复用 `.remote-agent/`；新旧数据目录同时存在时采用 `.anywork/`。启动、参数和环境变量完整说明见 [README](../README.md)。新安装的服务数据保存在 `.anywork/`，迁移或备份时应保留数据目录及原系统用户的 Codex 数据，不要提交这些文件。

## 远程访问与后台运行

互联网访问应使用 HTTPS 反向代理、VPN 或 HTTPS 隧道，浏览器和 Android 填写相同的服务器地址。终端与文件操作使用服务端系统用户权限，仅向可信设备提供令牌。

可选的 Supervisor 配置：

```bash
cp supervisord.example.conf supervisord.conf
# 修改工作区、工具路径；需要公网隧道时再启用对应进程
bash scripts/service.sh start
bash scripts/service.sh status
bash scripts/service.sh restart anywork
```

需事先安装 Supervisor；启用隧道还需安装 cloudflared。仅重启 `anywork` 可保留正在运行的隧道；重启临时隧道可能改变公网地址。模板不代表已设置系统开机启动。详细部署见 [部署说明](deployment.md)。

## 开发、验证与交付

```bash
./scripts/check.sh
npm run format:check
./scripts/build-android.sh
./scripts/package.sh
sha256sum -c artifacts/SHA256SUMS
```

浏览器测试首次运行前需安装 Chromium：`npx playwright install chromium`。测试使用隔离服务和确定性插件，不向真实会话发送消息。公网验收应优先只读，操作验证使用专门新建的隔离会话。

交付包位于 `artifacts/`，包括 Linux 服务与 Web、Android debug APK、对应源码及 SHA-256 校验文件。构建产物不进入 Git。Android 已通过构建和 Lint、手机尺寸浏览器验证，尚未完成实体设备安装验收；Docker 配置尚未在本机实际构建验证。各阶段结果见 [验收记录](validation.md)。

## 源码结构与扩展

| 目录 | 职责 |
| --- | --- |
| `crates/server` | API、SQLite、事件与队列、原会话发现与控制、文件与终端 |
| `crates/agent-sdk` | 插件清单与 JSON-RPC 传输 |
| `crates/agent-codex` | Codex 启动及审批映射 |
| `web` | 浏览器、PWA 与 Android 共用界面 |
| `android` | Android 宿主与系统桥接 |
| `scripts`、`e2e` | 构建、打包及隔离验收 |
| `docs` | 架构、协议、接口、调研与运维说明 |

新增 Agent 应实现 [插件协议](plugin-protocol.md)，通过管理员安装的进程清单接入，复用 Web 和 Android。详细设计见 [架构](architecture.md)、[API](api.md)、[界面设计](ui-design.md)、[普通会话同步调研](session-sync-research.md)及 [功能边界](features.md)。

## 版本管理与许可证

Git 保存源码、锁文件、测试、配置模板及文档。访问令牌、Codex 登录信息、数据库、上传附件、本机 Supervisor 配置、签名密钥、依赖缓存、参考仓库、截图及发布包均不提交。开源发布和源码归档规则见 [发布说明](releasing.md)。本机插件安装清单也不随源码分发。

项目采用 AGPL-3.0-only，复用 HAPI 和 AgentOS 的来源与许可证见 [NOTICE](../NOTICE)。修改并运行网络服务时同步更新对应源码归档，部署的 `/source` 提供源码下载。仓库不包含参考仓库完整检出。
