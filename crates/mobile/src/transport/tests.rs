use super::*;
use anywork_remote::{
    AccountVerifier, Gateway, GatewayConfig, VerifiedAccount, auth::VerifyFuture,
};
use axum::{
    Router,
    body::Bytes,
    extract::ws::{Message, WebSocketUpgrade},
    http::StatusCode,
    routing::{get, post},
};
use base64::{
    Engine,
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
};
use serde_json::json;
use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering},
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::sync::mpsc;
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
}
struct Auth {
    epoch: AtomicU64,
    tokens: AtomicUsize,
    denied: AtomicBool,
}
impl Authorization for Auth {
    fn token(&self, _: bool, _: u64) -> AuthFuture<'_, AccessGrant> {
        Box::pin(async move {
            anyhow::ensure!(!self.denied.load(Ordering::SeqCst), "fixture logged out");
            let n = self.tokens.fetch_add(1, Ordering::SeqCst);
            Ok(AccessGrant {
                access_token: format!("fixture-{n}"),
                expires_at: now() + 300,
                epoch: self.epoch.load(Ordering::SeqCst),
            })
        })
    }
    fn ensure_epoch(&self, expected: u64) -> AuthFuture<'_, ()> {
        Box::pin(async move {
            anyhow::ensure!(
                self.epoch.load(Ordering::SeqCst) == expected,
                "fixture epoch changed"
            );
            Ok(())
        })
    }
}
struct Verifier {
    short: bool,
}
impl AccountVerifier for Verifier {
    fn verify<'a>(&'a self, token: &'a str) -> VerifyFuture<'a> {
        Box::pin(async move {
            anyhow::ensure!(token.starts_with("fixture-"), "fixture token");
            Ok(VerifiedAccount {
                subject: "fixture-owner".into(),
                expires_at: now()
                    + if self.short && token == "fixture-0" {
                        3
                    } else {
                        300
                    },
            })
        })
    }
}
struct Fixture {
    service: TransportService,
    info: ConnectionInfo,
    auth: Arc<Auth>,
    gateway: Gateway,
    events: mpsc::UnboundedReceiver<TransportEvent>,
    calls: Arc<AtomicUsize>,
    task: tokio::task::JoinHandle<()>,
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.task.abort();
    }
}
impl Fixture {
    async fn new(short: bool) -> Self {
        let calls = Arc::new(AtomicUsize::new(0));
        let called = calls.clone();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let local_port = listener.local_addr().unwrap().port();
        let router = Router::new()
            .route(
                "/api/info",
                get(|| async { axum::Json(json!({"fixture":true})) }),
            )
            .route(
                "/api/sessions/test/uploads",
                post(|body: Bytes| async {
                    ([("content-type", "application/octet-stream")], body)
                }),
            )
            .route(
                "/api/sessions/test/messages",
                post(move || {
                    let calls = called.clone();
                    async move {
                        calls.fetch_add(1, Ordering::SeqCst);
                        tokio::time::sleep(Duration::from_millis(350)).await;
                        (
                            StatusCode::CONFLICT,
                            axum::Json(json!({"error":"fixture conflict"})),
                        )
                    }
                }),
            )
            .route(
                "/ws/terminal/test",
                get(|ws: WebSocketUpgrade| async {
                    ws.on_upgrade(|mut ws| async move {
                        assert!(ws.recv().await.is_some());
                        ws.send(Message::Binary(b"initial".to_vec().into()))
                            .await
                            .unwrap();
                        while let Some(Ok(Message::Text(text))) = ws.recv().await {
                            let _ = ws
                                .send(Message::Binary(text.as_bytes().to_vec().into()))
                                .await;
                        }
                    })
                }),
            )
            .layer(axum::extract::DefaultBodyLimit::max(MAX_BODY));
        let task = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
        let keys = snow::Builder::new(NOISE_SUITE.parse().unwrap())
            .generate_keypair()
            .unwrap();
        let gateway = Gateway::start(GatewayConfig {
            installation_id: "fixture-installation".into(),
            private_key: keys.private.try_into().unwrap(),
            allowed_origins: vec![MOBILE_ORIGIN.into()],
            local_port,
            local_token: "isolated-local-fixture".into(),
            verifier: Arc::new(Verifier { short }),
        })
        .await
        .unwrap();
        let auth = Arc::new(Auth {
            epoch: AtomicU64::new(1),
            tokens: AtomicUsize::new(0),
            denied: AtomicBool::new(false),
        });
        let service = TransportService::new();
        let (tx, events) = mpsc::unbounded_channel();
        let info = service
            .connect(
                VerifiedTarget {
                    gateway_url: format!("http://127.0.0.1:{}/", gateway.port),
                    installation_id: "fixture-installation".into(),
                    public_key: URL_SAFE_NO_PAD.encode(keys.public),
                    account_epoch: 1,
                    scope_id: "fixture-scope".into(),
                    lifetime: CancellationToken::new(),
                },
                auth.clone(),
                CancellationToken::new(),
                Arc::new(move |event| tx.send(event).is_ok()),
            )
            .await
            .unwrap();
        Self {
            service,
            info,
            auth,
            gateway,
            events,
            calls,
            task,
        }
    }
    fn op(&self, id: &str) -> OperationRef {
        OperationRef {
            connection: self.info.connection.clone(),
            operation_id: id.into(),
        }
    }
    async fn request(
        &self,
        id: &str,
        method: &str,
        path: &str,
        body: &[u8],
    ) -> (ResponseHead, Vec<u8>) {
        let operation = self.op(id);
        self.service
            .http_begin(HttpBegin {
                operation: operation.clone(),
                method: method.into(),
                path: path.into(),
                content_type: Some("application/octet-stream".into()),
                size: body.len(),
            })
            .await
            .unwrap();
        let mut offset = 0;
        for bytes in body.chunks(CHUNK) {
            let ack = self
                .service
                .http_write(HttpWrite {
                    operation: operation.clone(),
                    offset,
                    base64: STANDARD.encode(bytes),
                })
                .await
                .unwrap();
            offset += bytes.len();
            assert_eq!(ack.received, offset);
        }
        let head = self.service.http_finish(operation.clone()).await.unwrap();
        let mut body = Vec::new();
        loop {
            let item = self.service.http_read(operation.clone()).await.unwrap();
            body.extend(STANDARD.decode(item.base64).unwrap());
            if item.done {
                break;
            }
        }
        assert_eq!(head.size, body.len());
        (head, body)
    }
    async fn event(&mut self) -> TransportEvent {
        tokio::time::timeout(Duration::from_secs(3), self.events.recv())
            .await
            .unwrap()
            .unwrap()
    }
}
#[tokio::test]
async fn real_gateway_json_binary_chunks_http_error_and_cleanup() {
    let mut f = Fixture::new(false).await;
    let (head, body) = f.request("json", "GET", "/api/info", b"").await;
    assert_eq!(head.status, 200);
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&body).unwrap()["fixture"],
        true
    );
    let bytes: Vec<_> = (0..100_003).map(|n| (n % 251) as u8).collect();
    let (head, body) = f
        .request("binary", "POST", "/api/sessions/test/uploads", &bytes)
        .await;
    assert_eq!(
        head.content_type.as_deref(),
        Some("application/octet-stream")
    );
    assert_eq!(body, bytes);
    let (head, body) = f
        .request("conflict", "POST", "/api/sessions/test/messages", b"")
        .await;
    assert_eq!(head.status, 409);
    assert!(
        String::from_utf8(body)
            .unwrap()
            .contains("fixture conflict")
    );
    assert!(
        !f.service
            .close(f.info.connection.clone())
            .await
            .cleanup_pending
    );
    assert!(matches!(f.event().await, TransportEvent::Closed { .. }));
    f.gateway.close().await;
}
#[tokio::test]
async fn cancel_before_begin_is_a_tombstone_and_stale_generation_cannot_cancel() {
    let f = Fixture::new(false).await;
    let op = f.op("cancel-first");
    f.service.cancel(op.clone()).await.unwrap();
    let error = f
        .service
        .http_begin(HttpBegin {
            operation: op.clone(),
            method: "POST".into(),
            path: "/api/sessions/test/messages".into(),
            content_type: None,
            size: 0,
        })
        .await
        .unwrap_err();
    assert_eq!(error.code, "OPERATION_RETIRED");
    assert_eq!(f.calls.load(Ordering::SeqCst), 0);
    let mut stale = op;
    stale.connection.generation += 1;
    assert!(f.service.cancel(stale).await.is_err());
    f.service.close_all().await;
}
#[tokio::test]
async fn submitted_cancellation_is_unknown_and_never_replayed() {
    let f = Fixture::new(false).await;
    let op = f.op("mutation");
    f.service
        .http_begin(HttpBegin {
            operation: op.clone(),
            method: "POST".into(),
            path: "/api/sessions/test/messages".into(),
            content_type: None,
            size: 0,
        })
        .await
        .unwrap();
    let service = f.service.clone();
    let finishing = op.clone();
    let task = tokio::spawn(async move { service.http_finish(finishing).await });
    tokio::time::timeout(Duration::from_secs(2), async {
        while f.calls.load(Ordering::SeqCst) == 0 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    f.service.cancel(op.clone()).await.unwrap();
    let error = task.await.unwrap().unwrap_err();
    assert_eq!(error.code, "CANCELLED");
    assert_eq!(error.delivery, Delivery::OutcomeUnknown);
    tokio::time::sleep(Duration::from_millis(400)).await;
    assert_eq!(f.calls.load(Ordering::SeqCst), 1);
    assert!(f.service.http_finish(op).await.is_err());
    f.service.close_all().await;
}
#[tokio::test]
async fn epoch_change_blocks_late_result_and_closes_peer() {
    let mut f = Fixture::new(false).await;
    let op = f.op("epoch");
    f.service
        .http_begin(HttpBegin {
            operation: op.clone(),
            method: "POST".into(),
            path: "/api/sessions/test/messages".into(),
            content_type: None,
            size: 0,
        })
        .await
        .unwrap();
    let service = f.service.clone();
    let task = tokio::spawn(async move { service.http_finish(op).await });
    tokio::time::timeout(Duration::from_secs(2), async {
        while f.calls.load(Ordering::SeqCst) == 0 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    f.auth.epoch.store(2, Ordering::SeqCst);
    assert!(task.await.unwrap().is_err());
    assert!(matches!(f.event().await, TransportEvent::Closed { .. }));
    f.service.close_all().await;
}
#[tokio::test]
async fn real_pty_ready_input_resize_output_ack_and_close() {
    let mut f = Fixture::new(false).await;
    let op = f.op("terminal");
    f.service
        .pty(PtyCommand::Open {
            operation: op.clone(),
            session_id: "test".into(),
        })
        .await
        .unwrap();
    match f.event().await {
        TransportEvent::PtyReady { sequence, .. } => assert_eq!(sequence, 1),
        _ => panic!("expected ready"),
    }
    f.service
        .pty(PtyCommand::Ack {
            operation: op.clone(),
            sequence: 1,
        })
        .await
        .unwrap();
    match f.event().await {
        TransportEvent::PtyData {
            base64, sequence, ..
        } => {
            assert_eq!(STANDARD.decode(base64).unwrap(), b"initial");
            f.service
                .pty(PtyCommand::Ack {
                    operation: op.clone(),
                    sequence,
                })
                .await
                .unwrap();
        }
        _ => panic!("expected bytes"),
    }
    f.service
        .pty(PtyCommand::Input {
            operation: op.clone(),
            data: "你好\n".into(),
        })
        .await
        .unwrap();
    match f.event().await {
        TransportEvent::PtyData { base64, .. } => assert!(
            String::from_utf8(STANDARD.decode(base64).unwrap())
                .unwrap()
                .contains("你好")
        ),
        _ => panic!("expected echo"),
    }
    f.service
        .pty(PtyCommand::Resize {
            operation: op.clone(),
            cols: 90,
            rows: 30,
        })
        .await
        .unwrap();
    f.service
        .pty(PtyCommand::Close { operation: op })
        .await
        .unwrap();
    loop {
        if matches!(f.event().await, TransportEvent::PtyClosed { .. }) {
            break;
        }
    }
    f.service.close_all().await;
}
#[tokio::test]
async fn renewal_preserves_existing_pty_and_later_http() {
    let mut f = Fixture::new(true).await;
    let op = f.op("renew-pty");
    f.service
        .pty(PtyCommand::Open {
            operation: op.clone(),
            session_id: "test".into(),
        })
        .await
        .unwrap();
    for _ in 0..2 {
        let event = f.event().await;
        let sequence = match event {
            TransportEvent::PtyReady { sequence, .. }
            | TransportEvent::PtyData { sequence, .. } => sequence,
            _ => panic!("unexpected close"),
        };
        f.service
            .pty(PtyCommand::Ack {
                operation: op.clone(),
                sequence,
            })
            .await
            .unwrap();
    }
    tokio::time::sleep(Duration::from_secs(4)).await;
    assert!(f.auth.tokens.load(Ordering::SeqCst) >= 2);
    let (head, _) = f.request("after-renew", "GET", "/api/info", b"").await;
    assert_eq!(head.status, 200);
    f.service
        .pty(PtyCommand::Input {
            operation: op,
            data: "still original pty".into(),
        })
        .await
        .unwrap();
    assert!(matches!(f.event().await, TransportEvent::PtyData { .. }));
    f.service.close_all().await;
}
#[test]
fn ipc_flat_dtos_and_target_boundaries() {
    let begin:HttpBegin=serde_json::from_value(json!({"connection":{"connectionId":"x","generation":1},"operationId":"id","method":"GET","path":"/api/info","size":0})).unwrap();
    assert_eq!(begin.operation.operation_id, "id");
    for raw in [
        "http://evil.example/",
        "https://evil.example/",
        "https://x.trycloudflare.com/path",
        "https://x.trycloudflare.com/?token=x",
    ] {
        assert!(super::connection::test_address(raw).is_err());
    }
}

#[tokio::test]
async fn upload_limit_and_invalid_chunks_do_not_advance_or_submit() {
    let f = Fixture::new(false).await;
    let op = f.op("limits");
    assert!(
        f.service
            .http_begin(HttpBegin {
                operation: op.clone(),
                method: "POST".into(),
                path: "/api/sessions/test/uploads".into(),
                content_type: None,
                size: MAX_BODY + 1
            })
            .await
            .is_err()
    );
    f.service
        .http_begin(HttpBegin {
            operation: op.clone(),
            method: "POST".into(),
            path: "/api/sessions/test/uploads".into(),
            content_type: None,
            size: 3,
        })
        .await
        .unwrap();
    for (offset, base64) in [(1, "YWJj"), (0, "YWJj="), (0, "!!")] {
        assert!(
            f.service
                .http_write(HttpWrite {
                    operation: op.clone(),
                    offset,
                    base64: base64.into()
                })
                .await
                .is_err()
        );
    }
    let ack = f
        .service
        .http_write(HttpWrite {
            operation: op.clone(),
            offset: 0,
            base64: "YWJj".into(),
        })
        .await
        .unwrap();
    assert_eq!(ack.received, 3);
    f.service.http_finish(op.clone()).await.unwrap();
    assert_eq!(
        STANDARD
            .decode(f.service.http_read(op).await.unwrap().base64)
            .unwrap(),
        b"abc"
    );
    f.service.close_all().await;
}
#[tokio::test]
async fn exact_22_mib_round_trip_preserves_every_byte() {
    let f = Fixture::new(false).await;
    let bytes = vec![0xa5; MAX_BODY];
    let (head, received) = f
        .request("maximum", "POST", "/api/sessions/test/uploads", &bytes)
        .await;
    assert_eq!(head.size, MAX_BODY);
    assert_eq!(received, bytes);
    f.service.close_all().await;
}
#[tokio::test]
async fn eof_after_submission_is_unknown_and_closes_pending_operations() {
    let mut f = Fixture::new(false).await;
    let op = f.op("eof");
    f.service
        .http_begin(HttpBegin {
            operation: op.clone(),
            method: "POST".into(),
            path: "/api/sessions/test/messages".into(),
            content_type: None,
            size: 0,
        })
        .await
        .unwrap();
    let service = f.service.clone();
    let task = tokio::spawn(async move { service.http_finish(op).await });
    tokio::time::timeout(Duration::from_secs(2), async {
        while f.calls.load(Ordering::SeqCst) == 0 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    f.gateway.close().await;
    let error = task.await.unwrap().unwrap_err();
    assert_eq!(error.delivery, Delivery::OutcomeUnknown);
    assert!(!f.service.close_all().await.cleanup_pending);
}

#[tokio::test]
async fn foreground_checks_native_authorization_and_preserves_valid_connection() {
    let f = Fixture::new(false).await;
    f.service.foreground_validate().await.unwrap();
    assert_eq!(f.auth.tokens.load(Ordering::SeqCst), 2);
    let (head, body) = f.request("after-foreground", "GET", "/api/info", &[]).await;
    assert_eq!(head.status, 200);
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&body).unwrap(),
        json!({"fixture":true})
    );
    assert!(!f.service.close_all().await.cleanup_pending);
}

#[tokio::test]
async fn foreground_revoked_grant_closes_peer_without_reconnection() {
    let mut f = Fixture::new(false).await;
    f.auth.denied.store(true, Ordering::SeqCst);
    assert!(f.service.foreground_validate().await.is_err());
    let event = tokio::time::timeout(Duration::from_secs(2), f.events.recv())
        .await
        .unwrap()
        .unwrap();
    assert!(matches!(
        event,
        TransportEvent::Closed {
            code: "LOGIN_REQUIRED",
            ..
        }
    ));
    assert!(
        f.service
            .http_begin(HttpBegin {
                operation: f.op("revoked"),
                method: "POST".into(),
                path: "/api/sessions/test/messages".into(),
                content_type: None,
                size: 0,
            })
            .await
            .is_err()
    );
    assert_eq!(f.calls.load(Ordering::SeqCst), 0);
    assert!(!f.service.close_all().await.cleanup_pending);
}
