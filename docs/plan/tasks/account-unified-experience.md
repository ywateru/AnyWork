---
id: account-unified-experience
scope: desktop-local-web-hosted-web-android-account-entry
status: complete
depends-on: [account-live-reliability]
---

# 统一账号连接交付

## objective

实施[统一体验契约](../../account-unified-experience.md)：桌面退役独立匿名/固定/WireGuard连接，保留顺畅本地Web与显式账号远程；网页/手机同账号设备入口，无地址/令牌配置。先前反馈文档已交付，当前用户goal明确要求落实改造。

## context

阅读 `docs/INDEX.md`、`docs/account-unified-experience.md`、`docs/account-desktop.md`、`docs/account-remote-protocol.md`、`docs/account-web-layout.md`、`docs/cybergrid-product-feedback.md`。新契约优先于旧文档保留高级连接的历史表述。账号秘密RAM-only、业务内容不进云、单一刷新所有者、无写重放等安全约束保持。

## path

- Native/local lane：`crates/desktop/`、`desktop/ui/`、`crates/server/`（仅本机交接/auth/PTY，不碰业务schema与Agent逻辑）、`scripts/build-desktop.sh`及相关desktop检查脚本；更新`docs/account-desktop.md`和本机接口说明。
- Web/mobile lane：`web/`、`android/`、`scripts/build-android.sh`、相关Web/Android测试；更新`docs/account-web-layout.md`及Android说明。不得修改Native/server文件。按共享本机接口契约对接，不自行改协议。
- Verify lane：独立审查两个提交、真实组合集成、隔离浏览器/Native验证和最终发布/安装产物审查，报告放`docs/plan/reviews/`。
- Root：设计、分工、合并、合并检查、发布/本机更新协调；源码修改均委派，独立审查后合并。

## verification

按设计验收条目逐项出证据。跨层必须走真实调用，渲染mock只证明布局状态，不能替代cookie认证或实际OAuth/设备加密通道。最终交付包括受检源码、Web上线、新Mac产物和可用手机入口；保留不可验证范围与活动用户工作约束，不宣称尚未执行的部署/实机已通过。

## delivery evidence

- [给 CyberGrid 的反馈](../../cybergrid-product-feedback.md)已完成，可独立转发；未自动向上游发送。
- 产品源码冻结于 `113ddba1433e6437f73bdfebc6a4ea1d6e2fa74f`；后续报告提交不改变已构建产物。[独立源码审查](../reviews/account-unified-independent.md)和[合并检查](../reviews/account-unified-merged.md)覆盖 Native/server、Web、Android 与旧连接退役。
- [运行与产物验收](../reviews/account-unified-runtime-artifacts.md)记录实际本机 Cookie/PTY、真实自托管授权的两次续期、精确 Mac/Web 产物审查及测试边界。
- [正式 Web 上线记录](../reviews/account-unified-web-live.md)：正式 `/app/` 已绑定新静态部署，桌面/移动尺寸及图片字节验证通过。
- [Mac 本机上线记录](../reviews/account-unified-native-live.md)：同一冻结源码构建的客户端已安装到 `/Applications/AnyWork.app` 并运行；现有服务已交接至包内二进制。本机 GUI 确认统一入口和正确工作目录；108 条原会话标识、完整 schema、服务凭据、管理器配置和原进程环境均通过上线后核对。旧服务退出等待问题经单独审查的一次恢复处理，未停止无关代理或隧道。

现代 Android 系统浏览器内完整登录回程、实体手机切网/后台恢复，以及 Native 通过公共隧道连接正式 Web 的完整组合，仍不属于已完成的实机验收。本轮不发布新的公开二进制版本；官网保留旧安装包未包含本次更新的说明。
