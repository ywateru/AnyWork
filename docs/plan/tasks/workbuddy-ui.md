# WorkBuddy identity and launch setup

State: merged locally after independent acceptance of exact final product commit `18282da`, following baseline `8e17536`. The follow-up fixes the empty Agent selection when plugins arrive after the create dialog opens, while preserving any explicit selection if it becomes unavailable. Develop agent: harness_ui; independent reviewer: workbuddy_ui_verify. [Review](../reviews/workbuddy-ui.md) covers 18 desktop/mobile sidebar cases, launcher tests and an independent component-boundary check. Native feature acceptance belongs to the separate backend/runtime gate.

Contract: [shared desktop integration](../../workbuddy-integration.md), [investigation](../analysis/workbuddy.md).

Add native WorkBuddy identity to the generic sidebar/filter/creation controls with locally bundled official teal SVG and provenance. Preserve availability and existing Agent behavior; unknown agents remain generic. Focused browser and identity tests must cover both themes/mobile and no connection side effects.

Provide a source launcher `scripts/workbuddy-launch.py` using the installed executable's built-in debugging env option. Do not patch/re-sign the application, stop another process or start a separate agent engine. Publish only the private v1 descriptor agreed with the backend. Handle occupied profile, stale discovery, app exit and descriptor replacement honestly; do not destroy another launcher's descriptor. Tests use fake executables/CDP endpoints and temp directories, never the production profile. Exact setup instructions and local trust boundary must be documented. No release or version changes.

Paths: `web/**`, launcher and its isolated tests. Backend crate changes belong to the backend task. Commit before independent review.
