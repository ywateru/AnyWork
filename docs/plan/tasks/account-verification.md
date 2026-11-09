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

Independent source reviews are complete: Cloud `01b927f`, Web `c9a7074` and Desktop `ead3874` were accepted by separate reviewers and merged to local main. All established C1–C4, W1–W5 and D1–D3 findings are closed. Their precise reports and the restored merge/test-runner/lint correction history are linked from [final acceptance](../reviews/account-device-acceptance.md).

Independent actual Upstash testing passed 11 checks through the pinned official Redis store in a unique synthetic namespace, then removed only its own new keys. A fresh hosted DEV SPA sign-in and live Account/Grid boundaries also passed independently. The product Rust verifier accepted actual Logto ES384 JWTs and rejected invalid identity/scope/expiry/algorithm cases. Final merged-system checks passed against `c5f25d9`: complete check.sh, 611 browser cases/one pre-existing skip, 323 Web plus eight Node cases, 22 merged browser/Rust interoperability checks, cloud safety/recovery and bilingual website checks. Local `/app/` artifact and known-credential exclusion checks passed. These results are recorded with their actual scope in final acceptance.

Actual cloud and fixture evidence does not replace full native login/Keychain/device registration/browser acceptance, new-account email/default-role acceptance, physical mobile-network testing, or production publication gates. A fresh CUA inventory attempt still reports that the Mac is locked; no UI bypass was attempted.

## 最新范围覆盖

按用户最新修订，本阶段使用Development Logto，无生产付费前置；新账号敏感信息仅进程内存、不用Keychain。Native验收应验证关闭后重登录、同机公开安装ID稳定/公钥更新和旧pin确认，而非旧grant持久恢复。Mac已解锁，旧锁屏/Keychain检查保留历史范围，当前任务见account-client-entry.md。
