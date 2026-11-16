//! Restart/store fault tests with real loopback HTTP and injected identity only.
//! Never initializes the system keychain or contacts an online account.
use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};

struct Verifier {
    reject: std::sync::atomic::AtomicBool,
    wrong_subject: std::sync::atomic::AtomicBool,
}
impl AccountVerifier for Verifier {
    fn verify<'a>(&'a self, token: &'a str) -> anywork_remote::auth::VerifyFuture<'a> {
        Box::pin(async move {
            if self.reject.load(Ordering::SeqCst) || token != "fixture-resource-access" {
                bail!("fixture invalid signature or wrong subject")
            }
            Ok(anywork_remote::auth::VerifiedAccount {
                subject: if self.wrong_subject.load(Ordering::SeqCst) {
                    "other-fixture-owner"
                } else {
                    "fixture-owner"
                }
                .into(),
                expires_at: anywork_remote::auth::now() + 3600,
            })
        })
    }
}
struct Fixture {
    dir: tempfile::TempDir,
    store: Arc<saved::MemoryStore>,
    base: String,
    verifier: Arc<Verifier>,
    calls: Arc<AtomicUsize>,
    preflight_fail: Arc<std::sync::atomic::AtomicBool>,
    profile_fail: Arc<std::sync::atomic::AtomicBool>,
    mode: Arc<AtomicUsize>,
    entered: Arc<Notify>,
    release: Arc<tokio::sync::Semaphore>,
    server: tokio::task::JoinHandle<()>,
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.server.abort();
    }
}
impl Fixture {
    async fn new() -> Self {
        use axum::{
            response::IntoResponse,
            routing::{get, post},
        };
        let store = Arc::new(saved::MemoryStore::default());
        let calls = Arc::new(AtomicUsize::new(0));
        let preflight_fail = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let profile_fail = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let mode = Arc::new(AtomicUsize::new(0));
        let entered = Arc::new(Notify::new());
        let release = Arc::new(tokio::sync::Semaphore::new(0));
        let app = axum::Router::new()
            .route("/.well-known/openid-configuration", get({
                let fail=preflight_fail.clone(); move || { let fail=fail.clone(); async move {
                    if fail.load(Ordering::SeqCst) { return axum::http::StatusCode::SERVICE_UNAVAILABLE.into_response(); }
                    let c=PublicConfig::default();
                    axum::Json(json!({"issuer":c.issuer,"token_endpoint":format!("{}/token",c.issuer),"jwks_uri":format!("{}/jwks",c.issuer)})).into_response()
                }}
            }))
            .route("/token", post({
                let (calls,mode,store,entered,release)=(calls.clone(),mode.clone(),store.clone(),entered.clone(),release.clone());
                move |axum::Form(form):axum::Form<BTreeMap<String,String>>| {
                    let (calls,mode,store,entered,release)=(calls.clone(),mode.clone(),store.clone(),entered.clone(),release.clone());
                    async move {
                        assert_eq!(form["client_id"],PublicConfig::default().native_client_id);
                        assert_eq!(form["grant_type"],"refresh_token");
                        let call=calls.fetch_add(1,Ordering::SeqCst)+1;
                        assert_eq!(form["refresh_token"],format!("fixture-grant-{}",call-1));
                        let mode=mode.load(Ordering::SeqCst);
                        if mode==4 { entered.notify_one(); release.acquire().await.unwrap().forget(); }
                        if mode==1 { return (axum::http::StatusCode::BAD_REQUEST,axum::Json(json!({"error":"invalid_grant"}))).into_response(); }
                        if mode==2 { return (axum::http::StatusCode::BAD_GATEWAY,"unknown rotating outcome").into_response(); }
                        if mode==3 { store.fail_write.store(true,Ordering::SeqCst); }
                        axum::Json(json!({"access_token":"fixture-resource-access","refresh_token":format!("fixture-grant-{call}")})).into_response()
                    }
                }
            }))
            .route("/account",get({let fail=profile_fail.clone(); move || {let fail=fail.clone();async move {
                if fail.load(Ordering::SeqCst) { return axum::http::StatusCode::SERVICE_UNAVAILABLE.into_response(); }
                axum::Json(json!({"id":"fixture-owner","name":"Fixture Person"})).into_response()
            }}}))
            .route("/token/revocation",post(||async{axum::http::StatusCode::SERVICE_UNAVAILABLE}));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        Self {
            dir: tempfile::tempdir().unwrap(),
            store,
            base,
            verifier: Arc::new(Verifier {
                reject: std::sync::atomic::AtomicBool::new(false),
                wrong_subject: std::sync::atomic::AtomicBool::new(false),
            }),
            calls,
            preflight_fail,
            profile_fail,
            mode,
            entered,
            release,
            server,
        }
    }
    fn handle(&self) -> Handle {
        let mut handle = tests::handle(self.dir.path());
        let inner = Arc::get_mut(&mut handle.0).unwrap();
        inner.journal = Some(Journal::new(
            inner.config.clone(),
            inner.config.namespace(self.dir.path()).unwrap(),
            self.store.clone(),
        ));
        inner.restore = Mutex::new(false);
        inner.state.get_mut().snapshot.authorization_status = AuthorizationStatus::Restoring;
        inner.restore_fixture = Some(RestoreFixture {
            base: self.base.clone(),
            verifier: self.verifier.clone(),
        });
        handle
    }
    async fn seed(&self) {
        let handle = self.handle();
        let journal = handle.0.journal.as_ref().unwrap();
        assert!(journal.load().await.unwrap().is_none());
        let id = uuid::Uuid::new_v4().to_string();
        journal.begin(&id).await.unwrap();
        journal
            .checkpoint(
                &id,
                SavedPhase::Ready,
                Some("fixture-grant-0"),
                Some("fixture-owner"),
            )
            .await
            .unwrap();
    }
}

#[tokio::test]
async fn saved_restart_restores_rotated_owner_and_logout_never_restores_after_revoke_failure() {
    let f = Fixture::new().await;
    f.seed().await;
    let first = f.handle();
    assert_eq!(
        first.snapshot().await.authorization_status,
        AuthorizationStatus::Restoring
    );
    first.restore_login().await.unwrap();
    let snapshot = first.snapshot().await;
    assert!(snapshot.signed_in);
    assert_eq!(snapshot.account_label.as_deref(), Some("Fixture Person"));
    assert!(!snapshot.enabled);
    assert!(first.0.state.lock().await.installation.is_none());
    drop(first);
    let second = f.handle();
    second.restore_login().await.unwrap();
    assert_eq!(f.calls.load(Ordering::SeqCst), 4);
    assert!(second.snapshot().await.signed_in);
    assert!(second.logout().await.is_err()); // fixture network revocation fails
    assert!(f.store.bytes.lock().unwrap().is_none());
    let third = f.handle();
    third.restore_login().await.unwrap();
    assert_eq!(
        third.snapshot().await.authorization_status,
        AuthorizationStatus::SignedOut
    );
    assert_eq!(f.calls.load(Ordering::SeqCst), 4);
}

#[tokio::test]
async fn saved_preflight_offline_and_store_locked_are_retryable_without_post_or_deletion() {
    let f = Fixture::new().await;
    f.seed().await;
    let original = f.store.bytes.lock().unwrap().clone();
    f.store.fail_read.store(true, Ordering::SeqCst);
    let h = f.handle();
    assert!(h.restore_login().await.is_err());
    assert_eq!(
        h.snapshot().await.authorization_status,
        AuthorizationStatus::RestoreRetry
    );
    f.store.fail_read.store(false, Ordering::SeqCst);
    f.preflight_fail.store(true, Ordering::SeqCst);
    assert!(h.restore_login().await.is_err());
    assert_eq!(
        h.snapshot().await.authorization_status,
        AuthorizationStatus::RestoreRetry
    );
    assert_eq!(f.calls.load(Ordering::SeqCst), 0);
    assert_eq!(*f.store.bytes.lock().unwrap(), original);
    f.preflight_fail.store(false, Ordering::SeqCst);
    h.restore_login().await.unwrap();
    assert!(h.snapshot().await.signed_in);
}

#[tokio::test]
async fn saved_invalid_identity_cannot_become_signed_in_by_snapshot_or_default_enable() {
    for wrong_subject in [false, true] {
        let f = Fixture::new().await;
        f.seed().await;
        f.verifier.reject.store(!wrong_subject, Ordering::SeqCst);
        f.verifier
            .wrong_subject
            .store(wrong_subject, Ordering::SeqCst);
        let h = f.handle();
        assert!(h.restore_login().await.is_err());
        for _ in 0..3 {
            let snapshot = h.snapshot().await;
            assert!(!snapshot.signed_in);
            assert_eq!(
                snapshot.authorization_status,
                AuthorizationStatus::ReauthRequired
            );
        }
        assert!(h.0.state.lock().await.owner.is_none());
        assert!(h.enable_default().await.is_err());
        let before = f.calls.load(Ordering::SeqCst);
        let restarted = f.handle();
        restarted.restore_login().await.unwrap();
        assert!(!restarted.snapshot().await.signed_in);
        assert_eq!(f.calls.load(Ordering::SeqCst), before);
    }
}

#[tokio::test]
async fn saved_profile_get_failure_does_not_revoke_verified_login_or_publish_subject() {
    let f = Fixture::new().await;
    f.seed().await;
    f.profile_fail.store(true, Ordering::SeqCst);
    let h = f.handle();
    h.restore_login().await.unwrap();
    let snapshot = h.snapshot().await;
    assert!(snapshot.signed_in);
    assert!(snapshot.account_label.is_none());
}

#[tokio::test]
async fn saved_unknown_dispatch_and_invalid_grant_never_replay_after_restart() {
    for mode in [1, 2] {
        let f = Fixture::new().await;
        f.seed().await;
        f.mode.store(mode, Ordering::SeqCst);
        let h = f.handle();
        assert!(h.restore_login().await.is_err());
        assert!(!h.snapshot().await.signed_in);
        let restarted = f.handle();
        restarted.restore_login().await.unwrap();
        assert_eq!(
            restarted.snapshot().await.authorization_status,
            AuthorizationStatus::SignedOut
        );
        assert_eq!(f.calls.load(Ordering::SeqCst), 1);
    }
}

#[tokio::test]
async fn saved_rotation_store_failure_is_fenced_then_repaired_without_replaying_old_grant() {
    let f = Fixture::new().await;
    f.seed().await;
    f.mode.store(3, Ordering::SeqCst);
    let h = f.handle();
    assert!(h.restore_login().await.is_err());
    assert_eq!(
        h.snapshot().await.authorization_status,
        AuthorizationStatus::RestoreRetry
    );
    assert!(!h.snapshot().await.signed_in);
    let persisted: Value =
        serde_json::from_slice(f.store.bytes.lock().unwrap().as_ref().unwrap()).unwrap();
    assert_eq!(persisted["phase"], "pending");
    f.store.fail_write.store(false, Ordering::SeqCst);
    f.mode.store(0, Ordering::SeqCst);
    h.restore_login().await.unwrap();
    assert!(h.snapshot().await.signed_in);
    assert_eq!(f.calls.load(Ordering::SeqCst), 3);
}

#[tokio::test]
async fn saved_schema_config_namespace_and_unknown_fields_are_rejected_before_network() {
    for field in ["schema", "config", "namespace", "unknown"] {
        let f = Fixture::new().await;
        f.seed().await;
        let mut record: Value =
            serde_json::from_slice(f.store.bytes.lock().unwrap().as_ref().unwrap()).unwrap();
        match field {
            "schema" => record["schema"] = json!(2),
            "config" => record["config"]["resource"] = json!("https://other.fixture.invalid/api"),
            "namespace" => record["namespace"] = json!("other-support-namespace"),
            _ => record["unknown"] = json!("private-field"),
        }
        *f.store.bytes.lock().unwrap() = Some(serde_json::to_vec(&record).unwrap());
        let h = f.handle();
        assert!(h.restore_login().await.is_err());
        assert_eq!(
            h.snapshot().await.authorization_status,
            AuthorizationStatus::ReauthRequired
        );
        assert_eq!(f.calls.load(Ordering::SeqCst), 0);
    }
}

#[tokio::test]
async fn saved_logout_delete_failure_is_visible_and_tombstone_survives_restart() {
    let f = Fixture::new().await;
    f.seed().await;
    let h = f.handle();
    h.restore_login().await.unwrap();
    f.store.fail_delete.store(true, Ordering::SeqCst);
    assert!(h.logout().await.is_err());
    let record: Value =
        serde_json::from_slice(f.store.bytes.lock().unwrap().as_ref().unwrap()).unwrap();
    assert_eq!(record["phase"], "retired");
    assert!(record["refresh"].is_null());
    let restarted = f.handle();
    assert!(restarted.restore_login().await.is_err());
    assert!(!restarted.snapshot().await.signed_in);
    f.store.fail_delete.store(false, Ordering::SeqCst);
    restarted.restore_login().await.unwrap();
    assert_eq!(
        restarted.snapshot().await.authorization_status,
        AuthorizationStatus::SignedOut
    );
}

#[tokio::test]
async fn saved_pending_or_unverified_broker_never_restores_or_dispatches() {
    for phase in [SavedPhase::Pending, SavedPhase::Provisional] {
        let f = Fixture::new().await;
        f.seed().await;
        let h = f.handle();
        let journal = h.0.journal.as_ref().unwrap();
        let record = journal.load().await.unwrap().unwrap();
        journal
            .checkpoint(&record.owner, phase, Some("fixture-grant-0"), None)
            .await
            .unwrap();
        let restarted = f.handle();
        assert!(restarted.restore_login().await.is_err());
        assert_eq!(
            restarted.snapshot().await.authorization_status,
            AuthorizationStatus::ReauthRequired
        );
        assert_eq!(f.calls.load(Ordering::SeqCst), 0);
    }
}

#[tokio::test]
async fn saved_logout_during_rotation_fences_late_result_before_delete() {
    let f = Fixture::new().await;
    f.seed().await;
    f.mode.store(4, Ordering::SeqCst);
    let h = f.handle();
    let restore = tokio::spawn({
        let h = h.clone();
        async move { h.restore_login().await }
    });
    tokio::time::timeout(Duration::from_secs(3), f.entered.notified())
        .await
        .unwrap();
    let logout = tokio::spawn({
        let h = h.clone();
        async move { h.logout().await }
    });
    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            let value: Value =
                serde_json::from_slice(f.store.bytes.lock().unwrap().as_ref().unwrap()).unwrap();
            if value["phase"] == "retired" {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    f.release.add_permits(1);
    assert!(restore.await.unwrap().is_err());
    // The fixture rejects revocation, but the rotated grant stays retired and
    // deleted locally, and no unverified owner is ever publicly adopted.
    assert!(logout.await.unwrap().is_err());
    assert!(!h.snapshot().await.signed_in);
    assert!(f.store.bytes.lock().unwrap().is_none());
    let restarted = f.handle();
    restarted.restore_login().await.unwrap();
    assert_eq!(
        restarted.snapshot().await.authorization_status,
        AuthorizationStatus::SignedOut
    );
    assert_eq!(f.calls.load(Ordering::SeqCst), 1);
}

struct BlockingStore {
    memory: saved::MemoryStore,
    block: std::sync::atomic::AtomicBool,
    entered: Notify,
    released: (std::sync::Mutex<bool>, std::sync::Condvar),
}
struct ReleaseOnDrop(Arc<BlockingStore>);
impl Drop for ReleaseOnDrop {
    fn drop(&mut self) {
        *self.0.released.0.lock().unwrap() = true;
        self.0.released.1.notify_all();
    }
}
impl saved::SecretStore for BlockingStore {
    fn read(&self) -> Result<Option<Vec<u8>>> {
        self.memory.read()
    }
    fn write(&self, bytes: &[u8]) -> Result<()> {
        if self.block.swap(false, Ordering::SeqCst) {
            self.entered.notify_one();
            let (lock, cond) = &self.released;
            let mut released = lock.lock().unwrap();
            while !*released {
                released = cond.wait(released).unwrap();
            }
        }
        self.memory.write(bytes)
    }
    fn delete(&self) -> Result<()> {
        self.memory.delete()
    }
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn saved_cancelled_blocking_write_cannot_overwrite_retirement_or_new_owner() {
    let store = Arc::new(BlockingStore {
        memory: Default::default(),
        block: std::sync::atomic::AtomicBool::new(false),
        entered: Notify::new(),
        released: (std::sync::Mutex::new(false), std::sync::Condvar::new()),
    });
    let _release = ReleaseOnDrop(store.clone());
    let journal = Journal::new(
        PublicConfig::default(),
        "fixture-namespace".into(),
        store.clone(),
    );
    journal.load().await.unwrap();
    let owner = uuid::Uuid::new_v4().to_string();
    journal.begin(&owner).await.unwrap();
    store.block.store(true, Ordering::SeqCst);
    let write = tokio::spawn({
        let journal = journal.clone();
        let owner = owner.clone();
        async move {
            journal
                .checkpoint(
                    &owner,
                    SavedPhase::Ready,
                    Some("fixture-old-grant"),
                    Some("fixture-owner"),
                )
                .await
        }
    });
    tokio::time::timeout(Duration::from_secs(3), store.entered.notified())
        .await
        .unwrap();
    write.abort();
    let retire = tokio::spawn({
        let journal = journal.clone();
        async move { journal.retire().await }
    });
    // Retire is allowed to queue behind the still-running blocking write, but
    // the old async future no longer owns the state mutex. Releasing the real
    // I/O latch verifies the independent blocking serialization boundary.
    tokio::task::yield_now().await;
    *store.released.0.lock().unwrap() = true;
    store.released.1.notify_all();
    tokio::time::timeout(Duration::from_secs(3), retire)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    let record: Value =
        serde_json::from_slice(store.memory.bytes.lock().unwrap().as_ref().unwrap()).unwrap();
    assert_eq!(record["phase"], "retired");
    assert!(record["refresh"].is_null());
    journal.delete().await.unwrap();
    let next = uuid::Uuid::new_v4().to_string();
    journal.begin(&next).await.unwrap();
    assert!(
        journal
            .checkpoint(
                &owner,
                SavedPhase::Ready,
                Some("fixture-old-grant"),
                Some("fixture-owner")
            )
            .await
            .is_err()
    );
    let record: Value =
        serde_json::from_slice(store.memory.bytes.lock().unwrap().as_ref().unwrap()).unwrap();
    assert_eq!(record["owner"], next);
    assert_eq!(record["phase"], "provisional");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn saved_blocked_store_times_out_to_retry_before_any_rotating_post() {
    let f = Fixture::new().await;
    f.seed().await;
    let store = Arc::new(BlockingStore {
        memory: Default::default(),
        block: std::sync::atomic::AtomicBool::new(true),
        entered: Notify::new(),
        released: (std::sync::Mutex::new(false), std::sync::Condvar::new()),
    });
    let _release = ReleaseOnDrop(store.clone());
    *store.memory.bytes.lock().unwrap() = f.store.bytes.lock().unwrap().clone();
    let mut h = f.handle();
    let inner = Arc::get_mut(&mut h.0).unwrap();
    let mut journal = Journal::new(
        inner.config.clone(),
        inner.config.namespace(f.dir.path()).unwrap(),
        store.clone(),
    );
    Arc::get_mut(&mut journal).unwrap().timeout = Duration::from_millis(150);
    inner.journal = Some(journal);
    let result = h.restore_login().await;
    // Release the owned latch even when the assertion below reports a failure.
    *store.released.0.lock().unwrap() = true;
    store.released.1.notify_all();
    assert!(result.is_err());
    assert_eq!(
        h.snapshot().await.authorization_status,
        AuthorizationStatus::RestoreRetry
    );
    assert_eq!(f.calls.load(Ordering::SeqCst), 0);
    h.restore_login().await.unwrap();
    assert!(h.snapshot().await.signed_in);
    assert_eq!(f.calls.load(Ordering::SeqCst), 2);
}
