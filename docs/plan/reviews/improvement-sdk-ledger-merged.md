# SDK + ledger merged regression — gate remains open

Date: 2026-11-08. Exact tested source: `855f9719f2900f43caae0487adef29cc48c04392`, including ledger `8d57934` and qualified SDK `123cc1c`, each independently source-reviewed. **Complete command result: FAIL (exit 1).** This document is not a merged-regression acceptance. No product native/runtime/Web consumer uses the dormant SDK merely because its module review passed.

## Actual command and isolation

Root reused the private `.worktrees/improve-ledger-merged` integration tree and ran exactly one complete invocation:

```sh
CARGO_INCREMENTAL=0 CARGO_TARGET_DIR="$PWD/target" \
PLAYWRIGHT_CHANNEL=chrome ANYWORK_E2E_PORT=3239 bash scripts/check.sh
```

Source stayed at the exact SHA throughout. Outputs/data/processes were private, with root Node dependencies linked read-only; production release binary, Web dist, sessions and applications were untouched. Current main's later workflow/docs changes do not change this tested crate source. Local evidence: `.worktrees/improve-ledger-merged/artifacts/sdk-ledger-merged/{check.log,check.exit}`. Original failure trace and actual touch/geometry diagnostics remain in that tree's `test-results/sidebar-scroll-sidebar-con-8ba47--gestures-in-a-short-window-android-web/`.

## Observed results

- Rust format, workspace Clippy, build and tests passed: server **185 passed / 5 ignored**, desktop **34 / 4**, Codex **5**, SDK **18 unit + 5 actual fake-endpoint + 3 legacy bridge**. These are local Darwin results.
- Web type/build and all **317 unit tests** passed. Private desktop UI build passed.
- Every registered Python/HTTP check preceding browsers passed, including real SQLite schema/recovery, operation Store tests, capabilities/events/files/queue/desktop-host protocols, release/source/publisher/container-script fixtures. These are fixture/source checks, not a new connected operation protocol or actual container build.
- Complete browser invocation: **610 passed / one existing skip / one failure**, 20.8 minutes. Failure: Android short-window sidebar containment case at `e2e/sidebar-scroll.spec.ts:142`, 45-second whole-test timeout during `reachBoundary(up)` progress polling. The single skip remains the desktop-reference combined-header case on Android.
- The script stopped before its final updater UI command. That suffix is being run separately; it cannot change this full invocation's exit status.

## Open failure and required next evidence

The failure location alone does not distinguish real scroll stall, fractional boundary behavior or exhaustion of a test-wide budget after many successful gestures. The first diagnostic confirms trusted touch events and actual scrolling within a 159px list viewport; it does not capture all later gestures or prove the final cause. `web/` and `e2e/` are unchanged from the independently recorded ledger CI `66bd6f0`, which passed on Linux; the different environment/result must be investigated rather than relabelled.

[Focused diagnosis task](../tasks/improvement-sidebar-touch-runtime.md) preserves real-touch/80-session/strict-boundary/containment coverage and the original failure. Any correction requires an exact committed candidate and independent review, then appropriate corrected merged checks. Arbitrary timeout inflation, force scrolling, ignored tests or substituting the earlier green CI are not acceptable. SDK merged regression and current first-party integration remain open. Windows SDK package execution is a separate newly reviewed workflow correction and still awaits actual new Actions logs. No release, production restart, native prompt or website deployment was made.
