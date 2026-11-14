# Android device-loading candidate: build verification

2026-11-14. **PASS for ARM64 build and downloaded APK checks; device runtime acceptance pending Hilbert.** This report records existing evidence; no additional build or tests were run to prepare it.

| Item | Exact value |
| --- | --- |
| Product source | `b00464a6df98e9ca61e526d89a332f0acd921b93` |
| Source branch | `codex/android-loading-investigation` |
| Workflow run | [43570167244](https://github.com/ywateru/AnyWork/actions/runs/43570167244), `release.yml`, `workflow_dispatch`, `publish=false`, tag empty |
| ARM64 result | Job `132372646560` completed/success; artifact `14104343251` (`android-arm64`) uploaded successfully |
| APK | `anywork-android-arm64.apk`, **39,276,359 bytes** |
| APK SHA256 | `2b9fdcdfe5f4e7a39e20058876061e98513e8428ebd845f555b1c1b6c32da4d7` |
| Signer certificate SHA256 | `88b43f83632002fbeddd23a286eabee39c5ada0fa1b037d6ff32b9986a67acb8` |
| Identity | `dev.remoteagent.app`, versionName `0.1.38`, versionCode `40`, minSDK `26` |

## Observed canonical build and artifact checks

- CI produced the ARM64 Release APK. Postbuild Gradle reported `BUILD SUCCESSFUL`: 205 actionable tasks, 100 executed and 105 up-to-date. `:app:lintArm64Release`, system/auth `testDebugUnitTest`, and `:anywork-logto-core:test` succeeded. App `testUniversalDebugUnitTest` explicitly reported `NO-SOURCE`; console evidence does not establish a numeric JVM case count.
- The canonical APK checker passed identity, bundled UI, native libraries, signing and 16KiB alignment before artifact upload.
- Downloaded APK verification independently passed APK Signature v2 and matched the installed official v38 certificate supplied by Hilbert. Exact single ARM64 ABI, ELF PT_LOAD/ZIP 16KiB alignment, uncompressed native library, absent `.symtab`/`.debug_*`, and bundled `mobile.html`/NOTICE keys passed.
- Post-R8 DEX retains `org.rustls.platformverifier.CertificateVerifier`, `StatusCode` and `VerificationResult`. The JNI signature `verifyCertificateChain(Landroid/content/Context;Ljava/lang/String;Ljava/lang/String;[Ljava/lang/String;[BJ[[B)Lorg/rustls/platformverifier/VerificationResult;`, result `code:I` and `getValue()I` are preserved.
- Manifest is nondebuggable, with `extractNativeLibs=false` and `usesCleartextTraffic=false`. Its network-security resource reference resolves to optimized `res/8G.xml`; the complete structure and domain list match pinned verifier AAR `0.2.0`: base cleartext disabled, with 376 explicit CRL domain exceptions. `aapt xmltree` supplied binary XML text nodes omitted by `apkanalyzer`.

## Evidence and acceptance boundary

Ignored evidence is under `artifacts/android-loading-candidate/` in the `android-loading-build` worktree: `dispatch.json`, `arm64-job.json`, `arm64-ci.log`, `artifacts.json`, `verification.json`, `summary.md`, signing/manifest/resource/DEX outputs. Candidate path handed to Hilbert:

```text
/Users/water/work/2026/any-work/.worktrees/android-loading-build/artifacts/android-loading-candidate/arm64/anywork-android-arm64.apk
```

Hilbert received path/hash/certificate after baseline verification so the authorized data-preserving upgrade could overlap remaining read-only inspection. Actual Samsung loading recovery, retained login/data and functional runtime acceptance remain pending his report. Build/package success does not establish those outcomes.

No version/tag change or Release publication occurred. This build lane did not invoke ADB, install/uninstall, clear device data, access account data or production private keys, or run local Cargo/build commands. Parent will retain candidate/evidence before worktree cleanup; the current handoff path remains intact.

## Second candidate: safe failure-stage diagnostics

| Item | Exact value |
| --- | --- |
| Product source | `f5a0ae09aa2314e1519fcbb98ed7705c63200ee6`, descendant of the first TLS candidate, same source branch |
| Workflow run | [43573253953](https://github.com/ywateru/AnyWork/actions/runs/43573253953), `release.yml`, `workflow_dispatch`, `publish=false`, tag empty |
| ARM64 result | Job `132381965193` completed/success; artifact `14104779424` (`android-arm64`) uploaded successfully |
| APK | `anywork-android-arm64.apk`, **39,274,111 bytes** |
| APK SHA256 | `106be0556f7cdb6f81823375f0656b287a301037b6bb968f63d1402698b8c736` |
| Signer certificate SHA256 | `88b43f83632002fbeddd23a286eabee39c5ada0fa1b037d6ff32b9986a67acb8`, matches installed official v38 |
| Identity | `dev.remoteagent.app`, versionName `0.1.38`, versionCode `40`, minSDK `26` |

**Second ARM64 build/artifact checks PASS; second-candidate device stage confirmation pending Hilbert.** CI logs show `BUILD SUCCESSFUL in 44s`, successful ARM64 Release lint, system/auth/core JVM tasks, App unit `NO-SOURCE`, canonical identity/assets/signing/native/16KiB checker and artifact upload. Downloaded APK independently passes the same signature, exact single ARM64 ABI, ELF/ZIP alignment, stripped native, bundled assets, JNI/DEX preservation and complete pinned CRL manifest-config checks described above.

Ignored second-candidate evidence, including complete ARM64 job log and `verification.json`, is under `artifacts/android-loading-stage-candidate/`. The download completed over a slow connection; subsequent optional `gh run view --log` failed, but the full job log had already been saved independently using the job-logs API. Neither event indicates a build or APK verification failure. Candidate handoff path:

```text
/Users/water/work/2026/any-work/.worktrees/android-loading-build/artifacts/android-loading-stage-candidate/arm64/anywork-android-arm64.apk
```

Hilbert received the verified second APK path/hash/signer immediately on download completion. After securing the artifact, this lane cancelled only the remaining jobs in this second nonpublishing run. GitHub confirms whole-run `completed/cancelled`; its ARM64 job remains `success`. The first run was already completed when cancellation was considered, so no cancellation was sent for it. Exact lifecycle observations are saved in each evidence directory's `intentional-cancellation.json`.

For the **first** candidate only, Hilbert separately reported data-preserving `install -r`, API28 startup/SSO/AccountAPI record success and removal of permanent loading, with zero verifier initialization/panic/Java fatal/JNI errors in the new process; see his runtime report commit `6e6a331`. Device state remained `Unknown`, its confirmation button disabled and workspace connection unverified. These are Hilbert's observations, not tests rerun by this build lane. His second-source independent review was accepted in report `34c7baf`; that does not establish second-APK runtime acceptance. Both APK paths remain intact; no publication, version/tag edits or local build/device commands were added.
