# Schema migration and recovery contract

Status: implementation contract under the authorized prioritized improvement goal; not a claim of implemented backup/restore or expert approval. I05 covers migration, full backup, restore and retention. The first deliverable below establishes schema safety before I02 adds durable operation records. Other I05 deliverables remain open.

## Authority and boundaries

AnyWork's SQLite database owns its local session mapping, event cache, queue/edit state, composer metadata and feedback. Native histories and Agent account state outside the data directory retain their own authority. Uploaded attachments reside in the data directory; a JSON conversation export is not a full backup. The service token and native account credentials must not appear in public diagnostics or test artifacts.

Replacing application binaries does not roll back the database. An older binary must refuse an unsupported newer schema rather than resetting `user_version`, attempting repair or resuming tasks. A restore must never automatically deliver queued/uncertain work.

## First deliverable: versioned opening and migrations (I05a)

The existing schema is version 1. Opening a database first reads its version and checks that it is supported, **before** mutating journal mode, tables, indexes, recovery state or `user_version`. New databases and recognized legacy version-0 layouts are bootstrapped transactionally to version 1. A foreign or malformed database must produce an actionable error instead of being silently converted into an AnyWork store. For future versions, “no mutation” means no application write SQL, journal-mode change, checkpoint, DDL, recovery or version write before refusal; it does not promise byte-for-byte invariance of SQLite's own open/recovery/sidecar housekeeping. Tests must distinguish these claims.

Use an explicit ordered migration registry with a declared current version. Each step and version update commit in one SQLite transaction. Future schema versions fail closed without modifying logical contents. Failed schema/DDL operations roll back and must not run session/queue/edit startup recovery. Known versioned schemas must be validated for the tables, columns and indexes relied on by the application; a version number alone is insufficient proof of compatibility. Include primary/unique keys, cascading foreign keys, AUTOINCREMENT and sequence preservation, replay-index expressions/partial predicates and a defined unknown-table/index/trigger policy. Do not accept an unexpected trigger merely because required object names are present.

Initialization must preserve all existing event sequences, source identities, queues, edits, composer metadata and feedback. Legacy tables may be absent only where the old supported schema genuinely did not contain that feature; define the recognized legacy shapes from fixtures and current code, not arbitrary guesses. Malformed required JSON must not be replaced with empty state as a repair shortcut.

Only after schema validation/migration succeeds may existing startup recovery mark in-flight local operations uncertain, pause persisted queues and mark self-managed active sessions disconnected. Session status plus its `connection/interrupted` event must commit together; queue `sending`→`uncertain` plus pause, and edit in-flight→`uncertain`, must not be left half-committed. Recovery must not contact native Agent processes or send commands.

Migration serialization is not authorization to recover another live service's work. Acquire an OS-released exclusive ownership guard for this database before application migrations/recovery and retain it for the Store/service lifetime; reject a second active opener with an actionable already-in-use error, without performing recovery. A PID file's existence is not sufficient proof of ownership or safe recovery. Define canonical-path/alias behavior and private lock-file permissions. Recheck the schema version under the migration transaction even after the guard. Concurrent startup tests must prove one owner, loser refusal without state mutation, and safe acquisition/reopen after the owner exits or crashes; they must not claim two live recovery-capable services are supported.

At this stage, avoid a fake version-2 migration that changes nothing. The next actual feature introduces its migration with meaningful legacy-to-current fixtures. Do not introduce a downgrade path or copy a live database file as an implicit backup.

## Later I05 deliverables (not fulfilled by I05a)

1. **Consistent backup**: define a maintenance/snapshot boundary for SQLite plus attachments and local metadata; use SQLite backup facilities or an explicitly quiesced service. Include a manifest with format/application/schema versions, complete component list and integrity hashes. Exclude credentials by default or require explicit encrypted/private handling. Raw copying of a running database while omitting WAL is prohibited.
2. **Restore and rehearsal**: validate the complete manifest and supported schema before altering a destination. Restore into a new private directory first, verify mappings/attachments, and require explicit cutover; never overwrite a running store. Native identities must remain verifiable. Restored queues remain paused and unknown operations remain uncertain.
3. **Retention and recovery policy**: determine RPO/RTO with the owner, define backups, pruning and orphan attachment collection. Active/uncertain operations and referenced attachments must not be pruned. Future-version refusal, application rollback and data restoration need separate user guidance.

These require their own accepted contracts and end-to-end evidence. I05 cannot be closed on schema-opening tests alone.

## I05a acceptance

- New empty database, current version-1 database and explicit recognized legacy fixtures open without data loss; future and foreign/malformed schemas are rejected before logical mutation.
- Transaction failure after DDL and before version commit leaves the original version/schema/data intact. Recovery does not run after such failure.
- Concurrent openers cannot both acquire live service ownership or run startup recovery; the rejected opener leaves the owner's state untouched. After exit/crash a new opener can recover, preserve rows/sequence IDs and roll back a real interrupted transaction.
- Startup recovery preserves existing safe behavior for queues/edits, performs no native RPC and does not reset uncertain operations into executable pending work.
- Isolated server HTTP restart test proves historical events, feedback and queues remain readable and no task is automatically replayed. Use a deterministic fake Agent, ephemeral ports and private temporary data only.
- Document the tested SQLite/filesystem/platform scope and remaining backup/restore work. Tests must exercise the real opening path, not a parallel test-only migrator.

## I05a implemented opening path and recognized layouts

The candidate opens through `Store::open` → `store::schema::open`; there is no parallel test-only migrator. The declared current version remains **1**. An ordered registry contains the real version-0 → version-1 bootstrap. Within the same immediate transaction, an explicit compatibility step completes the replay indexes that historical version-1 releases added without incrementing their version. Each transaction validates the version again, validates schema/data, completes schema/version changes and performs startup recovery before committing. No version-2 placeholder or downgrade is introduced. Only after successful commit does the connection select WAL.

Accepted nonempty layouts contain **all eight original tables**, their exact primary/unique keys, cascading foreign keys, defaults and AUTOINCREMENT declarations, plus `events_session_seq`. Checked-in SQL fixtures retain the actual historical DDL:

| Shape | Historical source / fixture | Allowed replay indexes before opening |
| --- | --- | --- |
| Original | `f42b8e1`, `store/fixtures/schema-v1-original.sql` | Neither |
| Harness | `613649d`, `store/fixtures/schema-v1-harness.sql` | `harness_replay_identity` only |
| Current | `cd6699a`, `store/fixtures/schema-v1-current.sql` | Harness and source indexes |

Those commits already stamped version 1. Version 0 is recognized **only** when its nonempty schema exactly matches one of these known shapes with a missing version stamp; the fixture tests deliberately clear that stamp. This is not a claim that a published version-0 release existed. No missing feature table is guessed or repaired. A genuinely new version-0 database must contain no schema objects. A source-only replay-index layout is not historical and is refused. Missing unique replay indexes are created transactionally; duplicate native source keys cause the opening to fail without deleting/deduplicating data or committing recovery.

Validation uses a conservative allowlist of schema SQL, normalizing formatting and case outside quoted string literals. JSON path expressions retain their exact case, and partial predicates, keys, indexes and foreign keys must match. Unknown application tables, indexes, views and triggers are refused, including unexpected triggers attached to otherwise valid tables. SQLite's normal `sqlite_autoindex_*`, `sqlite_sequence`, and ANALYZE maintenance tables `sqlite_stat1`/`sqlite_stat4` are allowed; invented internal object kinds/names are refused. The foreign-key declarations and cascading behavior are validated; opening does not run a whole-database foreign-key repair or delete legacy orphan event rows. I01 global scans continue to skip those rows fail-closed. Recovery that actually violates a constraint fails its entire transaction. Session/feedback JSON must decode to the existing typed model; queue/edit/composer metadata must be valid objects. These records support startup recovery or local Store metadata. Opening does **not** globally decode event payloads: I01 may skip hidden malformed payloads, while visible global scans and single-session reads retain their own decoding-error semantics. Index completion may still fail transactionally if SQLite cannot evaluate a required replay expression on legacy data; it never rewrites malformed events to empty objects. Recovery does not replace malformed required metadata with empty state. Opening scans the required metadata linearly, without a full transcript parse.

Session status recovery and its `connection/interrupted` event share the same transaction as queue sending→uncertain, queue pause and edit in-flight→uncertain. Existing event and queue sequences, deleted AUTOINCREMENT high-water marks, source identities, draft/composer metadata and feedback survive. Updating session status uses `json_set` so unknown non-status metadata is also retained. Recovery never constructs an Agent runtime or sends a command.

## Database ownership and filesystem boundary

The ownership guard lasts until after the SQLite connection is dropped. A stale guard file's presence does not imply a live owner: the OS lock determines ownership and is released on exit/crash. The implementation never uses PID-file existence or deletes a guard to force recovery. The new database is created with Unix mode 0600; permissions of an existing database are not changed before version/schema refusal.

- **Unix:** Darwin testing demonstrated that `flock` on the database inode interferes with SQLite itself, so the guard uses a separate `.anywork-db-<device>-<inode>.lock` in the canonical database parent. Device/inode identity makes symlink and case aliases resolve to the same guard. Hard-linked databases are explicitly refused because aliases in different parents cannot safely share an adjacent guard. The guard is a regular, single-link file owned by the service user with no group/other permissions; creation uses 0600 and `O_NOFOLLOW`. A symlink/insecure guard is refused, not repaired or truncated. Keep the database and its guard in a private local directory.
- **Unix same-process safety:** initialization is serialized within the process. An existing database is inspected with metadata calls, without opening/closing an independent raw database descriptor; a new raw descriptor is closed before another initialization can open SQLite on that inode. This avoids accidentally releasing an existing connection's POSIX record locks. The lifetime guard is on its own inode.
- **Windows:** a live database handle holds a fail-immediately `LockFileEx` lock of one byte at offset 2^62. This is outside SQLite's maximum database extent (below 2^48) and its reserved locking area near 2^30. No file data is written or extended by that lock; handle close releases it. Whole-file locking is avoided because it would block SQLite's separate handle. This code path requires native Windows validation; macOS tests or cross-compilation do not establish it.
- `:memory:` creates a separate ephemeral Store and has no cross-process ownership identity. SQLite URI paths are refused. The standard-library Unix locking API requires Rust 1.89 or newer; the supported build path uses current stable Rust.

External replacement/unlinking of a live database or its guard is outside this ownership protocol and is unsupported; stop the service before maintenance. Deliberately removing a live guard can defeat a path-based sidecar lock. This is not a portable lock against arbitrary external writers or filesystem replacement. Network filesystems, distributed locks and filesystems without reliable local OS-lock semantics are unsupported and unaccepted; a lock-provider error fails opening. Existing SQLite tools do not participate in the AnyWork ownership protocol. No full-backup/restore capability is implied.

Future-version refusal guarantees no application write SQL, journal-mode change, DDL, checkpoint, recovery or version write before rejection. Acquiring/creating the private ownership sidecar is filesystem bookkeeping and does not modify database logical contents. SQLite's own open/recovery/sidecar housekeeping remains outside the byte-for-byte invariance claim.

## I05a candidate verification evidence

The focused suite exercises production `Store::open`, including fault injection compiled only into tests at real transaction boundaries. Tests cover all six recognized stamp/layout combinations, fresh/current opening, future-version logical and journal preservation, malformed/foreign schemas and required metadata, hidden event payload tolerance/read errors, replay-expression case/partial-index identity, duplicate-key DDL rollback, recovery rollback, ANALYZE objects and deleted sequence high-water preservation. Ownership tests cover threads and two actual child processes, loser refusal without recovery, symlink/case aliases, hard-link refusal, private-guard validation, retention of SQLite record locks after a rejected opener, process kill, released ownership and rollback of a real uncommitted SQLite transaction.

`scripts/schema-recovery-test.py` runs the actual server with a deterministic fake Agent, private temporary HOME/data/workspace, ephemeral ports and an explicit fixture token. It checks an actual running owner cannot be recovered by a second service; then kills the isolated owner, restarts it and verifies historical events/feedback/queues/edit state, uncertain/paused recovery and no new fixture RPC across several queue-worker cycles or a second restart. A future-schema HTTP startup test checks nonzero exit with unchanged logical database and DELETE journal mode. No native profile, model service or production address is involved.

Developer-side results are recorded with the candidate handoff; independent review and merged acceptance remain required. Full I05 backup, restore, retention and RPO/RTO remain open.

Developer verification on 2026-11-07 used macOS 26.4 (25E246), Rust 1.97.1, the locked `rusqlite 0.37.0` / bundled `libsqlite3-sys 0.35.0`, and disposable local filesystem fixtures. All build outputs were isolated in this candidate's worktree `target` directory.

| Check | Observed result |
| --- | --- |
| `cargo test --locked --offline -p anywork` | 134 passed; 4 native/profile opt-in tests ignored. Includes 16 schema/ownership tests and the existing I01 Store tests. |
| `cargo clippy --locked --offline -p anywork --all-targets -- -D warnings` | Passed. |
| `cargo build --locked --offline -p anywork` | Passed; this binary was used in both HTTP suites below. |
| `ANYWORK_BINARY="$PWD/target/debug/anywork" python3 scripts/schema-recovery-test.py` | 2 passed: owner refusal/crash/restart/no replay, and future-version refusal. |
| `ANYWORK_BINARY="$PWD/target/debug/anywork" python3 scripts/event-scope-test.py` | 4 passed: accepted I01 all/workspace/three-Agent/SSE/poll/cursor behavior retained. |
| `cargo fmt --all -- --check`, `git diff --check` | Passed. |

These are developer results, not independent acceptance. Native Linux/Windows owner-lock/crash tests and network-filesystem behavior have **not** been validated. In particular, the Windows reserved-byte lock path needs native execution before claiming Windows I05a support. The four ignored native/profile tests were intentionally not enabled; neither a real Agent nor the running production service was accessed. No full backup/restore, operation ledger, retention or storage-degraded feature was delivered by this candidate.
