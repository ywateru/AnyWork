# Web client — real Development account acceptance

Date: 2026-11-09, completed at approximately 21:45 +08:00.

Tested Web source: `683094b898484f1419e769b65403f1ec5f835847` (reviewed Web implementation). `git diff 9f704e64c4ab359ec9bc880f8e6b28a735b66af4 683094b -- web` is empty, so this is the same Web source as merged main at `9f704e6`. The report is committed separately for the orchestrator to integrate.

## Result

**Pass for actual hosted sign-in, Account API reads and CyberGrid directory discovery with the user-supplied test account.** This is separate from native GUI/Keychain/enrollment/business transport acceptance.

A new isolated Chrome context opened the actual application at the registered localhost5173 callback origin. It used the application's own “登录” button, the official Logto hosted identifier and secret fields, and the normal official SDK callback. The identifier and secret came only from the user-authorized mode0600 credential file outside Git. No existing browser profile, previous browser grant or Management API was used. The flow completed without showing a consent page; no consent button was clicked.

Observed boundaries:

| Boundary | Actual result |
| --- | --- |
| Hosted discovery / authorization navigation | Discovery200, authorization303, expected Development issuer UI loaded |
| Fresh hosted sign-in and `/app/callback` | Returned to the actual “我的设备” page |
| Account API | Two successful200 reads during the fresh run |
| Resource grant | Actual resource JWT included `connect` and the expected issuer |
| CyberGrid console trusted configuration | 200 |
| CyberGrid console auth exchange | 200 |
| CyberGrid device directory | 200 |
| Account UI alerts | 0 |
| Desktop/mobile browser widths | 1440 and390px; device heading visible and no horizontal overflow |
| Private browser-state checkpoint | Successful, mode0600, exclusive helper lease released |

No role was assigned or repaired during verification. The supplied existing test account obtained `connect` and successfully used the directory with the current service configuration. This verifies its current permission; it does not independently prove email delivery or the assignment mechanism for every future newly registered user.

## Identity interpretation

The fresh, empty browser context submitted the exact user-provided identifier to Logto and completed its secret-based login. An immediate read-only check using only this verifier's newly saved session confirmed that the SDK ID token's subject equals the Account API account ID (`true`).

The current Web authorization does not request an email scope, and the Account API response did not expose `primaryEmail`, `email` or `username`; the ID token also did not provide an email claim. Therefore an additional email-claim comparison is **unavailable**, rather than evidence of a different account. The first temporary test incorrectly treated an absent `primaryEmail` as a failed boolean comparison and printed an aggregate `passed:false` despite every Account/Grid boundary succeeding. That aggregate is not a product-failure conclusion. This follow-up establishes the actual schema and subject match without adding a scope, beginning another OAuth flow, changing a profile or printing any identifier/token value.

The read-only owned-session check returned Account200, subject-to-account-ID equality `true` and zero UI alerts.

## Process and limitations

The first sign-in attempt stopped before the hosted identifier field appeared and did not submit the account secret. An initial destination-only diagnostic remained at the local fixed error state. A subsequent diagnostic of the same product source reached the expected issuer with discovery200/authorization303/UI200, no failed issuer requests and no CSP/CORS/network console category. One full fresh sign-in then completed as recorded above. The earlier interruption's cause was not established and is not described as a fixed product defect or a persistent network failure.

All browser and file failures were reduced to fixed messages or allowlisted booleans/status categories. Credentials, complete URLs, queries, raw browser errors, response bodies and tokens were not printed. No screenshots containing account details were produced. Browser state was managed by the reviewed `withPrivateBrowserState` helper: fresh mode0600 input, exclusive ownership, parsed state passed to Playwright, atomic checkpoint in `finally`, then lease release. The live checks read account/device data but did not modify customData, device records, accounts, roles or email settings. The verifier's browser and localhost5173 Vite process were stopped afterward.

This evidence does not cover signup/email delivery, native OAuth/OS Keychain, enrollment, a real remote business/PTY session, physical phones or cellular networks. The saved session is scoped to this verifier and localhost app origin; using it against a deployed origin requires the orchestrator to take exclusive ownership and follow the actual origin's normal authorization flow. It must not be shared with another concurrent refresh owner.
