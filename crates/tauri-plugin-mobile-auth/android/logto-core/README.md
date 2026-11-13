# Logto 2.0.3 JVM core: explicit single-attempt transport

This directory contains **all 33** JVM core Kotlin source files from
[`3efc22a59ecd9f020bf6af58bd47d6a4f292b140`](https://github.com/logto-io/kotlin/tree/3efc22a59ecd9f020bf6af58bd47d6a4f292b140/kotlin-sdk/kotlin/src/main/kotlin).
The original Android UI AAR remains `io.logto.sdk:android:2.0.3`; its transitive
`io.logto.sdk:kotlin` is excluded and replaced with `:anywork-logto-core`.
No reflection, class/jar replacement or alternate OAuth implementation is used.

`LICENSE` is the pinned repository’s original MIT license. The preserved upstream
Maven build declares MPL-2.0; this provenance discrepancy is recorded rather than
rewriting either upstream file. `SOURCE.json` records original and local SHA-256
for every source, license and preserved upstream build/catalog, plus the downloaded
archive digest. `source.patch` is the entire upstream source diff. Only
`HttpRequest.kt` changes: disable connection retries and both redirect policies,
bound connect/read/write/whole-call times to 15/30/30/60 seconds, and wrap POST
bodies as one-shot while delegating their type, length and bytes unchanged.
OAuth, PKCE/state, ID-token checks, serialization and callback APIs are unchanged.
The original public lazy `httpClient`/`gson` and all `makeRequest` overloads remain.

Dependency versions/scopes come from the preserved catalog: `api` jose4j 0.9.6,
`implementation` OkHttp 4.11.0 and Gson 2.10.1. OkHttp is strictly pinned to the
reviewed 4.11.0 behavior. Android's existing Gson dependency can resolve higher;
this does not change transport policy. Kotlin JVM 2.2.10/JVM17 matches the host
Android build. Boole owns generated-project inclusion/root plugin registration.

Minimal JVM-only tests, from repository root using an existing Gradle 8.14 wrapper:

```sh
JAVA_HOME=/path/to/jdk17 /path/to/gradlew \
  -p crates/tauri-plugin-mobile-auth/android/logto-core/test-support \
  :anywork-logto-core:test --no-configuration-cache --console plain
python3 crates/tauri-plugin-mobile-auth/android/logto-core/verify-source.py \
  /path/to/extracted/kotlin-3efc22a59ecd9f020bf6af58bd47d6a4f292b140
```

MockWebServer receives the complete synthetic refresh FormBody, then emits EOF,
408, 503 with Retry-After 0, 421, or 307/308 with a valid destination Location.
Each callback must complete with exactly one source POST and zero destination
requests. The EOF case disconnects **after receiving the complete request**.
421 uses HTTP/1, not a claimed HTTP/2 coalescing runtime experiment. In pinned
[OkHttp's interceptor](https://github.com/square/okhttp/blob/parent-4.11.0/okhttp/src/main/kotlin/okhttp3/internal/http/RetryAndFollowUpInterceptor.kt),
421 checks body `isOneShot` before considering coalescing; the general follow-up
loop also refuses a one-shot body (essential for 503 Retry-After 0). The tests
assert the actual outgoing request body is one-shot. Redirects are also disabled.

This eliminates automatic SDK HTTP refresh resends. It does not claim server
rollback after an unknown response. The application owner still retires the grant
on unknown outcomes; its Rust regression test remains required. No real account
login, live refresh-loss experiment or production Native directory acceptance is
implied by these fixtures.
