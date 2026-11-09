# Independent account cloud re-review 02

Reviewed exact fix candidate: `01b927f0db0a7e6e680a618a693827997831ff5d`. Previous review: [account-cloud-01](account-cloud-01.md). Reviewer is separate from the author; this commit changes the review only.

## Findings resolved

C1 is resolved. The actual Release callsite now dispatches `vercel.yml`; Pages retains only explicit manual recovery. Independently checked the workflow source and ran the new actual-workflow-text regression. Python publisher selection alone is no longer the sole coverage for this call chain.

C2 is resolved for the documented process-interruption/retry contract. A durable operation UUID and immutable project/source/namespace/configuration digest precede environment/deployment mutations. Same-operation replay observes an existing deployment without creating another. Unknown POST outcomes reconcile bounded, paginated inventory by operation/configuration/source metadata and then verify the specific deployment's project/source/metadata/state. Missing, ambiguous, conflicting or unknown results fail closed without another POST. The submitting phase is persisted before POST, so even a crash immediately before the request requires explicit reconciliation rather than guessing that submission did not happen.

A deliberate new deployment requires a stable explicit UUID, first observes the preceding operation and rejects unresolved/in-progress operations. Repeating the same UUID reuses its result. Changed configuration/credentials fail ordinary replay and require a separate explicit operation after previous outcome reconciliation. Legacy adoption requires saved source/environment provenance and deployment ID, then verifies remote project/source; missing provenance fails instead of inferring identity from current arguments. Operation/configuration metadata contains a SHA-256 digest rather than plaintext credentials. Actual external deployment remains asynchronous; observing QUEUED/BUILDING records submission/in-progress state and does not establish a healthy service.

C3 is resolved: prefix validation now matches the pinned upstream 1–80 character grammar before provider access. The 80/81 boundary regression passed independently.

C4 is resolved: ordinary publication documentation consistently describes Vercel; Pages-specific setup and dispatch instructions appear under explicit legacy manual recovery. The compatibility `--pages-only` alias correctly remains a Vercel repair operation.

No new blocking or non-blocking finding was established in the corrective diff.

## Independently executed evidence

- `python3 scripts/cloud/test_deploy.py`:18 tests passed. Actual CLI main is executed against private temporary state and a recording fake provider. Independently inspected test/provider assertions that read persisted disk state before mutations. Coverage includes successful/in-progress replay, lost POST response, failure saving the response, failure saving initial intent, interruption after submitting intent but before HTTP, changed namespace/credential identity, missing/ambiguous/conflicting inventory, later inventory pages, wrong project/source/metadata, stable UUID redeployment, previous in-progress rejection, failed deployment requiring explicit new operation, legacy provenance and80/81 prefix bounds, plus the real Release workflow callsite.
- `python3 scripts/cloud/test_configure.py`:7 tests passed.
- `python3 scripts/publish-test.py`:28 tests passed. Immutable release/tag behavior, interruption recovery, failure handling, Vercel selection and exact-source website identity remain covered. Printed fixture publication messages do not describe real publication.
- Additional real **read-only** provider check: ran the committed `observe` function against the existing dedicated DEV deployment using a legacy observation intent held only in memory. Official Vercel metadata matched the expected project and pinned source; status was READY. No private state was changed, environment upsert/deployment POST was impossible in the test wrapper, and no response secrets were printed. This corroborates the provider response fields used by legacy observation; it is not a real unknown-outcome/redeployment mutation test.
- Earlier independently executed11-check actual Upstash REST evidence in review01 remains applicable: this correction changes only provisioning/recovery/workflow/docs, with no change to pinned coordinator runtime/SDK or Redis settings. No repeated storage mutation was necessary for this corrective scope.

## Acceptance boundary

**pass — cloud source and isolated recovery tests** for exact candidate `01b927f0db0a7e6e680a618a693827997831ff5d`; C1–C4 are closed.

This does not approve production activation or publication. No real deployment, plan upgrade, paid API, new resource, namespace reset or OAuth refresh was executed during this re-review. Process-interruption/unknown-response behavior was exercised against an offline provider; production recovery is not claimed to have been failure-injected at Vercel. The existing DEV service's observed READY metadata is distinct from the full AnyWork business lifecycle.

Production Logto resource/role entitlement and56USD/month base prerequisite, CyberGrid distribution permission, actual new-user registration/email/default-role acceptance, supported native device grant/discovery/disable, phone/cellular testing and the merged exact-source release gate remain separate pending release/system gates. Shared grants were not refreshed or loaded during this re-review.
