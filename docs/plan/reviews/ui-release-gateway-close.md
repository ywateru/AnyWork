# Gateway 关闭验收修正：独立复核

日期：2026-11-12，Asia/Shanghai。结论：**pass，可合并；未发现 blocking finding。**

只审已提交作者候选 `da043f04404feadae4d18a0db62650b644941b23`；独立 review 基线 `349d424bb4273901148f66f0e618345787d41c1d`，合并后固定源码 `475b11de9a51ccd7019c67a88da376f4c010a049`。变更限于四个 Native/remote 源码与测试文件。本结论接受原 gateway 关闭观察和测试同步修正，不宣称已查明 v0.1.27 CI 历史失败根因，不宣布 v0.1.28 发布完成。

## 历史问题与结论边界

v0.1.27 release 的 macOS arm64 job 两项失败均位于 `Fixture::close` 中对旧数字端口执行 `TcpStream::connect().is_err()` 的断言。此前独立只读汇总作者诊断的 80 轮日志：37 轮全绿，43 轮只有 provider readiness 文件标记超时；原两项断言没有复现。2,197 条已记录的 gateway close 都正常完成，最大约 205.458µs。受控竞争 listener 压力也未捕获原成功连接或其归属。因此 **CI 当时究竟有残留 gateway、端口重用还是其他 TCP 现象仍无实证定因**；这段历史不能改写为已证明端口重用。

新测试在明确安排的 foreign listener 场景中证明旧断言的误报条件，能独立支撑替换这个测试判据。另一个 readiness 超时问题改为同步真实进程创建边界，不与原 CI 两项失败混为一谈。

## 源码与契约复核

| 边界 | 独立审查结果 |
| --- | --- |
| 只观察原任务 | `GatewayShutdown` 的 `AbortHandle` 字段私有，公开接口只有 clone 与 `is_complete()`；没有 abort/cancel 或返回内部 handle 的能力，创建、克隆和释放该观察句柄都不触发关闭。`is_complete` 读取 Tokio 原 serving task 完成位，未使用可复用的 port，也未把 cancellation requested 当成 finished。 |
| task 与资源生命周期 | 核对本地精确依赖 Tokio 1.54.1 的 `runtime/task/{abort,harness,core}.rs`：future 完成/替换为 output 后才标记 COMPLETE。Axum 0.8.9 `serve/mod.rs` 的 graceful serve 明确先 drop 原 listener、再等连接任务收敛。该 future 拥有原 serve/listener，完成证据对应原资源生命周期。它不替代所有业务 WS 已关闭的实测；本轮另保留真实 Noise/WS 测试。 |
| production 关闭语义 | gateway 的 cancellation、3 秒 join timeout、provider stop、watcher/SDK cleanup 顺序均未改。`Remote::close` 仍先关本地 gateway，再停止 provider 和等待 Grid revoke。本候选没有用观察句柄强行关闭任务，也没有通过更改超时让测试通过。 |
| 失败启动路径 | `cfg(test)` 列表在 accounts 唯一的 `Gateway::start` 成功后立即记录 observer，早于 provider 准备、创建、readiness 和后续 SDK/目录事务；因此未进入 `State.remote` 的后续失败也有原任务记录。启动前失败没有创建 gateway，不应产生记录。fixture disable 返回后立即检查全部记录完成，不额外 grace retry，并检查 disabled、remote 为 None、无报告客户端。 |
| 可控旧端口误报 | 新测试先证明原 observer 尚未完成，再执行真实 Native enable→disable，断言原任务完成；随后成功 bind 精确旧端口，并 connect/accept 两端，比对双方 local/peer 地址。此时裸 TCP 成功归属于已知替代 listener；旧 `is_err` 判据会失败，但原任务关闭检查仍通过。这个实证排除了仅靠 TCP self-connect 解释受控样本的可能，不外推为原事故根因。 |
| pending revoke | 阻塞 DELETE 期间、释放网络响应之前即检查全部原任务完成、provider 停止、SDK remote gate 为关、Native enabled 为 false；失败 cleanup 保持禁止替代 registration 的既有断言。没有把远端 revoke pending 降格为本地仍开放。 |
| readiness 同步 | test-only oneshot 在 `OwnedProcess::spawn_account_provider` 成功之后发送真实 `Child::id()`。底层仍为真实 `Command::spawn`，不是虚构 PID 或返回假进程。接收和 disable 的 3 秒 deadline 均保留；测试确认 enable 未完成、原 gateway 仍运行，再取消并等待 enable 错误，最后以 `kill(pid, 0) == -1` 检查实际 child 已退出，且没有 config 请求。移除的是 shell 写文件的无关调度依赖，没有移除 provider 创建/取消门禁。 |

## 独立执行

使用独立 review 树，先构建本树 desktop UI dist；共享 root target 串行使用，`CARGO_TARGET_DIR=/Users/water/work/2026/any-work/target`、`CARGO_INCREMENTAL=0`，没有新建大型 target。

| 命令 | 独立结果 |
| --- | --- |
| `npm run build:desktop-ui` | pass，生成本树新 dist；未改 UI 源码。 |
| `cargo test --locked --release -p anywork-desktop --lib accounts::default_tests -- --test-threads=16` | **20 passed / 0 failed，8.51s**；含受控 port-reuse、新 readiness、原两项失败、失败 enable 与 pending revoke。 |
| `cargo test --locked --release -p anywork-desktop -p anywork-remote` | **Native 78 passed / 3 ignored，34.51s；remote 5 unit + 8 integration passed**。真实 loopback HTTP/Noise/WebSocket 测试先完成认证业务响应，再关闭 gateway，验证原 observer 完成、客户端表空以及实际已建 WS 在 1 秒内收到 close/EOF/error。其他 Noise 认证、renewal、expiry/tampering 边界也通过。 |
| `cargo clippy --locked -p anywork-desktop -p anywork-remote --all-targets -- -D warnings` | pass。 |
| `cargo fmt --all --check`、候选 patch `git diff --check` | pass。 |

未重跑无关全 Web/server 测试或 80 轮压力；本轮执行一次既定并发边界，再执行完整 Native/remote，未遇新失败。3 个 ignored 仍为显式公网配置 probe、官方 cloudflared 下载和发布 updater 实装测试，不宣称已执行。

## 证据、交接与剩余限制

永久证据位于主树忽略目录 `artifacts/ui-release-gateway-independent/`：`provenance.json`、`candidate.patch`、`desktop-ui-build.log`、`release-boundaries.log`、`full-native-remote-release.log`、`clippy.log`、`fmt.log`、`validation.json`。前置只读诊断汇总保留于 review 树 `artifacts/ui-release-gateway-independent/diagnostic-audit.json`，并复制到永久证据目录。

本轮没有作者代码修改、用户 app/服务生命周期操作、真实账号/业务操作、OS 权限变更、远端写入、tag 或 publish。所有检查结束，共享 Cargo target 已释放给 root。macOS arm64 本机验收不能替代新精确源码的远端 CI；v0.1.27 release 失败历史及 tag 不改，root 后续按 v0.1.28 流程发布。本报告不把先前线上 v0.1.27 源码身份通过当成新版本资产验收，最终 source/下载/资产检查等待新发布完成信号。
