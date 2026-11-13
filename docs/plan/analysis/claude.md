# Claude Code / Desktop Code 接入调研

补充：[第三方工程研究](claude-third-party.md)核对 Happy、Hapi、claude-code-ui 与 cc-peer 的固定源码，区分 JSONL 读取、包装器进程恢复、SDK 控制与原会话 mailbox；另记录截图 Claude-3p 会话的 Desktop/CLI/原进程映射。

日期：2026-11-13。本文记录本轮证据，不把静态协议调查、夹具通过与真实原生联调混为一谈。产品规则见 [接入契约](../../claude-integration.md)。

## 已核对的公开来源

1. [官方 Python Agent SDK](https://github.com/anthropics/claude-agent-sdk-python/tree/22b8eb9c19adfa78759b79e22bd664a57843bb06)，v0.2.181（2026-11-12），MIT。`_internal/transport/subprocess_cli.py` 确认 JSON 流启动参数；`_internal/query.py` 确认初始化、权限回调、中断、模型控制；`_internal/sessions.py` 确认持久历史规则。
2. [Claude Desktop Code 文档](https://code.claude.com/docs/en/desktop)，2026-11-13 读取。Desktop 与 CLI 使用相同底层引擎，但保留各自会话列表。`/desktop` 保存会话、打开桌面并退出 CLI；`claude --desktop --resume <session-id>` 为打开/交接入口，不能据此推断提供控制 socket。桌面可用 `/resume` 继续已关闭的 CLI 会话，原 ID 可再次由 CLI 恢复。桌面 Code 下载、更新自己的 Claude Code，与终端安装版本独立。
3. [Remote Control 官方文档](https://code.claude.com/docs/en/remote-control)，2026-11-13 读取。CLI、IDE 与 Desktop 本地 Code 可开启 `/remote-control` / `/rc`，连接 claude.ai/code 或 Claude 移动端。这是上游远程服务路径，不能当作 AnyWork 已具有本地控制权的证据。
4. 本机 `claude --version` / `--help`：2.1.323。公开提供 `--print`、双向 stream-json、`--include-partial-messages`、`--replay-user-messages`、`--session-id`、`--resume`、`--permission-mode`、`--model`。

公开网站最初 `.md` URL 返回 403，常规 HTML 页面使用浏览器 User-Agent 可读取。最终结论以上述实际读取的官方页面与固定源码为依据。

## CLI 会话与调用

| 边界 | 证据与接入要求 |
| --- | --- |
| 启动 | 独立 argv 调用 `claude --print --input-format stream-json --output-format stream-json --verbose`，提示通过 stdin JSON 发送 |
| 初始化 | 写入 `type:control_request`、唯一 `request_id`、`request.subtype:initialize`；CLI 以 `control_response` 回应，不能把进程 spawn 当初始化成功 |
| 输入 | `type:user`、`message.role:user`、`message.content`、`session_id`、`parent_tool_use_id`；保持原 UUID 与明确目标 |
| 权限 | CLI 发 `can_use_tool`，保留原 `request_id`、工具名和 input；只在用户明确接受后回 `behavior:allow` + 原 `updatedInput`，拒绝回 `behavior:deny` |
| 控制 | 官方 SDK 使用 `interrupt`、`set_model`、`set_permission_mode` 等 control 请求；超时与断开不视作成功 |
| 持久历史 | 配置目录 `projects` 下 UUID 命名 JSONL；`customTitle` 优先 `aiTitle`，其次摘要/可见首请求 |
| 分支 | 由 `uuid` / `parentUuid` 选择最近主分支，排除 sidechain、team、meta；压缩后不沿 `logicalParentUuid` 再次拼入旧正文；并行 tool_result 需按调用身份补齐 |
| writer | 本机 `sessions/*.json` 包含 `pid`、`sessionId`、`procStart`、`pidDomain`、`status` 等注册信息。原生活跃会话不能未经确认直接开第二个恢复进程 |

文件读取需防目录逃逸、符号链接和无界输入；未知记录类型可跳过而不能伪造正文，损坏必需字段不能静默报告完整历史。发现失败保留旧索引。

## 模块与调用链

- 原生适配器：CLI 配置/入口发现 → 原生进程与流协议 → `RpcProcess::bridge` → 标准事件与审批。
- 持久历史：CLI projects / Desktop Code 索引 → 原 session ID 和 cwd → Store 的外部会话 → 历史 API 与游标页。
- 服务接线：启动注册 → plugins/readiness → sessions/workspaces 被动同步 → 显式创建或恢复 → runtime → send/approval/interrupt → 持久事件 → SSE。
- 客户端：API 插件清单 → Agent 过滤和新建选项 → 真实能力的 composer → 中文/英文网站与指南。

集成验收需要逐段验证以上链路，单模块夹具不能替代从 HTTP 到原生协议再到 SSE/历史的检查。

## Desktop Code 调查

本机存在 `/Applications/Claude.app/Contents/Resources/app.asar` 与 `~/Library/Application Support/Claude/claude-code-sessions`。REA 静态调查定位 `window["claude.web"].LocalSessions`，包含 `getSessionList`、`getSession`、`sendMessage`、`interrupt`、`stop`、`setModel`、`getTranscriptTail` 与 `getTranscriptPage`。这提供固定 CDP 调用的原生边界，不需要另开 CLI 竞争同一会话。精确签名、版本/hash与证据见独立 [Desktop 调查](claude-desktop.md)。普通聊天、Cowork、云端、SSH、WSL 会话不自动纳入本地 Code 控制范围。

LocalSessions 未提供模型目录 getter；界面模型列表由 renderer 发送给主进程。初版应仅返回已观测会话模型并标记 `catalogComplete:false`，不能把固定模型别名列表伪装成实时完整目录。

2026-11-13 的进一步静态与隔离运行调查发现，5.11492.x 对普通 remote-debugging startup 参数直接退出。厂商 CDP 授权验证使用固定 Ed25519 公钥、profile 路径和五分钟时效；自生成密钥不能替代授权。正常原包另外读取 `developer_settings.json` 的 `allowDevTools`，并在组织策略允许时提供 Show Dev Tools 菜单。当前继续核对正常 DevTools 发起固定本地桥和原生 IPC 的可行性；不可把静态方法存在当作已有可用控制入口。

## 验收台账

后端与网页在独立 worktree 实施，提交后由非作者独立检查。最终验收报告补充实际运行结果；当前尚无本轮真实模型或 Desktop 写入通过声明。
