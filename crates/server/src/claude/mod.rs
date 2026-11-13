//! Claude Code stream-json adapter. Desktop Code has a separate ownership and
//! storage boundary; a bundled executable is never evidence of desktop control.
mod desktop;
mod desktop_adapter;
mod desktop_history;
mod discovery;
mod history;
mod ownership;
mod process;
mod protocol;

use crate::{
    App,
    store::{Session, now},
};
use anyhow::{Context, Result, ensure};
use remote_agent_sdk::{PluginManifest, RpcProcess};
use serde_json::Value;
use std::{path::PathBuf, sync::Arc};
use tokio::sync::mpsc;

pub const CODE: &str = "claude-code";
pub const DESKTOP: &str = "claude-desktop";
pub const DESKTOP_REASON: &str = "Claude Desktop Code 桥尚未连接；请运行 scripts/claude-desktop-launch.py，并在正常 DevTools 中审阅和执行连接片段。可读取本机 Code 历史；原生 Desktop 控制尚待独立验收。普通聊天、Cowork 和云会话不在此范围。";
pub fn desktop_available() -> bool {
    desktop_adapter::available()
}
pub fn is_claude(agent: &str) -> bool {
    matches!(agent, CODE | DESKTOP)
}

#[derive(Clone)]
pub struct Config {
    pub bin: PathBuf,
    /// Claude config home, containing projects/ and sessions/. Read-only here.
    pub root: PathBuf,
}
impl Config {
    pub fn from_env() -> Self {
        let exe = if cfg!(windows) {
            "claude.exe"
        } else {
            "claude"
        };
        let root = std::env::var_os("ANYWORK_CLAUDE_HISTORY_ROOT")
            .or_else(|| std::env::var_os("CLAUDE_CONFIG_DIR"))
            .map(PathBuf::from)
            .unwrap_or_else(|| user_home().join(".claude"));
        let bin = std::env::var_os("ANYWORK_CLAUDE_BIN")
            .map(PathBuf::from)
            .or_else(|| {
                std::env::var_os("PATH").and_then(|paths| {
                    std::env::split_paths(&paths)
                        .map(|p| p.join(exe))
                        .find(|p| p.is_file())
                })
            })
            .or_else(|| {
                let home = user_home();
                let mut candidates = vec![
                    home.join(format!(".local/bin/{exe}")),
                    home.join(format!(".npm-global/bin/{exe}")),
                    home.join(format!(".npm/bin/{exe}")),
                    home.join(format!(".volta/bin/{exe}")),
                    home.join(format!(".bun/bin/{exe}")),
                ];
                for root in [home.join(".nvm/versions/node"), home.join(".local")] {
                    if let Ok(entries) = std::fs::read_dir(root) {
                        let mut versions: Vec<_> = entries
                            .flatten()
                            .map(|e| e.path().join("bin").join(exe))
                            .collect();
                        versions.sort();
                        versions.reverse();
                        candidates.extend(versions);
                    }
                }
                candidates.into_iter().find(|p| p.is_file())
            })
            .or_else(|| discovery::downloaded(&user_home()))
            .unwrap_or_else(|| PathBuf::from(exe));
        Self { bin, root }
    }
    pub fn available(&self) -> bool {
        let Ok(meta) = std::fs::metadata(&self.bin) else {
            return false;
        };
        if !meta.is_file() {
            return false;
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            meta.permissions().mode() & 0o111 != 0
        }
        #[cfg(not(unix))]
        {
            true
        }
    }
}
fn user_home() -> PathBuf {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
}
pub fn manifests() -> Vec<PluginManifest> {
    [CODE, DESKTOP]
        .into_iter()
        .map(|id| PluginManifest {
            id: id.into(),
            name: if id == CODE {
                "Claude Code"
            } else {
                "Claude Desktop Code"
            }
            .into(),
            protocol_version: 1,
            command: if id == CODE {
                Config::from_env().bin.to_string_lossy().into()
            } else {
                String::new()
            },
            args: vec![],
            env: Default::default(),
            capabilities: {
                [
                    "chat",
                    "resume",
                    "interrupt",
                    "approvals",
                    "questions",
                    "images",
                    "models",
                    "tools",
                    "manual-approvals-only",
                ]
                .map(str::to_string)
                .to_vec()
            },
        })
        .collect()
}
pub async fn create(
    app: &Arc<App>,
    agent: &str,
    cwd: &str,
    title: Option<String>,
    model: Option<String>,
) -> Result<Session> {
    if agent == DESKTOP {
        return desktop_adapter::create(app, cwd, title, model).await;
    }
    ensure!(agent == CODE, "Unknown Claude agent");
    let session = Session {
        id: uuid::Uuid::new_v4().to_string(),
        thread_id: Some(uuid::Uuid::new_v4().to_string()),
        title: title
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| "新会话".into()),
        cwd: cwd.into(),
        agent: agent.into(),
        model,
        policy: "manual".into(),
        status: "starting".into(),
        archived: false,
        created_at: now(),
        updated_at: now(),
        external: false,
        auxiliary: false,
    };
    app.store.save(&session)?;
    if let Err(error) = app.ensure_runtime(&session).await {
        app.store.set_status(&session.id, "error")?;
        return Err(error);
    }
    app.store.session(&session.id)
}
pub async fn attach(
    app: &Arc<App>,
    s: &Session,
) -> Result<(Arc<RpcProcess>, mpsc::UnboundedReceiver<Value>, bool)> {
    if s.agent == DESKTOP {
        return desktop_adapter::attach(app, s).await;
    }
    ensure!(s.agent == CODE, "Unknown Claude agent");
    ensure!(
        s.policy == "manual",
        "Claude supports manual approvals only; switch this session policy to manual before connecting"
    );
    let config = Config::from_env();
    let thread = s
        .thread_id
        .as_deref()
        .context("Missing Claude session ID")?;
    uuid::Uuid::parse_str(thread).context("Invalid Claude session ID")?;
    let saved = history::find(&config.root, thread)?;
    ensure!(
        !s.external || saved.is_some(),
        "Claude history is unavailable; refusing to create a replacement session"
    );
    if saved.is_some() {
        history::import(app, s, &config)?;
    }
    let lease = ownership::acquire(&config, thread)?;
    let engine = process::Engine::spawn(&config, s, saved.is_some(), lease).await?;
    let (rpc, events, bridge) = RpcProcess::bridge();
    tokio::spawn(engine.run(bridge, app.clone(), s.clone()));
    Ok((rpc, events, false))
}
pub async fn sync(app: &Arc<App>) -> Result<()> {
    let cli_app = app.clone();
    let (cli, desktop) = tokio::join!(
        tokio::task::spawn_blocking(move || history::sync(&cli_app, &Config::from_env())),
        desktop_history::sync(app)
    );
    let errors: Vec<_> = [cli.map_err(anyhow::Error::from).and_then(|v| v), desktop]
        .into_iter()
        .filter_map(Result::err)
        .map(|e| e.to_string())
        .collect();
    ensure!(errors.is_empty(), "{}", errors.join("; "));
    desktop_adapter::sync(app).await?;
    Ok(())
}
pub async fn read_persisted_history(app: &Arc<App>, s: &Session) -> Result<(bool, Option<String>)> {
    if s.agent == DESKTOP {
        if desktop_available() {
            return desktop_adapter::read_history(app, s).await;
        }
        return desktop_history::import(app, s).await;
    }
    let app = app.clone();
    let s = s.clone();
    tokio::task::spawn_blocking(move || history::import(&app, &s, &Config::from_env())).await?
}
