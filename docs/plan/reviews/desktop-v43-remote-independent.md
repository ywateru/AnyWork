# Desktop v0.1.43：现场基线与 68364ff 独立审查

最终候选结论：**接受 `68364ffe288a008eeb182c8268defecc83c939af`，无阻塞代码发现。** 私有双版本HTTP服务与真实隔离Chromium复现了“缓存旧HTML、旧入口模块已移除、root空白”的反例；候选公开随机query能取得当前文档，实际 `localBootstrap.ts` 清除ticket fragment且保留query。安全readiness和固定诊断投影通过源码审查及独立UI回归。新浏览器回归尚未接入持续门禁，作为P2后续项明确保留。**未在用户运行实例安装候选，不将隔离夹具通过记为用户白屏已修复，也不宣称历史配置不可用已解决。** 精确范围及验证见末节。

历史现场结论：安装包与运行服务的版本标识分离已确认；该服务是历史上经批准安装、具备安全交接能力的定制构建，不能按正式v13标签推断不兼容。正常UI打开动作确实产生浏览器标签，但页面实际空白；其文档入口模块在当前源站已缺失，返回404/HTML。远程页当时显示已开启，未复现配置不可用。本次没有修复或接管现有服务。

**更正 `8cecc46` 的推断**：初版用正式v13标签缺少browser-ticket推断 PID28102 不支持当前交接，未先核对其定制构建来源，此推断撤回。版本号不能替代运行构建的身份或能力；下文按历史来源、当前正常UI行为和未直接读取的认证响应分别记录。

审查工作树为 `.worktrees/desktop-v43-review`，分支 `codex/desktop-v43-review`，基线 `15f5c3faff20dfa85fb1f092cf686fe62afec492`。现场基线取证时，相对正式 v43 源码 `417a67fb1ee743c2ef67f4e75dcd056355fb2e7b`，`crates/desktop` 与 `desktop/ui` 没有差异；候选随后仅在独立WT引入，未安装。进程/HTTP基线时间为 **2026-11-16 14:16–14:23 CST（06:16–06:23Z）**；历史来源更正及正常UI追加观察至 **14:49:30 CST（06:49:30Z）**，入口模块诊断追加于 **15:00–15:03 CST（07:00–07:03Z）**。

## 实际进程、版本与服务

| 对象 | 只读实证 | 结论与边界 |
| --- | --- | --- |
| 安装的 GUI | `/Applications/AnyWork.app`；bundle ID `dev.anywork.desktop`；short version / bundle version 均为 `0.1.43` | PASS：安装版本正确；没有通过私有 IPC 读取应用内部状态。 |
| GUI 进程 | PID **35803**，PPID **1**，11月16日14:10:47启动；可执行路径 `Contents/MacOS/anywork-desktop`；loopback TCP 监听 **55512、55533** | 进程路径指向该应用包；未探测这两个监听口或其协议。 |
| 本机服务进程 | PID **28102**，PPID **1**，11月10日13:28:27启动；路径 `/Applications/AnyWork.app/Contents/Resources/bin/anywork`；监听 **127.0.0.1:3210** | 已确认长期运行服务早于本次发行。两个进程 UID 均与审查者相同，但相同 UID、路径、PPID 不能证明历史所有权或结束进程安全性。 |
| 实际服务版本标识 | 匿名 `GET http://127.0.0.1:3210/api/health` → **200**，`status=ok, version=0.1.13` | 确认运行服务自报0.1.13；历史记录将其对应到下述定制构建，不能当作正式v13标签二进制。 |
| 包内服务版本 | 仅执行包内 `bin/anywork --version` → **anywork 0.1.43**，exit 0，文件21,654,736 bytes | 已安装的新服务程序存在；这不改变或代表 PID28102 的运行版本。 |
| 认证边界 | 匿名 `GET /api/info` → **401** | PASS：该请求拒绝未认证访问。未读取访问密钥，未请求认证后的 hostname、workspace、客户端或会话信息。 |

`ps` 仅读取 PID、PPID、启动时间、可执行路径及 UID比较；`lsof` 仅检查上述两个 PID 的 TCP LISTEN。没有读取原始 argv、进程环境或打开文件列表。进程事实证明长期运行服务与当前GUI并存；其历史安装来源由以下记录补全，不能仅凭当前进程元数据或版本号认定它是未知/不兼容服务。

## 定制服务的保留来源

- [account-local-update-01.md](account-local-update-01.md)记录更早的自部署候选源 `75726758a4c9ffd7e7da4fb45e115bba92803650`，同样标为0.1.13；它说明本机曾采用不同于正式tag的定制产物，不能将该报告的server摘要混作后续PID28102的摘要。
- [account-unified-native-live.md](account-unified-native-live.md)记录后续冻结源码 **`113ddba1433e6437f73bdfebc6a4ea1d6e2fa74f`** 的实际安装；恢复回执 **11月10日13:28:29 complete，新服务PID28102**。包内server摘要 **`8af12e2a147f692a9ccc2f930da71da125cacc7b1930cba1464d043976d90f34`**，当时已验证安装树、进程/监听身份、`local-browser-session`能力及workspace，并有独立post-install接受记录。
- [desktop-workspace-layout-live.md](desktop-workspace-layout-live.md)随后明确保留 **PID28102及同一server摘要**，仅更新Native/源码/签名三文件；没有重启服务。

本次额外只读核对 `113ddba` 的server源码，`/api/info`确实声明 `local_browser_session=true`，且存在 `/service/browser-ticket` 路由。**该源码与历史实测直接否定“自报13因此不支持安全交接”的推断。** 当前PID和启动时间与历史记录相符；本次未重新校验运行映像摘要、未读取认证后原始capability响应，不把历史来源记录伪装成今天的完整二进制认证。

## 本地 UI / 资源健康与复用兼容性

匿名本地首页为 **200 / text/html / 638 bytes**。抽查首页直接引用的三项资源均200，响应正文 SHA256 与当前安装包 `Contents/Resources/web` 中对应文件完全一致：

| 资源 | bytes | HTTP正文 SHA256 |
| --- | ---: | --- |
| `/assets/index-Ge3nA-F_.js` | 1,197,701 | `16c132e0933c8d4837256edb2659405bcc529af1cf40a1d742b670ceb5e38804` |
| `/assets/markdown-DSq9fB3F.js` | 182,749 | `2337dc7a04f2f4ca1280be33c977f241c6c51963a579978a580ce95d2d2eec4e` |
| `/assets/index-Blds00Ca.css` | 267,211 | `9b59bdc76401b2978f21e9bca110bfbc67fded44c1a36b6793c350ab034462ca` |

因此实际存在**自报0.1.13的定制后端与当前安装包静态资源组合**。资源200不证明JavaScript执行或工作区可用；下述UI观察实际确认了空白渲染，没有浏览业务内容。

独立代码核对区分就绪状态与打开流程，但不据此认定当前实例缺少能力：

1. `manager.rs:59` 的 `ServerInfo` 不保留服务 `version`，缺少 `local_browser_session` 时默认false。`probe` / `event`（`:397`、`:743`）接受健康状态并独立更新授权；`main.tsx:136` 的 `localReady` 只检查 snapshot可用、authorized、running，`:180` 的“已就绪 · 复用已有服务”不检查浏览器交接能力。一般而言，缺少交接能力的服务也可能满足该标签条件，却被open拒绝；**这是通用判定边界，不是当前实例缺少能力的证据**。本次匿名401不代表应用携带自身凭据时也被拒。
2. `prepare_workspace`（`manager.rs:645`）对已占用端口先验证授权，再强制要求 `local_browser_session`；失败时明确拒绝旧访问密钥链接回退。`open_workspace` 随后才申请一次性browser ticket。正式标签 `v0.1.13` 的缺少能力事实只描述该tag，**不适用于上述定制运行实例**；当前UI打开动作产生标签，也不支持“因缺少交接能力而在Native拒绝打开”的原假设。

`desktop/ui/src/startup.ts:65` 捕获 prepare失败后只显示通用“工作区没有就绪”，丢掉 Native返回的升级/数据目录说明。新登录的默认远程操作必须在 prepare成功后才触发；显式远程命令则检查 manager authorized/running。候选应让“健康、已授权、支持打开、安全可管理”边界可区分，并保留有用的安全错误提示。

## 经授权的当前正常UI观察

使用CUA正常桌面UI，未调用私有IPC或读取token。首次查看时远程页已显示 **“远程访问已开启”**，开关为on；此时没有失败重试按钮，没有为制造重试而关闭远程。

切到工作区后显示 **“已就绪 · 复用已有服务”**。实际点击一次 **“打开本地工作区”**，在 **06:43:28.307Z** 新增本地浏览器标签；桌面未显示Native打开错误。按当前源码，这支持prepare及ticket返回/浏览器启动阶段已完成的判断，**未直接读取或输出认证响应、ticket或完整URL**；不能由标签创建推断Web已兑换ticket或进入认证业务页面。

只读检查这个新标签：DOM可访问性快照长度 **0**，body存在且有1个子元素，`#root`子元素数 **0**，可见body文字长度 **0**，按钮/input/alert控件数 **0**；视口截图确认为白屏。浏览器控制附加后捕获的12条上限warn/error记录为 **0条**，不代表附加前没有启动错误。未刷新/重放一次性交接URL，没有读取存储、网络认证内容、会话或Agent正文。

截至 **06:49:30Z** 桌面远程页仍显示已开启。**当时本地打开失败已缩小到“浏览器已打开但业务页面没有渲染”的实际边界，脚本/资源诊断随后追加如下；原配置不可用本次未重现。** 没有登出、登录、关闭远程、更新、停止或重启任何现有进程。

## 追加：空白页入口模块与当前资源不一致

**07:00–07:03Z**继续只读检查同一新标签的DOM脚本引用及浏览器已观察资源。没有刷新、导航、重放交接URL或读取页面内部认证状态。该标签的入口模块为 **`/assets/index-DO0mvBqQ.js`**，与前述源站新读取首页的 **`/assets/index-Ge3nA-F_.js`** 不同；已观察资源列表也列出前者。浏览器文档没有CSP meta。公开的console接口未捕获warn/error；可用资源接口提供文件名及观察来源，不提供当次网络状态或响应MIME，不能声称已经取得启动时的浏览器网络错误。

针对已观察到的两个公开资源名，以无Cookie/Authorization、无代理的匿名GET核对当前源站：

| 请求 | 当前源站响应 | 与安装资源的关系 |
| --- | --- | --- |
| `/` | **200 / text/html / 638 bytes**，引用 `index-Ge3nA-F_.js` | 正文SHA与初始基线相同；无Cache-Control、ETag或CSP响应头，Last-Modified为11月15日11:58:15Z。 |
| `/assets/index-DO0mvBqQ.js` | **404 / text/html / 638 bytes** | 安装包中无该文件；404正文逐字节等于当前index HTML，SHA为 `67cac3d0aba0d5a6d8ee3f5f62aab6211676de9c8b5b0698e12a7f6714b13984`。 |
| `/assets/index-Ge3nA-F_.js` | **200 / text/javascript / 1,197,701 bytes** | 对应文件存在，SHA为前述 `16c132e0…`。 |

**直接证据是“实际空白文档引用的入口模块，在当前资源树已经缺失”**。当前缺失模块请求同时返回HTML而非JavaScript；若浏览器收到此响应，入口模块无法加载/执行，足以解释root未挂载。此证据比“服务版本旧所以不能交接”的原假设更接近实际故障。

分类边界：

- **模块加载/资源不一致：有具体证据。** 实际DOM的旧入口名、当前缺失文件/404，以及当前有效入口200共同成立。
- **MIME：当前源站旧模块响应实测text/html。** 未取得该标签最初请求的浏览器响应或console原文，不伪记为浏览器已报告严格MIME错误。
- **CSP：当前源站没有CSP头，实际DOM没有CSP meta；未观察到CSP报错。** 这不是对所有浏览器/扩展策略的排除证明。
- **运行时JS异常：未取得启动时异常。** 附加控制之后的空日志不能排除此前异常；也不能据此把缺失入口问题改称React代码异常。
- **缓存机制：旧文档与当前源站不一致已确认，具体304/启发式缓存/旧导航恢复路径仍未取证。** 源站index无显式Cache-Control是相关事实，不单独证明浏览器具体用了哪种缓存；未读取或清理浏览器缓存、Service Worker或持久存储。

已直接通知源码作者Planck：当前自定义 `113ddba` 服务有安全交接来源，远程现已开启，候选必须覆盖**入口文档与更新后hashed资源不一致导致白屏**的实际场景，不能只修假设能力问题。建议在隔离环境建立旧入口/新资源的反例，验证未修复时root确实不挂载，以及候选能加载匹配的入口或给出可理解的恢复界面；仅断言能力布尔或所有静态请求200不足以关闭本次故障。源码修改、精确缓存机制复现和候选验证仍由作者提交后独立审查。

## 单次强制刷新按键尝试：无结论

在保留上述before证据后，使用者授权仅一次正常CmdShiftR。通过已文档化的浏览器按键接口尝试一次，接口返回按键操作超时。**07:10:45Z**只读复核仍为原入口、root子元素0、非空白=false，未显示授权过期或工作区控件。**没有确认发生强制刷新或导航**，所以既不能记为缓存绕过成功，也不能记为产品“强制刷新仍失败”。没有第二次按键、清缓存、重放交接或再次正常打开生成新ticket；未操作账号、远程开关或服务。此无结论边界已通知作者；保留 `hard-reload-attempt-safe.json`，不改变缺失旧模块的已确认事实。

## 为什么更新可能保留旧服务

`manager::start`（`manager.rs:467`）每次建立新的 `Worker { server: None }`，所有权来自本次 `OwnedProcess`，不会根据可执行路径、同UID或已有PID收养旧服务。端口已占用时不替换监听者；探测后用 `external = !owned` 标识复用。

`Http::update_readiness`（`:262`）对非owned服务直接返回成功；`PauseForUpdate`（`:554`）随后调用的 `stop_server`（`:728`）只停止 `self.server` 持有的进程。更新安装流程 `updates.rs:495` 调用上述暂停流程，因此**更新应用包可以成功而外部旧服务继续运行**。该行为符合不擅停外部会话的保护边界，但不能作为服务已升级的证据。没有读取更新历史，不能据此认定此次安装方式或哪次历史更新造成了遗留。

候选验收阻断条件：不能靠端口、路径或同UID直接杀进程；不能绕过 browser ticket、导出token或降级成密钥链接；如需要主动升级运行服务，须有明确的所有权、兼容性、任务繁忙保护和用户可理解的操作边界。

## 远程配置错误与匿名公网对照

源码 `accounts.rs:150` 的默认桌面协调base仍是 `https://anywork-cybergrid-selfhost.vercel.app`，与 Android 已切换官网 gateway 的传输选择不同。未读取用户 `account-cloud.json`，故不声称默认值就是当前实例的有效配置。

本机使用源码中的**公开 Native appId**，不带 Authorization / Cookie，按 Native请求形状分别读取 `/api/v1/auth/config?appId=…`：

| 域名 | 结果 | 耗时 | 正文绑定 |
| --- | --- | ---: | --- |
| 原协调alias | HTTP200 / JSON / 808 bytes，无重定向 | 0.928s | issuer、resource、Native clientId、scope集合与默认源码全部相符 |
| `https://anywork.aixgg.com` gateway | HTTP200 / JSON / 808 bytes，无重定向 | 0.819s | 同上；正文与alias完全一致 |

两者正文 SHA256 均为 **`bc1ac1ba9d3e77a62fa9fe14fb75b8e528daa175d722d6df764c803a99782bdc`**。请求使用 Python urllib、正常 TLS 校验，远端采用其默认代理发现；本地请求禁用代理。**这不是运行中桌面的 reqwest / SDK 实测**，不证明故障时网络、系统代理、TLS路径或有效配置相同。

`verified_grid_config`（`accounts.rs:100`）仅在公开配置GET的可重试错误或8秒超时用尽三次尝试后，返回 `REMOTE_ENABLE_GRID_CONFIG_UNAVAILABLE`；配置绑定不符等不可重试问题返回另一个固定码。远程流程在SDK登录/注册/发布之前执行此检查（`:1542`）。因此所报固定码指向**配置读取可用性阶段**；本地旧版本不能单独解释该网络阶段码。当前对照读取没有重现失败，历史故障根因仍OPEN，不能宣布切换域名必然解决桌面问题。

## 历史现场验收状态与证据边界（候选前）

| 状态 | 内容 |
| --- | --- |
| PASS | 安装43与自报13的定制运行服务版本标识分离；两个进程与端口；历史批准安装/安全交接来源；本地健康/静态资源抽查；两条匿名Native形状配置GET及严格绑定对照；正常UI当前远程已开启。 |
| BLOCK / 待候选 | 实际“打开本地工作区”仅打开空白浏览器页面，其文档入口模块在当前源站缺失并返回404/HTML；尚未通过修复后的渲染验收。具体缓存形成机制和配置不可用事件仍未闭环。撤回按正式v13标签认定当前实例不支持交接的判断。 |
| 未测 | 新登录、有效配置override、Native网络失败重现、直接认证capability读取、ticket兑换/认证业务页面、任务忙闲、更新/迁移行为、候选修复。未运行Cargo或产品测试。 |

小型安全证据保留于本工作树 ignored `artifacts/desktop-v43-remote-independent/`：四份初始baseline JSON，以及 `historical-provenance-correction-safe.json`、`normal-ui-safe.json`、`module-browser-safe.json`、`module-mime-origin-safe.json`、`hard-reload-attempt-safe.json`。`version-capability-safe.json`中的tag能力投影仅适用于正式tag，更正JSON和本报告明确其不是运行构建。仅保留安全白名单字段/摘要，未保存HTTP业务正文、账号/设备身份、凭据、原始argv或环境，未输出/持久保存浏览器ticket或完整交接URL。UI仅导航、打开一次并只读观察空白页，随后回到原远程页；后来获准的单次强制刷新按键未确认生效。没有关闭既有标签、操作Agent/业务文件或启动长期运行测试进程。以上为候选前的报告更正和诊断追加；候选验证结果随后记录如下。

## 精确候选 68364ff：独立结论

2026-11-16，审查作者提交 **`68364ffe288a008eeb182c8268defecc83c939af`**。按协调者要求仅cherry-pick该代码提交，在本WT生成 **`07c61f038839a2d2f7424f4a2d70c258e58e25d0`**；未引入作者祖先文档提交。唯一冲突为作者报告在本分支不存在，保留候选中的原报告解决；产品文件无冲突。`git diff --exit-code 68364ff -- crates/desktop desktop/ui` 通过，独立验证的产品树与精确候选一致。遵循docs-sprint的独立verify角色，没有修改产品实现。

| 状态 | 独立审查证据与结论 |
| --- | --- |
| PASS：新文档入口 | `open_workspace` 每次显式打开生成UUIDv4公开query；origin/根路径不变，ticket仍仅在fragment。随机值不携带身份；没有自动刷新、重放或旧模块回退。私有浏览器夹具证明该query改变文档缓存键。 |
| PASS：实际bootstrap兼容 | 独立夹具直接转译未修改的 `web/src/localBootstrap.ts`；当前入口能在模块RAM取得合成ticket，清除fragment时保留完整query、origin和路径。服务器收到的所有请求均为GET、不含ticket，每个新query仅请求一次文档；没有自动ticket提交或重载。此项不测试真实ticket兑换。 |
| PASS：能力与所有权 | `workspace_ready` 同时要求authorized、Running和显式browser-session能力；不按服务版本号判断兼容性。UI与显式远程preflight拒绝缺能力服务，prepare失败保留固定升级/数据目录提示。没有新增杀进程、收养外部服务、导出token或访问密钥链接降级。兼容的定制旧服务仍可复用。 |
| PASS：安全诊断 | 配置失败IPC仅投影固定stage、枚举kind、有界HTTP状态及尝试次数；UI严格验证对象字段、枚举和范围。没有把SDK/provider字符串、URL、body或错误链送入界面。公开配置GET的重试次数/期限和issuer/resource/client/scopes绑定未放宽；默认协调配置和namespace未变。 |
| P2 / 后续持续门禁 | `test:workspace-entry-cache` 仅在 `desktop/ui/package.json` 声明，`scripts/check.sh` / CI未调用；账号入口浏览器脚本也未接线。新脚本默认Chrome路径为macOS应用路径，Linux持续执行还需选择可用Playwright Chromium或传入覆盖。已通知作者并获确认，由根集成与server/PWA lane协调；本次本机PASS不能称为持续门禁PASS。Rust回归仍属于既有workspace测试路径。 |
| OPEN：现场与其他lane | 用户实例尚未安装候选、尚无修复后现场渲染验收；历史缓存产生方式未捕获，原配置不可用也未重现。server/PWA缓存策略与持久登录实现均不属于此SHA，不能随本报告接受。 |

独立执行的针对性验证：

| 命令/验证 | 结果与实际范围 |
| --- | --- |
| TypeScript `tsc --noEmit -p desktop/ui/tsconfig.json` | PASS。共享root依赖，无安装/复制大型包。 |
| Vite生产构建，`--configLoader runner` | PASS。构建候选Desktop UI，避免共享依赖目录的临时配置写入。 |
| `node desktop/ui/scripts/account-entry-check.mjs` | PASS。合成Tauri bridge覆盖readiness缺失/恢复、安全诊断与拒绝私有字符串，以及原账号入口流程；不是真实OAuth。 |
| `node desktop/ui/scripts/workspace-entry-cache-check.mjs` | PASS。真实私有Chromium；旧HTML缓存命中、旧模块404/HTML、空root及新query加载当前模块均有断言。 |
| reviewer自建 `cache-bootstrap-review.mjs` | PASS。两次fragment-only负对照均空root且旧模块404/HTML；两次独立query均挂载当前入口。直接使用生产bootstrap，补足前述脚本对fragment清理/query保留的验证。 |
| `rustfmt --check --edition 2024 --config skip_children=true`，三项改动Rust文件 | PASS。 |
| 精确候选树比较、`git diff --check` | PASS。 |

两套浏览器夹具均使用随机loopback端口、独立临时浏览器上下文、合成ticket和显式 `max-age` 的两代HTML。负对照实际保留了浏览器缓存而移除旧模块，能让未改query的打开方式失败，证明测试会区分修复前后；不是只断言生成字符串。独立夹具证明生产bootstrap的行为，但不替代Native真实handoff、完整React应用或真实认证业务验收。它们也不冒充现场304/启发式缓存机制的精确重现。

未重复运行Cargo/原作者7项Rust定向测试；这7项的结果来自作者报告，独立工作仅审查相应真实HTTP manager测试、preflight和诊断负例的语义。候选未产生正式二进制/发行验收结论；不宣称已修好全部远程网络、更新迁移或跨重启登录。

候选阶段完全未操作用户应用、服务或原浏览器标签。私有浏览器与HTTP服务均在finally关闭，所有本次测试命令已退出；没有长期监控或后台测试进程。移除本WT自建的共享依赖symlink及生成的UI dist，保留ignored小型夹具/安全结果；不触碰root依赖、作者产物、真实会话或ADB。候选缓存结果位于 `artifacts/desktop-v43-remote/workspace-entry-cache.json`；独立bootstrap夹具及安全投影位于 `artifacts/desktop-v43-remote-independent/cache-bootstrap-review.mjs` 和 `cache-bootstrap-verdict.json`。本次最终提交仅更新本独立报告。
