# 移动端协调配置恢复：独立现场基线

2026-11-15，非作者 verifier。工作树 `.worktrees/mobile-coordination-verify`，源码基线 `b110681ad451754b5e1be6b59833fee5771a3d4c`。按[恢复任务](../tasks/mobile-coordination-recovery.md)独占 ADB；作者 Native/route 调查与本 lane 分开，探针建议通过父端协调。

**当前结论：失败基线已复核，恢复验收尚未通过。** 一次正常 UI 刷新再次结束于 `MOBILE_COORDINATION_CONFIG_FETCH_FAILED`。本次手机到 coordination 的 IPv4 TCP 能建立、TLS 握手失败，IPv6 TCP 超时；官网和 auth 的 HTTPS 成功。因此不沿用此前“当前 TCP 一律不通”的表述，也不将 curl 结果直接认作 Native 请求内部错误。

## 当前应用与一次正常刷新

- 使用明确路径 `/Users/water/Library/Android/sdk/platform-tools/adb`，发现一台已授权实体设备，无运行中的 emulator。只输出 API28 等安全投影，不记录序列号、账号或设备身份。
- 当前应用实际是 **v0.1.38/code40 诊断候选，并非 v41**。在设备上只读计算已安装 base.apk 摘要，得到 `106be0556f7cdb6f81823375f0656b287a301037b6bb968f63d1402698b8c736`，与此前已验签的阶段候选完全相同，绑定来源 `f5a0ae09aa2314e1519fcbb98ed7705c63200ee6` / CI `43573253953`。本轮没有复制 APK 或重跑验签，没有安装新包。
- 现有登录态可用，无需登录或密码。初始 UI 为“暂时无法确认设备状态”，刷新可用，“等待状态确认”连接禁用；展开诊断详情显示上述固定码。
- 只点击一次正常 UI“刷新设备”。开始后刷新变为禁用；旧错误卡片在忙碌时仍可能显示，不能以它认定新刷新完成。随后观测到刷新重新启用，并重新展开详情确认同一固定码。
- 该应用进程的新固定日志在设备时间 `17:26:01.365` 记录 `AnyWorkDirectory: MOBILE_COORDINATION_CONFIG_FETCH_FAILED`。最终安全 UI 快照为 `09:28:12Z`：固定码相同、刷新可用、连接禁用。只读取日志有限窗口，未见 verifier 未初始化 panic、Rust panic 或 Java fatal；不声称整段进程生命周期绝无异常，也不以 UI 采样间隔计算单次 SDK 请求耗时。

固定源码及锁定 SDK 核对：mobile `grid::devices` 调用 `auth_config()`，失败映射该固定码；其后才是应用 EndpointPolicy、Native registration 与 devices/presence。该码覆盖 SDK 请求、反序列化和 SDK 配置校验，不能独自细分 DNS/TCP/TLS/HTTP，也不能证明后续阶段已执行。未触发连接、读取隐藏 IPC、导出 token 或调用调试桥。

## 同手机公开无账号探针

使用手机已有 curl 7.58.0/BoringSSL；每项为无认证 GET、丢弃响应正文，不输出原始 curl 错误或服务响应。请求使用系统现有解析与路线，进程级 `--noproxy '*'`，保留证书/主机名校验，connect timeout 8 秒、总上限12秒，无 redirect 跟随；没有修改系统代理设置。

coordination 请求为 `https://anywork-cybergrid-selfhost.vercel.app/api/v1/auth/config?appId=<公开应用ID>`。参数名 **appId** 已核对锁定 SDK `f2a3961536e5c69b13c7dbc661953d9243becbae` 的实际实现，不是 console 的 clientId 路径。后续自查纠正：这次 shell 脚本的值取自 Web 公开 ID，而 Native 实际 client ID 对应另一项 Native 公开配置。全部 coordination 请求均在 HTTP 前失败，query 不参与 DNS/TCP/TLS，故仅保留表中传输阶段结论，**不作为精确 Native 配置绑定或反序列化验收**；后续 gateway probe 必须改用精确 Native client ID。未传账号、设备或 grant。

| 端点 / 地址族 | DNS | TCP累计秒 | TLS累计秒 | HTTP / exit | 判断 |
| --- | --- | ---: | ---: | --- | --- |
| coordination，默认 | 已解析并尝试地址 | 1.464 | 未完成 | 000 / 35 | TCP建立，TLS握手失败 |
| 官网 `/build.json`，默认 | 已解析 | 1.642 | 2.005 | 200 / 0 | TLS证书验证成功 |
| auth `/oidc/.well-known/openid-configuration`，默认 | 已解析 | 0.256 | 0.828 | 200 / 0 | TLS证书验证成功 |
| coordination，显式 IPv4 | 已解析 | 0.077 | 未完成 | 000 / 35 | 固定错误标记 `SSL_ERROR_SYSCALL` |
| coordination，显式 IPv6 | 已解析 | 未完成 | 未开始 | 000 / 28 | 总8.004秒，固定标记 `Connection timed out` |

默认三项采集于 `09:26:52Z–09:26:56Z`，coordination 两个显式地址族对照采集于 `09:27:47Z–09:27:55Z`。表中 curl 时间是自请求开始的累计值，不是各阶段独立耗时。DNS成功以解析后已尝试地址为依据；未完成TLS的请求不把默认 ssl_verify_result=0 当作证书通过证据。

安全系统投影确认默认网络为 MOBILE、Wi-Fi关闭、没有全局HTTP代理。未改 APN、代理、VPN、DNS 或 Wi-Fi。没有根据原始连接错误臆断网络供应商、SNI拦截、远端基础设施根因或证书拒绝；`SSL_ERROR_SYSCALL` 也不等于已采集服务端TLS拒绝原因。shell curl 与应用 Native/系统证书路径不同。

## AVD 就绪与建议对照

只读 SDK 清单发现4个现有AVD，均已有 API30 ARM64 google_apis system image（2 GiB配置）；Hypervisor.Framework 加速可用。磁盘可用约54.3 GB。未启动模拟器、下载镜像、创建依赖副本或并发编译，不碰已有AVD数据。

下一轮有区分力的对照建议由父端协调：

1. route lane 提供同一公开端点的电脑直连/既有代理证据，分别保留DNS、TCP、TLS、HTTP结论，避免将电脑既有代理路线当作手机直连成功。当前手机IPv4已有TLS失败证据，不用继续无差别重复默认请求。
2. 若 route lane 找到同后端受控HTTPS入口，先审查与精确源码/部署绑定及 issuer/resource/product/命名空间保持，再对手机做无账号证书/HTTP对照；不能仅凭入口HTTP200宣称身份策略和业务同步恢复。
3. 必要时用现有AVD的只读运行模式做Android栈/电脑出口对照，无需下载system image。AVD通过只说明该Android环境及出口可用，不替代蜂窝实体机；开始模拟器操作时不并发操作phone。
4. 后续作者提交及获准使用的同签包须另行精确审查/准入，再通过正常UI、现有授权完成真实config、设备目录及授权工作区只读读取。当前不安装新包；不绕过unknown门禁、不向Agent发prompt或编辑真实文件。

## 证据与所有权

小型脱敏证据在本WT ignored `artifacts/mobile-coordination-independent/`：`baseline-safe.json`、`installed-apk-binding.json`、`refresh-safe.json`、`final-device-safe.json`、`public-network-safe.json`、`avd-inventory.json`，以及无账号probe复核脚本。未保存原始私人UI树/截图、原始logcat、connectivity dump、地址标识或服务正文。

手机停在现有应用已登录、诊断详情展开的Unknown页面；刷新可用、连接禁用。所有本轮有限命令已结束，无自建模拟器、探针或监控后台进程；既有ADB server保留。ADB独占继续由本lane持有，后续通过父端接收作者commit或明确probe建议。该报告是基线与验收计划，不是协调配置、设备发现或工作区同步恢复完成声明。

## 后续：正式 v41 模拟器登录前对照

父端接受基线后授权启动现有模拟器。选用 `nuva_mirror_isolated` API30 ARM64 AVD，以 `-read-only -no-snapshot-load -no-snapshot-save -no-window -no-audio` 运行，不 wipe、不下载镜像、不改原 AVD 既有数据。所有命令显式选择 emulator，真实手机完全未操作。原 AVD 没有 AnyWork 安装；模拟器临时运行层安装了 root 保留的正式 v41 ARM64 APK，未复制或重建包。

实际安装前再次计算 APK SHA-256 为 `a31c8cc1404b9efa4ebfb4cfab526c85edc3397c28242e74910053cc5f07e434`，39,274,111 bytes，绑定正式源 `f669ef59bde7cb70bbe98fd59592b6f87e93698b`。安装成功耗时8.0秒，实际 package 为0.1.41/code43。`09:32:31Z` 已观测boot complete（不是从进程启动精确计时），正常启动应用后有限日志窗口未见 verifier/Rust panic 或 Java fatal。

`09:34:00Z` 通过正常 UI 点击“登录账号”，核对应用内来源确认弹窗并点击“继续”；`09:35:50Z` 观测到正常 Logto Username/Password/Sign in 页面。两时刻相差约110秒，包含人工检查和弹窗停留，**不是认证HTTP耗时**。该AVD无现成AnyWork SSO，用户名/密码字段为空，没有提交凭据。当前lane上下文缺少此前授权凭据的具体值或安全读取位置，待父端提供后才能继续正常UI登录；未从私人文件或进程中搜寻凭据。

| 阶段 | 实际证据 |
| --- | --- |
| 应用启动/登录来源确认 | 正式v41在API30启动，来源弹窗及auth登录表单正常加载 |
| 账号读取 | 未到达：等待正常UI登录；页面加载不等于Native账号API请求成功 |
| config / registration / presence | 均未到达，不能与手机Native失败作成功对照 |
| 授权工作区读取 | 未到达；未发送Agent prompt或改动真实文件 |

模拟器已有nc，无curl/wget/openssl；未推送额外工具或借私有bridge/隐藏IPC补做Native结果。小证据位于同ignored目录 `emulator-v41/` 的 launch/login/prelogin安全JSON。模拟器保留在登录页，唯一自建后台进程为本次emulator，ADB独占仍由本lane持有；没有监控或重复探针循环。这是等待授权凭据输入材料的中间记录，尚非模拟器业务验收通过。

## 40e0548 Native 与 gateway 精确源码审查

**接受（PASS）：可进入受控部署及手机匿名 gateway probe，无源码阻断项。** 审查精确合并候选 `40e0548431bc4467f5046a8334edaee685ce15df`，Native 代码 `207e890778b79e41e830e130a6f8cae9d7902e8d`、API契约报告 `02e90f8bfba16dcb4b585838cad08cf730161b60`、route代码 `c110af73c256facbf497e4a16682657d34e718b8`。确认两份代码在完整候选中没有后续漂移；本 reviewer 没有 cherry-pick 产品代码或修改 main。

- Native生产代码仅将 `Config::default().grid_url` 切到官网HTTPS根。resource/audience、issuer、client/product、callback、SDK锁定版、EndpointPolicy、epoch、公钥确认与unknown连接门禁均未改变。SDK实际client取该grid_url；账号scope仅绑定原issuer/client/subject，未随transport origin漂移。新增测试通过真实prepare配置投影断言原audience/client/callback，拒绝官网派生的错误audience，并检验同一合成账号scope保持；不是仅复述一行默认值的测试。
- 独立遍历锁定SDK的auth_config、api、directory、heartbeat、signals和精确session撤销路径，确认当前Native需要9个pathname：auth/config、auth/registration/challenge、auth/registration/admit、auth/exchange、directory、devices、devices/self、signals、session，均在 `/api/v1/` 下。GET/POST signals共用一路径；SDK apps未被当前Native调用，可以不代理。无协调resolve或业务宿主 `/connect`、`/remote/v1/ws`需求。
- `vercel.json`恰好这9条literal external rewrites，每个destination固定为旧协调origin加相同pathname；无动态host、query重写、redirect或catchall，不暴露console/admin/apps/旧auth登录路由。配置是pathname白名单，不是method ACL，非预期方法仍由原服务校验。现有app/callback/source重写不变。
- 每条路径精确配置Cache-Control、CDN-Cache-Control、Vercel-CDN-Cache-Control为no-store，另有 `x-vercel-enable-rewrite-caching: 0`，未注入认证/cookie/epoch或放宽CORS。CSP preparer只绑定global CSP，保留固定上游和其他header；其真实CLI及组装测试覆盖这一点。此处检查的是显式禁缓存配置，不将外部rewrite默认行为视作已完成线上无缓存验收。
- 不改变已部署协调服务、PUBLIC_ORIGIN、OAuth资源或存储namespace；同alias有利于保持既有状态，但源码规则不能独立证明生产alias/epoch未漂移。实际部署仍须固定源/目标身份并对账。

独立针对性验证：从精确40e0548提取必要脚本、vercel配置、workflow和5个小型静态asset到自动清理临时目录，运行 `scripts/cloud/test_frontend.py -v`，**9/9 PASS，1.276秒**。再分别使用旧无gateway配置、宽泛 `/api/v1/:path*`、signals改为public/max-age60的反例，全部由gateway测试拒绝。显式预期路径/固定origin和负例提供独立边界，不是从生产配置镜像生成期望；`scripts/check.sh`已持续调用该测试文件。两个代码提交的 `git show --check`通过。

已阅Native作者40e0548测试报告：19 pass/1 ignored，含真实锁定SDK的3项loopback目录/失败/恢复夹具；这是作者执行证据，本 reviewer 未重复Cargo，也不将loopback结果称为Android公网或Vercel验收。首次缺web/dist-mobile导致编译失败与后续复用产物通过的边界保留。

**部署后门槛仍在：** query（包括正确Native appId、cursor和signals after/wait）、HTTP方法/JSON body、Authorization、请求和响应X-CyberGrid-Epoch、状态/body/Retry-After、无缓存及至少15秒long-poll实际透传；路径规则和离线测试不能直接证明这些wire语义。合成受控协议验证与匿名手机config优先，不把真实token导出到shell。随后才是获准同签包与实体Native config→registration→presence→授权工作区只读读取。上线网站source与仍为v41的installer source/tag须分别记录，不伪造新版发行或修复publisher phase。

对应证据在ignored `gateway-review/`：frontend-9.log、3组负例log和focused-verdict.json，含精确输入文件摘要；临时源码/fixture树已删除，无依赖复制、构建、部署或公网探针。

## 模拟器恢复后的阶段边界

获准正常UI输入后已有一次登录提交，未保存凭据/表单正文或截图。随后上游503中断后，恢复检查确认emulator与应用进程仍在；MainActivity前台、display ON，可访问性树只有3个WebView容器节点，无可确认表单/设备控件，也无新固定MOBILE码或有限窗口panic/fatal。没有凭此推断认证、账号读取或SDK config成功，更没有再次盲输凭据、安装或重启应用。真实手机未操作。

按父端优先级暂停进一步模拟器UI排查，先完成上述代码接受以解除部署前审查门槛。模拟器正式v41的config/registration/presence/工作区仍待正常UI补证，当前不作为gateway候选或业务恢复通过。模拟器继续保留，ADB独占不变；没有自建轮询/探针后台进程。

## 40e0548 预构建部署输入审查

**接受（PASS），可进入受控部署。** 独立读取route WT的 `.vercel/output`，逐文件重算447文件/24,354,680字节摘要，与预构建upload manifest完全一致；manifest SHA256 `37f5549f0e4572959dec2e23b022801488d6ad919cb5adcc423351c36efe0db3`。实际Build Output config仍为9条固定同后端external routes及每条4项禁缓存header，且无static/api遮挡。build.json精确绑定40e0548/0.1.41；release.json的23附件名称/大小/URL与本lane先前正式v41公开验收记录一致。EN/ZH各有四ABI精确v41链接、无universal/alias下载链接；旧APK名称仅留在兼容标签映射，不将字符串存在误判为当前下载回退。

本地source归档SHA256 `84f14133573f6ac88627d56a991ad0822d54d340f5b052f3b82edd1cb698a656`；逐项对照Git确认1056个归档正文blob均属于精确40e0548，生成manifest路径集合一致。网站source与installer f669ef/v41分别绑定。已读取实际输出CSP，保留原auth/协调origin；部署摘要声明与先前生产一致，本次未另行在线复核。ignored `gateway-review/staging-verdict.json`保留小证据。

本轮未部署、未启动Cargo、未操作手机或重放模拟器凭据。等待route实际deployment ID后，先执行正确Native appId的手机匿名config probe；HTTP透传和业务恢复边界仍以上节为准。构建workflow15d6a0e由另一独立lane审查，不包含于本次40e0548结论。

## 模拟器正式 v41 可见 UI 补证（2026-11-15 10:19–10:22Z）

**登录/设备目录/presence PASS；工作区读取待公钥核对。** 本轮先检查已有emulator-5580：MainActivity前台且有焦点，仍只有3个无输入框的WebView/容器节点。正常截图显示完整已登录「我的设备」，一台电脑为在线，有「打开工作区」入口。此前仅凭可访问性树判为空白的推断不成立；未再次输入凭据、重装、重启或重置。

点击可见「打开工作区」后进入「核对电脑身份」：显示当前公钥与「我已在电脑端核对身份与完整公钥」复选框，未勾选时确认连接禁用。尚未与电脑端实际核对完整公钥，因此未勾选或连接，没有跳过此门禁。返回设备页，仅执行一次正常刷新（10:21:26.716Z），下一次可见观察10:21:46.229Z仍为一台在线电脑，无unknown/错误提示。19.513秒是两次观察间隔，不是请求耗时；初次提交到本轮观察的长间隔也不记为登录耗时。

按精确v41的Native路径，非空设备记录显示online需要SDK config/EndpointPolicy、首次session注册与身份绑定、devices/presence合并成功。可见结果支持这些阶段通过；本lane没有截获每条HTTP交换或导出grant，也不将刷新推断为每次都重新注册或证明每次config均发出新HTTP。受限log窗口无固定MOBILE错误、Rust panic或Java fatal，未保留原始日志。

这是原正式v41/43与原协调transport的模拟器对照，说明Android客户端在该模拟器网络下可到达目录，不能替代实体手机gateway候选验收。实体手机保持未动；真实工作区内容仍未读取、未发Agent消息、未改文件。模拟器保留设备页等待后续，未操作电脑宿主。小证据为ignored `emulator-v41/visible-directory-safe.json`、`refresh-visible-safe.json`、`workspace-stage-safe.json`及两张已遮盖账号/公钥的截图；原始截图未保留。ADB仍由本lane独占，唯一已有长期进程是本次只读emulator，无新监控循环。

## 实体手机 gateway 与签名候选业务验收（2026-11-15）

**PASS：真实手机通过正常 SSO、Native config/注册/devices/presence、公钥核对与认证连接，已返回授权工作区会话列表及一条既有会话历史正文。** 原 `MOBILE_COORDINATION_CONFIG_FETCH_FAILED` 在本次候选现场路径上已越过，可支持后续修复版本说明与发行准备；本次没有发布新版本、移动tag或将候选称为正式发行。

绑定：官网 source `40e0548431bc4467f5046a8334edaee685ce15df`，deployment `dpl_97y1sK6c1fMDqHzRAwZAjsHdiCg1`（`https://anywork-l1jfwi8f4-yywater68-1778s-projects.vercel.app`），production `https://anywork.aixgg.com`。手机候选 source `e4f3650890eb1e9e8010be29fca607a12302435a`；与40e0548之间只有候选workflow及两份review文档变化，产品运行时代码相同。GitHub匿名实时API独立确认 [CI43703073305](https://github.com/ywateru/AnyWork/actions/runs/43703073305) 为该精确head、attempt1、completed/success。使用父端交付artifact14157625553，未另下包或启动Cargo。

| 门槛 | 独立实际证据 | 结果 |
| --- | --- | --- |
| 手机匿名 Native config | 10:28:47–10:28:50Z；精确Native appId、正常证书/主机名校验、无认证GET、不跟随redirect，HTTP200；curl总3.370976秒，TLS累计1.939536秒 | PASS |
| 配置身份与后端一致 | 手机正文SHA256 `bc1ac1ba9d3e77a62fa9fe14fb75b8e528daa175d722d6df764c803a99782bdc`；与原入口重新匿名读回的完整JSON及原始bytes一致；issuer/client/resource、OAuth endpoint、memory-v1及UUID epoch符合Native规则，响应epoch header与正文一致 | PASS |
| 禁缓存 | 手机实际响应 `Cache-Control: no-store`、`x-vercel-cache: MISS`、`age: 0` | PASS（本次响应） |
| APK bytes/身份/签名 | 实际39,274,111字节；SHA256 `f2161a5923b052858f1d72490d4bb39ee537f7b9ed04feee00e936c2f730ad26`；aapt/apksigner独立验证 `dev.remoteagent.app`、0.1.41/code43、min26、单官方signer，证书SHA256 `88b43f83632002fbeddd23a286eabee39c5ada0fa1b037d6ff32b9986a67acb8`与正式v41相同，均匹配候选metadata | PASS |
| Native/随包UI | 仅ARM64一份JNI ELF，machine183；4个LOAD均16KiB，zipalign `-c -P 16 4`通过；nondebuggable、extractNativeLibs=false；native中有mobile.html及Logto notice标记，随后实际显示随包业务UI | PASS（未重复完整UI源码键枚举） |
| 保数据原位更新 | 10:31:26.714–10:31:37.208Z实际 `adb install -r`成功，手机0.1.38/code40→0.1.41/code43；没有uninstall、wipe或网络设置修改 | PASS |
| 普通登录/目录 | 初始为未登录引导，点击登录并确认既有auth origin后，现有SSO恢复，无凭据重输；10:34:41Z实际显示设备目录及一台在线电脑，无原固定失败码 | PASS |
| 完整公钥核对 | 正在运行的桌面AnyWork正常UI「远程访问→本机身份核对」，与手机确认页完整公钥逐字符目视一致；随后正常勾选，确认按钮可用，10:37:46Z点击连接 | PASS |
| 认证业务读取 | 连接后实际工作区会话列表返回；正常选择一条既有会话，10:47:28Z显示历史正文及工具记录，安全投影中有5个可见长正文节点、564个UI节点与正常会话工具导航 | PASS |

匿名probe脚本初稿曾把可选的顶层productId与host product强制比较，产生审查脚本自身的过严BLOCK。核对精确Native `EndpointPolicy::parse`后纠正：它仅在products列表存在时验证host product；此处productId和products均未提供，属于允许的兼容形态，且全文与原后端完全一致。安全证据保留该纠正原因；没有改变产品门禁或省略实际必需绑定。

以上登录、连接与历史观察时间含人工核对和工具采样间隔，不作为网络或登录耗时。受限最后400条logcat投影无固定MOBILE错误、Rust panic、Java fatal；不将有限日志窗口等同于全生命周期无错。正常UI中已有非空输入字段保持未动；没有创建会话、发送Agent消息、执行终端命令、编辑/保存真实文件。按父端要求，以认证工作区/既有历史读取为本次必要业务门槛，不继续穷举文件或Agent。

仍未覆盖：独立文件树读取、写入/发送、全部9条路由的逐项wire负例及15秒long-poll穷举、其他手机/网络、其他ABI运行和后续正式发行。真实业务成功证明本次实际经过的认证与转发路径，不替代这些未测范围。官网仍提供正式v41/f669ef安装包；当前e4f3650仅为同版本签名候选，不混淆网站source与installer source。旧production rollback由route lane保留，本lane未部署或更改回滚。

私有小证据在本WT ignored `artifacts/mobile-coordination-independent/`：`gateway-live/phone-anonymous-config-safe.json`、`candidate-e4f3650/apk-admission-safe.json`及四项工具log、`phone-candidate/`安装/SSO/目录/完整公钥匹配/连接/工作区/历史/最终安全日志和`business-verdict-safe.json`。不保留原始账号、完整公钥、grant、服务正文或历史正文；截图仅保留脱敏版本。没有读取私钥/token文件或重启/改变电脑宿主设置及会话。模拟器公钥也已与桌面UI匹配，但因手机优先仍未确认连接，不伪记其工作区通过；手机保留已连接的现有会话页，未另行logout或清理应用状态。仅原只读emulator与共享ADB server继续使用，无本lane长期监控/下载/构建进程；共享依赖/target未改动。
