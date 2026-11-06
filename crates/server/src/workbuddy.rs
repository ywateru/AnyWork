//! WorkBuddy Desktop 5.9.3: attach to its original trusted renderer/daemon.
//! Fixed preload methods only. No current subscription, account or host lifecycle calls.
use crate::{
    App,
    store::{Session, now},
};
use anyhow::{Context, Result, bail, ensure};
use futures_util::{SinkExt, StreamExt};
use remote_agent_sdk::{PluginManifest, RpcProcess};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};
use tokio::sync::mpsc;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream, tungstenite::Message};
use url::Url;
pub const AGENT: &str = "workbuddy";
type Socket = WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>;
#[derive(Clone)]
pub struct Config {
    path: Option<PathBuf>,
    optional: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Descriptor {
    version: u32,
    agent: String,
    app_version: String,
    pid: u32,
    url: String,
    browser_id: String,
    config_dir: PathBuf,
    instance_id: String,
}
impl Config {
    pub fn configured(path: Option<PathBuf>) -> Result<Self> {
        let optional = path.is_none();
        let path = path.or_else(|| {
            std::env::var_os("HOME")
                .or_else(|| std::env::var_os("USERPROFILE"))
                .map(|p| PathBuf::from(p).join(".anywork/workbuddy/host.json"))
        });
        let c = Self { path, optional };
        if !optional {
            c.descriptor()?;
        }
        Ok(c)
    }
    pub fn available(&self) -> bool {
        self.descriptor().is_ok()
    }
    pub fn manifest(&self) -> PluginManifest {
        PluginManifest {
            id: AGENT.into(),
            name: "WorkBuddy".into(),
            protocol_version: 1,
            command: String::new(),
            args: vec![],
            env: HashMap::new(),
            capabilities: vec![
                "models".into(),
                "images".into(),
                "approvals".into(),
                "interrupt".into(),
            ],
        }
    }
    fn descriptor(&self) -> Result<Descriptor> {
        let path = self
            .path
            .as_ref()
            .context("WorkBuddy launcher discovery is not configured")?;
        let bytes = private_read(path)?;
        let d: Descriptor = serde_json::from_slice(&bytes)
            .map_err(|_| anyhow::anyhow!("Invalid WorkBuddy discovery descriptor"))?;
        ensure!(
            d.version == 1 && d.agent == AGENT && d.app_version == "5.9.3",
            "Unsupported WorkBuddy desktop descriptor/version"
        );
        ensure!(
            d.pid > 0
                && d.config_dir.is_absolute()
                && uuid::Uuid::parse_str(&d.instance_id).is_ok(),
            "Invalid WorkBuddy discovery identity"
        );
        ensure!(
            !d.browser_id.is_empty()
                && d.browser_id.len() < 256
                && d.browser_id
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-'),
            "Invalid WorkBuddy browser identity"
        );
        endpoint(&d.url, "http")?;
        Ok(d)
    }
    async fn connect(&self) -> Result<Carrier> {
        let d = self.descriptor()?;
        let base = endpoint(&d.url, "http")?;
        let http = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(8))
            .build()?;
        let version: Value = http
            .get(base.join("json/version")?)
            .send()
            .await
            .map_err(|e| e.without_url())?
            .error_for_status()
            .map_err(|e| e.without_url())?
            .json()
            .await
            .map_err(|e| e.without_url())?;
        let browser = endpoint(
            version["webSocketDebuggerUrl"]
                .as_str()
                .context("WorkBuddy CDP browser unavailable")?,
            "ws",
        )?;
        ensure!(
            same_origin(&base, &browser)
                && browser.path() == format!("/devtools/browser/{}", d.browser_id),
            "WorkBuddy browser identity changed; relaunch with the AnyWork launcher"
        );
        let targets: Vec<Value> = http
            .get(base.join("json/list")?)
            .send()
            .await
            .map_err(|e| e.without_url())?
            .error_for_status()
            .map_err(|e| e.without_url())?
            .json()
            .await
            .map_err(|e| e.without_url())?;
        let mut matching = targets.iter().filter(|t| trusted_target(t));
        let target = matching
            .next()
            .context("WorkBuddy main renderer is unavailable; open its desktop window")?;
        ensure!(
            matching.next().is_none(),
            "Ambiguous WorkBuddy main renderer"
        );
        let ws = endpoint(
            target["webSocketDebuggerUrl"]
                .as_str()
                .context("WorkBuddy renderer debugger unavailable")?,
            "ws",
        )?;
        ensure!(
            same_origin(&base, &ws) && ws.path().starts_with("/devtools/page/"),
            "Invalid WorkBuddy renderer debugger endpoint"
        );
        let (socket, _) = tokio::time::timeout(
            Duration::from_secs(8),
            tokio_tungstenite::connect_async(ws.as_str()),
        )
        .await
        .context("WorkBuddy renderer connection timed out")?
        .map_err(|_| {
            anyhow::anyhow!(
                "Cannot connect to WorkBuddy renderer; restart through the AnyWork launcher"
            )
        })?;
        let c = Carrier::new(socket);
        let shape=c.evaluate("({invoke:typeof window.__wbInvoke,eventBridge:typeof window.__wbEventBridge,version:window.workbuddyDesktop?.appVersion,configDir:window.workbuddyDesktop?.configDir})").await?;
        ensure!(
            shape["invoke"] == "function"
                && shape["eventBridge"] == "function"
                && shape["version"] == d.app_version
                && shape["configDir"].as_str() == d.config_dir.to_str(),
            "Incompatible WorkBuddy renderer preload"
        );
        Ok(c)
    }
}
fn private_read(path: &Path) -> Result<Vec<u8>> {
    use std::io::Read;
    ensure!(
        path.is_absolute(),
        "WorkBuddy discovery path must be absolute"
    );
    for component in path.ancestors() {
        let meta =
            std::fs::symlink_metadata(component).context("WorkBuddy launcher entry unavailable")?;
        ensure!(
            !meta.file_type().is_symlink(),
            "WorkBuddy discovery path must not contain symlinks"
        );
    }
    let parent = path.parent().context("Invalid WorkBuddy discovery path")?;
    let dir = std::fs::symlink_metadata(parent).context(
        "WorkBuddy launcher entry unavailable; launch WorkBuddy with scripts/workbuddy-launch.py",
    )?;
    ensure!(
        dir.is_dir() && !dir.file_type().is_symlink(),
        "WorkBuddy discovery directory must not be a symlink"
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        ensure!(
            dir.uid() == unsafe { libc::geteuid() } && dir.permissions().mode() & 0o077 == 0,
            "WorkBuddy discovery directory must be private (0700)"
        );
    }
    let mut opts = std::fs::OpenOptions::new();
    opts.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.custom_flags(libc::O_NOFOLLOW);
    }
    let f = opts
        .open(path)
        .context("WorkBuddy launcher entry unavailable")?;
    let meta = f.metadata()?;
    ensure!(
        meta.is_file() && meta.len() <= 16 * 1024,
        "Invalid WorkBuddy discovery file size/type"
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        ensure!(
            meta.uid() == unsafe { libc::geteuid() } && meta.permissions().mode() & 0o077 == 0,
            "WorkBuddy discovery file must be private (0600)"
        );
    }
    let mut b = vec![];
    f.take(16 * 1024 + 1).read_to_end(&mut b)?;
    ensure!(b.len() <= 16 * 1024, "WorkBuddy descriptor too large");
    Ok(b)
}
fn endpoint(raw: &str, scheme: &str) -> Result<Url> {
    let u = Url::parse(raw).map_err(|_| anyhow::anyhow!("Invalid WorkBuddy loopback endpoint"))?;
    let loopback = u
        .host_str()
        .and_then(|h| h.trim_matches(['[', ']']).parse::<std::net::IpAddr>().ok())
        .is_some_and(|ip| ip.is_loopback());
    ensure!(
        u.scheme() == scheme
            && loopback
            && u.username().is_empty()
            && u.password().is_none()
            && u.query().is_none()
            && u.fragment().is_none(),
        "WorkBuddy endpoint must use direct loopback without credentials or query parameters"
    );
    if scheme == "http" {
        ensure!(u.path() == "/", "WorkBuddy HTTP endpoint must be an origin");
    }
    Ok(u)
}
fn same_origin(a: &Url, b: &Url) -> bool {
    a.host_str() == b.host_str() && a.port_or_known_default() == b.port_or_known_default()
}
fn trusted_target(t: &Value) -> bool {
    if t["type"] != "page" {
        return false;
    }
    let Some(u) = t["url"].as_str().and_then(|s| Url::parse(s).ok()) else {
        return false;
    };
    // The installed main UI is file backed. Never accept an account/login or web target.
    u.scheme() == "file" && u.path().ends_with("/app.asar/renderer/index.html")
}
#[derive(Clone)]
struct Carrier {
    commands: mpsc::UnboundedSender<CdpCommand>,
}
struct CdpCommand {
    expression: String,
    reply: tokio::sync::oneshot::Sender<Result<Value>>,
}
impl Carrier {
    fn new(mut socket: Socket) -> Self {
        let (commands, mut incoming) = mpsc::unbounded_channel::<CdpCommand>();
        tokio::spawn(async move {
            let mut pending = HashMap::<u64, tokio::sync::oneshot::Sender<Result<Value>>>::new();
            let mut next = 1u64;
            loop {
                tokio::select! {
                    cmd=incoming.recv()=>{
                        let Some(cmd)=cmd else{break};
                        pending.retain(|_,reply|!reply.is_closed());
                        let id=next;next+=1;
                        if socket.send(Message::Text(json!({"id":id,"method":"Runtime.evaluate","params":{"expression":cmd.expression,"returnByValue":true,"awaitPromise":true}}).to_string().into())).await.is_err(){let _=cmd.reply.send(Err(anyhow::anyhow!("WorkBuddy CDP disconnected")));break;}
                        pending.insert(id,cmd.reply);
                    }
                    frame=socket.next()=>{
                        let Some(Ok(frame))=frame else{break};
                        if let Message::Text(text)=frame {
                            let Ok(v)=serde_json::from_str::<Value>(&text) else{break};
                            if let Some(reply)=v["id"].as_u64().and_then(|id|pending.remove(&id)) {
                                let result=if !v["error"].is_null() || !v["result"]["exceptionDetails"].is_null(){Err(anyhow::anyhow!("WorkBuddy desktop operation failed"))}else{Ok(v["result"]["result"]["value"].clone())};
                                let _=reply.send(result);
                            }
                        }
                    }
                }
            }
            for (_, reply) in pending {
                let _ = reply.send(Err(anyhow::anyhow!("WorkBuddy CDP disconnected")));
            }
            let _ = socket.close(None).await;
        });
        Self { commands }
    }
    async fn evaluate(&self, expression: &str) -> Result<Value> {
        let (reply, rx) = tokio::sync::oneshot::channel();
        self.commands
            .send(CdpCommand {
                expression: expression.into(),
                reply,
            })
            .map_err(|_| anyhow::anyhow!("WorkBuddy CDP disconnected"))?;
        tokio::time::timeout(Duration::from_secs(30), rx)
            .await
            .context("WorkBuddy desktop operation timed out; do not resend unconfirmed messages")?
            .context("WorkBuddy CDP disconnected")?
    }
    async fn invoke(&self, channel: &str, args: Value) -> Result<Value> {
        ensure!(allowed(channel), "Unsupported WorkBuddy desktop operation");
        ensure!(args.is_array(), "Invalid WorkBuddy arguments");
        let call = format!(
            "window.__wbInvoke({},undefined,...{})",
            serde_json::to_string(channel)?,
            args
        );
        // Product models can contain private provider fields. Strip them inside
        // the renderer, before they cross CDP or enter AnyWork memory/history.
        let expression = if channel == "wb:models:list" {
            format!(
                "(async()=>{{const r=await {call};return {{items:(r.items||[]).map(m=>({{id:m.id,name:m.name,description:m.description,supportsImages:m.supportsImages,supportsReasoning:m.supportsReasoning,reasoning:m.reasoning,isDefault:m.isDefault,disabled:m.disabled}}))}}}})()"
            )
        } else if channel == "wb:conversations:get" || channel == "wb:conversations:create" {
            format!(
                "(async()=>{{const r=await {call};if(!r)return null;if(r.errorCode)return {{errorCode:r.errorCode}};const i=r.info,c=r.configManager||{{}};return {{info:{{id:i.id,title:i.title,state:i.state,lifecycle:i.lifecycle,space:{{type:i.space?.type,cwd:i.space?.cwd,name:i.space?.name}},transport:i.transport,kind:i.kind,createdAt:i.createdAt,updatedAt:i.updatedAt,lastActivityAt:i.lastActivityAt}},configManager:{{model:c.model,thoughtLevel:c.thoughtLevel}}}}}})()"
            )
        } else if channel == "wb:conversations:list" {
            format!(
                "(async()=>{{const r=await {call};return {{total:r.total,page:r.page,partial:r.partial,items:(r.items||[]).map(i=>({{id:i.id,title:i.title,state:i.state,lifecycle:i.lifecycle,space:{{type:i.space?.type,cwd:i.space?.cwd,name:i.space?.name}},transport:i.transport,kind:i.kind,createdAt:i.createdAt,updatedAt:i.updatedAt,lastActivityAt:i.lastActivityAt}}))}}}})()"
            )
        } else {
            call
        };
        let v = self.evaluate(&expression).await?;
        ensure!(
            v["errorCode"].is_null(),
            "WorkBuddy rejected the desktop operation"
        );
        Ok(v)
    }
}
fn allowed(channel: &str) -> bool {
    matches!(
        channel,
        "wb:conversations:list"
            | "wb:conversations:get"
            | "wb:conversations:create"
            | "wb:conversations:requests"
            | "wb:conversations:requestEntries"
            | "wb:conversations:getPendingInfo"
            | "wb:conversations:sendPrompt"
            | "wb:conversations:cancel"
            | "wb:conversations:resolvePending"
            | "wb:conversations:configSetModel"
            | "wb:conversations:configSetThoughtLevel"
            | "wb:models:list"
            | "wb:conversations:childAgentSnapshots"
            | "wb:conversations:childAgentRequests"
            | "wb:conversations:loadToolDetail"
            | "wb:conversations:childAgentLoadToolDetail"
    )
}
fn imported(row: &Value, workspace: &Path) -> Option<Session> {
    let id = row["id"].as_str()?;
    if id.is_empty()
        || id.len() > 256
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b':'))
    {
        return None;
    }
    let cwd = row["space"]["cwd"].as_str()?;
    if row["transport"] != "local" || crate::files::within(workspace, Path::new(cwd)).is_err() {
        return None;
    }
    Some(Session {
        id: format!("workbuddy-{id}"),
        thread_id: Some(id.into()),
        title: row["title"].as_str().unwrap_or("WorkBuddy 会话").into(),
        cwd: cwd.into(),
        agent: AGENT.into(),
        model: None,
        policy: "manual".into(),
        status: state_status(&row["state"]).into(),
        archived: row["lifecycle"] == "archived",
        created_at: row["createdAt"].as_i64().unwrap_or_else(now),
        updated_at: row["updatedAt"].as_i64().unwrap_or_else(now),
        external: true,
        auxiliary: false,
    })
}
fn state_status(state: &Value) -> &'static str {
    match state.as_str().unwrap_or("") {
        "running" | "streaming" | "working" | "planning" | "prompting" => "running",
        "waiting" | "pending" | "waiting_permission" | "waiting_question" | "paused" => "waiting",
        "error" | "failed" => "error",
        _ => "idle",
    }
}
pub async fn sync(app: &Arc<App>) -> Result<()> {
    if !app.workbuddy.available() {
        if app.workbuddy.optional {
            return Ok(());
        }
        bail!("WorkBuddy launcher entry unavailable");
    }
    let mut last = app.workbuddy_sync.lock().await;
    if last.is_some_and(|t| t.elapsed() < Duration::from_secs(2)) {
        return Ok(());
    }
    *last = Some(std::time::Instant::now());
    let host = app.workbuddy.connect().await?;
    let mut page = 1;
    let mut rows = vec![];
    loop {
        let result = host
            .invoke(
                "wb:conversations:list",
                json!([{"page":page,"size":100,"transport":"local"}]),
            )
            .await?;
        ensure!(
            result["partial"] != true,
            "WorkBuddy catalog is still loading; previous sessions retained"
        );
        let items = result["items"]
            .as_array()
            .context("Invalid WorkBuddy conversation catalog")?;
        for row in items {
            if let Some(s) = imported(row, &app.workspace) {
                rows.push(s);
            }
        }
        if items.len() < 100 || page * 100 >= result["total"].as_u64().unwrap_or(0) {
            break;
        }
        page += 1;
        ensure!(page <= 1000, "WorkBuddy catalog exceeds safety limit");
    }
    // Preserve peer-local waiting/disconnected while applying coarse observations.
    for row in &rows {
        app.store.save_shared_observation(row)?;
    }
    Ok(())
}
pub async fn create(
    app: &Arc<App>,
    cwd: &str,
    title: Option<String>,
    model: Option<String>,
) -> Result<Session> {
    let host = app.workbuddy.connect().await?;
    let v = host
        .invoke(
            "wb:conversations:create",
            json!([{"transport":"local","cwd":cwd,"title":title,"model":model}]),
        )
        .await?;
    let s=imported(&v["info"],&app.workspace).context("WorkBuddy did not return a local conversation in the selected workspace; do not repeat creation")?;
    app.store.save_shared_observation(&s)?;
    Ok(s)
}
// Native projection and bridge below.

fn digest(v: &Value) -> String {
    use sha2::{Digest, Sha256};
    format!("{:x}", Sha256::digest(v.to_string().as_bytes()))
}
fn native_request_id() -> String {
    let mut bytes = *uuid::Uuid::new_v4().as_bytes();
    let time = (now() as u64).to_be_bytes();
    bytes[..6].copy_from_slice(&time[2..]);
    bytes[6] = (bytes[6] & 15) | 0x70;
    uuid::Uuid::from_bytes(bytes).simple().to_string()
}
fn text_blocks(v: &Value) -> String {
    v.as_array()
        .into_iter()
        .flatten()
        .filter_map(|b| {
            if b["type"] == "text" {
                b["text"].as_str()
            } else {
                None
            }
        })
        .collect::<Vec<_>>()
        .join("")
}
struct Projection {
    thread: String,
    generation: String,
    seen: HashMap<String, String>,
    lifecycle: HashMap<String, String>,
    pending: Option<(String, Value)>,
    clients: HashMap<String, String>,
    active: Option<String>,
    last_status: Option<String>,
}
impl Projection {
    fn new(thread: String) -> Self {
        Self {
            thread,
            generation: uuid::Uuid::new_v4().to_string(),
            seen: HashMap::new(),
            lifecycle: HashMap::new(),
            pending: None,
            clients: HashMap::new(),
            active: None,
            last_status: None,
        }
    }
    fn emit(
        &self,
        tx: &mpsc::UnboundedSender<Value>,
        method: &str,
        mut params: Value,
        key: Option<String>,
        time: Option<i64>,
        id: Option<Value>,
    ) -> Result<()> {
        params["threadId"] = json!(self.thread);
        if let Some(key) = key {
            params["sourceEventKey"] = json!(format!("workbuddy:{}:{key}", self.thread));
        }
        if let Some(time) = time {
            params["sourceEventTime"] = json!(time);
            params["history_item_started_at_ms"] = json!(time);
        }
        let mut event = json!({"method":method,"params":params});
        if let Some(id) = id {
            event["id"] = id;
        }
        tx.send(event).context("AnyWork WorkBuddy bridge detached")
    }
    fn records(&mut self, records: &[Value], tx: &mpsc::UnboundedSender<Value>) -> Result<()> {
        for r in records {
            let id = r["id"]
                .as_str()
                .context("WorkBuddy request missing identity")?;
            let revision = digest(r);
            if self.seen.get(id) == Some(&revision) {
                continue;
            }
            let time = r["timestamp"].as_i64();
            let status = match r["state"].as_str().unwrap_or("") {
                "pending" | "streaming" => "inProgress",
                "cancelled" | "interrupted" => "interrupted",
                "error" | "failed" => "failed",
                _ => "completed",
            };
            // The request id is the conversation's native turn identity.
            if !self.lifecycle.contains_key(id) {
                self.emit(
                    tx,
                    "turn/started",
                    json!({"turn":{"id":id,"startedAt":time.map(|t|t/1000)}}),
                    Some(format!("{id}:start")),
                    time,
                    None,
                )?;
            }
            let body = text_blocks(&r["userMessage"]["content"]);
            let mut images = vec![];
            let mut files = vec![];
            referenced_media(&r["userMessage"], &mut images, &mut files);
            let attachments = images.into_iter().chain(files).collect::<Vec<_>>();
            if !body.is_empty() || !attachments.is_empty() {
                self.emit(tx,"user/message",json!({"text":body,"attachments":attachments,"history_id":format!("{id}:user"),"history_turn_id":id,"clientUserMessageId":self.clients.get(id),"input":r["userMessage"]["content"]}),Some(format!("{id}:user")),time,None)?;
            }
            // Native hidden system/context messages are never user-visible chat.
            for (index, b) in r["assistantMessage"]["content"]
                .as_array()
                .into_iter()
                .flatten()
                .enumerate()
            {
                let native = b["toolCallId"]
                    .as_str()
                    .map(str::to_owned)
                    .unwrap_or_else(|| index.to_string());
                let item_id = format!("{id}:{native}");
                let item = match b["type"].as_str().unwrap_or("") {
                    "text" => {
                        json!({"id":item_id,"type":"agentMessage","text":b["text"],"phase":"final_answer"})
                    }
                    "thought" | "thinking" => {
                        json!({"id":item_id,"type":"reasoning","summary":[{"text":b["text"]}],"source":"workbuddy"})
                    }
                    "tool" => {
                        let name = b["_meta"]["codebuddy.ai/toolName"]
                            .as_str()
                            .or_else(|| b["name"].as_str())
                            .or_else(|| b["title"].as_str())
                            .unwrap_or("tool");
                        let tool_status = match b["status"].as_str().unwrap_or("") {
                            "completed" => "completed",
                            "failed" => "failed",
                            "cancelled" => "interrupted",
                            _ => {
                                if status == "inProgress" {
                                    "inProgress"
                                } else {
                                    status
                                }
                            }
                        };
                        json!({"id":item_id,"type":"dynamicToolCall","nativeCallId":b["toolCallId"],"tool":name,"name":name,"title":b["title"],"description":b["description"],"arguments":b["rawInput"],"output":b["rawOutput"],"content":b["content"],"contentItems":b["content"],"status":tool_status,"success":tool_status=="completed"})
                    }
                    "localFile" => {
                        json!({"id":item_id,"type":"agentMessage","text":format!("[{}](<{}>)",b["name"].as_str().unwrap_or("document"),b["path"].as_str().unwrap_or(""))})
                    }
                    "localImage" => {
                        if let Some(path) = b["path"].as_str() {
                            json!({"id":item_id,"type":"imageView","path":path,"status":"completed"})
                        } else {
                            continue;
                        }
                    }
                    _ => continue,
                };
                let complete = status != "inProgress"
                    || item["status"] == "completed"
                    || item["status"] == "failed";
                let method = if complete {
                    "item/completed"
                } else {
                    "item/started"
                };
                let key = format!(
                    "{id}:{native}:{}:{}",
                    if complete { "complete" } else { "snapshot" },
                    digest(&item)
                );
                self.emit(
                    tx,
                    method,
                    json!({"turnId":id,"history_turn_id":id,"history_item_id":item_id,"item":item}),
                    Some(key),
                    time,
                    None,
                )?;
                let mut images = vec![];
                let mut files = vec![];
                if b["type"] == "tool" {
                    referenced_media(b, &mut images, &mut files);
                }
                for path in images {
                    let media_id = format!("{item_id}:image:{}", digest(&json!(path)));
                    self.emit(
                        tx,
                        "item/completed",
                        json!({"turnId":id,"item":{"id":media_id,"type":"imageView","path":path}}),
                        Some(media_id),
                        time,
                        None,
                    )?;
                }
                if !files.is_empty() {
                    let media_id = format!("{item_id}:documents");
                    let text = files
                        .iter()
                        .map(|p| {
                            format!(
                                "[{}](<{}>)",
                                Path::new(p)
                                    .file_name()
                                    .and_then(|s| s.to_str())
                                    .unwrap_or("document"),
                                p
                            )
                        })
                        .collect::<Vec<_>>()
                        .join("\n");
                    self.emit(tx,"item/completed",json!({"turnId":id,"item":{"id":media_id,"type":"agentMessage","text":text}}),Some(media_id),time,None)?;
                }
            }
            if status == "inProgress" {
                self.active = Some(id.into());
            } else {
                if self.active.as_deref() == Some(id) {
                    self.active = None;
                }
                if self
                    .lifecycle
                    .get(id)
                    .is_none_or(|previous| previous != status)
                {
                    self.emit(tx,"turn/completed",json!({"turn":{"id":id,"status":status,"error":r["terminalError"]},"nativeState":r["state"]}),Some(format!("{id}:end:{status}")),r["finishTimestamp"].as_i64().or(time),None)?;
                }
            }
            self.lifecycle.insert(id.into(), status.into());
            self.seen.insert(id.into(), revision);
        }
        Ok(())
    }
    fn pending(&mut self, native: Value, tx: &mpsc::UnboundedSender<Value>) -> Result<()> {
        if self.pending.as_ref().is_some_and(|(_, p)| p == &native) {
            return Ok(());
        }
        if let Some((id, _)) = self.pending.take() {
            self.emit(
                tx,
                "serverRequest/resolved",
                json!({"requestId":id,"reason":"native_changed"}),
                None,
                None,
                None,
            )?;
        }
        let Some(id) = native["id"].as_str() else {
            return Ok(());
        };
        let local = format!("workbuddy:{}:{}:{}", self.thread, self.generation, id);
        let (method, params) = if native["category"] == "question" {
            let questions=native["questions"].as_array().context("WorkBuddy questions missing")?.iter().map(|q|json!({"id":q["id"],"header":q["header"],"question":q["question"],"options":q["options"],"multiSelect":q["multiSelect"],"isOther":true})).collect::<Vec<_>>();
            ("item/tool/requestUserInput", json!({"questions":questions}))
        } else {
            let opts = native["options"].as_array().cloned().unwrap_or_default();
            let mut decisions = vec![];
            let supported = matches!(native["category"].as_str(), Some("tool" | "mcpConnection"));
            if supported && opts.iter().any(|o| o["kind"] == "allow_once") {
                decisions.push("accept");
            }
            if supported && opts.iter().any(|o| o["kind"] == "reject_once") {
                decisions.push("decline");
            }
            // Unsupported interactive flows remain visibly waiting; never invent
            // a permission option or mutate a plan/account/payment flow.
            (
                "item/commandExecution/requestApproval",
                json!({"command":native["toolName"],"reason":native["metadata"]["sandbox"]["description"],"availableDecisions":decisions,"nativeCategory":native["category"]}),
            )
        };
        self.emit(tx, method, params, None, None, Some(json!(local)))?;
        self.pending = Some((local, native));
        Ok(())
    }
    fn disconnect(&mut self, tx: &mpsc::UnboundedSender<Value>) -> Result<()> {
        if let Some((id, _)) = self.pending.take() {
            self.emit(
                tx,
                "serverRequest/resolved",
                json!({"requestId":id,"reason":"connection_lost"}),
                None,
                None,
                None,
            )?;
        }
        self.active = None;
        self.last_status = None;
        self.emit(
            tx,
            "connection/interrupted",
            json!({"message":"WorkBuddy 桌面连接中断，正在重新连接；未重新发送消息"}),
            None,
            None,
            None,
        )
    }
}
async fn read_records(host: &Carrier, thread: &str, all: bool) -> Result<Vec<Value>> {
    if let Some(child) = parse_child(thread) {
        let mut before = Value::Null;
        let mut records = vec![];
        loop {
            let page=host.invoke("wb:conversations:childAgentRequests",json!([child.parent,child.projection,{"byteLength":512*1024,"beforeRequestId":before}])).await?;
            let rows = page["items"]
                .as_array()
                .context("Invalid WorkBuddy child history")?;
            let first = rows
                .first()
                .and_then(|r| r["id"].as_str())
                .map(str::to_owned);
            let mut batch = rows
                .iter()
                .filter(|r| !records.iter().any(|old: &Value| old["id"] == r["id"]))
                .cloned()
                .collect::<Vec<_>>();
            batch.append(&mut records);
            records = batch;
            if !all || page["hasOlder"] != true {
                break;
            }
            let first = first.context("WorkBuddy child history cursor missing")?;
            ensure!(before != first, "WorkBuddy child history cursor repeated");
            before = json!(first);
            ensure!(
                records.len() < 100_000,
                "WorkBuddy child history exceeds safety limit"
            );
        }
        return Ok(records);
    }
    let mut before = Value::Null;
    let mut collected = Vec::new();
    let mut attempts = 0;
    loop {
        let page=host.invoke("wb:conversations:requestEntries",json!([thread,{"byteLength":512*1024,"beforeRequestId":before,"resultScope":"page"}])).await?;
        if page["historyReady"] == false && page["historyKnownEmpty"] != true && before.is_null() {
            attempts += 1;
            ensure!(
                attempts < 100,
                "WorkBuddy history is still loading; retry connection"
            );
            tokio::time::sleep(Duration::from_millis(100)).await;
            continue;
        }
        let rows = page["requests"]
            .as_array()
            .context("Invalid WorkBuddy request history")?;
        let first = rows
            .first()
            .and_then(|r| r["id"].as_str())
            .map(str::to_owned);
        let mut unique = rows
            .iter()
            .filter(|r| !collected.iter().any(|old: &Value| old["id"] == r["id"]))
            .cloned()
            .collect::<Vec<_>>();
        unique.append(&mut collected);
        collected = unique;
        if !all || page["hasOlder"] != true {
            break;
        }
        let first = first.context("WorkBuddy history cursor missing")?;
        ensure!(before != first, "WorkBuddy history cursor repeated");
        before = json!(first);
        ensure!(
            collected.len() < 100_000,
            "WorkBuddy history exceeds safety limit"
        );
    }
    Ok(collected)
}
fn media_pointers(value: &Value, prefix: &str, out: &mut Vec<String>) {
    match value {
        Value::Object(map) => {
            if matches!(
                value["type"].as_str(),
                Some("image" | "resource_link" | "resource")
            ) {
                out.push(prefix.into());
            }
            for (key, child) in map {
                media_pointers(
                    child,
                    &format!("{prefix}/{}", key.replace('~', "~0").replace('/', "~1")),
                    out,
                );
            }
        }
        Value::Array(items) => {
            for (i, child) in items.iter().enumerate() {
                media_pointers(child, &format!("{prefix}/{i}"), out);
            }
        }
        _ => {}
    }
}
async fn materialize_blocks(app: &App, session: &Session, records: &mut [Value]) -> Result<()> {
    use base64::Engine;
    for r in records {
        let mut pointers = vec![];
        media_pointers(r, "", &mut pointers);
        for pointer in pointers {
            let Some(b) = r.pointer_mut(&pointer) else {
                continue;
            };
            let image = b["type"] == "image";
            let path = if image && b["data"].is_string() {
                let data = b["data"].as_str().unwrap();
                ensure!(data.len() < 28 * 1024 * 1024, "WorkBuddy image too large");
                let bytes = base64::engine::general_purpose::STANDARD
                    .decode(data)
                    .context("Invalid WorkBuddy image data")?;
                ensure!(bytes.len() <= 20 * 1024 * 1024, "WorkBuddy image too large");
                let dir = app.data_dir.join("uploads").join(&session.id);
                tokio::fs::create_dir_all(&dir).await?;
                let path = dir.join(format!("workbuddy-{}.png", digest(&json!(data))));
                if !path.exists() {
                    tokio::fs::write(&path, bytes).await?;
                }
                Some(path)
            } else {
                b["_meta"]["filePath"]
                    .as_str()
                    .or_else(|| b["uri"].as_str())
                    .and_then(|raw| {
                        if raw.starts_with("file:") {
                            Url::parse(raw).ok().and_then(|u| u.to_file_path().ok())
                        } else {
                            Some(PathBuf::from(raw))
                        }
                    })
                    .filter(|p| p.is_absolute())
            };
            if let Some(path) = path {
                *b = json!({"type":if image{"localImage"}else{"localFile"},"path":path,"name":path.file_name().and_then(|s|s.to_str())});
            }
        }
    }
    Ok(())
}
fn referenced_media(value: &Value, images: &mut Vec<String>, files: &mut Vec<String>) {
    if let Some(path) = value["path"].as_str() {
        match value["type"].as_str() {
            Some("localImage") => images.push(path.into()),
            Some("localFile") => files.push(path.into()),
            _ => {}
        }
    }
    match value {
        Value::Object(m) => {
            for v in m.values() {
                referenced_media(v, images, files)
            }
        }
        Value::Array(a) => {
            for v in a {
                referenced_media(v, images, files)
            }
        }
        _ => {}
    }
}
async fn snapshot(
    app: &App,
    session: &Session,
    host: &Carrier,
    state: &mut Projection,
    tx: &mpsc::UnboundedSender<Value>,
    all: bool,
) -> Result<()> {
    let mut records = read_records(host, &state.thread, all).await?;
    materialize_blocks(app, session, &mut records).await?;
    state.records(&records, tx)?;
    let pending = if session.auxiliary {
        Value::Null
    } else {
        host.invoke("wb:conversations:getPendingInfo", json!([state.thread]))
            .await?
    };
    let observation = digest(&json!([records, pending]));
    state.pending(pending, tx)?;
    if !session.auxiliary {
        observe_children(app, session, host, state, tx).await?;
    }
    let status = if state.pending.is_some() {
        "waiting"
    } else if state.active.is_some() {
        "running"
    } else {
        "idle"
    };
    let status_key = format!("{status}:{observation}");
    if state.last_status.as_deref() != Some(&status_key) {
        state.emit(tx,"thread/status/changed",json!({"turnId":state.active,"status":{"type":if status=="idle"{"idle"}else{"active"},"activeFlags":if status=="waiting"{vec!["waitingOnApproval"]}else{vec![]}}}),None,None,None)?;
        state.last_status = Some(status_key);
    }
    Ok(())
}
pub async fn attach(
    app: &Arc<App>,
    session: &Session,
) -> Result<(Arc<RpcProcess>, mpsc::UnboundedReceiver<Value>, bool)> {
    let host = app.workbuddy.connect().await?;
    let thread = session
        .thread_id
        .clone()
        .context("Missing WorkBuddy conversation id")?;
    if session.auxiliary {
        ensure!(
            parse_child(&thread).is_some(),
            "Invalid WorkBuddy child reference"
        );
    } else {
        let view = host.invoke("wb:conversations:get", json!([thread])).await?;
        ensure!(
            view["info"]["id"] == thread && view["info"]["transport"] == "local",
            "WorkBuddy conversation identity mismatch"
        );
    }
    let mut state = Projection::new(thread);
    let (initial, mut initial_events) = mpsc::unbounded_channel();
    snapshot(app, session, &host, &mut state, &initial, true).await?;
    while let Ok(event) = initial_events.try_recv() {
        app.emit(
            &session.id,
            event["method"].as_str().unwrap(),
            event["params"].clone(),
            event.get("id").filter(|v| !v.is_null()).cloned(),
        );
    }
    app.store.set_status(
        &session.id,
        if state.pending.is_some() {
            "waiting"
        } else if state.active.is_some() {
            "running"
        } else {
            "idle"
        },
    )?;
    let (rpc, events, mut bridge) = RpcProcess::bridge();
    let app = app.clone();
    let session = session.clone();
    tokio::spawn(async move {
        let mut host = host;
        let tx = bridge.responses.clone();
        let mut tick = tokio::time::interval(Duration::from_millis(500));
        loop {
            tokio::select! {
                request=bridge.requests.recv()=>{
                    let Some(request)=request else{break};let Some(v)=request.value else{let _=request.accepted.send(Ok(()));break};
                    let result=handle(&app,&session,&host,&mut state,&tx,&v).await;
                    if let Some(id)=v.get("id") && v["method"].is_string(){
                        let response=match &result{Ok(value)=>json!({"id":id,"result":value}),Err(e)=>json!({"id":id,"error":{"message":e.to_string()}})};
                        let _=tx.send(response);
                    }
                    let _=request.accepted.send(result.map(|_|()));
                }
                _=tick.tick()=>{
                    if snapshot(&app,&session,&host,&mut state,&tx,false).await.is_err(){
                        if state.disconnect(&tx).is_err(){break;}
                        // Never retransmit commands. Reattach only read snapshots.
                        loop {
                            tokio::select! {
                                request=bridge.requests.recv()=>{
                                    let Some(request)=request else{return};
                                    if request.value.is_none(){let _=request.accepted.send(Ok(()));return;}
                                    let _=request.accepted.send(Err(anyhow::anyhow!("WorkBuddy desktop disconnected; wait for reconnection")));
                                }
                                _=tokio::time::sleep(Duration::from_secs(1))=>{
                                    if let Ok(next)=app.workbuddy.connect().await {
                                        let mut new_state=Projection::new(state.thread.clone());new_state.clients=std::mem::take(&mut state.clients);
                                        if snapshot(&app,&session,&next,&mut new_state,&tx,true).await.is_ok(){host=next;state=new_state;break;}
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        // Dropping our CDP carrier detaches only us. No cancel/dispose/close RPC.
    });
    Ok((rpc, events, false))
}
fn public_models(v: &Value) -> Result<Vec<Value>> {
    Ok(v["items"].as_array().context("Invalid WorkBuddy model catalog")?.iter().filter(|m|m["disabled"]!=true).map(|m|{
        let efforts=m["reasoning"]["supportedEfforts"].as_array().into_iter().flatten().filter_map(Value::as_str).map(|e|json!({"reasoningEffort":e,"description":e})).collect::<Vec<_>>();
        json!({"id":m["id"],"model":m["id"],"displayName":m["name"],"description":m["description"],"isDefault":m["isDefault"],"supportedReasoningEfforts":efforts,"supportsImages":m["supportsImages"]})
    }).collect())
}
async fn handle(
    app: &App,
    session: &Session,
    host: &Carrier,
    state: &mut Projection,
    tx: &mpsc::UnboundedSender<Value>,
    v: &Value,
) -> Result<Value> {
    if v["method"].is_null() {
        let id = v["id"]
            .as_str()
            .context("WorkBuddy response identity missing")?;
        let (local, pending) = state
            .pending
            .as_ref()
            .context("WorkBuddy interaction is no longer pending")?;
        ensure!(
            local == id,
            "Stale WorkBuddy interaction; refresh this conversation"
        );
        let current = host
            .invoke("wb:conversations:getPendingInfo", json!([state.thread]))
            .await?;
        ensure!(
            current == *pending,
            "WorkBuddy interaction changed; refresh before answering"
        );
        let result = if pending["category"] == "question" {
            let mut answers = serde_json::Map::new();
            let supplied = v["result"]["answers"]
                .as_object()
                .context("WorkBuddy question answers missing")?;
            for q in pending["questions"]
                .as_array()
                .context("Invalid native questions")?
            {
                let qid = q["id"]
                    .as_str()
                    .context("Native question identity missing")?;
                let values = supplied
                    .get(qid)
                    .and_then(|v| v["answers"].as_array())
                    .context("WorkBuddy question answer missing")?;
                ensure!(
                    values.iter().all(Value::is_string)
                        && (q["multiSelect"] == true || values.len() == 1),
                    "Invalid WorkBuddy question selection"
                );
                answers.insert(qid.into(), json!(values));
            }
            // Native questionExt has no permission options and accepts answers.
            let allow = pending["options"]
                .as_array()
                .and_then(|a| a.iter().find(|o| o["kind"] == "allow_once"))
                .map(|o| o["optionId"].clone());
            let mut response = json!({"answers":answers});
            if let Some(allow) = allow {
                response["optionId"] = allow;
            }
            response
        } else {
            ensure!(
                matches!(pending["category"].as_str(), Some("tool" | "mcpConnection")),
                "This WorkBuddy interaction requires the desktop; no response was sent"
            );
            let kind = match v["result"]["decision"].as_str() {
                Some("accept") => "allow_once",
                Some("decline") => "reject_once",
                _ => bail!("Only one-time WorkBuddy allow/deny is supported"),
            };
            let option = pending["options"]
                .as_array()
                .and_then(|opts| opts.iter().find(|o| o["kind"] == kind))
                .context("WorkBuddy did not offer this permission choice")?;
            json!({"optionId":option["optionId"]})
        };
        host.invoke(
            "wb:conversations:resolvePending",
            json!([state.thread, pending["id"], result]),
        )
        .await?;
        let previous = pending["id"].clone();
        let confirmed = host
            .invoke("wb:conversations:getPendingInfo", json!([state.thread]))
            .await?;
        ensure!(
            confirmed["id"] != previous,
            "WorkBuddy did not confirm interaction resolution; do not resend"
        );
        state.pending = None;
        return Ok(json!({}));
    }
    let p = &v["params"];
    if session.auxiliary {
        ensure!(
            matches!(
                v["method"].as_str(),
                Some(
                    "thread/start"
                        | "thread/resume"
                        | "anywork/session/state"
                        | "thread/read"
                        | "anywork/item/detail"
                )
            ),
            "WorkBuddy child conversations are read-only; no command was sent"
        );
    }
    if let Some(thread) = p["threadId"].as_str() {
        ensure!(
            thread == state.thread,
            "WorkBuddy session identity mismatch"
        );
    }
    match v["method"].as_str().unwrap_or("") {
        "thread/start" | "thread/resume" => {
            if session.auxiliary {
                return Ok(json!({"thread":{"id":state.thread}}));
            }
            let s = host
                .invoke("wb:conversations:get", json!([state.thread]))
                .await?;
            Ok(
                json!({"thread":{"id":state.thread},"model":s["configManager"]["model"],"reasoningEffort":s["configManager"]["thoughtLevel"]}),
            )
        }
        "anywork/session/state" => {
            snapshot(app, session, host, state, tx, false).await?;
            Ok(
                json!({"threadId":state.thread,"turnId":state.active,"status":if state.pending.is_some(){"waiting"}else if state.active.is_some(){"running"}else{"idle"}}),
            )
        }
        "anywork/session/settings" => {
            let s = host
                .invoke("wb:conversations:get", json!([state.thread]))
                .await?;
            Ok(
                json!({"model":s["configManager"]["model"],"reasoningEffort":s["configManager"]["thoughtLevel"]}),
            )
        }
        "model/list" => Ok(
            json!({"data":public_models(&host.invoke("wb:models:list",json!([{"scope":"conversation"}])).await?)?,"nextCursor":null}),
        ),
        "anywork/item/detail" => {
            let mut item = p["item"].clone();
            let call = item["nativeCallId"]
                .as_str()
                .context("Native tool identity unavailable")?;
            let detail = if let Some(child) = parse_child(&state.thread) {
                host.invoke(
                    "wb:conversations:childAgentLoadToolDetail",
                    json!([child.parent, child.projection, call]),
                )
                .await?
            } else {
                host.invoke(
                    "wb:conversations:loadToolDetail",
                    json!([state.thread, call]),
                )
                .await?
            };
            if detail.is_null() {
                return Ok(json!({"item":item}));
            }
            if let Some(native) = detail["toolCallId"].as_str() {
                ensure!(native == call, "WorkBuddy tool detail identity mismatch");
            }
            let mut record = json!({"assistantMessage":{"content":[detail]}});
            materialize_blocks(app, session, std::slice::from_mut(&mut record)).await?;
            let detail = &record["assistantMessage"]["content"][0];
            for (source, target) in [
                ("rawInput", "arguments"),
                ("rawOutput", "output"),
                ("content", "content"),
                ("content", "contentItems"),
            ] {
                if let Some(value) = detail.get(source) {
                    item[target] = value.clone();
                }
            }
            state.emit(
                tx,
                "item/completed",
                json!({"turnId":p["turnId"],"item":item}),
                Some(format!("detail:{}:{}", item["id"], digest(&item))),
                None,
                None,
            )?;
            Ok(json!({"item":item}))
        }
        "thread/settings/update" => {
            ensure!(
                p["collaborationMode"].is_null() && p["serviceTier"].is_null(),
                "WorkBuddy plan/service tiers are unsupported"
            );
            let catalog = public_models(
                &host
                    .invoke("wb:models:list", json!([{"scope":"conversation"}]))
                    .await?,
            )?;
            let model = p["model"].as_str().context("Select a WorkBuddy model")?;
            let entry = catalog
                .iter()
                .find(|m| m["model"] == model)
                .context("Model is not in the WorkBuddy catalog")?;
            if let Some(effort) = p["effort"].as_str() {
                ensure!(
                    entry["supportedReasoningEfforts"]
                        .as_array()
                        .is_some_and(|a| a.iter().any(|e| e["reasoningEffort"] == effort)),
                    "Unsupported WorkBuddy thought level"
                );
            }
            host.invoke(
                "wb:conversations:configSetModel",
                json!([state.thread, model]),
            )
            .await?;
            if let Some(effort) = p["effort"].as_str() {
                host.invoke(
                    "wb:conversations:configSetThoughtLevel",
                    json!([state.thread, effort]),
                )
                .await?;
            }
            let after = host
                .invoke("wb:conversations:get", json!([state.thread]))
                .await?;
            ensure!(
                after["configManager"]["model"] == model
                    && (p["effort"].is_null()
                        || after["configManager"]["thoughtLevel"] == p["effort"]),
                "WorkBuddy did not confirm model settings; refresh before retrying"
            );
            Ok(json!({}))
        }
        "turn/start" | "turn/steer" => {
            use base64::Engine;
            let mut content = vec![];
            for part in p["input"].as_array().context("Invalid WorkBuddy input")? {
                match part["type"].as_str() {
                    Some("text") => content.push(json!({"type":"text","text":part["text"]})),
                    Some("localImage") => {
                        let path =
                            PathBuf::from(part["path"].as_str().context("Image path missing")?);
                        let bytes = tokio::fs::read(&path).await?;
                        ensure!(bytes.len() <= 20 * 1024 * 1024, "Image exceeds 20 MiB");
                        let mime = if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
                            "image/png"
                        } else if bytes.starts_with(b"\xff\xd8\xff") {
                            "image/jpeg"
                        } else if bytes.starts_with(b"GIF8") {
                            "image/gif"
                        } else if bytes.starts_with(b"RIFF") {
                            "image/webp"
                        } else {
                            bail!("Unsupported WorkBuddy image format")
                        };
                        content.push(json!({"type":"image","data":base64::engine::general_purpose::STANDARD.encode(bytes),"mimeType":mime,"_meta":{"filePath":path,"filename":path.file_name().and_then(|p|p.to_str())}}));
                    }
                    Some("localFile") => {
                        let path =
                            PathBuf::from(part["path"].as_str().context("File path missing")?);
                        content.push(json!({"type":"resource_link","uri":Url::from_file_path(&path).map_err(|_|anyhow::anyhow!("Invalid WorkBuddy file path"))?.to_string(),"name":path.file_name().and_then(|p|p.to_str())}));
                    }
                    _ => bail!("Unsupported WorkBuddy attachment"),
                }
            }
            let id = native_request_id();
            let client = p["clientUserMessageId"].as_str().unwrap_or(&id).to_string();
            let options = json!({"clientRequestId":client,"clientTimestamp":now(),"_expectQueueReceipt":true,"queueDelivery":if v["method"]=="turn/steer"{"steer"}else{"queue"},"_meta":{"codebuddy.ai/conversationRequestId":id}});
            // Remember exact metadata before submission; native echo can race return.
            state.clients.insert(id.clone(), client);
            let receipt = host
                .invoke(
                    "wb:conversations:sendPrompt",
                    json!([state.thread, content, options]),
                )
                .await?;
            snapshot(app, session, host, state, tx, false).await?;
            Ok(
                json!({"turn":{"id":id,"status":"inProgress"},"nativeDisposition":receipt["disposition"]}),
            )
        }
        "turn/interrupt" => {
            // The caller already bound the active native turn. Recheck because
            // native cancel only takes conversation id, not an expected turn.
            snapshot(app, session, host, state, tx, false).await?;
            ensure!(
                p["turnId"].as_str() == state.active.as_deref(),
                "WorkBuddy active turn changed; cancellation was not sent"
            );
            host.invoke("wb:conversations:cancel", json!([state.thread]))
                .await?;
            Ok(json!({}))
        }
        "thread/read" => {
            snapshot(app, session, host, state, tx, false).await?;
            Ok(
                json!({"thread":{"id":state.thread,"status":{"type":if state.active.is_some(){"active"}else{"idle"}}}}),
            )
        }
        _ => bail!("WorkBuddy operation is unsupported; no desktop command was sent"),
    }
}

#[derive(serde::Serialize, Deserialize)]
struct ChildRef {
    workbuddy_child: bool,
    parent: String,
    projection: String,
    native: String,
}
fn parse_child(thread: &str) -> Option<ChildRef> {
    serde_json::from_str::<ChildRef>(thread)
        .ok()
        .filter(|r| r.workbuddy_child && !r.parent.is_empty() && !r.projection.is_empty())
}
async fn observe_children(
    app: &App,
    parent: &Session,
    host: &Carrier,
    state: &mut Projection,
    tx: &mpsc::UnboundedSender<Value>,
) -> Result<()> {
    let children = host
        .invoke(
            "wb:conversations:childAgentSnapshots",
            json!([state.thread]),
        )
        .await?;
    for c in children
        .as_array()
        .context("Invalid WorkBuddy child snapshot")?
    {
        let Some(projection) = c["projectionId"].as_str() else {
            continue;
        };
        let Some(native) = c["conversationid"].as_str() else {
            continue;
        };
        let reference = serde_json::to_string(&ChildRef {
            workbuddy_child: true,
            parent: state.thread.clone(),
            projection: projection.into(),
            native: native.into(),
        })?;
        let id = format!("workbuddy-child-{}", digest(&json!(reference)));
        let mut session = Session {
            id,
            thread_id: Some(reference.clone()),
            title: c["agentType"]
                .as_str()
                .or_else(|| c["teamName"].as_str())
                .unwrap_or("WorkBuddy 子 Agent")
                .into(),
            cwd: parent.cwd.clone(),
            agent: AGENT.into(),
            model: None,
            policy: "manual".into(),
            status: if c["state"] == "running" {
                "running"
            } else {
                "idle"
            }
            .into(),
            archived: false,
            created_at: parent.created_at,
            updated_at: parent.updated_at,
            external: true,
            auxiliary: true,
        };
        if let Ok(old) = app.store.session(&session.id) {
            session.created_at = old.created_at;
        }
        app.store.save_shared_observation(&session)?;
        let item = json!({"id":format!("workbuddy-child-{projection}"),"type":"collabAgentToolCall","tool":"wait","status":if c["state"]=="running"{"inProgress"}else{"completed"},"receiverThreadIds":[reference],"receiverThreads":[{"threadId":reference,"thread":{"name":session.title,"status":c["state"],"canInteract":false}}]});
        state.emit(
            tx,
            "item/completed",
            json!({"turnId":c["parentRequestId"],"item":item}),
            Some(format!("child:{projection}:{}", digest(c))),
            None,
            None,
        )?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    #[ignore = "requires an explicitly supplied isolated WorkBuddy descriptor; never discovers real profiles"]
    async fn isolated_native_desktop_read_contract() {
        let path = std::env::var_os("ANYWORK_TEST_WORKBUDDY_DESCRIPTOR")
            .expect("explicit isolated descriptor required");
        let config = Config::configured(Some(PathBuf::from(path))).unwrap();
        let host = config.connect().await.unwrap();
        let listed = host
            .invoke(
                "wb:conversations:list",
                json!([{"transport":"local","page":1,"size":10}]),
            )
            .await
            .unwrap();
        assert!(listed["items"].is_array());
        assert!(listed["total"].is_number());
        let models = host
            .invoke("wb:models:list", json!([{"scope":"conversation"}]))
            .await
            .unwrap();
        let public = public_models(&models).unwrap();
        assert!(!models.to_string().contains("apiKey"));
        println!(
            "Isolated native WorkBuddy read contract passed: {} conversations, {} public models",
            listed["items"].as_array().unwrap().len(),
            public.len()
        );
    }
    fn record(id: &str, state: &str) -> Value {
        json!({"id":id,"timestamp":1700000000123i64,"state":state,"userMessage":{"content":[{"type":"text","text":"visible"}]},"systemMessage":{"content":[{"type":"text","text":"HIDDEN SYSTEM CONTEXT"}]},"assistantMessage":{"content":[{"type":"text","text":"answer"},{"type":"tool","toolCallId":"reused-call","status":"completed","_meta":{"codebuddy.ai/toolName":"read_file"},"rawInput":{"path":"/tmp/file"},"rawOutput":"output"}]}})
    }
    fn drain(rx: &mut mpsc::UnboundedReceiver<Value>) -> Vec<Value> {
        let mut events = vec![];
        while let Ok(v) = rx.try_recv() {
            events.push(v)
        }
        events
    }
    #[test]
    fn snapshots_preserve_native_identity_hide_context_and_do_not_repeat_lifecycle() {
        let (mut p, (tx, mut rx)) = (Projection::new("parent".into()), mpsc::unbounded_channel());
        let mut r = record("r1", "streaming");
        p.records(&[r.clone()], &tx).unwrap();
        let first = drain(&mut rx);
        assert!(first.iter().all(|v| v.get("id").is_none()));
        assert!(
            !first
                .iter()
                .any(|v| v.to_string().contains("HIDDEN SYSTEM CONTEXT"))
        );
        p.records(&[r.clone()], &tx).unwrap();
        assert!(drain(&mut rx).is_empty());
        r["assistantMessage"]["content"][0]["text"] = json!("answer continued");
        p.records(&[r.clone()], &tx).unwrap();
        let next = drain(&mut rx);
        assert!(!next.iter().any(|v| v["method"] == "turn/started"));
        assert_eq!(
            next.iter()
                .find(|v| v["params"]["item"]["type"] == "agentMessage")
                .unwrap()["params"]["item"]["id"],
            "r1:0"
        );
        r["state"] = json!("cancelled");
        p.records(&[r.clone()], &tx).unwrap();
        let end = drain(&mut rx);
        assert_eq!(
            end.iter()
                .find(|v| v["method"] == "turn/completed")
                .unwrap()["params"]["turn"]["status"],
            "interrupted"
        );
        let second = record("r2", "completed");
        p.records(&[second], &tx).unwrap();
        let second = drain(&mut rx);
        let tools = first
            .iter()
            .chain(second.iter())
            .filter(|v| v["params"]["item"]["type"] == "dynamicToolCall")
            .map(|v| v["params"]["item"]["id"].clone())
            .collect::<Vec<_>>();
        assert_ne!(tools[0], tools[1]);
    }
    #[test]
    fn connection_generation_invalidates_local_permissions_before_interrupted() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let mut p = Projection::new("p".into());
        let pending = json!({"id":"permission","category":"tool","toolName":"bash","options":[{"optionId":"yes","kind":"allow_once"},{"optionId":"no","kind":"reject_once"},{"optionId":"forever","kind":"allow_always"}]});
        p.pending(pending.clone(), &tx).unwrap();
        let old = drain(&mut rx);
        assert_eq!(
            old[0]["params"]["availableDecisions"],
            json!(["accept", "decline"])
        );
        p.pending(pending.clone(), &tx).unwrap();
        assert!(drain(&mut rx).is_empty());
        p.disconnect(&tx).unwrap();
        let closed = drain(&mut rx);
        assert_eq!(closed[0]["method"], "serverRequest/resolved");
        assert_eq!(closed[0]["params"]["requestId"], old[0]["id"]);
        assert_eq!(closed[1]["method"], "connection/interrupted");
        let mut next = Projection::new("p".into());
        next.pending(pending, &tx).unwrap();
        let new = drain(&mut rx);
        assert_ne!(old[0]["id"], new[0]["id"]);
        let mut other = Projection::new("other".into());
        other
            .pending(
                json!({"id":"permission","category":"tool","options":[]}),
                &tx,
            )
            .unwrap();
        assert_ne!(old[0]["id"], drain(&mut rx)[0]["id"]);
    }
    #[test]
    fn endpoint_and_target_checks_reject_untrusted_urls_without_echoing_them() {
        for raw in [
            "https://127.0.0.1:9/",
            "http://example.com/",
            "http://127.0.0.1:9/?token=DO_NOT_PRINT",
            "http://user:SECRET@127.0.0.1:9/",
            "http://127.0.0.1:9/path",
            "http://localhost:9/",
        ] {
            let e = endpoint(raw, "http").unwrap_err().to_string();
            assert!(!e.contains("SECRET") && !e.contains("DO_NOT_PRINT"));
        }
        assert!(endpoint("http://127.0.0.1:9/", "http").is_ok());
        assert!(endpoint("http://[::1]:9/", "http").is_ok());
        assert!(trusted_target(
            &json!({"type":"page","url":"file:///Applications/WorkBuddy.app/Contents/Resources/app.asar/renderer/index.html?account=private"})
        ));
        for url in [
            "https://example.com/app.asar/renderer/index.html",
            "file:///tmp/app.asar/other/index.html",
            "file:///tmp/index.html",
        ] {
            assert!(!trusted_target(&json!({"type":"page","url":url})));
        }
        assert!(!allowed("wb:account:login"));
        assert!(!allowed("wb:conversations:dispose"));
        assert!(!allowed("wb:internal:conversation-event-subscription"));
    }
    #[test]
    fn native_request_ids_match_desktop_canonical_v7_contract() {
        let a = native_request_id();
        let b = native_request_id();
        assert_ne!(a, b);
        assert!(
            regex::Regex::new("^[0-9a-f]{12}7[0-9a-f]{3}[89ab][0-9a-f]{15}$")
                .unwrap()
                .is_match(&a)
        );
    }
    #[test]
    fn public_models_are_a_whitelist_with_native_reasoning_levels() {
        let v = json!({"items":[{"id":"m","name":"Model","apiKey":"secret","url":"https://private-provider","reasoning":{"supportedEfforts":["low","high"]}},{"id":"disabled","disabled":true}]});
        let models = public_models(&v).unwrap();
        assert_eq!(models.len(), 1);
        assert_eq!(
            models[0]["supportedReasoningEfforts"][1]["reasoningEffort"],
            "high"
        );
        assert!(!json!(models).to_string().contains("secret"));
    }
    #[test]
    fn imported_catalog_never_inherits_codex_global_scope() {
        let root = std::env::current_dir().unwrap();
        let row = json!({"id":"native","transport":"local","space":{"cwd":root},"title":"Native","state":"working","lifecycle":"archived","createdAt":1,"updatedAt":2});
        let s = imported(&row, &root).unwrap();
        assert!(s.external && s.archived);
        assert_eq!(s.agent, AGENT);
        assert_eq!(s.status, "running");
        assert_eq!(s.updated_at, 2);
        let mut outside = row.clone();
        outside["space"]["cwd"] = json!(root.parent().unwrap());
        assert!(imported(&outside, &root).is_none());
        outside = row;
        outside["id"] = json!("../../escape");
        assert!(imported(&outside, &root).is_none());
    }
    #[cfg(unix)]
    #[test]
    fn descriptor_permissions_symlinks_and_reloads_are_enforced() {
        use std::os::unix::fs::{PermissionsExt, symlink};
        let root = std::env::temp_dir()
            .canonicalize()
            .unwrap()
            .join(format!("anywork-wb-descriptor-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o700)).unwrap();
        let path = root.join("host.json");
        let write = |browser: &str| {
            std::fs::write(&path,json!({"version":1,"agent":AGENT,"appVersion":"5.9.3","pid":123,"url":"http://127.0.0.1:9/","browserId":browser,"configDir":root,"instanceId":uuid::Uuid::new_v4().to_string()}).to_string()).unwrap();
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        };
        write("one");
        let c = Config::configured(Some(path.clone())).unwrap();
        assert_eq!(c.descriptor().unwrap().browser_id, "one");
        write("two");
        assert_eq!(c.descriptor().unwrap().browser_id, "two");
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        assert!(!c.available());
        std::fs::remove_file(&path).unwrap();
        let real = root.join("real.json");
        std::fs::write(&real, "{}").unwrap();
        symlink(&real, &path).unwrap();
        assert!(!c.available());
        std::fs::remove_dir_all(root).unwrap();
    }
}
