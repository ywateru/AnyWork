# Claude Desktop Code：原生会话与本地桥研究 / 实现候选

调查日期：2026-11-13。仅针对 Desktop 的 Code / LocalSessions，不将普通聊天或 Cowork 混入。遵循 `/Users/<user>/.agents/skills/reverse-engineer-anything/SKILL.md`；首次分析使用 REA，所有分析均显式限定 `source_paths`。没有修改安装应用、复制账户配置/凭据、向既有会话发送测试提示或关闭既有 Claude。

## 当前结论与验收边界

- 原生控制面确实存在：renderer 的 `window['claude.web'].LocalSessions` 包含创建、发送、历史、审批、打断、设置和事件订阅。调用由原 Desktop owner 执行，不替换其 child。
- 普通 `--remote-debugging-port/pipe` 被打包应用启动代码拒绝；在独立 profile 对真实安装包运行，观察到退出码 1 和明确拒绝消息。
- 正常用户 DevTools 路径存在：`developer_settings.json` 的 `allowDevTools:true`；仍须通过组织 `developerModeEnabled !== false` 和非 HIPAA 限制。在完整复制、未修改的临时 `.app` + 独立 profile，已用正常快捷键实际打开原生 DevTools。
- 本提交交付的正常连接入口是 **用户审阅、在正常 DevTools 运行固定 snippet 后，renderer 主动建立 loopback WebSocket**。不再提供一个用户无法自行取得 endpoint 的 `--connect` 空壳。
- **CSP 是否允许该 WS、真实 preload 的 list/history/subscribe 调用，仍未完成运行验收**。隔离控制台的 self-XSS 防粘贴要求人工接管，探针没有执行；未绕过。代码、fixtures、真实本地 HTTP/WS 传输测试通过不能替代 native 验收。
- 普通 SDK `resume` / `--desktop` 是恢复/交接，不等价于同时 attach 原桌面持有的 stdio。现有证据没有建立一个通用本地 SDK frontend attach endpoint。官方 Remote Control `/rc` 是保留 owner 的另一条已公开路径，需其正常用户授权流程。

## 包身份与 REA 证据

调查期间安装包发生版本变化，不能把旧 hash 当作当前版本。

| 对象 | 版本 | SHA-256 | 大小 |
|---|---|---|---|
| 最初 `/Applications/Claude.app/Contents/Resources/app.asar` | 5.11492.0 | `283f9e4e79abd0780799e10e949ca0d54085fede7805e2125aeac8bc904280b8` | 96,635,596 |
| 后续同路径 / 隔离复制包 ASAR | 5.11492.2 | `1e38950b8666ee7a271fdac0fc407f62bf47dc692e2ecd7f2f4f8bf6000a78fc` | 88,681,943 |
| PATH CLI 实际 `.../@anthropic-ai/claude-code/bin/claude.exe` | 2.1.323 | `5432918d904a9b6afef7bb79d20df24d76052eabc1f41bceb84091d21f8889a7` | 独立于桌面 child |

Bundle ID：`com.anthropic.claudefordesktop`；`package.json` main：`.vite/build/index.pre.js`。桌面内嵌 SDK 标识 0.3.321，不能据此假定桌面 child 与 PATH CLI 同版本。

REA retained parent Evidence：

| 分析对象 | Evidence |
|---|---|
| 5.11492.0 entry | `ev_5fdf469e44f3df606738b6e1886ca81b3e94fd171a708eaa6c9ab7b0834eb831` |
| .0 SDK/control | `ev_0bb99f147657eab77fefbe4433a0960e2de2602385a7c9439e946e78259a17e3` |
| .0 manager/transcript | `ev_d2477f2f7e1f543a3325aab31649c4823ee1b7bf17712024a917fa7516cead93` |
| .0 preload/schema | `ev_80cd0904b0dcd5da79efb21947273192b9a1cc9b69b276959c86a636af463bab` |
| .0 Electron fuses | `ev_dacfced59ea8b583fbf3a24934428058c6f5e3e33457c325ccc6caaf010e8092` |
| .2 package/index.pre/index | `ev_1f3cd1e265c42aab9334ba4b01fdbdb60d1d584b612b4597e55d513e8743c975` |
| .2 API/preload/shared | `ev_7097154ba0a5f563655c5f96798b68b47fd6276063dcc8090316ae71cdbc64f7` |
| .2 registry | `ev_b4def5d24e7a5d5a85db90be5aa7587815310d8f6159817d8f8e3abdd7c54cf5` |
| .2 manager/SDK/serializer | `ev_29e1edd1d4519ba440331c9dce05f98c000c0fda83e20c9311455167aa3c1cef` |
| .2 permission broker / transcript readers | `ev_721a2b1586243b1373d1ba4f80d9d0b16c2a319d141b983c2758332ff55e8e31` |

局限：REA 报告八个 unpacked native 文件的 ASAR integrity 元数据与实际字节不符，使用 `record-and-continue` 保留并标记不可信；这不构成恶意篡改结论。共享 7.5 MB chunk 的 .2 分析在 semantic 阶段曾耗尽 1 GiB heap，其证据局部；其他分析亦受 semantic 节点/unknown 上限限制。以下精确位置还结合包内静态文本摘录，offset 均为 **解码后的 JS 字符 offset**，不是二进制文件偏移。静态分析不等于执行观测。

## 启动 gate 与正常 DevTools

5.11492.2 `.vite/build/index.pre.js`：

- `U6` 约 889296，包含 `remote-debugging-port`、`remote-debugging-pipe` 及网络覆盖/进程替换参数。
- `Tie(argv)` 对规范化参数前缀匹配；`Eie(app.commandLine)` 检查对应 Electron switches。
- 约 970460：`(Tie(process.argv)||Eie(app.commandLine))&&!K6()&&yue(...)`。
- `yue()` 输出 `Claude: refusing to start — a debugging or network-override switch is present on the command line.` 后 `process.exit(1)`。
- `K6()` 约 890693：同时要求 `CLAUDE_CDP_AUTH` 和 `CLAUDE_USER_DATA_DIR`。token 是 `timestamp.base64(profilePath).base64(signature)`；path 解码须精确相同；`Date.now()-timestamp` 必须在 0..300000 ms。
- `Aie()` 用包内固定 SPKI Ed25519 公钥验证签名，消息是前两段以点连接。此 verifier 无用户公钥或自签 key 配置入口。自行生成另一密钥不会通过。未发现正常用户签发该 vendor token 的公开入口；未伪造或借用签名。
- packaged 且未授权时删除 `CLAUDE_USER_DATA_DIR` 环境覆盖。测试隔离使用 Electron `--user-data-dir` 参数，没有依赖这个被删除的 env。

`.2 index.chunk-DrqHwgPN.js`：

- 4620505：`developer_settings.json` schema `{allowDevTools?:boolean}`，路径为 `app.getPath('userData')` 下。
- 4621605：`Cq(predicate) = predicate() && !sb() && mon()`；`sb()` 是 HIPAA restriction，`mon()` 2270950 为 `workspace.developerModeEnabled !== false`。
- 4980906：Show Dev Tools，正常 `CommandOrControl+Alt+I`；实际 click 再调用 `RUi()`，重新检查配置和策略。

不覆盖组织策略。普通 DevTools 开关与 CDP signed gate 是不同入口；前者不使远程调试参数自动获得授权。

## 存储 schema 与 ID 映射

metadata 根：

```text
<userData>/claude-code-sessions/<accountUuid>/<orgUuid>/local_<desktopUuid>.json
```

`<userData>` 默认 `~/Library/Application Support/Claude`，可因独立 profile、第三方 provider 配置或其它受支持路径改变，不能硬认默认根包含所有 Desktop sessions。

`.2 index.chunk-BWChMfQN.js` `writeSessionToDisk` 约 2061641 使用 `n.l(session)` 后直接 `JSON.stringify` 写入。`.2 index.chunk-DOahxd_D.js` `so()` 68235 返回普通 JSON object，**无外围 wrapper**。脱敏核心形状（可选项会省略，并非所有记录具备全部字段）：

```json
{
  "sessionId": "local_<desktopUuid>",
  "cliSessionId": "<independentCliUuid>",
  "cwd": "<absolute project path>",
  "originCwd": "<original absolute path or empty string>",
  "worktreePath": "<optional absolute path>",
  "worktreeName": "<optional name>",
  "createdAt": 0,
  "lastActivityAt": 0,
  "indexedAt": 0,
  "title": "<redacted>",
  "titleSource": "<optional source>",
  "model": "<native model id>",
  "effort": "<optional native effort>",
  "permissionMode": "<native permission mode>",
  "sessionSettings": {},
  "isArchived": false,
  "priorCliSessionIds": ["<previous CLI id>"],
  "priorRemoteCliSessionIds": [],
  "overflowCliSessionIds": [],
  "historyOnlyCliSessionId": "<optional id>",
  "rewindEdges": [],
  "importedFrom": "<optional import provenance>",
  "resumeConfirmed": false,
  "stagedTranscriptPath": "<optional import path>",
  "sshConfig": {},
  "wslConfig": {},
  "movedToCloud": {"cloudSessionId": "<id>"},
  "bridgeSessionIds": [],
  "cloudSessionId": "<optional RC/bridge id>",
  "remoteControlUserEnabled": true
}
```

时间为 epoch milliseconds（示例 0 是占位符）。字段类型需按 native parser 兼容；SSH/WSL/remote 字段只应出现在对应记录，不能把示例中这些空对象当作本地记录必需值。serializer 还含 branch/sourceBranch、agent、forkedFromSessionId/forkedAtMessageUuid、archival、worktree、Remote Control、错误及摘要等字段；不应整文件无筛选输出，因为可能含 snippets、queued input、email 等。

桌面 ID 与 CLI ID 是两种独立身份；去掉 `local_` 不能推出 `cliSessionId`。fork/import/rewind/overflow 可能产生多个 CLI transcript lineage。运行态 `query`、`inputStream` 不被序列化。

CLI transcript 常见路径：

```text
${CLAUDE_CONFIG_DIR || ~/.claude}/projects/<encoded-cwd>/<cliSessionId>.jsonl
<same>/<cliSessionId>/subagents/agent-*.jsonl
```

旧 `.0 index.chunk-CRfc9Qh5.js` 路径编码器约 3285：host 路径 NFC 后每个非 ASCII 字母数字字符替换为 `-`；长度超过 200 时，前 200 字符后加 `-` 和 abs(int32 hash).toString(36)。查询还尝试 cwd、worktreePath、originCwd，并有 staged transcript、SSH mirror 及目录 fallback。仅读当前 CLI UUID 的 parentUuid 链不等于已合并所有 rewind/prior lineage。

本次最初默认 storage 根只发现 scheduled-tasks 文件，未读取其内容、未制造原生记录。后续已在 `Claude-3p` 找到真实指定会话，详见下文；默认根为空不是会话不存在的证据。

## LocalSessions 精确调用与 carrier 范围

preload 为 `window['claude.web'].LocalSessions`；不是 Node 可直接调用的全局 RPC socket。main IPC 有 top-frame/受信 origin 检查。源码可用的完整 native 函数，carrier 仅提供下面的窄子集：

| 方法 | 参数 / 返回 |
|---|---|
| `getSessionList()` | `{sessions: NativeSession[], loadGeneration, archivedPending?}` |
| `getAll()` | session array；carrier 统一从 native list 筛选本地 Code |
| `getSession(sessionId)` | native row/null；carrier 要求现有本地 session |
| `start(info)` | `{sessionId}`；最小 `cwd,message`，可 `withoutFirstMessage:true` |
| `sendMessage(...)` | native 原签名见下；公开 API 返回 `Promise<void>`，丢弃内部 delivered/queued 结果；carrier 正常完成为 null，不能作为已开始执行的确认 |
| `getTranscript(sessionId)` | message array |
| `getTranscriptTail(sessionId,limit)` | `{messages,hasMore,diag?}` |
| `getTranscriptPage(sessionId,beforeUuid,limit,options?)` | `{messages,hasMore,found,totalRows?,source?,windowFallback?,fileCursor?,clock?}`；options `{window?,fileCursor?}` |
| `respondToToolPermission(requestId,decision,updatedInput?)` | **没有 sessionId 参数** |
| `interrupt(sessionId)` / `stop(sessionId)` | native 处理；仅显式对应调用才会停止/打断 |
| `setModel(sessionId,model)` | native policy/模型验证仍生效 |
| `setEffort(sessionId,effortOrNull)` | carrier 保留 null reset |
| `setPermissionMode(sessionId,mode,...)` | carrier 仅 default/plan/acceptEdits 两参数子集 |
| `getDefaultEffort()` / `getAdvisorSetting(sessionId)` | native 返回 |
| `onOnEvent(callback)` / `onOnToolPermissionRequest(callback)` | 注意双 On；返回 unsubscribe |

原 `sendMessage` 参数顺序：

```text
sessionId, message, images?, toolStates?, attachments?, priority?,
steeringGates?, messageUuid?, seededSummon?, typedText?, sessionMentions?,
paneHolds?, seededKind?, pastes?, marks?
```

carrier 拒绝 toolStates、synthetic origins、priority/steering/permission 注入和任意代码执行。友好 alias `send([{sessionId,message,images?,attachments?,messageUuid?}])` 按以上顺序转换。所有 `invoke` 的 args 都是 JSON array。

`start([{cwd,message:"",withoutFirstMessage:true,title?,model?,permissionMode?,useWorktree?}])`：`.2 API chunk nLDtJJ6T.js` 71942 的 `Xe()` 检查 `withoutFirstMessage===true`、无 scheduledTaskId、session 不是现有 session；`Ze()` 将 message 转为 undefined。这是无需靠空字符串猜测的静态入口；真实创建/不触发 inference 尚未登录验收。

审批仅显式 `once` / `deny`，作答前刷新 native snapshot 并核对 pending request，防过期审批。`AskUserQuestion` 的允许路径：将 `updatedInput.answers` 按原 question 文本键入字符串，再与原 native input 合并。没有自动同意或账户 token 操作。

没有发现 LocalSessions 模型目录 getter。`setAvailableCodeModels()` 是 renderer 向 main 的 setter，不能冒充 getter。carrier 合成 `models()` 仅从现有 native rows 中提取见过的 model IDs，返回 `{data:[...],catalogComplete:false}`。这不能验收为“完整模型目录”。

事件原生最小 union：

```text
{type:"message", sessionId, message:<SDK stream-json envelope>}
{type:"session_updated", sessionId, session:<snapshot>, sessionSettled?:true}
{type:<other native string>, sessionId, ...original fields}
permission channel: {requestId,sessionId,toolName,input,...}
```

`.2 BWChMfQN.js`：TW/EW 1268776/1268835 发出外层 `message`；1629889 将 SDK `r.type==="stream_event"` 交给 EW。因此文本 delta 位于 `event.message.event.delta`，外层不是 `stream_event`、不是 data。1418730 为 `session_updated`。未知事件原样保留，不猜 started/completed/status 枚举。

## 传输实现与统一 Rust 接口

```rust
DesktopClient::configured(Option<PathBuf>) -> anyhow::Result<DesktopClient>
DesktopClient::available(&self) -> bool
DesktopClient::connect(&self).await -> anyhow::Result<DesktopCarrier>
DesktopCarrier::invoke(&self, method: &str, args: Value).await -> Result<Value>
DesktopCarrier::poll_events(&self, cursor: u64).await -> Result<Value>
DesktopCarrier::disconnect(&self).await -> Result<()>
```

`DesktopCarrier` 可 clone。`available()` 只表示合法 descriptor 存在；connect 再做 open/list native handshake。App/Session、RpcProcess、turn/history projection 由后端 `desktop_adapter.rs` 负责；本模块不耦合 App。

默认 descriptor `~/.anywork/claude-desktop/host.json`，可用 `ANYWORK_CLAUDE_DESKTOP_DESCRIPTOR` 指定。目录 0700、文件 0600、owner 验证、拒绝符号链接；原子 no-replace 发布；只删自己的 inode，不删 stale lock，不关外部应用。

Descriptor 包含 protocol/version、`transport:"devtools-loopback"`、loopback origin、随机 client bearer、instanceId、launcherPid、观察到的 app path/version/hash。token 不应输出；hash 是安装观察值，不再把一个 hash 当永久运行能力开关。当前版本语义仅复核 .0/.2，其余版本要求重新审阅。

loopback broker：仅 `127.0.0.1` 随机端口；`/native` WebSocket 检查 Host/Origin、首帧随机 256-bit native token，一次 attach 后销毁该 token；`/rpc` 需另一 client bearer 且拒绝网页 Origin，无 CORS。token 不入 URL、query、subprotocol、stdout、HTTP 日志。固定 JS 只执行白名单调用；不接受 eval/expression/文件读取/任意 IPC channel。

原生 renderer -> broker 的数据为 JSON reply；Rust -> broker -> native 的命令为：

```json
{"op":"invoke","id":"<consumerUuid>","method":"getSessionList","args":[]}
```

包裹返回 `{ok:true,value:...}` 或 `{ok:false,error:<fixed diagnostic>}`；Rust 返回其中 value。`poll_events` 返回：

```json
{"events":[{"sequence":1,"channel":"event","event":{"type":"message","sessionId":"local_<uuid>","message":{}}}],"cursor":1,"gap":false,"generation":"<consumerUuid>"}
```

事件队列 1024 条 / 4M 字符，单次 poll 最多 128 条 / 1M；gap/重连需重拉 snapshot，不可自动重放用户写操作。WS 支持 masked/fragmented text、ping/pong，单消息 32 MiB；连接/请求有上限和 timeout。delivery unknown 错误必须显式显示。disconnect/Drop/WS关闭只取消本消费者订阅；未调用 native stop/query.close。

## 其它候选入口的调查边界

- SDK `.2 D3EjX7r8.js` 216683：local spawn `stdio:["pipe","pipe","pipe"]`；218604 参数为 `--output-format stream-json --verbose --input-format stream-json`。manager 的 local extraArgs builder `kk()` 628120 没有 sdk-url；自定义 spawn 出现在 SSH/WSL configure 路径。通用 SDK 298618 的 `sdk-url` 检测存在，不能据此推出普通 Desktop 本地 child 实际使用它。
- shared chunk 中 createServer 命中已核查为 OAuth callback 或临时端口探测；T8cWGZkW.js 的 Unix browser bridge 请求仅 `{v,key,url}`，路由 URL 到 browser pane，非会话 stream/control。SSH library listen 和页面事件 listen 不应误作 SDK gateway。动态 alias/未选模块使“全包不存在 endpoint”无法被严格证明。
- CLI 2.1.323 嵌入 JS：`--desktop` 明确拒绝 prompt、redirected input 和 noninteractive 模式；桌面 `claude://resume?session=<uuid>` handler 382xxx 调用 importCliSession，随后导航。`claude://code/new?q=...` 是新建/导航，`continue/needs-input` 是 session 导航，不是已确证的活跃会话 prompt API。本调查未向 handler 发送任何真实会话请求。
- registry `~/.claude/sessions/<pid>.json`：sessionId/pid/cwd/startedAt/updatedAt/kind/procStart/messagingSocketPath/peerProtocol/peerFeatures/hostSessionId 等。mac procStart 来自 `LC_ALL=C TZ=UTC ps -o lstart= -p PID` 的 trim 字符串；不是 epoch ms。kind 非 interactive 仍可能是活跃 writer。
- 本机 CLI 中 peerProtocol=1，features 见 `notify_idle`、`artifact_yield`、`reply_across_default_dirs`。messagingSocketPath 属于 UDS inbox；存在 user/receipt/control 通知，但这不足以证明 SDK 完整 stream、审批、history、models attach。没有向真实 inbox 发消息。
- Desktop 自己下载 CLI：`<userData>/claude-code/<version>/<expectedSHA256前12位lowerhex>/claude`，mac bundle 形式为同目录 `claude.app/Contents/MacOS/claude`；legacy version 目录亦有 fallback。`.verified` 是 UTF-8 文本，trim 后须等于 manifest **完整** checksum（不是目录中的 12 位前缀，也不是 JSON）。VM 是另一根 `claude-code-vm/<version>/claude`，不可混作 host CLI。不存在固定 Resources/claude-code/claude 的保证。

## 公开资料

官方 [Desktop](https://code.claude.com/docs/en/desktop) 与 [Remote Control](https://code.claude.com/docs/en/remote-control) 的抓取文本分别为 `/tmp/anywork-claude-public-0.md` 和 `-1.md`，本调查读取用户已抓取文件：

- Desktop 5420 附近确认 underlying engine 相同、session list 分离；`/desktop` / `claude --desktop --resume` 为交接、原终端退出；之后可在两端恢复同一 session。5719 附近说明 Code tab 独立下载/更新 CLI。
- Remote Control 449 附近说明 Desktop local Code 可 `/rc`。这是共享原 owner 的官方产品路径；不代表无需正常登录就有匿名本地 API。
- 官方 Python SDK clone `/tmp/anywork-claude-sdk-python`，commit `22b8eb9c19adfa78759b79e22bd664a57843bb06`；client connect/query/receive_messages/interrupt/set_permission_mode/set_model 和 subprocess transport resume/fork_session 说明启动/传输控制，未建立对任意原 Desktop PID stdio 的 attach。

## 验证与人工边界

完成：Python unittest **6 项**，其中 Node vm fake native 覆盖 list/get/start withoutFirstMessage/send/history/approval/question/interrupt/models/events、过期审批、原生错误脱敏、拒绝任意方法；本地真实 HTTP/WS socket fixture 覆盖 bearer/首帧认证、RPC往返、断开唤醒、分片/ping、大包和私有文件。Rust 独立临时 harness **3 项**，包括 connect/open/list/history/send/poll/disconnect 的 fixture HTTP roundtrip。这里的 fixture send 未触及真实 Claude。

本分支未引入 Planck 的 Rust 模块，故 harness 编译不能替代其最终 App adapter 的合并集成测试。提交后由后端 worker 接线，再进行合并验证。

真实观测：

1. 安装包独立 profile + ordinary debug args：exit 1，拒绝文案与静态 gate 一致。
2. 完整只读复制的 `.app` ASAR hash 与安装 .2 一致；只在独立 profile 写 `developer_settings.json`，未复制账户配置/凭据。
3. CUA 按唯一绝对 `.app` 路径确认窗口来自复制包，正常快捷键实际打开 DevTools。
4. 新 profile 网页停在 Cloudflare 验证；未点击挑战、未登录、未绕过。
5. 控制台 self-XSS 拦截粘贴，因此 **preload/CSP/真实读写尚未通过**，未发布 native-ready descriptor。

保留隔离包位于本地隔离临时目录，profile 为其下独立的 `profile` 目录。唯一复制实例与早期同路径隔离实例在本轮只读复核时 **均已不运行**。本代理没有关闭它们，不能据旧 PID 再定位窗口。没有任何仍运行的隔离窗口可供直接交接。未复制的标准 `/Applications/Claude.app` 当前主进程 PID 为 `<desktop-pid>`，是实际截图会话的 owner。

人工原因来自 `functions.mcp__cua_repl__js` 首次返回的工具文档 **Computer Use Confirmations Policy → 1) Hand-Off Required (User Must Do It)**，不是 REA skill 的要求：

> The agent should ask the user to take over or find an alternative.
>
> [15] Bypass browser/web safety barriers …

当时隔离实例的真实 DevTools 显示：

> Warning: Don’t paste code into the DevTools Console that you don’t understand or haven’t reviewed yourself. This could allow attackers to steal your identity or take control of your computer. Type "allow pasting" below and press Enter to allow pasting.

不通过自动键入、修改 prefs、改用另一输入方式消除此拦截。**编排线程**要求先完成代码与证据审阅，再统一安排人工步骤；此前写成“用户已要求暂不发起人工步骤”不准确，现已更正来源。当前没有向终端用户发起操作请求。

## 实际截图会话：只读定位结果

通过精确文件名匹配找到以下 metadata；只解析白名单字段，未读取 transcript 正文、未连接 UDS、未发送 prompt：

```text
userData: /Users/<user>/Library/Application Support/Claude-3p
metadata root: <userData>/claude-code-sessions
metadata relative path:
  <accountUuid>/<orgUuid>/local_<desktop-session-uuid>.json
Desktop ID: local_<desktop-session-uuid>
CLI ID: <cli-session-uuid>
cwd / originCwd: /Users/<user>
title: 用户指定的截图会话
model (native ID): <native-model-id>
effort: high
permissionMode: auto
isArchived: false
createdAt: <created-at-timestamp>
lastActivityAt: <last-activity-timestamp>
```

公开报告中的账户/组织目录始终使用字面量 `<accountUuid>/<orgUuid>`，不披露实际目录 UUID；Desktop/CLI session ID、机器路径与进程身份同样泛化，精确证据仅留本地用于问题定位。精确绝对路径已直接同步负责后端发现的 Planck。metadata 没有 sshConfig、wslConfig、movedToCloud、remoteTarget、cloudSessionId 非空值。截图展示第三方 provider / `<provider-model-display-name>`；显示名与原生 model ID 的映射尚未读取，不能把显示名直接拿去 setModel。

实际 transcript 文件：`/Users/<user>/.claude/projects/<encoded-project-path>/<cli-session-uuid>.jsonl`，本轮 stat 确认文件存在。观察到的 CLI transcript config 根为 `/Users/<user>/.claude`。没有读取进程环境，不能据此声称排除所有 CLAUDE_CONFIG_DIR 覆盖；该特定 UUID 的文件确实位于上述路径。

registry `/Users/<user>/.claude/sessions/<native-pid>.json` 明确记录 `sessionId` 为 CLI UUID、`hostSessionId` 为 Desktop ID、`kind:"interactive"`、`pid:<native-pid>`、`procStart:"<process-start-time>"`、`peerProtocol:1`，features 为 `notify_idle / reply_across_default_dirs / artifact_yield`，`messagingSocketPath:/tmp/cc-socks/<native-pid>.sock`。lsof 确认 PID `<native-pid>` 正持有该 socket；未连接。进程在运行不等于当前 turn 正忙；未通过 native snapshot 判定 isRunning/pending approvals。

只读进程父链：

```text
<desktop-pid> /Applications/Claude.app/Contents/MacOS/Claude
  <helper-pid> /Applications/Claude.app/Contents/Helpers/disclaimer
    <native-pid> <userData>/claude-code/2.1.321/ddbdf2b334e1/claude.app/Contents/MacOS/claude
```

下载目录版本为 2.1.321；child 可执行文件 SHA-256 为 `f309b01144b4a1c59b3deee5c033809725c3007686dd4ae254b64a49aa5a5f10`。这是该实际 child 文件身份，不是 PATH CLI 2.1.323，也不是用运行 --version 得到的结果。目录的 `ddbdf2b334e1` 可属于下载载荷 checksum，不能要求与展开后的单个可执行文件 hash 前缀相同。

当前主进程 argv 没有 switch，尤其没有 `--third-party`、`--user-data-dir`；标准安装包路径已确证。`.2 index.pre.js` 972199 在没有环境 userData override 且 `u7(o7())` 为真时调用 `app.setPath("userData",j8())`；`j8()` 在 macOS 将当前 userData 的 `-3p` 后缀补齐。`u7()` 926653 经 `zse()` 判断 managed `authentication.deploymentMode` / `disableClaudeAiSignIn`、持久 `deploymentMode` 与配置有效性/hybrid pointer；`Lse()` 的持久字段来自 `I8()` 指定的 third-party `claude_desktop_config.json`。因此正常持久化/managed 模式足以选择 Claude-3p，不要求命令行 `--third-party`。本轮没有读取该配置文件的其它字段或账号信息，也未核对究竟命中哪个 managed/persisted 分支，不能声称已确证其具体配置来源。被动 discovery 应默认覆盖已知 `Claude` 与 `Claude-3p` 根，支持用户显式配置额外 profile 根；不能让默认 `Claude` 空记录要求用户猜路径。此接线已同步 Planck，归其 adapter/ownership 模块，不在本 carrier 写集内。

## 原 profile DevTools 状态与后续人工载体

只读检查 `/Users/<user>/Library/Application Support/Claude-3p/developer_settings.json`：**文件不存在**。`.2 shared FUi()` 4620641 在缺失时返回 `{}`，`RUi()` 4621567 使用 `allowDevTools ?? false`，因此按当前磁盘配置正常 DevTools 未开启。本轮未触碰原账户设置、未打开原窗口 DevTools。组织 `workspace.developerModeEnabled` / HIPAA 的当前运行值未读取；它们仍是额外限制，不能被 launcher 覆盖。未发现磁盘上的 Anthropic managed preference 文件不等于没有云端组织策略。

推荐后续验收在用户自行审阅并允许的 **实际已登录 Claude-3p** 中进行：由用户选择是否配置上述正常 DevTools 开关，在组织策略允许时打开普通 DevTools，先运行下面的只读探针，再运行固定桥。无需复制账户或将凭据放入隔离 profile。桥连通后只读取截图 session 的状态；现有目标授权已覆盖在原 Desktop 新建隔离的本地 Code session 并发送测试提示，无需再为这些测试单独审批。截图会话始终只读，不作为测试 prompt 目标；DevTools 安全提示仍须合法人工交接，不得绕过。

本轮已从提交 `ba0cdd0` 的源码重新生成独立人工材料（旧 native-probe 目录的 snippet 已过时，不再作为交接文件）：

```text
<private-handoff-dir>/native-readonly-probe.js
<private-handoff-dir>/bridge-snippet.js
<private-handoff-dir>/host.json  (握手成功后才发布)
```

目录 0700、两个 JS 文件 0600；bridge snippet 含一次性本地 token，不能贴到日志或聊天。broker PID `<prior-broker-pid>`（本轮观测），仅监听 loopback，由本代理启动；没有操作 Claude 生命周期。`host.json` **尚不存在**，不能把材料已生成当作 native 已连通。只读探针不含 token：检查五个方法类型、subscribe/unsubscribe、list 包形状、零 UUID 不存在 session 的 get/history 包形状，打印 keys/counts；不显示正文，再测试 loopback WS open 后关闭，不发认证、不安装 bridge。它不会证明真实存在会话的 transcript 投影或 write 已正确。

后续操作前须核验 broker 仍活跃，已停止时重新运行 launcher 生成新的私有目录与 snippet，不重用旧 token。审阅完材料后，self-XSS 的人工交接由主编排线程统一说明。本轮既没有绕过警告，也没有向用户请求现在粘贴。

### 正常启用步骤与是否需要重启

5.11492.2 的正常产品菜单路径为 **Help → Troubleshooting → Enable Developer Mode…**。shared chunk 的 `NLa` 5604639 定义该项，`FLa` 将其放入 Troubleshooting，5609124 的 Help 菜单包含 FLa。`KLa()` 5611006 先检查 `Cq(()=>true)`，显示原生警告：

> Developer mode allows access to developer tools and debugging features. Only enable this if you know what you're doing.

用户点 Enable 后，它向当前 userData 的 `developer_settings.json` 写入 `allowDevTools:true`，随后调用 **`oP(true)`**。`oP()` 3480098 设置 relaunch 参数并 `app.quit()`；quit cleanup 3481980 再调用 `nur()`，3373817 为 `app.relaunch()`。因此这条普通 UI 路径会退出并重启 Claude，不能在保留当前 owner 的要求下由代理执行，也不能告知用户“此按钮不会影响当前进程”。策略不允许时，该项不会提供正常启用路径。

若用户选择保留当前进程，可以自行审阅并在文本编辑器中创建当前实际 profile 的文件：

```text
/Users/<user>/Library/Application Support/Claude-3p/developer_settings.json
```

当前文件缺失时，其内容为：

```json
{"allowDevTools": true}
```

若后续文件已存在，应保留原有字段，仅设置此布尔字段。保存后聚焦 Claude Code 主页面，再按 **Cmd+Option+I**。源码依据：`RUi()` 4621567 调用 `IUi(true)`，4621237 的 true 强制重新读取 FUi；5235970 的 `fva()` 和 5425100 的 renderer `before-input-event` 快捷键路径每次调用 RUi。该路径仍检查 `!sb() && mon()`，没有覆盖组织/HIPAA 策略。**按静态控制流无需重启；尚未在真实已登录 profile 运行验证。** Developer 菜单可见性 `dZi` 4734023 在启动时缓存，手动保存后菜单仍隐藏并不等于快捷键未重新读取设置。此处仅提供用户可审阅步骤，代理未创建或修改原 profile 的设置；也不建议用其它调试参数或私有签名替代策略检查。

最终交接只使用独立审阅通过的源码。当前 `ba0cdd0` 材料是候选；若审阅有修复，旧私有 snippet 作废。通过后核验我们自己 broker 的 PID/命令/监听身份，只终止该 broker，并在全新 0700 目录重新生成 snippet 和与其端口一致的只读探针，不关闭或重启 Claude、不替换 native owner。最终发布给用户的命令和材料须对应通过的确切提交，不能将本段候选路径当成已获独立接受。合法人工交接之后，新建隔离测试 session 和测试提示已在现有授权内，无需新增审批。

## 原生审批 / transcript 补充证据

新增 REA 仅选 `.vite/build/index.chunk-D6ACazmZ.js`、`Du6nQG6I.js`、`CXAJZ4of.js`、`jrAmM94U.js` 四源；其余源保持未选，semantic nodes/unknowns 有界且局部，仍有前述八项 native integrity 矛盾。parent 为 `ev_721a2b1586243b1373d1ba4f80d9d0b16c2a319d141b983c2758332ff55e8e31`。

`D6ACazmZ.js` 111339 的 `getPendingRequestsForSession()` 明确输出 `{requestId,sessionId,toolName,input,...}`，所以 snapshot 每个 pendingToolPermissions 都自带 sessionId。`BWChMfQN.js` 871xxx 的 `formatSessionForEvent()` 将其放进 pendingToolPermissions。审批请求事件也使用 `request` 字段；作答参数依然不带 sessionId。

`BWChMfQN.js` 1581740 `getTranscriptPage()` 返回消息 rows 的分页结果，1588147 `getTranscriptTail()` 去掉内部 delivered 字段，1590xxx 经过 renderer redelivery/auth-error 注释等变换。`TzQUU9A1.js` 6388 的 `$n` 导出函数调用 auth-row transform 与 notice synthesis。消息处理依赖 native type、uuid，并对 assistant/user 的 message 内容进行处理；具体字段并非每一消息都必填。**不能等同原始 JSONL 行或保证全部是未改变的 SDK envelope**。具体 parse→row 全 union 及真实返回包仍未执行验收，adapter 应保留未知类型并采用稳健投影。

## sendMessage 完成与实际投递的区别

在同一 `.2` ASAR hash 下复核已由 REA 分析的 API/manager 源码：`nLDtJJ6T.js` 76479..78754 为完整公开 `async sendMessage(...)`。普通分支执行 `let a = await y.sendMessage(...)`，仅在 `modelAuthored` 或 `marks.rejectUndelivered` 且 `!a.delivered` 时抛出异常，最后执行可选 `settleHeldSendsAfterWindowSend`，**没有 `return a`**。正常完成是 undefined，经本 carrier 转为 JSON null；不存在公开的 queued string 或 queued object 返回。carrier 不开放这些 marks；即使只开放 rejectUndelivered，它也不拒绝 `{delivered:true,queued:true}`。

`BWChMfQN.js` 907229 的 manager `sendMessage()` 确实将内部 send 结果原样返回；910815..938052 的 send 包含多条 `{delivered:true,queued:true}` 分支，公开 API 将这些结果丢弃。933xxx 先把带 messageUuid 的 user row 写入 buffer 并 emit 外层 message 事件，之后 934xxx 才可能进入 deferredSends 排队；935xxx 也可能写入 heldTurnStarts、设 isRunning=false、等待交给 host。因此 **user echo 仅证明接收/列出，不能证明开始执行**，snapshot 的 isRunning/turnRunning 也不与当前提交的 UUID 原子绑定。

snapshot 的 heldInput 来自 869206 的 `heldInputView()`，形状包括 `{uuids,since,hostRedial?,waitingFor?}`，但并不覆盖所有 deferred 分支，当前 carrier 的 curated row 也未暴露此字段。不能以其缺失推断未排队。adapter 仅检查返回 queued/status 或预先 busy snapshot 都无法消除检查与发送之间的竞态。应将正常返回表述为已提交、执行状态未确认，关联后续本消息的执行事件；无法确认时保留 unknown，不自动重发，不宣称 steer 成功或原子 reject-if-busy。上述事实与限制已直接同步 Planck；本次没有调用真实 sendMessage。
