use anywork_remote::{
    AccountVerifier, Gateway, GatewayConfig, NOISE_SUITE, VerifiedAccount,
    auth::{VerifyFuture, now},
    prologue,
};
use axum::{Router, http::HeaderMap, routing::get};
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use std::{
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};
use tokio_tungstenite::{
    MaybeTlsStream, WebSocketStream, connect_async_with_config,
    tungstenite::{Message, client::IntoClientRequest},
};
struct Fixture {
    ttl: u64,
    issued_at: u64,
}
impl AccountVerifier for Fixture {
    fn verify<'a>(&'a self, token: &'a str) -> VerifyFuture<'a> {
        Box::pin(async move {
            let extension = match token {
                "allowed-test-access" | "same-expiry-access" => 0,
                "renewed-test-access" => 4,
                "another-renewal-access" => 8,
                "long-renewal-access" => 240,
                "another-long-renewal-access" => 480,
                "other-owner-access" => 4,
                "slow-renewal-access" => {
                    tokio::time::sleep(Duration::from_secs(3)).await;
                    8
                }
                _ => anyhow::bail!("AUTH_REJECTED"),
            };
            Ok(VerifiedAccount {
                subject: if token == "other-owner-access" {
                    "different-owner"
                } else {
                    "test-owner"
                }
                .into(),
                expires_at: self.issued_at + self.ttl + extension,
            })
        })
    }
}
type Socket = WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>;
async fn start(ttl: u64) -> (Gateway, Vec<u8>, Arc<AtomicUsize>) {
    let calls = Arc::new(AtomicUsize::new(0));
    let called = calls.clone();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let app = Router::new().route(
        "/api/info",
        get(move |headers: HeaderMap| {
            let called = called.clone();
            async move {
                assert_eq!(
                    headers.get("authorization").unwrap(),
                    "Bearer local-test-secret"
                );
                assert!(
                    headers
                        .get("x-anywork-client-id")
                        .unwrap()
                        .to_str()
                        .unwrap()
                        .starts_with("remote-")
                );
                called.fetch_add(1, Ordering::SeqCst);
                axum::Json(json!({"safe":true}))
            }
        }),
    );
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let key = snow::Builder::new(NOISE_SUITE.parse().unwrap())
        .generate_keypair()
        .unwrap();
    let gateway = Gateway::start(GatewayConfig {
        installation_id: "test-installation".into(),
        private_key: key.private.try_into().unwrap(),
        allowed_origins: vec!["https://test.example".into()],
        local_port: port,
        local_token: "local-test-secret".into(),
        verifier: Arc::new(Fixture {
            ttl,
            issued_at: now(),
        }),
    })
    .await
    .unwrap();
    (gateway, key.public, calls)
}
async fn socket(port: u16, origin: &str) -> Result<Socket, tokio_tungstenite::tungstenite::Error> {
    socket_with_kind(port, origin, None).await
}
async fn socket_with_kind(
    port: u16,
    origin: &str,
    user_agent: Option<&str>,
) -> Result<Socket, tokio_tungstenite::tungstenite::Error> {
    let mut request = format!("ws://127.0.0.1:{port}/remote/v1/ws")
        .into_client_request()
        .unwrap();
    request
        .headers_mut()
        .insert("origin", origin.parse().unwrap());
    if let Some(user_agent) = user_agent {
        request
            .headers_mut()
            .insert("user-agent", user_agent.parse().unwrap());
    }
    // Match browser WebSocket clients: do not add Nagle/delayed-ACK waits to
    // each pair of small request/end frames in the throughput regression.
    Ok(connect_async_with_config(request, None, true).await?.0)
}
async fn connect(port: u16, key: &[u8], token: &str) -> (Socket, snow::TransportState) {
    let mut socket = socket(port, "https://test.example").await.unwrap();
    let noise = authenticate(&mut socket, key, token).await;
    (socket, noise)
}
async fn authenticate(socket: &mut Socket, key: &[u8], token: &str) -> snow::TransportState {
    let mut hs = initiator(key);
    let mut b = vec![0; 65535];
    let n = hs
        .write_message(
            &serde_json::to_vec(
                &json!({"type":"auth","installationId":"test-installation","accessToken":token}),
            )
            .unwrap(),
            &mut b,
        )
        .unwrap();
    socket
        .send(Message::Binary(b[..n].to_vec().into()))
        .await
        .unwrap();
    let message = socket.next().await.unwrap().unwrap();
    let n = hs.read_message(&message.into_data(), &mut b).unwrap();
    assert_eq!(
        serde_json::from_slice::<Value>(&b[..n]).unwrap()["type"],
        "ready"
    );
    hs.into_transport_mode().unwrap()
}
fn initiator(key: &[u8]) -> snow::HandshakeState {
    let local = snow::Builder::new(NOISE_SUITE.parse().unwrap())
        .generate_keypair()
        .unwrap();
    snow::Builder::new(NOISE_SUITE.parse().unwrap())
        .local_private_key(&local.private)
        .unwrap()
        .remote_public_key(key)
        .unwrap()
        .prologue(&prologue("test-installation"))
        .unwrap()
        .build_initiator()
        .unwrap()
}
fn encrypt(noise: &mut snow::TransportState, value: Value) -> Vec<u8> {
    let mut b = vec![0; 65535];
    let n = noise
        .write_message(&serde_json::to_vec(&value).unwrap(), &mut b)
        .unwrap();
    b[..n].to_vec()
}
async fn receive(socket: &mut Socket, noise: &mut snow::TransportState) -> Value {
    let bytes = socket.next().await.unwrap().unwrap().into_data();
    let mut b = vec![0; 65535];
    let n = noise.read_message(&bytes, &mut b).unwrap();
    serde_json::from_slice(&b[..n]).unwrap()
}
async fn assert_closed(socket: &mut Socket, seconds: u64) {
    let next = tokio::time::timeout(Duration::from_secs(seconds), socket.next())
        .await
        .expect("connection did not close before timeout");
    assert!(
        matches!(next, None | Some(Ok(Message::Close(_))) | Some(Err(_))),
        "denied/expired authorization must not send a binary ACK: {next:?}"
    );
}
#[tokio::test]
async fn encrypted_request_preserves_local_auth_and_disable_closes_it() {
    let (mut gateway, key, calls) = start(60).await;
    let shutdown = gateway.shutdown_observer();
    assert!(!shutdown.is_complete());
    let (mut ws, mut noise) = connect(gateway.port, &key, "allowed-test-access").await;
    for value in [
        json!({"type":"request","id":"r1","method":"GET","path":"/api/info","size":0}),
        json!({"type":"end","id":"r1"}),
    ] {
        ws.send(Message::Binary(encrypt(&mut noise, value).into()))
            .await
            .unwrap()
    }
    assert_eq!(receive(&mut ws, &mut noise).await["status"], 200);
    let body = receive(&mut ws, &mut noise).await;
    assert_eq!(body["type"], "chunk");
    assert_eq!(receive(&mut ws, &mut noise).await["type"], "end");
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    gateway.close().await;
    assert!(shutdown.is_complete());
    assert!(gateway.shutdown_observer().is_complete());
    assert!(gateway.remote_clients().is_empty());
    assert_closed(&mut ws, 1).await;
}
#[tokio::test]
async fn rejects_unknown_origins_plaintext_and_bad_account() {
    let (mut gateway, key, calls) = start(60).await;
    assert!(socket(gateway.port, "https://evil.example").await.is_err());
    let mut ws = socket(gateway.port, "https://test.example").await.unwrap();
    ws.send(Message::Text("{\"token\":\"local-test-secret\"}".into()))
        .await
        .unwrap();
    assert_closed(&mut ws, 1).await;
    let mut ws = socket(gateway.port, "https://test.example").await.unwrap();
    let mut hs = initiator(&key);
    let mut b = vec![0; 65535];
    let n=hs.write_message(&serde_json::to_vec(&json!({"type":"auth","installationId":"test-installation","accessToken":"other-account"})).unwrap(),&mut b).unwrap();
    ws.send(Message::Binary(b[..n].to_vec().into()))
        .await
        .unwrap();
    assert_closed(&mut ws, 1).await;
    assert!(gateway.remote_clients().is_empty());
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    gateway.close().await;
}
#[tokio::test]
async fn replay_and_tampering_fail_before_second_local_request() {
    let (mut gateway, key, calls) = start(60).await;
    let (mut ws, mut noise) = connect(gateway.port, &key, "allowed-test-access").await;
    let frame = encrypt(
        &mut noise,
        json!({"type":"request","id":"r1","method":"GET","path":"/api/info","size":0}),
    );
    ws.send(Message::Binary(frame.clone().into()))
        .await
        .unwrap();
    ws.send(Message::Binary(frame.into())).await.unwrap();
    assert_closed(&mut ws, 1).await;
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    let (mut ws, mut noise) = connect(gateway.port, &key, "allowed-test-access").await;
    let mut frame = encrypt(
        &mut noise,
        json!({"type":"request","id":"r1","method":"GET","path":"/api/info","size":0}),
    );
    frame[0] ^= 1;
    ws.send(Message::Binary(frame.into())).await.unwrap();
    assert_closed(&mut ws, 1).await;
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    gateway.close().await;
}
#[tokio::test]
async fn authorization_expiry_closes_without_fallback() {
    // Unix-second expiry must leave at least one complete second to handshake,
    // even when the fixture is created just before a wall-clock boundary.
    let (mut gateway, key, calls) = start(2).await;
    let (mut ws, _noise) = connect(gateway.port, &key, "allowed-test-access").await;
    wait_for_clients(&gateway, 1).await;
    assert_closed(&mut ws, 3).await;
    wait_for_clients(&gateway, 0).await;
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    gateway.close().await;
}
#[tokio::test]
async fn encrypted_renewal_keeps_same_connection_past_old_expiry_and_1024_requests() {
    let (mut gateway, key, calls) = start(2).await;
    let (mut ws, mut noise) = connect(gateway.port, &key, "allowed-test-access").await;
    wait_for_clients(&gateway, 1).await;
    let original_clients = gateway.remote_clients();
    ws.send(Message::Binary(
        encrypt(
            &mut noise,
            // Give the 1030 real HTTP round trips a separate CI throughput
            // budget. Expiry rejection is covered by the short-lease tests.
            json!({"type":"auth.renew","id":1,"accessToken":"long-renewal-access"}),
        )
        .into(),
    ))
    .await
    .unwrap();
    let renewed = receive(&mut ws, &mut noise).await;
    assert_eq!(renewed["type"], "auth.renewed");
    assert_eq!(renewed["id"], 1);
    tokio::time::sleep(Duration::from_secs(2)).await;
    // The old lease is dead. The original Noise connection remains authorized,
    // and polling cannot exhaust a total 1024-request budget after renewal.
    for n in 1..=1030 {
        let id = format!("r{n}");
        for frame in [
            json!({"type":"request","id":id,"method":"GET","path":"/api/info","size":0}),
            json!({"type":"end","id":id}),
        ] {
            ws.send(Message::Binary(encrypt(&mut noise, frame).into()))
                .await
                .unwrap();
        }
        assert_eq!(receive(&mut ws, &mut noise).await["status"], 200);
        assert_eq!(receive(&mut ws, &mut noise).await["type"], "chunk");
        assert_eq!(receive(&mut ws, &mut noise).await["type"], "end");
    }
    assert_eq!(calls.load(Ordering::SeqCst), 1030);
    ws.send(Message::Binary(
        encrypt(
            &mut noise,
            json!({"type":"auth.renew","id":2,"accessToken":"another-long-renewal-access"}),
        )
        .into(),
    ))
    .await
    .unwrap();
    assert_eq!(receive(&mut ws, &mut noise).await["id"], 2);
    assert_eq!(
        gateway.remote_clients(),
        original_clients,
        "renewal retains connection id and start time"
    );
    gateway.close().await;
    assert!(gateway.remote_clients().is_empty());
    assert_closed(&mut ws, 1).await;
}
#[tokio::test]
async fn bad_renewals_close_before_business_work_or_another_lease() {
    let (mut gateway, key, calls) = start(30).await;
    for (id, token) in [
        (1, "wrong-token"),
        (1, "allowed-test-access"),
        (1, "same-expiry-access"),
        (1, "other-owner-access"),
        (2, "renewed-test-access"),
    ] {
        let (mut ws, mut noise) = connect(gateway.port, &key, "allowed-test-access").await;
        ws.send(Message::Binary(
            encrypt(
                &mut noise,
                json!({"type":"auth.renew","id":id,"accessToken":token}),
            )
            .into(),
        ))
        .await
        .unwrap();
        assert_closed(&mut ws, 1).await;
        wait_for_clients(&gateway, 0).await;
    }
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    gateway.close().await;
}
#[tokio::test]
async fn renewal_verification_cannot_outlive_the_previous_lease_or_local_disable() {
    let (mut gateway, key, calls) = start(2).await;
    let (mut ws, mut noise) = connect(gateway.port, &key, "allowed-test-access").await;
    ws.send(Message::Binary(
        encrypt(
            &mut noise,
            json!({"type":"auth.renew","id":1,"accessToken":"slow-renewal-access"}),
        )
        .into(),
    ))
    .await
    .unwrap();
    assert_closed(&mut ws, 3).await;
    wait_for_clients(&gateway, 0).await;
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    gateway.close().await;
    let (mut gateway, key, _) = start(30).await;
    let (mut ws, mut noise) = connect(gateway.port, &key, "allowed-test-access").await;
    ws.send(Message::Binary(
        encrypt(
            &mut noise,
            json!({"type":"auth.renew","id":1,"accessToken":"slow-renewal-access"}),
        )
        .into(),
    ))
    .await
    .unwrap();
    gateway.close().await;
    assert_closed(&mut ws, 1).await;
    assert!(gateway.remote_clients().is_empty());
}

async fn wait_for_clients(gateway: &Gateway, count: usize) {
    tokio::time::timeout(Duration::from_secs(2), async {
        while gateway.remote_clients().len() != count {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("active encrypted connection registry did not converge");
}

#[tokio::test]
async fn only_authenticated_connections_project_bounded_device_hints_and_disconnect_cleanup() {
    let (mut gateway, key, _) = start(60).await;
    let mut sockets = Vec::new();
    let started = now();
    for (ua, expected) in [
        (Some("fixture iPhone private-ua"), "ios"),
        (Some("fixture Linux Android private-ua"), "android"),
        (Some("fixture X11 Linux private-ua"), "desktop"),
        (None, "unknown"),
    ] {
        let count = sockets.len();
        let mut ws = socket_with_kind(gateway.port, "https://test.example", ua)
            .await
            .unwrap();
        // An upgraded, unverified socket must not appear as a connected device.
        tokio::time::sleep(Duration::from_millis(20)).await;
        assert_eq!(gateway.remote_clients().len(), count);
        authenticate(&mut ws, &key, "allowed-test-access").await;
        wait_for_clients(&gateway, count + 1).await;
        let json = serde_json::to_value(gateway.remote_clients()).unwrap();
        let record = &json[count];
        assert_eq!(record.as_object().unwrap().len(), 3);
        assert_eq!(record["kind"], expected);
        assert!(record["id"].as_str().unwrap().starts_with("connection-"));
        assert!(record["connectedAt"].as_u64().unwrap() >= started);
        assert!(!json.to_string().contains("private-ua"));
        sockets.push(ws);
    }
    assert!(
        socket(gateway.port, "https://test.example").await.is_err(),
        "the existing four-socket bound remains enforced"
    );
    let mut ws = sockets.pop().unwrap();
    ws.close(None).await.unwrap();
    wait_for_clients(&gateway, 3).await;
    drop(sockets.pop());
    wait_for_clients(&gateway, 2).await;
    gateway.close().await;
    assert!(gateway.remote_clients().is_empty());
    for mut ws in sockets {
        assert_closed(&mut ws, 1).await;
    }
}

#[tokio::test]
async fn exact_origin_rejects_missing_duplicate_null_and_lookalikes() {
    let (mut gateway, _, calls) = start(60).await;
    let address = format!("ws://127.0.0.1:{}/remote/v1/ws", gateway.port);
    for values in [
        vec![],
        vec!["null"],
        vec!["https://test.example/"],
        vec!["https://test.example.evil"],
        vec!["https://test.example", "https://test.example"],
        vec!["https://test.example", "https://evil.example"],
        vec!["https://test.example, https://evil.example"],
    ] {
        let mut request = address.clone().into_client_request().unwrap();
        for value in values {
            request
                .headers_mut()
                .append("origin", value.parse().unwrap());
        }
        assert!(
            connect_async_with_config(request, None, true)
                .await
                .is_err()
        );
    }
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    gateway.close().await;
}
