---
id: model-picker-focus
scope: model-menu focus consistency discovered during final release checks
status: investigating
depends-on: [message-replay-race]
---

The v0.1.9 cloud browser suite passed 538 cases and skipped one, but its fast-tier checkbox lost focus after a successful native save. The merged local full suite passed the same case. Inspect the exact trace and reproduce the ordering before classifying the failure; retain the strict focus assertion.

## Contract

- A model-menu save that disables its initiating control must restore focus only after the control has committed its enabled state, on success or failure, when that menu still owns the interaction.
- A user who deliberately moves focus, closes the menu or changes sessions during a save must not have focus stolen by its old completion callback. Preserve current native-save semantics and error reporting.
- Do not weaken assertions, force clicks, arbitrarily sleep or introduce retries to hide a product race. Add a deterministic regression for the confirmed ordering and independently review the stable committed fix.
- Use isolated fixtures only. Do not send prompts to real sessions or alter installed hosts. Root owns merges, full checks and authorized publication/deployment.

The developer worktree is `task/model-picker-focus`, based on `e825c60`. Product corrections, if needed, ship in v0.1.10; published v0.1.9 tags and assets remain immutable.
