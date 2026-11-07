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
