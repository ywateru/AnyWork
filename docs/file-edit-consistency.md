# Conditional text-file saves — I04 candidate

Status: isolated implementation candidate, not independently accepted or merged. This document records the proposed contract and evidence, not a claim that I04 is resolved.

## HTTP contract

`GET /api/sessions/:id/files?path=...` returns `{ "content": "...", "revision": "sha256:<64 lowercase hex>" }` for a UTF-8 regular file. The digest identifies the exact bytes read, including CRLF and trailing newline. Text preview and save are limited to 2 MiB.

`PUT /api/sessions/:id/files` accepts `{ "path": "...", "content": "...", "expected_revision": "sha256:..." }`. The expected digest must match the current bytes. Explicit `expected_revision: null` means create only; it never replaces an existing file. Missing preconditions return HTTP 428 with `code: file_revision_required` and an actionable upgrade/refresh message. Unknown fields and malformed digests are rejected. No legacy unconditional-write fallback exists.

A mismatch, deletion of a previously read file, or create collision returns HTTP 409 with `code: file_revision_conflict`. Success returns `{ "ok": true, "revision": "sha256:..." }`. Clients must use this returned revision as the next baseline. Existing integration/browser fixture callers now explicitly request create-only for their newly created files.

Save errors use `{ "error": "...", "code": "...", "delivery_state": "not_written" | "uncertain" }`. A replacement error or failed parent-directory synchronization returns 503 `file_save_uncertain`; the client must compare the current file rather than blindly replaying the write. A lost response or worker failure likewise requires comparison even if no structured uncertainty is available.

## Publication and boundaries

Within one AnyWork server process, writes to the same canonical parent plus filename share a mutex across sessions and path aliases. The server checks the expected bytes, writes a unique same-directory temporary file, preserves the existing file's permission bits, synchronizes the temporary file, checks current bytes again, and publishes it. Existing files use filesystem rename replacement. Create-only uses an atomic hard link into the absent destination; unsupported filesystems fail rather than falling back to a destructive operation. Temporary files are removed on normal failure paths.

Save rejects final symbolic links and non-regular files; parent resolution retains the session workspace boundary. Unix file opens use no-follow/nonblocking flags. Windows uses an open-reparse-point flag. There is no unlink-before-replace or truncate-original fallback. Replacement changes inode identity, so hard-linked aliases do not retain shared content. Ownership, ACLs, extended attributes, resource forks and custom security labels are not copied; only ordinary permissions are preserved. Crash termination can leave an unreferenced `.anywork-save-*` file.

On Unix, successful publication is followed by parent-directory fsync. Windows has no portable directory-fsync equivalent in this implementation, so equivalent crash durability has not been established. Replacement and hard-link semantics still depend on the host filesystem. Windows and Linux execution remain unverified; macOS is the tested host.

This is **not atomic compare-and-swap against arbitrary external writers**. A native editor or Agent that does not share the AnyWork mutex can still write between the final comparison and rename. External mutation of parent directories, mount points or hard-linked aliases is also outside this guarantee. A digest cannot detect a change that returns to identical bytes. Multiple AnyWork server processes do not share the mutex. Stronger cross-process ownership/locking would require a separate protocol and cooperation from those writers.

## Web behavior

The editor retains its draft after conflicts, transport failures, malformed success responses and uncertain results. It offers copying the draft, fetching and comparing the latest file, explicitly adopting that revision while keeping the draft, or explicitly discarding the draft and loading the latest content. Ordinary save retries keep the original expected revision until the user selects a new baseline; comparison alone does not silently enable overwrite.

A successful save marks only the captured submitted text as saved. Text typed during the pending request stays dirty. Save/compare responses are ignored when their file, session, API instance or view generation no longer matches, including switching away and back or refreshing the same file. A legacy server without revision support disables saving and asks for an upgrade. Draft persistence across intentionally closing a file, navigation, browser reload or process crash is not provided by this candidate.

## Verification evidence and remaining acceptance

Executed in the isolated `codex/improve-file-consistency` worktree, without changing production assets or running native Agents:

- `cargo check --locked -p anywork`: passed.
- `cargo test --locked -p anywork files::tests -- --nocapture`: 8 passed. Cases cover missing/null/hash preconditions, exact byte revisions, stale-save conflicts, concurrent AnyWork saves, create collisions, injected prepublication failure, late external changes before the final check, large/special files, Unix permissions, symbolic links, FIFO and workspace traversal.
- `cargo build --locked -p anywork`: passed.
- Web TypeScript typecheck: passed, including the final view-generation adjustment.

Not yet accepted: real authenticated HTTP route/JSON behavior, browser interaction and delayed-response regression tests, full existing integration suite, Linux/Windows behavior, network filesystems, post-publication/directory-sync fault injection and an independent exact-commit review. Unit fault injection happens before final publication and does not establish arbitrary external-writer CAS. These gaps must remain visible in the project review and acceptance tracker.
