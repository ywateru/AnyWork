use crate::{
    AccountVerifier,
    auth::now,
    protocol::{self, Authentication, CHUNK, Incoming, MAX_BODY},
};
use anyhow::{Result, bail};
use axum::{
    Router,
    extract::{
        State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
};
use base64::{Engine, engine::general_purpose::STANDARD};
use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, HashMap},
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::{
    net::TcpListener,
    sync::{Semaphore, mpsc},
    task::JoinHandle,
};
use tokio_util::sync::CancellationToken;

pub struct GatewayConfig {
    pub installation_id: String,
    pub private_key: [u8; 32],
    pub allowed_origins: Vec<String>,
    pub local_port: u16,
    pub local_token: String,
    pub verifier: Arc<dyn AccountVerifier>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ClientKind {
    Ios,
    Android,
    Desktop,
    Unknown,
}
impl ClientKind {
    // A display hint only. Never retained verbatim or used for authorization.
    fn from_user_agent(value: Option<&str>) -> Self {
        let Some(value) = value else {
            return Self::Unknown;
        };
        if value.contains("iPhone") || value.contains("iPad") || value.contains("iPod") {
            Self::Ios
        } else if value.contains("Android") {
            Self::Android
        } else if value.contains("Macintosh")
            || value.contains("Windows")
            || value.contains("X11")
            || value.contains("Linux")
        {
            Self::Desktop
        } else {
            Self::Unknown
        }
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteClient {
    pub id: String,
    pub kind: ClientKind,
    pub connected_at: u64,
}
#[derive(Default)]
struct Clients(Mutex<BTreeMap<u64, RemoteClient>>);
struct ActiveClient {
    clients: Arc<Clients>,
    id: u64,
}
impl Drop for ActiveClient {
    fn drop(&mut self) {
        self.clients
            .0
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&self.id);
    }
}
impl Clients {
    fn register(
        self: &Arc<Self>,
        kind: ClientKind,
        stop: &CancellationToken,
    ) -> Result<ActiveClient> {
        static NEXT_ID: AtomicU64 = AtomicU64::new(1);
        let mut clients = self.0.lock().unwrap_or_else(|e| e.into_inner());
        if stop.is_cancelled() {
            bail!("REMOTE_CLOSED")
        }
        let id = NEXT_ID
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |id| id.checked_add(1))
            .map_err(|_| anyhow::anyhow!("REMOTE_CONNECTION_LIMIT"))?;
        clients.insert(
            id,
            RemoteClient {
                id: format!("connection-{id}"),
                kind,
                connected_at: now(),
            },
        );
        Ok(ActiveClient {
            clients: self.clone(),
            id,
        })
    }
    fn snapshot(&self) -> Vec<RemoteClient> {
        self.0
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .values()
            .cloned()
            .collect()
    }
    fn clear(&self) {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).clear();
    }
}
enum SessionEvent {
    Completed(Option<String>),
    Output(Option<Value>),
    Message(Option<Result<Message, axum::Error>>),
}
struct Context {
    cfg: GatewayConfig,
    stop: CancellationToken,
    permits: Arc<Semaphore>,
    http: reqwest::Client,
    clients: Arc<Clients>,
}
pub struct Gateway {
    pub port: u16,
    stop: CancellationToken,
    task: Option<JoinHandle<()>>,
    clients: Arc<Clients>,
}
impl Gateway {
    pub async fn start(cfg: GatewayConfig) -> Result<Self> {
        if !protocol::valid_id(&cfg.installation_id)
            || cfg.local_port == 0
            || cfg.local_token.is_empty()
            || cfg.allowed_origins.is_empty()
        {
            bail!("INVALID_GATEWAY_CONFIG")
        }
        for origin in &cfg.allowed_origins {
            let u = url::Url::parse(origin)?;
            if u.origin().ascii_serialization() != *origin
                || (u.scheme() != "https"
                    && !(u.scheme() == "http"
                        && matches!(u.host_str(), Some("127.0.0.1" | "localhost"))))
            {
                bail!("INVALID_GATEWAY_ORIGIN")
            }
        }
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let port = listener.local_addr()?.port();
        let stop = CancellationToken::new();
        let clients = Arc::new(Clients::default());
        let context = Arc::new(Context {
            cfg,
            stop: stop.clone(),
            permits: Arc::new(Semaphore::new(4)),
            clients: clients.clone(),
            http: reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .timeout(Duration::from_secs(30))
                .build()?,
        });
        let router = Router::new()
            .route("/remote/v1/ws", get(upgrade))
            .with_state(context);
        let task_stop = stop.clone();
        let task = tokio::spawn(async move {
            let _ = axum::serve(listener, router)
                .with_graceful_shutdown(task_stop.cancelled_owned())
                .await;
        });
        Ok(Self {
            port,
            stop,
            task: Some(task),
            clients,
        })
    }
    pub fn remote_clients(&self) -> Vec<RemoteClient> {
        if self.stop.is_cancelled() {
            return vec![];
        }
        self.clients.snapshot()
    }
    pub async fn close(&mut self) {
        self.stop.cancel();
        self.clients.clear();
        if let Some(task) = self.task.take() {
            let _ = tokio::time::timeout(Duration::from_secs(3), task).await;
        }
    }
}
impl Drop for Gateway {
    fn drop(&mut self) {
        self.stop.cancel();
        self.clients.clear();
    }
}
async fn upgrade(
    State(ctx): State<Arc<Context>>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Response {
    if !headers
        .get("origin")
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| ctx.cfg.allowed_origins.iter().any(|o| o == v))
    {
        return StatusCode::FORBIDDEN.into_response();
    }
    let Ok(permit) = ctx.permits.clone().try_acquire_owned() else {
        return StatusCode::TOO_MANY_REQUESTS.into_response();
    };
    let kind = ClientKind::from_user_agent(headers.get("user-agent").and_then(|v| v.to_str().ok()));
    ws.max_message_size(65535)
        .max_frame_size(65535)
        .on_upgrade(move |socket| async move {
            let _permit = permit;
            let _ = connection(ctx, socket, kind).await;
        })
        .into_response()
}
async fn binary(socket: &mut WebSocket) -> Result<Vec<u8>> {
    loop {
        match socket.recv().await {
            Some(Ok(Message::Binary(bytes))) => return Ok(bytes.to_vec()),
            Some(Ok(Message::Ping(p))) => socket.send(Message::Pong(p)).await?,
            _ => bail!("REMOTE_CLOSED"),
        }
    }
}
struct Assembly {
    method: String,
    path: String,
    content_type: Option<String>,
    size: usize,
    body: Vec<u8>,
}
struct Children {
    tasks: HashMap<String, JoinHandle<()>>,
    terminals: HashMap<String, mpsc::Sender<Value>>,
}
impl Drop for Children {
    fn drop(&mut self) {
        for task in self.tasks.values() {
            task.abort();
        }
    }
}
fn lease_duration(expires_at: u64) -> Result<Duration> {
    Ok(Duration::from_secs(expires_at)
        .saturating_sub(SystemTime::now().duration_since(UNIX_EPOCH)?))
}
async fn connection(ctx: Arc<Context>, mut socket: WebSocket, kind: ClientKind) -> Result<()> {
    let mut handshake = snow::Builder::new(protocol::NOISE_SUITE.parse()?)
        .local_private_key(&ctx.cfg.private_key)?
        .prologue(&protocol::prologue(&ctx.cfg.installation_id))?
        .build_responder()?;
    let (account, mut authorization_token, mut authorization_expires_at) = tokio::select! {
        _=ctx.stop.cancelled()=>return Ok(()),
        result=tokio::time::timeout(Duration::from_secs(10),async {
            let first=binary(&mut socket).await?;
            let mut plain=vec![0;65535]; let length=handshake.read_message(&first,&mut plain)?;
            let auth:Authentication=serde_json::from_slice(&plain[..length])?;
            if auth.r#type!="auth" || auth.installation_id!=ctx.cfg.installation_id { bail!("AUTH_REJECTED") }
            let account=ctx.cfg.verifier.verify(&auth.access_token).await?;
            if account.expires_at<=now() {bail!("AUTH_REJECTED")}
            let expires_at=account.expires_at.min(now()+300);
            let payload=serde_json::to_vec(&json!({"type":"ready","expiresAt":expires_at,"authRenewal":1}))?;
            let length=handshake.write_message(&payload,&mut plain)?;
            socket.send(Message::Binary(plain[..length].to_vec().into())).await?;
            Ok::<_,anyhow::Error>((account,auth.access_token,expires_at))
        })=>result??,
    };
    let remote = handshake
        .get_remote_static()
        .ok_or_else(|| anyhow::anyhow!("AUTH_REJECTED"))?;
    let client_id = format!(
        "remote-{}",
        remote
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>()
    );
    let mut noise = handshake.into_transport_mode()?;
    if now() >= authorization_expires_at {
        bail!("AUTH_REJECTED")
    }
    let _active_client = ctx.clients.register(kind, &ctx.stop)?;
    let deadline = tokio::time::sleep(lease_duration(authorization_expires_at)?);
    tokio::pin!(deadline);
    let mut renewal_sequence = 0_u64;
    let (out, mut output) = mpsc::channel::<Value>(16);
    let (done, mut completed) = mpsc::channel::<String>(16);
    let mut assemblies: HashMap<String, Assembly> = HashMap::new();
    let mut children = Children {
        tasks: HashMap::new(),
        terminals: HashMap::new(),
    };
    let mut used = protocol::RequestIds::default();
    let mut buffer = vec![0; 65535];
    loop {
        tokio::select! {
            biased;
            _=ctx.stop.cancelled()=>break,
            _=&mut deadline=>break,
            event=async {
                // Keep authorization priority without starving input under sustained output.
                tokio::select! {
                    id=completed.recv()=>SessionEvent::Completed(id),
                    value=output.recv()=>SessionEvent::Output(value),
                    message=socket.recv()=>SessionEvent::Message(message),
                }
            }=>match event {
            SessionEvent::Completed(Some(id))=>{children.tasks.remove(&id);children.terminals.remove(&id);},
            SessionEvent::Output(Some(value))=>{
                let plain=serde_json::to_vec(&value)?;
                if plain.len()>65519 {bail!("FRAME_TOO_LARGE")}
                let length=noise.write_message(&plain,&mut buffer)?;
                // A slow receiver must not hold a session beyond its authorization.
                tokio::select!{biased;_=&mut deadline=>break,_=ctx.stop.cancelled()=>break,result=tokio::time::timeout(Duration::from_secs(10),socket.send(Message::Binary(buffer[..length].to_vec().into())))=>{result??;}}
            },
            SessionEvent::Message(Some(Ok(message)))=>{
                let bytes=match message {Message::Binary(bytes)=>bytes,Message::Ping(p)=>{tokio::select!{biased;_=&mut deadline=>break,_=ctx.stop.cancelled()=>break,result=tokio::time::timeout(Duration::from_secs(1),socket.send(Message::Pong(p)))=>{result??;}}continue},Message::Pong(_)=>continue,_=>break};
                let length=noise.read_message(&bytes,&mut buffer)?;
                let incoming:Incoming=serde_json::from_slice(&buffer[..length])?;
                if now() >= authorization_expires_at || tokio::time::Instant::now() >= deadline.deadline() {
                    break;
                }
                if let Incoming::AuthRenew {id,access_token} = incoming {
                    if id != renewal_sequence + 1 || id > 9_007_199_254_740_991 || access_token.is_empty() || access_token.len() > 16384 || access_token == authorization_token {
                        bail!("AUTH_REJECTED")
                    }
                    let renewed = tokio::select! {
                        biased;
                        _=&mut deadline=>break,
                        _=ctx.stop.cancelled()=>break,
                        result=tokio::time::timeout(Duration::from_secs(10),ctx.cfg.verifier.verify(&access_token))=>result??,
                    };
                    let expires_at = renewed.expires_at.min(now() + 300);
                    if renewed.subject != account.subject || expires_at <= authorization_expires_at || now() >= authorization_expires_at || tokio::time::Instant::now() >= deadline.deadline() {
                        bail!("AUTH_REJECTED")
                    }
                    let plain=serde_json::to_vec(&json!({"type":"auth.renewed","id":id,"expiresAt":expires_at}))?;
                    let length=noise.write_message(&plain,&mut buffer)?;
                    tokio::select! {
                        biased;
                        _=&mut deadline=>break,
                        _=ctx.stop.cancelled()=>break,
                        result=tokio::time::timeout(Duration::from_secs(10),socket.send(Message::Binary(buffer[..length].to_vec().into())))=>result??,
                    }
                    if now() >= authorization_expires_at || tokio::time::Instant::now() >= deadline.deadline() || ctx.stop.is_cancelled() {
                        break;
                    }
                    authorization_expires_at=expires_at;
                    authorization_token=access_token;
                    renewal_sequence=id;
                    deadline.as_mut().reset(tokio::time::Instant::now()+lease_duration(expires_at)?);
                    continue;
                }
                incoming_frame(incoming,&ctx,&client_id,&out,&done,&mut assemblies,&mut children,&mut used).await?;
            },
            _=>break,
            }
        }
    }
    drop(children);
    let _ = tokio::time::timeout(Duration::from_secs(1), socket.close()).await;
    Ok(())
}
// All mutable protocol state belongs to this connection dispatcher.
#[allow(clippy::too_many_arguments)]
async fn incoming_frame(
    incoming: Incoming,
    ctx: &Arc<Context>,
    client_id: &str,
    out: &mpsc::Sender<Value>,
    done: &mpsc::Sender<String>,
    assemblies: &mut HashMap<String, Assembly>,
    children: &mut Children,
    used: &mut protocol::RequestIds,
) -> Result<()> {
    match incoming {
        Incoming::AuthRenew { .. } => bail!("AUTH_REJECTED"),
        Incoming::Request {
            id,
            method,
            path,
            content_type,
            size,
        } => {
            if !used.insert(&id) {
                bail!("INVALID_REQUEST_ID")
            }
            if size > MAX_BODY
                || assemblies.values().map(|a| a.size).sum::<usize>() + size > MAX_BODY
                || children.tasks.len() + assemblies.len() >= 8
                || protocol::allowed_path(&method, &path).is_err()
                || content_type
                    .as_ref()
                    .is_some_and(|v| v.len() > 256 || v.contains(['\r', '\n', '\0']))
            {
                out.try_send(json!({"type":"error","id":id,"code":"REQUEST_REJECTED"}))?;
                return Ok(());
            }
            assemblies.insert(
                id,
                Assembly {
                    method,
                    path,
                    content_type,
                    size,
                    body: Vec::new(),
                },
            );
        }
        Incoming::Chunk { id, data } => {
            let a = assemblies
                .get_mut(&id)
                .ok_or_else(|| anyhow::anyhow!("UNKNOWN_REQUEST"))?;
            if data.len() > CHUNK.div_ceil(3) * 4 {
                bail!("FRAME_TOO_LARGE")
            }
            let bytes = STANDARD.decode(&data)?;
            if bytes.len() > CHUNK
                || STANDARD.encode(&bytes) != data
                || a.body.len() + bytes.len() > a.size
            {
                bail!("INVALID_CHUNK")
            }
            a.body.extend(bytes);
            out.try_send(json!({"type":"ack","id":id,"received":a.body.len()}))?;
        }
        Incoming::End { id } => {
            let a = assemblies
                .remove(&id)
                .ok_or_else(|| anyhow::anyhow!("UNKNOWN_REQUEST"))?;
            if a.body.len() != a.size {
                bail!("INVALID_BODY_SIZE")
            }
            let ctx = ctx.clone();
            let output = out.clone();
            let done = done.clone();
            let task_id = id.clone();
            let request_client_id = client_id.to_string();
            children.tasks.insert(
                id,
                tokio::spawn(async move {
                    if http_request(ctx, &task_id, a, &output, &request_client_id)
                        .await
                        .is_err()
                    {
                        let _ = output
                            .send(
                                json!({"type":"error","id":task_id,"code":"LOCAL_REQUEST_FAILED"}),
                            )
                            .await;
                    }
                    let _ = done.send(task_id).await;
                }),
            );
        }
        Incoming::Cancel { id } | Incoming::PtyClose { id } => {
            assemblies.remove(&id);
            children.terminals.remove(&id);
            if let Some(task) = children.tasks.remove(&id) {
                task.abort();
            }
            out.try_send(json!({"type":"pty.closed","id":id}))?;
        }
        Incoming::PtyOpen { id, session_id } => {
            if !protocol::valid_id(&id) || !protocol::valid_id(&session_id) || !used.insert(&id) {
                bail!("INVALID_REQUEST_ID")
            }
            if children.terminals.len() >= 2 {
                out.try_send(json!({"type":"error","id":id,"code":"PTY_LIMIT"}))?;
                return Ok(());
            }
            let (input, rx) = mpsc::channel(16);
            children.terminals.insert(id.clone(), input);
            let ctx = ctx.clone();
            let output = out.clone();
            let done = done.clone();
            let task_id = id.clone();
            children.tasks.insert(
                id,
                tokio::spawn(async move {
                    if terminal(ctx, &task_id, &session_id, rx, &output)
                        .await
                        .is_err()
                    {
                        let _ = output
                            .send(json!({"type":"error","id":task_id,"code":"PTY_FAILED"}))
                            .await;
                    }
                    let _ = output.send(json!({"type":"pty.closed","id":task_id})).await;
                    let _ = done.send(task_id).await;
                }),
            );
        }
        Incoming::PtyInput { id, data } => {
            if data.len() > 16384 {
                bail!("INPUT_TOO_LARGE")
            }
            let tx = children
                .terminals
                .get(&id)
                .ok_or_else(|| anyhow::anyhow!("UNKNOWN_PTY"))?;
            tx.try_send(json!({"type":"input","data":data}))
                .map_err(|_| anyhow::anyhow!("PTY_BACKPRESSURE"))?;
        }
        Incoming::PtyResize { id, cols, rows } => {
            if !(2..=500).contains(&cols) || !(2..=200).contains(&rows) {
                bail!("INVALID_PTY_SIZE")
            }
            let tx = children
                .terminals
                .get(&id)
                .ok_or_else(|| anyhow::anyhow!("UNKNOWN_PTY"))?;
            tx.try_send(json!({"type":"resize","cols":cols,"rows":rows}))
                .map_err(|_| anyhow::anyhow!("PTY_BACKPRESSURE"))?;
        }
    }
    Ok(())
}
async fn http_request(
    ctx: Arc<Context>,
    id: &str,
    a: Assembly,
    out: &mpsc::Sender<Value>,
    client_id: &str,
) -> Result<()> {
    let mut request = ctx
        .http
        .request(
            reqwest::Method::from_bytes(a.method.as_bytes())?,
            format!("http://127.0.0.1:{}{}", ctx.cfg.local_port, a.path),
        )
        .bearer_auth(&ctx.cfg.local_token)
        .header("x-anywork-client-id", client_id)
        .header("user-agent", "AnyWork encrypted browser")
        .body(a.body);
    if let Some(content_type) = a.content_type {
        request = request.header("content-type", content_type);
    }
    let response = request.send().await?;
    if response
        .content_length()
        .is_some_and(|v| v > MAX_BODY as u64)
    {
        bail!("RESPONSE_TOO_LARGE")
    }
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();
    out.send(json!({"type":"response","id":id,"status":response.status().as_u16(),"contentType":content_type})).await?;
    let mut stream = response.bytes_stream();
    let mut size = 0;
    while let Some(bytes) = stream.next().await {
        let bytes = bytes?;
        size += bytes.len();
        if size > MAX_BODY {
            bail!("RESPONSE_TOO_LARGE")
        };
        for chunk in bytes.chunks(CHUNK) {
            out.send(json!({"type":"chunk","id":id,"data":STANDARD.encode(chunk)}))
                .await?;
        }
    }
    out.send(json!({"type":"end","id":id})).await?;
    Ok(())
}
async fn terminal(
    ctx: Arc<Context>,
    id: &str,
    session: &str,
    mut input: mpsc::Receiver<Value>,
    out: &mpsc::Sender<Value>,
) -> Result<()> {
    let (mut ws, _) = tokio::time::timeout(
        Duration::from_secs(5),
        tokio_tungstenite::connect_async(format!(
            "ws://127.0.0.1:{}/ws/terminal/{}",
            ctx.cfg.local_port, session
        )),
    )
    .await??;
    ws.send(tokio_tungstenite::tungstenite::Message::Text(
        json!({"token":ctx.cfg.local_token}).to_string().into(),
    ))
    .await?;
    out.send(json!({"type":"pty.ready","id":id})).await?;
    loop {
        tokio::select! {
            message=input.recv()=>match message{Some(value)=>ws.send(tokio_tungstenite::tungstenite::Message::Text(value.to_string().into())).await?,None=>break},
            message=ws.next()=>match message{Some(Ok(tokio_tungstenite::tungstenite::Message::Binary(bytes)))=>{for chunk in bytes.chunks(CHUNK){out.send(json!({"type":"pty.data","id":id,"data":STANDARD.encode(chunk)})).await?;}},Some(Ok(tokio_tungstenite::tungstenite::Message::Ping(p)))=>ws.send(tokio_tungstenite::tungstenite::Message::Pong(p)).await?,Some(Ok(tokio_tungstenite::tungstenite::Message::Pong(_)))=>{},_=>break}
        }
    }
    let _ = ws.close(None).await;
    Ok(())
}
