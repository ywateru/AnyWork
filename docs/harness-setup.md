# DeepSeek Harness shared-host setup / 共享主机接入

AnyWork supports the **official 0.2.2-rc.1 Typert carrier** (source revision `fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159`). It connects to an existing Harness Web/Desktop host. It does not start another engine or attach to arbitrary independent TUI processes. The reference Remote implementation used for contract comparison is `liguobao/ds-harness-remote@24160bd52e070f55e4e5a949d111644ca4a9a763`.

AnyWork 支持官方 **0.2.2-rc.1 Typert 接口**，连接现有 Harness Web/Desktop 主机。同一个原生 session ID 同时供 Harness 与 AnyWork 使用；读取历史不启动 Agent，不另外创建执行进程。独立 TUI 若没有共享 Web 主机，需先在 Harness 中启用 Web 入口，不能宣称能够接管所有 TUI。

## Connect an existing host / 连接已有主机

Start Harness's Web profile with its existing local configuration, for example `npx @deepseek-ai/dsh@0.2.2-rc.1 web`. Its startup output provides an authenticated local launch URL. Keep that credential private. Use the same workspace root in AnyWork; discovery is restricted to directories under `--workspace`.

先启动原有 Harness 的 Web profile（需要其要求的 Node 版本，0.2.2-rc.1 要求 Node ≥24.9），使用启动输出中的带 token 本地地址。AnyWork 只发现 `--workspace` 内的主机目录。将地址写入私人文件，避免在终端历史里直接记录 token。

```sh
# The file contains the complete http://127.0.0.1:<port>/?token=... launch URL.
# 文件内放完整启动地址，权限设为仅本人可读。
chmod 600 /private/path/harness-launch-url
ANYWORK_HARNESS_URL="$(cat /private/path/harness-launch-url)" \
  ./target/debug/anywork --workspace /absolute/project/root

# Alternative: clean host URL + a private file containing only its launch token.
./target/debug/anywork --workspace /absolute/project/root \
  --harness-url http://127.0.0.1:3080/ \
  --harness-token-file /private/path/harness-token
```

For desktop discovery, install the companion from `integrations/harness-discovery/` following its README. It writes `~/.anywork/harness/host.json` with mode 0600. AnyWork automatically checks that path; no desktop-manager command-line changes are required. After enabling the companion, reload the AnyWork page to see the Agent selector. Override with `--harness-discovery-file /private/path/host.json` / `ANYWORK_HARNESS_DISCOVERY_FILE`. The reader reopens the descriptor on reconnect so host restarts can rotate their token. Explicit URL configuration takes priority over automatic discovery.

桌面主机使用 `integrations/harness-discovery/` 中的配套插件，默认生成 `~/.anywork/harness/host.json`。AnyWork 默认启用 DeepSeek Harness 接入，Agent 选择器始终显示它；未配置入口时标记“待连接”。启用配套插件后点击“重新检查连接”，即可创建会话。可用 `--harness-discovery-file` 指向单独描述文件。此文件及其 token 均不通过 `/plugins` 返回给网页。它只接受本机 HTTP 地址，Unix 上拒绝符号链接、其他用户所有的文件或公开权限。

## Supported behavior / 能力范围

- Passive workspace/session discovery; complete fixed-cut paginated history; live text/reasoning/tool streams; reconnect and durable-sequence deduplication.
- Native host session creation, same-session queue/steer, cancellation, model catalog and confirmed model selection. Model settings remain on the native host.
- Native one-time approvals (`allowed-once` / `rejected`) and user questions through the official `$events` peer; responses remain tied to the original pending event and session. Persistent permission grants are not offered.
- Image inputs become native durable attachments; history and tool image references are downloaded through `session/attachment` into the current AnyWork session's preview directory. File inputs use native `fileUploads/upload` receipts. Native file references not uploaded through AnyWork show their host-side filename; arbitrary host private attachment storage is not exposed.
- Goal/plan controls, thread forking and user-message editing are explicitly disabled for this adapter. The existing AnyWork composer is retained.
- External host sessions cannot be deleted, renamed or archived through AnyWork; manage them in Harness. Stopping AnyWork or its desktop manager disconnects only AnyWork's API peers and never shuts down Harness or cancels its work.

以上能力均通过原主机执行。网络故障后只重建读流，不自动重发执行命令；发送结果未知时需先检查原会话。输入框保留原有行为，Harness 尚未接入的目标/计划/分叉/消息编辑明确禁用。网页访问密钥继续由 AnyWork 管理，与 Harness 启动 token 分开。

## Reproduce the real-host tests / 重跑真实主机测试

These fixtures use an actual pinned npm Harness with a deterministic **local OpenAI-compatible model endpoint**, not a mocked Harness carrier. No real account/API key or model charges are involved. Use separate terminal windows for the long-lived model and host. All paths below refer to a fresh temporary directory, not the production service or installed apps.

```sh
TEST_ROOT=$(mktemp -d)
mkdir -p "$TEST_ROOT/runtime"
npm install --prefix "$TEST_ROOT/runtime" --no-audit --no-fund \
  node@24.9.0 @deepseek-ai/dsh@0.2.2-rc.1 ws
# Terminal A
python3 scripts/fixtures/harness/model.py --root "$TEST_ROOT" --port 9386
# Terminal B (same TEST_ROOT)
python3 scripts/fixtures/harness/host.py --root "$TEST_ROOT" \
  --runtime "$TEST_ROOT/runtime" --port 9387 --model-port 9386
# Terminal C, after HOST_READY
cargo build --locked -p anywork
python3 scripts/harness-integration-test.py \
  --host-url-file "$TEST_ROOT/host-url" --workspace "$TEST_ROOT/workspace" \
  --runtime-package "$TEST_ROOT/runtime/package.json" \
  --node "$TEST_ROOT/runtime/node_modules/node/bin/node"
```

The test starts and stops only its own isolated AnyWork process on an ephemeral port. It checks native-created history, native-client traffic after attach, host creation, tools, one-time approval, image upload/history/preview, image tool results and survival of the external host after disconnect. The caller separately stops its model/host fixtures when finished. Logs and credentials stay under `TEST_ROOT` and must not be committed.

## Existing local history / 本机已有历史

[Persisted history](harness-persisted-history.md) is discovered passively from the supported native catalog, independently of the live connection. Historical sessions retain native IDs and can be read while the host is unavailable. Execution still requires the original shared host.

本机已有会话会从受支持的原生历史目录自动发现，沿用原始会话标识。共享主机暂不可用时仍可查看历史；发送和控制仍需连接原主机。所有项目的发现需要显式启用 `--agent-scope all`，旧的 `--codex-scope all` 仍只控制 Codex。

Explicitly selected URLs/discovery files may belong to a different native profile. In that case, bind its history root explicitly; AnyWork does not combine it with the default HOME catalog:

```sh
./target/debug/anywork --workspace /absolute/project/root --agent-scope all \
  --harness-url http://127.0.0.1:3080/ \
  --harness-token-file /private/path/harness-token \
  --harness-history-root /absolute/native-dsh-home
```

显式指定主机地址或发现文件时，需用 `--harness-history-root`（或 `ANYWORK_HARNESS_HISTORY_ROOT`）指定该 profile 的原生数据根目录，目录内应有 `sessions`、`storages` 和 `attachments`。未指定时不会混入默认用户目录的历史。没有显式主机配置时，默认只读 `$DSH_HOME` 或 `~/.dsh`；该根目录选项也可独立用于离线查看。
