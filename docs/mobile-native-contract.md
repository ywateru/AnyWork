# Mobile native interface v1

所有 DTO 使用 camelCase。模块内部通过 Rust 类型共享；JS 只能取得账号摘要、目录、句柄和业务响应，不取得凭据。下面的命令是实现边界；新增行为须同步本契约。shell owner 维护 Cargo、lock、lib.rs 和 Tauri 注册，模块作者不同时修改这些共享文件。

## Account

`mobile_account_snapshot` 返回 `{protocolVersion:1, epoch, phase, account?, devices, directoryState, revision}`。phase 为 signedOut/signingIn/signedIn/reauthRequired，account 包含 `scopeId,label,email?`，不输出 subject。设备包含 `deviceRef,installationId,label,platform,publicKey,keyVersion,online`，online 可未知；snapshot 含可信 key 或确认状态供核验页使用。

- `mobile_account_login({signup})`：启动独立内嵌授权 Activity，完成返回新 snapshot；取消是独立结果。
- `mobile_account_cancel`、`mobile_account_logout`：阻止迟到授权恢复，退出清理所有连接。
- `mobile_account_refresh`：读目录并返回新 snapshot，不自动登录。
- `mobile_account_device_update({deviceRef,expectedRevision,label?,remove?})`：保留未知 customData，写后核对；冲突显式失败。
- `mobile_transport_connect({deviceRef,expectedRevision,keyConfirmation?})`：账号层构造内部 `VerifiedTarget`，确认绑定当前 epoch/revision/publicKey，成功后保存信任。

AccountService 为 transport 提供 `VerifiedTarget {url,installation_id,public_key:[u8;32],scope_id,lifetime:CancellationToken}` 与 `Arc<dyn TransportAuthorization>`，二者不 Serialize。授权 trait `token(force_refresh,min_validity_secs)` 返回仅原生可见的 token。目录目标解析、信任接受和 connect 的具体方法由 account/transport 两位作者协同冻结，shell 仅转发。当前部署使用电脑既有 Native client 的 Native device session，不调用 SPA console 路由。应用 grant 仅内存，IdP SSO cookie 另由官方 SDK/WebView 管理；进程重启不自动恢复 grant。stable scopeId 由 issuer/subject 确定，epoch 只作异步栅栏，不充当草稿命名空间。

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
