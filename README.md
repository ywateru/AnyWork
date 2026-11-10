<div align="center">

<img src="web/public/icon.svg" width="76" alt="AnyWork" />

# AnyWork

**Your local agents. Anywhere.**

Continue Codex or DeepSeek Harness from your browser or Android phone.<br />Your workspace and agent process stay on your own computer.

[Website](https://anywork-tau.vercel.app/en/) · [My devices](https://anywork-tau.vercel.app/app/) · [Download](https://github.com/ywateru/AnyWork/releases/latest) · [中文说明](README.zh-CN.md) · [Getting started](docs/getting-started.md)

[![Checks](https://github.com/ywateru/AnyWork/actions/workflows/ci.yml/badge.svg)](https://github.com/ywateru/AnyWork/actions/workflows/ci.yml)
[![Build releases](https://github.com/ywateru/AnyWork/actions/workflows/release.yml/badge.svg)](https://github.com/ywateru/AnyWork/actions/workflows/release.yml)
[![License: AGPL v3](https://img.shields.io/badge/license-AGPL--3.0--only-183B56)](LICENSE)

</div>

## Leave the desk. Keep the context.

AnyWork gives agents running on your computer a remote workspace: streaming conversations, approvals, tool activity, files and previews. Codex also integrates subagents, diffs and a terminal. Open the same work on another screen, send a follow-up, or respond when the agent needs you.

The Rust desktop app starts your local workspace and opens it in your browser. For remote access, sign in on the host and allow your other devices to connect, then sign in to the same account on the website or phone. Logto manages accounts and minimal device settings; CyberGrid coordinates connections. Conversations, files, terminal content and endpoint private keys stay on your devices. Model calls continue to use your own model account and provider.

DeepSeek Harness is also available through its existing local Web/Desktop host: [shared-host setup and verification](docs/harness-setup.md). It preserves native session ownership and keeps Codex available alongside it.

Existing dsh and WorkBuddy histories can be browsed alongside Codex, including saved tool results while their host is disconnected. Desktop-managed services enable cross-project discovery; CLI users can set `--agent-scope all`. WorkBuddy shared desktop execution is experimental: see [setup and current acceptance limits](docs/workbuddy-launcher.md) and [history/synchronization details](docs/workbuddy-transcript-updates.md).

### What you can do

- **Continue the conversation.** Discover local Codex history, group chats by project, cache conversations and reconnect event streams. Attach to supported desktop sharing interfaces without starting a second execution engine.
- **Stay involved while work runs.** Queue or steer messages, see tool and subagent activity, answer approval requests, and receive browser completion and attention notifications.
- **Work with the output.** Browse files, preview documents and images, annotate image attachments, inspect Git diffs, and open a PTY terminal beside the chat.
- **Move between screens.** Use the same account and device list in a desktop browser, mobile browser/PWA or the Android account launcher.
- **Open your workspace.** Open locally from the desktop app, or select an authorized computer after signing in remotely. No server address, shared access key or tunnel selection is required in the user flow.

## Download and connect

Get a package from [GitHub Releases](https://github.com/ywateru/AnyWork/releases/latest), or use the [bilingual download page](https://anywork-tau.vercel.app/en/#download). These instructions describe the current source; published packages retain the capabilities recorded in their release notes. Account remote hosting is qualified first on macOS; other platform availability is tracked in the [support matrix](docs/support-matrix.md).

| Platform | Package | Requirements |
| --- | --- | --- |
| macOS Apple Silicon / Intel | `.dmg` installer; drag `AnyWork.app` into Applications | macOS 14+; ad-hoc signed, not notarized |
| Windows x64 | Per-user installer or portable `.zip` | Windows 10/11, Microsoft Edge WebView2; unsigned |
| Linux x64 / ARM64 | AppImage or portable `.tar.gz` | GTK 3, WebKitGTK 4.1; x64 built on Ubuntu 22.04, ARM64 on Ubuntu 24.04 |
| Android | `.apk` account launcher | Android 8.0+, a current HTTPS browser; Custom Tabs when available |
| Web / source | `.tar.gz` | Self-hosted deployment / development |

1. Set up the [Codex CLI](https://github.com/openai/codex) or an existing [supported Harness host](docs/harness-setup.md) **on the host computer**. Keep that computer awake while tasks run.
2. Open AnyWork, choose your workspace if needed, and click **Open workspace** for local browser access. Local use does not require a cloud account.
3. To connect remotely, register or sign in on the host and enable **Allow my other devices to access**. Open [My devices](https://anywork-tau.vercel.app/app/) on another computer or phone, sign in to the same account, verify the host identity and open its workspace.

Native account credentials and endpoint keys stay in process memory. After exiting the desktop app, sign in and enable remote access again. A new endpoint key requires confirmation. Closing remote access leaves local work available.

Desktop 0.1.1+ quietly checks and downloads updates, then installs only after confirmation. Use the Windows installer or Linux AppImage for automatic updates; portable directories update manually. Version 0.1.0 requires one manual upgrade. [Update guide](docs/updates.md).

The Android app connects to your host; it does not run Codex on the phone. Linux/Windows portable executables must remain beside their `resources` directory. macOS may require **System Settings → Privacy & Security → Open Anyway** after you verify the download. See the [installation and connection guide](docs/getting-started.md) for dependencies, CLI usage and troubleshooting.

## Run from source

Requires Node.js 22+, Rust stable with edition 2024 support, and Git. Configure Codex CLI or a supported Harness host for the agent you use; Harness 0.2.2-rc.1 separately requires Node.js 24.9+. Desktop builds also need the [Tauri system dependencies](https://v2.tauri.app/start/prerequisites/).

```bash
git clone https://github.com/ywateru/AnyWork.git
cd AnyWork
npm ci
npm run build
python3 scripts/source-archive.py
cargo build --locked --release -p anywork
./target/release/anywork --workspace /absolute/path/to/projects
```

The service listens on `http://127.0.0.1:3210`; its internal bearer remains in `.anywork/access-token` for desktop/API authentication. Use the desktop app with the matching data directory to open the local Web workspace through a one-time ticket and HttpOnly local session. The Web UI does not offer a manual address/key form. Add `--codex-scope all` to discover all local projects. Use account-authorized encrypted connections for remote work.

```bash
# Desktop manager (build the Web client first)
cargo fetch --locked
bash scripts/build-desktop.sh

# Android debug build: JDK 17, Android SDK 36, Build Tools 36.0.0
bash scripts/build-android.sh
```

Release packages are built by [GitHub Actions](.github/workflows/release.yml). Each desktop package includes the local server, Web client, licenses and corresponding source archive. Cloudflared can be used internally by the encrypted account connection. Standalone anonymous/named tunnels and WireGuard are retired from the desktop user flow; see [desktop and mobile behavior](docs/desktop-manager.md).

## How it connects

```mermaid
flowchart LR
    B[Remote browser / phone] -->|Same account · end-to-end encrypted session| G[Local account gateway]
    G --> S[AnyWork local service]
    L[Local browser] -->|Loopback-only browser session| S
    D[AnyWork desktop manager] --> S
    S --> C[Codex app-server / supported local sharing interface]
    C --> W[Your workspace and tools]
    C --> M[Your model provider]
```

AnyWork is a personal, trusted-device tool with the host user's file and terminal permissions. It is not a multi-tenant sandbox. Identity and coordination services process necessary metadata; relays carry encrypted business traffic. Initial device discovery and hosted frontend code remain trust boundaries.

### Current scope

See the [support and acceptance matrix](docs/support-matrix.md) for the current Agent/version/topology and platform evidence. Passive history, simulated tests and native writing acceptance are listed separately.

Agent adapters support **Codex** and the official **DeepSeek Harness 0.2.2-rc.1** loopback HTTP gateway. Harness shares the original native host/session; install its optional discovery companion or configure the host address explicitly. Goal/plan, fork and message editing are not supported for Harness, and independent TUI processes without a shared carrier cannot be controlled. See [Harness setup and tested scope](docs/harness-setup.md).

Codex desktop sharing relies on version-dependent Unix interfaces, tested against Codex CLI 0.163/0.164 and the desktop versions recorded in the research notes; Windows desktop hot attach is not supported. CLI-backed work is available separately.

Full goal creation/resume/edit/delete needs a compatible shared engine; the desktop follower path supports reading and pausing goals. The interface checks these capabilities before sending. Cross-client native queues, voice dictation/read-aloud, and push after the browser has been closed are not claimed as implemented. See [capabilities and limits](docs/getting-started.md#capabilities-and-limits) before choosing a deployment.

## Development

Maintainers can publish with `python3 scripts/publish.py` (or `npm run release`): version bump, exact-commit CI, release builds, website deployment and resumable verification run automatically. See the [release guide](docs/releasing.md).

```bash
npm run dev                     # Web dev server
npm test                        # Web unit tests
cargo test --workspace          # Rust tests (desktop dependencies required)
npx playwright install chromium
./scripts/check.sh              # Integration and browser checks
python3 scripts/build-site.py   # Static bilingual website
node scripts/site-test.mjs       # Website browser checks
```

Tests use isolated fixtures and temporary services; they do not send tasks to your real Codex chats.

| Area | Source |
| --- | --- |
| Local API, persistence, event streams, files and terminal | `crates/server/` |
| Agent protocol and Codex adapter | `crates/agent-sdk/`, `crates/agent-codex/` |
| Harness shared-host adapter and discovery companion | `crates/server/src/harness.rs`, `integrations/harness-discovery/` |
| Rust/Tauri desktop manager | `crates/desktop/`, `desktop/ui/` |
| Shared browser / Android interface | `web/`, `android/` |
| Bilingual product website | `site/`, `scripts/build-site.py` |

[Getting started](docs/getting-started.md) · [Architecture](docs/architecture.md) · [API](docs/api.md) · [Plugin protocol](docs/plugin-protocol.md) · [Release process](docs/releasing.md) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

## License and acknowledgements

[AGPL-3.0-only](LICENSE). Modified network deployments must provide the corresponding source; AnyWork serves its generated source archive at `/source`. Keep it current when deploying modifications.

AnyWork is an independent project, not affiliated with or endorsed by OpenAI. Codex and ChatGPT are trademarks of their respective owners. This distribution does not include their proprietary application modules or extracted avatar assets. Open-source reuse from [HAPI](https://github.com/tiann/hapi), AgentOS, Pierre and other dependencies is documented in [NOTICE](NOTICE) and [licenses/](licenses/).
