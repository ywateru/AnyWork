//! JSON-RPC plugin transport over owned stdio processes or existing Unix WebSockets.
//! Attached sockets never own the external execution process.
use anyhow::{Context, Result, anyhow};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, Command},
    sync::{Mutex, mpsc, oneshot},
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub protocol_version: u32,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(default)]
    pub capabilities: Vec<String>,
}

pub trait AgentPlugin: Send + Sync {
    fn manifest(&self) -> PluginManifest;
}

type Pending = Arc<Mutex<HashMap<String, oneshot::Sender<Result<Value>>>>>;

enum RpcInput {
    Stdio(ChildStdin),
    Socket(mpsc::UnboundedSender<Option<Value>>),
    Bridge(mpsc::UnboundedSender<BridgeMessage>),
}
pub struct RpcProcess {
    input: Mutex<RpcInput>,
    child: Option<Mutex<Child>>,
    pending: Pending,
    next_id: AtomicU64,
}

/// In-process protocol adapter. Dropping `responses` closes the RPC connection;
/// receiving `None` requests adapter shutdown, never an external engine stop.
pub struct RpcBridge {
    pub requests: mpsc::UnboundedReceiver<BridgeMessage>,
    pub responses: mpsc::UnboundedSender<Value>,
}

pub struct BridgeMessage {
    pub value: Option<Value>,
    pub accepted: oneshot::Sender<Result<()>>,
}

impl RpcProcess {
    pub fn bridge() -> (Arc<Self>, mpsc::UnboundedReceiver<Value>, RpcBridge) {
        let pending: Pending = Default::default();
        let p = pending.clone();
        let (outgoing, requests) = mpsc::unbounded_channel();
        let (responses, mut incoming) = mpsc::unbounded_channel::<Value>();
        let (events, rx) = mpsc::unbounded_channel();
        tokio::spawn(async move {
            while let Some(value) = incoming.recv().await {
                if value.get("method").is_none() && value.get("id").is_some() {
                    if let Some(tx) = p.lock().await.remove(&value["id"].to_string()) {
                        let result = match value.get("error") {
                            Some(error) => Err(anyhow!("{error}")),
                            None => Ok(value["result"].clone()),
                        };
                        let _ = tx.send(result);
                    }
                } else if events.send(value).is_err() {
                    break;
                }
            }
            for (_, tx) in p.lock().await.drain() {
                let _ = tx.send(Err(anyhow!(
                    "Agent adapter disconnected; delivery outcome unknown"
                )));
            }
            let _ = events.send(json!({"method":"plugin/exited","params":{}}));
        });
        (
            Arc::new(Self {
                input: Mutex::new(RpcInput::Bridge(outgoing)),
                child: None,
                pending,
                next_id: AtomicU64::new(1),
            }),
            rx,
            RpcBridge {
                requests,
                responses,
            },
        )
    }

    pub async fn spawn(
        manifest: &PluginManifest,
    ) -> Result<(Arc<Self>, mpsc::UnboundedReceiver<Value>)> {
        anyhow::ensure!(
            manifest.protocol_version == 1,
            "Unsupported plugin protocol"
        );
        let mut child = Command::new(&manifest.command)
            .args(&manifest.args)
            .envs(&manifest.env)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .with_context(|| {
                format!(
                    "Cannot start {}. Install the CLI and log in first.",
                    manifest.command
                )
            })?;
        let input = child.stdin.take().context("plugin stdin missing")?;
        let output = child.stdout.take().context("plugin stdout missing")?;
        let stderr = child.stderr.take().context("plugin stderr missing")?;
        let pending: Pending = Arc::new(Mutex::new(HashMap::new()));
        let (tx, rx) = mpsc::unbounded_channel();
        let p = pending.clone();
        let events = tx.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(output).lines();
            loop {
                match lines.next_line().await {
                    Ok(Some(line)) => match serde_json::from_str::<Value>(&line) {
                        Ok(v) => {
                            if v.get("method").is_none() && v.get("id").is_some() {
                                if let Some(tx) = p.lock().await.remove(&v["id"].to_string()) {
                                    let result = if let Some(err) = v.get("error") {
                                        Err(anyhow!("{err}"))
                                    } else {
                                        Ok(v["result"].clone())
                                    };
                                    let _ = tx.send(result);
                                }
                            } else if events.send(v).is_err() {
                                break;
                            }
                        }
                        Err(e) => tracing::warn!("Invalid plugin JSON: {e}"),
                    },
                    Ok(None) => break,
                    Err(e) => {
                        tracing::warn!("Plugin read failed: {e}");
                        break;
                    }
                }
            }
            for (_, tx) in p.lock().await.drain() {
                let _ = tx.send(Err(anyhow!("Agent process exited")));
            }
            let _ = events.send(json!({"method":"plugin/exited","params":{}}));
        });
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                tracing::debug!("agent: {line}");
            }
        });
        Ok((
            Arc::new(Self {
                input: Mutex::new(RpcInput::Stdio(input)),
                child: Some(Mutex::new(child)),
                pending,
                next_id: AtomicU64::new(1),
            }),
            rx,
        ))
    }

    /// Attach to an existing engine. This connection never owns its process.
    #[cfg(unix)]
    pub async fn connect_unix(
        path: &std::path::Path,
    ) -> Result<(Arc<Self>, mpsc::UnboundedReceiver<Value>)> {
        use futures_util::{SinkExt, StreamExt};
        use tokio_tungstenite::tungstenite::Message;
        let (mut socket, _) = tokio::time::timeout(std::time::Duration::from_secs(5), async {
            let stream = tokio::net::UnixStream::connect(path).await?;
            tokio_tungstenite::client_async("ws://localhost/", stream)
                .await
                .map_err(anyhow::Error::from)
        })
        .await
        .context("Shared Codex connection timed out")??;
        let pending: Pending = Default::default();
        let p = pending.clone();
        let (outgoing, mut outgoing_rx) = mpsc::unbounded_channel::<Option<Value>>();
        let (events, rx) = mpsc::unbounded_channel();
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    value = outgoing_rx.recv() => {
                        match value {
                            Some(Some(value)) => if socket.send(Message::Text(value.to_string().into())).await.is_err() { break; },
                            _ => { let _ = socket.close(None).await; break; }
                        }
                    }
                    message = socket.next() => {
                        match message {
                            Some(Ok(Message::Text(text))) => {
                                let Ok(v) = serde_json::from_str::<Value>(&text) else { continue; };
                                if v.get("method").is_none() && v.get("id").is_some() {
                                    if let Some(tx) = p.lock().await.remove(&v["id"].to_string()) {
                                        let result = match v.get("error") { Some(e) => Err(anyhow!("{e}")), None => Ok(v["result"].clone()) };
                                        let _ = tx.send(result);
                                    }
                                } else if events.send(v).is_err() { break; }
                            }
                            Some(Ok(Message::Ping(bytes))) => { if socket.send(Message::Pong(bytes)).await.is_err() { break; } }
                            Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                            _ => {}
                        }
                    }
                }
            }
            for (_, tx) in p.lock().await.drain() {
                let _ = tx.send(Err(anyhow!("Shared Codex connection closed")));
            }
            let _ = events.send(json!({"method":"plugin/exited","params":{}}));
        });
        Ok((
            Arc::new(Self {
                input: Mutex::new(RpcInput::Socket(outgoing)),
                child: None,
                pending,
                next_id: AtomicU64::new(1),
            }),
            rx,
        ))
    }

    pub async fn send(&self, value: Value) -> Result<()> {
        let mut input = self.input.lock().await;
        let receipt = match &mut *input {
            RpcInput::Stdio(input) => {
                input
                    .write_all(serde_json::to_string(&value)?.as_bytes())
                    .await?;
                input.write_all(b"\n").await?;
                input.flush().await?;
                None
            }
            RpcInput::Socket(tx) => {
                tx.send(Some(value))
                    .map_err(|_| anyhow!("Shared Codex connection closed"))?;
                None
            }
            RpcInput::Bridge(tx) => {
                let (accepted, result) = oneshot::channel();
                tx.send(BridgeMessage {
                    value: Some(value),
                    accepted,
                })
                .map_err(|_| anyhow!("Agent adapter disconnected"))?;
                Some(result)
            }
        };
        drop(input);
        // An adapter can need another RPC to finish this request. Never retain
        // the transport lock while waiting for its remote acknowledgement.
        if let Some(receipt) = receipt {
            tokio::time::timeout(std::time::Duration::from_secs(90), receipt)
                .await
                .context("Agent adapter timed out; delivery outcome unknown")?
                .context("Agent adapter disconnected; delivery outcome unknown")??;
        }
        Ok(())
    }

    pub async fn call(&self, method: &str, params: Value) -> Result<Value> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let key = id.to_string();
        let (tx, rx) = oneshot::channel();
        self.pending.lock().await.insert(key.clone(), tx);
        if let Err(e) = self
            .send(json!({"id":id,"method":method,"params":params}))
            .await
        {
            self.pending.lock().await.remove(&key);
            return Err(e);
        }
        let result = tokio::time::timeout(std::time::Duration::from_secs(90), rx).await;
        self.pending.lock().await.remove(&key);
        result
            .context("Agent request timed out")?
            .context("Agent disconnected")?
    }

    pub async fn close(&self) {
        if let Some(child) = &self.child {
            let _ = child.lock().await.kill().await;
        }
        if let RpcInput::Socket(tx) = &*self.input.lock().await {
            let _ = tx.send(None);
        }
        if let RpcInput::Bridge(tx) = &*self.input.lock().await {
            let (accepted, _) = oneshot::channel();
            let _ = tx.send(BridgeMessage {
                value: None,
                accepted,
            });
        }
    }
}
