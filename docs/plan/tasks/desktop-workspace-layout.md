---
id: desktop-workspace-layout
scope: desktop-ui-access-guidance
status: in-progress
depends-on: [account-unified-experience]
---

# 桌面控制台布局与访问说明

落实[桌面布局契约](../../desktop-workspace-layout.md)：优化整个客户端的信息层级，展示真实本地地址、可复制的无凭据根地址、本机会话使用条件，以及本地/账号远程的工作原理。保留现有认证、安全交接和服务生命周期。

作者范围：`desktop/ui/`、相关 `e2e/desktop-*` 和定向验证脚本。尽量不修改 Rust、Web 工作区、云端配置或业务协议。确需接口变化先报告具体原因；不自行扩大范围。独立审查检查布局、地址推导、复制/打开行为和账号/更新回归后合并。最后构建并验证新 Native，安全更新本机客户端，保留运行中的既有服务、凭据和数据。GitHub 推送按本会话已授权的项目更新范围执行；不发布公开安装包或重新部署网站。

交付记录包括源码提交、截图、实际检查、独立结论和本机客户端采用结果；不把模拟 IPC 截图当作真实登录或远程链路证明。
