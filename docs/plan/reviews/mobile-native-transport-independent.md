# Mobile native transport：独立审查

审查日期：2026-11-13。审查者为非实现者。唯一工作树 `.worktrees/mobile-transport-review`，分支 `codex/mobile-transport-review`，起点 `065ec8547f6d14148842ec77b01a6c78471a235a`。没有编辑 main、作者工作树或 Cargo/lib/lock 共享文件；仅本报告作为审查者提交。所有网络实验只连接本次创建的 loopback Gateway/HTTP/PTY；身份、token、签名 key 均为合成测试材料。

结论：本审查范围 **PASS**。独立发现并复现 **1 项 P1、3 项 P2**，均已报告作者并在稳定修复上独立复测闭环，没有遗留已确认的 P1/P2。Rust core、TS adapter、本机 Gateway 联合检查及独立 WSS 信任检查通过。此结论不代表 Android/Tauri IPC、APK、真实账号或公网 WSS 端到端验收通过。

## 精确源码

| 作者提交 | 本审查工作树 cherry-pick | 范围 |
| --- | --- | --- |
| `6428c6009a82e932cd0ec6a08612fa520eccbf43` | `81e029a` | Rust transport 和测试 |
| `05837945ca89b1346734aec3b42fc36c4b654bea` | `13fd925` | remote JWT/client、Origin、Desktop 构造处 |
| `d8afd9e8957c7e0511832bb77ab9b6dcb008b1ee` | `4611a1a` | NativeTransport.ts / transportTypes.ts |
| `4f475b89a22565cad2587bc20d848ed1269b7533` | `4a4bc69` | 前台授权/lease 核验 |
| `1fb71e968fb924f379cdf9667c4de004954839e1` | `7546a45` | T1/T2 期限及 pending connect 修复 |
| `8cb5eb6eb8d199475abc1ec39ef81a500971c9b8` | `24b415e` | T3 编码前尺寸预检 |
| `b4cbff2d1ec17932b900bf08ad244f806946f5ea` | `5e64a6e` | timeout/limit 契约 code 与 STALE_CONNECTION |
| `c8d8724d0e9ed5801c93b513e5a475568415b1be` | `4d0bb0b` | T4 显式 TLS provider/Connector 与回归 |

已读产品与审查约束：`docs/android-account-entry.md`、`docs/mobile-native-contract.md`、`docs/plan/tasks/android-native-client.md`、`docs/plan/analysis/android-native-client.md`。查找工作树及父目录，没有找到适用的 AGENTS.md。

## 已复现问题与闭环

### T1 — P2 / 已闭环：HTTP 总期限检查晚于操作执行

初始 `connection.rs` 的 `maintenance`（499–518）才删除到期 operation；`command` 的 Write/Finish/Read（563–625）只检查上传或响应状态，不检查 `h.deadline`。`run` 先执行选中的 command，再 maintenance。定时维护和命令同时就绪时，维护没有优先权；发送/授权核验也可能消耗剩余期限。

独立复现：将精确源码的 connection.rs 复制到临时小 harness，原源码字节前缀不改，只在末尾追加 private child tests。使用真实 loopback WebSocket 与 Snow IK transport pair：先 begin 一个 POST，再把该 operation 的单调 deadline 置于已到期状态（等价于 240 秒后的状态，不等待实际 240 秒），调用原始 `Actor::command(Finish)`；对端成功解密到 `end`。另一个测试把已完成响应置为过期，再调用原始 Read，仍取得 `late` 字节。不是重写模型或伪造 command 逻辑。

影响：维护循环抢占前，已过总期限的写操作仍可能提交；已到期响应仍可读。需在操作/帧分支及发送等待中遵守同一个 begin deadline，不因续期或 chunk 进度延期。

初始 BUG 断言：`review_expired_finish_still_sends_end`、`review_expired_read_still_yields_response` 均复现。第一轮 finish probe 因 reviewer 未消费 request 的 Noise nonce 而 Decrypt 失败；修正 fixture 消费首帧后两项复现，未将该 fixture 错误计为产品缺陷。

修复与复测：`1fb71e9` 的 Write/Finish/Read 都先 expire_http；chunk/end 用 send_until 受 begin 总期限约束；入站帧先处理 operation 到期。独立重新取修复源码，再运行原探针的正确性断言：Finish 对端只有 cancel、返回 timeout、operation 删除；Read 返回 timeout 并释放 response_bytes。永久回归另覆盖到期 write 和 inbound end。**闭环。**

### T2 — P2 / 已闭环：close_all 未封锁 pending connect

初始 `mod.rs:64–70` 在完整握手后才插入 peers，`close_all:168–179` 只取出已安装 peers。握手 attempt 不在 registry，也没有 service lifetime 栅栏。

独立复现 `review_close_all_does_not_fence_pending_connect`：真实 Gateway + 原始 TransportService；合成 Authorization::token 用 Notify barrier 暂停。connect 已进入 token wait 后调用 close_all，收到 `cleanupPending:false`；放行 token 后 connect 返回成功，随后 http_begin 仍成功。期间没有启动第二个新 connect。此测试使用真实 Gateway/Snow，不读取真实账户。

影响：调用者认为服务已关闭后，旧连接 attempt 仍可安装可用 socket。账号 lifetime 如果另外正确取消会缓解，但不能替代 TransportService::close_all 自身的关停保证。需原子 retire 所有 pending 和 installed 连接，并在安装前复核同一 registry generation/lifetime。

修复与复测：`1fb71e9` 统一 registry 管理 peers、pending attempts 和 service lifetime；close_all 在同一锁内取消旧 lifetime，安装时复核；attempt completion watch 纳入三秒清理等待。独立原 Notify barrier probe 修正为正确性断言：close_all 后旧 connect 必须 CONNECTION_CLOSED、live registry 为空，已通过。**闭环。**

### T3 — P2 / 已闭环：已知超大 Blob/FormData 在编码后才拒绝

初始 `NativeTransport.ts:125–137` 先构造真实 Request 再读 body stream，之后才按 chunk 检查 22 MiB；没有 Blob.size 或 FormData 累计已知尺寸的前置判断。

独立 Node Web API 计数复现：两个各 12 MiB Blob 的 FormData，已知原始下界 24 MiB；另测 24 MiB Blob。两者最终 LIMIT_EXCEEDED 且没有 native begin，但前者已经构造 Request 一次并 reader.read 五次，后者构造一次/read 两次。此计数不冒充 Android 内存峰值测量，但足以证明用户要求的编码前拒绝缺失。

需在 Request 构造/整体编码前检查可知下界并纳入并发预算；保留单文件 20 MiB、总正文 22 MiB、逐块 IPC。已知不足下界的编码额外开销仍需流式累计预算兜底。

修复与复测：`8cb5eb6` 在构造 Request 之前同步 knownBodySize 并预留并发预算；文件/Blob 20 MiB、聚合 22 MiB，编码后仍累计实际字节。独立原 24 MiB FormData/Blob 计数脚本均变为 Request=0、read=0、begin=0；作者新增永久并发 reservation 与拒绝后恢复用例也独立跑过。**闭环。**

PTY send delivery 的初步源码疑点已撤回：外层 call 在 peer 结束后有 post-check，会保守改为 outcome_unknown；本轮未复现对外泄漏 not_sent，不把它列为缺陷。

## 初次独立验证

先询问 Boole，收到共享 target 已释放后才执行 Cargo；后续明确把窗口交回 Planck。只使用既有依赖，初始 core/Gateway Cargo 命令均 offline + locked，`CARGO_INCREMENTAL=0`、`CARGO_PROFILE_DEV_DEBUG=0`，`CARGO_TARGET_DIR` 指向协调者主检出的共享 target。未进行大型 workspace/native build、依赖安装、node_modules/target 复制。

临时 manifest 从作者最小 harness 复制并把 lib、remote 路径全部改为本审查工作树，增加空 `[workspace]` 隔离，不改变仓库 manifest。下列相对命令均在本审查 WT 执行：

| 命令 | 结果 / 证明边界 |
| --- | --- |
| `cargo test --manifest-path .review-harness/transport/Cargo.toml --lib --offline --locked` | 10 passed；实际 Snow IK、Gateway、JSON/binary、409、完整 22 MiB 字节往返、取消墓碑、generation、epoch 迟到结果、续期保留原 PTY、EOF/outcome_unknown |
| `cargo test --manifest-path .review-harness/gateway/Cargo.toml --offline --locked` | 8 unit + 9 integration passed；合成签名 JWT 的 issuer/audience/owner/scope/exp/nbf/client/azp/tamper，精确 Origin 的缺失/重复/null/lookalike，重放/续期/旧 lease deadline |
| `node crates/mobile/src/transport/adapter.test.mjs` | 5 passed；真实 Node Request/Response/FormData API + synthetic IPC bridge，不冒充 Tauri |
| `cargo test --manifest-path .review-harness/probe/Cargo.toml --lib --offline --locked review_ -- --nocapture` | 3 BUG assertions 复现 T1 两项和 T2 一项，不能把“BUG 断言通过”写为候选正确 |
| `node .review-harness/body-preflight.mjs` | T3 构造/读取计数复现；24 MiB FormData: 1/5，Blob: 1/2 |

额外 JS → Rust → 真实 Gateway 联合检查：编译临时 `[[test]] harness=false` loopback stdio 桥，直接 include 审查 WT 原始 transport 模块；cfg(test) 只允许本机 HTTP fixture。stdout 传 DTO 和事件，JS invoke 委托实际 Rust service。临时 stdout/channel 的排队策略仅属于测试桥，不是产品 Tauri bridge 证据。使用 `cargo test --manifest-path .review-harness/transport/Cargo.toml --test review-native-bridge --no-run --offline --locked` 构建，再由 `node .review-harness/cross-api.mjs` 驱动。

该联合检查 8 项通过：

- HTTP 204、205、304 各返回真实 JS Response，body 为 null、text 为空（共三项）。
- 非 2xx 的 409 保留中文正文与 `text/plain; charset=utf-8`。
- JS HEAD 经 Rust method allowlist 拒绝，隔离本地 HTTP API 调用数不增。
- FormData 经 Rust 原样 echo 后，可用真实 Response.formData 解析 boundary、中文文件名和正文。
- 已 abort 的 signal 在 begin 前终结，不触达隔离 HTTP API。
- 实际 Rust PTY ready/data 通过 Channel 传给 adapter；测试桥刻意延后 open Promise 60ms，确认 ready 在其完成前被处理，ACK/data/幂等 close 正确。

临时桥第一次普通 bin 编译因 axum 仅在 dev-dependencies 而失败；修正仅临时 manifest 为测试入口后通过。未把 fixture 编译错误计入产品结论。

## 修复后最终复测

在 `7546a45` + `24b415e`（含 foreground `4a4bc69`）上：

| 验证 | 独立结果 |
| --- | --- |
| 原始源码 Rust lib suite | **18 passed**，10.42 秒测试时间；包括 240 秒到期状态下 finish/write/read/inbound end、pending close_all、foreground 授权撤销及墙钟/单调 lease 到期不可复活 |
| 修复源码副本 + 独立正确性/边界 probes | **6 passed**，0.12 秒；原 T1/T2 的三个 probe 均改用阻止错误行为的正确性断言；另三个实测墓碑、HTTP/聚合预算、PTY 背压 |
| `node crates/mobile/src/transport/adapter.test.mjs` | **7 passed**，包含 preflight 和并发 known-body reservation |
| 独立 preflight 构造/读取计数 | FormData 24 MiB、Blob 24 MiB 均 **0 Request / 0 read / 0 begin** |
| `tsc --noEmit --target ES2022 --module ESNext --moduleResolution bundler --lib ES2022,DOM,DOM.Iterable --skipLibCheck web/src/mobile/NativeTransport.ts web/src/mobile/transportTypes.ts` | exit 0 |
| 最终源码重编的 JS/Rust/Gateway 联合检查 | 上述 **8 项再次通过**；真实 Request/Response/FormData，真实 Snow/Gateway/本地 HTTP/PTY |

新增三个独立边界 probe 的实际断言：

- 连续登记 **65,536** 个 cancel-before-begin 墓碑后，新 cancel 及新 begin 拒绝；首个已退休 ID 的迟到 begin 仍拒绝；集合不淘汰、不增长，未产生 HTTP。
- **8 HTTP** 后第九个拒绝；取消释放槽位。一个声明 **22 MiB** 上传占满聚合 reservation，另一个 1 字节被拒；取消后 request_bytes 归零且新上传可以登记。
- PTY ready 前 input 拒绝；**2 PTY** 后第三个拒绝。ready + 31 data 达到 **32 sequence** 窗口，下一帧关 PTY；另一个 PTY 的未 ACK 时间置于 16 秒前，维护检测 **15 秒**超时并关停。这里操作的是已到期状态，没有等待实际 15 秒，也没有改变宿主时钟。

Gateway 文件在修复期间未变化，因此没有机械重复初次的 8 unit + 9 integration；最后的跨层检查仍使用其同一精确源码。编译窗口完成即交还 Planck/Boole，未并发占用其原生编译。

`b4cbff2` 错误 code followup 另行独立运行 **7 项 probe** 通过（原六项 + 八种旧 code × 三种 delivery 的归一映射），编译 2.78 秒、测试 0.17 秒。此后新增 WSS 依赖/Connector gate 见下一节，不能由此前 ws 测试代替。

## 逐项边界审查

| 边界 | 源码结论与实际覆盖 |
| --- | --- |
| Noise/目标 | IK suite、installation prologue、静态 key、ready 严格 DTO；生产目标限定 HTTPS quick tunnel 根地址，Origin 为可信常量，JS 不传 token/URL。实际本机 Gateway 覆盖握手；未访问生产 tunnel。 |
| registry/缓冲 | 源码有两连接 semaphore、32 command queue、8 HTTP、2 PTY、单块 32 KiB、请求/响应各 22 MiB 聚合预算、65,536 ID 墓碑、64 字节合法 ID 与单调 rN。无墓碑淘汰；到上限拒绝。完整 22 MiB、非法 chunk、8 HTTP/聚合 reservation、65,536 墓碑、2 PTY 实测；两连接 semaphore 与 32 command queue 已核源码，未对所有队列做饱和并发压力实验。 |
| HTTP 竞争 | 已测 begin 前 cancel、write offset/base64、提交后 cancel、EOF、epoch、迟到结果；过期分支发现 T1，修复复测闭环。finish 标记 submitted 后未知结果保守处理，不自动重放。 |
| lease/续期 | 同时检查墙钟 expires 和单调 deadline；旧 lease 直到匹配 authenticated auth.renewed 才推进。renew id/token 有边界，不重建 Noise/PTY，不重放业务。实际 Gateway 测试含旧 lease 到期和续期验证阻塞。未调整宿主真实时钟。 |
| foreground | 4f475b8 在 actor 核 epoch/lifetime/旧 lease，检查 native token(false,60)，仅 auth.renewed 可延长期限。独立 final suite 覆盖 foreground 有效/撤销、墙钟/单调 lease 到期不可复活。 |
| PTY | ready 前拒绝输入、UTF-8 分块、32 输出 sequence 窗口、15 秒未 ACK 超时、10 秒 open 超时、2 PTY、8 KiB input、JS 64 commands/64 KiB input 预算；无 reconnect/replay。已测真实 input/resize/output/ACK/close/续期保留，独立 actor probe 另测窗口压满和 ACK 超时。 |
| lifetime/generation | 调用前后、actor 帧前和发送前后检查账号 epoch/lifetime；ConnectionRef 精确匹配。epoch late-result 与旧 generation 实测。关停 pending 漏洞 T2 已闭环；完整 account owner/rotation 与 shell 接线未在本范围验证。 |
| client × Origin | 两个精确 client 集合 + 两个精确 Origin 集合分别守门；语义为两个集合的笛卡尔积，没有按 Native↔local、SPA↔website 对角绑定。保留 ES384/issuer/aud/scope/owner/exp/nbf/client/azp 一致性。单 client new() 契约保留；旧桌面需升级 verifier。JWT 与 Origin 拒绝分别实测，尚非四组合端到端 signed-JWT 握手测试。 |

## WSS/TLS 追加审查

### T4 — P1 / 已闭环：双 provider 默认 builder panic

显式 feature 核实：旧审查骨架只有 `tokio-tungstenite="0.29"`，但 shell 稳定提交 `1dd746721de3d60e6ae6ea328baa793552151539` 的 `crates/mobile/Cargo.toml:27` 已直接启用 `rustls-tls-webpki-roots`，第 28 行为 remote path。审查者通过 `git show` 独立读取该稳定源码，没有将未提交文件当成最终依据，也没有为此 cherry-pick shell 的共享文件。

Boole 执行的最终 Android graph 命令为 `cargo tree --offline --locked -p anywork-mobile --target aarch64-linux-android -e features -i tokio-tungstenite`；审查者读取其日志 `/tmp/anywork-mobile-android-tls-features.log`，确认 anywork-mobile 自身有直接的 `rustls-tls-webpki-roots -> __rustls-tls` 边，另有 SDK 的相同边。tokio-tungstenite 0.29 本地精确源码的 default 只有 connect/handshake；reqwest rustls 不能代替该 feature。

源码证据：pinned SDK 的 rustls/rustls-tokio 选 ring，mobile 的 reqwest 0.13 rustls 选 aws_lc_rs。rustls 0.23.46 如果同时开启两者且没有安装 process default，默认 ClientConfig::builder 会 panic。transport 使用 tokio-tungstenite 的默认 connector，其 tls.rs 也调用此 builder；reqwest 用局部 builder_with_provider，不替它安装全局 provider。此项先行报告 Boole/Planck 后，已独立在双 provider 的 fresh 进程运行复现：检查默认 provider 为 None，创建实际 reqwest Client 后仍为 None，catch_unwind 确认默认 ClientConfig::builder 在 rustls:249 panic。该 BUG 断言通过不代表旧实现正确。再次把同一生产默认 `connect_async_with_config` 用于 loopback WSS，client task 也明确以 panic 结束；该负控不经过任何修复后的 shell guard。

独立无 feature 负控：临时 crate 只启用 tokio-tungstenite 默认特性，同时依赖 reqwest rustls；实际 loopback WSS 返回 `TlsFeatureNotEnabled`，1 项通过。首次尝试调用被 feature-gate 隐藏的 client_async_tls 不能编译，已改成产品同类的 connect_async 公开入口后通过；该 fixture 编译结果不计作产品缺陷。TLS 临时 crate 首次使用 offline 解析已有缓存并生成本地 lock；之后使用 offline/locked，不安装或下载依赖。

修复：`c8d8724` 的私有 `transport/tls.rs` 使用 `ClientConfig::builder_with_provider(ring)`、正常安全协议版本、固定 WebPKI 根集、`with_no_client_auth`；连接改用 `connect_async_tls_with_config(..., Some(connector))`。没有生产 trust override、accept-invalid 或关闭 hostname 校验的入口。shell 另外保留全局 ring guard，但本审查的独立实验不运行 shell 入口，不依赖该 guard。

独立复测：临时 TLS crate 使用与最终图相同的 ring + reqwest aws-lc 组合。原样复制生产 tls.rs；仅追加一个 cfg(test) 私有构造转发，以本次 OpenSSL 生成的测试 CA 调用原始 client_config。三个独立用例与三个永久用例共 **6 passed，0.02 秒**，最终编译 1.27 秒。独立三个用例每个开始和结束均断言 `CryptoProvider::get_default().is_none()`：

1. 正确信任测试 CA、hostname=localhost 时实际 TLS WSS 字节 echo 成功，stream 为 Rustls。
2. 原始生产 connector 的固定 WebPKI 根集拒绝该测试 CA，匹配结构化 `CertificateError::UnknownIssuer`；不是无 TLS、timeout 或连接拒绝的假阳性。
3. 同一原始 client_config 信任该 CA，但请求错误 hostname，匹配结构化 `NotValidForName / NotValidForNameContext`；没有因为可信 CA 放弃 hostname 校验。

命令：`cargo test --manifest-path .review-harness/tls/Cargo.toml --test tls --offline --locked -- --nocapture`。另一个独立 test binary 使用 `--test ambiguous`，确认原默认 builder/默认 WSS 函数在未安装全局 provider 时仍会 panic，正确区分修复路径与旧路径。无 feature 负控为 `cargo test --manifest-path .review-harness/no-tls/Cargo.toml --offline --locked -- --nocapture`。

第一轮独立证书 fixture 的 LibreSSL EC 私钥 DER 无法被 ring 解析，改为标准合成 RSA CA/leaf 后才测信任；错误 hostname 首先采用错误字符串断言，已改为结构化证书错误断言。最终 6 项均通过；这些 fixture 修正未作为产品缺陷。所有证书/密钥均在本次工作树临时生成和删除，没有读取或修改系统/用户信任库。该本机验证证明显式 provider 和证书检查路径，不证明某公网 Cloudflare tunnel 的实际证书链可用。

**T4 闭环。** 最终 TLS 变更的独立覆盖为原始 helper/证书验证与连接调用源码审查；作者报告的完整 21 项 transport suite 本审查没有在最后 TLS 提交上全部重跑。前面的独立 18 项、7 项 code/boundary probes、8 项 JS/Rust 联合检查分别绑定其表中精确版本，不能合称“最终 Android 全功能通过”。

审查结束时已明确归还共享 target；删除本次约 0.5 MiB 临时 harness、日志、合成证书及其 serial 文件。共享 target、他人工作树、安装依赖均未清理。永久正确性回归已由作者纳入实现提交，本审查只提交此文档。

## 限制

本审查不构成实际 Android APK、Tauri 权限/Channel ABI、WebView、后台挂起/恢复、真实账号授权或目录 trust commit 的验收。没有操作在线手机/服务，没有读取真实 token/账号/会话，没有下载 AVD/镜像，没有发布/推送/更改版本。完整 Cargo/lib/lock 与 Android 接线由 shell owner 负责；此处最小 core harness 通过不能替代最终 mobile crate 编译。

错误 code 补充：初始 REQUEST/SEND/HANDSHAKE_TIMEOUT、各类 *_LIMIT 已在 `b4cbff2` 统一成契约 TIMEOUT/LIMIT_EXCEEDED；已安装连接的 generation 不符返回 STALE_CONNECTION，delivery 不变。OPERATION_RETIRED 等额外具体 code 仍存在；账号错误及 shell/UI 的最终用户态映射属于集成验收范围。
