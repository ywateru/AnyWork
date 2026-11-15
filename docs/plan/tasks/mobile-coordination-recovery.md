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

状态：候选实施准备中，尚未部署或恢复验收。
