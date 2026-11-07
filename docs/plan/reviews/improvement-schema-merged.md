# I05a merged-source acceptance

Date: 2026-11-07. Independently accepted source `84774c2` and review `9fa5154` were merged at `d343d0d`. Schema HTTP registration `e2ba9d5` was then merged. The isolated integration source at `a41eec7332eede11a2ca6e2f925d03e5aabf8d5a` completed one full invocation:

```sh
PLAYWRIGHT_CHANNEL=chrome ANYWORK_E2E_PORT=3228 ./scripts/check.sh
```

Exit code **0**. Evidence is retained in ignored `artifacts/g1-schema-merged-check.log` within the integration worktree. No running production service/assets, installed native apps, real credentials or native tasks were involved.

## Actual merged results

- Desktop UI/server/Web builds, Rust format and workspace/all-target Clippy passed.
- Workspace tests: server **144 passed / 4 explicit native tests ignored**, desktop **34 passed / 4 ignored**, SDK **5 passed**, Codex **3 passed**; doc tests passed.
- Web unit tests: **31 files / 317 cases passed**.
- Registered real HTTP/integration checks passed, including schema **3** methods with twelve malformed-schema startup cases, I01 event scope **4**, conditional files **6**, desktop-host **20**, existing queue/edit/recovery/shared-host/goal/API scenarios and source/version/publisher/release-gate smoke scripts. Tests that print publishing actions use mocked transports.
- Full browser suite: **611 passed / one existing skip**, desktop plus Pixel Chromium emulation, **12.9 minutes**. Desktop updater UI passed in the same successful command with the Chrome setting inherited correctly.

The original B1 remains documented in the [independent review](improvement-schema-safety.md); this successful corrected-source run does not erase the first candidate's invalid acceptance/NULL-sequence failure.

## Acceptance boundary

I05a's implemented schema/ownership/startup-recovery module is accepted for this tested local source boundary and may unblock isolated ledger development. Version remains 0.1.12; no release/deployment/restart was performed. Full I05 backup/restore/retention, arbitrary DB/guard replacement, network filesystems and physical power-loss guarantees remain open.

New exact SHA `3d66212afbf662695c9d266802f8272f571f3366` ran [Checks](https://github.com/ywateru/AnyWork/actions/runs/42374272433). Container and Android passed. [Windows native tests](https://github.com/ywateru/AnyWork/actions/runs/42374272433/job/128408548261) also passed: server **122 / 4 ignored**, desktop **15 / 1 ignored**, including all **17 Windows-applicable schema tests**. They actually exercised same-process aliases, thread/process concurrent owner refusal, killed-owner release/real SQL rollback, interrupted DDL, loser preservation of SQLite locks, future refusal, sequences, metadata and I01 orphan/hidden-event boundaries on disposable Windows databases. The Unix-only private-sidecar permission test does not apply to the Windows reserved-byte implementation. This supplies bounded native Windows ownership evidence, not network filesystem, physical power loss or real Agent-account acceptance.

The overall run **failed**: server/Web stopped in the early short-mobile sidebar gesture test, whose helper accepted a one-pixel top remainder before asserting exact zero. It did not execute Linux schema tests/HTTP. The [test-only correction](../tasks/improvement-sidebar-boundary.md) requires independent review and a fresh full exact-source run. Earlier successful `83eda6c` Checks does not contain this schema change; neither it nor the successful Windows job turns this failed run into release authorization. Full native Linux schema acceptance remains pending.
