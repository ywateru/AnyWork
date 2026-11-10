---
id: release-native-hostname-lookup
scope: isolated-native-test-service
status: done
depends-on: [release-native-ipc-preparation]
---

## objective and evidence

Resolve the Intel Mac v0.1.23 release test failure without changing production authorization or local-service verification. Exact-source Checks and every other release platform passed. Release `42883321694`, Intel job `130065151572`, failed four Native tests: the original IPC preparation and three successful-start fixture paths. Three reported fixture state `starting`, zero info requests, and no startup/bind error or stderr; the owned-retry failure reported only the verification error without its stage. The deliberate startup/bind error case passed. Server tests passed 193 cases; Native reported 41 passed, four failed and two existing ignores. Publisher stopped, upload was skipped, and the v0.1.23 tag remains immutable.

New diagnostics place the failure between the fixture's first status write and successful HTTP server construction. Investigate Python `HTTPServer.server_bind` and its hostname lookup after binding, using a deterministic resolver negative control before choosing a correction. Original remote stacks were not captured; distinguish a proven fixture dependency from an inferred remote cause. Logs: `/tmp/anywork-release-023-intel-job.log`.

## contract and delivery

The Native author owns a minimal test-only correction and regression evidence. The independent reviewer accepts the exact committed source separately. Preserve original account gating, HTTP/Bearer checks, owned/external identity, no ticket during preparation, real failure deadlines and explicit retry behavior. Do not add sleeps, blind retry, ignored tests or production bypasses. Use only disposable test data and processes; do not touch installed applications or the retained business service. Root merges accepted source, then runs complete exact-source Checks and all release/install/site gates with a fresh immutable candidate.

Repeated Intel-only failures also justify moving the same platform's Native tests before tag creation. A separate CI author adds an Intel macOS job to trusted Checks using the release runner/deployment target and release-profile tests, without removing or weakening existing jobs or the release matrix. This job must be independently reviewed with the test correction. A failed Intel pre-tag check must block immutable publication just as other Checks failures do; the subsequent installer job still repeats its normal tests and DMG validation.

## delivery

Native `4036185` and CI `3afcae1` passed [independent acceptance](../reviews/release-native-hostname-lookup-independent.md), then merged as `f8fcea2` and `34fd9d6`. A deterministic old-standard-library control proves that resolver blocking occurs after TCP bind and before the server listens. The test-only derived server preserves real TCP binding, threading and actual port reporting while removing the unused hostname lookup. A real child with hostname lookup forbidden passes HTTP/Bearer and owned-process cleanup checks. Owned-retry failures now also include safe stage diagnostics. Production logic, deadlines and original validation assertions remain unchanged.

The author and independent reviewer each passed all 46 Native tests with two existing ignores, strict test-inclusive Clippy and formatting. The reviewer also accepted exact CI runner/build/test parity and 13 offline publication-gate/version tests. No installed application or existing service was changed. The mechanism is demonstrated; the original remote resolver stack was not captured, and the existing port allocation-to-bind window remains. Full exact-source CI (now including Intel Mac), the complete release matrix and asset/site verification remain gates for the fresh v0.1.24 publication.
