# Harness desktop connection discovery

Status: authorized implementation, complements the native carrier in [Harness integration](deepseek-harness-integration.md).

## Purpose and source contract

Harness Desktop uses an authenticated HTTP listener on an OS-assigned loopback port. A running desktop is not discoverable from a fixed port. AnyWork must have a supported way to obtain that host's address without modifying the installed app or starting a second execution engine.

A small optional Cordis plugin, installed through Harness's official plugin mechanism, uses two public services at official revision `fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159`:

- `webServer.getOrigin()` from `packages/host/webserver/src/index.ts` returns the bound origin, including its assigned port and protocol. Calling it before bind throws.
- `connection.authenticatedUrl(origin)` from `packages/client/connection/src/rpc-host.ts` returns the authenticated launch URL, adding the process launch token as `?token=…`.

The plugin publishes that address to a private local descriptor. It adds no network listener and executes no session commands. The Rust adapter then connects through the existing native carrier. `dsh web` can use the same plugin, or the explicit URL/token configuration described in the integration guide. Third-party standalone TUI compositions without the native carrier are not automatically controllable.

## Descriptor contract

```json
{
  "version": 1,
  "url": "http://127.0.0.1:ASSIGNED_PORT/?token=HOST_LAUNCH_TOKEN",
  "pid": 12345,
  "instanceId": "random-per-plugin-activation"
}
```

`version` and `url` are required by the native adapter. `pid` and `instanceId` identify the publisher for cleanup and diagnostics, not authentication. Configure the adapter with `--harness-discovery-file <path>`; it must reread the descriptor for subsequent connections so host restarts do not pin stale credentials.

The plugin's default file is `~/.anywork/harness/host.json`; its configuration accepts a different absolute descriptor path. Multiple independent hosts must use separate paths. Publish atomically with an owner-only directory and file (0700 / 0600 on Unix), reject symlink publication targets, and do not log the authenticated URL. A descriptor is a local credential and must not enter public diagnostics or archives. Dispose removes only the descriptor belonging to that plugin activation; it must not remove another activation's replacement.

## User flow

```text
install local companion package into selected Harness profile
   ↓ restart/reload that Harness plugin through official controls
same existing Harness host publishes private descriptor
   ↓ AnyWork --harness-discovery-file <descriptor>
native API peer → workspace/session discovery → shared history/control
```

The installation documentation must give tested CLI and Desktop plugin-manager steps using the local package; no npm publication is assumed. Do not install into the user's actual running profile as part of tests. The independent verifier installs it into an isolated official host, checks file modes and replacement/cleanup, and uses the resulting descriptor for an actual same-session AnyWork connection.

