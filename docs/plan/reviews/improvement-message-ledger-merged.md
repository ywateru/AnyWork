# I02a merged regression

Date: 2026-11-08. Exact tested merge: `a26d6f437b8296649d346cac04626f69e7777af8`, including ledger source `8d579347831ee5c17cf2561e14ef95efd17c9ae9` and independent re-review `c3117a8f4f93ba5319dd1e05bcd413caa4005aaf`. **Result: PASS for the scoped I02a Store/schema module and merged local regression.** The first candidate's three failures remain in the [independent review](improvement-message-ledger.md); their correction is not relabelled as an initial pass.

## Actual execution

Root created isolated `codex/improve-ledger-merged` at this merge and ran one complete invocation, exit 0:

```sh
CARGO_INCREMENTAL=0 \
CARGO_TARGET_DIR=/Users/water/work/2026/any-work/.worktrees/improve-message-ledger/target \
PLAYWRIGHT_CHANNEL=chrome ANYWORK_E2E_PORT=3239 \
bash scripts/check.sh
```

The private integration tree links its `target` to the now-idle private ledger cache and its Node dependencies to existing root dependencies. Builds write only the private target and private UI/Web output. Production `target/release`, `web/dist`, `.anywork`, installed apps and actual native sessions are separate. Test processes/data/ports are disposable fixtures. The reviewer had restored exact source and finished before cache reuse began.

The same tree subsequently passed `npm run format:check`, `python3 scripts/build-site.py` and `PLAYWRIGHT_CHANNEL=chrome node scripts/site-test.mjs` (combined extras exit 0). Website checks include both languages at 1440/1024/768/390/320 widths, language negotiation/manual preference, stale metadata ordering and DMG preference/ZIP fallback. They build/test local assets without deploying the public site.

Local evidence: `.worktrees/improve-ledger-merged/artifacts/ledger-merged/{check.log,check.exit,format.log,site-build.log,site-test.log,extras.exit}`; browser results/screenshots are in that tree's ignored `test-results` and `artifacts`. These paths are reproducible local evidence, not public release artifacts.

## Results and scope

| Boundary | Actual result |
| --- | --- |
| Rust format, workspace Clippy/all targets, tests and build | Passed. Server **185 passed / 5 ignored**, desktop **34 / 4**, Codex **5**, SDK bridge **3**. Other unit/doc-test targets have no tests. The server count includes I07a's seven tests absent from the isolated ledger candidate's 178-test baseline. |
| Web | Type/build and **317 unit tests** passed. Private desktop UI build passed too. |
| Catalog / advisory capabilities / integration / events / schema HTTP | **2 / 6 / 25 / 4 / 3** passed. Schema script includes actual startup/ownership/crash and invalid/future-schema negatives. |
| Files / service control / shared history / WorkBuddy launcher | **6 / 1 / 1 / 15** passed. Both case-equivalent and Unicode-equivalent alias cases actually ran on this Darwin filesystem. |
| Editing / discovery / shared control / desktop bridge / desktop IPC / desktop HTTP | **14 / 9 / 10 / 6 / 11 / 20** passed. These remain existing connected protocol compatibility checks, not a new operation HTTP protocol. |
| Goal editor / goal mode / review | **3 / 6 / 13** passed. |
| Source archive / release version / publisher / release CI / container script | **4 / 3 / 26 / 10 / 7** passed. Container script tests are fixtures; an actual clean image is a separate cloud gate. |
| Desktop/Pixel browser suite | **611 passed / 1 existing skip**, 11.9 minutes. Skip: Android `conversation.spec.ts:129`, the desktop reference viewport's combined header. No case was forced or weakened. |
| Desktop updater UI | Passed quiet download/failure, deferral, preferences, confirmation, stale-version rejection and explicit install fixtures. No actual installed app was updated. |

The server's ignored count includes the internal crash-child entry exercised by parent tests; native/profile opt-ins were not enabled. These results are source/fixture evidence, not real native-account, physical power-loss or Android-device acceptance.

## Remaining gates

New v2 source still requires fresh exact-source Linux/Windows/Android/container Checks. Earlier `aacaa19` CI proves the pre-ledger source only. A task-module pass does not implement first-party HTTP IDs, the Web journal, immutable file snapshots/ACL enforcement, actual native acceptance proof, native idempotency or all-entry-point recording fences. Those remain I02b and coordinated lifecycle B/C work. Full I03 health/approval/reconciliation and I05 backup/restore remain open.

The SDK qualified transport candidate `123cc1c` and acceptance-proof research `a21f793` are under separate independent reviews; neither is part of this tested merge. No version bump, tag, Release, production restart, native prompt or public-site update was performed by this local acceptance.
