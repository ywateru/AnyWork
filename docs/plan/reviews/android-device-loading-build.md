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
