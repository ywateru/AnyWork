# Mobile coordination: ARM64 candidate workflow author report

2026-11-15. Base: `40e0548431bc4467f5046a8334edaee685ce15df`; branch `codex/mobile-coordination-build`. Scope is only `.github/workflows/android-candidate.yml` and this report. **Local configuration checks and subsequent exact-source CI/artifact checks PASS; device acceptance remains independently pending.**

## Delivered behavior

- Manual `workflow_dispatch` only, no inputs, one ARM64 job, `contents: read`, no publish/deploy/tag/version mutation. Existing release/Checks workflows are unchanged.
- Checkout explicitly uses `github.sha` with persisted Git credentials disabled. The source gate requires a branch dispatch and exact 40-character `HEAD == GITHUB_SHA`, then runs the existing local version-consistency guard without remote release checks. Version remains `0.1.41/code43`: higher than phone code40, equal to emulator code43 for a same-signer data-preserving replacement.
- Node22, Java17, SDK37.0, build-tools36.0.0, NDK27.2.12479018, stable Rust with only `aarch64-linux-android`, Gradle setup and ARM64 Rust cache reuse the existing release job. The sole build command is `./scripts/build-android.sh --release --target aarch64`; its locked Cargo build, R8, variant lint, JVM tests and APK checker remain authoritative.
- Existing repository Android signing secrets and alias `anywork` are passed through the existing environment contract. The temporary keystore is created with restrictive umask and removed in an `always()` cleanup step. No signing secret or keystore is included in uploaded paths.
- Before upload, APK signature verification must show exactly one signer with official certificate SHA256 `88b43f83632002fbeddd23a286eabee39c5ada0fa1b037d6ff32b9986a67acb8`. This supplements the canonical check against the configured keystore and prevents accidentally accepting a different signing identity.
- Artifact `android-arm64-candidate-<full source SHA>` contains only `anywork-android-arm64.apk` and `android-candidate.json`, retained seven days. JSON binds source SHA, repository, run/attempt/URL, APK SHA256/size, signer, package/version/minSDK and ARM64 target. `HEAD` is checked again before producing this record. No dynamic dispatch value is interpolated into shell code.

## Completed author checks

Executed only lightweight checks in this isolated worktree; no Cargo, Gradle, Android build, local signing, ADB, CI dispatch or cloud mutation:

1. PyYAML structural parsing: manual-only/no inputs, one non-matrix ARM64 job, read-only contents permission, explicit checkout and canonical command. Every shell block passed `bash -n`; both embedded Python blocks passed AST parsing.
2. Executed the real source/version gate locally: exact branch SHA accepted; a different SHA and a tag context rejected. Existing version-consistency guard passed with `0.1.41/code43`.
3. Compared Node/Java/Android/Gradle setup and pinned SDK/NDK commands against `release.yml`; they match. Rust target is explicitly ARM64.
4. Executed the artifact-record block in temporary **fixture** directories with mocked command output: one official signer accepted with correct SHA/hash metadata; foreign, multiple (including count10), missing signer and checkout mismatch rejected before writing a record. The retained v41 public signing output was a parser fixture; these checks do not establish a newly built APK's signer or runtime behavior.

Ignored helper/log: `artifacts/mobile-coordination-build/{validate.py,validation.log}`. `actionlint` was not installed; YAML, Bash and Python checks are not a claim that Actions has executed this new workflow.

## Next acceptance boundary

Independent review must accept the final workflow commit before dispatch. GitHub requires the new dispatch workflow on the default branch; after integration, dispatch a reviewed branch containing the exact intended source, with no inputs. Verify run `head_sha` equals that reviewed full SHA, and downloaded artifact/JSON/hash/signer agree. The workflow/report commit is part of that source SHA; the base above is not a claim about the future APK source.

The gateway deployment's source/deployment binding is separate from APK provenance. Route allowlist/deployment and actual phone/emulator registration, presence and authorized workspace reads remain outside this build-lane acceptance. No production APK, account data, installed app or existing retained v41 artifact was changed or redownloaded.

## Exact-source candidate delivery

Independent workflow review `3fd09c4` was accepted before dispatch. Using the existing publisher credential source `~/.ssh/ghp` through process-local askpass/environment, the coordinator-authorized source `e4f3650890eb1e9e8010be29fca607a12302435a` was pushed to main after reconciling the previous remote head. Global gh/keychain configuration was unchanged; no other credential sources were searched.

[Candidate run 43703073305](https://github.com/ywateru/AnyWork/actions/runs/43703073305) completed **success**, with only ARM64 job `132778214384`. No cancellation, retry, publication or version/tag change occurred. Canonical build, ARM64 Release lint, system/auth/core JVM tasks, App unit `NO-SOURCE`, APK checker, official signer/source record and upload all succeeded. Temporary signing-key cleanup succeeded. Numeric JVM case counts were not printed in the console and are not asserted here.

Artifact `14157625553`, named `android-arm64-candidate-e4f3650890eb1e9e8010be29fca607a12302435a`, was the only artifact downloaded. Its archive digest and run source binding passed. Actual downloaded APK verification passed:

- APK size **39,274,111 bytes**, SHA256 `f2161a5923b052858f1d72490d4bb39ee537f7b9ed04feee00e936c2f730ad26`.
- Single official signer SHA256 `88b43f83632002fbeddd23a286eabee39c5ada0fa1b037d6ff32b9986a67acb8`.
- `dev.remoteagent.app`, `0.1.41/code43`, minSDK26, ARM64 only, nondebuggable, `extractNativeLibs=false`, ELF/ZIP16KiB alignment.
- APK hash/size/certificate/identity match `android-candidate.json`; source SHA, repository, run and attempt match the completed GitHub run.

APK and small evidence are retained under root ignored `artifacts/mobile-coordination-candidate-e4f3650/`: `anywork-android-arm64.apk`, `android-candidate.json`, `verification.json`, `summary.md` and `candidate-ci.log`. Path/hash/certificate were handed to Hilbert for independent runtime verification; this lane performed no ADB or local builds. These artifact checks do not establish coordination/presence/workspace runtime acceptance. No workflow fix was needed during execution; root tracked files and local docs head `43325c6` were not changed or pushed by this lane.
