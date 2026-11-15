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

## 补充：同部署额外 HTTPS origin 与同源前缀网关

本节仍仅调查源码，没有检查或更改线上部署环境、请求公网、运行Cargo或操作设备。SDK/server引用均为上述锁定提交；部署实际采用的配置与路由仍需route lane确认。以下 `https://entry.example` 和 `/coord` 仅表示候选入口，不是新的已部署地址。

结论：**Rust Native SDK同时支持额外HTTPS根origin与路径前缀，均不需要SDK补丁；若入口还要供现有Web客户端共用，应选额外根origin。** 锁定JS SDK以及仓库内实际vendored JS SDK均拒绝非根baseUrl，所以不能将“Rust支持前缀”扩大为“所有客户端支持前缀”。两种方案都需要显式选择新入口，当前Android的 `Config::default().grid_url` 是编译配置，不会自动发现alias或回退。这里没有修改配置，也没有将源码兼容当作手机网络已恢复。

| 事项 | 同部署额外根origin | 同源 `/coord` 前缀网关 |
| --- | --- | --- |
| Rust SDK `base_url` | 支持 `https://entry.example` | 支持 `https://entry.example/coord` |
| 当前Native应用调用 | `grid_url`可选择该入口，身份参数独立 | 同左；网关必须将 `/coord/api/v1/...` 转至原 `/api/v1/...` |
| 当前Web SDK `baseUrl` | 支持根origin；另需满足console CORS/浏览器策略 | 直接拒绝；仅添加网关不会使当前Web SDK接受该配置 |
| OAuth audience / Native产品 | 保留原issuer、resource、Native clientId、product与策略 | 同左；不能从入口origin或prefix推导新resource |
| 协调状态 | 同一协调状态、epoch与存储命名空间 | 同左；代理应转发至原协调服务，不能另建空目录 |
| 已运行桌面实例 | 可继续使用旧入口 | 可继续使用旧入口；无需让既有实例切换前缀 |

### 精确URL组合与网关覆盖范围

[Rust types.rs::validate_config](https://github.com/ywateru/CyberGrid/blob/f2a3961536e5c69b13c7dbc661953d9243becbae/sdk-rust/src/types.rs#L104) 要求HTTPS、host、无credentials/query/fragment，但不要求根path；只去掉base末尾斜杠。调用不是 `Url::join("/api/...")`，而是字符串拼接，因而不会丢失prefix：

- [auth.rs::auth_config](https://github.com/ywateru/CyberGrid/blob/f2a3961536e5c69b13c7dbc661953d9243becbae/sdk-rust/src/auth.rs#L360)：`{base}/api/v1/auth/config`，query为编码后的 `appId`。
- [client.rs::api](https://github.com/ywateru/CyberGrid/blob/f2a3961536e5c69b13c7dbc661953d9243becbae/sdk-rust/src/client.rs#L628)：`{base}/api/v1{path}`。覆盖POST `/auth/registration/challenge`、`/auth/registration/admit`、`/auth/exchange`，GET `/apps`、旧版 `/devices`，PUT `/devices/self`，POST/GET `/signals`，DELETE `/session`。
- [capabilities.rs::directory_inner](https://github.com/ywateru/CyberGrid/blob/f2a3961536e5c69b13c7dbc661953d9243becbae/sdk-rust/src/capabilities.rs#L33)：`{base}/api/v1/directory`，通过query API附加opaque cursor。
- [client.rs::revoke_exact_session](https://github.com/ywateru/CyberGrid/blob/f2a3961536e5c69b13c7dbc661953d9243becbae/sdk-rust/src/client.rs#L1676)：关闭竞态中的精确旧session清理也直接拼 `{base}/api/v1/session`，没有绕回原root。

因此候选base若为 `https://entry.example/coord`，公开配置恰为 `https://entry.example/coord/api/v1/auth/config?appId=...`。原服务 [service.ts::createService](https://github.com/ywateru/CyberGrid/blob/f2a3961536e5c69b13c7dbc661953d9243becbae/server/src/service.ts#L45) 仅路由根 `/api/v1/`；前缀必须在网关内部去掉，不能原样交给服务，也不能用301/302/307/308让SDK跳转。SDK redirect none会拒绝这些响应。base应是prefix自身，不应再包含 `/api/v1`。

完整网关须保持method、query、JSON body、Content-Type、Authorization、X-CyberGrid-Epoch、响应status/body和epoch/Retry-After，保持no-store语义及取消传播；不能只代理GET config或把错误统一改成200。注册体内有OAuth accessToken，后续请求有协调session bearer，入口必须处于同一受控信任边界，不能记录这些body/header。SDK信令是HTTP POST与GET长轮询（`wait=15`，见 [send_signal / signal_loop](https://github.com/ywateru/CyberGrid/blob/f2a3961536e5c69b13c7dbc661953d9243becbae/sdk-rust/src/client.rs#L1526)），不是一个配置返回的signaling WebSocket；网关预算需允许15秒等待和正常网络开销，并配合SDK35秒上限。

作为对照，[JS sdk index.ts::serviceOrigin](https://github.com/ywateru/CyberGrid/blob/f2a3961536e5c69b13c7dbc661953d9243becbae/sdk-js/src/index.ts#L54) 明确要求pathname为 `/`，返回 `u.origin`。当前本仓库 [vendored serviceOrigin](../../../web/src/vendor/cybergrid/index.ts#L353) 同样拒绝prefix，[AccountApp](../../../web/src/AccountApp.tsx#L617) 将gridUrl直接作为baseUrl传入。即使另行把根 `/api/v1` 路由到后端，也不等于支持传入 `/coord` 的现有JS SDK。

### Audience、callback、cookie与session绑定

[AuthConfig::validate / same_oauth_binding](https://github.com/ywateru/CyberGrid/blob/f2a3961536e5c69b13c7dbc661953d9243becbae/sdk-rust/src/auth.rs#L99) 不要求resource origin等于base_url。它绑定issuer、clientId、resource、scope、loginFlow、OAuth endpoints及canonical product；AnyWork [Authorization::grant](../../../crates/mobile/src/account/grid.rs#L29) 与 [EndpointPolicy::parse](../../../crates/mobile/src/account/mod.rs#L1092) 继续核对既有固定身份配置。仅更改HTTP到达入口不应更改Native client、Logto resource、scope、redirect_uri或产品归属。

服务端 [LogtoIdentity::verify](https://github.com/ywateru/CyberGrid/blob/f2a3961536e5c69b13c7dbc661953d9243becbae/server/src/identity.ts#L12) 验证启动配置的issuer/audience及token的client_id/connect scope，不以请求Host选audience。**但** [coordinatorAuthConfiguration](https://github.com/ywateru/CyberGrid/blob/f2a3961536e5c69b13c7dbc661953d9243becbae/server/src/deployment-config.ts#L22) 在未显式设置LOGTO_RESOURCE时会用CYBERGRID_PUBLIC_ORIGIN加 `/api` 作为默认resource；因此不能仅为了alias更改PUBLIC_ORIGIN而让默认audience一起漂移。优先保持现有服务身份配置和原canonical origin，alias/gateway只改变到达路线。

还需区分内部canonical origin与外部入口：Node及function适配器向 [serveAPI / effectiveOrigin](https://github.com/ywateru/CyberGrid/blob/f2a3961536e5c69b13c7dbc661953d9243becbae/server/src/http.ts#L94) 传入配置的PUBLIC_ORIGIN时，内部Request URL固定使用该origin；未配置时才使用严格解析的Host/X-Forwarded-Host/Proto。公共Native config也调用 [requestAuthConfiguration / consoleCallback](https://github.com/ywateru/CyberGrid/blob/f2a3961536e5c69b13c7dbc661953d9243becbae/server/src/deployment-config.ts#L16)，绝对console callback若与内部Request origin不同，会返回INVALID_CONSOLE_REDIRECT_URI，尽管Native本身不用console登录。故保留原canonical origin的同部署alias可以兼容；若代理改变了后端看到的origin，必须先证明callback校验仍成立。这里没有读取线上env，不能宣称实际已满足。

Rust SDK HTTP client不安装cookie store/provider，公开config不附Authorization，注册将resource token置于JSON body，后续使用session bearer+epoch（[http_json](https://github.com/ywateru/CyberGrid/blob/f2a3961536e5c69b13c7dbc661953d9243becbae/sdk-rust/src/client.rs#L530)）。协调入口没有浏览器cookie host迁移需求；IdP系统浏览器cookie属于原issuer，保持issuer与原生callback不变即可保留原登录流程。不要据此推断Web无额外要求：JS fetch明确credentials omit，但浏览器Origin仍须满足服务端 [consoleCors](https://github.com/ywateru/CyberGrid/blob/f2a3961536e5c69b13c7dbc661953d9243becbae/server/src/console-cors.ts#L26) 及页面CSP；不能通过伪造/删除浏览器Origin绕过门禁。Native SDK协调HTTP请求本身不添加浏览器Origin，业务WebSocket的Origin是另一层约束。

[Credentials::binding](https://github.com/ywateru/CyberGrid/blob/f2a3961536e5c69b13c7dbc661953d9243becbae/sdk-rust/src/credentials.rs#L32) 将SDK持久grant文件绑定到精确base_url/server；持久SDK调用方换alias或prefix后不能静默沿用旧文件。这不阻止当前Android路径：它只安装RAM AuthProvider、不安装CredentialStore；账号scope hash仅含固定版本前缀、issuer、clientId、subject（[mod.rs](../../../crates/mobile/src/account/mod.rs#L356)），不含grid_url。不能把此结论扩为所有Desktop/SDK存储可无感迁移。

### 目录解析、返回的连接地址与同部署状态

锁定Rust SDK没有单独的 `/resolve` API或配置返回的signaling URL。所谓目标解析是 [Client::device](https://github.com/ywateru/CyberGrid/blob/f2a3961536e5c69b13c7dbc661953d9243becbae/sdk-rust/src/client.rs#L1336) 从devices()/directory结果挑选同账号/产品、在线且有指纹的device；信令仍走所选base的 `/api/v1/signals`。

返回的device/port `tunnelUrl`、browser bridge URL是独立的绝对连接地址，受EndpointPolicy约束，不会基于协调base重定向或补prefix。通用SDK [device_websocket_url / dial_tunnel](https://github.com/ywateru/CyberGrid/blob/f2a3961536e5c69b13c7dbc661953d9243becbae/sdk-rust/src/tunnel.rs#L25) 从经验证的device根HTTPS地址构造同authority的 `wss://.../connect`。AnyWork Native实际业务路径不同：[GridDevice::parse](../../../crates/mobile/src/account/mod.rs#L1270) 取 `anywork-remote` / `anywork-noise-v1` 业务port的tunnelUrl，[transport::address](../../../crates/mobile/src/transport/connection.rs#L1135) 验证现有受信根地址后构造该宿主的 `/remote/v1/ws`，Origin仍为 `https://tauri.localhost`。协调alias不会代理这些宿主地址，也不授权改写它们或放宽公钥、origin与unknown门禁。恢复config/目录后仍需分别验证宿主连接路线。

服务端 [auth/exchange与session校验](https://github.com/ywateru/CyberGrid/blob/f2a3961536e5c69b13c7dbc661953d9243becbae/server/src/service.ts#L69) 绑定用户、Native client/product、registrationKey、request/revision、协调epoch与incarnation；session按bearer hash从store取回，未绑定访问Host。[RedisStore::ready/register](https://github.com/ywateru/CyberGrid/blob/f2a3961536e5c69b13c7dbc661953d9243becbae/server/src/redis.ts#L49) 的epoch/seed/注册状态来自同一Redis命名空间。因此alias与旧入口必须到同一实际协调状态，保持产品/endpoint/admission策略一致；仅部署相同代码、另建不同prefix的Redis实例不能保留现有电脑presence。同部署多入口本身无需给Native开console权限，也无需重新注册Logto app或移动账号/业务数据。新建SDK Client仍会照常生成自己的RAM registrationKey并注册新device session，不能承诺换入口后保留旧RAM session/device代际。

### 可交给route lane的最小结论

当前Native-only可采用“受控HTTPS入口 `/coord` → 原服务 `/api/v1`”且不补丁SDK；若期望Web与Native共同使用新入口，额外根origin更符合现有两套SDK。两者都应保持原服务身份配置、canonical origin和同一Redis状态，原入口继续服务既有电脑。先由route lane证明实际路由、callback投影、无redirect且完整协议可用，再由独立verifier按授权验证设备上的config→注册→目录→宿主读取。本节没有实施任何方案或诊断，也没有新增运行验收结果。

## 已选根入口方案的精确API集合

协调者随后选择待实施方案：Native base为 `https://anywork.aixgg.com`（根、无prefix），使用窄external rewrites到既有协调alias，保持原audience。本轮仅提供源码契约；没有修改Native base或Vercel配置。

固定SDK的协调请求共有10个pathname、11个method/path组合：

| 方法 | 精确pathname | query / 生命周期 | 固定SDK源码 |
| --- | --- | --- | --- |
| GET | `/api/v1/auth/config` | `appId`；首次配置及恢复重核 | `auth.rs::auth_config:360` |
| POST | `/api/v1/auth/registration/challenge` | 无query；启用registrationAdmission时取challenge | `client.rs::admission:817` |
| POST | `/api/v1/auth/registration/admit` | 无query；同上，取ticket | `client.rs::admission:830` |
| POST | `/api/v1/auth/exchange` | 无query；Native注册、重新注册与恢复 | `client.rs::register_config:1093` |
| GET | `/api/v1/directory` | 可选 `cursor`；endpoint policy存在时的目录 | `capabilities.rs::directory_inner:50` |
| GET | `/api/v1/devices` | 无query；无endpoint policy时的兼容目录分支 | `capabilities.rs::devices:160` |
| PUT | `/api/v1/devices/self` | 无query；首次publication、20秒心跳、更新发布 | `client.rs::heartbeat:1506` |
| GET | `/api/v1/signals` | `after=<cursor>&wait=15`；后台长轮询 | `client.rs::spawn_background:1574` |
| POST | `/api/v1/signals` | 无query；发信令，目标device/incarnation在body | `client.rs::send_signal:1538` |
| DELETE | `/api/v1/session` | 无query；正常close及竞态旧session精确清理 | `client.rs::revoke_exact_session:1676`、`delete_session:1685` |
| GET | `/api/v1/apps` | 无query；SDK公开应用目录方法，当前Android grid.rs未调用 | `client.rs::apps:1323` |

这些是精确pathname，不需要通配动态后缀；不存在协调 `/resolve`、`/devices/:id`、`/heartbeat` 或 `/session/:id`。目标ID、registration/admission值、incarnation和发布revision在JSON body/目录内，cursor在query。完整SDK surface可列10条路径rewrite；严格当前Native-only surface可排除未调用的 `/api/v1/apps`，保留其余9条。`/api/v1/console/*`、`/api/v1/admin/*`、旧 `/api/v1/auth/login`、`/api/v1/auth/register` 均无需暴露；不要使用 `/api/v1/:path*` 来替代精确集合。

external rewrite需保留原query和上述各方法/body/授权及响应header，不能返回redirect或缓存登录/目录/信令响应。路径rewrite本身不等于method ACL；若平台仅按path匹配，同一路径的非表列方法仍交原服务按其校验拒绝，不能声称边缘已限制方法。原服务对不同错误方法的现有行为不由本报告修改。宿主 `/connect`、`/remote/v1/ws` 不属于这个协调路由集合，不应一起rewrite到协调服务。

本节通过只读遍历锁定SDK生产源码的所有 `api` / `http_json` / 直接session DELETE调用核对，没有运行Cargo、网络请求或生产操作。`git diff --check`用于报告格式核验，不是运行兼容性测试。

## Native入口实施候选

上述初步调查保持原实现的结论属于入口方案选择前的阶段。协调者接受 `772de4a` 契约后，本WT cherry-pick为 `77f232e`，据此仅将 `Config::default().grid_url` 改为 `https://anywork.aixgg.com`。resource仍为既有协调API audience；issuer、Native clientId、产品、原生callback、SDK版本与全部安全门禁不变。route lane单独负责external rewrites与缓存策略，本提交不修改Vercel、Cargo/lock、Desktop或Web。

新增 `gateway_transport_preserves_native_audience_policy_and_account_scope`：捕获真实 `Handle::prepare` 投影到AuthBackend的配置，断言使用原audience/client/callback；原配置可过EndpointPolicy，而将audience替换为官网派生 `/api` 时仍返回 `MOBILE_COORDINATION_CONFIGURATION`；同一合成账号在新旧transport下trust scope保持一致。不进行真实登录、公网请求或SDK注册。

本机工具链 `rustc 1.97.1`、`rustfmt 1.9.0`；已通过对两处Rust文件的rustfmt check（edition2024、skip_children）和 `git diff --check`。提交候选时尚未运行Cargo，已向协调者申请共享root target窗口，拟offline/locked执行新增回归及既有真实SDK loopback Native目录/恢复测试；不把待运行测试写成已通过，也不把入口切换视为设备同步恢复。当前未部署、未安装、未操作设备或宿主。
