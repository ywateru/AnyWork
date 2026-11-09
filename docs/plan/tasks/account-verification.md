---
id: account-verification
scope: account-device-independent-review
status: in-progress
depends-on: [account-web, account-desktop, account-cloud]
---

# Independent account/device verification

## objective

Review committed implementation using a different agent from its author. Report source acceptance, isolated integration, real cloud evidence and production release readiness separately. No pass based on mocks/builds alone. Pending payment, license decisions and unavailable physical-device tests must remain explicit.

## context

- [Master task](account-device-cloud.md), [approved design](../../account-device-cloud-review.md)
- [Final acceptance](../reviews/account-device-acceptance.md)
- `docs/account-remote-protocol.md`, `docs/account-desktop.md`, `docs/account-web-layout.md`, `docs/cloud-configuration.md` when delivered
- [Support matrix](../../support-matrix.md), [release contract](../../releasing.md)

## path

Review the exact committed heads for cloud, web and desktop branches and all callsites they touch. Write reviews to `docs/plan/reviews/account-{lane}-01.md` in the reviewed worktree. Do not implement product fixes or alter the author's branch without coordination. Never read existing user business sessions or send Agent prompts to them.

## verification

- Reconstruct every actual creation/injection/call chain from account entry to device registry to gateway to local APIs/PTY, including refresh ownership and private key storage.
- Independently exercise real browser/Rust crypto (not two copies of the same mock), bad identity/token/alg/audience/scope, tamper/replay, frame and aggregate limits, route restrictions, expiry/cancel/disable and PTY cleanup.
- Inspect all browser direct network paths, event polling, binary/preview/download/upload, account-scoped drafts/caches and late-response handling. Test malformed external config/directory/account data.
- Inspect native callback broker trust/timeout/state/URL bounds, grant checkpoint failure/restart/revoke ownership, same-owner restore and owner-switch rotation.
- Check official SDK/source pins, original licenses, source archive/export and native platform compile restrictions.
- Use only dedicated development tenant and generated test accounts for real OAuth/AccountAPI/Grid tests. Credentials outside Git can be provided by orchestrator; do not print secrets or raw token responses. No paid changes or existing resource deletion.
- Verify website desktop/390px, bilingual copy, keyboard/focus, truthful support claims, immutable download/source links, Vercel production vs development environment distinction.
- Review publisher exact-source gate, resumability, failure recovery, no tag/asset overwrite, no accidental Pages double deploy, secret handling.

Findings: severity P1/P2/P3, blocking/non-blocking, exact contract and file locations; finish pass/blocked with precise test evidence and limitations. A source-review pass is not approval to publish unverified production functionality.

## Progress (2026-11-09)

Independent reviews are active against committed lane candidates. Web review found browser-native `fetch` binding and late cancelled-upload acknowledgement failures; fixes await exact-commit re-review. Cloud review independently passed 11 actual Upstash checks through the pinned official Redis store, using a unique synthetic acceptance namespace and removing only its own keys afterward. It also found a release workflow still dispatching legacy Pages alongside the Vercel migration. Native review found desktop registration overwrites user-edited device labels and is examining durable refresh checkpoint recovery.

These findings block merging the affected candidates. Actual Upstash evidence does not replace full native login/Keychain/device registration/browser acceptance, new-account email/default-role acceptance, physical mobile-network testing, or production publication gates.
