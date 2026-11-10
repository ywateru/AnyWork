//! Isolated protocol fixture. Never used by the desktop product.
use anywork_remote::{
    AccountVerifier, Gateway, GatewayConfig, VerifiedAccount,
    auth::{VerifyFuture, now},
};
use axum::{
    Router,
    extract::ws::{Message, WebSocketUpgrade},
    response::IntoResponse,
    routing::{get, post},
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use std::sync::{
    Arc, OnceLock,
    atomic::{AtomicUsize, Ordering},
};
struct Fixture {
    renew_started: OnceLock<u64>,
}
impl AccountVerifier for Fixture {
    fn verify<'a>(&'a self, token: &'a str) -> VerifyFuture<'a> {
        Box::pin(async move {
            let expires_at = match token {
                "test-access" => now() + 300,
                "renew-initial" => *self.renew_started.get_or_init(now) + 4,
                "renew-1" => *self.renew_started.get_or_init(now) + 8,
                "renew-2" => *self.renew_started.get_or_init(now) + 12,
                _ => anyhow::bail!("AUTH_REJECTED"),
            };
            Ok(VerifiedAccount {
                subject: "test-owner".into(),
                expires_at,
            })
        })
    }
}
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let local_port = listener.local_addr()?.port();
    let active_ptys = Arc::new(AtomicUsize::new(0));
    let info_ptys = active_ptys.clone();
    let app = Router::new()
        .route("/api/info", get(move || {
            let count = info_ptys.clone();
            async move { axum::Json(serde_json::json!({"hostname":"fixture","workspace":"fixture","version":"test", "activePtys":count.load(Ordering::SeqCst)})) }
        }))
        .route("/api/sessions/fixture/uploads", post(|body:axum::body::Bytes|async move{body}))
        .route("/api/sessions/slow/document", get(|| async {
            tokio::time::sleep(std::time::Duration::from_millis(5500)).await;
            "slow-response"
        }))
        .route("/api/sessions/fixture/document", get(||async{([("content-type","application/octet-stream")],vec![42u8;100000])}))
        .route("/ws/terminal/fixture", get(move |ws: WebSocketUpgrade| {
            let count = active_ptys.clone();
            async move {
                ws.on_upgrade(move |mut socket| async move {
                    count.fetch_add(1, Ordering::SeqCst);
                    let _ = socket.recv().await;
                    let _ = socket.send(Message::Binary(b"test-ready".to_vec().into())).await;
                    while let Some(Ok(message)) = socket.recv().await {
                        if let Message::Text(text) = message {
                            let _ = socket.send(Message::Binary(text.as_bytes().to_vec().into())).await;
                        }
                    }
                    count.fetch_sub(1, Ordering::SeqCst);
                }).into_response()
            }
        })).layer(axum::extract::DefaultBodyLimit::max(22*1024*1024));
    tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });
    let key = snow::Builder::new(anywork_remote::NOISE_SUITE.parse()?).generate_keypair()?;
    let mut gateway = Gateway::start(GatewayConfig {
        installation_id: "test-installation".into(),
        private_key: key.private.try_into().unwrap(),
        allowed_origins: vec![
            std::env::var("ANYWORK_INTEROP_ORIGIN")
                .unwrap_or_else(|_| "http://127.0.0.1:5173".into()),
        ],
        local_port,
        local_token: "test-local-secret".into(),
        verifier: Arc::new(Fixture {
            renew_started: OnceLock::new(),
        }),
    })
    .await?;
    println!(
        "{}",
        serde_json::json!({"port":gateway.port,"publicKey":URL_SAFE_NO_PAD.encode(key.public),"installationId":"test-installation","fixture":true})
    );
    tokio::signal::ctrl_c().await?;
    gateway.close().await;
    Ok(())
}
