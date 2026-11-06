# WorkBuddy identity and launch setup

State: developing after native-envelope research in `.worktrees/workbuddy-ui`, branch `codex/workbuddy-ui`, base `a6f0943`. Develop agent: harness_ui; independent reviewer: harness_verify after a committed candidate exists.

Contract: [shared desktop integration](../../workbuddy-integration.md), [investigation](../analysis/workbuddy.md).

Add native WorkBuddy identity to the generic sidebar/filter/creation controls with locally bundled official teal SVG and provenance. Preserve availability and existing Agent behavior; unknown agents remain generic. Focused browser and identity tests must cover both themes/mobile and no connection side effects.

Provide a source launcher `scripts/workbuddy-launch.py` using the installed executable's built-in debugging env option. Do not patch/re-sign the application, stop another process or start a separate agent engine. Publish only the private v1 descriptor agreed with the backend. Handle occupied profile, stale discovery, app exit and descriptor replacement honestly; do not destroy another launcher's descriptor. Tests use fake executables/CDP endpoints and temp directories, never the production profile. Exact setup instructions and local trust boundary must be documented. No release or version changes.

Paths: `web/**`, launcher and its isolated tests. Backend crate changes belong to the backend task. Commit before independent review.
