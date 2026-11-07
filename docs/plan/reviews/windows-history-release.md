# Windows persisted history correction review

Task: [Windows history release correction](../tasks/windows-history-release.md).

Reviewed exact commits `204eab7` (Harness paths and documentation), `0b271ad` (WorkBuddy fixture) and `cf77db1` (permanent Windows native CI gate). The isolated review branch applies those commits without product edits.

## Findings

- **P2, blocking, resolved:** Harness previously queried filesystem metadata for a bare Windows drive/verbatim prefix before appending its root. The failed Windows release log contains nine history failures with Windows error 1. `harness_history.rs::absolute_ancestors` now collects only complete absolute ancestors; drive, UNC, verbatim-drive and verbatim-UNC namespaces remain supported. Relative, drive-relative, root-relative, parent-traversal and device-namespace inputs remain rejected.
- **P2, blocking, resolved:** Checking `FileType::is_symlink` alone does not exclude every Windows junction. `safe_path` additionally rejects `FILE_ATTRIBUTE_REPARSE_POINT`. Project directories are checked before enumeration, and session directories before generation selection. The final candidate adds real isolated Windows junction checks for both file access and catalog discovery. Existing Unix symlink tests remain enabled. Regular-file, compressed-frame, generation and size limits are unchanged.
- **P2, blocking, resolved:** The WorkBuddy catalog fixture used a Unix-only absolute workspace path. It now stores an absent platform-native absolute path as a SQL parameter and asserts that the returned cwd is identical. All prior account-partition, cloud/hidden/deleted exclusion, title, status, activity, archive-state and unchanged-database assertions remain. Additional cases reject nonabsolute paths without modifying the database; Windows also covers drive-relative and rooted-without-drive syntax. Production WorkBuddy validation is unchanged.
- **No open source findings:** The CI change adds an unconditional Windows native build/test job for main and pull requests, using the same locked release-mode server/desktop commands as packaging. It neither filters out the failing tests nor permits failures. No private native data or local paths were introduced.

## Independent verification

- Combined candidate: `cargo test --locked --offline -p anywork` — **117 passed, 4 existing explicit native opt-ins ignored** on macOS. This includes the portable absolute/parent-path regression, all existing Harness reader cases, and the platform-native WorkBuddy catalog/rejection cases.
- Separate WorkBuddy persisted-history run — **10 passed, 1 existing native opt-in ignored**.
- `cargo fmt --all -- --check` and `git diff --check` passed.
- Reviewed the original private Windows job evidence and the final Windows-only drive/UNC/verbatim/junction assertions. Those platform-specific tests cannot execute on this macOS host.
- No native prompts, account-store reads, application restarts, service changes or release actions occurred during review.

## Conclusion

**Pass for merge. Windows release acceptance remains pending the actual Windows CI build/test and packaging results.** A local source review or macOS test result does not replace that platform gate. Keep the failed v0.1.11 tag immutable and publish only a newer successfully validated version.

## Linux sidebar browser gate follow-up

Reviewed exact test-only commits `12959b1` and `e8327a8`. The original Linux Chromium Android failures stopped at the first list-bottom assertion, leaving the entire scroll range unconsumed. Independent inspection of the retained failure trace's final image shows projects 00–05 still at the top, with the header and footer intact. A single 10,000px synthesized touch from the list centre is not a valid bounded on-screen finger stroke; that result does not establish a product containment failure.

**P2, blocking test finding, resolved in source:** The test now keeps touch endpoints 16px inside the visible list, prevents fling, and reaches each boundary using a finite gesture budget derived from the scroll range and stroke length. Each interior stroke must make observable progress and preserve the shell, document, header, footer and list geometry. All original end-row visibility, exact top/bottom, repeated boundary gestures, overscroll styles, menus, fixed-control and empty-list assertions remain. There are no DOM scroll assignments, skipped cases, retries or product changes. The mobile boundary cases receive 45 seconds because traversing the fixture in real repeated strokes takes longer than the invalid oversized gesture.

Independent execution against the existing exact preflight Web assets and an isolated fixture server passed **all six desktop/Android browser cases**. The short Android case took **32.4 seconds**, independently demonstrating the need for its 45-second budget. Both normal and short Android screenshots reach conversation 79 with the footer retained and no document blank area. Prettier and diff checks passed. Browser output stayed in temporary review storage; the production Web directory and actual service were untouched.

**Pass for merge; actual Linux Chromium CI remains required before publication**, alongside the Windows platform gate above. macOS Chrome success is not recorded as Linux acceptance.

## Windows lexical-parent fixture follow-up

Windows gate run `42337544975` passed 96 server tests, including the new drive/UNC/verbatim and actual-junction cases, but failed the portable rooted-path test. The release gate remained closed. Its fixture called `PathBuf::join` on a canonical Windows verbatim root; Rust normalizes parent components during that operation, so the supposed traversal no longer contained `..` when passed to the validator.

Reviewed exact test-only correction `e204f42`. It appends the suffix through `OsString` with native separators, explicitly asserts that a `ParentDir` component survives, and requires the exact lexical rejection error rather than accepting an unrelated filesystem error. The valid existing-file check and all other path boundary assertions remain. Removing the old `exists()` assertion avoids making Windows verbatim filesystem resolution semantics part of a lexical-validation contract; the new component/error preconditions directly prove the required rejection. No production path logic changed.

Independent `cargo test --locked --offline -p anywork harness::` passed **19 tests with one existing native opt-in ignored**; format and diff checks passed. **Pass for merge; the next actual Windows CI run is still required before publication.** This local fixture verification is not a Windows pass claim.
