//! Versioned schema identity and atomic startup recovery. No native RPC.
use super::{Event, Feedback, Session, now};
use anyhow::{Context, Result};
use rusqlite::{Connection, TransactionBehavior, params};
use serde_json::{Value, json};
use std::{collections::BTreeMap, path::Path};

#[path = "identity.rs"]
mod identity;
#[path = "ownership.rs"]
mod ownership;
pub(super) use ownership::OwnerGuard;
pub(super) const CURRENT_VERSION: i64 = 2;

const BASE: &str = "
CREATE TABLE sessions(id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE events(seq INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, data TEXT NOT NULL);
CREATE INDEX events_session_seq ON events(session_id,seq);
CREATE TABLE message_queue(seq INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, data TEXT NOT NULL);
CREATE TABLE queue_settings(session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE, paused INTEGER NOT NULL DEFAULT 0);
CREATE TABLE queue_edits(session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE, seq INTEGER NOT NULL UNIQUE, data TEXT NOT NULL);
CREATE TABLE message_feedback(session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, message_id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(session_id,message_id));
CREATE TABLE composer_metadata(session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, client_id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(session_id,client_id));
CREATE TABLE message_edits(operation_id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, data TEXT NOT NULL);";
const HARNESS_INDEX: &str = "CREATE UNIQUE INDEX harness_replay_identity ON events(session_id,json_extract(data,'$.params.harnessEventKey')) WHERE json_extract(data,'$.params.harnessEventKey') IS NOT NULL;";
const SOURCE_INDEX: &str = "CREATE UNIQUE INDEX source_replay_identity ON events(session_id,json_extract(data,'$.params.sourceEventKey')) WHERE json_extract(data,'$.params.sourceEventKey') IS NOT NULL;";
const MIGRATIONS: &[(i64, &str)] = &[(1, BASE), (2, super::operations::DDL)];

static OPENING: std::sync::Mutex<()> = std::sync::Mutex::new(());

pub(super) fn open(path: &Path) -> Result<(Connection, Option<OwnerGuard>)> {
    // Serialize initialization in-process too: close a newly created raw file
    // before another thread can initialize SQLite on that inode. POSIX close
    // must never drop an already-live SQLite connection's record locks.
    let _opening = OPENING
        .lock()
        .map_err(|_| anyhow::anyhow!("Database initialization guard is unavailable"))?;
    let (mut db, owner) = if path == Path::new(":memory:") {
        (Connection::open_in_memory()?, None)
    } else {
        anyhow::ensure!(
            !path.as_os_str().to_string_lossy().starts_with("file:"),
            "SQLite URI database paths are unsupported; use a local file path"
        );
        let (owner, canonical) = OwnerGuard::acquire(path)?;
        (Connection::open(canonical)?, Some(owner))
    };
    // Do not configure journal mode, DDL, recovery or version before this read.
    supported(version(&db)?)?;
    db.busy_timeout(std::time::Duration::from_secs(5))?;
    db.execute_batch("PRAGMA foreign_keys=ON;")?;
    {
        let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let original = version(&tx)?;
        supported(original)?;
        let shape = validate_schema(&tx, original)?;
        validate_rows(&tx, shape.empty)?;
        if original == 2 {
            super::operations::validate(&tx)?;
        }
        for &(target, ddl) in MIGRATIONS {
            if original < target {
                if target != 1 || shape.empty {
                    tx.execute_batch(ddl)?;
                }
                if target == 2 {
                    super::operations::initialize(&tx)?;
                }
                fault("after_ddl")?;
                tx.pragma_update(None, "user_version", target)?;
            }
        }
        // Historical version-1 releases introduced these indexes without a
        // version bump. Recognize only their actual ordered layouts; duplicate
        // keys abort the transaction rather than deleting or deduplicating rows.
        for (name, ddl) in [
            ("harness_replay_identity", HARNESS_INDEX),
            ("source_replay_identity", SOURCE_INDEX),
        ] {
            if !shape.objects.contains_key(name) {
                tx.execute_batch(ddl)?;
            }
        }
        fault("before_recovery")?;
        validate_schema(&tx, CURRENT_VERSION)?;
        super::operations::validate(&tx)?;
        recover(&tx)?;
        super::operations::recover(&tx)?;
        super::operations::validate(&tx)?;
        fault("before_commit")?;
        tx.commit()?;
    }
    db.execute_batch("PRAGMA journal_mode=WAL;")?;
    Ok((db, owner))
}
fn version(db: &Connection) -> Result<i64> {
    Ok(db.pragma_query_value(None, "user_version", |row| row.get(0))?)
}
fn supported(value: i64) -> Result<()> {
    anyhow::ensure!(
        (0..=CURRENT_VERSION).contains(&value),
        "Unsupported database schema version {value}; this binary supports up to {CURRENT_VERSION}. Use a compatible newer AnyWork binary; no migration or recovery was run"
    );
    Ok(())
}
struct Shape {
    empty: bool,
    objects: BTreeMap<String, (String, String)>,
}
fn objects(db: &Connection) -> Result<BTreeMap<String, (String, String)>> {
    let mut query = db.prepare("SELECT name,type,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY name")?;
    Ok(query
        .query_map([], |row| Ok((row.get(0)?, (row.get(1)?, row.get(2)?))))?
        .collect::<std::result::Result<_, _>>()?)
}
fn validate_schema(db: &Connection, ver: i64) -> Result<Shape> {
    let found = objects(db)?;
    if found.is_empty() {
        anyhow::ensure!(
            ver == 0,
            "Malformed AnyWork schema: versioned database has no tables"
        );
        let count: i64 =
            db.query_row("SELECT count(*) FROM sqlite_schema", [], |row| row.get(0))?;
        anyhow::ensure!(
            count == 0,
            "Unrecognized empty legacy schema contains SQLite objects"
        );
        return Ok(Shape {
            empty: true,
            objects: found,
        });
    }
    let reference = Connection::open_in_memory()?;
    reference.execute_batch(BASE)?;
    reference.execute_batch(HARNESS_INDEX)?;
    reference.execute_batch(SOURCE_INDEX)?;
    if ver == 2 {
        reference.execute_batch(super::operations::DDL)?;
    }
    let expected = objects(&reference)?;
    let has_harness = found.contains_key("harness_replay_identity");
    let has_source = found.contains_key("source_replay_identity");
    anyhow::ensure!(
        !has_source || has_harness,
        "Unrecognized AnyWork schema: source-only replay index layout"
    );
    for (name, (kind, sql)) in &found {
        let (expected_kind, expected_sql) = expected.get(name)
            .with_context(|| format!("Unrecognized database schema object {name}; foreign tables, indexes, views and triggers are unsupported"))?;
        anyhow::ensure!(
            kind == expected_kind && identity::tokens(sql)? == identity::tokens(expected_sql)?,
            "Malformed AnyWork schema object {name}; required constraints or expressions differ"
        );
    }
    for name in expected.keys().filter(|name| {
        ver == 2
            || !matches!(
                name.as_str(),
                "harness_replay_identity" | "source_replay_identity"
            )
    }) {
        anyhow::ensure!(
            found.contains_key(name),
            "Malformed AnyWork schema: required object {name} is missing"
        );
    }
    // Validate SQLite's parsed metadata as well as the token identity. A type
    // name such as TEXTNOTNULL must never stand in for real NOT NULL/PK/FK
    // constraints, even if a later lexical change introduces a comparison bug.
    identity::validate_structure(db, &reference, &found)?;
    // Internal objects must be SQLite's normal autoindexes/sequence or ANALYZE
    // statistics. SQLite reserves sqlite_* names; reject invented internal SQL.
    let mut query = db.prepare("SELECT name,type FROM sqlite_schema WHERE name LIKE 'sqlite_%'")?;
    for row in query.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })? {
        let (name, kind) = row?;
        anyhow::ensure!(
            (kind == "index" && name.starts_with("sqlite_autoindex_"))
                || (kind == "table"
                    && matches!(
                        name.as_str(),
                        "sqlite_sequence" | "sqlite_stat1" | "sqlite_stat4"
                    )),
            "Unsupported SQLite internal schema object"
        );
    }
    // Schema SQL validates AUTOINCREMENT and every PK/UNIQUE/FK/default.
    // Do not "repair" legacy orphan event rows: I01 scans skip them fail-closed.
    Ok(Shape {
        empty: false,
        objects: found,
    })
}
fn validate_rows(db: &Connection, empty: bool) -> Result<()> {
    if empty {
        return Ok(());
    }
    for table in [
        "sessions",
        "message_queue",
        "queue_edits",
        "message_feedback",
        "composer_metadata",
        "message_edits",
    ] {
        let mut query = db.prepare(&format!("SELECT data FROM {table}"))?;
        for raw in query.query_map([], |row| row.get::<_, String>(0))? {
            let raw = raw?;
            let valid = match table {
                "sessions" => serde_json::from_str::<Session>(&raw).is_ok(),
                "message_feedback" => serde_json::from_str::<Feedback>(&raw).is_ok(),
                _ => serde_json::from_str::<Value>(&raw).is_ok_and(|value| value.is_object()),
            };
            anyhow::ensure!(
                valid,
                "Malformed required JSON in {table}; no startup recovery was run"
            );
        }
    }
    Ok(())
}
fn recover(db: &Connection) -> Result<()> {
    db.execute_batch("UPDATE message_edits SET data=json_set(data,'$.phase','uncertain','$.error','Service restarted while the native edit outcome was unknown; inspect history before retrying') WHERE json_extract(data,'$.phase') IN ('reverting','starting');
        UPDATE message_queue SET data=json_set(data,'$.status','uncertain','$.error','服务重启，发送结果未知，请检查对话后再操作') WHERE json_extract(data,'$.status')='sending';
        INSERT INTO queue_settings(session_id,paused) SELECT DISTINCT session_id,1 FROM message_queue WHERE 1 ON CONFLICT(session_id) DO UPDATE SET paused=1;")?;
    fault("after_queue_recovery")?;
    let mut query = db.prepare("SELECT id,data FROM sessions ORDER BY id")?;
    let sessions = query
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    drop(query);
    for (id, raw) in sessions {
        let session: Session = serde_json::from_str(&raw)?;
        anyhow::ensure!(
            id == session.id,
            "Session identity mismatch; no startup recovery was committed"
        );
        if !session.external
            && ["running", "starting", "waiting"].contains(&session.status.as_str())
        {
            db.execute(
                "UPDATE sessions SET data=json_set(data,'$.status','disconnected') WHERE id=?1",
                [&id],
            )?;
            fault("after_session_recovery")?;
            let event = Event {
                seq: 0,
                session_id: id.clone(),
                method: "connection/interrupted".into(),
                params: json!({"message":"Service restarted. Send a message to resume this conversation."}),
                request_id: None,
                created_at: now(),
            };
            db.execute(
                "INSERT INTO events(session_id,data) VALUES(?1,?2)",
                params![id, serde_json::to_string(&event)?],
            )?;
        }
    }
    Ok(())
}
#[cfg(not(test))]
fn fault(_stage: &str) -> Result<()> {
    Ok(())
}
#[cfg(test)]
thread_local! { static FAIL_AT: std::cell::RefCell<Option<&'static str>> = const { std::cell::RefCell::new(None) }; }
#[cfg(test)]
fn fault(stage: &str) -> Result<()> {
    if stage == "after_ddl" && FAIL_AT.with(|point| *point.borrow() == Some("crash_after_ddl")) {
        // Child-process test only: bypass destructors to exercise hot-journal
        // rollback and OS-released ownership after an interrupted real DDL.
        std::process::exit(27);
    }
    anyhow::ensure!(
        !FAIL_AT.with(|point| *point.borrow() == Some(stage)),
        "Injected schema transaction failure"
    );
    Ok(())
}

#[cfg(test)]
mod tests;
