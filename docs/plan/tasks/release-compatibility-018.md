---
id: release-compatibility-018
scope: exact-source-release-compatibility
status: in-progress
depends-on: [desktop-onboarding-native, desktop-onboarding-ui]
---

## objective

Resolve the exact-source v0.1.17 Checks failures before publishing a fresh immutable candidate. Run 42813746837 failed before any tag: current Linux stable denies the newly deprecated atomic `fetch_update` call; Windows qualified-transport Python fixtures did not initialize. Container and Android checks passed. The local merged checks remain valid evidence for their Mac toolchain, not proof that other toolchains passed.

## context

Keep the [onboarding contract](../../desktop-onboarding-layout.md) and all authorization/expiry checks intact. Do not suppress warnings, skip Windows behavioral tests, relax product deadlines or move tags. The v0.1.17 local candidate is unadopted and must be replaced by a candidate built from the subsequent exact release source. Vercel's expired CI credential is a separate configuration repair.

## path

- Native author owns only `crates/remote/src/gateway.rs` and associated registry tests: preserve bounded temporary identifier allocation and overflow refusal using APIs accepted by both installed and current stable Rust.
- UI author takes the separate portability lane: `crates/agent-sdk/tests/qualified.rs`, its disposable Python peer and the Windows CI Python setup if necessary. Determine why the peer does not initialize on Windows; preserve actual stdio, partial-write, cancellation, reaping and no-user-data boundaries.
- Independent reviewer checks both committed changes, their test evidence and combined source. Root handles documentation, merges and publication.

## verification

Targeted compiler/lint, registry lifecycle/overflow/concurrency and actual qualified-transport tests must pass without expanding privileges. The subsequent exact source must pass the full trusted GitHub Checks before publication. No real account, remote enable, production service restart or local candidate adoption is part of either source-fix lane.
