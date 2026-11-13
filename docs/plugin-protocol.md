# Agent 插件协议 v1

插件是由管理员安装的**可执行适配器**，不是 Rust 动态链接库，也不是浏览器脚本。清单见 `plugins/README.md`。新增、删除或升级清单后重启服务端。

## 传输

stdin / stdout 使用 UTF-8 NDJSON，一行一个 JSON-RPC 风格 envelope。stderr 用于诊断。协议遵循 Codex app-server 的核心兼容子集，省略 `jsonrpc` 字段。

请求：`{"id":1,"method":"thread/start","params":{...}}`

成功：`{"id":1,"result":{...}}`

失败：`{"id":1,"error":{"code":-32000,"message":"..."}}`

通知：`{"method":"turn/completed","params":{...}}`

服务端请求审批/问答：`{"id":700,"method":"item/commandExecution/requestApproval","params":{...}}`；宿主通过同一 ID 返回 `result`。不要把日志混入 stdout。

## 必须实现的方法

| 方法 | 输入关键字段 | 结果 |
| --- | --- | --- |
| `initialize` | `clientInfo`, `capabilities.experimentalApi` | 初始化结果对象 |
| `initialized` | 无 ID 的通知 | 无响应 |
| `thread/start` | `cwd`, 可选 `model`, `approvalPolicy`, `sandbox` | `{thread:{id}}` |
| `thread/resume` | `threadId`, `cwd`, 可选配置 | `{thread:{id}}` |
| `turn/start` | `threadId`, `input`, `approvalPolicy` | `{turn:{id,status:"inProgress"}}` |
| `turn/interrupt` | `threadId`, `turnId` | `{}`，随后 turn/completed |
| `model/list` | `{}` | `{data:[{id,model,displayName}]}` |

核心输入项为 `{type:"text",text}`。支持图片的适配器还应处理 `{type:"localImage",path}`。其他附件以服务端本地路径文本附加，适配器可由 Agent 读取。

## 客户端识别的通知

| 方法 | 参数 |
| --- | --- |
| `turn/started` | `{turn:{id,status}}` |
| `item/started`, `item/completed` | `{item:{id,type,...}}` |
| `item/agentMessage/delta` | `{itemId,delta}` |
| `item/reasoning/summaryTextDelta`, `item/reasoning/textDelta` | `{itemId,delta}` |
| `item/commandExecution/outputDelta` | `{itemId,delta}` |
| `turn/diff/updated` | `{turnId,diff}` |
| `turn/completed` | `{turn:{id,status,error?}}` |
| `serverRequest/resolved` | `{requestId}` |
| `error` | `{message}` 或 `{error:{message}}` |

item 类型：`agentMessage` 包含 `text`；`reasoning` 包含 `summary`；`commandExecution` 包含 `command`、`aggregatedOutput`、`status`；`fileChange` 包含 `changes`；其他类型保留原始字段并以工具卡片展示。

turn 结束状态为 `completed`、`interrupted`、`failed`。结束时清理未完成审批。插件进程 EOF 会生成宿主 `plugin/exited` 事件并使会话变为 disconnected。

## 审批和问答

- `item/commandExecution/requestApproval` / `item/fileChange/requestApproval`：结果 `{decision:"accept"|"decline"}`。
- `item/permissions/requestApproval`：结果 `{permissions:请求权限的获批子集,scope:"turn"}`。拒绝返回空权限对象。
- `item/tool/requestUserInput`：参数 `questions:[{id,header,question,options:[{label,description}]}]`，结果 `{answers:{问题ID:{answers:[文本]}}}`。
- 其他服务端请求可在界面查看原始 JSON 并提交对应 JSON 结果；原型表单不尝试猜测任意厂商 schema。

自动模式将适配后 thread/turn 的 `approvalPolicy` 设为 `never`，并自动处理仍出现的 `requestApproval`。Codex 保留 workspace-write；其他适配器按原生权限规则映射，不得据此自动启用 Claude `bypassPermissions`。问答不会代填。

## 内置与后续厂商适配

DeepSeek Harness、WorkBuddy、Claude Code 与 Claude Desktop Code 的内置适配器将各自的会话、turn、工具、审批转换为上述协议。Claude Code 原生 stream-json 使用 `control_request` / `control_response`，不是直接输出本文的 JSON-RPC envelope；由内置 bridge 完成转换。Claude Desktop Code 通过原桌面 LocalSessions 接口连接，不把 CLI `--resume` 作为桌面共享通道。具体接入和验收见 [Claude 契约](claude-integration.md)与[支持矩阵](support-matrix.md)。

Cursor 等其他厂商可按此协议扩展。能力清单用于描述能力；v1 的基础客户端假定核心方法存在，未实现的方法应返回明确错误，不能虚报已支持。`chat` / `resume` 等声明不代表所有拓扑均有可用 writer，就绪与控制能力仍需按当前会话投影。

可用 `scripts/fake-agent.py` 阅读完整协议交互，用 `scripts/integration-test.py` 作为契约验证样例。该脚本只是假 Agent 测试夹具，不是任何真实厂商适配器。

Codex 官方参考：[Codex App Server](https://developers.openai.com/codex/app-server)。首版已与本机 Codex CLI 0.163.0 实际联调。

Claude 参考：[官方 Agent SDK](https://github.com/anthropics/claude-agent-sdk-python)、[Desktop Code](https://code.claude.com/docs/en/desktop)。SDK 原生协议与本文的适配后协议属于不同层级。
