# Follow-up findings from prioritized improvement reviews

The [30-issue review](../project-improvement-review.md) and [progress tracker](improvement-progress.md) retain the complete goal. This file records review follow-ups; it is not a replacement or a smaller completion definition.

| Finding | Owner / status | Authoritative contract or evidence |
| --- | --- | --- |
| SDK A N1: injectable clock is not part of the delivered SDK API | Lifecycle B must provide the injectable monotonic native-observation clock and five-second expiry tests; SDK explicit deadlines already implemented. Open for B, not a blocking defect in dormant A. | [Exact SDK review](reviews/improvement-runtime-transport.md), [lifecycle delivery table](../runtime-lifecycle.md#delivery-modules-and-complete-connected-gate) |
| Proof research N1: Harness acceptance is visible in the live inbox/log before asynchronous persistence | Clarification incorporated in analysis; no new receipt type or durability guarantee accepted. Closed as documentation follow-up. | [Exact proof review](reviews/improvement-delivery-proofs.md), [analysis §7](analysis/delivery-proofs.md#7-deepseek-harness) |
| I21: actual moderate `glib` advisory `GHSA-wrw7-89jp-8q8g` | Dependency reachability and compatible remediation remain open under I21. No upgrade or exposure conclusion yet. | [Continuing evidence](improvement-progress.md#accepted-sdk-and-proof-research--2026-11-08) |
| Windows SDK tests were not selected by the existing native job | Narrow [CI integration task](tasks/improvement-sdk-windows-check.md) in progress; only actual fresh Windows test logs can close execution coverage. | [SDK module review](reviews/improvement-runtime-transport.md), `.github/workflows/ci.yml` |
