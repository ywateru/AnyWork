# Prioritized improvement progress

Goal: implement improvements in the priority order of [the review](../project-improvement-review.md). User authorized continued work on 2026-11-07. Review baseline is immutable historical evidence; this tracker records later implementation/verification so old findings are not silently rewritten.

| Stage | Issues | Current state / next evidence |
| --- | --- | --- |
| G0 | I01/I04/I20/I22/I25 | [Contract and tasks](tasks/improvement-g0.md), accepted source passed [merged local checks](reviews/improvement-g0-merged.md) and actual Linux x64 container job; full exact-source Checks still in progress |
| G1 | I02/I03/I05/I07/I08/I09/I10, critical I11/I12 | Pending after foundational contracts; maintain full scope |
| G2 | I13—I19, critical I28 | Pending; real native/Android/network evidence remains required |
| G3 | I06/I21/I23/I24/I26/I27/I29 | Pending; capacity baselines before optimization |
| G4 | I30 selected extensions | Product choices after core reliability; do not implement fake capabilities |

No stage is complete based only on documentation or fixture results when its contract requires real platform/upstream acceptance. No version bump, publication or production restart is part of the current isolated implementation work.

## Review snapshot — 2026-11-07

The current user-facing deliverable is the complete project review document. Existing implementation candidates remain isolated; no source candidate is merged or treated as an accepted fix by that document. The support/documentation consolidation is committed as `6bbaa75`; it does not change runtime capabilities.

| Candidate | Commit / location | Developer-reported evidence | Still required |
| --- | --- | --- | --- |
| I01 event scope | `cda8452` / `codex/improve-event-scope` | Server unit tests, 4 isolated HTTP cases, 8 Web cursor cases, type/lint/format checks | Independent source review, merged regression and check-pipeline registration; legacy SSE clients may rescan hidden tails on reconnect |
| I04 file consistency | `9f3a107` / `codex/improve-file-consistency` | Isolated compile/build, 8 filesystem semantics/concurrency/fault cases, Web type/format checks | Independent review; real HTTP/JSON contract and browser/late-response scenarios; cross-platform durability and external-writer limitations remain explicit |
| I20/I22 delivery gates | `511ae21` / `codex/improve-delivery-gates` | 8 mocked exact-SHA gate cases, 2 smoke-script cases, 4 source-archive cases; workflow YAML/Python checks; container CI added in candidate | Independent review, real Actions boundary integration and actual clean image build/runtime evidence; local Docker daemon unavailable; pinned Codex is not a native model/desktop-sharing acceptance result |

Counts above describe developer reports for those exact candidates, not independent acceptance or new mainline results. Full details stay in each candidate's module documentation until review and integration.

Independent documentation review of `6bbaa75` passed without blocking findings: 30 issue IDs, 11 decision IDs and 212 local links checked, with targeted source/evidence cross-checks. This is acceptance of the review material, not of the three source candidates. The non-blocking wording clarification about still-ungated legacy release paths was applied to `docs/updates.md`.

## Continuing delivery — 2026-11-07

- **I01 accepted and merged** at `463cb29`, following independent exact-candidate review `b9bde38`. Merged-source checks in `.worktrees/improve-g0-merged`: server 118 passed / 4 explicit native tests ignored; real isolated event HTTP 4 passed; Web typecheck and all 317 unit tests passed. No production rebuild/restart. Current SSE reconnect may re-scan hidden tail rows; the scan is bounded and reveals no hidden payload. The module and API documents record that limitation.
- **I04 source accepted and merged**: the initial review reproduced two successful writes through differently cased aliases of one macOS file. Fix `629992a` uses process-wide write serialization, validates runtime save/read revisions and `ok:true`, separates the toolbar, and tests post-publication sync uncertainty. Independent re-review `09daf58` passed 9 Rust / 6 HTTP / 18 browser cases, plus 24 additional 1 MiB alias races with one successful writer and one conflict each; source was merged at `1fab5f8`. Global serialization is a deliberate conservative throughput tradeoff. Merged local checks passed as recorded below; other-platform and arbitrary external-writer limitations remain explicit.
- **I20/I22 source accepted and merged**: independent review `170480b` found missing remote tag→authorized commit binding and incomplete container Web identity verification. Fix `5e41034` passed re-review `ae9ff24` and was merged with two negative regressions, robust partial-resource cleanup and bounded build diagnostics. The actual Docker job subsequently passed at exact SHA `83eda6c`; live Actions publication remains unexercised and no new release was triggered. Full Checks is still in progress at that source.
- **G1 schema source accepted; merged verification pending**: [schema safety task](tasks/improvement-schema-safety.md) defines the dependency before adding durable operations. Contract review clarified single-service ownership, future-version application-write refusal, atomic recovery and schema constraint validation. Actual Darwin testing rejected an unsafe database-file flock assumption; the implementation uses a private sidecar guard on Unix. Corrected schema source passed independent re-review as detailed below. Full backup/restore, I02 and I03 remain open.

### Current integration gates

- The full merged check first stopped at an obsolete exact-response assertion in `desktop-host-http-test.py`: the intentional global poll contract now includes `has_more`. Test-only correction `fc3d148` retains the prior event/cursor/authentication assertions and checks all three response fields explicitly. The developer ran all 20 isolated desktop-host HTTP cases successfully; a different verifier independently passed the poll/authentication and SSE replay cases. The correction is merged. The separately executed remaining tail passed 611 browser cases / one existing skip and all registered Python checks. The updater needed a targeted rerun with local Chrome selected, which passed. Rust server 126 / desktop 34 / SDK 5 / Codex 3 and Web 317 unit tests, format and bilingual site checks passed; [merged evidence](reviews/improvement-g0-merged.md) preserves the original failure and exact rerun boundaries. Actual Docker/CI/platform evidence remains separate.
- The first I05a schema candidate `fc2b9aa` was blocked: independent verification reproduced SQL token-boundary collisions and NULL event sequences during recovery. Correction `84774c2` preserves SQL lexical boundaries and compares SQLite structural metadata. Independent re-review `9fa5154` passed 18 schema tests, 3 HTTP methods (including 12 startup negatives), 4 I01 cases and 20 additional production-Store negatives plus ownership/crash/sequence checks. The corrected source/review is merged at `d343d0d`; merged regression is next. Native Windows/Linux lock execution and full I05 remain open.
- I02/I03 call-path analysis identified both main and child composers, queue admission/worker and WorkBuddy's restart-lost native/client mapping as connected boundaries. The [operation contract](../message-operations.md) and pending [ledger](tasks/improvement-message-ledger.md) / [delivery integration](tasks/improvement-message-delivery.md) tasks define the next dependency chain after accepted I05a. Independent contract review found ledger-generation/404 and preparation-claim gaps; `53354fc` corrected both and recheck found no further blocking findings. Stable store/incarnation binding, retained used-ID tombstones and separate preparation uncertainty are required alongside mandatory IDs, write-ahead transitions and immutable submitted drafts/artifacts. These contracts do not advertise implemented support.

The broader objective remains active through G1—G4; G0 progress does not close the full project improvement goal.
