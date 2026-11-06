use crate::{ApiError, App};
use axum::{
    extract::{
        Path, State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    http::HeaderMap,
    response::Response,
};
use futures_util::{SinkExt, StreamExt};
use portable_pty::{CommandBuilder, PtySize, native_pty_system};
use serde_json::{Value, json};
use std::{
    io::{Read, Write},
    sync::Arc,
};

pub async fn upgrade(
    State(app): State<Arc<App>>,
    Path(id): Path<String>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Result<Response, ApiError> {
    if let Some(origin) = headers.get("origin").and_then(|o| o.to_str().ok()) {
        let host = headers
            .get("host")
            .and_then(|h| h.to_str().ok())
            .unwrap_or("");
        if !app.origins.iter().any(|o| o == origin)
            && origin != format!("http://{host}")
            && origin != format!("https://{host}")
        {
            return Err(anyhow::anyhow!("Terminal origin is outside allowed origins").into());
        }
    }
    Ok(ws
        .max_message_size(1024 * 1024)
        .on_upgrade(move |socket| async move {
            if let Err(e) = run(app, id, socket).await {
                tracing::debug!("Terminal closed: {e}");
            }
        }))
}
async fn run(app: Arc<App>, id: String, mut socket: WebSocket) -> anyhow::Result<()> {
    let first = tokio::time::timeout(std::time::Duration::from_secs(5), socket.recv())
        .await?
        .ok_or_else(|| anyhow::anyhow!("Missing terminal authentication"))??;
    let auth: Value = serde_json::from_str(first.to_text()?)?;
    if !app.authorized(auth["token"].as_str().unwrap_or("")) {
        socket
            .send(Message::Text(
                json!({"error":"Invalid access token"}).to_string().into(),
            ))
            .await?;
        return Ok(());
    }
    let session = app.session(&id)?;
    let pair = native_pty_system().openpty(PtySize {
        rows: 24,
        cols: 80,
        pixel_width: 0,
        pixel_height: 0,
    })?;
    let mut cmd = CommandBuilder::new(std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into()));
    cmd.cwd(&session.cwd);
    cmd.env("TERM", "xterm-256color");
    let mut child = pair.slave.spawn_command(cmd)?;
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader()?;
    let mut writer = pair.master.take_writer()?;
    let (input_tx, mut input_rx) = tokio::sync::mpsc::channel::<Vec<u8>>(32);
    tokio::task::spawn_blocking(move || {
        while let Some(bytes) = input_rx.blocking_recv() {
            if writer
                .write_all(&bytes)
                .and_then(|_| writer.flush())
                .is_err()
            {
                break;
            }
        }
    });
    let (tx, mut rx) = tokio::sync::mpsc::channel::<Vec<u8>>(64);
    tokio::task::spawn_blocking(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if tx.blocking_send(buf[..n].to_vec()).is_err() {
                        break;
                    }
                }
            }
        }
    });
    let (mut sink, mut source) = socket.split();
    let shutdown = app.shutdown.notified();
    tokio::pin!(shutdown);
    shutdown.as_mut().enable();
    loop {
        if app.stopping.load(std::sync::atomic::Ordering::Relaxed) {
            break;
        }
        tokio::select! {
            _=&mut shutdown=>break,
            bytes=rx.recv()=>match bytes{Some(bytes)=>{if sink.send(Message::Binary(bytes.into())).await.is_err(){break;}},None=>break},
            message=source.next()=>match message{
                Some(Ok(Message::Text(text)))=>{if let Ok(value)=serde_json::from_str::<Value>(&text){match value["type"].as_str(){
                    Some("input")=>{if let Some(data)=value["data"].as_str() && input_tx.try_send(data.as_bytes().to_vec()).is_err(){break;}},
                    Some("resize")=>{let cols=value["cols"].as_u64().unwrap_or(80).clamp(2,500)as u16;let rows=value["rows"].as_u64().unwrap_or(24).clamp(2,200)as u16;let _=pair.master.resize(PtySize{rows,cols,pixel_width:0,pixel_height:0});},_=>{}
                }}},Some(Ok(Message::Ping(p)))=>{let _=sink.send(Message::Pong(p)).await;},Some(Ok(Message::Close(_)))|None|Some(Err(_))=>break,_=>{}
            }
        }
    }
    let _ = child.kill();
    drop(pair.master);
    tokio::task::spawn_blocking(move || {
        let _ = child.wait();
    });
    Ok(())
}
