---
id: account-cloud
scope: cloud-provisioning
status: in-progress
depends-on: []
---

# account-cloud

## objective

Provision a dedicated Logto tenant with SPA, Native, connect resource/default role, Account API, email sign-in/signup; Upstash Redis and official CyberGrid Vercel deployment. Return ONLY public config and credential-file locations to orchestrator. Preserve old resources. Implement resumable safe cloud configuration and migrate publisher from Pages to Vercel while preserving immutable source/releases. Deploy final frontend only after integrated validation.

## context

- [Master task](account-device-cloud.md)
- [Approved design](../../account-device-cloud-review.md)
- [Research](../analysis/account-device-cloud.md)
- [Architecture](../../architecture.md), [API](../../api.md), [UI](../../ui-design.md)
- [Desktop](../../desktop-manager-design.md), [brand](../../brand.md), [release](../../releasing.md)
- Local reference `ref/deepseek-harness`; crypto reference `ref/ds-harness-remote` is read-only.

## path

`scripts/cloud/`, `scripts/publish.py`, publisher tests, `.github/workflows/`, `docs/cloud-configuration.md`, cloud deployment docs; do not edit web/site/crates/desktop or root vercel.json

## verification

Current official schema first; no secrets stdout/Git/client; verify actual OAuth, Account API, issuer/audience/client, CORS; Redis failures closed and namespace isolation. Report SMTP/account restrictions accurately; do not use someone else’s mailbox. Separate upstream CI evidence from checks actually executed.

Commit implementation and test evidence before independent review. No claim of completion based only on mocks, build success or upstream reports.

## Candidate implementation and evidence

- Dedicated productionFree tenant afwf0u and separate developer tenant ueg42e created; previous resources untouched. Production paid entitlement blocks customresource/roles (verified quotas0/0). Exact read-only SKU API confirms Pro24USD+RBAC32USD=56USD/month base, before tax/overages; no purchase made.
- Dedicated Upstash free us-east-1 TLS/noeviction created, official CyberGrid2bd6729 deployed to dedicated DEV Vercel project. Health/config/admin-disabled/unknown/CORS probes recorded in cloud-configuration.md.
- Publisher migrated to Vercel exact-source workflow/provenance with backward repair alias, immutable release semantics preserved. 28publisher tests+7private-cloud safety tests passed. Current upstream suite80pass7skip0fail; local Redis tests skipped, not Upstash proof.
- Real hosted SPA PKCE/ES384 resource JWT+opaque AccountAPI token and namespace/replacement/wrongtoken checks passed. Isolated account seeded and role explicitly assigned; not signup/email/default-role proof. Native refresh/actual desktop and production mailbox gates remain for integrated verification.
- Candidate requires independent review before merge. Production release flag/CI secrets not activated; no frontend production publication.

## Independent review fixes C1–C4

Release dispatch now targets Vercel, with legacy Pages preserved solely as explicit manual recovery. Coordinator deployment now persists a secret-safe configuration/operation intent before mutation, reuses saved/matching provider deployments, reconciles unknown POST outcomes, fails closed on ambiguity/config changes, and requires a stable explicit redeploy UUID for a fresh operation. Prefix validation matches official1–80 grammar before provider access. New real-main offline recovery/call-chain tests cover review cases; no live deployment/payment/production activation or OAuth refresh is part of these fixes. Review must rerun against the new committed head.

Fix candidate verification: `python3 scripts/cloud/test_deploy.py`18 passed; `python3 scripts/cloud/test_configure.py`7 passed; `python3 scripts/publish-test.py`28 passed; Python compilation and diff whitespace checks passed. Tests are offline/private temporary fixtures, including actual deployment CLI main replay; no actual cloud deployment, payment or OAuth refresh was executed.
