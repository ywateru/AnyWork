# Install and use AnyWork

[中文](getting-started.zh-CN.md) · [Home](../README.md)

This page describes the unified account flow in the current source. Published packages retain the capabilities in their release notes. Account remote hosting is qualified first on macOS; see the [support matrix](support-matrix.md) for other platforms.

## Choose a download

Download from [GitHub Releases](https://github.com/ywateru/AnyWork/releases/latest). All release assets have SHA-256 checksums in `SHA256SUMS`. Verify with `shasum -a 256 <file>` on macOS or `sha256sum <file>` on Linux; on Windows use `Get-FileHash <file> -Algorithm SHA256`.

- **macOS 14+:** choose `macos-arm64` for Apple Silicon or `macos-x86_64` for Intel, open the `.dmg` and drag `AnyWork.app` into Applications. Read `INSTALL-macOS.txt` in the disk image; before opening the installed app, run `sudo xattr -cr "/Applications/AnyWork.app"` in Terminal. Run the copy in Applications so automatic updates can replace it. The app is ad-hoc signed, not Apple notarized. After checking its source and checksum, use Privacy & Security → Open Anyway if Gatekeeper blocks it.
- **Windows 10/11 x64:** use the per-user `-setup.exe` installer for automatic updates. For the portable ZIP, unzip and keep `anywork-desktop.exe` beside `resources`. Install [Microsoft Edge WebView2](https://developer.microsoft.com/microsoft-edge/webview2/) if absent. The binary has no publisher certificate. This release does not hot-attach to the Windows Codex desktop process; use the Codex CLI adapter.
- **Linux:** use a writable AppImage for automatic updates (`chmod +x anywork-linux-*.AppImage`). For portable archives, extract and run `./anywork-desktop`. x64 is built on Ubuntu 22.04 (glibc 2.35+); ARM64 on Ubuntu 24.04 (glibc 2.39+). Install runtime libraries: `sudo apt install libwebkit2gtk-4.1-0 libgtk-3-0 libayatana-appindicator3-1 libsecret-1-0`. Other distributions need equivalent packages.
- **Android 8+:** install the APK from the applicable release, or open [My devices](https://anywork-tau.vercel.app/app/) in your phone browser. The new account launcher uses browser Custom Tabs when available, without stored host addresses or shared keys. If signatures differ, use a matching package instead of uninstalling and deleting old data. Keep your browser up to date.

Automatic desktop updates are available from 0.1.1. Use the Windows per-user installer or Linux AppImage to enable them. Keep AppImages writable (on recent Ubuntu, install `libfuse2t64`, or use `--appimage-extract-and-run` if FUSE is unavailable). Version 0.1.0 needs one manual upgrade. [Update behavior and supported packages](updates.md).

## Start the host

Install and sign into Codex first. Verify `codex login status` in the host user's shell. If Codex is not on the desktop application's PATH, set `CODEX_BIN` to its absolute executable path before launching AnyWork. Your model account and AnyWork device account serve different purposes; model calls continue to use your existing account.

Open AnyWork, select the allowed workspace if needed, and click **Open workspace**. The desktop prepares the local service and opens the same workspace in your browser without a copied key. Local use does not require a cloud account and remains available when cloud services are unavailable.

An independently started service is reused after identity verification; select its matching data directory in settings. Do not start a second service on the same port. An older service without local browser handoff needs an upgrade; the desktop will not put its long-lived bearer in a URL.

## Continue on the website or phone

1. Register or sign in on the host computer, then explicitly enable **Allow my other devices to access**.
2. Open [My devices](https://anywork-tau.vercel.app/app/) on another computer or phone and sign in to the same account. The Android launcher opens this same HTTPS account flow; no VPN configuration or pairing link is required.
3. Select a ready computer. For a first connection or changed key, verify its identity against the host before opening the workspace.
4. Return to **My devices** to choose another computer. Signing out remotely ends that remote connection. Disabling remote access on the host leaves local work available.

Keep the host awake and connected. Native account credentials and endpoint keys stay in RAM; after exiting the desktop app, sign in, enable remote access and confirm the new key again. Normal short authorization updates happen inside the encrypted connection. A disconnected operation is never automatically replayed; check history if its result is unknown.

Standalone anonymous/named tunnels, WireGuard and manual address/key connections are retired from the new user flow. Old settings are retained for explicit rollback, without automatically running them. See [desktop and Android behavior](desktop-manager.md) for handoff, authorization and migration boundaries.

## Command-line service

From a source checkout:

```bash
./target/release/anywork \
  --workspace /absolute/path/to/projects \
  --codex-scope all
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
| `--codex-scope` / `ANYWORK_CODEX_SCOPE` | `workspace` | Use `all` to discover all local projects |
| `--data-dir` / `ANYWORK_DATA` | `.anywork` | Token, database, uploads |
| `--web-dir` / `ANYWORK_WEB` | `web/dist` | Static Web client |
| `ANYWORK_TOKEN` | Generated | Explicit key, at least 16 characters |
| `CODEX_BIN` | `codex` | Codex executable path |
| `--origins` / `ANYWORK_ORIGINS` | Local dev and Android origins | Custom cross-origin allowlist |

The CLI bearer remains for internal desktop/API authentication; the Web UI does not offer a key-pasting form. Android uses the hosted HTTPS frontend and no longer needs the old appassets origin for local business APIs. Legacy `REMOTE_AGENT_*` environment variables remain supported, with `ANYWORK_*` taking precedence. An existing `.remote-agent` directory is reused when no new data directory is specified.

## Capabilities and limits

- Supported Codex and Harness topologies, WorkBuddy passive history and experimental writing are distinguished in the [support and acceptance matrix](support-matrix.md). No Claude Code or Cursor implementation is implied by the plugin interface.
- Desktop collaboration uses local version-dependent Unix interfaces. A discovered historical chat is not proof that the live process has a controllable endpoint. The UI must respect the reported capabilities. Do not force a second writer into an executing chat.
- The desktop follower path can read/pause a goal. Creating, resuming, editing or deleting goals requires a compatible shared engine. See [shared engine setup](desktop-shared-start.md) and [adapter reference](desktop-adapter.md) (Chinese).
- Queued messages belong to AnyWork; native desktop queue migration is not claimed. Voice dictation/read-aloud and FCM/server push after the browser closes are not included.
- The server has its OS user's terminal and filesystem privileges. Workspace path checks are not a multi-tenant sandbox. Use your own remote account; endpoint encryption does not remove device, initial-directory or hosted-frontend trust boundaries.
- Logto stores account and minimal device settings; CyberGrid/Upstash stores necessary coordination metadata. Business contents stay on endpoints and relays carry ciphertext. Model providers continue to process calls under your existing account terms.

## Troubleshooting

**No models or a failed first message:** confirm the host user can run Codex, is signed in, and that `CODEX_BIN` is correct. GUI apps may have a different PATH from a terminal.

**History loads but controls are unavailable:** inspect the sharing capability/status. Check version compatibility and configured local sharing endpoint. Do not repeatedly send the same message; unknown outcomes should be checked in history first.

**Remote access cannot start:** inspect the fixed failure stage on the host. Check local service readiness, authorization and networking. Temporary service failures can be retried; a binding mismatch needs configuration correction, without bypassing verification.

**The phone cannot find the host:** confirm the same account, a running host and enabled remote access. Coordination failures may show an unknown status. Android opens the account page through a browser and does not bypass TLS errors or import old VPN settings.

**A local browser session ended:** click **Open workspace** in the desktop app to create a new local session. No service key entry is needed. Restarting the service invalidates its old local sessions.

**Notifications do not arrive:** grant browser/OS permission, use HTTPS, and leave the page available. A closed browser does not receive server push in this version.
