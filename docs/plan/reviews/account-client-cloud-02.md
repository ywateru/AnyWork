# Independent client-entry Cloud review 02

Reviewed exact fix candidate: `edc67a8a6e5554a0485342681a7b3af293ab3306`, including the changes from original candidate `5d803e1733b8aa830ed6e2818f70404221732715`. This is an independent re-review against the Cloud lane in `account-client-entry` and the findings in `account-client-cloud-01.md`. The review commit changes this report only.

## Decision

**Pass for the scoped Development-first Cloud source/configuration change.** CC1 is resolved, and the previously pending pinned Vercel environment-precedence check is complete. No additional blocking finding was established. This decision permits integration and subsequent merged-system verification; it does not claim that a deployment, self-hosted Logto migration or real remote-device acceptance has occurred.

## CC1 resolved: source offer reads immutable commit objects

`scripts/assemble-vercel.py` now passes its verified full HEAD SHA explicitly to `source-archive.py --revision`. The new revision path in `scripts/source-archive.py` requires a full lowercase 40-character commit identity, enumerates that commit's Git tree, applies the existing public-source filter and reads each included file from its immutable blob. It rejects public symlinks and non-regular Git entries, including submodules, rather than dereferencing their working-tree replacements. Regular executable/nonexecutable file modes are retained, and archive owner metadata remains neutral. The default exporter without `--revision` preserves the pre-existing working-tree contract.

This separates the environment-derived deployment CSP from the source offer without removing the CSP before Vercel consumes it. The source archive contains the committed `vercel.json`, while the prepared deployment configuration contains the selected public origins. The archive also contains the preparation rule responsible for that derivation; `build.json` retains the matching commit identity.

Independently repeated the original real temporary-Git reproduction using the committed scripts: missing bindings and stale CSP reject assembly; complete self-hosted bindings prepare and assemble successfully; `build.json` equals HEAD; archived `vercel.json` now equals `git show HEAD:vercel.json` and does not contain the environment-derived replacement origin. The new committed integration test additionally compares every archived public file with the corresponding HEAD blob after preparation and checks private `.env` exclusion plus executable mode preservation. Separate source-export tests verify that dirty working-tree/index bytes are ignored and that a committed public symlink still rejects export even when replaced by an ordinary working-tree file.

## Pinned environment precedence verified

Inspected the public npm packages for Vercel CLI **50.28.0**, the workflow's pinned version, and `@vercel/static-build` **2.8.45**. No authenticated CLI invocation was used. In the CLI's `dist/commands/build/index.js:540`, the pulled `.vercel/.env.<target>.local` file is loaded through its bundled dotenv4 implementation. That actual implementation, in `dist/chunks/chunk-5FSDBRAA.js:58`, assigns `process.env[key] = process.env[key] || parsedObj[key]`; it therefore preserves the five required nonempty job variables. The static builder constructs its build-command environment from `process.env` (`dist/index.js:33701`) and passes it through to the command (`:33755`). No conflicting override of these five application variables was found in the inspected call chain.

Independently executed the actual bundled dotenv implementation with five synthetic conflicting job/project values: all five explicit job values survived, while an unset optional variable loaded from the project file. The workflow now supplies a nonempty default for the optional `VITE_ACCOUNT_PORTAL_URL`, closing that optional-value ambiguity. This verifies the preparation/build binding for the explicit workflow variables rather than assuming behavior from locally cached newer CLI versions.

## Independently executed checks

- `python3 scripts/cloud/test_configure.py`: **9 passed**.
- `python3 scripts/cloud/test_frontend.py`: **7 passed**, including actual temporary CLI execution and prepare → assemble → immutable source-byte comparison.
- `python3 scripts/cloud/test_deploy.py`: **18 passed**, including unknown POST outcomes, state-save failures, stable-operation recovery, configuration changes, ambiguity and release dispatch boundaries.
- `python3 scripts/source-archive-test.py`: **6 passed**.
- `python3 scripts/publish-test.py`: **28 passed**. Publication URLs/log messages are offline fixture output; no publication occurred.
- Independent temporary-Git integration reproduction: missing binding rejected; stale CSP rejected; self-hosted assembly succeeded; declared identity and archived config matched HEAD.
- Actual pinned dotenv execution with synthetic conflicting values: five explicit job values preserved.
- `bash -n scripts/check.sh` and `git diff --check`: passed.

These are **68 scoped offline tests**, plus the independent CLI/Git reproductions. No full Rust/browser/OAuth rerun was needed for this Cloud-only correction. `scripts/check.sh` retains its existing checks and includes the three offline Cloud suites. The publisher and deployment-recovery checks passed without a change to immutable release behavior.

## Accepted scope and remaining system boundaries

The prior review's accepted observations remain: five public bindings are complete and explicit, missing bindings cannot silently combine Development and production defaults, self-hosted issuer/Grid changes require configuration rather than issuer-specific code, and preparation plus assembly reject stale or incomplete CSP/configuration. `ANYWORK_ACCOUNT_READY` allows the authorized Development-backed phase while still failing when absent/false; documentation continues to require actual account/encrypted-device acceptance and independent review before enabling deployment. A Vercel production deployment target does not turn a Development Logto tenant into a production tenant. Purchasing the historical Cloud production subscription is not a prerequisite for this phase.

No cloud write, deployment, OAuth operation, shared grant refresh, paid action or readiness-flag change was performed. Real registration/email, enrolled-device/remote lifecycle, physical phone/network checks and CyberGrid distribution permission remain separately tracked system/release gates. The proposed future sanitized static prebuilt staging was inspected only: pinned CLI50.28 treats `builds.json` as optional and its prebuilt uploader limits uploads to `.vercel/output/**`; that read-only observation does not authorize or attest to an actual deployment.
