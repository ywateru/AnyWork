# 默认远程与精简控制台：独立审查

状态：**PASS（精确源码验收）**。Native 与最终 UI 补丁已独立通过；云端月额度耗尽仍为已明确的外部限制。此报告不代表已发布、已安装或云端已恢复。

## 范围与边界

审查工作树 `codex/desktop-default-review`，初始基线 `bae075838296a312d95de1fcefd4bb773df06262`。依据 `desktop-default-remote` 任务和 `desktop-onboarding-layout` 契约，重点检查每个 RAM grant 的一次默认尝试、手动关闭保持、关闭/注销在操作锁前隔离旧请求、资源清理、失败不阻塞本地服务，以及四种尺寸的渐进展开布局。不得将外部服务配额故障当作客户端绑定校验错误或用额外重试掩盖。

本次没有登录真实账号、读取设备目录或业务正文、启用远程、修改云端配置/计费，也没有操作现有 Native 或服务。Cargo 缓存由作者独占期间，审查者不运行竞争构建。

## 协调服务故障的独立证据（2026-11-11）

- 公开配置 GET 经 shell 当前代理与直连分别返回 HTTP 503，固定类别 `COORDINATOR_UNAVAILABLE`。这两次 curl 只证明对应 shell 路径；Native 作者另有实际 pinned SDK 与 Native reqwest 同样 503 的证据，不能混称同一传输。
- 使用既有 Upstash REST 配置，只执行无写入的 `PING`、命名空间元数据 `TYPE` 和初始化标记 `GET`。前两项 200，后者 400，提供方固定短语为 `max requests limit exceeded`，错误中的计数为上限 500000、当前 500030。PING/TYPE 成功不能证明有额度执行协调器的实际 Redis 操作。
- Upstash 管理 API 读取既有数据库元数据返回 200：数据库 active、free，`db_request_limit=500000`、每秒命令上限 10000。只读取管理统计，无键枚举：`total_monthly_requests=521193`（read 499266、write 21927），月费用 0，存储 24157 bytes，月带宽 269767811 bytes。错误计数和统计采用不同计量/采样，未假设两者完全一致；二者均超过 500000。
- 因而当前已复现问题为 Redis **月请求额度耗尽**，不是瞬时每秒限流、客户端 issuer/resource/client 绑定错误，也没有证据表明需要修改 OAuth、放宽配置校验或重复注册。仅有代理 TLS 异常的其他探测不能解释直接 HTTP 503 和 Redis 的明确配额拒绝。
- 已阅读部署使用的 pinned CyberGrid `2bd6729` 服务源码：协调器初始化/就绪依赖 Redis，外层将失败转换为固定 503。此处依据实际部署版本，不把本地较新 CyberGrid 实现当作线上代码。未执行 Redis 初始化、reset、迁移或注册写操作。

官方当前 [Redis pricing](https://upstash.com/pricing/redis) 明确 Free 为每月 500K commands；Pay as You Go 为每 100K commands $0.20，Fixed 250MB 为 $10/month（另列 read-region 费用）。Free 恢复需等待额度周期恢复；如需立即保持服务，必须由负责人选择并明确批准适当的付费额度/预算，同时分析协调器请求成本。此次没有升级或购买。旧故障排查文档链接在本次读取失败，不将其当作已验证引用。配额周期具体重置时刻尚未验证，不能承诺某个恢复时间。

## 精确源码与独立验证

已在审查工作树隔离合并 Native `6d0d4c0d21c316dc322b0b5a3ce3e199dc796eca` 和 UI `0d16eb18c253352f5913b4aeb8602edc347e2f65`，未修改产品代码。

UI 后续修正为 `db2625d2fa579d6e95851a63967729e97ed58023`，同样已隔离合并。Native 后续 `5a2c9e63934f9029d772fad2336e6cda50dccccb` 仅作者证据更新，不改变已验产品源码。

- Native 在等待 operation 锁前捕获 owner 和 generation；disable/logout 先失效该 generation，再等待锁并关闭资源。默认次数和 manual-off 属于 RAM GrantOwner，不依赖 renderer 重载。默认失败被消费；本机服务未核验时拒绝但不消费。显式开启可恢复手动关闭；注销撤销失败使 grant 不能重新开启远程。
- 等待 provider 和公开配置可以取消；已发出的 refresh/register/PATCH 等待结果而不重放。各阶段和最终接管检查代次。已经在飞行中的 PATCH 可能留下离线目录记录，这一限制已明确，清理不保证“未发生该写入”。gateway/provider/SDK 清理路径均有定向断言。snapshot 等待 refresh 时不持有全局 State，避免轮询挡住关闭意图。旧 watcher 绑定原 owner/代次。
- Reviewer 自行生产 UI type/build PASS，输出 `index-BNmv74FC.js` / `index-DfVnwZ1X.css`，与作者最终产物名相同。日志 `/tmp/anywork-default-independent-build.log`。
- Reviewer 自行运行 `cargo test -p anywork-desktop --lib accounts:: -- --test-threads=1`：**26 PASS、1 explicit-network probe ignored**。包括全部 8 项新默认策略测试、真实 Tauri IPC→本地核验→真实 pinned SDK 调用链、关闭/注销延迟竞态、token 轮换及无 ticket。日志 `/tmp/anywork-default-independent-native.log`。未运行被忽略的公开探测；外部诊断与隔离集成证据分别记录。
- Reviewer 在 UI 作者完成后的精确工作树/生产 dist 上自行运行两种 Chrome 项目的 6 项定向测试：**12 PASS**。覆盖默认开启、手动关闭后 reload/设置保持、显式重启、失败后本地可用/详情/重试、pending default 时本地打开/设置/退出、同账号重新登录、账号状态失联时延迟派发、键盘 disclosure。日志 `/tmp/anywork-default-independent-browser.log`。
- Reviewer 自行运行四尺寸生产 UI 检查：**4 PASS**（1440×1000、960×720、800×620、390×844）。日志 `/tmp/anywork-default-independent-layout.log`。检查作者最终 960/800/390 图片，主次层级清楚，800 下连接摘要可达；390 按设计纵向滚动，无横向溢出。这些为实际 Chrome + 合成 IPC，不代表安装后的 WKWebView、物理手机或云端恢复验证。

## 审查发现与关闭证据

**原阻塞，现已关闭：打开账号入口会丢弃同一登录授权下的迟到远程失败。** `useAccountController.action` 原先共享单个 generation；默认操作 pending 时，允许点击的“打开账号入口”调用普通 action 并推进 generation。原远程操作随后失败时，错误因 generation 不相等被丢弃。Native snapshot 不持久保存 enable 错误，所以页面只剩未开启状态，没有要求的简短失败提示、诊断及“重试”文案。

独立回归 `/tmp/anywork-default-independent-edge/edge.spec.ts` 使用当前生产 dist 和受控 `holdEnable + failEnable`：等待默认操作→普通点击打开账号入口→释放失败→断言 alert，结果 **1 FAIL（alert 不存在）**。日志 `/tmp/anywork-default-independent-edge.log`，trace 在 `/tmp/anywork-default-independent-edge-results`。这是无真实账号/远程的确定性合成边界；不能用 dismiss、force click 或放宽 timeout 处理。应保留 auth/logout 隔离，同时让无关 portal 操作不吞掉当前授权的远程失败。

精确补丁 `db2625d2` 将 remoteIssue/远程操作代次与普通 action 的 snapshot 排序分开。普通打开入口不清除当前远程错误；signIn/cancel/logout 在调用 Native 前同步失效远程与授权代次，确认 Native 身份变化也清理旧错误。默认操作继续使用 preparation 的授权 epoch，异步 snapshot 返回后再次检查授权及请求排序，防止旧结果覆盖注销/重新登录。

Reviewer 使用原来失败的独立测试（操作顺序和断言不变）复跑：**1 PASS**，日志 `/tmp/anywork-default-independent-edge-fixed.log`。Reviewer 自行最终组合 UI type/build PASS，产物 `index-BbANbFn-.js` / `index-DfVnwZ1X.css`，日志 `/tmp/anywork-default-independent-final-build.log`。补丁未改 DOM 布局/CSS，四尺寸视觉证据沿用前述精确基础提交；未将旧 JS 的四尺寸检查假称为最后补丁后的重跑。

Reviewer 对最终精确 `db2625d2` 生产 dist 运行两项目补丁定向回归：**8 PASS**。覆盖 pending 时打开入口→失败→诊断/重试可用、已有错误后再打开入口仍保留、注销清除错误、退出后的迟到失败不能重新显示、同账号重新登录、准备完成时等待有效账号 snapshot。日志 `/tmp/anywork-default-independent-fix-browser.log`。这些是同一合成 Native 边界下的实际 Chrome 交互，保留正常点击，没有 force/dismiss 或放宽 timeout。

## 结论与剩余交付边界

接受 Native `6d0d4c0d21c316dc322b0b5a3ce3e199dc796eca`、UI `0d16eb18c253352f5913b4aeb8602edc347e2f65` + `db2625d2fa579d6e95851a63967729e97ed58023` 的组合，无剩余源码阻塞。Native 作者 docs-only `5a2c9e6` 不改变该结论。审查遵循 docs-sprint 的独立 verify 角色，并以 frontend-design 的层级/可读性要求核对截图；没有实施产品修改。

合并后的整体检查、精确源码 CI/发布、任何本机安装或实际账号操作仍由负责人按原授权流程进行。不能将本报告的合成 HTTP/真实 SDK/IPC 测试说成正式云端成功发现设备，也不能把移动视口当物理手机验证。Cloud 仍因 Upstash 配额拒绝，免费等待与任何付费修复选择分别处理；本次不增加付费授权。

关于可选 $5 月预算方案：此次实际取得的是官方 pricing 页面和现有管理元数据/统计；官方 change-plan/update-budget 说明页面的读取失败，未独立确认 API schema、付款前置条件、账号范围影响或预算生效顺序。故不作安全执行保证，不凭推测调用 API，也不把预算描述成严格实时硬性支出上限。
