# Mobile native interface v1

所有 DTO 使用 camelCase。模块内部通过 Rust 类型共享；JS 只能取得账号摘要、目录、句柄和业务响应，不取得凭据。下面的命令是实现边界；新增行为须同步本契约。shell owner 维护 Cargo、lock、lib.rs 和 Tauri 注册，模块作者不同时修改这些共享文件。

## Account

`mobile_account_snapshot` 返回 `{protocolVersion:1, epoch, phase, account?, devices, directoryState, revision}`。phase 为 signedOut/signingIn/signedIn/reauthRequired，account 包含 `scopeId,label,email?`，不输出 subject。设备包含 `deviceRef,installationId,label,platform,publicKey,keyVersion,online`，online 可未知；snapshot 含可信 key 或确认状态供核验页使用。

目录刷新以 unknown 结束时，设备页提供可展开的“诊断详情”，仅显示明确白名单内的 `snapshot.errorCode`；不显示未知字符串、SDK 错误、响应体、URL、账号身份或授权材料。无可用白名单码时提示重新检查，不据此推断失败阶段。原生在该次刷新仍属于当前 epoch 的 unknown 终态记录同一白名单码，固定前缀 `AnyWorkDirectory:`，其它错误统一为 `MOBILE_OPERATION_FAILED`。现有刷新返回值/终态事件为诊断依据；额外 `snapshot()` 会重新应用授权状态，不能用它保证读取上一轮 coordination 错误。诊断不将 unknown 变为 offline/online，不解禁连接，不自动登录或重放业务。

- `mobile_account_login({signup})`：启动独立内嵌授权 Activity，完成返回新 snapshot；取消是独立结果。
- `mobile_account_cancel`、`mobile_account_logout`：阻止迟到授权恢复，退出清理所有连接。
- `mobile_account_refresh`：读目录并返回新 snapshot，不自动登录。
- `mobile_account_device_update({deviceRef,expectedEpoch,expectedRevision,label?,remove?})`：保留未知 customData，写后核对；冲突显式失败。
- `mobile_transport_connect({deviceRef,expectedEpoch,expectedRevision,keyConfirmation?})`：账号层构造内部 `VerifiedTarget`，确认绑定当前 epoch/revision/publicKey，成功后保存信任。

AccountService 为 transport 提供 `VerifiedTarget {gateway_url,installation_id,public_key:base64url字符串,account_epoch,scope_id,lifetime:CancellationToken}` 与 `Arc<dyn TransportAuthorization>`，二者不 Serialize。授权 trait `token(force_refresh,min_validity_secs)` 返回仅原生可见的 token，并提供 ensure_epoch；公钥在握手前严格解码/校验32字节。目录目标解析、信任接受和 connect 的具体方法由 account/transport 两位作者协同冻结，shell 仅转发。当前部署使用电脑既有 Native client 的 Native device session，不调用 SPA console 路由。应用 grant 仅内存，IdP SSO cookie 另由官方 SDK/WebView 管理；进程重启不自动恢复 grant。stable scopeId 由 issuer/subject 确定，epoch 只作异步栅栏，不充当草稿命名空间。

## Transport

Rust `TransportService` 不依赖 Tauri。`ConnectionRef={connectionId,generation}`，`ConnectionInfo=ConnectionRef & {scopeId}`。`OperationRef={connection:ConnectionRef,operationId}`；operationId 由前端启动前生成且不重用，Rust wire ID 为递增 rN。

| 命令 | 入参/返回 |
| --- | --- |
| mobile_transport_http_begin | OperationRef + method/path/contentType?/size → void |
| mobile_transport_http_write | OperationRef + offset/base64 → {received} |
| mobile_transport_http_finish | OperationRef → {status,contentType?,size} |
| mobile_transport_http_read | OperationRef → {base64,done} |
| mobile_transport_cancel | OperationRef → void；支持早于 begin 的取消 |
| mobile_transport_close | ConnectionRef → {cleanupPending} |
| mobile_transport_pty | OperationRef + tagged type open/input/resize/ack/close；open 带 sessionId 和输出通道 |

HTTP 上限与协议一致，32 KiB chunk，单体/连接缓冲有界，最多八 HTTP/two PTY。finish 首版收齐有界响应后返回 head，read 分块取走，到期释放。240 秒从 begin 起算，续期/读写不重置。取消墓碑有界，耗尽拒绝新操作，不淘汰后接受迟到 begin。PTY 输出 `{connection,operationId,sequence,type:ready|data|closed,base64?,code?}`，消费 ACK、有界窗口及超时；ready 前不输入。所有连接/请求有 generation/账号 lifetime 栅栏。

错误 `{code,delivery}`，delivery 为 not_sent/outcome_unknown/response_complete。固定 code 至少覆盖 CANCELLED、LOGIN_REQUIRED、STALE_CONNECTION、INVALID_REQUEST、INVALID_FRAME、LIMIT_EXCEEDED、CONNECTION_CLOSED、AUTHORIZATION_EXPIRED、TIMEOUT、DEVICE_NOT_READY、DIRECTORY_CONFLICT、KEY_CONFIRMATION_REQUIRED。不自动重放未知结果。连接结束主动事件携带 ConnectionRef 和固定 code。事件/终端监听先于操作启动。

`web/src/mobile/NativeTransport.ts` 实现既有 BusinessTransport；正确序列化 FormData/二进制、保留 status/content-type、映射 Abort，close 同时清理监听。其余 UI 不另造 business 请求栈。

## System

独立 mobile-system plugin，仅本地业务窗口可调用。`exportBegin({name,mime,expectedBytes,purpose:save|share})→{handle}`；`exportWrite({handle,sequence,base64})→{received}`；`exportFinish({handle})→{status:saved|cancelled|chooserOpened}`；`exportAbort({handle})`。系统失败为 typed error，不伪装 cancelled。句柄归属当前宿主并有期限；账号退出取消待导出。

`openExternal({url})` 仅合法 HTTPS。`backSetState({canGoBack,blocking})` 与 back event；`insetsGet()` 与 insets event 返回 system bars/cutout/IME 逻辑单位、visible 和 revision。前端 `system.ts` 为单一适配器。前后台事件触发授权与连接核验，不自动恢复写入。权限和实际原生实现由 shell owner 精确记录。

## Shell wire 与平台规则（Tauri 2.12.5 / CLI 2.12.4）

Android 原生入口在创建账号 HTTP client 或启动 Tauri/后台请求前，用 Tao 已初始化的 JVM/Application context 初始化 rustls-platform-verifier。reqwest 0.13 使用 Android 系统信任验证；Gradle 必须携带与 Cargo.lock 中 Android shim 版本一致的官方 JVM AAR，Release R8 保留其 JNI 类。不得以跳过证书/主机名校验或替换为宽松 trust manager 处理初始化失败。初始化失败在启动边界显式终止，不让账号目录先进入 loading 后在 worker 中 panic。

JS 使用公开 `window.__TAURI__.core.invoke(command, {request: DTO})`；无参命令省略第二参数。`app.withGlobalTauri=true` 提供 `event.listen` 和 `core.Channel`，PTY Channel 放在 `request.onEvent`。不使用 `__TAURI_INTERNALS__`。仅 main 本地 capability 授权账号/transport 和 mobile-system 的精确命令、core event listen/unlisten；auth Kotlin 插件无 JS guest 权限。build.rs 从同一命令列表生成 ACL，不给远程 origin 授权。

随包入口 `https://tauri.localhost/mobile.html`、`frontendDist=../../web/dist-mobile`、`useHttpsScheme=true`。Rust WS 固定 Origin `https://tauri.localhost`，不接受 JS URL/Origin。业务 WebView 导航只接受此 origin；CSP 允许本地脚本、IPC、blob 图片/PDF，拒绝远程脚本、frame 及表单提交。外链通过 `plugin:mobile-system|open_external`，仅合法 HTTPS。

系统命令为 `plugin:mobile-system|export_begin/export_write/export_finish/export_abort/open_external/back_set_state/appearance_set/insets_get`。`export_write.received` 是累计字节数；句柄10分钟期限、64KiB decoded chunk、22MiB文件、最多2个驻留句柄（含等待保存及分享保留文件）。保存 picker 由非导出 Activity 承载，取消/退出关闭自身 chooser，迟到结果不恢复句柄；分享仅返回 chooserOpened，退出/到期撤销临时 URI 授权并删除专属cache。进程重启清理专属 `anywork-exports` cache，绝不遍历或删除用户选择的目标文件。

事件通过公开 event.listen：`mobile-system-back` 返回 `{eventId,revision}`，单调eventId；UI处理后调用 back_set_state `{canGoBack,blocking,handledEventId}`，包括仍停留在脏编辑确认的情况。IME由原生先消费。1500ms未ACK不自动退出，下一次物理返回交系统；等待ACK期间的重复按键不重复派发。root原生结束当前 Activity，不走WebView URL历史。

`mobile-system-insets` 和 `insets_get` 返回 `{unit:"cssPx",systemBars:{top,right,bottom,left},cutout:{...},ime:{...},imeVisible,revision}`。Android物理像素除实际WebView scale（含density/page scale，未就绪fallback density）转CSS px；UI不再按density乘除。main使用edge-to-edge、adjustNothing，不给WebView加原生padding；IME是完整遮挡高度，UI各边取systemBars/cutout的max、bottom再取IME的max，只应用一次。实际APK visualViewport/中文IME仍须独立验收，若WebView provider消耗部分遮挡则原生改报剩余overlap。

`mobile-system-lifecycle` 返回 `{foreground,revision}`；前台核验授权和既有连接lease，不重新发送业务写入。上传沿用固定Wry onShowFileChooser系统选择器（multiple/ClipData/content URI/cancel）；文件大小在UI/transport请求边界继续校验，Android provider行为、中文名和宿主重建列入APK验收。

系统主题同步使用 `plugin:mobile-system|appearance_set`，参数 `{request:{dark:boolean}}`，返回 `{dark:boolean}`。仅本地 main 获权；UI 挂载及实际 `data-theme` 变化时同步。原生按 UI 深浅设置状态栏和导航栏图标对比度，并在 resume 重用最近值；未收到 UI 值前使用 Android 系统默认。实际图标对比度仍须 APK 视觉验收。


### 关闭通知与导出取消收口

PTY数据仍用64项有界队列，溢出关闭peer；最终connectionClosed不进入该数据队列，由sink同步移除对应connectionId/generation路由并通知main，避免队满丢失终止事件。

保存provider I/O在独立copy worker运行，最多一个active copy；元数据/abort控制worker不等provider写入。exportAbort、账号abortAll与onDestroy都立即退役句柄/待settle invoke，并通过copy取消标记、Android CancellationSignal及后台fd关闭请求释放I/O。每块读取/写入前后及flush后检查取消；迟到完成不能报告saved。某provider忽略取消或已开始的write无法回滚时，已写目标字节保留，逻辑取消仍先确认，copy实际退出前新的finish报告SYSTEM_BUSY，不能宣称文件已回滚或底层I/O必然即时结束。所有清理仅针对自有临时文件，不删除用户目标。
