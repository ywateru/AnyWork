# Security / 安全

AnyWork runs with its host user's filesystem and terminal permissions. It is intended for personal workspaces and trusted devices. Use HTTPS or a VPN outside a trusted LAN; protect the access key and model-provider credentials separately.

AnyWork 使用宿主系统用户的文件与终端权限，面向个人工作区和可信设备。跨越可信局域网时使用 HTTPS/VPN，分别保护访问密钥与模型服务凭据。

Report vulnerabilities using this repository's **Security → Report a vulnerability** private reporting feature. If private reporting is unavailable, open an issue containing only a request for a private contact; do not publish exploit details, secrets or personal histories. Do not send a live token to demonstrate a problem.

请通过仓库 **Security → Report a vulnerability** 私密报告漏洞。如入口不可用，仅创建请求私密联系方式的问题，不要公开利用细节、凭据或个人会话。无需发送真实令牌证明问题。

Version 0.1 is the initial supported release line. Fixes and security notes are published in GitHub Releases. There is no guaranteed response SLA.

当前支持初始 0.1 版本线，修复与安全说明通过 GitHub Releases 发布，暂无响应时间承诺。

## Known upstream dependency / 已知上游依赖

The Linux desktop manager currently inherits `glib 0.18.5` through Tauri's GTK 3 stack. GitHub advisory [GHSA-wrw7-89jp-8q8g](https://github.com/advisories/GHSA-wrw7-89jp-8q8g) describes undefined behavior in `VariantStrIter`, fixed in glib 0.20. AnyWork's own source does not call that iterator; reachability through the complete desktop stack has not been exhaustively verified. The alert remains open. A direct minor-version bump is incompatible with the GTK 3 dependency line. The standalone Rust server and browser client do not require the GTK/glib desktop stack.

Linux 桌面管理器通过 Tauri 的 GTK 3 依赖引入 `glib 0.18.5`。上述中等级别上游通告涉及 `VariantStrIter` 未定义行为，修复版本为 glib 0.20。AnyWork 自身源码没有直接调用该迭代器，但尚未穷尽验证桌面依赖的可达路径，告警保持开启。直接跨版本替换不兼容现有 GTK 3 依赖线。独立 Rust 服务与浏览器客户端不依赖 GTK/glib 桌面栈。
