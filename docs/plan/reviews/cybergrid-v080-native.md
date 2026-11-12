# CyberGrid v0.8.0 Native：独立验收

日期：2026-11-12，Asia/Shanghai。

## 结论

**pass，可合并 Native 候选 `d56532a74fe9d46dd998d55ae632f7ba100f7ab7`。未发现 blocking finding。** 独立 review HEAD 为 `11d8b81328840a990a3a13f9718ddc949bfc80ce`，包含 main `e4796e1`（已接受的 UI/Web SDK）及本候选。依据 task、analysis/cybergrid-v080 和 account-desktop 的 RAM owner、完整 OIDC scope、legacy HTTP 与远程门禁契约。

未审作者未提交修改，未改实现。报告仅提交在 review 分支，供 root cherry-pick。证据在主树忽略目录 `artifacts/cybergrid-v080-native-independent/`。没有真实账户/业务/Redis/部署写入、权限变更或用户 app 生命周期操作；没有重复缺权限的 CUA 拖动尝试。

## 独立源码与来源审查

- Cargo.toml 与 lock 固定官方 Rust SDK **0.3.0 / `f2a3961536e5c69b13c7dbc661953d9243becbae`**，lock 只更新该 SDK 的版本/source。实际 Cargo checkout 的 tracked status 干净；client.rs、auth.rs、Cargo.toml、LICENSE、THIRD_PARTY_NOTICES 与精确上游 git object 逐字节一致。Native notice 更新对应版本与提交，未修改原许可边界。`independent-provenance.json` 留存来源及候选文件摘要。
- GridAuthorization 绑定既有唯一 RAM GrantOwner、宿主意图 Arc 和精确 SDK Client Weak pointer；同数字 generation 的另一 Client 仍拒绝。请求校验固定 issuer/Native client/resource，完整 `{openid, offline_access, profile, email, connect}` 集合及重复/缺失/未知 scope、秒级有效期、legacy reason/force 配对、SDK generation、关闭/取消及宿主意图。Rust 没有误用 Web 的 connect-only scope 规则。
- 宿主没有资源 token cache，每次 callback 在原 GrantOwner mutex 内获取新 token；因此普通请求不需要复用缓存或手动清 cache。请求前、取得 owner 后、轮换完成后均复核生命周期。已发出的轮换不被取消等待丢弃，新 refresh grant 先保存在原 RAM owner；未知 OAuth 结果禁止旧 grant 再用。JWT exp 仅判定 freshness，不替代既有身份验证。
- 改用 login_with_auth_provider，保持 grant_store=None，不调用 SDK credential store、浏览器登录/import/load。SDK 初始 remote gate 关闭；expose 只保存意图，宿主在原 default-once/manual-enable 策略内显式 enable_remote。只有 Ready/PublicationConfirmed、当前 confirmed_intent_revision 与 server_publish_revision 通过，才写安装目录并报告 enabled。SDK enable_remote 提前打开 gate 的失败路径会关闭本机入口并 retire client；初始化已提交 session 的失败路径同样保留清理 owner。
- 初始协调 exchange unknown 留在 PendingGrid 原 Client/authorization/token/request/revision/epoch；同 owner/同宿主意图才能原事务恢复。手动关闭或换 owner 先协调清理，撤销未确认保留精确 client 并阻止替换注册。unknown 后的拒绝不会强刷。OAuth uncertain 与协调 unknown 分开，不因普通 UI 重试创建第二个未知登记。
- Remote 关闭先 retire callback，再关 AnyWork gateway/连接及 provider，然后 await SDK disable/revocation；云端失败不会恢复本机入口。默认 once 已消耗和 manual-off 的恢复/轮询仍不得重开。迟到 publish/index 响应通过宿主意图检查，不能恢复旧 enabled 状态。
- AnyWork Noise、Quick Tunnel HTTPS 根、Account API 目录格式、设备命名/SSO、dirty draft 与本地服务所有权契约未扩展；SDK 未用的 iroh/STUN 显式关闭。无 server/Redis、finite-v2、bridge/watch、UI IPC 形状变化。

## 独立执行结果

所有 Cargo 使用共享 `/Users/water/work/2026/any-work/target`，`CARGO_INCREMENTAL=0`；没有第二个大型 target。先独立构建当前 desktop UI，再构建 Native，未启动安装 app。

| 检查 | 结果与证据 |
| --- | --- |
| `cargo test --locked -p anywork-desktop --lib -- --test-threads=1` | **77 passed / 3 ignored / 0 failed**，执行 44.21s；包含全部 **19** 个 Native SDK/生命周期边界，以及原登录/profile/命名/所有权/更新测试。`native-lib.log` |
| `cargo clippy --locked -p anywork-desktop --all-targets -- -D warnings` | **pass**。`native-clippy.log` |
| `cargo build --locked -p anywork-desktop` | **pass**，使用本轮新 UI dist。`native-build.log`、`desktop-ui-build.log` |
| `cargo fmt --all -- --check`、候选 `git diff --check` | **pass**。`native-fmt.log` |
| 禁止非 loopback 出站的 19 个边界复核 | **19 passed / 9.33s**，直接运行测试二进制，子进程 sandbox policy 只允许 localhost 出站；不改变系统权限。`fixture-loopback-only.log` |
| 独立补充边界 | **3 passed / 0.52s**，见下。`independent-boundary.log` |
| 当前公开配置只读 probe | **pass**，实际新 Rust SDK `sdk=ok binding=true`，原生 HTTP `http_200`；外层明确断言该输出，而非只依赖 probe 的测试退出码。仅公开配置 GET，无 token/登录/exchange。`public-config.log`、`public-config-assertion.json` |

三项 ignored 分别是显式公开网络诊断、官方 cloudflared 下载和临时 app 更新安装。仅单独执行了公开配置 GET probe；未启用下载/安装测试。

19 个用例通过实际固定 SDK、loopback Axum legacy memory-v1、实际 Native adapter、合成 provider 进程与本地 gateway，覆盖默认 gate、显式发布、unknown receipt 原事务、unknown 后 401、不强刷新类别、完整绑定/新鲜度、cancel/owner/client、发布失败/初始发布失败清理、先关本机入口再等待失败撤销，以及迟到确认与 manual-off。没有用 mock Client 代替 SDK。

新增三项测试只追加在 `git archive 11d8b813` 的临时副本，作者与 review 产品源码均未改：

1. 持有 grant mutex 使请求排队，取消后释放：拒绝，token endpoint **0** 次。
2. 关闭精确 Client 后，给其传仍未取消、generation 匹配的请求：拒绝，token endpoint **0** 次。
3. 夹具先保存 exchange receipt，再返回 HTTP 200 的损坏 JSON：宿主保留未知原 client，显式重试恢复原请求/完整 body/token/registration key/revision；仅 **1 receipt**，没有额外资源 token 轮换，目录只在恢复后写入。

证据包括 `independent-boundary-tests.rs`、`archive-fixture-extension.diff`、`run-independent-boundary.py` 和 `archive-source.json`。首次准备该临时副本时，系统 Python 不支持 tarfile.extractall(filter=...)，在解包/附加测试前报错；改用本机 tar 解包固定 git archive 后三项全通过。这是验收驱动兼容修正，不是产品修复。

## 出站隔离核对

作者首轮曾把无效合成 grant 发往固定 issuer 的历史没有被抹去。本轮逐路径确认：Fixture 将 Account endpoint/Grid URL 设为 loopback；GrantOwner 的 cfg(test) token_endpoint 指向本地 `/oidc/token`，owner.revoke 从同一 override 派生 `/oidc/token/revocation`。该 override 不进入 production build，生产仍使用固定可信 issuer。SDK iroh/STUN 关闭，cloudflared 是只输出合成 URL 的本地 shell/sleep fixture。19 用例在禁止非 loopback 出站的进程 sandbox 内仍全部通过，为最终夹具不依赖外部 token/revocation 请求提供独立实证；这不声称重建作者早期运行的网络历史。

## 实证边界与交接

legacy HTTP 夹具证明宿主与真实 SDK 的请求/失败/所有权兼容，不证明生产 Redis receipt 原子事务、真实 provider 轮换、跨设备加密握手或完整候选 Native 登录 runtime。此前 provider SSO、UI 实窗和 Web 验收保持各自边界；拖动位移仍是已记录输入环境限制，没有因 SDK pass 改写为通过。

未知且已关闭的 SDK 登记可能继续保留 cleanup pending 并阻止新登记；本轮未引入绕过 unknown 的新请求。退出进程丢弃 RAM 不代表云授权或未知登记已撤销。snapshot.enabled 沿用宿主已确认初始发布的 enabled 意图，不是后续实时协调可达性的新设计。

本轮接受 SDK-only/current server unchanged 范围。没有初始化 Redis、变更 epoch/prefix/allowlist 或迁移服务端策略。后续 server static-products 的旧→新→旧 receipt/session 与回退实验仍属独立任务。

所有独立 Cargo 命令和 fixture 已结束，可交回共享 target。root 合并后仍须执行适当集成检查、精确源码 CI/publisher 与最终发行/线上只读验收；本报告不是发布完成声明。
