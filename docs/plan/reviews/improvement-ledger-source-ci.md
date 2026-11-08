# I02a ledger exact-source cloud checks

Date: 2026-11-08. Exact source: `66bd6f07ff9882e4cd12cd5492fdee5f0c8a6b1e` (ledger accepted/merged, before the qualified SDK merge). [Checks run 42437919764](https://github.com/ywateru/AnyWork/actions/runs/42437919764) is terminal **success**; all four actual jobs completed successfully. Root read the exact SHA/job status and downloaded the final logs. One intermediate status request failed with a TLS-handshake timeout; a read of the same run subsequently confirmed completion. No run was restarted or substituted.

| Actual job | Evidence and limits |
| --- | --- |
| `server-web` | Complete `scripts/check.sh`, early real-touch/sidebar and model-menu checks, formatting, bilingual site build/test passed. Complete browser suite: **611 passed / one existing skip**, 13.2 minutes. Linux source/HTTP/SQLite/fixture acceptance, not native account or physical Android acceptance. |
| `windows-native` | Actual locked release builds and selected server/desktop package tests passed: server **163 passed / 5 ignored**, desktop **15 / 1**, zero-test remaining targets. Schema ownership/recovery/migration cases actually ran. SDK package tests were not selected by this older workflow; the [coverage follow-up](../tasks/improvement-sdk-windows-check.md) requires fresh execution. |
| `android` | Actual Android build passed. No connected-device lifecycle/WireGuard/native-host acceptance follows from compilation. |
| `container` | Corresponding-source export, clean server-only image build and isolated container acceptance passed. This is an actual CI container job, not only the container-script unit fixtures. |

Local downloaded evidence is ignored `artifacts/ci-ledger-66bd6f0/{run.json,run.log}`. Exact earlier Darwin [merged ledger regression](improvement-message-ledger-merged.md) remains separately recorded. The prior `aacaa19` platform evidence is no longer the newest ledger proof, but remains valid for its own source.

This closes the fresh v2-source platform-check gate for I02a's scoped Store/schema module. It does not connect the ledger to current HTTP/native/Web sending, close I02/I03/I05/I07, accept the later SDK source or change the native support matrix. SDK `123cc1c` merged after this SHA and requires its own merged/source checks. No tag, Release, production restart, native prompt or website deployment was performed by these checks.
