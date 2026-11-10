---
id: account-unified-experience
scope: desktop-local-web-hosted-web-android-account-entry
status: in-progress
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
