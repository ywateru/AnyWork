//! Dormant transport primitives. Production Runtime/adapters have not migrated.
//! No qualified path falls back to `RpcProcess` or its legacy bridge.
use crate::PluginManifest;
use serde::Serialize;
use serde_json::Value;
#[cfg(unix)]
use std::path::PathBuf;
use std::{
    collections::HashMap,
    fmt, io,
    ops::Deref,
    sync::{
        Arc, Mutex, Weak,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader},
    process::{Child, Command},
    sync::{mpsc, oneshot, watch},
    task::JoinHandle,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct Binding(pub [u8; 32]);

/// Called synchronously at the actual writer, serialized with SDK close/cancel.
/// Must not reenter this transport, await, or infer authority from payload JSON.
pub trait Admission: Send + Sync {
    fn admit(&self, binding: &Binding) -> Result<(), Refused>;
}
#[derive(Debug)]
pub struct Refused;

#[derive(Clone)]
pub struct Qualification {
    binding: Binding,
    authority: Arc<dyn Admission>,
}
impl Qualification {
    pub fn new(binding: Binding, authority: Arc<dyn Admission>) -> Self {
        Self { binding, authority }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub enum Kind {
    UnsupportedBridge,
    InvalidLimits,
    InvalidEndpoint,
    Connect,
    Refused,
    QueueFull,
    TooLarge,
    PendingFull,
    Deadline,
    Cancelled,
    Closed,
    OwnerDropped,
    Eof,
    Protocol,
    Write,
    NativeError,
    MetadataOverflow,
    ReceiverDropped,
    IncomingOverflow,
    CleanupUnknown,
    ProducerFailure,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub enum Disposition {
    NotAdmitted,
    Unknown,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Failure {
    pub kind: Kind,
    pub disposition: Disposition,
}
impl Failure {
    fn new(kind: Kind, admitted: bool) -> Self {
        Self {
            kind,
            disposition: if admitted {
                Disposition::Unknown
            } else {
                Disposition::NotAdmitted
            },
        }
    }
}
impl fmt::Display for Failure {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "qualified transport {:?} ({:?})",
            self.kind, self.disposition
        )
    }
}
impl std::error::Error for Failure {}

#[derive(Clone, Copy, Debug)]
pub struct QueueLimit {
    pub count: usize,
    pub item_bytes: usize,
    pub total_bytes: usize,
}
#[derive(Clone, Copy, Debug)]
pub struct Limits {
    pub metadata: QueueLimit,
    pub outbound: QueueLimit,
    pub incoming: QueueLimit,
    pub pending: usize,
}
impl Default for Limits {
    fn default() -> Self {
        Self {
            metadata: QueueLimit {
                count: 128,
                item_bytes: 2048,
                total_bytes: 256 * 1024,
            },
            outbound: QueueLimit {
                count: 16,
                item_bytes: 32 * 1024 * 1024,
                total_bytes: 64 * 1024 * 1024,
            },
            incoming: QueueLimit {
                count: 128,
                item_bytes: 32 * 1024 * 1024,
                total_bytes: 64 * 1024 * 1024,
            },
            pending: 128,
        }
    }
}
impl Limits {
    fn valid(self) -> bool {
        fn within(a: QueueLimit, b: QueueLimit) -> bool {
            a.count > 0
                && a.count <= b.count
                && a.item_bytes > 0
                && a.item_bytes <= b.item_bytes
                && a.total_bytes > 0
                && a.total_bytes <= b.total_bytes
        }
        let max = Self::default();
        within(self.metadata, max.metadata)
            && within(self.outbound, max.outbound)
            && within(self.incoming, max.incoming)
            && self.pending > 0
            && self.pending <= max.pending
    }
}

pub enum Endpoint {
    Owned(PluginManifest),
    #[cfg(unix)]
    Unix(PathBuf),
    /// Existing adapters cannot enforce final native admission; reject explicitly.
    LegacyBridge,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub enum Phase {
    Queued,
    DispatchAdmitted,
    LocalWrite,
    Response,
    Cancelled,
}
#[derive(Clone, Debug, Serialize)]
pub struct Metadata {
    pub request: u64,
    pub binding: Binding,
    pub phase: Phase,
    pub disposition: Disposition,
    pub elapsed_micros: u64,
}

#[derive(Default, Clone, Copy, Debug, PartialEq, Eq)]
pub struct Usage {
    pub count: usize,
    pub bytes: usize,
}
struct Budget {
    limit: QueueLimit,
    usage: Mutex<Usage>,
}
impl Budget {
    fn new(limit: QueueLimit) -> Arc<Self> {
        Arc::new(Self {
            limit,
            usage: Mutex::new(Usage::default()),
        })
    }
    fn reserve(self: &Arc<Self>, bytes: usize) -> Option<Reservation> {
        let mut used = self.usage.lock().unwrap();
        if bytes > self.limit.item_bytes
            || used.count >= self.limit.count
            || bytes > self.limit.total_bytes.saturating_sub(used.bytes)
        {
            return None;
        }
        used.count += 1;
        used.bytes += bytes;
        Some(Reservation {
            budget: self.clone(),
            bytes,
        })
    }
    fn usage(&self) -> Usage {
        *self.usage.lock().unwrap()
    }
}
struct Reservation {
    budget: Arc<Budget>,
    bytes: usize,
}
impl Drop for Reservation {
    fn drop(&mut self) {
        let mut used = self.budget.usage.lock().unwrap();
        used.count -= 1;
        used.bytes -= self.bytes;
    }
}
pub struct Packet<T> {
    value: T,
    _reservation: Reservation,
}
impl<T> Deref for Packet<T> {
    type Target = T;
    fn deref(&self) -> &T {
        &self.value
    }
}
impl<T: fmt::Debug> fmt::Debug for Packet<T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.value.fmt(f)
    }
}

pub struct Receiver<T> {
    rx: mpsc::Receiver<Packet<T>>,
    core: Weak<Core>,
    terminal: watch::Receiver<Option<Kind>>,
}
impl<T> Receiver<T> {
    pub async fn recv(&mut self) -> Option<Packet<T>> {
        loop {
            match self.try_recv() {
                Ok(packet) => return Some(packet),
                Err(mpsc::error::TryRecvError::Disconnected) => return None,
                Err(mpsc::error::TryRecvError::Empty) => {}
            }
            tokio::select! {
                packet = self.rx.recv() => return packet,
                changed = self.terminal.changed() => { if changed.is_err() { return None; } }
            }
        }
    }
    pub fn try_recv(&mut self) -> Result<Packet<T>, mpsc::error::TryRecvError> {
        match self.rx.try_recv() {
            Err(mpsc::error::TryRecvError::Empty) if self.terminal.borrow().is_some() => {
                Err(mpsc::error::TryRecvError::Disconnected)
            }
            result => result,
        }
    }
}
impl<T> Drop for Receiver<T> {
    fn drop(&mut self) {
        if let Some(core) = self.core.upgrade() {
            core.close(Kind::ReceiverDropped);
        }
    }
}
pub type MetadataReceiver = Receiver<Metadata>;
pub type EventReceiver = Receiver<Value>;
pub type Reply = Packet<Value>;
#[derive(Debug)]
pub struct LocalWrite {
    pub request: u64,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Resource {
    Running,
    Detached,
    Reaped,
    CleanupUnknown,
}

struct Entry {
    qualification: Qualification,
    admitted: Arc<AtomicBool>,
    ack: Option<oneshot::Sender<Result<LocalWrite, Failure>>>,
    reply: Option<oneshot::Sender<Result<Reply, Failure>>>,
}
struct State {
    terminal: Option<Kind>,
    next_id: u64,
    pending: HashMap<u64, Entry>,
}
struct Core {
    state: Mutex<State>,
    terminal: watch::Sender<Option<Kind>>,
    meta: mpsc::Sender<Packet<Metadata>>,
    events: mpsc::Sender<Packet<Value>>,
    metadata: Arc<Budget>,
    outbound: Arc<Budget>,
    incoming: Arc<Budget>,
    pending_limit: usize,
    started: Instant,
}
impl Core {
    fn close(&self, reason: Kind) {
        let mut s = self.state.lock().unwrap();
        if s.terminal.is_some() {
            return;
        }
        s.terminal = Some(reason);
        for (_, entry) in s.pending.drain() {
            let error = Failure::new(reason, entry.admitted.load(Ordering::Acquire));
            if let Some(tx) = entry.ack {
                let _ = tx.send(Err(error));
            }
            if let Some(tx) = entry.reply {
                let _ = tx.send(Err(error));
            }
        }
        self.terminal.send_replace(Some(reason));
    }
    fn metadata(&self, id: u64, q: &Qualification, phase: Phase, admitted: bool) {
        let value = Metadata {
            request: id,
            binding: q.binding,
            phase,
            disposition: if admitted {
                Disposition::Unknown
            } else {
                Disposition::NotAdmitted
            },
            elapsed_micros: self.started.elapsed().as_micros().min(u64::MAX as u128) as u64,
        };
        let bytes = serde_json::to_vec(&value)
            .expect("fixed metadata serializes")
            .len();
        let state = self.state.lock().unwrap();
        if state.terminal.is_some() {
            return;
        }
        let failed = match self.metadata.reserve(bytes) {
            Some(reservation) => self
                .meta
                .try_send(Packet {
                    value,
                    _reservation: reservation,
                })
                .is_err(),
            None => true,
        };
        drop(state);
        if failed {
            self.close(Kind::MetadataOverflow);
        }
    }

    fn admit(&self, id: u64, deadline: Instant) -> Result<Qualification, Failure> {
        let mut s = self.state.lock().unwrap();
        if let Some(kind) = s.terminal {
            return Err(Failure::new(kind, false));
        }
        let entry = s
            .pending
            .get_mut(&id)
            .ok_or(Failure::new(Kind::Cancelled, false))?;
        if Instant::now() >= deadline {
            return Err(Failure::new(Kind::Deadline, false));
        }
        let admitted = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            entry
                .qualification
                .authority
                .admit(&entry.qualification.binding)
        }));
        match admitted {
            Ok(Ok(())) => {}
            Ok(Err(_)) => return Err(Failure::new(Kind::Refused, false)),
            Err(_) => return Err(Failure::new(Kind::ProducerFailure, false)),
        }
        entry.admitted.store(true, Ordering::Release);
        Ok(entry.qualification.clone())
    }
    fn ack(&self, id: u64, result: Result<LocalWrite, Failure>) {
        if let Some(tx) = self
            .state
            .lock()
            .unwrap()
            .pending
            .get_mut(&id)
            .and_then(|e| e.ack.take())
        {
            let _ = tx.send(result);
        }
    }
    fn route(&self, mut value: Value, bytes: usize) {
        if !value.is_object() {
            self.close(Kind::Protocol);
            return;
        }
        let Some(reservation) = self.incoming.reserve(bytes) else {
            self.close(Kind::IncomingOverflow);
            return;
        };
        // Serialize reply/event admission with terminal close. A response admitted
        // here may complete before a later close, but closed producers never enqueue.
        let mut state = self.state.lock().unwrap();
        if state.terminal.is_some() {
            return;
        }
        if value.get("method").is_none() && value.get("id").is_some() {
            let entry = value["id"].as_u64().and_then(|id| {
                state
                    .pending
                    .get_mut(&id)
                    .filter(|entry| entry.admitted.load(Ordering::Acquire))
                    .and_then(|entry| {
                        entry
                            .reply
                            .take()
                            .map(|tx| (id, tx, entry.qualification.clone()))
                    })
            });
            drop(state);
            if let Some((id, tx, q)) = entry {
                self.metadata(id, &q, Phase::Response, true);
                let terminal = self.state.lock().unwrap().terminal;
                let result = if let Some(reason) = terminal {
                    Err(Failure::new(reason, true))
                } else if value.get("error").is_some() {
                    Err(Failure::new(Kind::NativeError, true))
                } else {
                    Ok(Packet {
                        value: value["result"].take(),
                        _reservation: reservation,
                    })
                };
                let _ = tx.send(result);
            }
        } else {
            let failed = self
                .events
                .try_send(Packet {
                    value,
                    _reservation: reservation,
                })
                .is_err();
            drop(state);
            if failed {
                self.close(Kind::IncomingOverflow);
            }
        }
    }
}

struct Registration {
    core: Arc<Core>,
    id: u64,
    admitted: Arc<AtomicBool>,
    done: bool,
}
impl Registration {
    fn finish(&mut self) {
        self.done = true;
        self.core.state.lock().unwrap().pending.remove(&self.id);
    }
    fn error(&self, kind: Kind) -> Failure {
        Failure::new(kind, self.admitted.load(Ordering::Acquire))
    }
}
impl Drop for Registration {
    fn drop(&mut self) {
        if self.done {
            return;
        }
        let entry = self.core.state.lock().unwrap().pending.remove(&self.id);
        if let Some(e) = entry {
            self.core.metadata(
                self.id,
                &e.qualification,
                Phase::Cancelled,
                e.admitted.load(Ordering::Acquire),
            );
        }
    }
}
struct Outbound {
    id: u64,
    bytes: Vec<u8>,
    deadline: Instant,
    _reservation: Reservation,
}
struct Waiters {
    registration: Registration,
    ack: oneshot::Receiver<Result<LocalWrite, Failure>>,
    reply: Option<oneshot::Receiver<Result<Reply, Failure>>>,
}

struct Channels {
    core: Arc<Core>,
    outgoing: mpsc::Sender<Outbound>,
    rx: mpsc::Receiver<Outbound>,
    metadata: MetadataReceiver,
    events: EventReceiver,
}
fn channels(limits: Limits) -> Channels {
    let (meta, meta_rx) = mpsc::channel(limits.metadata.count);
    let (events, event_rx) = mpsc::channel(limits.incoming.count);
    let (terminal, _) = watch::channel(None);
    let core = Arc::new(Core {
        state: Mutex::new(State {
            terminal: None,
            next_id: 1,
            pending: HashMap::new(),
        }),
        terminal,
        meta,
        events,
        metadata: Budget::new(limits.metadata),
        outbound: Budget::new(limits.outbound),
        incoming: Budget::new(limits.incoming),
        pending_limit: limits.pending,
        started: Instant::now(),
    });
    let (outgoing, rx) = mpsc::channel(limits.outbound.count);
    let metadata = Receiver {
        rx: meta_rx,
        core: Arc::downgrade(&core),
        terminal: core.terminal.subscribe(),
    };
    let events = Receiver {
        rx: event_rx,
        core: Arc::downgrade(&core),
        terminal: core.terminal.subscribe(),
    };
    Channels {
        core,
        outgoing,
        rx,
        metadata,
        events,
    }
}

pub struct Transport {
    core: Arc<Core>,
    outgoing: mpsc::Sender<Outbound>,
    resource: watch::Receiver<Resource>,
}
impl Drop for Transport {
    fn drop(&mut self) {
        self.core.close(Kind::OwnerDropped);
    }
}

impl Transport {
    pub async fn open(
        endpoint: Endpoint,
        limits: Limits,
    ) -> Result<(Self, MetadataReceiver, EventReceiver), Failure> {
        if !limits.valid() {
            return Err(Failure::new(Kind::InvalidLimits, false));
        }
        if matches!(endpoint, Endpoint::LegacyBridge) {
            return Err(Failure::new(Kind::UnsupportedBridge, false));
        }
        let Channels {
            core,
            outgoing,
            rx,
            metadata,
            events,
        } = channels(limits);
        let (resource_tx, resource) = watch::channel(Resource::Running);
        let (child, tasks) = match endpoint {
            Endpoint::Owned(manifest) => {
                if manifest.protocol_version != 1 {
                    return Err(Failure::new(Kind::InvalidEndpoint, false));
                }
                let mut child = Command::new(&manifest.command)
                    .args(&manifest.args)
                    .envs(&manifest.env)
                    .stdin(std::process::Stdio::piped())
                    .stdout(std::process::Stdio::piped())
                    .stderr(std::process::Stdio::null())
                    .kill_on_drop(true)
                    .spawn()
                    .map_err(|_| Failure::new(Kind::Connect, false))?;
                let input = child
                    .stdin
                    .take()
                    .ok_or(Failure::new(Kind::Connect, false))?;
                let output = child
                    .stdout
                    .take()
                    .ok_or(Failure::new(Kind::Connect, false))?;
                let writer = tokio::spawn(stdio_writer(input, rx, core.clone()));
                let reader = tokio::spawn(stdio_reader(output, core.clone()));
                (Some(child), vec![writer, reader])
            }
            #[cfg(unix)]
            Endpoint::Unix(path) => {
                use tokio_tungstenite::{
                    client_async_with_config, tungstenite::protocol::WebSocketConfig,
                };
                let connect = async {
                    let stream = tokio::net::UnixStream::connect(path)
                        .await
                        .map_err(|_| Failure::new(Kind::Connect, false))?;
                    let config = WebSocketConfig::default()
                        .max_message_size(Some(limits.incoming.item_bytes))
                        .max_frame_size(Some(limits.incoming.item_bytes));
                    client_async_with_config("ws://localhost/", stream, Some(config))
                        .await
                        .map_err(|_| Failure::new(Kind::Connect, false))
                };
                let (socket, _) = tokio::time::timeout(Duration::from_secs(5), connect)
                    .await
                    .map_err(|_| Failure::new(Kind::Connect, false))??;
                let actor = tokio::spawn(socket_actor(socket, rx, core.clone()));
                (None, vec![actor])
            }
            Endpoint::LegacyBridge => unreachable!("rejected before creating channels"),
        };
        tokio::spawn(supervise(
            core.terminal.subscribe(),
            child,
            tasks,
            resource_tx,
        ));
        Ok((
            Self {
                core,
                outgoing,
                resource,
            },
            metadata,
            events,
        ))
    }

    pub fn terminal(&self) -> watch::Receiver<Option<Kind>> {
        self.core.terminal.subscribe()
    }
    pub fn metadata_usage(&self) -> Usage {
        self.core.metadata.usage()
    }
    pub fn outgoing_usage(&self) -> Usage {
        self.core.outbound.usage()
    }
    pub fn incoming_usage(&self) -> Usage {
        self.core.incoming.usage()
    }
    pub fn pending_count(&self) -> usize {
        self.core.state.lock().unwrap().pending.len()
    }

    fn enqueue(
        &self,
        q: Qualification,
        method: Option<&str>,
        value: Value,
        deadline: Instant,
    ) -> Result<Waiters, Failure> {
        if Instant::now() >= deadline {
            return Err(Failure::new(Kind::Deadline, false));
        }
        let (ack_tx, ack) = oneshot::channel();
        let (reply_tx, reply) = oneshot::channel();
        let mut s = self.core.state.lock().unwrap();
        if let Some(kind) = s.terminal {
            return Err(Failure::new(kind, false));
        }
        if s.pending.len() >= self.core.pending_limit {
            return Err(Failure::new(Kind::PendingFull, false));
        }
        let id = s.next_id;
        s.next_id = s
            .next_id
            .checked_add(1)
            .ok_or(Failure::new(Kind::PendingFull, false))?;
        let value = match method {
            Some(method) => {
                if method.len() > self.core.outbound.limit.item_bytes {
                    return Err(Failure::new(Kind::TooLarge, false));
                }
                // Move the caller's value. json! would clone an arbitrary payload
                // before the bounded serializer has a chance to reject it.
                Value::Object(serde_json::Map::from_iter([
                    ("id".into(), Value::from(id)),
                    ("method".into(), Value::String(method.into())),
                    ("params".into(), value),
                ]))
            }
            None => value,
        };
        let bytes = encode(&value, self.core.outbound.limit.item_bytes)?;
        let reservation = self
            .core
            .outbound
            .reserve(bytes.len())
            .ok_or(Failure::new(Kind::QueueFull, false))?;
        let admitted = Arc::new(AtomicBool::new(false));
        s.pending.insert(
            id,
            Entry {
                qualification: q.clone(),
                admitted: admitted.clone(),
                ack: Some(ack_tx),
                reply: method.map(|_| reply_tx),
            },
        );
        drop(s);
        let registration = Registration {
            core: self.core.clone(),
            id,
            admitted,
            done: false,
        };
        self.core.metadata(id, &q, Phase::Queued, false);
        // Metadata overflow closes and drains pending; do not enqueue executable work.
        if let Some(kind) = self.core.state.lock().unwrap().terminal {
            return Err(Failure::new(kind, false));
        }
        self.outgoing
            .try_send(Outbound {
                id,
                bytes,
                deadline,
                _reservation: reservation,
            })
            .map_err(|error| {
                Failure::new(
                    match error {
                        mpsc::error::TrySendError::Full(_) => Kind::QueueFull,
                        mpsc::error::TrySendError::Closed(_) => Kind::Closed,
                    },
                    false,
                )
            })?;
        Ok(Waiters {
            registration,
            ack,
            reply: method.map(|_| reply),
        })
    }

    pub async fn send(
        &self,
        q: Qualification,
        value: Value,
        deadline: Instant,
    ) -> Result<LocalWrite, Failure> {
        let mut w = self.enqueue(q, None, value, deadline)?;
        let result = tokio::time::timeout_at(deadline.into(), &mut w.ack)
            .await
            .map_err(|_| w.registration.error(Kind::Deadline))?
            .map_err(|_| w.registration.error(Kind::Closed))?;
        w.registration.finish();
        result
    }
    pub async fn call(
        &self,
        q: Qualification,
        method: &str,
        params: Value,
        deadline: Instant,
    ) -> Result<Reply, Failure> {
        let mut w = self.enqueue(q, Some(method), params, deadline)?;
        let result = async {
            (&mut w.ack)
                .await
                .map_err(|_| w.registration.error(Kind::Closed))??;
            w.reply
                .as_mut()
                .expect("call has reply")
                .await
                .map_err(|_| w.registration.error(Kind::Closed))?
        };
        let result = match tokio::time::timeout_at(deadline.into(), result).await {
            Ok(result) => result,
            Err(_) => return Err(w.registration.error(Kind::Deadline)),
        };
        w.registration.finish();
        result
    }
    pub async fn close(&self) -> Resource {
        self.core.close(Kind::Closed);
        let mut resource = self.resource.clone();
        loop {
            let state = *resource.borrow_and_update();
            if state != Resource::Running {
                return state;
            }
            if resource.changed().await.is_err() {
                return Resource::CleanupUnknown;
            }
        }
    }
}

struct Limited {
    bytes: Vec<u8>,
    max: usize,
}
impl io::Write for Limited {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if bytes.len() > self.max.saturating_sub(self.bytes.len()) {
            return Err(io::Error::other("frame limit"));
        }
        self.bytes.extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}
fn encode(value: &Value, max: usize) -> Result<Vec<u8>, Failure> {
    let mut output = Limited {
        bytes: Vec::new(),
        max,
    };
    serde_json::to_writer(&mut output, value).map_err(|_| Failure::new(Kind::TooLarge, false))?;
    Ok(output.bytes)
}

struct ActorLifetime(Arc<Core>);
impl Drop for ActorLifetime {
    fn drop(&mut self) {
        self.0.close(Kind::ProducerFailure);
    }
}

async fn stdio_writer<W: AsyncWrite + Unpin>(
    mut input: W,
    mut rx: mpsc::Receiver<Outbound>,
    core: Arc<Core>,
) {
    let _lifetime = ActorLifetime(core.clone());
    while let Some(frame) = rx.recv().await {
        let q = match core.admit(frame.id, frame.deadline) {
            Ok(q) => q,
            Err(error) => {
                core.ack(frame.id, Err(error));
                if error.kind == Kind::ProducerFailure {
                    core.close(error.kind);
                    return;
                }
                continue;
            }
        };
        core.metadata(frame.id, &q, Phase::DispatchAdmitted, true);
        let result = tokio::time::timeout_at(frame.deadline.into(), async {
            input.write_all(&frame.bytes).await?;
            input.write_all(b"\n").await?;
            input.flush().await
        })
        .await;
        match result {
            Ok(Ok(())) => {
                core.metadata(frame.id, &q, Phase::LocalWrite, true);
                core.ack(frame.id, Ok(LocalWrite { request: frame.id }));
            }
            _ => {
                core.close(Kind::Write);
                return;
            }
        }
    }
    core.close(Kind::Closed);
}

async fn stdio_reader<R: tokio::io::AsyncRead + Unpin>(output: R, core: Arc<Core>) {
    let _lifetime = ActorLifetime(core.clone());
    let mut output = BufReader::with_capacity(
        core.incoming.limit.item_bytes.saturating_add(1).min(8192),
        output,
    );
    loop {
        let mut bytes = Vec::new();
        let n = (&mut output)
            .take(core.incoming.limit.item_bytes as u64 + 1)
            .read_until(b'\n', &mut bytes)
            .await;
        match n {
            Ok(0) => {
                core.close(Kind::Eof);
                return;
            }
            Ok(n) if n <= core.incoming.limit.item_bytes => match serde_json::from_slice(&bytes) {
                Ok(value) => core.route(value, n),
                Err(_) => {
                    core.close(Kind::Protocol);
                    return;
                }
            },
            _ => {
                core.close(Kind::Protocol);
                return;
            }
        }
    }
}

#[cfg(unix)]
async fn socket_actor(
    socket: tokio_tungstenite::WebSocketStream<tokio::net::UnixStream>,
    mut rx: mpsc::Receiver<Outbound>,
    core: Arc<Core>,
) {
    let _lifetime = ActorLifetime(core.clone());
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::tungstenite::Message;
    let (mut writer, mut reader) = socket.split();
    loop {
        tokio::select! {
            frame = rx.recv() => {
                let Some(mut frame) = frame else { core.close(Kind::Closed); return; };
                let q = match core.admit(frame.id, frame.deadline) { Ok(q) => q, Err(error) => { core.ack(frame.id, Err(error)); if error.kind == Kind::ProducerFailure { core.close(error.kind); return; } continue; } };
                core.metadata(frame.id, &q, Phase::DispatchAdmitted, true);
                let text = String::from_utf8(std::mem::take(&mut frame.bytes)).expect("JSON is UTF8");
                if !matches!(tokio::time::timeout_at(frame.deadline.into(), writer.send(Message::Text(text.into()))).await, Ok(Ok(()))) { core.close(Kind::Write); return; }
                core.metadata(frame.id, &q, Phase::LocalWrite, true);
                core.ack(frame.id, Ok(LocalWrite { request: frame.id }));
            }
            incoming = reader.next() => match incoming {
                Some(Ok(Message::Text(text))) => match serde_json::from_str(&text) {
                    Ok(value) => core.route(value, text.len()),
                    Err(_) => { core.close(Kind::Protocol); return; }
                },
                Some(Ok(Message::Ping(bytes))) => { if !matches!(tokio::time::timeout(Duration::from_secs(5), writer.send(Message::Pong(bytes))).await, Ok(Ok(()))) { core.close(Kind::Eof); return; } }
                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => { core.close(Kind::Eof); return; }
                _ => {}
            }
        }
    }
}

async fn supervise(
    terminal: watch::Receiver<Option<Kind>>,
    child: Option<Child>,
    tasks: Vec<JoinHandle<()>>,
    resource: watch::Sender<Resource>,
) {
    supervise_with_budget(terminal, child, tasks, resource, Duration::from_secs(5)).await;
}

async fn supervise_with_budget(
    mut terminal: watch::Receiver<Option<Kind>>,
    mut child: Option<Child>,
    tasks: Vec<JoinHandle<()>>,
    resource: watch::Sender<Resource>,
    budget: Duration,
) {
    while terminal.borrow_and_update().is_none() {
        if terminal.changed().await.is_err() {
            break;
        }
    }
    for task in &tasks {
        task.abort();
    }
    if let Some(child) = child.as_mut() {
        let _ = child.start_kill();
    }
    // One budget covers both local task quiescence and process reap. Timeout
    // reports uncertainty but does not detach JoinHandles or an owned process.
    let cleanup = async {
        for task in tasks {
            let _ = task.await;
        }
        match child.as_mut() {
            Some(child) => loop {
                match child.wait().await {
                    Ok(_) => break Resource::Reaped,
                    Err(_) => {
                        resource.send_replace(Resource::CleanupUnknown);
                        tokio::time::sleep(Duration::from_secs(1)).await;
                    }
                }
            },
            None => Resource::Detached,
        }
    };
    tokio::pin!(cleanup);
    match tokio::time::timeout(budget, &mut cleanup).await {
        Ok(outcome) => {
            resource.send_replace(outcome);
        }
        Err(_) => {
            resource.send_replace(Resource::CleanupUnknown);
            let outcome = cleanup.await;
            resource.send_replace(outcome);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::{
        pin::Pin,
        sync::atomic::{AtomicUsize, Ordering},
        task::{Context, Poll, Waker},
    };

    struct Authority {
        allowed: AtomicBool,
        admitted: AtomicUsize,
    }
    impl Admission for Authority {
        fn admit(&self, binding: &Binding) -> Result<(), Refused> {
            assert_eq!(*binding, Binding([3; 32]));
            if !self.allowed.load(Ordering::Acquire) {
                return Err(Refused);
            }
            self.admitted.fetch_add(1, Ordering::AcqRel);
            Ok(())
        }
    }
    fn qualification() -> (Arc<Authority>, Qualification) {
        let a = Arc::new(Authority {
            allowed: AtomicBool::new(true),
            admitted: AtomicUsize::new(0),
        });
        let q = Qualification::new(Binding([3; 32]), a.clone());
        (a, q)
    }
    fn deadline() -> Instant {
        Instant::now() + Duration::from_secs(5)
    }
    struct Wire {
        blocked: AtomicBool,
        bytes: Mutex<Vec<u8>>,
        waker: Mutex<Option<Waker>>,
        entered: Mutex<Option<oneshot::Sender<()>>>,
        fail_after: Option<usize>,
        panic: bool,
    }
    impl Wire {
        fn release(&self) {
            self.blocked.store(false, Ordering::Release);
            if let Some(w) = self.waker.lock().unwrap().take() {
                w.wake();
            }
        }
    }
    struct Writer(Arc<Wire>);
    impl AsyncWrite for Writer {
        fn poll_write(
            self: Pin<&mut Self>,
            cx: &mut Context<'_>,
            bytes: &[u8],
        ) -> Poll<io::Result<usize>> {
            if let Some(tx) = self.0.entered.lock().unwrap().take() {
                let _ = tx.send(());
            }
            assert!(!self.0.panic, "injected writer failure");
            if self.0.blocked.load(Ordering::Acquire) {
                *self.0.waker.lock().unwrap() = Some(cx.waker().clone());
                if self.0.blocked.load(Ordering::Acquire) {
                    return Poll::Pending;
                }
            }
            let mut output = self.0.bytes.lock().unwrap();
            let count = match self.0.fail_after {
                Some(limit) if output.len() >= limit => {
                    return Poll::Ready(Err(io::Error::other("injected partial write")));
                }
                Some(limit) => bytes.len().min(limit - output.len()),
                None => bytes.len(),
            };
            output.extend_from_slice(&bytes[..count]);
            Poll::Ready(Ok(count))
        }
        fn poll_flush(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<io::Result<()>> {
            Poll::Ready(Ok(()))
        }
        fn poll_shutdown(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<io::Result<()>> {
            Poll::Ready(Ok(()))
        }
    }
    fn transport(
        limits: Limits,
        blocked: bool,
        fail_after: Option<usize>,
        panic: bool,
    ) -> (
        Arc<Transport>,
        MetadataReceiver,
        EventReceiver,
        Arc<Wire>,
        oneshot::Receiver<()>,
    ) {
        let Channels {
            core,
            outgoing,
            rx,
            metadata,
            events,
        } = channels(limits);
        let (entered, entered_rx) = oneshot::channel();
        let wire = Arc::new(Wire {
            blocked: AtomicBool::new(blocked),
            bytes: Mutex::new(Vec::new()),
            waker: Mutex::new(None),
            entered: Mutex::new(Some(entered)),
            fail_after,
            panic,
        });
        let writer = tokio::spawn(stdio_writer(Writer(wire.clone()), rx, core.clone()));
        let (resource_tx, resource) = watch::channel(Resource::Running);
        tokio::spawn(supervise(
            core.terminal.subscribe(),
            None,
            vec![writer],
            resource_tx,
        ));
        (
            Arc::new(Transport {
                core,
                outgoing,
                resource,
            }),
            metadata,
            events,
            wire,
            entered_rx,
        )
    }

    #[tokio::test]
    async fn actual_writer_rechecks_queued_binding_and_never_retargets() {
        let (t, _m, _e, wire, entered) = transport(Limits::default(), true, None, false);
        let (a, q) = qualification();
        let first = {
            let t = t.clone();
            let q = q.clone();
            tokio::spawn(async move { t.send(q, json!("first"), deadline()).await })
        };
        entered.await.unwrap(); // first has passed final admission and is blocked in actual write
        let mut second = t
            .enqueue(q.clone(), None, json!("second"), deadline())
            .unwrap();
        assert_eq!(t.outgoing_usage().count, 2);
        a.allowed.store(false, Ordering::Release);
        wire.release();
        assert!(first.await.unwrap().is_ok());
        assert_eq!(
            (&mut second.ack).await.unwrap().unwrap_err(),
            Failure::new(Kind::Refused, false)
        );
        second.registration.finish();
        assert_eq!(&*wire.bytes.lock().unwrap(), b"\"first\"\n");
        assert_eq!(a.admitted.load(Ordering::Acquire), 1);
        // New request with that same captured revoked binding is also refused.
        assert_eq!(
            t.send(q, json!("third"), deadline())
                .await
                .unwrap_err()
                .disposition,
            Disposition::NotAdmitted
        );
        t.close().await;
        assert_eq!(t.outgoing_usage(), Usage::default());
    }

    #[tokio::test]
    async fn queued_cancellation_removes_registration_and_has_zero_wire_effect() {
        let (t, mut m, _e, wire, entered) = transport(Limits::default(), true, None, false);
        let (_, q) = qualification();
        let first = t.enqueue(q.clone(), None, json!(1), deadline()).unwrap();
        entered.await.unwrap();
        let second = t.enqueue(q, None, json!(2), deadline()).unwrap();
        drop(second);
        assert_eq!(t.pending_count(), 1);
        let mut found = false;
        while let Ok(receipt) = m.try_recv() {
            if receipt.phase == Phase::Cancelled && receipt.request == 2 {
                assert_eq!(receipt.disposition, Disposition::NotAdmitted);
                found = true;
            }
        }
        assert!(found);
        wire.release();
        first.ack.await.unwrap().unwrap();
        drop(first.registration);
        t.close().await;
        assert_eq!(&*wire.bytes.lock().unwrap(), b"1\n");
        assert_eq!(t.pending_count(), 0);
        assert_eq!(t.outgoing_usage(), Usage::default());
    }

    #[tokio::test]
    async fn after_admission_close_is_unknown_and_terminal_does_not_need_receipt_drain() {
        let mut limits = Limits::default();
        limits.metadata.count = 2;
        let (t, _m, _e, wire, entered) = transport(limits, true, None, false);
        let (_, q) = qualification();
        let call = {
            let t = t.clone();
            tokio::spawn(async move { t.send(q, json!("blocked"), deadline()).await })
        };
        entered.await.unwrap();
        assert_eq!(t.metadata_usage().count, 2);
        let mut terminal = t.terminal();
        t.close().await;
        assert_eq!(*terminal.borrow_and_update(), Some(Kind::Closed));
        assert_eq!(
            call.await.unwrap().unwrap_err().disposition,
            Disposition::Unknown
        );
        assert!(wire.bytes.lock().unwrap().is_empty());
        assert_eq!(t.pending_count(), 0);
        assert_eq!(t.outgoing_usage(), Usage::default());
    }

    #[tokio::test]
    async fn partial_write_and_writer_panic_are_sticky_unknown() {
        for (limit, panic, reason) in [
            (Some(7), false, Kind::Write),
            (None, true, Kind::ProducerFailure),
        ] {
            let (t, _m, _e, wire, _entered) = transport(Limits::default(), false, limit, panic);
            let (_, q) = qualification();
            let error = t
                .send(q.clone(), json!("abcdefghijk"), deadline())
                .await
                .unwrap_err();
            assert_eq!(error, Failure::new(reason, true));
            assert_eq!(*t.terminal().borrow(), Some(reason));
            assert_eq!(
                t.send(q, json!(null), deadline())
                    .await
                    .unwrap_err()
                    .disposition,
                Disposition::NotAdmitted
            );
            t.close().await;
            assert_eq!(wire.bytes.lock().unwrap().len(), if panic { 0 } else { 7 });
            assert_eq!(t.outgoing_usage(), Usage::default());
        }
    }

    #[tokio::test]
    async fn pending_queue_count_and_bytes_bound_actual_envelopes() {
        let mut limits = Limits::default();
        limits.outbound.count = 3;
        limits.outbound.total_bytes = 6;
        limits.pending = 3;
        let (t, _m, _e, wire, entered) = transport(limits, true, None, false);
        let (_, q) = qualification();
        let first = t.enqueue(q.clone(), None, json!(12), deadline()).unwrap();
        entered.await.unwrap();
        let second = t.enqueue(q.clone(), None, json!(3456), deadline()).unwrap();
        assert_eq!(t.outgoing_usage(), Usage { count: 2, bytes: 6 });
        assert_eq!(
            t.enqueue(q.clone(), None, json!(7), deadline())
                .err()
                .unwrap()
                .kind,
            Kind::QueueFull
        );
        assert_eq!(t.pending_count(), 2);
        drop(second);
        drop(first);
        wire.release();
        t.close().await;
        assert_eq!(t.outgoing_usage(), Usage::default());
        assert_eq!(t.pending_count(), 0);

        let mut limits = Limits::default();
        limits.outbound.count = 1;
        let (t, _m, _e, _wire, entered) = transport(limits, true, None, false);
        let first = t.enqueue(q.clone(), None, json!(1), deadline()).unwrap();
        entered.await.unwrap();
        assert_eq!(
            t.enqueue(q.clone(), None, json!(2), deadline())
                .err()
                .unwrap()
                .kind,
            Kind::QueueFull
        );
        assert_eq!(t.outgoing_usage(), Usage { count: 1, bytes: 1 });
        drop(first);
        t.close().await;
        assert_eq!(t.outgoing_usage(), Usage::default());

        let limits = Limits {
            pending: 1,
            ..Limits::default()
        };
        let (t, _m, _e, _wire, entered) = transport(limits, true, None, false);
        let first = t.enqueue(q.clone(), None, json!(1), deadline()).unwrap();
        entered.await.unwrap();
        assert_eq!(
            t.enqueue(q, None, json!(2), deadline()).err().unwrap().kind,
            Kind::PendingFull
        );
        drop(first);
        t.close().await;
    }

    #[tokio::test]
    async fn actual_metadata_count_item_and_byte_limits_release_on_drop() {
        let (_, q) = qualification();
        for mode in 0..3 {
            let sample = Metadata {
                request: 1,
                binding: q.binding,
                phase: Phase::Queued,
                disposition: Disposition::NotAdmitted,
                elapsed_micros: 0,
            };
            let bytes = serde_json::to_vec(&sample).unwrap().len();
            let mut limits = Limits::default();
            match mode {
                0 => limits.metadata.count = 1,
                1 => limits.metadata.item_bytes = bytes - 1,
                _ => limits.metadata.total_bytes = bytes + 32,
            }
            let Channels {
                core,
                metadata,
                events,
                outgoing,
                rx,
            } = channels(limits);
            core.metadata(1, &q, Phase::Queued, false);
            if mode != 1 {
                assert_eq!(core.metadata.usage().count, 1);
            }
            core.metadata(2, &q, Phase::Queued, false);
            assert_eq!(*core.terminal.borrow(), Some(Kind::MetadataOverflow));
            drop(metadata);
            drop(events);
            drop(outgoing);
            drop(rx);
            assert_eq!(core.metadata.usage(), Usage::default());
        }
        let Channels {
            core,
            mut metadata,
            events,
            outgoing,
            rx,
        } = channels(Limits::default());
        core.metadata(1, &q, Phase::Queued, false);
        let receipt = metadata.recv().await.unwrap();
        assert_eq!(
            core.metadata.usage().bytes,
            serde_json::to_vec(&*receipt).unwrap().len()
        );
        drop(metadata); // held receipt still owns its bytes and count
        assert_eq!(core.metadata.usage().count, 1);
        drop(receipt);
        assert_eq!(core.metadata.usage(), Usage::default());
        drop(events);
        drop(outgoing);
        drop(rx);
    }

    #[tokio::test]
    async fn incoming_payload_limits_and_receiver_loss_close_independently() {
        let mut limits = Limits::default();
        limits.incoming.total_bytes = 32;
        let Channels {
            core,
            metadata,
            mut events,
            outgoing,
            rx,
        } = channels(limits);
        core.route(json!({"method":"x"}), 20);
        let packet = events.recv().await.unwrap();
        core.route(json!({"method":"y"}), 20);
        assert_eq!(*core.terminal.borrow(), Some(Kind::IncomingOverflow));
        assert_eq!(
            core.incoming.usage(),
            Usage {
                count: 1,
                bytes: 20
            }
        );
        drop(packet);
        assert_eq!(core.incoming.usage(), Usage::default());
        drop(events);
        drop(metadata);
        drop(outgoing);
        drop(rx);
    }
    #[tokio::test]
    async fn expired_queued_and_oversized_unicode_never_write() {
        let (t, _m, _e, wire, entered) = transport(Limits::default(), true, None, false);
        let (_, q) = qualification();
        let mut first = t.enqueue(q.clone(), None, json!(1), deadline()).unwrap();
        entered.await.unwrap();
        let end = Instant::now() + Duration::from_millis(5);
        let mut expired = t.enqueue(q.clone(), None, json!(2), end).unwrap();
        tokio::time::sleep_until(end.into()).await;
        wire.release();
        (&mut first.ack).await.unwrap().unwrap();
        assert_eq!(
            (&mut expired.ack).await.unwrap().unwrap_err(),
            Failure::new(Kind::Deadline, false)
        );
        expired.registration.finish();
        first.registration.finish();
        t.close().await;
        assert_eq!(&*wire.bytes.lock().unwrap(), b"1\n");

        let mut limits = Limits::default();
        limits.outbound.item_bytes = 5;
        let (t, _m, _e, wire, _entered) = transport(limits, false, None, false);
        assert_eq!(
            t.call(q.clone(), "xxxxxx", Value::Null, deadline())
                .await
                .unwrap_err(),
            Failure::new(Kind::TooLarge, false)
        );
        assert_eq!(
            t.send(q, json!("界界"), deadline()).await.unwrap_err(),
            Failure::new(Kind::TooLarge, false)
        );
        assert_eq!(t.pending_count(), 0);
        assert_eq!(t.outgoing_usage(), Usage::default());
        assert!(wire.bytes.lock().unwrap().is_empty());
        t.close().await;
    }

    #[tokio::test]
    async fn stdio_oversized_unterminated_input_is_bounded_before_json_parsing() {
        use tokio::io::AsyncWriteExt;
        let mut limits = Limits::default();
        limits.incoming.item_bytes = 32;
        let Channels {
            core,
            metadata: _metadata,
            mut events,
            outgoing: _outgoing,
            rx: _rx,
        } = channels(limits);
        let (input, mut producer) = tokio::io::duplex(128);
        let reader = tokio::spawn(stdio_reader(input, core.clone()));
        // Remain open and provide no newline: a line-based unbounded reader would
        // wait forever here. Only max+1 bytes are needed to reject the frame.
        producer.write_all(&[b'x'; 33]).await.unwrap();
        tokio::time::timeout(Duration::from_secs(1), reader)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(*core.terminal.borrow(), Some(Kind::Protocol));
        assert_eq!(core.incoming.usage(), Usage::default());
        assert!(events.try_recv().is_err());
        core.route(json!({"method":"late"}), 20);
        assert!(events.try_recv().is_err());
    }

    #[tokio::test]
    async fn eof_and_producer_failure_wake_pending_with_full_receipts() {
        for panic in [false, true] {
            let mut limits = Limits::default();
            limits.metadata.count = 2;
            let (t, _metadata, _events, wire, entered) = transport(limits, true, None, panic);
            let (_, q) = qualification();
            let pending = t.enqueue(q, Some("hang"), json!({}), deadline()).unwrap();
            entered.await.unwrap();
            assert_eq!(t.metadata_usage().count, 2);
            if !panic {
                let input = tokio::io::empty();
                stdio_reader(input, t.core.clone()).await;
            }
            let error = pending.ack.await.unwrap().unwrap_err();
            assert_eq!(error.disposition, Disposition::Unknown);
            assert_eq!(
                *t.terminal().borrow(),
                Some(if panic {
                    Kind::ProducerFailure
                } else {
                    Kind::Eof
                })
            );
            drop(pending.registration);
            t.close().await;
            assert!(wire.bytes.lock().unwrap().is_empty());
            assert_eq!(t.pending_count(), 0);
            assert_eq!(t.outgoing_usage(), Usage::default());
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn actual_unix_writer_rechecks_queued_binding_after_socket_pressure() {
        use futures_util::StreamExt;
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = PathBuf::from(format!("/tmp/aw-queue-{}-{stamp}.sock", std::process::id()));
        let listener = tokio::net::UnixListener::bind(&path).unwrap();
        let (release_tx, release_rx) = oneshot::channel();
        let host = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let config = tokio_tungstenite::tungstenite::protocol::WebSocketConfig::default()
                .max_frame_size(Some(32 * 1024 * 1024));
            let mut socket = tokio_tungstenite::accept_async_with_config(stream, Some(config))
                .await
                .unwrap();
            release_rx.await.unwrap(); // no native reading until first send is blocked
            let mut frames = Vec::new();
            while let Some(Ok(message)) = socket.next().await {
                if let tokio_tungstenite::tungstenite::Message::Text(text) = message {
                    frames.push(serde_json::from_str::<Value>(&text).unwrap());
                }
            }
            frames
        });
        let (t, mut metadata, _events) =
            Transport::open(Endpoint::Unix(path.clone()), Limits::default())
                .await
                .unwrap();
        let (a, q) = qualification();
        let end = Instant::now() + Duration::from_secs(15);
        let mut first = t
            .enqueue(
                q.clone(),
                None,
                json!({"first":"x".repeat(16*1024*1024)}),
                end,
            )
            .unwrap();
        loop {
            if metadata.recv().await.unwrap().phase == Phase::DispatchAdmitted {
                break;
            }
        }
        assert!(matches!(
            first.ack.try_recv(),
            Err(oneshot::error::TryRecvError::Empty)
        ));
        let mut second = t
            .enqueue(
                q.clone(),
                None,
                json!({"second":"must not reach host"}),
                end,
            )
            .unwrap();
        assert_eq!(t.outgoing_usage().count, 2);
        a.allowed.store(false, Ordering::Release);
        release_tx.send(()).unwrap();
        tokio::time::timeout_at(end.into(), &mut first.ack)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        assert_eq!(
            tokio::time::timeout_at(end.into(), &mut second.ack)
                .await
                .unwrap()
                .unwrap()
                .unwrap_err(),
            Failure::new(Kind::Refused, false)
        );
        first.registration.finish();
        second.registration.finish();
        assert_eq!(t.close().await, Resource::Detached);
        let frames = tokio::time::timeout_at(end.into(), host)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0]["first"].as_str().unwrap().len(), 16 * 1024 * 1024);
        assert_eq!(a.admitted.load(Ordering::Acquire), 1);
        assert_eq!(t.pending_count(), 0);
        assert_eq!(t.outgoing_usage(), Usage::default());
        std::fs::remove_file(path).unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn unix_oversized_header_closes_without_waiting_for_payload() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = PathBuf::from(format!("/tmp/aw-limit-{}-{stamp}.sock", std::process::id()));
        let listener = tokio::net::UnixListener::bind(&path).unwrap();
        let (release_tx, release_rx) = oneshot::channel();
        let host = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut socket = tokio_tungstenite::accept_async(stream).await.unwrap();
            // Valid unmasked text header, length 33. No body ever follows. The
            // configured frame limit must reject before buffer/JSON admission.
            socket.get_mut().write_all(&[0x81, 33]).await.unwrap();
            release_rx.await.unwrap();
        });
        let mut limits = Limits::default();
        limits.incoming.item_bytes = 32;
        let (t, _metadata, mut events) = Transport::open(Endpoint::Unix(path.clone()), limits)
            .await
            .unwrap();
        let mut terminal = t.terminal();
        if terminal.borrow().is_none() {
            tokio::time::timeout(Duration::from_secs(1), terminal.changed())
                .await
                .unwrap()
                .unwrap();
        }
        assert_eq!(*terminal.borrow(), Some(Kind::Eof));
        assert_eq!(t.incoming_usage(), Usage::default());
        assert!(events.try_recv().is_err());
        assert_eq!(t.close().await, Resource::Detached);
        release_tx.send(()).unwrap();
        host.await.unwrap();
        std::fs::remove_file(path).unwrap();
    }

    #[tokio::test]
    async fn last_owner_drop_reaps_owned_child_without_receipt_drain() {
        let manifest = PluginManifest {
            id: "fake-drop".into(),
            name: "fixture".into(),
            protocol_version: 1,
            command: if cfg!(windows) { "python" } else { "python3" }.into(),
            args: vec![
                "-u".into(),
                "-c".into(),
                "import sys; print('\"ready\"', flush=True); sys.stdin.read()".into(),
            ],
            env: HashMap::new(),
            capabilities: vec![],
        };
        let (t, _metadata, _events) = Transport::open(Endpoint::Owned(manifest), Limits::default())
            .await
            .unwrap();
        let mut resource = t.resource.clone();
        let terminal = t.terminal();
        drop(t);
        assert_eq!(*terminal.borrow(), Some(Kind::OwnerDropped));
        tokio::time::timeout(Duration::from_secs(5), async {
            while *resource.borrow_and_update() == Resource::Running {
                resource.changed().await.unwrap();
            }
        })
        .await
        .unwrap();
        assert_eq!(*resource.borrow(), Resource::Reaped);
    }
    #[tokio::test]
    async fn response_receipt_overflow_cannot_escape_as_success_or_leak_pending() {
        let mut limits = Limits::default();
        limits.metadata.count = 3;
        let (t, _metadata, _events, _wire, _entered) = transport(limits, false, None, false);
        let (_, q) = qualification();
        let mut pending = t.enqueue(q, Some("echo"), json!(null), deadline()).unwrap();
        (&mut pending.ack).await.unwrap().unwrap();
        assert_eq!(t.metadata_usage().count, 3); // queued, admitted, local-write
        t.core
            .route(json!({"id":1,"result":"must not become success"}), 64);
        let reply = pending.reply.take().unwrap().await.unwrap().unwrap_err();
        assert_eq!(reply, Failure::new(Kind::MetadataOverflow, true));
        pending.registration.finish();
        assert_eq!(t.pending_count(), 0);
        assert_eq!(t.incoming_usage(), Usage::default());
        t.close().await;
    }
    #[tokio::test]
    async fn cleanup_timeout_retains_task_ownership_until_quiescence() {
        let (terminal, terminal_rx) = watch::channel(None);
        let (resource, mut outcome) = watch::channel(Resource::Running);
        let (entered, started) = oneshot::channel();
        let (release, blocked) = std::sync::mpsc::channel();
        // A started blocking task cannot be aborted. Production actors are async;
        // this deterministic fixture proves timeout doesn't detach an owner.
        let task = tokio::task::spawn_blocking(move || {
            entered.send(()).unwrap();
            blocked.recv().unwrap();
        });
        started.await.unwrap();
        let supervisor = tokio::spawn(supervise_with_budget(
            terminal_rx,
            None,
            vec![task],
            resource,
            Duration::from_millis(5),
        ));
        terminal.send_replace(Some(Kind::Closed));
        tokio::time::timeout(Duration::from_secs(1), outcome.changed())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(*outcome.borrow_and_update(), Resource::CleanupUnknown);
        assert!(!supervisor.is_finished());
        release.send(()).unwrap();
        tokio::time::timeout(Duration::from_secs(1), supervisor)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(*outcome.borrow(), Resource::Detached);
    }
    #[tokio::test]
    async fn authority_panic_fails_closed_before_wire_without_poisoning_cleanup() {
        struct Panicking;
        impl Admission for Panicking {
            fn admit(&self, _: &Binding) -> Result<(), Refused> {
                panic!("injected authority failure")
            }
        }
        let (t, _metadata, _events, wire, _entered) =
            transport(Limits::default(), false, None, false);
        let q = Qualification::new(Binding([9; 32]), Arc::new(Panicking));
        assert_eq!(
            t.send(q, json!(1), deadline()).await.unwrap_err(),
            Failure::new(Kind::ProducerFailure, false)
        );
        assert_eq!(*t.terminal().borrow(), Some(Kind::ProducerFailure));
        t.close().await;
        assert_eq!(t.pending_count(), 0);
        assert_eq!(t.outgoing_usage(), Usage::default());
        assert!(wire.bytes.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn incoming_count_limit_includes_held_packets() {
        let mut limits = Limits::default();
        limits.incoming.count = 1;
        let Channels {
            core,
            metadata: _metadata,
            mut events,
            outgoing: _outgoing,
            rx: _rx,
        } = channels(limits);
        core.route(json!({"method":"one"}), 16);
        let held = events.recv().await.unwrap();
        core.route(json!({"method":"two"}), 16);
        assert_eq!(*core.terminal.borrow(), Some(Kind::IncomingOverflow));
        assert_eq!(
            core.incoming.usage(),
            Usage {
                count: 1,
                bytes: 16
            }
        );
        drop(held);
        assert_eq!(core.incoming.usage(), Usage::default());
    }
    #[tokio::test]
    async fn receivers_finish_after_close_without_dropping_transport_owner() {
        let (t, mut metadata, mut events, _wire, _entered) =
            transport(Limits::default(), false, None, false);
        let (_, q) = qualification();
        t.send(q.clone(), json!(1), deadline()).await.unwrap();
        t.close().await;
        // All already queued receipts remain inspectable; no new receipt can be
        // published after terminal. An idle recv must then finish, not await a
        // Sender held by the still-alive transport forever.
        t.core.metadata(99, &q, Phase::Queued, false);
        let mut count = 0;
        while tokio::time::timeout(Duration::from_secs(1), metadata.recv())
            .await
            .unwrap()
            .is_some()
        {
            count += 1;
        }
        assert_eq!(count, 3);
        assert!(
            tokio::time::timeout(Duration::from_secs(1), events.recv())
                .await
                .unwrap()
                .is_none()
        );
        assert_eq!(t.metadata_usage(), Usage::default());
    }
}
