//! Synthetic identities and loopback Account API fixtures; no real OAuth login.
use super::*;
use std::sync::atomic::{AtomicBool, Ordering};

fn profile(subject: &str) -> tauri_plugin_mobile_auth::Profile {
    tauri_plugin_mobile_auth::Profile {
        subject: subject.into(),
        display_name: "Fixture User".into(),
        username: Some("fixture".into()),
        email: None,
        picture: None,
    }
}
fn native(generation: u64, status: &str) -> NativeSnapshot {
    NativeSnapshot {
        generation,
        status: status.into(),
        profile: (status == "signedIn").then(|| profile("fixture-subject")),
        error_code: None,
    }
}
#[derive(Default)]
struct Backend {
    fail_token: AtomicBool,
    started: tokio::sync::Notify,
    release: tokio::sync::Notify,
}
impl AuthBackend for Backend {
    fn configure(
        &self,
        _: tauri_plugin_mobile_auth::Configuration,
    ) -> AuthFuture<'_, NativeSnapshot> {
        Box::pin(async { Ok(native(0, "signedOut")) })
    }
    fn snapshot(&self) -> AuthFuture<'_, NativeSnapshot> {
        Box::pin(async { Ok(native(7, "signedIn")) })
    }
    fn sign_in(&self, _: bool) -> AuthFuture<'_, NativeSnapshot> {
        Box::pin(async {
            self.started.notify_one();
            self.release.notified().await;
            Ok(native(7, "signedIn"))
        })
    }
    fn logout(&self) -> AuthFuture<'_, NativeSnapshot> {
        Box::pin(async { Ok(native(8, "signedOut")) })
    }
    fn profile(&self, _: u64) -> AuthFuture<'_, NativeSnapshot> {
        self.snapshot()
    }
    fn token(
        &self,
        generation: u64,
        _: bool,
        _: bool,
        _: u64,
    ) -> AuthFuture<'_, tauri_plugin_mobile_auth::AccessGrant> {
        Box::pin(async move {
            if self.fail_token.load(Ordering::SeqCst) {
                bail!("fixture unknown rotation")
            }
            Ok(tauri_plugin_mobile_auth::AccessGrant {
                access_token: "fixture-native-only-access".into(),
                generation,
                expires_at: now() + 3600,
            })
        })
    }
}
fn handle(config: Config) -> (Handle, Arc<Backend>) {
    let backend = Arc::new(Backend::default());
    (
        Handle::with_backend(config, backend.clone(), Arc::new(|_| {})),
        backend,
    )
}
async fn signed_in(handle: &Handle) {
    handle.apply(0, native(7, "signedIn")).await.unwrap();
}
fn key(byte: u8) -> String {
    URL_SAFE_NO_PAD.encode([byte; 32])
}
fn account_data() -> Value {
    json!({"id":"fixture-subject","customData":{"unrelated":{"retain":true},"anywork":{
        "schemaVersion":1,"future":{"retain":true},"preferences":{"locale":"en"},
        "devices":{"fixture-install":{"label":"Laptop","platform":"macos","publicKey":key(1),"keyVersion":1,"gridDeviceId":"fixture-grid","future":"retain"}}
    }}})
}
async fn install_target(handle: &Handle) -> (String, u64, u64) {
    let mut records = Handle::account_devices(&account_data()).unwrap();
    records[0].online = Some(true);
    records[0].gateway_url = Some("https://fixture.trycloudflare.com".into());
    let scope = handle.scope_id().await.unwrap();
    let device_ref = digest(&["mobile-device-ref-v1", &scope, &records[0].installation_id]);
    let mut state = handle.0.state.lock().await;
    state.snapshot.directory_state = DirectoryState::Ready;
    state.snapshot.revision = 10;
    state.sampled_at = now();
    state.snapshot.devices = vec![Device {
        device_ref: device_ref.clone(),
        installation_id: records[0].installation_id.clone(),
        label: records[0].label.clone(),
        platform: records[0].platform.clone(),
        public_key: records[0].public_key.clone(),
        key_version: 1,
        online: Some(true),
        trusted_public_key: None,
    }];
    state.records = records;
    (device_ref, state.snapshot.epoch, state.snapshot.revision)
}

#[tokio::test]
async fn public_snapshot_never_contains_subject_or_native_access_material() {
    let (handle, _) = handle(Config::default());
    signed_in(&handle).await;
    let snapshot = serde_json::to_string(&handle.0.state.lock().await.snapshot).unwrap();
    assert!(!snapshot.contains("fixture-subject"));
    assert!(!snapshot.contains("accessToken"));
    assert!(!snapshot.contains("refreshToken"));
    assert!(!snapshot.contains("fixture-native-only-access"));
    assert!(snapshot.contains("Fixture User"));
    assert_eq!(handle.scope_id().await.unwrap().len(), 64);
    let mut other = native(8, "signedIn");
    other.profile = Some(profile("other-fixture-subject"));
    let first = handle.scope_id().await.unwrap();
    handle.apply(0, other).await.unwrap();
    assert_ne!(first, handle.scope_id().await.unwrap());
}

#[tokio::test]
async fn cancel_fences_late_login_result_and_does_not_restore_identity() {
    let (handle, backend) = handle(Config::default());
    let runner = {
        let handle = handle.clone();
        tokio::spawn(async move { handle.login(false).await })
    };
    backend.started.notified().await;
    let cancelled = handle.cancel().await.unwrap();
    assert!(cancelled.phase == Phase::SignedOut);
    backend.release.notify_one();
    assert_eq!(
        runner.await.unwrap().err().unwrap().to_string(),
        "CANCELLED"
    );
    let state = handle.0.state.lock().await;
    assert!(state.snapshot.phase == Phase::SignedOut);
    assert!(state.snapshot.account.is_none());
}

#[tokio::test]
async fn unknown_rotation_retires_targets_and_blocks_old_owner() {
    let (handle, backend) = handle(Config::default());
    signed_in(&handle).await;
    let (device, epoch, revision) = install_target(&handle).await;
    let prepared = handle
        .prepare_current_target(&device, epoch, revision, Some(&key(1)))
        .await
        .unwrap();
    backend.fail_token.store(true, Ordering::SeqCst);
    assert!(
        handle
            .token(TokenResource::Business, true, 60)
            .await
            .is_err()
    );
    assert!(prepared.target.lifetime.is_cancelled());
    assert!(handle.ensure_epoch(epoch).await.is_err());
    assert!(handle.0.state.lock().await.snapshot.phase == Phase::ReauthRequired);
    assert!(prepared.authorization.token(false, 60).await.is_err());
}

#[test]
fn directory_schema_is_bounded_and_distinguishes_missing_from_empty() {
    assert!(
        Handle::account_devices(&json!({"customData":{}}))
            .unwrap()
            .is_empty()
    );
    assert!(Handle::account_devices(&json!({})).is_err());
    let mut value = account_data();
    value["customData"]["anywork"]["devices"]["fixture-install"]["publicKey"] = json!("bad");
    assert!(Handle::account_devices(&value).is_err());
    let mut value = account_data();
    value["customData"]["anywork"]["devices"]["fixture-install"]["keyVersion"] = json!(0);
    assert!(Handle::account_devices(&value).is_err());
    let mut value = account_data();
    value["customData"]["anywork"]["preferences"]["locale"] = json!("invalid");
    assert!(Handle::account_devices(&value).is_err());
    let mut value = account_data();
    let devices = value["customData"]["anywork"]["devices"]
        .as_object_mut()
        .unwrap();
    devices.insert("__proto__".into(), devices["fixture-install"].clone());
    assert!(Handle::account_devices(&value).is_err());
    let mut value = account_data();
    value["customData"]["oversized"] = json!("x".repeat(32768));
    assert!(Handle::account_devices(&value).is_err());
}

#[tokio::test]
async fn handshake_failure_never_saves_pin_success_commit_is_single_use_and_scoped() {
    let (handle, _) = handle(Config::default());
    signed_in(&handle).await;
    let (device, epoch, revision) = install_target(&handle).await;
    assert_eq!(
        handle
            .prepare_current_target(&device, epoch, revision, None)
            .await
            .err()
            .unwrap()
            .to_string(),
        "KEY_CONFIRMATION_REQUIRED"
    );
    let abandoned = handle
        .prepare_current_target(&device, epoch, revision, Some(&key(1)))
        .await
        .unwrap();
    drop(abandoned); // failed handshake
    assert!(
        handle
            .0
            .trust
            .lock()
            .await
            .as_ref()
            .unwrap()
            .get(&handle.scope_id().await.unwrap(), "fixture-install")
            .is_none()
    );
    let first = handle
        .prepare_current_target(&device, epoch, revision, Some(&key(1)))
        .await
        .unwrap();
    let stale = handle
        .prepare_current_target(&device, epoch, revision, Some(&key(1)))
        .await
        .unwrap();
    handle.commit_trust(first.trust).await.unwrap();
    assert!(handle.commit_trust(stale.trust).await.is_err());
    let scope = handle.scope_id().await.unwrap();
    let trust = handle.0.trust.lock().await;
    assert!(
        trust
            .as_ref()
            .unwrap()
            .get(&scope, "fixture-install")
            .is_some()
    );
    assert!(
        trust
            .as_ref()
            .unwrap()
            .get("other-scope", "fixture-install")
            .is_none()
    );
}

#[tokio::test]
async fn changed_key_and_directory_revision_reject_old_confirmation() {
    let (handle, _) = handle(Config::default());
    signed_in(&handle).await;
    let (device, epoch, revision) = install_target(&handle).await;
    let prepared = handle
        .prepare_current_target(&device, epoch, revision, Some(&key(1)))
        .await
        .unwrap();
    {
        let mut state = handle.0.state.lock().await;
        state.records[0].public_key = key(2);
        state.snapshot.devices[0].public_key = key(2);
        state.snapshot.revision += 1;
    }
    assert!(handle.commit_trust(prepared.trust).await.is_err());
    assert!(
        handle
            .prepare_current_target(&device, epoch, revision + 1, Some(&key(1)))
            .await
            .is_err()
    );
    assert!(
        handle
            .prepare_current_target(&device, epoch, revision + 1, Some(&key(2)))
            .await
            .is_ok()
    );
    handle.logout().await.unwrap();
    assert!(
        handle
            .prepare_current_target(&device, epoch, revision + 1, Some(&key(2)))
            .await
            .is_err()
    );
}

#[test]
fn trust_file_contains_only_public_pins_and_rejects_corrupt_storage() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("pins.json");
    let mut store = TrustStore::load(Some(path.clone())).unwrap();
    store
        .save(
            "fixture-scope",
            "fixture-install",
            TrustPin {
                public_key: key(1),
                key_version: 1,
            },
        )
        .unwrap();
    let body = std::fs::read_to_string(&path).unwrap();
    assert!(!body.contains("fixture-scope"));
    assert!(!body.contains("fixture-install"));
    assert!(
        TrustStore::load(Some(path.clone()))
            .unwrap()
            .get("fixture-scope", "fixture-install")
            .is_some()
    );
    std::fs::write(&path, "broken").unwrap();
    assert!(TrustStore::load(Some(path)).is_err());
}

fn native_config() -> Value {
    let config = Config::default();
    json!({"provider":"logto","issuer":config.issuer,"clientId":config.client_id,"resource":config.resource,
        "deviceAuthorizationEndpoint":format!("{}/device/auth",config.issuer),"tokenEndpoint":format!("{}/token",config.issuer),
        "revocationEndpoint":format!("{}/token/revocation",config.issuer),"scope":"openid offline_access profile email connect",
        "coordination":{"protocol":"memory-v1","epoch":"00000000-0000-4000-8000-000000000001"}})
}
#[test]
fn native_configuration_requires_issuer_client_resource_and_no_console_fields() {
    let value = native_config();
    assert!(EndpointPolicy::parse(&value, &Config::default()).is_ok());
    for field in [
        "issuer",
        "clientId",
        "resource",
        "tokenEndpoint",
        "deviceAuthorizationEndpoint",
    ] {
        let mut changed = value.clone();
        changed[field] = json!("invalid");
        assert!(EndpointPolicy::parse(&changed, &Config::default()).is_err());
    }
    assert!(value.get("authorizationEndpoint").is_none());
    assert!(value.get("jwksUri").is_none());
}

#[test]
fn gateway_rejects_untrusted_origins_noncanonical_paths_and_wrong_business_port() {
    let policy = EndpointPolicy { providers: vec![] };
    assert!(policy.endpoint("https://fixture.trycloudflare.com").is_ok());
    for invalid in [
        "http://fixture.trycloudflare.com",
        "https://example.com",
        "https://fixture.trycloudflare.com/evil",
        "https://fixture.trycloudflare.com/%2f",
        "https://fixture.trycloudflare.com?secret=x",
        "https://fixture.trycloudflare.com:8443",
    ] {
        assert!(policy.endpoint(invalid).is_err());
    }
    let mut device = json!({"devices":[{"id":"fixture-grid","online":true,"lastSeen":"2026-01-01T00:00:00Z","ports":[{"id":"anywork-remote","transport":"tcp","port":4000,"type":"wrong","tunnelUrl":"https://fixture.trycloudflare.com"}]}]});
    assert!(GridDevice::parse(&device, &policy).is_err());
    device["devices"][0]["ports"][0]["type"] = json!("anywork-noise-v1");
    assert!(GridDevice::parse(&device, &policy).unwrap()[0].online);
}

/// Minimal real HTTP fixture for the Account API, separate from OAuth/native UI.
async fn server(
    initial: Value,
    conflict: bool,
) -> (String, Arc<Mutex<Value>>, tokio::task::JoinHandle<()>) {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let data = Arc::new(Mutex::new(initial));
    let shared = data.clone();
    let task = tokio::spawn(async move {
        loop {
            let (mut socket, _) = listener.accept().await.unwrap();
            let shared = shared.clone();
            tokio::spawn(async move {
                let mut body = Vec::new();
                let mut bytes = [0u8; 2048];
                let (end, length, patch) = loop {
                    let n = socket.read(&mut bytes).await.unwrap();
                    if n == 0 {
                        return;
                    }
                    body.extend_from_slice(&bytes[..n]);
                    assert!(body.len() < 131072);
                    if let Some(end) = body.windows(4).position(|w| w == b"\r\n\r\n") {
                        let header = String::from_utf8_lossy(&body[..end]);
                        let length = header
                            .lines()
                            .find_map(|line| {
                                line.to_lowercase()
                                    .strip_prefix("content-length: ")
                                    .and_then(|v| v.parse::<usize>().ok())
                            })
                            .unwrap_or(0);
                        break (end + 4, length, header.starts_with("PATCH "));
                    }
                };
                while body.len() < end + length {
                    let n = socket.read(&mut bytes).await.unwrap();
                    if n == 0 {
                        return;
                    }
                    body.extend_from_slice(&bytes[..n]);
                }
                let mut data = shared.lock().await;
                if patch {
                    let request: Value = serde_json::from_slice(&body[end..end + length]).unwrap();
                    data["customData"] = request["customData"].clone();
                    if conflict {
                        data["customData"]["concurrent"] = json!(true);
                    }
                }
                let response = serde_json::to_vec(&*data).unwrap();
                let header = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    response.len()
                );
                socket.write_all(header.as_bytes()).await.unwrap();
                socket.write_all(&response).await.unwrap();
            });
        }
    });
    (url, data, task)
}

#[tokio::test]
async fn account_rename_and_remove_preserve_unknown_fields_and_verify_writes() {
    let (url, data, task) = server(account_data(), false).await;
    let (handle, _) = handle(Config {
        endpoint: url,
        ..Config::default()
    });
    signed_in(&handle).await;
    let (device, epoch, revision) = install_target(&handle).await;
    let renamed = handle
        .device_update(DeviceUpdateRequest {
            device_ref: device.clone(),
            expected_epoch: epoch,
            expected_revision: revision,
            label: Some("Renamed".into()),
            remove: None,
        })
        .await
        .unwrap();
    assert_eq!(renamed.devices[0].label, "Renamed");
    assert!(renamed.directory_state == DirectoryState::Unknown); // host has no native broker
    {
        let data = data.lock().await;
        assert_eq!(data["customData"]["unrelated"]["retain"], true);
        assert_eq!(
            data["customData"]["anywork"]["devices"]["fixture-install"]["future"],
            "retain"
        );
    }
    let removed = handle
        .device_update(DeviceUpdateRequest {
            device_ref: device,
            expected_epoch: epoch,
            expected_revision: renamed.revision,
            label: None,
            remove: Some(true),
        })
        .await
        .unwrap();
    assert!(removed.devices.is_empty());
    assert!(removed.directory_state == DirectoryState::Ready);
    assert_eq!(
        data.lock().await["customData"]["anywork"]["future"]["retain"],
        true
    );
    task.abort();
}

#[tokio::test]
async fn account_write_readback_conflict_is_not_reported_as_success() {
    let (url, _, task) = server(account_data(), true).await;
    let (handle, _) = handle(Config {
        endpoint: url,
        ..Config::default()
    });
    signed_in(&handle).await;
    let (device, epoch, revision) = install_target(&handle).await;
    let error = handle
        .device_update(DeviceUpdateRequest {
            device_ref: device,
            expected_epoch: epoch,
            expected_revision: revision,
            label: Some("Renamed".into()),
            remove: None,
        })
        .await
        .err()
        .unwrap();
    assert_eq!(error.to_string(), "DIRECTORY_CONFLICT");
    task.abort();
}
