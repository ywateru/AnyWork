//! Native Harness 0.2.2 Typert carrier. External hosts retain execution ownership.
//! Contract: deepseek-harness fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159,
//! client/connection browser-auth+client/rpc, api/gateway stream-protocol.
use crate::{
    App,
    store::{Session, now},
};
use anyhow::{Context, Result, bail, ensure};
use base64::Engine;
use futures_util::{SinkExt, StreamExt};
use remote_agent_sdk::{PluginManifest, RpcProcess};
use serde_json::{Value, json};
use std::{collections::HashMap, path::PathBuf, sync::Arc, time::Duration};
use tokio::sync::mpsc;
use tokio_tungstenite::{
    MaybeTlsStream, WebSocketStream,
    tungstenite::{Message, client::IntoClientRequest},
};

pub const AGENT: &str = "deepseek-harness";
type Socket = WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>;
#[derive(Clone)]
pub struct Config {
    base: url::Url,
    token: String,
    descriptor: Option<PathBuf>,
    optional: bool,
}
impl Config {
    pub fn configured(
        raw: Option<&str>,
        token_file: Option<PathBuf>,
        descriptor: Option<PathBuf>,
    ) -> Result<Option<Self>> {
        ensure!(
            raw.is_none() || descriptor.is_none(),
            "Choose a Harness URL or discovery file, not both"
        );
        if let Some(path) = descriptor {
            use std::io::Read;
            let mut options = std::fs::OpenOptions::new();
            options.read(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.custom_flags(libc::O_NOFOLLOW);
            }
            let file=options.open(&path).context("Cannot read Harness discovery file; install or enable the Harness discovery companion")?;
            let meta = file.metadata()?;
            ensure!(
                meta.len() <= 16 * 1024,
                "Harness discovery file is too large"
            );
            #[cfg(unix)]
            {
                use std::os::unix::fs::{MetadataExt, PermissionsExt};
                ensure!(
                    meta.uid() == unsafe { libc::geteuid() },
                    "Harness discovery file must belong to the current user"
                );
                ensure!(
                    meta.permissions().mode() & 0o077 == 0,
                    "Harness discovery file must have private 0600 permissions"
                );
            }
            let mut bytes = Vec::new();
            file.take(16 * 1024 + 1).read_to_end(&mut bytes)?;
            ensure!(
                bytes.len() <= 16 * 1024,
                "Harness discovery file is too large"
            );
            let value: Value = serde_json::from_slice(&bytes)?;
            ensure!(
                value["version"] == 1,
                "Unsupported Harness discovery version"
            );
            let mut config = Self::new(
                value["url"]
                    .as_str()
                    .context("Missing Harness discovery URL")?,
                token_file,
            )?;
            config.descriptor = Some(path);
            return Ok(Some(config));
        }
        if let Some(raw) = raw {
            return Self::new(raw, token_file).map(Some);
        }
        let Some(home) = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"))
        else {
            return Ok(None);
        };
        Ok(Some(Self {
            base: url::Url::parse("http://127.0.0.1:3080/")?,
            token: String::new(),
            descriptor: Some(PathBuf::from(home).join(".anywork/harness/host.json")),
            optional: true,
        }))
    }
    pub fn new(raw: &str, token_file: Option<PathBuf>) -> Result<Self> {
        let mut base = url::Url::parse(raw).context("Invalid Harness URL")?;
        ensure!(
            base.scheme() == "http"
                && matches!(
                    base.host_str(),
                    Some("localhost" | "127.0.0.1" | "[::1]" | "::1")
                ),
            "Harness URL must be a loopback HTTP address"
        );
        ensure!(
            base.username().is_empty() && base.password().is_none() && base.path() == "/",
            "Harness URL must name the host root"
        );
        let tokens: Vec<_> = base
            .query_pairs()
            .filter(|(k, _)| k == "token")
            .map(|(_, v)| v.into_owned())
            .collect();
        ensure!(tokens.len() <= 1, "Harness URL has repeated tokens");
        let token = match token_file {
            Some(p) => std::fs::read_to_string(p)
                .context("Cannot read Harness token file")?
                .trim()
                .to_owned(),
            None => tokens.first().cloned().context(
                "Harness requires its launch token: supply a token URL or --harness-token-file",
            )?,
        };
        ensure!(!token.is_empty(), "Harness token is empty");
        base.set_query(None);
        base.set_fragment(None);
        Ok(Self {
            base,
            token,
            descriptor: None,
            optional: false,
        })
    }
    pub fn available(&self) -> bool {
        !self.optional
            || self
                .descriptor
                .as_ref()
                .is_some_and(|path| Self::configured(None, None, Some(path.clone())).is_ok())
    }
    pub fn manifest() -> PluginManifest {
        PluginManifest {
            id: AGENT.into(),
            name: "DeepSeek Harness".into(),
            protocol_version: 1,
            command: String::new(),
            args: vec![],
            env: HashMap::new(),
            capabilities: vec![
                "chat".into(),
                "tools".into(),
                "images".into(),
                "approvals".into(),
                "shared-host".into(),
                "models".into(),
            ],
        }
    }
    async fn connect(&self) -> Result<Carrier> {
        let resolved;
        let config = if let Some(path) = &self.descriptor {
            resolved = Self::configured(None, None, Some(path.clone()))?
                .context("Harness discovery missing")?;
            &resolved
        } else {
            self
        };
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(20))
            .build()?;
        let mut connect = config.base.join("connect")?;
        connect
            .query_pairs_mut()
            .append_pair("token", &config.token)
            .append_pair("interactions", "answer");
        let response = client.get(connect).send().await.map_err(|_| {
            anyhow::anyhow!("Harness host is unavailable; start the configured host and reconnect")
        })?;
        ensure!(
            response.status() == reqwest::StatusCode::FOUND,
            "Harness authentication failed (HTTP {}); refresh the host launch token",
            response.status()
        );
        let cookie = response
            .headers()
            .get(reqwest::header::SET_COOKIE)
            .context("Harness did not issue an API peer cookie")?
            .to_str()?
            .split(';')
            .next()
            .unwrap_or("")
            .to_owned();
        let mut ws = config.base.join("api/remote.mux")?;
        ws.set_scheme("ws")
            .map_err(|_| anyhow::anyhow!("Invalid Harness WebSocket URL"))?;
        let mut request = ws.as_str().into_client_request()?;
        request.headers_mut().insert("cookie", cookie.parse()?);
        let (socket, _) = tokio_tungstenite::connect_async(request)
            .await
            .map_err(|_| {
                anyhow::anyhow!(
                    "Cannot open Harness API peer; check the host version and launch token"
                )
            })?;
        Ok(Carrier {
            client,
            base: config.base.clone(),
            cookie,
            socket,
        })
    }
}
struct Carrier {
    client: reqwest::Client,
    base: url::Url,
    cookie: String,
    socket: Socket,
}
impl Carrier {
    async fn call(&self, endpoint: &str, args: Value) -> Result<Value> {
        let id = uuid::Uuid::new_v4().to_string();
        let mut response = self.client.post(self.base.join(&format!("api/{endpoint}"))?).header(reqwest::header::COOKIE,&self.cookie)
            .json(&json!({"type":"client-request","rpcId":id,"method":endpoint,"payload":{"args":args}})).send().await
            .map_err(|_|anyhow::anyhow!("Harness transport interrupted; mutation outcome may be unknown. Inspect the session before retrying"))?;
        ensure!(
            response.status().is_success(),
            "Harness {endpoint} failed (HTTP {})",
            response.status()
        );
        ensure!(
            response.content_length().unwrap_or(0) <= 32 * 1024 * 1024,
            "Harness response exceeds 32 MiB"
        );
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .context("Harness response interrupted")?
        {
            ensure!(
                bytes.len() + chunk.len() <= 32 * 1024 * 1024,
                "Harness response exceeds 32 MiB"
            );
            bytes.extend_from_slice(&chunk);
        }
        let data: Value = serde_json::from_slice(&bytes).context("Invalid Harness response")?;
        ensure!(
            data["type"] == "server-response" && data["rpcId"] == id,
            "Invalid Harness RPC correlation"
        );
        ensure!(
            data["result"]["ok"] == true,
            "Harness {endpoint}: {}",
            data["result"]["error"]
        );
        Ok(data["result"]["value"].clone())
    }
    async fn open(&mut self, id: &str, endpoint: &str, args: Value) -> Result<()> {
        self.socket
            .send(Message::Text(
                json!({"type":"open","streamId":id,"endpoint":endpoint,"payload":{"args":args}})
                    .to_string()
                    .into(),
            ))
            .await?;
        Ok(())
    }
    async fn next(&mut self) -> Result<Value> {
        loop {
            match self
                .socket
                .next()
                .await
                .context("Harness peer disconnected")??
            {
                Message::Text(text) => {
                    ensure!(
                        text.len() <= 32 * 1024 * 1024,
                        "Harness stream frame exceeds limit"
                    );
                    return Ok(serde_json::from_str(&text)?);
                }
                Message::Ping(bytes) => self.socket.send(Message::Pong(bytes)).await?,
                Message::Close(_) => bail!("Harness peer disconnected"),
                _ => {}
            }
        }
    }
    async fn first(&mut self, id: &str, endpoint: &str, args: Value) -> Result<Value> {
        self.open(id, endpoint, args).await?;
        let frame = tokio::time::timeout(Duration::from_secs(20), self.next()).await??;
        ensure!(
            frame["type"] == "item" && frame["streamId"] == id,
            "Harness {endpoint}: {}",
            frame["error"]
        );
        self.socket
            .send(Message::Text(
                json!({"type":"cancel","streamId":id}).to_string().into(),
            ))
            .await?;
        Ok(frame["value"].clone())
    }
}
fn address(thread: &str) -> Value {
    json!({"kind":"session","sessionId":thread})
}
fn session_id(thread: &str) -> String {
    format!("harness-{thread}")
}

/// Passive catalog discovery: no create, resume, prompt or background activation.
pub async fn sync(app: &Arc<App>) -> Result<()> {
    let Some(config) = &app.harness else {
        return Ok(());
    };
    if !config.available() {
        return Ok(());
    }
    let mut last = app.harness_sync.lock().await;
    if last.is_some_and(|t| t.elapsed() < Duration::from_secs(2)) {
        return Ok(());
    }
    *last = Some(std::time::Instant::now());
    let mut host = config.connect().await?;
    let baseline = host
        .first("workspaces", "workspace/follow", json!({}))
        .await?;
    ensure!(
        baseline["type"] == "baseline",
        "Incompatible Harness workspace carrier"
    );
    let rows = host.call("session/list", json!({"_request":{}})).await?;
    let rows = rows["items"]
        .as_array()
        .context("Invalid Harness session list")?;
    for workspace in baseline["value"]["items"]
        .as_array()
        .context("Invalid Harness workspace list")?
    {
        let Some(cwd) = workspace["path"].as_str() else {
            continue;
        };
        if crate::files::within(&app.workspace, &PathBuf::from(cwd)).is_err() {
            continue;
        }
        for thread in workspace["sessionIds"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
        {
            let Some(row) = rows.iter().find(|row| row["sessionId"] == thread) else {
                continue;
            };
            if row["origin"] == "subagent" || row["parentSessionId"].is_string() {
                continue;
            }
            let id = session_id(thread);
            let old = app.store.session(&id).ok();
            let title = row["projections"]["values"]["title"]
                .as_str()
                .or_else(|| row["title"].as_str())
                .unwrap_or("Harness 会话");
            let s = Session {
                id: id.clone(),
                thread_id: Some(thread.into()),
                title: old
                    .as_ref()
                    .map(|s| s.title.clone())
                    .filter(|s| s != "Harness 会话")
                    .unwrap_or_else(|| title.into()),
                cwd: cwd.into(),
                agent: AGENT.into(),
                model: old.as_ref().and_then(|s| s.model.clone()),
                policy: "manual".into(),
                status: if row["running"] == true {
                    "running"
                } else {
                    "idle"
                }
                .into(),
                archived: false,
                created_at: old.as_ref().map_or(now(), |s| s.created_at),
                updated_at: row["updatedAt"].as_i64().unwrap_or_else(now),
                external: true,
                auxiliary: false,
            };
            app.store.save_shared_observation(&s)?;
        }
    }
    Ok(())
}

pub async fn create(app: &Arc<App>, cwd: &str, title: Option<String>) -> Result<Session> {
    let config = app
        .harness
        .as_ref()
        .context("Harness host is not configured")?;
    let host = config.connect().await?;
    let workspace = host
        .call("workspace/create", json!({"request":{"path":cwd}}))
        .await?;
    let workspace = workspace["workspace"]["workspaceId"]
        .as_str()
        .context("Harness did not return a workspace")?;
    let created = host
        .call(
            "session/create",
            json!({"request":{"workspaceId":workspace}}),
        )
        .await?;
    let thread = created["sessionId"]
        .as_str()
        .context("Harness did not return a session")?;
    let s = Session {
        id: session_id(thread),
        thread_id: Some(thread.into()),
        title: title.unwrap_or_else(|| "Harness 会话".into()),
        cwd: cwd.into(),
        agent: AGENT.into(),
        model: None,
        policy: "manual".into(),
        status: "idle".into(),
        archived: false,
        created_at: now(),
        updated_at: now(),
        external: true,
        auxiliary: false,
    };
    app.store.save(&s)?;
    Ok(s)
}

pub async fn attach(
    app: &Arc<App>,
    session: &Session,
) -> Result<(Arc<RpcProcess>, mpsc::UnboundedReceiver<Value>, bool)> {
    let config = app
        .harness
        .as_ref()
        .context("Harness host is not configured")?
        .clone();
    let thread = session
        .thread_id
        .clone()
        .context("Missing Harness session id")?;
    let mut host = config.connect().await?;
    let mut state = Projection::new(thread.clone());
    host.open(
        "session",
        "session/follow",
        json!({"request":{"address":address(&thread),"maxMessages":100,"assistantStream":true}}),
    )
    .await?;
    let snapshot = tokio::time::timeout(Duration::from_secs(20), host.next()).await??;
    ensure!(
        snapshot["type"] == "item" && snapshot["value"]["type"] == "snapshot",
        "Invalid Harness opening snapshot: {}",
        snapshot["error"]
    );
    ensure!(
        snapshot["value"]["header"]["id"] == thread,
        "Harness snapshot session identity mismatch"
    );
    let records = history_records(&host, &thread, &snapshot["value"]).await?;
    let (initial, mut initial_events) = mpsc::unbounded_channel();
    for mut record in records {
        materialize_images(app, session, &host, &mut record["event"]).await?;
        state.event(&record["event"], &initial)?;
    }
    while let Ok(event) = initial_events.try_recv() {
        app.emit(
            &session.id,
            event["method"].as_str().unwrap_or("unknown"),
            event["params"].clone(),
            None,
        );
    }
    app.store.set_status(
        &session.id,
        if state.turn.is_some() {
            "running"
        } else {
            "idle"
        },
    )?;
    let (rpc, events, mut bridge) = RpcProcess::bridge();
    state.baseline(&snapshot["value"]["assistantStream"], &bridge.responses)?;
    let app = app.clone();
    let id = session.id.clone();
    tokio::spawn(async move {
        let mut host = host;
        let result=async {
            host.open("events","$events",json!({})).await?;
            loop {
                tokio::select! {
                    incoming=host.next()=>{
                        let frame=match incoming {
                            Ok(frame)=>frame,
                            Err(error)=>{
                                state.invalidate_interactions(&bridge.responses,"connection_lost")?;
                                state.emit(&bridge.responses,"connection/interrupted",json!({"message":error.to_string(),"agent":AGENT}),None)?;
                                // Never replay mutations. Reads reconnect with a new peer and fixed-cut history.
                                loop {
                                    tokio::select! {
                                        _=tokio::time::sleep(Duration::from_secs(1))=>{
                                            if let Ok(connected)=config.connect().await {host=connected;break;}
                                        },
                                        request=bridge.requests.recv()=>{
                                            let Some(request)=request else {return Ok(())};
                                            if request.value.is_none(){let _=request.accepted.send(Ok(()));return Ok(())}
                                            let _=request.accepted.send(Err(anyhow::anyhow!("Harness host is reconnecting; no command was sent")));
                                        }
                                    }
                                }
                                host.open("session","session/follow",json!({"request":{"address":address(&thread),"maxMessages":100,"assistantStream":true}})).await?;
                                host.open("events","$events",json!({})).await?;
                                continue;
                            }
                        };
                        ensure!(frame["type"]!="error","Harness stream: {}",frame["error"]);
                        if frame["streamId"]=="session" && frame["type"]=="item" {
                            let value=&frame["value"];
                            if value["type"]=="snapshot" {
                                ensure!(value["header"]["id"]==thread,"Harness snapshot session identity mismatch");
                                let records=history_records(&host,&thread,value).await?;
                                for mut record in records {materialize_images(&app,&app.store.session(&id)?,&host,&mut record["event"]).await?;state.event(&record["event"],&bridge.responses)?;}
                                state.baseline(&value["assistantStream"],&bridge.responses)?;
                                state.emit(&bridge.responses,"thread/status/changed",json!({"status":{"type":if state.turn.is_some(){"active"}else{"idle"}}}),None)?;
                            } else if value["type"]=="event" {let mut event=value["event"].clone();materialize_images(&app,&app.store.session(&id)?,&host,&mut event).await?;state.event(&event,&bridge.responses)?;}
                            else if value["type"]=="assistant-stream"{state.live(&value["frame"],&bridge.responses)?;}
                        } else if frame["streamId"]=="events" && frame["type"]=="item" {
                            state.interaction(&frame["value"],&bridge.responses,&host).await?;
                        }
                    }
                    request=bridge.requests.recv()=>{
                        let Some(request)=request else {break};
                        let Some(value)=request.value else {let _=request.accepted.send(Ok(()));break};
                        let result=state.request(&host,&value).await;
                        let acknowledgement=result.as_ref().map(|_|()).map_err(|error|anyhow::anyhow!(error.to_string()));
                        let _=request.accepted.send(acknowledgement);
                        if let Some(request_id)=value.get("id") {
                            if value.get("method").is_some() {
                                let response=match result {Ok(result)=>json!({"id":request_id,"result":result}),Err(error)=>json!({"id":request_id,"error":{"message":error.to_string()}})};
                                let _=bridge.responses.send(response);
                            } else if let Err(error)=result {
                                let _=bridge.responses.send(json!({"method":"error","params":{"message":error.to_string()}}));
                            }
                        }
                    }
                }
            }
            Ok::<(),anyhow::Error>(())
        }.await;
        // Close every local interaction even when stream setup or a protocol
        // failure terminates the actor, without answering the native waterfall.
        let _ = state.invalidate_interactions(&bridge.responses, "connection_lost");
        if let Err(error) = result {
            let _ = state.emit(
                &bridge.responses,
                "connection/interrupted",
                json!({"message":error.to_string(),"agent":AGENT}),
                None,
            );
        }
        let _ = host.socket.close(None).await;
    });
    Ok((rpc, events, false))
}

/// Host-owned image references become session-scoped local preview files. Never treat
/// an attachment ID/name as a filesystem path or fetch a provider-supplied URL.
async fn materialize_images(
    app: &App,
    session: &Session,
    host: &Carrier,
    event: &mut Value,
) -> Result<()> {
    let content = if event["type"] == "user/message" {
        event["data"].get_mut("content")
    } else {
        event["data"]["message"].get_mut("content")
    };
    let Some(content) = content.and_then(Value::as_array_mut) else {
        return Ok(());
    };
    for part in content {
        if part["type"] == "file" {
            let reference = &part["attachment"];
            let key = reference["attachmentId"].as_str().unwrap_or("");
            let name = reference["name"].as_str().unwrap_or("");
            if key.len() <= 256
                && key
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b':')
                && std::path::Path::new(name)
                    .file_name()
                    .and_then(|s| s.to_str())
                    == Some(name)
            {
                let path = app
                    .data_dir
                    .join("uploads")
                    .join(&session.id)
                    .join(format!("harness-{}-{name}", key.replace(':', "-")));
                if path.is_file() {
                    *part = json!({"type":"localFile","path":path,"harnessAttachment":reference});
                } else {
                    *part = json!({"type":"text","text":format!("附件：{name}（由 Harness 主机保存）")});
                }
            }
            continue;
        }
        if part["type"] != "image" || !part["attachment"].is_object() {
            continue;
        }
        let reference = &part["attachment"];
        let key = reference["attachmentId"]
            .as_str()
            .context("Invalid Harness image identity")?;
        ensure!(
            key.len() <= 256
                && !key.is_empty()
                && key
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b':'),
            "Invalid Harness image identity"
        );
        let ext = match reference["mediaType"].as_str() {
            Some("image/png") => "png",
            Some("image/jpeg") => "jpg",
            Some("image/webp") => "webp",
            Some("image/gif") => "gif",
            _ => bail!("Unsupported Harness image media type"),
        };
        let folder = app.data_dir.join("uploads").join(&session.id);
        let path = folder.join(format!("harness-{}.{ext}", key.replace(':', "-")));
        if !path.is_file() {
            let value = host
                .call(
                    "session/attachment",
                    json!({"request":{"sessionId":session.thread_id,"attachment":reference}}),
                )
                .await?;
            let data = base64::engine::general_purpose::STANDARD.decode(
                value["data"]
                    .as_str()
                    .context("Missing Harness image bytes")?,
            )?;
            ensure!(
                data.len() <= 20 * 1024 * 1024
                    && reference["bytes"].as_u64() == Some(data.len() as u64),
                "Harness image byte length mismatch"
            );
            tokio::fs::create_dir_all(&folder).await?;
            tokio::fs::write(&path, data).await?;
        }
        *part = json!({"type":"localImage","path":path,"harnessAttachment":reference});
    }
    Ok(())
}

async fn history_records(host: &Carrier, thread: &str, value: &Value) -> Result<Vec<Value>> {
    let mut records = value["records"]
        .as_array()
        .cloned()
        .context("Invalid Harness history snapshot")?;
    let mut more = value["hasMore"] == true;
    let cut = value["cursor"].clone();
    let mut pages = 0;
    while more {
        pages += 1;
        ensure!(pages < 1000, "Harness history exceeds page limit");
        let before = records
            .first()
            .map(|r| r["event"]["seq"].clone())
            .context("Harness empty history page with hasMore")?;
        let page=host.call("session/page",json!({"request":{"address":address(thread),"throughSeq":cut,"beforeSeq":before,"maxMessages":100}})).await?;
        let mut older = page["records"]
            .as_array()
            .cloned()
            .context("Invalid Harness history page")?;
        ensure!(
            !older.is_empty() || page["hasMore"] != true,
            "Harness history cursor made no progress"
        );
        ensure!(
            older
                .iter()
                .all(|r| r["event"]["seq"].as_i64() < before.as_i64()),
            "Harness history cursor did not decrease"
        );
        older.extend(records);
        records = older;
        more = page["hasMore"] == true;
    }
    Ok(records)
}

struct Projection {
    thread: String,
    turn: Option<String>,
    tools: HashMap<String, Value>,
    attempts: HashMap<String, (String, String)>,
    event_client: Option<String>,
    pending: HashMap<String, Value>,
}
impl Projection {
    fn new(thread: String) -> Self {
        Self {
            thread,
            turn: None,
            tools: HashMap::new(),
            attempts: HashMap::new(),
            event_client: None,
            pending: HashMap::new(),
        }
    }
    fn emit(
        &self,
        out: &mpsc::UnboundedSender<Value>,
        method: &str,
        mut params: Value,
        key: Option<String>,
    ) -> Result<()> {
        params["threadId"] = json!(self.thread);
        if params["turnId"].is_null() {
            params["turnId"] = json!(self.turn);
        }
        if let Some(key) = key {
            params["harnessEventKey"] = json!(key);
        }
        out.send(json!({"method":method,"params":params}))
            .map_err(|_| anyhow::anyhow!("Harness adapter closed"))
    }
    fn event(&mut self, event: &Value, out: &mpsc::UnboundedSender<Value>) -> Result<()> {
        let Some(seq) = event["seq"].as_i64() else {
            bail!("Invalid Harness durable sequence")
        };
        let d = &event["data"];
        let typ = event["type"]
            .as_str()
            .context("Missing Harness event type")?;
        let turn = d["turn"]
            .as_i64()
            .map(|t| format!("harness-turn-{t}"))
            .or_else(|| self.turn.clone());
        let emit = |this: &Self, method: &str, mut p: Value| {
            p["harnessEventTime"] = event["time"].clone();
            let key = format!("{seq}:{method}:{}", p["item"]["id"].as_str().unwrap_or(""));
            this.emit(out, method, p, Some(key))
        };
        match typ {
            "turn/start" => {
                self.turn = turn.clone();
                emit(
                    self,
                    "turn/started",
                    json!({"turn":{"id":turn,"status":"inProgress","startedAt":event["time"].as_i64().map(|t|t/1000)},"turnId":turn}),
                )?;
            }
            "turn/end" => {
                let status = match d["reason"]["kind"]
                    .as_str()
                    .or_else(|| d["reason"].as_str())
                    .unwrap_or("")
                {
                    "aborted" | "cancelled" | "interrupted" | "forked" => "interrupted",
                    "error" | "failed" => "failed",
                    "completed" | "blocked" | "max-tokens" => "completed",
                    kind => bail!("Unsupported Harness turn/end reason: {kind}"),
                };
                emit(
                    self,
                    "turn/completed",
                    json!({"turn":{"id":turn,"status":status,"harnessReason":d["reason"]},"turnId":turn}),
                )?;
                self.turn = None;
            }
            "user/message" => {
                if d["source"]["kind"] != "user" {
                    return Ok(());
                }
                let message = &d["message"];
                let message = if message.is_object() { message } else { d };
                emit(
                    self,
                    "user/message",
                    json!({"turnId":turn,"history_turn_id":turn,"history_id":message["id"].as_str().map(str::to_owned).unwrap_or_else(||format!("harness-user-{seq}")),"harnessClientId":d["source"]["rpcId"],"history_item_started_at_ms":event["time"],"text":content_text(&message["content"]),"attachments":message["content"].as_array().into_iter().flatten().filter(|p|matches!(p["type"].as_str(),Some("localImage"|"localFile"))).filter_map(|p|p["path"].as_str()).collect::<Vec<_>>() }),
                )?;
            }
            "assistant/message" => {
                let m = &d["message"];
                let item = format!("harness-assistant-{}-{}", d["turn"], d["step"]);
                let reasoning = m["content"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter(|part| part["type"] == "reasoning")
                    .filter_map(|part| part["text"].as_str())
                    .collect::<Vec<_>>()
                    .join("\n");
                if !reasoning.is_empty() {
                    emit(
                        self,
                        "item/completed",
                        json!({"turnId":turn,"item":{"type":"reasoning","id":format!("{item}-reasoning"),"summary":[reasoning],"source":AGENT,"status":"completed"}}),
                    )?;
                }
                let text = content_text(&m["content"]);
                if text.is_empty() {
                    return Ok(());
                }
                emit(
                    self,
                    "item/completed",
                    json!({"turnId":turn,"item":{"type":"agentMessage","id":item,"text":text,"phase":if m["content"].as_array().is_some_and(|a|a.iter().any(|c|c["type"]=="tool-call")){"commentary"}else{"final_answer"},"status":"completed","source":AGENT}}),
                )?;
            }
            "tool/call" => {
                let call = d["callId"]
                    .as_str()
                    .context("Missing Harness tool call id")?;
                let arguments = d["arguments"]
                    .as_str()
                    .and_then(|s| serde_json::from_str::<Value>(s).ok())
                    .unwrap_or_else(|| d["arguments"].clone());
                let item = json!({"type":"dynamicToolCall","id":format!("harness-tool-{seq}-{call}"),"nativeCallId":call,"tool":d["name"],"title":d["name"],"description":arguments["description"],"arguments":arguments,"status":"inProgress","source":AGENT});
                self.tools.insert(call.into(), item.clone());
                self.tools.insert(format!("seq:{seq}"), item.clone());
                emit(self, "item/started", json!({"turnId":turn,"item":item}))?;
            }
            "tool/result" => {
                let m = &d["message"];
                let call = m["callId"]
                    .as_str()
                    .or_else(|| m["source"]["callId"].as_str())
                    .context("Missing Harness tool result identity")?;
                let mut item=event["sourceEventSeqs"].as_array().and_then(|sources|sources.iter().filter_map(Value::as_i64).find_map(|seq|self.tools.get(&format!("seq:{seq}")))).or_else(||self.tools.get(call)).cloned().unwrap_or_else(||json!({"type":"dynamicToolCall","id":format!("harness-result-{seq}-{call}"),"tool":"tool","source":AGENT}));
                item["status"] = json!(if m["isError"] == true {
                    "failed"
                } else {
                    "completed"
                });
                item["content"] = m["content"].clone();
                item["output"] = json!(content_text(&m["content"]));
                item["harnessMeta"] = d["meta"].clone();
                emit(self, "item/completed", json!({"turnId":turn,"item":item}))?;
            }
            _ => {}
        }
        Ok(())
    }
    fn baseline(&mut self, baseline: &Value, out: &mpsc::UnboundedSender<Value>) -> Result<()> {
        let a = &baseline["activeAttempt"];
        let Some(id) = a["attemptId"].as_str() else {
            return Ok(());
        };
        let item = format!("harness-assistant-{}-{}", a["turn"], a["step"]);
        self.attempts
            .insert(id.into(), (item.clone(), String::new()));
        let mut text = String::new();
        let mut reasoning = String::new();
        for record in a["stream"].as_array().into_iter().flatten() {
            match record["type"].as_str() {
                Some("text-chunks") => {
                    for part in record["texts"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter_map(Value::as_str)
                    {
                        text.push_str(part)
                    }
                }
                Some("reasoning-chunks") => {
                    for part in record["texts"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter_map(Value::as_str)
                    {
                        reasoning.push_str(part)
                    }
                }
                Some("chunk") => {
                    let chunk = &record["chunk"];
                    if chunk["type"] == "text-delta" {
                        text.push_str(chunk["text"].as_str().unwrap_or(""))
                    } else if chunk["type"] == "reasoning-delta" {
                        reasoning.push_str(chunk["text"].as_str().unwrap_or(""))
                    }
                }
                _ => {}
            }
        }
        // Replace the previously observed process-local prefix at this cut;
        // appending it would duplicate pre-disconnection deltas in the UI.
        if !text.is_empty() {
            self.emit(out,"item/started",json!({"item":{"type":"agentMessage","id":item,"text":text,"status":"inProgress","source":AGENT}}),Some(format!("baseline:{id}:{}:text",a["nextIndex"])))?;
        }
        if !reasoning.is_empty() {
            self.emit(out,"item/started",json!({"item":{"type":"reasoning","id":format!("{item}-reasoning"),"summary":[reasoning],"status":"inProgress","source":AGENT}}),Some(format!("baseline:{id}:{}:reasoning",a["nextIndex"])))?;
        }
        Ok(())
    }
    fn live(&mut self, f: &Value, out: &mpsc::UnboundedSender<Value>) -> Result<()> {
        let Some(id) = f["attemptId"].as_str() else {
            return Ok(());
        };
        match f["type"].as_str() {
            Some("start") => {
                self.attempts.insert(
                    id.into(),
                    (
                        format!("harness-assistant-{}-{}", f["turn"], f["step"]),
                        String::new(),
                    ),
                );
            }
            Some("chunk") => self.chunk(id, &f["chunk"], out)?,
            _ => {}
        }
        Ok(())
    }
    fn chunk(&mut self, id: &str, chunk: &Value, out: &mpsc::UnboundedSender<Value>) -> Result<()> {
        let chunk = if chunk.is_array() {
            chunk.get(1).unwrap_or(chunk)
        } else {
            chunk
        };
        let item_id = self
            .attempts
            .get(id)
            .map(|v| v.0.clone())
            .unwrap_or_else(|| id.into());
        let typ = chunk["type"].as_str().unwrap_or("");
        let text = chunk["text"]
            .as_str()
            .or_else(|| chunk["delta"].as_str())
            .unwrap_or("");
        if !text.is_empty() && matches!(typ, "text-delta" | "text" | "content-delta") {
            self.emit(
                out,
                "item/agentMessage/delta",
                json!({"itemId":item_id,"delta":text}),
                None,
            )?;
        }
        if !text.is_empty() && matches!(typ, "reasoning-delta" | "reasoning") {
            self.emit(
                out,
                "item/reasoning/textDelta",
                json!({"itemId":format!("{item_id}-reasoning"),"delta":text,"source":AGENT}),
                None,
            )?;
        }
        Ok(())
    }
    fn invalidate_interactions(
        &mut self,
        out: &mpsc::UnboundedSender<Value>,
        reason: &str,
    ) -> Result<()> {
        self.event_client = None;
        for (id, _) in std::mem::take(&mut self.pending) {
            self.emit(
                out,
                "serverRequest/resolved",
                json!({"requestId":id,"reason":reason}),
                None,
            )?;
        }
        Ok(())
    }
    fn interaction_id(&self, event: &str) -> Result<String> {
        let client = self
            .event_client
            .as_ref()
            .context("Harness interaction has no live client generation")?;
        Ok(format!("{client}:{event}"))
    }
    fn begin_interaction(&mut self, frame: &Value) -> Result<String> {
        let event = frame["eventId"]
            .as_str()
            .context("Missing Harness interaction id")?;
        let id = self.interaction_id(event)?;
        self.pending.insert(id.clone(), frame.clone());
        Ok(id)
    }
    async fn interaction(
        &mut self,
        frame: &Value,
        out: &mpsc::UnboundedSender<Value>,
        host: &Carrier,
    ) -> Result<()> {
        if frame["type"] == "ready" {
            self.event_client = frame["clientId"].as_str().map(str::to_owned);
        } else if frame["type"] == "waterfall" {
            let event = frame["eventId"]
                .as_str()
                .context("Missing Harness interaction id")?;
            if frame["agentId"] != self.thread
                || !matches!(
                    frame["event"].as_str(),
                    Some("user-questions/request" | "approval/request")
                )
            {
                host.call(
                    "$events/result",
                    json!({"clientId":self.event_client,"eventId":event,"outcome":{"kind":"next"}}),
                )
                .await?;
                return Ok(());
            }
            let request_id = self.begin_interaction(frame)?;
            if frame["event"] == "approval/request" {
                let call = frame["request"]["callId"].as_str().unwrap_or(event);
                let command = self
                    .tools
                    .get(call)
                    .and_then(|tool| tool["arguments"]["command"].as_str())
                    .unwrap_or_else(|| {
                        frame["request"]["toolName"]
                            .as_str()
                            .unwrap_or("Harness tool")
                    });
                out.send(json!({"id":request_id,"method":"item/commandExecution/requestApproval","params":{"threadId":self.thread,"turnId":self.turn,"itemId":self.tools.get(call).and_then(|item|item["id"].as_str()).unwrap_or(call),"command":command,"reason":frame["request"]["reason"],"availableDecisions":["accept","decline"],"source":AGENT}})).map_err(|_|anyhow::anyhow!("Harness adapter closed"))?;
                return Ok(());
            }
            let questions=frame["request"]["questions"].as_array().context("Invalid Harness question batch")?.iter().map(|q|json!({"id":q["id"],"header":q["header"].as_str().unwrap_or("Harness"),"question":format!("{}{}",q["question"].as_str().unwrap_or(""),q["detail"].as_str().map(|s|format!("\n{s}")).unwrap_or_default()),"options":q["options"],"isOther":q["intent"]["kind"]!="approval","isSecret":false})).collect::<Vec<_>>();
            out.send(json!({"id":request_id,"method":"item/tool/requestUserInput","params":{"threadId":self.thread,"turnId":self.turn,"itemId":event,"questions":questions,"source":AGENT}})).map_err(|_|anyhow::anyhow!("Harness adapter closed"))?;
        } else if frame["type"] == "cancel"
            && let Some(id) = frame["eventId"].as_str()
        {
            let request_id = self.interaction_id(id)?;
            self.pending.remove(&request_id);
            self.emit(
                out,
                "serverRequest/resolved",
                json!({"requestId":request_id}),
                None,
            )?;
        }
        Ok(())
    }
    async fn request(&mut self, host: &Carrier, v: &Value) -> Result<Value> {
        let p = &v["params"];
        if v.get("method").is_none() {
            let id = v["id"]
                .as_str()
                .context("Invalid Harness request identity")?;
            let pending = self
                .pending
                .get(id)
                .context("Harness permission is no longer pending")?;
            if pending["event"] == "approval/request" {
                let decision = v["result"]["decision"]
                    .as_str()
                    .context("Missing Harness approval decision")?;
                ensure!(
                    matches!(decision, "accept" | "decline"),
                    "Harness only accepts a one-time grant or rejection"
                );
                let result=host.call("$events/result",json!({"clientId":self.event_client,"eventId":pending["eventId"],"outcome":{"kind":"result","value":if decision=="accept"{"allowed-once"}else{"rejected"}}})).await?;
                self.pending.remove(id);
                return Ok(result);
            }
            let mut answers = vec![];
            for q in pending["request"]["questions"]
                .as_array()
                .context("Invalid Harness questions")?
            {
                let qid = q["id"]
                    .as_str()
                    .context("Invalid Harness question identity")?;
                let selected = v["result"]["answers"][qid]["answers"]
                    .as_array()
                    .context("Missing Harness question answer")?
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_owned)
                    .collect::<Vec<_>>();
                if q["intent"]["kind"] == "approval" {
                    ensure!(
                        selected.len() == 1
                            && (q["intent"]["approve"] == selected[0]
                                || q["intent"]["reject"] == selected[0]),
                        "Only one-time allow or deny is supported for Harness permissions"
                    );
                }
                answers.push(json!({"id":qid,"selected":selected}));
            }
            let result=host.call("$events/result",json!({"clientId":self.event_client,"eventId":pending["eventId"],"outcome":{"kind":"result","value":{"answers":answers}}})).await?;
            self.pending.remove(id);
            return Ok(result);
        }
        match v["method"].as_str().unwrap_or("") {
            "thread/resume" | "thread/start" => Ok(json!({"thread":{"id":self.thread}})),
            "thread/turns/list" => {
                let state = host
                    .call(
                        "session/state",
                        json!({"request":{"sessionId":self.thread}}),
                    )
                    .await?;
                Ok(
                    json!({"data":if state["running"]==true {vec![json!({"id":self.turn.clone().unwrap_or_else(||"harness-active".into()),"status":"inProgress"})]}else{vec![]},"nextCursor":null}),
                )
            }
            "anywork/session/state" => {
                let state = host
                    .call(
                        "session/state",
                        json!({"request":{"sessionId":self.thread}}),
                    )
                    .await?;
                Ok(
                    json!({"status":if !self.pending.is_empty(){"waiting"}else if state["running"]==true{"running"}else{"idle"},"turnId":if state["running"]==true{Some(self.turn.clone().unwrap_or_else(||"harness-active".into()))}else{None}}),
                )
            }
            "thread/read" => {
                let state = host
                    .call(
                        "session/state",
                        json!({"request":{"sessionId":self.thread}}),
                    )
                    .await?;
                Ok(
                    json!({"thread":{"id":self.thread,"status":{"type":if state["running"]==true{"active"}else{"idle"}}}}),
                )
            }
            "anywork/harness/settings" => {
                let projection = host
                    .call(
                        "session/projections",
                        json!({"request":{"sessionId":self.thread}}),
                    )
                    .await?;
                let selection = &projection["values"]["modelSelection"];
                let catalog;
                let current = if selection["next"].is_object() {
                    &selection["next"]
                } else if selection["lastUsed"].is_object() {
                    &selection["lastUsed"]
                } else {
                    catalog = host.call("session/modelCatalog", json!({})).await?;
                    &catalog["default"]
                };
                Ok(
                    json!({"model":if current.is_object(){Some(json!({"provider":current["provider"],"model":current["model"]}).to_string())}else{None},"reasoningEffort":current["reasoningEffort"]}),
                )
            }
            "thread/settings/update" => {
                ensure!(
                    p["collaborationMode"].is_null() && p["serviceTier"].is_null(),
                    "Harness does not expose plan or service tier settings"
                );
                let raw = p["model"]
                    .as_str()
                    .context("Select a Harness model before changing its reasoning effort")?;
                let mut route: Value =
                    serde_json::from_str(raw).context("Invalid Harness model route")?;
                ensure!(
                    route["provider"].is_string() && route["model"].is_string(),
                    "Invalid Harness model route"
                );
                route["sessionId"] = json!(self.thread);
                if let Some(effort) = p["effort"].as_str() {
                    route["reasoningEffort"] = json!(effort);
                }
                let selected = host
                    .call("session/selectModel", json!({"request":route}))
                    .await?;
                ensure!(
                    selected["selected"]["provider"] == route["provider"]
                        && selected["selected"]["model"] == route["model"],
                    "Harness did not confirm the selected model"
                );
                Ok(selected)
            }
            "turn/start" | "turn/steer" => {
                let mut content = vec![];
                for part in p["input"].as_array().context("Invalid Harness input")? {
                    match part["type"].as_str() {
                        Some("text") => content.push(json!({"type":"text","text":part["text"]})),
                        Some("localFile") => {
                            let path =
                                PathBuf::from(part["path"].as_str().context("Missing file path")?);
                            let bytes = tokio::fs::read(&path).await?;
                            ensure!(
                                bytes.len() <= 20 * 1024 * 1024,
                                "Harness file exceeds 20 MiB"
                            );
                            let upload=host.call("fileUploads/upload",json!({"agentId":self.thread,"request":{"name":path.file_name().and_then(|s|s.to_str()),"data":base64::engine::general_purpose::STANDARD.encode(bytes)}})).await?;
                            let receipt = upload["receiptId"]
                                .as_str()
                                .context("Harness did not return a file receipt")?;
                            if let Some(key) = upload["file"]["attachmentId"].as_str() {
                                ensure!(
                                    key.len() <= 256
                                        && key.bytes().all(|b| b.is_ascii_alphanumeric()
                                            || b == b'-'
                                            || b == b'_'),
                                    "Invalid Harness file identity"
                                );
                                if let Some(parent) = path.parent() {
                                    let name = upload["file"]["name"]
                                        .as_str()
                                        .context("Missing Harness filename")?;
                                    ensure!(
                                        std::path::Path::new(name)
                                            .file_name()
                                            .and_then(|s| s.to_str())
                                            == Some(name),
                                        "Invalid Harness filename"
                                    );
                                    tokio::fs::copy(
                                        &path,
                                        parent.join(format!(
                                            "harness-{}-{name}",
                                            key.replace(':', "-")
                                        )),
                                    )
                                    .await?;
                                }
                            }
                            content.push(json!({"type":"file","receiptId":receipt}));
                        }
                        Some("localImage") => {
                            let path =
                                PathBuf::from(part["path"].as_str().context("Missing image path")?);
                            let data = tokio::fs::read(&path).await?;
                            ensure!(
                                data.len() <= 20 * 1024 * 1024,
                                "Harness image exceeds 20 MiB"
                            );
                            let media = match path
                                .extension()
                                .and_then(|s| s.to_str())
                                .unwrap_or("")
                                .to_lowercase()
                                .as_str()
                            {
                                "jpg" | "jpeg" => "image/jpeg",
                                "png" => "image/png",
                                "webp" => "image/webp",
                                "gif" => "image/gif",
                                _ => bail!("Unsupported Harness image format"),
                            };
                            content.push(json!({"type":"image","mediaType":media,"data":base64::engine::general_purpose::STANDARD.encode(data),"name":path.file_name().and_then(|s|s.to_str())}));
                        }
                        _ => bail!("Unsupported Harness input part"),
                    }
                }
                let request_id = p["clientUserMessageId"]
                    .as_str()
                    .map(str::to_owned)
                    .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
                let result=host.call("session/prompt",json!({"request":{"sessionId":self.thread,"requestId":request_id,"mode":if v["method"]=="turn/steer"{"steer"}else{"queue"},"content":content}})).await?;
                ensure!(
                    result["accepted"] == true,
                    "Harness did not accept the message"
                );
                Ok(json!({"accepted":true}))
            }
            "turn/interrupt" => {
                host.call(
                    "session/cancel",
                    json!({"request":{"sessionId":self.thread}}),
                )
                .await
            }
            "model/list" => {
                let catalog = host.call("session/modelCatalog", json!({})).await?;
                Ok(model_list(&catalog))
            }
            _ => bail!(
                "DeepSeek Harness does not support {}; no host command was sent",
                v["method"]
            ),
        }
    }
}
fn content_text(content: &Value) -> String {
    content
        .as_array()
        .into_iter()
        .flatten()
        .filter(|part| part["type"] == "text")
        .filter_map(|part| part["text"].as_str())
        .collect::<Vec<_>>()
        .join("\n")
}
fn model_list(catalog: &Value) -> Value {
    let mut data = vec![];
    for group in catalog["groups"].as_array().into_iter().flatten() {
        for model in group["models"].as_array().into_iter().flatten() {
            let route = json!({"provider":group["id"],"model":model["id"]}).to_string();
            data.push(json!({"id":route,"model":route,"displayName":format!("{} · {}",group["name"].as_str().unwrap_or(""),model["name"].as_str().unwrap_or("")),"supportedReasoningEfforts":model["reasoning"]["efforts"].as_array().map(|es|es.iter().map(|e|json!({"reasoningEffort":e["id"],"description":e["name"]})).collect::<Vec<_>>()).unwrap_or_default(),"defaultReasoningEffort":model["reasoning"]["defaultEffort"]}));
        }
    }
    json!({"data":data,"nextCursor":null})
}

#[cfg(test)]
mod tests {
    use super::*;
    fn frames() -> (
        Projection,
        mpsc::UnboundedSender<Value>,
        mpsc::UnboundedReceiver<Value>,
    ) {
        let (out, rx) = mpsc::unbounded_channel();
        (Projection::new("native-session".into()), out, rx)
    }
    #[test]
    fn rejects_nonlocal_hosts_without_revealing_launch_token() {
        for url in [
            "https://example.com/?token=private-launch-secret",
            "http://127.0.0.1/bad?token=private-launch-secret",
            "http://user:private-launch-secret@127.0.0.1/",
        ] {
            let error = Config::new(url, None).err().unwrap().to_string();
            assert!(!error.contains("private-launch-secret"));
        }
    }
    #[test]
    fn durable_user_tool_lifecycle_preserves_identity_and_hides_injections() {
        let (mut p, out, mut rx) = frames();
        for event in [
            json!({"seq":1,"time":1000,"type":"turn/start","data":{"turn":1}}),
            json!({"seq":2,"time":1001,"type":"user/message","data":{"id":"hidden","source":{"kind":"runtime-context"},"content":[{"type":"text","text":"internal"}]}}),
            json!({"seq":3,"time":1002,"type":"user/message","data":{"id":"native-user","source":{"kind":"user","rpcId":"native-request"},"content":[{"type":"text","text":"visible"}]}}),
            json!({"seq":4,"time":1003,"type":"tool/call","data":{"turn":1,"step":1,"callId":"call","name":"bash","arguments":"{\"description\":\"Print marker\",\"command\":\"printf marker\"}"}}),
            json!({"seq":5,"time":1004,"type":"tool/result","data":{"turn":1,"message":{"source":{"callId":"call"},"isError":true,"content":[{"type":"text","text":"denied"}]}}}),
            json!({"seq":6,"time":1005,"type":"turn/end","data":{"turn":1,"reason":{"kind":"cancelled"}}}),
        ] {
            p.event(&event, &out).unwrap();
        }
        let mut events = vec![];
        while let Ok(v) = rx.try_recv() {
            events.push(v);
        }
        assert_eq!(events.len(), 5);
        assert_eq!(events[1]["method"], "user/message");
        assert_eq!(events[1]["params"]["text"], "visible");
        assert_eq!(
            events[2]["params"]["item"]["id"],
            events[3]["params"]["item"]["id"]
        );
        assert_eq!(events[2]["params"]["item"]["tool"], "bash");
        assert_eq!(events[3]["params"]["item"]["status"], "failed");
        assert_eq!(events[4]["params"]["turn"]["status"], "interrupted");
    }
    #[test]
    fn native_turn_end_reasons_preserve_cancellation_and_reject_unknown_variants() {
        let (mut p, out, mut rx) = frames();
        for cause in ["user", "parent", "hook", "disposed", "legacy"] {
            let reason = json!({"kind":"aborted","reason":{"kind":cause}});
            p.event(
                &json!({"seq":1,"type":"turn/end","data":{"turn":1,"reason":reason}}),
                &out,
            )
            .unwrap();
            let event = rx.try_recv().unwrap();
            assert_eq!(event["params"]["turn"]["status"], "interrupted");
            assert_eq!(event["params"]["turn"]["harnessReason"], reason);
        }
        for (kind, expected) in [
            ("interrupted", "interrupted"),
            ("forked", "interrupted"),
            ("error", "failed"),
            ("completed", "completed"),
            ("blocked", "completed"),
            ("max-tokens", "completed"),
        ] {
            p.event(
                &json!({"seq":2,"type":"turn/end","data":{"turn":1,"reason":{"kind":kind}}}),
                &out,
            )
            .unwrap();
            assert_eq!(rx.try_recv().unwrap()["params"]["turn"]["status"], expected);
        }
        assert!(p.event(&json!({"seq":3,"type":"turn/end","data":{"turn":1,"reason":{"kind":"future-variant"}}}), &out).is_err());
    }
    #[test]
    fn lost_peer_resolves_persisted_requests_and_redelivery_has_a_new_identity() {
        let (mut p, out, mut rx) = frames();
        let frame = json!({"eventId":"same-native-event","event":"approval/request"});
        assert!(p.begin_interaction(&frame).is_err());
        p.event_client = Some("old-client".into());
        let old = p.begin_interaction(&frame).unwrap();
        let store = crate::store::Store::open(std::path::Path::new(":memory:")).unwrap();
        store
            .save(&Session {
                id: "session".into(),
                thread_id: Some("native-session".into()),
                title: "fixture".into(),
                cwd: "/tmp".into(),
                agent: AGENT.into(),
                model: None,
                policy: "manual".into(),
                status: "running".into(),
                archived: false,
                created_at: 0,
                updated_at: 0,
                external: true,
                auxiliary: false,
            })
            .unwrap();
        store
            .event(
                "session",
                "item/commandExecution/requestApproval",
                json!({}),
                Some(json!(old)),
            )
            .unwrap();
        assert!(store.request("session", &json!(old)).is_ok());
        p.invalidate_interactions(&out, "connection_lost").unwrap();
        let resolved = rx.try_recv().unwrap();
        assert_eq!(resolved["params"]["requestId"], old);
        assert_eq!(resolved["params"]["reason"], "connection_lost");
        store
            .event(
                "session",
                resolved["method"].as_str().unwrap(),
                resolved["params"].clone(),
                None,
            )
            .unwrap();
        assert!(store.request("session", &json!(old)).is_err());
        assert!(p.event_client.is_none());
        assert!(p.pending.is_empty());
        p.event_client = Some("new-client".into());
        let current = p.begin_interaction(&frame).unwrap();
        assert_ne!(current, old);
        assert!(!p.pending.contains_key(&old));
        assert_eq!(p.pending[&current]["eventId"], "same-native-event");
        store
            .event(
                "session",
                "item/commandExecution/requestApproval",
                json!({}),
                Some(json!(current)),
            )
            .unwrap();
        assert!(store.request("session", &json!(current)).is_ok());
        assert!(store.request("session", &json!(old)).is_err());
        // Repeating invalidation must never emit an answer or leave a request.
        p.invalidate_interactions(&out, "connection_lost").unwrap();
        assert_eq!(rx.try_recv().unwrap()["params"]["requestId"], current);
        p.invalidate_interactions(&out, "connection_lost").unwrap();
        assert!(rx.try_recv().is_err());
    }
    #[test]
    fn live_and_durable_assistant_use_same_item_without_reasoning_as_answer() {
        let (mut p, out, mut rx) = frames();
        p.live(
            &json!({"type":"start","attemptId":"attempt","turn":2,"step":3}),
            &out,
        )
        .unwrap();
        p.live(&json!({"type":"chunk","attemptId":"attempt","chunk":{"type":"text-delta","text":"hello"}}),&out).unwrap();
        p.event(&json!({"seq":8,"time":1008,"type":"assistant/message","data":{"turn":2,"step":3,"message":{"id":"message","content":[{"type":"reasoning","text":"reason"},{"type":"text","text":"hello"}]}}}),&out).unwrap();
        let delta = rx.try_recv().unwrap();
        let reasoning = rx.try_recv().unwrap();
        let answer = rx.try_recv().unwrap();
        assert_eq!(delta["params"]["itemId"], answer["params"]["item"]["id"]);
        assert_eq!(answer["params"]["item"]["text"], "hello");
        assert_ne!(
            reasoning["params"]["harnessEventKey"],
            answer["params"]["harnessEventKey"]
        );
    }
    #[test]
    fn durable_replay_is_idempotent_even_after_store_reopen() {
        let path = std::env::temp_dir().join(format!(
            "anywork-harness-replay-{}.sqlite",
            uuid::Uuid::new_v4()
        ));
        let session = Session {
            id: "session".into(),
            thread_id: Some("native".into()),
            title: "fixture".into(),
            cwd: "/tmp".into(),
            agent: AGENT.into(),
            model: None,
            policy: "manual".into(),
            status: "idle".into(),
            archived: false,
            created_at: 0,
            updated_at: 0,
            external: true,
            auxiliary: false,
        };
        let seq = {
            let store = crate::store::Store::open(&path).unwrap();
            store.save(&session).unwrap();
            store
                .event(
                    "session",
                    "user/message",
                    json!({"harnessEventKey":"1:user/message","text":"same"}),
                    None,
                )
                .unwrap()
                .seq
        };
        let store = crate::store::Store::open(&path).unwrap();
        assert_eq!(
            store
                .event(
                    "session",
                    "user/message",
                    json!({"harnessEventKey":"1:user/message","text":"same"}),
                    None
                )
                .unwrap()
                .seq,
            seq
        );
        assert_eq!(store.events("session", 0, 100).unwrap().len(), 1);
        drop(store);
        std::fs::remove_file(path).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn private_discovery_reloads_and_rejects_symlinks_or_public_files() {
        use std::os::unix::fs::{PermissionsExt, symlink};
        let folder = std::env::temp_dir().join(format!(
            "anywork-harness-discovery-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir(&folder).unwrap();
        let path = folder.join("host.json");
        std::fs::write(
            &path,
            json!({"version":1,"url":"http://127.0.0.1:1234/?token=secret-one"}).to_string(),
        )
        .unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        let config = Config::configured(None, None, Some(path.clone()))
            .unwrap()
            .unwrap();
        assert_eq!(config.token, "secret-one");
        std::fs::write(
            &path,
            json!({"version":1,"url":"http://127.0.0.1:1234/?token=secret-two"}).to_string(),
        )
        .unwrap();
        assert_eq!(
            Config::configured(None, None, config.descriptor.clone())
                .unwrap()
                .unwrap()
                .token,
            "secret-two"
        );
        let link = folder.join("link.json");
        symlink(&path, &link).unwrap();
        assert!(Config::configured(None, None, Some(link)).is_err());
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        let error = Config::configured(None, None, Some(path))
            .err()
            .unwrap()
            .to_string();
        assert!(!error.contains("secret-two"));
        std::fs::remove_dir_all(folder).unwrap();
    }
}
