//! Sidebar-only subscriptions to the configured desktop host. No execution
//! runtime is created, no approvals are answered, and no thread is resumed.
use crate::{App, desktop, desktop_ipc::Client, desktop_state::Snapshot, store::Session};
use anyhow::{Context, Result, ensure};
use serde_json::json;
use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Weak},
    time::{Duration, Instant},
};
use tokio::task::JoinSet;

const FRESH_FOR: Duration = Duration::from_secs(12);
const RETRY_AFTER: Duration = Duration::from_secs(10);
const SNAPSHOT_AFTER: Duration = Duration::from_secs(3);
const MAX_DISCOVERIES: usize = 8;

#[derive(Default)]
pub struct Statuses(HashMap<String, (&'static str, Instant)>);
impl Statuses {
    pub fn get(&self, id: &str) -> Option<&'static str> {
        self.0
            .get(id)
            .filter(|(_, at)| at.elapsed() < FRESH_FOR)
            .map(|(status, _)| *status)
    }
}

struct Followed {
    session: Session,
    owner: String,
    state: Option<Snapshot>,
    received: Instant,
    requested: Instant,
    snapshot_pending: bool,
}

pub fn start(app: &Arc<App>) {
    let Some(path) = app
        .desktop_ipc_socket
        .clone()
        .filter(|_| app.codex_discovery)
    else {
        return;
    };
    let weak = Arc::downgrade(app);
    tokio::spawn(async move {
        loop {
            let Some(app) = weak.upgrade() else {
                break;
            };
            if app.stopping.load(std::sync::atomic::Ordering::Relaxed) {
                break;
            }
            if let Err(error) = observe(&weak, &path).await {
                tracing::debug!(%error, "Desktop sidebar observer disconnected");
            }
            app.desktop_statuses.lock().await.0.clear();
            tokio::select! {
                _ = app.shutdown.notified() => break,
                _ = tokio::time::sleep(Duration::from_secs(2)) => {},
            }
        }
    });
}

async fn observe(weak: &Weak<App>, path: &std::path::Path) -> Result<()> {
    let (client, mut incoming) = Client::connect(path).await?;
    let mut followed: HashMap<String, Followed> = HashMap::new();
    let result = async {
        let mut attempted: HashMap<String, Instant> = HashMap::new();
        let mut probes: JoinSet<(Session, Option<String>)> = JoinSet::new();
        let mut probing = HashSet::new();
        let mut tick = tokio::time::interval(Duration::from_secs(2));
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            let app = weak.upgrade().context("AnyWork stopped")?;
            tokio::select! {
                _ = app.shutdown.notified() => break,
                _ = client.closed() => break,
                Some(probe) = probes.join_next(), if !probes.is_empty() => {
                    let (session, owner) = probe?;
                    probing.remove(session.thread_id.as_ref().unwrap());
                    if let Some(owner) = owner {
                        let thread = session.thread_id.as_deref().context("Missing observed thread")?.to_owned();
                        // Pin identity before following: only this owner's snapshot
                        // can establish status for this catalog conversation.
                        followed.insert(thread.clone(), Followed { session, owner: owner.clone(), state: None, received: Instant::now(), requested: Instant::now(), snapshot_pending: true });
                        client.follow(&thread, &owner, true).await?;
                    }
                }
                message = incoming.recv() => {
                    let Some(message) = message else { break; };
                    if message["method"] == "client-status-changed" && message["params"]["status"] == "disconnected" {
                        let owner = message["params"]["clientId"].as_str().unwrap_or_default();
                        let removed: Vec<_> = followed.iter().filter(|(_, item)| item.owner == owner).map(|(id, _)| id.clone()).collect();
                        for thread in removed {
                            if let Some(item) = followed.remove(&thread) {
                                app.desktop_statuses.lock().await.0.remove(&item.session.id);
                            }
                            attempted.remove(&thread);
                        }
                        continue;
                    }
                    let Some(thread) = message["params"]["conversationId"].as_str() else { continue; };
                    let Some(item) = followed.get_mut(thread) else { continue; };
                    if !desktop::stream_identity(&message, &client.id, &item.owner, thread) { continue; }
                    let change = &message["params"]["change"];
                    if change["type"] == "snapshot" { item.snapshot_pending = false; }
                    let next = (|| -> Result<Snapshot> {
                        ensure!(message["version"] == 11, "Unsupported desktop state version");
                        if change["type"] == "snapshot" {
                            let revision = change["revision"].as_u64().context("Missing desktop revision")?;
                            ensure!(item.state.as_ref().is_none_or(|old| revision >= old.revision), "Stale desktop snapshot");
                            Snapshot::new(change["conversationState"].clone(), revision, thread, &item.session.cwd)
                        } else {
                            ensure!(change["type"] == "patches", "Unknown desktop change");
                            let state = item.state.as_ref().context("No initial desktop snapshot")?;
                            let mut state = Snapshot { raw: state.raw.clone(), revision: state.revision, synchronized: state.synchronized };
                            state.apply(change)?;
                            Snapshot::new(state.raw, state.revision, thread, &item.session.cwd)
                        }
                    })();
                    match next {
                        Ok(state) => {
                            let status = crate::catalog::external_status(&state.status());
                            item.state = Some(state);
                            item.received = Instant::now();
                            app.desktop_statuses.lock().await.0.insert(item.session.id.clone(), (status, item.received));
                        }
                        Err(error) => {
                            tracing::debug!(%error, "Desktop sidebar snapshot needs resynchronization");
                            item.state = None;
                            app.desktop_statuses.lock().await.0.remove(&item.session.id);
                            // Retry only at the bounded heartbeat, not for every
                            // incompatible frame from a newer desktop version.
                        }
                    }
                }
                _ = tick.tick() => {
                    if app.stopping.load(std::sync::atomic::Ordering::Relaxed) { break; }
                    let sessions: HashMap<_, _> = app.store.sessions()?.into_iter()
                        .filter(|s| s.external && s.thread_id.is_some() && app.session_directory(&s.cwd, true).is_ok())
                        .map(|s| (s.thread_id.clone().unwrap(), s)).collect();
                    let removed: Vec<_> = followed.iter().filter(|(id, item)| !sessions.contains_key(*id) || item.received.elapsed() >= FRESH_FOR).map(|(id, _)| id.clone()).collect();
                    for thread in removed {
                        if let Some(item) = followed.remove(&thread) {
                            app.desktop_statuses.lock().await.0.remove(&item.session.id);
                            client.follow(&thread, &item.owner, false).await?;
                        }
                        attempted.remove(&thread);
                    }
                    attempted.retain(|thread, _| sessions.contains_key(thread));
                    // Idle conversations also need snapshots: the original
                    // desktop can start a new turn while this page is elsewhere.
                    for (thread, item) in &mut followed {
                        if item.requested.elapsed() >= FRESH_FOR { item.snapshot_pending = false; }
                        if !item.snapshot_pending && item.received.elapsed() >= SNAPSHOT_AFTER && item.requested.elapsed() >= SNAPSHOT_AFTER {
                            client.follow(thread, &item.owner, true).await?;
                            item.requested = Instant::now();
                            item.snapshot_pending = true;
                        }
                    }
                    let mut candidates: Vec<_> = sessions.into_values().filter(|s| {
                        let thread = s.thread_id.as_ref().unwrap();
                        !followed.contains_key(thread) && !probing.contains(thread) && attempted.get(thread).is_none_or(|at| at.elapsed() >= RETRY_AFTER)
                    }).collect();
                    // Never starve older conversations behind recently updated
                    // histories that do not have a desktop owner.
                    candidates.sort_by_key(|s| (attempted.get(s.thread_id.as_ref().unwrap()).copied(), std::cmp::Reverse(s.updated_at)));
                    for session in candidates.into_iter().take(MAX_DISCOVERIES.saturating_sub(probes.len())) {
                        let thread = session.thread_id.as_ref().unwrap().clone();
                        attempted.insert(thread.clone(), Instant::now());
                        probing.insert(thread.clone());
                        let client = client.clone();
                        probes.spawn(async move {
                            let reply = client.request("thread-owner-discovery", 1, json!({"hostId":"local","conversationId":thread}), None).await;
                            if let Err(error) = &reply {
                                tracing::debug!(%error, "Desktop sidebar owner query unavailable");
                            }
                            let owner = reply.ok().and_then(|v| v["handledByClientId"].as_str().filter(|id| !id.is_empty() && *id != client.id).map(str::to_owned));
                            (session, owner)
                        });
                    }
                }
            }
        }
        Ok(())
    }.await;
    let _ = tokio::time::timeout(Duration::from_secs(1), async {
        for (thread, item) in &followed {
            let _ = client.follow(thread, &item.owner, false).await;
        }
    })
    .await;
    client.close().await;
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stale_observations_are_not_running_evidence() {
        let mut statuses = Statuses::default();
        statuses
            .0
            .insert("live".into(), ("running", Instant::now()));
        statuses
            .0
            .insert("stale".into(), ("running", Instant::now() - FRESH_FOR));
        assert_eq!(statuses.get("live"), Some("running"));
        assert_eq!(statuses.get("stale"), None);
        assert_eq!(statuses.get("unknown"), None);
    }
}
