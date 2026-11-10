use crate::{
    ApiError, App, files,
    store::{Session, now},
};
use anyhow::{Context, Result};
use axum::{
    Json,
    extract::{Path, Query, State},
    response::sse::{Event as SseEvent, KeepAlive, Sse},
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{path::PathBuf, sync::Arc};

pub async fn info(State(app): State<Arc<App>>) -> Json<Value> {
    Json(
        json!({"capability_projection_v1":true,"client_presence":true,"local_service_control":true,"local_browser_session":true,"product":"AnyWork","version":env!("CARGO_PKG_VERSION"),"workspace":app.workspace,"agent_scope":if app.agent_scope == crate::CodexScope::All { "all" } else { "workspace" },"codex_scope":if app.codex_scope == crate::CodexScope::All { "all" } else { "workspace" },"hostname":std::env::var("ANYWORK_HOSTNAME").or_else(|_|std::env::var("REMOTE_AGENT_HOSTNAME")).or_else(|_|std::env::var("HOSTNAME")).unwrap_or_else(|_|"Local machine".into())}),
    )
}
pub async fn plugins(State(app): State<Arc<App>>) -> Json<Value> {
    let mut plugins: Vec<_> = app.plugins.values().collect();
    plugins.sort_by(|a, b| a.id.cmp(&b.id));
    Json(json!({"plugins": plugins.into_iter().map(|p| {
        let available = crate::shared_host::available(&app, &p.id);
        let setup_hint = match (p.id.as_str(), available) {
            (crate::harness::AGENT, false) => Some("DeepSeek Harness 插件已启用。请在本机启动 Harness 并启用 discovery 配套插件，然后点击“重新检查连接”。"),
            (crate::workbuddy::AGENT, false) => Some("WorkBuddy 插件已启用。请通过 AnyWork 的 WorkBuddy 引导程序启动桌面应用，然后点击“重新检查连接”。"),
            _ => None,
        };
        json!({"id":p.id,"name":p.name,"capabilities":p.capabilities,
            "protocol_version":p.protocol_version,"available":available,"setup_hint":setup_hint,
            "capability_projection":crate::capabilities::catalog(p, available)})
    }).collect::<Vec<_>>()}))
}
/// Read stored state only: an update check must not start discovery or attach engines.
pub async fn update_readiness(State(app): State<Arc<App>>) -> Result<Json<Value>, ApiError> {
    let busy = app
        .store
        .sessions()?
        .iter()
        .filter(|session| {
            !session.external
                && ["running", "starting", "waiting"].contains(&session.status.as_str())
        })
        .count();
    Ok(Json(json!({"busy_sessions": busy})))
}
/// Explicit desktop control only; automatic app cleanup never calls this endpoint.
pub async fn stop_service(
    State(app): State<Arc<App>>,
    axum::extract::ConnectInfo(peer): axum::extract::ConnectInfo<std::net::SocketAddr>,
    headers: axum::http::HeaderMap,
) -> axum::response::Response {
    use axum::{http::StatusCode, response::IntoResponse};
    if !local_service_control_allowed(peer, &headers) {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({"error":"服务启停仅允许本机桌面直接操作。"})),
        )
            .into_response();
    }
    match app.store.sessions() {
        Ok(sessions)
            if sessions.iter().any(|s| {
                !s.external && ["running", "starting", "waiting"].contains(&s.status.as_str())
            }) =>
        {
            return (StatusCode::CONFLICT, Json(json!({"error":"仍有本服务管理的会话正在执行或等待确认，请任务结束后再停止服务。"}))).into_response();
        }
        Err(_) => {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({"error":"无法确认会话状态，请稍后再停止服务。"})),
            )
                .into_response();
        }
        _ => {}
    }
    app.stopping
        .store(true, std::sync::atomic::Ordering::Relaxed);
    app.stop_requested.notify_one();
    Json(json!({"stopping":true})).into_response()
}
fn local_service_control_allowed(
    peer: std::net::SocketAddr,
    headers: &axum::http::HeaderMap,
) -> bool {
    peer.ip().is_loopback()
        && headers
            .get("x-anywork-service-control")
            .and_then(|v| v.to_str().ok())
            == Some("desktop")
        && ![
            "forwarded",
            "x-forwarded-for",
            "x-forwarded-host",
            "x-forwarded-proto",
            "cf-connecting-ip",
            "x-real-ip",
            "origin",
        ]
        .iter()
        .any(|name| headers.contains_key(*name))
}
pub async fn sessions(State(app): State<Arc<App>>) -> Result<Json<Value>, ApiError> {
    let mut catalog = app.catalog.lock().await;
    catalog.sync(&app).await;
    let mut discovery_error = catalog.error.clone();
    drop(catalog);
    let errors = crate::shared_host::sync(&app).await;
    if !errors.is_empty() {
        discovery_error = Some(
            discovery_error
                .into_iter()
                .chain(errors)
                .collect::<Vec<_>>()
                .join("；"),
        );
    }
    let mut sessions = app.store.sessions()?;
    sessions.retain(|s| {
        app.session_in_scope(&s.cwd, if s.external { &s.agent } else { "" })
            .is_ok()
    });
    #[cfg(unix)]
    {
        let runtimes = app.runtimes.lock().await;
        let statuses = app.desktop_statuses.lock().await;
        for session in &mut sessions {
            if session.external
                && session.agent == "codex"
                && !runtimes.contains_key(&session.id)
                && let Some(status) = statuses.get(&session.id)
            {
                session.status = status.into();
            }
        }
    }
    Ok(Json(
        json!({"sessions":sessions,"discovery_error":discovery_error}),
    ))
}
pub async fn session(
    State(app): State<Arc<App>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let session = app.session(&id)?;
    let session = if session.external && session.agent == "codex" {
        app.catalog
            .lock()
            .await
            .refresh_status(&app, &session)
            .await?
    } else {
        session
    };
    Ok(Json(json!({"session":session})))
}
#[derive(Deserialize)]
pub struct Create {
    cwd: String,
    agent: Option<String>,
    model: Option<String>,
    title: Option<String>,
    policy: Option<String>,
}
pub async fn create(
    State(app): State<Arc<App>>,
    Json(body): Json<Create>,
) -> Result<Json<Value>, ApiError> {
    let cwd = files::within(&app.workspace, &app.workspace.join(body.cwd))?;
    if !cwd.is_dir() {
        return Err(anyhow::anyhow!("Workspace must be a directory").into());
    }
    let agent = body.agent.unwrap_or_else(|| "codex".into());
    if !app.plugins.contains_key(&agent) {
        return Err(anyhow::anyhow!("Plugin is not installed").into());
    }
    if crate::shared_host::is_shared(&agent) {
        let session = crate::shared_host::create(
            &app,
            &agent,
            &cwd.to_string_lossy(),
            body.title,
            body.model,
        )
        .await?;
        return Ok(Json(json!({"session": session})));
    }
    let policy = body.policy.unwrap_or_else(|| "manual".into());
    validate_policy(&policy)?;
    let s = Session {
        id: uuid::Uuid::new_v4().to_string(),
        thread_id: None,
        title: body
            .title
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| "新会话".into()),
        cwd: cwd.to_string_lossy().into(),
        agent,
        model: body.model.filter(|s| !s.is_empty()),
        policy,
        status: "starting".into(),
        archived: false,
        created_at: now(),
        updated_at: now(),
        external: false,
        auxiliary: false,
    };
    app.store.save(&s)?;
    if let Err(e) = app.ensure_runtime(&s).await {
        let _ = app.store.update(&s.id, |s| s.status = "error".into());
        app.emit(&s.id, "error", json!({"message":e.to_string()}), None);
    }
    Ok(Json(json!({"session":app.store.session(&s.id)?})))
}
fn validate_policy(s: &str) -> Result<()> {
    anyhow::ensure!(["manual", "auto"].contains(&s), "Invalid approval policy");
    Ok(())
}
#[derive(Deserialize)]
pub struct Update {
    title: Option<String>,
    archived: Option<bool>,
    policy: Option<String>,
    model: Option<String>,
}
pub async fn update(
    State(app): State<Arc<App>>,
    Path(id): Path<String>,
    Json(body): Json<Update>,
) -> Result<Json<Value>, ApiError> {
    let gate = app.gate(&id).await;
    let _lock = gate.lock().await;
    let current = app.session(&id)?;
    if current.external {
        return Err(
            anyhow::anyhow!("此会话由外部 Agent 管理，请在原客户端管理名称、归档和配置。").into(),
        );
    }
    if body.model.is_some() && ["running", "waiting", "starting"].contains(&current.status.as_str())
    {
        return Err(anyhow::anyhow!("Agent is busy; change models after this turn").into());
    }
    if body.model.as_ref().is_some_and(|m| m.trim().is_empty()) {
        return Err(anyhow::anyhow!("Model cannot be empty").into());
    }
    if let Some(policy) = &body.policy {
        validate_policy(policy)?;
    }
    let s = app.store.update(&id, |s| {
        if let Some(t) = body.title {
            s.title = t;
        }
        if let Some(a) = body.archived {
            s.archived = a;
        }
        if let Some(p) = body.policy {
            s.policy = p;
        }
        if let Some(model) = body.model {
            s.model = Some(model);
        }
    })?;
    app.changed.notify_waiters();
    Ok(Json(json!({"session":s})))
}
pub async fn remove(
    State(app): State<Arc<App>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let gate = app.gate(&id).await;
    let _lock = gate.lock().await;
    if app.session(&id)?.external {
        return Err(
            anyhow::anyhow!("此会话由外部 Agent 管理，请在原客户端管理名称、归档和配置。").into(),
        );
    }
    if let Some(rt) = app.runtimes.lock().await.remove(&id) {
        rt.rpc.close().await;
    }
    app.store.delete(&id)?;
    let _ = tokio::fs::remove_dir_all(app.data_dir.join("uploads").join(&id)).await;
    app.changed.notify_waiters();
    Ok(Json(json!({"ok":true})))
}
#[derive(Clone, serde::Serialize, Deserialize)]
pub struct ComposerDocument {
    markdown: String,
    document: Value,
}
#[derive(Clone, serde::Serialize, Deserialize)]
pub struct Message {
    text: String,
    #[serde(default)]
    attachments: Vec<String>,
    #[serde(default)]
    mode: Option<String>,
    #[serde(default)]
    queue_if_busy: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    composer: Option<ComposerDocument>,
    #[serde(default)]
    goal: bool,
}
pub async fn message(
    State(app): State<Arc<App>>,
    Path(id): Path<String>,
    Json(mut body): Json<Message>,
) -> Result<Json<Value>, ApiError> {
    let gate = app.gate(&id).await;
    let _lock = gate.lock().await;
    let enqueue = if body.queue_if_busy {
        let session = app.session(&id)?;
        if session.archived {
            return Err(anyhow::anyhow!("Unarchive this session before sending a message").into());
        }
        validate_message(&app, &id, &body)?;
        let runtime = app.ensure_runtime(&session).await?;
        if session.external {
            crate::runtime::active_turn(
                &runtime,
                session
                    .thread_id
                    .as_deref()
                    .context("Missing Codex thread")?,
            )
            .await?
            .is_some()
        } else {
            ["running", "waiting", "starting"].contains(&app.session(&id)?.status.as_str())
        }
    } else {
        body.mode.as_deref() == Some("queue")
    };
    if enqueue {
        let session = app.session(&id)?;
        if session.archived {
            return Err(anyhow::anyhow!("Unarchive this session before sending a message").into());
        }
        validate_message(&app, &id, &body)?;
        let runtime = app.ensure_runtime(&session).await?;
        if body.goal {
            crate::composer::require_goal_control(&runtime, false)?;
        }
        app.store.enqueue(
            &id,
            json!({"text":body.text,"attachments":body.attachments,"composer":body.composer,"goal":body.goal,"status":"pending"}),
        )?;
        app.changed.notify_waiters();
        let mut result = app.store.queue(&id)?;
        result["queued"] = json!(true);
        return Ok(Json(result));
    }
    if body.queue_if_busy {
        body.mode = Some("steer".into());
    }
    deliver(&app, &id, body).await
}
fn validate_message(app: &App, id: &str, body: &Message) -> Result<()> {
    anyhow::ensure!(
        !body.text.trim().is_empty() || !body.attachments.is_empty(),
        "Message is empty"
    );
    if let Some(composer) = &body.composer {
        anyhow::ensure!(
            composer.document["type"] == "doc" && composer.document["content"].is_array(),
            "Invalid composer document"
        );
    }
    let session = app.session(id)?;
    anyhow::ensure!(
        !(session.agent == crate::workbuddy::AGENT && session.auxiliary),
        "WorkBuddy child conversations are read-only"
    );
    anyhow::ensure!(
        !body.goal || !crate::shared_host::is_shared(&session.agent),
        "当前 Agent 不支持目标控制，未发送消息"
    );
    for path in &body.attachments {
        attachment_path(app, &session, path)?;
    }
    Ok(())
}
// Uploaded files remain session-scoped; remote files must be inside this
// session's actual cwd. Canonicalization enforces the same symlink boundary.
fn attachment_path(app: &App, session: &Session, path: &str) -> Result<PathBuf> {
    let root = PathBuf::from(&session.cwd);
    let path = root.join(path).canonicalize()?;
    let uploads = app.data_dir.join("uploads");
    let path = if uploads.exists() && path.starts_with(uploads.canonicalize()?) {
        files::within(&uploads.join(&session.id).canonicalize()?, &path)?
    } else {
        files::within(&root, &path)?
    };
    anyhow::ensure!(path.is_file(), "Attachment is not a file");
    Ok(path)
}
pub(crate) async fn deliver(
    app: &Arc<App>,
    id: &str,
    body: Message,
) -> Result<Json<Value>, ApiError> {
    if app.store.active_edit(id)?.is_some() {
        return Err(anyhow::anyhow!(
            "Message edit pending; resolve the saved edit before sending another message"
        )
        .into());
    }
    let s = app.session(id)?;
    if s.archived {
        return Err(anyhow::anyhow!("Unarchive this session before sending a message").into());
    }
    if !s.external
        && body.mode.as_deref() != Some("steer")
        && ["running", "waiting", "starting"].contains(&s.status.as_str())
    {
        return Err(anyhow::anyhow!("Agent is busy; interrupt or wait for completion").into());
    }
    validate_message(app, id, &body)?;
    let rt = app.ensure_runtime(&s).await?;
    if body.goal {
        if crate::shared_host::is_shared(&s.agent) {
            return Err(anyhow::anyhow!("当前 Agent 不支持目标控制，未发送消息").into());
        }
        crate::composer::require_goal_control(&rt, false)?;
    }
    if !s.external
        && ["running", "waiting", "starting"].contains(&s.status.as_str())
        && rt.turn.lock().await.is_none()
    {
        return Err(
            anyhow::anyhow!("Agent is busy; please wait until the active turn is ready").into(),
        );
    }
    // Prepare durable image references before submission. The native composer
    // sends /goal input first and activates persisted goal state only after the
    // engine accepts that input. A failed activation must never resend it.
    let materialized_goal = if body.goal {
        let attachments = body
            .attachments
            .iter()
            .map(|path| attachment_path(app, &s, path))
            .collect::<Result<Vec<_>>>()?;
        let objective = body.text.clone();
        Some(
            tokio::task::spawn_blocking(move || {
                crate::composer::goal_objective::materialize_message(
                    &crate::observer::codex_home()?,
                    &objective,
                    &attachments,
                )
            })
            .await??,
        )
    } else {
        None
    };
    let prompt = materialized_goal
        .as_ref()
        .map(|goal| format!("/goal {}", goal.objective));
    let prompt = prompt.as_deref().unwrap_or(&body.text);
    let first_text = if s.agent == "codex" {
        crate::user_text::serialize_text(prompt)
    } else {
        json!({"type":"text","text":prompt})
    };
    let mut input = vec![first_text];
    for path in &body.attachments {
        let path = attachment_path(app, &s, path)?;
        let image = path.extension().and_then(|e| e.to_str()).is_some_and(|e| {
            ["png", "jpg", "jpeg", "webp", "gif"].contains(&e.to_lowercase().as_str())
        });
        if image {
            input.push(json!({"type":"localImage","path":path}));
        } else if crate::shared_host::is_shared(&s.agent) {
            input.push(json!({"type":"localFile","path":path}));
        } else {
            input.push(
                json!({"type":"text","text":format!("Attached local file: {}",path.display())}),
            );
        }
    }
    // Native userMessage.clientId binds local editor metadata without guessing
    // from repeated text, arrival order, or a shared steer turn.
    let client_id = if let Some(composer) = &body.composer {
        let client_id = uuid::Uuid::new_v4().to_string();
        let mut metadata = serde_json::to_value(composer)?;
        if body.goal {
            metadata["goal_display_text"] = json!(body.text);
        }
        app.store
            .save_composer_metadata(id, &client_id, &metadata)?;
        Some(client_id)
    } else {
        None
    };
    let with_client_id = |mut params: Value| {
        if let Some(client_id) = &client_id {
            params["clientUserMessageId"] = json!(client_id);
        }
        params
    };
    // Keep the actual native first text for echo identity and edit matching.
    // The original composer Markdown can differ when a library mention is
    // serialized to its source URL; retain it separately for export/recovery.
    let mut echo = json!({
        "text":input[0]["text"],
        "display_text":if body.goal { body.text.clone() } else { crate::user_text::display_first_text(&input) },
        "attachments":body.attachments,
        "goal":body.goal,
    });
    if let Some(composer) = &body.composer {
        echo["composer"] = json!(composer);
    }
    if input[0]["text"].as_str() != Some(body.text.as_str()) {
        echo["submitted_text"] = json!(body.text);
    }
    if s.external || (body.mode.as_deref() == Some("steer") && rt.turn.lock().await.is_some()) {
        let thread = s.thread_id.as_deref().context("Missing Codex thread")?;
        let active = if s.external {
            crate::runtime::active_turn(&rt, thread).await?
        } else {
            rt.turn.lock().await.clone()
        };
        let result = if let Some(turn) = active {
            // A steer belongs to the running turn; it must not reset its review patch.
            echo["turnId"] = json!(turn);
            rt.rpc
                .call(
                    "turn/steer",
                    with_client_id(json!({"threadId":thread,"expectedTurnId":turn,"input":input})),
                )
                .await?
        } else {
            // Preserve the original client's model, approvals and permission settings.
            app.store.update(id, |s| s.status = "starting".into())?;
            rt.rpc
                .call(
                    "turn/start",
                    with_client_id(json!({"threadId":thread,"input":input})),
                )
                .await?
        };
        if !s.external {
            app.emit(id, "user/message", echo, None);
        }
        return Ok(Json(
            activate_message_goal(app, id, &rt, materialized_goal, result).await,
        ));
    }
    let s = app.store.update(id, |s| {
        s.status = "running".into();
        if s.title == "新会话" && !body.text.trim().is_empty() {
            s.title = body.text.chars().take(42).collect();
        }
    })?;
    app.emit(id, "user/message", echo, None);
    let mut params = json!({"threadId":s.thread_id,"input":input,"approvalPolicy":if s.policy=="auto"{"never"}else{"on-request"}});
    if let Some(model) = s.model {
        params["model"] = json!(model);
    }
    let result = rt.rpc.call("turn/start", with_client_id(params)).await;
    match result {
        Ok(result) => Ok(Json(
            activate_message_goal(app, id, &rt, materialized_goal, result).await,
        )),
        Err(e) => {
            let _ = app.store.update(id, |s| s.status = "error".into());
            app.emit(id, "error", json!({"message":e.to_string()}), None);
            Err(e.into())
        }
    }
}

async fn activate_message_goal(
    app: &Arc<App>,
    id: &str,
    rt: &crate::runtime::Runtime,
    goal: Option<crate::composer::goal_objective::Materialized>,
    mut accepted: Value,
) -> Value {
    let Some(goal) = goal else { return accepted };
    // Retain materialized files even on a lost activation response: the already
    // accepted input can reference them, and the native set may have committed.
    let result = async {
        let thread = app.session(id)?.thread_id.context("Missing Codex thread")?;
        rt.rpc.call("thread/goal/set", json!({"threadId":thread,"objective":goal.objective,"status":"active","origin":"user"})).await
    }.await;
    match result {
        Ok(result) => accepted["goal"] = result["goal"].clone(),
        Err(error) => {
            let warning = format!(
                "消息已发送，但启用目标未确认：{error}。请检查当前目标后再操作，无需重发消息。"
            );
            app.emit(
                id,
                "error",
                json!({"message":warning,"goal_activation_failed":true}),
                None,
            );
            accepted["goal_error"] = json!(warning);
        }
    }
    accepted
}
pub async fn interrupt(
    State(app): State<Arc<App>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let gate = app.gate(&id).await;
    let _lock = gate.lock().await;
    let s = app.session(&id)?;
    if s.agent == crate::workbuddy::AGENT && s.auxiliary {
        return Err(anyhow::anyhow!("WorkBuddy child conversations are read-only").into());
    }
    app.store.pause_queue(&id, true)?;
    let rt = if s.external {
        app.ensure_runtime(&s).await?
    } else {
        app.runtimes
            .lock()
            .await
            .get(&id)
            .cloned()
            .context("Session is not connected")?
    };
    let turn = if s.external {
        crate::runtime::active_turn(&rt, s.thread_id.as_deref().context("Missing Codex thread")?)
            .await?
    } else {
        rt.turn.lock().await.clone()
    }
    .context("No active turn")?;
    let result = rt
        .rpc
        .call(
            "turn/interrupt",
            json!({"threadId":s.thread_id,"turnId":turn}),
        )
        .await?;
    if s.external {
        // Interrupt acknowledgement precedes engine teardown. Keep this session's
        // operation gate until teardown settles so the next message is not cancelled.
        let thread = s.thread_id.as_deref().context("Missing Codex thread")?;
        tokio::time::timeout(std::time::Duration::from_secs(10), async {
            loop {
                let state = rt
                    .rpc
                    .call(
                        "thread/read",
                        json!({"threadId":thread,"includeTurns":false}),
                    )
                    .await?;
                if state["thread"]["status"]["type"] != "active" {
                    break;
                }
                if let Some(active) = crate::runtime::active_turn(&rt, thread).await?
                    && active != turn
                {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            }
            Ok::<(), anyhow::Error>(())
        })
        .await
        .context("停止请求已提交，原进程仍在结束任务，请稍后发送消息")??;
    }
    Ok(Json(result))
}
pub async fn connect(
    State(app): State<Arc<App>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let gate = app.gate(&id).await;
    let _lock = gate.lock().await;
    let session = app.session(&id)?;
    if session.archived {
        return Err(anyhow::anyhow!("Unarchive this session before connecting").into());
    }
    match app.ensure_runtime(&session).await {
        Ok(_) => Ok(Json(json!({"ok":true,"connected":true,"mode":"control"}))),
        Err(error) if session.external => {
            tracing::debug!(session_id = %id, %error, "External conversation is available as history");
            let owner_unavailable = error.is::<crate::control::OwnerUnavailable>();
            let reason = if owner_unavailable {
                "已加载会话历史。此会话仍由独立 Codex 进程执行，暂时无法连接原执行入口。可重试连接，输入内容已保留。"
            } else {
                "已加载会话历史，可继续查看消息。暂时无法连接此会话的执行进程。"
            };
            Ok(Json(
                json!({"ok":true,"connected":false,"mode":"history","reason":reason,"code":if owner_unavailable {"owner_unavailable"}else{"control_unavailable"}}),
            ))
        }
        Err(error) => Err(error.into()),
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Respond {
    request_id: Value,
    #[serde(default, deserialize_with = "present_response")]
    result: Option<Value>,
    #[serde(default, deserialize_with = "present_response")]
    accept: Option<Value>,
}
fn present_response<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<Value>, D::Error> {
    Value::deserialize(d).map(Some)
}
pub async fn respond(
    State(app): State<Arc<App>>,
    Path(id): Path<String>,
    body: Result<Json<Respond>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<Value>, ApiError> {
    let Json(body) =
        body.map_err(|error| anyhow::anyhow!("Invalid response body: {}", error.body_text()))?;
    let gate = app.gate(&id).await;
    let _lock = gate.lock().await;
    app.session(&id)?;
    let event = app.store.request(&id, &body.request_id)?;
    if body.result.is_some() == body.accept.is_some() {
        return Err(anyhow::anyhow!("Provide exactly one of result or accept").into());
    }
    let rt = app
        .runtimes
        .lock()
        .await
        .get(&id)
        .cloned()
        .context("Session is not connected")?;
    let result = if event.method.ends_with("/requestApproval") {
        match body.result {
            Some(result) => {
                remote_agent_codex::validate_approval_result(&event.method, &event.params, &result)
            }
            None => remote_agent_codex::approval_result(
                &event.method,
                &event.params,
                body.accept
                    .and_then(|value| value.as_bool())
                    .context("accept must be a boolean")?,
            ),
        }
        .map_err(anyhow::Error::msg)?
    } else {
        let result = body.result.context("Response result is required")?;
        if !result.is_object() {
            return Err(anyhow::anyhow!("Response result must be an object").into());
        }
        result
    };
    // Keep the response transition ahead of any concurrent turn completion.
    // Otherwise a fast completion can be overwritten back to "running".
    let _turn_state = rt.turn.lock().await;
    rt.rpc
        .send(json!({"id":body.request_id,"result":result}))
        .await?;
    if !rt.desktop {
        app.emit(
            &id,
            "serverRequest/resolved",
            json!({"requestId":body.request_id}),
            None,
        );
        app.store.update(&id, |s| {
            if s.status == "waiting" {
                s.status = "running".into();
            }
        })?;
    }
    Ok(Json(json!({"ok":true})))
}
#[derive(Deserialize)]
pub struct EventQuery {
    #[serde(default)]
    after: i64,
    #[serde(default)]
    controls: bool,
}
#[derive(Deserialize)]
pub struct AllEventsQuery {
    after: Option<i64>,
}
fn scoped_event_page(app: &App, after: i64) -> anyhow::Result<crate::store::ScopedEventPage> {
    app.store.scoped_events(after, 500, |session| {
        app.session_in_scope(
            &session.cwd,
            if session.external { &session.agent } else { "" },
        )
        .is_ok()
    })
}
pub async fn poll_all_events(
    State(app): State<Arc<App>>,
    Query(q): Query<AllEventsQuery>,
) -> Result<Json<Value>, ApiError> {
    // Omitting the cursor establishes a watermark without replaying all chats.
    let page = match q.after {
        Some(after) => scoped_event_page(&app, after)?,
        None => crate::store::ScopedEventPage {
            events: vec![],
            cursor: app.store.event_cursor()?,
            has_more: false,
        },
    };
    Ok(Json(
        json!({"events":page.events,"cursor":page.cursor,"has_more":page.has_more}),
    ))
}
pub async fn all_events(
    State(app): State<Arc<App>>,
    Query(q): Query<AllEventsQuery>,
) -> Result<
    Sse<impl futures_util::Stream<Item = std::result::Result<SseEvent, std::convert::Infallible>>>,
    ApiError,
> {
    let after = q.after.unwrap_or(app.store.event_cursor()?);
    if after < 0 {
        return Err(anyhow::anyhow!("Event cursor must be non-negative").into());
    }
    let stream = async_stream::stream! {
        let mut cursor = after;
        loop {
            if app.stopping.load(std::sync::atomic::Ordering::Relaxed) { break; }
            let notified = app.changed.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            match scoped_event_page(&app, cursor) {
                Ok(page) => {
                    let visible_cursor = page.events.last().map(|event| event.seq).unwrap_or(cursor);
                    for event in page.events {
                        yield Ok(SseEvent::default().id(event.seq.to_string()).json_data(event).unwrap());
                    }
                    if page.cursor > visible_cursor {
                        // No data field: older fetch parsers cannot mistake a
                        // cursor checkpoint for a real AgentEvent.
                        yield Ok(SseEvent::default().event("cursor").id(page.cursor.to_string()));
                    }
                    cursor = page.cursor;
                    if page.has_more { continue; }
                }
                Err(error) => { tracing::error!("Reading scoped event stream: {error}"); break; }
            }
            tokio::select! {
                _ = notified => {},
                _ = tokio::time::sleep(std::time::Duration::from_secs(15)) => {},
            }
        }
    };
    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
}
pub async fn poll_events(
    State(app): State<Arc<App>>,
    Path(id): Path<String>,
    Query(q): Query<EventQuery>,
) -> Result<Json<Value>, ApiError> {
    app.session(&id)?;
    let events = if q.controls {
        app.store.control_events(&id, q.after, 500)?
    } else {
        app.store.events(&id, q.after, 500)?
    };
    Ok(Json(json!({"events":events})))
}
pub async fn events(
    State(app): State<Arc<App>>,
    Path(id): Path<String>,
    Query(q): Query<EventQuery>,
) -> Result<
    Sse<impl futures_util::Stream<Item = std::result::Result<SseEvent, std::convert::Infallible>>>,
    ApiError,
> {
    app.session(&id)?;
    let stream = async_stream::stream! {let mut cursor=q.after;loop{
        if app.stopping.load(std::sync::atomic::Ordering::Relaxed){break;}
        let notified=app.changed.notified();tokio::pin!(notified);notified.as_mut().enable();
        match app.store.events(&id,cursor,500){Ok(events) if !events.is_empty()=>{for event in events{cursor=event.seq;yield Ok(SseEvent::default().id(cursor.to_string()).json_data(event).unwrap());}continue;},Err(_)=>break,_=>{}}
        if app.store.session(&id).is_err(){break;}
        tokio::select!{_=notified=>{},_=tokio::time::sleep(std::time::Duration::from_secs(15))=>{}}
    }};
    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
}
pub async fn export(
    State(app): State<Arc<App>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let s = app.session(&id)?;
    let mut events = vec![];
    let mut after = 0;
    loop {
        let page = app.store.events(&id, after, 5000)?;
        if page.is_empty() {
            break;
        }
        after = page.last().unwrap().seq;
        events.extend(page);
    }
    Ok(Json(
        json!({"session":s,"events":events,"feedback":app.store.feedback_list(&id)?}),
    ))
}
pub async fn models(
    State(app): State<Arc<App>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let s = app.session(&id)?;
    if crate::shared_host::is_shared(&s.agent) {
        let existing = app.runtimes.lock().await.get(&id).cloned();
        return if let Some(rt) = existing {
            Ok(Json(rt.rpc.call("model/list", json!({})).await?))
        } else {
            Ok(Json(
                json!({"data":[],"settings_available":false,"settings_error":"连接原生 Agent 后可选择模型；本地历史仍可查看"}),
            ))
        };
    }
    let gate = app.gate(&id).await;
    let _lock = gate.lock().await;
    if s.external && s.agent == "codex" {
        drop(_lock);
        return Ok(Json(
            app.catalog
                .lock()
                .await
                .query(&app, "model/list", json!({}))
                .await?,
        ));
    }
    let rt = app.ensure_runtime(&s).await?;
    drop(_lock);
    Ok(Json(rt.rpc.call("model/list", json!({})).await?))
}

#[derive(Deserialize)]
pub struct QueueAction {
    action: String,
    id: Option<i64>,
    text: Option<String>,
    paused: Option<bool>,
    attachments: Option<Vec<String>>,
    composer: Option<ComposerDocument>,
    goal: Option<bool>,
}
pub async fn queue_get(
    State(app): State<Arc<App>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    app.session(&id)?;
    Ok(Json(app.store.queue(&id)?))
}
pub async fn queue_action(
    State(app): State<Arc<App>>,
    Path(id): Path<String>,
    Json(body): Json<QueueAction>,
) -> Result<Json<Value>, ApiError> {
    let gate = app.gate(&id).await;
    let _lock = gate.lock().await;
    app.session(&id)?;
    if ["take", "restore", "replace"].contains(&body.action.as_str()) {
        let seq = body.id.context("Queue message id required")?;
        if body.action == "take" {
            app.store.queue_begin_edit(&id, seq)?;
        } else if body.action == "restore" {
            app.store.queue_restore_edit(&id, seq, None)?;
        } else {
            let queue = app.store.queue(&id)?;
            let mut item = queue["editing"].clone();
            if item["id"].as_i64() != Some(seq) {
                return Err(anyhow::anyhow!("Queue edit does not match").into());
            }
            item["text"] = json!(body.text.context("Text required")?);
            item["attachments"] = json!(body.attachments.context("Attachments required")?);
            item["composer"] = json!(body.composer);
            if let Some(goal) = body.goal {
                item["goal"] = json!(goal);
            }
            item["status"] = json!("pending");
            item["error"] = Value::Null;
            let message: Message = serde_json::from_value(item.clone())?;
            validate_message(&app, &id, &message)?;
            let session = app.session(&id)?;
            if session.archived {
                return Err(anyhow::anyhow!(
                    "Unarchive this session before submitting the edited queue message"
                )
                .into());
            }
            app.ensure_runtime(&session).await?;
            app.store.queue_restore_edit(&id, seq, Some(item))?;
        }
    } else if body.action == "pause" {
        let paused = body.paused.unwrap_or(true);
        if !paused {
            let session = app.session(&id)?;
            if session.archived {
                return Err(anyhow::anyhow!("Unarchive this session before resuming queue").into());
            }
            app.ensure_runtime(&session).await?;
        }
        app.store.pause_queue(&id, paused)?;
    } else {
        let queue = app.store.queue(&id)?;
        let item = queue["items"]
            .as_array()
            .unwrap()
            .iter()
            .find(|item| item["id"].as_i64() == body.id)
            .cloned()
            .context("Queue message not found")?;
        let seq = item["id"].as_i64().unwrap();
        match body.action.as_str() {
            "delete" => {
                if item["status"] == "sending" {
                    return Err(anyhow::anyhow!("Queue message is pending delivery").into());
                }
                app.store.queue_write(&id, seq, None)?;
            }
            "edit" => {
                if item["status"] != "pending" {
                    return Err(anyhow::anyhow!("Only pending queue messages can be edited").into());
                }
                let mut item = item;
                item["text"] = json!(body.text.context("Text required")?);
                item["composer"] = json!(body.composer);
                item["status"] = json!("pending");
                item["error"] = Value::Null;
                let message: Message = serde_json::from_value(item.clone())?;
                validate_message(&app, &id, &message)?;
                app.store.queue_write(&id, seq, Some(item))?;
            }
            "steer" => {
                if item["status"] != "pending" {
                    return Err(anyhow::anyhow!("Only pending queue messages can be sent; inspect the conversation before deleting an unconfirmed message").into());
                }
                send_queued(&app, &id, item, "steer").await?;
            }
            _ => return Err(anyhow::anyhow!("Unknown queue action").into()),
        }
    }
    Ok(Json(app.store.queue(&id)?))
}
async fn send_queued(
    app: &Arc<App>,
    id: &str,
    mut item: Value,
    mode: &str,
) -> Result<(), ApiError> {
    let seq = item["id"].as_i64().context("Missing queue id")?;
    item["status"] = json!("sending");
    app.store.queue_write(id, seq, Some(item.clone()))?;
    let mut message: Message = serde_json::from_value(item.clone())?;
    message.mode = Some(mode.into());
    match deliver(app, id, message).await {
        Ok(_) => app.store.queue_write(id, seq, None)?,
        Err(error) => {
            item["status"] = json!("uncertain");
            item["error"] = json!(format!("发送未确认，请检查对话后再操作：{}", error.0));
            app.store.queue_write(id, seq, Some(item))?;
            return Err(error);
        }
    }
    Ok(())
}
pub fn start_queue_worker(app: Arc<App>) {
    tokio::spawn(async move {
        loop {
            tokio::select! { _=app.shutdown.notified()=>break, _=tokio::time::sleep(std::time::Duration::from_secs(1))=>{} }
            if app.stopping.load(std::sync::atomic::Ordering::Relaxed) {
                break;
            }
            let sessions = app.store.sessions().unwrap_or_default();
            futures_util::future::join_all(sessions.into_iter().map(|s| {
                let app = app.clone();
                async move {
                    let gate = app.gate(&s.id).await;
                    let Ok(_lock) = gate.try_lock() else { return };
                    let Ok(s) = app.session(&s.id) else {
                        return;
                    };
                    let Ok(queue) = app.store.queue(&s.id) else {
                        return;
                    };
                    if queue["paused"] == true || s.archived {
                        return;
                    }
                    let Some(item) = queue["items"]
                        .as_array()
                        .and_then(|items| items.first())
                        .cloned()
                    else {
                        return;
                    };
                    if item["status"] != "pending" {
                        return;
                    }
                    // A restart must not silently reconnect and resume an interrupted managed turn.
                    let Some(rt) = app.runtimes.lock().await.get(&s.id).cloned() else {
                        return;
                    };
                    if s.external {
                        if s.status == "starting" || rt.turn.lock().await.is_some() {
                            return;
                        }
                        let Some(thread) = s.thread_id.as_deref() else {
                            return;
                        };
                        let Ok(state) = crate::runtime::session_state(&rt, thread).await else {
                            return;
                        };
                        if state["status"] != "idle" {
                            return;
                        }
                    } else if rt.turn.lock().await.is_some() || s.status != "idle" {
                        return;
                    }
                    let _ = send_queued(&app, &s.id, item, "auto").await;
                }
            }))
            .await;
        }
    });
}

#[cfg(test)]
mod service_control_tests {
    use super::*;
    #[test]
    fn service_control_requires_direct_local_desktop_requests() {
        let mut headers = axum::http::HeaderMap::new();
        assert!(!local_service_control_allowed(
            "127.0.0.1:80".parse().unwrap(),
            &headers
        ));
        headers.insert("x-anywork-service-control", "desktop".parse().unwrap());
        assert!(local_service_control_allowed(
            "127.0.0.1:80".parse().unwrap(),
            &headers
        ));
        assert!(local_service_control_allowed(
            "[::1]:80".parse().unwrap(),
            &headers
        ));
        assert!(!local_service_control_allowed(
            "192.0.2.10:80".parse().unwrap(),
            &headers
        ));
        for name in [
            "forwarded",
            "x-forwarded-for",
            "x-forwarded-host",
            "x-forwarded-proto",
            "cf-connecting-ip",
            "x-real-ip",
            "origin",
        ] {
            let mut forwarded = headers.clone();
            forwarded.insert(
                axum::http::HeaderName::from_static(name),
                "test".parse().unwrap(),
            );
            assert!(
                !local_service_control_allowed("127.0.0.1:80".parse().unwrap(), &forwarded),
                "{name}"
            );
        }
    }
}
