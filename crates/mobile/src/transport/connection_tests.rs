// Regression cases adapted from independent review reproductions.

use super::*;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
struct Auth;
impl Authorization for Auth {
    fn token(&self, _: bool, _: u64) -> AuthFuture<'_, AccessGrant> {
        Box::pin(async {
            Ok(AccessGrant {
                access_token: "fixture".into(),
                expires_at: now() + 300,
                epoch: 1,
            })
        })
    }
    fn ensure_epoch(&self, _: u64) -> AuthFuture<'_, ()> {
        Box::pin(async { Ok(()) })
    }
}
async fn actor() -> (Actor, tokio::net::TcpStream, snow::TransportState) {
    let keys = snow::Builder::new(NOISE_SUITE.parse().unwrap())
        .generate_keypair()
        .unwrap();
    let local = snow::Builder::new(NOISE_SUITE.parse().unwrap())
        .generate_keypair()
        .unwrap();
    let mut client = snow::Builder::new(NOISE_SUITE.parse().unwrap())
        .local_private_key(&local.private)
        .unwrap()
        .remote_public_key(&keys.public)
        .unwrap()
        .build_initiator()
        .unwrap();
    let mut server = snow::Builder::new(NOISE_SUITE.parse().unwrap())
        .local_private_key(&keys.private)
        .unwrap()
        .build_responder()
        .unwrap();
    let mut out = vec![0; 65535];
    let mut plain = vec![0; 65535];
    let n = client.write_message(b"", &mut out).unwrap();
    server.read_message(&out[..n], &mut plain).unwrap();
    let n = server.write_message(b"", &mut out).unwrap();
    client.read_message(&out[..n], &mut plain).unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let remote = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        stream
    });
    let socket = tokio::net::TcpStream::connect(("127.0.0.1", port))
        .await
        .unwrap();
    let remote = remote.await.unwrap();
    let (sender, receiver) = mpsc::channel(32);
    let a = Actor {
        reference: ConnectionRef {
            connection_id: "fixture".into(),
            generation: 1,
        },
        socket: Wire::new(Box::new(socket)),
        noise: client.into_transport_mode().unwrap(),
        auth: Arc::new(Auth),
        epoch: 1,
        events: Arc::new(|_| true),
        stop: CancellationToken::new(),
        lifetime: CancellationToken::new(),
        service_lifetime: CancellationToken::new(),
        sender,
        receiver,
        used: HashSet::new(),
        http: HashMap::new(),
        ptys: HashMap::new(),
        next: 0,
        request_bytes: 0,
        response_bytes: 0,
        expires: now() + 300,
        deadline: Instant::now() + Duration::from_secs(300),
        renew_at: Instant::now() + Duration::from_secs(240),
        renewal: 0,
        renewal_pending: false,
        renewable: false,
        token: "fixture".into(),
    };
    (a, remote, server.into_transport_mode().unwrap())
}

async fn remote_frame(
    remote: &mut tokio::net::TcpStream,
    noise: &mut snow::TransportState,
) -> Value {
    let mut length = [0; 4];
    tokio::time::timeout(Duration::from_secs(2), remote.read_exact(&mut length))
        .await
        .unwrap()
        .unwrap();
    let length = u32::from_be_bytes(length) as usize;
    assert!(length > 0 && length <= 65_535);
    let mut bytes = vec![0; length];
    tokio::time::timeout(Duration::from_secs(2), remote.read_exact(&mut bytes))
        .await
        .unwrap()
        .unwrap();
    let mut plain = vec![0; 65_535];
    let n = noise.read_message(&bytes, &mut plain).unwrap();
    serde_json::from_slice(&plain[..n]).unwrap()
}

#[tokio::test]
async fn expired_finish_cancels_without_submitting_end() {
    let (mut a, mut remote, mut noise) = actor().await;
    let op = a.operation("expired");
    a.begin(HttpBegin {
        operation: op.clone(),
        method: "POST".into(),
        path: "/api/sessions/test/messages".into(),
        content_type: None,
        size: 0,
    })
    .await
    .unwrap();
    assert_eq!(
        remote_frame(&mut remote, &mut noise).await["type"],
        "request"
    );
    a.http.get_mut("expired").unwrap().deadline = Instant::now() - Duration::from_millis(1);
    let (reply, receive) = oneshot::channel();
    a.command(Command::Finish(op, reply)).await.unwrap();
    let error = receive.await.unwrap().unwrap_err();
    assert_eq!(error.code, "TIMEOUT");
    assert_eq!(error.delivery, Delivery::NotSent);
    assert_eq!(
        remote_frame(&mut remote, &mut noise).await["type"],
        "cancel"
    );
    assert!(!a.http.contains_key("expired"));
}

#[tokio::test]
async fn expired_read_cannot_deliver_retained_body() {
    let (mut a, mut remote, mut noise) = actor().await;
    let op = a.operation("expired");
    a.begin(HttpBegin {
        operation: op.clone(),
        method: "GET".into(),
        path: "/api/info".into(),
        content_type: None,
        size: 0,
    })
    .await
    .unwrap();
    remote_frame(&mut remote, &mut noise).await;
    let h = a.http.get_mut("expired").unwrap();
    h.deadline = Instant::now() - Duration::from_millis(1);
    h.complete = true;
    h.body = b"late".to_vec();
    a.response_bytes = 4;
    let (reply, receive) = oneshot::channel();
    a.command(Command::Read(op, reply)).await.unwrap();
    let error = receive.await.unwrap().unwrap_err();
    assert_eq!(error.code, "TIMEOUT");
    assert_eq!(error.delivery, Delivery::ResponseComplete);
    assert_eq!(
        remote_frame(&mut remote, &mut noise).await["type"],
        "cancel"
    );
    assert_eq!(a.response_bytes, 0);
}

#[tokio::test]
async fn expired_upload_cannot_send_another_chunk() {
    let (mut a, mut remote, mut noise) = actor().await;
    let op = a.operation("expired");
    a.begin(HttpBegin {
        operation: op.clone(),
        method: "POST".into(),
        path: "/api/sessions/test/uploads".into(),
        content_type: None,
        size: 3,
    })
    .await
    .unwrap();
    remote_frame(&mut remote, &mut noise).await;
    a.http.get_mut("expired").unwrap().deadline = Instant::now() - Duration::from_millis(1);
    let (reply, receive) = oneshot::channel();
    a.command(Command::Write(
        HttpWrite {
            operation: op,
            offset: 0,
            base64: "YWJj".into(),
        },
        reply,
    ))
    .await
    .unwrap();
    assert_eq!(receive.await.unwrap().unwrap_err().code, "TIMEOUT");
    assert_eq!(
        remote_frame(&mut remote, &mut noise).await["type"],
        "cancel"
    );
    assert_eq!(a.request_bytes, 0);
}

#[tokio::test]
async fn expired_inbound_end_does_not_escape_as_success() {
    let (mut a, mut remote, mut noise) = actor().await;
    let op = a.operation("expired");
    a.begin(HttpBegin {
        operation: op.clone(),
        method: "GET".into(),
        path: "/api/info".into(),
        content_type: None,
        size: 0,
    })
    .await
    .unwrap();
    remote_frame(&mut remote, &mut noise).await;
    let (reply, receive) = oneshot::channel();
    a.command(Command::Finish(op, reply)).await.unwrap();
    assert_eq!(remote_frame(&mut remote, &mut noise).await["type"], "end");
    let h = a.http.get_mut("expired").unwrap();
    h.head = Some(ResponseHead {
        status: 200,
        content_type: None,
        size: 0,
    });
    h.deadline = Instant::now() - Duration::from_millis(1);
    let wire = h.wire.clone();
    a.frame(Frame::End { id: wire }).await.unwrap();
    let error = receive.await.unwrap().unwrap_err();
    assert_eq!(error.code, "TIMEOUT");
    assert_eq!(error.delivery, Delivery::OutcomeUnknown);
    assert_eq!(
        remote_frame(&mut remote, &mut noise).await["type"],
        "cancel"
    );
}

#[tokio::test]
async fn foreground_cannot_revive_expired_wall_or_monotonic_lease() {
    for wall_expired in [true, false] {
        let (mut a, _remote, _noise) = actor().await;
        if wall_expired {
            a.expires = now() - 1;
        } else {
            a.deadline = Instant::now() - Duration::from_millis(1);
        }
        let previous = (a.expires, a.deadline);
        let (reply, _receive) = oneshot::channel();
        assert_eq!(
            a.command(Command::Foreground(reply))
                .await
                .unwrap_err()
                .code,
            "AUTHORIZATION_EXPIRED"
        );
        assert_eq!((a.expires, a.deadline), previous);
    }
}

#[tokio::test]
async fn raw_wire_rejects_empty_and_oversized_frames() {
    let (left, mut peer) = tokio::io::duplex(128);
    let mut wire = Wire::new(Box::new(left));
    assert!(wire.send(&[]).await.is_err());
    assert!(wire.send(&vec![0; 65_536]).await.is_err());
    for length in [0u32, 65_536u32] {
        peer.write_all(&length.to_be_bytes()).await.unwrap();
        assert!(wire.recv().await.is_err());
    }
}
