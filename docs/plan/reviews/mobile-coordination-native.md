# 移动端协调同步恢复：Native 源码调查

调查基线 `b110681`，任务见[移动端协调配置与同步恢复](../tasks/mobile-coordination-recovery.md)。本轮先核对源码，再决定是否实施；没有运行 Cargo、安装依赖或操作设备/模拟器、真实宿主、云。本文是 Native 作者的源码调查，不是新的连接验收。

## 初步结论与实施建议

目前没有发现足以将已记录故障归因为 Native 请求参数、错误端点选择或 TLS 初始化的明确客户端 bug。保持现有实现，暂不提交行为补丁。历史实体证据是：Android 原平台 verifier panic 已消失；正常账号读取后，SDK `auth_config()` 返回固定阶段码 `MOBILE_COORDINATION_CONFIG_FETCH_FAILED`；同手机公开配置请求在 DNS 成功后、TCP建立前超时，而登录域名可用，主机端真实锁定 SDK 配置 roundtrip 成功。这支持到协调域名的路线问题，但不证明供应商内部原因，也不排除本轮出现新的可观测失败。

不建议把增加重试、缩短或延长超时、替换根证书、跟随重定向、强制IPv4、硬编码IP、变更endpoint或强制online当作修复。现有真实网络证据不能靠调整响应解析解决。应等待独立 verifier/route lane 的当前路线对照；若网络可达但Native仍失败，先取得安全错误分类再提出有针对性的补丁。

## 锁定实现与调用顺序

`Cargo.lock` 将 CyberGrid SDK 固定为 `f2a3961536e5c69b13c7dbc661953d9243becbae`，本机checkout HEAD已核对一致。SDK 0.3.0 的 reqwest锁定为0.12.28；AnyWork账号读取为另一份reqwest0.13.5。没有将两个HTTP client混为同一TLS实现。

[grid.rs](../../../crates/mobile/src/account/grid.rs) 的 `devices`：

1. 锁定当前账号的NativeDirectory；检查epoch，不允许旧账号目录混用。
2. 第一次创建SDK client时显式设置 `base_url = handle.config.grid_url`、`app_id = handle.config.client_id`，关闭iroh/STUN/cloudflared。不会采用SDK默认的另一个base URL，也不创建console client。
3. 安装既有内存AuthProvider；仅安装provider不触发token请求。
4. 先调用SDK `auth_config()`，任何该调用的错误统一映射为 `MOBILE_COORDINATION_CONFIG_FETCH_FAILED`。
5. 成功后才把typed配置序列化交生产EndpointPolicy解析，再核epoch、注册Native device session、核subject/purpose/app/product，最后查询SDK devices。

因此该固定码对应失败路径尚未进入第5步；不能归因于AuthProvider force-refresh guard、注册session或工作区握手，也不能把这些后续阶段写成已验证。

## 实际HTTP、超时与重试

固定源码：[SDK auth.rs::auth_config](https://github.com/ywateru/CyberGrid/blob/f2a3961536e5c69b13c7dbc661953d9243becbae/sdk-rust/src/auth.rs#L360)、[client.rs::Client::new](https://github.com/ywateru/CyberGrid/blob/f2a3961536e5c69b13c7dbc661953d9243becbae/sdk-rust/src/client.rs#L142)、[client.rs::http_json](https://github.com/ywateru/CyberGrid/blob/f2a3961536e5c69b13c7dbc661953d9243becbae/sdk-rust/src/client.rs#L530)。

- URL由显式base URL加 `/api/v1/auth/config` 构成，用URL query API编码 `appId`。不是 `clientId`；没有手拼未编码账号值或发送登录凭据。
- 调用为GET、无body、`auth=false`，不附加session Authorization或X-CyberGrid-Epoch，也不调用账号token provider。响应体上限 `2 << 20`，分chunk读取并检查总量。
- SDK client设置35秒总请求超时及 `redirect::Policy::none()`；没有设置独立connect/read timeout，SDK Config的direct/fallback/iroh超时也不是此HTTP请求的超时。35秒覆盖DNS/连接/TLS/HTTP响应体等请求阶段。
- `http_json`没有围绕公开配置的应用级重试循环。SDK未显式关闭reqwest0.12.28默认的安全协议NACK重试；其默认classifier不是把任意HTTP503或TCP超时无限重放。429/503会记录Retry-After供SDK恢复流程使用，但本次auth_config仍按错误返回。不要声称底层绝对只有一个wire attempt，也不要以此未经复现地判为本次连接超时根因。
- AnyWork账号HTTP另有10秒connect/30秒total、redirect none、retry never；这些设置不会传递给SDK内部HTTP client。

历史36.6秒手动刷新观测包含profile/Account读取和ADB轮询，与35秒SDK总上限相容；不能用它精确测量TCP耗时或断言发生过几次底层attempt。

## TLS、DNS与代理边界

[SDK Cargo.toml](https://github.com/ywateru/CyberGrid/blob/f2a3961536e5c69b13c7dbc661953d9243becbae/sdk-rust/Cargo.toml#L19) 的reqwest为 `default-features=false`、`json`和`rustls-tls`。reqwest0.12.28源码中 `rustls-tls` 启用 `rustls-tls-webpki-roots`，client构建将WebPKI根加入rustls RootCertStore；默认保留证书链、SNI和主机名验证。SDK没有调用danger_accept_invalid_*、自定义宽松verifier或DNS/IP覆盖。

这条SDK路径不使用账号reqwest0.13的rustls-platform-verifier/JVM shim；因此不能把此前Android verifier未初始化panic当作当前SDK auth_config错误的解释。两者共用rustls crypto provider不意味着共用证书验证器。

SDK没有显式配置代理或禁用代理，保留reqwest默认系统/环境代理探测。主机端HTTP成功或Rust探针成功本身不能证明与手机走同一路线；需由route lane与独立verifier按各自授权环境核对。没有读取或记录任何本机代理凭据、系统网络配置或用户账号。

## 状态、解析与配置校验

`http_json`先按2MiB上限读取body，非2xx返回SDK Api错误，仅接受有界固定格式的错误code；3xx因不跟随重定向，也按非2xx失败。成功HTTP后才serde反序列化AuthConfig。配置请求不要求已登录设备的epoch响应头。

[SDK AuthConfig::validate](https://github.com/ywateru/CyberGrid/blob/f2a3961536e5c69b13c7dbc661953d9243becbae/sdk-rust/src/auth.rs#L126) 校验：支持的loginFlow、admission版本/时限、endpoint policy、合法canonical product及完整product policy、Logto provider、显式Native appId匹配、HTTPS issuer/resource和同issuer origin的OAuth endpoints，以及openid/offline_access/connect scopes。typed Coordination需要完整数值字段，不能仅用protocol/epoch的简化JSON推断真实SDK反序列化通过。

后续auth_config还比较缓存的OAuth/product绑定；绑定变化或同epoch admission消失可失败。当前AnyWork统一映射会隐藏这些细分原因，所以固定fetch阶段码不能直接等同TCP错误。首次client尚无缓存，历史首次登录也失败，不能只假定旧缓存导致。

应用EndpointPolicy还检查固定issuer/client/resource/endpoints、coordination协议和UUID、scope白名单、product与gateway policy等；它在SDK auth_config成功后才执行。其错误通常为MOBILE_COORDINATION_CONFIGURATION或MOBILE_INVALID_ENDPOINT_POLICY，不是当前fetch阶段码。

## 已有测试的价值和限制

- `account/grid_tests.rs::NativeFixture` 走真实锁定SDK，包含完整Coordination字段；断言公开config请求没有Authorization、query恰为appId，覆盖配置、注册和目录失败的安全收敛。它使用loopbackHTTP，不证明Android公网TCP或TLS。
- `account/tests.rs::public_native_configuration_sdk_roundtrip` 用生产默认配置、真实SDK auth_config→serde→EndpointPolicy，检查device_session为空；默认ignored避免CI依赖公网。历史作者已明确执行通过。本轮未重跑，且host结果不能替代手机路线。
- 当前实体和网络事实沿用[独立设备报告](android-device-loading-independent.md)，不是本轮作者新采集；没有操作ADB或读取原始账号/设备数据。

## 最小下一步

目前无生产修复建议，不运行Cargo制造“已修复”印象。若最新设备与route证据仍不足，最小Native诊断补丁可在同一个SDK auth_config错误边界匹配公开Error枚举与reqwest谓词，仅记录固定的timeout/connect/request/body/decode/protocol/api类别或有界HTTP状态；保持现有公共errorCode、endpoint、token和unknown连接门禁。不得格式化SDK任意错误、URL、body或身份，不沿错误source链打印文本。此补丁只改善定位，需协调者决定后再实施并分配共享Cargo窗口。

如果实际证据要求更改SDK HTTP builder、信任根、base URL或依赖rev，先向协调者提出具体复现和契约影响；不直接修改共享Cargo/lock或引入旁路client。作者WT目前仅新增此报告；未修改Native生产源码、根Cargo/lock、前端或部署文件。
