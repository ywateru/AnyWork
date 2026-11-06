# Independent review: native Harness shared-host backend

Result: **PASS**. Reviewed committed backend revisions `613649d13ce9166666bbd689a89248059ae61880`, `08f780f6ba333a7fe60726568e977fff3f34f1cd`, and final fix `a26d54bbc61fc77a3bc0826942b501e334a59d0b`. The cancellation and interaction-lifecycle blockers found independently on `08f780f` are closed on `a26d54b`. This review does not claim control of arbitrary independent TUI processes without an official carrier.

## Actual upstream and isolation

Used npm `@deepseek-ai/dsh@0.2.2-rc.1`, Node `24.9.0`, official source `fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159`, and Remote source `24160bd52e070f55e4e5a949d111644ca4a9a763`. A real official Web Host ran on loopback 9387 with a deterministic OpenAI-compatible local model on 9386. All homes, workspaces, sessions, credentials and model traffic belonged to temporary verifier fixtures. No production 3210 service, installed Codex/ChatGPT/AnyWork process or real model key was used.

The native carrier created and executed a session before AnyWork connected. AnyWork restored that exact native session ID and history; native prompts after attach and AnyWork prompts used the same original Host. Discovery-companion review is recorded separately in [harness-discovery.md](harness-discovery.md). This is actual upstream execution, not a mocked carrier or a test that only creates a new AnyWork session.

## Independent execution

The final backend worktree was clean. Independently executed each command and checked its exit status:

```sh
cargo build --locked --offline -p anywork
cargo test --locked --offline -p anywork harness::
python3 scripts/harness-integration-test.py --host-url-file /private/tmp/anywork-harness-verification/host-url --workspace /private/tmp/anywork-harness-verification/workspace --runtime-package /private/tmp/anywork-harness-verification/runtime/package.json --node /private/tmp/anywork-harness-verification/runtime/node_modules/node/bin/node
python3 scripts/source-archive-test.py
```

Build passed, all 7 Harness unit tests passed, full real-host integration passed, and all 3 source-export tests passed. The source-export test force-tracks private fixtures under both `ref/` and `.worktrees/` and verifies they remain excluded; it also checks private metadata, symlinks and unsafe manifests.

The committed integration fixture verifies native-created history, same-session traffic through two clients, fixed-cut history without duplicate replay, Host-owned session creation, real `bash` output, one-time permission, approval surviving a catalog refresh after more than two seconds, AnyWork multipart PNG upload, native durable image hydration and authenticated image bytes, actual `read_image` tool output, native cancellation, disabled unsupported capabilities, and external Host/session survival after AnyWork exits.

## Findings and closure

| Finding on 08f780f | Evidence | Closure on a26d54b |
| --- | --- | --- |
| **B1, blocking:** user cancellation was projected as completed | Native `turn/end.reason={kind:"aborted",reason:{kind:"user"}}` after interrupt; AnyWork previously returned completed | Real interrupted turn now has status `interrupted` and preserves the entire native reason in `turn.harnessReason`. Unknown variants fail explicitly. |
| **B2, blocking:** catalog refresh erased waiting state | An unresolved approval became `running` after the two-second catalog refresh, hiding the approval UI | Atomic shared observation preserves valid pending interactions. Independently waited 2.2 seconds and refreshed `/sessions` both before and after reconnect; state remained `waiting`. |
| **Interaction lifecycle, blocking:** native request identity could survive a peer change | Official gateway retains pending events and reoffers the same native event ID to a new API Peer | Disconnect emits `serverRequest/resolved(connection_lost)` before `connection/interrupted`; local IDs include the current client generation while replies retain the native event ID. Old IDs were rejected before and after redelivery, the new grant executed once, and its replay was rejected. |

These are historical findings, not open blockers.

## Additional real-host boundary checks

Used independent temporary acceptance clients beyond the committed developer fixture. Two simultaneous sessions each produced a real approval waterfall: cross-session replies were rejected, accept and decline affected only their own sessions, resolved requests could not be answered again, and only the accepted command produced output.

For connection failures, a raw TCP relay forwarded the actual official Host bytes and credentials. Destroying relay sockets for 1.8 seconds while an approval waited did not emulate an upstream API. The native Host reoffered the same event ID to a new peer; AnyWork invalidated the old local request and offered a different local ID. The new valid approval was accepted exactly once. Subsequent input executed once, user messages were not replayed, and durable Harness event keys remained unique.

Destroyed the same actual transport after the first assistant text delta while the local model continued producing delayed chunks. Reconnection replaced the snapshot prefix; reconstruction through the frontend item-start/delta/completed lifecycle yielded exactly `verify-reconnect deterministic complete`, with one final assistant item, one user message and unique durable event keys. No prompt or approval mutation was automatically resent after an uncertain failure.

While the Host was genuinely busy, `queue_if_busy:true` queued input in AnyWork; after the initial turn completed normally, the queued message appeared and executed exactly once. A separate busy native steer input also appeared exactly once and completed. Interrupt was tested separately, since interrupt deliberately pauses AnyWork's own queue.

Actual tool-image and historical user-image rendering, modal stability and draft preservation in desktop/mobile browsers are documented in [harness-ui.md](harness-ui.md), with ignored screenshots under `artifacts/harness-native-*.png`.

## Supported scope and remaining limits

The supported carrier is the pinned official loopback HTTP Web/desktop gateway, obtained explicitly or from the companion's private descriptor. The companion was installed on the isolated official Web profile and verified through the same official services used by Desktop. The production Electron app was deliberately not installed into or restarted; that packaging/device-specific installation remains a manual verification limit. No arbitrary TUI takeover or HTTPS-adapter support is asserted.

Goal/plan, thread fork and message editing are explicitly unsupported rather than simulated. Native Host settings and permissions remain authoritative. AnyWork's own pending queue is verified; already queued native Host inputs are not asserted to have a separately editable AnyWork queue representation. Actual native execution and final user-message identity are shared. File/document preview relies on the existing authorized workspace resource path; arbitrary files outside that path are not implicitly fetched from the Host.

See [harness-preflight.md](harness-preflight.md) for protocol preparation and [harness-discovery.md](harness-discovery.md) for credential/discovery lifecycle evidence. Final merged-main smoke is recorded below when the orchestrator's build is ready.

## Final merged-main smoke and cleanup

After the orchestrator merged the backend and rebuilt main, independently launched main's `target/debug/anywork` with `/private/tmp/anywork-harness-final-web-dist` and the isolated companion descriptor. Restored the native-precreated history, then sent `verify-tools` through the same actual Host and confirmed real tool output and completion. Repeated actual tool-image and historical user-image modal tests in 1440px desktop and 390px mobile browsers: each stayed open for 1.4 seconds and Escape preserved the draft. Updated the ignored `artifacts/harness-native-*.png` screenshots from this merged build and visually checked the mobile result.

Stopped only owned verifier processes (local model 9386, official isolated Host 9387, AnyWork 9391/9394, raw relay 9392/9393), verified every fixture listener closed, and removed temporary live descriptor/launch-URL files. Production 3210 and installed applications were untouched. Backend acceptance remains **PASS**, with no open blocking finding.
