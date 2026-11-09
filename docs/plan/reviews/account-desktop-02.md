# Independent desktop D1/D2 reverification

- Reviewed exact commit: `7ebd201453fc81220eb827c636ca749adab0b69d`.
- Prior independent review: [account-desktop-01.md](account-desktop-01.md), committed as `972e3bb`.
- Reviewer: `verify_desktop`, independent of implementation; no tracked product changes.
- Date/platform: 2026-11-09, macOS arm64.
- Verdict: **D1 and D2 closed at the source/isolated integration boundary. Overall desktop candidate BLOCKED by D3 below.** Native GUI/real OS credential-store acceptance and production release remain separate pending gates.

## D1 — corrected and independently reverified

The native owner now writes an uncertainty marker before provider I/O. A failed preflight write sends no refresh request. Transport/parse/unknown response outcomes retain uncertainty, block another live refresh and block checkpoint recovery. A parsed response containing a known rotated grant retains the new token in RAM and permits checkpoint retry; the saved grant is written before the marker is cleared. Failure at either persistent write returns no access token. Startup rejects a persisted uncertainty marker even if its last-known refresh token happens to match the saved grant. This is the correct distinction between a known RAM rotation and an uncertain outcome after process loss.

The real `begin` path now calls the same `restore_grant` helper exercised in tests. `recover_checkpoint`, the snapshot and the remote watcher also reject uncertain owner state. The documentation accurately says that an old-token marker cannot reconstruct/revoke an unknown newer token and that provider session/grant revocation may be required.

The independent original failure reproduction was updated to use unchanged source slices from this exact candidate: it still seeds an old persisted grant, allows an actual loopback HTTP response to rotate it, fails the grant write, drops the RAM owner and then invokes the production restoration helper. Restoration now fails with the uncertainty marker retained; the old grant is not silently reusable. This is an isolated persistent-state/process-loss model, not an actual Keychain fault or OS crash.

## D2 — corrected and independently reverified

`update_device_index`/`device_record` preserve an existing valid alias and update the public key/Grid metadata. The valid-label boundary matches the browser contract: at most 80 UTF-16 units and no control characters. Other devices, AnyWork preferences and other customData namespaces remain unchanged. `publish_index` compares the complete customData readback, rather than checking only its own device record. Cross-client read/replace races remain explicitly outside the linear-consistency guarantee.

The independent temporary test uses the exact merge/record functions and verifies a renamed Unicode label survives, the public key/Grid ID change, sibling data/preferences/another namespace remain identical, and 40 versus 41 surrogate-pair emoji enforce the UTF-16 boundary. This establishes the source merge, not an actual GUI/cloud republish cycle.

## D3 — P2, blocking: persisted-only logout clears an unrevoked known grant

Locations: `crates/desktop/src/accounts.rs:419` (startup owner is None), `:465` (restoration is deferred to begin), `:1029`–`:1044` (logout fallback and unconditional clear). Contract: `docs/account-desktop.md:5` and `:7`, plus the native ownership/revocation requirements in `docs/account-device-cloud-review.md:204`–`:206`.

The correction makes `logout` call `clear_saved_grant` unconditionally. With no RAM owner, no transaction and an empty `PENDING_KEY`, the preceding branches never read or revoke `GRANT_KEY`. Logout therefore returns success and deletes a known saved refresh grant without sending a revocation request. A fresh Handle has exactly this memory state until `begin` restores the grant. A public configuration change that retains the same issuer/native-client/support namespace but changes another config field can also make `begin` reject restoration, leave no RAM owner, and expose the UI's error/logout action while the saved grant remains present.

A deterministic independent external harness copied this candidate's exact `logout` and `revoke` orchestration. It supplied an isolated state/secret store, a no-op disable (there is no remote), and a real loopback revocation endpoint that counts requests. Starting with a saved grant and no RAM owner/transaction/pending record, `logout()` returned Ok, the saved grant became empty and the endpoint received **zero** revocation requests. The test passes as a reproduction of the defect. It does not use a real user grant or OS Keychain.

Load and validate the persisted known grant for cleanup when RAM/transaction/pending ownership is absent, revoke it before clearing it, and preserve recovery material on revocation failure. Configuration mismatch must not silently turn revocation into deletion; use the safely bound saved issuer/client or fail explicitly. Keep the corrected grant-before-marker clearing order. Cover persisted-only success, persisted-only revocation failure, and public-config mismatch recovery.

## Independent checks and limits

Ran in the reviewed worktree:

```sh
CARGO_INCREMENTAL=0 cargo test -p anywork-remote -p anywork-desktop --lib --tests
```

Result: desktop **46 passed, 4 ignored**, including all 12 account cases; remote **2 protocol + 4 gateway passed**. The ignored external/bundled/tunnel/update cases were not silently counted as passing.

An additional external temporary harness reused the worktree build target and exact source slices. Six independent correction checks passed: original crash-loss restoration is blocked; preflight failure makes zero provider requests; marker-clear failure blocks live/restart refresh; a known successful nonrotating response can restore the same grant; an unknown parsed response never retries; alias republish preserves sibling data and the Unicode size boundary. A seventh test deterministically reproduces D3 as described above. No tracked product files were edited for these tests.

The actual ES384 JWT positive/negative results from review 01 remain applicable because no remote verifier source changed. No new cloud token request or rotation was necessary for this reverification; the reviewer retains exclusive ownership of the synthetic SPA refresh grant unless the orchestrator reassigns it. No credentials or raw tokens were printed/committed.

Native UI, real Keychain write/restore/failure, native login/commit/enable, Grid registration/discovery, business API/real PTY cleanup and logout remain pending the manually unlocked isolated end-to-end run. The Mac lock was not bypassed and CUA was not manipulated. The production subscription/payment and upstream distribution-license gates also remain open. These source/fixture results do not constitute approval to publish production account remote access.
