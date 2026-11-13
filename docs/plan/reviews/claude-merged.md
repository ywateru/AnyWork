# Claude 接入主分支核验

日期：2026-11-13。源码、独立审查与主分支检查已完成。用户最新安排为暂缓 Claude Desktop 真机测试，提交后自行手动测试；本轮调研、实现、网页和文档交付据此收尾。Desktop 原生桥与实时控制未真机验收，继续保留实验声明。没有发布、部署或替换现有 AnyWork 服务。

后续发布准备：用户随后授权更新 GitHub 并打包新版本，计划按标准发布器交付 v0.1.30。公开报告已将真实会话/审查 chat 标识、个人路径、目标会话标题和进程身份泛化。早期待发布提交曾含更具体的私人标识，因此原始审查历史仅保留在不推送的本地备份分支，公开提交使用相同实现的脱敏源码快照，不改写已有远端历史。下文精确实现与审查 commit 号用于关联原始本地证据，不承诺它们存在于公开仓库；公开发行源码以最终不可变 tag 和对应 Checks 为准。本条为发布前准备记录，不表示构建或发布已完成。

## 已合入的精确范围

- CLI 作者候选 `e70c8a5`：主分支 `1b2b570`、`301a8c6`、`533b903`；[独立审查](claude-backend-independent.md)接受 CLI 和被动历史。
- Web/官网作者候选 `7a25eaa`：主分支 `060b97f` 至 `17167df`；[独立审查](claude-web-independent.md)接受 Web、双语官网与文档。
- [第三方研究](../analysis/claude-third-party.md)：主分支 `abcf81b`、账户目录脱敏修订 `407f0c6`。仅静态研究，不执行第三方服务或连接真实 peer socket。
- 固定 Desktop 载体 `ba0cdd0`：主分支 `cee01fc`；[独立审查](claude-desktop-independent.md)接受载体源码/夹具，研究跟进与报告合入至 `6e19e34`。尚未以该结果替代 App mapper 或原生控制验收。
- Desktop mapper/默认发现 `129f3d0` + `fd71325` + `c4aff63`、工具身份测试 `2f69beb`：合入 main 至 `ded4fd4`；[独立审查](claude-desktop-mapper-independent.md)关闭重连重复消息问题，并通过截图目标的真实只读核验。
- Web 最后证据与权限文案 `fd07e61`、`9ab14a0`：合入 main 至 `39db1fa`，独立追加接受报告为 `83f42a1`。最终生产构建已重新通过，文案区分 AnyWork 自动代答与原桌面权限模式。

## 主分支执行结果

| 检查 | 结果 |
| --- | --- |
| `cargo test --workspace` | 最终合并源码 335 passed / 8 ignored；需要显式原生环境的忽略项目仍保留，不推断其通过 |
| `cargo fmt --all -- --check` | 通过 |
| `cargo clippy --workspace --all-targets -- -D warnings` | 通过 |
| `cargo build` | 通过 |
| `npm run build` | TypeScript、生产构建及 PWA 通过 |
| `npm test` | 401 项 Web 单测、8 项私有浏览器状态检查通过 |
| `python3 scripts/build-site.py` + `PLAYWRIGHT_CHANNEL=chrome node scripts/site-test.mjs` | 英中各 320/390/768/1024/1440px、语言选择及下载检查通过 |
| `PLAYWRIGHT_CHANNEL=chrome node web/scripts/claude-agents.check.mjs` | 390/1440px × 亮暗模式，清单、人工审批创建、旧策略恢复和自定义 Agent 通过 |
| `scripts/claude-integration-test.py` | 17 项 API/协议夹具通过 |
| `scripts/claude-desktop-adapter-test.py` | 最终合并源码 12 项 Desktop/profile API 夹具通过 |
| `scripts/plugin-catalog-test.py` / `scripts/capability-projection-test.py` | 2 / 6 项通过 |
| `scripts/shared-history-test.py` / `scripts/event-scope-test.py` | 1 / 4 项通过 |
| `scripts/integration-test.py` | 25 项现有 API 回归通过 |
| `scripts/claude-desktop-launch-test.py` | 6 项 Python/Node/HTTP/WS 夹具通过 |
| `scripts/source-archive-test.py` / `scripts/release-version-test.py` | 6 / 3 项通过，无版本修改或发布 |
| `git diff --check e3d7b8d..HEAD` 与 Claude Python 脚本语法编译 | 通过 |

首轮 API 检查使用冻结的 `/private/tmp/anywork-claude-main-cli-533b903`；最终合并后重跑 fmt、workspace clippy/test/build，再冻结 `/private/tmp/anywork-claude-main-final`，重跑 CLI 17、Desktop 12、插件 2、能力 6、事件 4、共享历史 1、现有 API 25 项及源归档检查，均通过。通过 `ANYWORK_BINARY` 显式传入，避免并行 worktree 编译覆盖共享 binary。Rust 日志保留在 `artifacts/claude-final/rust-checks.log`。真实 CLI 新会话与审批/问答/取消的独立执行证据见 CLI 报告；本阶段没有重复向模型付费调用，也没有向截图原会话发送提示或调用 resume。

代表性网页截图和审批浏览器结果已保留到主工作区 ignored 目录 `artifacts/claude-final/`。截图来自独立 Web 验证，不能作为原生 Desktop 控制证据。

## 按用户安排后置的真机验收

合法人工 DevTools 入口、preload 返回形状、CSP、真实 Desktop 新测试会话发送/审批/取消/模型设置及重连均须单独记录；不能用上述 CLI/浏览器或协议夹具结论替代。截图目标已独立只读通过默认发现与 5 页 98 事件读取，metadata/JSONL hash 不变；原 owner 保留。

原临时人工材料目录 `<private-handoff-dir>/` 仅作为本阶段研究记录，不作为长期安装入口。按用户暂缓测试的安排，已核对命令身份并正常停止自有等待 broker（PID `<broker-pid>`）；未向 Claude 进程发送信号。此前没有成功握手或生成 `host.json`，退出后工具已清理其私有 token snippet。后续应按[长期连接与手测指南](../../claude-desktop-setup.md)重新生成私有材料，不复用旧 token；不代输 self-XSS 确认、不改组织策略、不向截图会话发送测试内容。

收尾文档另由非作者只读复核：启动工具 `--help`、描述符/环境变量与清理契约、手测清单及 243 个相对链接/标题锚点均通过，未运行原生测试。发现的一处计划总览旧措辞已更新为源码完成、真机后置；本次文档变更通过 `git diff --check`，不重复已通过的源码回归。
