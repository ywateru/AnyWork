# 登录设备修订与 CyberGrid：合并检查

日期：2026-11-12，Asia/Shanghai。此记录仍在交付中，不表示已经发布。

登录、设备命名与窗口候选通过[独立修正轮验收](ui-login-device-followup.md)后合入 main `37b5d4d`。独立审查接受源码修正和实际原生控件证据；真实拖动位移仍是输入环境限制，不能记为通过。真实 provider SSO 研究也不等于候选 Native 登录全 runtime 验收。

该合并状态执行：Web 353 项单测与 8 项 private-state 通过；Web typecheck、format、Web 与 desktop UI build、官方 SDK account-entry 检查通过。账号、desktop-login-device、desktop-tunnel、desktop-v2 的 Chrome desktop/Android Web 共 **56 项 E2E 通过**，耗时 1.4 分钟。使用隔离端口 3346、合成业务服务及 Native 边界，不操作用户账号、安装应用或运行服务。证据为忽略的 `artifacts/ui-login-merged-*`，没有重复生成 Cargo target。

随后合入已[独立接受的 Web SDK](cybergrid-v080-web.md) `a7fb33f`，四模块固定 CyberGrid v0.8.0 源码；新的合并检查与 Native SDK 适配尚待完成。服务端维持现有固定绑定及 TLS Redis，不把 SDK 更新写成服务端切换。

最终发行必须等待 Native SDK 候选独立接受、合并集成检查、精确源码 CI、不可变发行和线上身份核验。本轮不以旧版本 v0.1.26 的成功记录替代这些门槛。
