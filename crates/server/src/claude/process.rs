//! Owned CLI only. All stdin writes are serialized by one actor. Native control
//! acknowledgements are correlated separately from AnyWork RPC/request IDs.
use super::{Config, ownership::Lease, protocol};
use crate::{App, store::Session};
use anyhow::{Context, Result, ensure};
use base64::Engine as _;
use remote_agent_sdk::RpcBridge;
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    process::Stdio,
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines},
    process::{Child, ChildStdin, ChildStdout, Command},
    sync::mpsc,
};

type Output = Lines<BufReader<ChildStdout>>;
pub struct Engine {
    child: Child,
    stdin: ChildStdin,
    lines: Output,
    _lease: Lease,
    thread: String,
    init: Value,
    model: Option<String>,
    turn: Option<String>,
    interrupted: bool,
    pending: HashMap<String, Pending>,
    permissions: HashMap<String, Value>,
    blocks: HashMap<usize, Value>,
    tool_items: HashMap<String, Value>,
    message: String,
    prelude: Vec<Value>,
    native_state: Option<String>,
    result: Option<Value>,
    offsets: HashMap<String, usize>,
}
struct Pending {
    rpc_id: Value,
    kind: Control,
    deadline: Instant,
}
enum Control {
    Model(String),
    Interrupt(String),
}
async fn write(stdin: &mut ChildStdin, value: &Value) -> Result<()> {
    stdin.write_all(value.to_string().as_bytes()).await?;
    stdin.write_all(b"\n").await?;
    stdin.flush().await?;
    Ok(())
}
fn frame(line: &str) -> Result<Value> {
    ensure!(
        line.len() <= 32 * 1024 * 1024,
        "Claude protocol frame exceeds limit"
    );
    serde_json::from_str(line).map_err(|_| anyhow::anyhow!("Malformed Claude stream-json frame"))
}
impl Engine {
    pub async fn spawn(config: &Config, s: &Session, resume: bool, lease: Lease) -> Result<Self> {
        ensure!(
            !config
                .bin
                .extension()
                .and_then(|v| v.to_str())
                .is_some_and(|ext| ["cmd", "bat"].contains(&ext.to_ascii_lowercase().as_str())),
            "Claude .cmd/.bat wrappers are unsupported; set ANYWORK_CLAUDE_BIN to the native claude.exe executable"
        );
        let thread = s
            .thread_id
            .as_deref()
            .context("Missing Claude session ID")?;
        let mut cmd = Command::new(&config.bin);
        cmd.args([
            "--print",
            "--input-format",
            "stream-json",
            "--output-format",
            "stream-json",
            "--verbose",
            "--include-partial-messages",
            "--replay-user-messages",
            "--permission-prompt-tool",
            "stdio",
            "--permission-mode",
            "manual",
        ])
        .arg(format!(
            "{}={thread}",
            if resume { "--resume" } else { "--session-id" }
        ))
        .current_dir(&s.cwd)
        .env("CLAUDE_CONFIG_DIR", &config.root)
        .env("CLAUDE_CODE_ENTRYPOINT", "sdk-anywork")
        .env("CLAUDE_CODE_SDK_READS_SESSION_STATE", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
        if let Some(model) = &s.model {
            cmd.arg("--model").arg(model);
        }
        let mut child = cmd
            .spawn()
            .context("Cannot start Claude Code; configure ANYWORK_CLAUDE_BIN and log in locally")?;
        let mut stdin = child.stdin.take().context("Missing Claude stdin")?;
        let mut lines =
            BufReader::new(child.stdout.take().context("Missing Claude stdout")?).lines();
        let stderr = child.stderr.take().context("Missing Claude stderr")?;
        // Drain without logging: diagnostics can include prompts, paths or tokens.
        tokio::spawn(async move {
            let mut r = BufReader::new(stderr);
            let mut sink = tokio::io::sink();
            let _ = tokio::io::copy(&mut r, &mut sink).await;
        });
        let id = format!("anywork-init-{}", uuid::Uuid::new_v4());
        write(&mut stdin,&json!({"type":"control_request","request_id":id,"request":{"subtype":"initialize","hooks":null}})).await?;
        let mut prelude = vec![];
        let init = tokio::time::timeout(Duration::from_secs(60),async {
            loop {
                let line = lines.next_line().await?.context("Claude exited during initialization; check local login and CLI configuration")?;
                let v = frame(&line)?;
                if v["type"] == "control_response" && v["response"]["request_id"] == id {
                    ensure!(v["response"]["subtype"] == "success", "Claude initialization rejected");
                    let result = v["response"]["response"].clone();
                    ensure!(result["hooks_applied"] != false,"Claude session is already running in another host; refusing a competing writer");
                    if let Some(native) = result["session_id"].as_str() { ensure!(native == thread,"Claude resumed a different session; input was not sent"); }
                    break Ok::<_,anyhow::Error>(result);
                }
                ensure!(prelude.len() < 1000,"Claude initialization prelude exceeds limit"); prelude.push(v);
            }
        }).await.context("Claude initialization timed out; no input was sent")??;
        let model = s
            .model
            .clone()
            .or_else(|| init["model"].as_str().map(str::to_string));
        Ok(Self {
            child,
            stdin,
            lines,
            _lease: lease,
            thread: thread.into(),
            init,
            model,
            turn: None,
            interrupted: false,
            pending: HashMap::new(),
            permissions: HashMap::new(),
            blocks: HashMap::new(),
            tool_items: HashMap::new(),
            message: String::new(),
            prelude,
            native_state: None,
            result: None,
            offsets: HashMap::new(),
        })
    }
    pub async fn run(mut self, mut bridge: RpcBridge, app: Arc<App>, s: Session) {
        let tx = bridge.responses.clone();
        let mut tick = tokio::time::interval(Duration::from_secs(1));
        let mut failure = None;
        for v in std::mem::take(&mut self.prelude) {
            if self.native(v, &tx).await.is_err() {
                failure = Some("Claude initialization stream failed");
                break;
            }
        }
        while failure.is_none() {
            tokio::select! {
                message = bridge.requests.recv() => {
                    let Some(message) = message else { break; };
                    let Some(value) = message.value else { let _ = message.accepted.send(Ok(())); break; };
                    let response_only = value.get("method").is_none();
                    let result = self.request(value.clone(), &tx, &app, &s).await;
                    match result {
                        Ok(()) => { let _ = message.accepted.send(Ok(())); }
                        Err(error) if response_only => { let _ = message.accepted.send(Err(error)); }
                        Err(error) => {
                            let _ = message.accepted.send(Ok(()));
                            if !value["id"].is_null() { send_error(&tx,value["id"].clone(),&error.to_string()); }
                        }
                    }
                }
                line = self.lines.next_line() => {
                    match line {
                        Ok(Some(line)) => match frame(&line) { Ok(v) => if self.native(v,&tx).await.is_err() { failure=Some("Claude protocol failed; delivery outcome unknown"); }, Err(_) => failure=Some("Claude returned invalid stream-json; delivery outcome unknown") },
                        _ => { failure=Some("Claude process disconnected; delivery outcome unknown. Reconnect explicitly; input will not be replayed."); }
                    }
                }
                _ = tick.tick() => {
                    if self.pending.values().any(|p| p.deadline <= Instant::now()) { failure=Some("Claude control request timed out; delivery outcome unknown"); }
                    if tx.is_closed() { break; }
                }
            }
        }
        if let Some(reason) = failure {
            notify(
                &tx,
                "connection/interrupted",
                json!({"threadId":self.thread,"reason":reason}),
            );
            for (_, p) in self.pending.drain() {
                send_error(&tx, p.rpc_id, reason);
            }
        }
        // Only this owned subprocess is stopped. Never signal a registry PID.
        let _ = self.child.kill().await;
        let _ = self.child.wait().await;
    }
    fn settings(&self) -> Value {
        json!({"model":self.model,"effort":null})
    }
    fn status(&self) -> &'static str {
        if self.turn.is_none() {
            "idle"
        } else if !self.permissions.is_empty() {
            "waiting"
        } else {
            "running"
        }
    }
    async fn request(
        &mut self,
        v: Value,
        tx: &mpsc::UnboundedSender<Value>,
        app: &Arc<App>,
        s: &Session,
    ) -> Result<()> {
        let id = v["id"].clone();
        let p = &v["params"];
        if v.get("method").is_none() {
            let key = id.as_str().context("Unknown Claude approval ID")?;
            let request = self
                .permissions
                .get(key)
                .context("Claude request is no longer pending")?;
            let response = protocol::permission_response(request, &v["result"])?;
            write(&mut self.stdin,&json!({"type":"control_response","response":{"subtype":"success","request_id":key,"response":response}})).await?;
            self.permissions.remove(key);
            return Ok(());
        }
        let method = v["method"].as_str().unwrap_or("");
        if let Some(thread) = p["threadId"].as_str() {
            ensure!(thread == self.thread, "Claude thread identity mismatch");
        }
        let result = match method {
            "initialize" => json!({"name":"anywork-claude","protocolVersion":1}),
            "initialized" => return Ok(()),
            "thread/start" | "thread/resume" => {
                json!({"thread":{"id":self.thread},"model":self.model})
            }
            "thread/read" => {
                json!({"thread":{"id":self.thread,"status":{"type":if self.turn.is_some(){"active"}else{"idle"}}}})
            }
            "anywork/session/state" => json!({"status":self.status(),"turnId":self.turn}),
            "anywork/session/settings" => self.settings(),
            "model/list" => json!({"data":protocol::models(&self.init),"nextCursor":null}),
            "thread/settings/update" => {
                ensure!(
                    self.turn.is_none(),
                    "Claude is busy; settings were not changed"
                );
                ensure!(
                    p["effort"].is_null() && p["serviceTier"].is_null(),
                    "Claude effort/service tier control is not exposed by this adapter"
                );
                let model = p["model"].as_str().context("Missing Claude model")?;
                ensure!(
                    protocol::models(&self.init)
                        .iter()
                        .any(|m| m["model"] == model),
                    "Model is not in the native Claude catalog"
                );
                self.control(
                    tx,
                    id,
                    Control::Model(model.into()),
                    json!({"subtype":"set_model","model":model}),
                )
                .await?;
                return Ok(());
            }
            "turn/start" => {
                ensure!(
                    self.turn.is_none() && self.pending.is_empty(),
                    "Claude is busy; input was not sent"
                );
                let input = p["input"].as_array().context("Invalid Claude input")?;
                let mut content = vec![];
                for block in input {
                    match block["type"].as_str() {
                        Some("text") => content.push(json!({"type":"text","text":block["text"].as_str().context("Invalid text input")?})),
                        Some("localImage" | "localFile") => {
                            let path = std::path::PathBuf::from(block["path"].as_str().context("Missing attachment path")?);
                            // Recheck at the adapter boundary, including symlink traversal.
                            let path = crate::api::attachment_path(app,s,&path.to_string_lossy())?;
                            let bytes = super::history::read_file(&path,20 * 1024 * 1024)?;
                            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
                            let media = match ext.as_str() { "png"=>Some("image/png"),"jpg"|"jpeg"=>Some("image/jpeg"),"gif"=>Some("image/gif"),"webp"=>Some("image/webp"),_=>None };
                            if let Some(media) = media { content.push(json!({"type":"image","source":{"type":"base64","media_type":media,"data":base64::engine::general_purpose::STANDARD.encode(bytes)}})); }
                            else if ext == "pdf" { content.push(json!({"type":"document","source":{"type":"base64","media_type":"application/pdf","data":base64::engine::general_purpose::STANDARD.encode(bytes)}})); }
                            else { let text = String::from_utf8(bytes).context("Unsupported binary attachment; use a text, image or PDF file")?; content.push(json!({"type":"text","text":format!("Attached file {}:\n{text}",path.file_name().unwrap_or_default().to_string_lossy())})); }
                        }
                        _ => anyhow::bail!("Unsupported Claude input block"),
                    }
                }
                let turn = uuid::Uuid::new_v4().to_string();
                let user = json!({"type":"user","uuid":turn,"session_id":self.thread,"message":{"role":"user","content":content},"parent_tool_use_id":null,"client_composed":true});
                // Never acknowledge a failed/uncertain write as queued for replay.
                write(&mut self.stdin, &user)
                    .await
                    .context("Claude input write failed; delivery outcome unknown")?;
                self.turn = Some(turn.clone());
                self.interrupted = false;
                self.result = None;
                self.blocks.clear();
                self.tool_items.clear();
                self.offsets.clear();
                notify(
                    tx,
                    "turn/started",
                    json!({"threadId":self.thread,"turn":{"id":turn,"status":"inProgress"}}),
                );
                let mut echo = user;
                echo["clientUserMessageId"] = p["clientUserMessageId"].clone();
                for (method, params) in protocol::row_events(&self.thread, &turn, &echo) {
                    notify(tx, &method, params);
                }
                json!({"turn":{"id":turn,"status":"inProgress"}})
            }
            "turn/interrupt" => {
                ensure!(
                    self.turn.as_deref() == p["turnId"].as_str() && self.turn.is_some(),
                    "Claude active turn changed"
                );
                self.control(
                    tx,
                    id,
                    Control::Interrupt(self.turn.clone().unwrap()),
                    json!({"subtype":"interrupt"}),
                )
                .await?;
                return Ok(());
            }
            "turn/steer" => anyhow::bail!(
                "Claude concurrent steering is not supported; wait or cancel before sending input"
            ),
            _ => anyhow::bail!("Unsupported Claude method: {method}"),
        };
        if !id.is_null() {
            let _ = tx.send(json!({"id":id,"result":result}));
        }
        Ok(())
    }
    async fn control(
        &mut self,
        _tx: &mpsc::UnboundedSender<Value>,
        rpc_id: Value,
        kind: Control,
        request: Value,
    ) -> Result<()> {
        let key = format!("anywork-{}", uuid::Uuid::new_v4());
        write(
            &mut self.stdin,
            &json!({"type":"control_request","request_id":key,"request":request}),
        )
        .await?;
        self.pending.insert(
            key,
            Pending {
                rpc_id,
                kind,
                deadline: Instant::now() + Duration::from_secs(60),
            },
        );
        Ok(())
    }
    fn finish(&mut self, tx: &mpsc::UnboundedSender<Value>, result: Value) {
        let Some(turn) = self.turn.take() else {
            return;
        };
        for (request, _) in self.permissions.drain() {
            notify(
                tx,
                "serverRequest/resolved",
                json!({"threadId":self.thread,"requestId":request}),
            );
        }
        let status = if self.interrupted {
            "interrupted"
        } else if result["is_error"] == true {
            "failed"
        } else {
            "completed"
        };
        let error=(status=="failed").then(|| json!({"message":"Claude reported a failed turn; check local model access and account configuration","code":result["subtype"]}));
        notify(
            tx,
            "turn/completed",
            json!({"threadId":self.thread,"turn":{"id":turn,"status":status,"error":error}}),
        );
        self.result = None;
    }
    fn reopen(&mut self, tx: &mpsc::UnboundedSender<Value>) {
        if self.turn.is_some() {
            return;
        }
        // A background task may wake the native main thread after its result.
        // This is a new local run identity, not a synthetic user input.
        let turn = uuid::Uuid::new_v4().to_string();
        self.turn = Some(turn.clone());
        self.interrupted = false;
        self.result = None;
        self.blocks.clear();
        self.tool_items.clear();
        self.offsets.clear();
        notify(
            tx,
            "turn/started",
            json!({"threadId":self.thread,"turn":{"id":turn,"status":"inProgress"},"nativeBackgroundWake":true}),
        );
    }
    async fn native(&mut self, v: Value, tx: &mpsc::UnboundedSender<Value>) -> Result<()> {
        if let Some(thread) = v["session_id"].as_str() {
            ensure!(thread == self.thread, "Claude session identity changed");
        }
        match v["type"].as_str() {
            Some("control_response") => {
                let key = v["response"]["request_id"].as_str().unwrap_or("");
                if let Some(p) = self.pending.remove(key) {
                    if v["response"]["subtype"] != "success" {
                        send_error(tx, p.rpc_id, "Claude rejected control request");
                    } else {
                        match p.kind {
                            Control::Model(model) => {
                                self.model = Some(model);
                                notify(
                                    tx,
                                    "thread/settings/updated",
                                    json!({"threadId":self.thread,"threadSettings":self.settings()}),
                                );
                            }
                            Control::Interrupt(turn) if self.turn.as_deref() == Some(&turn) => {
                                self.interrupted = true
                            }
                            Control::Interrupt(_) => {}
                        }
                        let _ = tx.send(json!({"id":p.rpc_id,"result":{}}));
                    }
                }
            }
            Some("control_request") => {
                let key = v["request_id"]
                    .as_str()
                    .context("Missing Claude control request ID")?;
                let r = &v["request"];
                if r["subtype"] != "can_use_tool" {
                    write(&mut self.stdin,&json!({"type":"control_response","response":{"subtype":"error","request_id":key,"error":"Unsupported AnyWork control request"}})).await?;
                    return Ok(());
                }
                self.reopen(tx);
                ensure!(
                    !self.permissions.contains_key(key),
                    "Duplicate Claude permission request ID"
                );
                let mut params = json!({"threadId":self.thread,"turnId":self.turn,"itemId":r["tool_use_id"],"tool":r["tool_name"],"input":r["input"],"reason":r["description"],"availableDecisions":["accept","decline"]});
                let method = if r["tool_name"] == "AskUserQuestion" {
                    let questions = r["input"]["questions"]
                        .as_array()
                        .context("Malformed Claude question request")?;
                    params["questions"]=json!(questions.iter().enumerate().map(|(n,q)| json!({"id":n.to_string(),"header":q["header"],"question":q["question"],"options":q["options"],"isOther":true,"multiSelect":q["multiSelect"]})).collect::<Vec<_>>());
                    "item/tool/requestUserInput"
                } else {
                    params["command"] = r["input"]["command"].clone();
                    "item/commandExecution/requestApproval"
                };
                self.permissions.insert(key.into(), r.clone());
                let _ = tx.send(json!({"id":key,"method":method,"params":params}));
            }
            Some("control_cancel_request") => {
                if let Some(key) = v["request_id"].as_str()
                    && self.permissions.remove(key).is_some()
                {
                    notify(
                        tx,
                        "serverRequest/resolved",
                        json!({"threadId":self.thread,"requestId":key}),
                    );
                }
            }
            Some("system") => {
                if v["subtype"] == "init"
                    && let Some(model) = v["model"].as_str()
                {
                    self.model = Some(protocol::model_id(&self.init, model));
                    notify(
                        tx,
                        "thread/settings/updated",
                        json!({"threadId":self.thread,"threadSettings":self.settings()}),
                    );
                }
                if v["subtype"] == "session_state_changed" {
                    self.native_state = v["state"].as_str().map(str::to_string);
                    match self.native_state.as_deref() {
                        Some("running" | "requires_action") => self.reopen(tx),
                        Some("idle") => {
                            if let Some(result) = self.result.take() {
                                self.finish(tx, result);
                            }
                        }
                        _ => {}
                    }
                }
            }
            Some("result") => {
                if v["is_error"] == true || self.native_state.as_deref().is_none_or(|s| s == "idle")
                {
                    self.finish(tx, v);
                } else {
                    self.result = Some(v);
                }
            }
            Some("stream_event") => {
                // Subagents have their own block indices/message identities.
                if !v["parent_tool_use_id"].is_null() {
                    return Ok(());
                }
                self.reopen(tx);
                let e = &v["event"];
                let index = e["index"].as_u64().unwrap_or(0) as usize;
                match e["type"].as_str() {
                    Some("message_start") => {
                        self.message = e["message"]["id"].as_str().unwrap_or("message").into();
                        self.blocks.clear();
                    }
                    Some("content_block_start") => {
                        let block = e["content_block"].clone();
                        let id = block["id"]
                            .as_str()
                            .map(str::to_string)
                            .unwrap_or_else(|| format!("{}:{index}", self.message));
                        let item = protocol::item(&block, &id);
                        notify(
                            tx,
                            "item/started",
                            json!({"threadId":self.thread,"turnId":self.turn,"item":item}),
                        );
                        self.blocks.insert(index, json!({"id":id,"block":block}));
                    }
                    Some("content_block_delta") => {
                        if let Some(block) = self.blocks.get(&index) {
                            let d = &e["delta"];
                            let (method, delta) = match d["type"].as_str() {
                                Some("text_delta") => {
                                    ("item/agentMessage/delta", d["text"].clone())
                                }
                                Some("thinking_delta") => {
                                    ("item/reasoning/textDelta", d["thinking"].clone())
                                }
                                Some("input_json_delta") => {
                                    ("item/toolCall/inputDelta", d["partial_json"].clone())
                                }
                                _ => return Ok(()),
                            };
                            notify(
                                tx,
                                method,
                                json!({"threadId":self.thread,"turnId":self.turn,"itemId":block["id"],"delta":delta}),
                            );
                        }
                    }
                    _ => {}
                }
            }
            Some("assistant" | "user") => {
                if !v["parent_tool_use_id"].is_null() {
                    return Ok(());
                }
                // User echoes were projected on acceptance. Tool results are
                // user-role frames but never become visible user prompts.
                if v["type"] == "user" && protocol::is_user_prompt(&v) {
                    return Ok(());
                }
                self.reopen(tx);
                let mut row = v.clone();
                // API message ID keeps streamed text and final blocks identical.
                if v["type"] == "assistant" {
                    let mid = v["message"]["id"].as_str().unwrap_or("message");
                    let blocks = v["message"]["content"]
                        .as_array()
                        .cloned()
                        .unwrap_or_default();
                    let offset = self.offsets.entry(mid.into()).or_default();
                    row["_anyworkBlockOffset"] = json!(*offset);
                    for (n, b) in blocks.iter().enumerate() {
                        let id = b["id"]
                            .as_str()
                            .map(str::to_string)
                            .unwrap_or_else(|| format!("{mid}:{}", *offset + n));
                        let item = protocol::item(b, &id);
                        if b["type"] == "tool_use" {
                            self.tool_items.insert(id, item);
                        }
                    }
                    *offset += blocks.len();
                    // protocol::row_events uses uuid for keys, native message id
                    // for text item IDs below; both are stable on history reads.
                }
                if !row["uuid"].is_string() {
                    row["uuid"] = row["message"]["id"].clone();
                }
                for (method, mut params) in
                    protocol::row_events(&self.thread, self.turn.as_deref().unwrap_or(""), &row)
                {
                    if method == "item/completed" {
                        let id = params["item"]["id"].as_str().unwrap_or("");
                        if let Some(mut tool) = self.tool_items.remove(id) {
                            tool["aggregatedOutput"] = params["item"]["aggregatedOutput"].clone();
                            tool["result"] = params["item"]["result"].clone();
                            tool["status"] = params["item"]["status"].clone();
                            if tool["type"] == "commandExecution" {
                                notify(
                                    tx,
                                    "item/commandExecution/outputDelta",
                                    json!({"threadId":self.thread,"turnId":self.turn,"itemId":id,"delta":tool["aggregatedOutput"]}),
                                );
                            }
                            params["item"] = tool;
                        }
                    }
                    notify(tx, &method, params);
                }
            }
            _ => {}
        }
        Ok(())
    }
}
fn notify(tx: &mpsc::UnboundedSender<Value>, method: &str, params: Value) {
    let _ = tx.send(json!({"method":method,"params":params}));
}
fn send_error(tx: &mpsc::UnboundedSender<Value>, id: Value, message: &str) {
    let _ = tx.send(json!({"id":id,"error":{"code":-32000,"message":message}}));
}
