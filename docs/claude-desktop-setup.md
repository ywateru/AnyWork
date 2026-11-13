# Claude Desktop Code：连接与后续手动测试

2026-11-13：Desktop 适配器、连接工具、协议夹具和独立源码审查已完成；按用户安排，原生桥连接及桌面写入的真机测试留待提交后手动执行。本指南是后续操作说明，不表示这些步骤已在真实 Desktop 上通过。历史发现与截图会话的只读读取已单独通过，详见[主分支核验](plan/reviews/claude-merged.md)。

## 适用范围

仅连接 Claude Desktop 的**本地 Code**，不涵盖普通聊天、Cowork 或云会话。当前连接工具针对 macOS 原应用包，检查过的版本为 **5.11492.0、5.11492.2**；其他版本会拒绝连接，需先复核原生 preload 契约。跨平台历史目录发现不表示 Windows/Linux 桌面连接工具已验收。

未连接桥时，AnyWork 仍可被动读取受支持的持久历史。默认发现 Claude 与 Claude-3p 两个 profile；路径和覆盖变量见[中文入门](getting-started.zh-CN.md#安装-claude-cli-与-desktop)。CLI 的独立 `resume`、原生深链和历史可见都不能代替连接原桌面执行者。

## 后续连接步骤

1. 使用包含本次提交的 AnyWork 服务。在原 Claude Desktop 中登录，打开 **Code** 的本地项目。先准备独立的临时测试目录和测试会话，避免向既有工作会话发送测试内容。
2. 使用原应用正常提供的开发者入口，遵守组织与 HIPAA 限制。macOS 的 **Help → Troubleshooting → Enable Developer Mode…** 会重启 Claude，应先保存当前工作。研究中还定位到实际 profile 的 `developer_settings.json` 中 `allowDevTools: true` 配置，以及聚焦 Code 后 **Cmd+Option+I** 的配置重读路径；这一无需重启的路径只有静态依据，尚未真机核验。若选择该配置路径，应在实际 profile 下保留既有 JSON 字段，仅修改对应字段；Claude-3p 路径为 `~/Library/Application Support/Claude-3p/developer_settings.json`。开发者配置不能覆盖组织禁用策略。AnyWork 工具不会修改这些设置。
3. 在仓库根目录启动连接工具，保持该终端运行：

   ```sh
   python3 scripts/claude-desktop-launch.py --app /Applications/Claude.app
   ```

   工具不会启动、停止或重启 Claude。它在本机 loopback 上等待连接，并打印私有 `bridge-snippet.js` 的路径。默认材料目录为 `~/.anywork/claude-desktop/`，描述符为其中的 `host.json`。目录权限要求 `0700`，文件为 `0600`，不允许符号链接。
4. 在本机审阅生成的固定脚本和仓库中的 `scripts/claude-desktop-carrier.js`，然后由用户在**原应用本地 Code renderer** 的正常 DevTools 控制台执行生成脚本一次。若原应用要求 self-XSS 手动确认，应在原应用自行完成正常流程；不要用自动化输入、修改首选项或其他方式绕过防护。脚本和描述符包含本次连接的私有 token，不应提交、分享或贴进聊天。
5. 等待终端打印原生 preload、事件订阅和 session-list 握手成功。只有握手成功才发布 `host.json`；单独生成脚本不表示已连接。随后在 AnyWork 中选择 **Claude Desktop Code**，点击“重新检查连接”，核对实际就绪状态和会话能力。

如需不同目录，连接工具支持 `--descriptor /绝对路径/私有目录/host.json`。AnyWork 服务应使用同一系统用户，并将 `ANYWORK_CLAUDE_DESKTOP_DESCRIPTOR` 设置为同一绝对路径；该环境变量也可供连接工具读取。显式 `--descriptor` 优先于连接工具的环境变量。不要把历史根目录变量与桥接描述符混用。

工具会拒绝覆盖已有描述符或脚本。先正常停止对应的旧工具；如果无法确认旧文件的所有者，改用新的私有目录。正常按 **Ctrl-C** 只断开本工具的桥并清理自己发布的文件，原会话继续由 Claude 持有。renderer 重载或连接丢失后，应结束旧工具并重新生成、审阅和连接新脚本，勿复用旧 token。普通 `--remote-debugging-port` / `--remote-debugging-pipe` 在当前版本受厂商签名授权限制，不属于本指南的设置路径。

## 后续手动验收清单

所有写操作只对独立测试会话执行，并记录 Claude 版本、AnyWork commit、操作结果及脱敏后的错误信息。若某项无法操作，记录当前能力、设置提示和原生实际结果，不将未执行项记为通过。

| 检查 | 预期与核对点 |
| --- | --- |
| 发现与历史 | 原生 Desktop ID 与 CLI ID 分别保留；历史分页、重复读取稳定；来源属于正确 profile，不产生第二个会话或启动 CLI writer。 |
| 新建与发送 | 从 AnyWork 创建独立 Desktop 测试会话，新会话使用原生 `permissionMode: default`；发送简短文本，原桌面出现同一请求，正文、思考及工具事件按实际原生结果显示，无重复消息。 |
| 发送结果不明 | 原生发送返回 void 或连接中断时，检查 `turn: null` / `submission.deliveryState: unknown` 等实际反馈；先查看原桌面和历史，不自动重发。 |
| 审批与问答 | 用测试目录中的低风险操作触发原生审批和开放问题；仅提交原请求提供的一次性决定或对应答案。若原桌面权限模式未触发审批，记录该模式，不能据此宣称审批通过。 |
| 取消与模型 | 对测试会话中正在运行的请求取消，核对原生执行状态；模型切换只按实际会话能力和原生模型 ID 检查，观察目录报告 `catalogComplete: false`。取消不应结束 Claude 应用。 |
| 重连与去重 | 在测试会话结束后断开桥，核对可用能力下降；按上述流程重新连接，历史和实时消息身份一致，无重复追加或请求自动重放。 |
| 原会话保护 | 用户指定的既有截图会话保持只读，不发送提示、不调用 CLI resume、不执行截图里的磁盘清理文字。 |

`manual-approvals-only` 表示 AnyWork 不自动代答审批请求。已有 Desktop 会话的原生 `permissionMode`（包括 `auto`）由原桌面管理，导入历史或连接桥不会重置它；不能把 AnyWork 的策略名称理解为原生宿主必定逐项弹出审批。

## 当前交付记录

本次实现和检查记录见[接入契约](claude-integration.md)、[第三方参考研究](plan/analysis/claude-third-party.md)、[Desktop 载体审查](plan/reviews/claude-desktop-independent.md)和[Desktop mapper 独立审查](plan/reviews/claude-desktop-mapper-independent.md)。真机桥测试按用户要求暂缓；曾用于等待连接的临时 broker 已停止，未生成有效描述符，后续应按本指南生成全新的私有材料。
