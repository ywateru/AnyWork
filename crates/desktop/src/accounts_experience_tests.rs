//! Confined synthetic account and loopback boundaries; no real account writes.
use super::*;
use axum::response::IntoResponse;

async fn rename(h: &Handle, name: &str) -> Result<Snapshot> {
    h.rename_device(name, &h.snapshot().await.device_name).await
}
use std::sync::atomic::{AtomicUsize, Ordering};

#[test]
fn callback_payloads_require_one_state_and_one_result() {
    for (query, expected) in [
        ("state=owner&code=private", CallbackPage::Received),
        ("state=owner&error=access_denied", CallbackPage::Cancelled),
        ("state=owner&error=server_error", CallbackPage::Failed),
        ("state=other&error=access_denied", CallbackPage::Invalid),
        ("state=owner&state=owner&code=a", CallbackPage::Invalid),
        ("state=owner&code=a&code=b", CallbackPage::Invalid),
        (
            "state=owner&code=a&error=access_denied",
            CallbackPage::Invalid,
        ),
        ("state=owner", CallbackPage::Invalid),
        ("state=owner&code=", CallbackPage::Invalid),
    ] {
        let url = url::Url::parse(&format!("http://127.0.0.1:17897/callback?{query}")).unwrap();
        assert_eq!(
            callback_page(Some(&url), Some("owner")),
            expected,
            "{query}"
        );
        assert_eq!(callback_page(Some(&url), None), CallbackPage::Invalid);
    }
}

#[tokio::test]
async fn loopback_callback_serves_safe_html_and_invalid_state_does_not_consume_transaction() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let tx = super::tests::transaction();
    *tx.expected_state.lock().await = Some("private-state".into());
    let task = tokio::spawn(callback_listener(listener, tx.clone()));
    for (query, code, title) in [
        ("state=wrong&code=private-code", 400, "此登录链接无效"),
        (
            "state=private-state&error=access_denied&error_description=private-description",
            200,
            "已取消登录",
        ),
    ] {
        let response = client()
            .unwrap()
            .get(format!("http://{address}/callback?{query}"))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status().as_u16(), code);
        assert_eq!(response.headers()["cache-control"], "no-store");
        assert_eq!(response.headers()["referrer-policy"], "no-referrer");
        let policy = response.headers()["content-security-policy"]
            .to_str()
            .unwrap()
            .to_string();
        let html = response.text().await.unwrap();
        assert!(html.contains(title));
        assert!(html.contains(include_str!("../../../web/public/icon.svg")));
        for secret in ["private-code", "private-state", "private-description"] {
            assert!(!html.contains(secret));
        }
        let script = html
            .split("<script>")
            .nth(1)
            .unwrap()
            .split("</script>")
            .next()
            .unwrap();
        let digest =
            base64::engine::general_purpose::STANDARD.encode(Sha256::digest(script.as_bytes()));
        assert!(policy.contains(&format!("'sha256-{digest}'")));
        assert!(script.contains("history.replaceState"));
        if code == 400 {
            assert!(tx.callback.lock().await.is_none());
        }
    }
    task.await.unwrap();
    assert!(
        tx.callback
            .lock()
            .await
            .as_ref()
            .unwrap()
            .contains("error=access_denied")
    );
    assert!(callback_response(CallbackPage::Received).contains("应用正在完成验证"));
    assert!(!callback_response(CallbackPage::Received).contains("登录成功"));
}

#[tokio::test]
async fn loopback_success_and_provider_error_deliver_only_to_the_matching_transaction() {
    for (payload, title) in [
        ("code=private-code", "已收到登录结果"),
        ("error=server_error", "登录未完成"),
    ] {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let tx = super::tests::transaction();
        *tx.expected_state.lock().await = Some("matching".into());
        let task = tokio::spawn(callback_listener(listener, tx.clone()));
        let response = client()
            .unwrap()
            .get(format!(
                "http://{address}/callback?state=matching&{payload}"
            ))
            .send()
            .await
            .unwrap();
        assert!(response.status().is_success());
        let body = response.text().await.unwrap();
        assert!(body.contains(title));
        assert!(!body.contains("private-code"));
        task.await.unwrap();
        assert!(tx.callback.lock().await.as_ref().unwrap().contains(payload));
    }
}

#[tokio::test]
async fn local_device_name_is_generated_once_editable_and_preview_read_only() {
    let dir = tempfile::tempdir().unwrap();
    let h = super::tests::handle(dir.path());
    let first = h.snapshot().await.device_name;
    assert!(
        first.starts_with("Mac · ")
            || first.starts_with("Linux · ")
            || first.starts_with("Windows · ")
    );
    assert_eq!(load_device_name(dir.path(), false).unwrap(), first);
    let renamed = rename(&h, "  办公电脑 💻  ").await.unwrap();
    assert_eq!(renamed.device_name, "办公电脑 💻");
    assert!(!renamed.device_name_synced);
    assert_eq!(
        super::tests::handle(dir.path())
            .snapshot()
            .await
            .device_name,
        "办公电脑 💻"
    );
    for invalid in [
        "".into(),
        "  ".into(),
        "bad\nname".into(),
        "💻".repeat(41),
        "\u{85}".into(),
    ] {
        assert_eq!(
            rename(&h, &invalid).await.err().unwrap().to_string(),
            "DEVICE_NAME_REJECTED"
        );
    }
    assert!(rename(&h, &"💻".repeat(40)).await.is_ok());
    let empty = tempfile::tempdir().unwrap();
    load_device_name(empty.path(), true).unwrap();
    assert_eq!(std::fs::read_dir(empty.path()).unwrap().count(), 0);
    let outside = empty.path().join("outside");
    std::fs::write(&outside, "untouched").unwrap();
    std::os::unix::fs::symlink(&outside, empty.path().join("device-name.json")).unwrap();
    assert!(load_device_name(empty.path(), false).is_err());
    assert!(save_device_name(empty.path(), "test").is_err());
    assert_eq!(std::fs::read_to_string(outside).unwrap(), "untouched");
}

struct DirectoryFixture {
    dir: tempfile::TempDir,
    handle: Handle,
    data: Arc<Mutex<Value>>,
    mode: Arc<AtomicUsize>,
    patches: Arc<AtomicUsize>,
    entered: Arc<Notify>,
    release: Arc<Notify>,
    task: tokio::task::JoinHandle<()>,
}
impl DirectoryFixture {
    async fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let mut handle = super::tests::handle(dir.path());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let config = &mut Arc::get_mut(&mut handle.0).unwrap().config;
        config.endpoint = base.clone();
        config.issuer = format!("{base}/oidc");
        let owner = Arc::new(
            GrantOwner::new(Grant {
                config: config.clone(),
                refresh: "fixture-refresh".into(),
                subject: "fixture-owner".into(),
            })
            .unwrap(),
        );
        handle.0.state.lock().await.owner = Some(owner);
        let i = handle.installation("fixture-owner").await.unwrap();
        handle.remember_name("Web 自定义名称", true).await.unwrap();
        let data = Arc::new(Mutex::new(
            json!({"otherApp":{"keep":true},"anywork":{"schemaVersion":1,"preferences":{"appearance":"dark"},"devices":{i.id.clone():{"label":"Web 自定义名称","platform":"macos","publicKey":i.public_key,"keyVersion":7,"gridDeviceId":"grid-stable","extra":"retain"},"another":{"label":"another","platform":"linux","publicKey":i.public_key,"keyVersion":2}}}}),
        ));
        let mode = Arc::new(AtomicUsize::new(0));
        let patches = Arc::new(AtomicUsize::new(0));
        let entered = Arc::new(Notify::new());
        let release = Arc::new(Notify::new());
        let app = {
            let (data, mode, patches, entered, release, path) = (
                data.clone(),
                mode.clone(),
                patches.clone(),
                entered.clone(),
                release.clone(),
                dir.path().to_path_buf(),
            );
            axum::Router::new().fallback(move |request: axum::extract::Request| {
                let (data, mode, patches, entered, release, path) = (data.clone(), mode.clone(), patches.clone(), entered.clone(), release.clone(), path.clone());
                async move {
                    let current = mode.load(Ordering::SeqCst);
                    match (request.method().as_str(), request.uri().path()) {
                        ("POST", "/oidc/token") => axum::Json(json!({"access_token":"fixture-access","refresh_token":"fixture-rotated"})).into_response(),
                        ("GET", "/oidc/me") => axum::Json(json!({"sub":if current == 8 {"wrong-owner"} else {"fixture-owner"},"name":"可信用户名"})).into_response(),
                        ("GET", "/api/my-account") => {
                            if current == 1 { return axum::http::StatusCode::SERVICE_UNAVAILABLE.into_response(); }
                            if current == 4 { entered.notify_one(); release.notified().await; }
                            axum::Json(json!({"id":"fixture-owner","customData":data.lock().await.clone()})).into_response()
                        }
                        ("PATCH", "/api/my-account") => {
                            patches.fetch_add(1, Ordering::SeqCst);
                            if current == 2 { return axum::http::StatusCode::SERVICE_UNAVAILABLE.into_response(); }
                            let bytes = axum::body::to_bytes(request.into_body(), 65536).await.unwrap();
                            let body: Value = serde_json::from_slice(&bytes).unwrap();
                            if current != 3 { *data.lock().await = body["customData"].clone(); }
                            if current == 5 { std::fs::remove_file(path.join("device-name.json")).unwrap(); std::fs::create_dir(path.join("device-name.json")).unwrap(); }
                            axum::Json(json!({})).into_response()
                        }
                        _ => panic!("unexpected synthetic request"),
                    }
                }
            })
        };
        let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        Self {
            dir,
            handle,
            data,
            mode,
            patches,
            entered,
            release,
            task,
        }
    }
}
impl Drop for DirectoryFixture {
    fn drop(&mut self) {
        self.task.abort();
    }
}

#[tokio::test]
async fn directory_name_publication_preserves_web_name_then_rename_changes_only_label() {
    let f = DirectoryFixture::new().await;
    f.handle.remember_name("Mac · ABCD", false).await.unwrap();
    let i = f.handle.installation("fixture-owner").await.unwrap();
    let owner = f.handle.0.state.lock().await.owner.clone().unwrap();
    f.handle
        .publish_index(&owner, &i, "grid-stable")
        .await
        .unwrap();
    assert_eq!(f.handle.snapshot().await.device_name, "Web 自定义名称");
    assert_eq!(
        load_device_name(f.dir.path(), false).unwrap(),
        "Web 自定义名称"
    );
    let before = f.data.lock().await.clone();
    owner.policy().manual_off = true;
    let renamed = rename(&f.handle, "新的中文名称").await.unwrap();
    assert!(renamed.device_name_synced);
    assert_eq!(renamed.device_name, "新的中文名称");
    let mut expected = before;
    expected["anywork"]["devices"][&i.id]["label"] = json!("新的中文名称");
    assert_eq!(*f.data.lock().await, expected);
    let after = f.handle.installation("fixture-owner").await.unwrap();
    assert_eq!(after.id, i.id);
    assert_eq!(after.public_key, i.public_key);
    assert_eq!(after.private_key, i.private_key);
    assert!(owner.policy().manual_off);
    assert!(!renamed.enabled);
}

#[tokio::test]
async fn directory_failures_never_report_success_or_overwrite_local_name() {
    for mode in [1, 2, 3, 5] {
        let f = DirectoryFixture::new().await;
        let name = f.handle.snapshot().await.device_name;
        f.mode.store(mode, Ordering::SeqCst);
        assert!(
            rename(&f.handle, "pending draft").await.is_err(),
            "mode {mode}"
        );
        assert_eq!(f.handle.snapshot().await.device_name, name);
        assert!(!f.handle.snapshot().await.device_name_synced);
        if mode != 5 {
            assert_eq!(load_device_name(f.dir.path(), false).unwrap(), name);
        }
    }
}

#[tokio::test]
async fn absent_directory_stores_local_name_without_publishing_or_enabling() {
    let f = DirectoryFixture::new().await;
    *f.data.lock().await = json!({"otherApp":{"keep":true}});
    let result = rename(&f.handle, "local only").await.unwrap();
    assert_eq!(result.device_name, "local only");
    assert!(!result.device_name_synced);
    assert!(!result.enabled);
    assert_eq!(f.patches.load(Ordering::SeqCst), 0);
    assert_eq!(*f.data.lock().await, json!({"otherApp":{"keep":true}}));
}

#[tokio::test]
async fn logout_fences_name_write_while_account_read_is_in_flight() {
    let f = DirectoryFixture::new().await;
    f.mode.store(4, Ordering::SeqCst);
    let h = f.handle.clone();
    let rename = tokio::spawn(async move { rename(&h, "stale name").await });
    f.entered.notified().await;
    f.handle.invalidate_remote(true).await;
    f.release.notify_one();
    assert!(rename.await.unwrap().is_err());
    assert_eq!(f.patches.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn stale_local_and_web_editors_cannot_replace_a_newer_name() {
    let f = DirectoryFixture::new().await;
    assert!(
        f.handle
            .rename_device("stale", "outdated local name")
            .await
            .is_err()
    );
    assert_eq!(f.patches.load(Ordering::SeqCst), 0);
    let i = f.handle.installation("fixture-owner").await.unwrap();
    f.data.lock().await["anywork"]["devices"][&i.id]["label"] = json!("Changed in Web");
    assert_eq!(
        rename(&f.handle, "stale overwrite")
            .await
            .err()
            .unwrap()
            .to_string(),
        "DEVICE_NAME_CONFLICT"
    );
    assert_eq!(f.patches.load(Ordering::SeqCst), 0);
    assert_eq!(f.handle.snapshot().await.device_name, "Changed in Web");
    assert_eq!(
        load_device_name(f.dir.path(), false).unwrap(),
        "Changed in Web"
    );
    assert_eq!(
        rename(&f.handle, "explicit new edit")
            .await
            .unwrap()
            .device_name,
        "explicit new edit"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn naming_and_window_marker_use_the_actual_native_ipc_contract() {
    let dir = tempfile::tempdir().unwrap();
    let handle = super::tests::handle(dir.path());
    let name = handle.snapshot().await.device_name;
    let app = tauri::test::mock_builder()
        .manage(handle.clone())
        .invoke_handler(tauri::generate_handler![
            account_snapshot,
            account_rename_device,
            crate::bridge::desktop_chrome
        ])
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    let view = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let invoke = |cmd: &str, body: Value| {
        tauri::test::get_ipc_response(
            &view,
            tauri::webview::InvokeRequest {
                cmd: cmd.into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: "tauri://localhost".parse().unwrap(),
                body: tauri::ipc::InvokeBody::Json(body),
                headers: Default::default(),
                invoke_key: tauri::test::INVOKE_KEY.into(),
            },
        )
    };
    let result: Value = invoke(
        "account_rename_device",
        json!({"name":"IPC 名称","expectedName":name}),
    )
    .unwrap()
    .deserialize()
    .unwrap();
    assert_eq!(result["deviceName"], "IPC 名称");
    assert_eq!(result["deviceNameSynced"], false);
    assert!(
        invoke(
            "account_rename_device",
            json!({"name":"without expected name"})
        )
        .is_err()
    );
    let chrome: String = invoke("desktop_chrome", json!({}))
        .unwrap()
        .deserialize()
        .unwrap();
    assert_eq!(
        chrome,
        if cfg!(target_os = "macos") {
            "macos-overlay"
        } else {
            "standard"
        }
    );
}

#[tokio::test]
async fn native_user_info_is_provider_bound_and_requires_matching_subject() {
    let f = DirectoryFixture::new().await;
    let profile = f
        .handle
        .user_info("fixture-access", "fixture-owner")
        .await
        .unwrap();
    assert_eq!(account_label(&profile), "可信用户名");
    f.mode.store(8, Ordering::SeqCst);
    assert_eq!(
        f.handle
            .user_info("fixture-access", "fixture-owner")
            .await
            .unwrap_err()
            .to_string(),
        "ACCOUNT_IDENTITY_MISMATCH"
    );
}
