# Independent review: Windows SDK package test selection

Reviewed candidate: `28b09803d3cda5154c2cf85d06fe50cb532c4d46`, parent `8fbd9dda5ee93fe1c0174302024123aefd1b6261`. Review date: 2026-11-08. Reviewer is independent of this CI change and the qualified SDK implementation. Scope is the [narrow task](../tasks/improvement-sdk-windows-check.md), workflow selection and the candidate's coverage document; no platform execution claim.

**PASS for merge as a CI coverage correction. No blocking or nonblocking defect found. Actual Windows execution remains pending a fresh Actions run.**

## Independently checked

- `git show` confines implementation changes to one Windows step: append `-p remote-agent-sdk` to the existing `cargo test --locked --release -p anywork -p anywork-desktop`. No SDK source/test changes, build/package removal, filters, ignores, fallback, permissions, triggers, dependencies, job timeout or failure handling change.
- Parsed before/after YAML using PyYAML; structurally compared the entire workflow after restoring that single command in memory. The structures match exactly, and the replacement command selects all three intended packages. The preceding native build still runs normally. Compiling SDK as a dependency previously did not run its package tests.
- Enumerated test function attributes in actual SDK source at the candidate: `src/qualified.rs` has 18 tests, exactly two `cfg(unix)`; `tests/qualified.rs` has five, exactly one `cfg(unix)`; `tests/bridge.rs` has three, no platform gate. No test has an ignore attribute. Therefore the document's expected 26 Unix / **23 Windows** runnable tests (16 unit + 4 qualified integration + 3 legacy bridge) match static source. Unix-only names match the document. There are no SDK doc-test examples providing additional claimed test coverage.
- Inspected actual stdio integration helper and cfg boundaries. Windows selects `python`, elsewhere `python3`; the four common integration tests retain real fake-process/pipe assertions rather than a Windows-specific mock or skip. Whether Windows runner Python/process behavior meets those assertions is deliberately left to Actions, not inferred from this review.
- `python3 scripts/release-ci-test.py`: **10 tests passed**, without publication or compilation. This checks existing release CI gates with synthetic API responses, not SDK native behavior.
- `git diff --check`: passed. No Cargo, native application, browser/assets, account/profile or production service was run or changed by this review.

## Required downstream evidence

A fresh Windows Actions log must enumerate and pass the SDK unit binary (16), qualified integration binary (4), and bridge binary (3). An old green run, transitive build, static count or this review is insufficient. Linux/macOS actual behavior and all broader native acceptance/runtime/bridge migration gates retain their separate source and execution evidence. A genuine platform failure must be kept and fixed through a source review, not hidden with a new skip. The candidate document accurately separates these limits.
