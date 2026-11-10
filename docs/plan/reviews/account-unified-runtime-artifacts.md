# 统一账号运行与最终产物独立验收

审查日期：2026-11-10。最终构建源码：`113ddba1433e6437f73bdfebc6a4ea1d6e2fa74f`。

## 结论与边界

接受最终 Mac 候选包、Vercel 静态候选产物及其私有操作脚本。独立检查未发现阻断发布的问题。此报告没有执行部署、安装、停止真实服务或修改真实用户的登录状态；实际切换仍需主执行者对精确产物、当前服务与近期客户端状态作出明确决定。

真实自托管 Logto 的短令牌续期已在隔离服务中连续运行 688 秒并完成两次续期；本机 Cookie/PTY 在最终 release 二进制上也已验证。公共隧道下完整 Native→目录→远程 Web 的组合链路和现代 Android 系统浏览器内完整登录尚未验证，不能以这些结果替代。

## 后续源码与浏览器回归

独立接受 `fb0d10e` 的历史快照覆盖修复和 `1d341ed` 的测试等待修正。覆盖标记仅来自同来源、同代、空缓存时接受的权威历史快照及有效 `latest_seq`；普通实时游标、增量合并、来源切换不能扩大覆盖范围。编辑后显式清空当前历史代，避免已经反映的迟到 reset 再次清掉用户加载的旧消息，也保持未反映的新 reset 能正常清空。

独立运行 `web/src/sessionHistory.test.ts`：20 项通过。源码审查包含普通高实时游标、合并读、首快照混入实时行、来源变更等回归用例。`1d341ed` 只在目标控制操作前等待真正的轮询完成 toast，无产品改动。作者对同一不可变生产产物的结果为首次 570 通过、1 既有跳过、1 toast 测试时序失败，修正等待后该用例两个项目均通过；合计独立用例为 571 通过、1 跳过，不宣称完整套件重新全部运行。

## 真实自托管登录与续期

在独立 manager、空 workspace、私有浏览器上下文中运行源码编译的 Native 夹具。唯一浏览器启动差异是把系统 opener 改为只写入自有私有文件的 URL 捕获；SDK、Handle、Native fetch、回调校验、提交及账号 UI 使用原实现。修改后 accounts.rs 摘要为 `a7270aee7d0b33be98c07a19d9ab7b03441c06a990b09110befabac34135059f`，差异与二进制摘要保存在私有证据目录。

官方 SDK 真实登录成功，Native 显示测试账号已登录；正式退出后回到未登录，夹具已关闭。两次手动远程启用在资源授权/设备注册前返回 `REMOTE_ENABLE_PROVIDER`。没有重放失败的 refresh grant。后来另一执行者经授权对同一 cloudflared 字节、相同参数和空配置作单次探测，实际 Rust parser 识别一个入口并观察到两次注册，45.558 秒内停止成功。因此没有证据把先前失败归因于永久 parser 或配置缺陷；公共组合链路仍属未完成的验收项。

另以官方 SPA SDK 新授权、实际 `AccountLogtoClient` fresh-token 串行 API、真实 Rust JWT 校验和 Noise gateway 完成协议验证：

- 初始令牌剩余期限 299 秒；连续连接 688 秒，自动获取两个新令牌，三个不同到期时间。
- 共 23 次 HTTP 200；原来的同一 shell PTY 在旧令牌过期后仍能回显。
- 随后通过加密续期消息注入无效令牌，浏览器 PTY 关闭，HTTP 拒绝，最终状态为 `CONNECTION_CLOSED`。
- SDK 正式退出、浏览器、gateway 和自有服务器均已关闭；令牌未输出或落盘。

此验证使用直接 loopback gateway，未经过公共隧道；正式 HTTPS 来源上的 SDK owner 仍持有唯一授权。隔离 Chrome 的 Local Network Access 权限是夹具所需条件，不据此归因于产品公共隧道。先前未及时启动 SDK 的回调夹具已弃用，未重放 refresh grant。

夹具存在一个必须记录的缺陷：创建空测试会话时使用了 `codex` 而非假 agent，启动了自有 Codex app-server 和 `thread/start`。没有发送任务、消息、turn 或 resume，但不能断言没有默认凭据查找。已按自有服务鉴权停止，确认自有服务器与 PTY 退出，并以唯一继承的自有数据目录标记检查到零个存活 Codex 子进程、零个读取失败。历史子 PID 未提前持久记录，不能补充更强的逐 PID 追踪结论。自有 DB 仅检查精确测试会话，含一条自有线程记录；没有扫描用户目录/历史，也没有删除线程。以后必须明确配置假 `CODEX_BIN` 与 manifest。自有临时授权 URL 文件已移除。

## Mac 包与操作脚本

候选包清单摘要：`594f8e50545cad6f3d45e8ae000a16057c2ba15b76afcd8b73ddbb852ce361be`。

| 项目 | SHA-256 |
| --- | --- |
| Native | `e93ef4c9d8bbe8c4b0da19c20a279a8e4040b830747e9f4ae11dff6420f8ad63` |
| server | `8af12e2a147f692a9ccc2f930da71da125cacc7b1930cba1464d043976d90f34` |
| cloudflared | `c647bfd58ab7fa562d47061853321eb78b7205b110a45fff8f3c53196f3986a5` |
| prepare.py | `216b6510ad664532aaf3dd49e75be298ced516d0a04353046b8ffb05ea286823` |
| switch.py | `45ee13acdbdf7cdc67d6f8463dc668847a4acf5390c35a787537f652dceef1a1` |

独立验证全部 441 文件的 hash、mode 和 symlink 元数据与清单一致，源码 archive 与冻结提交一致，根路径 Web base、有效 codex PNG、source offer、强制 provider 可执行及摘要均正确，无 tunwg。严格 deep codesign 验证通过；签名为 ad-hoc，不能称为发行者公证签名。

使用该包内的 release server 独立运行实际 HTTP/Chrome Cookie/PTY 检查通过：固定安全错误、直接来源/Host/代理边界、无效 Authorization 不回退、一次使用/容量、HttpOnly/Strict、重载、真实 PTY ACK/输出及退出取消。服务、假 agent 和所有数据均为自有临时资源。

私有操作脚本源码审查及 13 个契约测试通过。prepare 只构建、清除所有 VITE_/ANYWORK_/WORKBUDDY_ 构建覆盖、绑定冻结源码和 provider；switch 绑定原服务身份、argv、配置、token、包、脚本与候选清单。原进程环境在停止前经身份复核捕获到 RAM 并校验基线，启动及同次失败回滚都显式使用该 RAM 副本；不替换 HOME/CODEX_HOME，不使用执行器环境，不持久保存环境值。RAM 丢失后禁止自动重建环境，手动恢复必须重新明确决定。

停止/启动前先持久化操作阶段，只允许一次真实 bearer graceful stop；未知结果不得重试或 kill。新子进程身份在健康检查前记录。回滚不恢复 DB、token 或配置，且只操作已确认归属的进程。发布批准还必须绑定有效期限、近期客户端中断决定与环境契约；本报告本身不是 live GO。

## Vercel 静态产物与发布脚本

候选清单摘要：`e5b33c94cfbcf6c665f7b058bde0f95ecfc0421f4fc9cf81e7ed5632f1d5d840`。

- 全部 446 文件逐项大小、摘要与全树摘要一致：`6644fac07270833d21fb6e8aee1c23c9d01bfce23edfde24c922a31db99ecd80`。
- 仅静态输出，零 functions；上传目录只含审查后的 `.vercel` 结构，无构建时凭据或 CLI 上传。
- `/agents/codex-light.png` 与 `/app/agents/codex-light.png` 完全相同且为有效 PNG。app base、回调 no-store、SW no-cache 和 CSP 配置正确；作者实际 1440/390 浏览器产物检查均通过，无横向溢出。
- source offer 摘要 `b34588b2adde46285b73328569fb0980a869e58ac197fa557c08fe3529daeca8`，708 个源码文件与冻结 Git 对象逐字节一致，再加准确清单。既有保守导出策略排除了 `docs/local-browser-session.md`（`docs/local-*`），没有缺失产品源码。
- 发布脚本摘要 `5749d3f8d5382f1b7644ccdfc864bdaf7364831347b087c32b22c29632186623`；辅助脚本、独立复制的 CLI 50.28.0 全树、项目绑定、完整公开配置、基线、原 intent 和产物均被固定。

独立内存模拟通过：dry-run 不提交；`submitting` 必须先持久保存再调用唯一 CLI；已观察/未知提交结果只查询恢复，不重放；未知结果恢复不依赖后来可能改变的产物与公开配置。辅助查询只发 GET，真实部署唯一入口是固定的 prebuilt CLI 调用。

独立实际 dry-run 于 12:57 通过，`submitted:false`；生产 alias 仍为 `dpl_CV59TUfcxyfELrRyHUvHELcmkoT8`，公开 build 字节与基线一致。未执行 `--execute`。

## Android 与资源限制

保留全部四个用户 AVD 与真实连接设备。只在自有 API30 emulator 安装测试 APK，确认实际 Chrome CustomTabActivity 打开固定 HTTPS 门户；Chrome91 因既有 `Object.hasOwn` 兼容限制无法渲染，没有尝试登录。该自有 emulator 与 ADB forward 已停止，自有旧 AVD 目录已清理。

官方 API36 Google APIs arm64 image 已安装；自有现代 AVD 未成功启动，默认 userdata 需求高于可用空间。Native 构建后仅余约 2.34 GiB，未进一步分配大镜像或清理用户/共享缓存。现代 Chrome/WebKit 移动浏览器模拟与 Android 构建/lint/unit 通过的证据独立成立；现代 Android 实机/模拟器内完整 Custom Tab 登录回程仍未验证。此限制不被写成已通过，也不扩展为旧浏览器 polyfill 改造。
