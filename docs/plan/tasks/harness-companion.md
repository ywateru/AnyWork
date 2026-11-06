---
id: harness-companion
scope: official Harness desktop discovery plugin
status: merged
depends-on: []
---

## Objective

Implement the small installable Cordis companion described in `docs/harness-desktop-discovery.md`. Publish only the existing authenticated loopback host address to a private descriptor; do not start a server or execution engine. Include installation documentation and meaningful lifecycle tests.

## Context

- `docs/harness-desktop-discovery.md`
- `docs/deepseek-harness-integration.md`
- Official `webServer.getOrigin()` and `connection.authenticatedUrl()` sources, pinned to `fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159`.

## Path

Own `integrations/harness-discovery/` and companion installation documentation. Do not modify Rust, product input components or backend discovery parsing; coordinate schema with backend agent. This serial follow-up may use the completed UI development worktree, keeping a separate commit.

## Verification

Check secure atomic descriptor publication, loopback-only URL, configurable destination, symlink protection, own-activation cleanup and multiple activations. Demonstrate official installation in an isolated host and runtime service injection, coordinating host ownership with independent verifier. Commit before separate-agent review. Never install into the real user's Harness Desktop/CLI profile.

## Delivery

Implementation `ebfefef` is merged through `5d9d5b1`. [Independent review](../reviews/harness-discovery.md) passes: eight lifecycle tests, official installation in an isolated Harness Web profile, and discovery of native-created sessions through the published descriptor. The installed production Electron application was not modified or restarted; that manual installation remains a stated verification limit.
