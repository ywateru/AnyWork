---
id: cybergrid-v080
scope: pinned Rust/JS SDK refresh and host compatibility
status: in-progress
depends-on: []
---

## objective

按用户追加要求，将 CyberGrid 正式 v0.8.0 的必要 SDK/宿主适配纳入本次发行。精确范围见 [评估与集成契约](../analysis/cybergrid-v080.md)。Native 适配先等待登录/设备与窗口修订接受并合并；文件无交集的 Web SDK 与 token adapter 可以先从当前 main 隔离实施，合并后共同验收。登录设备任务的发布阶段待本任务合并后一并完成。

## context

- ../analysis/cybergrid-v080.md
- ../../account-desktop.md
- ../../account-remote-protocol.md
- ../../cloud-configuration.md
- ../../releasing.md
- ../../design/desktop-refactor/login-device-followup.md

## path

Native 作者：`Cargo.lock`、`crates/desktop/Cargo.toml`、`crates/desktop/src/**` 及必要 Native 测试、`desktop/CYBERGRID_NOTICES.md`。Web 作者：`web/src/vendor/cybergrid/**`、账号 token adapter 及必要 Web 测试。根代理维护本评估、任务、发行说明和索引；独立审查者维护 review。服务端部署尚不在代码作者本阶段写入范围，待兼容性结论明确后追加精确任务。

## verification

作者提交后独立审查，固定源码、真实 SDK/HTTP 集成和宿主失败边界均须通过。共享 Cargo target 串行使用，不生成多份大型缓存；只操作隔离测试账号和服务。保留旧客户端协议、业务内容加密、RAM-only、手动关闭、dirty draft 与服务所有权约束。合并后执行适当集成检查及精确源码 CI，统一发布并验收 Web/安装包/source 身份。
