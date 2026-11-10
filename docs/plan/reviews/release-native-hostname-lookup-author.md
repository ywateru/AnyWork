# Native fixture hostname lookup — author evidence

Base: `c36b87632b459db0249c8edf703abc4b31f1863b` (immutable v0.1.23). This is a test-only correction under the existing Unix test-module gate. Production authorization, HTTP identity/token/capability validation, deadlines, retry/ownership behavior and service launch code are unchanged.

## Observed failure and proven dependency

Intel release run `42883321694`, job `130065151572`, passed 193 server cases but reported 41 Native passes, four failures and two existing ignores. Three failing successful-start paths directly reported `stage=starting`, zero info requests and no stderr/startup/bind error. The fourth, owned retry, reported only its verification error; it did **not** directly report that stage. The deliberately failing startup/bind control passed. Evidence is in `/tmp/anywork-release-023-intel-job.log`.

Python's standard `HTTPServer.server_bind` first calls `TCPServer.server_bind`, then calls `socket.getfqdn(host)` to populate `server_name`. `TCPServer` activates listening only after that method returns. The fixture wrote its initial status before construction and its ready status afterward, placing this synchronous lookup inside the observed silent-start interval.

A new deterministic negative control runs the unmodified standard `ThreadingHTTPServer` in an isolated Python process. It observes the real successful kernel TCP bind, replaces `getfqdn` with an event-controlled blocker, and proves that construction cannot complete until that resolver is released. The events release the thread and close the socket in a `finally` block; the outer process has a five-second bound. It performs no real DNS lookup and introduces no fixed startup sleep.

This establishes an unnecessary synchronous resolver dependency and reproduces a mechanism consistent with the remote diagnostics. **The remote runner's actual Python stack/resolver state was not captured; the specific DNS stall remains an inference, not a proven unique cause of v0.1.23.** The earlier ephemeral-port selection race remains unchanged and retains its explicit bind-error classification.

## Minimal correction

Only the disposable Python fixture uses a `ThreadingHTTPServer` subclass whose `server_bind` calls `TCPServer.server_bind` directly, sets the unused fixture `server_name` to `fixture`, and sets `server_port` from the actual bound socket address. The standard TCP binding, reuse options, activation/listening, threading and request lifecycle remain inherited. The fixture's public info response already reports its fixed synthetic hostname; it needs no resolved FQDN.

The real child positive regression now installs a `getfqdn` function that raises if called, then executes the existing PATH-shadow, authenticated info, missing/wrong/selected Bearer, owned PID termination and closed-port checks. It therefore fails if the fixture accidentally returns to the resolver-dependent binding path. All original IPC admission, no-ticket, external-preservation and explicit-retry assertions remain intact. Owned-retry recovery now includes the safe fixture-stage diagnostics if verification fails, without changing the assertion.

## Verification

- Complete release-profile Native library: **46 passed, two existing ignored**, 30.62 seconds on ARM macOS. This includes the original IPC test and the full unchanged 30-second owned startup-failure/explicit-retry regression.
- Deterministic old-standard-library bind/resolver blocking control passed.
- Actual child with DNS calls forbidden passed authenticated HTTP, Bearer rejection/acceptance, single owned child termination and port closure.
- Existing startup exit 73, bind failure exit 74, safe stderr/exit evidence, unauthorized external-service preservation and token/no-ticket regressions passed.
- Native Clippy including tests with `-D warnings`, formatting and diff checks passed. As before, the binary test target used read-only `TAURI_CONFIG` pointing at the existing root UI distribution; no UI output was modified.
- Windows excludes the helper under `cfg(all(test, unix))`; no production or Windows dependency was added. Intel acceptance still requires fresh exact-source CI; local ARM results are not an Intel result.

Logs: `/tmp/anywork-native-hostname-lookup-tests.log`, `/tmp/anywork-native-hostname-lookup-clippy.log`. All child services, sockets and files were disposable fixtures. No installed application, existing service, account, workspace/business content or cloud configuration was changed. No tag or existing release was retried or moved.
