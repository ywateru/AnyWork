//! Narrow lifecycle dispatch for existing, externally owned execution hosts.
use crate::{App, store::Session};
use anyhow::Result;
use remote_agent_sdk::RpcProcess;
use serde_json::{Value, json};
use std::sync::Arc;
use tokio::sync::mpsc;

pub fn is_shared(agent: &str) -> bool {
    matches!(
        agent,
        crate::harness::AGENT
            | crate::workbuddy::AGENT
            | crate::claude::CODE
            | crate::claude::DESKTOP
    )
}
pub fn available(app: &App, agent: &str) -> bool {
    match agent {
        crate::claude::CODE => crate::claude::Config::from_env().available(),
        crate::claude::DESKTOP => crate::claude::desktop_available(),
        crate::harness::AGENT => app.harness.as_ref().is_some_and(|c| c.available()),
        crate::workbuddy::AGENT => app.workbuddy.available(),
        _ => true,
    }
}
pub async fn sync(app: &Arc<App>) -> Vec<String> {
    let mut errors = Vec::new();
    let (harness, workbuddy) = tokio::join!(crate::harness::sync(app), crate::workbuddy::sync(app));
    if let Err(e) = harness {
        errors.push(format!("Harness 会话同步失败：{e}"));
    }
    if let Err(e) = workbuddy {
        errors.push(format!("WorkBuddy 会话同步失败：{e}"));
    }
    if let Err(e) = crate::claude::sync(app).await {
        errors.push(format!("Claude 会话同步失败：{e}"));
    }
    errors
}
pub async fn create(
    app: &Arc<App>,
    agent: &str,
    cwd: &str,
    title: Option<String>,
    model: Option<String>,
) -> Result<Session> {
    let s = match agent {
        crate::claude::CODE | crate::claude::DESKTOP => {
            crate::claude::create(app, agent, cwd, title, model.clone()).await?
        }
        crate::harness::AGENT => crate::harness::create(app, cwd, title).await?,
        crate::workbuddy::AGENT => crate::workbuddy::create(app, cwd, title, model.clone()).await?,
        _ => anyhow::bail!("Unsupported shared host"),
    };
    // WorkBuddy's create receives its model atomically. Harness settings remain
    // explicitly selected through composer; do not silently overwrite policy.
    if agent == crate::harness::AGENT && model.is_some() {
        let rt = app.ensure_runtime(&s).await?;
        rt.rpc
            .call("thread/settings/update", json!({"model":model}))
            .await?;
    }
    Ok(s)
}
pub async fn attach(
    app: &Arc<App>,
    s: &Session,
) -> Result<(Arc<RpcProcess>, mpsc::UnboundedReceiver<Value>, bool)> {
    match s.agent.as_str() {
        crate::claude::CODE | crate::claude::DESKTOP => crate::claude::attach(app, s).await,
        crate::harness::AGENT => crate::harness::attach(app, s).await,
        crate::workbuddy::AGENT => crate::workbuddy::attach(app, s).await,
        _ => anyhow::bail!("Unsupported shared host"),
    }
}
pub fn settings_method(agent: &str) -> &'static str {
    if agent == crate::harness::AGENT {
        "anywork/harness/settings"
    } else {
        "anywork/session/settings"
    }
}

/// Persisted reads never acquire a thread writer or wait for a live host.
pub async fn read_persisted_history(app: &Arc<App>, s: &Session) -> Result<(bool, Option<String>)> {
    match s.agent.as_str() {
        crate::claude::CODE | crate::claude::DESKTOP => {
            crate::claude::read_persisted_history(app, s).await
        }
        crate::harness::AGENT => {
            let app = app.clone();
            let s = s.clone();
            tokio::task::spawn_blocking(move || crate::harness::read_persisted_history(&app, &s))
                .await?
        }
        crate::workbuddy::AGENT => crate::workbuddy::read_persisted_history(app, s).await,
        _ => Ok((false, None)),
    }
}
