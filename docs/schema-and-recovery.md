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
2. **Restore and rehearsal**: validate the complete manifest and supported schema before altering a destination. Restore into a new private directory first, verify mappings/attachments, and require explicit cutover; never overwrite a running store. Native identities must remain verifiable. Restored queues remain paused and unknown operations remain uncertain. Once the message ledger is introduced, rotate its incarnation before serving commands from a restored/rolled-back snapshot; old client journals cannot treat missing restored operations as safe to resend. Preserve used-ID tombstones and expose lineage changes for explicit reconciliation; see [message operations](message-operations.md).
3. **Retention and recovery policy**: determine RPO/RTO with the owner, define backups, pruning and orphan attachment collection. Active/uncertain operations and referenced attachments must not be pruned. Future-version refusal, application rollback and data restoration need separate user guidance.

These require their own accepted contracts and end-to-end evidence. I05 cannot be closed on schema-opening tests alone.

## I05a acceptance

- New empty database, current version-1 database and explicit recognized legacy fixtures open without data loss; future and foreign/malformed schemas are rejected before logical mutation.
- Transaction failure after DDL and before version commit leaves the original version/schema/data intact. Recovery does not run after such failure.
- Concurrent openers cannot both acquire live service ownership or run startup recovery; the rejected opener leaves the owner's state untouched. After exit/crash a new opener can recover, preserve rows/sequence IDs and roll back a real interrupted transaction.
- Startup recovery preserves existing safe behavior for queues/edits, performs no native RPC and does not reset uncertain operations into executable pending work.
- Isolated server HTTP restart test proves historical events, feedback and queues remain readable and no task is automatically replayed. Use a deterministic fake Agent, ephemeral ports and private temporary data only.
- Document the tested SQLite/filesystem/platform scope and remaining backup/restore work. Tests must exercise the real opening path, not a parallel test-only migrator.
