# Windows qualified transport fixture — author report

Date: 2026-11-10. Task: [release compatibility 018](../tasks/release-compatibility-018.md). Scope is the disposable peer, qualified integration tests and Windows CI Python setup; no production transport, deadline or runtime behavior changed.

## Failure evidence and limits

Exact v0.1.17 [Checks run 42813746837](https://github.com/ywateru/AnyWork/actions/runs/42813746837), Windows job `129821443961`, passed SDK unit and bridge tests. Both normal stdio tests then timed out waiting for their initial `ready` event at five seconds. The partial-write test finished in the same five-second interval and failed because its count file had never been created. The log contains no selected Python executable/version or peer stderr, so it does not establish whether a launcher/shim, interpreter initialization, inherited Python startup customization or another startup delay caused this instance. These observations do not establish a production protocol regression.

The preceding Windows job `129768024026` in [run 42798005458](https://github.com/ywateru/AnyWork/actions/runs/42798005458) passed these tests on the **same** runner image `windows-2025-vs2026`, version `20261103.298.1`. An image change is therefore not the supported diagnosis. The workflow previously relied on an unspecified `python` resolved from PATH and had no setup-python step.

The existing fixture already used `-u` and explicit stdout flushes. Its normal stdio loop reads complete newline-delimited requests; Rust writes newline-delimited JSON. On the author's Python 3.9.6, `-I -u` still exposes a buffered stdin reader: sending only 17 bytes without EOF correctly left the old 4096-byte read waiting. Thus this investigation did **not** reproduce a universal blocked-read or short-read defect in the old script. A native Windows re-run remains necessary to confirm release compatibility.

## Changes

- Windows CI explicitly provisions CPython 3.12 with setup-python and passes its absolute `python-path` output as test-only `ANYWORK_TEST_PYTHON`. The test helper validates an explicit override as an existing absolute file, and uses it directly rather than resolving a shim. Local runs without the override retain their standard platform Python command.
- Disposable peer invocations use `-I -u`, removing user-site/PYTHON environment customization while retaining unbuffered stdout. No HOME, CODEX_HOME, profiles, credentials or installed Agent data are changed or read by the peer.
- Both normal and partial modes share the bounded readiness handshake. A failed handshake explicitly closes and verifies the owned child is reaped, then reports a fixed readiness stage without dumping peer output. The partial-write deadline starts only after its actual reader reports ready, separating startup from wire behavior. Readiness and write deadlines remain five seconds each; no production deadline was changed.
- Partial mode uses direct pipe reads in a loop to consume exactly 4096 bytes before exiting without consuming the remainder. It writes the actual byte count. The transport test still sends a real 4 MiB payload, verifies one admission, requires the resulting failure to remain `Unknown`, checks the actual count file and verifies reaping, no pending work and released outgoing usage.
- A new real-pipe regression writes 17 bytes, verifies the peer has neither exited nor produced its count, then writes the remaining 4079 bytes while keeping stdin open. It requires successful exit and the exact count `4096`; this checks the prefix boundary without depending on Python buffering or EOF.

Cancellation, refusal, native-error projection, EOF, deadline, bounded receipts, pending cleanup, reaping and Unix detach coverage remain enabled. No test is skipped and no fallback transport is introduced.

## Verification

Author host: macOS, Python 3.9.6; explicit interpreter `/Library/Developer/CommandLineTools/usr/bin/python3`. Existing Cargo cache reused without deleting shared artifacts.

- `ANYWORK_TEST_PYTHON=<absolute interpreter> cargo test --locked -p remote-agent-sdk`: **27 PASS** (18 unit, 3 bridge, 6 qualified; zero ignored).
- Final qualified integration suite after the admission assertion: **6/6 PASS**, including actual stdio cancellation/deadline/EOF, refused/replied/native-error calls, partial pipe write and exact-prefix regression. Windows excludes the pre-existing Unix-only case and will execute the five portable integration tests.
- Scoped Clippy: `cargo clippy --locked -p remote-agent-sdk --test qualified -- -D warnings`: PASS.
- Rustfmt for the modified Rust test and `git diff --check`: PASS.

This is local source/fixture evidence, not Windows execution evidence. The merged exact release source must still pass the trusted Windows Checks job with the newly selected Python before a release is published. No real account, remote enable, installed application, live service or publication was modified by this lane.
