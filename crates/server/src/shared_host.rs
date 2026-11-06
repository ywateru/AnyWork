//! Narrow lifecycle dispatch for existing, externally owned execution hosts.
use crate::{App, store::Session};
use anyhow::Result;
use remote_agent_sdk::RpcProcess;
use serde_json::{Value, json};
use std::sync::Arc;
use tokio::sync::mpsc;

pub fn is_shared(agent: &str) -> bool {
    matches!(agent, crate::harness::AGENT | crate::workbuddy::AGENT)
}
pub fn available(app: &App, agent: &str) -> bool {
    match agent {
        crate::harness::AGENT => app.harness.as_ref().is_some_and(|c| c.available()),
        crate::workbuddy::AGENT => app.workbuddy.available(),
        _ => true,
    }
}
pub async fn sync(app: &Arc<App>) -> Vec<String> {
    let mut errors = Vec::new();
    if let Err(e) = crate::harness::sync(app).await {
        errors.push(format!("Harness 会话同步失败：{e}"));
    }
    if let Err(e) = crate::workbuddy::sync(app).await {
        errors.push(format!("WorkBuddy 会话同步失败：{e}"));
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
