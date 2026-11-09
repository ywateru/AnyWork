# 账号与设备云入口：最终集成验收记录

> 当前交付修订：本阶段使用 Development Logto，不购买生产套餐；现有客户端注册/登录入口见[当前任务](../tasks/account-client-entry.md)。用户进一步要求不使用本地钥匙串，新账号授权/私钥改为进程内存，退出后重新登录；旧Keychain实现及测试为历史证据。修订源码已独立验收；真实重启链路阻断及当前结果见下节。

状态：本阶段的现有客户端入口、Development配置和纯内存原生账号修订已独立审查并合并，合并系统检查通过。真实原生首次登录→启用→Web发现→加密访问→关闭已通过；同安装重启后再次开启失败仍阻断最终交付。尚未部署新版官网、更新安装客户端或既有用户服务。用户授权实施、整体测试并更新；方案见 [设计](../../account-device-cloud-review.md)，任务见 [当前交付](../tasks/account-client-entry.md)。下方早期基线记录保留为历史，不代表当前修订结果。

## 当前客户端修订验收（优先于下方历史记录）

2026-11-09，当前合并源码 `e3ffdf7`。Web现有客户端入口、Development完整配置和原生纯内存账号版本已分别通过独立审查并合并，详见 [Web入口](account-client-web-01.md)、[Cloud配置](account-client-cloud-02.md)、[内存原生账号](account-client-desktop-memory-01.md)。历史Keychain、生产付费套餐或锁屏条件不能作为本阶段仍需完成的要求。

- 合并后桌面UI构建、Rust fmt、全workspace/all-target clippy、workspace tests、server/native build及全套Python系统/发布/cloud检查通过，日志 `/tmp/anywork-client-native-cloud-merged-check.log`。Web build、327 Vitest、8 Node检查通过；完整Chrome桌面/Android模拟浏览器套件 **611通过、1项既有桌面专用用例跳过**（21.0分钟）。最终诊断修订后仍需重跑受影响范围。
- 用户提供测试账号的全新独立Web托管登录通过：Account200×2、Grid config/exchange/devices200、实际connect JWT、无management角色变更、1440/390px无溢出。见 [真实Web登录](account-client-web-live.md)。没有以已有测试账号登录证明新注册邮件已送达。
- 真实隔离Native应用登录后手动开启远程访问，Web自动发现在线设备；对照本机公钥确认后，实际公网加密隧道进入空会话工作区。关闭远程访问使Web立即退出工作区。仅用空workspace/data/history、断开的宿主夹具和任务独占进程，没有访问用户业务会话。
- 同support/config的进程重启后，Native显示尚未登录，没有恢复grant。重新登录同账号后开启远程访问失败，当前为**集成阻断**。只读Account API确认目标installation恰有1条，keyVersion整数1、公钥有效32bytes、GridID非空。未确认失败阶段，不能将首次成功与重启夹具测试拼成完整生命周期验收；下一步增加固定安全阶段码定位，不盲重试。
- 新账号运行路径不使用Keychain；grant/访问令牌/私钥仅内存，唯一可持久化安装文件只含公开随机installationId。现有手动连接凭据处理不在此修订范围。首次成功与重启使用相同公开ID；真实换钥/旧pin确认仍待上述阻断关闭。
- 前端Vercel项目与静态发布工具已准备，尚未部署；尚未更新安装客户端或既有用户服务。Logto保持Development，CyberGrid使用已就绪Development协调服务，不购买套餐。

## 证据规则

- 每项结果绑定实际源码提交、执行环境和日期。上游报告、单元夹具、浏览器模拟、真实云服务和物理设备分开记录。
- 测试只使用隔离目录、测试账号和临时会话；不向既有原生 Agent 会话发送提示，不读取用户业务正文，不停止未归本任务持有的进程。
- 任何核心门槛未通过，都不能将整套功能、生产更新或安全性标记完成。
- 无业务明文入云不等于零身份/连接元数据。元数据、永久 fence/seed、备份和访问日志边界按实际配置披露。

## 门槛

| 项目 | 必须证据 | 当前结果 |
| --- | --- | --- |
| 精确基线 | AnyWork、CyberGrid、SDK/crypto 版本与许可来源；正式构建对应源码 | 固定源码及原始 notices 已复验；本机合并源码 `c5f25d9`；正式构建/分发许可仍待完成 |
| 新账号 | 注册/登录/退出/回跳；邮件实际投递；默认 connect 权限 | 独立 DEV 预置测试账号托管登录/回跳通过；新注册/邮件/默认角色未验收 |
| Account API | 官方 opaque token；只读写当前用户；保留其他 customData 命名空间；有界配置/并发冲突说明 | DEV 实际读写、完整替换/命名空间及错误 token 证据通过；无 CAS 局限已记录；生产待验收 |
| CyberGrid | 真实 Logto JWT→协调会话→同账号设备；跨账号拒绝；生产 CORS 精确匹配 | DEV 实际 config/exchange/devices200、CORS 拒绝及签名鉴权通过；真实原生设备注册/发现和生产仍待验收 |
| Upstash | 专用 namespace；写权限；无内存回退；冷启动与 namespace 重置行为 | 独立真实 REST 11 项通过；专用 Free 库、namespace 隔离；未重置实际运行 namespace，未证明物理 TTL 擦除 |
| 本机绑定 | 通过本机明确动作启用；验证 issuer/sub/client/scope；重启恢复；唯一 grant 刷新者 | 源码及隔离刷新/崩溃/退出测试通过，实际 Logto JWT 正反向通过；GUI/真实 Keychain 待解锁验收 |
| 私钥边界 | 本机 keyring/私有文件；静态包、Logto、Redis、日志和公网响应无长期秘密 | 源码及隔离凭据文件/网关测试通过；真实 Keychain 和生产包验收未完成 |
| 加密互操作 | 实际浏览器与 Rust 双端握手；成熟 Noise 库；篡改/重放/错误设备身份失败关闭 | 最终合并源码的浏览器/Rust 隔离互操作 22 项通过；Noise IK clatterjs/snow，含 20MiB 上传与取消/错误认证 |
| 业务全路径 | 会话读取、消息、审批、文件、图片、文档、上传、事件游标、PTY 均走授权加密路径 | 加密网关/浏览器夹具与既有工作区测试分别验证；实际原生启用→发现→完整 AnyWork 业务链待验收，不将两组夹具拼成端到端通过 |
| 生命周期 | token/业务会话过期、断网、取消、切账号、换设备、密钥变化与关闭入口；PTY 回收 | 源码与隔离用例通过；真实完整设备生命周期待验收 |
| 布局/无障碍 | 官网双语、390px设备页/工作区、键盘焦点、错误与空态、减少动画 | 官网 en/zh×1440/1024/768/390/320 本机通过；DEV 空设备页1440/390与对话框独立通过；完整浏览器套件611通过/1跳过 |
| 数据隔离 | 草稿/缓存按账号和安装身份隔离；迟到响应不串账号；SW不缓存认证与业务 | 源码及323 Web+8凭据安全检查通过；最终合并浏览器套件通过；完整真实账号设备链仍待验收 |
| 发布 | 完整检查、独立审查、精确提交、不可变 release/source/updater、Vercel和恢复验证 | 本机完整检查、源码独立审查及静态组装通过；18部署恢复+7配置安全+28发布器通过；生产 ready 未激活，尚无新 release/正式前端部署 |
| 实际移动网络 | 手机蜂窝访问桌面 Wi-Fi；物理设备证据与模拟结果分开 | 待验证 |

## 已有历史证据的范围

调研时两次 Upstash Developer API 请求成功、可见列表为空；四次 CyberGrid 公共路由无凭据探测证明有限入口行为。这些不证明新租户/新部署、AnyWork账号功能或加密业务链路已可用。

## 独立源码验收与合并

| 实现 | 接受的精确产品提交 | 最终独立评审 | 状态 |
| --- | --- | --- | --- |
| Cloud | `01b927f0db0a7e6e680a618a693827997831ff5d` | [account-cloud-02](account-cloud-02.md)，`899271e` | C1–C4关闭并合并 |
| Web | `c9a70749291cc6b9776c8b40662923df81c19473` | [account-web-05](account-web-05.md)，`6cc9f60` | W1–W5关闭并合并 |
| Desktop | `ead3874a7bacabf50c99374d3aca85ed76aa88d3` | [account-desktop-04](account-desktop-04.md)，`99a505f` | D1–D3及全量lint关闭并合并 |

合并基线 `c5f25d98fa3d73f2ae2c836ea183e694a0bac27f`。此前两次合并因总测试入口冲突、Rust新改动的lint失败被撤回，修复经独立复验后恢复；Web权限测试的 `fs.watch` 时序问题也已换成对真实文件句柄的确定性检查，不以重跑偶然成功关闭。唯一合并冲突是两条分支相同的 desktop UI 依赖排序，保留与 npm lock 一致的 Web 版本，无产品逻辑调整。

## 合并后本机完整检查

环境：macOS arm64、Rust 1.97、Node22.16、本机 Chrome。执行 `scripts/check.sh` 全套命令，复用本任务的 Cargo target；旧测试入口指向同次构建的 server binary。日志在本机 `/tmp/anywork-account-merged-check.log`，不进入源码包。

- 桌面 UI 生产构建、Rust fmt、全 workspace/all-targets clippy `-D warnings`、全 workspace tests、server/native build 全部通过。Rust 共272通过、9项外部前置用例忽略；其中 server185通过/5忽略、desktop50通过/4忽略、remote6通过。
- Web build、323 Vitest +8 Node检查通过。完整 Python 接口/事件/数据库恢复/文件一致性/共享宿主/发现/目标/审批/发布源与版本等套件通过，桌面 updater UI 通过。
- Playwright共612项：**611通过、1跳过**，耗时11.1分钟。跳过的是手机项目下的既有桌面专用参考布局用例；这是浏览器模拟，不是物理手机或蜂窝证明。
- 独立补跑 typecheck、format、7云配置安全+18部署恢复检查通过；官网 en/zh×1440/1024/768/390/320、语言选择、下载版本顺序及DMG选择通过。
- 最终合并源码的 `remote-interop.mjs` **22项通过**：真实 Chrome clatterjs→Rust snow/gateway，HTTP、binary、multipart、PTY、20MiB上传、取消/迟到ACK/超时/过期、未知ACK、错误鉴权及重放。使用隔离 loopback fixture，不是生产 Native 注册链。
- 按根 Vercel buildCommand 本机组装 `site/dist` 与 `/app/`；以本机静态服务验证1440/390px登录/注册按钮、无水平溢出、资源均从 `/app/` 载入、空回跳失败恢复、source offer和build.json。该服务模拟配置中的rewrite，不代替真实Vercel部署验收。
- 已知27项私有凭据/邮箱字节对437个静态文件、651个源码归档成员的扫描命中0；未打印值或摘要。此检查针对已知凭据明文，不代替代码审查或真实Keychain验收。

默认Playwright Chromium缓存不存在时启动失败，改用已安装Chrome后上述浏览器检查通过。未下载替代浏览器、未绕过Mac锁屏，未使用真实用户业务数据。

## 独立审查过程证据（2026-11-09；历史阻断已由上表关闭）

- 云候选 `983a016`：独立验证以官方固定版本 `redis.ts` 访问真实专用 Upstash，11 项断言通过，覆盖独立 store 共享 epoch、并发注册幂等、跨实例发现/信号、owner 隔离、冷启动会话、撤销失败关闭、永久注册 fence、分布式限流、全新 namespace 隔离及无效 REST token 失败关闭。仅写入 `anywork:acceptance:<随机 UUID>` 测试数据，结束后删除本次新建键；未读取业务或重置既有 namespace。
- 同一云候选的 28 项发布器测试及 7 项离线配置安全测试通过。[独立云评审](account-cloud-01.md)（云分支评审提交 `a38895f`）发现三个阻断：release 仍触发旧 Pages、协调服务部署不能安全恢复/复用、CLI namespace 长度限制超过上游运行时；修复及复验前不合并。
- Web 候选 `13ead5c` 的独立评审为 blocked：浏览器默认 `fetch` 调用绑定失败；取消上传后的迟到加密 ACK 会关闭其他请求/PTY。作者已在修复，必须复验新提交。
- Web 修复候选 `18b4b8a` 的[独立复验](account-web-02.md)（评审提交 `286da5c`）关闭原 W1/W2/W3：323 项单元测试、typecheck 及 22 项真实浏览器/Rust 互操作断言通过；原始迟到 ACK 复现后续 GET 现返回200。新增验证工具的私有状态文件保护 W4 仍阻断，修复后须复验。
- Web 独立评审以自己的全新 DEV 官方托管登录会话验证 Account200×2、Grid config/exchange/devices200、零 UI 警告，立即以自己的独立私有状态复跑 1440/390px 与添加设备对话框也通过。这与作者先前 19:48 复用旧状态的 Account401 分开记录；旧失败原因尚未确定，不将新会话成功归因于对旧状态原因的证明。
- [独立桌面评审](account-desktop-01.md)（评审提交 `972e3bb`，目标 `d23f5a8`）为 blocked：重新发布设备索引覆盖用户名称；原生 refresh 未先持久化不确定标记，checkpoint 写失败再丢失进程时可能恢复旧令牌。后者已用实际代码片段与隔离 token endpoint 确定性重现。桌面库 38 项、远程协议/网关 6 项通过；4 项外部依赖测试忽略。
- 桌面独立评审以实际产品 `JwtVerifier` 接受真实 DEV Logto ES384/JWKS JWT，并拒绝原签名 token 的 owner/aud/client 不匹配、实际过期 JWT、真实签名但缺少 connect 的 JWT、错误算法及 opaque 输入。该程序化证据不代表 Native OAuth/Keychain GUI 链通过。
- DEV 托管登录和浏览器设备页、浏览器/Rust 加密夹具的作者证据仍须按对应独立评审确认。实际桌面 GUI 登录、Keychain grant、启用注册到 Web 的完整链路未通过；原生验收时电脑处于锁屏状态，不能用夹具替代。

生产 Logto 套餐授权、CyberGrid 可分发许可、注册邮件/default-role 与实际手机蜂窝网络等门槛仍开放。未进行生产套餐升级、产品源码公开发布、最终前端生产部署或 release 更新。

## 继续验收与更新的外部条件

1. 解锁本机 Mac 后，使用隔离服务、测试账号和独立 manager home 完成 `docs/account-desktop.md` 中的真实 Native GUI/Keychain/重启/启用→Grid→Web业务/PTY/关闭/退出链。最近一次 CUA `listApps()` 原文为："The Mac is locked and automatic unlock could not unlock it. Ask the user to unlock the Mac manually before continuing." 不绕过锁屏；若实际出现新的持久OAuth授权确认界面，按CUA动作时确认规则处理。
2. 用户明确授权生产 Logto **Pro24+RBAC32=56美元/月基础费用**后，才可执行立即扣首张账单的订阅 API；税费和超额用量以官方结算为准。官方SKU/额度读取证据和来源见[云配置](../../cloud-configuration.md)。当前生产仍为Free，Development不替代生产。
3. 固定CyberGrid [LICENSE](https://github.com/ywateru/CyberGrid/blob/2bd6729c6bbee90ed2926410caca883a0a100890/LICENSE)仍为All rights reserved，未提供普通开源分发许可。公开分发SDK/客户端前需确定与AnyWork AGPL兼容的许可或权利人明确分发授权；不自行改写上游许可证。
4. 新用户真实邮箱注册、邮件投递/默认connect权限，以及物理手机蜂窝→桌面Wi-Fi仍需各自实际验收。在上述门槛满足前，不启用 `ANYWORK_PRODUCTION_READY`、不打新版本/tag、不公开push产品或更新运行中的用户服务。门槛满足后按现有不可变发布器完成精确提交检查、生产Vercel构建、release/updater和最终下载/源码验证。

## 当前继续实施状态（2026-11-09，用户修订后）

用户随后明确要求修改当前客户端UI增加注册/登录，并先使用Development Logto、未来迁移自部署。[当前客户端任务](../tasks/account-client-entry.md)取代上节第2项的本阶段生产付费前置：本轮不购买Cloud套餐，不要求以生产租户替换开发租户。真实链路、独立审查和分发条件仍各自记录。

本机随后已解锁；实际启动了唯一标识的 `AnyWork Acceptance.app`，空workspace/data/history、独立manager home与断开宿主描述，认证sessions库存为0。CUA确认实际账号页并点击“注册 / 登录”，进入等待浏览器状态；未完成OAuth或Keychain验收。等待结束后出现“尚未登录”但按钮为“退出账号”的错误状态，已作为当前Desktop修复范围。该隔离应用与其runner负责的server已停止，没有更改既有用户服务。之前锁屏证据为历史事实，不再是当前阻断。

此轮新增工作分别实施Web现有工作区入口、Desktop直接入口与开发默认值、云构建配置/自部署迁移；尚未据此前完整检查宣称新改动通过。变更后需独立精确提交审查和相应合并验证。

### 内存存储修订前的实际UI观察

`46ac30b`候选实际隔离原生窗口已显示主界面独立“注册”“登录”按钮。点击登录后账号页显示“已登录”及“开启远程访问”；未核对该登录对应账号、未点开启，不作为完整设备链路通过。随后用户要求不用Keychain，故停止此候选验收和其app/server。仅精确删除该次随机support/config命名空间中新增的1项本地测试grant（另2项不存在），未读取其内容、未触碰其他命名空间，也未声称该删除撤销了云授权。新内存实现完成后须重新验证。
