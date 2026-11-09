---
id: account-web
scope: web-account-device-site
status: in-progress
depends-on: []
---

# account-web

## objective

Implement Logto official SPA login/signup/callback/logout, Account API minimal bounded customData preserving other namespaces, CyberGrid JS SDK device discovery, cancellation/account isolation; redesign bilingual homepage in established white/black design with reference DeepSeek Harness. Reuse full workspace. Normal flow has no URL/token entry; keep manual advanced flow. Do not open plaintext remote business traffic. Coordinate secure transport protocol with desktop lane, then implement complete API/binary/events/PTY adapter within web.

## context

- [Master task](account-device-cloud.md)
- [Approved design](../../account-device-cloud-review.md)
- [Research](../analysis/account-device-cloud.md)
- [Architecture](../../architecture.md), [API](../../api.md), [UI](../../ui-design.md)
- [Desktop](../../desktop-manager-design.md), [brand](../../brand.md), [release](../../releasing.md)
- Local reference `ref/deepseek-harness`; crypto reference `ref/ds-harness-remote` is read-only.

## path

`web/`, `site/`, root `vercel.json`, `scripts/build-site.py`, `scripts/site-test.mjs`, `docs/account-web-layout.md`; no cloud publisher or Rust/desktop edits

## verification

Use frontend-design skill and layout docs before code. Test real implementation boundaries, malformed/expired/account-switch states, config conflict feedback, mobile390px/keyboard/layout. No telemetry and no business caching in service worker. Build public env config only. Account API token differs from Grid resource token; no PAT/M2M/client secret. Explicitly report missing integration gates.

Commit implementation and test evidence before independent review. No claim of completion based only on mocks, build success or upstream reports.
