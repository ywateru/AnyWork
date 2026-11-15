# 移动端协调配置与同步恢复

2026-11-15 用户要求继续解决移动端同步问题，提供 `MOBILE_COORDINATION_CONFIG_FETCH_FAILED` 截图，并授权必要时使用虚拟机测试。承接[实体设备调查](../reviews/android-device-loading-independent.md)与[v0.1.41 交付](android-loading-release.md)，本次目标是恢复实际设备发现与授权工作区读取，不能只以修复永久 loading 或编译成功结束。

## 已知边界与调查

此前 Samsung Android 9 已完成账号读取，原生 SDK `auth_config()` 失败，尚未进入注册与 presence。手机对协调公开配置的 DNS 成功、TCP 超时，电脑 SDK 同配置正常；这些证据不直接证明网络供应商内部原因，也不排除另一条可观测失败。

本轮从当前源码与实测重新核对：

1. Native lane 追踪锁定 SDK 请求地址、查询参数、超时、证书与配置验证，判断是否存在客户端缺陷。源码修复必须最小、有针对回归；不先假定增加重试即可解决。
2. Route lane 比较电脑直连/已有代理路线与手机实际路线，核对既有协调服务、HTTPS 域名及同后端可达入口。先只读调查；任何入口调整须保持 issuer/resource/product/账号与存储命名空间，不能迁移授权或重建业务数据。
3. 非作者 verifier 独占 ADB，复核实体设备当前 UI/版本/原生固定阶段与公开无凭据网络探针；必要时使用现有 Android emulator 做对照。只读连接后可验证设备/工作区/历史目录，不向既有 Agent 会话发消息，不编辑真实文件。

## 修复与验收约束

- 账号 grant 只在既有原生内存边界；不记录凭据、用户/设备身份、原始服务响应或 SDK 任意错误文本。
- 保留系统证书链、主机名验证、EndpointPolicy、账号 epoch、公钥确认与 unknown 连接门禁。
- 不以硬编码 IP、跳过 TLS、设备代理/VPN/APN 更改、强制 online 或模拟业务成功交付。
- 如需发布可达的受控 HTTPS 入口，先记录源码/部署绑定和兼容方案，再由独立 verifier 实际验证；保持旧入口可用与既有电脑运行实例、云数据及原生会话不变。
- 编译/夹具、模拟器、实体设备、真实账号/工作区读取分别记录。最后必须说明实际走到的阶段和仍未完成事项。

工作区：`mobile-coordination-native`（Native 作者）、`mobile-coordination-route`（入口调查/作者）、`mobile-coordination-verify`（独立审查及独占 ADB）。依赖共享现有 root `node_modules` / Cargo target，不复制依赖或并发大编译。协调者维护产品契约与合并发布；未经新证据不重复 v41 已完成的全平台打包。

## 已选候选

当前手机复核显示官网/auth HTTPS200，协调 IPv4 TCP 成功但 TLS 握手失败；电脑请求受系统隧道影响，不能证明公网直连。Native 调查未发现明确请求参数或 TLS 初始化缺陷。采用既有官网 origin 的精确路径 external rewrite 候选：Android transport root 使用官网，转发至同一个既有协调 alias，维持所有 OAuth 和存储绑定。无需新 DNS、迁移数据或更改手机网络。精确 SDK API 集合由 Native lane 冻结；route lane 负责规则/缓存边界和部署，Native lane 负责默认入口及定向回归，独立 verifier 负责源码审查与实体/模拟器验收。

契约已同步 [mobile-native-contract](../../mobile-native-contract.md) 和 [cloud-configuration](../../cloud-configuration.md)。候选只有通过转发语义与手机实际注册/目录/授权工作区读取后才可记为同步恢复；若后续失败，按新阶段继续定位。

## 实际恢复与发行门槛

- 网站源 `40e0548` 已部署到既有官网项目，9 条精确路径转发到原协调 alias；匿名配置与原入口相等，保留 epoch，无缓存。受控 synthetic wire 9 组通过，含 15 秒轮询与测试会话撤销；旧后端 `/directory` 为404且未声明该能力，SDK 直接使用 `/devices` 兼容分支，并非请求404后降级，未伪造新能力。
- 同签名 ARM64 候选 `e4f3650`／run `43703073305` 在实体 Android 9 手机通过 `install -r` 保留数据覆盖。原蜂窝网络无修改，正常 SSO、在线电脑发现、完整公钥与本机身份核对、授权工作区/既有会话历史读取通过。未发送 Agent/终端命令，未编辑真实文件；文件列表未额外验收。
- API30 模拟器正式 v41 另通过正常登录与设备发现。模拟器与手机证据分开；正式 v42 四 ABI 及其它发行附件仍须精确源码构建、签名与独立核验。

状态：**已交付 [v0.1.43](https://github.com/ywateru/AnyWork/releases/tag/v0.1.43) / code45，官网与正式安装包同源 `417a67f`。** 公开 v41 安装包与旧 tag 保留，候选不冒充正式发行。

### 正式发行检查阻塞

首个正式版本候选 v0.1.42/code44 源 `0a38dbb` 的 Checks `43706633883` 为4项通过、server-web失败，尚无 tag 或 Release。失败是已有 `transport::tests::renewal_preserves_existing_pty_and_later_http` 在3秒有效期夹具、固定等待4秒后未观察到第二次 token 请求。不能未经分析认定为基础设施瞬态或盲重跑；由 Native 作者独立工作树调查实际续期逻辑与测试时序，保留有意义的续期/既有 PTY/后续 HTTP 门槛。独立 reviewer 接受后才恢复正式发布，不跳过检查。网站自动流程另因失效令牌失败，现有已验收官网入口继续服务，正式站点更新另行绑定最终发行源。

续期夹具已在秒末相位控制中复现旧失败：服务端完整墙钟与客户端整秒转换令三秒测试租期几乎没有调度余量。修复只修改测试，使用12秒短租期、观察 gateway 收到刷新授权，再跨过旧到期点验证完整 HTTP JSON 和同一 PTY 的精确回显。作者21项通过，独立正向与“不延长租约”负对照通过；[作者](../reviews/mobile-renewal-check-author.md)与[独立记录](../reviews/mobile-renewal-check-independent.md)保留证据。生产逻辑不变。按 canonical publisher 单调版本规则归档未发布 v42 的真实失败，随后以 v0.1.43/code45 对新精确源码重新运行 CI，未复用旧通过状态。

## 正式交付

- 精确源 `417a67fb1ee743c2ef67f4e75dcd056355fb2e7b` 的 Checks `43709434739` 五项全成功，续期测试实际通过；Build releases `43711399021` 十二项全成功。v43 tag 正确绑定，23 个正式附件、22 条校验项与5组更新签名元数据匹配。
- 四份正式 APK 正文均独立核验单 ABI、appID、v0.1.43/code45、官方单证书、非 debug、JNI/DEX 与 ELF/ZIP 16KiB，正式源码归档1063个 blob/mode匹配精确 Git tree。实体手机 `install -r` 保留数据覆盖正式 ARM64，正常 SSO 后在线电脑发现通过。既有同运行时候选的公钥/工作区/历史读取证据单独保留，不冒称正式包重复了全部业务测试。
- 官网当前 deployment `dpl_9SphfUmfubzcC9pgg8gFPDTFbqMi`，build 与安装包同源/v43，四 ABI 英中文链接、app、CSP、源码和协调配置公开读回通过；原40e deployment保留作回滚，后端/epoch不变。自动流程 `43712745935` 因 token invalid 失败，publisher 真实停在 `pages`；人工精确部署和 `--verify-existing` 成功不被改写成自动流程成功。
- 完整证据：[独立发行与正式手机核验](../reviews/v43-release-independent.md)、[官网部署](../reviews/v43-site-manual-recovery.md)、[网站 staging 独立审查](../reviews/v43-site-staging-independent.md)。不扩展为真实 Agent/终端/文件写入、Claude Desktop 原生控制或所有网络环境均已验收。
