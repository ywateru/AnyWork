# Claude Web / 官网独立审查

日期：2026-11-13。审查分支：`codex/claude-web-review`。验证者未实现产品修复。

**最终结论：pass（Web / 官网与文档范围）。** CW-01、CW-02 均已复核关闭，无开放 P1/P2/P3。接受精确作者 HEAD `9ab14a0cad5a059514c5bf9179705608694d4a7e`：`7a25eaa` 之后的 `fd07e61`、`9ab14a0` 增量只改文档与 App/Composer 显示文案，逐提交判断和测试见末尾追加章节。此结论不接受原生 Desktop 连接或写入；self-XSS 手动交接、防护及完整控制仍未验证，不授权发布。下文首轮发现保留历史证据，以最终追加结论为准。

## 精确对象与依据

- 基线：`e3d7b8d`。
- Web / 官网实现：`734ea3e64986e870b6ee22d815c1230e48434497`。
- 用户追加的文档提交：`2b5b3d62345f75651b51908e73e20d9583a5cb63`，按要求 cherry-pick 为本分支 `5bd9dd0a99c57306fac5da3d04ad781409e7934c`。首轮检查针对这两个提交的组合。
- 标签修复：`8ec7e63e5ec30a35e8192705709c82dff5a4efd2`，按要求 cherry-pick 为 `a7d0ea472928e636b735845f6dbfc9a29ebaafeb`。本次追加复查只覆盖该修复与相关设置展示；未重复官网全矩阵。
- 已读取主协调工作区 `/Users/<user>/work/2026/any-work` 中的 `docs/claude-integration.md`、`docs/plan/tasks/claude-web.md`、`docs/plan/tasks/claude-verification.md`；这些协调文件不在本 worktree 的旧 baseline 内，没有复制或改写它们。
- 用户后续明确：Desktop 5.11492.x 拒绝普通 CDP startup，`CLAUDE_CDP_AUTH` 需要厂商 Ed25519 短期 profile 签名，合法 IPC 入口仍在研究；最终 Desktop 文案由协调者结合研究修订后再复核。此项原生限制来自协调者提供的最新事实，本验证者没有启动真实应用独立重现它。

## 首轮发现（最终已关闭）

### CW-02 — 官网仍将 launcher 描述成已存在的 Desktop 写入接入条件

**原 P2 / blocking，现已通过最终文案复核关闭；见末尾追加验收。**

位置：`site/locales/zh.json:180`、`site/locales/en.json:180`，渲染于 `site/template.html:36` 的 Claude Desktop Code 卡片。中文为“写入需要经 AnyWork 连接引导启动桌面 Code／本地桥接”，英文为“Writing requires Desktop Code started through the AnyWork connection launcher and its local bridge”。

复现：构建静态站后打开 `/zh/#agents` 或 `/en/#agents`，查看 Claude Desktop Code。两个语言均将经 launcher 启动的写入路径作为确定的接入说明；尽管随后标注实时控制待验收，仍没有表达当前版本的合法控制入口尚未证实。根据用户提供的最新事实，不能把该条件解读为照做即可接入控制。

追加文档的表述更谨慎：`docs/getting-started.md:45`、`:63` 及中文对应位置要求“经授权的原生本地入口”，缺入口保留历史只读；`:65` 正确记录 `~/.anywork/claude-desktop/host.json` 与 `ANYWORK_CLAUDE_DESKTOP_DESCRIPTOR`，描述符本身不证明可控。这些澄清没有同步到官网卡片。指南中的 helper 使用步骤、README、矩阵和架构的最终事实边界，也需随协调者的最终方案保持一致；本次不因并行后端尚未交付 helper 而另立缺文件阻塞项。

证据层级：官网源码、双语浏览与协调者最新原生调查事实；不是本验证者的真实 Desktop 控制证据。`artifacts/claude-independent/site-{zh,en}-{390,1440}.png` 留有当前文字。关闭条件是双语明确区分可验证的历史展示、尚未建立的合法实时控制路径及最终实际接入要求，不能仅删除“待验收”或改成无条件可控。本次不发布，最终文案暂不判通过。

最终没有开放 P1/P2/P3。

## 已关闭的发现

### CW-01 — 设置页将当前 Agent 固定称为 Codex

**原 P2 / blocking，现已关闭；不再阻塞。**

原问题位置：`web/src/components/Settings.tsx:535` 的 connection 分支；`:538` 写死 `<strong>Codex</strong>`，`:545` 又称“使用当前服务已配置的 Codex 账户”。界面入口是“设置与插件 → Agent 与连接”。该代码在基线已有，但当前用户明确要求本轮后端展示准确，因此不作为历史问题豁免。

修复前复现：让服务清单仅返回 `claude-code`、`claude-desktop`，不返回 `codex`。进入设置的“常规”，正确显示 Claude Code 和 Claude Desktop Code；再点击“Agent 与连接”，Agent 却变为 Codex，正文仍要求 Codex 账户。两个设置页签相互矛盾，会让用户误判 Claude 的登录/设置要求。验证使用原始 App / Settings 组件和确定性 transport，没有执行原生 Agent。

证据：`artifacts/claude-independent/scope-A-installed-agents.png` 与 `artifacts/claude-independent/scope-A-connection.png`。两张截图分别显示仅两种 Claude 的 UI 清单和错误 Codex 页面；已人工查看。独立生产构建浏览也在 390/1440、亮/暗四种组合记录了相同固定文字，见 `artifacts/claude-independent/results.json` 的 observations。

修复范围：仅消除这一处固定后端/账户描述，使用当前服务的准确清单或通用说明；不需要扩展设置架构，也不应把历史身份或不可用插件描述成可执行。根据用户明确授权，已将具体代码、复现、截图及小范围修复要求发送至 Mendel chat `<review-chat-uuid>`；现已收到并独立接受作者修复 `8ec7e63`（本分支 `a7d0ea4`）。

修复判断：差异仅修改 `Settings.tsx:538` 的固定 Agent 值为“由当前服务提供”，并将 `:545` 的 Codex 账户说明改为服务提供 Agent/连接状态、可到常规查看清单和设置提示。检查 `Settings` props、connection 分支与 App 注入的 children：原页没有 Codex 账户字段、账户数据绑定或账户查询，只是两段固定文字；常规页的清单仍来自 `plugins.map`。因此本次没有将真实 Codex 专用账户数据泛化冒充多 Agent 数据，也没有改权限、账户或设置架构。保留的 appearance preset 名称 Codex 属于视觉样式，与后端身份无关。

修复后复核：使用相同原始 App / Settings 组件，Chrome 在 1440/390 下各验证 Claude-only、自定义 Agent、Codex-only、空清单、五种内置 Agent 混合清单，共 10 个场景。连接页均为通用准确说明，不再出现固定 Codex 或账户断言；“管理连接与插件”可通过键盘 Enter 跳到常规，常规按 API 保留各场景的精确名称/数量；Desktop 仍正确显示待连接状态和服务 hint。没有 API 写入、页面错误或设置容器横向溢出。人工查看了修复后的 390px 截图。

追加证据：`artifacts/claude-independent/settings-followup.mjs`、`settings-followup-results.json`、`settings-fixed-A-{390,1440}-connection.png`、`settings-fixed-A-{390,1440}-catalog.png`，以及 `settings-fixed-C-*`（Codex-only 对照）。这些是本次本地夹具与截图，不随报告提交。

**P2 / non-blocking（已关闭）— 734ea3e 单独缺少新增指南目标。** 初次针对精确实现提交执行 `PLAYWRIGHT_CHANNEL=chrome node scripts/site-test.mjs`，在 `scripts/site-test.mjs:57` 因目标文档没有 `## Choose a backend agent` 标题而失败；中文同样缺少 `## 选择后端 Agent`，支持矩阵仍把 Claude 归为未交付插件边界。按用户要求应用 `2b5b3d6` 后，两种标题、后端表、范围/描述符说明已补齐，最终站点检查全部通过。初次失败不计为最终组合的开放缺陷。

## 代码与行为核对

- **身份来自 API。** `agentIdentity.ts` 只做固定名称/图片映射；`CreateSession` 枚举实际 `/plugins`，没有以品牌表注册执行能力。`claude-code` 与 `claude-desktop` 保留不同 ID、名称及终端/显示器角标。未来 Agent 使用服务名称、通用 Bot 图标及自己的创建 ID，没有落到 Codex。
- **加载与切服隔离。** 新建和侧栏通过 `pluginsLoadedFor === api`、sessions 对应 API 标记投影；插件请求包含取消/请求序号保护。`AccountApp.tsx:738` 以 `connection.scope` 为 App key，切服重建状态。独立同源 harness 按该生产生命周期切换 A/B：分别保存 Claude Code / Future 过滤项，回 A 时挂起插件响应，再回 B 并释放迟到 A 响应；B 的创建清单与常规设置始终只显示 B，A 的 hint 没有串入。该证据是组件/transport 夹具，不是云端真实设备切换。
- **缺省/过滤/新建。** 清单包含 Codex 时新建仍缺省 Codex，侧栏 Claude 筛选不篡改新建选择；仅 Claude Code 的迟到清单会初始化它；空清单保持禁用，不虚构品牌选项。仅不可用 Desktop 的迟到清单保持该身份并禁用创建，按 Enter 不发请求。重新检查后仍保留 Desktop 选择，按新可用状态启用创建。
- **hint。** 常规设置逐字渲染服务返回的 `setup_hint`，含 descriptor 默认路径及覆盖环境变量的长文在 390px 可换行；待连接状态可见。新建时不可用 Desktop 的 status 原样显示且禁止提交；hint 是普通 JSX 文本。CW-01 的另一个设置页签已在本次修复复查关闭，详见上文。
- **现有 Agent。** 在 390/1440 及亮/暗四组合，分别选择 Claude Code、Claude Desktop Code、Codex、DeepSeek Harness、WorkBuddy 和 Future Agent，独立捕获共 24 个 `/sessions` 请求，均精确为所选原始 ID，`model:null`、`policy:"manual"` 和指定 cwd；全部被浏览器夹具截获。没有向真实 Agent 创建或发送请求。
- **资源。** 图标均来自本地 `/agents/`，新 SVG 只有静态几何/固定填色；本地 SHA-256 与文档一致。独立只读 GET 官方 `https://claude.ai/favicon.svg` 返回 200，摘要同为 `b150888bc7257af83e3b85d3c2be4294f88986026f8168f6c12fc1fde6697350`。两种 Claude 复用原图，以独立 UI 角标区分；亮/暗主题可见，Codex/Harness/WorkBuddy 资源保持可用；`/` 与 `/app/` 基路径由针对性单测覆盖。
- **官网范围。** 中英文同序列出 Codex、Claude Code CLI、Claude Desktop Code、DeepSeek Harness、WorkBuddy，插入位置在工作原理后、工作区演示前。保留本地 Code 与普通聊天/Cowork/云会话区分、WorkBuddy 实验边界、源码与已发布包边界、CLI/Desktop 各自会话列表及 engine 更新范围。Desktop 最终控制事实仍受 CW-02 阻塞。
- **双语布局与可访问性。** 独立浏览 390/1440，检查完整新增区、所有 article/link 横向边界、无横向溢出、区域的 h2 命名与 h3 层级、四个可读链接、指南→矩阵的 Tab 焦点；保存 ARIA snapshot，并人工查看中文/英文窄屏、大屏及亮暗设置截图。Agent 菜单 Enter/Escape 与焦点操作通过。不是完整读屏或 WCAG 审计。
- **指南链接。** 最终组合的中英文文件/锚点均存在，支持矩阵路径正确；官方 CLI 安装和 Desktop quickstart URL 独立只读请求均为 HTTP 200。GitHub main 链接最终是否包含这些尚未合并文档不作为已部署成功证据。

## 独立执行与结果

下面表格为首轮 `734ea3e + 2b5b3d6` 的结果；标签修复的追加复查单独列在表后。

使用本机 Chrome channel，浏览器报告版本 `157.0.8103.51`；复用主工作区现有 node_modules，未重新安装依赖。构建只写本 review worktree 的 ignored 输出。

| 命令 / 验证 | 独立结果 |
| --- | --- |
| `npm exec -w web -- vitest run src/agentAssets.test.ts src/sidebarAgents.test.ts src/sessionAgentSelection.test.ts` | 3 文件、14 项通过 |
| `npm run build -w web` | TypeScript noEmit、Vite 生产构建与 PWA 生成通过；有常规大 chunk 提示 |
| `python3 scripts/build-site.py` | 双语静态站构建通过 |
| `PLAYWRIGHT_CHANNEL=chrome node web/scripts/claude-agents.check.mjs` | 作者新增夹具由本验证者独立执行；390/1440 × light/dark 四组合通过 |
| `PLAYWRIGHT_CHANNEL=chrome node artifacts/claude-independent/browser-review.mjs` | 生产 Web 的四组合、3 种迟到清单、双语站点 390/1440 四组合通过；独立创建 payload、hint、键盘和布局断言通过 |
| `PLAYWRIGHT_CHANNEL=chrome node artifacts/claude-independent/scope-review.mjs` | 仅 Claude 清单的错误 Codex 截图已复现；A/B scope、迟到响应与常规设置隔离断言通过 |
| `PLAYWRIGHT_CHANNEL=chrome node scripts/site-test.mjs`（应用文档提交后） | 英中各 1440/1024/768/390/320、语言协商、下载顺序和 fallback 检查全部通过 |
| `git diff --check e3d7b8d..5bd9dd0` | 通过 |

`8ec7e63` 追加复查：

- `npm run typecheck -w web`：通过。
- `PLAYWRIGHT_CHANNEL=chrome node artifacts/claude-independent/settings-followup.mjs`：390/1440 × 5 种清单，共 10 个设置场景通过；浏览器 `157.0.8103.51`，只使用内存 transport。
- `git diff --check 8ec7e63^..8ec7e63`：通过。
- 未重跑官网全矩阵、未把此前的生产构建和官网结果冒充该追加提交的新执行结果；该提交仅改三行设置文案。

首次额外 scope harness 未加载项目 Vite 配置，因 `@/lib` alias 无法解析而未进入产品界面；补上 `web/vite.config.ts` 后通过，无产品代码修改。此夹具配置错误不计作产品失败。独立脚本、JSON、截图和 ARIA 文本保留在 ignored `artifacts/claude-independent/`，不随报告提交；作者脚本及站点测试为已提交的可复现入口。没有机械重复作者报告的全量 400 项；本次只对上述明确列出的项目给出独立执行证据。

## 隔离与后续关闭条件

所有 UI 写请求均由路由夹具截获，scope harness 使用内存 transport；服务器仅用于本次临时 loopback 静态/Vite 浏览，并已退出。未调用真实 Claude/Codex/WorkBuddy、未改原生会话/登录/profile/描述符、未连接生产服务或部署。没有为本审查启动后端服务或原生 launcher。

报告提交仅包含本文件；产品及文档变更来自用户明确指定的作者提交 cherry-pick，验证者没有代改。CW-01、CW-02 均已复核关闭，最终范围见以下追加验收。真实 CLI、Desktop 合法原生入口、控制/模型/审批/取消及最终后端能力投影仍属后端及集成独立验收，本报告不代为宣称通过。

## Final exact-commit acceptance, 2026-11-13

The accepted author HEAD is **`7a25eaa41e803c984c5daf9037fdf2952317abbc`**. The final review worktree product tree is `98fc9e6`; `git diff 7a25eaa..98fc9e6 -- . ':!docs/plan/reviews/claude-web-independent.md'` is empty. Only this review report differs from the author tree.

| Exact author commit | Review cherry-pick | Acceptance |
| --- | --- | --- |
| `8ec7e63e5ec30a35e8192705709c82dff5a4efd2` | `a7d0ea4` | **pass**: CW-01 closed; the original connection page contained static copy, with no Codex account data or query being relabelled. |
| `721ec1eea6840340cf3e0876d578ee370daf8691` | `da292a3` | **pass**: accurate native login, configuration and unconfirmed Desktop control statements; removes the executable launcher setup recipe and the established-launcher-path claim. |
| `caab4d0567fc85f87e922270cc0ac2c728f33936` | `b73221f` | **pass**: capability-driven manual-only creation and main/child composers, explicit legacy policy recovery, and compatibility with permissive existing agents. |
| `2b2f261ec5211e07681366d1248b83fd88ca038c` | `afb4897` | **pass, documentation**: distinguishes experimental outgoing carrier work from native connection/full writing acceptance; bounds CLI evidence to the backend verification record. |
| `7a25eaa41e803c984c5daf9037fdf2952317abbc` | `98fc9e6` | **pass, documentation; final author HEAD**: the Desktop history root is the actual profile's absolute `claude-code-sessions` root, distinct from account/org subdirectories and `host.json`. Third-party formats require separate checks. |

**CW-02 closure.** Both website languages now state that a usable control path has not been confirmed, ordinary scripts cannot enable signature-gated CDP, and signing in does not establish an AnyWork control connection. README, both guides, matrix, architecture and connection settings consistently distinguish native login/history from live control. The normal DevTools outgoing loopback approach is expressly experimental, subject to native developer-mode, HIPAA and organization policies and user-completed native safeguards. Generating scripts, passing carrier fixtures or finding a descriptor does not establish original Desktop control. The guides retain the descriptor override and incomplete observed-model catalog boundary. The final custom-profile clarification grants history discovery only.

Independent source checks confirmed the documented configuration fields and ordering against the backend configuration and its verification record: `ANYWORK_CLAUDE_BIN`; `ANYWORK_CLAUDE_HISTORY_ROOT` before `CLAUDE_CONFIG_DIR`, otherwise `~/.claude`; native Windows `claude.exe`, without `.cmd`/`.bat` wrappers; separate Desktop history and descriptor variables. The CLI 2.1.323 / 94 model / service-API smoke claims in the matrix are attributed to the backend `scripts/claude-verification.md`, which was read for its explicit boundaries. This Web review did not rerun those real model operations or independently accept the backend.

**Manual-only review.** `sessionManualApprovalsOnly` fails closed for an absent plugin and otherwise uses `manual-approvals-only`, without an Agent-name allowlist. Create resets stale auto state and refuses residual auto before POST. The main composer resolves its own session's plugin; the child resolves `child.agent`, rather than inheriting the parent's policy capability. Legacy auto disables ordinary send and editor submit, preserves drafts, and requires an explicit user PATCH to manual before enabling sending. It does not silently PATCH or enable permission bypass. Older catalogs lacking the flag retain existing behavior. The Web projection is not an API authorization boundary: queue actions and other API entrances must also be rejected by the backend where unsupported. The backend verification record separately documents both manifest flags and auto-policy refusal; this report does not replace that review.

Final independent checks:

- Focused Vitest: **3 files, 15 tests passed**.
- `npm run build -w web`: TypeScript, Vite and PWA passed; log `artifacts/claude-independent/latest-build.log`. The final runtime code is `caab4d0`; the subsequent commits modify documentation only.
- `PLAYWRIGHT_CHANNEL=chrome node web/scripts/claude-agents.check.mjs`: latest author script independently executed; **390/1440 × light/dark, four combinations passed**, including exact manual create requests and legacy draft/policy recovery.
- `PLAYWRIGHT_CHANNEL=chrome node artifacts/claude-independent/settings-followup.mjs`: **10 settings scenarios passed**, including the new native-login/read-only explanation, Claude-only/Codex-only/custom/empty/mixed catalogs and keyboard navigation.
- `PLAYWRIGHT_CHANNEL=chrome node artifacts/claude-independent/final-policy-review.mjs`: independent production-build fixture passed at **390/1440**. It verifies a refused policy PATCH preserves auto state and draft; retrying manual recovers; missing plugins cannot authorize auto; Codex retains auto; a permissive Codex parent's manual-only child uses its own capability and PATCHes its own session; and Claude CLI/Desktop/custom manual-only create requests each POST the exact manual policy. A delayed catalog separately fails closed before arrival and restores permissive Codex behavior after arrival. All writes were intercepted.
- The same independent script checked final truthful Desktop website statements in **English/Chinese × 390/1440**, keyboard guide focus and horizontal bounds; all four passed. Captures: `final-site-{zh,en}-{390,1440}.png`; policy results: `final-policy-results.json`; child captures: `final-child-policy-{390,1440}.png`, under ignored `artifacts/claude-independent/`.
- The bilingual site was rebuilt. Final guide field assertions and removal of the old launcher execution recipe passed. The previous full site matrix was not mechanically repeated.
- `git diff --check e3d7b8d..98fc9e6` passed.

The first additional child fixture omitted its interactive flag and located the activity label instead of the session title; it could not find a child editor. Correcting those fixture facts to match the existing projection contract made the test pass; no product code was changed.

**Final scope:** no open Web/documentation blocking finding. Native Desktop self-XSS handoff, actual connection, approval/cancellation/reconnect and full writing remain **unverified**. No safeguard was bypassed, no native UI was operated and no established Desktop write claim is accepted. The requested carrier-only independent review follows separately in its own worktree/report.

## 文档增量精确验收 `fd07e613`，2026-11-13

**pass，接受作者文档提交 `fd07e61391aecdc82c75245236dc46671e1ff504`。** 父提交是上述已接受的 `7a25eaa`；本分支 cherry-pick 为 `668c46c`。作者增量只修改 `docs/getting-started.md`、`docs/getting-started.zh-CN.md`、`docs/support-matrix.md`，没有 Web、站点模板/locale、Rust 或脚本变化。与作者 tracked tree 对比，除本报告外 diff 为空。本次不改变先前的 Web 行为结论，也不验收 mapper 候选。

独立核对结果：

- **CLI 证据引用准确。** 从主协调工作区读取已提交的 `docs/plan/reviews/claude-backend-independent.md` 最终 `e70c8a50442be05d7d15947d3097e003553de250` 验收章节。报告记录了私有冻结 binary 及 SHA-256、CLI 2.1.323 的真实初始化/发送与文本流、工具一次批准、开放问答、自管取消、模型切换、同 UUID 重启恢复与历史读取通过。新双语指南和矩阵正确归因于该独立验收，不扩大到 Windows 实机、真实图片理解、后台子任务、全部模型或 Desktop 控制。本次只核对该证据引用，未重跑真实模型操作。
- **默认路径与精确候选一致。** 只读 `git show 129f3d0:crates/server/src/claude/desktop_history.rs`：`roots()` 的显式环境变量分支直接返回一个根；`default_roots()` 对 Claude/Claude-3p 各给一个目录。macOS 为 `~/Library/Application Support`，Windows 为 APPDATA（缺失回 home），Linux 为 XDG_CONFIG_HOME（缺失回 `~/.config`）。指南的三平台路径及替代双根语义与此一致。`sync_roots`、`source`、`import_roots` 在重复 metadata 身份时拒绝选择；导入记录携带 profile 来源，`history.rs` 将其投影为 `claudeDesktopProfileRoot`。这里是文案对照代码，未执行该候选的 mapper 集成，也未据此接受其安全/正确性。
- **候选/发布/原生边界保持准确。** 双语与矩阵都明确 `129f3d0` 仍在独立 review，不表示已发布；仅支持的历史格式与被动发现不授予 live control。self-XSS 手动动作、native probe、实际连接及 full control 仍 pending，桥源码/fixture 单独记录，没有 established Desktop write claim。该文案与本验证者另行提交的 carrier-only 报告范围一致，未把 carrier pass 升格成 native pass。
- **链接与一致性。** 三份文档的本地引用检查通过；新增 backend review 链接可在主协调工作区的 tracked 报告解析，旧 review baseline 没有复制该跨分支报告。中英文均保留精确候选、版本、self-XSS、覆盖变量与三平台路径，含义一致。最终集成需携带被引用的独立报告，未声称远端已发布文档可达。

本轮执行：docs-only 差异白名单检查、作者三文件逐字一致性检查、本地文档引用解析、双语关键字段检查以及 `git diff --check 881f262..668c46c` 全部通过。没有重复站点全矩阵、浏览器、Web 单测、Rust 编译或真实模型测试；此前运行结果仍仅按其原记录归属。验证者仅更新本报告，产品和指南内容来自精确作者提交。

**最终门禁：Web/官网/文档范围无开放 P1/P2/P3，接受 `fd07e613` 的上述文档增量。** `129f3d0` mapper/default-roots 的独立结论和真实 Desktop 验收仍由各自任务给出，本次没有代为接受。

## 权限文案增量精确验收 `9ab14a0`，2026-11-13

**pass，最终接受作者 HEAD `9ab14a0cad5a059514c5bf9179705608694d4a7e`（前置 `fd07e613`）。** 本分支 cherry-pick 为 `df80142`。差异只有双语指南、支持矩阵、架构文档、新建说明和 Composer title；新增文案未改变标签、能力标记、禁用条件、默认策略、发送/恢复守卫、PATCH 或 POST 参数。与作者 tracked tree 对比，除本报告外 diff 为空。

- `App.tsx:2336` 的新建说明、`Composer.tsx:398` 的审批容器 title 与 `:435` 的提示 title 均准确说明“AnyWork 不自动代答审批请求，原生权限模式由宿主管理”。这没有承诺每个原生操作都会弹出人工审批，也没有将 AnyWork 的 `policy:manual` 当成对已有 Desktop `permissionMode` 的重置。原生权限显示标签及旧 auto 显式恢复行为保持此前接受的实现。
- 对照 `129f3d0` 的 `process.rs:90`：新建的 CLI 运行时显式传入 `--permission-mode manual`（包括为恢复创建的新 CLI 进程）。对照其 Desktop `observation`、`attach`、history 导入和本轮此前接受的 carrier：AnyWork 策略与 native snapshot 分开保存，导入/连接没有调用 native `setPermissionMode`；已有 Desktop 的原生模式仍由原宿主掌管，包含 `auto` 的情况。文档只解释这一边界，不声称所有 native mode 已运行验收。
- 双语指南、矩阵与架构对 `manual-approvals-only` 的说明一致，保留原请求决定白名单、Codex 沙箱不外推、CLI `e70c8a5` 的精确独立证据归属、`129f3d0` 候选仍在独立 review 及 Desktop native pending；没有把权限文案修正当成 native acceptance。

按协调者要求补跑的相关检查：

| 本轮独立执行 | 结果 |
| --- | --- |
| `npm run typecheck -w web` | 通过 |
| `node node_modules/vitest/vitest.mjs run web/src/sessionAgentSelection.test.ts web/src/sidebarAgents.test.ts web/src/agentAssets.test.ts` | 3 文件、15/15 通过；包括 manual-only 缺清单保守行为、Claude/自定义 Agent 能力识别、旧 catalog/Codex 兼容 |
| Prettier check：`web/src/App.tsx`、`web/src/components/conversation/Composer.tsx` | 通过 |
| `git diff --check 7a25eaa..9ab14a0`、报告 diff-check、精确 tree 对照 | 通过 |

临时复用主工作区 node_modules，检查后移除本轮创建的根 symlink；没有安装或修改依赖。未增加仅复述文案实现的测试，未重复浏览器矩阵或全量 Web 测试；本次没有布局、模板、样式和行为变化，因此此前浏览器行为结论继续适用，且不冒充本轮新执行。

**最终增量门禁：`fd07e613` 文档通过，`9ab14a0` 文案与相关定向检查通过，无开放 Web/文档 P1/P2/P3。** 验证者提交仅更新本报告。Desktop mapper/default-roots 候选的独立 review 与真实 Desktop probe/full control 仍在各自范围内；本报告不代为接受或声明发布。
