//! Opt-in desktop-host adapter. The endpoint must be explicitly configured;
//! there is no automatic original-application discovery or execution here.
use crate::{App, desktop_ipc::Client, desktop_state::Snapshot, store::Session};
use anyhow::{Context, Result, bail, ensure};
use remote_agent_sdk::RpcProcess;
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    path::Path,
    sync::{
        Arc, Weak,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
use tokio::sync::{Mutex, mpsc};

#[derive(Clone)]
struct PendingRequest {
    native: Value,
    web_id: String,
    answered: bool,
}

struct Adapter {
    app: Weak<App>,
    client: Arc<Client>,
    owner: String,
    thread: String,
    cwd: String,
    epoch: String,
    state: Mutex<Snapshot>,
    mutations: Mutex<()>,
    uncertain: AtomicBool,
    pending: Mutex<HashMap<String, PendingRequest>>,
    events: mpsc::UnboundedSender<Value>,
}

pub fn configured(
    data: &Path,
    explicit: Option<std::path::PathBuf>,
) -> Result<Option<std::path::PathBuf>> {
    let path = if explicit.is_some() {
        explicit
    } else {
        let config = data.join("desktop-host.json");
        match std::fs::read(&config) {
            Ok(bytes) => {
                ensure!(
                    bytes.len() <= 65536,
                    "Desktop host configuration is too large"
                );
                let value: Value =
                    serde_json::from_slice(&bytes).context("Invalid desktop-host.json")?;
                ensure!(
                    value["version"] == 1,
                    "Unsupported desktop host configuration version"
                );
                Some(
                    value["socket"]
                        .as_str()
                        .context("Missing desktop host socket")?
                        .into(),
                )
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(error) => return Err(error.into()),
        }
    };
    ensure!(
        path.as_ref().is_none_or(|p| p.is_absolute()),
        "Desktop IPC requires an absolute socket path"
    );
    Ok(path)
}

#[derive(Debug)]
pub struct NoOwner;
impl std::fmt::Display for NoOwner {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Desktop does not own this conversation")
    }
}
impl std::error::Error for NoOwner {}

pub async fn connect(
    app: &Arc<App>,
    session: &Session,
    path: &Path,
) -> Result<(Arc<RpcProcess>, mpsc::UnboundedReceiver<Value>)> {
    let thread = session
        .thread_id
        .as_deref()
        .context("Missing original desktop thread")?;
    let (client, mut incoming) = Client::connect(path).await?;
    let result = async {
        let discovered = client
            .request(
                "thread-owner-discovery",
                1,
                json!({"hostId":"local","conversationId":thread}),
                None,
            )
            .await
            .map_err(|error| {
                if error
                    .downcast_ref::<crate::desktop_ipc::Rejected>()
                    .is_some_and(|e| e.0 == "no-client-found")
                {
                    error.context(NoOwner)
                } else {
                    error
                }
            })?;
        let owner = discovered["handledByClientId"]
            .as_str()
            .filter(|id| !id.is_empty() && *id != client.id)
            .context("Desktop owner not found")?
            .to_owned();
        client.follow(thread, &owner, true).await?;
        let initial = tokio::time::timeout(Duration::from_secs(5), async {
            while let Some(message) = incoming.recv().await {
                if state_message(&message, &client.id, &owner, thread)
                    && message["params"]["change"]["type"] == "snapshot"
                {
                    let change = &message["params"]["change"];
                    return Snapshot::new(
                        change["conversationState"].clone(),
                        change["revision"]
                            .as_u64()
                            .context("Missing desktop snapshot revision")?,
                        thread,
                        &session.cwd,
                    );
                }
            }
            bail!("Desktop owner disconnected before initial snapshot")
        })
        .await
        .context("Desktop snapshot timed out")??;
        Ok::<_, anyhow::Error>((owner, initial))
    }
    .await;
    let (owner, initial) = match result {
        Ok(value) => value,
        Err(error) => {
            client.close().await;
            return Err(error);
        }
    };
    let (rpc, events, bridge) = RpcProcess::bridge();
    let adapter = Arc::new(Adapter {
        app: Arc::downgrade(app),
        client,
        owner,
        thread: thread.into(),
        cwd: session.cwd.clone(),
        epoch: uuid::Uuid::new_v4().to_string(),
        state: Mutex::new(initial),
        mutations: Default::default(),
        uncertain: AtomicBool::new(false),
        pending: Default::default(),
        events: bridge.responses,
    });
    if let Err(error) = adapter.publish(None).await {
        adapter.client.close().await;
        return Err(error);
    }
    let a = adapter.clone();
    tokio::spawn(async move {
        let mut snapshots = tokio::time::interval(Duration::from_secs(1));
        snapshots.tick().await;
        let mut resnapshot: Option<std::time::Instant> = None;
        loop {
            tokio::select! {
                message = incoming.recv() => {
                    let Some(message) = message else { break; };
                    if message["method"] == "client-status-changed" && message["params"]["clientId"] == a.owner && message["params"]["status"] == "disconnected" { break; }
                    if stream_identity(&message, &a.client.id, &a.owner, &a.thread) && message["version"] != 11 {
                        a.event("error", json!({"threadId":a.thread,"message":"桌面状态协议版本不兼容，连接已关闭"}));
                        break;
                    }
                    if !state_message(&message, &a.client.id, &a.owner, &a.thread) { continue; }
                    let change = &message["params"]["change"];
                    if change["type"] == "snapshot" { resnapshot = None; }
                    let previous = {
                        let mut state = a.state.lock().await;
                        let old = state.raw.clone();
                        let updated = if change["type"] == "snapshot" {
                            change["revision"].as_u64().context("Missing desktop revision").and_then(|revision| {
                                ensure!(revision >= state.revision, "Stale desktop snapshot");
                                Snapshot::new(change["conversationState"].clone(), revision, &a.thread, &a.cwd)
                            })
                        } else if change["type"] == "patches" {
                            let mut candidate = Snapshot { raw: state.raw.clone(), revision: state.revision, synchronized: state.synchronized };
                            candidate.apply(change).and_then(|_| Snapshot::new(candidate.raw, candidate.revision, &a.thread, &a.cwd))
                        } else {
                            Err(anyhow::anyhow!("Unknown desktop state change type"))
                        };
                        match updated {
                            Ok(next) => { *state = next; Some(old) }
                            Err(error) => { state.synchronized = false; tracing::debug!(%error, "Desktop state needs resynchronization"); None }
                        }
                    };
                    if let Some(previous) = previous {
                        if a.publish(Some(&previous)).await.is_err() { break; }
                    } else if resnapshot.is_none() {
                        if a.client.follow(&a.thread, &a.owner, true).await.is_err() { break; }
                        resnapshot = Some(std::time::Instant::now());
                    }
                }
                _ = snapshots.tick() => {
                    // Native command output may suppress patches to followers.
                    // A read-only resnapshot also repairs missing revision gaps.
                    // At most one full snapshot request may be outstanding.
                    // A slow owner must not accumulate one large serialization
                    // request each second and fall ever further behind.
                    if resnapshot.is_some_and(|at| at.elapsed() >= Duration::from_secs(10)) { break; }
                    let needed = { let state = a.state.lock().await; state.busy() || !state.synchronized };
                    if needed && resnapshot.is_none() {
                        if a.client.follow(&a.thread, &a.owner, true).await.is_err() { break; }
                        resnapshot = Some(std::time::Instant::now());
                    }
                }
            }
        }
        a.state.lock().await.synchronized = false;
        for request in a.pending.lock().await.values() {
            a.event(
                "serverRequest/resolved",
                json!({"threadId":a.thread,"requestId":request.web_id,"connection_lost":true}),
            );
        }
        a.event("plugin/exited", json!({"threadId":a.thread}));
        let _ = tokio::time::timeout(
            Duration::from_secs(1),
            a.client.follow(&a.thread, &a.owner, false),
        )
        .await;
        a.client.close().await;
    });
    tokio::spawn(async move {
        let mut requests = bridge.requests;
        let mut tasks = tokio::task::JoinSet::new();
        let capacity = Arc::new(tokio::sync::Semaphore::new(32));
        loop {
            let request = tokio::select! {
                _ = adapter.client.closed() => break,
                Some(_) = tasks.join_next(), if !tasks.is_empty() => continue,
                request = requests.recv() => match request { Some(request) => request, None => break },
            };
            let Some(value) = request.value else {
                let _ = request.accepted.send(Ok(()));
                break;
            };
            let a = adapter.clone();
            let permit = capacity.clone().try_acquire_owned();
            tasks.spawn(async move {
                let result = match permit {
                    Ok(_permit) => a.native(&value).await,
                    Err(_) => Err(anyhow::anyhow!(
                        "Desktop adapter is busy; no command was sent"
                    )),
                };
                if value.get("method").is_some() {
                    if value.get("id").is_some() {
                        let response = match result {
                            Ok(result) => json!({"id":value["id"],"result":result}),
                            Err(error) => {
                                json!({"id":value["id"],"error":{"message":format!("{error:#}")}})
                            }
                        };
                        let _ = a.events.send(response);
                    }
                    let _ = request.accepted.send(Ok(()));
                } else {
                    let _ = request.accepted.send(result.map(|_| ()));
                }
            });
        }
        tasks.abort_all();
        let _ = adapter
            .client
            .follow(&adapter.thread, &adapter.owner, false)
            .await;
        adapter.client.close().await;
    });
    Ok((rpc, events))
}

fn state_message(message: &Value, client: &str, owner: &str, thread: &str) -> bool {
    message["version"] == 11 && stream_identity(message, client, owner, thread)
}

pub(crate) fn stream_identity(message: &Value, client: &str, owner: &str, thread: &str) -> bool {
    message["type"] == "broadcast"
        && message["method"] == "thread-stream-state-changed"
        && message["sourceClientId"] == owner
        && message["params"]["conversationId"] == thread
        && message["params"]["hostId"] == "local"
        && message.get("targetClientIds").is_none_or(|targets| {
            targets
                .as_array()
                .is_some_and(|targets| targets.iter().any(|target| target == client))
        })
}

/// The desktop's queue restore mapper uses src/localPath for local images.
/// Its attachment descriptors are display/path metadata; native input still
/// carries the actual image and is forwarded without rewriting.
fn image_context(input: &[Value], client_id: &str) -> (Vec<Value>, Vec<Value>) {
    let mut images = Vec::new();
    let mut attachments = Vec::new();
    for (index, part) in input.iter().enumerate() {
        let id = format!("{client_id}:{index}");
        if part["type"] == "localImage" {
            if let Some(path) = part["path"].as_str() {
                images.push(json!({"id":id,"src":path,"localPath":path}));
                let label = Path::new(path)
                    .file_name()
                    .map(|name| name.to_string_lossy().into_owned())
                    .unwrap_or_else(|| path.into());
                let descriptor =
                    json!({"label":label,"path":path,"fsPath":path,"isImageAttachment":true});
                if !attachments.contains(&descriptor) {
                    attachments.push(descriptor);
                }
            }
        } else if part["type"] == "image"
            && let Some(url) = part["url"].as_str()
        {
            images.push(json!({"id":id,"src":url}));
        }
    }
    (images, attachments)
}

impl Adapter {
    fn event(&self, method: &str, params: Value) {
        let _ = self.events.send(json!({"method":method,"params":params}));
    }

    async fn owner_request(&self, method: &str, version: u32, mut params: Value) -> Result<Value> {
        ensure!(
            !self.uncertain.load(Ordering::Acquire),
            "上一次桌面操作的送达结果尚未确认，当前连接已停止发送操作，请先在桌面核对结果；未重复发送"
        );
        if !self.state.lock().await.synchronized {
            return Err(crate::desktop_ipc::Rejected(
                "state-resynchronizing; no mutation was sent".into(),
            )
            .into());
        }
        params["conversationId"] = json!(self.thread);
        match self
            .client
            .request(method, version, params, Some(&self.owner))
            .await
        {
            Ok(result) => Ok(result["result"].clone()),
            Err(error) => {
                if !error.is::<crate::desktop_ipc::Rejected>() {
                    self.uncertain.store(true, Ordering::Release);
                }
                Err(error)
            }
        }
    }

    async fn publish(&self, previous: Option<&Value>) -> Result<()> {
        let state = {
            let state = self.state.lock().await;
            Snapshot {
                raw: state.raw.clone(),
                revision: state.revision,
                synchronized: state.synchronized,
            }
        };
        let old = previous.map(|raw| Snapshot {
            raw: raw.clone(),
            revision: 0,
            synchronized: true,
        });
        if old.as_ref().is_none_or(|old| old.raw != state.raw) {
            self.event("thread/history/updated", json!({"revision":state.revision}));
        }
        if old
            .as_ref()
            .is_none_or(|old| old.raw["threadGoal"] != state.raw["threadGoal"])
        {
            self.event(
                "thread/goal/updated",
                json!({"threadId":self.thread,"goal":state.raw["threadGoal"]}),
            );
        }
        let active = state.active_turn();
        let old_active = old.as_ref().and_then(Snapshot::active_turn);
        if old_active != active {
            if let Some(id) = old_active {
                let turn = state
                    .native_turns()
                    .into_iter()
                    .find(|turn| turn["id"] == id)
                    .unwrap_or(json!({"id":id,"status":"completed"}));
                self.event(
                    "turn/completed",
                    json!({"threadId":self.thread,"turn":turn,"desktop_projection":true}),
                );
            }
            if let Some(id) = &active {
                self.event(
                    "turn/started",
                    json!({"threadId":self.thread,"turn":{"id":id},"desktop_projection":true}),
                );
            }
        }
        let status = state.thread()["status"].clone();
        if old
            .as_ref()
            .is_none_or(|old| old.thread()["status"] != status)
        {
            self.event(
                "thread/status/changed",
                json!({"threadId":self.thread,"status":status}),
            );
        }
        let settings = state.settings();
        if old.as_ref().is_none_or(|old| old.settings() != settings) {
            self.event(
                "thread/settings/updated",
                json!({"threadId":self.thread,"threadSettings":settings}),
            );
        }
        let mut pending = self.pending.lock().await;
        let mut current = HashMap::new();
        for native in state.raw["requests"].as_array().into_iter().flatten() {
            ensure!(
                (native["id"].is_number() || native["id"].is_string())
                    && native["method"].is_string()
                    && native["params"].is_object(),
                "Invalid desktop pending request"
            );
            ensure!(
                native["params"]
                    .get("threadId")
                    .is_none_or(|id| id == &json!(self.thread)),
                "Desktop pending request thread mismatch"
            );
            let key = native["id"].to_string();
            if let Some(existing) = pending.remove(&key) {
                ensure!(
                    existing.native["method"] == native["method"]
                        && existing.native["params"] == native["params"],
                    "Desktop pending request identity reused"
                );
                current.insert(key, existing);
            } else {
                let web_id = format!("desktop:{}:{}", self.epoch, uuid::Uuid::new_v4());
                let _ = self
                    .events
                    .send(json!({"method":native["method"],"params":native["params"],"id":web_id}));
                current.insert(
                    key,
                    PendingRequest {
                        native: native.clone(),
                        web_id,
                        answered: false,
                    },
                );
            }
        }
        for old in pending.values() {
            self.event(
                "serverRequest/resolved",
                json!({"threadId":self.thread,"requestId":old.web_id}),
            );
        }
        *pending = current;
        Ok(())
    }

    async fn native(&self, message: &Value) -> Result<Value> {
        let Some(method) = message["method"].as_str() else {
            return self.respond(message).await;
        };
        let params = &message["params"];
        if let Some(thread) = params.get("threadId") {
            ensure!(
                thread == &json!(self.thread),
                "Desktop thread identity mismatch"
            );
        }
        let _mutation = if !matches!(
            method,
            "initialized"
                | "thread/read"
                | "anywork/active-turn"
                | "anywork/desktop-view"
                | "thread/resume"
                | "thread/turns/list"
                | "thread/goal/get"
                | "model/list"
                | "configRequirements/read"
        ) {
            Some(self.mutations.lock().await)
        } else {
            None
        };
        let state = self.state.lock().await;
        ensure!(
            state.synchronized,
            "Desktop state is resynchronizing; no command was sent"
        );
        match method {
            "initialized" => return Ok(json!({})),
            "thread/read" => return Ok(json!({"thread":state.thread()})),
            "anywork/active-turn" => return Ok(json!({"turnId":state.active_turn()})),
            "anywork/desktop-view" => {
                return Ok(
                    json!({"thread":state.thread(),"history_complete":state.history_complete(),"has_live_tail":state.has_live_tail()}),
                );
            }
            "thread/resume" => {
                let mut result = state.settings();
                result["thread"] = state.thread();
                return Ok(result); // Hydrate only; do not issue a second resume.
            }
            "thread/turns/list" => {
                let mut turns = state.native_turns();
                if params["sortDirection"] == "desc" {
                    turns.reverse();
                }
                let start = params["cursor"]
                    .as_str()
                    .map(|cursor| {
                        cursor
                            .strip_prefix("desktop:")
                            .context("Unsupported desktop history cursor")
                            .and_then(|value| value.parse::<usize>().map_err(anyhow::Error::from))
                    })
                    .transpose()?
                    .unwrap_or(0);
                let limit = params["limit"].as_u64().unwrap_or(100).clamp(1, 100) as usize;
                let end = (start + limit).min(turns.len());
                ensure!(start <= turns.len(), "Invalid desktop history cursor");
                return Ok(
                    json!({"data":turns[start..end],"nextCursor":if end<turns.len(){Some(format!("desktop:{end}"))}else{None}}),
                );
            }
            "thread/goal/get" => return Ok(json!({"goal":state.raw["threadGoal"]})),
            _ => {}
        }
        let active = state.active_turn();
        let busy = state.busy();
        let raw = state.raw.clone();
        drop(state);
        match method {
            "thread/goal/set"
                if params["status"] == "paused"
                    && params.as_object().is_some_and(|params| {
                        params
                            .keys()
                            .all(|key| matches!(key.as_str(), "threadId" | "status" | "origin"))
                    }) =>
            {
                ensure!(raw["threadGoal"].is_object(), "此会话没有可暂停的目标");
                if raw["threadGoal"]["status"] == "paused" {
                    return Ok(json!({"goal":raw["threadGoal"]}));
                }
                ensure!(
                    raw["threadGoal"]["status"] == "active",
                    "此目标已结束，无需暂停"
                );
                // The shipped host has no follower goal-set RPC. Its untargeted
                // user-stop path pauses the goal through the owner's request
                // client before interrupting execution. Version 4 with an
                // expectedTurnId takes an early branch that DOES NOT pause it.
                let result = self
                    .owner_request(
                        "thread-follower-interrupt-turn",
                        3,
                        json!({"mode":"user-stop"}),
                    )
                    .await?;
                if let Some(error) = result["goalPauseError"].as_str() {
                    bail!("桌面已收到停止请求，但目标暂停失败：{error}");
                }
                let confirmed = tokio::time::timeout(Duration::from_secs(5), async {
                    loop {
                        let state = self.state.lock().await;
                        let goal = state.raw["threadGoal"].clone();
                        ensure!(
                            state.synchronized,
                            "桌面目标状态正在重新同步，请核对桌面结果"
                        );
                        if goal["status"] == "paused" {
                            return Ok::<_, anyhow::Error>(goal);
                        }
                        drop(state);
                        tokio::time::sleep(Duration::from_millis(50)).await;
                    }
                })
                .await
                .context(
                    "暂停请求已送达，但尚未收到桌面目标状态确认；请核对桌面结果，未重复发送",
                )??;
                Ok(json!({"goal":confirmed}))
            }
            "thread/goal/set" | "thread/goal/clear" => {
                bail!(
                    "当前桌面的会话共享入口只支持暂停目标；恢复、编辑和删除请在桌面中操作，或通过共享引擎启动桌面后使用。未启动其他执行进程"
                )
            }
            "model/list" | "configRequirements/read" => {
                let app = self.app.upgrade().context("AnyWork is stopping")?;
                app.catalog
                    .lock()
                    .await
                    .query(&app, method, params.clone())
                    .await
            }
            "thread/settings/update" => {
                let mut settings = params
                    .as_object()
                    .context("Invalid desktop settings")?
                    .clone();
                settings.remove("threadId");
                ensure!(
                    settings.keys().all(|key| matches!(
                        key.as_str(),
                        "model" | "effort" | "collaborationMode" | "serviceTier"
                    )),
                    "Unsupported desktop settings change"
                );
                ensure!(
                    !busy || settings.keys().all(|key| key == "effort"),
                    "Desktop is busy; only reasoning effort can change during execution"
                );
                let result = self
                    .owner_request(
                        "thread-follower-update-thread-settings",
                        2,
                        json!({"threadSettings":settings}),
                    )
                    .await?;
                ensure!(
                    result["applied"] == true,
                    "Desktop owner did not apply settings"
                );
                let _ = self.client.follow(&self.thread, &self.owner, true).await;
                Ok(json!({}))
            }
            "turn/start" | "turn/steer" => {
                let input = params["input"]
                    .as_array()
                    .context("Missing desktop message input")?;
                ensure!(!input.is_empty(), "Empty desktop input");
                ensure!(
                    params
                        .as_object()
                        .is_some_and(|params| params.keys().all(|key| matches!(
                            key.as_str(),
                            "threadId" | "input" | "clientUserMessageId" | "expectedTurnId"
                        ))),
                    "Unsupported desktop turn options; original settings preserved"
                );
                let client_id = params["clientUserMessageId"]
                    .as_str()
                    .map(str::to_owned)
                    .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
                let text = input
                    .iter()
                    .filter_map(|part| part["text"].as_str())
                    .collect::<Vec<_>>()
                    .join("\n");
                let mut restore = json!({"id":client_id,"text":text,"cwd":self.cwd,"createdAt":crate::store::now(),"context":{"prompt":text,"addedFiles":[],"fileAttachments":[],"ideContext":null,"imageAttachments":[],"workspaceRoots":[self.cwd]}});
                let (images, attachments) = image_context(input, &client_id);
                restore["context"]["imageAttachments"] = json!(images);
                if raw["latestCollaborationMode"].is_object() {
                    restore["context"]["collaborationMode"] =
                        raw["latestCollaborationMode"].clone();
                }
                if method == "turn/steer" {
                    ensure!(
                        active.as_deref() == params["expectedTurnId"].as_str() && active.is_some(),
                        "Desktop active turn changed; message was not sent"
                    );
                    let result = self.owner_request("thread-follower-steer-turn", 1, json!({"input":input,"restoreMessage":restore,"attachments":attachments,"clientUserMessageId":client_id})).await?;
                    Ok(result["result"].clone())
                } else {
                    ensure!(!busy, "Desktop is busy; no second turn was started");
                    let request = json!({"threadId":self.thread,"input":input,"clientUserMessageId":client_id});
                    let result = self.owner_request("thread-follower-start-turn", 2, json!({"turnStart":{"request":request,"context":{"restoreMessage":restore,"attachments":attachments}}})).await?;
                    Ok(result["result"].clone())
                }
            }
            "turn/interrupt" => {
                ensure!(
                    active.as_deref() == params["turnId"].as_str() && active.is_some(),
                    "Desktop active turn changed; no interrupt was sent"
                );
                let result = self
                    .owner_request(
                        "thread-follower-interrupt-turn",
                        4,
                        json!({"mode":"user-stop","expectedTurnId":active}),
                    )
                    .await?;
                if let Some(error) = result["goalPauseError"].as_str() {
                    self.event("error", json!({"threadId":self.thread,"message":format!("任务已停止，但目标暂停失败：{error}")}));
                }
                Ok(result)
            }
            _ => {
                bail!("Desktop host adapter does not support {method}; no engine command was sent")
            }
        }
    }

    async fn respond(&self, message: &Value) -> Result<Value> {
        let _mutation = self.mutations.lock().await;
        let request = self
            .pending
            .lock()
            .await
            .values()
            .find(|request| message["id"] == request.web_id)
            .cloned()
            .context("Desktop request belongs to an old connection or is no longer pending")?;
        ensure!(
            !request.answered,
            "Desktop response was already dispatched; do not resend"
        );
        let state = self.state.lock().await;
        ensure!(
            state.synchronized
                && state.raw["requests"]
                    .as_array()
                    .is_some_and(|requests| requests
                        .iter()
                        .any(|native| native == &request.native)),
            "Desktop request is no longer pending"
        );
        drop(state);
        let result = &message["result"];
        let (method, mut payload) = match request.native["method"].as_str() {
            Some("item/commandExecution/requestApproval") => (
                "thread-follower-command-approval-decision",
                json!({"decision":result["decision"]}),
            ),
            Some("item/fileChange/requestApproval") => (
                "thread-follower-file-approval-decision",
                json!({"decision":result["decision"]}),
            ),
            Some("item/permissions/requestApproval") => (
                "thread-follower-permissions-request-approval-response",
                json!({"response":result}),
            ),
            Some("item/tool/requestUserInput") => (
                "thread-follower-submit-user-input",
                json!({"response":result}),
            ),
            Some("mcpServer/elicitation/request") => (
                "thread-follower-submit-mcp-server-elicitation-response",
                json!({"response":result}),
            ),
            _ => bail!("Original desktop host must handle this pending tool; no response was sent"),
        };
        payload["requestId"] = request.native["id"].clone();
        let key = request.native["id"].to_string();
        {
            let mut pending = self.pending.lock().await;
            let current = pending
                .get_mut(&key)
                .filter(|p| p.web_id == request.web_id)
                .context("Desktop request was resolved before dispatch")?;
            current.answered = true;
        }
        let result = self.owner_request(method, 1, payload).await;
        if let Err(error) = &result {
            // Only a definitive protocol rejection permits another answer.
            // Timeout, disconnect and malformed replies retain the reservation.
            if error.is::<crate::desktop_ipc::Rejected>()
                && let Some(current) = self.pending.lock().await.get_mut(&key)
                && current.web_id == request.web_id
            {
                current.answered = false;
            }
        }
        let result = result?;
        ensure!(
            result["ok"] == true,
            "Desktop owner did not acknowledge response; delivery outcome unknown"
        );
        Ok(json!({}))
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn durable_configuration_and_explicit_override() {
        let data = std::env::temp_dir().join(format!("aw-desktop-config-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&data).unwrap();
        assert_eq!(super::configured(&data, None).unwrap(), None);
        let file = data.join("desktop-host.json");
        std::fs::write(&file, r#"{"version":1,"socket":"/tmp/existing-host.sock"}"#).unwrap();
        assert_eq!(
            super::configured(&data, None).unwrap().unwrap(),
            std::path::PathBuf::from("/tmp/existing-host.sock")
        );
        assert_eq!(
            super::configured(&data, Some("/tmp/override.sock".into()))
                .unwrap()
                .unwrap(),
            std::path::PathBuf::from("/tmp/override.sock")
        );
        std::fs::write(&file, r#"{"version":1,"socket":"relative.sock"}"#).unwrap();
        assert!(super::configured(&data, None).is_err());
        std::fs::write(&file, r#"{"version":2,"socket":"/tmp/host.sock"}"#).unwrap();
        assert!(super::configured(&data, None).is_err());
        std::fs::remove_dir_all(data).unwrap();
    }
    use super::*;

    #[test]
    fn image_restore_keeps_input_indexes_and_deduplicates_path_metadata() {
        let input = json!([
            {"type":"text","text":"inspect"},
            {"type":"localImage","path":"/tmp/图片 one.png"},
            {"type":"image","url":"data:image/png;base64,fixture"},
            {"type":"localImage","path":"/tmp/图片 one.png"},
            {"type":"localImage"},
            {"type":"text","text":"tail"}
        ]);
        let original = input.clone();
        let (images, attachments) = image_context(input.as_array().unwrap(), "draft-id");
        assert_eq!(
            images,
            vec![
                json!({"id":"draft-id:1","src":"/tmp/图片 one.png","localPath":"/tmp/图片 one.png"}),
                json!({"id":"draft-id:2","src":"data:image/png;base64,fixture"}),
                json!({"id":"draft-id:3","src":"/tmp/图片 one.png","localPath":"/tmp/图片 one.png"})
            ]
        );
        assert_eq!(
            attachments,
            vec![
                json!({"label":"图片 one.png","path":"/tmp/图片 one.png","fsPath":"/tmp/图片 one.png","isImageAttachment":true})
            ]
        );
        assert_eq!(input, original);
    }
}
