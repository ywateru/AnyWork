# v0.1.43 桌面远程、手机工作区与登录恢复

状态：调查与实现中。基线 main `15f5c3f`，2026-11-16。

用户报告桌面更新后远程启用错误 `REMOTE_ENABLE_GRID_CONFIG_UNAVAILABLE`，本地“已就绪 · 复用已有服务”仍无法打开；追加 Android 连接后样式严重异常，以及桌面和手机应保存登录、重启无需二次登录。后者明确替代历史仅内存授权要求，契约见[登录恢复](../../login-session-persistence.md)。

## 分工

- `codex/desktop-v43-remote`：调查协调配置请求、启动登录时序和本地服务复用；有证据后修正。随后实现桌面安全保存登录和恢复，负责对应 UI 状态。
- `codex/mobile-workspace-layout`：定位连接后 App 样式加载/作用域，修正已有手机布局，连接工作区截图回归。
- `codex/mobile-login-restore`：Android 安全存储、官方 Logto owner 恢复、轮换和退出生命周期。
- `codex/desktop-v43-review`：独立、只读核对本机安装/服务版本、归属和能力；审查桌面候选及手机布局。
- `codex/login-restore-review`：独立审查桌面/Android 安全保存与恢复，验证实际提交。
- Root：契约、调度、合并、综合检查与交付记录。

## 约束与门禁

区分协调网络失败、本地服务兼容性和登录时序，不因复用就终止服务；不猜 PID，不杀原生 Agent，不中断真实会话。公开探测不含凭据，日志仅固定错误类别，不输出原始 argv、token 或账号资料。协调入口调整须先核对全部 Native 所需路由并保留 issuer/resource/client/product 绑定；不改 DNS、代理、TLS 校验或服务 namespace。

手机沿用[现有布局](../../mobile-client-layout.md)：窄屏全屏工作区及可收起会话列表，工具行和图标保持正常尺寸，正文不逐字竖排。验收必须覆盖已连接会话/文件/终端界面，不能以设备列表正常替代。Claude Desktop 真机执行仍按用户要求后置。

每项候选提交后独立审查，阻断发现交作者修正；仅合并通过项，分别记录源码测试、浏览器截图、平台构建与真实设备未覆盖边界。不把历史发行成功当成本轮通过。
