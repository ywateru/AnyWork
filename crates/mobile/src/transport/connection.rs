use super::*;
use base64::{
    Engine,
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    collections::{HashMap, HashSet},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::{
    net::TcpStream,
    sync::{mpsc, oneshot, watch},
    time::Instant,
};
use tokio_tungstenite::{
    MaybeTlsStream, WebSocketStream, connect_async_tls_with_config,
    tungstenite::{Message, client::IntoClientRequest, protocol::WebSocketConfig},
};

const MAX_IDS: usize = 65_536;
const OPERATION_TIME: Duration = Duration::from_secs(240);
const MAX_SAFE: u64 = 9_007_199_254_740_991;
type Socket = WebSocketStream<MaybeTlsStream<TcpStream>>;
pub(super) type Reply<T> = oneshot::Sender<Result<T>>;
pub(super) enum Command {
    Begin(HttpBegin, Reply<()>),
    Write(HttpWrite, Reply<WriteAck>),
    Finish(OperationRef, Reply<ResponseHead>),
    Read(OperationRef, Reply<ResponseChunk>),
    Cancel(OperationRef, Reply<()>),
    Pty(PtyCommand, Reply<()>),
    Foreground(Reply<()>),
    Renew(anyhow::Result<AccessGrant>),
}
#[derive(Clone)]
pub(super) struct Peer {
    reference: ConnectionRef,
    sender: mpsc::Sender<Command>,
    stop: CancellationToken,
    finished: watch::Receiver<bool>,
    auth: Arc<dyn Authorization>,
    epoch: u64,
    lifetime: CancellationToken,
    service_lifetime: CancellationToken,
    _slot: Arc<tokio::sync::OwnedSemaphorePermit>,
    _owner: Arc<PeerOwner>,
}
struct PeerOwner(CancellationToken);
impl Drop for PeerOwner {
    fn drop(&mut self) {
        self.0.cancel();
    }
}
impl Peer {
    pub fn reference(&self) -> &ConnectionRef {
        &self.reference
    }
    pub fn is_closed(&self) -> bool {
        self.stop.is_cancelled()
            || self.lifetime.is_cancelled()
            || self.service_lifetime.is_cancelled()
    }
    pub fn stop(&self) {
        self.stop.cancel();
    }
    pub async fn check(&self) -> Result<()> {
        if self.is_closed() {
            return Err(error("CONNECTION_CLOSED"));
        }
        if self.auth.ensure_epoch(self.epoch).await.is_err() {
            self.stop();
            return Err(error("IDENTITY_CHANGED"));
        }
        if self.is_closed() {
            return Err(error("CONNECTION_CLOSED"));
        }
        Ok(())
    }
    pub async fn send(&self, cmd: Command) -> Result<()> {
        if self.is_closed() {
            return Err(error("CONNECTION_CLOSED"));
        }
        self.sender.try_send(cmd).map_err(|e| match e {
            mpsc::error::TrySendError::Full(_) => error("LIMIT_EXCEEDED"),
            mpsc::error::TrySendError::Closed(_) => error("CONNECTION_CLOSED"),
        })
    }
    pub async fn close(&self) -> CleanupState {
        self.stop();
        let mut finished = self.finished.clone();
        let complete = tokio::time::timeout(Duration::from_secs(3), async {
            while !*finished.borrow_and_update() {
                if finished.changed().await.is_err() {
                    break;
                }
            }
        })
        .await
        .is_ok();
        CleanupState {
            cleanup_pending: !complete,
        }
    }
    pub async fn connect(
        reference: ConnectionRef,
        target: VerifiedTarget,
        auth: Arc<dyn Authorization>,
        cancel: CancellationToken,
        service_lifetime: CancellationToken,
        events: EventSink,
        slot: tokio::sync::OwnedSemaphorePermit,
    ) -> Result<Self> {
        let stop = cancel.child_token();
        let lifetime = target.lifetime.clone();
        let epoch = target.account_epoch;
        let key = URL_SAFE_NO_PAD
            .decode(&target.public_key)
            .map_err(|_| error("INVALID_TARGET"))?;
        if key.len() != 32
            || URL_SAFE_NO_PAD.encode(&key) != target.public_key
            || !anywork_remote::protocol::valid_id(&target.installation_id)
            || target.scope_id.is_empty()
            || target.scope_id.len() > 1024
        {
            return Err(error("INVALID_TARGET"));
        }
        let url = address(&target.gateway_url)?;
        let operation = async {
            auth.ensure_epoch(epoch)
                .await
                .map_err(|_| error("IDENTITY_CHANGED"))?;
            let grant = auth
                .token(true, 60)
                .await
                .map_err(|_| error("LOGIN_REQUIRED"))?;
            auth.ensure_epoch(epoch)
                .await
                .map_err(|_| error("IDENTITY_CHANGED"))?;
            if grant.epoch != epoch
                || grant.expires_at <= now()
                || grant.access_token.is_empty()
                || grant.access_token.len() > 16_384
            {
                return Err(error("AUTHORIZATION_REJECTED"));
            }
            let mut request = url
                .into_client_request()
                .map_err(|_| error("INVALID_TARGET"))?;
            request
                .headers_mut()
                .insert("origin", MOBILE_ORIGIN.parse().unwrap());
            request
                .headers_mut()
                .insert("user-agent", "AnyWork Android native".parse().unwrap());
            let config = WebSocketConfig::default()
                .max_message_size(Some(65_535))
                .max_frame_size(Some(65_535));
            let (mut socket, _) = connect_async_tls_with_config(
                request,
                Some(config),
                true,
                Some(super::tls::connector()?),
            )
            .await
            .map_err(|_| error("CONNECTION_FAILED"))?;
            auth.ensure_epoch(epoch)
                .await
                .map_err(|_| error("IDENTITY_CHANGED"))?;
            let local = snow::Builder::new(NOISE_SUITE.parse().unwrap())
                .generate_keypair()
                .map_err(|_| error("HANDSHAKE_FAILED"))?;
            let prologue = format!("AnyWork\0remote-v1\0{}", target.installation_id);
            let mut hs = snow::Builder::new(NOISE_SUITE.parse().unwrap())
                .local_private_key(&local.private)
                .map_err(|_| error("HANDSHAKE_FAILED"))?
                .remote_public_key(&key)
                .map_err(|_| error("HANDSHAKE_FAILED"))?
                .prologue(prologue.as_bytes())
                .map_err(|_| error("HANDSHAKE_FAILED"))?
                .build_initiator()
                .map_err(|_| error("HANDSHAKE_FAILED"))?;
            let mut buf = vec![0; 65_535];
            let payload = serde_json::to_vec(
                &json!({"type":"auth", "installationId":target.installation_id,
                "accessToken":grant.access_token}),
            )
            .map_err(|_| error("HANDSHAKE_FAILED"))?;
            let n = hs
                .write_message(&payload, &mut buf)
                .map_err(|_| error("HANDSHAKE_FAILED"))?;
            socket
                .send(Message::Binary(buf[..n].to_vec().into()))
                .await
                .map_err(|_| error("HANDSHAKE_FAILED"))?;
            auth.ensure_epoch(epoch)
                .await
                .map_err(|_| error("IDENTITY_CHANGED"))?;
            let incoming = loop {
                match socket.next().await {
                    Some(Ok(Message::Binary(data))) => break data,
                    Some(Ok(Message::Ping(data))) => socket
                        .send(Message::Pong(data))
                        .await
                        .map_err(|_| error("HANDSHAKE_FAILED"))?,
                    _ => return Err(error("HANDSHAKE_FAILED")),
                }
            };
            auth.ensure_epoch(epoch)
                .await
                .map_err(|_| error("IDENTITY_CHANGED"))?;
            let n = hs
                .read_message(&incoming, &mut buf)
                .map_err(|_| error("HANDSHAKE_FAILED"))?;
            let ready: Ready =
                serde_json::from_slice(&buf[..n]).map_err(|_| error("INVALID_FRAME"))?;
            if ready.kind != "ready"
                || hs.get_remote_static() != Some(key.as_slice())
                || ready.auth_renewal.is_some_and(|v| v != 1)
            {
                return Err(error("INVALID_FRAME"));
            }
            let deadline = lease(ready.expires_at)?;
            let noise = hs
                .into_transport_mode()
                .map_err(|_| error("HANDSHAKE_FAILED"))?;
            Ok((socket, noise, ready, deadline, grant.access_token))
        };
        // Rotation stays owned by the account module if this wait is canceled.
        let (socket, noise, ready, deadline, token) = tokio::select! { biased;
            _ = stop.cancelled() => return Err(error("CANCELLED")),
            _ = lifetime.cancelled() => return Err(error("IDENTITY_CHANGED")),
            _ = service_lifetime.cancelled() => return Err(error("CONNECTION_CLOSED")),
            result = tokio::time::timeout(Duration::from_secs(15), operation) => result.map_err(|_|error("HANDSHAKE_TIMEOUT"))??,
        };
        if stop.is_cancelled() || lifetime.is_cancelled() || service_lifetime.is_cancelled() {
            return Err(error("CANCELLED"));
        }
        let (sender, receiver) = mpsc::channel(32);
        let (done, finished) = watch::channel(false);
        let slot = Arc::new(slot);
        let peer = Self {
            _owner: Arc::new(PeerOwner(stop.clone())),
            lifetime: lifetime.clone(),
            service_lifetime: service_lifetime.clone(),
            _slot: slot.clone(),
            reference: reference.clone(),
            sender: sender.clone(),
            stop: stop.clone(),
            finished,
            auth: auth.clone(),
            epoch,
        };
        tokio::spawn(async move {
            let mut actor = Actor {
                reference,
                socket,
                noise,
                auth,
                epoch,
                events,
                stop: stop.clone(),
                lifetime,
                service_lifetime,
                sender,
                receiver,
                used: HashSet::new(),
                http: HashMap::new(),
                ptys: HashMap::new(),
                next: 0,
                request_bytes: 0,
                response_bytes: 0,
                expires: ready.expires_at,
                deadline,
                renew_at: renewal_at(deadline),
                renewal: 0,
                renewal_pending: false,
                renewable: ready.auth_renewal == Some(1),
                token,
            };
            let _slot = slot;
            let reason = match actor.run().await {
                Ok(()) => "CONNECTION_CLOSED",
                Err(e) => e.code,
            };
            stop.cancel();
            actor.shutdown(reason).await;
            let _ = done.send(true);
        });
        Ok(peer)
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Ready {
    #[serde(rename = "type")]
    kind: String,
    expires_at: u64,
    auth_renewal: Option<u8>,
}
#[derive(Deserialize)]
#[serde(tag = "type", deny_unknown_fields)]
enum Frame {
    #[serde(rename = "response", rename_all = "camelCase")]
    Response {
        id: String,
        status: u16,
        content_type: Option<String>,
    },
    #[serde(rename = "chunk")]
    Chunk { id: String, data: String },
    #[serde(rename = "end")]
    End { id: String },
    #[serde(rename = "ack")]
    Ack { id: String, received: usize },
    #[serde(rename = "error")]
    Error { id: String, code: String },
    #[serde(rename = "pty.ready")]
    PtyReady { id: String },
    #[serde(rename = "pty.data")]
    PtyData { id: String, data: String },
    #[serde(rename = "pty.closed")]
    PtyClosed { id: String },
    #[serde(rename = "auth.renewed", rename_all = "camelCase")]
    Renewed { id: u64, expires_at: u64 },
}
struct Http {
    wire: String,
    size: usize,
    written: usize,
    submitted: bool,
    deadline: Instant,
    write: Option<(usize, Reply<WriteAck>, Instant)>,
    finish: Option<Reply<ResponseHead>>,
    head: Option<ResponseHead>,
    body: Vec<u8>,
    read: usize,
    complete: bool,
}
impl Http {
    fn delivery(&self) -> Delivery {
        if self.complete {
            Delivery::ResponseComplete
        } else if self.submitted {
            Delivery::OutcomeUnknown
        } else {
            Delivery::NotSent
        }
    }
    fn fail(mut self, code: &'static str) {
        let e = TransportError::new(code, self.delivery());
        if let Some((_, reply, _)) = self.write.take() {
            let _ = reply.send(Err(e.clone()));
        }
        if let Some(reply) = self.finish.take() {
            let _ = reply.send(Err(e));
        }
    }
}
struct Pty {
    wire: String,
    ready: bool,
    opened: Instant,
    sent: u64,
    acked: u64,
    unacked_since: Option<Instant>,
}
struct Actor {
    reference: ConnectionRef,
    socket: Socket,
    noise: snow::TransportState,
    auth: Arc<dyn Authorization>,
    epoch: u64,
    events: EventSink,
    stop: CancellationToken,
    lifetime: CancellationToken,
    service_lifetime: CancellationToken,
    sender: mpsc::Sender<Command>,
    receiver: mpsc::Receiver<Command>,
    used: HashSet<String>,
    http: HashMap<String, Http>,
    ptys: HashMap<String, Pty>,
    next: u64,
    request_bytes: usize,
    response_bytes: usize,
    expires: u64,
    deadline: Instant,
    renew_at: Instant,
    renewal: u64,
    renewal_pending: bool,
    renewable: bool,
    token: String,
}
impl Actor {
    async fn check(&self) -> Result<()> {
        if self.stop.is_cancelled()
            || self.lifetime.is_cancelled()
            || self.service_lifetime.is_cancelled()
        {
            return Err(error("CONNECTION_CLOSED"));
        }
        if now() >= self.expires || Instant::now() >= self.deadline {
            return Err(error("AUTHORIZATION_EXPIRED"));
        }
        self.auth
            .ensure_epoch(self.epoch)
            .await
            .map_err(|_| error("IDENTITY_CHANGED"))?;
        if self.stop.is_cancelled()
            || self.lifetime.is_cancelled()
            || self.service_lifetime.is_cancelled()
        {
            return Err(error("CONNECTION_CLOSED"));
        }
        if now() >= self.expires || Instant::now() >= self.deadline {
            return Err(error("AUTHORIZATION_EXPIRED"));
        }
        Ok(())
    }
    async fn send(&mut self, value: Value) -> Result<()> {
        self.send_until(value, self.deadline).await
    }
    async fn send_until(&mut self, value: Value, operation_deadline: Instant) -> Result<()> {
        self.check().await?;
        let (deadline, expired) = if operation_deadline < self.deadline {
            (operation_deadline, "REQUEST_TIMEOUT")
        } else {
            (self.deadline, "AUTHORIZATION_EXPIRED")
        };
        if Instant::now() >= deadline {
            return Err(error(expired));
        }
        let plain = serde_json::to_vec(&value).map_err(|_| error("INVALID_REQUEST"))?;
        if plain.len() > 65_519 {
            return Err(error("INVALID_REQUEST"));
        }
        let mut buf = vec![0; 65_535];
        let n = self
            .noise
            .write_message(&plain, &mut buf)
            .map_err(|_| error("PROTOCOL_ERROR"))?;
        tokio::select! { biased;
            _ = self.stop.cancelled() => return Err(error("CONNECTION_CLOSED")),
            _ = self.service_lifetime.cancelled() => return Err(error("CONNECTION_CLOSED")),
            _ = self.lifetime.cancelled() => return Err(error("IDENTITY_CHANGED")),
            _ = tokio::time::sleep_until(deadline) => return Err(error(expired)),
            result = tokio::time::timeout(Duration::from_secs(10),self.socket.send(Message::Binary(buf[..n].to_vec().into()))) => {
                result.map_err(|_|error("SEND_TIMEOUT"))?.map_err(|_|error("CONNECTION_CLOSED"))?;
            }
        }
        self.check().await
    }
    fn emit(&self, event: TransportEvent) -> Result<()> {
        if !(self.events)(event) {
            return Err(error("BRIDGE_CLOSED"));
        }
        Ok(())
    }
    fn operation(&self, id: &str) -> OperationRef {
        OperationRef {
            connection: self.reference.clone(),
            operation_id: id.to_owned(),
        }
    }
    fn admit(&mut self, id: &str) -> Result<String> {
        if !anywork_remote::protocol::valid_id(id) {
            return Err(TransportError::invalid());
        }
        if self.used.contains(id) {
            return Err(error("OPERATION_RETIRED"));
        }
        if self.used.len() >= MAX_IDS || self.next >= MAX_SAFE {
            return Err(error("OPERATION_LIMIT"));
        }
        self.used.insert(id.to_owned());
        self.next += 1;
        Ok(format!("r{}", self.next))
    }
    fn remove_http(&mut self, id: &str) -> Option<Http> {
        let h = self.http.remove(id)?;
        self.request_bytes -= h.size;
        self.response_bytes -= h.body.len();
        Some(h)
    }
    async fn expire_http(&mut self, id: &str) -> Result<Option<TransportError>> {
        let expired = self.http.get(id).is_some_and(|h| {
            Instant::now() >= h.deadline
                || h.write
                    .as_ref()
                    .is_some_and(|(_, _, deadline)| Instant::now() >= *deadline)
        });
        if !expired {
            return Ok(None);
        }
        let h = self.remove_http(id).unwrap();
        let error = TransportError::new("REQUEST_TIMEOUT", h.delivery());
        let wire = h.wire.clone();
        h.fail("REQUEST_TIMEOUT");
        self.send(json!({"type":"cancel","id":wire})).await?;
        Ok(Some(error))
    }
    fn http_id(&self, wire: &str) -> Option<String> {
        self.http
            .iter()
            .find(|(_, h)| h.wire == wire)
            .map(|(id, _)| id.clone())
    }
    fn pty_id(&self, wire: &str) -> Option<String> {
        self.ptys
            .iter()
            .find(|(_, p)| p.wire == wire)
            .map(|(id, _)| id.clone())
    }
    async fn run(&mut self) -> Result<()> {
        loop {
            self.check().await?;
            tokio::select! {
                _ = self.stop.cancelled() => return Ok(()),
                _ = self.lifetime.cancelled() => return Err(error("IDENTITY_CHANGED")),
                _ = self.service_lifetime.cancelled() => return Ok(()),
                _ = tokio::time::sleep_until(self.deadline) => return Err(error("AUTHORIZATION_EXPIRED")),
                command = self.receiver.recv() => match command { Some(c) => self.command(c).await?, None => return Ok(()) },
                message = self.socket.next() => {
                    self.check().await?;
                    match message {
                        Some(Ok(Message::Binary(bytes))) => {
                            let mut buf=vec![0;65_535];
                            let n=self.noise.read_message(&bytes,&mut buf).map_err(|_|error("PROTOCOL_ERROR"))?;
                            let frame:Frame=serde_json::from_slice(&buf[..n]).map_err(|_|error("INVALID_FRAME"))?;
                            self.frame(frame).await?;
                        }
                        Some(Ok(Message::Ping(bytes))) => {
                            tokio::time::timeout(Duration::from_secs(1),self.socket.send(Message::Pong(bytes))).await
                                .map_err(|_|error("SEND_TIMEOUT"))?.map_err(|_|error("CONNECTION_CLOSED"))?;
                        }
                        Some(Ok(Message::Pong(_))) => (),
                        _ => return Err(error("CONNECTION_CLOSED")),
                    }
                }
                _ = tokio::time::sleep(Duration::from_millis(100)) => {
                    self.maintenance().await?;
                }
            }
            // Run maintenance under sustained traffic as well as while idle.
            self.maintenance().await?;
        }
    }
    async fn maintenance(&mut self) -> Result<()> {
        let now = Instant::now();
        let expired: Vec<_> = self
            .http
            .iter()
            .filter(|(_, h)| {
                now >= h.deadline
                    || h.write
                        .as_ref()
                        .is_some_and(|(_, _, deadline)| now >= *deadline)
            })
            .map(|(id, _)| id.clone())
            .collect();
        for id in expired {
            if let Some(h) = self.remove_http(&id) {
                let wire = h.wire.clone();
                h.fail("REQUEST_TIMEOUT");
                self.send(json!({"type":"cancel","id":wire})).await?;
            }
        }
        let expired: Vec<_> = self
            .ptys
            .iter()
            .filter(|(_, p)| {
                (!p.ready && now.duration_since(p.opened) > Duration::from_secs(10))
                    || p.unacked_since
                        .is_some_and(|t| now.duration_since(t) > Duration::from_secs(15))
            })
            .map(|(id, _)| id.clone())
            .collect();
        for id in expired {
            self.close_pty(&id, "PTY_BACKPRESSURE").await?;
        }
        if self.renewable && !self.renewal_pending && now >= self.renew_at {
            self.renewal_pending = true;
            let auth = self.auth.clone();
            let sender = self.sender.clone();
            let epoch = self.epoch;
            // Do not drop an already dispatched account rotation on transport close.
            tokio::spawn(async move {
                let result = async {
                    auth.ensure_epoch(epoch).await?;
                    let grant = auth.token(true, 60).await?;
                    auth.ensure_epoch(epoch).await?;
                    Ok(grant)
                }
                .await;
                let _ = sender.send(Command::Renew(result)).await;
            });
        }
        Ok(())
    }
    async fn command(&mut self, command: Command) -> Result<()> {
        self.check().await?;
        match command {
            Command::Begin(req, reply) => {
                let result = self.begin(req).await;
                let fatal = result.as_ref().err().is_some_and(fatal);
                let reason = result.as_ref().err().cloned();
                let _ = reply.send(result);
                if fatal {
                    return Err(reason.unwrap());
                }
            }
            Command::Write(req, reply) => {
                let id = &req.operation.operation_id;
                if let Some(error) = self.expire_http(id).await? {
                    let _ = reply.send(Err(error));
                    return Ok(());
                }
                let bytes = match decode(&req.base64) {
                    Ok(v) if !v.is_empty() => v,
                    _ => {
                        let _ = reply.send(Err(TransportError::invalid()));
                        return Ok(());
                    }
                };
                let Some(h) = self.http.get_mut(id) else {
                    let _ = reply.send(Err(error("OPERATION_RETIRED")));
                    return Ok(());
                };
                if h.submitted
                    || h.write.is_some()
                    || req.offset != h.written
                    || h.written + bytes.len() > h.size
                {
                    let _ = reply.send(Err(TransportError::new("INVALID_REQUEST", h.delivery())));
                    return Ok(());
                }
                let wire = h.wire.clone();
                let deadline = h.deadline;
                h.write = Some((
                    h.written + bytes.len(),
                    reply,
                    Instant::now() + Duration::from_secs(15),
                ));
                self.send_until(
                    json!({"type":"chunk","id":wire,"data":req.base64}),
                    deadline,
                )
                .await?;
            }
            Command::Finish(req, reply) => {
                if let Some(error) = self.expire_http(&req.operation_id).await? {
                    let _ = reply.send(Err(error));
                    return Ok(());
                }
                let Some(h) = self.http.get_mut(&req.operation_id) else {
                    let _ = reply.send(Err(error("OPERATION_RETIRED")));
                    return Ok(());
                };
                if h.submitted || h.write.is_some() || h.written != h.size {
                    let _ = reply.send(Err(TransportError::new("INVALID_REQUEST", h.delivery())));
                    return Ok(());
                }
                h.submitted = true;
                h.finish = Some(reply);
                let wire = h.wire.clone();
                let deadline = h.deadline;
                self.send_until(json!({"type":"end","id":wire}), deadline)
                    .await?;
            }
            Command::Read(req, reply) => {
                if let Some(error) = self.expire_http(&req.operation_id).await? {
                    let _ = reply.send(Err(error));
                    return Ok(());
                }
                let result = match self.http.get_mut(&req.operation_id) {
                    Some(h) if h.complete => {
                        let end = (h.read + CHUNK).min(h.body.len());
                        let data = STANDARD.encode(&h.body[h.read..end]);
                        h.read = end;
                        Ok(ResponseChunk {
                            base64: data,
                            done: end == h.body.len(),
                        })
                    }
                    Some(h) => Err(TransportError::new("RESPONSE_NOT_READY", h.delivery())),
                    None => Err(error("OPERATION_RETIRED")),
                };
                if result.as_ref().is_ok_and(|r| r.done) {
                    self.remove_http(&req.operation_id);
                }
                let _ = reply.send(result);
            }
            Command::Cancel(req, reply) => {
                let id = &req.operation_id;
                if !anywork_remote::protocol::valid_id(id) {
                    let _ = reply.send(Err(TransportError::invalid()));
                    return Ok(());
                }
                if !self.used.contains(id) {
                    if self.used.len() >= MAX_IDS {
                        let _ = reply.send(Err(error("OPERATION_LIMIT")));
                        return Ok(());
                    }
                    self.used.insert(id.clone());
                }
                if let Some(h) = self.remove_http(id) {
                    let wire = h.wire.clone();
                    h.fail("CANCELLED");
                    self.send(json!({"type":"cancel","id":wire})).await?;
                }
                self.close_pty(id, "CANCELLED").await?;
                let _ = reply.send(Ok(()));
            }
            Command::Pty(req, reply) => {
                let result = self.pty(req).await;
                let reason = result.as_ref().err().filter(|e| fatal(e)).cloned();
                let _ = reply.send(result);
                if let Some(reason) = reason {
                    return Err(reason);
                }
            }
            Command::Foreground(reply) => {
                let result = async {
                    let grant = tokio::select! { biased;
                        _ = self.stop.cancelled() => return Err(error("CONNECTION_CLOSED")),
                        _ = self.lifetime.cancelled() => return Err(error("IDENTITY_CHANGED")),
                        _ = self.service_lifetime.cancelled() => return Err(error("CONNECTION_CLOSED")),
                        _ = tokio::time::sleep_until(self.deadline) => return Err(error("AUTHORIZATION_EXPIRED")),
                        result = tokio::time::timeout(Duration::from_secs(15), self.auth.token(false, 60)) =>
                            result.map_err(|_| error("LOGIN_REQUIRED"))?
                                .map_err(|_| error("LOGIN_REQUIRED"))?,
                    };
                    self.check().await?;
                    if grant.epoch != self.epoch {
                        return Err(error("IDENTITY_CHANGED"));
                    }
                    if grant.expires_at.saturating_sub(now()) < 60
                        || grant.access_token.is_empty()
                        || grant.access_token.len() > 16_384
                    {
                        return Err(error("LOGIN_REQUIRED"));
                    }
                    // A token is only evidence of current account authorization.
                    // Only an authenticated auth.renewed frame changes the lease.
                    Ok(())
                }
                .await;
                let reason = result.as_ref().err().cloned();
                let _ = reply.send(result);
                if let Some(reason) = reason {
                    return Err(reason);
                }
            }
            Command::Renew(result) => {
                let grant = result.map_err(|_| error("AUTHORIZATION_EXPIRED"))?;
                self.check().await?;
                if grant.epoch != self.epoch
                    || grant.expires_at <= now()
                    || grant.access_token.is_empty()
                    || grant.access_token.len() > 16_384
                    || grant.access_token == self.token
                    || self.renewal >= MAX_SAFE
                {
                    return Err(error("AUTHORIZATION_EXPIRED"));
                }
                self.renewal += 1;
                self.token = grant.access_token;
                self.send(json!({"type":"auth.renew","id":self.renewal,"accessToken":self.token}))
                    .await?;
                // Keep the OLD lease armed until its authenticated matching ACK.
            }
        }
        Ok(())
    }
    async fn begin(&mut self, req: HttpBegin) -> Result<()> {
        if req.size > MAX_BODY || self.http.len() >= 8 || self.request_bytes + req.size > MAX_BODY {
            return Err(error("REQUEST_LIMIT"));
        }
        anywork_remote::protocol::allowed_path(&req.method, &req.path)
            .map_err(|_| TransportError::invalid())?;
        if req
            .content_type
            .as_ref()
            .is_some_and(|s| s.len() > 256 || s.contains(['\r', '\n', '\0']))
        {
            return Err(TransportError::invalid());
        }
        let wire = self.admit(&req.operation.operation_id)?;
        self.request_bytes += req.size;
        self.http.insert(
            req.operation.operation_id,
            Http {
                wire: wire.clone(),
                size: req.size,
                written: 0,
                submitted: false,
                deadline: Instant::now() + OPERATION_TIME,
                write: None,
                finish: None,
                head: None,
                body: Vec::new(),
                read: 0,
                complete: false,
            },
        );
        self.send(
            json!({"type":"request","id":wire,"method":req.method,"path":req.path,
            "contentType":req.content_type,"size":req.size}),
        )
        .await
    }
    async fn pty(&mut self, req: PtyCommand) -> Result<()> {
        let id = req.operation().operation_id.clone();
        match req {
            PtyCommand::Open { session_id, .. } => {
                if self.ptys.len() >= 2 {
                    return Err(error("PTY_LIMIT"));
                }
                if !anywork_remote::protocol::valid_id(&session_id) {
                    return Err(TransportError::invalid());
                }
                let wire = self.admit(&id)?;
                self.ptys.insert(
                    id,
                    Pty {
                        wire: wire.clone(),
                        ready: false,
                        opened: Instant::now(),
                        sent: 0,
                        acked: 0,
                        unacked_since: None,
                    },
                );
                self.send(json!({"type":"pty.open","id":wire,"sessionId":session_id}))
                    .await
            }
            PtyCommand::Input { data, .. } => {
                let p = self
                    .ptys
                    .get(&id)
                    .filter(|p| p.ready)
                    .ok_or_else(|| error("PTY_NOT_READY"))?;
                if data.len() > 8192 {
                    return Err(TransportError::invalid());
                }
                self.send(json!({"type":"pty.input","id":p.wire,"data":data}))
                    .await
            }
            PtyCommand::Resize { cols, rows, .. } => {
                let p = self
                    .ptys
                    .get(&id)
                    .filter(|p| p.ready)
                    .ok_or_else(|| error("PTY_NOT_READY"))?;
                self.send(json!({"type":"pty.resize","id":p.wire,"cols":cols.clamp(2,500),"rows":rows.clamp(2,200)})).await
            }
            PtyCommand::Ack { sequence, .. } => {
                if let Some(p) = self.ptys.get_mut(&id) {
                    if sequence <= p.acked || sequence > p.sent {
                        return Err(TransportError::invalid());
                    }
                    p.acked = sequence;
                    p.unacked_since = if p.acked == p.sent {
                        None
                    } else {
                        Some(Instant::now())
                    };
                }
                Ok(())
            }
            PtyCommand::Close { .. } => {
                // Closing before open is a cancellation tombstone too.
                if !self.used.contains(&id) {
                    if !anywork_remote::protocol::valid_id(&id) || self.used.len() >= MAX_IDS {
                        return Err(TransportError::invalid());
                    }
                    self.used.insert(id.clone());
                }
                self.close_pty(&id, "PTY_CLOSED").await
            }
        }
    }
    async fn close_pty(&mut self, id: &str, code: &'static str) -> Result<()> {
        if let Some(p) = self.ptys.remove(id) {
            self.emit(TransportEvent::PtyClosed {
                operation: self.operation(id),
                sequence: p.sent + 1,
                code,
            })?;
            self.send(json!({"type":"pty.close","id":p.wire})).await?;
        }
        Ok(())
    }
    async fn frame(&mut self, frame: Frame) -> Result<()> {
        let wire = match &frame {
            Frame::Response { id, .. }
            | Frame::Chunk { id, .. }
            | Frame::End { id }
            | Frame::Ack { id, .. }
            | Frame::Error { id, .. }
            | Frame::PtyReady { id }
            | Frame::PtyData { id, .. }
            | Frame::PtyClosed { id } => Some(id),
            Frame::Renewed { .. } => None,
        };
        if let Some(wire) = wire {
            let n = wire
                .strip_prefix('r')
                .and_then(|n| n.parse::<u64>().ok())
                .filter(|n| *n > 0 && *n <= self.next);
            if n.is_none() || format!("r{}", n.unwrap()) != *wire {
                return Err(error("INVALID_FRAME"));
            }
            if let Some(id) = self.http_id(wire)
                && self.expire_http(&id).await?.is_some()
            {
                return Ok(());
            }
        }
        match frame {
            Frame::Response {
                id,
                status,
                content_type,
            } => {
                if !(200..=599).contains(&status)
                    || content_type
                        .as_ref()
                        .is_some_and(|v| v.len() > 256 || v.contains(['\r', '\n', '\0']))
                {
                    return Err(error("INVALID_FRAME"));
                }
                if let Some(id) = self.http_id(&id) {
                    let h = self.http.get_mut(&id).unwrap();
                    if !h.submitted || h.head.is_some() {
                        return Err(error("INVALID_FRAME"));
                    }
                    h.head = Some(ResponseHead {
                        status,
                        content_type,
                        size: 0,
                    });
                }
            }
            Frame::Chunk { id, data } => {
                let bytes = decode(&data).map_err(|_| error("INVALID_FRAME"))?;
                if let Some(id) = self.http_id(&id) {
                    let h = self.http.get_mut(&id).unwrap();
                    if h.head.is_none()
                        || h.complete
                        || h.body.len() + bytes.len() > MAX_BODY
                        || self.response_bytes + bytes.len() > MAX_BODY
                    {
                        return Err(error("RESPONSE_LIMIT"));
                    }
                    h.body
                        .try_reserve_exact(bytes.len())
                        .map_err(|_| error("RESPONSE_LIMIT"))?;
                    h.body.extend_from_slice(&bytes);
                    self.response_bytes += bytes.len();
                }
            }
            Frame::End { id } => {
                if let Some(id) = self.http_id(&id) {
                    let h = self.http.get_mut(&id).unwrap();
                    let mut head = h.head.clone().ok_or_else(|| error("INVALID_FRAME"))?;
                    if h.complete {
                        return Err(error("INVALID_FRAME"));
                    }
                    head.size = h.body.len();
                    h.complete = true;
                    let reply = h.finish.take().ok_or_else(|| error("INVALID_FRAME"))?;
                    if reply.send(Ok(head)).is_err() {
                        self.remove_http(&id);
                    }
                }
            }
            Frame::Ack { id, received } => {
                if let Some(id) = self.http_id(&id) {
                    let h = self.http.get_mut(&id).unwrap();
                    let (expected, reply, _) =
                        h.write.take().ok_or_else(|| error("INVALID_FRAME"))?;
                    if received != expected {
                        let _ = reply.send(Err(error("INVALID_FRAME")));
                        return Err(error("INVALID_FRAME"));
                    }
                    h.written = received;
                    let _ = reply.send(Ok(WriteAck { received }));
                }
            }
            Frame::Error { id, code } => {
                if code.len() > 128 {
                    return Err(error("INVALID_FRAME"));
                }
                if let Some(id) = self.http_id(&id) {
                    if let Some(h) = self.remove_http(&id) {
                        h.fail("REMOTE_REQUEST_FAILED");
                    }
                } else if let Some(id) = self.pty_id(&id) {
                    self.close_pty(&id, "REMOTE_PTY_FAILED").await?;
                }
            }
            Frame::PtyReady { id } => {
                if let Some(id) = self.pty_id(&id) {
                    let p = self.ptys.get_mut(&id).unwrap();
                    if p.ready {
                        return Err(error("INVALID_FRAME"));
                    }
                    p.ready = true;
                    p.sent += 1;
                    p.unacked_since = Some(Instant::now());
                    let sequence = p.sent;
                    self.emit(TransportEvent::PtyReady {
                        operation: self.operation(&id),
                        sequence,
                    })?;
                }
            }
            Frame::PtyData { id, data } => {
                decode(&data).map_err(|_| error("INVALID_FRAME"))?;
                if let Some(id) = self.pty_id(&id) {
                    let p = self.ptys.get_mut(&id).unwrap();
                    if !p.ready {
                        return Err(error("INVALID_FRAME"));
                    }
                    if p.sent - p.acked >= 32 {
                        self.close_pty(&id, "PTY_BACKPRESSURE").await?;
                        return Ok(());
                    }
                    p.sent += 1;
                    let sequence = p.sent;
                    p.unacked_since.get_or_insert(Instant::now());
                    self.emit(TransportEvent::PtyData {
                        operation: self.operation(&id),
                        sequence,
                        base64: data,
                    })?;
                }
            }
            Frame::PtyClosed { id } => {
                if let Some(id) = self.pty_id(&id) {
                    let p = self.ptys.remove(&id).unwrap();
                    self.emit(TransportEvent::PtyClosed {
                        operation: self.operation(&id),
                        sequence: p.sent + 1,
                        code: "PTY_CLOSED",
                    })?;
                }
            }
            Frame::Renewed { id, expires_at } => {
                if !self.renewable
                    || !self.renewal_pending
                    || id != self.renewal
                    || expires_at <= self.expires
                {
                    return Err(error("INVALID_FRAME"));
                }
                let deadline = lease(expires_at)?;
                self.expires = expires_at;
                self.deadline = deadline;
                self.renew_at = renewal_at(deadline);
                self.renewal_pending = false;
            }
        }
        Ok(())
    }
    async fn shutdown(&mut self, code: &'static str) {
        for (_, h) in self.http.drain() {
            h.fail(code);
        }
        for (id, p) in self.ptys.drain() {
            (self.events)(TransportEvent::PtyClosed {
                operation: OperationRef {
                    connection: self.reference.clone(),
                    operation_id: id,
                },
                sequence: p.sent + 1,
                code,
            });
        }
        (self.events)(TransportEvent::Closed {
            connection: self.reference.clone(),
            code,
        });
        // No command (including a renewal result) is admitted after this point.
        self.receiver.close();
        let _ = tokio::time::timeout(Duration::from_secs(1), self.socket.close(None)).await;
    }
}
fn error(code: &'static str) -> TransportError {
    TransportError::new(code, Delivery::NotSent)
}
fn fatal(e: &TransportError) -> bool {
    matches!(
        e.code,
        "CONNECTION_CLOSED"
            | "AUTHORIZATION_EXPIRED"
            | "IDENTITY_CHANGED"
            | "TIMEOUT"
            | "PROTOCOL_ERROR"
            | "BRIDGE_CLOSED"
    )
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn lease(expires: u64) -> Result<Instant> {
    let ttl = expires
        .checked_sub(now())
        .filter(|s| *s > 0 && *s <= 301)
        .ok_or_else(|| error("INVALID_FRAME"))?;
    Ok(Instant::now() + Duration::from_secs(ttl))
}
fn renewal_at(deadline: Instant) -> Instant {
    let ttl = deadline.saturating_duration_since(Instant::now());
    deadline - std::cmp::min(Duration::from_secs(60), ttl / 3)
}
fn decode(data: &str) -> Result<Vec<u8>> {
    if data.len() > CHUNK.div_ceil(3) * 4 {
        return Err(TransportError::invalid());
    }
    let bytes = STANDARD
        .decode(data)
        .map_err(|_| TransportError::invalid())?;
    if bytes.len() > CHUNK || STANDARD.encode(&bytes) != data {
        return Err(TransportError::invalid());
    }
    Ok(bytes)
}
fn address(raw: &str) -> Result<String> {
    let mut url = url::Url::parse(raw).map_err(|_| error("INVALID_TARGET"))?;
    #[cfg(test)]
    let fixture = url.scheme() == "http" && url.host_str() == Some("127.0.0.1");
    #[cfg(not(test))]
    let fixture = false;
    let quick = url
        .host_str()
        .and_then(|s| s.strip_suffix(".trycloudflare.com"))
        .is_some_and(|s| {
            !s.is_empty()
                && s.len() <= 63
                && s.split('-').all(|p| {
                    !p.is_empty()
                        && p.bytes()
                            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
                })
        });
    if (!fixture && (url.scheme() != "https" || !quick || url.port().is_some()))
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(error("INVALID_TARGET"));
    }
    url.set_scheme(if fixture { "ws" } else { "wss" })
        .map_err(|_| error("INVALID_TARGET"))?;
    url.set_path("/remote/v1/ws");
    Ok(url.to_string())
}
#[cfg(test)]
pub(super) fn test_address(raw: &str) -> Result<String> {
    address(raw)
}

#[cfg(test)]
#[path = "connection_tests.rs"]
mod tests;
