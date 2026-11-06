//! A durable, two-step edit of the original native thread. Conversation history
//! changes are not file-system undo operations. Unknown RPC outcomes are never
//! treated as safe permission to send the edited message again.
use crate::{App, runtime::Runtime, store::Session, user_text};
use anyhow::{Context, Result, anyhow, ensure};
use axum::{
    Json,
    extract::{Path, Query, State, rejection::JsonRejection},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    hash::{DefaultHasher, Hash, Hasher},
    sync::Arc,
};

pub struct EditError(StatusCode, String);
impl From<anyhow::Error> for EditError {
    fn from(error: anyhow::Error) -> Self {
        Self(StatusCode::BAD_REQUEST, error.to_string())
    }
}
impl IntoResponse for EditError {
    fn into_response(self) -> Response {
        (self.0, Json(json!({"error":self.1}))).into_response()
    }
}
fn conflict(message: impl Into<String>) -> EditError {
    EditError(StatusCode::CONFLICT, message.into())
}

#[derive(Deserialize)]
pub struct EditQuery {
    message_id: Option<String>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EditBody {
    message_id: String,
    text: String,
    expected_fingerprint: String,
    operation_id: String,
    #[serde(default)]
    retry: bool,
}

struct Target {
    turn_id: String,
    item_id: String,
    input: Vec<Value>,
    fingerprint: String,
    retained_tail: Option<String>,
    cutoff: Option<i64>,
    attachments: Vec<String>,
}

fn public_operation(operation: &Value) -> Value {
    let mut result = json!({});
    for field in [
        "id",
        "message_id",
        "text",
        "expected_fingerprint",
        "phase",
        "stage",
        "error",
        "turn_id",
    ] {
        if let Some(value) = operation.get(field) {
            result[field] = value.clone();
        }
    }
    result["retryable"] = json!(matches!(
        operation["phase"].as_str(),
        Some("prepared" | "reverted" | "failed")
    ));
    result["fingerprint"] = operation["expected_fingerprint"].clone();
    result["input_types"] = json!(
        operation["input"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|part| part["type"].clone())
            .collect::<Vec<_>>()
    );
    result["attachments"] = operation
        .get("attachments")
        .cloned()
        .unwrap_or_else(|| json!([]));
    result["input_summary"] = json!(
        operation["input"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|part| {
                let kind = part["type"].as_str()?;
                if kind == "text" {
                    return part["text"]
                        .as_str()?
                        .strip_prefix("Attached local file: ")
                        .map(|path| json!({"type":"file","label":path}));
                }
                let label = part["name"]
                    .as_str()
                    .or_else(|| part["path"].as_str())
                    .unwrap_or(kind);
                Some(json!({"type":kind,"label":label}))
            })
            .collect::<Vec<_>>()
    );
    result["attachment_count"] = json!(
        result["attachments"]
            .as_array()
            .map_or(0, Vec::len)
            .max(result["input_summary"].as_array().map_or(0, Vec::len))
    );
    result
}
fn response(operation: &Value) -> Json<Value> {
    Json(
        json!({"operation":public_operation(operation),"history_changed":operation["history_changed"]==true,"turn_id":operation["turn_id"]}),
    )
}

async fn native_state(rt: &Runtime, thread: &str) -> Result<Vec<Value>> {
    let result = rt
        .rpc
        .call(
            "thread/read",
            json!({"threadId":thread,"includeTurns":false}),
        )
        .await?;
    ensure!(
        result["thread"]["historyMode"] == "paginated",
        "This Codex thread does not support editing: persistent paginated history is required"
    );
    ensure!(
        result["thread"]["ephemeral"] != true,
        "Ephemeral conversations do not support editing"
    );
    ensure!(
        result["thread"]["status"]["type"] == "idle",
        "Agent is busy; wait for completion before editing"
    );
    let page = rt
        .rpc
        .call(
            "thread/turns/list",
            json!({"threadId":thread,"limit":2,"sortDirection":"desc","itemsView":"full"}),
        )
        .await?;
    let turns = page["data"]
        .as_array()
        .context("Invalid Codex turn history")?
        .clone();
    ensure!(
        !turns.iter().any(|turn| turn["status"] == "inProgress"),
        "Agent is busy; wait for completion before editing"
    );
    Ok(turns)
}

fn first_text(input: &[Value]) -> Option<&str> {
    input
        .iter()
        .find(|part| part["type"] == "text")
        .and_then(|part| part["text"].as_str())
}
fn edited_input(input: &[Value], text: &str) -> Result<Vec<Value>> {
    let mut input = input.to_vec();
    let first = input
        .iter()
        .position(|part| part["type"] == "text")
        .context("This message has no editable text input")?;
    // A hidden context prefix is not a user body or an attachment. Validate the
    // edited body and preserved input before rebuilding the original wrapper.
    ensure!(
        !user_text::trim(text).is_empty()
            || input.iter().enumerate().any(|(index, part)| index != first
                && (part["type"] != "text"
                    || part["text"]
                        .as_str()
                        .is_some_and(|text| !user_text::trim(text).is_empty()))),
        "Edited message has no text or preserved attachment input"
    );
    let part = &mut input[first];
    part["text"] = json!(user_text::rebuild(
        part["text"].as_str().context("Invalid native text input")?,
        text
    ));
    part["text_elements"] = json!([]);
    Ok(input)
}
fn user_input(turn: &Value) -> Result<(&Value, Vec<Value>)> {
    let items = turn["items"]
        .as_array()
        .context("Native input is unavailable")?;
    let users = items
        .iter()
        .filter(|item| item["type"] == "userMessage")
        .collect::<Vec<_>>();
    ensure!(
        users.len() == 1,
        "This turn contains additional user input; its exact original message cannot be edited safely"
    );
    let input = users[0]["content"]
        .as_array()
        .context("Native user input is unavailable")?
        .clone();
    ensure!(
        first_text(&input).is_some(),
        "This message has no editable text input"
    );
    Ok((users[0], input))
}

async fn target(
    app: &Arc<App>,
    session: &Session,
    rt: &Runtime,
    message_id: &str,
) -> Result<Target> {
    let thread = session
        .thread_id
        .as_deref()
        .context("Missing Codex thread")?;
    let turns = native_state(rt, thread).await?;
    let latest = turns.first().context("There is no user message to edit")?;
    let turn_id = latest["id"]
        .as_str()
        .context("Missing native turn id")?
        .to_owned();
    let (user, input) = user_input(latest)?;
    let item_id = user["id"]
        .as_str()
        .context("Missing native user item id")?
        .to_owned();
    let (cutoff, attachments) = if session.external {
        let index = latest["items"]
            .as_array()
            .unwrap()
            .iter()
            .position(|item| item["id"] == item_id)
            .unwrap();
        ensure!(
            message_id == format!("user-{turn_id}:{item_id}")
                || message_id == format!("user-{turn_id}:{index}"),
            "Only the latest user turn can be edited; refresh the conversation"
        );
        (
            None,
            input
                .iter()
                .filter(|part| part["type"] == "localImage")
                .filter_map(|part| part["path"].as_str().map(str::to_owned))
                .collect(),
        )
    } else {
        let event = app
            .store
            .latest_user_event(&session.id)?
            .context("Local user message is unavailable")?;
        let key = event.params["history_id"]
            .as_str()
            .map(str::to_owned)
            .unwrap_or_else(|| event.seq.to_string());
        ensure!(
            message_id == format!("user-{key}"),
            "Only the latest user turn can be edited; refresh the conversation"
        );
        let native_turn = if let Some(turn) = event.params["history_turn_id"]
            .as_str()
            .or_else(|| event.params["turnId"].as_str())
        {
            Some(turn.to_owned())
        } else {
            app.store
                .events(&session.id, event.seq, 5000)?
                .iter()
                .find(|event| event.method == "turn/started")
                .and_then(|event| event.params["turn"]["id"].as_str())
                .map(str::to_owned)
        };
        ensure!(
            native_turn.as_deref() == Some(turn_id.as_str()),
            "The local message does not match the latest native turn; refresh before editing"
        );
        ensure!(
            event.params["text"].as_str() == first_text(&input),
            "The original native input changed; refresh before editing"
        );
        (
            Some(event.seq),
            event.params["attachments"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|path| path.as_str().map(str::to_owned))
                .collect(),
        )
    };
    let retained_tail = turns
        .get(1)
        .and_then(|turn| turn["id"].as_str())
        .map(str::to_owned);
    // A revision token, not an authorization boundary. Every mutation also
    // rereads native history; do not expose images or original input in it.
    let canonical=json!({"thread":thread,"turn":turn_id,"item":item_id,"input":input,"retained_tail":retained_tail}).to_string();
    let mut revision = DefaultHasher::new();
    canonical.hash(&mut revision);
    let fingerprint = format!("native-edit-v1-{:016x}", revision.finish());
    Ok(Target {
        turn_id,
        item_id,
        input,
        fingerprint,
        retained_tail,
        cutoff,
        attachments,
    })
}

fn validate_session(app: &App, id: &str) -> Result<Session> {
    let session = app.session(id)?;
    ensure!(
        session.agent == "codex",
        "Editing requires a Codex conversation"
    );
    ensure!(
        !session.archived,
        "Unarchive this conversation before editing"
    );
    let queue = app.store.queue(id)?;
    ensure!(
        !queue["items"]
            .as_array()
            .into_iter()
            .flatten()
            .any(|item| item["status"] == "sending"),
        "A queued message is busy sending; wait before editing"
    );
    Ok(session)
}

pub async fn get(
    State(app): State<Arc<App>>,
    Path(id): Path<String>,
    Query(query): Query<EditQuery>,
) -> Result<Json<Value>, EditError> {
    let gate = app.gate(&id).await;
    let _lock = gate.lock().await;
    let session = validate_session(&app, &id)?;
    if query.message_id.is_none() {
        return Ok(Json(
            json!({"operation":app.store.unfinished_edit(&id)?.as_ref().map(public_operation)}),
        ));
    }
    if app.store.active_edit(&id)?.is_some() {
        return Err(conflict(
            "A saved message edit needs recovery before editing another message",
        ));
    }
    let rt = app.ensure_runtime(&session).await?;
    let message_id = query.message_id.unwrap();
    let target = target(&app, &session, &rt, &message_id)
        .await
        .map_err(|error| conflict(error.to_string()))?;
    // Match the same final display projection as history. Original native input
    // stays intact for target equality, fingerprints and edit reconstruction.
    let display_text = if session.external {
        user_text::display_input(&target.input)
    } else {
        user_text::display_first_text(&target.input)
    };
    Ok(Json(
        json!({"editable":true,"message_id":message_id,"turn_id":target.turn_id,"user_item_id":target.item_id,
        "text":user_text::trim(&display_text),"input_types":target.input.iter().map(|part|part["type"].clone()).collect::<Vec<_>>(),
        "fingerprint":target.fingerprint,"attachments":target.attachments,"limitations":["Conversation history changes; existing files are preserved","The native client has no compare-and-swap edit transaction"]}),
    ))
}

pub async fn post(
    State(app): State<Arc<App>>,
    Path(id): Path<String>,
    body: std::result::Result<Json<EditBody>, JsonRejection>,
) -> Result<Json<Value>, EditError> {
    let Json(body) = body.map_err(|error| EditError(StatusCode::BAD_REQUEST, error.body_text()))?;
    if uuid::Uuid::parse_str(&body.operation_id).is_err() {
        return Err(EditError(
            StatusCode::BAD_REQUEST,
            "operation_id must be a UUID".into(),
        ));
    }
    let gate = app.gate(&id).await;
    let lock = gate.lock_owned().await;
    let session = validate_session(&app, &id)?;
    let saved = app.store.edit_operation(&id, &body.operation_id)?;
    if let Some(operation) = &saved {
        if operation["message_id"] != body.message_id
            || operation["expected_fingerprint"] != body.expected_fingerprint
        {
            return Err(conflict("The saved operation does not match this edit"));
        }
        if !body.retry || matches!(operation["phase"].as_str(), Some("completed" | "cancelled")) {
            return Ok(response(operation));
        }
    }
    let rt = app.ensure_runtime(&session).await?;
    let mut operation = if let Some(operation) = saved {
        operation
    } else {
        if body.retry {
            return Err(conflict("The saved edit operation no longer exists"));
        }
        if app.store.active_edit(&id)?.is_some() {
            return Err(conflict("Another message edit is pending"));
        }
        let target = target(&app, &session, &rt, &body.message_id)
            .await
            .map_err(|error| conflict(error.to_string()))?;
        if target.fingerprint != body.expected_fingerprint {
            return Err(conflict("The conversation changed; refresh before editing"));
        }
        // Validate and construct the complete native input before changing history.
        let input = edited_input(&target.input, &body.text)?;
        for part in &input {
            if matches!(part["type"].as_str(), Some("localImage" | "localAudio"))
                && !part["path"]
                    .as_str()
                    .is_some_and(|path| std::path::Path::new(path).is_file())
            {
                return Err(EditError(
                    StatusCode::BAD_REQUEST,
                    "An original local attachment is no longer available; history was not changed"
                        .into(),
                ));
            }
        }
        json!({"id":body.operation_id,"message_id":body.message_id,"text":body.text,"expected_fingerprint":body.expected_fingerprint,
            "phase":"prepared","stage":"revert","thread_id":session.thread_id,"target_turn_id":target.turn_id,"attachments":target.attachments,
            "retained_tail":target.retained_tail,"cutoff":target.cutoff,"original_input":target.input,"input":input,"history_changed":false})
    };
    // Pause pending queue entries before the durable edit begins. They remain
    // paused after recovery so an old continuation cannot race the replacement.
    app.store.pause_queue(&id, true)?;
    if operation["phase"] == "reverted"
        || operation["phase"] == "failed"
        || operation["phase"] == "prepared"
    {
        operation["text"] = json!(body.text);
        operation["input"] = json!(edited_input(
            operation["original_input"]
                .as_array()
                .context("Missing saved input")?,
            &body.text
        )?);
    }
    app.store.save_edit(&id, &operation)?;
    // Detach mutation from HTTP cancellation: navigating away must not cancel
    // the state transition between the native RPC and the durable journal.
    let task_app = app.clone();
    let task_id = id.clone();
    let task_rt = rt.clone();
    let task = tokio::spawn(async move {
        let _lock = lock;
        execute(&task_app, &task_id, &session, &task_rt, operation).await
    });
    let operation = task
        .await
        .map_err(|error| anyhow!("Edit task interrupted: {error}"))??;
    Ok(response(&operation))
}

/// Abandon only the local recovery journal. Native history and files are never
/// changed by cancellation, including when the prior send result was unknown.
pub async fn cancel(
    State(app): State<Arc<App>>,
    Path((id, operation_id)): Path<(String, String)>,
) -> Result<Json<Value>, EditError> {
    let gate = app.gate(&id).await;
    let _lock = gate.lock().await;
    app.session(&id)?;
    if let Some(mut operation) = app.store.edit_operation(&id, &operation_id)? {
        if !matches!(operation["phase"].as_str(), Some("completed" | "cancelled")) {
            operation["phase"] = json!("cancelled");
            app.store.save_edit(&id, &operation)?;
        }
        app.changed.notify_waiters();
        return Ok(Json(
            json!({"ok":true,"operation":public_operation(&operation),"history_changed":operation["history_changed"]==true}),
        ));
    }
    Ok(Json(json!({"ok":true})))
}

fn save_phase(
    app: &App,
    id: &str,
    operation: &mut Value,
    phase: &str,
    stage: &str,
    error: Option<String>,
) -> Result<()> {
    operation["phase"] = json!(phase);
    operation["stage"] = json!(stage);
    operation["error"] = json!(error);
    app.store.save_edit(id, operation)
}
fn is_unknown(error: &anyhow::Error) -> bool {
    let text = error.to_string();
    text.contains("timed out")
        || text.contains("disconnected")
        || text.contains("exited")
        || text.contains("closed")
        || !text.starts_with('{')
}
fn tail_id(turns: &[Value]) -> Option<&str> {
    turns.first().and_then(|turn| turn["id"].as_str())
}
fn retained_matches(turns: &[Value], operation: &Value) -> bool {
    tail_id(turns) == operation["retained_tail"].as_str()
}
fn replacement_observed(turns: &[Value], operation: &Value) -> bool {
    turns
        .first()
        .and_then(|turn| user_input(turn).ok())
        .is_some_and(|(_, input)| json!(input) == operation["input"])
        && tail_id(turns) != operation["target_turn_id"].as_str()
}
fn commit_revert(app: &App, id: &str, operation: &mut Value) -> Result<()> {
    operation["phase"] = json!("reverted");
    operation["stage"] = json!("start");
    operation["history_changed"] = json!(true);
    operation["error"] = Value::Null;
    app.store
        .commit_edit_revert(id, operation, operation["cutoff"].as_i64())?;
    app.changed.notify_waiters();
    Ok(())
}

async fn execute(
    app: &Arc<App>,
    id: &str,
    session: &Session,
    rt: &Runtime,
    mut operation: Value,
) -> Result<Value> {
    let thread = operation["thread_id"]
        .as_str()
        .context("Missing saved thread")?
        .to_owned();
    let phase = operation["phase"].as_str().unwrap_or("").to_owned();
    if ["uncertain", "reverting", "starting"].contains(&phase.as_str()) {
        let turns = match native_state(rt, &thread).await {
            Ok(turns) => turns,
            Err(error) => {
                save_phase(
                    app,
                    id,
                    &mut operation,
                    "uncertain",
                    "reconcile",
                    Some(format!("Cannot confirm native history: {error}")),
                )?;
                return Ok(operation);
            }
        };
        if operation["history_changed"] == true || operation["stage"] == "start" {
            if replacement_observed(&turns, &operation) {
                operation["turn_id"] = turns[0]["id"].clone();
                save_phase(app, id, &mut operation, "completed", "start", None)?;
            } else {
                save_phase(app,id,&mut operation,"uncertain","start",Some("The previous send result is unknown. No message was resent; inspect the native conversation before recovery.".into()))?;
            }
            return Ok(operation);
        }
        if retained_matches(&turns, &operation) {
            commit_revert(app, id, &mut operation)?;
        } else if tail_id(&turns) != operation["target_turn_id"].as_str() {
            save_phase(app,id,&mut operation,"uncertain","revert",Some("Native history changed while the edit outcome was unknown; no further mutation was made".into()))?;
            return Ok(operation);
        } else {
            // An explicit retry can repeat the same beforeTurnId. It never
            // computes a rollback count against potentially changed history.
            operation["phase"] = json!("prepared");
        }
    }
    if operation["phase"] == "prepared" || operation["phase"] == "failed" {
        let current = target(
            app,
            session,
            rt,
            operation["message_id"].as_str().unwrap_or(""),
        )
        .await;
        match current {
            Ok(target)
                if target.fingerprint
                    == operation["expected_fingerprint"].as_str().unwrap_or("") => {}
            other => {
                let error = match other {
                    Ok(_) => "The native conversation changed before editing".into(),
                    Err(error) => error.to_string(),
                };
                save_phase(app, id, &mut operation, "failed", "revert", Some(error))?;
                return Ok(operation);
            }
        }
        save_phase(app, id, &mut operation, "reverting", "revert", None)?;
        match rt
            .rpc
            .call(
                "thread/revert",
                json!({"threadId":thread,"beforeTurnId":operation["target_turn_id"]}),
            )
            .await
        {
            Ok(_) => commit_revert(app, id, &mut operation)?,
            Err(error) => {
                let phase = if is_unknown(&error) {
                    "uncertain"
                } else {
                    "failed"
                };
                save_phase(
                    app,
                    id,
                    &mut operation,
                    phase,
                    "revert",
                    Some(error.to_string()),
                )?;
                return Ok(operation);
            }
        }
    }
    if operation["phase"] != "reverted" {
        return Ok(operation);
    }
    let turns = match native_state(rt, &thread).await {
        Ok(turns) => turns,
        Err(error) => {
            save_phase(
                app,
                id,
                &mut operation,
                "reverted",
                "start",
                Some(error.to_string()),
            )?;
            return Ok(operation);
        }
    };
    if !retained_matches(&turns, &operation) {
        save_phase(app,id,&mut operation,"uncertain","start",Some("The native conversation changed after history was reverted; the replacement was not sent".into()))?;
        return Ok(operation);
    }
    save_phase(app, id, &mut operation, "starting", "start", None)?;
    if !session.external {
        let input = operation["input"]
            .as_array()
            .context("Missing saved input")?;
        app.emit(id,"user/message",json!({"text":first_text(input),"display_text":user_text::display_first_text(input),"attachments":operation["attachments"],"edit_operation_id":operation["id"]}),None);
    }
    match rt.rpc.call("turn/start",json!({"threadId":thread,"input":operation["input"],"clientUserMessageId":operation["id"]})).await {
        Ok(result)=> {
            operation["turn_id"]=result["turn"]["id"].clone();
            save_phase(app,id,&mut operation,"completed","start",None)?;
        }
        Err(error)=> {
            let phase=if is_unknown(&error) {"uncertain"} else {"reverted"};
            save_phase(app,id,&mut operation,phase,"start",Some(error.to_string()))?;
            if phase=="reverted" && !session.external { app.store.remove_edit_echo(id,&operation)?; }
        }
    }
    app.changed.notify_waiters();
    Ok(operation)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn edits_only_first_text_and_preserves_native_input() {
        let original = vec![
            json!({"type":"text","text":"old","text_elements":[{"native":"span"}]}),
            json!({"type":"image","fileId":"file-1","detail":"high"}),
            json!({"type":"skill","name":"skill","path":"/skill"}),
            json!({"type":"mention","name":"file","path":"app://source"}),
            json!({"type":"text","text":"keep","text_elements":[1]}),
        ];
        let updated = edited_input(&original, "new").unwrap();
        assert_eq!(
            updated[0],
            json!({"type":"text","text":"new","text_elements":[]})
        );
        assert_eq!(updated[1..], original[1..]);
        assert_eq!(original[0]["text"], "old");
    }
    #[test]
    fn ambiguous_steer_history_is_not_editable() {
        assert!(user_input(&json!({"items":[{"type":"userMessage","content":[{"type":"text","text":"first"}]},{"type":"userMessage","content":[{"type":"text","text":"steer"}]}]})).is_err());
    }
    #[test]
    fn empty_text_requires_preserved_input() {
        assert!(edited_input(&[json!({"type":"text","text":"old"})], "  ").is_err());
        let image = vec![
            json!({"type":"text","text":"old"}),
            json!({"type":"image","url":"data:image/png;base64,fixture"}),
        ];
        assert_eq!(edited_input(&image, "").unwrap()[1], image[1]);
        let file = vec![
            json!({"type":"text","text":"old"}),
            json!({"type":"text","text":"Attached local file: /file.pdf"}),
        ];
        assert!(edited_input(&file, "").is_ok());
    }
    #[test]
    fn context_is_rebuilt_from_raw_input_but_does_not_count_as_edited_content() {
        let prefix =
            "<page-comment-context>\nopaque context\n</page-comment-context>\n## My request:\n";
        let input = vec![
            json!({"type":"text","text":format!("{prefix}old body"),"text_elements":[{"native":"span"}]}),
        ];
        assert!(edited_input(&input, " \n ").is_err());
        let edited = edited_input(&input, "new body ## My request: literal").unwrap();
        assert_eq!(
            edited[0]["text"],
            format!("{prefix}new body ## My request: literal\n")
        );
        assert_eq!(edited[0]["text_elements"], json!([]));
        assert_eq!(input[0]["text"], format!("{prefix}old body"));
    }
}
