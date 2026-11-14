# Mobile Native recovery: independent review

Reviewed exact commit `fa47cc5bb5a76c9889845af8d89d1bf3160cef49`. Result: **accepted for the reproduced Native SDK recovery defect; no blocking finding**. This acceptance does not attribute the user's phone screenshot or initial presence failure to the Native path. The screenshot's text and controls identify `web/src/AccountApp.tsx`, which is a separate Web console lane and can also be opened by an older Android Custom Tab launcher.

## Recovery contract and retained guards

The pinned CyberGrid SDK revision is `f2a3961536e5c69b13c7dbc661953d9243becbae`. Its `sdk-rust/src/client.rs`, `exchange_pending`, requests a provider token with the existing reason and `fresh || natural_expiry`. In particular, a finite-admission session can expire and cause `CoordinationRecovery` with `force_refresh=true`. The old Mobile equality requiring forced refresh to mean only `AuthorizationRejected` incorrectly rejects that valid request.

`crates/mobile/src/account/grid.rs`, `Authorization::grant`, removes only that equality. It retains the exact SDK-instance binding, request cancellation, SDK generation, requested minimum validity, issuer, client, resource, allowed/unique scopes and account epoch checks. The checks run before token acquisition and again afterward; the returned grant must still belong to the expected epoch. `Handle::token` retains the validity range, native generation, token and expiry checks.

The force flag continues to reach the sole Kotlin token owner. `MobileAuthPlugin::token` uses it to clear the access-token cache and still checks current ownership, expiry, required resource permission and subject. It is a cache-freshness instruction, not an identity assertion. The patch does not expose OAuth material to business JS, change capabilities, bypass registration authorization, introduce a console session or alter trust-on-handshake rules.

The other product changes preserve fixed failure-stage codes in the Rust snapshot. No underlying SDK error strings or service response bodies are exposed by those mapped boundaries. This is diagnostic support; it is not proof of the cause of an earlier generic unknown state.

## Actual SDK coverage

Host tests now compile the same `grid.rs` through a test-only dependency on the same pinned SDK. Non-Android production builds retain their unavailable stub. The added tests use actual SDK HTTP/configuration, optional admission, registration, ephemeral identity/publication and device-query code against loopback fixtures; they do not replace the Native broker with injected online state.

The three `native_grid` tests cover:

- Initial directory refresh without console login, with and without admission; reuse of the Native registration owner and preparation of a bound target.
- Configuration fetch/binding, registration, subject, device fetch and business-port failures; account records remain unknown, targets fail closed and private response material is absent from the public snapshot.
- An initially successful Native registration followed by a two-second synthetic session expiry. The real SDK monitor drives recovery, and the backend records a forced resource-token request before presence returns to ready.

The last test proves a recovery path after initial success. It does not reproduce an initial unknown state in a fresh client. The fixture exercises legacy `/devices`; it does not cover versioned `/directory` responses. That limitation does not explain the observed production configuration, which did not advertise endpoint policy at the time of the public checks below.

## Independent verification

An independent checkout of the unmodified exact commit ran:

```sh
cargo test -p anywork-mobile --lib
```

Result: **39 passed, 0 failed**, including all three real-SDK `native_grid` tests; test execution took 12.48 seconds. This run was completed before the Web WIP existed in that checkout. At report preparation, the author's Native files and dependency configuration were checked against `fa47cc5` and remained unchanged. The completed full-library evidence was reused rather than repeating the same tests merely to generate this report.

A separate temporary ignored verification test performed only an unauthenticated production public-config GET through the actual pinned SDK, then `serde_json::to_value(AuthConfig)` and the exact Mobile `EndpointPolicy::parse`. Result: **1 passed, 0 failed**; issuer/client/resource bindings matched. An independent raw public GET returned HTTP 200. Evidence retained only field names, booleans and fixed validation outcomes, not identities or authorization material.

The observed production config advertised neither finite admission nor endpoint policy, so the SDK selected `/api/v1/devices`. The raw console-related configuration fields dropped by SDK normalization did not break Mobile parsing. These checks establish host-side public configuration compatibility only; they do not establish Android network/TLS behavior, token acquisition, production registration or an authenticated directory response.

## Acceptance boundary

Accept `fa47cc5` for inclusion in the final Android source/APK as a bounded correction to valid forced-refresh recovery, with improved synthetic SDK coverage. Do not describe it as fixing the reported phone screenshot, nor as demonstrating that the deployed legacy service experienced finite-admission expiry. Current production did not advertise that feature during the checks.

No real login, user credentials, account stores, original sessions, devices or native-app interactions were used by this independent review. Grant acquisition, registration and account writes in the suite are synthetic. APK compilation/runtime and the Web phone presence investigation remain separate validation responsibilities. No Web WIP was reviewed or included in this acceptance.
