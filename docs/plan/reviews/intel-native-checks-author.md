# Intel Native pre-tag Checks — author evidence

Date: 2026-11-11. Task: [release Native hostname lookup](../tasks/release-native-hostname-lookup.md), separate CI lane. Clean branch `codex/ci-intel-native-checks` starts at `c36b87632b459db0249c8edf703abc4b31f1863b`; the previous UI author branch is preserved.

The only workflow change adds an unconditional `macos-native` job to trusted Checks. It uses the same Intel runner (`macos-15-intel`), minimum system target (`MACOSX_DEPLOYMENT_TARGET=14.0`), Node 22, stable Rust, 60-minute job deadline, locked release-profile build and locked release-profile server/desktop test command as the release job. As in release, `npm ci`, the production Web build and the production desktop UI build precede Rust compilation in that order. It retains the runner's system Python without a setup action or interpreter override. Existing Checks jobs and the release workflow remain unchanged. A failing new job therefore prevents the entire exact-source Checks run from succeeding before tag creation; installer testing still repeats normally afterward.

The new job uses a shared Rust cache key matching the existing Intel release job's platform key plus its automatic job-ID suffix. The action's current [key construction](https://github.com/Swatinem/rust-cache/blob/v2/src/config.ts) and [default inputs](https://github.com/Swatinem/rust-cache/blob/v2/action.yml) were read: ordinary `key` includes the job ID by default, whereas `shared-key` replaces that combination. Rust/environment/dependency hashes and GitHub cache scope still determine actual reuse; a cache hit is not assumed. No existing cache configuration was changed.

Verification:

- PyYAML parsing and focused structural assertions: PASS. Confirmed exact release runner/target/build/test parity, Node 22, no Python override, no job/step condition or continue-on-error, and identical prior jobs/top-level workflow after removing the one added job. Confirmed the release workflow has no diff.
- `python3 scripts/release-ci-test.py`: **10/10 PASS**, including fail-closed exact-source Checks authorization.
- `python3 scripts/release-version-test.py`: **3/3 PASS**.
- `git diff --check`: PASS.

No Cargo build, Native fixture/source modification, remote CI dispatch, installation, application launch or live-service access was performed. `actionlint` is not installed on this host; parsed structure and existing offline release-gate tests were used instead. Actual Intel execution remains the new exact-source CI gate after root integration. The independent Native author owns the separate hostname-dependent test fixture correction.
