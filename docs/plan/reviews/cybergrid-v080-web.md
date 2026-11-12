# CyberGrid v0.8.0 Web：独立验收

日期：2026-11-12，Asia/Shanghai。

## 结论

**pass，可合并 Web 候选 `a7fb33f111ccb8b1fba9d5be9eb3a3cc3df0bc3a`。** 独立审查树 clean HEAD 为 `353baf8a656ca47d7773af2b3f402d86d3b46550`，包含候选及 main `005ebe9` 文档。依据任务和 analysis/cybergrid-v080；未审未提交作者代码，未修改实现，没有使用 Cargo 或真实账户/业务/Redis 写操作。此结论限 Web SDK 与宿主适配，不接受未提交 Native SDK 或服务端部署。

独立证据：`artifacts/cybergrid-v080-web-independent/`。同目录 `server-readiness.md` 是只读服务端决策建议，不是已实施升级验收。

## 源码与边界

- 官方四模块固定 `f2a3961536e5c69b13c7dbc661953d9243becbae`，组件 metadata JS 0.2.0，不声称 npm 发布。直接从精确上游 git object 重算 SOURCE.json 中每个原始摘要并比较本地摘要：全部一致。bridge/directory/endpoints、LICENSE 与保留 notices 逐字节相同；index 的 TypeScript AST 经忽略 trivia、引号及冗余括号后相同，格式化后的直接 diff 仅方法签名空白。`provenance.json`、`compare-upstream.cjs`、`semantic-compare.json` 可复核。原 CRLF/trailing spaces notices 与它们原始 SOURCE 哈希匹配，不应再次格式化。
- token callback 完整传递 issuer/clientId/resource/scopes/minValidity/forceRefresh/requestReason/generation/signal。宿主校验固定绑定、仅 connect、整数有效期/代次及 force/reason 一致；JWT exp 只判定缓存新鲜度，身份仍由可信 SDK/subject 和接收服务验证。近过期最多重取一次；已强刷仍不足明确失败。
- 所有资源 token、强刷、登录与退出共用 tokenTail。取消排队请求不触碰 grant，已发出的 SDK 轮换完成保存后才释放 owner；轮换失败封锁旧 grant。账号 epoch 与 await 前后 subject 检查拒绝迟到值；SDK 自身 generation/flight 阻止旧连接注册或安装目录返回污染新账号。
- 第一条明确 401 INVALID_IDENTITY、且无 unknown outcome 时，官方 SDK 只强刷一次并保留 request ID。网络未知后保留同一 RAM token/epoch/request ID；未知之后的拒绝不产生新 token 请求。取消后的迟到 session 仍由 SDK 清理路径持有。
- legacy devices/getPortTunnelUrl 路径保留，缺省 products/policyVersion/endpointPolicy 正常兼容；存在的新字段严格验证。业务网关、AnyWork Noise 与 Quick Tunnel HTTPS 根限制没有放宽；没有启用 bridge/watch/finite-v2。原 sidebar-scroll.spec.ts、手势/timeout 门禁无修改。account-layout fixture 仅适配新增 callback 与 subject helper，不改变产品行为。

## 独立执行

| 检查 | 结果 |
| --- | --- |
| npm test（Web） | **397 passed / 40 files**，内含 **18 个真实 vendored SDK→loopback HTTP 用例**；再 **8/8 private-state**。`web-test.log` |
| npm run build（Web） | **pass**，含 tsc；Vite 现有 chunk-size 提示不影响结果。`web-build.log` |
| npm run format:check | **pass**。`format.log` |
| account-layout-check.mjs | **pass**：1440、390 和 390×480 touch shell，192px 历史列表；目录各状态、key确认、连接取消/切换、账号退出焦点与确认。认证/目录/加密传输使用隔离 fixture；浏览器截图在 `browser/`。`account-layout.log` |
| 当前公开 auth/config → 新 SDK | **pass 到 host-authorization 边界**，Node fetch 只读 1 GET，配置固定绑定接受；0 exchange、0 token/credential 输入。`public-config.json`。初次 localhost Chrome 受正式 CORS 限制，未通过，不将其算 SDK 配置失败或浏览器跨域通过。 |
| account-unified.spec.ts | **6 passed / 16.8s**，desktop + Android Web；一次性本地 ticket、Cookie/PTY、退出和公开账号入口。复用已有本地 server binary，3346 独立服务，无 Cargo。`account-e2e.log` |

真实 HTTP 用例使用合成 OAuth provider，真实 SDK 与 fetch/listener，覆盖 legacy 配置/设备/端口、精确首次拒绝强刷、其他拒绝不刷、unknown 同事务重放、unknown 后拒绝不换 token、取消轮换 owner、换号、恢复 subject 变化、迟到目录取消、static 产品限制及畸形策略/目录拒绝。不是生产账号或真正 Noise 握手测试。

## 部署建议与限制

SDK 可与当前旧服务功能兼容，因此服务端升级不是本 Web 合并的协议前提。但客户端更新不能补齐服务端 session/receipt 的实际 authClientId/policyMode 绑定；若本轮要求获得该策略安全收益，建议另行精确升级官方 static-products 服务。单 product ID 沿用现有 Native ID，保持现有 SPA、TLS Redis prefix/epoch/limits 和 legacy-v1；不新增业务桥接或 Management 凭据。

新 static 会拒绝旧无绑定 session/receipt。JS 对同 epoch APPLICATION_UNAVAILABLE 没有自动恢复触发，不能承诺透明重连；需验证明确重连/重载与 unknown fence。不能只移动生产 alias 就宣称旧策略退役，所有旧公开 deployment URL 也须停用或受保护。Standard Vercel Authentication 保留正式域名公开/保护生成 URL 的方案尚待项目实证。本次未执行任何平台变更。

现有 redis-cutover helper 是固定旧 artifact 的 Upstash→TCP 操作，不能重用为代码升级；新 PIN/source/artifact/products/provenance 必须建立新 operation。保留同 epoch 不等于旧代码 rollback 已被证明；回到旧服务会恢复旧策略缺口，应明确作为安全降级。详见证据目录 server-readiness.md。
