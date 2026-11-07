---
id: improvement-g0
scope: prioritized-project-improvement
status: in-progress
depends-on: []
---

# G0: Correctness and delivery gates

The user authorized implementation in the priority order of [the project review](../../project-improvement-review.md). This task begins that continuing objective; completing G0 does not complete all 30 improvement issues. Do not publish a version, restart production or send real native tasks during implementation.

## Objective and decomposition

1. **I01 / event-scope**: all-event SSE and poll obey the same current Agent/workspace scope as session access, without blocking scan progress through hidden rows. Integrate the Web polling cursor contract and isolated regressions.
2. **I04 / file-consistency**: reads return a content revision; saves require an expected revision or explicit create-only condition, reject conflicts, use durable atomic replacement, preserve the draft and handle late results in Web. This is protection against cooperative/conventional concurrent edits; portable filesystem APIs cannot promise CAS against an arbitrary external writer in the final check/rename window. State this limitation.
3. **I20/I22 / delivery-gates**: enforce successful trusted exact-SHA Checks in the Release workflow itself (including manual/tag/legacy paths), fix Docker to build server only, and add clean container validation. Preserve immutable releases and independent Pages recovery. No real publication.
4. **I25 / support-matrix**: consolidate current supported/read-only/experimental/native acceptance states; fix stale overview/version/SDK/publishing claims and link them to evidence. Root owns this documentation once implementation contracts settle.

## Integration contracts

### Global event cursors

`GET /api/events/poll` returns `{events,cursor,has_more}`. Cursor is the highest scanned global sequence, even when all scanned events are invisible. With no `after`, establish a high watermark without replay. Non-negative cursors only. Filtering uses current session scope for all supported Agent IDs; unknown/deleted sessions do not leak. Limit scanned work per batch, allow continued draining using has_more. SSE sends visible normal events only, may send a cursor-only named checkpoint frame containing no hidden session/payload; older readers must not be passed a fake AgentEvent. New Web polling reads the response cursor, retains compatibility when legacy servers lack it, and never regresses. Per-session streams remain session-scoped.

### Conditional text-file saving

Text read returns `{content,revision}` with a SHA-256 identity of the exact read bytes. PUT accepts `{path,content,expected_revision}`; null explicitly means create-only, missing precondition returns 428, mismatch/existing-create/missing-old returns 409 with a stable error code. Never accept an omitted precondition as permission to overwrite. Success returns new revision; preview/save retain the 2 MiB and existing canonical-path/symlink/session boundaries. Old browser code gets an actionable refresh message, not an unsafe compatibility fallback.

Serialize AnyWork writes to the same resolved destination, compare the latest bytes immediately before replacement, use a same-directory unique temporary file, sync and atomically replace; preserve existing file permissions. Reject unsupported/unsafe file types. Platform-specific replacement must not silently remove the original before rename or fall back to truncating it. Clean temporary files on failure; when durability outcome is uncertain report it without blind retries. New-file creation must not clobber a concurrently appearing file. Web retains text on conflicts and failed/uncertain saves, offers explicit comparison/reload/copy actions, does not silently overwrite on retry, and ignores responses belonging to a different file/session. Do not claim native cross-process atomic CAS.

### Release Checks gate

All publishing runs verify required Checks workflow identity, pinned source SHA, trusted repository/main event (`push` or explicit `workflow_dispatch`), completed success; missing/failed/cancelled/wrong-SHA/fork/PR run cannot authorize release. Waits are bounded with useful Actions URLs. Recheck at the publishing boundary. Exact successful runs are reusable. Nonpublishing build-only runs may remain available without publication permission. Legacy prepare must either dispatch exact-source Checks explicitly (GITHUB_TOKEN push does not cause on-push CI) or be retired with instructions; never retain the bypass. Test GitHub reads against mocked transport; do not trigger Actions during tests.

### Container

Container builds only `anywork`, does not depend on desktop UI or GTK/Tauri. Validate source export, clean build, non-root process, authenticated API, Web/source version and persistence with isolated paths/ephemeral port, without native account/model requests. If Docker is unavailable locally, record that and add a real CI job; do not label a static check as actual image acceptance.

## Paths / ownership

- event-scope: `crates/server/src/api.rs`, `crates/server/src/store.rs`, `web/src/api.ts`, new focused cursor tests, `scripts/event-scope-test.py`, `docs/global-event-scope.md`.
- file-consistency: `crates/server/src/files.rs`, `web/src/components/Workspace.tsx`, existing file browser tests/callers requiring conditional updates, `scripts/file-consistency-test.py`, `docs/file-edit-consistency.md`. Avoid editing shared API/store/SDK unless reported back as a dependency first.
- delivery-gates: `.github/workflows/`, `Dockerfile`, new release-gate/container scripts and tests, related `docs/releasing.md`/`docs/deployment.md`; do not edit `scripts/publish.py` without flagging dependency.
- root: docs index/architecture/API contract references, support matrix, task/review status and final `scripts/check.sh` registration.

## Verification

Each developer commits focused source and meaningful tests, then a separate verifier reviews exact commits and runs integration boundaries in an isolated worktree. Use worktree-specific build targets and Web output; never overwrite running service assets or shared binaries while another candidate is being tested. Root merges accepted commits sequentially and runs merged Rust/HTTP/Web checks appropriate to the cross-cutting changes, then records actual results. Existing fixture clients sending file PUT must adopt the read revision; do not weaken conflict protection to satisfy them.

After G0, continue with G1 (I02/I03/I05/I07/I08/I09/I10 and critical I11/I12), then G2/G3 and approved G4 choices. Preserve all uncompleted issues and acceptance gaps in the continuing tracker.
