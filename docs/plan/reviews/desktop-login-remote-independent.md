# Desktop remote enable: independent review

Reviewed product sequence `e711a7c` → `9704b1d` → `1f4db0ff14bdbf50532a1fc06b3d854d96d7ef05` in an independent checkout at the final product commit. Result: no blocking finding in these three changes. The reproduced defects are acceptable to merge with the limitations below; this does **not** close the reported requirement to log into Web before desktop remote enable succeeds.

## Findings and safety boundaries

### SDK refresh contract

`crates/desktop/src/accounts.rs`, `GridAuthorization::current` and `GridAuthorization::token`: removing the equality between `force_refresh` and `AuthorizationRejected` matches pinned CyberGrid `f2a3961536e5c69b13c7dbc661953d9243becbae`. In `sdk-rust/src/client.rs`, `exchange_pending` calls `provider_token(config, reason, fresh || natural_expiry)`, so a recovery request can legitimately force refresh for another reason. The desktop provider has no access-token cache and refreshes through the sole RAM grant owner on every request.

SDK-instance identity, SDK generation, cancellation, minimum validity, issuer/client/resource, complete scope set, retired-provider and host-intent checks remain. Rotation completes under the same owner and is recorded before stale-result rejection. This fixes a recovery defect; a fresh initial Connect request with `force_refresh=false` does not trigger the removed condition.

### Preflight diagnostics

`accounts.rs::safe_error` now maps known preflight failures to fixed `REMOTE_ENABLE_*` values already supported by the account UI's exact-code handling. The UI includes distinct reauthorization guidance and does not render arbitrary underlying provider errors. The actual Tauri handler test verifies JSON String rejection payloads for eight conditions and checks that the attempted enable adds no token requests, registrations or account-directory writes in those cases.

This makes a future report actionable. An error-code improvement alone does not explain a past generic message.

### Workspace preparation ordering

`crates/desktop/src/manager.rs`, `Worker::prepare_workspace`: the new `reset_probe()` runs only after successful authenticated `/api/info` validation and the required local-browser capability. It advances the existing generation, aborts an in-flight old poll and makes an already-queued old `Event::Probe` fail the generation check. Setting `last_probe` to now schedules the next check at the normal interval. The actor processes these operations serially; the change does not exempt future probes from clearing readiness.

The new regression uses real loopback HTTP to obtain an older failed probe, successfully prepares the workspace, then delivers that old event. It subsequently exercises the real account-enable path, owned synthetic provider, pinned Native SDK registration and account-index write. A fresh failed probe still clears authorization/readiness, and an older successful result cannot authorize a newly configured host. Existing unsuccessful preparation cases continue to assert that authorization is absent.

This is a concrete readiness race for reuse of an existing service or another preparation. Starting a new owned service already reset probes, so the new fix must not be described as affecting every first startup. No Web login or console bootstrap is involved in this local ordering fix.

## Independent validation

Only the exact final product checkout was used for the following results. Existing built desktop assets were linked for Tauri embedding; no UI source was modified, and this link is not independent validation of the author's UI build. Cargo used the coordinated shared target with `CARGO_INCREMENTAL=0`, `CARGO_PROFILE_DEV_DEBUG=0`, `CARGO_PROFILE_TEST_DEBUG=0`, `CARGO_BUILD_JOBS=2`, `--offline --locked`.

Each command used `cargo test --offline --locked -p anywork-desktop --lib <filter>`:

| Filter | Independent result |
| --- | --- |
| `workspace_preparation_fences_older_probe_results_before_remote_enable` | 1 passed; 0 failed |
| `enable_preflight_failures_cross_real_ipc_as_exact_codes_without_new_registration` | 1 passed; 0 failed; eight IPC conditions |
| `provider_` | 7 passed; 0 failed |
| `default_once_manual_off_explicit_retry_and_new_grant` | 1 passed; 0 failed |

The provider filter includes rotation/freshness, invalid bindings, cancellation, remaining lifetime and stale-result handling. The additional default-once test checks manual-off, explicit retry and replacement-grant behavior. Total for this final independent run: 10 tests passed, none failed. The author separately reports the old-source red reproduction, full library suite, strict clippy and UI/browser checks; these are not presented as independently rerun here.

## Open original-failure boundary

The enable fixtures begin with a synthetic authorized grant owner. They do not prove real first OAuth login → commit → remote enable against production. No real credentials, account stores, user sessions, device operations, online authorization or native app interaction were used by this reviewer. All grant rotations, registrations and writes in these tests target isolated fixtures.

The user's original desktop failure has no captured contemporaneous fixed stage code. Configuration transport, network/proxy differences and the actual preflight state at that moment remain unproven. These changes fix independently established defects and preserve subsequent diagnostics; release and task wording must retain that distinction.

The separately reported phone screenshot was identified as `web/src/AccountApp.tsx`, also used by an older Android Custom Tab launcher. It is not evidence for a bundled Native Android refresh failure. Phone Web console presence is a separate review lane and is not closed by these desktop changes or the Native Android expiry correction.
