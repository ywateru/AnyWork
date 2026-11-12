# CyberGrid v0.8.0 集成评估

日期：2026-11-12。用户要求检查 CyberGrid 更新，并将必要调整纳入本次修改。上游正式版本 [v0.8.0](https://github.com/ywateru/CyberGrid/releases/tag/v0.8.0) 对应 `f2a3961536e5c69b13c7dbc661953d9243becbae`；当前集成基线为 `2bd6729c6bbee90ed2926410caca883a0a100890`。发行项目版本与组件版本不同：Rust SDK 0.3.0、JS SDK 0.2.0、Node server 0.2.0。

## 决策与模块

本轮采用新版官方 Rust/JS SDK 并适配宿主调用，继续使用现有 AnyWork Noise 业务通道、RAM-only grant owner 和 legacy `memory-v1` 协调模式。新 bridge、directory watch、finite-v2 不因依赖更新而默认启用。服务端更新是否必要另行核对；不得仅替换部署 PIN 使旧 artifact/provenance/恢复状态失去对应关系。

JS 的 0.2.0 是固定源码中的组件 metadata，不声称 npm 包已发布。直接 vendor 官方四模块，保持原始许可/notice 来源和可复核 hash；现有 TypeScript notice 如经格式化导致记录 hash 不符，应恢复原始 bytes 或明确记录归一化。

| 模块 | 输入与输出 | 修改与约束 |
| --- | --- | --- |
| Rust SDK / Native host | 已验证账号授权、明确远程意图 → 注册、发布与关闭结果 | 固定新提交；在既有默认一次/手动启用策略内部显式开启 SDK remote gate；确认发布后才写目录/宣告开启 |
| Native AuthProvider | 固定 issuer/client/resource/scopes 与新鲜度请求 → 唯一 RAM owner 的令牌 | 明确验证请求绑定和新鲜度；不取消已发出的轮换，不复用未知结果的旧 grant，不增加落盘凭据 |
| 官方 JS SDK 四模块 | 宿主 token callback、固定公开绑定 → 设备和端口发现 | 同步 index/bridge/directory/endpoints 及来源说明；旧 discovery API 保留，业务对话与 Noise 通道不迁移 |
| Web token adapter | SDK forceRefresh/minValidity 等请求 → 经校验的新鲜 token | 绑定必须匹配当前配置，强刷沿现有 AccountLogtoClient；保持账号切换、取消和迟到隔离 |
| 部署与来源 | 精确服务器源码、配置、artifact → 可恢复部署 | 如需更新，先记录具体兼容性与操作候选、独立审查，再新建 operation；保留严格 TLS Redis、现有账号字段和回退证据 |

## 集成链路

1. 登录/默认一次或手动启用 → Native grant owner → SDK 身份与 remote gate → 端口确认发布 → 原 Logto 安装目录；失败不得留下假在线状态，手动关闭不得被恢复流程重新开启。
2. SDK 初次/恢复/强刷 → AuthProvider 请求绑定 → 串行 OAuth 轮换 → SDK 注册/恢复；取消不使未知旋转可重放。
3. Web 登录 → AccountLogtoClient → 新 JS callback → 当前协调服务真实 HTTP → 安装目录与端口 → 原 AnyWork 加密通道；发现 unknown 与 offline 分开，取消/换号拒绝迟到成功。
4. 新旧客户端 → 当前或候选服务器 → 原 TLS Redis 协调命名空间；旧部署可恢复，不能借 SDK 更新清空存储、改 epoch 或引入 Management M2M。
5. 精确来源与 notices → AnyWork source offer/安装包 → 发布；沿用原许可边界，不把依赖公开或版本更新解释为新许可。

## 令牌与兼容边界

- 新 SDK 请求的 `issuer/clientId/resource/scopes` 必须匹配宿主公开绑定。JS callback 的 scopes 为 `connect`；Rust 请求取自可信 auth/config 的完整 OIDC scope 集合，当前为 `openid offline_access profile email connect`，必须与固定已知集合一致且拒绝重复或未知值，资源 JWT 继续要求 `connect`。不得把 Rust 请求误限为单一 `connect`。`minValidity` 是秒，`forceRefresh/requestReason/generation/signal` 不得被只取 resource 的旧适配丢弃。
- Native 注册/交换结果未知时必须保留 SDK 所持的原事务，或明确阻止新尝试直至完成该事务的清理；不能因开启失败而丢弃 client，再让普通重试创建另一笔未知注册。协调撤销未确认与本机访问已关闭分开表达；本机关闭不能依赖云端确认才生效。
- Web 沿原 `tokenTail` 单 owner 获取令牌，检查缓存 JWT 剩余寿命，不足时最多重新获取一次，再不足则明确失败；`exp` 仅判定 freshness，身份继续由原可信验证路径决定。已发出的轮换须完成保存/撤销，不因取消等待丢弃其 owner。
- 初次交换不强刷；只有第一次明确 `401 + INVALID_IDENTITY` 且此前无未知结果，才允许同一 request ID 的一次 forced refresh。其他拒绝和网络/服务错误不触发这条刷新路径。未知交换保留同一 RAM token/epoch/request ID；未知之后的拒绝不能自动新建授权或刷新。
- 旧服务缺省 `products/policyVersion/endpointPolicy` 时，保留原 `devices()/getPortTunnelUrl()` 兼容路径；新字段若存在则必须通过新版严格校验。AnyWork 入口仍只接受原合法 Quick Tunnel HTTPS 根，不因新版 endpoint descriptor 而放宽允许地址。

## 验收

模块测试之外，需打通真实 SDK 到 legacy HTTP 协调夹具，并记录固定上游版本的实际公开配置兼容性。Native 覆盖默认门禁、显式开启/发布确认/本地关闭、取消、unknown exchange、唯一 owner 和绑定/新鲜度；Web 覆盖四模块构建、fresh token 分支、身份/取消隔离和原设备连接回归。保留原登录、命名及 macOS 窗口验收，增量独立审查后再发布。

## 服务端范围决定

本次发行更新 SDK 与宿主适配，保留目前已部署、经目录补丁适配的协调服务。旧服务已在交换时验证固定 SPA/Native、issuer/audience、用户身份和 connect，Native 请求持续检查应用目录。当前单一 SPA、单一 Native 及允许列表不变，没有发现必须立即切服才能关闭的当前授权缺口；新版 SDK 对 legacy 服务的实际 HTTP 兼容性仍是发行门槛。

v0.8.0 server 的 static products 可替代本地目录补丁，并在策略变化后持续验证 session 的 authClientId/policyMode。但 static 会拒绝旧未绑定 session；旧注册 receipt 的兼容恢复也不等价，不能声称现有会话透明升级。因此服务端切换须作为独立操作先验证旧→新 static→旧的 Redis、receipt、重新登记与回退行为，保留原 TLS、prefix、epoch、seed 和 limits，不在本次 SDK 更新中改配置或初始化 namespace。启用 finite-v2 需要独立 prefix，仍不在本轮范围。

只读 provider 核对显示正式 alias 的公开配置正常，当前及旧 immutable deployment URL 匿名访问被 Vercel Authentication 拒绝；现有保护必须保留。拥有 provider 授权或 bypass 的访问不等于旧 runtime 已停止。未来切换不能仅移动一个 alias 就宣称旧入口全部退休，也不能修改历史 helper 的固定哈希使旧 operation 失去回退能力。此处记录的是本轮范围决定，不宣称服务端已升级或完成回滚实验。
