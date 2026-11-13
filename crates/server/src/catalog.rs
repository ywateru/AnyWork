//! Read-only discovery of the current user's Codex history. Never resumes a
//! desktop thread during discovery. Explicit control reuses the original thread.
use crate::{
    ApiError, App, files,
    store::{Event, Session, now},
};
use anyhow::{Context, Result};
use axum::{
    Json,
    extract::{Path, Query, State},
};
use remote_agent_sdk::RpcProcess;
use serde_json::{Value, json};
use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
    time::{Duration, Instant},
};

#[derive(Default)]
pub struct Catalog {
    rpc: Option<Arc<CatalogRpc>>,
    synced: Option<Instant>,
    pub error: Option<String>,
}
struct CatalogRpc {
    process: Arc<RpcProcess>,
    observer: crate::observer::Observer,
}
impl CatalogRpc {
    async fn call(&self, method: &str, params: Value) -> Result<Value> {
        if matches!(
            method,
            "thread/list"
                | "thread/read"
                | "thread/items/list"
                | "thread/turns/list"
                | "model/list"
                | "thread/goal/get"
        ) && let Ok(value) = self.observer.call(method, params.clone()).await
        {
            return Ok(value);
        }
        self.process.call(method, params).await
    }
    async fn close(&self) {
        self.process.close().await;
    }
}
async fn list_source(rpc: &CatalogRpc, shared: bool) -> Result<Vec<(Value, bool)>> {
    let mut rows = Vec::new();
    for archived in [false, true] {
        let mut cursor = Value::Null;
        let mut seen = HashSet::new();
        loop {
            let params = json!({"limit":100,"cursor":cursor,"archived":archived,"modelProviders":[],"sourceKinds":["cli","vscode","exec","appServer","subAgent","subAgentReview","subAgentCompact","subAgentThreadSpawn","subAgentOther","unknown"]});
            let page = if shared {
                rpc.observer.call("thread/list", params).await?
            } else {
                rpc.process.call("thread/list", params).await?
            };
            for thread in page["data"]
                .as_array()
                .context("Invalid Codex thread list")?
            {
                rows.push((thread.clone(), archived));
            }
            cursor = page["nextCursor"].clone();
            if cursor.is_null() {
                break;
            }
            anyhow::ensure!(
                seen.insert(cursor.to_string()),
                "Repeated Codex page cursor"
            );
        }
    }
    Ok::<_, anyhow::Error>(rows)
}

impl Catalog {
    /// Read metadata without acquiring a thread writer or resuming an engine.
    pub async fn query(&mut self, app: &App, method: &str, params: Value) -> Result<Value> {
        anyhow::ensure!(
            matches!(
                method,
                "model/list" | "thread/read" | "thread/goal/get" | "configRequirements/read"
            ),
            "Catalog query is read-only"
        );
        self.rpc(app).await?.call(method, params).await
    }
    async fn rpc(&mut self, app: &App) -> Result<Arc<CatalogRpc>> {
        if let Some(rpc) = &self.rpc {
            return Ok(rpc.clone());
        }
        let manifest = app
            .plugins
            .get("codex")
            .context("Codex plugin not installed")?;
        let (rpc, mut events) = RpcProcess::spawn(manifest).await?;
        tokio::spawn(async move { while events.recv().await.is_some() {} });
        if let Err(e) = rpc.call("initialize", json!({"clientInfo":{"name":"anywork_catalog","version":env!("CARGO_PKG_VERSION")},"capabilities":{"experimentalApi":true}})).await {
            rpc.close().await; return Err(e);
        }
        rpc.send(json!({"method":"initialized","params":{}}))
            .await?;
        let rpc = Arc::new(CatalogRpc {
            process: rpc,
            observer: Default::default(),
        });
        self.rpc = Some(rpc.clone());
        Ok(rpc)
    }
    pub async fn sync(&mut self, app: &App) {
        if !app.codex_discovery
            || self
                .synced
                .is_some_and(|t| t.elapsed() < Duration::from_secs(2))
        {
            return;
        }
        self.error = None;
        let result = self.scan(app).await;
        self.synced = Some(Instant::now());
        if let Err(error) = &result {
            self.error = Some(format!("Codex 会话同步失败：{error}"));
        }
        if result.is_err()
            && let Some(rpc) = self.rpc.take()
        {
            rpc.close().await;
        }
    }
    async fn scan(&mut self, app: &App) -> Result<()> {
        let rpc = self.rpc(app).await?;
        let managed: HashSet<String> = app
            .store
            .sessions()?
            .into_iter()
            .filter(|s| !s.external && s.agent == "codex")
            .filter_map(|s| s.thread_id)
            .collect();
        let mut imported = vec![];
        let mut imported_ids = HashSet::new();
        let mut successful_sources = 0;
        let mut persisted_complete = false;
        let mut errors = Vec::new();
        // Persisted history is independent of which engine currently owns a
        // thread. Overlay the shared daemon's live metadata after reading it.
        for shared in [false, true] {
            let source = list_source(&rpc, shared).await;
            match source {
                Ok(rows) => {
                    successful_sources += 1;
                    if !shared {
                        persisted_complete = true;
                    }
                    for (thread, archived) in rows {
                        let scope = (!app.history_all("codex")).then_some(app.workspace.as_path());
                        if let Some(session) = imported_session(&thread, archived, scope, &managed)
                        {
                            if imported_ids.insert(session.id.clone()) {
                                imported.push(session);
                            } else if shared
                                && let Some(previous) =
                                    imported.iter_mut().find(|s| s.id == session.id)
                            {
                                *previous = session;
                            }
                        }
                    }
                }
                Err(error) => errors.push(error.to_string()),
            }
        }
        anyhow::ensure!(successful_sources > 0, "{}", errors.join("; "));
        if !persisted_complete {
            // A healthy live daemon is not evidence that its list contains all
            // persisted CLI threads. Retain earlier history on partial failure.
            for mut previous in app
                .store
                .sessions()?
                .into_iter()
                .filter(|s| s.external && s.agent == "codex")
            {
                if app.session_directory(&previous.cwd, true).is_ok()
                    && !previous
                        .thread_id
                        .as_ref()
                        .is_some_and(|id| managed.contains(id))
                    && imported_ids.insert(previous.id.clone())
                {
                    previous.status = "external".into();
                    imported.push(previous);
                }
            }
            self.error =
                Some("Codex 持久化历史索引暂不可用，已保留此前历史并加载可用的共享会话".into());
        }
        let runtimes = app.runtimes.lock().await;
        for session in &mut imported {
            if runtimes.contains_key(&session.id) {
                session.status = app.session(&session.id)?.status;
            }
        }
        drop(runtimes);
        app.store.refresh_imports("codex", &imported)?;
        Ok(())
    }
    pub async fn refresh_status(&mut self, app: &App, session: &Session) -> Result<Session> {
        let runtime = app.runtimes.lock().await.get(&session.id).cloned();
        #[cfg(unix)]
        if runtime.is_none()
            && let Some(status) = app.desktop_statuses.lock().await.get(&session.id)
        {
            // Keep expiring observations out of persistent metadata. Otherwise
            // a failed catalog scan could retain a disconnected owner's status.
            let mut observed = session.clone();
            observed.status = status.into();
            return Ok(observed);
        }
        let result = async {
            let thread = session
                .thread_id
                .as_deref()
                .context("Missing Codex thread")?;
            let params = json!({"threadId":thread,"includeTurns":false});
            let value = if let Some(runtime) = runtime {
                runtime.rpc.call("thread/read", params).await?
            } else {
                self.rpc(app).await?.call("thread/read", params).await?
            };
            anyhow::ensure!(
                value["thread"]["id"] == thread,
                "Unexpected thread status response"
            );
            Ok::<_, anyhow::Error>(external_status(&value["thread"]["status"]))
        }
        .await;
        // No evidence of activity is a state of uncertainty, not an active turn.
        app.store
            .set_status(&session.id, result.unwrap_or("external"))
    }
    pub async fn close(&mut self) {
        if let Some(rpc) = self.rpc.take() {
            rpc.close().await;
        }
    }
}

pub(crate) fn external_status(status: &Value) -> &'static str {
    match status["type"].as_str() {
        Some("active") => {
            if status["activeFlags"].as_array().is_some_and(|flags| {
                flags
                    .iter()
                    .any(|f| matches!(f.as_str(), Some("waitingOnApproval" | "waitingOnUserInput")))
            }) {
                "waiting"
            } else {
                "running"
            }
        }
        Some("idle") => "idle",
        Some("systemError") => "error",
        // notLoaded is local to the queried process, not evidence of inactivity.
        _ => "external",
    }
}

fn imported_session(
    thread: &Value,
    archived: bool,
    workspace: Option<&std::path::Path>,
    managed: &HashSet<String>,
) -> Option<Session> {
    let thread_id = thread["id"].as_str()?;
    // Internal approval-review records are not user conversations.
    if thread["source"]["subAgent"]["other"] == "guardian" {
        return None;
    }
    if managed.contains(thread_id) {
        return None;
    }
    let path = std::path::PathBuf::from(thread["cwd"].as_str()?);
    if !path.is_absolute() {
        return None;
    }
    let cwd = match workspace {
        Some(root) => files::within(root, &path).ok()?,
        None => match path.canonicalize() {
            Ok(path) => path,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => path,
            Err(_) => return None,
        },
    };
    let title = thread["name"]
        .as_str()
        .filter(|s| !s.trim().is_empty())
        .or_else(|| thread["preview"].as_str().filter(|s| !s.trim().is_empty()))
        .unwrap_or("未命名会话");
    Some(Session {
        id: format!("codex-{thread_id}"),
        thread_id: Some(thread_id.into()),
        title: title.into(),
        cwd: cwd.to_string_lossy().into(),
        agent: "codex".into(),
        model: thread["model"].as_str().map(String::from),
        policy: "manual".into(),
        status: external_status(&thread["status"]).into(),
        archived,
        created_at: thread["createdAt"].as_i64().unwrap_or(0) * 1000,
        updated_at: thread["updatedAt"].as_i64().unwrap_or(0) * 1000,
        external: true,
        auxiliary: thread["source"].is_object() && thread["source"].get("subAgent").is_some(),
    })
}

async fn history(rpc: &CatalogRpc, thread: &str) -> Result<Vec<Value>> {
    let mut turns = vec![];
    let mut cursor = Value::Null;
    let mut seen = HashSet::new();
    loop {
        match rpc.call("thread/turns/list", json!({"threadId":thread,"limit":100,"cursor":cursor,"itemsView":"full","sortDirection":"asc"})).await {
            Ok(page) => {
                turns.extend(page["data"].as_array().context("Invalid Codex turns")?.iter().cloned());
                cursor = page["nextCursor"].clone();
                if cursor.is_null() { return Ok(turns); }
                anyhow::ensure!(seen.insert(cursor.to_string()), "Repeated Codex turn cursor");
            }
            Err(e) if cursor.is_null() && (e.to_string().contains("-32601") || e.to_string().contains("unsupported")) => {
                let result = rpc.call("thread/read", json!({"threadId":thread,"includeTurns":true})).await?;
                return Ok(result["thread"]["turns"].as_array().context("Codex history is unavailable")?.clone());
            }
            Err(e) => return Err(e),
        }
    }
}
fn history_events(
    session: &Session,
    turns: &[Value],
    store: Option<&crate::store::Store>,
) -> Result<Vec<Event>> {
    let mut events = vec![];
    let push = |events: &mut Vec<Event>, method: &str, params: Value| {
        events.push(Event {
            seq: events.len() as i64 + 1,
            session_id: session.id.clone(),
            method: method.into(),
            params,
            request_id: None,
            created_at: session.updated_at,
        });
    };
    for turn in turns {
        let start = events.len();
        for item in turn["items"].as_array().into_iter().flatten() {
            if item["type"] == "userMessage" {
                let text = item["content"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|c| c["text"].as_str())
                    .collect::<Vec<_>>()
                    .join("\n");
                let attachments = item["content"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|c| match c["type"].as_str() {
                        Some("localImage") => c["path"].as_str(),
                        Some("image") => c["url"]
                            .as_str()
                            .filter(|url| url.starts_with("data:image/")),
                        _ => None,
                    })
                    .collect::<Vec<_>>();
                let display_text = crate::user_text::display_input(
                    item["content"].as_array().map(Vec::as_slice).unwrap_or(&[]),
                );
                push(
                    &mut events,
                    "user/message",
                    json!({"text":text,"display_text":display_text,"attachments":attachments}),
                );
                if let Some(composer) = store
                    .map(|store| store.composer_metadata_for_item(&session.id, item))
                    .transpose()?
                    .flatten()
                {
                    if let Some(display) = composer["goal_display_text"].as_str() {
                        events.last_mut().unwrap().params["display_text"] = json!(display);
                    }
                    events.last_mut().unwrap().params["composer"] = composer;
                }
            } else {
                let mut completed = item.clone();
                if completed.get("status").is_none() {
                    completed["status"] = json!("completed");
                }
                push(&mut events, "item/completed", json!({"item":completed}));
            }
            events.last_mut().unwrap().params["history_item_id"] = item["id"].clone();
        }
        for event in &mut events[start..] {
            event.params["history_turn_id"] = turn["id"].clone();
            if turn["status"].is_string() {
                event.params["history_turn_status"] = turn["status"].clone();
            }
            if let Some(time) = turn["startedAt"].as_i64() {
                event.params["history_work_started_at"] = json!(time.saturating_mul(1000));
            }
            if let Some(time) = turn["completedAt"].as_i64() {
                event.params["history_work_completed_at"] = json!(time.saturating_mul(1000));
            }
        }
    }
    Ok(events)
}
fn defer_history_details(session: &Session, events: &mut [Event]) {
    for event in events {
        let item = &event.params["item"];
        if event.method != "item/completed"
            || matches!(
                item["type"].as_str(),
                Some("agentMessage" | "userMessage" | "reasoning")
            )
            || item.to_string().len() <= 8192
        {
            continue;
        }
        let mut summary = json!({});
        for field in ["id", "type", "status", "command", "server", "tool"] {
            if let Some(value) = item.get(field) {
                summary[field] = value.clone();
            }
        }
        summary["history_detail"] = if session.external && session.agent == "codex" {
            json!({"turn_id":event.params["history_turn_id"],"item_id":item["id"]})
        } else {
            json!({"seq":event.seq})
        };
        event.params["item"] = summary;
    }
}
fn compact_history(mut events: Vec<Event>, completed: &HashSet<String>) -> Vec<Event> {
    events.retain(|e| {
        if e.method == "item/completed" && e.params["item"]["type"] == "userMessage" {
            return false;
        }
        let item_id = e.params["itemId"]
            .as_str()
            .or_else(|| e.params["item"]["id"].as_str());
        !(e.request_id.is_none()
            && (e.method == "item/started"
                || e.method.contains("delta")
                || e.method.ends_with("Delta"))
            && item_id.is_some_and(|id| completed.contains(id)))
    });
    events
}
#[derive(serde::Deserialize)]
pub struct DetailQuery {
    seq: Option<i64>,
    turn_id: Option<String>,
    item_id: Option<String>,
}
pub async fn history_item(
    State(app): State<Arc<App>>,
    Path(id): Path<String>,
    Query(q): Query<DetailQuery>,
) -> Result<Json<Value>, ApiError> {
    let session = app.session(&id)?;
    if !session.external || session.agent != "codex" {
        let seq = q.seq.context("Missing history item sequence")?;
        let event = app
            .store
            .events(&id, seq.saturating_sub(1), 1)?
            .into_iter()
            .find(|e| e.seq == seq && e.method == "item/completed")
            .context("History item not found")?;
        if session.agent == crate::workbuddy::AGENT
            && event.params["item"]["nativeCallId"].is_string()
        {
            let runtime = app.runtimes.lock().await.get(&id).cloned();
            if event.params["persisted_history"] != true
                && let Some(rt) = runtime
            {
                return Ok(Json(rt.rpc.call("anywork/item/detail",json!({"threadId":session.thread_id,"turnId":event.params["turnId"],"item":event.params["item"]})).await?));
            }
        }
        return Ok(Json(json!({"item":event.params["item"]})));
    }
    if session.agent != "codex" {
        return Err(anyhow::anyhow!(
            "Use the stored history event identity for shared-host details"
        )
        .into());
    }
    let turn_id = q.turn_id.context("Missing history turn id")?;
    let item_id = q.item_id.context("Missing history item id")?;
    #[cfg(unix)]
    {
        let runtime = app.runtimes.lock().await.get(&id).cloned();
        if let Some(runtime) = runtime.filter(|runtime| runtime.desktop) {
            let (turns, _) = desktop_turns(&app, &session, &runtime).await?;
            let item = turns
                .iter()
                .filter(|turn| turn["id"] == turn_id)
                .flat_map(|turn| turn["items"].as_array().into_iter().flatten())
                .find(|item| item["id"] == item_id)
                .context("History item not found")?;
            return Ok(Json(json!({"item":item})));
        }
    }
    let rpc = app.catalog.lock().await.rpc(&app).await?;
    let turns = history(
        &rpc,
        session
            .thread_id
            .as_deref()
            .context("Missing Codex thread")?,
    )
    .await?;
    let item = turns
        .iter()
        .filter(|t| t["id"] == turn_id)
        .flat_map(|t| t["items"].as_array().into_iter().flatten())
        .find(|i| i["id"] == item_id)
        .context("History item not found")?;
    Ok(Json(json!({"item":item})))
}
#[derive(serde::Deserialize)]
pub struct HistoryQuery {
    #[serde(default)]
    paged: bool,
    cursor: Option<String>,
    limit: Option<usize>,
}

#[cfg(unix)]
async fn desktop_turns(
    app: &Arc<App>,
    session: &Session,
    rt: &crate::runtime::Runtime,
) -> Result<(Vec<Value>, Option<String>)> {
    let thread = session
        .thread_id
        .as_deref()
        .context("Missing Codex thread")?;
    let snapshot = rt
        .rpc
        .call("anywork/desktop-view", json!({"threadId":thread}))
        .await?;
    let live = snapshot["thread"]["turns"]
        .as_array()
        .context("Invalid desktop history view")?
        .clone();
    let persisted = async {
        let rpc = app.catalog.lock().await.rpc(app).await?;
        history(&rpc, thread).await
    }
    .await;
    let (persisted, error) = match persisted {
        Ok(turns) => (turns, None),
        Err(error) => (
            vec![],
            Some(format!(
                "当前显示桌面已加载的会话内容，较早历史暂时无法读取：{error}"
            )),
        ),
    };
    let notice = error.or_else(|| {
        (snapshot["history_complete"] != true)
            .then(|| "桌面尚未加载完整历史，当前内容包含已保存历史和桌面已加载的回合。".into())
    });
    Ok((
        crate::desktop_state::merge_native_history(persisted, live),
        notice,
    ))
}

#[cfg(unix)]
async fn read_desktop_history(
    app: &Arc<App>,
    session: &Session,
    rt: &crate::runtime::Runtime,
    query: &HistoryQuery,
    limit: usize,
) -> Result<Value> {
    let (turns, notice) = desktop_turns(app, session, rt).await?;
    let end = query
        .cursor
        .as_deref()
        .map(|cursor| {
            let id = cursor
                .strip_prefix("desktop-before:")
                .context("Invalid desktop history cursor")?;
            turns
                .iter()
                .position(|turn| turn["id"].as_str() == Some(id))
                .context("Desktop history changed; reload earlier messages")
        })
        .transpose()?
        .unwrap_or(turns.len());
    let start = if query.paged {
        end.saturating_sub(limit)
    } else {
        0
    };
    let selected = &turns[start..end];
    let mut events = history_events(session, selected, Some(&app.store))?;
    for event in &mut events {
        let turn = event.params["history_turn_id"]
            .as_str()
            .context("Missing desktop turn id")?;
        let item = event.params["history_item_id"]
            .as_str()
            .context("Missing desktop item id")?;
        event.params["history_id"] = json!(format!("{turn}:{item}"));
    }
    if query.paged {
        defer_history_details(session, &mut events);
    }
    let next = if start > 0 {
        Some(format!(
            "desktop-before:{}",
            turns[start]["id"]
                .as_str()
                .context("Missing desktop cursor id")?
        ))
    } else {
        None
    };
    let ids: Vec<_> = selected
        .iter()
        .filter_map(|turn| turn["id"].as_str())
        .collect();
    Ok(
        json!({"events":events,"next_cursor":next,"replace_turn_ids":ids,"history_notice":notice,"source":"desktop"}),
    )
}

pub async fn read_history(
    State(app): State<Arc<App>>,
    Path(id): Path<String>,
    Query(q): Query<HistoryQuery>,
) -> Result<Json<Value>, ApiError> {
    let s = app.session(&id)?;
    let mut persisted_notice = None;
    if crate::shared_host::is_shared(&s.agent) && !app.runtimes.lock().await.contains_key(&id) {
        let saved = !app.store.events(&id, 0, 1)?.is_empty();
        match crate::shared_host::read_persisted_history(&app, &s).await {
            Ok((true, notice)) => persisted_notice = notice,
            Ok((false, notice)) if saved => persisted_notice = notice,
            Ok((false, _)) if crate::claude::is_claude(&s.agent) => {
                persisted_notice = Some("Claude 原生历史尚未落盘；未启动执行进程".into());
            }
            Ok((false, _)) => {
                let gate = app.gate(&id).await;
                let _lock = gate.lock().await;
                app.ensure_runtime(&s).await?;
            }
            Err(error) if saved => {
                persisted_notice =
                    Some(format!("原生历史暂不可读取，已保留此前加载的记录：{error}"))
            }
            Err(error) => return Err(error.into()),
        }
    }
    let limit = q.limit.unwrap_or(5).clamp(1, 20);
    if !s.external || s.agent != "codex" {
        let before = q
            .cursor
            .as_deref()
            .map(str::parse::<i64>)
            .transpose()
            .context("Invalid history cursor")?
            .unwrap_or(i64::MAX);
        let (events, next_cursor) = app.store.history_page(&id, before, limit)?;
        let latest_seq = events.last().map(|e| e.seq).unwrap_or(0);
        let mut events = compact_history(events, &app.store.completed_item_ids(&id)?);
        defer_history_details(&s, &mut events);
        return Ok(Json(
            json!({"events":events,"next_cursor":next_cursor,"latest_seq":latest_seq,"history_notice":persisted_notice}),
        ));
    }
    #[cfg(unix)]
    if q.cursor
        .as_deref()
        .is_none_or(|cursor| cursor.starts_with("desktop-before:"))
    {
        let runtime = app.runtimes.lock().await.get(&id).cloned();
        if let Some(runtime) = runtime.filter(|runtime| runtime.desktop) {
            return Ok(Json(
                read_desktop_history(&app, &s, &runtime, &q, limit).await?,
            ));
        }
    }
    let rpc = app.catalog.lock().await.rpc(&app).await?;
    let thread = s.thread_id.as_deref().context("Missing Codex thread")?;
    if !q.paged {
        return Ok(Json(
            json!({"events":history_events(&s, &history(&rpc, thread).await?, Some(&app.store))?}),
        ));
    }
    if q.cursor.is_none() || q.cursor.as_deref().is_some_and(|c| c.starts_with("items:")) {
        let cursor = q.cursor.as_deref().and_then(|c| c.strip_prefix("items:"));
        match rpc
            .call(
                "thread/items/list",
                json!({"threadId":thread,"limit":limit * 8,"cursor":cursor,"sortDirection":"desc"}),
            )
            .await
        {
            Ok(page) => {
                let rows = page["data"].as_array().context("Invalid Codex items")?;
                let mut events = Vec::new();
                for row in rows.iter().rev() {
                    let turn_id = row["turnId"].as_str().context("Missing history turn id")?;
                    let item_id = row["item"]["id"]
                        .as_str()
                        .context("Missing history item id")?;
                    let turn = json!({"id":turn_id,"items":[row["item"].clone()]});
                    for mut event in history_events(&s, &[turn], Some(&app.store))? {
                        event.params["history_id"] = json!(format!("{turn_id}:{item_id}"));
                        event.params["history_turn_id"] = json!(turn_id);
                        if let Some(time) = row["startedAtMs"].as_i64() {
                            event.params["history_item_started_at_ms"] = json!(time);
                        }
                        if let Some(time) = row["completedAtMs"].as_i64() {
                            event.params["history_item_completed_at_ms"] = json!(time);
                        }
                        events.push(event);
                    }
                }
                defer_history_details(&s, &mut events);
                let next_cursor = page["nextCursor"].as_str().map(|c| format!("items:{c}"));
                return Ok(Json(json!({"events":events,"next_cursor":next_cursor})));
            }
            Err(e)
                if q.cursor.is_none()
                    && (e.to_string().contains("-32601")
                        || e.to_string().to_lowercase().contains("unsupported")
                        || e.to_string().contains("does not support")) => {}
            Err(e) => return Err(e.into()),
        }
    }
    let legacy = q
        .cursor
        .as_deref()
        .is_some_and(|c| c.starts_with("legacy:"));
    let page = if legacy {
        None
    } else {
        match rpc.call("thread/turns/list", json!({"threadId":thread,"limit":limit,"cursor":q.cursor.as_deref().and_then(|c| c.strip_prefix("turns:")),"sortDirection":"desc","itemsView":"full"})).await {
            Ok(page) => Some(page),
            Err(e) if q.cursor.is_none() && (e.to_string().contains("-32601") || e.to_string().contains("unsupported")) => None,
            Err(e) => return Err(e.into()),
        }
    };
    let (turns, next_cursor) = if let Some(page) = page {
        let mut turns = page["data"]
            .as_array()
            .context("Invalid Codex turns")?
            .clone();
        turns.reverse();
        (
            turns,
            page["nextCursor"]
                .as_str()
                .map(|c| json!(format!("turns:{c}")))
                .unwrap_or(Value::Null),
        )
    } else {
        // Compatibility for older Codex versions without turn pagination.
        let turns = history(&rpc, thread).await?;
        let end = q
            .cursor
            .as_deref()
            .map(|c| {
                c.strip_prefix("legacy:")
                    .context("Invalid history cursor")?
                    .parse::<usize>()
                    .context("Invalid history cursor")
            })
            .transpose()?
            .unwrap_or(turns.len())
            .min(turns.len());
        let start = end.saturating_sub(limit);
        (
            turns[start..end].to_vec(),
            if start > 0 {
                json!(format!("legacy:{start}"))
            } else {
                Value::Null
            },
        )
    };
    let mut events = Vec::new();
    let mut turn_ids = Vec::new();
    for turn in &turns {
        let turn_id = turn["id"].as_str().context("Missing history turn id")?;
        turn_ids.push(turn_id);
        for (index, mut event) in history_events(&s, std::slice::from_ref(turn), Some(&app.store))?
            .into_iter()
            .enumerate()
        {
            event.params["history_id"] = json!(format!("{turn_id}:{index}"));
            event.params["history_turn_id"] = json!(turn_id);
            events.push(event);
        }
    }
    defer_history_details(&s, &mut events);
    Ok(Json(
        json!({"events":events,"turn_ids":turn_ids,"next_cursor":next_cursor}),
    ))
}
pub async fn fork(
    State(app): State<Arc<App>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let source = app.session(&id)?;
    if source.agent != "codex" {
        return Err(anyhow::anyhow!("Fork requires a Codex session").into());
    }
    let rpc = app.catalog.lock().await.rpc(&app).await?;
    let mut options =
        remote_agent_codex::thread_options(&source.cwd, source.model.as_deref(), "manual");
    options["threadId"] = json!(source.thread_id.context("Missing Codex thread")?);
    let result = rpc.call("thread/fork", options).await?;
    let thread = result["thread"]["id"]
        .as_str()
        .context("Missing forked thread id")?;
    let s = Session {
        id: uuid::Uuid::new_v4().to_string(),
        thread_id: Some(thread.into()),
        title: format!("{} · 继续", source.title),
        cwd: source.cwd,
        agent: "codex".into(),
        model: source.model,
        policy: "manual".into(),
        status: "disconnected".into(),
        archived: false,
        created_at: now(),
        updated_at: now(),
        external: false,
        auxiliary: false,
    };
    let turns = history(&rpc, thread).await?;
    app.store.save(&s)?;
    for event in history_events(&s, &turns, Some(&app.store))? {
        app.store.event(&s.id, &event.method, event.params, None)?;
    }
    Ok(Json(json!({"session":s})))
}
pub async fn workspaces(State(app): State<Arc<App>>) -> Result<Json<Value>, ApiError> {
    {
        let mut catalog = app.catalog.lock().await;
        catalog.sync(&app).await;
    }
    let _ = crate::shared_host::sync(&app).await;
    let root = app.workspace.to_string_lossy().to_string();
    let mut counts = HashMap::<String, usize>::new();
    for session in app.store.sessions()? {
        if app
            .session_in_scope(
                &session.cwd,
                if session.external { &session.agent } else { "" },
            )
            .is_ok()
        {
            let count = counts.entry(session.cwd).or_default();
            if !session.archived && !session.auxiliary {
                *count += 1;
            }
        }
    }
    let mut workspaces = counts
        .into_iter()
        .map(|(path, count)| {
            let name = std::path::Path::new(&path)
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_else(|| path.clone());
            json!({"path":path,"name":name,"root":path==root,"sessions":count})
        })
        .collect::<Vec<_>>();
    workspaces.sort_by(|a, b| a["path"].as_str().cmp(&b["path"].as_str()));
    Ok(Json(json!({"workspaces":workspaces})))
}

pub async fn references_image(
    app: &App,
    session: &Session,
    path: &std::path::Path,
) -> Result<bool> {
    fn matches(value: &Value, path: &std::path::Path) -> bool {
        if matches!(value["type"].as_str(), Some("imageView" | "localImage"))
            && value["path"].as_str().is_some_and(|p| {
                std::path::Path::new(p)
                    .canonicalize()
                    .is_ok_and(|p| p == path)
            })
        {
            return true;
        }
        match value {
            Value::Array(values) => values.iter().any(|v| matches(v, path)),
            Value::Object(values) => values.values().any(|v| matches(v, path)),
            _ => false,
        }
    }
    references_in_history(app, session, |value| matches(value, path)).await
}

/// A document outside the workspace must be an exact path or Markdown file
/// link in this session's own history. Never grant access from a substring hit.
pub async fn references_document(
    app: &App,
    session: &Session,
    path: &std::path::Path,
) -> Result<bool> {
    fn same(candidate: &str, root: &std::path::Path, path: &std::path::Path) -> bool {
        let candidate = candidate.trim();
        let candidate = candidate
            .strip_prefix("file://localhost")
            .or_else(|| candidate.strip_prefix("file://"))
            .unwrap_or(candidate);
        if candidate.starts_with("//") || candidate.contains("://") {
            return false;
        }
        let mut decoded = Vec::new();
        let bytes = candidate.as_bytes();
        let mut at = 0;
        while at < bytes.len() {
            if bytes[at] == b'%'
                && at + 2 < bytes.len()
                && let Ok(hex) = std::str::from_utf8(&bytes[at + 1..at + 3])
                && let Ok(value) = u8::from_str_radix(hex, 16)
            {
                decoded.push(value);
                at += 3;
                continue;
            }
            decoded.push(bytes[at]);
            at += 1;
        }
        let Ok(candidate) = String::from_utf8(decoded) else {
            return false;
        };
        root.join(candidate).canonicalize().is_ok_and(|p| p == path)
    }
    fn matches(value: &Value, root: &std::path::Path, path: &std::path::Path) -> bool {
        match value {
            Value::String(text) => {
                if same(text, root, path) {
                    return true;
                }
                if let Some(candidate) = text.strip_prefix("Attached local file: ")
                    && same(candidate, root, path)
                {
                    return true;
                }
                text.split("](").skip(1).any(|rest| {
                    let candidate = if let Some(rest) = rest.strip_prefix('<') {
                        rest.split_once(">").map(|(candidate, _)| candidate)
                    } else {
                        let mut depth = 0;
                        let mut end = None;
                        for (i, c) in rest.char_indices() {
                            match c {
                                '(' => depth += 1,
                                ')' if depth == 0 => {
                                    end = Some(i);
                                    break;
                                }
                                ')' => depth -= 1,
                                _ => {}
                            }
                        }
                        end.map(|end| &rest[..end])
                    };
                    candidate.is_some_and(|candidate| same(candidate, root, path))
                })
            }
            Value::Array(values) => values.iter().any(|v| matches(v, root, path)),
            Value::Object(values) => values.values().any(|v| matches(v, root, path)),
            _ => false,
        }
    }
    let root = std::path::Path::new(&session.cwd);
    references_in_history(app, session, |value| matches(value, root, path)).await
}

async fn references_in_history(
    app: &App,
    session: &Session,
    matches: impl Fn(&Value) -> bool,
) -> Result<bool> {
    // Live self-managed turns may also call view_image outside the project.
    let mut after = 0;
    loop {
        let events = app.store.events(&session.id, after, 500)?;
        if events.is_empty() {
            break;
        }
        for event in events {
            after = event.seq;
            if matches(&event.params) {
                return Ok(true);
            }
        }
    }
    if !session.external || session.agent != "codex" {
        return Ok(false);
    }
    #[cfg(unix)]
    {
        let runtime = app.runtimes.lock().await.get(&session.id).cloned();
        if let Some(runtime) = runtime.filter(|runtime| runtime.desktop) {
            // The owner can reference an image/document before its rollout is
            // persisted. Admission still requires this exact thread's input or
            // output; attaching a host never grants general filesystem access.
            let snapshot = runtime
                .rpc
                .call(
                    "thread/read",
                    json!({"threadId":session.thread_id,"includeTurns":true}),
                )
                .await?;
            if matches(&snapshot["thread"]["turns"]) {
                return Ok(true);
            }
        }
    }
    let rpc = app.catalog.lock().await.rpc(app).await?;
    let turns = history(
        &rpc,
        session
            .thread_id
            .as_deref()
            .context("Missing Codex thread")?,
    )
    .await?;
    Ok(turns.iter().any(matches))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn history_retains_composer_only_for_exact_native_identity_without_replacing_display() {
        let root = std::env::current_dir().unwrap();
        let session = imported_session(
            &json!({"id":"thread","cwd":root,"source":"vscode"}),
            false,
            Some(&root),
            &HashSet::new(),
        )
        .unwrap();
        let store = crate::store::Store::open(std::path::Path::new(":memory:")).unwrap();
        store.save(&session).unwrap();
        let composer = json!({"markdown":"\\*\\*literal\\*\\*","document":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"**literal**"}]}]}});
        store
            .save_composer_metadata(&session.id, "client", &composer)
            .unwrap();
        let content = json!([{"type":"text","text":"context ## My request: **literal**"}]);
        let turns = json!([{"id":"turn","items":[
            {"id":"first","type":"userMessage","clientId":"client","content":content},
            {"id":"same-text","type":"userMessage","clientId":"different","content":content},
            {"id":"client","type":"userMessage","content":content},
            {"id":"assistant","type":"agentMessage","clientId":"client","text":"answer"}
        ]}]);
        let before = turns.clone();
        let events = history_events(&session, turns.as_array().unwrap(), Some(&store)).unwrap();
        assert_eq!(events[0].params["composer"], composer);
        assert_eq!(events[0].params["display_text"], "**literal**");
        assert_eq!(events[0].params["text"], content[0]["text"]);
        assert_eq!(events[0].params["history_item_id"], "first");
        assert_eq!(events[0].params["history_turn_id"], "turn");
        assert!(
            events[1..]
                .iter()
                .all(|event| event.params.get("composer").is_none())
        );
        assert_eq!(turns, before);
        let page = history_events(
            &session,
            &[json!({"id":"turn","items":[before[0]["items"][0]]})],
            Some(&store),
        )
        .unwrap();
        assert_eq!(page[0].params["composer"], events[0].params["composer"]);
        assert_eq!(page[0].params["history_item_id"], "first");
    }
    #[test]
    fn external_runtime_states_are_not_guessed_from_not_loaded() {
        assert_eq!(
            external_status(&json!({"type":"active","activeFlags":[]})),
            "running"
        );
        assert_eq!(
            external_status(&json!({"type":"active","activeFlags":["waitingOnApproval"]})),
            "waiting"
        );
        assert_eq!(
            external_status(&json!({"type":"active","activeFlags":["waitingOnUserInput"]})),
            "waiting"
        );
        assert_eq!(external_status(&json!({"type":"idle"})), "idle");
        assert_eq!(external_status(&json!({"type":"notLoaded"})), "external");
        assert_eq!(external_status(&Value::Null), "external");
    }
    #[test]
    fn imports_respect_scope_and_deduplicate_managed_threads() {
        let root = std::env::current_dir().unwrap();
        let t = json!({"id":"thread","cwd":root,"name":"桌面会话","source":"vscode"});
        let s = imported_session(&t, false, Some(&root), &HashSet::new()).unwrap();
        assert!(s.external);
        assert!(!s.auxiliary);
        let mut internal = t.clone();
        internal["source"] = json!({"subAgent":{"other":"guardian"}});
        assert!(imported_session(&internal, false, Some(&root), &HashSet::new()).is_none());
        assert_eq!(s.title, "桌面会话");
        assert!(
            imported_session(&t, false, Some(&root), &HashSet::from(["thread".into()])).is_none()
        );
        assert!(
            imported_session(
                &json!({"cwd":"/","id":"outside"}),
                false,
                Some(&root),
                &HashSet::new()
            )
            .is_none()
        );
        let e = history_events(
            &s,
            &[
                json!({"items":[{"id":"u","type":"userMessage","content":[{"type":"text","text":"你好"}]},{"id":"a","type":"agentMessage","text":"你好！"}]}),
            ],
            None,
        ).unwrap();
        assert_eq!(e[0].method, "user/message");
        assert_eq!(e[0].params["display_text"], "你好");
        assert_eq!(e[1].params["item"]["text"], "你好！");
        let raw = "context ## My request: final body";
        let content = json!([
            {"type":"text","text":raw},
            {"type":"mention","name":"source","path":"app://source","text":"raw metadata stays present"}
        ]);
        let before = content.clone();
        let projected = history_events(
            &s,
            &[json!({"id":"turn","items":[{"id":"user","type":"userMessage","content":content}]})],
            None,
        )
        .unwrap();
        assert_eq!(
            projected[0].params["text"],
            format!("{raw}\nraw metadata stays present")
        );
        assert_eq!(projected[0].params["display_text"], "final body");
        assert_eq!(content, before);
    }
}
