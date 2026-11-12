# 登录设备修订与 CyberGrid：合并检查

日期：2026-11-12，Asia/Shanghai。此记录仍在交付中，不表示已经发布。

登录、设备命名与窗口候选通过[独立修正轮验收](ui-login-device-followup.md)后合入 main `37b5d4d`。独立审查接受源码修正和实际原生控件证据；真实拖动位移仍是输入环境限制，不能记为通过。真实 provider SSO 研究也不等于候选 Native 登录全 runtime 验收。

该合并状态执行：Web 353 项单测与 8 项 private-state 通过；Web typecheck、format、Web 与 desktop UI build、官方 SDK account-entry 检查通过。账号、desktop-login-device、desktop-tunnel、desktop-v2 的 Chrome desktop/Android Web 共 **56 项 E2E 通过**，耗时 1.4 分钟。使用隔离端口 3346、合成业务服务及 Native 边界，不操作用户账号、安装应用或运行服务。证据为忽略的 `artifacts/ui-login-merged-*`，没有重复生成 Cargo target。

随后合入已[独立接受的 Web SDK](cybergrid-v080-web.md) `a7fb33f`，四模块固定 CyberGrid v0.8.0 源码。合并树 `e900de6` 的 **397 Web 单测 + 8 private-state**、typecheck、format、Web build 全通过；6 项 account-unified desktop/Android Web E2E 通过。账号布局检查覆盖 1440/800/390、480 高度及 390×320：登录、设备目录、四类对话中心、滚动、焦点、取消与 touch shell 的 192px 历史列表通过。证据在忽略的 `artifacts/cybergrid-web-merged-*`。

布局验证第一次未启动 Vite 得到 connection-refused，第二次因给只支持根路径模块拦截的夹具传入 `/app/` Vite base 而找不到页面标题；修正为夹具要求的根路径开发服务后完整通过。没有修改产品或放宽断言。Vite 仅绑定 127.0.0.1:3347，外部认证/协调均由合成路由拦截；验证后已按核对过的 PID 停止。E2E 使用隔离 3348 服务。Native SDK 适配与最终检查尚待完成。

服务端维持现有固定绑定及 TLS Redis，不把 SDK 更新写成服务端切换。已保存本次作者/审查证据后删除五个已结束工作树及已合入的作者分支，约释放 347MiB；保留正在开发的 Native SDK 工作树和共享 Cargo target，未清理用户数据或无关工作树。

最终发行必须等待 Native SDK 候选独立接受、合并集成检查、精确源码 CI、不可变发行和线上身份核验。本轮不以旧版本 v0.1.26 的成功记录替代这些门槛。
