//! Synthetic HTTP/SDK/provider integration only; no real grant or cloud account.
use super::*;
use axum::response::IntoResponse;
use std::os::unix::fs::PermissionsExt;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};

struct Fixture {
    dir: tempfile::TempDir,
    handle: Handle,
    requests: Arc<std::sync::Mutex<BTreeMap<String, usize>>>,
    fail_config: Arc<AtomicBool>,
    fail_revoke: Arc<AtomicBool>,
    fail_grid_revoke: Arc<AtomicBool>,
    publication_failure: Arc<AtomicUsize>,
    exchange_mode: Arc<AtomicUsize>,
    exchanges: Arc<Mutex<Vec<Value>>>,
    receipts: Arc<Mutex<BTreeMap<String, Value>>>,
    publications: Arc<Mutex<Vec<Value>>>,
    token_lifetime: Arc<AtomicU64>,
    token_unknown: Arc<AtomicBool>,
    gate: Arc<Mutex<Option<String>>>,
    entered: Arc<Notify>,
    release: Arc<tokio::sync::Semaphore>,
    server: tokio::task::JoinHandle<()>,
}
impl Fixture {
    async fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let provider = dir.path().join("fixture-provider");
        std::fs::write(&provider, format!("#!/bin/sh\nprintf '%s' $$ > '{}'\nfor arg do last=\"$arg\"; done\nprintf '%s' \"$last\" > '{}'\nprintf '%s\\n' 'https://fixture-only.trycloudflare.com'\nexec /bin/sleep 60\n",dir.path().join("provider-pid").display(),dir.path().join("gateway-url").display())).unwrap();
        std::fs::set_permissions(&provider, std::fs::Permissions::from_mode(0o700)).unwrap();
        let mut local = manager::Snapshot::new(
            config::Config {
                cloudflared_binary: provider.display().to_string(),
                port: 39899,
                ..Default::default()
            },
            "synthetic-local-token".into(),
        );
        local.authorized = true;
        local.service = manager::Phase::Running;
        let mut handle =
            Handle::new(dir.path().into(), manager::Handle::preview(local), false).unwrap();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let config = &mut Arc::get_mut(&mut handle.0).unwrap().config;
        config.cybergrid_url = base.clone();
        config.endpoint = base.clone();
        let mut auth = super::tests::auth_config_fixture(config);
        auth["coordination"] = json!({"protocol":"memory-v1","epoch":"fixture-epoch","heartbeatSeconds":20,"leaseSeconds":65,"signalTtlSeconds":30,"maxSignalWaitSeconds":15});
        let app_id = config.native_client_id.clone();
        let requests = Arc::new(std::sync::Mutex::new(BTreeMap::<String, usize>::new()));
        let data = Arc::new(Mutex::new(json!({})));
        let fail_config = Arc::new(AtomicBool::new(false));
        let fail_revoke = Arc::new(AtomicBool::new(false));
        let fail_grid_revoke = Arc::new(AtomicBool::new(false));
        let publication_failure = Arc::new(AtomicUsize::new(0));
        let exchange_mode = Arc::new(AtomicUsize::new(0));
        let exchanges = Arc::new(Mutex::new(Vec::new()));
        let receipts = Arc::new(Mutex::new(BTreeMap::<String, Value>::new()));
        let publications = Arc::new(Mutex::new(Vec::<Value>::new()));
        let token_lifetime = Arc::new(AtomicU64::new(3600));
        let token_unknown = Arc::new(AtomicBool::new(false));
        let gate = Arc::new(Mutex::new(None::<String>));
        let entered = Arc::new(Notify::new());
        let release = Arc::new(tokio::sync::Semaphore::new(0));
        let app = {
            let receipts = receipts.clone();
            let token_unknown = token_unknown.clone();
            let fail_revoke = fail_revoke.clone();
            let (
                fail_grid_revoke,
                publication_failure,
                exchange_mode,
                exchanges,
                publications,
                token_lifetime,
            ) = (
                fail_grid_revoke.clone(),
                publication_failure.clone(),
                exchange_mode.clone(),
                exchanges.clone(),
                publications.clone(),
                token_lifetime.clone(),
            );
            let (requests, data, fail, gate, entered, release) = (
                requests.clone(),
                data.clone(),
                fail_config.clone(),
                gate.clone(),
                entered.clone(),
                release.clone(),
            );
            axum::Router::new().fallback(move |request:axum::extract::Request| {
                let (requests,data,fail,fail_revoke,gate,entered,release,auth,app_id)=(requests.clone(),data.clone(),fail.clone(),fail_revoke.clone(),gate.clone(),entered.clone(),release.clone(),auth.clone(),app_id.clone());
                let (fail_grid_revoke,publication_failure,exchange_mode,exchanges,publications,token_lifetime) = (fail_grid_revoke.clone(),publication_failure.clone(),exchange_mode.clone(),exchanges.clone(),publications.clone(),token_lifetime.clone());
                let receipts = receipts.clone();
                let token_unknown = token_unknown.clone();
                async move {
                    let path=request.uri().path().to_string();
                    let key=format!("{} {}",request.method(),path);
                    let occurrence={let mut calls=requests.lock().unwrap(); let count=calls.entry(key.clone()).or_default(); *count+=1; *count};
                    let wait={ let mut g=gate.lock().await; if g.as_ref()==Some(&key) || g.as_ref()==Some(&format!("{key}#{occurrence}")) {g.take();true} else {false} };
                    if wait { entered.notify_one(); release.acquire().await.unwrap().forget(); }
                    let value = match key.as_str() {
                        "GET /api/v1/auth/config" => {
                            assert!(!request.headers().contains_key("authorization"));
                            if fail.load(Ordering::SeqCst) {return (axum::http::StatusCode::UNAUTHORIZED,axum::Json(json!({"error":{"code":"denied"}}))).into_response();}
                            auth
                        },
                        "POST /oidc/token" => {
                            if token_unknown.load(Ordering::SeqCst) { return (axum::http::StatusCode::BAD_GATEWAY,"unconfirmed rotation response").into_response(); }
                            json!({"access_token":format!("fixture.{}.fixture",URL_SAFE_NO_PAD.encode(serde_json::to_vec(&json!({"exp":anywork_remote::auth::now()+token_lifetime.load(Ordering::SeqCst)})).unwrap())),"refresh_token":"synthetic-rotated"})
                        },
                        "POST /oidc/token/revocation" => {
                            if fail_revoke.load(Ordering::SeqCst) {return (axum::http::StatusCode::BAD_GATEWAY,axum::Json(json!({}))).into_response();}
                            json!({})
                        },
                        "POST /api/v1/auth/exchange" => {
                            let bytes = axum::body::to_bytes(request.into_body(), 32768).await.unwrap();
                            let body:Value=serde_json::from_slice(&bytes).unwrap();
                            exchanges.lock().await.push(body.clone());
                            let receipt_key=format!("{}:{}:{}:{}",body["registrationKey"],body["requestId"],body["registrationRevision"],body["coordinatorEpoch"]);
                            let mode = exchange_mode.load(Ordering::SeqCst);
                            let receipt = if mode == 0 || mode == 1 {
                                Some(receipts.lock().await.entry(receipt_key).or_insert_with(|| json!({"coordinatorEpoch":"fixture-epoch","incarnation":"44607dc4-3ea1-48c0-97dc-f6c013984f6e","purpose":"device","appId":app_id,"sessionKey":"synthetic-session-only","expiresAt":chrono::Utc::now()+chrono::Duration::minutes(10),"deviceId":"fixture-device","user":{"id":"fixture-owner"}})).clone())
                            } else {None};
                            if mode != 0 {
                                if mode == 2 {exchange_mode.store(0, Ordering::SeqCst);}
                                let status = if mode == 1 {axum::http::StatusCode::BAD_GATEWAY} else if mode == 3 {axum::http::StatusCode::FORBIDDEN} else {axum::http::StatusCode::UNAUTHORIZED};
                                return (status, [("X-CyberGrid-Epoch", "fixture-epoch")], axum::Json(json!({"error":{"code":"INVALID_IDENTITY"}}))).into_response();
                            }
                            receipt.unwrap()
                        },
                        "GET /api/my-account" => json!({"id":"fixture-owner","customData":data.lock().await.clone()}),
                        "PATCH /api/my-account" => {
                            let bytes=axum::body::to_bytes(request.into_body(),32768).await.unwrap();
                            let body:Value=serde_json::from_slice(&bytes).unwrap();
                            *data.lock().await=body["customData"].clone();json!({})
                        },
                        "GET /api/v1/signals" => {tokio::time::sleep(Duration::from_millis(30)).await;json!({"signals":[],"cursor":0,"coordinatorEpoch":"fixture-epoch"})},
                        "PUT /api/v1/devices/self" => {
                            let bytes = axum::body::to_bytes(request.into_body(),32768).await.unwrap();
                            publications.lock().await.push(serde_json::from_slice(&bytes).unwrap());
                            if publication_failure.load(Ordering::SeqCst) != 0 && (publication_failure.load(Ordering::SeqCst) == 2 || publications.lock().await.last().unwrap()["ports"].as_array().is_some_and(|ports| !ports.is_empty())) {return (axum::http::StatusCode::BAD_GATEWAY, axum::Json(json!({"error":{"code":"UNAVAILABLE"}}))).into_response();}
                            json!({})
                        },
                        "DELETE /api/v1/session" => {
                            if fail_grid_revoke.load(Ordering::SeqCst) {return (axum::http::StatusCode::BAD_GATEWAY, axum::Json(json!({"error":{"code":"UNAVAILABLE"}}))).into_response();}
                            json!({})
                        },
                        _ => panic!("unexpected synthetic endpoint {key}"),
                    };
                    (axum::http::StatusCode::OK, [("X-CyberGrid-Epoch", "fixture-epoch")], axum::Json(value)).into_response()
                }
            })
        };
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let mut owner = GrantOwner::new(Grant {
            config: handle.0.config.clone(),
            refresh: "synthetic-initial".into(),
            subject: "fixture-owner".into(),
        })
        .unwrap();
        owner.token_endpoint = Some(format!("{base}/oidc/token"));
        handle.0.state.lock().await.owner = Some(Arc::new(owner));
        Self {
            dir,
            handle,
            requests,
            fail_config,
            fail_revoke,
            fail_grid_revoke,
            publication_failure,
            exchange_mode,
            exchanges,
            receipts,
            publications,
            token_lifetime,
            token_unknown,
            gate,
            entered,
            release,
            server,
        }
    }
    fn calls(&self, key: &str) -> usize {
        self.requests.lock().unwrap().get(key).copied().unwrap_or(0)
    }
    async fn block(&self, key: &str) {
        *self.gate.lock().await = Some(key.into());
    }
    fn provider_stopped(&self) {
        if let Ok(pid) = std::fs::read_to_string(self.dir.path().join("provider-pid")) {
            let pid: i32 = pid.parse().unwrap();
            assert_eq!(
                unsafe { libc::kill(pid, 0) },
                -1,
                "fixture provider still alive"
            );
        }
    }
    async fn assert_gateways_closed(&self) {
        for gateway in self.handle.0.gateway_shutdowns.lock().await.iter() {
            assert!(gateway.is_complete(), "original gateway task still running");
        }
    }
    async fn close(self) {
        self.handle.disable().await;
        self.provider_stopped();
        // A retired numeric port may already belong to another fixture/service.
        // Observe every original task, including gateways from failed enables.
        self.assert_gateways_closed().await;
        let snapshot = self.handle.snapshot().await;
        assert!(!snapshot.enabled);
        assert!(snapshot.remote_clients.is_empty());
        assert!(self.handle.0.state.lock().await.remote.is_none());
        self.server.abort();
    }
}

#[tokio::test]
async fn closed_gateway_identity_survives_its_port_being_reused() {
    let f = Fixture::new().await;
    f.handle.enable_default().await.unwrap();
    let port = {
        let state = f.handle.0.state.lock().await;
        state.remote.as_ref().unwrap().gateway.port
    };
    assert!(
        f.handle
            .0
            .gateway_shutdowns
            .lock()
            .await
            .iter()
            .all(|g| !g.is_complete()),
        "the completion witness must not report an open gateway as closed"
    );
    f.handle.disable().await;
    f.assert_gateways_closed().await;
    // Binding the exact retired port proves that the original listener is gone.
    // A new listener makes the old raw connect().is_err() assertion fail even
    // though the original task and remote access have actually closed.
    let replacement = tokio::net::TcpListener::bind(("127.0.0.1", port))
        .await
        .unwrap();
    let connection = tokio::net::TcpStream::connect(("127.0.0.1", port))
        .await
        .unwrap();
    let (accepted, _) = replacement.accept().await.unwrap();
    assert_eq!(
        connection.peer_addr().unwrap(),
        accepted.local_addr().unwrap()
    );
    assert_eq!(
        connection.local_addr().unwrap(),
        accepted.peer_addr().unwrap()
    );
    f.close().await;
    drop((accepted, connection, replacement));
}

#[tokio::test]
async fn default_once_manual_off_explicit_retry_and_new_grant() {
    let f = Fixture::new().await;
    let (a, b) = tokio::join!(f.handle.enable_default(), f.handle.enable_default());
    a.unwrap();
    b.unwrap();
    assert!(f.handle.snapshot().await.enabled);
    assert_eq!(f.calls("POST /api/v1/auth/exchange"), 1);
    assert_eq!(f.calls("PATCH /api/my-account"), 1);
    // UI remount/reprepare/default has no new publication.
    f.handle.enable_default().await.unwrap();
    f.handle.disable().await;
    f.provider_stopped();
    f.handle.0.manager.state.lock().unwrap().authorized = false;
    f.handle.enable_default().await.unwrap();
    f.handle.0.manager.state.lock().unwrap().authorized = true;
    assert!(!f.handle.snapshot().await.enabled);
    assert_eq!(f.calls("POST /api/v1/auth/exchange"), 1);
    f.handle.enable().await.unwrap();
    assert!(f.handle.snapshot().await.enabled);
    f.handle.logout().await.unwrap();
    assert!(!f.handle.snapshot().await.signed_in);
    assert!(f.handle.enable_default().await.is_err());
    let mut owner = GrantOwner::new(Grant {
        config: f.handle.0.config.clone(),
        refresh: "new-synthetic-grant".into(),
        subject: "fixture-owner".into(),
    })
    .unwrap();
    owner.token_endpoint = Some(format!("{}/oidc/token", f.handle.0.config.endpoint));
    f.handle.0.state.lock().await.owner = Some(Arc::new(owner));
    f.handle.enable_default().await.unwrap();
    assert_eq!(f.calls("POST /api/v1/auth/exchange"), 3);
    assert_eq!(f.calls("DELETE /api/v1/session"), 2);
    // The only account identity persistence is the public installation UUID.
    for item in std::fs::read_dir(f.dir.path().join("account-installations")).unwrap() {
        let value: Value =
            serde_json::from_slice(&std::fs::read(item.unwrap().path()).unwrap()).unwrap();
        assert_eq!(value.as_object().unwrap().len(), 1);
        assert!(value["installationId"].as_str().is_some());
    }
    f.close().await;
}

#[tokio::test]
async fn failed_default_is_consumed_local_readiness_independent_and_explicit_retry_works() {
    let f = Fixture::new().await;
    f.fail_config.store(true, Ordering::SeqCst);
    assert_eq!(
        safe_error(f.handle.enable_default().await.unwrap_err()),
        "REMOTE_ENABLE_GRID_CONFIG"
    );
    assert!(f.handle.0.manager.snapshot().authorized);
    f.provider_stopped();
    assert!(f.handle.enable_default().await.is_ok());
    assert_eq!(f.calls("GET /api/v1/auth/config"), 1);
    f.fail_config.store(false, Ordering::SeqCst);
    f.handle.enable().await.unwrap();
    assert!(f.handle.snapshot().await.enabled);
    f.close().await;
}

#[tokio::test]
async fn disable_and_logout_fence_delayed_config_token_registration_and_index() {
    for (stage, logout) in [
        ("GET /api/v1/auth/config", false),
        ("POST /oidc/token", false),
        ("POST /api/v1/auth/exchange", false),
        ("GET /api/my-account", false),
        ("PATCH /api/my-account", false),
        ("POST /oidc/token", true),
    ] {
        let f = Fixture::new().await;
        f.block(stage).await;
        let handle = f.handle.clone();
        let enable = tokio::spawn(async move { handle.enable_default().await });
        tokio::time::timeout(Duration::from_secs(15), f.entered.notified())
            .await
            .unwrap();
        // A renderer poll waiting for the same token must not hold account
        // State and prevent the close intent from being recorded.
        let poll = if stage == "POST /oidc/token" {
            let owner = f.handle.0.state.lock().await.owner.clone().unwrap();
            let before = Arc::strong_count(&owner);
            let handle = f.handle.clone();
            let poll = tokio::spawn(async move { handle.snapshot().await });
            tokio::time::timeout(Duration::from_secs(2), async {
                while Arc::strong_count(&owner) <= before {
                    tokio::task::yield_now().await;
                }
            })
            .await
            .unwrap();
            assert!(!poll.is_finished());
            Some(poll)
        } else {
            None
        };
        let handle = f.handle.clone();
        let close = tokio::spawn(async move {
            if logout {
                handle.logout().await
            } else {
                handle.disable().await;
                Ok(())
            }
        });
        // Prove invalidation has already occurred, before releasing the network.
        tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                if f.handle
                    .0
                    .state
                    .lock()
                    .await
                    .owner
                    .as_ref()
                    .unwrap()
                    .policy()
                    .manual_off
                {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        f.release.add_permits(1);
        assert!(enable.await.unwrap().is_err(), "{stage}");
        close.await.unwrap().unwrap();
        if let Some(poll) = poll {
            assert!(!poll.await.unwrap().enabled);
        }
        assert!(!f.handle.snapshot().await.enabled, "{stage}");
        assert!(f.handle.0.state.lock().await.remote.is_none());
        f.provider_stopped();
        if stage == "POST /api/v1/auth/exchange" || stage.contains("my-account") {
            assert_eq!(f.calls("DELETE /api/v1/session"), 1, "{stage}");
        }
        if stage != "PATCH /api/my-account" {
            assert_eq!(f.calls("PATCH /api/my-account"), 0, "{stage}");
        }
        let before = f.calls("POST /api/v1/auth/exchange");
        if !logout {
            if stage == "POST /oidc/token" {
                let owner = f.handle.0.state.lock().await.owner.clone().unwrap();
                assert!(!owner.state.lock().await.uncertain);
                assert_eq!(f.calls("POST /oidc/token"), 1);
                assert!(f.handle.snapshot().await.signed_in);
            }
            f.handle.enable_default().await.unwrap();
            assert_eq!(f.calls("POST /api/v1/auth/exchange"), before);
        }
        f.close().await;
    }
}

#[tokio::test]
async fn queued_old_owner_enable_does_not_adopt_replacement_grant() {
    let f = Fixture::new().await;
    let op = f.handle.0.operation.lock().await;
    let old = f.handle.0.state.lock().await.owner.clone().unwrap();
    let handle = f.handle.clone();
    let task = tokio::spawn(async move { handle.enable_default().await });
    tokio::task::yield_now().await;
    // Wait for queued command to retain the original owner (no timing assumption).
    tokio::time::timeout(Duration::from_secs(2), async {
        while Arc::strong_count(&old) < 3 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    old.policy().invalidate(true);
    let grant = old.state.lock().await.grant.clone();
    let next = Arc::new(GrantOwner::new(grant).unwrap());
    f.handle.0.state.lock().await.owner = Some(next.clone());
    drop(op);
    assert!(task.await.unwrap().is_err());
    assert!(!next.policy().consumed);
    assert_eq!(f.calls("GET /api/v1/auth/config"), 0);
    f.close().await;
}

#[tokio::test]
async fn default_without_verified_service_does_not_consume_grant() {
    let f = Fixture::new().await;
    f.handle.0.manager.state.lock().unwrap().authorized = false;
    assert_eq!(
        f.handle.enable_default().await.unwrap_err().to_string(),
        "LOCAL_SERVICE_NOT_READY"
    );
    assert!(
        !f.handle
            .0
            .state
            .lock()
            .await
            .owner
            .as_ref()
            .unwrap()
            .policy()
            .consumed
    );
    assert_eq!(f.calls("GET /api/v1/auth/config"), 0);
    f.close().await;
}

#[tokio::test]
async fn failed_logout_retains_latest_grant_but_never_reopens_remote() {
    let f = Fixture::new().await;
    f.handle.enable_default().await.unwrap();
    f.fail_revoke.store(true, Ordering::SeqCst);
    assert!(f.handle.logout().await.is_err());
    let owner = f.handle.0.state.lock().await.owner.clone().unwrap();
    assert_eq!(owner.state.lock().await.grant.refresh, "synthetic-rotated");
    assert!(owner.policy().logged_out && owner.policy().consumed);
    assert!(!f.handle.snapshot().await.signed_in);
    assert!(f.handle.enable_default().await.is_err());
    assert!(f.handle.enable().await.is_err());
    assert_eq!(f.calls("POST /api/v1/auth/exchange"), 1);
    assert_eq!(f.calls("DELETE /api/v1/session"), 1);
    f.provider_stopped();
    f.fail_revoke.store(false, Ordering::SeqCst);
    f.handle.logout().await.unwrap();
    assert!(f.handle.0.state.lock().await.owner.is_none());
    f.close().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn ipc_verified_local_prepare_then_default_runs_real_sdk_chain_without_browser() {
    let mut f = Fixture::new().await;
    let service = crate::test_service::Service::new(f.dir.path(), "dns-forbidden");
    let port = std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    let config = config::Config {
        workspace: f.dir.path().display().to_string(),
        data_directory: f.dir.path().join("local-data").display().to_string(),
        server_binary: service.executable.display().to_string(),
        port,
        ..f.handle.0.manager.snapshot().config
    };
    config::save(&f.dir.path().join("manager.json"), &config).unwrap();
    let manager = manager::start(manager::Options {
        support: f.dir.path().into(),
        resources: f.dir.path().into(),
    })
    .unwrap();
    Arc::get_mut(&mut f.handle.0).unwrap().manager = manager.clone();
    let app = tauri::test::mock_builder()
        .manage(f.handle.clone())
        .manage(crate::bridge::DesktopState {
            handle: manager.clone(),
            preview: None,
        })
        .manage(crate::updates::Handle::new(f.dir.path(), false))
        .invoke_handler(tauri::generate_handler![
            crate::bridge::desktop_start,
            account_enable_default
        ])
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let invoke = |command: &str| {
        tauri::test::get_ipc_response(
            &webview,
            tauri::webview::InvokeRequest {
                cmd: command.into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: "tauri://localhost".parse().unwrap(),
                body: tauri::ipc::InvokeBody::default(),
                headers: Default::default(),
                invoke_key: tauri::test::INVOKE_KEY.into(),
            },
        )
    };
    assert!(invoke("account_enable_default").is_err());
    assert_eq!(f.calls("GET /api/v1/auth/config"), 0);
    invoke("desktop_start").unwrap_or_else(|e| panic!("{e:?}; {}", service.diagnostics()));
    assert!(manager.snapshot().authorized);
    invoke("account_enable_default").unwrap();
    assert!(f.handle.snapshot().await.enabled);
    assert_eq!(f.calls("GET /api/v1/auth/config"), 2);
    assert_eq!(f.calls("POST /api/v1/auth/exchange"), 1);
    assert_eq!(f.calls("PATCH /api/my-account"), 1);
    assert_eq!(service.status()["ticketRequests"], 0);
    f.handle.disable().await;
    invoke("desktop_start").unwrap();
    invoke("account_enable_default").unwrap();
    assert_eq!(f.calls("POST /api/v1/auth/exchange"), 1);
    assert!(!f.handle.snapshot().await.enabled);
    manager.shutdown().await;
    f.close().await;
}

#[tokio::test]
async fn disable_cancels_provider_readiness_and_closes_gateway_before_returning() {
    let f = Fixture::new().await;
    let provider = f.handle.0.manager.snapshot().config.cloudflared_binary;
    std::fs::write(provider,format!("#!/bin/sh\nprintf '%s' $$ > '{}'\nfor arg do last=\"$arg\"; done\nprintf '%s' \"$last\" > '{}'\nexec /bin/sleep 60\n",f.dir.path().join("provider-pid").display(),f.dir.path().join("gateway-url").display())).unwrap();
    // Synchronize on the actual process spawn while its URL channel is pending.
    // A shell-written marker adds an unrelated OS scheduling/deadline race.
    let (spawned, process) = tokio::sync::oneshot::channel();
    *f.handle.0.provider_spawned.lock().await = Some(spawned);
    let handle = f.handle.clone();
    let enable = tokio::spawn(async move { handle.enable_default().await });
    let pid = tokio::time::timeout(Duration::from_secs(3), process)
        .await
        .unwrap()
        .unwrap();
    assert!(!enable.is_finished());
    assert!(!f.handle.0.gateway_shutdowns.lock().await[0].is_complete());
    tokio::time::timeout(Duration::from_secs(3), f.handle.disable())
        .await
        .unwrap();
    assert!(enable.await.unwrap().is_err());
    assert_eq!(
        unsafe { libc::kill(pid as i32, 0) },
        -1,
        "provider process still alive after disable"
    );
    assert_eq!(f.calls("GET /api/v1/auth/config"), 0);
    assert!(!f.handle.snapshot().await.enabled);
    f.close().await;
}

impl Fixture {
    async fn grid(&self) -> (Arc<cybergrid_sdk::Client>, Arc<GridAuthorization>) {
        let owner = self.handle.0.state.lock().await.owner.clone().unwrap();
        let generation = owner.policy().generation.clone();
        let grid = cybergrid_sdk::Client::new(cybergrid_sdk::Config {
            base_url: self.handle.0.config.cybergrid_url.clone(),
            app_id: self.handle.0.config.native_client_id.clone(),
            iroh_enabled: false,
            stun_servers: vec![],
            ..Default::default()
        })
        .unwrap();
        let authorization = Arc::new(GridAuthorization {
            owner,
            generation,
            client: Arc::downgrade(&grid),
            retired: AtomicBool::new(false),
        });
        grid.set_auth_provider(authorization.clone()).await;
        (grid, authorization)
    }
    fn request(&self, grid: &cybergrid_sdk::Client) -> cybergrid_sdk::AuthTokenRequest {
        let config = &self.handle.0.config;
        cybergrid_sdk::AuthTokenRequest {
            issuer: config.issuer.clone(),
            client_id: config.native_client_id.clone(),
            resource: config.resource.clone(),
            scopes: GRID_SCOPES.iter().map(|s| s.to_string()).collect(),
            min_validity: 60,
            force_refresh: false,
            reason: cybergrid_sdk::AuthRequestReason::Connect,
            generation: grid.snapshot().generation,
            cancel: CancellationToken::new(),
        }
    }
}

#[tokio::test]
async fn sdk_legacy_gate_stays_closed_until_explicit_current_publication() {
    let f = Fixture::new().await;
    let (grid, _) = f.grid().await;
    assert!(!grid.snapshot().remote_enabled);
    grid.login_with_auth_provider("synthetic host")
        .await
        .unwrap();
    assert!(!grid.snapshot().remote_enabled);
    let publications = f.publications.lock().await.clone();
    assert!(!publications.is_empty());
    assert!(publications.iter().all(|p| p["ports"] == json!([])));
    let calls = f.calls("PUT /api/v1/devices/self");
    let mut port = cybergrid_sdk::Port::tcp("anywork-remote", 39899, "anywork-noise-v1");
    port.tunnel_url = Some("https://fixture-only.trycloudflare.com".into());
    grid.expose(port).await.unwrap();
    assert_eq!(f.calls("PUT /api/v1/devices/self"), calls);
    assert!(grid_publication_confirmed(&grid).is_err());
    f.block("PUT /api/v1/devices/self").await;
    let enabling = tokio::spawn({
        let grid = grid.clone();
        async move { grid.enable_remote().await }
    });
    f.entered.notified().await;
    assert!(grid_publication_confirmed(&grid).is_err());
    f.release.add_permits(1);
    enabling.await.unwrap().unwrap();
    grid_publication_confirmed(&grid).unwrap();
    let last = f.publications.lock().await.last().unwrap().clone();
    assert_eq!(last["ports"][0]["id"], "anywork-remote");
    assert_eq!(
        last["ports"][0]["tunnelUrl"],
        "https://fixture-only.trycloudflare.com"
    );
    grid.disable_remote().await;
    assert!(!grid.snapshot().remote_enabled);
    f.close().await;
}

#[tokio::test]
async fn native_unknown_exchange_retry_retains_original_client_token_and_request() {
    let f = Fixture::new().await;
    f.exchange_mode.store(1, Ordering::SeqCst);
    assert_eq!(
        safe_error(f.handle.enable_default().await.unwrap_err()),
        "REMOTE_ENABLE_GRID_REGISTER"
    );
    assert!(!f.handle.snapshot().await.enabled);
    f.provider_stopped();
    assert_eq!(f.calls("POST /oidc/token"), 1);
    assert_eq!(f.calls("PATCH /api/my-account"), 0);
    let original = f
        .handle
        .0
        .state
        .lock()
        .await
        .pending_grid
        .as_ref()
        .unwrap()
        .grid
        .clone();
    assert!(!original.snapshot().remote_enabled);
    assert_eq!(
        original.snapshot().coordination.reason,
        cybergrid_sdk::StateReason::ExchangeOutcomeUnknown
    );
    // Consumed default stays a no-op. Explicit retry resumes the SDK's exact RAM transaction.
    f.handle.enable_default().await.unwrap();
    assert_eq!(f.calls("POST /api/v1/auth/exchange"), 1);
    f.exchange_mode.store(0, Ordering::SeqCst);
    f.handle.enable().await.unwrap();
    let state = f.handle.0.state.lock().await;
    assert!(Arc::ptr_eq(&original, &state.remote.as_ref().unwrap().grid));
    assert!(state.pending_grid.is_none());
    drop(state);
    let exchanges = f.exchanges.lock().await;
    assert_eq!(exchanges.len(), 2);
    assert_eq!(exchanges[0], exchanges[1]);
    drop(exchanges);
    assert_eq!(f.receipts.lock().await.len(), 1);
    assert_eq!(f.calls("POST /oidc/token"), 2); // initial resource + index, no recovery refresh
    assert!(f.handle.snapshot().await.enabled);
    f.close().await;
}

#[tokio::test]
async fn manual_off_unknown_blocks_new_registration_until_original_cleanup_resolves() {
    let f = Fixture::new().await;
    f.exchange_mode.store(1, Ordering::SeqCst);
    assert!(f.handle.enable_default().await.is_err());
    let original = f
        .handle
        .0
        .state
        .lock()
        .await
        .pending_grid
        .as_ref()
        .unwrap()
        .grid
        .clone();
    f.handle.disable().await;
    assert!(!f.handle.snapshot().await.enabled);
    assert!(
        f.handle
            .snapshot()
            .await
            .error
            .unwrap()
            .contains("尚未确认")
    );
    f.exchange_mode.store(4, Ordering::SeqCst); // 401 after unknown must not force refresh
    assert_eq!(
        f.handle.enable().await.unwrap_err().to_string(),
        "REMOTE_COORDINATION_CLEANUP_REQUIRED"
    );
    assert_eq!(f.calls("POST /oidc/token"), 1);
    assert_eq!(f.calls("PATCH /api/my-account"), 0);
    let exchanges = f.exchanges.lock().await.clone();
    assert_eq!(exchanges.len(), 3);
    assert!(exchanges.iter().all(|e| *e == exchanges[0]));
    assert!(Arc::ptr_eq(
        &original,
        &f.handle
            .0
            .state
            .lock()
            .await
            .pending_grid
            .as_ref()
            .unwrap()
            .grid
    ));
    f.handle.enable_default().await.unwrap();
    assert_eq!(f.calls("POST /api/v1/auth/exchange"), 3);
    f.exchange_mode.store(0, Ordering::SeqCst);
    f.handle.enable().await.unwrap();
    let exchanges = f.exchanges.lock().await.clone();
    assert_eq!(exchanges.len(), 5); // exact cleanup followed by new client registration
    assert_eq!(exchanges[0], exchanges[3]);
    assert_ne!(exchanges[0]["requestId"], exchanges[4]["requestId"]);
    assert_ne!(
        exchanges[0]["registrationKey"],
        exchanges[4]["registrationKey"]
    );
    assert_eq!(f.calls("DELETE /api/v1/session"), 1);
    assert!(f.handle.snapshot().await.enabled);
    f.close().await;
}

#[tokio::test]
async fn disable_closes_local_gateway_before_pending_revocation_and_blocks_replacement() {
    let f = Fixture::new().await;
    f.handle.enable_default().await.unwrap();
    let grid = f
        .handle
        .0
        .state
        .lock()
        .await
        .remote
        .as_ref()
        .unwrap()
        .grid
        .clone();
    f.fail_grid_revoke.store(true, Ordering::SeqCst);
    f.block("DELETE /api/v1/session").await;
    let closing = tokio::spawn({
        let handle = f.handle.clone();
        async move { handle.disable().await }
    });
    f.entered.notified().await;
    f.assert_gateways_closed().await;
    assert!(!grid.snapshot().remote_enabled);
    assert!(!f.handle.snapshot().await.enabled);
    f.provider_stopped();
    f.release.add_permits(1);
    closing.await.unwrap();
    assert!(
        f.handle
            .snapshot()
            .await
            .error
            .unwrap()
            .contains("尚未确认")
    );
    assert_eq!(f.calls("DELETE /api/v1/session"), 1);
    assert_eq!(
        f.handle.enable().await.unwrap_err().to_string(),
        "REMOTE_COORDINATION_CLEANUP_REQUIRED"
    );
    assert_eq!(f.calls("POST /api/v1/auth/exchange"), 1);
    assert_eq!(f.calls("POST /oidc/token"), 2);
    f.fail_grid_revoke.store(false, Ordering::SeqCst);
    f.handle.enable().await.unwrap();
    assert_eq!(f.calls("POST /api/v1/auth/exchange"), 2);
    assert!(f.handle.snapshot().await.enabled);
    f.close().await;
}

#[tokio::test]
async fn sdk_forces_refresh_only_after_first_definitive_invalid_identity() {
    for mode in [2, 3] {
        let f = Fixture::new().await;
        f.exchange_mode.store(mode, Ordering::SeqCst);
        let result = f.handle.enable_default().await;
        if mode == 2 {
            result.unwrap();
            let exchanges = f.exchanges.lock().await.clone();
            assert_eq!(exchanges.len(), 2);
            assert_eq!(exchanges[0]["requestId"], exchanges[1]["requestId"]);
            assert_eq!(f.calls("POST /oidc/token"), 3); // initial, forced, index
        } else {
            assert!(result.is_err());
            assert_eq!(f.calls("POST /oidc/token"), 1);
            assert_eq!(f.calls("POST /api/v1/auth/exchange"), 1);
            assert_eq!(f.calls("PATCH /api/my-account"), 0);
        }
        f.close().await;
    }
}

#[tokio::test]
async fn provider_rejects_every_mismatched_binding_and_invalid_request_before_rotation() {
    let f = Fixture::new().await;
    let (grid, authorization) = f.grid().await;
    for bad in 0..11 {
        let mut request = f.request(&grid);
        match bad {
            0 => request.issuer.push_str("/other"),
            1 => request.client_id.push_str("-other"),
            2 => request.resource.push_str("/other"),
            3 => request.scopes.push("unknown".into()),
            4 => request.scopes[1] = "openid".into(),
            5 => {
                request.scopes.pop();
            }
            6 => request.min_validity = 0,
            7 => request.min_validity = 3601,
            8 => request.generation += 1,
            9 => request.cancel.cancel(),
            10 => request.min_validity = 1,
            _ => unreachable!(),
        }
        assert!(
            authorization.token(&grid, &request).await.is_err(),
            "case {bad}"
        );
        assert_eq!(f.calls("POST /oidc/token"), 0);
    }
    let (other, _) = f.grid().await;
    assert_eq!(other.snapshot().generation, grid.snapshot().generation);
    assert!(
        authorization
            .token(&other, &f.request(&other))
            .await
            .is_err()
    );
    other.disable_remote().await;
    assert_eq!(f.calls("POST /oidc/token"), 0);
    let mut request = f.request(&grid);
    request.scopes.reverse(); // set equality, not arbitrary order
    request.reason = cybergrid_sdk::AuthRequestReason::CoordinationRecovery;
    authorization.token(&grid, &request).await.unwrap();
    request.reason = cybergrid_sdk::AuthRequestReason::AuthorizationRejected;
    request.force_refresh = true;
    authorization.token(&grid, &request).await.unwrap();
    assert_eq!(f.calls("POST /oidc/token"), 2);
    authorization.owner.policy().invalidate(false);
    assert!(authorization.token(&grid, &request).await.is_err());
    assert_eq!(f.calls("POST /oidc/token"), 2);
    grid.disable_remote().await;
    f.close().await;
}

#[tokio::test]
async fn provider_freshness_is_independent_of_reason_and_always_rotates_the_owned_grant() {
    let f = Fixture::new().await;
    let (grid, authorization) = f.grid().await;
    let mut request = f.request(&grid);
    for reason in [
        cybergrid_sdk::AuthRequestReason::Connect,
        cybergrid_sdk::AuthRequestReason::CoordinationRecovery,
        cybergrid_sdk::AuthRequestReason::AuthorizationRejected,
    ] {
        request.reason = reason;
        for force in [false, true] {
            request.force_refresh = force;
            authorization.token(&grid, &request).await.unwrap();
        }
    }
    assert_eq!(f.calls("POST /oidc/token"), 6);
    assert_eq!(
        authorization.owner.state.lock().await.grant.refresh,
        "synthetic-rotated"
    );
    // A legitimate forced recovery cannot bypass manual-off intent.
    authorization.owner.policy().invalidate(false);
    assert!(authorization.token(&grid, &request).await.is_err());
    assert_eq!(f.calls("POST /oidc/token"), 6);
    grid.close().await.unwrap();
    f.close().await;
}

#[tokio::test]
async fn provider_checks_remaining_lifetime_and_checkpoints_rotation_before_stale_result() {
    let f = Fixture::new().await;
    let (grid, authorization) = f.grid().await;
    let request = f.request(&grid);
    f.token_lifetime.store(10, Ordering::SeqCst);
    assert!(authorization.token(&grid, &request).await.is_err());
    assert_eq!(
        authorization.owner.state.lock().await.grant.refresh,
        "synthetic-rotated"
    );
    assert!(!authorization.owner.state.lock().await.uncertain);
    f.token_lifetime.store(3600, Ordering::SeqCst);
    f.block("POST /oidc/token").await;
    let cancel = request.cancel.clone();
    let task = tokio::spawn({
        let grid = grid.clone();
        let authorization = authorization.clone();
        async move { authorization.token(&grid, &request).await }
    });
    f.entered.notified().await;
    cancel.cancel();
    authorization.owner.policy().invalidate(false);
    f.release.add_permits(1);
    assert!(task.await.unwrap().is_err());
    let owner = authorization.owner.state.lock().await;
    assert!(!owner.uncertain);
    assert_eq!(owner.grant.refresh, "synthetic-rotated");
    drop(owner);
    assert_eq!(f.calls("POST /oidc/token"), 2);
    grid.disable_remote().await;
    f.close().await;
}

#[tokio::test]
async fn failed_explicit_publication_never_marks_enabled_or_writes_directory_and_retains_cleanup() {
    let f = Fixture::new().await;
    f.publication_failure.store(1, Ordering::SeqCst);
    f.fail_grid_revoke.store(true, Ordering::SeqCst);
    assert_eq!(
        safe_error(f.handle.enable_default().await.unwrap_err()),
        "REMOTE_ENABLE_GRID_EXPOSE"
    );
    assert_eq!(f.calls("PATCH /api/my-account"), 0);
    assert!(!f.handle.snapshot().await.enabled);
    f.provider_stopped();
    let pending = f
        .handle
        .0
        .state
        .lock()
        .await
        .pending_grid
        .as_ref()
        .unwrap()
        .grid
        .clone();
    assert!(!pending.snapshot().remote_enabled);
    assert!(
        f.handle
            .snapshot()
            .await
            .error
            .unwrap()
            .contains("尚未确认")
    );
    assert_eq!(
        f.handle.enable().await.unwrap_err().to_string(),
        "REMOTE_COORDINATION_CLEANUP_REQUIRED"
    );
    assert_eq!(f.calls("POST /api/v1/auth/exchange"), 1);
    f.publication_failure.store(0, Ordering::SeqCst);
    f.fail_grid_revoke.store(false, Ordering::SeqCst);
    f.handle.enable().await.unwrap();
    assert!(f.handle.snapshot().await.enabled);
    assert_eq!(f.calls("PATCH /api/my-account"), 1);
    f.close().await;
}

#[tokio::test]
async fn known_session_initial_publication_failure_retains_exact_cleanup_owner() {
    let f = Fixture::new().await;
    f.publication_failure.store(2, Ordering::SeqCst);
    f.fail_grid_revoke.store(true, Ordering::SeqCst);
    assert_eq!(
        safe_error(f.handle.enable_default().await.unwrap_err()),
        "REMOTE_ENABLE_GRID_REGISTER"
    );
    assert!(!f.handle.snapshot().await.enabled);
    assert_eq!(f.calls("PATCH /api/my-account"), 0);
    f.provider_stopped();
    let pending = f
        .handle
        .0
        .state
        .lock()
        .await
        .pending_grid
        .as_ref()
        .unwrap()
        .grid
        .clone();
    assert!(!pending.snapshot().remote_enabled);
    assert!(f.calls("DELETE /api/v1/session") >= 1);
    assert_eq!(
        f.handle.enable().await.unwrap_err().to_string(),
        "REMOTE_COORDINATION_CLEANUP_REQUIRED"
    );
    let registrations = f.calls("POST /api/v1/auth/exchange");
    f.handle.enable_default().await.unwrap();
    assert_eq!(f.calls("POST /api/v1/auth/exchange"), registrations);
    f.publication_failure.store(0, Ordering::SeqCst);
    f.fail_grid_revoke.store(false, Ordering::SeqCst);
    f.handle.enable().await.unwrap();
    assert_eq!(f.calls("POST /api/v1/auth/exchange"), registrations + 1);
    assert!(f.handle.snapshot().await.enabled);
    f.close().await;
}

#[tokio::test]
async fn late_current_publication_ack_cannot_overwrite_manual_off_or_write_index() {
    let f = Fixture::new().await;
    f.block("PUT /api/v1/devices/self#2").await;
    let enabling = tokio::spawn({
        let handle = f.handle.clone();
        async move { handle.enable_default().await }
    });
    f.entered.notified().await;
    assert!(!f.handle.snapshot().await.enabled);
    assert_eq!(f.calls("PATCH /api/my-account"), 0);
    let closing = tokio::spawn({
        let handle = f.handle.clone();
        async move { handle.disable().await }
    });
    let owner = f.handle.0.state.lock().await.owner.clone().unwrap();
    tokio::time::timeout(Duration::from_secs(3), async {
        while !owner.policy().manual_off {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    f.release.add_permits(1);
    assert!(enabling.await.unwrap().is_err());
    closing.await.unwrap();
    assert!(!f.handle.snapshot().await.enabled);
    assert_eq!(f.calls("PATCH /api/my-account"), 0);
    assert_eq!(f.calls("DELETE /api/v1/session"), 1);
    f.handle.enable_default().await.unwrap();
    assert_eq!(f.calls("POST /api/v1/auth/exchange"), 1);
    f.close().await;
}

#[tokio::test]
async fn sdk_oauth_unknown_requires_new_login_and_never_becomes_coordinator_retry() {
    let f = Fixture::new().await;
    f.token_unknown.store(true, Ordering::SeqCst);
    assert_eq!(
        safe_error(f.handle.enable_default().await.unwrap_err()),
        "REMOTE_ENABLE_RESOURCE_TOKEN"
    );
    let state = f.handle.snapshot().await;
    assert_eq!(
        state.authorization_status,
        AuthorizationStatus::ReauthRequired
    );
    assert!(!state.enabled && !state.signed_in);
    assert!(f.handle.0.state.lock().await.pending_grid.is_none());
    f.token_unknown.store(false, Ordering::SeqCst);
    assert_eq!(
        f.handle.enable().await.unwrap_err().to_string(),
        "ACCOUNT_REAUTH_REQUIRED"
    );
    assert_eq!(f.calls("POST /oidc/token"), 1);
    assert_eq!(f.calls("POST /api/v1/auth/exchange"), 0);
    f.provider_stopped();
    f.close().await;
}
