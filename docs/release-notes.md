AnyWork brings a local Codex workspace to browsers and Android, with a Rust desktop manager for hosting and connectivity.

AnyWork 将本机 Codex 工作区带到浏览器与 Android，使用 Rust 桌面管理器管理服务与连接。

**Downloads / 下载**

- macOS 14+ Apple Silicon / Intel: ad-hoc signed app, not notarized / 临时签名，尚未公证。
- Windows x64: unsigned portable package, requires WebView2 / 未做发行商签名，需 WebView2。
- Linux x64 / ARM64: portable packages, require GTK 3 and WebKitGTK 4.1 / 需安装运行库。
- Android 8+: signed universal APK / 持久签名通用 APK。
- Web client and corresponding source / Web 资源与对应源码。

Checksums are provided in `SHA256SUMS`. Each desktop archive includes its corresponding source, licenses and a start guide.

所有文件提供 SHA-256 校验值。桌面包内含对应源码、许可证与启动说明。

[English installation guide](https://github.com/ywateru/AnyWork/blob/main/docs/getting-started.md) · [中文安装指南](https://github.com/ywateru/AnyWork/blob/main/docs/getting-started.zh-CN.md)

**Scope / 能力边界**

Codex is the included agent. Desktop hot attach depends on compatible Unix sharing interfaces; Windows uses CLI-backed chats. Full goal operations need a compatible shared engine; the desktop follower supports reading/pausing. Temporary tunnel addresses can change. Voice and closed-browser push are not included.

内置 Agent 为 Codex。桌面热接入依赖兼容的 Unix 共享入口；Windows 使用 CLI 会话。完整目标操作需兼容共享引擎，follower 支持读取/暂停。临时隧道可能换址。暂不含语音与关闭浏览器后的推送。

Independent open-source project, not affiliated with OpenAI. AGPL-3.0-only; see NOTICE for third-party acknowledgements.

独立开源项目，与 OpenAI 无隶属关系。AGPL-3.0-only，第三方来源见 NOTICE。
