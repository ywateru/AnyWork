use crate::{ApiError, App};
use axum::{
    Json,
    extract::{Multipart, Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Deserializer};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs::OpenOptions,
    io::{Read, Write},
    path::{Path as FsPath, PathBuf},
    sync::{Arc, Mutex, OnceLock, Weak},
};

pub fn within(root: &FsPath, path: &FsPath) -> anyhow::Result<PathBuf> {
    // Compare the same path representation on both sides. On Windows,
    // canonicalize adds a verbatim prefix (\\?\) even to an absolute path.
    let root = root.canonicalize()?;
    let canonical = path.canonicalize()?;
    anyhow::ensure!(
        canonical.starts_with(&root),
        "Path is outside the allowed workspace"
    );
    Ok(canonical)
}

#[derive(Deserialize)]
pub struct FileQuery {
    #[serde(default)]
    pub path: String,
}
pub async fn list(
    State(app): State<Arc<App>>,
    Path(id): Path<String>,
    Query(q): Query<FileQuery>,
) -> Result<Json<Value>, ApiError> {
    let s = app.session(&id)?;
    let root = PathBuf::from(s.cwd);
    let path = within(&root, &root.join(q.path))?;
    if path.is_dir() {
        let mut entries = vec![];
        for entry in std::fs::read_dir(&path)?.take(2000) {
            let e = entry?;
            let m = e.metadata()?;
            entries.push(json!({"name":e.file_name().to_string_lossy(),"path":e.path().strip_prefix(&root)?.to_string_lossy(),"directory":m.is_dir(),"size":m.len()}));
        }
        entries.sort_by_key(|e| {
            (
                !e["directory"].as_bool().unwrap_or(false),
                e["name"].as_str().unwrap_or("").to_lowercase(),
            )
        });
        Ok(Json(
            json!({"entries":entries,"path":path.strip_prefix(root)?.to_string_lossy()}),
        ))
    } else {
        if !std::fs::metadata(&path)?.is_file() {
            return Err(anyhow::anyhow!("Only regular text files can be previewed").into());
        }
        if std::fs::metadata(&path)?.len() > 2 * 1024 * 1024 {
            return Err(anyhow::anyhow!("File exceeds the 2 MiB preview limit").into());
        }
        let bytes = read_regular(&path).map_err(|error| anyhow::anyhow!(error.message))?;
        let revision = revision(&bytes);
        let content = String::from_utf8(bytes)?;
        Ok(Json(json!({"content":content,"revision":revision})))
    }
}
const MAX_TEXT: u64 = 2 * 1024 * 1024;

fn revision(bytes: &[u8]) -> String {
    format!("sha256:{:x}", Sha256::digest(bytes))
}

#[derive(Default, Debug)]
pub enum ExpectedRevision {
    #[default]
    Missing,
    Create,
    Match(String),
}
impl<'de> Deserialize<'de> for ExpectedRevision {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Ok(match Option::<String>::deserialize(deserializer)? {
            Some(value) => Self::Match(value),
            None => Self::Create,
        })
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WriteFile {
    pub path: String,
    pub content: String,
    #[serde(default)]
    pub expected_revision: ExpectedRevision,
}

#[derive(Debug)]
pub struct SaveError {
    status: StatusCode,
    code: &'static str,
    message: String,
    uncertain: bool,
}
impl SaveError {
    fn new(status: StatusCode, code: &'static str, message: impl Into<String>) -> Self {
        Self {
            status,
            code,
            message: message.into(),
            uncertain: false,
        }
    }
    fn conflict() -> Self {
        Self::new(
            StatusCode::CONFLICT,
            "file_revision_conflict",
            "文件已被修改、删除或创建，请比较最新内容后再保存；当前草稿已保留",
        )
    }
    fn io(error: std::io::Error) -> Self {
        Self::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "file_write_failed",
            format!("文件操作失败：{error}"),
        )
    }
}
impl IntoResponse for SaveError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(json!({"error":self.message,"code":self.code,
            "delivery_state":if self.uncertain {"uncertain"} else {"not_written"}})),
        )
            .into_response()
    }
}
pub enum FileWriteError {
    Access(ApiError),
    Save(SaveError),
}
impl IntoResponse for FileWriteError {
    fn into_response(self) -> Response {
        match self {
            Self::Access(error) => error.into_response(),
            Self::Save(error) => error.into_response(),
        }
    }
}
impl From<SaveError> for FileWriteError {
    fn from(error: SaveError) -> Self {
        Self::Save(error)
    }
}

/// Open without following a final symlink, reject special files, and cap the
/// actual bytes read even if the file grows after metadata inspection.
fn read_regular(path: &FsPath) -> Result<Vec<u8>, SaveError> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(0x00200000);
    }
    let file = options.open(path).map_err(SaveError::io)?;
    let metadata = file.metadata().map_err(SaveError::io)?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(SaveError::new(
            StatusCode::BAD_REQUEST,
            "file_type_unsupported",
            "只支持普通文本文件",
        ));
    }
    if metadata.len() > MAX_TEXT {
        return Err(SaveError::new(
            StatusCode::BAD_REQUEST,
            "file_too_large",
            "File exceeds the 2 MiB preview limit",
        ));
    }
    let mut bytes = Vec::new();
    file.take(MAX_TEXT + 1)
        .read_to_end(&mut bytes)
        .map_err(SaveError::io)?;
    if bytes.len() as u64 > MAX_TEXT {
        return Err(SaveError::new(
            StatusCode::BAD_REQUEST,
            "file_too_large",
            "File exceeds the 2 MiB preview limit",
        ));
    }
    Ok(bytes)
}

type FileLocks = Mutex<HashMap<PathBuf, Weak<Mutex<()>>>>;
static FILE_LOCKS: OnceLock<FileLocks> = OnceLock::new();
struct TemporaryFile(PathBuf);
impl Drop for TemporaryFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

fn save_file(root: &FsPath, body: WriteFile) -> Result<String, SaveError> {
    save_file_with(root, body, |_| Ok(()))
}
fn save_file_with(
    root: &FsPath,
    body: WriteFile,
    before_commit: impl FnOnce(&FsPath) -> Result<(), SaveError>,
) -> Result<String, SaveError> {
    match &body.expected_revision {
        ExpectedRevision::Missing => {
            return Err(SaveError::new(
                StatusCode::PRECONDITION_REQUIRED,
                "file_revision_required",
                "保存需要文件版本，请刷新 AnyWork 页面后重新读取文件；草稿请先复制保留",
            ));
        }
        ExpectedRevision::Match(value)
            if value.len() != 71
                || !value.starts_with("sha256:")
                || !value[7..]
                    .bytes()
                    .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase()) =>
        {
            return Err(SaveError::new(
                StatusCode::BAD_REQUEST,
                "file_revision_invalid",
                "无效的文件版本",
            ));
        }
        _ => {}
    }
    if body.content.len() as u64 > MAX_TEXT {
        return Err(SaveError::new(
            StatusCode::BAD_REQUEST,
            "file_too_large",
            "File exceeds 2 MiB",
        ));
    }
    let destination = root.join(&body.path);
    let parent = within(
        root,
        destination.parent().ok_or_else(|| {
            SaveError::new(StatusCode::BAD_REQUEST, "file_path_invalid", "Invalid path")
        })?,
    )
    .map_err(|error| {
        SaveError::new(
            StatusCode::FORBIDDEN,
            "file_path_forbidden",
            error.to_string(),
        )
    })?;
    let target = parent.join(destination.file_name().ok_or_else(|| {
        SaveError::new(
            StatusCode::BAD_REQUEST,
            "file_path_invalid",
            "Invalid filename",
        )
    })?);
    let lock = {
        let mut locks = FILE_LOCKS.get_or_init(Default::default).lock().unwrap();
        locks.retain(|_, value| value.strong_count() > 0);
        if let Some(lock) = locks.get(&target).and_then(Weak::upgrade) {
            lock
        } else {
            let lock = Arc::new(Mutex::new(()));
            locks.insert(target.clone(), Arc::downgrade(&lock));
            lock
        }
    };
    let _guard = lock.lock().unwrap();
    let check = || -> Result<Option<std::fs::Permissions>, SaveError> {
        match std::fs::symlink_metadata(&target) {
            Ok(metadata) => {
                if metadata.file_type().is_symlink() || !metadata.is_file() {
                    return Err(SaveError::new(
                        StatusCode::BAD_REQUEST,
                        "file_type_unsupported",
                        "保存不支持符号链接或特殊文件",
                    ));
                }
                match &body.expected_revision {
                    ExpectedRevision::Match(expected)
                        if revision(&read_regular(&target)?) == *expected =>
                    {
                        Ok(Some(metadata.permissions()))
                    }
                    _ => Err(SaveError::conflict()),
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                match body.expected_revision {
                    ExpectedRevision::Create => Ok(None),
                    _ => Err(SaveError::conflict()),
                }
            }
            Err(error) => Err(SaveError::io(error)),
        }
    };
    let permissions = check()?;
    let temporary = TemporaryFile(parent.join(format!(".anywork-save-{}", uuid::Uuid::new_v4())));
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&temporary.0).map_err(SaveError::io)?;
    file.write_all(body.content.as_bytes())
        .map_err(SaveError::io)?;
    if let Some(permissions) = permissions {
        file.set_permissions(permissions).map_err(SaveError::io)?;
    }
    file.sync_all().map_err(SaveError::io)?;
    drop(file);
    before_commit(&target)?;
    check()?; // Recheck immediately before the atomic publication boundary.
    match body.expected_revision {
        ExpectedRevision::Create => std::fs::hard_link(&temporary.0, &target).map_err(|error| {
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                SaveError::conflict()
            } else {
                SaveError::io(error)
            }
        })?,
        ExpectedRevision::Match(_) => std::fs::rename(&temporary.0, &target).map_err(|error| {
            let mut failure = SaveError::new(
                StatusCode::SERVICE_UNAVAILABLE,
                "file_save_uncertain",
                format!("无法确认文件替换结果，请比较最新文件后再操作：{error}"),
            );
            failure.uncertain = true;
            failure
        })?,
        ExpectedRevision::Missing => unreachable!(),
    }
    #[cfg(unix)]
    if let Err(error) = std::fs::File::open(&parent).and_then(|directory| directory.sync_all()) {
        let mut failure = SaveError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "file_save_uncertain",
            format!("文件已替换，但无法确认目录持久化，请重新读取并比较：{error}"),
        );
        failure.uncertain = true;
        return Err(failure);
    }
    Ok(revision(body.content.as_bytes()))
}

pub async fn write(
    State(app): State<Arc<App>>,
    Path(id): Path<String>,
    Json(body): Json<WriteFile>,
) -> Result<Json<Value>, FileWriteError> {
    let session = app
        .session(&id)
        .map_err(|error| FileWriteError::Access(error.into()))?;
    let revision = tokio::task::spawn_blocking(move || save_file(FsPath::new(&session.cwd), body))
        .await
        .map_err(|_| {
            let mut failure = SaveError::new(
                StatusCode::SERVICE_UNAVAILABLE,
                "file_save_uncertain",
                "文件保存任务异常，无法确认结果，请比较最新文件后再操作",
            );
            failure.uncertain = true;
            failure
        })??;
    Ok(Json(json!({"ok":true,"revision":revision})))
}
pub async fn upload(
    State(app): State<Arc<App>>,
    Path(id): Path<String>,
    mut multipart: Multipart,
) -> Result<Json<Value>, ApiError> {
    app.session(&id)?;
    let dir = app.data_dir.join("uploads").join(&id);
    std::fs::create_dir_all(&dir)?;
    let mut files = vec![];
    while let Some(field) = multipart.next_field().await? {
        let name = field.file_name().unwrap_or("attachment").to_string();
        let safe = FsPath::new(&name)
            .file_name()
            .ok_or_else(|| anyhow::anyhow!("Invalid filename"))?
            .to_string_lossy()
            .to_string();
        let dest = dir.join(format!("{}-{safe}", uuid::Uuid::new_v4()));
        let bytes = field.bytes().await?;
        if bytes.len() > 20 * 1024 * 1024 {
            return Err(anyhow::anyhow!("Attachment exceeds 20 MiB").into());
        }
        tokio::fs::write(&dest, &bytes).await?;
        files.push(json!({"name":safe,"path":dest,"size":bytes.len()}));
    }
    Ok(Json(json!({"files":files})))
}
pub async fn git(
    State(app): State<Arc<App>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let s = app.session(&id)?;
    async fn run(cwd: &str, args: &[&str]) -> anyhow::Result<String> {
        let out = tokio::time::timeout(
            std::time::Duration::from_secs(15),
            tokio::process::Command::new("git")
                .args(args)
                .current_dir(cwd)
                .env("GIT_TERMINAL_PROMPT", "0")
                .kill_on_drop(true)
                .output(),
        )
        .await??;
        anyhow::ensure!(
            out.status.success(),
            "{}",
            String::from_utf8_lossy(&out.stderr)
        );
        anyhow::ensure!(
            out.stdout.len() < 8 * 1024 * 1024,
            "Git output exceeds 8 MiB"
        );
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    }
    let status = run(&s.cwd, &["status", "--short", "--branch"]).await?;
    let diff = run(&s.cwd, &["diff", "--no-ext-diff", "--no-textconv", "HEAD"])
        .await
        .or_else(|_| Ok::<_, anyhow::Error>(String::new()))?;
    Ok(Json(json!({"status":status,"diff":diff})))
}

/// Authenticated raster preview. Uploads stay isolated by session; native images
/// outside the project must be explicitly referenced by that thread's history.
pub async fn image(
    State(app): State<Arc<App>>,
    Path(id): Path<String>,
    Query(q): Query<FileQuery>,
) -> Result<axum::response::Response, ApiError> {
    use axum::{http::header, response::IntoResponse};
    let session = app.session(&id)?;
    let root = PathBuf::from(&session.cwd);
    let path = root.join(&q.path).canonicalize()?;
    let all_uploads = app.data_dir.join("uploads");
    let is_upload = all_uploads
        .canonicalize()
        .is_ok_and(|p| path.starts_with(p));
    if is_upload {
        within(&all_uploads.join(&id), &path)?;
    } else if !path.starts_with(&root)
        && !crate::catalog::references_image(&app, &session, &path).await?
    {
        return Err(anyhow::anyhow!("Image is not referenced by this session").into());
    }
    if !path.is_file() || std::fs::metadata(&path)?.len() > 20 * 1024 * 1024 {
        return Err(anyhow::anyhow!("Image is not a file or exceeds 20 MiB").into());
    }
    let bytes = tokio::fs::read(&path).await?;
    let mime = if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        "image/png"
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        "image/jpeg"
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        "image/gif"
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        "image/webp"
    } else {
        return Err(anyhow::anyhow!("Unsupported raster image").into());
    };
    Ok((
        [
            (header::CONTENT_TYPE, mime),
            (header::CACHE_CONTROL, "private, no-store"),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
        ],
        bytes,
    )
        .into_response())
}

/// Fetch binary documents with the same session boundary as image previews.
/// PDFs render inline; office packages are validated but always downloaded.
pub async fn document(
    State(app): State<Arc<App>>,
    Path(id): Path<String>,
    Query(q): Query<FileQuery>,
) -> Result<axum::response::Response, ApiError> {
    use axum::{
        http::{HeaderValue, header},
        response::IntoResponse,
    };
    use tokio::io::AsyncReadExt;
    const MAX_DOCUMENT: u64 = 20 * 1024 * 1024;
    let session = app.session(&id)?;
    let root = PathBuf::from(&session.cwd);
    let path = root.join(&q.path).canonicalize()?;
    let all_uploads = app.data_dir.join("uploads");
    if all_uploads
        .canonicalize()
        .is_ok_and(|uploads| path.starts_with(uploads))
    {
        within(&all_uploads.join(&id).canonicalize()?, &path)?;
    } else if !path.starts_with(&root)
        && !crate::catalog::references_document(&app, &session, &path).await?
    {
        return Err(
            anyhow::anyhow!("Document is outside this session's workspace and history").into(),
        );
    }
    let metadata = tokio::fs::metadata(&path).await?;
    if !metadata.is_file() || metadata.len() > MAX_DOCUMENT {
        return Err(anyhow::anyhow!("Document is not a file or exceeds 20 MiB").into());
    }
    let file = tokio::fs::File::open(&path).await?;
    let metadata = file.metadata().await?;
    if !metadata.is_file() || metadata.len() > MAX_DOCUMENT {
        return Err(anyhow::anyhow!("Document is not a file or exceeds 20 MiB").into());
    }
    let mut bytes = Vec::new();
    file.take(MAX_DOCUMENT + 1).read_to_end(&mut bytes).await?;
    if bytes.len() as u64 > MAX_DOCUMENT {
        return Err(anyhow::anyhow!("Document exceeds 20 MiB").into());
    }
    let (mime, inline) = document_type(&path, &bytes)?;
    let name = path.file_name().unwrap_or_default().to_string_lossy();
    let disposition = document_disposition(&name, inline);
    let mut response = bytes.into_response();
    let headers = response.headers_mut();
    headers.insert(header::CONTENT_TYPE, HeaderValue::from_static(mime));
    headers.insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_str(&disposition)?,
    );
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, no-store"),
    );
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    Ok(response)
}

fn document_type(path: &FsPath, bytes: &[u8]) -> anyhow::Result<(&'static str, bool)> {
    let extension = path
        .extension()
        .unwrap_or_default()
        .to_string_lossy()
        .to_ascii_lowercase();
    let kind = match extension.as_str() {
        "pdf" => {
            anyhow::ensure!(bytes.starts_with(b"%PDF-"), "Invalid PDF signature");
            ("application/pdf", true)
        }
        "docx" | "xlsx" | "pptx" => {
            let members = zip_members(bytes)?;
            let main = match extension.as_str() {
                "docx" => "word/document.xml",
                "xlsx" => "xl/workbook.xml",
                _ => "ppt/presentation.xml",
            };
            anyhow::ensure!(
                members.contains("[Content_Types].xml")
                    && members.contains("_rels/.rels")
                    && members.contains(main),
                "Invalid Office document package"
            );
            (
                match extension.as_str() {
                    "docx" => {
                        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    }
                    "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    _ => {
                        "application/vnd.openxmlformats-officedocument.presentationml.presentation"
                    }
                },
                false,
            )
        }
        "odt" | "ods" | "odp" => {
            let members = zip_members(bytes)?;
            anyhow::ensure!(
                members.contains("mimetype") && members.contains("content.xml"),
                "Invalid OpenDocument package"
            );
            (
                match extension.as_str() {
                    "odt" => "application/vnd.oasis.opendocument.text",
                    "ods" => "application/vnd.oasis.opendocument.spreadsheet",
                    _ => "application/vnd.oasis.opendocument.presentation",
                },
                false,
            )
        }
        "doc" | "xls" | "ppt" => {
            anyhow::ensure!(
                bytes.starts_with(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"),
                "Invalid Office binary document signature"
            );
            ("application/octet-stream", false)
        }
        "rtf" => {
            anyhow::ensure!(bytes.starts_with(b"{\\rtf"), "Invalid RTF signature");
            ("application/rtf", false)
        }
        _ => anyhow::bail!("Unsupported binary document format"),
    };
    Ok(kind)
}

// Read only bounded ZIP central-directory metadata. Document downloads never
// decompress or execute embedded content, and encrypted/ZIP64 packages fail closed.
fn zip_members(bytes: &[u8]) -> anyhow::Result<std::collections::HashSet<&str>> {
    use anyhow::{Context, ensure};
    fn u16_at(bytes: &[u8], at: usize) -> Option<usize> {
        Some(u16::from_le_bytes(bytes.get(at..at + 2)?.try_into().ok()?) as usize)
    }
    fn u32_at(bytes: &[u8], at: usize) -> Option<usize> {
        Some(u32::from_le_bytes(bytes.get(at..at + 4)?.try_into().ok()?) as usize)
    }
    ensure!(
        bytes.starts_with(b"PK\x03\x04"),
        "Invalid ZIP document signature"
    );
    let end = bytes
        .len()
        .checked_sub(22)
        .context("Incomplete ZIP document")?;
    let eocd = (end.saturating_sub(65535)..=end)
        .rev()
        .find(|at| {
            bytes.get(*at..*at + 4) == Some(b"PK\x05\x06")
                && u16_at(bytes, *at + 20).is_some_and(|length| *at + 22 + length == bytes.len())
        })
        .context("Missing ZIP document directory")?;
    ensure!(
        u16_at(bytes, eocd + 4) == Some(0) && u16_at(bytes, eocd + 6) == Some(0),
        "Multi-volume document packages are unsupported"
    );
    let count = u16_at(bytes, eocd + 10).context("Invalid ZIP document count")?;
    ensure!(
        count > 0 && count <= 10000 && u16_at(bytes, eocd + 8) == Some(count),
        "Invalid ZIP document count"
    );
    let directory_size = u32_at(bytes, eocd + 12).context("Invalid ZIP document directory")?;
    let mut at = u32_at(bytes, eocd + 16).context("Invalid ZIP document directory")?;
    let directory_start = at;
    let directory_end = at
        .checked_add(directory_size)
        .context("Invalid ZIP directory size")?;
    ensure!(
        directory_end <= eocd,
        "Invalid ZIP document directory bounds"
    );
    let mut members = std::collections::HashSet::new();
    for _ in 0..count {
        ensure!(
            bytes.get(at..at + 4) == Some(b"PK\x01\x02"),
            "Invalid ZIP document entry"
        );
        ensure!(
            u16_at(bytes, at + 8).is_some_and(|flags| flags & 1 == 0),
            "Encrypted document packages are unsupported"
        );
        let name_length = u16_at(bytes, at + 28).context("Invalid ZIP entry name")?;
        let extra_length = u16_at(bytes, at + 30).context("Invalid ZIP entry metadata")?;
        let comment_length = u16_at(bytes, at + 32).context("Invalid ZIP entry comment")?;
        let offset = u32_at(bytes, at + 42).context("Invalid ZIP entry offset")?;
        ensure!(
            offset < directory_end && bytes.get(offset..offset + 4) == Some(b"PK\x03\x04"),
            "Invalid ZIP local entry"
        );
        let name = std::str::from_utf8(
            bytes
                .get(at + 46..at + 46 + name_length)
                .context("Incomplete ZIP entry name")?,
        )?;
        let local_name_length = u16_at(bytes, offset + 26).context("Invalid local ZIP name")?;
        let local_extra_length =
            u16_at(bytes, offset + 28).context("Invalid local ZIP metadata")?;
        ensure!(
            bytes.get(offset + 30..offset + 30 + local_name_length) == Some(name.as_bytes()),
            "ZIP document names disagree"
        );
        let compressed = u32_at(bytes, at + 20).context("Invalid ZIP data size")?;
        ensure!(
            offset
                .checked_add(30 + local_name_length + local_extra_length + compressed)
                .is_some_and(|end| end <= directory_start),
            "Invalid ZIP document data bounds"
        );
        ensure!(members.insert(name), "Duplicate ZIP document entry");
        at = at
            .checked_add(46 + name_length + extra_length + comment_length)
            .context("Invalid ZIP entry size")?;
        ensure!(at <= directory_end, "Invalid ZIP entry bounds");
    }
    ensure!(at == directory_end, "Invalid ZIP directory size");
    Ok(members)
}
fn document_disposition(name: &str, inline: bool) -> String {
    let fallback = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') {
                c
            } else {
                '_'
            }
        })
        .collect::<String>();
    let encoded = name
        .as_bytes()
        .iter()
        .map(|b| {
            if b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_' | b'~') {
                (*b as char).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect::<String>();
    format!(
        "{}; filename=\"{}\"; filename*=UTF-8''{}",
        if inline { "inline" } else { "attachment" },
        fallback,
        encoded
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let path =
                std::env::temp_dir().join(format!("anywork-save-test-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir(&path).unwrap();
            Self(path)
        }
        fn write(&self, expected: ExpectedRevision, text: &str) -> Result<String, SaveError> {
            save_file(
                &self.0,
                WriteFile {
                    path: "file.txt".into(),
                    content: text.into(),
                    expected_revision: expected,
                },
            )
        }
        fn path(&self) -> PathBuf {
            self.0.join("file.txt")
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    #[test]
    fn write_preconditions_distinguish_missing_null_and_revision() {
        let missing: WriteFile =
            serde_json::from_value(json!({"path":"file.txt","content":"new"})).unwrap();
        assert!(matches!(
            missing.expected_revision,
            ExpectedRevision::Missing
        ));
        let create: WriteFile = serde_json::from_value(
            json!({"path":"file.txt","content":"new","expected_revision":null}),
        )
        .unwrap();
        assert!(matches!(create.expected_revision, ExpectedRevision::Create));
        let fixture = Fixture::new();
        assert_eq!(
            save_file(&fixture.0, missing).unwrap_err().status,
            StatusCode::PRECONDITION_REQUIRED
        );
        assert!(!fixture.path().exists());
        assert_eq!(
            fixture
                .write(ExpectedRevision::Match("invalid".into()), "new")
                .unwrap_err()
                .code,
            "file_revision_invalid"
        );
    }
    #[test]
    fn atomic_save_checks_exact_bytes_and_preserves_original_on_conflict() {
        let fixture = Fixture::new();
        let text = "第一行\r\nsecond\n";
        let first = fixture.write(ExpectedRevision::Create, text).unwrap();
        assert_eq!(first, revision(&std::fs::read(fixture.path()).unwrap()));
        assert_eq!(
            fixture
                .write(ExpectedRevision::Create, "no")
                .unwrap_err()
                .status,
            StatusCode::CONFLICT
        );
        let second = fixture
            .write(ExpectedRevision::Match(first.clone()), "changed")
            .unwrap();
        assert_ne!(first, second);
        assert_eq!(
            fixture
                .write(ExpectedRevision::Match(first), "stale")
                .unwrap_err()
                .status,
            StatusCode::CONFLICT
        );
        assert_eq!(std::fs::read_to_string(fixture.path()).unwrap(), "changed");
        assert_eq!(std::fs::read_dir(&fixture.0).unwrap().count(), 1);
    }
    #[test]
    fn missing_old_file_is_a_conflict_and_create_cannot_clobber_racer() {
        let fixture = Fixture::new();
        let old = fixture.write(ExpectedRevision::Create, "old").unwrap();
        std::fs::remove_file(fixture.path()).unwrap();
        assert_eq!(
            fixture
                .write(ExpectedRevision::Match(old), "not-created")
                .unwrap_err()
                .status,
            StatusCode::CONFLICT
        );
        let error = save_file_with(
            &fixture.0,
            WriteFile {
                path: "file.txt".into(),
                content: "mine".into(),
                expected_revision: ExpectedRevision::Create,
            },
            |target| {
                std::fs::write(target, "other").unwrap();
                Ok(())
            },
        )
        .unwrap_err();
        assert_eq!(error.status, StatusCode::CONFLICT);
        assert_eq!(std::fs::read_to_string(fixture.path()).unwrap(), "other");
        assert_eq!(std::fs::read_dir(&fixture.0).unwrap().count(), 1);
    }
    #[test]
    fn late_external_changes_and_prepublication_failure_preserve_content() {
        let fixture = Fixture::new();
        let expected = fixture.write(ExpectedRevision::Create, "old").unwrap();
        let body = || WriteFile {
            path: "file.txt".into(),
            content: "mine".into(),
            expected_revision: ExpectedRevision::Match(expected.clone()),
        };
        let error = save_file_with(&fixture.0, body(), |_| {
            Err(SaveError::io(std::io::Error::other(
                "injected interrupted write",
            )))
        })
        .unwrap_err();
        assert!(!error.uncertain);
        assert_eq!(std::fs::read_to_string(fixture.path()).unwrap(), "old");
        let error = save_file_with(&fixture.0, body(), |target| {
            std::fs::write(target, "external").unwrap();
            Ok(())
        })
        .unwrap_err();
        assert_eq!(error.status, StatusCode::CONFLICT);
        assert_eq!(std::fs::read_to_string(fixture.path()).unwrap(), "external");
        assert_eq!(std::fs::read_dir(&fixture.0).unwrap().count(), 1);
    }
    #[test]
    fn anywork_concurrent_writes_with_one_revision_accept_only_one() {
        let fixture = Fixture::new();
        let expected = fixture.write(ExpectedRevision::Create, "old").unwrap();
        let barrier = Arc::new(std::sync::Barrier::new(2));
        let threads: Vec<_> = ["one", "two"]
            .into_iter()
            .map(|text| {
                let root = fixture.0.clone();
                let expected = expected.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    save_file(
                        &root,
                        WriteFile {
                            path: "./file.txt".into(),
                            content: text.into(),
                            expected_revision: ExpectedRevision::Match(expected),
                        },
                    )
                })
            })
            .collect();
        let results: Vec<_> = threads
            .into_iter()
            .map(|thread| thread.join().unwrap())
            .collect();
        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        assert_eq!(
            results
                .iter()
                .filter(|result| result
                    .as_ref()
                    .is_err_and(|error| error.status == StatusCode::CONFLICT))
                .count(),
            1
        );
    }
    #[test]
    fn rejects_large_text_and_special_targets_without_modifying_them() {
        let fixture = Fixture::new();
        let old = fixture.write(ExpectedRevision::Create, "old").unwrap();
        assert_eq!(
            fixture
                .write(
                    ExpectedRevision::Match(old),
                    &"a".repeat(MAX_TEXT as usize + 1)
                )
                .unwrap_err()
                .code,
            "file_too_large"
        );
        assert_eq!(std::fs::read_to_string(fixture.path()).unwrap(), "old");
        std::fs::create_dir(fixture.0.join("directory")).unwrap();
        assert_eq!(
            save_file(
                &fixture.0,
                WriteFile {
                    path: "directory".into(),
                    content: "no".into(),
                    expected_revision: ExpectedRevision::Create
                }
            )
            .unwrap_err()
            .code,
            "file_type_unsupported"
        );
    }
    #[cfg(unix)]
    #[test]
    fn saves_preserve_mode_and_reject_symlinks_and_fifos() {
        use std::os::unix::fs::{PermissionsExt, symlink};
        let fixture = Fixture::new();
        let old = fixture.write(ExpectedRevision::Create, "old").unwrap();
        std::fs::set_permissions(fixture.path(), std::fs::Permissions::from_mode(0o640)).unwrap();
        fixture
            .write(ExpectedRevision::Match(old.clone()), "new")
            .unwrap();
        assert_eq!(
            std::fs::metadata(fixture.path())
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o640
        );
        symlink(fixture.path(), fixture.0.join("link")).unwrap();
        assert_eq!(
            save_file(
                &fixture.0,
                WriteFile {
                    path: "link".into(),
                    content: "no".into(),
                    expected_revision: ExpectedRevision::Match(old)
                }
            )
            .unwrap_err()
            .code,
            "file_type_unsupported"
        );
        let fifo = fixture.0.join("fifo");
        let name = std::ffi::CString::new(fifo.to_string_lossy().as_bytes()).unwrap();
        assert_eq!(unsafe { libc::mkfifo(name.as_ptr(), 0o600) }, 0);
        assert_eq!(
            read_regular(&fifo).unwrap_err().code,
            "file_type_unsupported"
        );
        assert_eq!(std::fs::read_to_string(fixture.path()).unwrap(), "new");
    }
    #[test]
    fn rejects_traversal_and_symlinks() {
        let root = std::env::temp_dir().join(format!("ra-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let canonical = root.canonicalize().unwrap();
        assert_eq!(within(&root, &root).unwrap(), canonical);
        assert_eq!(within(&root.join("."), &canonical).unwrap(), canonical);
        assert!(within(&root, &root.join("..")).is_err());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink("/etc", root.join("escape")).unwrap();
            assert!(within(&root, &root.join("escape/passwd")).is_err());
        }
        std::fs::remove_dir_all(root).unwrap();
    }
}
