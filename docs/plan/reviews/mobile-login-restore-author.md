# Android saved-login author record

状态：作者实现与定向验证完成，待精确提交独立审查；不是 APK/实机验收。基线 `15f5c3f`；当前契约为 root `7353492`、`e118ee6` 的 `docs/login-session-persistence.md`。不修改版本、发布、真实凭据或设备。

## Root cause and implementation boundary

`MobileAuthPlugin` explicitly disabled SDK persistence and called fence/signOut on host Activity destruction. The SDK's default persistence is plaintext SharedPreferences and remains disabled. The original `io.logto.sdk:android:2.0.3` AAR remains unchanged; its complete pinned vendor JVM core remains the only OAuth transport. Native retains the SDK as single refresh owner.

A strong process owner now survives business Activity/WebView recreation. Normal closure preserves a completed grant and lets an already dispatched refresh finish and save. Only the closing host's unfinished interactive authorization is cancelled. SDK orphan login Activities still require the existing in-memory attempt/PKCE owner.

The new v1 record is the only credential schema read. It contains refresh token, ID token and previously validated subject, authenticated with complete endpoint/issuer/client/resource/grid URL/product/callback/scope binding. Access tokens, transient Noise/registration keys, account data and legacy credentials are excluded. Android Keystore protects a non-exportable AES key; AES-GCM uses a fresh 96-bit IV and binding as AAD. Ciphertext is written as 0600 under `noBackupFilesDir`, fsynced, replaced using `Os.rename`, then its directory is fsynced. This avoids newer `java.nio.file` runtime APIs and does not change minSdk. A fixed schema-specific alias/file rejects other binding rather than importing it.

Cold start uses no saved access token: load authenticated grant, force SDK refresh from an empty access cache, then verify current issuer/client and same subject. A new returned ID is verified by the SDK. A response may legally omit ID: after fresh refresh confirms authorization, identity/display can retain the integrity-protected, previously verified binding, with UserInfo subject equality when available. This does **not** claim the old ID just underwent fresh signature/expiry validation. Only the SDK's pure UserInfo GET failure permits fallback; nested refresh, invalid ID/JWKS and wrong UserInfo subject fail closed.

## Durable refresh and logout

Before any refresh FormBody is enqueued the same store generation persists `pending`. Per-call OkHttp `requestHeadersStart` is a conservative possible-transmission boundary. Only an actual failure before this event may restore `ready`; no exception/timeout category is used to infer delivery. After headers start, missing/invalid results and crashes keep the record unusable. No retry/redirect/follow-up was added. Reading a response body now completes with a failure on IOException instead of stranding the native continuation.

After SDK response verification and subject checks, save the accepted grant before returning a native success. A rotation received but failing subsequent validation cannot restore old ready. Logout immediately increments runtime and store generations, commits loggedOut (or deletes key/ciphertext if that write fails), retires Rust targets, then serially revokes/clears SDK RAM and cookies. If tombstone and both independent deletion paths fail, native reports
`reauthRequired`/`MOBILE_AUTH_CLEAR_REQUIRED` instead of claiming logout completion.
Rust retires account/targets immediately in that state and reports `signedOut` only
after durable native confirmation. Logout before initial configure erases the new
schema without reading it, and fences the later startup restore. Storage/revocation
failures are explicit. Late save/no-send callbacks cannot undo the tombstone. Ordinary shutdown does not call signOut.

## UI and account contract

UI notices/polling are assigned to the separate mobile UI author. This lane owns
only the bridge DTO/5 fixed messages and their test (`8e8a77c`). Phase values: `signedOut`, `restoring`, `restoreRetryable`, `signingIn`, `signedIn`, `reauthRequired`. Cold UI begins restoring; accounts and targets are absent until fresh authorization and subject binding succeed. `mobile_account_refresh` retries restore without SSO. Logout is allowed during restore/retry and fences delayed results. A newly adopted restored owner gets a fresh Rust epoch; directory revision remains its existing independent counter.

Configure and retry return `restoring` without waiting for network; the process-owned
operation holds the SDK mutex to actual completion. Public snapshot stays responsive,
and `refresh` during restoring only polls. The UI author will poll about once per
second and stop on unmount/terminal state. One monotonic 90-second network budget
spans GET and POST; each call receives at most 60 seconds or remaining budget,
including response-body reads. Budget exhaustion fails before the next enqueue.
There is no separate Rust/JS IPC timeout in this call chain (Tauri 2.12.5
`run_mobile_plugin_async`); caller cancellation cannot cancel a dispatched rotation.
No timeout unlocks an SDK owner while a late callback can mutate it. Rust epoch
checks reject configure/restore/snapshot results after newer logout/login.

New fixed error codes: `MOBILE_AUTH_STORAGE_UNAVAILABLE`, `MOBILE_AUTH_RESTORE_UNAVAILABLE`, `MOBILE_AUTH_SAVED_GRANT_INVALID`, `MOBILE_AUTH_REFRESH_UNCERTAIN`, `MOBILE_AUTH_CLEAR_REQUIRED`. Existing profile/revocation warnings remain. No provider response/error/credential is returned to guest IPC.

## Validation status

- Final JVM auth/core tests and Android lint pass: auth 30/30, core 13/13, zero failures/errors/skips; `:tauri-plugin-mobile-auth:lintDebug` passes. Tests use synthetic grant records, real JCE AES-GCM, the actual original Android SDK AAR, loopback synthetic IdP and actual OkHttp callbacks.
- Targeted Web account tests: 2 passed; Web typecheck passed. A command invocation mistakenly forwarded the TypeScript path to the unrelated Node private-state runner: Vitest's 447 tests passed but that command returned failure for unsupported `.ts` input. The corrected direct Vitest invocation passes; this is not a product failure.
- Final Rust account tests: 24 passed, 0 failed, 1 existing ignored public-service probe, 23 filtered out. Guest native-auth boundary: 1 passed. Strict clippy for `anywork-mobile` and `tauri-plugin-mobile-auth` lib/tests passes with `-D warnings`. Shared target released to Desktop author after these checks.
- Upstream provenance verification passes: complete 33 Kotlin sources and exact HTTP-only patch against archive SHA `070d90439ebd2f41f90b2c11d27ca9e5617c3fff267d9391b2281ff8573f387c`.
- Independent reviewer reports 19/19 real Android Keystore steps across 19 distinct processes using isolated emulator 5560 and new package `dev.anywork.loginrestore.review`, with no network permission or real grants. This accepts the unchanged 7706-byte GrantStore SHA-256 `1e0f028028fc15ade2b5ad041bc9aab2dd8f587cac26c42430f3cfd814025c49`, not the entire native SDK lifecycle. The reviewer owns its evidence and final independent report.
- No actual production login, APK, install, release, CI or production mutation was performed by this author. Complete source review and integrated UI/device login acceptance remain separate gates. Platform fixtures do not simulate physical power loss or prove hardware-backed keys on every device.

Ignored evidence: `artifacts/login-restore/` in this worktree.

## Reproduction commands

Use JDK17 and the existing Android SDK. Generated Tauri Gradle glue must include
`:tauri-android` at the installed Tauri 2.12.5 `mobile/android` path and the existing
mobile-auth/system plugin paths, as produced by normal Tauri generation. No Rust or
APK task is needed for the following scoped Gradle targets:

```sh
JAVA_HOME=/path/to/jdk17 ANDROID_HOME=/path/to/android/sdk \
  crates/mobile/gen/android/gradlew -p crates/mobile/gen/android \
  :tauri-plugin-mobile-auth:testDebugUnitTest :anywork-logto-core:test \
  :tauri-plugin-mobile-auth:lintDebug --console plain --no-configuration-cache
CARGO_TARGET_DIR=/path/to/shared/target CARGO_INCREMENTAL=0 \
  CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 CARGO_BUILD_JOBS=2 \
  cargo test --offline --locked -p anywork-mobile --lib account::
cargo test --offline --locked -p tauri-plugin-mobile-auth --lib boundary_tests
cargo clippy --offline --locked -p anywork-mobile -p tauri-plugin-mobile-auth \
  --lib --tests -- -D warnings
cd web && ../node_modules/.bin/vitest run src/mobile/account.test.ts
```

Host Tauri macros require an existing `web/dist-mobile`; this author used a temporary
symlink to the already built root assets, removed after Cargo completed. It is not
a product source change and no UI build was performed by this lane.
