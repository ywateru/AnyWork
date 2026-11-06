//! Route explicit actions to an existing thread owner before considering a cold
//! resume. A socket connection never owns or stops the external process.
use crate::{App, store::Session};
use anyhow::{Context, Result, bail, ensure};
use remote_agent_sdk::RpcProcess;
use serde_json::{Value, json};
use std::{collections::HashSet, path::PathBuf, sync::Arc, time::Duration};
use tokio::sync::mpsc::UnboundedReceiver;

#[derive(Debug)]
pub struct OwnerUnavailable;

impl std::fmt::Display for OwnerUnavailable {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("此会话仍由独立 Codex 进程持有，暂时无法连接原执行入口。本次消息未发送，输入内容已保留。")
    }
}

impl std::error::Error for OwnerUnavailable {}

/// Only explicit local registrations are admitted; never sweep unrelated sockets.
pub fn endpoints(app: &App) -> Result<Vec<PathBuf>> {
    let mut paths = Vec::new();
    if let Some(path) = std::env::var_os("ANYWORK_CODEX_SOCKET") {
        paths.push(PathBuf::from(path));
    }
    if let Some(value) = std::env::var_os("ANYWORK_CODEX_SOCKETS") {
        paths.extend(std::env::split_paths(&value));
    }
    let registry = app.data_dir.join("codex-runtimes.json");
    if registry.exists() {
        ensure!(
            std::fs::metadata(&registry)?.len() <= 65536,
            "Codex runtime registry is too large"
        );
        let config: Value = serde_json::from_slice(&std::fs::read(registry)?)?;
        ensure!(
            config["version"] == 1,
            "Unsupported Codex runtime registry version"
        );
        let home = crate::observer::codex_home()?.canonicalize()?;
        for entry in config["runtimes"]
            .as_array()
            .context("Invalid Codex runtime registry")?
        {
            // History, writer locks and attachments must refer to the same home.
            let entry_home = entry["codex_home"]
                .as_str()
                .context("Missing runtime Codex home")?;
            if PathBuf::from(entry_home).canonicalize().ok().as_ref() == Some(&home) {
                paths.push(PathBuf::from(
                    entry["socket"].as_str().context("Missing runtime socket")?,
                ));
            }
        }
    }
    paths.push(crate::observer::socket_path()?);
    let mut seen = HashSet::new();
    paths.retain(|path| seen.insert(path.clone()));
    ensure!(
        paths.len() <= 16,
        "Too many registered Codex control entries"
    );
    ensure!(
        paths.iter().all(|path| path.is_absolute()),
        "Codex control socket must use an absolute path"
    );
    Ok(paths)
}

#[cfg(unix)]
pub async fn connect_owner(
    app: &Arc<App>,
    session: &Session,
) -> Result<(Arc<RpcProcess>, UnboundedReceiver<Value>, bool)> {
    use std::os::unix::fs::{FileTypeExt, MetadataExt};
    if let Some(path) = &app.desktop_ipc_socket {
        match crate::desktop::connect(app, session, path).await {
            Ok((rpc, events)) => return Ok((rpc, events, true)),
            // Only a definitive discovery rejection permits trying another
            // registered owner. Transport/snapshot/identity failures stop here.
            Err(error) if error.is::<crate::desktop::NoOwner>() => {}
            Err(error) => {
                return Err(error.context("无法连接配置的桌面协作入口；未启动其他执行进程"));
            }
        }
    }
    let thread = session
        .thread_id
        .as_deref()
        .context("Missing Codex thread")?;
    let home_uid = std::fs::metadata(crate::observer::codex_home()?)?.uid();
    let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
    let mut cold: Option<(Arc<RpcProcess>, UnboundedReceiver<Value>)> = None;
    for path in endpoints(app)? {
        let Ok(metadata) = std::fs::metadata(&path) else {
            continue;
        };
        if !metadata.file_type().is_socket() || metadata.uid() != home_uid {
            continue;
        }
        let Ok(Ok((rpc, events))) =
            tokio::time::timeout_at(deadline, RpcProcess::connect_unix(&path)).await
        else {
            continue;
        };
        let inspect = tokio::time::timeout_at(deadline, async {
            let initialized = rpc.call("initialize", json!({"clientInfo":{"name":"anywork","version":"0.1.0"},"capabilities":{"experimentalApi":true}})).await?;
            if let Some(home) = initialized["codexHome"].as_str() {
                ensure!(PathBuf::from(home).canonicalize()? == crate::observer::codex_home()?.canonicalize()?, "Codex home does not match the discovered history");
            }
            rpc.send(json!({"method":"initialized","params":{}})).await?;
            let current = rpc.call("thread/read", json!({"threadId":thread,"includeTurns":false})).await?;
            ensure!(current["thread"]["id"] == thread, "Unexpected thread identity");
            ensure!(current["thread"]["source"]["subAgent"]["other"] != "guardian", "Not a user conversation");
            let cwd = current["thread"]["cwd"].as_str().context("Missing thread cwd")?;
            let cwd = app.session_directory(cwd, true)?;
            ensure!(cwd.is_dir(), "会话工作目录已不存在，仍可查看历史");
            ensure!(cwd == PathBuf::from(&session.cwd).canonicalize()?, "Thread workspace changed; refresh before connecting");
            Ok::<_, anyhow::Error>(current["thread"]["status"]["type"].as_str().map(str::to_string))
        }).await;
        match inspect {
            Ok(Ok(Some(status)))
                if matches!(status.as_str(), "active" | "idle" | "systemError") =>
            {
                if let Some((previous, _)) = cold.take() {
                    previous.close().await;
                }
                return Ok((rpc, events, false));
            }
            Ok(Ok(Some(status))) if status == "notLoaded" && cold.is_none() => {
                cold = Some((rpc, events))
            }
            _ => rpc.close().await,
        }
    }
    // A held writer is meaningful only after all registered owners were tried.
    if let Err(error) = crate::observer::check_cold_writer(thread) {
        if let Some((rpc, _)) = cold.take() {
            rpc.close().await;
        }
        return Err(error.context(OwnerUnavailable));
    }
    if let Some(candidate) = cold {
        return Ok((candidate.0, candidate.1, false));
    }
    bail!(
        "无法连接此会话的原执行入口。请确认共享引擎仍在运行后重试；本次消息未发送，输入内容已保留。"
    )
}
