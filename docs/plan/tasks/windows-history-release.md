# Windows persisted history release correction

The authorized 0.1.11 release matrix compiled on all targets, but Windows native tests exposed ten failures: nine Harness history path checks returned Windows error 1; one WorkBuddy catalog fixture used a Unix-only absolute cwd. No 0.1.11 release was published; keep its tag immutable and publish the corrected source with a newer version.

Required behavior: read explicit Windows native history roots with drive/UNC root semantics, without inspecting a drive-relative prefix as an absolute directory. Preserve parent-component, symlink/reparse and bounded-file protections. Do not hide failing tests, relax the directory boundary or ignore a supported platform. WorkBuddy fixture paths must be platform-native while retaining all catalog assertions and read-only DB checks.

Harness developer owns `harness_history.rs` and regression coverage. WorkBuddy developer owns its catalog fixture/path inspection only. Independent verifier reviews exact committed fixes, original Windows job evidence and read-only path semantics. Root owns merge, combined checks and new-version publishing; the real native applications and local AnyWork service remain untouched.

Evidence: failed release run `42336235874`, Windows job `128293715544`; private copied job log is excluded from public source. Windows rerun is the final platform gate. Local complete preflight passed 157 Rust, 309 Web unit and 593 browser cases (one existing desktop-only case skipped on Android), all service/interface checks, Android debug/Lint/unit and updater UI checks before this platform-specific correction.

Status: investigating; release blocked until corrected native Windows tests and packaging pass.
