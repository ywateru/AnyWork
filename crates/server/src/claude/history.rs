//! Passive Claude JSONL reads. Behavior reference: anthropics/claude-agent-sdk-python
//! 22b8eb9c19adfa78759b79e22bd664a57843bb06, _internal/sessions.py (MIT).
//! This Rust implementation walks parentUuid, never logicalParentUuid, then
//! recovers parallel tool siblings belonging to the same API response/writer.
use super::{CODE, Config, protocol};
use crate::{App, store::Session};
use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::Read,
    path::{Path, PathBuf},
};

const LIMIT: usize = 128 * 1024 * 1024;
pub fn read_file(path: &Path, limit: usize) -> Result<Vec<u8>> {
    ensure!(
        fs::symlink_metadata(path)?.file_type().is_file(),
        "Claude history file must be a regular file"
    );
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    let file = options
        .open(path)
        .context("Claude history file unavailable")?;
    ensure!(
        file.metadata()?.is_file() && file.metadata()?.len() <= limit as u64,
        "Claude history file exceeds read limit"
    );
    let mut bytes = Vec::new();
    file.take(limit as u64 + 1).read_to_end(&mut bytes)?;
    ensure!(
        bytes.len() <= limit,
        "Claude history file exceeds read limit"
    );
    Ok(bytes)
}
fn files(root: &Path) -> Result<Vec<PathBuf>> {
    ensure!(root.is_absolute(), "Claude history root must be absolute");
    let projects = root.join("projects");
    if !projects.exists() {
        return Ok(vec![]);
    }
    ensure!(
        !fs::symlink_metadata(&projects)?.file_type().is_symlink(),
        "Claude projects directory must not be a symlink"
    );
    let mut files = vec![];
    for (n, entry) in fs::read_dir(projects)?.enumerate() {
        ensure!(n < 10_000, "Claude project discovery exceeds limit");
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            continue;
        }
        for file in fs::read_dir(entry.path())? {
            let file = file?;
            let path = file.path();
            if path.extension().is_some_and(|s| s == "jsonl")
                && path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .is_some_and(|s| uuid::Uuid::parse_str(s).is_ok())
            {
                ensure!(
                    file.file_type()?.is_file(),
                    "Claude session must be a regular file"
                );
                ensure!(
                    files.len() < 100_000,
                    "Claude history discovery exceeds limit"
                );
                files.push(path);
            }
        }
    }
    files.sort();
    Ok(files)
}
pub fn find(root: &Path, thread: &str) -> Result<Option<PathBuf>> {
    uuid::Uuid::parse_str(thread).context("Invalid Claude session ID")?;
    let matches: Vec<_> = files(root)?
        .into_iter()
        .filter(|p| p.file_stem().and_then(|s| s.to_str()) == Some(thread))
        .collect();
    ensure!(
        matches.len() <= 1,
        "Ambiguous Claude session ID across project histories"
    );
    Ok(matches.into_iter().next())
}
pub(super) fn read(path: &Path) -> Result<(Vec<Value>, bool)> {
    let bytes = read_file(path, LIMIT)?;
    let mut rows = vec![];
    let mut partial = false;
    let mut identities = HashMap::new();
    let lines: Vec<_> = bytes.split(|b| *b == b'\n').collect();
    for (n, line) in lines.iter().enumerate() {
        if line.is_empty() {
            continue;
        }
        match serde_json::from_slice::<Value>(line) {
            Ok(row) if row.is_object() => {
                if let Some(id) = uid(&row)
                    && let Some(previous) = identities.insert(id.to_string(), row.clone())
                {
                    ensure!(
                        previous == row,
                        "Conflicting Claude history UUID at line {}",
                        n + 1
                    );
                    continue;
                }
                rows.push(row);
            }
            Err(_) if n + 1 == lines.len() && !bytes.ends_with(b"\n") => partial = true,
            _ => anyhow::bail!("Malformed Claude history record at line {}", n + 1),
        }
        ensure!(
            rows.len() <= 200_000,
            "Claude history record count exceeds limit"
        );
    }
    Ok((rows, partial))
}
fn uid(row: &Value) -> Option<&str> {
    row["uuid"].as_str()
}
fn visible(row: &Value) -> bool {
    matches!(row["type"].as_str(), Some("user" | "assistant"))
        && row["isSidechain"] != true
        && row["isMeta"] != true
        && row["teamName"].as_str().is_none_or(str::is_empty)
}
fn same_writer(a: &Value, b: &Value) -> bool {
    (a["isSidechain"] == true) == (b["isSidechain"] == true) && a["teamName"] == b["teamName"]
}
fn message_id(row: &Value) -> Option<&str> {
    (row["type"] == "assistant")
        .then(|| row["message"]["id"].as_str())
        .flatten()
        .filter(|s| !s.is_empty())
}
fn blocks(row: &Value) -> impl Iterator<Item = &Value> {
    row["message"]["content"].as_array().into_iter().flatten()
}

pub(super) fn chain(rows: &[Value]) -> Vec<Value> {
    let entries: Vec<_> = rows
        .iter()
        .filter(|r| {
            uid(r).is_some()
                && matches!(
                    r["type"].as_str(),
                    Some("user" | "assistant" | "progress" | "system" | "attachment")
                )
        })
        .collect();
    let index: HashMap<_, _> = entries
        .iter()
        .enumerate()
        .filter_map(|(i, r)| uid(r).map(|id| (id, i)))
        .collect();
    let parents: HashSet<_> = entries
        .iter()
        .filter_map(|r| r["parentUuid"].as_str())
        .collect();
    let mut leaves = vec![];
    for row in &entries {
        if parents.contains(uid(row).unwrap()) {
            continue;
        }
        let mut cur = Some(*row);
        let mut seen = HashSet::new();
        while let Some(r) = cur {
            if !seen.insert(uid(r).unwrap()) {
                break;
            }
            if visible(r) {
                leaves.push(r);
                break;
            }
            cur = r["parentUuid"]
                .as_str()
                .and_then(|p| index.get(p))
                .map(|i| entries[*i]);
        }
    }
    let Some(leaf) = leaves
        .iter()
        .copied()
        .filter(|r| visible(r))
        .max_by_key(|r| index[uid(r).unwrap()])
    else {
        return vec![];
    };
    let mut ordered = vec![];
    let mut seen = HashSet::new();
    let mut cur = Some(leaf);
    while let Some(r) = cur {
        if !seen.insert(uid(r).unwrap()) {
            break;
        }
        ordered.push(r);
        cur = r["parentUuid"]
            .as_str()
            .and_then(|p| index.get(p))
            .map(|i| entries[*i]);
    }
    ordered.reverse();
    // Anchor each response at its last on-chain assistant content block.
    let mut anchors = HashMap::new();
    for r in &ordered {
        if let Some(id) = message_id(r) {
            anchors.insert(id, uid(r).unwrap());
        }
    }
    let mut inserts: HashMap<&str, Vec<&Value>> = HashMap::new();
    for (mid, anchor) in anchors {
        let siblings: Vec<_> = entries
            .iter()
            .copied()
            .filter(|r| message_id(r) == Some(mid) && same_writer(r, leaf))
            .collect();
        let members: HashSet<_> = siblings.iter().filter_map(|r| uid(r)).collect();
        let calls: HashSet<_> = siblings
            .iter()
            .flat_map(|r| blocks(r))
            .filter(|b| b["type"] == "tool_use")
            .filter_map(|b| b["id"].as_str())
            .collect();
        let mut recovered: Vec<_> = siblings
            .into_iter()
            .filter(|r| !seen.contains(uid(r).unwrap()))
            .collect();
        let mut answered: HashSet<_> = ordered
            .iter()
            .flat_map(|r| blocks(r))
            .filter(|b| b["type"] == "tool_result")
            .filter_map(|b| b["tool_use_id"].as_str())
            .collect();
        for r in &entries {
            if seen.contains(uid(r).unwrap()) || r["type"] != "user" || !same_writer(r, leaf) {
                continue;
            }
            let ids: Vec<_> = blocks(r)
                .filter(|b| b["type"] == "tool_result")
                .filter_map(|b| b["tool_use_id"].as_str())
                .collect();
            let direct = r["parentUuid"]
                .as_str()
                .is_some_and(|p| members.contains(p));
            let owns = ids.iter().any(|id| calls.contains(id) && !answered.contains(id)
                // Reused tool IDs across different API responses are ambiguous.
                && entries.iter().filter(|e| message_id(e).is_some_and(|other| other != mid)).all(|e| !blocks(e).any(|b| b["type"] == "tool_use" && b["id"] == *id)));
            if !ids.is_empty() && (direct || owns) {
                answered.extend(ids);
                recovered.push(r);
            }
        }
        recovered.sort_by_key(|r| {
            (
                r["type"] != "assistant",
                r["timestamp"].as_str().unwrap_or(""),
                index[uid(r).unwrap()],
            )
        });
        recovered.retain(|r| seen.insert(uid(r).unwrap()));
        inserts.insert(anchor, recovered);
    }
    ordered
        .into_iter()
        .flat_map(|r| std::iter::once(r).chain(inserts.remove(uid(r).unwrap()).unwrap_or_default()))
        .filter(|r| visible(r))
        .cloned()
        .collect()
}
fn timestamp(row: &Value) -> i64 {
    row["timestamp"]
        .as_str()
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|d| d.timestamp_millis())
        .unwrap_or(0)
}
fn title(rows: &[Value], messages: &[Value]) -> String {
    // Only top-level metadata rows carry titles. Never scan tool input or
    // assistant content for a coincidentally named field.
    let metadata = |kind: &str, key: &str| {
        rows.iter()
            .rev()
            .filter(|r| r["type"] == kind)
            .find_map(|r| r[key].as_str().filter(|s| !s.trim().is_empty()))
    };
    metadata("custom-title", "customTitle")
        .or_else(|| metadata("ai-title", "aiTitle"))
        .or_else(|| metadata("last-prompt", "lastPrompt"))
        .or_else(|| metadata("summary", "summary"))
        .map(str::to_string)
        .or_else(|| {
            messages
                .iter()
                .filter(|r| protocol::is_user_prompt(r))
                .map(|r| protocol::text(&r["message"]["content"]))
                .find(|s| !s.trim().is_empty())
                .map(|s| s.chars().take(80).collect())
        })
        .unwrap_or_else(|| "Claude Code".into())
}
pub fn sync(app: &App, config: &Config) -> Result<()> {
    let existing = app.store.sessions()?;
    let managed: HashSet<_> = existing
        .iter()
        .filter(|s| s.agent == CODE && !s.external)
        .filter_map(|s| s.thread_id.as_deref())
        .collect();
    let mut failed = 0;
    for path in files(&config.root)? {
        let result = (|| -> Result<()> {
            let thread = path.file_stem().and_then(|s| s.to_str()).unwrap();
            if managed.contains(thread) {
                return Ok(());
            }
            let (rows, _) = read(&path)?;
            let messages = chain(&rows);
            if messages.is_empty() {
                return Ok(());
            }
            ensure!(
                messages
                    .iter()
                    .all(|r| r["sessionId"].as_str().is_none_or(|id| id == thread)),
                "Claude history session identity mismatch"
            );
            let cwd = messages
                .iter()
                .rev()
                .find_map(|r| r["cwd"].as_str())
                .context("Claude history has no working directory")?;
            if app.session_in_scope(cwd, CODE).is_err() {
                return Ok(());
            }
            let id = format!("{CODE}-{thread}");
            if app.runtimes.blocking_lock().contains_key(&id) {
                return Ok(());
            }
            let old = existing.iter().find(|s| s.id == id);
            let title = title(&rows, &messages);
            let s = Session {
                id,
                thread_id: Some(thread.into()),
                title,
                cwd: cwd.into(),
                agent: CODE.into(),
                model: messages
                    .iter()
                    .rev()
                    .find_map(|r| r["message"]["model"].as_str())
                    .map(str::to_string),
                policy: "manual".into(),
                status: "external".into(),
                archived: old.is_some_and(|s| s.archived),
                created_at: messages.first().map(timestamp).unwrap_or(0),
                updated_at: messages.iter().map(timestamp).max().unwrap_or(0),
                external: true,
                auxiliary: false,
            };
            app.store.save_shared_observation(&s)?;
            Ok(())
        })();
        if result.is_err() {
            failed += 1;
        }
    }
    ensure!(
        failed == 0,
        "{failed} Claude history files could not be read; previously discovered history retained"
    );
    Ok(())
}
pub fn import(app: &App, s: &Session, config: &Config) -> Result<(bool, Option<String>)> {
    let thread = s
        .thread_id
        .as_deref()
        .context("Missing Claude session ID")?;
    let Some(path) = find(&config.root, thread)? else {
        return Ok((false, None));
    };
    let (rows, partial) = read(&path)?;
    let messages = chain(&rows);
    ensure!(
        messages
            .iter()
            .all(|row| row["sessionId"].as_str().is_none_or(|id| id == thread)),
        "Claude history session identity mismatch"
    );
    import_messages(app, s, messages, partial)
}
pub(super) fn import_messages(
    app: &App,
    s: &Session,
    messages: Vec<Value>,
    partial: bool,
) -> Result<(bool, Option<String>)> {
    // An empty projection can mean a new format, a partial rewrite or only
    // metadata. It is never authoritative evidence to erase a cached chain.
    if messages.is_empty() {
        return Ok((
            false,
            Some("Claude 历史没有可识别的主消息链；保留此前缓存".into()),
        ));
    }
    let thread = s
        .thread_id
        .as_deref()
        .context("Missing Claude session identity")?;
    let mut turn = String::new();
    let mut keys = HashSet::new();
    let mut offsets: HashMap<String, usize> = HashMap::new();
    let mut tools: HashMap<String, Value> = HashMap::new();
    for mut row in messages {
        if protocol::is_user_prompt(&row) {
            turn = uid(&row).unwrap().into();
        }
        if let Some(mid) = message_id(&row).map(str::to_string) {
            let offset = offsets.entry(mid).or_default();
            row["_anyworkBlockOffset"] = json!(*offset);
            *offset += row["message"]["content"].as_array().map_or(0, Vec::len);
        }
        let native_identity = row["sessionId"]
            .as_str()
            .or_else(|| row["session_id"].as_str());
        // Event identity belongs to the projected session. Desktop's CLI UUID
        // is provenance only: using it in source keys would duplicate the same
        // SDK message when a live Desktop event is hydrated after reconnect.
        for (method, mut params) in protocol::row_events(thread, &turn, &row) {
            params["threadId"] = json!(thread);
            if s.agent == super::DESKTOP {
                params["claudeCliSessionId"] = json!(native_identity);
                params["claudeDesktopProfileRoot"] = row["_anyworkDesktopProfileRoot"].clone();
            }
            if method == "item/started"
                && let Some(id) = params["item"]["id"].as_str()
            {
                tools.insert(id.into(), params["item"].clone());
            } else if method == "item/completed"
                && let Some(id) = params["item"]["id"].as_str()
                && let Some(mut tool) = tools.remove(id)
            {
                for key in ["aggregatedOutput", "result", "status"] {
                    tool[key] = params["item"][key].clone();
                }
                params["item"] = tool;
            }
            params["persisted_history"] = json!(true);
            params["sourceEventTime"] = json!(timestamp(&row));
            params["history_turn_id"] = json!(turn);
            params["history_turn_status"] = json!("completed");
            if let Some(key) = params["sourceEventKey"].as_str() {
                keys.insert(key.to_string());
            }
            app.store.event(&s.id, &method, params, None)?;
        }
    }
    if !partial {
        app.store.prune_persisted_history(&s.id, &keys)?;
    }
    Ok((
        true,
        partial.then(|| "Claude 历史末尾正在写入或不完整；已加载完整记录".into()),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn row(id: &str, parent: Option<&str>, ty: &str) -> Value {
        json!({"uuid":id,"parentUuid":parent,"type":ty,"message":{"content":[{"type":"text","text":id}]}})
    }
    #[test]
    fn selects_main_branch_ignores_sidechain_meta_and_logical_parent() {
        let mut rows = vec![
            row("u", None, "user"),
            row("a", Some("u"), "assistant"),
            row("obsolete", Some("a"), "user"),
            row("new", Some("a"), "user"),
        ];
        let mut side = row("side", Some("new"), "assistant");
        side["isSidechain"] = json!(true);
        rows.push(side);
        assert_eq!(
            chain(&rows).iter().filter_map(uid).collect::<Vec<_>>(),
            ["u", "a", "new"]
        );
        let mut compact = row("compact", None, "user");
        compact["logicalParentUuid"] = json!("new");
        compact["isCompactSummary"] = json!(true);
        rows.push(compact);
        assert_eq!(
            chain(&rows).iter().filter_map(uid).collect::<Vec<_>>(),
            ["compact"]
        );
    }
    #[test]
    fn recovers_parallel_tools_without_recovering_abandoned_conversation() {
        let rows = vec![
            row("u", None, "user"),
            json!({"uuid":"a1","type":"assistant","parentUuid":"u","message":{"id":"m","content":[{"type":"tool_use","id":"t1"}]}}),
            json!({"uuid":"a2","type":"assistant","parentUuid":"a1","message":{"id":"m","content":[{"type":"tool_use","id":"t2"}]}}),
            json!({"uuid":"r1","type":"user","parentUuid":"a1","message":{"content":[{"type":"tool_result","tool_use_id":"t1"}]}}),
            json!({"uuid":"r2","type":"user","parentUuid":"a2","message":{"content":[{"type":"tool_result","tool_use_id":"t2"}]}}),
            row("final", Some("r1"), "assistant"),
        ];
        let chain = chain(&rows);
        let ids: Vec<_> = chain.iter().filter_map(uid).collect();
        for id in ["a1", "a2", "r1", "r2", "final"] {
            assert!(ids.contains(&id));
        }
        assert_eq!(ids.len(), 6);
    }
    #[test]
    fn corrupt_committed_record_fails_without_disclosing_content() {
        let tmp = tempfile::NamedTempFile::new().unwrap();
        fs::write(tmp.path(), b"{PRIVATE\n").unwrap();
        let e = read(tmp.path()).unwrap_err().to_string();
        assert!(!e.contains("PRIVATE"));
        fs::write(tmp.path(), b"{}\n{PRIVATE").unwrap();
        assert!(read(tmp.path()).unwrap().1);
    }
    #[test]
    fn conflicting_uuid_is_not_silently_overwritten() {
        let tmp = tempfile::NamedTempFile::new().unwrap();
        fs::write(
            tmp.path(),
            b"{\"uuid\":\"u\",\"type\":\"user\"}\n{\"uuid\":\"u\",\"type\":\"assistant\"}\n",
        )
        .unwrap();
        assert!(
            read(tmp.path())
                .unwrap_err()
                .to_string()
                .contains("Conflicting")
        );
    }
    #[test]
    fn metadata_title_priority_ignores_empty_and_nested_tool_fields() {
        let messages = vec![row("first prompt", None, "user")];
        let mut rows = vec![
            json!({"type":"assistant","message":{"content":[{"type":"tool_use","input":{"customTitle":"wrong"}}]}}),
        ];
        assert_eq!(title(&rows, &messages), "first prompt");
        for (kind, field, value) in [
            ("summary", "summary", "summary"),
            ("last-prompt", "lastPrompt", "latest"),
            ("ai-title", "aiTitle", "AI"),
            ("custom-title", "customTitle", "custom"),
        ] {
            let mut metadata = json!({"type":kind});
            metadata[field] = json!(value);
            rows.push(metadata);
            assert_eq!(title(&rows, &messages), value);
        }
        rows.push(json!({"type":"custom-title","customTitle":"  "}));
        assert_eq!(title(&rows, &messages), "custom");
    }
}
