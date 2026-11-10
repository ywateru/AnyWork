# 桌面引导与真实连接独立审查

日期：2026-11-10。审查角色仅负责源码、隔离验证与报告，不开发产品、不操作真实用户服务、登录或远程。设计基线为 `be7208e`，补充契约为 `32072bd`。

## 设计审查

设计以“介绍 → 登录或注册 → 准备服务 → 工作区控制台”为顺序。原生 `desktop_start` 和 `desktop_open` 必须独立核验当前授权；已有外部服务不能成为未登录旁路，也不能被接管、停止或改写配置。已接受的工作可以继续，退出账号只阻止新的启动或打开，并关闭远程。

初审发现两个需在实现中关闭的阻塞项：

- **P1 / 原 blocking，已关闭：启动恢复绕过登录。** 基线 `crates/desktop/src/updates.rs` 的 `Handle::start → resume_saved → ResumePlan::resume → Command::StartServer` 可在新进程登录前读取磁盘恢复文件启动服务。设计 `docs/desktop-onboarding-layout.md` 第 8 条及 `docs/updates.md` 已由 `32072bd` 明确修订；Native `87102db` 删除启动读取及安装写入路径。独立测试确认现代 `owned:true` 文件字节保留且无服务命令。
- **P1 / 原 blocking，已关闭：旧恢复计划未绑定原服务。** 基线恢复计划只有 `owned`，执行时读取当时 manager 配置和凭据，不能保证恢复安装前的同一服务。Native `87102db` 使用不可序列化的 RAM 内原配置与凭据，独立回归确认后续快照变更不能转移恢复目标，外部服务不产生恢复命令。

补充的远程入口契约已明确：UI 使用 `account_snapshot.accountPortalUrl` 与 Native 打开账号页相同的已验证配置绑定，不硬编码正式域名；缺失或非裸 HTTPS 时显示暂不可用。原有开发配置可允许 loopback HTTP，并不意味着 UI 可以把它显示为手机远程入口。

活动连接的审查以完成账号验证和 Noise 握手后的真实 gateway socket 为准。User-Agent 只能转为有限、不可信的显示类别；临时编号不得暴露完整静态公钥或业务客户端 ID。续期不新增行，关闭、过期、失败续期及注销均须移除。快照失败与真实零连接必须区分。

## 已提交源码与组合验证

已审 Native `87102db1a71f31ab14ea7b9c173f0bf98131988a` 与测试/报告补充 `88fea9bbd9abc7fb93774c0c7b44dee449270678`，UI `aefd304bc876080231ac1c034be0a4d0445004ef` 与测试/文案补充 `adaea579361b55d22a91120d55f99eefc631b525`。在独立 review worktree 合并作者提交与 `32072bd` 后重新构建和运行；两项补充均不修改生产 UI 或 Rust 产品代码。以下结果由独立审查运行，未直接采用作者计数。

另外接受 root 的 `0cba8898998e640a1d15d04c1fbfc391838f4aaf` 文档修正。**P2 / 发布准备 blocking，已关闭：** UI 文案补充原把发行说明标题改为 `What's new`，root 检查发现 `scripts/publish.py` 版本准备必须匹配 `New in <semver> / 本次更新`。该提交恢复所需标题；独立审查用发布器相同正则在内存中替换版本，确认恰好命中一处且不改写文件。该修正不影响产品功能，无需重新运行 UI/Rust 矩阵。

| 检查 | 独立结果与实际边界 |
| --- | --- |
| 生产 UI 构建与 TypeScript | 通过；JS `index-CtORsyv5.js`，CSS `index-DW0CcbH9.css`，同一产物供浏览器及 Native 编译检查使用。 |
| Native library | 41 通过，2 个原有下载/安装集成测试保留 ignored。实际 Tauri mock-runtime dispatcher、账号 handle、manager 与独立 Python HTTP 子进程：未登录拒绝；合成有效 RAM 账号只准备服务，无 ticket；失效或移除账号阻止新命令，已接受服务继续且凭据不变。 |
| 真实 loopback HTTP 外部服务 | 准备不签 ticket，显式打开的 manager 路径只签一张短期 ticket；外部监听、配置与凭据保留。401、错误产品身份及旧交接能力拒绝且不启动替代服务。 |
| 真实 gateway | 3 单元与 8 WebSocket/Noise 集成测试通过。未验证 socket 不计入；四种有限类别仅序列化 3 个公开字段；第 5 个 socket 拒绝；正常/异常断开、过期、坏续期、关闭清理。两次续期与超过 1,024 次请求不改变原连接编号或开始时间；旧协议拒绝/防重放检查保留。 |
| Native 与 remote all-target Clippy | `-D warnings` 通过，包含实际生产 UI 资源与 Native 命令注册的 bin 编译。 |
| 真实 Chrome 生产 UI | 70/70 通过，桌面与移动浏览器配置均运行，无 skip；不启动业务测试服务器，使用严格合成 IPC。覆盖介绍前无启动、一次自动准备、显式失败重试、同账号重新登录时旧准备结果迟到、logout 前旧 poll 迟到、未知快照、新操作禁用、unsupported、连接增删及有限字段校验。 |
| UI 最终补充 | 新增 3 项用例 × 两种浏览器配置，6/6 独立通过；保留 Native grant 的新 UI 仍先介绍、打开操作不可并发重复、设置失败返回原阶段。 |
| 地址与保留设置 | 裸本机地址随已保存快照变化，草稿不改变地址；剪贴板失败和旧复制完成有固定反馈；远程入口使用 snapshot 配置，拒绝缺失、HTTP、凭据、query、fragment、非法地址；设置草稿和服务所有权约束通过。 |
| 账号入口回归 | 独立临时静态 HTTP 服务与生产 UI，官方 SDK 注册/登录 screen 分离、失败重试、取消/迟到与不确定 cleanup、重新授权、固定 enable stage、键盘入口通过。无真实 OAuth 或 grant。 |
| 更新 UI 回归 | 静默检查/下载失败、延后、偏好、确认、旧版本变化拒绝和显式安装合成 IPC 通过，未下载或安装更新。 |
| 官网与发行说明同步 | 检查中英文新引导、活动连接与既有本机浏览器/CLI 边界表述；独立离线构建和 site 浏览器脚本通过，两种语言 × 五种宽度、语言协商、迟到发行版本顺序及 ZIP/DMG 选择检查保留。未部署网站。 |

源码审查确认：Native start/open 均独立要求当前 `signedIn` 与 `authorizationStatus=signedIn`；本轮只准备路径与原打开路径共享服务验证逻辑。新连接投影不替换 JWT/Noise 权限检查，不暴露完整静态公钥、业务 client ID、UA、IP 或 token，不增加云写入。UI 串行轮询并用操作 generation 丢弃旧结果；准备过程按确认账号转换区分 epoch，快照短暂不可用只暂停新动作，不制造退出或再次启动。

四种尺寸 `1440×1000`、`960×720`、`800×620`、`390×844` 均生成介绍、账号、准备、失败、控制台、设置截图并通过无横向溢出检查。独立视觉复核包括 1440px 介绍、800px 介绍/账号/错误/设置、960px 控制台、390px 介绍/控制台及更新就绪页：主动作清晰，设备图明确标示关系示意，连接行与历史心跳不混淆，本机与远程地址说明各自明确。最终四尺寸截图保存在 `/tmp/anywork-onboarding-independent-visual-final`，更新截图在 review worktree 的 `artifacts/desktop-update-ready.png`；均属于隔离验证产物，不包含真实账号或工作内容。

Native 测试补充 `88fea9b` 将既有 HTTP fixture 的 `HOME`/`CODEX_HOME` 重赋改为 `ANYWORK_CODEX_DATA_DIR` 与 `FAKE_AGENT_STATE_DIR`。独立检查其子进程环境只保留 PATH/TMPDIR/SHELL/LANG/LC_ALL，并显式指定临时 host/catalog/workspace/plugins 及自有 fake-agent 包装器，不回落到真实 Codex 或用户数据。该补充的 Python 6/11/20 用例通过由作者报告提供，独立审查没有重复运行，不能与上表的独立测试计数混合。

**结论：pass。** 所列精确源码与根文档修正组合无未关闭 blocking 或 non-blocking findings；两项初审阻塞均在 Native 提交中关闭，发布标题兼容性问题由 root 修正关闭。源码验收不等于真实 Logto 登录、公共隧道可用性、Windows 编译或本机产物采用验收。此次 Native IPC 使用合成 RAM 账号，浏览器使用合成 IPC，gateway 使用合成验证器加实际 Noise/WebSocket；不将这些分层证据称为真实账号端到端测试。原有长时间真实授权证明未重复运行。实际安装和发行仍需独立审查新候选与其专用操作脚本，不能复用此前已中断的发布操作。

现有 server `28102` 与 Native `19611` 未被此审查操作；未重启旧的 `0.1.16` 发布流程。

## 本机候选更新路线（待产物审查）

本轮修改位于 desktop 与 Native 内嵌的 gateway/UI；既有业务 server 协议不需迁移。因此可以准备新的独立候选，采用文件级原位更新，保留正在运行的 `Resources/bin/anywork`。这是建议路线，不是对尚未生成的候选或执行脚本的批准。

- 从合并后冻结的精确源码构建 Native 与内嵌生产 UI，生成相应源码提供包及签名清单。逐文件比较安装包，预计仅允许 Native 主可执行、源码包与 `CodeResources` 三项变化；任何其他差异必须重新说明并审查。严格验证完整包签名，候选中业务 server、业务 Web 和 provider 均须与现有包完全相同。
- 创建全新的私有操作目录、基线、脚本、测试、单次审批及日志；不得复用前次 `adopt.py` 的状态或审批。审批绑定精确候选、基线和脚本哈希；未知执行结果先核对，不能盲目重放。
- 在任何写入前，由 root 重新检查真实 Native 已退出账号且远程关闭，然后只退出 Native。审查代理不操作真实客户端。保留 server `28102`，不调用其停止接口，不发送信号，不重新启动 server，不移动或重命名整个 `.app` 目录。
- 只对允许的文件做同目录原子替换，保留各自的原始字节以便文件级回滚；遇到未知并发变化或不明打开结果停止，不能扩大回滚到整个 app 或服务。更新后重新验证整包树和签名，再打开 Native。
- 前后核对 server 的 PID、父进程关系、启动参数、工作目录、可执行路径及 inode、原环境摘要，以及配置和 token 文件哈希。若执行元数据保留检查，仅使用会话 ID 哈希和 schema；不读取业务正文，不把会话总数固定为此前的 108 或 109。
- 实际 UI 验收只确认新 Native 展示介绍页，且没有自动登录、启动本地服务、打开工作区或开启远程。既有外部服务保持运行；磁盘 `resume.json` 保留不执行。
