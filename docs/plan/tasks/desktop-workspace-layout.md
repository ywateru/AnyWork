---
id: desktop-workspace-layout
scope: desktop-ui-access-guidance
status: complete
depends-on: [account-unified-experience]
---

# 桌面控制台布局与访问说明

落实[桌面布局契约](../../desktop-workspace-layout.md)：优化整个客户端的信息层级，展示真实本地地址、可复制的无凭据根地址、本机会话使用条件，以及本地/账号远程的工作原理。保留现有认证、安全交接和服务生命周期。

作者范围：`desktop/ui/`、相关 `e2e/desktop-*` 和定向验证脚本。尽量不修改 Rust、Web 工作区、云端配置或业务协议。确需接口变化先报告具体原因；不自行扩大范围。独立审查检查布局、地址推导、复制/打开行为和账号/更新回归后合并。最后构建并验证新 Native，安全更新本机客户端，保留运行中的既有服务、凭据和数据。GitHub 推送按本会话已授权的项目更新范围执行；不发布公开安装包或重新部署网站。

交付记录包括源码提交、截图、实际检查、独立结论和本机客户端采用结果；不把模拟 IPC 截图当作真实登录或远程链路证明。

## delivery

产品源码固定于 `fa40ba19b5a3e7936d36e224f7cc2b62d47c363c`，仅改动桌面 UI；Rust、业务 Web、授权控制器和远程协议未变化。[作者检查](../reviews/desktop-workspace-layout-author.md)和[独立源码/界面审查](../reviews/desktop-workspace-layout-independent.md)均通过：生产构建、TypeScript、62 个桌面交互场景、账号入口和更新回归，以及四种尺寸和状态的视觉检查。

新版 Native 已安装并运行于 `/Applications/AnyWork.app`。采用过程仅原子替换界面程序、对应源码包和签名记录；现有服务 PID28102 及其可执行文件 inode、路径、环境、配置、凭据保持不变，没有停止或重启服务。实际 Mac/WKWebView 界面已确认本地地址 `http://127.0.0.1:3210/`、两栏入口和工作原理；点击复制后显示“本地地址已复制”，立即在内存中比较本次剪贴板与预期根地址，结果相同，仅记录布尔值。没有打开真实业务工作区、登录账号或开启远程访问。实际交付与独立核对见[本机上线记录](../reviews/desktop-workspace-layout-live.md)。
