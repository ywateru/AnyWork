---
id: release-mobile-menu-synchronization
scope: mobile-browser-test
status: in-progress
depends-on: [release-compatibility-018]
---

## objective

Correct the mobile directory-order test synchronization exposed by exact-source v0.1.18 Checks run `42820324352`, then publish a new immutable candidate. Windows, Android and container checks passed; server-web finished with 646 browser passes, one existing skip and one timeout. No v0.1.18 tag or release was created.

## evidence

The failed trace shows the test selecting `.mobile-menu` before reloaded session hydration finishes. Hydration hides its parent window tab bar and exposes `.conversation-sidebar-toggle`; the click continues waiting on the old hidden button until the test deadline. Directory-order assertions were not reached. API polling continued successfully and the final snapshot contained the expected groups. This supports a fixture synchronization race, not a proven external infrastructure failure or a failed ordering assertion.

## ownership and verification

The UI author owns the minimal corresponding browser fixture/test change and author report. Preserve directory ordering, reload persistence and mobile sidebar assertions; do not extend timeouts blindly or skip coverage. Use isolated test data and the frozen release behavior. The independent reviewer checks the exact committed fix and targeted actual browser regressions. Root merges accepted commits and starts a fresh publisher operation; v0.1.18 is not retried or adopted locally. The fresh source must pass full trusted Checks and the release matrix before publication. Existing applications, accounts and business services remain untouched by this correction.
