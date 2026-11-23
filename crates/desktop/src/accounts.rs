//! Native account lifecycle. This module owns all refresh operations and uses
//! CyberBus only as the encrypted device network beneath AnyWork's gateway.
use crate::{
    config,
    device_name::{load_device_name, normalized_device_name, save_device_name, valid_device_name},
    manager,
};
use anyhow::{Result, bail};
use anywork_cyberbus::{
    DEFAULT_SERVICE_PORT, Locator, NetworkVerifier, Overlay, OverlayConfig, RealClock,
};
use anywork_remote::{AccountVerifier, Gateway, GatewayConfig, JwtVerifier, RemoteClient};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, path::PathBuf, sync::Arc, time::Duration};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    sync::{Mutex, Notify},
};
use tokio_util::sync::CancellationToken;

#[path = "accounts_saved.rs"]
mod saved;
use saved::{Journal, Phase as SavedPhase};
#[path = "accounts_restore.rs"]
mod restore;
#[cfg(test)]
use restore::RestoreFixture;

const CALLBACK: &str = "http://127.0.0.1:17897/callback";
const LOCATOR_LIFETIME_SECONDS: u64 = 600;
// Fixed diagnostics only. Provider errors can contain credentials/URLs and are
// deliberately discarded at the boundary rather than formatted or logged.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum EnableStage {
    SignInRequired,
    ReauthRequired,
    LocalService,
    LocalServiceUpgrade,
    CleanupPending,
    Cancelled,
    AlreadyEnabled,
    Identity,
    Gateway,
    NetworkToken,
    NetworkStart,
    IndexToken,
    IndexRead,
    IndexSchema,
    IndexWrite,
    IndexReadback,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    pub(super) fn handle(support: &std::path::Path) -> Handle {
        Handle::new(
            support.to_path_buf(),
            manager::Handle::preview(manager::Snapshot::new(
                config::Config::default(),
                String::new(),
            )),
            false,
        )
        .unwrap()
    }

    pub(super) fn transaction() -> Arc<Transaction> {
        Arc::new(Transaction {
            id: "test-login".into(),
            expected_state: Mutex::new(None),
            callback: Mutex::new(None),
            notify: Notify::new(),
            stop: CancellationToken::new(),
            operation: Mutex::new(()),
            latest: Mutex::new(None),
            uncertain: std::sync::atomic::AtomicBool::new(false),
        })
    }

    async fn provider(unknown: bool) -> (Arc<GrantOwner>, Arc<AtomicUsize>) {
        let calls = Arc::new(AtomicUsize::new(0));
        let server_calls = calls.clone();
        let latest = Arc::new(Mutex::new("initial-ram-grant".to_string()));
        let app = axum::Router::new().route(
            "/token",
            axum::routing::post(
                move |axum::Form(form): axum::Form<std::collections::HashMap<String, String>>| {
                    let latest = latest.clone();
                    let calls = server_calls.clone();
                    async move {
                        let mut latest = latest.lock().await;
                        assert_eq!(form.get("refresh_token"), Some(&*latest));
                        let n = calls.fetch_add(1, Ordering::SeqCst) + 1;
                        *latest = format!("rotated-ram-{n}");
                        if unknown {
                            (axum::http::StatusCode::BAD_GATEWAY, "response lost".into())
                        } else {
                            (
                                axum::http::StatusCode::OK,
                                json!({"access_token":"test-access","refresh_token":latest.clone()})
                                    .to_string(),
                            )
                        }
                    }
                },
            ),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        (
            Arc::new(
                GrantOwner::new(Grant {
                    config: PublicConfig {
                        issuer: format!("http://127.0.0.1:{port}"),
                        ..Default::default()
                    },
                    refresh: "initial-ram-grant".into(),
                    subject: "test-owner".into(),
                })
                .unwrap(),
            ),
            calls,
        )
    }

    #[test]
    fn public_configuration_defaults_to_cyberbus_and_validates_every_endpoint() {
        let dir = tempfile::tempdir().unwrap();
        let defaults = PublicConfig::load(dir.path()).unwrap();
        assert_eq!(defaults.resource, "https://cyberbus.x.aixgg.com/api");
        assert_eq!(defaults.product_id, "anywork");
        assert_eq!(defaults.bootstrap_peers, vec!["tcp://43.155.169.102:11010"]);
        assert!(defaults.validate().is_ok());
        let expected = defaults.namespace(dir.path()).unwrap();
        for field in [
            "endpoint",
            "issuer",
            "nativeClientId",
            "spaClientId",
            "resource",
            "productId",
            "frontendOrigin",
        ] {
            let mut modified = serde_json::to_value(&defaults).unwrap();
            modified[field] = json!(format!("{}-different", modified[field].as_str().unwrap()));
            let changed: PublicConfig = serde_json::from_value(modified).unwrap();
            assert_ne!(changed.namespace(dir.path()).unwrap(), expected, "{field}");
        }
        let mut changed = defaults.clone();
        changed.bootstrap_peers.push("tls://peer.invalid:1".into());
        assert!(changed.validate().is_err());
        let mut changed = defaults;
        changed.endpoint = "http://remote.invalid".into();
        assert!(changed.validate().is_err());
    }

    #[tokio::test]
    async fn directory_record_and_short_lived_locator_preserve_unrelated_data() {
        let dir = tempfile::tempdir().unwrap();
        let i = handle(dir.path()).installation("owner").await.unwrap();
        let mut data = json!({
            "otherApp":{"keep":true},
            "anywork":{
                "schemaVersion":1,
                "preferences":{"appearance":"dark"},
                "devices":{}
            }
        });
        update_device_index(&mut data, &i, Some(("10.144.5.6", 11_001, 100, 700))).unwrap();
        assert_eq!(data["anywork"]["devices"][&i.id]["keyVersion"], 1);
        assert_eq!(
            data["anywork"]["devices"][&i.id]
                .as_object()
                .unwrap()
                .keys()
                .cloned()
                .collect::<std::collections::BTreeSet<_>>(),
            ["keyVersion", "label", "platform", "publicKey"]
                .into_iter()
                .map(str::to_string)
                .collect()
        );
        let locator = &data["anywork"]["cyberbus"][&i.id];
        assert_eq!(locator["version"], 1);
        assert_eq!(locator["productId"], "anywork");
        assert_eq!(locator["ipv4"], "10.144.5.6");
        assert_eq!(locator["port"], 11_001);
        assert_eq!(locator["keyVersion"], 1);
        assert_eq!(locator["issuedAt"], 100);
        assert_eq!(locator["expiresAt"], 700);
        assert_eq!(data["otherApp"], json!({"keep":true}));
        assert_eq!(data["anywork"]["preferences"], json!({"appearance":"dark"}));
        remove_device_locator(&mut data, &i.id).unwrap();
        assert!(data["anywork"]["cyberbus"].get(&i.id).is_none());
        assert_eq!(data["anywork"]["devices"][&i.id]["keyVersion"], 1);
    }

    #[test]
    fn directory_rejects_control_port_out_of_pool_and_oversized_locator() {
        let dir = tempfile::tempdir().unwrap();
        let runtime = tokio::runtime::Runtime::new().unwrap();
        let i = runtime
            .block_on(handle(dir.path()).installation("owner"))
            .unwrap();
        for (ipv4, port, issued, expires) in [
            ("10.144.5.6", 11_000, 100, 700),
            ("10.145.5.6", 11_001, 100, 700),
            ("10.144.5.6", 11_001, 700, 100),
            ("10.144.5.6", 11_001, 100, 100 + 86_401),
        ] {
            let mut data = json!({"anywork":{"schemaVersion":1,"devices":{}}});
            assert!(
                update_device_index(&mut data, &i, Some((ipv4, port, issued, expires))).is_err()
            );
        }
    }

    #[test]
    fn device_key_version_increments_and_exhaustion_fails_closed() {
        let dir = tempfile::tempdir().unwrap();
        let runtime = tokio::runtime::Runtime::new().unwrap();
        let i1 = runtime
            .block_on(handle(dir.path()).installation("owner"))
            .unwrap();
        let mut data = json!({"anywork":{"schemaVersion":1,"devices":{}}});
        update_device_index(&mut data, &i1, None).unwrap();
        assert_eq!(data["anywork"]["devices"][&i1.id]["keyVersion"], 1);
        data["anywork"]["devices"][&i1.id]["label"] = json!("办公电脑");
        let i2 = runtime
            .block_on(handle(dir.path()).installation("owner"))
            .unwrap();
        update_device_index(&mut data, &i2, None).unwrap();
        assert_eq!(data["anywork"]["devices"].as_object().unwrap().len(), 1);
        assert_eq!(data["anywork"]["devices"][&i1.id]["keyVersion"], 2);
        assert_eq!(data["anywork"]["devices"][&i1.id]["label"], "办公电脑");
        let mut exhausted = data["anywork"]["devices"][&i1.id].clone();
        exhausted["keyVersion"] = json!(9_007_199_254_740_991u64);
        assert!(device_record(&exhausted, &i1).is_err());
        exhausted["keyVersion"] = json!(0);
        assert!(device_record(&exhausted, &i2).is_err());
    }

    #[tokio::test]
    async fn one_ram_owner_serializes_account_and_resource_rotation() {
        let (owner, calls) = provider(false).await;
        let mut tasks = Vec::new();
        for n in 0..8 {
            let owner = owner.clone();
            tasks.push(tokio::spawn(async move {
                owner.token(n % 2 == 0).await.unwrap()
            }));
        }
        for task in tasks {
            assert_eq!(task.await.unwrap(), "test-access");
        }
        assert_eq!(calls.load(Ordering::SeqCst), 8);
        assert_eq!(owner.state.lock().await.grant.refresh, "rotated-ram-8");
    }

    #[tokio::test]
    async fn unknown_rotation_never_replays_last_known_ram_grant() {
        let (owner, calls) = provider(true).await;
        assert!(owner.token(true).await.is_err());
        assert!(owner.state.lock().await.uncertain);
        assert!(owner.token(false).await.is_err());
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn enable_stage_codes_discard_underlying_errors_before_ipc() {
        for (stage, code) in [
            (
                EnableStage::SignInRequired,
                "REMOTE_ENABLE_SIGN_IN_REQUIRED",
            ),
            (EnableStage::ReauthRequired, "REMOTE_ENABLE_REAUTH_REQUIRED"),
            (EnableStage::LocalService, "REMOTE_ENABLE_LOCAL_SERVICE"),
            (
                EnableStage::LocalServiceUpgrade,
                "REMOTE_ENABLE_LOCAL_SERVICE_UPGRADE",
            ),
            (EnableStage::CleanupPending, "REMOTE_ENABLE_CLEANUP_PENDING"),
            (EnableStage::Cancelled, "REMOTE_ENABLE_CANCELLED"),
            (EnableStage::AlreadyEnabled, "REMOTE_ENABLE_ALREADY_ENABLED"),
            (EnableStage::Identity, "REMOTE_ENABLE_IDENTITY"),
            (EnableStage::Gateway, "REMOTE_ENABLE_GATEWAY"),
            (EnableStage::NetworkToken, "REMOTE_ENABLE_NETWORK_TOKEN"),
            (EnableStage::NetworkStart, "REMOTE_ENABLE_NETWORK_START"),
            (EnableStage::IndexToken, "REMOTE_ENABLE_INDEX_TOKEN"),
            (EnableStage::IndexRead, "REMOTE_ENABLE_INDEX_READ"),
            (EnableStage::IndexSchema, "REMOTE_ENABLE_INDEX_SCHEMA"),
            (EnableStage::IndexWrite, "REMOTE_ENABLE_INDEX_WRITE"),
            (EnableStage::IndexReadback, "REMOTE_ENABLE_INDEX_READBACK"),
        ] {
            let error = stage
                .at::<(), _>(Err("https://private.invalid/?token=never-display"))
                .unwrap_err();
            assert_eq!(error.chain().count(), 1);
            assert_eq!(safe_error(error), code);
        }
        let generic = safe_error(anyhow::anyhow!(
            "https://private.invalid/?token=never-display"
        ));
        assert!(!generic.contains("private.invalid") && !generic.contains("never-display"));
    }

    #[tokio::test]
    async fn actual_locator_index_failures_have_specific_safe_stages_without_retries() {
        for stage in [
            EnableStage::IndexToken,
            EnableStage::IndexRead,
            EnableStage::IndexSchema,
            EnableStage::IndexWrite,
            EnableStage::IndexReadback,
        ] {
            let reads = Arc::new(AtomicUsize::new(0));
            let writes = Arc::new(AtomicUsize::new(0));
            let tokens = Arc::new(AtomicUsize::new(0));
            let (get_reads, patch_writes, token_calls) =
                (reads.clone(), writes.clone(), tokens.clone());
            let app = axum::Router::new()
                .route(
                    "/oidc/token",
                    axum::routing::post(move || {
                        let calls = token_calls.clone();
                        async move {
                            calls.fetch_add(1, Ordering::SeqCst);
                            if stage == EnableStage::IndexToken {
                                (
                                    axum::http::StatusCode::BAD_GATEWAY,
                                    "private provider body".to_owned(),
                                )
                            } else {
                                (
                                    axum::http::StatusCode::OK,
                                    json!({"access_token":"sample-access","refresh_token":"sample-rotated"})
                                        .to_string(),
                                )
                            }
                        }
                    }),
                )
                .route(
                    "/api/my-account",
                    axum::routing::get(move || {
                        let calls = get_reads.clone();
                        async move {
                            calls.fetch_add(1, Ordering::SeqCst);
                            if stage == EnableStage::IndexRead {
                                (
                                    axum::http::StatusCode::BAD_GATEWAY,
                                    "private read body".to_owned(),
                                )
                            } else {
                                let data = if stage == EnableStage::IndexSchema {
                                    json!({"anywork":{"schemaVersion":2,"devices":{}}})
                                } else {
                                    json!({})
                                };
                                (
                                    axum::http::StatusCode::OK,
                                    json!({"id":"sample-owner","customData":data}).to_string(),
                                )
                            }
                        }
                    })
                    .patch(move || {
                        let calls = patch_writes.clone();
                        async move {
                            calls.fetch_add(1, Ordering::SeqCst);
                            let status = if stage == EnableStage::IndexWrite {
                                axum::http::StatusCode::BAD_GATEWAY
                            } else {
                                axum::http::StatusCode::OK
                            };
                            (status, "{}")
                        }
                    }),
                );
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let port = listener.local_addr().unwrap().port();
            let server = tokio::spawn(async move {
                let _ = axum::serve(listener, app).await;
            });
            let dir = tempfile::tempdir().unwrap();
            let mut h = handle(dir.path());
            let config = &mut Arc::get_mut(&mut h.0).unwrap().config;
            config.endpoint = format!("http://127.0.0.1:{port}");
            config.issuer = format!("{}/oidc", config.endpoint);
            let owner = Arc::new(
                GrantOwner::new(Grant {
                    config: h.0.config.clone(),
                    refresh: "sample-initial".into(),
                    subject: "sample-owner".into(),
                })
                .unwrap(),
            );
            let installation = h.installation("sample-owner").await.unwrap();
            assert_eq!(
                safe_error(
                    h.publish_index(&owner, &installation, Some(("10.144.1.2", 11_001)))
                        .await
                        .unwrap_err()
                ),
                stage.code()
            );
            assert_eq!(tokens.load(Ordering::SeqCst), 1);
            assert_eq!(
                reads.load(Ordering::SeqCst),
                match stage {
                    EnableStage::IndexToken => 0,
                    EnableStage::IndexReadback => 2,
                    _ => 1,
                }
            );
            assert_eq!(
                writes.load(Ordering::SeqCst),
                usize::from(matches!(
                    stage,
                    EnableStage::IndexWrite | EnableStage::IndexReadback
                ))
            );
            server.abort();
        }
    }

    #[test]
    fn account_label_uses_trusted_profile_and_never_an_opaque_id() {
        assert_eq!(
            account_label(&json!({"primaryEmail":"person@example.org","username":"name"})),
            "name"
        );
        assert_eq!(
            account_label(&json!({"profile":{"name":"显示名"}})),
            "显示名"
        );
        assert_eq!(account_label(&json!({"id":"opaque-subject"})), "已登录账号");
    }
}
impl EnableStage {
    fn code(self) -> &'static str {
        match self {
            Self::SignInRequired => "REMOTE_ENABLE_SIGN_IN_REQUIRED",
            Self::ReauthRequired => "REMOTE_ENABLE_REAUTH_REQUIRED",
            Self::LocalService => "REMOTE_ENABLE_LOCAL_SERVICE",
            Self::LocalServiceUpgrade => "REMOTE_ENABLE_LOCAL_SERVICE_UPGRADE",
            Self::CleanupPending => "REMOTE_ENABLE_CLEANUP_PENDING",
            Self::Cancelled => "REMOTE_ENABLE_CANCELLED",
            Self::AlreadyEnabled => "REMOTE_ENABLE_ALREADY_ENABLED",
            Self::Identity => "REMOTE_ENABLE_IDENTITY",
            Self::Gateway => "REMOTE_ENABLE_GATEWAY",
            Self::NetworkToken => "REMOTE_ENABLE_NETWORK_TOKEN",
            Self::NetworkStart => "REMOTE_ENABLE_NETWORK_START",
            Self::IndexToken => "REMOTE_ENABLE_INDEX_TOKEN",
            Self::IndexRead => "REMOTE_ENABLE_INDEX_READ",
            Self::IndexSchema => "REMOTE_ENABLE_INDEX_SCHEMA",
            Self::IndexWrite => "REMOTE_ENABLE_INDEX_WRITE",
            Self::IndexReadback => "REMOTE_ENABLE_INDEX_READBACK",
        }
    }
    fn at<T, E>(self, result: std::result::Result<T, E>) -> Result<T> {
        result.map_err(|_| anyhow::Error::new(self))
    }
}
impl std::fmt::Display for EnableStage {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.code())
    }
}
impl std::error::Error for EnableStage {}
// Only configuration failures gain structured, fixed diagnostics. Other IPC
// errors retain the exact safe stage string accepted by existing renderers.
#[derive(Serialize)]
#[serde(untagged)]
pub enum AccountActionError {
    Code(String),
}
fn action_error(error: anyhow::Error) -> AccountActionError {
    AccountActionError::Code(safe_error(error))
}

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PublicConfig {
    pub endpoint: String,
    pub issuer: String,
    pub native_client_id: String,
    pub spa_client_id: String,
    pub resource: String,
    pub product_id: String,
    #[serde(default)]
    pub bootstrap_peers: Vec<String>,
    pub frontend_origin: String,
}
impl Default for PublicConfig {
    fn default() -> Self {
        Self {
            endpoint: "https://auth.x.aixgg.com".into(),
            issuer: "https://auth.x.aixgg.com/oidc".into(),
            native_client_id: "x7lzj58abb1sdp16lkd34".into(),
            spa_client_id: "5ere2kbu9mugfu3xd8e90".into(),
            resource: "https://cyberbus.x.aixgg.com/api".into(),
            product_id: "anywork".into(),
            bootstrap_peers: vec!["tcp://43.155.169.102:11010".into()],
            frontend_origin: "https://anywork.aixgg.com".into(),
        }
    }
}
impl PublicConfig {
    fn load(support: &std::path::Path) -> Result<Self> {
        let path = support.join("account-cloud.json");
        let config = if path.exists() {
            let bytes = std::fs::read(path)?;
            if bytes.len() > 8192 {
                bail!("INVALID_ACCOUNT_CONFIG")
            }
            serde_json::from_slice(&bytes)?
        } else {
            Self::default()
        };
        config.validate()?;
        Ok(config)
    }
    fn namespace(&self, support: &std::path::Path) -> Result<String> {
        let mut binding = serde_json::to_vec(self)?;
        binding.push(0);
        binding.extend_from_slice(support.as_os_str().as_encoded_bytes());
        Ok(format!("account-{:x}", Sha256::digest(&binding)))
    }
    fn validate(&self) -> Result<()> {
        for value in [&self.endpoint, &self.issuer, &self.resource] {
            let u = url::Url::parse(value)?;
            if u.scheme() != "https"
                || u.host_str().is_none()
                || !u.username().is_empty()
                || u.password().is_some()
                || u.query().is_some()
                || u.fragment().is_some()
            {
                bail!("INVALID_ACCOUNT_CONFIG")
            }
        }
        let origin = url::Url::parse(&self.frontend_origin)?;
        if origin.origin().ascii_serialization() != self.frontend_origin
            || (origin.scheme() != "https"
                && !(origin.scheme() == "http"
                    && matches!(origin.host_str(), Some("127.0.0.1" | "localhost"))))
        {
            bail!("INVALID_ACCOUNT_CONFIG")
        }
        if self.issuer != format!("{}/oidc", self.endpoint.trim_end_matches('/'))
            || self.native_client_id.is_empty()
            || self.spa_client_id.is_empty()
            || self.product_id.is_empty()
            || self.product_id.len() > 64
            || self.bootstrap_peers.len() > 64
            || self.bootstrap_peers.iter().any(|peer| {
                let Ok(url) = url::Url::parse(peer) else {
                    return true;
                };
                !matches!(url.scheme(), "tcp" | "udp" | "ws" | "wss")
                    || url.host_str().is_none()
                    || url.port_or_known_default().is_none()
                    || !url.username().is_empty()
                    || url.password().is_some()
                    || url.query().is_some()
                    || url.fragment().is_some()
            })
        {
            bail!("INVALID_ACCOUNT_CONFIG")
        };
        Ok(())
    }
}
#[derive(Default, Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AuthorizationStatus {
    #[default]
    SignedOut,
    Restoring,
    RestoreRetry,
    Authorizing,
    LoginInterrupted,
    SignedIn,
    ReauthRequired,
}
#[derive(Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub authorization_status: AuthorizationStatus,
    pub transaction_id: Option<String>,
    pub signed_in: bool,
    pub subject: Option<String>,
    pub account_label: Option<String>,
    pub device_name: String,
    pub device_name_synced: bool,
    pub enabled: bool,
    pub busy: bool,
    pub error: Option<String>,
    pub installation_id: Option<String>,
    pub public_key: Option<String>,
    pub remote_clients: Vec<RemoteClient>,
    pub account_portal_url: String,
}
#[derive(Clone)]
struct Grant {
    config: PublicConfig,
    refresh: String,
    subject: String,
}
#[derive(Clone)]
struct Installation {
    config: PublicConfig,
    subject: String,
    id: String,
    private_key: String,
    public_key: String,
    name: String,
}
struct GrantState {
    grant: Grant,
    invalid: bool,
    // A provider exchange may have rotated the grant, but its outcome is unknown.
    uncertain: bool,
    save_pending: bool,
}
// Independent of the refresh mutex: closing access must fence an enable even
// while its sole OAuth exchange is awaiting a response. Never cancel that exchange.
#[derive(Default)]
struct RemotePolicy {
    consumed: bool,
    manual_off: bool,
    logged_out: bool,
    generation: Arc<()>,
    stop: CancellationToken,
}
impl RemotePolicy {
    fn invalidate(&mut self, logout: bool) {
        self.consumed = true;
        self.manual_off = true;
        self.logged_out |= logout;
        self.stop.cancel();
        self.stop = CancellationToken::new();
        self.generation = Arc::new(());
    }
    fn check(&self, generation: &Arc<()>) -> Result<()> {
        if self.logged_out || !Arc::ptr_eq(&self.generation, generation) {
            bail!("REMOTE_OPERATION_CANCELLED")
        }
        Ok(())
    }
    fn claim(&mut self, generation: &Arc<()>, default: bool, enabled: bool) -> Result<bool> {
        self.check(generation)?;
        if default && (self.consumed || self.manual_off || enabled) {
            return Ok(false);
        }
        if enabled {
            bail!("REMOTE_ALREADY_ENABLED")
        }
        self.consumed = true;
        if !default {
            self.manual_off = false;
        }
        Ok(true)
    }
}
struct GrantOwner {
    remote_policy: std::sync::Mutex<RemotePolicy>,
    state: Mutex<GrantState>,
    http: reqwest::Client,
    saved: Option<(Arc<Journal>, String)>,
    #[cfg(test)]
    token_endpoint: Option<String>,
}
impl GrantOwner {
    fn new(grant: Grant) -> Result<Self> {
        Ok(Self {
            remote_policy: std::sync::Mutex::new(RemotePolicy::default()),
            state: Mutex::new(GrantState {
                grant,
                invalid: false,
                uncertain: false,
                save_pending: false,
            }),
            http: client()?,
            saved: None,
            #[cfg(test)]
            token_endpoint: None,
        })
    }
    async fn checkpoint(&self, state: &GrantState, phase: SavedPhase) -> Result<()> {
        if let Some((journal, owner)) = &self.saved {
            journal
                .checkpoint(
                    owner,
                    phase,
                    Some(&state.grant.refresh),
                    Some(&state.grant.subject),
                )
                .await?;
        }
        Ok(())
    }
    fn policy(&self) -> std::sync::MutexGuard<'_, RemotePolicy> {
        self.remote_policy.lock().unwrap_or_else(|e| e.into_inner())
    }
    fn token_endpoint(&self, config: &PublicConfig) -> String {
        #[cfg(test)]
        if let Some(endpoint) = &self.token_endpoint {
            return endpoint.clone();
        }
        format!("{}/token", config.issuer)
    }
    async fn revoke(&self) -> Result<()> {
        let state = self.state.lock().await;
        Handle::revoke_at(
            &self.http,
            &format!("{}/revocation", self.token_endpoint(&state.grant.config)),
            &state.grant.config.native_client_id,
            &state.grant.refresh,
        )
        .await
    }
    async fn token(&self, resource: bool) -> Result<String> {
        let mut state = self.state.lock().await;
        self.refresh(&mut state, resource).await
    }
    async fn recover_storage(&self) -> Result<()> {
        let mut state = self.state.lock().await;
        if state.save_pending {
            self.checkpoint(&state, SavedPhase::Ready).await?;
            state.save_pending = false;
            state.uncertain = false;
        }
        Ok(())
    }
    async fn refresh(&self, state: &mut GrantState, resource: bool) -> Result<String> {
        if state.invalid || state.uncertain {
            bail!("ACCOUNT_REAUTH_REQUIRED")
        }
        let config = state.grant.config.clone();
        let mut form = vec![
            ("grant_type", "refresh_token".to_string()),
            ("client_id", config.native_client_id.clone()),
            ("refresh_token", state.grant.refresh.clone()),
        ];
        if resource {
            form.push(("resource", config.resource.clone()));
        }
        // Persist uncertainty BEFORE dispatch. A new process must never replay
        // a grant whose rotating POST may already have reached the provider.
        self.checkpoint(state, SavedPhase::Pending).await?;
        state.uncertain = true;
        let endpoint = self.token_endpoint(&config);
        let response = match self.http.post(endpoint).form(&form).send().await {
            Ok(response) => response,
            Err(error) if error.is_connect() => {
                // A connect failure happens before HTTP dispatch. Re-checkpoint
                // the still-current grant; other outcomes remain pending.
                self.checkpoint(state, SavedPhase::Ready).await?;
                state.uncertain = false;
                return Err(anyhow::anyhow!("ACCOUNT_RESTORE_NETWORK"));
            }
            Err(_) => bail!("ACCOUNT_REAUTH_REQUIRED"),
        };
        let successful = response.status().is_success();
        let bytes = bounded(response).await?;
        let value: Value = serde_json::from_slice(&bytes)?;
        // Capture a rotated grant before validating the rest of the response.
        // Even an invalid provider response must never strand its newest grant.
        let rotated = value["refresh_token"].as_str().filter(|s| !s.is_empty());
        let access = value["access_token"].as_str().filter(|s| !s.is_empty());
        if let Some(refresh) = rotated {
            state.grant.refresh = refresh.into();
        }
        // A parsed successful token response without rotation confirms the old
        // grant remains current. Otherwise only a returned rotation is known.
        if rotated.is_some() || (successful && value.get("error").is_none() && access.is_some()) {
            // Store failure leaves the disk pending and this RAM owner fenced.
            state.save_pending = true;
            self.checkpoint(state, SavedPhase::Ready).await?;
            state.save_pending = false;
            state.uncertain = false;
        }
        if !successful || value.get("error").is_some() {
            if value["error"] == "invalid_grant" {
                state.invalid = true;
                if let Some((journal, _)) = &self.saved {
                    journal.retire().await?;
                }
            }
            bail!("ACCOUNT_REAUTH_REQUIRED")
        }
        value["access_token"]
            .as_str()
            .filter(|v| !v.is_empty())
            .map(str::to_owned)
            .ok_or_else(|| anyhow::anyhow!("ACCOUNT_TOKEN_REJECTED"))
    }
}

fn profile_text(account: &Value, keys: &[&str]) -> Option<String> {
    // Account API responses from supported Logto versions may expose profile
    // attributes at the top level or under `profile`. Both arrive from the
    // authenticated provider, never from an unverified renderer display string.
    keys.iter()
        .find_map(|key| {
            [
                account.get(*key),
                account.get("profile").and_then(|p| p.get(*key)),
            ]
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(str::trim)
            .find(|v| !v.is_empty() && v.chars().count() <= 160 && !v.chars().any(char::is_control))
        })
        .map(str::to_owned)
}
fn profile_label(account: &Value) -> Option<String> {
    profile_text(account, &["name", "username", "primaryEmail", "email"])
}
fn account_label(account: &Value) -> String {
    profile_label(account).unwrap_or_else(|| "已登录账号".into())
}
fn directory_name(account: &Value, id: &str) -> Option<String> {
    if account["customData"]["anywork"]["schemaVersion"] != 1 {
        return None;
    }
    account["customData"]["anywork"]["devices"][id]["label"]
        .as_str()
        .filter(|v| valid_device_name(v))
        .map(str::to_owned)
}
fn public_installation_id(
    support: &std::path::Path,
    config: &PublicConfig,
    subject: &str,
) -> Result<String> {
    #[derive(Serialize, Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct PublicIdentity {
        installation_id: String,
    }
    let directory = support.join("account-installations");
    if std::fs::symlink_metadata(&directory).is_ok_and(|m| m.file_type().is_symlink()) {
        bail!("INSTALLATION_ID_REJECTED")
    }
    let path_for = |config: &PublicConfig| -> Result<PathBuf> {
        let binding = format!("{}\0{subject}", config.namespace(support)?);
        Ok(directory.join(format!("{:x}.json", Sha256::digest(binding.as_bytes()))))
    };
    let read_id = |path: &std::path::Path| -> Result<Option<String>> {
        match std::fs::symlink_metadata(path) {
            Ok(metadata) => {
                if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > 128
                {
                    bail!("INSTALLATION_ID_REJECTED")
                }
                let id = serde_json::from_slice::<PublicIdentity>(&std::fs::read(path)?)?
                    .installation_id;
                uuid::Uuid::parse_str(&id)
                    .map_err(|_| anyhow::anyhow!("INSTALLATION_ID_REJECTED"))?;
                Ok(Some(id))
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error.into()),
        }
    };
    let path = path_for(config)?;
    if let Some(id) = read_id(&path)? {
        return Ok(id);
    }
    let id = uuid::Uuid::new_v4().to_string();
    config::atomic_private(
        &path,
        &serde_json::to_vec(&PublicIdentity {
            installation_id: id.clone(),
        })?,
    )?;
    Ok(id)
}
fn update_device_index(
    data: &mut Value,
    i: &Installation,
    locator: Option<(&str, u16, u64, u64)>,
) -> Result<()> {
    if !data.is_object() {
        bail!("ACCOUNT_DATA_REJECTED")
    };
    if data.get("anywork").is_none() {
        data["anywork"] = json!({"schemaVersion":1,"preferences":{},"devices":{}})
    };
    if data["anywork"]["schemaVersion"] != 1 || !data["anywork"]["devices"].is_object() {
        bail!("ACCOUNT_SCHEMA_REJECTED")
    };
    if data["anywork"]["devices"].as_object().unwrap().len() >= 32
        && data["anywork"]["devices"].get(&i.id).is_none()
    {
        bail!("ACCOUNT_DEVICE_LIMIT")
    };
    let record = device_record(&data["anywork"]["devices"][&i.id], i)?;
    let key_version = record["keyVersion"]
        .as_u64()
        .ok_or_else(|| anyhow::anyhow!("ACCOUNT_DEVICE_RECORD_REJECTED"))?;
    data["anywork"]["devices"][&i.id] = record;
    if let Some((ipv4, port, issued_at, expires_at)) = locator {
        let ipv4 = ipv4
            .parse()
            .map_err(|_| anyhow::anyhow!("DEVICE_LOCATOR_REJECTED"))?;
        let locator = Locator::new(
            i.config.product_id.clone(),
            ipv4,
            port,
            key_version,
            issued_at,
            expires_at,
        )
        .map_err(|_| anyhow::anyhow!("DEVICE_LOCATOR_REJECTED"))?;
        if !data["anywork"]["cyberbus"].is_object() {
            data["anywork"]["cyberbus"] = json!({});
        }
        data["anywork"]["cyberbus"][&i.id] = serde_json::to_value(locator)?;
    }
    if serde_json::to_vec(&data)?.len() > 32768 {
        bail!("ACCOUNT_DATA_LIMIT")
    };
    Ok(())
}
fn remove_device_locator(data: &mut Value, installation_id: &str) -> Result<()> {
    let Some(locators) = data
        .get_mut("anywork")
        .and_then(|value| value.get_mut("cyberbus"))
        .and_then(Value::as_object_mut)
    else {
        return Ok(());
    };
    locators.remove(installation_id);
    Ok(())
}
fn device_record(existing: &Value, installation: &Installation) -> Result<Value> {
    let version = if existing.is_null() {
        1
    } else {
        let previous = existing["keyVersion"]
            .as_u64()
            .filter(|v| *v > 0 && *v <= 9_007_199_254_740_991)
            .ok_or_else(|| anyhow::anyhow!("ACCOUNT_DEVICE_RECORD_REJECTED"))?;
        if existing["publicKey"].as_str() == Some(installation.public_key.as_str()) {
            previous
        } else {
            previous
                .checked_add(1)
                .filter(|v| *v <= 9_007_199_254_740_991)
                .ok_or_else(|| anyhow::anyhow!("ACCOUNT_KEY_VERSION_EXHAUSTED"))?
        }
    };
    let label = existing["label"]
        .as_str()
        .filter(|label| valid_device_name(label))
        .unwrap_or(&installation.name);
    Ok(
        json!({"label":label,"platform":std::env::consts::OS,"publicKey":installation.public_key,"keyVersion":version}),
    )
}
fn validate_directory_record(record: &Value) -> Result<()> {
    let safe_text = |value: &Value, limit: usize| {
        value.as_str().is_some_and(|v| {
            !v.is_empty() && v.encode_utf16().count() <= limit && !v.chars().any(char::is_control)
        })
    };
    let valid_key = record["publicKey"]
        .as_str()
        .is_some_and(|v| v.len() == 43 && URL_SAFE_NO_PAD.decode(v).is_ok_and(|b| b.len() == 32));
    if !record.is_object()
        || !safe_text(&record["label"], 80)
        || !safe_text(&record["platform"], 32)
        || !valid_key
        || !record["keyVersion"]
            .as_u64()
            .is_some_and(|v| v > 0 && v <= 9_007_199_254_740_991)
    {
        bail!("ACCOUNT_DEVICE_RECORD_REJECTED")
    }
    Ok(())
}
fn client() -> Result<reqwest::Client> {
    Ok(reqwest::Client::builder()
        .retry(reqwest::retry::never())
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(30))
        .build()?)
}
async fn bounded(mut response: reqwest::Response) -> Result<Vec<u8>> {
    if response.content_length().is_some_and(|v| v > 131072) {
        bail!("ACCOUNT_RESPONSE_REJECTED")
    };
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        if bytes.len() + chunk.len() > 131072 {
            bail!("ACCOUNT_RESPONSE_REJECTED")
        };
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}
struct Transaction {
    id: String,
    expected_state: Mutex<Option<String>>,
    callback: Mutex<Option<String>>,
    notify: Notify,
    stop: CancellationToken,
    operation: Mutex<()>,
    latest: Mutex<Option<String>>,
    uncertain: std::sync::atomic::AtomicBool,
}
struct Remote {
    gateway: Gateway,
    accept: tokio::task::JoinHandle<()>,
    watcher: tokio::task::JoinHandle<()>,
    locator: tokio::task::JoinHandle<()>,
}
impl Remote {
    async fn close(&mut self) {
        self.accept.abort();
        self.locator.abort();
        self.gateway.close().await;
        self.watcher.abort();
    }
}
struct State {
    installation: Option<Installation>,
    transaction: Option<Arc<Transaction>>,
    owner: Option<Arc<GrantOwner>>,
    restoring_owner: Option<Arc<GrantOwner>>,
    remote: Option<Remote>,
    snapshot: Snapshot,
}
struct Inner {
    read_only: bool,
    config: PublicConfig,
    support: PathBuf,
    manager: manager::Handle,
    state: Mutex<State>,
    operation: Mutex<()>,
    account_write: Mutex<()>,
    journal: Option<Arc<Journal>>,
    restore: Mutex<bool>,
    #[cfg(test)]
    restore_fixture: Option<RestoreFixture>,
    #[cfg(test)]
    gateway_shutdowns: Mutex<Vec<anywork_remote::gateway::GatewayShutdown>>,
}
#[derive(Clone)]
pub struct Handle(Arc<Inner>);
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Begin {
    transaction_id: String,
    endpoint: String,
    issuer: String,
    app_id: String,
    resource: String,
    scope: String,
    redirect_uri: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BrowserRequest {
    url: String,
    method: String,
    headers: BTreeMap<String, String>,
    body: Option<String>,
}
#[derive(Serialize)]
pub struct BrowserResponse {
    status: u16,
    headers: BTreeMap<String, String>,
    body: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Commit {
    access_token: String,
    account_token: String,
    refresh_token: String,
}
impl Handle {
    pub fn new(support: PathBuf, manager: manager::Handle, read_only: bool) -> Result<Self> {
        let config = PublicConfig::load(&support)?;
        let device_name = load_device_name(&support, read_only)?;
        // Legacy unit fixtures deliberately have no system store. Persistence
        // tests inject a shared fake across handles; no test reads user secrets.
        let journal = if read_only || cfg!(test) {
            None
        } else {
            Some(Journal::system(&config, &support)?)
        };
        let needs_restore = journal.is_some();
        Ok(Self(Arc::new(Inner {
            read_only,
            config,
            support,
            manager,
            state: Mutex::new(State {
                installation: None,
                transaction: None,
                owner: None,
                restoring_owner: None,
                remote: None,
                snapshot: Snapshot {
                    device_name,
                    authorization_status: if needs_restore {
                        AuthorizationStatus::Restoring
                    } else {
                        AuthorizationStatus::SignedOut
                    },
                    ..Default::default()
                },
            }),
            operation: Mutex::new(()),
            account_write: Mutex::new(()),
            journal,
            restore: Mutex::new(!needs_restore),
            #[cfg(test)]
            restore_fixture: None,
            #[cfg(test)]
            gateway_shutdowns: Mutex::new(Vec::new()),
        })))
    }
    pub fn portal_url(&self) -> String {
        format!("{}/app/", self.0.config.frontend_origin)
    }
    pub async fn snapshot(&self) -> Snapshot {
        loop {
            // A renderer poll must not delay disable/logout while a rotating
            // grant is in flight. Re-read public state after waiting for it.
            let owner = self.0.state.lock().await.owner.clone();
            let (reauth, save_pending) = if let Some(owner) = &owner {
                let grant = owner.state.lock().await;
                (grant.invalid || grant.uncertain, grant.save_pending)
            } else {
                (false, false)
            };
            let state = self.0.state.lock().await;
            let same_owner = match (&owner, &state.owner) {
                (Some(a), Some(b)) => Arc::ptr_eq(a, b),
                (None, None) => true,
                _ => false,
            };
            if !same_owner {
                continue;
            }
            let mut snapshot = state.snapshot.clone();
            snapshot.account_portal_url = self.portal_url();
            snapshot.remote_clients = match &state.remote {
                Some(remote) => remote.gateway.remote_clients(),
                None => vec![],
            };
            snapshot.transaction_id = state.transaction.as_ref().map(|tx| tx.id.clone());
            if save_pending {
                snapshot.signed_in = false;
                snapshot.authorization_status = AuthorizationStatus::RestoreRetry;
                snapshot.error = Some(
                    "最新授权尚未保存。请解锁系统凭据存储后重试；当前不会继续使用令牌。".into(),
                );
            } else if matches!(
                snapshot.authorization_status,
                AuthorizationStatus::Restoring | AuthorizationStatus::RestoreRetry
            ) {
                snapshot.signed_in = false;
            } else if let Some(owner) = &owner {
                let logged_out = owner.policy().logged_out;
                snapshot.signed_in = !reauth && !logged_out;
                snapshot.authorization_status = if reauth || logged_out {
                    snapshot.error = Some("本次授权已中断，不能重试旧令牌。结束本次授权后重新登录；未知的新授权可能还需在登录服务中撤销。".into());
                    AuthorizationStatus::ReauthRequired
                } else {
                    AuthorizationStatus::SignedIn
                };
            } else if let Some(tx) = &state.transaction {
                let interrupted = tx.stop.is_cancelled()
                    || (tx.uncertain.load(std::sync::atomic::Ordering::SeqCst)
                        && tx.operation.try_lock().is_ok());
                snapshot.busy = !interrupted;
                snapshot.authorization_status = if interrupted {
                    AuthorizationStatus::LoginInterrupted
                } else {
                    AuthorizationStatus::Authorizing
                };
            }
            return snapshot;
        }
    }
    async fn transaction(&self, id: &str) -> Result<Arc<Transaction>> {
        if self.0.read_only {
            bail!("ACCOUNT_PREVIEW_READ_ONLY")
        }
        self.0
            .state
            .lock()
            .await
            .transaction
            .as_ref()
            .filter(|tx| tx.id == id && !tx.stop.is_cancelled())
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("LOGIN_TRANSACTION_CLOSED"))
    }
    pub async fn begin(&self) -> Result<Begin> {
        if self.0.read_only {
            bail!("ACCOUNT_PREVIEW_READ_ONLY")
        }
        let _op = self.0.operation.lock().await;
        if !*self.0.restore.lock().await {
            bail!("ACCOUNT_RESTORE_REQUIRED")
        }
        let mut state = self.0.state.lock().await;
        if state.transaction.is_some() || state.owner.is_some() {
            bail!("ACCOUNT_OPERATION_IN_PROGRESS")
        }
        state.snapshot.authorization_status = AuthorizationStatus::SignedOut;
        state.snapshot.error = None;
        let listener = tokio::net::TcpListener::bind("127.0.0.1:17897")
            .await
            .map_err(|_| anyhow::anyhow!("LOGIN_CALLBACK_PORT_IN_USE"))?;
        let tx = Arc::new(Transaction {
            id: uuid::Uuid::new_v4().to_string(),
            expected_state: Mutex::new(None),
            callback: Mutex::new(None),
            notify: Notify::new(),
            stop: CancellationToken::new(),
            operation: Mutex::new(()),
            latest: Mutex::new(None),
            uncertain: std::sync::atomic::AtomicBool::new(false),
        });
        if let Some(journal) = &self.0.journal {
            journal.begin(&tx.id).await?;
        }
        state.transaction = Some(tx.clone());
        state.snapshot.busy = true;
        state.snapshot.error = None;
        let task_tx = tx.clone();
        tokio::spawn(async move {
            callback_listener(listener, task_tx).await;
        });
        Ok(self.begin_result(tx.id.clone()))
    }
    fn begin_result(&self, id: String) -> Begin {
        let c = &self.0.config;
        Begin {
            transaction_id: id,
            endpoint: c.endpoint.clone(),
            issuer: c.issuer.clone(),
            app_id: c.native_client_id.clone(),
            resource: c.resource.clone(),
            scope: "openid profile offline_access custom_data connect network:join".into(),
            redirect_uri: CALLBACK.into(),
        }
    }
    pub async fn open(&self, id: &str, raw: &str) -> Result<()> {
        let tx = self.transaction(id).await?;
        let u = url::Url::parse(raw)?;
        let endpoint = url::Url::parse(&self.0.config.issuer)?;
        let params: BTreeMap<_, _> = u
            .query_pairs()
            .map(|(k, v)| (k.into_owned(), v.into_owned()))
            .collect();
        if u.origin() != endpoint.origin()
            || u.path() != format!("{}/auth", endpoint.path())
            || params.get("client_id") != Some(&self.0.config.native_client_id)
            || params.get("redirect_uri").map(String::as_str) != Some(CALLBACK)
            || params.get("response_type").map(String::as_str) != Some("code")
            || params.get("code_challenge_method").map(String::as_str) != Some("S256")
            || params.get("resource") != Some(&self.0.config.resource)
        {
            bail!("LOGIN_URL_REJECTED")
        }
        let expected = params
            .get("state")
            .filter(|s| !s.is_empty() && s.len() < 1024)
            .ok_or_else(|| anyhow::anyhow!("LOGIN_STATE_REQUIRED"))?
            .clone();
        let mut state = tx.expected_state.lock().await;
        if state.is_some() {
            bail!("LOGIN_ALREADY_OPENED")
        };
        *state = Some(expected);
        drop(state);
        open::that(raw).map_err(|_| anyhow::anyhow!("LOGIN_BROWSER_UNAVAILABLE"))?;
        Ok(())
    }
    pub async fn wait_callback(&self, id: &str) -> Result<String> {
        let tx = self.transaction(id).await?;
        tokio::time::timeout(Duration::from_secs(180), async {
            loop {
                let notified = tx.notify.notified();
                if let Some(value) = tx.callback.lock().await.clone() {
                    return Ok(value);
                };
                tokio::select! {_=tx.stop.cancelled()=>bail!("LOGIN_CANCELLED"),_=notified=>{}}
            }
        })
        .await
        .map_err(|_| anyhow::anyhow!("LOGIN_TIMED_OUT"))?
    }
    pub async fn fetch(&self, id: &str, request: BrowserRequest) -> Result<BrowserResponse> {
        let tx = self.transaction(id).await?;
        let _op = tx.operation.lock().await;
        if tx.stop.is_cancelled() {
            bail!("LOGIN_TRANSACTION_CLOSED")
        }
        let u = url::Url::parse(&request.url)?;
        let issuer = url::Url::parse(&self.0.config.issuer)?;
        let allowed = u.origin() == issuer.origin()
            && u.query().is_none()
            && u.fragment().is_none()
            && u.username().is_empty()
            && u.password().is_none();
        let token = request.method == "POST" && u.path() == format!("{}/token", issuer.path());
        let read = request.method == "GET"
            && [
                format!("{}/.well-known/openid-configuration", issuer.path()),
                format!("{}/jwks", issuer.path()),
            ]
            .contains(&u.path().to_string());
        if !allowed || (!token && !read) || request.body.as_ref().is_some_and(|b| b.len() > 32768) {
            bail!("LOGIN_REQUEST_REJECTED")
        }
        if request.headers.iter().any(|(k, v)| {
            !["content-type", "accept"].contains(&k.to_ascii_lowercase().as_str())
                || v.contains(['\r', '\n', '\0'])
        }) {
            bail!("LOGIN_HEADER_REJECTED")
        }
        if token {
            if tx.uncertain.load(std::sync::atomic::Ordering::SeqCst) {
                bail!("LOGIN_REAUTH_REQUIRED")
            }
            let fields: BTreeMap<_, _> =
                url::form_urlencoded::parse(request.body.as_deref().unwrap_or("").as_bytes())
                    .map(|(k, v)| (k.into_owned(), v.into_owned()))
                    .collect();
            if fields.get("client_id") != Some(&self.0.config.native_client_id)
                || !fields
                    .get("grant_type")
                    .is_some_and(|g| ["authorization_code", "refresh_token"].contains(&g.as_str()))
            {
                bail!("LOGIN_GRANT_REJECTED")
            };
            if fields.get("grant_type").map(String::as_str) == Some("refresh_token")
                && fields.get("refresh_token") != tx.latest.lock().await.as_ref()
            {
                bail!("LOGIN_STALE_GRANT")
            }
        }
        let mut builder = client()?.request(
            reqwest::Method::from_bytes(request.method.as_bytes())?,
            &request.url,
        );
        for (k, v) in request.headers {
            builder = builder.header(k, v)
        }
        if let Some(body) = request.body {
            builder = builder.body(body)
        };
        if token {
            if let Some(journal) = &self.0.journal {
                journal
                    .checkpoint(
                        &tx.id,
                        SavedPhase::Pending,
                        tx.latest.lock().await.as_deref(),
                        None,
                    )
                    .await?;
            }
            tx.uncertain
                .store(true, std::sync::atomic::Ordering::SeqCst);
        }
        let response = builder.send().await?;
        let status = response.status().as_u16();
        let body = String::from_utf8(bounded(response).await?)?;
        if token {
            let value: Value = serde_json::from_str(&body)?;
            if let Some(refresh) = value["refresh_token"].as_str().filter(|v| !v.is_empty()) {
                // The sole broker owns this rotation in RAM before IPC returns.
                *tx.latest.lock().await = Some(refresh.into());
                if let Some(journal) = &self.0.journal {
                    journal
                        .checkpoint(&tx.id, SavedPhase::Provisional, Some(refresh), None)
                        .await?;
                }
                tx.uncertain
                    .store(false, std::sync::atomic::Ordering::SeqCst);
            }
            if (200..300).contains(&status)
                && value.get("error").is_none()
                && value["access_token"]
                    .as_str()
                    .is_some_and(|v| !v.is_empty())
            {
                if let Some(journal) = &self.0.journal {
                    journal
                        .checkpoint(
                            &tx.id,
                            SavedPhase::Provisional,
                            tx.latest.lock().await.as_deref(),
                            None,
                        )
                        .await?;
                }
                tx.uncertain
                    .store(false, std::sync::atomic::Ordering::SeqCst);
            }
        }
        Ok(BrowserResponse {
            status,
            headers: BTreeMap::from([("content-type".into(), "application/json".into())]),
            body,
        })
    }
    pub async fn commit(&self, id: &str, tokens: Commit) -> Result<String> {
        let _op = self.0.operation.lock().await;
        let tx = self.transaction(id).await?;
        let _grant = tx.operation.lock().await;
        if tx.stop.is_cancelled() || tx.uncertain.load(std::sync::atomic::Ordering::SeqCst) {
            bail!("LOGIN_REAUTH_REQUIRED")
        }
        if tx.latest.lock().await.as_deref() != Some(&tokens.refresh_token) {
            bail!("LOGIN_STALE_GRANT")
        }
        let subject = jwt_subject(&tokens.access_token)?;
        let verifier = JwtVerifier::new(
            self.0.config.issuer.clone(),
            self.0.config.resource.clone(),
            self.0.config.native_client_id.clone(),
            subject.clone(),
        )?;
        verifier.verify(&tokens.access_token).await?;
        let account = self
            .account_request(&tokens.account_token, reqwest::Method::GET, None)
            .await?;
        if account["id"].as_str() != Some(&subject) {
            bail!("ACCOUNT_IDENTITY_MISMATCH")
        }
        let profile = if profile_text(&account, &["name", "username"]).is_some() {
            account.clone()
        } else {
            // The same opaque no-resource token is used by the official Logto
            // SDK for UserInfo. TLS/provider origin and subject are both bound.
            let info = self.user_info(&tokens.account_token, &subject).await?;
            if profile_label(&info).is_some() {
                info
            } else {
                account.clone()
            }
        };
        let installation = self.installation(&subject).await?;
        let cloud_name = directory_name(&account, &installation.id);
        if let Some(name) = &cloud_name {
            save_device_name(&self.0.support, name)?;
        }
        let grant = Grant {
            config: self.0.config.clone(),
            refresh: tokens.refresh_token,
            subject: subject.clone(),
        };
        let mut owner = GrantOwner::new(grant)?;
        if let Some(journal) = &self.0.journal {
            journal
                .checkpoint(
                    &tx.id,
                    SavedPhase::Ready,
                    Some(&owner.state.lock().await.grant.refresh),
                    Some(&subject),
                )
                .await?;
            owner.saved = Some((journal.clone(), tx.id.clone()));
        }
        let owner = Arc::new(owner);
        // ACK only after the verified grant is durably owned by Native.
        let mut state = self.0.state.lock().await;
        state.owner = Some(owner);
        state.transaction = None;
        tx.stop.cancel();
        state.snapshot.busy = false;
        state.snapshot.account_label = Some(account_label(&profile));
        state.snapshot.device_name_synced = cloud_name.is_some();
        if let Some(name) = cloud_name {
            state.snapshot.device_name = name.clone();
            if let Some(installation) = &mut state.installation {
                installation.name = name;
            }
        }
        state.snapshot.subject = Some(subject);
        state.snapshot.signed_in = true;
        Ok(if self.0.journal.is_some() {
            "OwnedSecurely"
        } else {
            "OwnedInMemory"
        }
        .into())
    }
    async fn account_request(
        &self,
        token: &str,
        method: reqwest::Method,
        body: Option<Value>,
    ) -> Result<Value> {
        let mut request = client()?
            .request(method, format!("{}/api/my-account", self.0.config.endpoint))
            .bearer_auth(token);
        if let Some(body) = body {
            request = request.json(&body)
        };
        let response = request.send().await?;
        if !response.status().is_success() {
            bail!("ACCOUNT_API_REJECTED")
        };
        Ok(serde_json::from_slice(&bounded(response).await?)?)
    }
    async fn user_info(&self, token: &str, subject: &str) -> Result<Value> {
        let response = client()?
            .get(format!("{}/me", self.0.config.issuer))
            .bearer_auth(token)
            .send()
            .await;
        let Ok(response) = response else {
            return Ok(json!({}));
        };
        if !response.status().is_success() {
            // Profile lookup is optional; the already verified identity remains
            // usable without publishing the provider's opaque subject as a name.
            return Ok(json!({}));
        }
        let profile: Value = serde_json::from_slice(&bounded(response).await?)?;
        if profile["sub"].as_str() != Some(subject) {
            bail!("ACCOUNT_IDENTITY_MISMATCH")
        }
        Ok(profile)
    }
    async fn check_name_owner(&self, owner: &Arc<GrantOwner>) -> Result<()> {
        let state = self.0.state.lock().await;
        if !state.owner.as_ref().is_some_and(|o| Arc::ptr_eq(o, owner)) || owner.policy().logged_out
        {
            bail!("ACCOUNT_OPERATION_CANCELLED")
        }
        Ok(())
    }
    async fn remember_name(&self, name: &str, synced: bool) -> Result<()> {
        save_device_name(&self.0.support, name)?;
        let mut state = self.0.state.lock().await;
        state.snapshot.device_name = name.into();
        state.snapshot.device_name_synced = synced;
        if let Some(installation) = &mut state.installation {
            installation.name = name.into();
        }
        Ok(())
    }
    pub async fn rename_device(&self, name: &str, expected_name: &str) -> Result<Snapshot> {
        if self.0.read_only {
            bail!("ACCOUNT_PREVIEW_READ_ONLY")
        }
        let name = normalized_device_name(name)?;
        let owner = self.0.state.lock().await.owner.clone();
        let _op = self.0.operation.lock().await;
        {
            let mut state = self.0.state.lock().await;
            if state.snapshot.device_name != expected_name {
                bail!("DEVICE_NAME_CONFLICT")
            }
            state.snapshot.device_name_synced = false;
        }
        let mut synced = false;
        if let Some(owner) = &owner {
            self.check_name_owner(owner).await?;
            let _write = self.0.account_write.lock().await;
            self.check_name_owner(owner).await?;
            let token = owner.token(false).await?;
            self.check_name_owner(owner).await?;
            let subject = owner.state.lock().await.grant.subject.clone();
            let installation = self.installation(&subject).await?;
            let mut account = self
                .account_request(&token, reqwest::Method::GET, None)
                .await?;
            self.check_name_owner(owner).await?;
            if account["id"].as_str() != Some(&subject) {
                bail!("ACCOUNT_IDENTITY_MISMATCH")
            }
            let mut data = account["customData"].take();
            if let Some(anywork) = data.get("anywork") {
                if anywork["schemaVersion"] != 1
                    || !anywork["devices"].is_object()
                    || anywork["devices"]
                        .as_object()
                        .is_some_and(|devices| devices.len() > 32)
                {
                    bail!("ACCOUNT_SCHEMA_REJECTED")
                }
                if let Some(record) = data["anywork"]["devices"].get_mut(&installation.id) {
                    // Validation must not rotate a key or replace a record that
                    // Web currently owns. Only the label field changes.
                    validate_directory_record(record)?;
                    if record["label"].as_str() != Some(expected_name) {
                        self.remember_name(record["label"].as_str().unwrap(), false)
                            .await?;
                        bail!("DEVICE_NAME_CONFLICT")
                    }
                    record["label"] = json!(name);
                    if serde_json::to_vec(&data)?.len() > 32768 {
                        bail!("ACCOUNT_DATA_LIMIT")
                    }
                    self.check_name_owner(owner).await?;
                    self.0.state.lock().await.snapshot.device_name_synced = false;
                    self.account_request(
                        &token,
                        reqwest::Method::PATCH,
                        Some(json!({"customData":data.clone()})),
                    )
                    .await?;
                    self.check_name_owner(owner).await?;
                    let after = self
                        .account_request(&token, reqwest::Method::GET, None)
                        .await?;
                    self.check_name_owner(owner).await?;
                    if after["id"].as_str() != Some(&subject) || after["customData"] != data {
                        if after["id"].as_str() == Some(&subject)
                            && let Some(current) = directory_name(&after, &installation.id)
                        {
                            self.remember_name(&current, false).await?;
                        }
                        bail!("DEVICE_NAME_CONFLICT")
                    }
                    synced = true;
                }
            } else if !data.is_null() && !data.is_object() {
                bail!("ACCOUNT_DATA_REJECTED")
            }
        } else if self.0.state.lock().await.owner.is_some() {
            bail!("ACCOUNT_OPERATION_CANCELLED")
        }
        self.remember_name(&name, synced).await?;
        Ok(self.snapshot().await)
    }
    async fn installation(&self, subject: &str) -> Result<Installation> {
        let mut state = self.0.state.lock().await;
        if let Some(i) = &state.installation
            && i.config == self.0.config
            && i.subject == subject
        {
            return Ok(i.clone());
        }
        let id = public_installation_id(&self.0.support, &self.0.config, subject)?;
        let keys = snow::Builder::new(anywork_remote::NOISE_SUITE.parse()?).generate_keypair()?;
        let i = Installation {
            config: self.0.config.clone(),
            subject: subject.into(),
            id,
            private_key: URL_SAFE_NO_PAD.encode(keys.private),
            public_key: URL_SAFE_NO_PAD.encode(keys.public),
            name: state.snapshot.device_name.clone(),
        };
        state.installation = Some(i.clone());
        Ok(i)
    }
    async fn publish_index(
        &self,
        owner: &Arc<GrantOwner>,
        i: &Installation,
        locator: Option<(&str, u16)>,
    ) -> Result<()> {
        let generation = owner.policy().generation.clone();
        let check = || {
            let policy = owner.policy();
            policy.check(&generation)?;
            if policy.manual_off {
                bail!("REMOTE_OPERATION_CANCELLED")
            }
            Ok::<_, anyhow::Error>(())
        };
        check()?;
        let _write = self.0.account_write.lock().await;
        check()?;
        let token = EnableStage::IndexToken.at(owner.token(false).await)?;
        check()?;
        let mut account = EnableStage::IndexRead.at(self
            .account_request(&token, reqwest::Method::GET, None)
            .await)?;
        if account["id"].as_str() != Some(owner.state.lock().await.grant.subject.as_str()) {
            return Err(EnableStage::IndexRead.into());
        }
        let mut data = account["customData"].take();
        if data.is_null() {
            data = json!({})
        };
        let published_at = anywork_remote::auth::now();
        let locator = locator.map(|(ipv4, port)| {
            (
                ipv4,
                port,
                published_at,
                published_at.saturating_add(LOCATOR_LIFETIME_SECONDS),
            )
        });
        EnableStage::IndexSchema.at(update_device_index(&mut data, i, locator))?;
        check()?;
        EnableStage::IndexWrite.at(self
            .account_request(
                &token,
                reqwest::Method::PATCH,
                Some(json!({"customData":data.clone()})),
            )
            .await)?;
        check()?;
        let after = EnableStage::IndexReadback.at(self
            .account_request(&token, reqwest::Method::GET, None)
            .await)?;
        if after["id"].as_str() != Some(&i.subject) || after["customData"] != data {
            return Err(EnableStage::IndexReadback.into());
        };
        check()?;
        let name = directory_name(&after, &i.id).ok_or(EnableStage::IndexReadback)?;
        EnableStage::IndexReadback.at(save_device_name(&self.0.support, &name))?;
        let mut state = self.0.state.lock().await;
        state.snapshot.device_name = name.clone();
        state.snapshot.device_name_synced = true;
        if let Some(installation) = &mut state.installation {
            installation.name = name;
        }
        Ok(())
    }
    pub async fn enable(&self) -> Result<()> {
        self.enable_mode(false).await
    }
    pub async fn enable_default(&self) -> Result<()> {
        self.enable_mode(true).await
    }
    async fn enable_mode(&self, default: bool) -> Result<()> {
        if self.0.read_only {
            bail!("ACCOUNT_PREVIEW_READ_ONLY")
        }
        // Capture intent before queueing: disable/logout also invalidate queued
        // callers, and a queued old-account call must never adopt a new owner.
        let owner = self
            .0
            .state
            .lock()
            .await
            .owner
            .clone()
            .ok_or_else(|| anyhow::anyhow!("ACCOUNT_SIGN_IN_REQUIRED"))?;
        let generation = owner.policy().generation.clone();
        let _op = self.0.operation.lock().await;
        let enabled = {
            let state = self.0.state.lock().await;
            if !state.owner.as_ref().is_some_and(|o| Arc::ptr_eq(o, &owner)) {
                bail!("REMOTE_OPERATION_CANCELLED")
            }
            state.remote.is_some()
        };
        owner.policy().check(&generation)?;
        {
            let grant = owner.state.lock().await;
            if grant.invalid || grant.uncertain {
                bail!("ACCOUNT_REAUTH_REQUIRED")
            }
        }
        {
            let policy = owner.policy();
            policy.check(&generation)?;
            // No-op default requests do not depend on service readiness.
            if default && (policy.consumed || policy.manual_off || enabled) {
                return Ok(());
            }
        }
        let snapshot = self.0.manager.snapshot();
        if !snapshot.authorized || snapshot.service != manager::Phase::Running {
            bail!("LOCAL_SERVICE_NOT_READY")
        }
        if !snapshot.workspace_ready() {
            return Err(EnableStage::LocalServiceUpgrade.into());
        }
        let (run, stop) = {
            let state = self.0.state.lock().await;
            let mut policy = owner.policy();
            let run = policy.claim(&generation, default, state.remote.is_some())?;
            (run, policy.stop.clone())
        };
        if !run {
            return Ok(());
        }
        let subject = owner.state.lock().await.grant.subject.clone();
        let i = EnableStage::Identity.at(self.installation(&subject).await)?;
        let gateway_verifier = EnableStage::Gateway.at(JwtVerifier::with_allowed_clients(
            self.0.config.issuer.clone(),
            self.0.config.resource.clone(),
            vec![
                self.0.config.spa_client_id.clone(),
                self.0.config.native_client_id.clone(),
            ],
            subject.clone(),
        ))?;
        let network_verifier = EnableStage::NetworkToken.at(NetworkVerifier::new(
            self.0.config.issuer.clone(),
            self.0.config.resource.clone(),
            vec![self.0.config.native_client_id.clone()],
            self.0.config.product_id.clone(),
            Arc::new(RealClock),
        ))?;
        let network_token = tokio::select! {
            biased;
            _ = stop.cancelled() => return Err(EnableStage::Cancelled.into()),
            token = owner.token(true) => EnableStage::NetworkToken.at(token)?,
        };
        let verified =
            EnableStage::NetworkToken.at(network_verifier.verify(&network_token).await)?;
        if verified.subject != subject {
            return Err(EnableStage::Identity.into());
        }
        owner.policy().check(&generation)?;
        let private: [u8; 32] = URL_SAFE_NO_PAD
            .decode(&i.private_key)
            .map_err(|_| EnableStage::Identity)?
            .try_into()
            .map_err(|_| EnableStage::Identity)?;
        let watched_token = snapshot.token.clone();
        let mut gateway = EnableStage::Gateway.at(Gateway::start(GatewayConfig {
            installation_id: i.id.clone(),
            private_key: private,
            allowed_origins: vec![
                self.0.config.frontend_origin.clone(),
                "https://tauri.localhost".into(),
            ],
            local_port: snapshot.config.port,
            local_token: snapshot.token,
            verifier: Arc::new(gateway_verifier),
        })
        .await)?;
        #[cfg(test)]
        self.0
            .gateway_shutdowns
            .lock()
            .await
            .push(gateway.shutdown_observer());
        let mut overlay = match EnableStage::NetworkStart.at(Overlay::start(
            &verified.credentials,
            &i.id,
            OverlayConfig {
                bootstrap_peers: self.0.config.bootstrap_peers.clone(),
                service_port: DEFAULT_SERVICE_PORT,
                enable_p2p: true,
            },
        )
        .await)
        {
            Ok(overlay) => overlay,
            Err(error) => {
                gateway.close().await;
                return Err(error);
            }
        };
        let ipv4 = overlay.ipv4().to_string();
        let port = overlay.service_port();
        let acceptor = gateway.acceptor();
        let accept_stop = stop.clone();
        let overlay_alive = Arc::new(std::sync::atomic::AtomicBool::new(true));
        let watched_alive = overlay_alive.clone();
        let accept = tokio::spawn(async move {
            loop {
                let Ok((stream, _peer)) = overlay.accept(&accept_stop).await else {
                    break;
                };
                acceptor.accept_stream(stream);
            }
            let _ = overlay.close().await;
            watched_alive.store(false, std::sync::atomic::Ordering::SeqCst);
        });
        if let Err(error) = self.publish_index(&owner, &i, Some((&ipv4, port))).await {
            accept.abort();
            gateway.close().await;
            return Err(error);
        }
        let inner = Arc::downgrade(&self.0);
        let watched_owner = Arc::downgrade(&owner);
        let watched_generation = generation.clone();
        let watched_port = snapshot.config.port;
        let watched_alive = overlay_alive.clone();
        let watcher = tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_millis(500)).await;
                let Some(inner) = inner.upgrade() else { break };
                let local = inner.manager.snapshot();
                let invalid_owner = {
                    let owner = inner.state.lock().await.owner.clone();
                    if let Some(owner) = &owner {
                        let grant = owner.state.lock().await;
                        grant.invalid || grant.uncertain
                    } else {
                        true
                    }
                };
                if !watched_alive.load(std::sync::atomic::Ordering::SeqCst)
                    || invalid_owner
                    || !local.authorized
                    || local.service != manager::Phase::Running
                    || local.config.port != watched_port
                    || local.token != watched_token
                {
                    tokio::spawn(async move {
                        if let Some(owner) = watched_owner.upgrade() {
                            Handle(inner)
                                .disable_current(&owner, &watched_generation)
                                .await;
                        }
                    });
                    break;
                }
            }
        });
        let locator_owner = owner.clone();
        let locator_installation = i.clone();
        let locator_ipv4 = ipv4.clone();
        let locator_stop = stop.clone();
        let locator_handle = self.clone();
        let locator = tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = locator_stop.cancelled() => break,
                    _ = tokio::time::sleep(Duration::from_secs(
                        LOCATOR_LIFETIME_SECONDS / 2,
                    )) => {}
                }
                if locator_handle
                    .publish_index(
                        &locator_owner,
                        &locator_installation,
                        Some((&locator_ipv4, port)),
                    )
                    .await
                    .is_err()
                {
                    break;
                }
            }
        });
        let mut pending = Some(Remote {
            gateway,
            accept,
            watcher,
            locator,
        });
        let installed = {
            let mut state = self.0.state.lock().await;
            let policy = owner.policy();
            if policy.check(&generation).is_ok() {
                state.remote = pending.take();
                state.snapshot.enabled = true;
                state.snapshot.installation_id = Some(i.id.clone());
                state.snapshot.public_key = Some(i.public_key.clone());
                state.snapshot.error = None;
                true
            } else {
                false
            }
        };
        if !installed {
            if let Some(remote) = pending.as_mut() {
                remote.close().await;
            }
            self.remove_locator(&owner, &i).await;
            bail!("REMOTE_OPERATION_CANCELLED")
        }
        Ok(())
    }
    pub async fn disable(&self) {
        self.invalidate_remote(false).await;
        let _op = self.0.operation.lock().await;
        self.close_remote().await;
    }
    async fn invalidate_remote(&self, logout: bool) {
        let state = self.0.state.lock().await;
        for owner in [&state.owner, &state.restoring_owner].into_iter().flatten() {
            owner.policy().invalidate(logout);
        }
    }
    async fn disable_current(&self, owner: &Arc<GrantOwner>, generation: &Arc<()>) {
        let _op = self.0.operation.lock().await;
        if owner.policy().check(generation).is_err() {
            return;
        }
        self.close_remote().await;
    }
    // Caller holds operation; no public action can interleave with cleanup.
    async fn close_remote(&self) {
        let (remote, owner, installation) = {
            let mut state = self.0.state.lock().await;
            state.snapshot.enabled = false;
            state.snapshot.installation_id = None;
            state.snapshot.public_key = None;
            (
                state.remote.take(),
                state.owner.clone(),
                state.installation.clone(),
            )
        };
        if let Some(mut remote) = remote {
            remote.close().await;
            if let (Some(owner), Some(installation)) = (owner, installation) {
                self.remove_locator(&owner, &installation).await;
            }
        }
    }
    async fn remove_locator(&self, owner: &Arc<GrantOwner>, i: &Installation) {
        if owner.state.lock().await.invalid {
            return;
        }
        let _write = self.0.account_write.lock().await;
        let Ok(token) = owner.token(false).await else {
            return;
        };
        let Ok(mut account) = self
            .account_request(&token, reqwest::Method::GET, None)
            .await
        else {
            return;
        };
        if account["id"].as_str() != Some(i.subject.as_str()) {
            return;
        }
        let mut data = account["customData"].take();
        if remove_device_locator(&mut data, &i.id).is_err() {
            return;
        }
        let _ = self
            .account_request(
                &token,
                reqwest::Method::PATCH,
                Some(json!({"customData":data})),
            )
            .await;
    }
    pub async fn cancel(&self, id: &str) -> Result<()> {
        let _op = self.0.operation.lock().await;
        if self.0.read_only {
            bail!("ACCOUNT_PREVIEW_READ_ONLY")
        }
        let tx = self
            .0
            .state
            .lock()
            .await
            .transaction
            .as_ref()
            .filter(|tx| tx.id == id)
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("LOGIN_TRANSACTION_CLOSED"))?;
        tx.stop.cancel();
        if let Some(journal) = &self.0.journal {
            journal.retire().await?;
        }
        let _grant = tx.operation.lock().await;
        if let Some(journal) = &self.0.journal {
            journal.delete().await?;
        }
        if let Some(refresh) = tx.latest.lock().await.clone() {
            self.revoke(&refresh).await?;
        }
        let mut state = self.0.state.lock().await;
        state.transaction = None;
        state.snapshot.busy = false;
        state.snapshot.authorization_status = AuthorizationStatus::SignedOut;
        state.snapshot.error = None;
        Ok(())
    }
    async fn revoke(&self, refresh: &str) -> Result<()> {
        Self::revoke_owned(&self.0.config, refresh).await
    }
    async fn revoke_owned(config: &PublicConfig, refresh: &str) -> Result<()> {
        Self::revoke_at(
            &client()?,
            &format!("{}/token/revocation", config.issuer),
            &config.native_client_id,
            refresh,
        )
        .await
    }
    async fn revoke_at(
        http: &reqwest::Client,
        endpoint: &str,
        client_id: &str,
        refresh: &str,
    ) -> Result<()> {
        let response = http
            .post(endpoint)
            .form(&[
                ("client_id", client_id),
                ("token", refresh),
                ("token_type_hint", "refresh_token"),
            ])
            .send()
            .await?;
        if !response.status().is_success() {
            bail!("ACCOUNT_REVOCATION_FAILED")
        };
        Ok(())
    }
    pub async fn logout(&self) -> Result<()> {
        if self.0.read_only {
            bail!("ACCOUNT_PREVIEW_READ_ONLY")
        }
        self.invalidate_remote(true).await;
        // Retire before waiting on an in-flight exchange. A late rotation may
        // remain available for revocation in RAM but cannot revive disk state.
        let retirement = match &self.0.journal {
            Some(journal) => journal.retire().await,
            None => Ok(()),
        };
        let _op = self.0.operation.lock().await;
        self.close_remote().await;
        retirement?;
        let (owner, transaction) = {
            let state = self.0.state.lock().await;
            (
                state
                    .owner
                    .clone()
                    .or_else(|| state.restoring_owner.clone()),
                state.transaction.clone(),
            )
        };
        if let Some(tx) = &transaction {
            tx.stop.cancel();
        }
        // Wait for the sole broker request before revoking its latest rotation.
        let _transaction_operation = match &transaction {
            Some(tx) => Some(tx.operation.lock().await),
            None => None,
        };
        if let Some(journal) = &self.0.journal {
            journal.delete().await?;
        }
        let revocation = if let Some(owner) = owner {
            owner.revoke().await
        } else if let Some(refresh) = match &transaction {
            Some(tx) => tx.latest.lock().await.clone(),
            None => None,
        } {
            self.revoke(&refresh).await
        } else {
            Ok(())
        };
        let mut state = self.0.state.lock().await;
        if let Some(tx) = state.transaction.take() {
            tx.stop.cancel()
        };
        state.owner = None;
        state.restoring_owner = None;
        state.installation = None;
        let device_name = state.snapshot.device_name.clone();
        state.snapshot = Snapshot {
            device_name,
            ..Default::default()
        };
        *self.0.restore.lock().await = true;
        if revocation.is_err() {
            state.snapshot.error = Some(
                "本应用保存的登录已清除，但登录服务撤销尚未确认。可在登录服务中结束授权。".into(),
            );
            bail!("ACCOUNT_REVOCATION_PENDING")
        }
        Ok(())
    }
}
fn jwt_subject(token: &str) -> Result<String> {
    let body = token
        .split('.')
        .nth(1)
        .ok_or_else(|| anyhow::anyhow!("ACCOUNT_TOKEN_REJECTED"))?;
    let value: Value = serde_json::from_slice(&URL_SAFE_NO_PAD.decode(body)?)?;
    value["sub"]
        .as_str()
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| anyhow::anyhow!("ACCOUNT_TOKEN_REJECTED"))
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum CallbackPage {
    Received,
    Cancelled,
    Failed,
    Invalid,
}
fn callback_page(url: Option<&url::Url>, expected: Option<&str>) -> CallbackPage {
    let Some(url) = url else {
        return CallbackPage::Invalid;
    };
    let values = |key: &str| {
        url.query_pairs()
            .filter(|(k, _)| k == key)
            .map(|(_, v)| v.into_owned())
            .collect::<Vec<_>>()
    };
    let states = values("state");
    if url.path() != "/callback"
        || expected.is_none()
        || states.len() != 1
        || states.first().map(String::as_str) != expected
    {
        return CallbackPage::Invalid;
    }
    let codes = values("code");
    let errors = values("error");
    match (codes.as_slice(), errors.as_slice()) {
        ([code], []) if !code.is_empty() => CallbackPage::Received,
        ([], [error]) if error == "access_denied" => CallbackPage::Cancelled,
        ([], [error]) if !error.is_empty() => CallbackPage::Failed,
        _ => CallbackPage::Invalid,
    }
}
fn callback_response(page: CallbackPage) -> String {
    let (title, message) = match page {
        CallbackPage::Received => (
            "已收到登录结果",
            "请返回 AnyWork，应用正在完成验证。此页面可以安全关闭。",
        ),
        CallbackPage::Cancelled => (
            "已取消登录",
            "请返回 AnyWork。你可以在应用中重新开始登录，此页面可以安全关闭。",
        ),
        CallbackPage::Failed => (
            "登录未完成",
            "请返回 AnyWork 查看登录状态并重试。此页面可以安全关闭。",
        ),
        CallbackPage::Invalid => (
            "此登录链接无效",
            "请返回 AnyWork，重新开始登录。此页面可以安全关闭。",
        ),
    };
    let body = include_str!("account-callback.html")
        .replace("{{ICON}}", include_str!("../../../web/public/icon.svg"))
        .replace("{{TITLE}}", title)
        .replace("{{MESSAGE}}", message);
    let script_hash = base64::engine::general_purpose::STANDARD.encode(Sha256::digest(
        b"try{history.replaceState(null,\"\",\"/callback\")}catch{}",
    ));
    format!(
        "HTTP/1.1 {}\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nX-Content-Type-Options: nosniff\r\nContent-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-{}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}",
        if page == CallbackPage::Invalid {
            "400 Bad Request"
        } else {
            "200 OK"
        },
        script_hash,
        body.len(),
        body
    )
}
async fn callback_listener(listener: tokio::net::TcpListener, tx: Arc<Transaction>) {
    let deadline = tokio::time::sleep(Duration::from_secs(180));
    tokio::pin!(deadline);
    loop {
        let accepted = tokio::select! {_=tx.stop.cancelled()=>break,_=&mut deadline=>{tx.stop.cancel();tx.notify.notify_waiters();break},value=listener.accept()=>value};
        let Ok((mut stream, peer)) = accepted else {
            break;
        };
        if !peer.ip().is_loopback() {
            continue;
        }
        let mut bytes = vec![0; 8192];
        let read = tokio::time::timeout(Duration::from_secs(3), stream.read(&mut bytes)).await;
        let Ok(Ok(n)) = read else { continue };
        let request = String::from_utf8_lossy(&bytes[..n]);
        let first = request.lines().next().unwrap_or("");
        let parts: Vec<_> = first.split_whitespace().collect();
        let url = if parts.len() == 3 && parts[0] == "GET" && parts[1].starts_with("/callback?") {
            url::Url::parse(&format!("http://127.0.0.1:17897{}", parts[1])).ok()
        } else {
            None
        };
        let expected = tx.expected_state.lock().await;
        let page = if tx.stop.is_cancelled() {
            CallbackPage::Invalid
        } else {
            callback_page(url.as_ref(), expected.as_deref())
        };
        drop(expected);
        let response = callback_response(page);
        let _ = stream.write_all(response.as_bytes()).await;
        if page != CallbackPage::Invalid && !tx.stop.is_cancelled() {
            *tx.callback.lock().await = url.map(|u| u.to_string());
            tx.notify.notify_waiters();
            break;
        }
    }
}

fn safe_error(error: anyhow::Error) -> String {
    if let Some(stage) = error.downcast_ref::<EnableStage>() {
        return stage.code().into();
    }
    match error.to_string().as_str() {
        "LOGIN_CALLBACK_PORT_IN_USE" => "登录回调端口已被占用，请关闭其他登录窗口后重试。".into(),
        "ACCOUNT_SIGN_IN_REQUIRED" => EnableStage::SignInRequired.code().into(),
        "ACCOUNT_REAUTH_REQUIRED" => EnableStage::ReauthRequired.code().into(),
        "LOCAL_SERVICE_NOT_READY" => EnableStage::LocalService.code().into(),
        "REMOTE_COORDINATION_CLEANUP_REQUIRED" => EnableStage::CleanupPending.code().into(),
        "REMOTE_OPERATION_CANCELLED" => EnableStage::Cancelled.code().into(),
        "REMOTE_ALREADY_ENABLED" => EnableStage::AlreadyEnabled.code().into(),
        "DEVICE_NAME_REJECTED" => "名称需为 1–80 个字符，且不能包含控制字符。".into(),
        "DEVICE_NAME_CONFLICT" => "设备名称未完成同步，账号目录已发生变化，请刷新后重试。".into(),
        "DEVICE_NAME_STORAGE_REJECTED" => "无法保存设备名称，请检查本机配置文件。".into(),
        "ACCOUNT_STORE_UNAVAILABLE"
        | "ACCOUNT_STORE_DELETE_FAILED"
        | "ACCOUNT_REVOCATION_PENDING"
        | "ACCOUNT_STORE_REJECTED"
        | "ACCOUNT_RESTORE_RETRY"
        | "ACCOUNT_RESTORE_REQUIRED" => error.to_string(),
        _ => "账号操作未完成，请检查登录状态和网络后重试。".into(),
    }
}
#[tauri::command]
pub async fn account_snapshot(state: tauri::State<'_, Handle>) -> Result<Snapshot, String> {
    Ok(state.snapshot().await)
}
#[tauri::command]
pub async fn account_restore(state: tauri::State<'_, Handle>) -> Result<(), String> {
    state.restore_login().await.map_err(safe_error)
}
#[tauri::command]
pub async fn account_rename_device(
    state: tauri::State<'_, Handle>,
    name: String,
    expected_name: String,
) -> Result<Snapshot, String> {
    state
        .rename_device(&name, &expected_name)
        .await
        .map_err(safe_error)
}
#[tauri::command]
pub async fn account_begin(state: tauri::State<'_, Handle>) -> Result<Begin, String> {
    state.begin().await.map_err(safe_error)
}
#[tauri::command]
pub async fn account_open(
    state: tauri::State<'_, Handle>,
    transaction_id: String,
    url: String,
) -> Result<(), String> {
    state.open(&transaction_id, &url).await.map_err(safe_error)
}
#[tauri::command]
pub async fn account_fetch(
    state: tauri::State<'_, Handle>,
    transaction_id: String,
    request: BrowserRequest,
) -> Result<BrowserResponse, String> {
    state
        .fetch(&transaction_id, request)
        .await
        .map_err(safe_error)
}
#[tauri::command]
pub async fn account_wait_callback(
    state: tauri::State<'_, Handle>,
    transaction_id: String,
) -> Result<String, String> {
    state
        .wait_callback(&transaction_id)
        .await
        .map_err(safe_error)
}
#[tauri::command]
pub async fn account_commit(
    state: tauri::State<'_, Handle>,
    transaction_id: String,
    tokens: Commit,
) -> Result<String, String> {
    state
        .commit(&transaction_id, tokens)
        .await
        .map_err(safe_error)
}
#[tauri::command]
pub async fn account_cancel(
    state: tauri::State<'_, Handle>,
    transaction_id: String,
) -> Result<(), String> {
    state.cancel(&transaction_id).await.map_err(safe_error)
}
#[tauri::command]
pub async fn account_enable(state: tauri::State<'_, Handle>) -> Result<(), AccountActionError> {
    state.enable().await.map_err(action_error)
}
#[tauri::command]
pub async fn account_enable_default(
    state: tauri::State<'_, Handle>,
) -> Result<(), AccountActionError> {
    state.enable_default().await.map_err(action_error)
}
#[tauri::command]
pub async fn account_disable(state: tauri::State<'_, Handle>) -> Result<(), String> {
    state.disable().await;
    Ok(())
}
#[tauri::command]
pub async fn account_logout(state: tauri::State<'_, Handle>) -> Result<(), String> {
    state.logout().await.map_err(safe_error)
}
#[cfg(test)]
#[path = "accounts_experience_tests.rs"]
mod experience_tests;
#[cfg(test)]
#[path = "accounts_saved_tests.rs"]
mod saved_tests;
