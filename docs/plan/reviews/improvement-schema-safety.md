# I05a independent schema and startup-recovery review

Reviewed exact candidate **`fc2b9aaa20686b5f3a0ecffb1ad1a087c207cf26`** on 2026-11-07 in the assigned isolated `improve-schema-safety` worktree. The reviewer did not develop this implementation and made no implementation changes. Contracts: [schema and recovery](../../schema-and-recovery.md), [I05a task](../tasks/improvement-schema-safety.md), and the accepted I01 scope behavior. This review does not cover full backup, restore, retention, RPO/RTO or the future operation ledger.

## Result

**Changes requested: B1 is blocking.** The lifetime ownership guard and transactional recovery have meaningful evidence on the tested macOS host. Future-version refusal and the accepted I01 orphan/hidden-event behavior passed inspection and execution. However, the schema identity normalizer conflates different SQL tokens and accepts malformed required constraints. A real server accepted these schemas; production `Store::open` then committed recovery into one with no real event primary key/AUTOINCREMENT, producing an event whose `seq` is NULL. The candidate must not be accepted or merged until this is repaired and independently rechecked.

## B1 / P1 — whitespace deletion makes different schema semantics compare equal

Location: `crates/server/src/store/schema.rs:107` (`normalized`) and `:158` (schema identity comparison).

The normalizer removes every whitespace character outside single-quoted strings. It loses token boundaries, so these valid SQLite declarations normalize to identical strings:

| Required declaration | Independently tested different declaration | Actual difference |
| --- | --- | --- |
| `data TEXT NOT NULL` | `data TEXTNOTNULL` | The second declaration is an ordinary type name; `PRAGMA table_info` reports `notnull=0`. |
| `seq INTEGER PRIMARY KEY AUTOINCREMENT` | `seq INTEGERPRIMARYKEYAUTOINCREMENT` | The second declaration is an ordinary type name, with neither a primary key nor AUTOINCREMENT. |

Reproduction uses the checked-in `schema-v1-current.sql` fixture in a private temporary database, replacing the indicated declaration(s) and retaining the version stamp and remaining schema. These are executable DDL variants, rather than `writable_schema` corruption or SQL text that SQLite refuses to parse.

Independent evidence:

1. The exact candidate's real debug server started successfully and answered `/api/health` for both malformed variants. Its journal changed from DELETE to WAL. The accepted baseline fixture started as expected; wrong replay predicates, wrong JSON-path key case, a non-unique replay index, and an unknown trigger were refused.
2. A separate disposable harness calling the production `Store::open` source seeded a valid local session with `status=running`. For `TEXTNOTNULL`, opening returned success, changed the status to `disconnected`, and inserted an interrupted event. Thus invalid schema was not rejected before recovery.
3. For `INTEGERPRIMARYKEYAUTOINCREMENT`, the same real opening path returned success, changed status to `disconnected`, and committed `connection/interrupted` with **`events.seq = NULL`**. `event_cursor()` returned 0. This directly violates the required sequence/primary-key contract and can make later event reads fail.

Minimal mutation for the second case:

```python
sql = fixture_sql.replace(
    'seq INTEGER PRIMARY KEY AUTOINCREMENT',
    'seq INTEGERPRIMARYKEYAUTOINCREMENT',
)
```

Required correction: preserve SQL token identity/boundaries in the allowlist comparison, or validate the actual structural metadata with an appropriately strict SQL-expression check. Do not replace this with another whitespace/case heuristic that merges identifiers or alters quoted literals. Preserve exact JSON-path key case and string contents. Add production-opening regressions for valid SQLite type-token lookalikes, asserting refusal **before** version/journal/recovery mutation and preserving seeded active-session/queue/sequence data. Continue to test actual PK, uniqueness, FK/CASCADE, defaults and AUTOINCREMENT semantics, not just required object/column names.

The existing malformed-schema tests remove constraints in ways that change the normalized character stream. They therefore pass while missing this boundary collision. The current all-green developer suite does not disprove B1.

## Source assessment and independently checked boundaries

### Opening and schema transaction

- `Store::open` calls the candidate's schema opening path and retains ownership after the connection field. The OS guard is acquired before migration/recovery; a rejected opener does not enter recovery.
- Supported-version checking occurs immediately after SQLite open, before application journal changes, DDL, recovery and version writes. Version is rechecked under the immediate transaction. `busy_timeout` and connection-local FK enabling occur only after the first supported-version check. SQLite's own open/hot-journal/sidecar bookkeeping is explicitly outside the logical no-application-write promise.
- An explicit ordered bootstrap registry retains current version 1. Current/original/harness layouts are recognized, and missing historical replay indexes are completed in the same transaction. Historical fixture DDL was cross-checked against the cited original `f42b8e1` and current `cd6699a` Store opening source. Version-0 recognition means an exact known unstamped layout, not an invented published v0 history or guessed missing tables.
- Wrong predicate, JSON-path `sourceEventKey` case, non-unique replay index, unknown trigger and future-version negative probes were refused with unchanged logical snapshot and DELETE journal. These checks work for the tested mutations; the token-boundary defect above remains blocking.
- Single-quoted SQL literal content is retained by the normalizer. Data validation/recovery does not rewrite source-key strings; an independent seeded event retained its exact raw JSON, mixed-case source keys, quotes, spaces and Unicode.

### Atomic recovery and I01 compatibility

- Schema completion, version changes, queue uncertainty/pause, edit uncertainty, session status and interrupted event insertion share one transaction. The injected failures after DDL, after queue/session recovery and before commit exercise real transaction rollback; snapshots include schema, version, journal, rows and sequence state. These are meaningful assertions, not tests of a separate migrator.
- Session recovery uses `json_set` and preserves unknown metadata instead of serializing only known typed fields. Independent production-Store probes preserved the complete session value except status, exact composer JSON, event strings/source identities, queue/edit metadata and deleted event high-water state: interrupted event sequence advanced from a deleted 900 to 901. Reopening was idempotent, with no second interrupted event or metadata change.
- Required Session/Feedback JSON is typed; queue/edit/composer JSON must be objects. There is no blanket event transcript decode or startup `foreign_key_check` repair gate. Schema FK/CASCADE declarations remain required, while legacy orphan event rows remain stored and fail-closed in scoped scans. Hidden malformed Event shapes are skipped without decode; visible/per-session decoding errors retain existing semantics. The corresponding actual Store tests and I01 HTTP/SSE/poll suite passed.
- No native runtime/RPC is constructed by schema recovery. The isolated HTTP restart test compares fake-Agent call bytes after crash/restart, several queue-worker cycles and a second restart, while verifying history/feedback/paused uncertain queue/edit state. This is stronger than merely observing an idle status immediately after startup.

### Lifetime ownership and crash behavior

- Unix guards use a private inode-identified sidecar and `O_NOFOLLOW`, refusing non-private/non-regular/hard-linked guards and hard-linked database aliases. Initial database creation is 0600; existing database permissions are not rewritten before future-version refusal. Guard presence alone does not imply ownership, and the implementation does not unlink it to force acquisition.
- The initialization mutex plus failure of `create_new` on an existing DB avoids opening/closing an independent database descriptor in a rejected same-process opener. This matters on Darwin, where such a close could release SQLite POSIX record locks. The lifetime lock itself is on the sidecar inode.
- Beyond the supplied tests, an independent harness held an actual SQLite `BEGIN IMMEDIATE`, rejected additional `Store::open` calls through canonical, dot-path, symbolic-link and existing uppercase aliases, and after each rejection started a separate SQL writer. Every writer remained blocked: losers did not unlock the original connection's SQLite lock.
- The independent harness also held ownership and an uncommitted title update in a disposable child, rejected cross-process alias openers with actionable ownership errors and no committed-state mutation, then killed the holder. Reopening acquired ownership, rolled back the uncommitted title and preserved previously committed recovery state/sequences.
- The supplied simultaneous thread/process tests retain the winning Store while checking the loser and count exactly one interrupted recovery event. The crash test rolls back real SQLite work, rather than treating removal of a PID file as ownership release.
- Windows uses a separate database handle and a reserved-byte `LockFileEx` region. That source path was inspected, but no Windows/native Linux execution was performed here. macOS success does not accept those platform paths. External DB/guard replacement/unlinking and network filesystems remain outside the declared protocol.

## Actual independent execution

All work used disposable local paths, the assigned worktree's target, isolated fake plugins/accounts and ephemeral loopback ports. No production service, native Agent, real credentials or root build assets were accessed.

| Check/probe | Observed result |
| --- | --- |
| Exact candidate/head verification | `fc2b9aaa20686b5f3a0ecffb1ad1a087c207cf26`; clean before review |
| `cargo test --locked --offline -p anywork store::schema::tests -- --nocapture` | 16 passed, including real Store/transaction/owner/crash tests |
| `cargo build --locked --offline -p anywork` | Passed; used for real HTTP probes |
| `ANYWORK_BINARY="$PWD/target/debug/anywork" python3 scripts/schema-recovery-test.py` | 2 passed; future refusal plus owner refusal/crash/restart/no replay |
| `ANYWORK_BINARY="$PWD/target/debug/anywork" python3 scripts/event-scope-test.py` | 4 passed; scoped SSE/poll/cursor/Agent behavior retained |
| Additional real HTTP schema matrix | Reference accepted; `TEXTNOTNULL` and `INTEGERPRIMARYKEYAUTOINCREMENT` wrongly accepted; wrong predicate/key case/unique index/trigger/future negatives refused |
| Additional production-Store opening/recovery probe | Both type-token variants wrongly accepted; malformed event sequence declaration produced NULL sequence during recovery |
| Additional source/string/metadata/high-water/idempotence probe | Passed; exact event/composer retention, unknown session metadata preserved, event high-water 901, no second recovery |
| Additional same-/cross-process alias guard and SQLite-record-lock probe | Passed for canonical/dot/symlink/uppercase aliases on this macOS filesystem; killed owner released guard and uncommitted SQL rolled back |

Independent temporary harnesses were kept under `/private/tmp`, not added to implementation. The Store harness compiled an exact-byte copy of candidate `store.rs` under a conventional module directory, with the candidate's real schema/ownership modules and locked dependency artifacts; this only accommodates Rust module-path resolution and does not substitute a test migrator or change opening logic. Real HTTP probes also used the unmodified candidate binary. Only this review document is committed.

## Required follow-up and remaining scope

Return B1 to the developer. Re-review the exact correction commit, including independent valid-token-lookalike negatives, the existing positive legacy fixtures, SQL literal preservation, ownership, sequence and I01 boundary regressions. Do not relax required schema declarations or introduce full-store orphan/event decoding/repair to fix it. Root should register accepted module checks and run merged-contract verification before marking I05a accepted.

This review leaves Linux/Windows guards, network filesystems, real power-loss durability and actual backup/restore/retention unaccepted. I05a's schema/ownership recovery evidence cannot close full I05.
