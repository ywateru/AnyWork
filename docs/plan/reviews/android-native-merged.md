# Android 原生重构与网页账号合并验收

日期：2026-11-13。范围为网页账号显示与隔离修复、Rust/Tauri 2 Android 客户端、手机界面和系统能力、电脑宿主移动 Native client 授权。此前 Claude Desktop 真机桥连接及写入测试仍由用户后续手动执行。

## 源码与独立门禁

账号显示、Android 账号、HTTP patch、transport、手机 UI 和系统壳均有非作者报告，发现与修复过程保留于各报告：

- [网页账号](account-identity-visible-independent.md)：真实 SDK 的 UserInfo、跨标签账号切换、旧 owner cache 和迟到刷新写入。
- [Android 账号](mobile-account-independent.md)与[HTTP patch](mobile-auth-http-independent.md)：官方内嵌 WebView SDK、授权生命周期、固定上游 core 来源与单次 POST。
- [原生传输](mobile-native-transport-independent.md)：真实隔离网关、JS/Rust 联合调用、WSS TLS provider、超时与取消。
- [手机 UI](mobile-ui-independent.md)：草稿 revision、未知回执保护、审批/子会话不重放、预览安全区。
- [系统壳](mobile-shell-independent.md)：满队列关闭通知及慢 provider 取消。

`6554d0c` 的模板 TV 声明删除由非作者确认符合手机产品范围，保留手机 MAIN/LAUNCHER、权限和 FileProvider；主线对应提交为 `5487218`。没有通过关闭 lint 或增加 baseline 忽略该问题。

## 合并检查

| 检查 | 结果与边界 |
| --- | --- |
| Web、mobile、desktop UI 生产构建 | 全部通过，包含 TypeScript |
| Web 单测 | 43文件、440项通过；private-state 8/8 |
| Rust 工作区测试 | 376通过、0失败、8忽略；真实历史、显式联网诊断与实际升级等 opt-in 项保持忽略 |
| Rust 工作区 build、fmt、全 targets 严格 clippy | 通过；clippy以最终lint修复后的完整产品树执行 |
| 前端格式、双语网站构建与响应式检查 | 通过 |
| 源码归档/版本/发布器/Release CI/容器脚本守卫 | 56/56，通过的是隔离 fixture，未冒充真实发布或 Docker 构建 |
| 手机浏览器集成 | 30/30；公开 IPC 合成边界，见[专项记录](mobile-final-integration.md) |
| Android canonical 构建 | arm64 debug assemble、lint（0 error、38 warning）、system/auth/core 11/8/7单测及 APK checker通过 |

严格 clippy 初次发现 host 未使用的 Android parser 和三处嵌套条件；`3561a93`（主线`8c4baab`）限定parser为Android与测试使用，保留Android真实grid校验，三处let-chain保持短路/错误传播/清理顺序。非作者复核通过，mobile36/36回归通过。后续暴露的auth测试`.err().expect()`改用固定失败信息match，不给敏感成功DTO新增Debug（`fae916e`，主线`543ff88`）；非作者复核、auth库测试及完整workspace全targets严格clippy与fmt通过。最终验证产品树与主线零差异，故不重复已绿全量测试，也不为这些等价或仅host/test修正重建APK；正式发行CI仍从精确源码重新构建。未使用整体 allow 或删除验证断言规避门禁。

## APK 来源

产品候选源码 `1ebe60ae63bd7be8c88e250f53a771332cf134bf` 与主线 `5487218` 产品零差异，包含用户名、portal、core、receipt和系统取消/关闭修复。debug APK 为117054564 bytes，SHA-256：

```text
0c24ca3d01738e85ab3397555fc65fbd401b577f0f5891612948b34f77b75f51
```

包名 `dev.remoteagent.app`、versionName0.1.30、versionCode32、minSdk26；包内 Rust arm64库、全部本地HTML/JS/CSS资产及NOTICE、debug证书、ELF/ZIP16KiB检查通过。此为隔离运行候选，正式发行版本、四ABI与签名由 GitHub Release 完成。

## 运行与发布门禁

隔离官方 API35 Google APIs arm64 模拟器的[无账号 APK 独立运行验收](mobile-apk-runtime-independent.md)通过，实际安装字节的 guest SHA-256与上述候选一致。真实本地 Origin/IPC/ACL、离线启动、DocumentsUI 保存并读回、取消、系统分享面板、图片选择器、IME/insets、Back、系统栏深色图标、HTTPS外链、公开内嵌登录页及两次取消、强停后离线重启均已验证。临时输入控件和系统桥合成内容只证明相应原生边界，不冒充远程业务。

没有使用真实账号、旧 AVD 用户数据或在线手机。实体设备、真实账号登录/refresh及目录、真实远程电脑业务、中文 IME、持续后台连接及正式包覆盖安装仍未实测。官方临时镜像/SDK/AVD、自己的 emulator与overlay已全部清理，原SDK和用户资料保留；清理后的可用空间以后续交付记录为准。

发布使用既有一键发布器，只推主线与对应不可变版本tag，不推私人分支。精确源码 Checks、全平台 Release、正式官网与轻量产物核验均是后续发布门禁；当前报告不把旧 v0.1.30 的线上结果计作本轮发布。
