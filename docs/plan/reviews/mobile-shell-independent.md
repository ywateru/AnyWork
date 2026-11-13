# Android shell independent review

- Reviewer scope: non-author shell/IPC/system integration; no transport-core author self-review or repeated OAuth protocol review.
- Exact initial candidate: `260c14ac3f48fb43942d9ba6bdab049821c3d438`.
- Review worktree: `mobile-shell-review`, branch `codex/mobile-shell-review`.
- Date: 2026-11-13.
- Product edits: none. Only this report is committed by the reviewer.

## Gate

PASS for the assigned shell boundary after owner fix `4025a0f9b97c8493dfc99733fa77314c1f0d8f40`. Two P2 defects were independently reproduced in the initial candidate and both are now closed by source review and focused executable rechecks. The remaining registration/ACL/packaging source review found no additional blocking defect within the assigned scope. The initial candidate alone is not accepted; integrate the fix. This is not a device-runtime, final-APK or release-signing acceptance.

## P2: bounded data queue can discard connection retirement

`crates/mobile/src/lib.rs`, `TransportBridge::new` / `sink` initially put every event, including `TransportEvent::Closed`, through the same 64-slot `mpsc` queue using `try_send`. If data fills the queue, the terminal event also returns false; draining accepted data later never emits `mobile-transport-closed`. The frontend cannot reliably observe connection retirement.

Independent minimal repro extracts the entire original `impl TransportBridge` unchanged, uses actual product event DTOs and Tokio scheduling/queue behavior, and substitutes only AppHandle/Channel/service side effects. A current-thread test installs two PTY routes, sends 64 legal ready/data events without yielding, sends Closed, then lets the consumer drain. Closed is rejected and the collected global event list stays empty.

Observed output:

```text
REPRO bridge sink accepted 64 valid PTY events, rejected Closed, consumer drained without connection-ended notification
1 passed; 0 failed (assertions demonstrate the defect, not acceptance)
```

Repro command (temporary review fixture retained for the owner):

```sh
CARGO_TARGET_DIR=/Users/water/work/2026/any-work/target CARGO_INCREMENTAL=0 \
  cargo test --manifest-path /tmp/anywork-mobile-shell-review/Cargo.toml \
  --offline --lib -- --nocapture
```

Required fix: preserve bounded PTY delivery while routing terminal retirement independently of data capacity, synchronously retiring routes for the exact connection/generation. Cover both a saturated queue and a dropped receiver. No transport-core rewrite or unbounded event queue is required.

Status: **closed in `4025a0f`**. The actual `bridge_events.rs` helper routes Closed directly to the retirement callback, independent of the data queue. The callback removes only the matching connection/generation routes under a short synchronous mutex and emits to main. No lock spans an await or Channel send. PTY data remains bounded. Independently ran its two unchanged product tests plus a full-queue test against the exact fixed `impl TransportBridge`: all **3 passed**, including immediate emission, one observed notification, matching-route removal and preservation of another generation's route.

Fixed recheck:

```sh
python3 /tmp/anywork-mobile-shell-review/run-fixed-bridge.py
CARGO_TARGET_DIR=/Users/water/work/2026/any-work/target CARGO_INCREMENTAL=0 \
  cargo test --manifest-path /tmp/anywork-mobile-shell-review/Cargo.toml \
  --offline --lib -- --nocapture
```

The fixed runner selects `fixed-bridge.rs` in the temporary manifest; the earlier original reproduction used `probe.rs`. Both source fixtures are retained. Shared target was released to the owner immediately after the focused recheck.

## P2: cancellation queued behind a slow provider allows late saved

`MobileSystemPlugin.kt`, `io` / `abortAll` / `saveResult` initially serialize cancellation and provider copying on one worker. Once `saveResult` enters `copyTo`, `abortAll` cannot even mark the copy cancelled. After the provider unblocks, later chunks continue and the original finish resolves `saved` before cancellation is handled.

Independent JVM repro compiles the unchanged product `ExportStore.kt` and exact extracted method bodies of `io`, `cancelPending`, `abortAll`, and `saveResult`. Android/Tauri peripheral types are stubs; the scheduled executor, private source file, copy loop and blocked OutputStream are real. The first of two 64 KiB writes waits on a latch. Invoke abortAll after that write starts; it remains queued. Release the latch: both chunks are written, `saved` resolves, then abortAll completes.

Observed output:

```text
REPRO abortAll queued during blocked first write: all 131072 bytes copied in 2 chunks, late finish=saved; abort acknowledged only afterward
```

Repro command:

```sh
python3 /tmp/anywork-mobile-shell-review/run-save-probe.py
```

The runner uses cached Kotlin compiler 2.2.10 and `/opt/zerobrew/opt/openjdk@17/bin/java`; no Gradle build, real provider, destination document or credentials are involved.

Required fix: record retirement independently of the blocked copy worker, check cancellation before further chunks and fence the final result. Apply the same lifecycle policy to handle abort, account/logout abortAll and destruction. Best-effort cancellation/descriptor close must not block the UI thread. If Android/provider I/O cannot stop immediately, report cleanup pending accurately and suppress a late success after cancellation wins. **No rollback of bytes already written to an external document is required.** This finding concerns controllable cancellation ordering and result reporting, not the unavoidable possibility of a blocked third-party provider.

Status: **closed in `4025a0f`**. Provider copying runs on a separate single copy worker, with at most one active copy retained until I/O exits. Control-worker cancellation atomically retires the copy, clears/rejects the pending invocation and retires private staging state. CancellationSignal/descriptor close run on a separate cleanup worker. Actual `ExportCopy` checks before/after reads and writes and after flush; final settlement runs back on the control worker and requires the same still-pending invocation plus a live entry. Destruction keeps the control worker available for the eventual copy cleanup.

Independently recompiled exact fixed bodies for `io`, `cancelPending`, `exportAbort`, `abortAll`, `saveResult`, `onDestroy`, the nested `SaveCopy`, and actual `ExportCopy`/`ExportStore`. The fake provider deliberately ignores signal/close while its first write is blocked. **All 3 integration cases passed**:

```text
PASS handle: cancellation settled while provider blocked; no second chunk/late saved; retained first external chunk; private source retired
PASS logout: cancellation settled while provider blocked; no second chunk/late saved; retained first external chunk; private source retired
PASS destroy: cancellation settled while provider blocked; no second chunk/late saved; retained first external chunk; private source retired
```

For handle/logout, the abort command also acknowledges before unblocking the provider. After release, finish has exactly one settlement (`CANCELLED`), the second chunk is absent, and the staging entry/file is retired. The destroy case additionally waits for copy/control executors to terminate. Command:

```sh
python3 /tmp/anywork-mobile-shell-review/run-fixed-save.py
```

This establishes cancellation ordering and settlement fencing with real JVM threads and unchanged product methods. Actual Android provider interruption is best effort: an ignoring provider can still leave the single copy/cleanup slot pending, and future finish calls remain busy until it exits. The contract explicitly discloses that limit. No claim of destination rollback or guaranteed platform I/O interruption is made.

## Other assigned boundaries

- All 14 shell commands match between `generate_handler!`, `tauri_build` command metadata and explicit main capability grants. A small static assertion independently checked set equality.
- Connect integration is prepare-target → native authenticated connect → epoch check → commit trust → epoch check. Every post-connect error branch closes the newly created connection. Account retirement cancels its lifetime and schedules connection/export cleanup; foreground refresh and service validation are wired.
- PTY callback DTO/channel registration precedes open, channel is attached to the invoking webview, routes are bounded and failed opens remove their route. No transport implementation re-review was performed.
- The business capability is local-only, main-window-only and has no remote URL grant. Auth plugin has no guest command handler or build-time guest commands and receives no credential/API permission grants. Native auth remains callable from Rust.
- Local bundled `mobile.html`, `frontendDist`, HTTPS Tauri scheme and exact `https://tauri.localhost` navigation fence are configured. CSP permits IPC and bundled resources, with no general business network origin.
- System plugin Rust DTOs reject unknown fields and use typed envelopes. Only the eight intended guest system commands are registered; native subscription/abortAll stay Rust-only. Export handles expose neither arbitrary paths nor credentials, and limits/order/expiry are checked. Save cleanup deletes private staging files, never the user's destination. Share grants use a dedicated non-exported provider and bounded private cache lifetime.
- Source review covered native callback/result envelopes, picker generation fencing, back/IME routing, CSS-pixel insets, appearance resume, app identifier/version and Android build/release scripts. These code paths still require Android runtime verification; source review alone does not establish physical-device behavior.

## Existing APK evidence and limits

Independently inspected the owner's existing base APK, without rebuilding or installing:

```text
/Users/water/work/2026/any-work/.worktrees/mobile-shell/artifacts/anywork-android-system-base.apk
SHA256 e6a13fdb1af0002ff0b955c0b6d8a386d393a75ebc6637d2a362383a33e8e4b6
```

`aapt dump badging`: `dev.remoteagent.app`, versionName `0.1.30`, versionCode `32`, minSdk `26`, targetSdk `37`, launcher `dev.remoteagent.app.MainActivity`, arm64 native library. No external-storage permission is advertised. `zipalign -c -P 16 4` independently passed. VersionCode exceeds legacy 31. This debug/base artifact predates the fixes and is not evidence that the final fixed APK contains them.

No full workspace build, parallel Gradle build, private key access, real session/history access, live export, device installation or release signing was performed by this review. Canonical fixed APK build/lint/unit tests belong to the shell owner; device/WebView/IME/chooser behavior and upgrade signing continuity remain separate integration/release checks.

## Handoff

Both confirmed findings and all recheck results were sent directly to Boole. The shell owner can run the single canonical APK/core-test/lint/unit sequence after `4025a0f` (owner script/report follow-up `c9f3953`). The reviewer has no Cargo/Gradle background session or shared-target reservation. Temporary repro sources remain under `/tmp/anywork-mobile-shell-review` for reproduction; no product files were modified. The independent probes do not replace canonical Android compilation or device checks.
