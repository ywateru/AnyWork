# Prioritized improvement progress

Goal: implement improvements in the priority order of [the review](../project-improvement-review.md). User authorized continued work on 2026-11-07. Review baseline is immutable historical evidence; this tracker records later implementation/verification so old findings are not silently rewritten.

| Stage | Issues | Current state / next evidence |
| --- | --- | --- |
| G0 | I01/I04/I20/I22/I25 | [Contract and tasks](tasks/improvement-g0.md), in progress; independent verification required |
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
