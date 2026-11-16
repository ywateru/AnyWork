# Mobile authorization boundary

This internal Tauri plugin has no guest commands or guest permissions. Only Rust
calls `run_mobile_plugin_async`. Business JavaScript receives the account module's
redacted snapshot, never these native profile/access-grant DTOs.

The sole OAuth/refresh owner remains official `io.logto.sdk:android:2.0.3`.
Its ordinary SharedPreferences persistence stays disabled (`usingPersistStorage=false`).
A process-owned subclass exposes only the protected refresh/ID fields to an internal
Keystore adapter; these values never cross JNI or guest IPC. Access-token caches,
Noise keys, registration keys and account contents are not persisted. No historical
credential record or legacy SDK storage is read.

## Saved login and lifecycle

The current contract is [login-session-persistence](../../docs/login-session-persistence.md).
`GrantStore` schema v1 binds endpoint, issuer, Native client, resource, grid URL, host product, callback,
and exact scope set, plus the previously validated subject inside authenticated
ciphertext. `AndroidGrantBytes` uses an Android Keystore non-exportable AES key and
AES-GCM (random 96-bit IV, binding in AAD), with a 0600 file under `noBackupFilesDir`.
Writes fsync the temporary file, atomically replace the current record, and fsync
its directory; failures propagate. SDK plaintext SharedPreferences stays off.

The process, not a host Activity, owns the SDK/mutex. Ordinary Activity destruction
preserves a completed login and lets already dispatched rotation settle. Only that
Activity's unfinished interactive authorization is cancelled. Cold configure returns
`restoring` immediately and schedules a process-owned restore under the same SDK
mutex. Snapshot polling remains responsive; public `mobile_account_refresh` starts
one retry from `restoreRetryable`, without opening SSO. The restore loads only this
new schema and forces an SDK access-token request from refresh grant. No saved access token is needed. SDK refresh verifies a returned
ID token through its existing JWKS/signature/issuer/audience path; the adapter also
checks fixed issuer/client and same subject, including UserInfo when available.
When the token endpoint omits a new ID token, the fresh refresh establishes current
authorization while identity retains the integrity-protected previously verified
binding. This does not freshly verify the old ID signature or expiry. Only a pure
UserInfo GET failure allows this fallback/warning; nested refresh/JWKS/ID failures
and a changed subject fail closed. An ID token loaded from encrypted storage is not by itself a signed-in session.

Each SDK operation installs a `RefreshJournal` lease. Before a refresh request is
enqueued the old grant becomes durably `pending`. An actual OkHttp per-call
`requestHeadersStart` event conservatively marks possible transmission. Only a
failure before that event may roll back to ready; exceptions/timeouts are not
classified by their names. Response loss, invalid_grant, SDK validation failure,
process death or an interrupted commit never authorizes reuse of old pending grant.
A successful SDK response and same-subject check must be saved before native ACK.
A new subject cannot replace the saved subject. A stale store generation rejects
both late commits and late no-send rollbacks. A monotonic 90-second network budget
spans all SDK GET/POST calls in that operation; each call, including body read, gets
at most 60 seconds or the remaining budget. Exhaustion fails before the next enqueue.
No coroutine timeout releases the lock while a previously sent rotation can still
complete. Tauri 2.12.5 async JNI and the public JS bridge impose no separate timeout;
dropping a caller does not cancel the process-owned operation.

`restoreRetryable` has no usable account/targets and retries via native `restore`
without opening SSO. Pre-send network failures and temporarily unavailable storage
retain the recoverable record. Invalid/corrupt/binding-mismatched or interrupted
pending records require reauthentication. Explicit logout immediately fences both
runtime and store generation, writes a durable loggedOut record (or cryptographically
erases the key/file if writing fails), then waits for serial SDK revoke/cleanup.
If tombstone, key deletion and ciphertext deletion all fail, native reports
`reauthRequired`/`MOBILE_AUTH_CLEAR_REQUIRED` and only retrying clear is allowed.
Rust retires runtime access immediately but reports `signedOut` only after native
confirms durable clearing. A logout arriving before configure erases the new schema
without reading it and also fences any later initial restore. Storage/revocation
failures are explicit; a late refresh cannot resurrect a record.
SSO cookies are separate from the saved application grant and are cleared on logout.
The pre-login source dialog describes saved login and system Back cancellation;
the full-screen SDK Activity still has no promised source bar.

The callback is the existing desktop Native constant
`http://127.0.0.1:17897/callback` (`crates/desktop/src/accounts.rs`). The official SDK
intercepts the exact scheme/authority/path in WebView navigation and verifies
callback state/PKCE; Android does not bind a listener or install an intent filter
for this callback. This is reuse of existing product configuration, not a newly
invented redirect URI or a claim of successful production login. A deployment
rejecting that registered Native callback is a real login failure, not bypassed.

One native operation spans the SDK callback and destruction of all its login
Activities. Interactive cancellation fences generation immediately, finishes only those
Activities, and waits for the operation to settle before logout completes. A
manifest ContentProvider installs public Android lifecycle callbacks before any
restored Activity: an SDK login restored without an in-memory attempt is closed.
No reflection or SDK private manager access is used. This matters because SDK
2.0.3's `onDestroy` cancels its process-global current authorization session.

## Explicit SDK transport policy

The original SDK core's default OkHttp can resend form POSTs after recoverable
I/O or HTTP follow-ups. Under contract `7b10e1f`, the Android UI AAR stays original
and its transitive JVM core is replaced by complete same-version pinned source
in [android/logto-core](android/logto-core/README.md). The public HTTP-only patch
disables connection retries and redirects, bounds timeouts, and marks POST bodies
one-shot. The latter also blocks 503 Retry-After 0 and 421 follow-ups that a retry
flag alone cannot cover. All OAuth/PKCE/state/ID-token logic remains upstream.
The native mutex and final-error fence still retire an unknown rotating owner.
Source hashes, upstream license, exact diff and single-attempt fixtures are included.
This does not claim a successful real-account refresh-loss experiment.

Source: [Logto HTTP implementation](https://github.com/logto-io/kotlin/blob/3efc22a59ecd9f020bf6af58bd47d6a4f292b140/kotlin-sdk/kotlin/src/main/kotlin/io/logto/sdk/core/http/HttpRequest.kt),
[Logto Core form requests](https://github.com/logto-io/kotlin/blob/3efc22a59ecd9f020bf6af58bd47d6a4f292b140/kotlin-sdk/kotlin/src/main/kotlin/io/logto/sdk/core/Core.kt),
[pinned dependencies](https://github.com/logto-io/kotlin/blob/3efc22a59ecd9f020bf6af58bd47d6a4f292b140/gradle/libs.versions.toml),
[OkHttp retry interceptor](https://github.com/square/okhttp/blob/parent-4.11.0/okhttp/src/main/kotlin/okhttp3/internal/http/RetryAndFollowUpInterceptor.kt).

## Pinned official evidence

SDK 2.0.3 source commit: `3efc22a59ecd9f020bf6af58bd47d6a4f292b140`.

- [Official Android guide](https://docs.logto.io/quick-starts/android): v3 uses Custom Tabs; this product intentionally pins embedded WebView v2.
- [WebView callback interception](https://github.com/logto-io/kotlin/blob/3efc22a59ecd9f020bf6af58bd47d6a4f292b140/android-sdk/android/src/main/kotlin/io/logto/sdk/android/auth/logto/LogtoWebViewAuthClient.kt).
- [Scheme/authority/path matching and global session lifecycle](https://github.com/logto-io/kotlin/blob/3efc22a59ecd9f020bf6af58bd47d6a4f292b140/android-sdk/android/src/main/kotlin/io/logto/sdk/android/auth/logto/LogtoAuthManager.kt).
- [PKCE/state, redirect validation and code exchange](https://github.com/logto-io/kotlin/blob/3efc22a59ecd9f020bf6af58bd47d6a4f292b140/android-sdk/android/src/main/kotlin/io/logto/sdk/android/auth/logto/LogtoAuthSession.kt).
- [SDK bridges and Activity destruction](https://github.com/logto-io/kotlin/blob/3efc22a59ecd9f020bf6af58bd47d6a4f292b140/android-sdk/android/src/main/kotlin/io/logto/sdk/android/auth/logto/LogtoWebViewAuthActivity.kt).
- [RAM configuration](https://github.com/logto-io/kotlin/blob/3efc22a59ecd9f020bf6af58bd47d6a4f292b140/android-sdk/android/src/main/kotlin/io/logto/sdk/android/type/LogtoConfig.kt).
- [SDK storage, cookie clearing, refresh, UserInfo and ID-token verification](https://github.com/logto-io/kotlin/blob/3efc22a59ecd9f020bf6af58bd47d6a4f292b140/android-sdk/android/src/main/kotlin/io/logto/sdk/android/LogtoClient.kt).
- [Tauri mobile plugin API](https://github.com/tauri-apps/tauri/blob/tauri-v2.12.5/crates/tauri/src/plugin/mobile.rs).

Fixtures and compilation are separate from production identity-provider/device
acceptance. No real account login or credential copying was performed here.
