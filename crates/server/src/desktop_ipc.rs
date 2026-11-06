//! Framed desktop-host IPC. Only an explicitly configured existing endpoint is
//! admitted. This client never creates a router, engine, or replacement thread.
use anyhow::{Context, Result, anyhow, ensure};
use serde_json::{Value, json};
use std::{collections::HashMap, path::Path, sync::Arc, time::Duration};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{UnixStream, unix::OwnedWriteHalf},
    sync::{Mutex, mpsc, oneshot, watch},
};

const MAX_FRAME: usize = 0x10000000;
type Pending = Arc<Mutex<HashMap<String, oneshot::Sender<Value>>>>;

#[derive(Debug)]
pub struct Rejected(pub String);
impl std::fmt::Display for Rejected {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Desktop IPC rejected request: {}", self.0)
    }
}
impl std::error::Error for Rejected {}

pub struct Client {
    writer: Arc<Mutex<OwnedWriteHalf>>,
    pending: Pending,
    shutdown: watch::Sender<bool>,
    pub id: String,
}

async fn write(writer: &Mutex<OwnedWriteHalf>, value: &Value) -> Result<()> {
    let bytes = serde_json::to_vec(value)?;
    ensure!(
        !bytes.is_empty() && bytes.len() <= MAX_FRAME,
        "Invalid IPC frame size"
    );
    let mut writer = writer.lock().await;
    writer.write_u32_le(bytes.len() as u32).await?;
    writer.write_all(&bytes).await?;
    writer.flush().await?;
    Ok(())
}

impl Client {
    pub async fn connect(path: &Path) -> Result<(Arc<Self>, mpsc::Receiver<Value>)> {
        use std::os::unix::fs::{FileTypeExt, MetadataExt};
        ensure!(
            path.is_absolute(),
            "Desktop IPC requires an absolute socket path"
        );
        let metadata = std::fs::symlink_metadata(path)?;
        let directory = std::fs::symlink_metadata(path.parent().context("Missing IPC directory")?)?;
        let uid = std::fs::metadata(crate::observer::codex_home()?)?.uid();
        ensure!(
            metadata.file_type().is_socket() && metadata.uid() == uid,
            "Invalid desktop IPC socket owner/type"
        );
        ensure!(
            directory.is_dir()
                && directory.uid() == uid
                && directory.mode() & 0o022 == 0
                && metadata.mode() & 0o077 == 0,
            "Unsafe desktop IPC endpoint permissions"
        );
        let socket =
            tokio::time::timeout(Duration::from_secs(3), UnixStream::connect(path)).await??;
        ensure!(
            socket.peer_cred()?.uid() == uid,
            "Desktop IPC peer owner mismatch"
        );
        let (mut reader, writer) = socket.into_split();
        let writer = Arc::new(Mutex::new(writer));
        let pending: Pending = Default::default();
        let (shutdown, mut closed) = watch::channel(false);
        let (broadcasts, rx) = mpsc::channel(128);
        let p = pending.clone();
        let w = writer.clone();
        let disconnected = shutdown.clone();
        tokio::spawn(async move {
            let result: Result<()> = async {
                loop {
                    let message: Value = tokio::select! {
                        _ = closed.changed() => break,
                        result = async {
                            let length = reader.read_u32_le().await? as usize;
                            ensure!(length > 0 && length <= MAX_FRAME, "Invalid desktop IPC frame size");
                            let mut bytes = vec![0; length];
                            reader.read_exact(&mut bytes).await?;
                            let value: Value = serde_json::from_slice(&bytes)?;
                            ensure!(value.is_object(), "Invalid desktop IPC envelope");
                            Ok::<_, anyhow::Error>(value)
                        } => result?,
                    };
                    match message["type"].as_str() {
                        Some("response") => {
                            if let Some(id) = message["requestId"].as_str()
                                && let Some(tx) = p.lock().await.remove(id) {
                                let _ = tx.send(message);
                            }
                        }
                        Some("broadcast") => broadcasts.try_send(message).context("Desktop IPC stream consumer fell behind")?,
                        Some("client-discovery-request") => write(&w, &json!({"type":"client-discovery-response","requestId":message["requestId"],"response":{"canHandle":false}})).await?,
                        Some("request") => write(&w, &json!({"type":"response","requestId":message["requestId"],"resultType":"error","error":"no-handler-for-request"})).await?,
                        _ => {}
                    }
                }
                Ok(())
            }.await;
            if let Err(error) = result {
                tracing::debug!(%error, "Desktop IPC disconnected");
            }
            p.lock().await.clear();
            let _ = disconnected.send(true);
            let _ = w.lock().await.shutdown().await;
        });
        let mut client = Self {
            writer,
            pending,
            shutdown,
            id: String::new(),
        };
        let initialized = client
            .request("initialize", 0, json!({"clientType":"desktop"}), None)
            .await;
        match initialized.and_then(|value| {
            value["result"]["clientId"]
                .as_str()
                .filter(|v| !v.is_empty())
                .map(str::to_owned)
                .context("Invalid desktop IPC client identity")
        }) {
            Ok(id) => client.id = id,
            Err(error) => {
                client.close().await;
                return Err(error);
            }
        }
        Ok((Arc::new(client), rx))
    }

    pub async fn request(
        &self,
        method: &str,
        version: u32,
        params: Value,
        target: Option<&str>,
    ) -> Result<Value> {
        ensure!(!*self.shutdown.borrow(), "Desktop IPC disconnected");
        let id = uuid::Uuid::new_v4().to_string();
        let (tx, rx) = oneshot::channel();
        self.pending.lock().await.insert(id.clone(), tx);
        let mut message = json!({"type":"request","requestId":id,"method":method,"version":version,"params":params,"timeoutMs":10000});
        if !self.id.is_empty() {
            message["sourceClientId"] = json!(self.id);
        }
        if let Some(target) = target {
            message["targetClientId"] = json!(target);
        }
        // Local follower methods intentionally omit top-level hostId.
        let result = async {
            write(&self.writer, &message)
                .await
                .context("Desktop IPC write failed; delivery outcome unknown")?;
            let response = tokio::time::timeout(Duration::from_secs(12), rx)
                .await
                .context("Desktop IPC request timed out; delivery outcome unknown")?
                .context("Desktop IPC disconnected; delivery outcome unknown")?;
            if response["resultType"] == "error" {
                let code = response["error"].as_str().unwrap_or("unknown-error");
                if matches!(
                    code,
                    "no-client-found" | "no-handler-for-request" | "request-version-mismatch"
                ) {
                    return Err(Rejected(code.into()).into());
                }
                return Err(anyhow!(
                    "Desktop IPC request failed ({code}); delivery outcome unknown"
                ));
            }
            ensure!(
                response["resultType"] == "success" && response["method"] == method,
                "Desktop IPC invalid reply; delivery outcome unknown"
            );
            if let Some(target) = target {
                ensure!(
                    response["handledByClientId"] == target,
                    "Desktop IPC owner changed; delivery outcome unknown"
                );
            }
            Ok(response)
        }
        .await;
        self.pending.lock().await.remove(&id);
        result
    }

    pub async fn follow(&self, thread: &str, owner: &str, following: bool) -> Result<()> {
        write(&self.writer, &json!({"type":"broadcast","method":"thread-stream-following-changed","version":1,"sourceClientId":self.id,"targetClientIds":[owner],"params":{"conversationId":thread,"hostId":"local","following":following}})).await
    }

    pub async fn close(&self) {
        let _ = self.shutdown.send(true);
        let _ = self.writer.lock().await.shutdown().await;
    }

    pub async fn closed(&self) {
        let mut closed = self.shutdown.subscribe();
        while !*closed.borrow_and_update() {
            if closed.changed().await.is_err() {
                break;
            }
        }
    }
}
