use super::*;
use crate::store::Store;
use std::{fs, path::PathBuf, process::Command};

struct Fixture {
    dir: PathBuf,
    path: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let dir = std::env::temp_dir().join(format!("anywork-schema-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&dir).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&dir, fs::Permissions::from_mode(0o700)).unwrap();
        }
        let path = dir.join("store.db");
        Self { dir, path }
    }
    fn db(&self) -> Connection {
        Connection::open(&self.path).unwrap()
    }
    fn legacy(&self, ver: i64, replay: u8) {
        let db = self.db();
        let ddl = [
            include_str!("../fixtures/schema-v1-original.sql"),
            include_str!("../fixtures/schema-v1-harness.sql"),
            include_str!("../fixtures/schema-v1-current.sql"),
        ][replay as usize];
        db.execute_batch(ddl).unwrap();
        db.pragma_update(None, "user_version", ver).unwrap();
    }
    fn seed(&self) {
        let db = self.db();
        let session = json!({"id":"one","thread_id":"native-thread","title":"preserved","cwd":"/tmp","agent":"fixture","model":null,"policy":"manual","status":"running","archived":false,"created_at":1,"updated_at":1,"external":false,"extra_identity":"keep"});
        db.execute(
            "INSERT INTO sessions VALUES('one',?1)",
            [session.to_string()],
        )
        .unwrap();
        let event = json!({"seq":0,"session_id":"one","method":"user/message","params":{"text":"original","sourceEventKey":"original-source"},"created_at":1});
        db.execute(
            "INSERT INTO events(seq,session_id,data) VALUES(41,'one',?1)",
            [event.to_string()],
        )
        .unwrap();
        db.execute(
            "INSERT INTO message_queue(seq,session_id,data) VALUES(51,'one',?1)",
            [json!({"status":"sending","text":"do not replay"}).to_string()],
        )
        .unwrap();
        db.execute("INSERT INTO queue_settings VALUES('one',0)", [])
            .unwrap();
        db.execute(
            "INSERT INTO queue_edits VALUES('one',61,?1)",
            [json!({"status":"pending","text":"draft"}).to_string()],
        )
        .unwrap();
        db.execute(
            "INSERT INTO message_edits VALUES('op','one',?1)",
            [json!({"id":"op","phase":"starting","source_identity":"untouched"}).to_string()],
        )
        .unwrap();
        db.execute(
            "INSERT INTO composer_metadata VALUES('one','client',?1)",
            [json!({"markdown":"draft","document":{"type":"doc","content":[]}}).to_string()],
        )
        .unwrap();
        let feedback = json!({"session_id":"one","message_id":"message","rating":"positive","tags":[],"text":null,"created_at":1,"updated_at":1});
        db.execute(
            "INSERT INTO message_feedback VALUES('one','message',?1)",
            [feedback.to_string()],
        )
        .unwrap();
    }
    fn snapshot(&self) -> Value {
        let db = self.db();
        let mut result = serde_json::Map::new();
        let mut query = db
            .prepare("SELECT name,type,sql FROM sqlite_schema ORDER BY name")
            .unwrap();
        let schema: Vec<_> = query
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            })
            .unwrap()
            .map(|row| row.unwrap())
            .collect();
        result.insert("schema".into(), json!(schema));
        result.insert("version".into(), json!(version(&db).unwrap()));
        result.insert(
            "journal".into(),
            json!(
                db.pragma_query_value(None, "journal_mode", |row| row.get::<_, String>(0))
                    .unwrap()
            ),
        );
        for table in [
            "sessions",
            "events",
            "message_queue",
            "queue_settings",
            "queue_edits",
            "message_feedback",
            "composer_metadata",
            "message_edits",
            "sqlite_sequence",
        ] {
            let Ok(mut query) = db.prepare(&format!("SELECT * FROM {table} ORDER BY 1,2")) else {
                result.insert(table.into(), json!("missing"));
                continue;
            };
            let columns = query.column_count();
            let rows: Vec<_> = query
                .query_map([], |row| {
                    (0..columns)
                        .map(|index| row.get_ref(index).map(|value| format!("{value:?}")))
                        .collect::<rusqlite::Result<Vec<_>>>()
                })
                .unwrap()
                .map(|row| row.unwrap())
                .collect();
            result.insert(table.into(), json!(rows));
        }
        Value::Object(result)
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.dir).unwrap();
    }
}
fn error(path: &Path) -> String {
    Store::open(path)
        .err()
        .expect("opening must fail")
        .to_string()
}
fn fail_at(stage: &'static str, path: &Path) {
    FAIL_AT.with(|point| *point.borrow_mut() = Some(stage));
    let result = Store::open(path);
    FAIL_AT.with(|point| *point.borrow_mut() = None);
    assert!(result.is_err());
}

#[test]
fn fresh_current_and_historical_layouts_preserve_data_sequences_and_recover_atomically() {
    let empty = Fixture::new();
    let store = Store::open(&empty.path).unwrap();
    assert_eq!(version(&store.0.lock().unwrap()).unwrap(), CURRENT_VERSION);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            fs::metadata(&empty.path).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
    drop(store);
    for ver in [0, 1] {
        for replay in 0..=2 {
            let fixture = Fixture::new();
            fixture.legacy(ver, replay);
            fixture.seed();
            let store = Store::open(&fixture.path).unwrap();
            assert_eq!(version(&store.0.lock().unwrap()).unwrap(), 1);
            assert_eq!(store.sessions().unwrap()[0].status, "disconnected");
            let events = store.events("one", 0, 500).unwrap();
            assert_eq!(events[0].seq, 41);
            assert_eq!(events[1].seq, 42);
            assert_eq!(events[0].params["sourceEventKey"], "original-source");
            assert_eq!(events[1].method, "connection/interrupted");
            assert_eq!(
                store.queue("one").unwrap()["items"][0]["status"],
                "uncertain"
            );
            assert_eq!(store.queue("one").unwrap()["items"][0]["id"], 51);
            assert_eq!(store.queue("one").unwrap()["paused"], true);
            assert_eq!(store.queue("one").unwrap()["editing"]["text"], "draft");
            assert_eq!(
                store.edit_operation("one", "op").unwrap().unwrap()["phase"],
                "uncertain"
            );
            assert_eq!(store.feedback_list("one").unwrap().len(), 1);
            let raw: String = store
                .0
                .lock()
                .unwrap()
                .query_row("SELECT data FROM sessions WHERE id='one'", [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(
                serde_json::from_str::<Value>(&raw).unwrap()["extra_identity"],
                "keep"
            );
            drop(store);
            let store = Store::open(&fixture.path).unwrap();
            assert_eq!(store.events("one", 0, 500).unwrap().len(), 2);
        }
    }
}

#[test]
fn future_schema_refusal_does_not_change_version_journal_schema_or_recovery_state() {
    let fixture = Fixture::new();
    fixture.legacy(91, 2);
    fixture.seed();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&fixture.path, fs::Permissions::from_mode(0o640)).unwrap();
    }
    let before = fixture.snapshot();
    assert!(error(&fixture.path).contains("Unsupported database schema version 91"));
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            fs::metadata(&fixture.path).unwrap().permissions().mode() & 0o777,
            0o640
        );
    }
    assert_eq!(fixture.snapshot(), before);
}

#[test]
fn rejected_schema_constraints_indexes_unknown_objects_and_required_json_do_not_recover() {
    for sql in [
        "DROP INDEX events_session_seq;",
        "DROP INDEX source_replay_identity; CREATE INDEX source_replay_identity ON events(session_id);",
        "DROP INDEX source_replay_identity; CREATE UNIQUE INDEX source_replay_identity ON events(session_id,json_extract(data,'$.params.sourceeventkey')) WHERE json_extract(data,'$.params.sourceeventkey') IS NOT NULL;",
        "CREATE TABLE foreign_data(id TEXT);",
        "CREATE INDEX unexpected ON sessions(data);",
        "CREATE TRIGGER unexpected AFTER UPDATE ON sessions BEGIN DELETE FROM events; END;",
        "DROP TABLE composer_metadata;",
        "UPDATE message_queue SET data='not JSON';",
        "UPDATE sessions SET data='{}';",
        "DROP INDEX harness_replay_identity;",
    ] {
        let fixture = Fixture::new();
        fixture.legacy(1, 2);
        fixture.seed();
        fixture.db().execute_batch(sql).unwrap();
        let before = fixture.snapshot();
        assert!(!error(&fixture.path).is_empty());
        assert_eq!(fixture.snapshot(), before);
    }
    for malformed in [
        BASE.replace(
            "id TEXT PRIMARY KEY, data TEXT NOT NULL",
            "id TEXT, data TEXT NOT NULL",
        ),
        BASE.replace("ON DELETE CASCADE", "ON DELETE RESTRICT"),
        BASE.replace("PRIMARY KEY AUTOINCREMENT", "PRIMARY KEY"),
        BASE.replace("seq INTEGER NOT NULL UNIQUE", "seq INTEGER NOT NULL"),
    ] {
        let fixture = Fixture::new();
        fixture.db().execute_batch(&malformed).unwrap();
        assert!(error(&fixture.path).contains("Malformed AnyWork schema"));
    }
    let fixture = Fixture::new();
    fixture
        .db()
        .execute_batch("CREATE TABLE unrelated(id INTEGER);")
        .unwrap();
    assert!(error(&fixture.path).contains("Unrecognized database schema object"));
}

#[test]
fn sqlite_type_token_lookalikes_are_refused_before_any_schema_or_recovery_write() {
    // All variants are valid SQLite DDL. They declare ordinary type names, not
    // the required constraints; Unicode spaces are identifier characters here.
    for (original, replacement) in [
        ("data TEXT NOT NULL", "data TEXTNOTNULL"),
        (
            "seq INTEGER PRIMARY KEY AUTOINCREMENT",
            "seq INTEGERPRIMARYKEYAUTOINCREMENT",
        ),
        ("data TEXT NOT NULL", "data TEXT\u{a0}NOT\u{a0}NULL"),
        (
            "seq INTEGER PRIMARY KEY AUTOINCREMENT",
            "seq INTEGER\u{2003}PRIMARY\u{2003}KEY\u{2003}AUTOINCREMENT",
        ),
        ("data TEXT NOT NULL", "data \"TEXT NOT NULL\""),
        (
            "seq INTEGER PRIMARY KEY AUTOINCREMENT",
            "seq \"INTEGER PRIMARY KEY AUTOINCREMENT\"",
        ),
    ] {
        for ver in [0, 1] {
            let fixture = Fixture::new();
            fixture
                .db()
                .execute_batch(
                    &include_str!("../fixtures/schema-v1-current.sql")
                        .replace(original, replacement),
                )
                .unwrap();
            fixture
                .db()
                .pragma_update(None, "user_version", ver)
                .unwrap();
            fixture.seed();
            let before = fixture.snapshot();
            assert_eq!(before["journal"], "delete");
            // Verify the parsed-metadata defense independently too, rather
            // than exercising it only after a lexer has already rejected SQL.
            let reference = Connection::open_in_memory().unwrap();
            reference.execute_batch(BASE).unwrap();
            reference.execute_batch(HARNESS_INDEX).unwrap();
            reference.execute_batch(SOURCE_INDEX).unwrap();
            let db = fixture.db();
            assert!(identity::validate_structure(&db, &reference, &objects(&db).unwrap()).is_err());
            drop(db);
            assert!(error(&fixture.path).contains("Malformed AnyWork schema object"));
            // Includes journal, version, running session, raw rows, source
            // identities, queue/edit phases and exact sequence/high-water IDs.
            assert_eq!(fixture.snapshot(), before, "{replacement}, version {ver}");
        }
    }
}

#[test]
fn schema_identity_preserves_tokens_quotes_unicode_and_sqlite_metadata() {
    assert_ne!(
        identity::tokens("data TEXT NOT NULL").unwrap(),
        identity::tokens("data TEXTNOTNULL").unwrap()
    );
    assert_ne!(
        identity::tokens("data TEXT NOT NULL").unwrap(),
        identity::tokens("data TEXT\u{a0}NOT\u{a0}NULL").unwrap()
    );
    assert_ne!(
        identity::tokens("seq INTEGER PRIMARY KEY AUTOINCREMENT").unwrap(),
        identity::tokens("seq \"INTEGER PRIMARY KEY AUTOINCREMENT\"").unwrap()
    );
    for literal in [
        "'A''b 雪; X'",
        "\"A\"\"b 雪; X\"",
        "`A``b 雪; X`",
        "[A b 雪; X]",
    ] {
        assert_eq!(
            identity::tokens(&format!("SELECT {literal} AS x;")).unwrap(),
            vec![
                "select".to_string(),
                literal.to_string(),
                "as".into(),
                "x".into()
            ]
        );
        assert_ne!(
            identity::tokens(&format!("SELECT {literal} AS x")).unwrap(),
            identity::tokens(&format!("SELECT {} AS x", literal.to_ascii_lowercase())).unwrap()
        );
    }
    assert_ne!(
        identity::tokens("json_extract(data,'$.params.sourceEventKey')").unwrap(),
        identity::tokens("json_extract(data,'$.params.sourceeventkey')").unwrap()
    );
    assert!(identity::tokens("'unterminated").is_err());
    assert!(identity::tokens("data TEXT /* unrecognized */ NOT NULL").is_err());
    // Formatting and unquoted ASCII keyword/column case remain compatible.
    let fixture = Fixture::new();
    let ddl = format!("{BASE}{HARNESS_INDEX}{SOURCE_INDEX}")
        .replace("CREATE", "create")
        .replace("TEXT", "text")
        .replace("INTEGER", "integer")
        .replace("data ", "DATA ")
        .replace("(data,", "(DATA,")
        .replace(' ', "\n\t")
        .replace(',', " ,\r\n ");
    fixture.db().execute_batch(&ddl).unwrap();
    fixture.db().pragma_update(None, "user_version", 1).unwrap();
    fixture.seed();
    let preserved = json!({"seq":0,"session_id":"one","method":"user/message","params":{"text":"Keep 雪; A''b ","sourceEventKey":"ExactCase 雪 ' quote"},"created_at":1}).to_string();
    fixture
        .db()
        .execute("UPDATE events SET data=?1 WHERE seq=41", [&preserved])
        .unwrap();
    let store = Store::open(&fixture.path).unwrap();
    assert_eq!(store.sessions().unwrap()[0].status, "disconnected");
    let events = store.events("one", 0, 500).unwrap();
    assert_eq!(events[0].seq, 41);
    assert_eq!(events[0].params["sourceEventKey"], "ExactCase 雪 ' quote");
    assert_eq!(events[0].params["text"], "Keep 雪; A''b ");
    let raw: String = store
        .0
        .lock()
        .unwrap()
        .query_row("SELECT data FROM events WHERE seq=41", [], |row| row.get(0))
        .unwrap();
    assert_eq!(raw, preserved);
    assert_eq!(events[1].seq, 42);
    assert_eq!(events[1].method, "connection/interrupted");
}

#[test]
fn real_transaction_faults_rollback_ddl_version_and_every_recovery_change() {
    let fresh = Fixture::new();
    fail_at("after_ddl", &fresh.path);
    let db = fresh.db();
    assert_eq!(version(&db).unwrap(), 0);
    assert_eq!(
        db.query_row("SELECT count(*) FROM sqlite_schema", [], |row| row
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
    drop(db);
    Store::open(&fresh.path).unwrap();
    for stage in [
        "after_ddl",
        "before_recovery",
        "after_queue_recovery",
        "after_session_recovery",
        "before_commit",
    ] {
        let fixture = Fixture::new();
        fixture.legacy(0, 0);
        fixture.seed();
        let before = fixture.snapshot();
        fail_at(stage, &fixture.path);
        assert_eq!(fixture.snapshot(), before);
    }
}

#[test]
fn duplicate_replay_identity_aborts_real_unique_index_ddl_without_deduplication() {
    let fixture = Fixture::new();
    fixture.legacy(0, 0);
    fixture.seed();
    fixture
        .db()
        .execute(
            "INSERT INTO events(session_id,data) SELECT session_id,data FROM events",
            [],
        )
        .unwrap();
    let before = fixture.snapshot();
    assert!(error(&fixture.path).contains("UNIQUE constraint failed"));
    assert_eq!(fixture.snapshot(), before);
}

#[test]
fn ownership_rejects_same_process_path_and_filesystem_aliases_until_drop() {
    let fixture = Fixture::new();
    let store = Store::open(&fixture.path).unwrap();
    for path in [fixture.path.clone(), fixture.dir.join(".").join("store.db")] {
        assert!(error(&path).contains("ownership unavailable"));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::symlink;
        let link = fixture.dir.join("symbolic.db");
        symlink(&fixture.path, &link).unwrap();
        assert!(error(&link).contains("ownership unavailable"));
        let hard = fixture.dir.join("hard.db");
        fs::hard_link(&fixture.path, &hard).unwrap();
        assert!(error(&hard).contains("Hard-linked"));
        fs::remove_file(hard).unwrap();
        let case = fixture.dir.join("STORE.DB");
        if case.exists() {
            assert!(error(&case).contains("ownership unavailable"));
        }
    }
    drop(store);
    Store::open(&fixture.path).unwrap();
}

// Child test entry uses an explicit disposable fixture path; never user data.
#[test]
fn ownership_child() {
    let Ok(path) = std::env::var("ANYWORK_TEST_SCHEMA_CHILD_PATH") else {
        return;
    };
    let mode = std::env::var("ANYWORK_TEST_SCHEMA_CHILD_MODE").unwrap();
    if mode == "migrationcrash" {
        FAIL_AT.with(|point| *point.borrow_mut() = Some("crash_after_ddl"));
        let _ = Store::open(Path::new(&path));
        panic!("migration crash injection was not reached");
    }
    if mode == "refuse" {
        assert!(error(Path::new(&path)).contains("ownership unavailable"));
        return;
    }
    if mode == "compete" {
        let Ok(_store) = Store::open(Path::new(&path)) else {
            std::process::exit(23)
        };
        fs::write(format!("{path}.{}.ready", std::process::id()), b"ready").unwrap();
        loop {
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
    }
    let store = Store::open(Path::new(&path)).unwrap();
    let db = store.0.lock().unwrap();
    db.execute_batch(
        "BEGIN IMMEDIATE; UPDATE sessions SET data=json_set(data,'$.title','uncommitted-child');",
    )
    .unwrap();
    fs::write(format!("{path}.ready"), b"ready").unwrap();
    loop {
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
}

#[test]
fn concurrent_process_owner_refusal_and_crash_release_preserve_owner_and_rollback_sqlite() {
    let fixture = Fixture::new();
    fixture.legacy(1, 2);
    fixture.seed();
    let store = Store::open(&fixture.path).unwrap();
    let before = fixture.snapshot();
    let executable = std::env::current_exe().unwrap();
    let child = Command::new(&executable)
        .args([
            "--exact",
            "store::schema::tests::ownership_child",
            "--nocapture",
        ])
        .env("ANYWORK_TEST_SCHEMA_CHILD_PATH", &fixture.path)
        .env("ANYWORK_TEST_SCHEMA_CHILD_MODE", "refuse")
        .output()
        .unwrap();
    assert!(
        child.status.success(),
        "{}",
        String::from_utf8_lossy(&child.stderr)
    );
    assert_eq!(fixture.snapshot(), before);
    drop(store);
    let mut child = Command::new(executable)
        .args(["--exact", "store::schema::tests::ownership_child"])
        .env("ANYWORK_TEST_SCHEMA_CHILD_PATH", &fixture.path)
        .env("ANYWORK_TEST_SCHEMA_CHILD_MODE", "crash")
        .spawn()
        .unwrap();
    let ready = PathBuf::from(format!("{}.ready", fixture.path.display()));
    let mut reached = false;
    for _ in 0..200 {
        if ready.exists() {
            reached = true;
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    if !reached {
        let _ = child.kill();
        let _ = child.wait();
        panic!("disposable child did not acquire ownership");
    }
    assert!(error(&fixture.path).contains("ownership unavailable"));
    child.kill().unwrap();
    child.wait().unwrap();
    let reopened = Store::open(&fixture.path).unwrap();
    assert_eq!(reopened.sessions().unwrap()[0].title, "preserved");
    assert_eq!(reopened.events("one", 0, 500).unwrap()[0].seq, 41);
}

#[test]
fn simultaneous_fresh_thread_openers_have_one_owner() {
    let fixture = Fixture::new();
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(3));
    let (send, receive) = std::sync::mpsc::channel();
    let mut threads = vec![];
    for _ in 0..2 {
        let path = fixture.path.clone();
        let barrier = barrier.clone();
        let send = send.clone();
        threads.push(std::thread::spawn(move || {
            barrier.wait();
            send.send(Store::open(&path)).ok();
        }));
    }
    barrier.wait();
    let results = [receive.recv().unwrap(), receive.recv().unwrap()];
    assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
    assert!(
        results
            .iter()
            .find_map(|result| result.as_ref().err())
            .unwrap()
            .to_string()
            .contains("ownership unavailable")
    );
    for thread in threads {
        thread.join().unwrap();
    }
    drop(results);
    Store::open(&fixture.path).unwrap();
}

#[test]
fn simultaneous_process_startups_have_one_owner_and_one_recovery() {
    let fixture = Fixture::new();
    fixture.legacy(1, 2);
    fixture.seed();
    let mut children = vec![];
    for _ in 0..2 {
        children.push(
            Command::new(std::env::current_exe().unwrap())
                .args(["--exact", "store::schema::tests::ownership_child"])
                .env("ANYWORK_TEST_SCHEMA_CHILD_PATH", &fixture.path)
                .env("ANYWORK_TEST_SCHEMA_CHILD_MODE", "compete")
                .spawn()
                .unwrap(),
        );
    }
    let mut winner = None;
    let mut loser = None;
    for _ in 0..300 {
        for (index, child) in children.iter_mut().enumerate() {
            if PathBuf::from(format!("{}.{}.ready", fixture.path.display(), child.id())).exists() {
                winner = Some(index);
            }
            if let Some(status) = child.try_wait().unwrap() {
                assert_eq!(status.code(), Some(23));
                loser = Some(index);
            }
        }
        if winner.is_some() && loser.is_some() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    for child in &mut children {
        let _ = child.kill();
        let _ = child.wait();
    }
    assert!(winner.is_some() && loser.is_some() && winner != loser);
    let store = Store::open(&fixture.path).unwrap();
    let events = store.events("one", 0, 500).unwrap();
    assert_eq!(
        events
            .iter()
            .filter(|event| event.method == "connection/interrupted")
            .count(),
        1
    );
}

#[test]
fn sqlite_record_locks_survive_a_rejected_same_process_opener() {
    let fixture = Fixture::new();
    let store = Store::open(&fixture.path).unwrap();
    let db = store.0.lock().unwrap();
    db.execute_batch("BEGIN IMMEDIATE;").unwrap();
    assert!(error(&fixture.path).contains("ownership unavailable"));
    let other = fixture.db();
    other.busy_timeout(std::time::Duration::ZERO).unwrap();
    assert!(other.execute_batch("BEGIN IMMEDIATE;").is_err());
    db.execute_batch("ROLLBACK;").unwrap();
}

#[test]
fn sqlite_analyze_and_deleted_autoincrement_high_water_are_preserved() {
    let fixture = Fixture::new();
    fixture.legacy(1, 2);
    fixture.seed();
    fixture.db().execute_batch("INSERT INTO events(seq,session_id,data) SELECT 900,session_id,json_set(data,'$.params.sourceEventKey','deleted-unique') FROM events LIMIT 1; DELETE FROM events WHERE seq=900; ANALYZE;").unwrap();
    let store = Store::open(&fixture.path).unwrap();
    let events = store.events("one", 0, 500).unwrap();
    assert_eq!(events.last().unwrap().seq, 901);
    let seq: i64 = store
        .0
        .lock()
        .unwrap()
        .query_row(
            "SELECT seq FROM sqlite_sequence WHERE name='events'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(seq, 901);
}

#[cfg(unix)]
#[test]
fn sidecar_guard_rejects_symlinks_and_insecure_permissions() {
    use std::os::unix::fs::{MetadataExt, PermissionsExt, symlink};
    let fixture = Fixture::new();
    let store = Store::open(&fixture.path).unwrap();
    drop(store);
    let info = fixture.path.metadata().unwrap();
    let guard = fixture
        .dir
        .join(format!(".anywork-db-{}-{}.lock", info.dev(), info.ino()));
    assert_eq!(
        guard.metadata().unwrap().permissions().mode() & 0o777,
        0o600
    );
    fs::set_permissions(&guard, fs::Permissions::from_mode(0o644)).unwrap();
    assert!(error(&fixture.path).contains("private regular file"));
    fs::remove_file(&guard).unwrap();
    let unrelated = fixture.dir.join("unrelated");
    fs::write(&unrelated, b"untouched").unwrap();
    symlink(&unrelated, &guard).unwrap();
    assert!(!error(&fixture.path).is_empty());
    assert_eq!(fs::read(&unrelated).unwrap(), b"untouched");
}

#[test]
fn actual_process_exit_during_bootstrap_ddl_rolls_back_then_reopens() {
    let fixture = Fixture::new();
    let status = Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "store::schema::tests::ownership_child"])
        .env("ANYWORK_TEST_SCHEMA_CHILD_PATH", &fixture.path)
        .env("ANYWORK_TEST_SCHEMA_CHILD_MODE", "migrationcrash")
        .status()
        .unwrap();
    assert_eq!(status.code(), Some(27));
    let store = Store::open(&fixture.path).unwrap();
    assert_eq!(version(&store.0.lock().unwrap()).unwrap(), CURRENT_VERSION);
    assert_eq!(store.event_cursor().unwrap(), 0);
    assert!(store.sessions().unwrap().is_empty());
}

#[test]
fn legacy_orphan_events_remain_stored_and_hidden_by_the_accepted_global_scan() {
    let fixture = Fixture::new();
    fixture.legacy(1, 2);
    fixture.seed();
    let raw = json!({"seq":0,"session_id":"deleted","method":"orphan/test","params":{"text":"hidden"},"created_at":1});
    let db = fixture.db();
    // Reproduce an existing legacy orphan, not a newly accepted Store write.
    db.execute_batch("PRAGMA foreign_keys=OFF").unwrap();
    db.execute(
        "INSERT INTO events(session_id,data) VALUES('deleted',?1)",
        [raw.to_string()],
    )
    .unwrap();
    drop(db);
    let store = Store::open(&fixture.path).unwrap();
    let count: i64 = store
        .0
        .lock()
        .unwrap()
        .query_row(
            "SELECT count(*) FROM events WHERE session_id='deleted'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(count, 1);
    assert!(
        store
            .scoped_events(0, 500, |_| true)
            .unwrap()
            .events
            .iter()
            .all(|event| event.session_id != "deleted")
    );
}

#[test]
fn opening_does_not_decode_hidden_event_payloads_or_change_scan_error_semantics() {
    let fixture = Fixture::new();
    fixture.legacy(1, 2);
    fixture.seed();
    let db = fixture.db();
    db.execute("INSERT INTO sessions SELECT 'hidden',json_set(data,'$.id','hidden','$.status','idle') FROM sessions WHERE id='one'",[]).unwrap();
    db.execute(
        "INSERT INTO events(session_id,data) VALUES('hidden','{}')",
        [],
    )
    .unwrap();
    drop(db);
    let store = Store::open(&fixture.path).unwrap();
    let page = store
        .scoped_events(0, 500, |session| session.id == "one")
        .unwrap();
    assert!(page.events.iter().all(|event| event.session_id == "one"));
    assert!(store.scoped_events(0, 500, |_| true).is_err());
    assert!(store.events("hidden", 0, 500).is_err());
}
