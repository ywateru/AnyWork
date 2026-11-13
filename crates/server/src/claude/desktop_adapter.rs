//! Maps the original Desktop renderer carrier to the existing runtime ABI.
//! No subprocess, native writer takeover, CDP launch or input replay occurs here.
use super::{
    DESKTOP,
    desktop::{DesktopCarrier, DesktopClient},
    history, protocol,
};
use crate::{
    App,
    store::{Session, now},
};
use anyhow::{Context, Result, ensure};
use base64::Engine as _;
use remote_agent_sdk::{RpcBridge, RpcProcess};
use serde_json::{Value, json};
use std::{collections::HashMap, sync::Arc, time::Duration};
use tokio::sync::mpsc;

pub fn available() -> bool {
    super::desktop::available()
}
fn local_id(id: &str) -> bool {
    id.strip_prefix("local_")
        .is_some_and(|id| uuid::Uuid::parse_str(id).is_ok())
}
fn busy(row: &Value) -> bool {
    row["isRunning"] == true
        || row["turnRunning"] == true
        || row["cliBootPending"] == true
        || row["pendingToolPermissions"]
            .as_array()
            .is_some_and(|r| !r.is_empty())
}
async fn snapshot(carrier: &DesktopCarrier, id: &str) -> Result<Value> {
    ensure!(local_id(id), "Invalid local Desktop Code session identity");
    let row = carrier.invoke("getSession", json!([id])).await?;
    ensure!(
        row["sessionId"] == id,
        "Original Desktop Code session is unavailable; no replacement was started"
    );
    Ok(row)
}
pub async fn create(
    app: &Arc<App>,
    cwd: &str,
    title: Option<String>,
    model: Option<String>,
) -> Result<Session> {
    let carrier = DesktopClient::configured(None)?.connect().await?;
    let native = format!("local_{}", uuid::Uuid::new_v4());
    let mut info = json!({"sessionId":native,"cwd":cwd,"message":"","withoutFirstMessage":true,"permissionMode":"default"});
    if let Some(title) = title.as_ref().filter(|s| !s.trim().is_empty()) {
        info["title"] = json!(title);
    }
    if let Some(model) = &model {
        info["model"] = json!(model);
    }
    // start has an explicit withoutFirstMessage option. No empty inference is
    // used to manufacture a session. Unknown delivery must not retry start.
    carrier.invoke("start", json!([info])).await?;
    let row = snapshot(&carrier, &native).await?;
    let s = observation(app, &row, false)?;
    carrier.disconnect().await?;
    app.ensure_runtime(&s).await?;
    app.store.session(&s.id)
}
fn observation(app: &App, row: &Value, external: bool) -> Result<Session> {
    let native = row["sessionId"]
        .as_str()
        .context("Missing Desktop Code identity")?;
    ensure!(local_id(native), "Invalid Desktop Code identity");
    super::desktop_history::source(native)?;
    let cwd = row["cwd"]
        .as_str()
        .or_else(|| row["originCwd"].as_str())
        .context("Desktop Code has no local directory")?;
    app.session_in_scope(cwd, DESKTOP)?;
    let id = format!("{DESKTOP}-{native}");
    let old = app.store.session(&id).ok();
    let s = Session {
        id,
        thread_id: Some(native.into()),
        title: row["title"]
            .as_str()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or("Claude Desktop Code")
            .into(),
        cwd: cwd.into(),
        agent: DESKTOP.into(),
        model: row["model"].as_str().map(str::to_string),
        policy: old
            .as_ref()
            .map(|s| s.policy.clone())
            .unwrap_or_else(|| "manual".into()),
        status: if external {
            "external"
        } else if busy(row) {
            "running"
        } else {
            "idle"
        }
        .into(),
        archived: row["isArchived"] == true,
        created_at: row["createdAt"].as_i64().unwrap_or_else(now),
        updated_at: row["lastActivityAt"].as_i64().unwrap_or_else(now),
        external: old.as_ref().map_or(external, |s| s.external),
        auxiliary: false,
    };
    app.store.save_shared_observation(&s)?;
    Ok(s)
}
pub async fn sync(app: &Arc<App>) -> Result<()> {
    if !available() {
        return Ok(());
    }
    let carrier = DesktopClient::configured(None)?.connect().await?;
    let rows = carrier.invoke("getSessionList", json!([])).await?;
    for row in rows["sessions"]
        .as_array()
        .context("Invalid Desktop Code list")?
    {
        if let Some(native) = row["sessionId"].as_str()
            && app
                .runtimes
                .lock()
                .await
                .contains_key(&format!("{DESKTOP}-{native}"))
        {
            continue;
        }
        // A shared descriptor can list projects outside this service's scope.
        if let Some(cwd) = row["cwd"].as_str().or_else(|| row["originCwd"].as_str())
            && app.session_in_scope(cwd, DESKTOP).is_ok()
        {
            observation(app, row, true)?;
        }
    }
    carrier.disconnect().await
}
pub async fn attach(
    app: &Arc<App>,
    s: &Session,
) -> Result<(Arc<RpcProcess>, mpsc::UnboundedReceiver<Value>, bool)> {
    ensure!(
        s.policy == "manual",
        "Claude supports manual approvals only; switch this session policy to manual before connecting"
    );
    let carrier = DesktopClient::configured(None)?.connect().await?;
    let thread = s
        .thread_id
        .as_deref()
        .context("Missing Desktop Code identity")?;
    super::desktop_history::source(thread)?;
    let row = snapshot(&carrier, thread).await?;
    ensure!(
        row["cwd"].as_str().or_else(|| row["originCwd"].as_str()) == Some(s.cwd.as_str()),
        "Desktop Code working directory changed; refresh discovery"
    );
    let _ = hydrate(app, s, &carrier).await?;
    let (rpc, events, bridge) = RpcProcess::bridge();
    let actor = Adapter {
        carrier,
        thread: thread.into(),
        row,
        turn: None,
        permissions: HashMap::new(),
        blocks: HashMap::new(),
        offsets: HashMap::new(),
        tools: HashMap::new(),
        message: String::new(),
        generation: None,
        cursor: 0,
        interrupted: false,
        uncertain: false,
        clients: HashMap::new(),
        submission: None,
    };
    tokio::spawn(actor.run(bridge, app.clone(), s.clone()));
    Ok((rpc, events, false))
}
pub async fn read_history(app: &Arc<App>, s: &Session) -> Result<(bool, Option<String>)> {
    super::desktop_history::source(
        s.thread_id
            .as_deref()
            .context("Missing Desktop Code identity")?,
    )?;
    let carrier = DesktopClient::configured(None)?.connect().await?;
    let notice = hydrate(app, s, &carrier).await?;
    carrier.disconnect().await?;
    Ok((true, notice))
}
async fn hydrate(app: &App, s: &Session, carrier: &DesktopCarrier) -> Result<Option<String>> {
    let thread = s
        .thread_id
        .as_deref()
        .context("Missing Desktop Code identity")?;
    let mut page = carrier
        .invoke("getTranscriptTail", json!([thread, 500]))
        .await?;
    let mut rows = page["messages"]
        .as_array()
        .context("Invalid Desktop Code transcript")?
        .clone();
    let mut seen = std::collections::HashSet::new();
    let mut limited = false;
    while page["hasMore"] == true {
        let Some(before) = rows.first().and_then(|r| r["uuid"].as_str()) else {
            limited = true;
            break;
        };
        if !seen.insert(before.to_string()) || seen.len() > 40 {
            limited = true;
            break;
        }
        let options = if page["fileCursor"].is_string() {
            json!({"fileCursor":page["fileCursor"]})
        } else {
            json!({})
        };
        page = carrier
            .invoke("getTranscriptPage", json!([thread, before, 500, options]))
            .await?;
        let mut older = page["messages"]
            .as_array()
            .context("Invalid Desktop Code transcript page")?
            .clone();
        if page["found"] == false || older.is_empty() {
            limited = true;
            break;
        }
        older.extend(rows);
        rows = older;
        ensure!(
            rows.len() <= 21_000,
            "Desktop history exceeds read limit; cache retained"
        );
    }
    // The renderer may transform SDK messages or synthesize notices. Project
    // only recognized envelopes and report unknown shapes. A bounded native
    // read never authorizes pruning earlier cached history.
    let mut messages = vec![];
    let mut unknown = false;
    let source = super::desktop_history::source(thread)?;
    let mut ids = std::collections::HashSet::new();
    for row in &rows {
        if matches!(row["type"].as_str(), Some("assistant" | "user"))
            && row["parent_tool_use_id"].is_null()
            && row["isSidechain"] != true
            && row["isMeta"] != true
        {
            if let Some(id) = row["uuid"].as_str() {
                if ids.insert(id.to_string()) {
                    let mut row = row.clone();
                    row["_anyworkDesktopProfileRoot"] =
                        json!(source.as_ref().and_then(|p| p.ancestors().nth(3)));
                    messages.push(row);
                }
            } else {
                unknown = true;
            }
        } else if !matches!(
            row["type"].as_str(),
            Some("system" | "result" | "stream_event")
        ) && row["parent_tool_use_id"].is_null()
        {
            unknown = true;
        }
    }
    let (imported, notice) = history::import_messages(app, s, messages, true)?;
    Ok(if unknown || limited {
        Some(
            "Desktop 原生历史包含未识别的展示记录，或达到分页边界；已保留缓存，未宣称历史完整"
                .into(),
        )
    } else if !imported {
        notice
    } else {
        None
    })
}

struct Adapter {
    carrier: DesktopCarrier,
    thread: String,
    row: Value,
    turn: Option<String>,
    permissions: HashMap<String, Value>,
    blocks: HashMap<u64, Value>,
    offsets: HashMap<String, usize>,
    tools: HashMap<String, Value>,
    message: String,
    generation: Option<String>,
    cursor: u64,
    interrupted: bool,
    uncertain: bool,
    clients: HashMap<String, Value>,
    submission: Option<String>,
}
fn notify(tx: &mpsc::UnboundedSender<Value>, method: &str, params: Value) {
    let _ = tx.send(json!({"method":method,"params":params}));
}
impl Adapter {
    fn settings(&self) -> Value {
        json!({"model":self.row["model"],"effort":null,"catalogComplete":false})
    }
    fn begin(&mut self, tx: &mpsc::UnboundedSender<Value>) {
        if self.turn.is_none() {
            let turn = uuid::Uuid::new_v4().to_string();
            self.turn = Some(turn.clone());
            self.interrupted = false;
            self.blocks.clear();
            self.offsets.clear();
            self.tools.clear();
            notify(
                tx,
                "turn/started",
                json!({"threadId":self.thread,"turn":{"id":turn,"status":"inProgress"},"nativeSessionActivity":true,"submissionDeliveryState":self.submission.as_ref().map(|_|"unknown")}),
            );
        }
    }
    fn resolve(&mut self, tx: &mpsc::UnboundedSender<Value>) {
        for (key, _) in self.permissions.drain() {
            notify(
                tx,
                "serverRequest/resolved",
                json!({"threadId":self.thread,"requestId":key}),
            );
        }
    }
    fn finish(&mut self, tx: &mpsc::UnboundedSender<Value>, result: &Value) {
        self.resolve(tx);
        // A session terminal event releases the local send fence; it cannot
        // prove which queued/submitted input ran. Preserve that uncertainty.
        if let Some(id) = self.submission.take() {
            notify(
                tx,
                "claude/submission/state",
                json!({"threadId":self.thread,"submissionId":id,"deliveryState":"unknown","nativeTerminalObserved":true}),
            );
        }
        if let Some(turn) = self.turn.take() {
            let status = if result["is_error"] == true {
                "failed"
            } else if self.interrupted {
                "interrupted"
            } else {
                "completed"
            };
            notify(
                tx,
                "turn/completed",
                json!({"threadId":self.thread,"turn":{"id":turn,"status":status,"error":(status=="failed").then(||json!({"message":"Claude Desktop reported a failed turn","code":result["subtype"]}))}}),
            );
        }
    }
    fn permission(&mut self, v: Value, tx: &mpsc::UnboundedSender<Value>) -> Result<()> {
        ensure!(
            v["sessionId"] == self.thread,
            "Desktop permission session identity mismatch"
        );
        let key = v["requestId"]
            .as_str()
            .context("Missing native permission ID")?
            .to_string();
        if self.permissions.contains_key(&key) {
            return Ok(());
        }
        self.begin(tx);
        let r = json!({"subtype":"can_use_tool","tool_name":v["toolName"],"input":v["input"],"tool_use_id":v["cliToolUseId"]});
        let mut p = json!({"threadId":self.thread,"turnId":self.turn,"itemId":v["cliToolUseId"],"tool":v["toolName"],"input":v["input"],"reason":v["description"],"availableDecisions":["accept","decline"]});
        let method = if v["toolName"] == "AskUserQuestion" {
            let questions = v["input"]["questions"]
                .as_array()
                .context("Invalid native question")?;
            p["questions"]=json!(questions.iter().enumerate().map(|(n,q)|json!({"id":n.to_string(),"header":q["header"],"question":q["question"],"options":q["options"],"isOther":true,"multiSelect":q["multiSelect"]})).collect::<Vec<_>>());
            "item/tool/requestUserInput"
        } else {
            p["command"] = v["input"]["command"].clone();
            "item/commandExecution/requestApproval"
        };
        self.permissions.insert(key.clone(), r);
        let _ = tx.send(json!({"id":key,"method":method,"params":p}));
        Ok(())
    }
    fn update(&mut self, row: Value, tx: &mpsc::UnboundedSender<Value>) -> Result<()> {
        ensure!(
            row["sessionId"] == self.thread,
            "Desktop snapshot identity mismatch"
        );
        self.row = row;
        notify(
            tx,
            "thread/settings/updated",
            json!({"threadId":self.thread,"threadSettings":self.settings()}),
        );
        if busy(&self.row) {
            self.begin(tx);
        }
        let pending = self.row["pendingToolPermissions"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        let stale: Vec<_> = self
            .permissions
            .keys()
            .filter(|id| !pending.iter().any(|r| r["requestId"] == id.as_str()))
            .cloned()
            .collect();
        for id in stale {
            self.permissions.remove(&id);
            notify(
                tx,
                "serverRequest/resolved",
                json!({"threadId":self.thread,"requestId":id}),
            );
        }
        for mut p in pending {
            if p["sessionId"].is_null() {
                p["sessionId"] = json!(self.thread);
            }
            self.permission(p, tx)?;
        }
        Ok(())
    }
    fn native(&mut self, v: &Value, tx: &mpsc::UnboundedSender<Value>) -> Result<()> {
        if !v["parent_tool_use_id"].is_null() {
            return Ok(());
        }
        // CLI IDs in SDK envelopes are lineage metadata, never control targets.
        match v["type"].as_str() {
            Some("result") => {
                self.begin(tx);
                self.finish(tx, v);
            }
            Some("stream_event") => {
                self.begin(tx);
                let e = &v["event"];
                let index = e["index"].as_u64().unwrap_or(0);
                match e["type"].as_str() {
                    Some("message_start") => {
                        self.message = e["message"]["id"]
                            .as_str()
                            .context("Missing native message identity")?
                            .into();
                        self.blocks.clear();
                    }
                    Some("content_block_start") => {
                        let b = &e["content_block"];
                        let id = b["id"]
                            .as_str()
                            .map(str::to_string)
                            .unwrap_or_else(|| format!("{}:{index}", self.message));
                        notify(
                            tx,
                            "item/started",
                            json!({"threadId":self.thread,"turnId":self.turn,"item":protocol::item(b,&id)}),
                        );
                        self.blocks.insert(index, json!(id));
                    }
                    Some("content_block_delta") => {
                        if let Some(id) = self.blocks.get(&index) {
                            let d = &e["delta"];
                            let (method, delta) = match d["type"].as_str() {
                                Some("text_delta") => ("item/agentMessage/delta", &d["text"]),
                                Some("thinking_delta") => {
                                    ("item/reasoning/textDelta", &d["thinking"])
                                }
                                Some("input_json_delta") => {
                                    ("item/toolCall/inputDelta", &d["partial_json"])
                                }
                                _ => return Ok(()),
                            };
                            notify(
                                tx,
                                method,
                                json!({"threadId":self.thread,"turnId":self.turn,"itemId":id,"delta":delta}),
                            );
                        }
                    }
                    _ => {}
                }
            }
            Some("assistant" | "user") => {
                // A Desktop user echo can be emitted before a deferred send
                // reaches the engine. It is receipt evidence only.
                if v["type"] == "assistant" || !protocol::is_user_prompt(v) {
                    self.begin(tx);
                }
                let mut row = v.clone();
                if v["type"] == "assistant" {
                    let mid = v["message"]["id"]
                        .as_str()
                        .context("Missing native message identity")?;
                    let offset = self.offsets.entry(mid.into()).or_default();
                    row["_anyworkBlockOffset"] = json!(*offset);
                    for b in v["message"]["content"].as_array().into_iter().flatten() {
                        if b["type"] == "tool_use" {
                            let id = b["id"].as_str().context("Missing tool identity")?;
                            self.tools.insert(id.into(), protocol::item(b, id));
                        }
                    }
                    *offset += v["message"]["content"].as_array().map_or(0, Vec::len);
                }
                ensure!(
                    row["uuid"].is_string(),
                    "Missing native Desktop message UUID"
                );
                if v["type"] == "user"
                    && let Some(client) =
                        row["uuid"].as_str().and_then(|id| self.clients.remove(id))
                {
                    row["clientUserMessageId"] = client;
                }
                for (method, mut p) in
                    protocol::row_events(&self.thread, self.turn.as_deref().unwrap_or(""), &row)
                {
                    p["claudeCliSessionId"] = v["session_id"].clone();
                    if method == "item/completed"
                        && let Some(id) = p["item"]["id"].as_str()
                        && let Some(mut tool) = self.tools.remove(id)
                    {
                        for k in ["result", "aggregatedOutput", "status"] {
                            tool[k] = p["item"][k].clone();
                        }
                        p["item"] = tool;
                    }
                    notify(tx, &method, p);
                }
            }
            Some("system") if v["subtype"] == "session_state_changed" => {
                if matches!(v["state"].as_str(), Some("running" | "requires_action")) {
                    self.begin(tx);
                }
            }
            _ => {}
        }
        Ok(())
    }
    async fn poll(&mut self, tx: &mpsc::UnboundedSender<Value>) -> Result<()> {
        let page = self.carrier.poll_events(self.cursor).await?;
        let generation = page["generation"]
            .as_str()
            .context("Missing Desktop event generation")?;
        ensure!(
            page["gap"] == false && self.generation.as_deref().is_none_or(|g| g == generation),
            "Desktop event stream changed or lost events; reconnect explicitly, input will not be replayed"
        );
        self.generation = Some(generation.into());
        for envelope in page["events"]
            .as_array()
            .context("Invalid Desktop event list")?
        {
            let event = &envelope["event"];
            if event["sessionId"] != self.thread {
                continue;
            }
            match envelope["channel"].as_str() {
                Some("permission") => self.permission(event.clone(), tx)?,
                Some("event") => match event["type"].as_str() {
                    Some("message") => self.native(&event["message"], tx)?,
                    Some("session_updated") => self.update(event["session"].clone(), tx)?,
                    _ => {}
                },
                _ => {}
            }
        }
        let cursor = page["cursor"]
            .as_u64()
            .context("Invalid Desktop event cursor")?;
        ensure!(cursor >= self.cursor, "Desktop event cursor regressed");
        self.cursor = cursor;
        Ok(())
    }
    async fn run(mut self, mut bridge: RpcBridge, app: Arc<App>, s: Session) {
        let tx = bridge.responses.clone();
        let mut tick = tokio::time::interval(Duration::from_millis(100));
        let mut result = self.update(self.row.clone(), &tx);
        while result.is_ok() {
            tokio::select! {
                request=bridge.requests.recv()=>{
                    let Some(request)=request else{break;};let Some(v)=request.value else{let _=request.accepted.send(Ok(()));break;};
                    let response_only=v.get("method").is_none();let id=v["id"].clone();
                    match self.request(v,&tx,&app,&s).await{
                        Ok(value)=>{let _=request.accepted.send(Ok(()));if !id.is_null() && !response_only{let _=tx.send(json!({"id":id,"result":value}));}}
                        Err(e)=>{let error=e.to_string();if response_only{let _=request.accepted.send(Err(e));}else{let _=request.accepted.send(Ok(()));let _=tx.send(json!({"id":id,"error":{"code":-32000,"message":error}}));}
                            // A failed carrier call may have reached native code.
                            // Tear down this subscription, never retry a write.
                            if self.uncertain {result=Err(anyhow::anyhow!("Desktop request failed; delivery outcome may be unknown; reconnect explicitly"));}
                        }
                    }
                }
                _=tick.tick()=>{if tx.is_closed(){break;}result=self.poll(&tx).await;}
            }
        }
        self.resolve(&tx);
        if let Err(e) = result {
            notify(
                &tx,
                "connection/interrupted",
                json!({"threadId":self.thread,"reason":e.to_string()}),
            );
        }
        let _ = self.carrier.disconnect().await;
    }
    async fn request(
        &mut self,
        v: Value,
        tx: &mpsc::UnboundedSender<Value>,
        app: &App,
        s: &Session,
    ) -> Result<Value> {
        self.uncertain = false;
        let p = &v["params"];
        if v.get("method").is_none() {
            let id = v["id"].as_str().context("Invalid permission identity")?;
            let req = self
                .permissions
                .get(id)
                .context("Desktop permission is no longer pending")?;
            let decision = protocol::permission_response(req, &v["result"])?;
            let args = if decision["behavior"] == "deny" {
                json!([id, "deny"])
            } else if req["tool_name"] == "AskUserQuestion" {
                json!([id,"once",{"answers":decision["updatedInput"]["answers"]}])
            } else {
                json!([id, "once"])
            };
            self.uncertain = true;
            self.carrier.invoke("respondToToolPermission", args).await?;
            self.uncertain = false;
            self.permissions.remove(id);
            return Ok(json!({}));
        }
        if let Some(id) = p["threadId"].as_str() {
            ensure!(id == self.thread, "Desktop thread identity mismatch");
        }
        Ok(match v["method"].as_str().unwrap_or("") {
            "initialize" => json!({"name":"anywork-claude-desktop","protocolVersion":1}),
            "initialized" => json!({}),
            "thread/start" | "thread/resume" => {
                json!({"thread":{"id":self.thread},"model":self.row["model"]})
            }
            "anywork/session/state" => {
                let row = snapshot(&self.carrier, &self.thread).await?;
                self.update(row, tx)?;
                json!({"status":if self.turn.is_some(){if self.permissions.is_empty(){"running"}else{"waiting"}}else if self.submission.is_some(){"starting"}else{"idle"},"turnId":self.turn,"submissionId":self.submission,"deliveryState":self.submission.as_ref().map(|_|"unknown")})
            }
            "thread/read" => {
                json!({"thread":{"id":self.thread,"status":{"type":if self.turn.is_some(){"active"}else{"idle"}}}})
            }
            "anywork/session/settings" => self.settings(),
            "model/list" => {
                let mut models = self.carrier.invoke("models", json!([])).await?;
                models["catalogComplete"] = json!(false);
                models["nextCursor"] = Value::Null;
                models
            }
            "thread/settings/update" => {
                ensure!(
                    p["effort"].is_null() && p["serviceTier"].is_null(),
                    "Desktop effort/service tier control is not exposed"
                );
                let model = p["model"]
                    .as_str()
                    .filter(|s| !s.is_empty())
                    .context("Missing Desktop model")?;
                ensure!(
                    !busy(&snapshot(&self.carrier, &self.thread).await?),
                    "Desktop session is busy; settings were not changed"
                );
                self.uncertain = true;
                self.carrier
                    .invoke("setModel", json!([self.thread, model]))
                    .await?;
                let row = snapshot(&self.carrier, &self.thread).await?;
                ensure!(
                    row["model"] == model,
                    "Desktop model change was not confirmed"
                );
                self.update(row, tx)?;
                self.uncertain = false;
                json!({})
            }
            "turn/start" => {
                let row = snapshot(&self.carrier, &self.thread).await?;
                ensure!(
                    !busy(&row) && self.turn.is_none() && self.submission.is_none(),
                    "Desktop Code is busy; concurrent steer is not supported"
                );
                let mut texts = vec![];
                let mut images = vec![];
                let mut attachments = vec![];
                for block in p["input"].as_array().context("Invalid Desktop input")? {
                    match block["type"].as_str() {
                        Some("text") => texts.push(
                            block["text"]
                                .as_str()
                                .context("Invalid Desktop text")?
                                .to_string(),
                        ),
                        Some("localImage" | "localFile") => {
                            let path = crate::api::attachment_path(
                                app,
                                s,
                                block["path"].as_str().context("Missing attachment path")?,
                            )?;
                            let bytes = history::read_file(&path, 20 * 1024 * 1024)?;
                            let name = path
                                .file_name()
                                .context("Missing attachment name")?
                                .to_string_lossy();
                            let data = base64::engine::general_purpose::STANDARD.encode(bytes);
                            let ext = path
                                .extension()
                                .and_then(|s| s.to_str())
                                .unwrap_or("")
                                .to_ascii_lowercase();
                            let media = match ext.as_str() {
                                "png" => Some("image/png"),
                                "jpg" | "jpeg" => Some("image/jpeg"),
                                "gif" => Some("image/gif"),
                                "webp" => Some("image/webp"),
                                _ => None,
                            };
                            if let Some(media) = media {
                                images
                                    .push(json!({"filename":name,"base64":data,"mimeType":media}));
                            } else {
                                attachments.push(json!({"name":name,"base64":data}));
                            }
                        }
                        _ => anyhow::bail!("Unsupported Desktop input block"),
                    }
                }
                let message = uuid::Uuid::new_v4().to_string();
                self.uncertain = true;
                let reply=self.carrier.invoke("send",json!([{"sessionId":self.thread,"message":texts.join("\n"),"images":images,"attachments":attachments,"messageUuid":message}])).await?;
                ensure!(
                    reply["queued"] != true
                        && reply["status"] != "queued"
                        && reply != "queued"
                        && reply["type"] != "queued",
                    "Desktop queued input instead of starting; inspect native state before sending again"
                );
                self.clients
                    .insert(message.clone(), p["clientUserMessageId"].clone());
                self.submission = Some(message.clone());
                self.uncertain = false;
                // Public LocalSessions.sendMessage is Promise<void>; manager
                // delivery/queue results are swallowed. Never claim an atomic
                // turn start from null or from an echoed user UUID.
                json!({"turn":null,"submission":{"id":message,"status":"submitted","deliveryState":"unknown","message":"Desktop 已接收提交；执行或原生排队结果尚未确认，请勿重复发送"}})
            }
            "turn/interrupt" => {
                ensure!(
                    self.turn.is_some() && self.turn.as_deref() == p["turnId"].as_str(),
                    "Desktop active turn changed"
                );
                ensure!(
                    busy(&snapshot(&self.carrier, &self.thread).await?),
                    "Desktop no longer has an active turn"
                );
                self.uncertain = true;
                self.carrier
                    .invoke("interrupt", json!([self.thread]))
                    .await?;
                self.interrupted = true;
                self.uncertain = false;
                json!({})
            }
            "turn/steer" => anyhow::bail!("Desktop concurrent steering is not supported"),
            method => anyhow::bail!("Unsupported Desktop method: {method}"),
        })
    }
}
