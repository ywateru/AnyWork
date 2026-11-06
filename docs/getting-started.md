# Install and use AnyWork

[中文](getting-started.zh-CN.md) · [Home](../README.md)

## Choose a download

Download from [GitHub Releases](https://github.com/ywateru/AnyWork/releases/latest). All release assets have SHA-256 checksums in `SHA256SUMS`. Verify with `shasum -a 256 <file>` on macOS or `sha256sum <file>` on Linux; on Windows use `Get-FileHash <file> -Algorithm SHA256`.

- **macOS 14+:** choose `macos-arm64` for Apple Silicon or `macos-x86_64` for Intel, open the `.dmg` and drag `AnyWork.app` into Applications. Read `INSTALL-macOS.txt` in the disk image; before opening the installed app, run `sudo xattr -cr "/Applications/AnyWork.app"` in Terminal. Run the copy in Applications so automatic updates can replace it. The app is ad-hoc signed, not Apple notarized. After checking its source and checksum, use Privacy & Security → Open Anyway if Gatekeeper blocks it.
- **Windows 10/11 x64:** use the per-user `-setup.exe` installer for automatic updates. For the portable ZIP, unzip and keep `anywork-desktop.exe` beside `resources`. Install [Microsoft Edge WebView2](https://developer.microsoft.com/microsoft-edge/webview2/) if absent. The binary has no publisher certificate. This release does not hot-attach to the Windows Codex desktop process; use the Codex CLI adapter.
- **Linux:** use a writable AppImage for automatic updates (`chmod +x anywork-linux-*.AppImage`). For portable archives, extract and run `./anywork-desktop`. x64 is built on Ubuntu 22.04 (glibc 2.35+); ARM64 on Ubuntu 24.04 (glibc 2.39+). Install runtime libraries: `sudo apt install libwebkit2gtk-4.1-0 libgtk-3-0 libayatana-appindicator3-1 libsecret-1-0`. Other distributions need equivalent packages.
- **Android 8+:** install `anywork-android.apk`, allowing installation from the source you selected. It is a signed universal APK, not a Play Store distribution. Older local debug builds with the same application ID use another signer and must be uninstalled first (export needed connection settings before doing so). Use an up-to-date Android System WebView.

Automatic desktop updates are available from 0.1.1. Use the Windows per-user installer or Linux AppImage to enable them. Keep AppImages writable (on recent Ubuntu, install `libfuse2t64`, or use `--appimage-extract-and-run` if FUSE is unavailable). Version 0.1.0 needs one manual upgrade. [Update behavior and supported packages](updates.md).

## Start the host

Install and sign into Codex first. Verify `codex login status` in the host user's shell. If Codex is not on the desktop application's PATH, set `CODEX_BIN` to its absolute executable path before launching AnyWork. The Codex account authenticates model calls; the AnyWork access key authenticates remote devices.

Open the desktop manager, complete the welcome flow, select the allowed workspace, and start the service. The **Service** area contains the host and key settings. **Connections** contains independently enabled routes and their addresses. Copy an address and the access key to your trusted device. The host must remain on, connected and awake.

On Android, create a connection profile with the server URL and key, verify it, then open the workspace. Browser users open the server URL and enter the key. Local HTTP does not provide all browser features: notification permission generally requires localhost or HTTPS.

## Choose a connection

| Route | Setup | What to expect |
| --- | --- | --- |
| Local computer | Default loopback address | `http://127.0.0.1:3210` |
| Trusted LAN | Enable LAN in the manager; allow your OS firewall | Use the host's LAN IP; plain HTTP is not encrypted |
| Temporary Cloudflare tunnel | Enable the temporary tunnel; approve cloudflared download if prompted | Temporary HTTPS URL, no Cloudflare account; URL can change after restart |
| Named Cloudflare tunnel | Configure your domain, route and connector token | Your domain remains stable; requires your Cloudflare configuration |
| WireGuard + TLS relay | Install a compatible `tunwg` binary and configure your relay | Requires your own compatible relay; not a hosted AnyWork service |
| Private Android WireGuard | Import your WireGuard profile and use a trusted HTTPS endpoint | Your peer routing, DNS and TLS must already be configured |

Cloudflare temporary tunnels use cursor-based polling in place of SSE. While its process is alive AnyWork preserves the existing tunnel and address; after a process exit it retries with backoff, but Cloudflare does not guarantee reuse of the previous hostname. The temporary, named and relay routes can be on at the same time. [Advanced connection reference](desktop-manager.md) (Chinese).

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

For Android, keep `https://appassets.androidplatform.net` when overriding allowed origins. Legacy `REMOTE_AGENT_*` environment variables remain supported, with `ANYWORK_*` taking precedence. An existing `.remote-agent` directory is reused when no new data directory is specified.

## Capabilities and limits

- Codex is the included production adapter. No Claude Code, Cursor or other agent support is implied by the plugin interface.
- Desktop collaboration uses local version-dependent Unix interfaces. A discovered historical chat is not proof that the live process has a controllable endpoint. The UI must respect the reported capabilities. Do not force a second writer into an executing chat.
- The desktop follower path can read/pause a goal. Creating, resuming, editing or deleting goals requires a compatible shared engine. See [shared engine setup](desktop-shared-start.md) and [adapter reference](desktop-adapter.md) (Chinese).
- Queued messages belong to AnyWork; native desktop queue migration is not claimed. Voice dictation/read-aloud and FCM/server push after the browser closes are not included.
- The server has its OS user's terminal and filesystem privileges. Workspace path checks are not a multi-tenant sandbox. Share keys only with trusted devices. Use TLS/VPN outside your trusted LAN.
- Third-party tunnels and model services have their own data handling policies. AnyWork does not provide an external relay or hide those services from the connection path.

## Troubleshooting

**No models or a failed first message:** confirm the host user can run Codex, is signed in, and that `CODEX_BIN` is correct. GUI apps may have a different PATH from a terminal.

**History loads but controls are unavailable:** inspect the sharing capability/status. Check version compatibility and configured local sharing endpoint. Do not repeatedly send the same message; unknown outcomes should be checked in history first.

**A tunnel cannot start:** use the manager's cloudflared download prompt or specify the correct binary. For named tunnels verify the token and origin URL. For a relay verify the helper path, credentials, DNS and TLS. A lost Quick Tunnel address is not recoverable by promising a fixed hostname.

**Android cannot connect:** test the same HTTPS address in the phone browser, check the key and Android origin allowlist, then verify VPN routing/DNS if enabled. The app does not accept untrusted TLS certificates as a substitute for a valid endpoint.

**Notifications do not arrive:** grant browser/OS permission, use HTTPS, and leave the page available. A closed browser does not receive server push in this version.
