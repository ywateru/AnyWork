# Independent desktop D3 reverification

- Reviewed exact commit: `361f695df81b122ecb691768ecdedc4a6c654872`.
- Prior reviews: [account-desktop-01.md](account-desktop-01.md) and [account-desktop-02.md](account-desktop-02.md).
- Reviewer: independent `verify_desktop`; date/platform: 2026-11-09, macOS arm64.
- Verdict: **PASS for desktop source and the recorded isolated integration scope. D1, D2 and D3 are closed.** No remaining blocking finding was identified in this correction. Native GUI/real OS credential-store end-to-end acceptance and production release remain pending; this pass does not close them.

## D3 correction

`persisted_cleanup_tokens` (`crates/desktop/src/accounts.rs:241`) reads both the saved grant and pending record before making a cleanup request. It validates every known record's endpoint, issuer and Native client against the current bound configuration, rejects empty refresh tokens and an empty saved subject, and fails before I/O on malformed/foreign records. A frontend-origin/resource change can prevent normal restoration without preventing cleanup under the same pinned issuer/client. Stored URLs are never used as alternate request targets.

The helper collects distinct known tokens. A known broker escrow is considered first; with an uncertainty marker a newer durable saved checkpoint is considered before the marker's last-known token. `logout:1093` revokes each collected token and reaches `clear_saved_grant:1097` only after all requests succeed. The grant-before-marker clearing order remains intact (`:301`). A failure preserves recovery records. The original persisted-only path therefore no longer deletes a known grant without revocation.

This is best-effort cleanup of **known** tokens. An uncertainty marker cannot reveal an unseen rotated token or prove that an unknown newer authorization was revoked; provider account/session revocation can still be needed. The updated desktop documentation states this limit. No runtime evidence in this review claims otherwise.

## Independent verification

Reran against this exact worktree/commit:

```sh
CARGO_INCREMENTAL=0 cargo test -p anywork-remote -p anywork-desktop --lib --tests
```

Results: desktop **50 passed, 0 failed, 4 ignored**, including **16 account tests**; remote **2 protocol + 4 gateway passed**. The four added cleanup tests call the actual private `Handle.logout` with isolated memory credentials, a preview manager and real loopback HTTP revocation endpoints. They cover persisted-only cleanup after `begin` rejects public-config mismatch, failure preserving saved/pending material, foreign issuer/client/endpoint rejection, and both a saved checkpoint and an uncertain last-known token. These test constructors do not alter production HTTPS validation or use OS Keychain/user services. The existing four ignored external/bundled/tunnel/update cases remain ignored. `git diff --check` also passed.

The independent temporary harness was refreshed from unchanged source slices of this exact candidate. It retains the actual `GrantOwner`, restoration/cleanup/index functions and `logout`/`revoke` orchestration, with minimal isolated state/credential-store context and a no-op disable because no remote exists. It reuses the worktree Cargo target. All **11** cases passed:

- The original D3 reproduction now receives one actual loopback revocation request before the saved grant is cleared.
- Two distinct known tokens are revoked and then both saved records are cleared.
- If the second revocation fails after the first succeeds, both original persistent records remain unchanged.
- A foreign pending-record client binding blocks before any request, including a request for an otherwise valid saved grant.
- Matching known tokens are deduplicated to one revocation request.
- The six prior independent D1/D2 checks still pass: original process-loss restore is blocked; preflight failure sends zero refresh requests; marker-clear failure blocks live/restart refresh; known nonrotating success restores safely; unknown parsed outcomes do not retry; Unicode aliases and sibling customData survive republish.

These are isolated deterministic failure models and loopback HTTP checks, not OS process-crash/Keychain fault injection. No tracked product files were changed by the reviewer.

## Remaining acceptance boundaries

The actual ES384 cloud JWT positive/negative evidence from review 01 still applies because the remote verifier source did not change. No new cloud token request was made during reviews 02/03. Synthetic SPA refresh-grant ownership remains with this reviewer until the orchestrator explicitly reassigns it. No credential/raw token was printed or committed.

The locked Mac prevents the separate real native UI/Keychain/full login → enable → Grid registration/index → browser discovery/business/real PTY → logout acceptance. No CUA manipulation or lock bypass was attempted. Linux runtime is unverified and Windows account flow remains outside the approved supported target due to the pinned upstream Unix SDK restriction. Production Logto subscription/payment and upstream CyberGrid distribution permission remain release gates. This source/isolated pass is suitable for merge and merged checks, not a claim that those pending product/release gates have passed.
