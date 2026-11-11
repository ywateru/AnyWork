//! Synthetic HTTP/SDK/provider integration only; no real grant or cloud account.
use super::*;
use axum::response::IntoResponse;
use std::os::unix::fs::PermissionsExt;
use std::sync::atomic::{AtomicBool, Ordering};

struct Fixture {
    dir: tempfile::TempDir,
    handle: Handle,
    requests: Arc<std::sync::Mutex<BTreeMap<String, usize>>>,
    fail_config: Arc<AtomicBool>,
    fail_revoke: Arc<AtomicBool>,
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
        let gate = Arc::new(Mutex::new(None::<String>));
        let entered = Arc::new(Notify::new());
        let release = Arc::new(tokio::sync::Semaphore::new(0));
        let app = {
            let fail_revoke = fail_revoke.clone();
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
                async move {
                    let path=request.uri().path().to_string();
                    let key=format!("{} {}",request.method(),path);
                    *requests.lock().unwrap().entry(key.clone()).or_default()+=1;
                    let wait={ let mut g=gate.lock().await; if g.as_ref()==Some(&key) {g.take();true} else {false} };
                    if wait { entered.notify_one(); release.acquire().await.unwrap().forget(); }
                    let value = match key.as_str() {
                        "GET /api/v1/auth/config" => {
                            assert!(!request.headers().contains_key("authorization"));
                            if fail.load(Ordering::SeqCst) {return (axum::http::StatusCode::UNAUTHORIZED,axum::Json(json!({"error":{"code":"denied"}}))).into_response();}
                            auth
                        },
                        "POST /oidc/token" => json!({"access_token":"synthetic-access","refresh_token":"synthetic-rotated"}),
                        "POST /oidc/token/revocation" => {
                            if fail_revoke.load(Ordering::SeqCst) {return (axum::http::StatusCode::BAD_GATEWAY,axum::Json(json!({}))).into_response();}
                            json!({})
                        },
                        "POST /api/v1/auth/exchange" => json!({"coordinatorEpoch":"fixture-epoch","incarnation":"44607dc4-3ea1-48c0-97dc-f6c013984f6e","purpose":"device","appId":app_id,"sessionKey":"synthetic-session","expiresAt":chrono::Utc::now()+chrono::Duration::minutes(10),"deviceId":"fixture-device","user":{"id":"fixture-owner"}}),
                        "GET /api/my-account" => json!({"id":"fixture-owner","customData":data.lock().await.clone()}),
                        "PATCH /api/my-account" => {
                            let bytes=axum::body::to_bytes(request.into_body(),32768).await.unwrap();
                            let body:Value=serde_json::from_slice(&bytes).unwrap();
                            *data.lock().await=body["customData"].clone();json!({})
                        },
                        "GET /api/v1/signals" => {tokio::time::sleep(Duration::from_millis(30)).await;json!({"signals":[],"cursor":0,"coordinatorEpoch":"fixture-epoch"})},
                        "PUT /api/v1/devices/self" | "DELETE /api/v1/session" => json!({}),
                        _ => panic!("unexpected synthetic endpoint {key}"),
                    };
                    (axum::http::StatusCode::OK, [("X-CyberGrid-Epoch", "fixture-epoch")], axum::Json(value)).into_response()
                }
            })
        };
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let mut owner_config = handle.0.config.clone();
        owner_config.issuer = format!("{base}/oidc");
        handle.0.state.lock().await.owner = Some(Arc::new(
            GrantOwner::new(Grant {
                config: owner_config,
                refresh: "synthetic-initial".into(),
                subject: "fixture-owner".into(),
            })
            .unwrap(),
        ));
        Self {
            dir,
            handle,
            requests,
            fail_config,
            fail_revoke,
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
    async fn close(self) {
        self.handle.disable().await;
        self.provider_stopped();
        if let Ok(url) = std::fs::read_to_string(self.dir.path().join("gateway-url")) {
            let port = url::Url::parse(&url).unwrap().port().unwrap();
            assert!(
                tokio::net::TcpStream::connect(("127.0.0.1", port))
                    .await
                    .is_err()
            );
        }
        self.server.abort();
    }
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
    let mut config = f.handle.0.config.clone();
    config.issuer = format!("{}/oidc", config.endpoint);
    f.handle.0.state.lock().await.owner = Some(Arc::new(
        GrantOwner::new(Grant {
            config,
            refresh: "new-synthetic-grant".into(),
            subject: "fixture-owner".into(),
        })
        .unwrap(),
    ));
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
    let handle = f.handle.clone();
    let enable = tokio::spawn(async move { handle.enable_default().await });
    tokio::time::timeout(Duration::from_secs(3), async {
        while !f.dir.path().join("gateway-url").exists() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    tokio::time::timeout(Duration::from_secs(3), f.handle.disable())
        .await
        .unwrap();
    assert!(enable.await.unwrap().is_err());
    assert_eq!(f.calls("GET /api/v1/auth/config"), 0);
    assert!(!f.handle.snapshot().await.enabled);
    f.close().await;
}
