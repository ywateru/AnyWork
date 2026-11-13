# Install and use AnyWork

[中文](getting-started.zh-CN.md) · [Home](../README.md)

This page describes the unified account flow in the current source. Published packages retain the capabilities in their release notes. Account remote hosting is qualified first on macOS; see the [support matrix](support-matrix.md) for other platforms.

## Choose a download

Download from [GitHub Releases](https://github.com/ywateru/AnyWork/releases/latest). All release assets have SHA-256 checksums in `SHA256SUMS`. Verify with `shasum -a 256 <file>` on macOS or `sha256sum <file>` on Linux; on Windows use `Get-FileHash <file> -Algorithm SHA256`.

- **macOS 14+:** choose `macos-arm64` for Apple Silicon or `macos-x86_64` for Intel, open the `.dmg` and drag `AnyWork.app` into Applications. Read `INSTALL-macOS.txt` in the disk image; before opening the installed app, run `sudo xattr -cr "/Applications/AnyWork.app"` in Terminal. Run the copy in Applications so automatic updates can replace it. The app is ad-hoc signed, not Apple notarized. After checking its source and checksum, use Privacy & Security → Open Anyway if Gatekeeper blocks it.
- **Windows 10/11 x64:** use the per-user `-setup.exe` installer for automatic updates. For the portable ZIP, unzip and keep `anywork-desktop.exe` beside `resources`. Install [Microsoft Edge WebView2](https://developer.microsoft.com/microsoft-edge/webview2/) if absent. The binary has no publisher certificate. This release does not hot-attach to the Windows Codex desktop process; use the Codex CLI adapter.
- **Linux:** use a writable AppImage for automatic updates (`chmod +x anywork-linux-*.AppImage`). For portable archives, extract and run `./anywork-desktop`. x64 is built on Ubuntu 22.04 (glibc 2.35+); ARM64 on Ubuntu 24.04 (glibc 2.39+). Install runtime libraries: `sudo apt install libwebkit2gtk-4.1-0 libgtk-3-0 libayatana-appindicator3-1 libsecret-1-0`. Other distributions need equivalent packages.
- **Android 8+:** install the APK from the applicable release. The current source provides a Rust/Tauri 2 client with bundled pages, in-app sign-in and a complete remote workspace. Keep Android System WebView up to date. Older APKs retain their release-specific browser launcher behavior; check the release notes. If signatures differ, use a matching package instead of uninstalling and deleting old data. A phone browser can also open [My devices](https://anywork.aixgg.com/app/).

Automatic desktop updates are available from 0.1.1. Use the Windows per-user installer or Linux AppImage to enable them. Keep AppImages writable (on recent Ubuntu, install `libfuse2t64`, or use `--appimage-extract-and-run` if FUSE is unavailable). Version 0.1.0 needs one manual upgrade. [Update behavior and supported packages](updates.md).

## Start the host

Set up the backend you intend to use; see [Choose a backend agent](#choose-a-backend-agent) below. For Codex, verify `codex login status` in the host user's shell; set `CODEX_BIN` to the absolute executable path if the desktop application cannot find it. Your model account and AnyWork device account serve different purposes; model calls continue to use your existing account.

Open AnyWork, select the allowed workspace if needed, and click **Open workspace**. The desktop prepares the local service and opens the same workspace in your browser without a copied key. Local use does not require a cloud account and remains available when cloud services are unavailable.

An independently started service is reused after identity verification; select its matching data directory in settings. Do not start a second service on the same port. An older service without local browser handoff needs an upgrade; the desktop will not put its long-lived bearer in a URL.

## Continue on the website or phone

1. Register or sign in on the host computer, then explicitly enable **Allow my other devices to access**.
2. Open [My devices](https://anywork.aixgg.com/app/) on another computer or phone and sign in to the same account. In the Android client, sign in inside the app and select **My devices**. No VPN configuration or pairing link is required.
3. Select a ready computer. For a first connection or changed key, verify its identity against the host before opening the workspace.
4. Return to **My devices** to choose another computer. Signing out remotely ends that remote connection. Disabling remote access on the host leaves local work available.

Keep the host awake and connected. Native account credentials and endpoint keys stay in RAM; after exiting the desktop app, sign in, enable remote access and confirm the new key again. Normal short authorization updates happen inside the encrypted connection. A disconnected operation is never automatically replayed; check history if its result is unknown.

Standalone anonymous/named tunnels, WireGuard and manual address/key connections are retired from the new user flow. Old settings are retained for explicit rollback, without automatically running them. See [desktop and Android behavior](desktop-manager.md) for handoff, authorization and migration boundaries.

## Choose a backend agent

The following describes the current source integration, not a promise that every published package includes it. Check the [support and acceptance matrix](support-matrix.md) for topology-specific evidence. The Web client loads the host's `/plugins` catalog; **New chat → Agent** and **Settings → Agents** use that list, availability and setup hints. A sidebar filter can include historical or unavailable Agents without making them executable.

| Backend | Setup and scope |
| --- | --- |
| Codex | Install and sign in to [Codex CLI](https://github.com/openai/codex) as the host user. Set `CODEX_BIN` if the GUI cannot find it. Existing desktop control needs a compatible [sharing interface](desktop-shared-start.md). |
| Claude Code (`claude-code`) | Install [Claude Code CLI](https://code.claude.com/docs/en/setup) and complete its native sign-in under the same host user. Confirm `claude --version` works in the service environment. Choose **Claude Code** when the host catalog reports it available; use **Recheck connection** after setup. Existing sessions retain their native IDs for history and explicit resumption. |
| Claude Desktop Code (`claude-desktop`) | Use the **local Code** section of Claude Desktop, with a workspace prepared in that app. Ordinary Claude chat, Cowork and cloud sessions are separate. Select **Claude Desktop Code** in the sidebar to find discovered local history. Writing requires **a valid native bridge allowed by organization policy**. A usable desktop control path has not yet been confirmed. Without that endpoint, supported persisted history remains readable. Follow the host's setup hint; visible history, a desktop deep link or independent CLI resumption does not prove attachment to the original desktop execution process. Live desktop control acceptance is pending. |
| DeepSeek Harness | Connect the official 0.2.2-rc.1 gateway or discovery companion: [setup guide](harness-setup.md). Independent TUI processes without a shared endpoint cannot be controlled. |
| WorkBuddy | Supported persisted history is readable; [shared execution setup](workbuddy-launcher.md) is experimental. Real writing, approval and cancellation acceptance remains limited. |

Claude Code's integration scope includes text/images, streamed replies/thinking/tools, approval and open questions, cancellation and model selection. Native initialization with CLI 2.1.323 and candidate `e70c8a5`'s isolated service API send/text stream, one-time tool approval, open question, owned cancellation, model change and same-UUID restart/resume have [passed independent acceptance](plan/reviews/claude-backend-independent.md). This covers the current source, without implying release availability or acceptance of Windows runtime, real image understanding, background subtasks, every model or Desktop control. The UI must use actual backend/session capabilities. Codex-style goals, message editing, service tiers and fork must not be inferred from the Claude name. `manual-approvals-only` means AnyWork does not auto-answer approval requests; only decisions offered by the original request may be sent. AnyWork starts new CLI runtimes with `--permission-mode manual`. An existing Desktop session's native `permissionMode`, including `auto`, remains owned by the original host; history import and bridge connection do not reset it. AnyWork session policy and native permission mode are managed separately, without extending Codex sandbox guarantees to Claude.

### Install Claude CLI and Desktop

Install the terminal CLI following the [official Claude Code setup instructions](https://code.claude.com/docs/en/setup) for your OS, then run `claude` and complete the native sign-in. Run `claude --version` under the same system user and PATH used by AnyWork. Set `ANYWORK_CLAUDE_BIN` in the service environment if the executable is elsewhere. `ANYWORK_CLAUDE_HISTORY_ROOT` selects the Claude configuration root containing `projects` / `sessions` and takes precedence over `CLAUDE_CONFIG_DIR`; if neither is set, the default is `~/.claude`. On Windows, use the native `claude.exe`; `.cmd` / `.bat` wrappers are unsupported. No model credentials should be copied into AnyWork's device account settings.

For the desktop path, follow the [official Desktop quickstart](https://code.claude.com/docs/en/desktop-quickstart): install Claude Desktop, sign in, select **Code**, and open a **local** project folder. Desktop and the terminal CLI use the same underlying engine and share project configuration/memory, but keep their own session lists. Desktop runs and updates its own copy of Claude Code; updating one does not update the other. Check Desktop's own update menu and start a new session to use its newer engine.

Live writes require a valid native bridge allowed by organization policy. A usable control path for Claude Desktop 5.11492.x has not yet been confirmed: ordinary CDP startup requires a vendor-signed authorization profile. A local script, including `scripts/claude-desktop-launch.py`, cannot independently enable that endpoint. Signing in, reading persisted history or finding a descriptor does not establish control. Keep supported history read-only when no valid bridge is available; do not restart the app, bypass native authorization or start a second writer to force a connection. Real writing, approval, cancellation and reconnection acceptance remains separate from identifying native methods.

The normal DevTools outgoing loopback bridge is a separate **experimental connection path without completed native acceptance**; it does not rely on CDP startup flags. In this approach, a local tool generates a fixed bridge script for the user to review and explicitly connect from the original app's local Code renderer DevTools. Native developer-mode, HIPAA and organization-policy restrictions still apply. Manual actions required by native safeguards, including self-XSS protection, must be completed by the user in the original app; AnyWork does not disable or bypass them. Bridge source and fixture validation are recorded separately. The native probe, connection procedure and full write path still await acceptance. Running the tool, generating a script or passing carrier tests does not establish control of the original desktop. The connection uses neither AnyWork's general access token nor model credentials. Reloads or disconnects require a fresh valid connection; requests with unknown outcomes are not automatically replayed.

The implementation and source review are complete. At the user's request, native Desktop bridge and write tests are deferred to manual testing after the commits. See the [Desktop connection and manual test guide (Chinese)](claude-desktop-setup.md) for the reviewed launcher command, private descriptor setup, disconnection and acceptance checklist. Desktop control remains experimental and has not passed real-device acceptance.

The accepted source passively scans the known Claude and Claude-3p profiles' `claude-code-sessions` roots when no override is set. Default discovery and the actual Claude-3p session's read-only history have [passed independent review](plan/reviews/claude-desktop-mapper-independent.md); this does not imply release availability or native bridge acceptance. Both profiles use the same platform parent directory:

| Platform | Default discovery roots |
| --- | --- |
| macOS | `~/Library/Application Support/Claude/claude-code-sessions` and `~/Library/Application Support/Claude-3p/claude-code-sessions` |
| Windows | `%APPDATA%/Claude/claude-code-sessions` and `%APPDATA%/Claude-3p/claude-code-sessions`; the parent falls back to the user's home if `APPDATA` is absent |
| Linux | `$XDG_CONFIG_HOME/Claude/claude-code-sessions` and `$XDG_CONFIG_HOME/Claude-3p/claude-code-sessions`; the parent defaults to `~/.config` |

Explicitly setting `ANYWORK_CLAUDE_DESKTOP_HISTORY_ROOT` **replaces both defaults with one root**, rather than adding another root. Set it in the AnyWork service environment to the absolute path of the actual `claude-code-sessions` directory, rather than an account/organization subdirectory or bridge descriptor file. Discovery observations retain metadata provenance. If a native session ID matches multiple metadata files, discovery reports ambiguity instead of silently choosing a profile. Third-party record formats still require separate checks; a screenshot or directory name does not establish compatibility. This configures discovery of supported history formats, without establishing a live bridge.

The local bridge descriptor defaults to `~/.anywork/claude-desktop/host.json`. Set `ANYWORK_CLAUDE_DESKTOP_DESCRIPTOR` in the AnyWork service environment to use a different descriptor. This is a local discovery entry, not model credentials or proof that a desktop is controllable.

Desktop's initial model list contains only models observed in local desktop sessions and reports `catalogComplete: false`. It is not a complete model catalog; an unlisted model is not proof that Claude itself lacks it. Available model operations still follow the current backend/session response.

The official [Desktop reference](https://code.claude.com/docs/en/desktop#coming-from-the-cli) documents explicit handoff. `/desktop` saves the terminal session, opens it in Desktop and exits the CLI. From the shell, `claude --desktop` opens Desktop directly; `claude --desktop --resume <session-id>` hands over an existing CLI session by ID. These shell flags require Claude Code **2.1.285+**; the handoff requires macOS or x64 Windows and a Claude subscription login, not API key or third-party provider authentication. A session still open in another terminal or running in the background is not moved. This native handoff is not an AnyWork desktop control API and does not establish arbitrary live desktop control.

Discovery is passive: reading history does not start inference or acquire a writer, and the last historical event does not establish current running state. For cross-project discovery use `--agent-scope all`; the legacy `--codex-scope all` only affects Codex. Never force a second writer into a locked or busy native session, and check history before resending an operation with an unknown outcome. Restarting AnyWork does not authorize replaying a request. Cancellation can only affect execution owned by the adapter, not terminate the Claude Desktop app. Attach files through the session upload/file picker; an arbitrary local path does not grant attachment access.

## Command-line service

From a source checkout:

```bash
./target/release/anywork \
  --workspace /absolute/path/to/projects \
  --agent-scope all
```

From an extracted portable package, enter `resources` (macOS: `AnyWork.app/Contents/Resources`) first:

```bash
./bin/anywork --web-dir web --workspace /absolute/path/to/projects
# Windows PowerShell:
# .\bin\anywork.exe --web-dir web --workspace C:\Projects
```

The default token file is `.anywork/access-token`, relative to the working directory. Desktop manager settings use the OS application support directory. Do not start a second server on the manager's port.

| Option / environment | Default | Purpose |
| --- | --- | --- |
| `--bind` / `ANYWORK_BIND` | `127.0.0.1:3210` | Listening interface and port |
| `--workspace` / `ANYWORK_WORKSPACE` | Current directory | Allowed workspace root |
| `--agent-scope` / `ANYWORK_AGENT_SCOPE` | `workspace` | Use `all` for supported Agents across projects |
| `--codex-scope` / `ANYWORK_CODEX_SCOPE` | `workspace` | Legacy Codex-only discovery scope |
| `--data-dir` / `ANYWORK_DATA` | `.anywork` | Token, database, uploads |
| `--web-dir` / `ANYWORK_WEB` | `web/dist` | Static Web client |
| `ANYWORK_TOKEN` | Generated | Explicit key, at least 16 characters |
| `CODEX_BIN` | `codex` | Codex executable path |
| `--origins` / `ANYWORK_ORIGINS` | Local dev and Android origins | Custom cross-origin allowlist |

The CLI bearer remains for internal desktop/API authentication; the Web UI does not offer a key-pasting form. Android uses bundled pages and a Rust encrypted connection instead of accessing host APIs from the legacy appassets origin. Legacy `REMOTE_AGENT_*` environment variables remain supported, with `ANYWORK_*` taking precedence. An existing `.remote-agent` directory is reused when no new data directory is specified.

## Capabilities and limits

- Codex, Claude Code CLI, local Claude Desktop Code, Harness and WorkBuddy have different topology and acceptance limits; see the [support and acceptance matrix](support-matrix.md). Cursor and other plugins are not implied to have built-in adapters.
- Desktop collaboration uses local version-dependent Unix interfaces. A discovered historical chat is not proof that the live process has a controllable endpoint. The UI must respect the reported capabilities. Do not force a second writer into an executing chat.
- The desktop follower path can read/pause a goal. Creating, resuming, editing or deleting goals requires a compatible shared engine. See [shared engine setup](desktop-shared-start.md) and [adapter reference](desktop-adapter.md) (Chinese).
- Queued messages belong to AnyWork; native desktop queue migration is not claimed. Voice dictation/read-aloud and FCM/server push after the browser closes are not included.
- The server has its OS user's terminal and filesystem privileges. Workspace path checks are not a multi-tenant sandbox. Use your own remote account; endpoint encryption does not remove device, initial-directory or hosted-frontend trust boundaries.
- Logto stores account and minimal device settings; CyberGrid/Upstash stores necessary coordination metadata. Business contents stay on endpoints and relays carry ciphertext. Model providers continue to process calls under your existing account terms.

## Troubleshooting

**No models or a failed first message:** confirm the host user can run Codex, is signed in, and that `CODEX_BIN` is correct. GUI apps may have a different PATH from a terminal.

**History loads but controls are unavailable:** inspect the sharing capability/status. Check version compatibility and configured local sharing endpoint. Do not repeatedly send the same message; unknown outcomes should be checked in history first.

**Remote access cannot start:** inspect the fixed failure stage on the host. Check local service readiness, authorization and networking. Temporary service failures can be retried; a binding mismatch needs configuration correction, without bypassing verification.

**The phone cannot find the host:** confirm the same account, a running host and enabled remote access. Coordination failures may show an unknown status. Refresh devices inside Android; older hosts need an update for Native mobile authorization. Sign in again after an app process restart. Do not bypass TLS errors or import old VPN settings.

**A local browser session ended:** click **Open workspace** in the desktop app to create a new local session. No service key entry is needed. Restarting the service invalidates its old local sessions.

**Notifications do not arrive:** grant browser/OS permission, use HTTPS, and leave the page available. A closed browser does not receive server push in this version.
