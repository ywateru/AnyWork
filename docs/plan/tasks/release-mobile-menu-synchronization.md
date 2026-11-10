---
id: release-mobile-menu-synchronization
scope: mobile-browser-test
status: done
depends-on: [release-compatibility-018]
---

## objective

Correct the mobile directory-order test synchronization exposed by exact-source v0.1.18 Checks run `42820324352`, then publish a new immutable candidate. Windows, Android and container checks passed; server-web finished with 646 browser passes, one existing skip and one timeout. No v0.1.18 tag or release was created.

## evidence

The failed trace shows the test selecting `.mobile-menu` before reloaded session hydration finishes. Hydration hides its parent window tab bar and exposes `.conversation-sidebar-toggle`; the click continues waiting on the old hidden button until the test deadline. Directory-order assertions were not reached. API polling continued successfully and the final snapshot contained the expected groups. This supports a fixture synchronization race, not a proven external infrastructure failure or a failed ordering assertion.

## ownership and verification

The UI author owns the minimal corresponding browser fixture/test change and author report. Preserve directory ordering, reload persistence and mobile sidebar assertions; do not extend timeouts blindly or skip coverage. Use isolated test data and the frozen release behavior. The independent reviewer checks the exact committed fix and targeted actual browser regressions. Root merges accepted commits and starts a fresh publisher operation; v0.1.18 is not retried or adopted locally. The fresh source must pass full trusted Checks and the release matrix before publication. Existing applications, accounts and business services remain untouched by this correction.

## delivery

Fix `a23d488` adds only the two post-reload conversation-readiness assertions. The author's original mobile case passed three consecutive runs, and [independent exact-source review](../reviews/release-browser-018-independent.md) accepted the fix with four additional runs across desktop and mobile. The production Web assets were built from frozen f772 source and matched the failed CI asset names; the reused earlier server binary is explicitly a fixture dependency, not an exact-release-server claim. Root merged the fix and review for a fresh v0.1.19 publisher operation. Full exact-source CI, release builds and website verification remain publication gates.
