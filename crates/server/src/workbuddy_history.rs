//! Passive, version-bound WorkBuddy local catalog and transcript reads.
//! Only sessions metadata and its projects JSONL are read; no account API/store.
use super::{AGENT, Projection};
use crate::{App, store::Session};
use anyhow::{Context, Result, ensure};
use rusqlite::{Connection, OpenFlags};
use serde_json::{Value, json};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
    sync::Arc,
};

const MAX_FILE: u64 = 128 * 1024 * 1024;
const MAX_RECORDS: usize = 200_000;
pub(super) type Cache = HashMap<String, (String, Option<String>)>;

fn root(app: &App) -> Result<Option<PathBuf>> {
    if let Some(path) = std::env::var_os("ANYWORK_WORKBUDDY_HOME") {
        let path = PathBuf::from(path);
        ensure!(
            path.is_absolute(),
            "WorkBuddy history root must be absolute"
        );
        return Ok(Some(path));
    }
    match app.workbuddy.descriptor() {
        Ok(descriptor) => return Ok(Some(descriptor.config_dir)),
        Err(error) if !app.workbuddy.optional => return Err(error),
        Err(_) => {}
    }
    Ok(std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(|p| PathBuf::from(p).join(".workbuddy")))
}
fn safe_segment(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 255
        && value != "."
        && value != ".."
        && !value.contains(['/', '\\', '\0'])
}
fn checked(root: &Path, path: &Path) -> Result<fs::Metadata> {
    ensure!(
        root.is_absolute(),
        "WorkBuddy history root must be absolute"
    );
    let relative = path
        .strip_prefix(root)
        .context("WorkBuddy history path escapes root")?;
    let mut current = root.to_path_buf();
    let meta = fs::symlink_metadata(&current).context("Cannot read WorkBuddy history root")?;
    ensure!(
        !meta.file_type().is_symlink() && meta.is_dir(),
        "WorkBuddy history root must be a real directory"
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        ensure!(
            meta.uid() == unsafe { libc::geteuid() },
            "WorkBuddy history root belongs to another user"
        );
    }
    for component in relative.components() {
        ensure!(
            matches!(component, std::path::Component::Normal(_)),
            "Invalid WorkBuddy history path"
        );
        current.push(component);
        let metadata = fs::symlink_metadata(&current)?;
        ensure!(
            !metadata.file_type().is_symlink(),
            "WorkBuddy history paths must not contain symlinks"
        );
    }
    Ok(fs::symlink_metadata(path)?)
}
fn open_file(root: &Path, path: &Path, limit: u64) -> Result<fs::File> {
    let metadata = checked(root, path)?;
    ensure!(
        metadata.is_file() && metadata.len() <= limit,
        "WorkBuddy history file exceeds its supported size/type"
    );
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    let file = options.open(path)?;
    ensure!(
        file.metadata()?.is_file(),
        "WorkBuddy history is not a regular file"
    );
    Ok(file)
}
fn settings_hidden(raw: Option<String>) -> Result<bool> {
    let Some(raw) = raw.filter(|raw| !raw.is_empty()) else {
        return Ok(false);
    };
    let value: Value =
        serde_json::from_str(&raw).context("Invalid WorkBuddy session settings metadata")?;
    Ok(value["conversationTags"]["wbQuickAsk"] == "1")
}
fn scan(root: &Path) -> Result<Vec<Session>> {
    let path = root.join("workbuddy.db");
    if !path.try_exists()? {
        return Ok(vec![]);
    }
    let meta = checked(root, &path)?;
    ensure!(
        meta.is_file() && meta.len() <= MAX_FILE,
        "Unsupported WorkBuddy catalog size/type"
    );
    for extension in ["workbuddy.db-wal", "workbuddy.db-shm"] {
        let sibling = root.join(extension);
        if sibling.try_exists()? {
            checked(root, &sibling)?;
        }
    }
    let db = Connection::open_with_flags(
        &path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    db.busy_timeout(std::time::Duration::from_millis(250))?;
    db.pragma_update(None, "query_only", true)?;
    let mut query=db.prepare("SELECT id,cwd,COALESCE(NULLIF(custom_title,''),NULLIF(title,''),'WorkBuddy 会话'),status,created_at,updated_at,last_activity_at,model,session_settings FROM sessions WHERE transport='local' AND deleted_at IS NULL ORDER BY COALESCE(last_activity_at,created_at) DESC,id LIMIT 10001")?;
    let rows = query.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, String>(3)?,
            r.get::<_, i64>(4)?,
            r.get::<_, i64>(5)?,
            r.get::<_, Option<i64>>(6)?,
            r.get::<_, Option<String>>(7)?,
            r.get::<_, Option<String>>(8)?,
        ))
    })?;
    let mut sessions = vec![];
    for row in rows {
        let (id, cwd, title, status, created, updated, activity, model, settings) = row?;
        ensure!(
            sessions.len() < 10000,
            "WorkBuddy catalog exceeds safety limit"
        );
        ensure!(
            safe_segment(&id) && Path::new(&cwd).is_absolute(),
            "Invalid WorkBuddy native conversation identity/directory"
        );
        if settings_hidden(settings)? {
            continue;
        }
        sessions.push(Session {
            id: format!("workbuddy-{id}"),
            thread_id: Some(id),
            title,
            cwd,
            agent: AGENT.into(),
            model,
            policy: "manual".into(),
            status: "external".into(),
            archived: status == "archived",
            created_at: created,
            updated_at: updated.max(activity.unwrap_or(updated)),
            external: true,
            auxiliary: false,
        });
    }
    Ok(sessions)
}
pub(super) async fn sync(app: &Arc<App>) -> Result<()> {
    let Some(root) = root(app)? else {
        return Ok(());
    };
    if !root.try_exists()? {
        return Ok(());
    }
    let rows = tokio::task::spawn_blocking(move || scan(&root)).await??;
    let runtimes = app.runtimes.lock().await;
    for row in rows {
        if app.session_in_scope(&row.cwd, AGENT).is_ok() && !runtimes.contains_key(&row.id) {
            app.store.save_shared_observation(&row)?;
        }
    }
    Ok(())
}
fn key(cwd: &Path) -> String {
    let mut base = String::new();
    for c in cwd.to_string_lossy().chars() {
        let c = if matches!(c, '/' | '\\' | ':') {
            '-'
        } else {
            c
        };
        if c != '-' || !base.ends_with('-') {
            base.push(c)
        }
    }
    let base = base.trim_matches('-');
    if base.len() <= 255 {
        return base.into();
    }
    let hash = base
        .bytes()
        .fold(5381u32, |acc, b| acc.wrapping_mul(33) ^ u32::from(b));
    let mut n = hash;
    let mut suffix = String::new();
    loop {
        suffix.insert(0, char::from_digit(n % 36, 36).unwrap());
        n /= 36;
        if n == 0 {
            break;
        }
    }
    let mut prefix = String::new();
    for c in base.chars() {
        if prefix.len() + c.len_utf8() > 180 {
            break;
        }
        prefix.push(c)
    }
    format!("{prefix}-{suffix}")
}
fn paths(root: &Path, session: &Session) -> Result<Option<PathBuf>> {
    let id = session
        .thread_id
        .as_deref()
        .context("Missing WorkBuddy native identity")?;
    ensure!(safe_segment(id), "Invalid WorkBuddy native identity");
    let mut keys = vec![key(Path::new(&session.cwd))];
    if let Ok(real) = Path::new(&session.cwd).canonicalize() {
        let k = key(&real);
        if !keys.contains(&k) {
            keys.insert(0, k)
        }
    }
    let mut roots = vec![root.to_path_buf()];
    if root.try_exists()? {
        for (index, entry) in fs::read_dir(root)?.enumerate() {
            ensure!(
                index < 2000,
                "WorkBuddy profile catalog exceeds safety limit"
            );
            let entry = entry?;
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name.starts_with("user-") && entry.file_type()?.is_dir() {
                roots.push(entry.path());
            }
        }
    }
    for owner_root in roots {
        checked(root, &owner_root)?;
        for k in &keys {
            ensure!(safe_segment(k), "Invalid WorkBuddy project storage key");
            let project = owner_root.join("projects").join(k);
            let direct = project.join(format!("{id}.jsonl"));
            if direct.try_exists()? {
                checked(root, &direct)?;
                return Ok(Some(direct));
            }
            let alias = project.join(format!("{id}.acp-session.json"));
            if alias.try_exists()? {
                let v: Value = serde_json::from_reader(open_file(root, &alias, 64 * 1024)?)?;
                let alias = v["acpSessionId"]
                    .as_str()
                    .context("Invalid WorkBuddy session alias")?;
                ensure!(
                    safe_segment(alias),
                    "Invalid WorkBuddy session alias identity"
                );
                let path = project.join(format!("{alias}.jsonl"));
                if path.try_exists()? {
                    checked(root, &path)?;
                    return Ok(Some(path));
                }
            }
        }
    }
    Ok(None)
}
fn signature(path: &Path, metadata: &fs::Metadata) -> Result<String> {
    Ok(format!(
        "{}:{}:{}",
        path.display(),
        metadata.len(),
        metadata
            .modified()?
            .duration_since(std::time::UNIX_EPOCH)?
            .as_nanos()
    ))
}
fn transcript(root: &Path, path: &Path) -> Result<(Vec<Value>, Option<String>)> {
    let file = open_file(root, path, MAX_FILE)?;
    let initial = signature(path, &file.metadata()?)?;
    let mut reader = BufReader::new(file);
    let mut records = vec![];
    let mut bytes = vec![];
    let mut notice = None;
    let mut total = 0;
    loop {
        bytes.clear();
        let len = reader
            .by_ref()
            .take(16 * 1024 * 1024 + 1)
            .read_until(b'\n', &mut bytes)?;
        if len == 0 {
            break;
        }
        total += len;
        ensure!(
            len <= 16 * 1024 * 1024 && total as u64 <= MAX_FILE && records.len() < MAX_RECORDS,
            "WorkBuddy transcript exceeds safety limit"
        );
        if bytes.iter().all(u8::is_ascii_whitespace) {
            continue;
        }
        match serde_json::from_slice::<Value>(&bytes) {
            Ok(record) => {
                ensure!(record.is_object(), "Invalid WorkBuddy transcript record");
                records.push(record)
            }
            Err(_) if !bytes.ends_with(b"\n") => {
                notice = Some(
                    "原生会话末尾仍在写入，已显示完整的历史记录；稍后重新打开以继续加载。".into(),
                );
                break;
            }
            Err(_) => anyhow::bail!("WorkBuddy transcript contains an invalid complete record"),
        }
    }
    ensure!(
        initial == signature(path, &reader.get_ref().metadata()?)?,
        "WorkBuddy history changed while reading; retry opening history"
    );
    Ok((active_history(records)?, notice))
}
fn nonempty(value: &Value) -> Option<&str> {
    value.as_str().map(str::trim).filter(|v| !v.is_empty())
}
fn meta(r: &Value, key: &str) -> bool {
    r["providerData"][key] == true
}
fn hidden(r: &Value) -> bool {
    meta(r, "isCompactInternal")
        || r["providerData"]["compactType"].is_string()
        || (r["role"] == "user"
            && (meta(r, "isMeta")
                || meta(r, "skipRun")
                || r["providerData"]["teammateMessage"]["from"].is_string()))
}
fn real_user(r: &Value) -> bool {
    r["type"] == "message" && r["role"] == "user" && !hidden(r)
}
fn custom(r: &Value) -> bool {
    matches!(
        r["type"].as_str(),
        Some(
            "custom-title"
                | "ai-title"
                | "file-history-snapshot"
                | "summary"
                | "topic"
                | "goal-result"
                | "goal-progress"
                | "resend-fork-notice"
                | "session-meta"
        )
    )
}
fn active_history(mut records: Vec<Value>) -> Result<Vec<Value>> {
    let mut parents = HashSet::new();
    let branched = records.iter().any(|r| {
        r["type"] == "resend-fork-notice"
            || (real_user(r)
                && nonempty(&r["parentId"]).is_some_and(|id| !parents.insert(id.to_owned())))
    });
    if !branched {
        return Ok(records.into_iter().filter(|r| !custom(r)).collect());
    }
    let mut target = records
        .iter()
        .rev()
        .find_map(|r| {
            if r["type"] == "resend-fork-notice" {
                nonempty(&r["parentId"])
            } else if !custom(r) {
                nonempty(&r["id"])
            } else {
                None
            }
        })
        .map(str::to_owned);
    let mut selected = vec![];
    for index in (0..records.len()).rev() {
        let r = &records[index];
        if nonempty(&r["id"]) != target.as_deref() {
            continue;
        }
        selected.push(index);
        target = nonempty(&r["parentId"])
            .or_else(|| nonempty(&r["logicalParentId"]))
            .map(str::to_owned);
    }
    selected.reverse();
    let selected: HashSet<_> = selected.into_iter().collect();
    Ok(records
        .drain(..)
        .enumerate()
        .filter_map(|(i, r)| (selected.contains(&i) && !custom(&r)).then_some(r))
        .collect())
}
fn timestamp(r: &Value) -> Option<i64> {
    r["timestamp"].as_i64().or_else(|| {
        r["timestamp"].as_str().and_then(|s| {
            chrono::DateTime::parse_from_rfc3339(s)
                .ok()
                .map(|v| v.timestamp_millis())
        })
    })
}
fn text(value: &Value) -> String {
    if let Some(s) = value.as_str() {
        return s.into();
    }
    if let Some(list) = value.as_array() {
        return list
            .iter()
            .map(text)
            .filter(|v| !v.is_empty())
            .collect::<Vec<_>>()
            .join("");
    }
    value["text"]
        .as_str()
        .or_else(|| value["output"].as_str())
        .map(str::to_owned)
        .unwrap_or_else(|| {
            if value.get("content").is_some() {
                text(&value["content"])
            } else {
                String::new()
            }
        })
}
fn parsed(value: &Value) -> Value {
    if let Some(s) = value.as_str() {
        serde_json::from_str(s).unwrap_or_else(|_| json!({"output":s}))
    } else {
        value.clone()
    }
}
fn requests(records: &[Value]) -> Result<Vec<Value>> {
    let mut groups: Vec<Value> = vec![];
    let mut by_id = HashMap::new();
    let mut current = None;
    for (index, r) in records.iter().enumerate() {
        let explicit = nonempty(&r["providerData"]["conversationRequestId"])
            .or_else(|| nonempty(&r["providerData"]["requestId"]))
            .or_else(|| nonempty(&r["conversationRequestId"]))
            .or_else(|| nonempty(&r["requestId"]));
        if real_user(r) {
            let id = explicit
                .or_else(|| nonempty(&r["id"]))
                .context("WorkBuddy user record has no stable request identity")?;
            current = Some(groups.len());
            by_id.insert(id.to_owned(), groups.len());
            groups.push(json!({"id":id,"state":"streaming","timestamp":timestamp(r),"userMessage":{"content":[]},"assistantMessage":{"content":[]},"_sourceIndex":index}));
        } else if let Some(id) = explicit {
            current = Some(if let Some(i) = by_id.get(id) {
                *i
            } else {
                let i = groups.len();
                by_id.insert(id.to_owned(), i);
                groups.push(json!({"id":id,"state":"streaming","userMessage":{"content":[]},"assistantMessage":{"content":[]}}));
                i
            });
        }
        let Some(i) = current else { continue };
        let g = &mut groups[i];
        if hidden(r) {
            continue;
        }
        if real_user(r) {
            let blocks = if let Some(s) = r["content"].as_str() {
                json!([{"type":"text","text":s}])
            } else {
                r["content"].clone()
            };
            if let Some(blocks) = blocks.as_array() {
                for b in blocks {
                    if let Some(t) = b["text"].as_str()
                        && (b["type"] == "text" || b["type"] == "input_text")
                    {
                        g["userMessage"]["content"]
                            .as_array_mut()
                            .unwrap()
                            .push(json!({"type":"text","text":crate::user_text::body(t)}));
                        continue;
                    }
                    if let Some("localImage" | "localFile" | "image" | "resource") =
                        b["type"].as_str()
                    {
                        g["userMessage"]["content"]
                            .as_array_mut()
                            .unwrap()
                            .push(b.clone());
                    }
                }
            }
        }
        let blocks = g["assistantMessage"]["content"].as_array_mut().unwrap();
        match r["type"].as_str() {
            Some("message") if r["role"] == "assistant" => {
                let t = text(&r["content"]);
                if !t.trim().is_empty() {
                    blocks.push(json!({"type":"text","text":t.trim()}));
                    g["state"] = json!("completed");
                    g["finishTimestamp"] = json!(timestamp(r));
                }
            }
            Some("reasoning") => {
                let t = text(&r["content"]);
                if !t.is_empty() {
                    blocks.push(json!({"type":"reasoning","text":t}));
                    g["state"] = json!("streaming");
                }
            }
            Some("function_call") => {
                let id = nonempty(&r["callId"])
                    .or_else(|| nonempty(&r["id"]))
                    .context("WorkBuddy tool call has no identity")?;
                let name = r["name"].as_str().unwrap_or("tool");
                let input = parsed(&r["arguments"]);
                if let Some(block) = blocks.iter_mut().find(|b| b["toolCallId"] == id) {
                    block["rawInput"] = input;
                    block["title"] = json!(name);
                    block["_meta"] = json!({"codebuddy.ai/toolName":name});
                } else {
                    blocks.push(json!({"type":"tool","toolCallId":id,"title":name,"_meta":{"codebuddy.ai/toolName":name},"rawInput":input,"status":"in_progress"}));
                }
            }
            Some("function_call_result" | "function_call_output") => {
                let id = nonempty(&r["callId"])
                    .or_else(|| nonempty(&r["id"]))
                    .context("WorkBuddy tool result has no identity")?;
                let status = match r["status"].as_str() {
                    Some("failed" | "error" | "incomplete") => "failed",
                    Some("cancelled" | "canceled" | "killed") => "cancelled",
                    Some("in_progress" | "pending") => "in_progress",
                    _ => "completed",
                };
                let output = parsed(&r["output"]);
                if let Some(block) = blocks.iter_mut().find(|b| b["toolCallId"] == id) {
                    block["rawOutput"] = output;
                    block["status"] = json!(status);
                } else {
                    blocks.push(
                        json!({"type":"tool","toolCallId":id,"status":status,"rawOutput":output}),
                    );
                }
            }
            Some("acp-terminal-state") => {
                g["state"] = json!(match r["status"].as_str() {
                    Some("cancelled" | "killed" | "interrupted") => "cancelled",
                    Some("failed" | "error") => "error",
                    _ => "completed",
                });
            }
            _ => {}
        }
    }
    Ok(groups)
}
pub(super) async fn read(app: &Arc<App>, session: &Session) -> Result<(bool, Option<String>)> {
    let Some(root) = root(app)? else {
        return Ok((false, None));
    };
    if !root.try_exists()? {
        return Ok((false, None));
    }
    let Some(path) = paths(&root, session)? else {
        return Ok((false, None));
    };
    let revision = signature(&path, &checked(&root, &path)?)?;
    let mut cache = app.workbuddy.history_cache.lock().await;
    if let Some((previous, notice)) = cache
        .get(&session.id)
        .filter(|(previous, _)| previous == &revision)
    {
        let _ = previous;
        return Ok((true, notice.clone()));
    }
    let path_copy = path.clone();
    let root_copy = root.clone();
    let (records, notice) =
        tokio::task::spawn_blocking(move || transcript(&root_copy, &path_copy)).await??;
    let normalized = requests(&records)?;
    if app.runtimes.lock().await.contains_key(&session.id) {
        return Ok((true, notice));
    }
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
    let mut projection = Projection::new(
        session
            .thread_id
            .clone()
            .context("Missing WorkBuddy native identity")?,
    );
    projection.records(&normalized, &tx)?;
    drop(tx);
    let mut events = vec![];
    while let Some(event) = rx.recv().await {
        events.push(event);
    }
    if notice.is_none() {
        let keys = events
            .iter()
            .filter_map(|event| {
                event["params"]["sourceEventKey"]
                    .as_str()
                    .map(str::to_owned)
            })
            .collect();
        if app.store.prune_persisted_history(&session.id, &keys)? {
            app.changed.notify_waiters();
        }
    }
    for event in events {
        let mut params = event["params"].clone();
        params["persisted_history"] = json!(true);
        app.store.event(
            &session.id,
            event["method"]
                .as_str()
                .context("Invalid WorkBuddy history event")?,
            params,
            None,
        )?;
    }
    cache.insert(session.id.clone(), (revision, notice.clone()));
    Ok((true, notice))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn temporary() -> PathBuf {
        let p = std::env::temp_dir().join(format!("anywork-wb-history-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&p).unwrap();
        p
    }
    fn session(cwd: &str) -> Session {
        Session {
            id: "workbuddy-native".into(),
            thread_id: Some("native".into()),
            title: "History".into(),
            cwd: cwd.into(),
            agent: AGENT.into(),
            model: None,
            policy: "manual".into(),
            status: "external".into(),
            archived: false,
            created_at: 1,
            updated_at: 2,
            external: true,
            auxiliary: false,
        }
    }
    fn metadata(root: &Path) -> Connection {
        let db = Connection::open(root.join("workbuddy.db")).unwrap();
        db.execute_batch("CREATE TABLE sessions(id TEXT,cwd TEXT,title TEXT,custom_title TEXT,status TEXT,created_at INTEGER,updated_at INTEGER,last_activity_at INTEGER,model TEXT,session_settings TEXT,transport TEXT,deleted_at INTEGER,user_id TEXT);").unwrap();
        db
    }
    #[test]
    fn catalog_reads_local_os_profile_history_without_account_stores() {
        let root = temporary();
        let db = metadata(&root);
        for (id, user, status, transport, settings, deleted) in [
            ("first", "old-account", "completed", "local", None, None),
            ("second", "new-account", "archived", "local", None, None),
            ("cloud", "new-account", "completed", "cloud", None, None),
            (
                "hidden",
                "new-account",
                "completed",
                "local",
                Some(r#"{"conversationTags":{"wbQuickAsk":"1"}}"#),
                None,
            ),
            (
                "deleted",
                "new-account",
                "completed",
                "local",
                None,
                Some(1),
            ),
        ] {
            db.execute("INSERT INTO sessions VALUES(?1,'/missing/project','native title','custom title',?2,100,200,300,'native-model',?3,?4,?5,?6)",rusqlite::params![id,status,settings,transport,deleted,user]).unwrap();
        }
        drop(db);
        let before = fs::read(root.join("workbuddy.db")).unwrap();
        let rows = scan(&root).unwrap();
        assert_eq!(rows.len(), 2);
        assert!(rows.iter().all(|s| s.agent == AGENT
            && s.external
            && s.status == "external"
            && s.title == "custom title"
            && s.updated_at == 300));
        assert!(rows.iter().any(|s| s.archived));
        assert_eq!(before, fs::read(root.join("workbuddy.db")).unwrap());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn transcript_projects_text_tools_and_native_request_identity() {
        let records = vec![
            json!({"id":"u","type":"message","role":"user","content":"hello","timestamp":"2026-11-06T01:00:00Z","providerData":{"conversationRequestId":"native-request"}}),
            json!({"id":"r","type":"reasoning","content":"reason","parentId":"u"}),
            json!({"id":"t","type":"function_call","name":"Read","callId":"tool-1","arguments":"{\"path\":\"README.md\"}"}),
            json!({"id":"o","type":"function_call_result","callId":"tool-1","status":"completed","output":{"result":"tool output"}}),
            json!({"id":"a","type":"message","role":"assistant","content":"answer"}),
        ];
        let requests = requests(&records).unwrap();
        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0]["id"], "native-request");
        assert_eq!(requests[0]["state"], "completed");
        assert_eq!(requests[0]["timestamp"], 1793926800000i64);
        assert_eq!(
            requests[0]["assistantMessage"]["content"][1]["toolCallId"],
            "tool-1"
        );
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        Projection::new("native".into())
            .records(&requests, &tx)
            .unwrap();
        let mut events = vec![];
        while let Ok(event) = rx.try_recv() {
            events.push(event)
        }
        assert!(
            events
                .iter()
                .any(|e| e["params"]["sourceEventKey"] == "workbuddy:native:native-request:user")
        );
        assert!(
            events
                .iter()
                .any(|e| e["params"]["item"]["nativeCallId"] == "tool-1"
                    && e["params"]["item"]["output"]["result"] == "tool output")
        );
        assert!(
            events
                .iter()
                .any(|e| e["params"]["item"]["type"] == "reasoning")
        );
    }
    #[test]
    fn legacy_native_user_id_is_stable_and_hidden_context_is_not_visible() {
        let records = vec![
            json!({"id":"hidden","type":"message","role":"user","content":"hidden system","providerData":{"isMeta":true}}),
            json!({"id":"legacy-user","type":"message","role":"user","content":"visible"}),
            json!({"id":"compact","type":"message","role":"user","content":"hidden compact","providerData":{"isCompactInternal":true}}),
            json!({"id":"assistant","type":"message","role":"assistant","content":"visible reply"}),
        ];
        let requests = requests(&records).unwrap();
        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0]["id"], "legacy-user");
        assert!(!requests[0].to_string().contains("hidden"));
    }
    #[test]
    fn native_active_branch_excludes_abandoned_resend() {
        let records = vec![
            json!({"id":"u1","type":"message","role":"user","content":"first"}),
            json!({"id":"a1","parentId":"u1","type":"message","role":"assistant","content":"first reply"}),
            json!({"id":"old","parentId":"a1","type":"message","role":"user","content":"old branch"}),
            json!({"id":"old-a","parentId":"old","type":"message","role":"assistant","content":"abandoned reply"}),
            json!({"id":"new","parentId":"a1","type":"message","role":"user","content":"new branch"}),
            json!({"id":"new-a","parentId":"new","type":"message","role":"assistant","content":"new reply"}),
        ];
        let active = active_history(records).unwrap();
        let projected = requests(&active).unwrap();
        assert_eq!(projected.len(), 2);
        assert!(
            !serde_json::to_string(&projected)
                .unwrap()
                .contains("abandoned")
        );
        assert_eq!(projected[1]["id"], "new");
    }
    #[test]
    fn partial_tail_has_notice_but_corrupt_complete_record_fails() {
        let root = temporary();
        let file = root.join("native.jsonl");
        fs::write(&file, b"{\"id\":\"one\",\"type\":\"message\"}\n{\"id\":").unwrap();
        let (records, notice) = transcript(&root, &file).unwrap();
        assert_eq!(records.len(), 1);
        assert!(notice.is_some());
        fs::write(&file, b"{broken}\n").unwrap();
        assert!(transcript(&root, &file).is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn aliases_and_project_keys_stay_inside_known_root() {
        let root = temporary();
        let s = session("/missing/work space");
        let project = root.join("projects").join(key(Path::new(&s.cwd)));
        fs::create_dir_all(&project).unwrap();
        fs::write(
            project.join("native.acp-session.json"),
            r#"{"acpSessionId":"actual"}"#,
        )
        .unwrap();
        fs::write(project.join("actual.jsonl"), "").unwrap();
        assert_eq!(
            paths(&root, &s).unwrap(),
            Some(project.join("actual.jsonl"))
        );
        fs::write(
            project.join("native.acp-session.json"),
            r#"{"acpSessionId":"../../private"}"#,
        )
        .unwrap();
        assert!(paths(&root, &s).is_err());
        assert!(key(Path::new(&format!("/{}", "子".repeat(300)))).len() < 255);
        fs::remove_dir_all(root).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn symlinked_native_source_is_rejected() {
        let root = temporary();
        let outside = temporary();
        fs::write(outside.join("secret"), "private").unwrap();
        std::os::unix::fs::symlink(outside.join("secret"), root.join("history.jsonl")).unwrap();
        assert!(transcript(&root, &root.join("history.jsonl")).is_err());
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }
    #[test]
    #[ignore = "requires explicit native history root; read-only aggregate metadata/transcript check"]
    fn installed_native_history_read_only() {
        let root = PathBuf::from(
            std::env::var_os("ANYWORK_TEST_WORKBUDDY_HISTORY_ROOT")
                .expect("explicit root required"),
        );
        let rows = scan(&root).unwrap();
        let mut count = 0;
        let mut turns = 0;
        let mut events = 0;
        for s in &rows {
            if let Some(path) = paths(&root, s).unwrap() {
                let (records, _) = transcript(&root, &path).unwrap();
                let normalized = requests(&records).unwrap();
                turns += normalized.len();
                let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
                Projection::new(s.thread_id.clone().unwrap())
                    .records(&normalized, &tx)
                    .unwrap();
                while rx.try_recv().is_ok() {
                    events += 1
                }
                count += 1;
            }
        }
        assert!(!rows.is_empty());
        assert_eq!(count, rows.len());
        println!(
            "Read-only native WorkBuddy: {} metadata rows, {count} transcript files, {turns} projected turns, {events} events; no prompts or writes",
            rows.len()
        );
    }
}
