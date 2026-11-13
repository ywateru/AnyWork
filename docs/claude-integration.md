# Claude Code 与 Claude Desktop Code

状态：2026-11-13 CLI、Web 与 Desktop 载体/适配源码已合并并独立接受；真实 CLI 和截图会话被动历史已通过。用户明确安排 Desktop 真机测试留待提交后自行执行，本轮调研、源码、网页和文档交付已完成。Desktop 原生桥控制仍未真机验收，继续标为实验能力；源码验收、真实模型与发布分别记录。

[第三方研究](plan/analysis/claude-third-party.md)、[CLI 审查](plan/reviews/claude-backend-independent.md)、[Desktop 载体审查](plan/reviews/claude-desktop-independent.md)、[Desktop 映射与真实只读审查](plan/reviews/claude-desktop-mapper-independent.md)、[Web 审查](plan/reviews/claude-web-independent.md)及[主分支检查](plan/reviews/claude-merged.md)分别记录证据。[Desktop 连接与手测指南](claude-desktop-setup.md)记录后续操作，不以源码完成代替真机通过。

## 原生边界

Claude Code CLI 的非交互入口是 `claude --print --input-format stream-json --output-format stream-json --verbose`，会话通过明确的 UUID、`--session-id` / `--resume` 绑定。适配器复用本机登录，不复制凭据，不调用 shell 拼接用户提示。官方 Python Agent SDK 是流协议、权限与恢复的参考实现。CLI JSONL 历史位于 Claude 配置目录的 `projects` 下。

Claude Desktop 的 **Code** 与普通 Claude 聊天、Cowork 分开识别。本机安装包和 `claude-code-sessions` 存储仅做只读调查；桌面会话映射和共享调用必须有原生接口证据。不能把读取历史、独立 CLI 恢复或桌面深链当作已连接原桌面执行进程。具体协议调研记录于 `plan/analysis/claude.md`。

已在安装包定位 `window["claude.web"].LocalSessions` 原生 preload 边界，含会话列表、发送、中断、模型、历史分页。当前 5.11492.x 会拒绝未经厂商短期签名授权的 CDP 启动参数，因此普通 `--remote-debugging-port` launcher 不可用。连接方案继续核对原生 IPC 与正常 DevTools 的固定 outgoing loopback 桥，不能发布一个普通用户无法获得入口的空壳。受支持的连接必须复用原桌面所有者，不以 CLI 恢复替代；缺少入口时只读历史仍可使用。连接载体与原生会话调用分别验收。

## 产品契约

- Agent 标识固定为 `claude-code` 与 `claude-desktop`，界面分别显示 Claude Code、Claude Desktop Code。两者接入已有插件清单、侧栏过滤、能力与就绪投影。
- CLI 支持创建、持久历史发现、最近历史读取与分页、按原 ID 恢复、文本和图片、流式正文/思考/工具、审批和开放问答、取消及模型选择。原生不支持的目标、Codex 式消息编辑、服务等级与分叉不显示为可用。
- 历史发现被动执行，不启动推理，不取得 writer，不从历史最后事件猜测现在仍在运行。跨目录遵守通用 `--agent-scope all`；已有 Claude 历史不直接改写。
- 同一原生会话只允许一个受控 writer。不能因原宿主不可达而悄悄恢复到第二个执行器，不能忽略已有原生 session 锁或活跃状态。未知执行结果不自动重放。
- 桌面 Code 支持已有本地会话的发现与可见记录读取，并接入经调研确认可用的原生控制路径。云会话与 Cowork 不冒充本地 Code 会话。缺少入口时明确说明原因与设置步骤。
- 本机截图会话位于 Claude-3p profile。默认持久发现应覆盖经核实的 Claude 与 Claude-3p 原生存储位置；`ANYWORK_CLAUDE_DESKTOP_HISTORY_ROOT` 可显式指定单个 `claude-code-sessions` 根。不同 profile 的会话同 ID 冲突不得静默覆盖，索引来源应能定位原 metadata 与 transcript。不能仅凭默认 Claude 目录为空判定本机没有 Code 会话。
- 桌面连接工具仅操作用户明确指定的应用/profile，不关闭已有应用，不删除实例锁，不自动把既有配置复制到测试 profile。不伪造厂商 CDP 签名，不修改登录或组织策略；已有受授权 CDP 只连接 loopback。正常 DevTools 方案尊重 `developerModeEnabled` 与 HIPAA 限制。描述符包含实例身份且按当前用户私有权限保存；固定调用不接收任意 JavaScript。断开载体只清理自身描述符，不结束 Claude。
- 如使用 outgoing loopback 桥，由当前服务生成单独的随机、有限作用域连接令牌，原生 renderer 在用户明确连接后使用首帧认证；不把 AnyWork 通用访问令牌或模型账号凭据粘贴到 renderer。连接有来源、大小与固定方法校验；重启/重载换代后旧连接不能继续发命令。连接步骤必须先以隔离原应用核实，CSP 或组织策略阻止时明确不可用。
- 桌面连接描述符默认 `~/.anywork/claude-desktop/host.json`，通过 `ANYWORK_CLAUDE_DESKTOP_DESCRIPTOR` 显式覆盖。事件轮询包含 generation、cursor 与丢失标记；事件缺口或 renderer 重载后先重新读取原生快照，不能把未知执行状态当空闲并重复发送。
- 原生 Desktop LocalSessions 未暴露模型目录 getter。桌面模型列表允许由已观测会话模型组成，并明确 `catalogComplete:false`；不硬编码一份假装完整的厂商模型目录。
- 适配器将原生流转换为现有 `thread/*`、`turn/*`、`item/*` 事件，并保持消息、工具调用、轮次和会话身份。取消只操作本适配器拥有的执行，不结束原桌面应用。
- 权限请求只接受原请求提供的决定；默认保留人工审批，不自动启用 bypassPermissions。附件使用现有会话文件边界，不把任意本地路径升级为可读附件。
- 服务重启可保留并继续原生会话；只读发现失败不删除已有历史。损坏或未知记录明确报告，记录内容不进入错误日志。

## 网页介绍与验收

沿用现有网站视觉。官网新增后端 Agent 说明，README、入门文档和支持矩阵同步；区分 Codex、Claude Code、Claude Desktop Code、DeepSeek Harness 和 WorkBuddy 的实际能力与实验边界。官网中文、英文保持同等声明。

```text
现有首页
  工作原理
  支持的后端 Agent
    Codex | Claude Code | Claude Desktop Code
    DeepSeek Harness | WorkBuddy（实验共享执行）
    设置指南 / 支持与验收边界
  现有工作区演示、连接方式、下载
```

验收覆盖真实适配器到服务 API 的创建/发送/历史/恢复/审批/取消链路，协议故障与忙碌状态、网页能力展示、双语站点构建与浏览器检查。真实本机历史只读，真实模型测试使用隔离工作区及新测试会话。没有真实模型或桌面控制证据的能力必须保留验收限制。
