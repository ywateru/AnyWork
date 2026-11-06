//! Read-only client of the existing desktop daemon. Never resumes a thread or
//! answers its approvals, and dropping this client never stops the daemon.
use anyhow::{Context, Result, bail};
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use std::{
    sync::atomic::{AtomicU64, Ordering},
    time::Duration,
};
use tokio::sync::Mutex;
#[cfg(unix)]
use tokio::{net::UnixStream, time::timeout};
#[cfg(unix)]
use tokio_tungstenite::{WebSocketStream, tungstenite::Message};

pub fn codex_home() -> Result<std::path::PathBuf> {
    std::env::var_os("CODEX_HOME")
        .map(std::path::PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|p| std::path::PathBuf::from(p).join(".codex")))
        .context("Codex home unavailable")
}
pub fn socket_path() -> Result<std::path::PathBuf> {
    Ok(codex_home()?.join("app-server-control/app-server-control.sock"))
}

/// A cold resume must not compete with an independently running CLI writer.
pub fn check_cold_writer(thread: &str) -> Result<()> {
    anyhow::ensure!(!thread.contains(['/', '\\']), "Invalid thread id");
    let path = codex_home()?
        .join("thread-writer-locks")
        .join(format!("{thread}.lock"));
    match std::fs::File::open(path) {
        Ok(file) => {
            file.try_lock().context(
                "会话正由另一个独立 Codex 进程占用，无法连接该进程的控制入口；未启动第二个执行进程",
            )?;
            file.unlock()?;
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e.into()),
    }
    Ok(())
}

#[derive(Default)]
pub struct Observer {
    next_id: AtomicU64,
    #[cfg(unix)]
    socket: Mutex<Option<WebSocketStream<UnixStream>>>,
}
impl Observer {
    pub async fn call(&self, method: &str, params: Value) -> Result<Value> {
        anyhow::ensure!(
            matches!(
                method,
                "thread/list"
                    | "thread/read"
                    | "thread/items/list"
                    | "thread/turns/list"
                    | "model/list"
                    | "thread/goal/get"
            ),
            "Observer is read-only"
        );
        #[cfg(unix)]
        {
            let mut socket = self.socket.lock().await;
            let result = timeout(Duration::from_secs(5), async {
                if socket.is_none() {
                    let stream = UnixStream::connect(socket_path()?).await?;
                    let (mut ws, _) = tokio_tungstenite::client_async("ws://localhost/", stream).await?;
                    query(&mut ws, self.next_id.fetch_add(1, Ordering::Relaxed), "initialize", json!({"clientInfo":{"name":"anywork_observer","version":"0.1.0"},"capabilities":{"experimentalApi":true}})).await?;
                    ws.send(Message::Text(json!({"method":"initialized","params":{}}).to_string().into())).await?;
                    *socket = Some(ws);
                }
                query(socket.as_mut().unwrap(), self.next_id.fetch_add(1, Ordering::Relaxed), method, params).await
            }).await;
            match result {
                Ok(Ok(value)) => Ok(value),
                other => {
                    *socket = None;
                    match other {
                        Ok(Err(e)) => Err(e),
                        _ => bail!("Codex observer timed out"),
                    }
                }
            }
        }
        #[cfg(not(unix))]
        {
            let _ = params;
            bail!("Desktop observer requires a local Unix socket")
        }
    }
}
#[cfg(unix)]
async fn query(
    ws: &mut WebSocketStream<UnixStream>,
    id: u64,
    method: &str,
    params: Value,
) -> Result<Value> {
    // A cancelled HTTP request can leave its response in this shared socket.
    // Unique IDs prevent that late response from satisfying the next query.
    // Notifications are discarded without interpreting their payloads.
    ws.send(Message::Text(
        json!({"id":id,"method":method,"params":params})
            .to_string()
            .into(),
    ))
    .await?;
    while let Some(message) = ws.next().await {
        match message? {
            Message::Text(text) => {
                let v: Value = serde_json::from_str(&text)?;
                if v.get("method").is_none() && v["id"] == id {
                    if let Some(error) = v.get("error") {
                        bail!("{error}");
                    }
                    return Ok(v["result"].clone());
                }
            }
            Message::Ping(bytes) => ws.send(Message::Pong(bytes)).await?,
            Message::Close(_) => break,
            _ => {}
        }
    }
    bail!("Codex observer disconnected")
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use tokio_tungstenite::tungstenite::protocol::Role;
    #[tokio::test]
    async fn cancelled_query_cannot_supply_the_next_queries_response() {
        let (client, server) = UnixStream::pair().unwrap();
        let client = WebSocketStream::from_raw_socket(client, Role::Client, None).await;
        let mut server = WebSocketStream::from_raw_socket(server, Role::Server, None).await;
        let observer = Observer {
            socket: Mutex::new(Some(client)),
            ..Default::default()
        };
        let (received, cancelled) = tokio::sync::oneshot::channel();
        let task = tokio::spawn(async move {
            let first: Value =
                serde_json::from_str(&server.next().await.unwrap().unwrap().into_text().unwrap())
                    .unwrap();
            received.send(()).unwrap();
            let second: Value =
                serde_json::from_str(&server.next().await.unwrap().unwrap().into_text().unwrap())
                    .unwrap();
            assert_ne!(first["id"], second["id"]);
            for (id, result) in [
                (
                    first["id"].clone(),
                    json!({"thread":{"status":{"type":"idle"}}}),
                ),
                (second["id"].clone(), json!({"data":[],"nextCursor":null})),
            ] {
                server
                    .send(Message::Text(
                        json!({"id":id,"result":result}).to_string().into(),
                    ))
                    .await
                    .unwrap();
            }
        });
        // Drop the first in-flight query after the server received it, before
        // its response arrives; this mirrors navigating away during a fetch.
        tokio::select! {
            _ = cancelled => {},
            result = observer.call("thread/read", json!({"threadId":"ordinary"})) => panic!("Query completed before cancellation: {result:?}"),
        }
        let page = observer
            .call("thread/items/list", json!({"threadId":"ordinary"}))
            .await
            .unwrap();
        assert_eq!(page, json!({"data":[],"nextCursor":null}));
        task.await.unwrap();
    }
    #[tokio::test]
    async fn observer_rejects_mutations_and_reads_changing_snapshots() {
        let (client, server) = UnixStream::pair().unwrap();
        let client = WebSocketStream::from_raw_socket(client, Role::Client, None).await;
        let mut server = WebSocketStream::from_raw_socket(server, Role::Server, None).await;
        let observer = Observer {
            socket: Mutex::new(Some(client)),
            ..Default::default()
        };
        let task = tokio::spawn(async move {
            for text in ["partial", "complete"] {
                let request = server.next().await.unwrap().unwrap().into_text().unwrap();
                let request: Value = serde_json::from_str(&request).unwrap();
                assert_eq!(request["method"], "thread/read");
                assert_eq!(request["params"]["threadId"], "ordinary");
                server
                    .send(Message::Text(
                        json!({"method":"thread/status/changed","params":{}})
                            .to_string()
                            .into(),
                    ))
                    .await
                    .unwrap();
                server
                    .send(Message::Text(
                        json!({"id":request["id"],"result":{"text":text}})
                            .to_string()
                            .into(),
                    ))
                    .await
                    .unwrap();
            }
        });
        for method in [
            "thread/resume",
            "thread/fork",
            "turn/start",
            "turn/interrupt",
            "item/commandExecution/requestApproval",
        ] {
            assert!(observer.call(method, json!({})).await.is_err());
        }
        assert_eq!(
            observer
                .call("thread/read", json!({"threadId":"ordinary"}))
                .await
                .unwrap()["text"],
            "partial"
        );
        assert_eq!(
            observer
                .call("thread/read", json!({"threadId":"ordinary"}))
                .await
                .unwrap()["text"],
            "complete"
        );
        task.await.unwrap();
        assert!(
            observer
                .call("thread/read", json!({"threadId":"ordinary"}))
                .await
                .is_err()
        );
        assert!(observer.socket.lock().await.is_none());
    }
}
