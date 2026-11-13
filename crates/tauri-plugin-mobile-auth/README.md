# Mobile authorization boundary

This internal Tauri plugin has no guest commands or guest permissions. Only Rust
calls `run_mobile_plugin_async`. Business JavaScript receives the account module's
redacted snapshot, never these native profile/access-grant DTOs.

The sole OAuth owner is official `io.logto.sdk:android:2.0.3`. Persistence is
explicitly disabled with `usingPersistStorage=false`. Refresh and ID tokens never
leave that SDK instance. Resource and opaque Account API access tokens are acquired
under one native mutex; no Rust OAuth client, imported token file, credential
migration, KeyStore or second refresh owner exists. A caller dropping its Rust
future does not cancel the native coroutine or discard its new SDK grant. Unknown
refresh outcomes fence that owner until logout/login.

Android WebView/IdP SSO cookies may persist independently of the application
grant. Logout clears cookies and SDK RAM, while revocation failure is reported.
Process restart does not restore an application grant. The SDK's own Polyfill and
SocialHandler bridges remain within its documented trust boundary; no AnyWork IPC
is installed in the login Activity. Before launch, an Android dialog identifies
the fixed `https://auth.x.aixgg.com` source and explains system Back cancellation
and cookie persistence. The full-screen SDK Activity has no promised source bar.

The callback is the existing desktop Native constant
`http://127.0.0.1:17897/callback` (`crates/desktop/src/accounts.rs`). The official SDK
intercepts the exact scheme/authority/path in WebView navigation and verifies
callback state/PKCE; Android does not bind a listener or install an intent filter
for this callback. This is reuse of existing product configuration, not a newly
invented redirect URI or a claim of successful production login. A deployment
rejecting that registered Native callback is a real login failure, not bypassed.

One native operation spans the SDK callback and destruction of all its login
Activities. Cancellation fences generation immediately, finishes only those
Activities, and waits for the operation to settle before logout completes. A
manifest ContentProvider installs public Android lifecycle callbacks before any
restored Activity: an SDK login restored without an in-memory attempt is closed.
No reflection or SDK private manager access is used. This matters because SDK
2.0.3's `onDestroy` cancels its process-global current authorization session.

## Unresolved SDK transport constraint

The SDK's Kotlin core uses a public, immutable lazy `httpClient = OkHttpClient()`
with no configuration injection on `LogtoConfig` or `LogtoClient`. The pinned
source depends on OkHttp 4.11.0. Its default connection-retry/follow-up policy can
resend a replayable form POST after some recoverable I/O failures (and specific
HTTP follow-up responses). Refresh requests use ordinary `FormBody`; they are
not marked one-shot. Our native mutex and final-error fence prevent application
retries after an unknown rotation, but **do not disable SDK-internal retries**.
Strict single-dispatch rotation is therefore an unresolved acceptance condition,
not a property of this implementation. No real refresh-loss experiment was run.
Do not resolve this by reflection, field replacement or a hidden SDK patch. A
reviewed upstream public transport policy, or an explicitly revised contract, is
needed before claiming that stronger guarantee.

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
