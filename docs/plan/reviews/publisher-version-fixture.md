# Publisher versioned asset fixture correction

Author verification, 2026-11-14. Independent review pending.

Base: `6552b19e814984f215851f9f95816677c62501c4`, actual source version
`0.1.36`, isolated branch `codex/publish-version-fixture`.

The unmodified `python3 -B scripts/publish-test.py` reproduced the CI failure:
33 tests ran in 16.294 seconds, with exactly one failure at the missing-asset
assertion. The current-version fixture correctly generated the split release,
and the production verifier reported `Release must contain exactly the expected
23 assets`; the test still matched `20 assets`.

The current-version test now derives the expected count from
`assets_for_tag(tag)` before damaging the fixture and matches the complete
asset-count error. Existing digest and website rejection assertions remain.

The existing version table independently retains literal expected counts:
`v0.1.13` and `v0.1.34` require 20 assets; `v0.1.35`, `v0.1.100`, `v0.2.0`
and `v1.0.0` require 23. Each complete fixture still passes asset, checksum,
APK identity, website and website-recovery checks. Each now also loses one
asset and must fail with its exact expected count. Existing mixed/universal,
duplicate and incomplete split APK rejection tests are unchanged.

After correction, the same full command passed all 33 tests in 12.944 seconds
against actual source version `0.1.36`. Python syntax compilation and
`git diff --check` also passed. Before/after logs are retained outside the
worktree under `artifacts/publish-version-fixture/` in the main workspace.

Only the test and this report changed. Production verification logic, version
files, release gates and workflows are unchanged. All publisher mutations used
temporary repositories and mocked HTTP. No real tag, release, build or website
deployment was invoked; the deployment worktree was not touched.
