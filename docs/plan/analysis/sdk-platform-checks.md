# SDK package execution in native Checks

Source baseline: `8fbd9dda5ee93fe1c0174302024123aefd1b6261`, containing independently accepted qualified SDK source `123cc1c2ee3ba99f441cde71c470ab0a79f924e4`. This is the narrow [Windows coverage task](../tasks/improvement-sdk-windows-check.md), not new SDK behavior or platform/native-agent acceptance. The [SDK source review](../reviews/improvement-runtime-transport.md) retains its exact local evidence and dormant integration limits.

## Package selection and expected counts

The Windows [`Test native applications` step](../../../.github/workflows/ci.yml#L65) previously selected only `anywork` and `anywork-desktop`. Their dependency compilation includes the SDK but does not execute the SDK package's own tests. The step now preserves both packages, `--locked` and `--release`, and explicitly adds `-p remote-agent-sdk`. It retains default unit/integration/doc-test selection, the existing job timeout and all failures. No test filter, ignored test, fallback or dependency/toolchain change is introduced.

The counts below are **static expected runnable test counts**, derived from the committed test functions and cfg attributes, not an execution result from this task:

| SDK target | Linux / macOS | Windows | Source |
| --- | ---: | ---: | --- |
| Qualified module unit tests | 18 | 16 | [qualified.rs test module](../../../crates/agent-sdk/src/qualified.rs#L1010) |
| Qualified actual fake-endpoint integration tests | 5 | 4 | [tests/qualified.rs](../../../crates/agent-sdk/tests/qualified.rs#L100) |
| Legacy bridge integration tests | 3 | 3 | [tests/bridge.rs](../../../crates/agent-sdk/tests/bridge.rs#L5) |
| Total runnable SDK tests | **26** | **23** | No SDK test has an `ignore` attribute. There are currently no SDK doc-test examples to execute. |

Three existing tests are compiled only on Unix; Windows does not enumerate them as ignored runtime tests:

- [actual_unix_writer_rechecks_queued_binding_after_socket_pressure](../../../crates/agent-sdk/src/qualified.rs#L1504).
- [unix_oversized_header_closes_without_waiting_for_payload](../../../crates/agent-sdk/src/qualified.rs#L1593).
- [unix_external_process_survives_detach_and_accepts_another_connection](../../../crates/agent-sdk/tests/qualified.rs#L249).

The remaining qualified tests include serialized-writer qualification, cancellation before/after admission, partial writes and producer/authority panic, count/item/aggregate bounds, held-packet reservations, pending cleanup, terminal overflow, last-owner drop and cleanup uncertainty. The cross-platform integration cases exercise actual owned Python stdio, deadline/cancellation/EOF, partial pipe writes/reap, and unsupported bridge/bad limits. Their existing helpers choose `python` on Windows and `python3` elsewhere; this change does not replace the processes with mocks or bypass their assertions. A Windows process/pipe/cleanup failure must remain visible and receive a separate source-fix review.

The Linux Checks job already invokes [`scripts/check.sh`](../../../scripts/check.sh#L8), which runs `cargo test --workspace`, including these SDK package tests. This edit only closes the missing explicit package execution in the existing Windows job; it creates no new macOS job or Unix-on-Windows support claim.

## Evidence and remaining gate

Local verification on 2026-11-08: PyYAML parsing and structural comparison passed, proving only this Windows step's run command changes; package selection remains exactly the server, desktop and SDK with locked/release flags. Static test-attribute enumeration confirmed the table and three Unix gates. Document references/line bounds and `git diff --check` passed. `python3 scripts/release-ci-test.py` passed **10 tests**. No Cargo build/test, new browser build, real Agent or platform process was run. The release gate tests use synthetic API responses; they neither publish nor demonstrate Windows execution.

After independent review and merge, a **fresh Windows Actions run** must show the SDK unit binary, `tests/qualified.rs` and `tests/bridge.rs` actually running, with their enumerated outcomes. A green transitive build or old successful run is insufficient. Counts must be re-evaluated if SDK tests/cfg gates change. Any failure is retained; this task adds no skip to obtain green status.

SDK A remains dormant: no installed runtime or adapter consumes its authority, and legacy bridges remain unqualified. Real native applications/accounts, Windows shared-host/desktop collaboration, Linux/Windows qualified transport behavior before fresh execution, complete B/C migration, injected-clock/native freshness, durable preparation and I02/I03 integration retain their separate gates. CI fake-process success cannot establish native acceptance, expected-turn CAS or a broader support-matrix claim.
