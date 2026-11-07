//! Read-only Harness v4 JSONL history. Native roots/schema are documented in
//! docs/harness-persisted-history.md; opening a log never starts a host or lease.
use super::{AGENT, Projection};
use crate::{App, store::Session};
use anyhow::{Context, Result, bail, ensure};
use serde_json::{Value, json};
use std::{
    collections::{HashMap, HashSet},
    fs::{self, File},
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock},
    time::SystemTime,
};

const HEADER_LIMIT: usize = 64 * 1024;
const BODY_LIMIT: usize = 128 * 1024 * 1024;
const ENTRY_LIMIT: usize = 10_000;
#[derive(Clone, PartialEq, Eq)]
struct Revision(u64, SystemTime);
#[derive(Clone)]
struct Header {
    value: Value,
    path: PathBuf,
    revision: Revision,
}
type HeaderCache = HashMap<PathBuf, (Revision, Value)>;
static HEADERS: OnceLock<Mutex<HeaderCache>> = OnceLock::new();
static IMPORTED: OnceLock<Mutex<HashMap<(PathBuf, PathBuf), Revision>>> = OnceLock::new();

fn default_home() -> Result<Option<PathBuf>> {
    let root = std::env::var_os("DSH_HOME").map(PathBuf::from).or_else(|| {
        std::env::var_os("HOME")
            .or_else(|| std::env::var_os("USERPROFILE"))
            .map(|p| PathBuf::from(p).join(".dsh"))
    });
    if let Some(root) = &root {
        ensure!(root.is_absolute(), "Harness history root must be absolute");
    }
    Ok(root)
}
// Explicit hosts can belong to another profile. Their private launch credential
// carries no data-directory identity, so never pair one with an assumed HOME.
fn home(app: &App) -> Result<Option<PathBuf>> {
    if let Some(root) = &app.harness_history_root {
        ensure!(root.is_absolute(), "Harness history root must be absolute");
        return Ok(Some(root.clone()));
    }
    if app.harness.as_ref().is_some_and(|config| !config.optional) {
        return Ok(None);
    }
    default_home()
}
fn safe_path(path: &Path) -> Result<()> {
    ensure!(path.is_absolute(), "Harness history path must be absolute");
    let mut cursor = PathBuf::new();
    for part in path.components() {
        ensure!(
            !matches!(part, std::path::Component::ParentDir),
            "Invalid Harness history path"
        );
        cursor.push(part.as_os_str());
        let meta = fs::symlink_metadata(&cursor).context("Harness history path is unavailable")?;
        ensure!(
            !meta.file_type().is_symlink(),
            "Harness history paths must not contain symlinks"
        );
    }
    Ok(())
}
fn revision(path: &Path) -> Result<Revision> {
    safe_path(path)?;
    let meta = fs::metadata(path)?;
    ensure!(
        meta.is_file(),
        "Harness history entry is not a regular file"
    );
    Ok(Revision(meta.len(), meta.modified()?))
}
fn open_file(path: &Path, limit: usize) -> Result<File> {
    safe_path(path)?;
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    let file = options.open(path)?;
    ensure!(
        file.metadata()?.is_file() && file.metadata()?.len() <= limit as u64,
        "Harness history file exceeds its read limit"
    );
    Ok(file)
}
fn json_file(path: &Path, limit: usize) -> Result<Value> {
    let mut bytes = Vec::new();
    open_file(path, limit)?
        .take(limit as u64 + 1)
        .read_to_end(&mut bytes)?;
    ensure!(
        bytes.len() <= limit,
        "Harness metadata exceeds its read limit"
    );
    serde_json::from_slice(&bytes).context("Invalid Harness history metadata")
}
fn generation(name: &str) -> Option<(u64, bool)> {
    let (name, compressed) = name
        .strip_suffix(".zstd")
        .map_or((name, false), |v| (v, true));
    if name == "session.jsonl" {
        return Some((0, compressed));
    }
    let version = name.strip_prefix("session.v")?.strip_suffix(".jsonl")?;
    if version.starts_with('0') || !version.bytes().all(|c| c.is_ascii_digit()) {
        return None;
    }
    Some((version.parse().ok()?, compressed))
}
fn selected_log(dir: &Path) -> Result<Option<PathBuf>> {
    safe_path(dir)?;
    let mut selected: Option<(u64, PathBuf)> = None;
    let mut encoding = None;
    for entry in fs::read_dir(dir)?.take(ENTRY_LIMIT + 1) {
        let entry = entry?;
        let Some((version, compressed)) = generation(&entry.file_name().to_string_lossy()) else {
            continue;
        };
        ensure!(
            entry.file_type()?.is_file(),
            "Harness generation must be a regular file"
        );
        ensure!(
            encoding.is_none_or(|old| old == compressed),
            "Harness session has conflicting log encodings"
        );
        encoding = Some(compressed);
        if selected.as_ref().is_none_or(|(old, _)| version > *old) {
            selected = Some((version, entry.path()));
        }
    }
    match selected {
        Some((4, path)) => Ok(Some(path)),
        Some(_) => bail!("Unsupported Harness history generation; this reader supports v4"),
        None => Ok(None),
    }
}
// Zstandard frames are independently committed native batches. Locate complete
// frames before decoding so a concurrent torn final frame is never repaired or
// mistaken for an empty session. Reserved structure and oversized windows fail.
fn frame_end(bytes: &[u8], start: usize) -> Result<Option<usize>> {
    let Some(magic) = bytes.get(start..start + 4) else {
        return Ok(None);
    };
    ensure!(
        magic == [0x28, 0xb5, 0x2f, 0xfd],
        "Invalid Harness compressed frame"
    );
    let Some(&descriptor) = bytes.get(start + 4) else {
        return Ok(None);
    };
    ensure!(
        descriptor & 0x18 == 0,
        "Invalid Harness compressed frame descriptor"
    );
    let single = descriptor & 0x20 != 0;
    let mut cursor = start + 5;
    if !single {
        let Some(&window) = bytes.get(cursor) else {
            return Ok(None);
        };
        let base = 1_u64
            .checked_shl(10 + u32::from(window >> 3))
            .unwrap_or(u64::MAX);
        ensure!(
            base.saturating_add((base / 8).saturating_mul(u64::from(window & 7)))
                <= BODY_LIMIT as u64,
            "Harness compressed window exceeds limit"
        );
        cursor += 1;
    }
    cursor += [0, 1, 2, 4][usize::from(descriptor & 3)];
    let size_len = match descriptor >> 6 {
        0 if single => 1,
        0 => 0,
        1 => 2,
        2 => 4,
        _ => 8,
    };
    let Some(size) = bytes.get(cursor..cursor + size_len) else {
        return Ok(None);
    };
    if size_len > 0 {
        let mut padded = [0_u8; 8];
        padded[..size_len].copy_from_slice(size);
        let size = u64::from_le_bytes(padded).saturating_add(if size_len == 2 { 256 } else { 0 });
        ensure!(
            size <= BODY_LIMIT as u64,
            "Harness compressed frame exceeds limit"
        );
    }
    cursor += size_len;
    loop {
        let Some(header) = bytes.get(cursor..cursor + 3) else {
            return Ok(None);
        };
        let block =
            u32::from(header[0]) | (u32::from(header[1]) << 8) | (u32::from(header[2]) << 16);
        let typ = (block >> 1) & 3;
        ensure!(typ != 3, "Invalid Harness compressed block");
        cursor = cursor
            .checked_add(3 + if typ == 1 { 1 } else { (block >> 3) as usize })
            .context("Harness frame size overflow")?;
        if cursor > bytes.len() {
            return Ok(None);
        }
        if block & 1 != 0 {
            break;
        }
    }
    if descriptor & 4 != 0 {
        cursor += 4;
    }
    Ok((cursor <= bytes.len()).then_some(cursor))
}
fn decode_frame(bytes: &[u8], limit: usize) -> Result<Vec<u8>> {
    let mut decoder = ruzstd::decoding::StreamingDecoder::new(bytes)
        .context("Cannot decode Harness compressed frame")?;
    let mut output = Vec::new();
    decoder
        .by_ref()
        .take(limit as u64 + 1)
        .read_to_end(&mut output)
        .context("Corrupt Harness compressed frame")?;
    ensure!(
        output.len() <= limit,
        "Harness decompressed history exceeds limit"
    );
    if let Some(expected) = decoder.decoder.get_checksum_from_data() {
        ensure!(
            decoder.decoder.get_calculated_checksum() == Some(expected),
            "Harness compressed frame checksum mismatch"
        );
    }
    Ok(output)
}
fn raw_header(path: &Path) -> Result<Value> {
    let mut bytes = Vec::new();
    // Metadata reads only the first independently compressed header frame.
    let file = open_file(path, usize::MAX)?;
    let mut reader = BufReader::new(file.take(HEADER_LIMIT as u64));
    if path.extension().is_some_and(|ext| ext == "zstd") {
        reader.read_to_end(&mut bytes)?;
        let end = frame_end(&bytes, 0)?.context("Incomplete Harness header frame")?;
        bytes = decode_frame(&bytes[..end], HEADER_LIMIT)?;
        ensure!(
            bytes.iter().filter(|&&c| c == b'\n').count() == 1 && bytes.last() == Some(&b'\n'),
            "Harness first frame must contain exactly its header"
        );
    } else {
        reader.read_until(b'\n', &mut bytes)?;
        ensure!(
            bytes.last() == Some(&b'\n'),
            "Incomplete Harness history header"
        );
    }
    let value: Value = serde_json::from_slice(&bytes).context("Invalid Harness session header")?;
    ensure!(
        value["type"] == "session"
            && value["version"] == 4
            && value["createdAt"].as_i64().is_some_and(|v| v >= 0)
            && value["isSeeded"].is_boolean(),
        "Unsupported Harness session header"
    );
    let id = value["id"]
        .as_str()
        .context("Missing Harness native identity")?;
    ensure!(
        !id.is_empty()
            && id.len() <= 512
            && id
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_' | b'.' | b':')),
        "Unsupported Harness native identity"
    );
    ensure!(
        value["cwd"]
            .as_str()
            .is_some_and(|v| Path::new(v).is_absolute()),
        "Harness session has no absolute working directory"
    );
    ensure!(
        path.parent()
            .and_then(Path::file_name)
            .and_then(|v| v.to_str())
            == Some(id),
        "Harness history directory and native identity disagree"
    );
    Ok(value)
}
fn header(path: PathBuf) -> Result<Header> {
    let rev = revision(&path)?;
    if let Some((cached, value)) = HEADERS
        .get_or_init(Default::default)
        .lock()
        .unwrap()
        .get(&path)
        && *cached == rev
    {
        return Ok(Header {
            value: value.clone(),
            path,
            revision: rev,
        });
    }
    let value = raw_header(&path)?;
    let mut cache = HEADERS.get_or_init(Default::default).lock().unwrap();
    if cache.len() >= ENTRY_LIMIT {
        cache.clear();
    }
    cache.insert(path.clone(), (rev.clone(), value.clone()));
    Ok(Header {
        value,
        path,
        revision: rev,
    })
}
fn headers(root: &Path) -> Result<Vec<Header>> {
    let sessions = root.join("sessions");
    if !sessions.try_exists()? {
        return Ok(vec![]);
    }
    safe_path(&sessions)?;
    let mut output = Vec::new();
    let mut seen = HashSet::new();
    let mut count = 0;
    for project in fs::read_dir(&sessions)? {
        let project = project?;
        ensure!(
            !project.file_type()?.is_symlink(),
            "Harness history project must not be a symlink"
        );
        if !project.file_type()?.is_dir() {
            continue;
        }
        for dir in fs::read_dir(project.path())? {
            count += 1;
            ensure!(
                count <= ENTRY_LIMIT,
                "Harness history catalog exceeds limit"
            );
            let dir = dir?;
            ensure!(
                !dir.file_type()?.is_symlink(),
                "Harness session directory must not be a symlink"
            );
            if !dir.file_type()?.is_dir() {
                continue;
            }
            if let Some(path) = selected_log(&dir.path())? {
                let h = header(path)?;
                ensure!(
                    seen.insert(h.value["id"].as_str().unwrap().to_owned()),
                    "Harness native identity occurs in multiple projects"
                );
                output.push(h);
            }
        }
    }
    Ok(output)
}
fn archived(root: &Path) -> Result<HashSet<String>> {
    let path = root.join("storages/workspace.json");
    if !path.try_exists()? {
        return Ok(HashSet::new());
    }
    let v = json_file(&path, 8 * 1024 * 1024)?;
    ensure!(
        v["unit"]["name"] == "workspace" && v["unit"]["version"] == 2,
        "Unsupported Harness workspace metadata"
    );
    Ok(v["global"]["archivedSessionIds"]
        .as_array()
        .context("Invalid Harness archived session catalog")?
        .iter()
        .map(|id| {
            id.as_str()
                .map(str::to_owned)
                .context("Invalid Harness archived session identity")
        })
        .collect::<Result<_>>()?)
}
fn title(root: &Path, h: &Header) -> Result<Option<String>> {
    let path = root
        .join("storages/session_projcache/sessions")
        .join(format!("{}.json", h.value["id"].as_str().unwrap()));
    if !path.try_exists()? {
        return Ok(None);
    }
    let v = match json_file(&path, 4 * 1024 * 1024) {
        Ok(value) => value,
        Err(error) if error.chain().any(|cause| cause.is::<serde_json::Error>()) => {
            return Ok(None);
        }
        Err(error) => return Err(error),
    };
    if !matches!(v["version"].as_u64(), Some(3..=7)) {
        return Ok(None);
    }
    let identity = &v["record"]["identity"];
    if identity["createdAt"] != h.value["createdAt"]
        || identity["cwd"] != h.value["cwd"]
        || identity["formatVersion"] != h.value["version"]
        || identity["isSeeded"].as_bool().unwrap_or(false)
            != h.value["isSeeded"].as_bool().unwrap_or(false)
    {
        return Ok(None);
    }
    let row = &v["record"]["rows"]["title"];
    Ok((row["ver"] == 1)
        .then(|| row["val"].as_str())
        .flatten()
        .filter(|s| !s.is_empty())
        .map(str::to_owned))
}
/// Catalog reads headers and projection hints only; conversation bodies stay cold.
pub(super) async fn sync(app: &Arc<App>) -> Result<()> {
    let Some(root) = home(app)? else {
        return Ok(());
    };
    let archive = archived(&root)?;
    let runtime_ids: HashSet<_> = app.runtimes.lock().await.keys().cloned().collect();
    for h in headers(&root)? {
        if h.value["parentSession"].is_string() || h.value["origin"] == "subagent" {
            continue;
        }
        let cwd = h.value["cwd"].as_str().unwrap();
        if app.session_in_scope(cwd, AGENT).is_err() {
            continue;
        }
        let thread = h.value["id"].as_str().unwrap();
        let id = super::session_id(thread);
        if runtime_ids.contains(&id) {
            continue;
        }
        let old = app.store.session(&id).ok();
        let session = Session {
            id,
            thread_id: Some(thread.into()),
            title: title(&root, &h)?
                .or_else(|| old.as_ref().map(|s| s.title.clone()))
                .unwrap_or_else(|| "Harness 会话".into()),
            cwd: cwd.into(),
            agent: AGENT.into(),
            model: old.as_ref().and_then(|s| s.model.clone()),
            policy: "manual".into(),
            status: "external".into(),
            archived: archive.contains(thread),
            created_at: h.value["createdAt"].as_i64().unwrap(),
            updated_at: h
                .revision
                .1
                .duration_since(SystemTime::UNIX_EPOCH)?
                .as_millis()
                .try_into()?,
            external: true,
            auxiliary: false,
        };
        app.store.save_shared_observation(&session)?;
    }
    Ok(())
}
fn read_body(h: &Header) -> Result<(Vec<Value>, bool)> {
    let mut bytes = Vec::new();
    open_file(&h.path, BODY_LIMIT)?
        .take(BODY_LIMIT as u64 + 1)
        .read_to_end(&mut bytes)?;
    ensure!(bytes.len() <= BODY_LIMIT, "Harness history exceeds limit");
    let mut incomplete = false;
    if h.path.extension().is_some_and(|v| v == "zstd") {
        let mut decoded = Vec::new();
        let mut cursor = 0;
        while cursor < bytes.len() {
            let Some(end) = frame_end(&bytes, cursor)? else {
                incomplete = true;
                break;
            };
            let frame = decode_frame(&bytes[cursor..end], BODY_LIMIT - decoded.len())?;
            decoded.extend_from_slice(&frame);
            cursor = end;
        }
        bytes = decoded;
    }
    let mut lines = bytes.split(|&c| c == b'\n');
    let decoded_header: Value =
        serde_json::from_slice(lines.next().context("Missing Harness header")?)?;
    ensure!(
        decoded_header == h.value,
        "Harness header changed while reading history"
    );
    let terminated = bytes.last() == Some(&b'\n');
    let mut rows = Vec::new();
    let event_lines: Vec<_> = lines.collect();
    for (index, line) in event_lines.iter().enumerate() {
        if index + 1 == event_lines.len() {
            if line.is_empty() {
                break;
            }
            if !terminated {
                incomplete = true;
                break;
            }
        }
        let row: Value =
            serde_json::from_slice(line).context("Malformed committed Harness history event")?;
        ensure!(
            row["seq"].as_u64() == Some(rows.len() as u64)
                && row["time"].as_i64().is_some_and(|t| t >= 0)
                && row["type"].is_string()
                && row["data"].is_object(),
            "Invalid Harness history event sequence"
        );
        ensure!(
            rows.len() < 100_000,
            "Harness history record count exceeds limit"
        );
        rows.push(row);
    }
    Ok((rows, incomplete))
}
fn materialize_attachments(
    app: &App,
    root: &Path,
    session: &Session,
    event: &mut Value,
) -> Result<()> {
    use sha2::{Digest, Sha256};
    let content = if event["type"] == "user/message" {
        event["data"].get_mut("content")
    } else {
        event["data"]["message"].get_mut("content")
    };
    let Some(parts) = content.and_then(Value::as_array_mut) else {
        return Ok(());
    };
    for part in parts {
        let typ = part["type"].as_str().unwrap_or("");
        if !matches!(typ, "image" | "file") {
            continue;
        }
        let reference = &part["attachment"];
        let Some(hash) = reference["attachmentId"]
            .as_str()
            .and_then(|id| id.strip_prefix("sha256:"))
            .filter(|h| {
                h.len() == 64
                    && h.bytes()
                        .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
            })
        else {
            bail!("Invalid Harness attachment identity");
        };
        let (source, name) = if typ == "image" {
            let ext = match reference["mediaType"].as_str() {
                Some("image/png") => "png",
                Some("image/jpeg") => "jpg",
                Some("image/webp") => "webp",
                Some("image/gif") => "gif",
                _ => bail!("Unsupported Harness image type"),
            };
            (
                root.join("attachments/v1/objects")
                    .join(&hash[..2])
                    .join(hash),
                format!("harness-sha256-{hash}.{ext}"),
            )
        } else {
            let name = reference["name"]
                .as_str()
                .context("Invalid Harness attachment name")?;
            ensure!(
                !name.is_empty()
                    && name.len() <= 255
                    && !name.contains(['/', '\\'])
                    && name != "."
                    && name != ".."
                    && !name.chars().any(char::is_control),
                "Invalid Harness attachment name"
            );
            (
                root.join("attachments/v1/files")
                    .join(&hash[..2])
                    .join(hash)
                    .join(name),
                format!("harness-sha256-{hash}-{name}"),
            )
        };
        if !source.try_exists()? {
            *part = json!({"type":"text","text":if typ=="image"{"图片附件（本机文件暂不可用）"}else{"文件附件（本机文件暂不可用）"}});
            continue;
        }
        let mut data = Vec::new();
        open_file(&source, 20 * 1024 * 1024)?
            .take(20 * 1024 * 1024 + 1)
            .read_to_end(&mut data)?;
        ensure!(
            reference["bytes"].as_u64() == Some(data.len() as u64)
                && format!("{:x}", Sha256::digest(&data)) == hash,
            "Harness attachment content identity mismatch"
        );
        let folder = app.data_dir.join("uploads").join(&session.id);
        fs::create_dir_all(&folder)?;
        let path = folder.join(name);
        if !path.exists() {
            fs::write(&path, data)?;
        }
        *part = json!({"type":if typ=="image"{"localImage"}else{"localFile"},"path":path,"harnessAttachment":reference});
    }
    Ok(())
}
pub(super) fn import(app: &Arc<App>, session: &Session) -> Result<(bool, Option<String>)> {
    let Some(root) = home(app)? else {
        return Ok((false, None));
    };
    import_from_root(app, session, &root)
}
fn import_from_root(
    app: &Arc<App>,
    session: &Session,
    root: &Path,
) -> Result<(bool, Option<String>)> {
    let thread = session
        .thread_id
        .as_deref()
        .context("Missing Harness native identity")?;
    ensure!(
        session.agent == AGENT && session.id == super::session_id(thread),
        "Harness history session identity mismatch"
    );
    let Some(h) = headers(root)?.into_iter().find(|h| h.value["id"] == thread) else {
        return Ok((false, None));
    };
    app.session_in_scope(h.value["cwd"].as_str().unwrap(), AGENT)?;
    ensure!(
        h.value["cwd"] == session.cwd,
        "Harness persisted working directory does not match session"
    );
    let cache_key = (app.data_dir.clone(), h.path.clone());
    if IMPORTED
        .get_or_init(Default::default)
        .lock()
        .unwrap()
        .get(&cache_key)
        == Some(&h.revision)
        && !app.store.events(&session.id, 0, 1)?.is_empty()
    {
        return Ok((true, None));
    }
    let (mut rows, incomplete) = read_body(&h)?;
    let mut projection = Projection::new(thread.into());
    let (out, mut events) = tokio::sync::mpsc::unbounded_channel();
    for row in &mut rows {
        materialize_attachments(app, root, session, row)?;
        projection.event(row, &out)?;
    }
    drop(out);
    while let Ok(value) = events.try_recv() {
        app.store.event(
            &session.id,
            value["method"]
                .as_str()
                .context("Missing projected Harness event method")?,
            value["params"].clone(),
            None,
        )?;
    }
    // Incomplete tails must be re-read, even when a writer has not yet changed mtime.
    if !incomplete {
        let mut cache = IMPORTED.get_or_init(Default::default).lock().unwrap();
        if cache.len() >= ENTRY_LIMIT {
            cache.clear();
        }
        cache.insert(cache_key, h.revision);
    }
    Ok((
        true,
        incomplete.then(|| {
            "Harness 正在写入历史，已显示完整记录；末尾尚未提交的内容会在下次读取时重试。".into()
        }),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let dir = std::env::temp_dir()
                .canonicalize()
                .unwrap()
                .join(format!("anywork-dsh-history-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }
        fn log(&self, id: &str, rows: &[Value], compressed: bool) -> PathBuf {
            let dir = self.0.join("sessions/project").join(id);
            fs::create_dir_all(&dir).unwrap();
            let header = json!({"type":"session","version":4,"id":id,"createdAt":1000,"cwd":self.0.join("removed-project"),"isSeeded":false,"delegationDepth":0});
            let line = |v: &Value| format!("{v}\n").into_bytes();
            let data = if compressed {
                let mut bytes = frame(&line(&header));
                bytes.extend(frame(&rows.iter().flat_map(line).collect::<Vec<_>>()));
                bytes
            } else {
                line(&header)
                    .into_iter()
                    .chain(rows.iter().flat_map(line))
                    .collect()
            };
            let path = dir.join(if compressed {
                "session.v4.jsonl.zstd"
            } else {
                "session.v4.jsonl"
            });
            fs::write(&path, data).unwrap();
            path
        }
        fn app(&self) -> Arc<App> {
            Arc::new(App {
                catalog: Default::default(),
                harness: None,
                harness_history_root: None,
                harness_sync: Default::default(),
                workbuddy: crate::workbuddy::Config::configured(None).unwrap(),
                workbuddy_sync: Default::default(),
                codex_discovery: false,
                codex_scope: crate::CodexScope::Workspace,
                agent_scope: crate::CodexScope::All,
                #[cfg(unix)]
                desktop_ipc_socket: None,
                #[cfg(unix)]
                desktop_statuses: Default::default(),
                store: crate::store::Store::open(Path::new(":memory:")).unwrap(),
                workspace: self.0.clone(),
                data_dir: self.0.join("anywork"),
                token: "fixture-not-for-production".into(),
                clients: Default::default(),
                trust_local_proxy: false,
                plugins: Default::default(),
                runtimes: Default::default(),
                gates: Default::default(),
                changed: Default::default(),
                origins: vec![],
                stopping: Default::default(),
                shutdown: Default::default(),
                stop_requested: Default::default(),
            })
        }
        fn session(&self, id: &str) -> Session {
            Session {
                id: super::super::session_id(id),
                thread_id: Some(id.into()),
                title: "Original title".into(),
                cwd: self.0.join("removed-project").to_string_lossy().into(),
                agent: AGENT.into(),
                model: None,
                policy: "manual".into(),
                status: "external".into(),
                archived: false,
                created_at: 1000,
                updated_at: 2000,
                external: true,
                auxiliary: false,
            }
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn frame(data: &[u8]) -> Vec<u8> {
        assert!(data.len() < 128 * 1024);
        let mut bytes = vec![0x28, 0xb5, 0x2f, 0xfd, 0xa0];
        bytes.extend((data.len() as u32).to_le_bytes());
        let header = ((data.len() as u32) << 3) | 1;
        bytes.extend(&header.to_le_bytes()[..3]);
        bytes.extend(data);
        bytes
    }
    fn events() -> Vec<Value> {
        vec![
            json!({"seq":0,"type":"turn/start","time":2000,"data":{"turn":1}}),
            json!({"seq":1,"type":"user/message","time":2100,"data":{"id":"native-user","source":{"kind":"user"},"content":[{"type":"text","text":"offline user"}]}}),
            json!({"seq":2,"type":"tool/call","time":2200,"data":{"turn":1,"step":1,"callId":"native-call","name":"bash","arguments":{"command":"pwd"}}}),
            json!({"seq":3,"type":"tool/result","time":2300,"sourceEventSeqs":[2],"data":{"turn":1,"step":1,"message":{"callId":"native-call","content":[{"type":"text","text":"result"}]}}}),
            json!({"seq":4,"type":"assistant/message","time":2400,"data":{"turn":1,"step":1,"message":{"content":[{"type":"text","text":"offline answer"}]}}}),
            json!({"seq":5,"type":"turn/end","time":2500,"data":{"turn":1,"reason":{"kind":"completed"}}}),
        ]
    }
    #[test]
    fn compressed_batches_and_plaintext_read_the_same_native_events() {
        let f = Fixture::new();
        let rows = events();
        let compressed = f.log("native-compressed", &rows, true);
        let plain = f.log("native-plain", &rows, false);
        for path in [compressed, plain] {
            let h = header(path).unwrap();
            let (actual, torn) = read_body(&h).unwrap();
            assert_eq!(actual, rows);
            assert!(!torn);
        }
    }
    #[test]
    fn generations_are_numeric_and_foreign_latest_or_mixed_encodings_are_refused() {
        let f = Fixture::new();
        let path = f.log("native", &[], false);
        let dir = path.parent().unwrap();
        fs::write(dir.join("session.v3.jsonl"), b"older").unwrap();
        fs::write(dir.join("session.v9.jsonl.tmp"), b"temporary").unwrap();
        assert_eq!(selected_log(dir).unwrap(), Some(path.clone()));
        fs::write(dir.join("session.v10.jsonl"), b"future").unwrap();
        assert!(
            selected_log(dir)
                .unwrap_err()
                .to_string()
                .contains("Unsupported")
        );
        fs::remove_file(dir.join("session.v10.jsonl")).unwrap();
        fs::write(dir.join("session.v4.jsonl.zstd"), b"mixed").unwrap();
        assert!(
            selected_log(dir)
                .unwrap_err()
                .to_string()
                .contains("conflicting")
        );
    }
    #[test]
    fn torn_final_frame_is_reported_but_corrupt_committed_batches_fail() {
        let f = Fixture::new();
        let path = f.log("native", &events(), true);
        let mut bytes = fs::read(&path).unwrap();
        bytes.extend(&frame(b"next unfinished batch\n")[..9]);
        fs::write(&path, &bytes).unwrap();
        let (rows, torn) = read_body(&header(path.clone()).unwrap()).unwrap();
        assert_eq!(rows, events());
        assert!(torn);
        bytes.truncate(bytes.len() - 9);
        bytes.extend(frame(b"not-json\n"));
        fs::write(&path, bytes).unwrap();
        assert!(read_body(&header(path).unwrap()).is_err());
    }
    #[test]
    fn plaintext_torn_tail_preserves_prefix_but_complete_invalid_sequence_fails() {
        let f = Fixture::new();
        let path = f.log("native", &events(), false);
        let original = fs::read(&path).unwrap();
        let mut bytes = original.clone();
        bytes.extend(b"{\"seq\":6");
        fs::write(&path, bytes).unwrap();
        let (rows, torn) = read_body(&header(path.clone()).unwrap()).unwrap();
        assert_eq!(rows, events());
        assert!(torn);
        let mut bytes = original;
        bytes.extend(b"{\"seq\":9,\"type\":\"turn/start\",\"time\":3000,\"data\":{}}\n");
        fs::write(&path, bytes).unwrap();
        assert!(read_body(&header(path).unwrap()).is_err());
    }
    #[test]
    fn zstd_checksum_and_window_limits_are_enforced() {
        let data = b"small native batch\n";
        let mut bytes = frame(data);
        let mut decoder = ruzstd::decoding::StreamingDecoder::new(bytes.as_slice()).unwrap();
        let mut decoded = Vec::new();
        decoder.read_to_end(&mut decoded).unwrap();
        let checksum = decoder.decoder.get_calculated_checksum().unwrap();
        bytes[4] |= 4;
        bytes.extend(checksum.to_le_bytes());
        assert_eq!(decode_frame(&bytes, HEADER_LIMIT).unwrap(), data);
        *bytes.last_mut().unwrap() ^= 1;
        assert!(decode_frame(&bytes, HEADER_LIMIT).is_err());
        let mut window = vec![0x28, 0xb5, 0x2f, 0xfd, 0, 0xff];
        window.extend([1, 0, 0]);
        assert!(frame_end(&window, 0).is_err());
    }
    #[test]
    fn catalog_reads_only_headers_and_cache_titles_are_lifecycle_bound() {
        let f = Fixture::new();
        let path = f.log("native", &[], false);
        let mut data = fs::read(&path).unwrap();
        data.extend(b"malformed body\n");
        fs::write(&path, data).unwrap();
        let list = headers(&f.0).unwrap();
        assert_eq!(list.len(), 1);
        let h = &list[0];
        let folder = f.0.join("storages/session_projcache/sessions");
        fs::create_dir_all(&folder).unwrap();
        let cache = folder.join("native.json");
        let mut record = json!({"version":7,"record":{"identity":{"createdAt":1000,"cwd":h.value["cwd"],"formatVersion":4},"rows":{"title":{"ver":1,"seq":0,"val":"Cached native title"}}}});
        fs::write(&cache, record.to_string()).unwrap();
        assert_eq!(
            title(&f.0, h).unwrap().as_deref(),
            Some("Cached native title")
        );
        record["record"]["identity"]["createdAt"] = json!(999);
        fs::write(&cache, record.to_string()).unwrap();
        assert_eq!(title(&f.0, h).unwrap(), None);
        fs::write(&cache, b"unfinished cache").unwrap();
        assert_eq!(title(&f.0, h).unwrap(), None);
        assert!(read_body(h).is_err());
    }
    #[test]
    fn offline_history_is_idempotent_and_live_projection_reuses_native_keys() {
        let f = Fixture::new();
        f.log("native", &events(), true);
        let app = f.app();
        let session = f.session("native");
        app.store.save(&session).unwrap();
        assert_eq!(
            import_from_root(&app, &session, &f.0).unwrap(),
            (true, None)
        );
        let first = app.store.events(&session.id, 0, 100).unwrap();
        assert_eq!(first.len(), 6);
        assert_eq!(
            import_from_root(&app, &session, &f.0).unwrap(),
            (true, None)
        );
        assert_eq!(
            app.store.events(&session.id, 0, 100).unwrap().len(),
            first.len()
        );
        let mut projection = Projection::new("native".into());
        let (out, mut rx) = tokio::sync::mpsc::unbounded_channel();
        for row in events() {
            projection.event(&row, &out).unwrap();
        }
        drop(out);
        while let Ok(value) = rx.try_recv() {
            app.store
                .event(
                    &session.id,
                    value["method"].as_str().unwrap(),
                    value["params"].clone(),
                    None,
                )
                .unwrap();
        }
        let all = app.store.events(&session.id, 0, 100).unwrap();
        assert_eq!(all.len(), first.len());
        assert!(all.iter().all(|e| e.request_id.is_none()));
        assert_eq!(app.store.session(&session.id).unwrap().status, "external");
        assert_eq!(all.iter().filter(|e| e.method == "user/message").count(), 1);
        assert_eq!(
            all.iter()
                .filter(|e| e.params["item"]["type"] == "dynamicToolCall")
                .count(),
            2
        );
    }
    #[test]
    fn images_are_read_from_verified_objects_and_copied_only_into_anywork() {
        use sha2::{Digest, Sha256};
        let f = Fixture::new();
        let app = f.app();
        let session = f.session("native");
        let data = b"native image bytes";
        let hash = format!("{:x}", Sha256::digest(data));
        let source =
            f.0.join("attachments/v1/objects")
                .join(&hash[..2])
                .join(&hash);
        fs::create_dir_all(source.parent().unwrap()).unwrap();
        fs::write(&source, data).unwrap();
        let mut event = json!({"type":"user/message","data":{"content":[{"type":"image","attachment":{"attachmentId":format!("sha256:{hash}"),"mediaType":"image/png","bytes":data.len()}}]}});
        materialize_attachments(&app, &f.0, &session, &mut event).unwrap();
        let path = PathBuf::from(event["data"]["content"][0]["path"].as_str().unwrap());
        assert!(path.starts_with(&app.data_dir));
        assert_eq!(fs::read(&path).unwrap(), data);
        assert_eq!(fs::read(source).unwrap(), data);
    }
    #[tokio::test]
    async fn explicit_host_does_not_assume_default_profile_but_root_override_works() {
        let f = Fixture::new();
        f.log("native", &events(), false);
        let mut app = f.app();
        assert_eq!(home(&app).unwrap(), default_home().unwrap());
        let config =
            super::super::Config::new("http://127.0.0.1:3080/?token=isolated-fixture", None)
                .unwrap();
        Arc::get_mut(&mut app).unwrap().harness = Some(config.clone());
        assert_eq!(home(&app).unwrap(), None);
        sync(&app).await.unwrap();
        assert!(!import(&app, &f.session("native")).unwrap().0);
        Arc::get_mut(&mut app).unwrap().harness_history_root = Some(f.0.clone());
        assert_eq!(home(&app).unwrap(), Some(f.0.clone()));
        sync(&app).await.unwrap();
        assert!(import(&app, &f.session("native")).unwrap().0);
        // Explicit descriptor configuration also has optional=false; selecting
        // a descriptor does not prove that its profile uses the default HOME.
        Arc::get_mut(&mut app)
            .unwrap()
            .harness
            .as_mut()
            .unwrap()
            .descriptor = Some(f.0.join("host.json"));
        Arc::get_mut(&mut app).unwrap().harness_history_root = None;
        assert_eq!(home(&app).unwrap(), None);
        Arc::get_mut(&mut app).unwrap().harness_history_root = Some(PathBuf::from("relative"));
        assert!(home(&app).is_err());
    }
    #[cfg(unix)]
    #[test]
    fn symlinked_catalogs_generations_and_attachments_are_refused() {
        use std::os::unix::fs::symlink;
        let f = Fixture::new();
        let path = f.log("native", &[], false);
        let original = fs::read(&path).unwrap();
        fs::remove_file(&path).unwrap();
        fs::write(f.0.join("other"), original).unwrap();
        symlink(f.0.join("other"), &path).unwrap();
        assert!(headers(&f.0).is_err());
        let f = Fixture::new();
        fs::create_dir_all(f.0.join("sessions")).unwrap();
        symlink(std::env::temp_dir(), f.0.join("sessions/foreign")).unwrap();
        assert!(headers(&f.0).is_err());
    }
    #[test]
    #[ignore = "reads the current user's real Harness history, read-only; opt in explicitly"]
    fn native_history_read_only_aggregate() {
        assert_eq!(
            std::env::var("ANYWORK_TEST_HARNESS_NATIVE_HISTORY").as_deref(),
            Ok("1")
        );
        let root = default_home().unwrap().unwrap();
        let all = headers(&root).unwrap();
        let root_count = all
            .iter()
            .filter(|h| !h.value["parentSession"].is_string() && h.value["origin"] != "subagent")
            .count();
        let mut projected = 0;
        let mut records = 0;
        let mut partial = 0;
        for h in &all {
            let (rows, torn) = read_body(h).unwrap();
            records += rows.len();
            partial += usize::from(torn);
            let (mut projection, out, mut rx) = {
                let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
                (
                    Projection::new(h.value["id"].as_str().unwrap().into()),
                    tx,
                    rx,
                )
            };
            for row in rows {
                projection.event(&row, &out).unwrap();
            }
            drop(out);
            while rx.try_recv().is_ok() {
                projected += 1;
            }
        }
        println!(
            "Harness read-only aggregate: {} logs, {root_count} roots, {} children, {records} durable rows, {projected} projected events, {partial} incomplete tails",
            all.len(),
            all.len() - root_count
        );
    }
}
