# AnyWork 0.1.3 DMG 与隧道修正验收

日期：2026-11-06。发行源码：`f06f9917e2c5d306be70560bbe38a442bd567a51`。

## 正式发行

- [Release v0.1.3](https://github.com/ywateru/AnyWork/releases/tag/v0.1.3)。
- [多平台发版构建：成功](https://github.com/ywateru/AnyWork/actions/runs/42193178166)。
- [全量 CI：成功](https://github.com/ywateru/AnyWork/actions/runs/42193177732)。Rust 111 项、Web 291 项、浏览器 495 项通过（浏览器另跳过 1 项）；Python 集成、Clippy、格式检查和桌面更新 UI fixture 均通过。
- [发行后的官网部署：成功](https://github.com/ywateru/AnyWork/actions/runs/42194591480)。
- Apple Silicon：`anywork-macos-arm64.dmg`，33,732,091 字节。
- Intel：`anywork-macos-x86_64.dmg`，33,609,220 字节。
- 两份 DMG 替代 Mac 手动下载 ZIP。签名 `.app.tar.gz` 更新包及各自 `.sig` 保留在同一次发行内，`latest.json` 仍覆盖五种桌面架构。

## 安装盘验收

本机与两个对应架构的 macOS Actions runner 均执行 `scripts/check-macos-dmg.py`：

- 磁盘映像通过 `hdiutil verify`，只读挂载并在检查后推出。
- 根目录包含 `AnyWork.app`、指向 `/Applications` 的 `Applications` 链接及 `INSTALL-macOS.txt`。
- 文本文件逐字节匹配仓库的中英文安装说明，包含 `sudo xattr -cr "/Applications/AnyWork.app"`，明确先拖入应用程序及密码输入方式。
- 应用版本为 0.1.3，主程序路径为 `Contents/MacOS/anywork-desktop`。
- 桌面程序与内置 Server 的处理器架构正确，Server 的 `--version` 与发行版一致。
- 应用通过 `codesign --verify --deep --strict`；当前使用临时签名，未做 Apple 公证。
- Server、Web、对应源码、许可证等资源完整；应用内 434 个普通文件的 SHA-256 和权限逐一匹配同架构的签名自动更新压缩包，文件列表和符号链接也匹配。
- 任一 Mac 的 DMG 缺失或为空时，更新清单发布检查拒绝继续。

## 官网验收

本地 Chrome 覆盖中英文各 1440、1024、768、390、320 像素布局；语言自动识别、手动选择记忆、标签键盘操作、版本元数据乱序防倒退均通过。新增下载用例验证有 DMG 时优先使用 DMG，仅有旧版 ZIP 时继续可用。

正式上线后，实际访问语言中立入口：`zh-CN` 浏览器进入 `/zh/`，`en-US` 进入 `/en/`，两种页面的两个 Mac 下载按钮均指向 v0.1.3 对应 DMG。

## 匿名隧道诊断与修正

复查用户正在使用的连接时，原 cloudflared 进程仍在运行，其本机 `/ready` 返回一条有效边缘连接，源站代理错误计数为 0。公网健康接口分别经直连和系统代理返回 HTTP 200，应用使用的 Rust 认证验证代码连续三次成功。没有停止、重启或替换用户的现有服务与隧道。

旧版将非身份拒绝的错误全部替换成同一句“等待网络和 TLS 恢复”，且未持久保存当时的详细传输错误，因此不能据复查结果断言最初失败的唯一原因。已确认并修正代码中的恢复与诊断缺陷：

- 显式启用系统代理支持。远程连接建立限时 5 秒，完整请求限时由 5 秒调整为 12 秒。
- 原本只在连接或超时错误后直连重试；现在默认连接出现临时 HTTP 错误或异常响应时，也执行完整的直连认证验证。
- 分别归纳超时、TLS、DNS、HTTP 和响应格式错误，展示默认连接与直连重试各自的安全原因，不输出原始 URL、访问密钥或代理响应内容。
- HTTP 401/403 与服务身份不匹配仍会拒绝连接。临时网络故障保留原进程和已验证地址，继续自动恢复。

本地桌面单测 32 项通过；另有 4 项需外部环境的测试默认忽略。新增用例覆盖代理 HTTP 502、代理返回 HTML、访问密钥拒绝、超时、无法连接与错误信息去敏。Clippy 全目标无警告。单独显式运行真实 Cloudflare 匿名隧道测试，通过隔离本地服务完成申请、TLS 与服务身份验证，39 秒通过并清理测试进程。发版的每个桌面平台均通过对应原生测试。

## 正式附件下载校验

从 v0.1.3 Release 实际下载两份 DMG、`latest.json` 及 `SHA256SUMS`，本机计算 SHA-256 与发行校验值逐项一致：

| 文件 | SHA-256 |
| --- | --- |
| `anywork-macos-arm64.dmg` | `5a21ce5c6cbae6ab097379a5902027684fb025563796d01bb0ea11449ee528e8` |
| `anywork-macos-x86_64.dmg` | `e785037c4359635175422976989b4e210557b786d01420a24c5a31912c704e39` |
| `latest.json` | `62eba99b31f6de7e8d135febf829885722f7e7c14a19aa310ee66cc79760745b` |

读取正式 `latest.json`，五种桌面平台的 URL 均指向 v0.1.3，签名的版本注释均为 0.1.3。
