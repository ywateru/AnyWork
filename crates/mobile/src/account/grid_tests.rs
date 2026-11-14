//! Actual pinned SDK HTTP boundary; no native broker stubs or online injection.
use super::*;
use axum::response::IntoResponse;

const EPOCH: &str = "00000000-0000-4000-8000-000000000001";
#[derive(Clone, Copy, Default)]
enum Failure {
    #[default]
    None,
    ConfigFetch,
    ConfigBinding,
    Registration,
    Subject,
    Devices,
    BusinessPort,
}
struct NativeFixture {
    handle: Handle,
    backend: Arc<Backend>,
    expire_first_session: Arc<std::sync::atomic::AtomicBool>,
    failure: Arc<std::sync::Mutex<Failure>>,
    requests: Arc<std::sync::Mutex<Vec<String>>>,
    server: tokio::task::JoinHandle<()>,
}
impl NativeFixture {
    async fn new(admission: bool) -> Self {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let requests = Arc::new(std::sync::Mutex::new(Vec::new()));
        let failure = Arc::new(std::sync::Mutex::new(Failure::None));
        let expire_first_session = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let mut auth = native_config();
        auth["coordination"] = json!({"protocol":"memory-v1","epoch":EPOCH,"heartbeatSeconds":20,"leaseSeconds":65,"signalTtlSeconds":120,"maxSignalWaitSeconds":15});
        if admission {
            auth["registrationAdmission"] =
                json!({"version":2,"challengeSeconds":120,"ticketSeconds":86400});
        }
        let opaque = format!("e30.{}", URL_SAFE_NO_PAD.encode([42; 32]));
        let app = {
            let expire_first_session = expire_first_session.clone();
            let (requests, failure) = (requests.clone(), failure.clone());
            axum::Router::new().fallback(move |request: axum::extract::Request| {
                let expire_first_session = expire_first_session.clone();
                let (requests, auth, failure, opaque) = (requests.clone(), auth.clone(), failure.clone(), opaque.clone());
                async move {
                    let key = format!("{} {}", request.method(), request.uri().path());
                    requests.lock().unwrap().push(key.clone());
                    let failure = *failure.lock().unwrap();
                    let headers = [("X-CyberGrid-Epoch", EPOCH)];
                    if matches!((failure, key.as_str()), (Failure::ConfigFetch, "GET /api/v1/auth/config") | (Failure::Registration, "POST /api/v1/auth/exchange") | (Failure::Devices, "GET /api/v1/devices")) {
                        // An arbitrary private service message must not escape
                        // into the redacted product snapshot.
                        return (axum::http::StatusCode::FORBIDDEN, headers, axum::Json(json!({"error":{"code":"FIXTURE_DENIED","message":"private-fixture-response"}}))).into_response();
                    }
                    let value = match key.as_str() {
                        "GET /api/my-account" => {
                            assert_eq!(request.headers()["authorization"], "Bearer fixture-native-only-access");
                            account_data()
                        }
                        "GET /api/v1/auth/config" => {
                            assert!(!request.headers().contains_key("authorization"));
                            assert_eq!(request.uri().query().unwrap(), format!("appId={}", Config::default().client_id));
                            let mut auth = auth;
                            if matches!(failure, Failure::ConfigBinding) {
                                auth["resource"] = json!("https://other.fixture.invalid/api");
                            }
                            auth
                        }
                        "POST /api/v1/auth/registration/challenge" | "POST /api/v1/auth/registration/admit" | "POST /api/v1/auth/exchange" => {
                            let bytes = axum::body::to_bytes(request.into_body(), 32768).await.unwrap();
                            let body: Value = serde_json::from_slice(&bytes).unwrap();
                            assert_eq!(body["accessToken"], "fixture-native-only-access");
                            assert_eq!(body["appId"], Config::default().client_id);
                            assert_eq!(body["registrationKey"].as_str().unwrap().len(), 43);
                            match key.as_str() {
                                "POST /api/v1/auth/registration/challenge" => json!({"challenge":opaque,"epoch":EPOCH,"expiresAt":chrono::Utc::now()+chrono::Duration::seconds(120)}),
                                "POST /api/v1/auth/registration/admit" => {
                                    assert_eq!(body["challenge"], opaque);
                                    assert!(uuid::Uuid::parse_str(body["requestId"].as_str().unwrap()).is_ok());
                                    json!({"admissionTicket":opaque,"epoch":EPOCH,"expiresAt":chrono::Utc::now()+chrono::Duration::days(1)})
                                }
                                _ => {
                                    assert_eq!(body["coordinatorEpoch"], EPOCH);
                                    assert!(body["registrationRevision"].as_u64().unwrap() > 0);
                                    if admission { assert_eq!(body["admissionTicket"], opaque); }
                                    let lifetime = if expire_first_session.swap(false, Ordering::SeqCst) { chrono::Duration::seconds(2) } else { chrono::Duration::minutes(10) };
                                    json!({"purpose":"device","appId":Config::default().client_id,"sessionKey":"fixture-session-only","deviceId":"fixture-android","user":{"id":if matches!(failure, Failure::Subject) {"wrong-fixture-subject"} else {"fixture-subject"}},"expiresAt":chrono::Utc::now()+lifetime,"coordinatorEpoch":EPOCH,"incarnation":uuid::Uuid::new_v4().to_string()})
                                }
                            }
                        }
                        "PUT /api/v1/devices/self" => {
                            let body = axum::body::to_bytes(request.into_body(), 32768).await.unwrap();
                            let body: Value = serde_json::from_slice(&body).unwrap();
                            assert_eq!(body["ports"], json!([]));
                            assert!(body["tunnelUrl"].is_null());
                            json!({})
                        }
                        "DELETE /api/v1/session" => json!({}),
                        "GET /api/v1/devices" => {
                            assert_eq!(request.headers()["authorization"], "Bearer fixture-session-only");
                            assert_eq!(request.headers()["X-CyberGrid-Epoch"], EPOCH);
                            json!({"devices":[{"id":"fixture-grid","name":"Laptop","online":true,"lastSeen":"2026-01-01T00:00:00Z","ports":[{"id":"anywork-remote","transport":"tcp","port":4000,"type":if matches!(failure,Failure::BusinessPort) {"wrong-business-type"} else {"anywork-noise-v1"},"tunnelUrl":"https://fixture.trycloudflare.com"}]}]})
                        }
                        "GET /api/v1/signals" => {
                            tokio::time::sleep(Duration::from_millis(30)).await;
                            json!({"signals":[],"cursor":0,"coordinatorEpoch":EPOCH})
                        }
                        _ => panic!("unexpected synthetic endpoint {key}"),
                    };
                    (headers, axum::Json(value)).into_response()
                }
            })
        };
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let (handle, backend) = handle(Config {
            endpoint: base.clone(),
            grid_url: base,
            ..Config::default()
        });
        signed_in(&handle).await;
        Self {
            handle,
            backend,
            expire_first_session,
            failure,
            requests,
            server,
        }
    }
    fn calls(&self, key: &str) -> usize {
        self.requests
            .lock()
            .unwrap()
            .iter()
            .filter(|r| r.as_str() == key)
            .count()
    }
    async fn refresh(&self) -> AccountSnapshot {
        tokio::time::timeout(Duration::from_secs(5), self.handle.refresh())
            .await
            .unwrap()
            .unwrap()
    }
    async fn close(&self) {
        self.handle.logout().await.unwrap();
        self.server.abort();
    }
}
impl Drop for NativeFixture {
    fn drop(&mut self) {
        self.server.abort();
    }
}

#[tokio::test]
async fn native_directory_sdk_refreshes_presence_without_console_login() {
    for admission in [false, true] {
        let f = NativeFixture::new(admission).await;
        let snapshot = f.refresh().await;
        assert!(snapshot.directory_state == DirectoryState::Ready);
        assert_eq!(snapshot.devices[0].online, Some(true));
        // A second refresh reuses the native owner instead of registering again.
        let second = f.refresh().await;
        assert_eq!(second.revision, snapshot.revision);
        assert_eq!(f.calls("POST /api/v1/auth/exchange"), 1);
        assert_eq!(f.calls("GET /api/v1/devices"), 2);
        assert_eq!(
            f.calls("POST /api/v1/auth/registration/admit"),
            usize::from(admission)
        );
        assert!(
            !f.requests
                .lock()
                .unwrap()
                .iter()
                .any(|r| r.contains("console"))
        );
        let target = f
            .handle
            .prepare_target(
                &snapshot.devices[0].device_ref,
                snapshot.epoch,
                snapshot.revision,
                Some(&key(1)),
            )
            .await
            .unwrap();
        assert_eq!(
            target.target.gateway_url,
            "https://fixture.trycloudflare.com"
        );
        f.close().await;
    }
}

#[tokio::test]
async fn native_failures_keep_account_records_unknown_and_expose_only_fixed_stage() {
    for (failure, expected) in [
        (
            Failure::ConfigFetch,
            "MOBILE_COORDINATION_CONFIG_FETCH_FAILED",
        ),
        (Failure::ConfigBinding, "MOBILE_COORDINATION_CONFIGURATION"),
        (
            Failure::Registration,
            "MOBILE_COORDINATION_REGISTRATION_FAILED",
        ),
        (Failure::Subject, "MOBILE_IDENTITY_MISMATCH"),
        (
            Failure::Devices,
            "MOBILE_COORDINATION_DIRECTORY_FETCH_FAILED",
        ),
        (Failure::BusinessPort, "MOBILE_INVALID_GATEWAY"),
    ] {
        let f = NativeFixture::new(false).await;
        *f.failure.lock().unwrap() = failure;
        let snapshot = f.refresh().await;
        assert!(snapshot.phase == Phase::SignedIn);
        assert!(snapshot.directory_state == DirectoryState::Unknown);
        assert_eq!(snapshot.devices.len(), 1);
        assert_eq!(snapshot.devices[0].online, None);
        assert_eq!(snapshot.error_code.as_deref(), Some(expected));
        let public = serde_json::to_string(&snapshot).unwrap();
        for private in [
            "fixture-subject",
            "fixture-native-only-access",
            "fixture-session-only",
            "private-fixture-response",
            "FIXTURE_DENIED",
        ] {
            assert!(!public.contains(private));
        }
        assert!(
            f.handle
                .prepare_current_target(
                    &snapshot.devices[0].device_ref,
                    snapshot.epoch,
                    snapshot.revision,
                    Some(&key(1))
                )
                .await
                .is_err()
        );
        f.close().await;
    }
}

#[tokio::test]
async fn native_sdk_session_expiry_can_force_refresh_during_coordination_recovery() {
    let f = NativeFixture::new(true).await;
    f.expire_first_session.store(true, Ordering::SeqCst);
    let first = f.refresh().await;
    assert!(first.directory_state == DirectoryState::Ready);
    // The SDK's real lease monitor drives recovery, not a constructed
    // AuthTokenRequest. No wall-clock service, account or device is contacted.
    tokio::time::timeout(Duration::from_secs(6), async {
        while f.calls("POST /api/v1/auth/exchange") < 2 {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("native SDK must renew its expired session");
    let recovered = tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            let snapshot = f.refresh().await;
            if snapshot.directory_state == DirectoryState::Ready {
                break snapshot;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("renewed native directory must become ready");
    assert_eq!(recovered.devices[0].online, Some(true));
    assert!(
        f.backend
            .token_requests
            .lock()
            .unwrap()
            .iter()
            .any(|(_, resource, force, validity)| *resource && *force && *validity == 60)
    );
    f.close().await;
}
