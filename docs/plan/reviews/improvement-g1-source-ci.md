# G1 source CI acceptance: schema, capability projection and sidebar helper

Source: `aacaa19b98314976b34e91f11c12326c6ad6ad7c`. Date: 2026-11-07. [Checks run 42376388458](https://github.com/ywateru/AnyWork/actions/runs/42376388458): **all four jobs passed**. This is a fresh exact-source run after the preserved failure at `3d66212`; it is not a rerun reclassified as success.

| Job | Actual evidence |
| --- | --- |
| [Server/Web 128414728393](https://github.com/ywateru/AnyWork/actions/runs/42376388458/job/128414728393) | Early 42 browser cases passed, then the complete `scripts/check.sh`, formatting and bilingual site checks passed. Linux server 151 passed / 4 explicitly ignored, including all 18 schema tests; desktop 34 passed / 3 ignored. Web 317 unit tests and 611 full-suite browser cases passed / one existing Android skip (the desktop reference-viewport case). Registered schema-recovery, event-scope and capability-projection HTTP suites completed successfully. |
| [Windows 128414728430](https://github.com/ywateru/AnyWork/actions/runs/42376388458/job/128414728430) | Server 129 passed / 4 ignored; desktop 15 passed / 1 ignored. All 17 applicable schema tests passed, including actual child-process/thread ownership refusal, kill/release, DDL/process rollback, aliases, future-schema refusal, lexical/structural validation, preserved SQLite locks and I01 legacy boundaries. |
| [Container 128414728192](https://github.com/ywateru/AnyWork/actions/runs/42376388458/job/128414728192) | Actual clean Linux container build/runtime gate passed: non-root, authentication, source-bound Web/full digest validation and persisted data. It includes this source's I05a and I07a changes, unlike the earlier `83eda6c` result. |
| [Android 128414728381](https://github.com/ywateru/AnyWork/actions/runs/42376388458/job/128414728381) | Configured SDK 36 build/lint/unit gate passed. This is not physical Android, VPN/Doze or native background-notification acceptance. |

Codex unit tests passed 5; SDK bridge tests passed 3 (SDK library itself has no unit cases). Registered Python suites all completed successfully: catalog 2, capabilities 6, integration 25, event scope 4, schema recovery 3, file consistency 6 (4 passed / 2 filesystem-dependent alias cases skipped on Linux), service control 1, shared history 1, WorkBuddy launcher 15, editing 14, discovery 9, shared control 10, desktop bridge 6, desktop IPC 11, desktop-host HTTP 20, goal editor 3, goal mode 6, review 13, source archive 4, release version 3, publisher 26, release CI 10 and container smoke script 7. The updater UI check passed quiet download, failure/deferral, preferences, confirmation, stale-version refusal and explicit install scenarios. Earlier macOS file tests actually exercised both alias cases; a Linux skip is not their acceptance.

Reporting correction: the prior local G0/schema/capability summaries transposed the SDK and Codex package labels. Inspection of the original log headings confirms **Codex 5 / SDK bridge 3**; those labels are corrected in the records, with all totals, source SHAs, original failures and execution boundaries preserved. No new test execution is implied by this clerical correction.

The root also ran the actual read-only trusted-release gate with `--sha aacaa19b98314976b34e91f11c12326c6ad6ad7c --timeout 30`. It exited 0 and selected this run as `Authorized exact-source Checks`. There was no tag argument, tag creation, release, deployment or production/native-account action.

## What this closes

- I05a's missing native Linux evidence is now present. macOS local checks and actual Windows evidence remain in their respective historical records. This does not complete backup/restore/retention or full I05.
- I07a's additive read-only source and registered HTTP check now have full-source CI evidence. Native observations, Web consumption, typed errors and complete I07 remain open.
- The test-only sidebar helper correction has both independent focused execution and a fresh successful cloud run. Strict top-zero, real input and containment assertions remain; this does not establish physical-device behavior.

The failed `3d66212` run, exact one-pixel helper inconsistency and [independent correction review](improvement-sidebar-boundary.md) remain recorded. No unsupported native model, WorkBuddy writing, installation/upgrade or real-device claim follows from deterministic fixtures, emulation or CI success. Later source requires its own exact-source Checks; the subsequent document commits are not silently assigned this SHA's result.
