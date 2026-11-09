---
id: account-desktop
scope: desktop-account-secure-transport
status: in-progress
depends-on: []
---

# account-desktop

## objective

Implement local desktop native Logto login, owner binding via explicit local action, secure on-device grant/private keys, official CyberGrid Rust SDK lifecycle/registration, public minimal device index and allow/disable access. Implement browser-to-local endpoint E2EE covering all existing APIs/events/files/PTY without sending local bearer to browser/cloud. First investigate Noise IK via mature snow and clatterjs reference, send concrete protocol and public interfaces to root/web before implementing cross-end contracts. No custom weak crypto. Native grant has one refresh owner for Account+Grid tokens.

## context

- [Master task](account-device-cloud.md)
- [Approved design](../../account-device-cloud-review.md)
- [Research](../analysis/account-device-cloud.md)
- [Architecture](../../architecture.md), [API](../../api.md), [UI](../../ui-design.md)
- [Desktop](../../desktop-manager-design.md), [brand](../../brand.md), [release](../../releasing.md)
- Local reference `ref/deepseek-harness`; crypto reference `ref/ds-harness-remote` is read-only.

## path

`crates/`, `desktop/`, `Cargo.toml`, `Cargo.lock`, `docs/account-remote-protocol.md`, `docs/account-desktop.md`, required dependency notices/vendor native SDK provenance; no web/site/cloud script edits

## verification

Test interop vectors and real complete browser/Rust handshake with auth, replay/tamper/wrong-account/expiration/key changes/disable; bounded frames and uploads, backpressure/cancel/PTY teardown. Preserve existing runtime/data and manual flows. Do not run prompts in users native Agent sessions. Vendor only appropriately licensed content; report provider/platform restrictions. Independent review before merge.

Commit implementation and test evidence before independent review. No claim of completion based only on mocks, build success or upstream reports.

## Source delivery (2026-11-09)

Independent final acceptance: product `ead3874`, [review04](../reviews/account-desktop-04.md). D1–D3 closed; merged to local main. Desktop tests pass 50 with four external prerequisites ignored; remote protocol/gateway tests pass six. Actual product ES384 verification and isolated refresh uncertainty, process-loss, alias preservation and persisted-only logout paths were independently exercised. Full workspace lint passed after the final correction. Real Native GUI/Keychain/enable/discovery/business/logout acceptance still requires an unlocked Mac and is not replaced by these tests. See [final acceptance](../reviews/account-device-acceptance.md).
