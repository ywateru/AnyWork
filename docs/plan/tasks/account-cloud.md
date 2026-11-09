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
