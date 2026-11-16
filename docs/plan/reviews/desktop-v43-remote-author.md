# Desktop v43：远程配置与登录恢复作者调查

基线 `15f5c3faff20dfa85fb1f092cf686fe62afec492`，独立 WT `codex/desktop-v43-remote`。2026-11-16。先形成行为提案，再实施；没有新发行或用户机器修复验收。

## 当前远程错误的已证实含义

`accounts.rs::enable_mode` 先检查已有账号 owner、授权状态及本地 manager 的 authorized/Running，准备独立 gateway/provider 后才执行 `verified_grid_config`。该函数对公开、无凭据的 SDK `auth_config()` GET 最多尝试三次，每次8秒、间隔250/750ms。可重试传输失败、超时和 HTTP 408/429/500/502/503/504 全部耗尽才返回 `REMOTE_ENABLE_GRID_CONFIG_UNAVAILABLE`；配置、schema/protocol、issuer/resource/Native client/scopes 不匹配立即以 `REMOTE_ENABLE_GRID_CONFIG` 结束。错误发生在设备注册、发布及账号目录更新之前，不能由此断言登录失败或目录写失败。

`manager.rs::prepare_workspace` 的 reused 指复用已监听端口的本地服务，而非复用云登录。它仍使用本地授权 `/api/info`，要求安全 browser-ticket 能力；`open_workspace` 还要单独申请短效 ticket。ready/reused 因而不能证明浏览器交接成功，也不能证明云协调配置可达。旧进程是否在用户机器上提供不兼容版本，需另一验证者的只读现场证据；本作者没有连接用户本地服务、查看token、关闭或重启进程。

## 默认入口与完整桌面 SDK surface

v43 Desktop 的 `PublicConfig::default().cybergrid_url` 仍为原 coordination origin，Android 则已使用官网根origin网关。锁定 SDK 为 `f2a3961536e5c69b13c7dbc661953d9243becbae`。源码逐项核对：Desktop `login_with_auth_provider` 的配置/准入/注册、`expose`/`enable_remote` 的 publication/心跳、后台恢复/长轮询和精确session撤销只需要现有九条路径；没有为远程host调用 `/apps`、console/admin、`/connect` 或业务websocket协调接口。

| 方法 | pathname | 桌面调用 |
| --- | --- | --- |
| GET | `/api/v1/auth/config` | 配置与恢复，编码query `appId`，无凭据 |
| POST | `/api/v1/auth/registration/challenge` | SDK admission challenge |
| POST | `/api/v1/auth/registration/admit` | SDK admission ticket |
| POST | `/api/v1/auth/exchange` | Native设备注册/恢复 |
| GET | `/api/v1/directory` | 有policy的目录，包括信令目标查找 |
| GET | `/api/v1/devices` | 无policy兼容分支 |
| PUT | `/api/v1/devices/self` | publication、变更和心跳 |
| GET/POST | `/api/v1/signals` | `after`/`wait=15`长轮询与目标信令body |
| DELETE | `/api/v1/session` | 正常关闭及竞态旧session精确撤销 |

SDK `auth.rs::auth_config` 使用显式 `base_url + /api/v1/auth/config`；`client.rs::api` 与撤销路径亦使用同一个base，返回的OAuth endpoint仍在原issuer，resource由服务配置独立绑定。现有网关可以覆盖这套调用，但这里只证明源码路径兼容，不重做生产注册/wire测试。

2026-11-16T06:16:28Z，本机匿名curl对两个origin各做一次精确 `GET /api/v1/auth/config?appId=<publicNativeClientId>`：原origin 200/0.857秒，官网网关200/2.826秒；两个body摘要相同，issuer/resource/Native client/五scope均匹配。没有认证header、cookie、重定向跟随或网络配置修改；未持久化raw body/error。它不是安装中Desktop SDK或用户现场路线的复现，不能据此将用户故障归因为原域名，也不能据此证明重试登录会解决。小型安全结果在本WT ignored `artifacts/desktop-v43-remote/public-config-probes.json`。

**默认入口暂不修改。** `PublicConfig::namespace` 对完整序列化配置和support目录hash；`public_installation_id` 再绑定subject。直接把 `cybergrid_url` 改为官网会改变namespace和设备身份；不得将Android单字段改法机械移植到桌面。若后续明确选择网关，需单独定义仅transport选择的、限定精确官方binding的策略，并保持完整身份/namespace隔离及custom配置行为。

## 拟议最小远程诊断行为

保留原阶段码、请求次数/期限、无认证公开GET及全部身份比较。只把当前被丢弃的失败分类投影为固定allowlist及有界HTTP status/attempts；区分外层deadline、HTTP timeout/connect/request/body/decode、临时HTTP状态及protocol/配置绑定不匹配。不得format错误字符串、source chain、URL或响应body。通过账号IPC的安全结构交给诊断详情，原有其他阶段字符串保持兼容；UI只识别精确code和已定义字段，拒绝未知类型/私有文本。此候选只修复定位能力，不冒充已解决用户的现场连接或workspace打开故障。

## 本地 readiness 的明确缺陷与修复契约

独立验证者 Nash 的初步现场报告记录安装GUI和随包服务为v43，而当前端口外部服务health版本为v0.1.13。协调者随后纠正：`account-unified-native-live.md` 记录该自定义服务构建曾通过local-browser-session验收，不能用官方v0.1.13 tag的能力推断它缺少安全交接；当前认证能力仍未知。本作者没有读取其 `/api/info` 凭据、复测现场或获得停止进程授权。

源码独立存在可复现缺陷：后台probe只要认证 `/api/info` 成功就可设 `authorized=true` / `Running`；UI `localReady` 只检查这两项，不检查实际 `local_browser_session`，而真正prepare/open才要求此能力。因此缺少该能力的合成外部服务可被后台观测投影成“已就绪 · 复用已有服务”，随后安全交接又被拒绝。不能将这个fixture失败直接归因于用户当前服务。

先实施这个已确认缺陷：统一新增workspace readiness谓词，要求认证Running且显式支持安全browser session；健康但未经认证的服务显示“已有服务待验证”，已认证但缺能力的显示“本地服务需要升级”。禁用打开和默认/显式远程启用，给出固定upgrade诊断，指导用户在确认该服务归属/任务安全后自行升级或选择正确数据目录。不可因旧版本或复用就停止、替换或降级到访问密钥链接。兼容外部服务仍可复用，无需版本号硬编码。此修正与公开协调GET故障独立，不宣称修复了当时的远程网络错误。

```text
本地服务需要升级
现有服务不支持安全浏览器交接；本应用不会停止它。
确认该服务的任务已结束后升级服务，或在设置中选择正确的数据目录。
[打开工作区：禁用]  [设置]
```

## 实际白屏：旧入口文档引用已移除模块

Nash 现场证据 `62ef646`：正常打开后DOM仍引用旧哈希模块，该模块返回404且Content-Type为HTML；匿名读取当前入口则引用另一个存在的模块，返回200 JavaScript。当前远程已经enabled，历史GRID_CONFIG错误未复现。由此明确当前白屏发生在浏览器bootstrap，不能把它归因于缺少安全交接能力或声称已修复历史配置网络问题。入口响应未设Cache-Control，PWA navigation使用默认HTTP cache；旧入口可被启发式缓存。但尚未捕获实际启动的网络/304记录，具体缓存命中过程仍是证据边界。

实施前修复契约：每一次显式Native打开生成公开、无身份含义的UUID query `desktop-open`，使入口HTTP缓存key独立，兼容仍在运行的旧服务。短效ticket仍只存在fragment，不出现在HTTP query；不自动重载、不重放ticket、不寻找旧模块、不停止外部服务。路径和origin不变，`localBootstrap.ts`读取ticket后保留search并清除fragment，账号/本地session绑定不变。用真实隔离Chromium及合成HTTP服务验证旧入口缓存引用已移除模块可白屏、新query能取得新入口；不把合成缓存策略说成现场304的复现。新版服务HTML/sw缓存header及PWA navigation策略由独立作者处理，本候选不编辑server/Web。

## 用户新增持久登录：实施前生命周期提案

以下替代旧“每次进程必须重新登录”的契约；与远程诊断分开提交，保留所有授权/身份/no-replay边界。

1. Native独占一个当前schema的系统安全存储记录。采用维护中的系统secure-store库：macOS Keychain、Linux Secret Service、Windows Credential Manager对应后端；不使用明文文件或仅进程/session内核keyring替代跨重启保存。新service/schema/key名，不枚举、不导入任何旧凭据。存储key绑定完整配置及support namespace；record再绑定schema、完整配置、已验证subject及owner标识，拒绝未知字段/版本/绑定。只保存必要refresh grant与恢复journal；不保存access token、Noise私钥或SDK device session。实际库版本、平台覆盖与Cargo变更在实施前明确。
2. 新登录只有经JWT/JWKS、account subject及完整配置校验后，才可提交可恢复owner。初次PKCE broker与其后的rotating refresh始终单一串行owner；若broker在最终commit前拿到轮换grant，必须在Native记录未确认所有权，不能因IPC失败遗失新grant或把未验证subject记录当已登录恢复。
3. 每次refresh dispatch前durably写入pending标志，防止进程崩溃后重放可能已被消费的旧grant；成功返回rotation时先更新Native最新grant并durably确认，再向SDK/JS ACK。不允许保存失败时仍按成功返回。新grant可留在RAM待重试安全存储；旧disk记录保持pending，绝不能被新进程当成ready。
4. 启动仅读取当前schema的精确记录。ready记录交给同一Native owner进行安全恢复、完整issuer/client/resource/subject验证；远程gateway/device registration和Noise key仍重新创建，不恢复旧业务session。临时失败保留受保护记录与明确可恢复状态；不以profile GET失败强制删除登录。已确认 `invalid_grant` 要求重新授权；未知token POST结果保持pending、拒绝自动重放。必须区分未dispatch/明确connect失败与已dispatch但结果未知，不能为“临时网络”承诺不安全自动重试。
5. logout先废止当前owner/generation并关闭本地远程门禁，再删除/持久标记不可恢复记录，等待已dispatch rotation结束后删除其最新结果；即使网络撤销失败也不得下次自动恢复已登出的旧grant。系统存储不可用或删除失败须给固定错误，不得假报已清除。手动关闭远程的owner语义与一次性default-enable保持，跨进程是否恢复关闭意图需和根契约统一。
6. 所有store操作经可注入接口串行化，测试使用独立内存fake，绝不接触真实Keychain/账号。回归覆盖重启恢复、配置/subject/namespace错配、schema拒绝、rotation保存失败、pending崩溃、logout/late result、invalid grant、临时失败，以及原SDK绑定/重放门禁。UI明确“登录由系统安全存储保留”“退出账号删除保存登录”，并区分恢复中、可恢复网络失败和需重新登录；不能继续声称关闭程序一定丢失授权。

注意当前 `lib.rs` 对Windows使用 `accounts_unsupported.rs`，不是完整Native账号实现。系统存储抽象可提供Windows后端，但不得把新增存储库声称为Windows账号全链已实现；此范围需协调者明确。远程候选已执行下述定向验证；持久化尚未实施或新增依赖，真实安全存储验收仍不得读取用户凭据。


## 远程候选作者验证

- 同一共享root target、offline/locked、incremental关闭、dev/test debug关闭、jobs=2；未交叉编译或运行用户服务。`cargo test -p anywork-desktop --lib` 定向filters：`grid_config_` 3通过、`configuration_projection_never` 1通过、`preparation_rejects_external` 1通过、`open_reuses_verified_external` 1通过、`enable_preflight_failures` 1通过。闭环验证配置重试/绑定、投影无私有字段、真实本地HTTP安全交接能力、真实IPC preflight拒绝。端口关闭测试遇到既有系统代理将连接失败返回502；测试精确接受CONNECT或HTTP_STATUS502，不修改代理配置。该开发期断言调整保留于ignored日志。
- `npm run build -w anywork-desktop-ui`、`node desktop/ui/scripts/account-entry-check.mjs` 通过：能力缺失/恢复、固定配置诊断、未知私有字符串拒绝、原账号/默认启用流程。仅synthetic Tauri bridge，不进行真实OAuth。
- `node desktop/ui/scripts/workspace-entry-cache-check.mjs` 通过真实隔离Chromium HTTP-cache测试：缓存旧入口后，旧模块404 HTML导致空root；新的公开query命中新入口并渲染新模块；服务器所有请求均无fragment ticket。fixture用显式max-age确保确定性，不冒充现场启发式缓存/304的捕获。结果JSON位于ignored `artifacts/desktop-v43-remote/workspace-entry-cache.json`。
- 新nonce的真实manager handoff `open_reuses_verified_external` 复验1通过：两个显式open的query不同且为v4 UUID、origin/path不变、query仅nonce、ticket仅fragment、配置/token未改、外部服务保持存活。没有读取真实凭据、启动或重启安装中服务、重放用户ticket、停止外部host或修改网络。
