//! Read-only native Desktop Code metadata. Only account/org/local_UUID.json
//! under claude-code-sessions is considered; never general chats or Cowork.
//! cliSessionId is a separate identity and never used as a live-control target.
use super::{Config, DESKTOP, history};
use crate::{App, store::Session};
use anyhow::{Context, Result, ensure};
use serde_json::Value;
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Arc,
};

fn roots() -> Vec<PathBuf> {
    if let Some(path) = std::env::var_os("ANYWORK_CLAUDE_DESKTOP_HISTORY_ROOT") {
        return vec![path.into()];
    }
    default_roots(&super::user_home())
}
fn default_roots(home: &Path) -> Vec<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        ["Claude", "Claude-3p"]
            .map(|profile| {
                home.join("Library/Application Support")
                    .join(profile)
                    .join("claude-code-sessions")
            })
            .to_vec()
    }
    #[cfg(target_os = "windows")]
    {
        let base = std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.to_path_buf());
        ["Claude", "Claude-3p"]
            .map(|profile| base.join(profile).join("claude-code-sessions"))
            .to_vec()
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let base = std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join(".config"));
        ["Claude", "Claude-3p"]
            .map(|profile| base.join(profile).join("claude-code-sessions"))
            .to_vec()
    }
}
fn local_id(id: &str) -> bool {
    id.strip_prefix("local_")
        .is_some_and(|id| uuid::Uuid::parse_str(id).is_ok())
}
fn files(root: &Path) -> Result<Vec<PathBuf>> {
    ensure!(
        root.is_absolute(),
        "Claude Desktop history root must be absolute"
    );
    if !root.exists() {
        return Ok(vec![]);
    }
    ensure!(
        fs::symlink_metadata(root)?.file_type().is_dir(),
        "Claude Desktop history root must be a real directory"
    );
    let mut result = vec![];
    for (n, account) in fs::read_dir(root)?.enumerate() {
        ensure!(n < 1000, "Claude Desktop account discovery exceeds limit");
        let account = account?;
        if !account.file_type()?.is_dir() {
            continue;
        }
        for (n, org) in fs::read_dir(account.path())?.enumerate() {
            ensure!(
                n < 1000,
                "Claude Desktop organization discovery exceeds limit"
            );
            let org = org?;
            if !org.file_type()?.is_dir() {
                continue;
            }
            for file in fs::read_dir(org.path())? {
                let file = file?;
                let path = file.path();
                if path.extension().is_some_and(|s| s == "json")
                    && path
                        .file_stem()
                        .and_then(|s| s.to_str())
                        .is_some_and(local_id)
                {
                    ensure!(
                        file.file_type()?.is_file(),
                        "Claude Desktop metadata must be a regular file"
                    );
                    ensure!(
                        result.len() < 100_000,
                        "Claude Desktop history discovery exceeds limit"
                    );
                    result.push(path);
                }
            }
        }
    }
    result.sort();
    Ok(result)
}
fn metadata(path: &Path) -> Result<Value> {
    let bytes = history::read_file(path, 4 * 1024 * 1024)?;
    let row: Value = serde_json::from_slice(&bytes)
        .map_err(|_| anyhow::anyhow!("Malformed Claude Desktop Code metadata"))?;
    ensure!(row.is_object(), "Invalid Claude Desktop Code metadata");
    let id = path
        .file_stem()
        .and_then(|s| s.to_str())
        .context("Invalid Claude Desktop metadata filename")?;
    ensure!(
        row["sessionId"].as_str().is_none_or(|value| value == id),
        "Claude Desktop metadata session identity mismatch"
    );
    Ok(row)
}
fn is_remote(row: &Value) -> bool {
    ["remoteTarget", "sshConfig", "wslConfig"]
        .iter()
        .any(|key| row.get(*key).is_some_and(|v| !v.is_null()))
        || row
            .get("movedToCloud")
            .is_some_and(|v| !v.is_null() && v != &Value::Bool(false))
}
fn millis(row: &Value, key: &str) -> i64 {
    row[key]
        .as_i64()
        .or_else(|| {
            row[key]
                .as_str()
                .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
                .map(|v| v.timestamp_millis())
        })
        .unwrap_or(0)
}
pub async fn sync(app: &Arc<App>) -> Result<()> {
    let app = app.clone();
    tokio::task::spawn_blocking(move || sync_roots(&app, &roots())).await?
}
fn all_files(roots: &[PathBuf]) -> Result<Vec<PathBuf>> {
    roots.iter().try_fold(vec![], |mut all, root| {
        all.extend(files(root)?);
        Ok(all)
    })
}
fn sync_roots(app: &App, roots: &[PathBuf]) -> Result<()> {
    let paths = all_files(roots)?;
    let mut counts = std::collections::HashMap::new();
    for path in &paths {
        *counts
            .entry(path.file_stem().unwrap().to_string_lossy().into_owned())
            .or_insert(0usize) += 1;
    }
    let mut failed = 0;
    for path in paths {
        let result = (|| -> Result<()> {
            let row = metadata(&path)?;
            if is_remote(&row) {
                return Ok(());
            }
            let native = path.file_stem().and_then(|s| s.to_str()).unwrap();
            ensure!(
                counts[native] == 1,
                "Ambiguous Claude Desktop session identity across profiles"
            );
            let cwd = row["worktreePath"]
                .as_str()
                .or_else(|| row["cwd"].as_str())
                .or_else(|| row["originCwd"].as_str())
                .context("Claude Desktop Code metadata has no local working directory")?;
            if app.session_in_scope(cwd, DESKTOP).is_err() {
                return Ok(());
            }
            let id = format!("{DESKTOP}-{native}");
            if app.runtimes.blocking_lock().contains_key(&id) {
                return Ok(());
            }
            let old = app.store.session(&id).ok();
            let s = Session {
                id,
                thread_id: Some(native.into()),
                title: row["title"]
                    .as_str()
                    .filter(|v| !v.trim().is_empty())
                    .unwrap_or("Claude Desktop Code")
                    .into(),
                cwd: cwd.into(),
                agent: DESKTOP.into(),
                model: row["model"].as_str().map(str::to_string),
                policy: "manual".into(),
                status: "external".into(),
                archived: old
                    .as_ref()
                    .map_or(row["isArchived"] == true, |s| s.archived),
                created_at: millis(&row, "createdAt"),
                updated_at: millis(&row, "lastActivityAt"),
                external: true,
                auxiliary: false,
            };
            // Disk is never evidence that the Desktop process is still running.
            app.store.save_shared_observation(&s)?;
            Ok(())
        })();
        if result.is_err() {
            failed += 1;
        }
    }
    ensure!(
        failed == 0,
        "{failed} Claude Desktop Code metadata files could not be read; previously discovered history retained"
    );
    Ok(())
}
pub async fn import(app: &Arc<App>, s: &Session) -> Result<(bool, Option<String>)> {
    let app = app.clone();
    let s = s.clone();
    tokio::task::spawn_blocking(move || import_roots(&app, &s, &roots(), &Config::from_env()))
        .await?
}
pub(super) fn source(native: &str) -> Result<Option<PathBuf>> {
    let paths: Vec<_> = all_files(&roots())?
        .into_iter()
        .filter(|p| p.file_stem().and_then(|v| v.to_str()) == Some(native))
        .collect();
    ensure!(
        paths.len() <= 1,
        "Ambiguous Claude Desktop session identity across profiles"
    );
    Ok(paths.into_iter().next())
}
fn import_roots(
    app: &App,
    s: &Session,
    roots: &[PathBuf],
    config: &Config,
) -> Result<(bool, Option<String>)> {
    let native = s
        .thread_id
        .as_deref()
        .context("Missing Claude Desktop session identity")?;
    ensure!(
        local_id(native),
        "Invalid local Claude Desktop Code identity"
    );
    let paths: Vec<_> = all_files(roots)?
        .into_iter()
        .filter(|p| p.file_stem().and_then(|s| s.to_str()) == Some(native))
        .collect();
    ensure!(
        paths.len() <= 1,
        "Ambiguous Claude Desktop session identity across profiles"
    );
    let Some(path) = paths.first() else {
        return Ok((
            false,
            Some("Claude Desktop Code 元数据暂不可读取；未尝试启动 CLI".into()),
        ));
    };
    let row = metadata(path)?;
    let profile_root = path.ancestors().nth(3).map(Path::to_path_buf);
    ensure!(
        !is_remote(&row),
        "Remote/cloud Claude Desktop sessions are not local Code sessions"
    );
    let cli = row["cliSessionId"]
        .as_str()
        .or_else(|| row["historyOnlyCliSessionId"].as_str());
    let Some(cli) = cli else {
        return Ok((
            true,
            Some(
                "Claude Desktop Code 记录尚无 cliSessionId；保留会话元数据，未猜测或启动替代会话"
                    .into(),
            ),
        ));
    };
    uuid::Uuid::parse_str(cli).context("Invalid Claude Desktop CLI lineage identity")?;
    let Some(path) = history::find(&config.root, cli)? else {
        return Ok((
            true,
            Some(
                "Claude Desktop Code 本机 CLI 历史暂不可用；SSH 镜像和云记录不作为本地历史读取"
                    .into(),
            ),
        ));
    };
    let (rows, partial) = history::read(&path)?;
    let mut messages = history::chain(&rows);
    ensure!(
        messages
            .iter()
            .all(|r| r["sessionId"].as_str().is_none_or(|id| id == cli)),
        "Claude Desktop transcript CLI identity mismatch"
    );
    for message in &mut messages {
        message["_anyworkDesktopProfileRoot"] = serde_json::json!(profile_root);
    }
    let (_, notice) = history::import_messages(app, s, messages, partial)?;
    let lineage = row["priorCliSessionIds"]
        .as_array()
        .is_some_and(|ids| !ids.is_empty())
        || row["rewindEdges"]
            .as_array()
            .is_some_and(|ids| !ids.is_empty());
    Ok((true,notice.or_else(||lineage.then(||"已读取当前 cliSessionId 的原生消息链；此前 CLI lineage 或 rewind 记录未合并，避免重复或展示已放弃的分支".into()))))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn default_profiles_include_native_and_third_party_without_scanning_arbitrary_directories() {
        let roots = default_roots(Path::new("/isolated-home"));
        assert_eq!(roots.len(), 2);
        assert!(
            roots
                .iter()
                .any(|p| p.ends_with("Claude/claude-code-sessions"))
        );
        assert!(
            roots
                .iter()
                .any(|p| p.ends_with("Claude-3p/claude-code-sessions"))
        );
    }
    #[test]
    fn distinguishes_desktop_identity_and_filters_cloud_metadata() {
        assert!(local_id("local_123e4567-e89b-12d3-a456-426614174000"));
        assert!(!local_id("123e4567-e89b-12d3-a456-426614174000"));
        assert!(is_remote(&serde_json::json!({"movedToCloud":true})));
        assert!(is_remote(
            &serde_json::json!({"movedToCloud":{"cloudSessionId":"cloud-migrated"}})
        ));
        assert!(!is_remote(
            &serde_json::json!({"cloudSessionId":"remote-control-link","cliSessionId":"123e4567-e89b-12d3-a456-426614174000","movedToCloud":null})
        ));
        assert!(!is_remote(&serde_json::json!({"remoteTarget":null})));
    }
    #[test]
    fn scans_only_two_level_local_code_files() {
        let root = tempfile::tempdir().unwrap();
        let org = root.path().join("account/org");
        fs::create_dir_all(&org).unwrap();
        let id = "local_123e4567-e89b-12d3-a456-426614174000";
        fs::write(org.join(format!("{id}.json")), "{}").unwrap();
        fs::write(root.path().join("scheduled-tasks.json"), "{}").unwrap();
        fs::write(org.join("chat.json"), "{}").unwrap();
        assert_eq!(files(root.path()).unwrap().len(), 1);
        fs::write(
            org.join(format!("{id}.json")),
            serde_json::json!({"sessionId":"wrong"}).to_string(),
        )
        .unwrap();
        assert!(metadata(&org.join(format!("{id}.json"))).is_err());
    }
}
