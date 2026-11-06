use crate::{ApiError, App};
use axum::{
    Json,
    extract::{Multipart, Path, Query, State},
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    path::{Path as FsPath, PathBuf},
    sync::Arc,
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
        if std::fs::metadata(&path)?.len() > 2 * 1024 * 1024 {
            return Err(anyhow::anyhow!("File exceeds the 2 MiB preview limit").into());
        }
        let content = std::fs::read_to_string(path)?;
        Ok(Json(json!({"content":content})))
    }
}
#[derive(Deserialize)]
pub struct WriteFile {
    pub path: String,
    pub content: String,
}
pub async fn write(
    State(app): State<Arc<App>>,
    Path(id): Path<String>,
    Json(body): Json<WriteFile>,
) -> Result<Json<Value>, ApiError> {
    let s = app.session(&id)?;
    let root = PathBuf::from(s.cwd);
    let dest = root.join(&body.path);
    let parent = within(
        &root,
        dest.parent()
            .ok_or_else(|| anyhow::anyhow!("Invalid path"))?,
    )?;
    let target = parent.join(
        dest.file_name()
            .ok_or_else(|| anyhow::anyhow!("Invalid filename"))?,
    );
    if target.exists() {
        within(&root, &target)?;
    }
    if body.content.len() > 2 * 1024 * 1024 {
        return Err(anyhow::anyhow!("File exceeds 2 MiB").into());
    }
    std::fs::write(target, body.content)?;
    Ok(Json(json!({"ok":true})))
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
