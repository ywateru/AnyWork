//! Native account lifecycle. This module owns all refresh operations; the SDK
//! only asks its AuthProvider for a resource access token.
use crate::{
    config, manager,
    process::{LaunchPlan, OwnedProcess},
};
use anyhow::{Result, bail};
use anywork_remote::{AccountVerifier, Gateway, GatewayConfig, JwtVerifier, RemoteClient};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, path::PathBuf, sync::Arc, time::Duration};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    sync::{Mutex, Notify, mpsc},
};
use tokio_util::sync::CancellationToken;

const CALLBACK: &str = "http://127.0.0.1:17897/callback";
// Fixed diagnostics only. Provider errors can contain credentials/URLs and are
// deliberately discarded at the boundary rather than formatted or logged.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum EnableStage {
    Identity,
    Gateway,
    Provider,
    GridClient,
    GridConfig,
    GridConfigUnavailable,
    ResourceToken,
    GridRegister,
    GridExpose,
    IndexToken,
    IndexRead,
    IndexSchema,
    IndexWrite,
    IndexReadback,
}
impl EnableStage {
    fn code(self) -> &'static str {
        match self {
            Self::Identity => "REMOTE_ENABLE_IDENTITY",
            Self::Gateway => "REMOTE_ENABLE_GATEWAY",
            Self::Provider => "REMOTE_ENABLE_PROVIDER",
            Self::GridClient => "REMOTE_ENABLE_GRID_CLIENT",
            Self::GridConfig => "REMOTE_ENABLE_GRID_CONFIG",
            Self::GridConfigUnavailable => "REMOTE_ENABLE_GRID_CONFIG_UNAVAILABLE",
            Self::ResourceToken => "REMOTE_ENABLE_RESOURCE_TOKEN",
            Self::GridRegister => "REMOTE_ENABLE_GRID_REGISTER",
            Self::GridExpose => "REMOTE_ENABLE_GRID_EXPOSE",
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

fn retryable_grid_config_error(error: &cybergrid_sdk::Error) -> bool {
    match error {
        cybergrid_sdk::Error::Http(error) => {
            !error.is_builder() && !error.is_decode() && !error.is_redirect()
        }
        cybergrid_sdk::Error::Api { status, .. } => {
            matches!(status, 408 | 429 | 500 | 502 | 503 | 504)
        }
        cybergrid_sdk::Error::Timeout(_) | cybergrid_sdk::Error::Transport(_) => true,
        _ => false,
    }
}

async fn verified_grid_config(
    grid: &cybergrid_sdk::Client,
    expected: &PublicConfig,
    attempt_timeout: Duration,
    retry_delays: [Duration; 2],
) -> Result<cybergrid_sdk::AuthConfig> {
    // Only the public, unauthenticated, idempotent configuration GET is retried.
    // Never repeat OAuth exchanges, device registration or directory writes.
    for attempt in 0..=retry_delays.len() {
        let retryable = match tokio::time::timeout(attempt_timeout, grid.auth_config()).await {
            Ok(Ok(auth)) => {
                if auth.issuer != expected.issuer
                    || auth.resource != expected.resource
                    || auth.client_id != expected.native_client_id
                {
                    return Err(EnableStage::GridConfig.into());
                }
                return Ok(auth);
            }
            Ok(Err(error)) => retryable_grid_config_error(&error),
            Err(_) => true,
        };
        if !retryable {
            return Err(EnableStage::GridConfig.into());
        }
        if let Some(delay) = retry_delays.get(attempt) {
            tokio::time::sleep(*delay).await;
        }
    }
    Err(EnableStage::GridConfigUnavailable.into())
}

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublicConfig {
    pub endpoint: String,
    pub issuer: String,
    pub native_client_id: String,
    pub spa_client_id: String,
    pub resource: String,
    pub cybergrid_url: String,
    pub frontend_origin: String,
}
impl Default for PublicConfig {
    fn default() -> Self {
        Self {
            endpoint: "https://auth.x.aixgg.com".into(),
            issuer: "https://auth.x.aixgg.com/oidc".into(),
            native_client_id: "x7lzj58abb1sdp16lkd34".into(),
            spa_client_id: "5ere2kbu9mugfu3xd8e90".into(),
            resource: "https://anywork-cybergrid-selfhost.vercel.app/api".into(),
            cybergrid_url: "https://anywork-cybergrid-selfhost.vercel.app".into(),
            frontend_origin: "https://anywork-tau.vercel.app".into(),
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
        for value in [
            &self.endpoint,
            &self.issuer,
            &self.resource,
            &self.cybergrid_url,
        ] {
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
    pub enabled: bool,
    pub busy: bool,
    pub error: Option<String>,
    pub grid_device_id: Option<String>,
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
}
struct GrantState {
    grant: Grant,
    invalid: bool,
    // A provider exchange may have rotated the grant, but its outcome is unknown.
    uncertain: bool,
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
}
impl GrantOwner {
    fn new(grant: Grant) -> Result<Self> {
        Ok(Self {
            remote_policy: std::sync::Mutex::new(RemotePolicy::default()),
            state: Mutex::new(GrantState {
                grant,
                invalid: false,
                uncertain: false,
            }),
            http: client()?,
        })
    }
    fn policy(&self) -> std::sync::MutexGuard<'_, RemotePolicy> {
        self.remote_policy.lock().unwrap_or_else(|e| e.into_inner())
    }
    async fn token(&self, resource: bool) -> Result<String> {
        let mut state = self.state.lock().await;
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
        // Unknown exchange outcomes block this RAM owner from replaying a
        // possibly rotated grant. Nothing is checkpointed to persistent storage.
        state.uncertain = true;
        let response = self
            .http
            .post(format!("{}/token", config.issuer))
            .form(&form)
            .send()
            .await?;
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
            state.uncertain = false;
        }
        if !successful || value.get("error").is_some() {
            if value["error"] == "invalid_grant" {
                state.invalid = true;
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
fn account_label(account: &Value, subject: &str) -> String {
    ["primaryEmail", "username", "name"]
        .iter()
        .find_map(|key| {
            account[*key].as_str().filter(|v| {
                !v.is_empty() && v.chars().count() <= 160 && !v.chars().any(char::is_control)
            })
        })
        .map(str::to_owned)
        .unwrap_or_else(|| format!("账号 {}", subject.chars().take(12).collect::<String>()))
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
    let binding = format!("{}\0{subject}", config.namespace(support)?);
    let directory = support.join("account-installations");
    if std::fs::symlink_metadata(&directory).is_ok_and(|m| m.file_type().is_symlink()) {
        bail!("INSTALLATION_ID_REJECTED")
    }
    let path = directory.join(format!("{:x}.json", Sha256::digest(binding.as_bytes())));
    let id = match std::fs::symlink_metadata(&path) {
        Ok(metadata) => {
            if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > 128 {
                bail!("INSTALLATION_ID_REJECTED")
            }
            serde_json::from_slice::<PublicIdentity>(&std::fs::read(&path)?)?.installation_id
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let id = uuid::Uuid::new_v4().to_string();
            config::atomic_private(
                &path,
                &serde_json::to_vec(&PublicIdentity {
                    installation_id: id.clone(),
                })?,
            )?;
            id
        }
        Err(error) => return Err(error.into()),
    };
    uuid::Uuid::parse_str(&id).map_err(|_| anyhow::anyhow!("INSTALLATION_ID_REJECTED"))?;
    Ok(id)
}
fn update_device_index(data: &mut Value, i: &Installation, grid_id: &str) -> Result<()> {
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
    let record = device_record(&data["anywork"]["devices"][&i.id], i, grid_id)?;
    data["anywork"]["devices"][&i.id] = record;
    if serde_json::to_vec(&data)?.len() > 32768 {
        bail!("ACCOUNT_DATA_LIMIT")
    };
    Ok(())
}
fn device_record(existing: &Value, installation: &Installation, grid_id: &str) -> Result<Value> {
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
        .filter(|label| {
            !label.is_empty()
                && label.encode_utf16().count() <= 80
                && !label.chars().any(|c| c <= '\u{1f}' || c == '\u{7f}')
        })
        .unwrap_or("AnyWork desktop");
    Ok(
        json!({"label":label,"platform":std::env::consts::OS,"publicKey":installation.public_key,"keyVersion":version,"gridDeviceId":grid_id}),
    )
}
impl cybergrid_sdk::AuthProvider for GrantOwner {
    fn access_token<'a>(
        &'a self,
        _client: &'a cybergrid_sdk::Client,
    ) -> cybergrid_sdk::AuthFuture<'a> {
        Box::pin(async move {
            self.token(true).await.map_err(|_| {
                cybergrid_sdk::Error::Credentials("Account authorization needs recovery".into())
            })
        })
    }
}
fn client() -> Result<reqwest::Client> {
    Ok(reqwest::Client::builder()
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
    provider: OwnedProcess,
    grid: Arc<cybergrid_sdk::Client>,
    watcher: tokio::task::JoinHandle<()>,
}
impl Remote {
    async fn close(&mut self) {
        self.gateway.close().await;
        self.watcher.abort();
        let _ = self.grid.close().await;
        self.provider.stop().await;
    }
}
struct State {
    installation: Option<Installation>,
    transaction: Option<Arc<Transaction>>,
    owner: Option<Arc<GrantOwner>>,
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
        Ok(Self(Arc::new(Inner {
            read_only,
            config,
            support,
            manager,
            state: Mutex::new(State {
                installation: None,
                transaction: None,
                owner: None,
                remote: None,
                snapshot: Snapshot::default(),
            }),
            operation: Mutex::new(()),
            account_write: Mutex::new(()),
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
            let reauth = if let Some(owner) = &owner {
                let grant = owner.state.lock().await;
                grant.invalid || grant.uncertain
            } else {
                false
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
            if let Some(owner) = &owner {
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
            scope: "openid profile offline_access custom_data connect".into(),
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
                tx.uncertain
                    .store(false, std::sync::atomic::Ordering::SeqCst);
            }
            if (200..300).contains(&status)
                && value.get("error").is_none()
                && value["access_token"]
                    .as_str()
                    .is_some_and(|v| !v.is_empty())
            {
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
        let grant = Grant {
            config: self.0.config.clone(),
            refresh: tokens.refresh_token,
            subject: subject.clone(),
        };
        let owner = Arc::new(GrantOwner::new(grant)?);
        // Explicit ACK transfers the only refresh ownership to this RAM owner.
        let mut state = self.0.state.lock().await;
        state.owner = Some(owner);
        state.transaction = None;
        tx.stop.cancel();
        state.snapshot.busy = false;
        state.snapshot.account_label = Some(account_label(&account, &subject));
        state.snapshot.subject = Some(subject);
        state.snapshot.signed_in = true;
        Ok("OwnedInMemory".into())
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
        };
        state.installation = Some(i.clone());
        Ok(i)
    }
    async fn publish_index(
        &self,
        owner: &Arc<GrantOwner>,
        i: &Installation,
        grid_id: &str,
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
        EnableStage::IndexSchema.at(update_device_index(&mut data, i, grid_id))?;
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
        if after["customData"] != data {
            return Err(EnableStage::IndexReadback.into());
        };
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
        let verifier = EnableStage::Gateway.at(JwtVerifier::new(
            self.0.config.issuer.clone(),
            self.0.config.resource.clone(),
            self.0.config.spa_client_id.clone(),
            subject,
        ))?;
        let private: [u8; 32] = URL_SAFE_NO_PAD
            .decode(&i.private_key)
            .map_err(|_| EnableStage::Identity)?
            .try_into()
            .map_err(|_| EnableStage::Identity)?;
        let watched_token = snapshot.token.clone();
        let mut gateway = EnableStage::Gateway.at(Gateway::start(GatewayConfig {
            installation_id: i.id.clone(),
            private_key: private,
            allowed_origins: vec![self.0.config.frontend_origin.clone()],
            local_port: snapshot.config.port,
            local_token: snapshot.token,
            verifier: Arc::new(verifier),
        })
        .await)?;
        let (tx, mut rx) = mpsc::channel(8);
        let prepared_provider = (|| {
            owner.policy().check(&generation)?;
            let binary = EnableStage::Provider.at(crate::cloudflared::resolve(
                &snapshot.config.cloudflared_binary,
                &self.0.support,
                &config::resources_dir(),
            ))?;
            let path = self.0.support.join("account-tunnel.yml");
            EnableStage::Provider.at(config::atomic_private(&path, b"{}\n"))?;
            let plan = LaunchPlan {
                program: binary,
                args: vec![
                    "tunnel".into(),
                    "--config".into(),
                    path.display().to_string(),
                    "--no-autoupdate".into(),
                    "--protocol".into(),
                    "http2".into(),
                    "--url".into(),
                    format!("http://127.0.0.1:{}", gateway.port),
                ],
                env: BTreeMap::new(),
                cwd: self.0.support.clone(),
            };
            EnableStage::Provider.at(OwnedProcess::spawn_account_provider(&plan, tx))
        })();
        let mut provider = match prepared_provider {
            Ok(provider) => provider,
            Err(error) => {
                gateway.close().await;
                return Err(error);
            }
        };
        let received = tokio::select! {
            biased;
            _ = stop.cancelled() => None,
            received = tokio::time::timeout(Duration::from_secs(45), rx.recv()) => received.ok().flatten(),
        };
        let url = match received {
            Some(url) => url,
            _ => {
                gateway.close().await;
                provider.stop().await;
                return Err(EnableStage::Provider.into());
            }
        };
        let grid =
            match EnableStage::GridClient.at(cybergrid_sdk::Client::new(cybergrid_sdk::Config {
                base_url: self.0.config.cybergrid_url.clone(),
                app_id: self.0.config.native_client_id.clone(),
                cloudflared: None,
                ..Default::default()
            })) {
                Ok(grid) => grid,
                Err(error) => {
                    gateway.close().await;
                    provider.stop().await;
                    return Err(error);
                }
            };
        // Client::new leaves grant_store=None in the pinned official SDK. Only
        // this RAM AuthProvider is installed: never call use_credential_store,
        // SDK browser login/import, or credential loading on the account path.
        grid.set_auth_provider(owner.clone()).await;
        let result = async {
            owner.policy().check(&generation)?;
            tokio::select! {
                biased;
                _ = stop.cancelled() => bail!("REMOTE_OPERATION_CANCELLED"),
                result = verified_grid_config(
                &grid,
                &self.0.config,
                Duration::from_secs(8),
                [Duration::from_millis(250), Duration::from_millis(750)],
                ) => { result?; }
            }
            owner.policy().check(&generation)?;
            let token = EnableStage::ResourceToken.at(owner.token(true).await)?;
            owner.policy().check(&generation)?;
            let session = EnableStage::GridRegister.at(grid
                .login_with_access_token(&token, "AnyWork desktop")
                .await)?;
            owner.policy().check(&generation)?;
            let mut port =
                cybergrid_sdk::Port::tcp("anywork-remote", gateway.port, "anywork-noise-v1");
            port.tunnel_url = Some(url);
            EnableStage::GridExpose.at(grid.expose(port).await)?;
            owner.policy().check(&generation)?;
            self.publish_index(&owner, &i, &session.device_id).await?;
            owner.policy().check(&generation)?;
            Ok::<_, anyhow::Error>(session.device_id)
        }
        .await;
        let device = match result {
            Ok(id) => id,
            Err(e) => {
                gateway.close().await;
                let _ = grid.close().await;
                provider.stop().await;
                return Err(e);
            }
        };
        // Provider URL changes invalidate the advertised path; close rather than
        // silently advertise an old URL or send business traffic in plaintext.
        let inner = Arc::downgrade(&self.0);
        let watched_owner = Arc::downgrade(&owner);
        let watched_generation = generation.clone();
        let watched_port = snapshot.config.port;
        let watcher = tokio::spawn(async move {
            loop {
                let changed = tokio::select! {event=rx.recv()=>event.is_none()||event.is_some(),_=tokio::time::sleep(Duration::from_millis(500))=>false};
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
                let failed = {
                    let mut state = inner.state.lock().await;
                    state.remote.as_mut().is_some_and(|remote| {
                        remote.provider.child.try_wait().ok().flatten().is_some()
                    })
                };
                if changed
                    || failed
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
        let mut pending = Some(Remote {
            gateway,
            provider,
            grid,
            watcher,
        });
        let installed = {
            let mut state = self.0.state.lock().await;
            let policy = owner.policy();
            if policy.check(&generation).is_ok() {
                state.remote = pending.take();
                state.snapshot.enabled = true;
                state.snapshot.grid_device_id = Some(device);
                state.snapshot.installation_id = Some(i.id.clone());
                state.snapshot.public_key = Some(i.public_key.clone());
                state.snapshot.error = None;
                true
            } else {
                false
            }
        };
        if !installed {
            pending.as_mut().unwrap().close().await;
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
        if let Some(owner) = &self.0.state.lock().await.owner {
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
        let remote = self.0.state.lock().await.remote.take();
        if let Some(mut remote) = remote {
            remote.close().await
        };
        let mut state = self.0.state.lock().await;
        state.snapshot.enabled = false;
        state.snapshot.grid_device_id = None;
        state.snapshot.installation_id = None;
        state.snapshot.public_key = None;
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
        let _grant = tx.operation.lock().await;
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
        let response = client()?
            .post(format!("{}/token/revocation", config.issuer))
            .form(&[
                ("client_id", config.native_client_id.as_str()),
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
        let _op = self.0.operation.lock().await;
        self.close_remote().await;
        let (owner, transaction) = {
            let state = self.0.state.lock().await;
            (state.owner.clone(), state.transaction.clone())
        };
        if let Some(tx) = &transaction {
            tx.stop.cancel();
        }
        // Wait for the sole broker request before revoking its latest rotation.
        let _transaction_operation = match &transaction {
            Some(tx) => Some(tx.operation.lock().await),
            None => None,
        };
        if let Some(owner) = owner {
            let state = owner.state.lock().await;
            Self::revoke_owned(&state.grant.config, &state.grant.refresh).await?;
        } else if let Some(refresh) = match &transaction {
            Some(tx) => tx.latest.lock().await.clone(),
            None => None,
        } {
            self.revoke(&refresh).await?;
        }
        let mut state = self.0.state.lock().await;
        if let Some(tx) = state.transaction.take() {
            tx.stop.cancel()
        };
        state.owner = None;
        state.installation = None;
        state.snapshot = Snapshot::default();
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
        };
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
        let valid = if let Some(u) = &url {
            u.path() == "/callback"
                && u.query_pairs()
                    .find(|(k, _)| k == "state")
                    .map(|(_, v)| v.into_owned())
                    == *tx.expected_state.lock().await
                && tx.expected_state.lock().await.is_some()
        } else {
            false
        };
        let body = if valid {
            "AnyWork sign-in received. Return to the desktop app."
        } else {
            "Invalid AnyWork sign-in callback."
        };
        let response = format!(
            "HTTP/1.1 {}\r\nContent-Type: text/plain; charset=utf-8\r\nCache-Control: no-store\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}",
            if valid { "200 OK" } else { "400 Bad Request" },
            body.len(),
            body
        );
        let _ = stream.write_all(response.as_bytes()).await;
        if valid {
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
        "LOCAL_SERVICE_NOT_READY" => "请先启动并连接本地服务。".into(),
        "ACCOUNT_REAUTH_REQUIRED" => "账号授权已失效，请退出账号后重新登录。".into(),
        _ => "账号操作未完成，请检查登录状态和网络后重试。".into(),
    }
}
#[tauri::command]
pub async fn account_snapshot(state: tauri::State<'_, Handle>) -> Result<Snapshot, String> {
    Ok(state.snapshot().await)
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
pub async fn account_enable(state: tauri::State<'_, Handle>) -> Result<(), String> {
    state.enable().await.map_err(safe_error)
}
#[tauri::command]
pub async fn account_enable_default(state: tauri::State<'_, Handle>) -> Result<(), String> {
    state.enable_default().await.map_err(safe_error)
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
#[path = "accounts_default_tests.rs"]
mod default_tests;
#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[tokio::test]
    #[ignore = "explicit public-network diagnostic, no account or credentials"]
    async fn public_grid_configuration_transport_probe() {
        let config = PublicConfig::default();
        let grid = cybergrid_sdk::Client::new(cybergrid_sdk::Config {
            base_url: config.cybergrid_url.clone(),
            app_id: config.native_client_id.clone(),
            ..Default::default()
        })
        .unwrap();
        let sdk = match tokio::time::timeout(Duration::from_secs(8), grid.auth_config()).await {
            Ok(Ok(auth)) => format!(
                "ok binding={}",
                auth.issuer == config.issuer
                    && auth.resource == config.resource
                    && auth.client_id == config.native_client_id
            ),
            Ok(Err(cybergrid_sdk::Error::Api { status, .. })) => format!("http_{status}"),
            Ok(Err(cybergrid_sdk::Error::Http(error))) => format!(
                "http_transport connect={} timeout={}",
                error.is_connect(),
                error.is_timeout()
            ),
            Ok(Err(_)) => "other_fixed_class".into(),
            Err(_) => "deadline".into(),
        };
        let mut url =
            url::Url::parse(&format!("{}/api/v1/auth/config", config.cybergrid_url)).unwrap();
        url.query_pairs_mut()
            .append_pair("appId", &config.native_client_id);
        let native =
            match tokio::time::timeout(Duration::from_secs(8), client().unwrap().get(url).send())
                .await
            {
                Ok(Ok(response)) => format!("http_{}", response.status().as_u16()),
                Ok(Err(error)) => format!(
                    "http_transport connect={} timeout={}",
                    error.is_connect(),
                    error.is_timeout()
                ),
                Err(_) => "deadline".into(),
            };
        println!("PUBLIC_CONFIG_PROBE sdk={sdk} native={native}");
        grid.close().await.unwrap();
    }

    pub(super) fn auth_config_fixture(config: &PublicConfig) -> Value {
        json!({
            "provider":"logto", "clientId":config.native_client_id,
            "issuer":config.issuer, "resource":config.resource,
            "scope":"openid offline_access connect",
            "deviceAuthorizationEndpoint":format!("{}/device/auth",config.issuer),
            "tokenEndpoint":format!("{}/token",config.issuer),
        })
    }

    #[tokio::test]
    async fn grid_config_retries_only_temporary_public_get_failures() {
        for (statuses, expected_calls, expected_code, malformed, wrong_field) in [
            (vec![503, 200], 2, None, false, None),
            (vec![429, 502, 200], 3, None, false, None),
            (
                vec![504],
                3,
                Some("REMOTE_ENABLE_GRID_CONFIG_UNAVAILABLE"),
                false,
                None,
            ),
            (vec![401], 1, Some("REMOTE_ENABLE_GRID_CONFIG"), false, None),
            (vec![403], 1, Some("REMOTE_ENABLE_GRID_CONFIG"), false, None),
            (vec![404], 1, Some("REMOTE_ENABLE_GRID_CONFIG"), false, None),
            (vec![200], 1, Some("REMOTE_ENABLE_GRID_CONFIG"), true, None),
            (
                vec![200],
                1,
                Some("REMOTE_ENABLE_GRID_CONFIG"),
                false,
                Some("issuer"),
            ),
            (
                vec![200],
                1,
                Some("REMOTE_ENABLE_GRID_CONFIG"),
                false,
                Some("resource"),
            ),
            (
                vec![200],
                1,
                Some("REMOTE_ENABLE_GRID_CONFIG"),
                false,
                Some("clientId"),
            ),
        ] {
            let config = PublicConfig::default();
            let mut body = auth_config_fixture(&config);
            if let Some(field) = wrong_field {
                body[field] = if field == "clientId" {
                    json!("other-native")
                } else {
                    json!("https://other.invalid")
                };
            }
            let body = if malformed {
                "private invalid JSON response".into()
            } else {
                body.to_string()
            };
            let requests = Arc::new(AtomicUsize::new(0));
            let unexpected = Arc::new(AtomicUsize::new(0));
            let (calls, other) = (requests.clone(), unexpected.clone());
            let app = axum::Router::new()
                .route(
                    "/api/v1/auth/config",
                    axum::routing::get(move |request: axum::extract::Request| {
                        let (statuses, body, calls) =
                            (statuses.clone(), body.clone(), calls.clone());
                        async move {
                            assert!(request.uri().query().unwrap().starts_with("appId="));
                            assert!(!request.headers().contains_key("authorization"));
                            let index = calls.fetch_add(1, Ordering::SeqCst);
                            (
                                axum::http::StatusCode::from_u16(
                                    statuses[index.min(statuses.len() - 1)],
                                )
                                .unwrap(),
                                body,
                            )
                        }
                    }),
                )
                .fallback(move || {
                    let other = other.clone();
                    async move {
                        other.fetch_add(1, Ordering::SeqCst);
                        axum::http::StatusCode::NOT_FOUND
                    }
                });
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
            let grid = cybergrid_sdk::Client::new(cybergrid_sdk::Config {
                base_url: format!("http://{address}"),
                app_id: config.native_client_id.clone(),
                ..Default::default()
            })
            .unwrap();
            let result =
                verified_grid_config(&grid, &config, Duration::from_secs(2), [Duration::ZERO; 2])
                    .await;
            match expected_code {
                Some(code) => assert_eq!(safe_error(result.unwrap_err()), code),
                None => assert_eq!(result.unwrap().issuer, config.issuer),
            }
            assert_eq!(requests.load(Ordering::SeqCst), expected_calls);
            assert_eq!(unexpected.load(Ordering::SeqCst), 0);
            grid.close().await.unwrap();
            server.abort();
        }
    }

    #[tokio::test]
    async fn grid_config_stalled_response_is_bounded_and_keeps_safe_diagnostics() {
        let calls = Arc::new(AtomicUsize::new(0));
        let requests = calls.clone();
        let app = axum::Router::new().route(
            "/api/v1/auth/config",
            axum::routing::get(move || {
                let requests = requests.clone();
                async move {
                    requests.fetch_add(1, Ordering::SeqCst);
                    tokio::time::sleep(Duration::from_secs(60)).await;
                    "private response must never become a diagnostic"
                }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let grid = cybergrid_sdk::Client::new(cybergrid_sdk::Config {
            base_url: format!("http://{address}"),
            app_id: "native-fixture".into(),
            ..Default::default()
        })
        .unwrap();
        let result = tokio::time::timeout(
            Duration::from_secs(2),
            verified_grid_config(
                &grid,
                &PublicConfig::default(),
                Duration::from_millis(30),
                [Duration::ZERO; 2],
            ),
        )
        .await
        .unwrap();
        assert_eq!(
            safe_error(result.unwrap_err()),
            "REMOTE_ENABLE_GRID_CONFIG_UNAVAILABLE"
        );
        assert_eq!(calls.load(Ordering::SeqCst), 3);
        grid.close().await.unwrap();
        server.abort();
    }

    #[tokio::test]
    async fn grid_config_connection_failure_is_retryable_and_never_exposes_url() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        drop(listener);
        let grid = cybergrid_sdk::Client::new(cybergrid_sdk::Config {
            base_url: format!("http://{address}"),
            app_id: "native-fixture".into(),
            ..Default::default()
        })
        .unwrap();
        let error = verified_grid_config(
            &grid,
            &PublicConfig::default(),
            Duration::from_secs(1),
            [Duration::ZERO; 2],
        )
        .await
        .unwrap_err();
        assert_eq!(error.chain().count(), 1);
        assert_eq!(safe_error(error), "REMOTE_ENABLE_GRID_CONFIG_UNAVAILABLE");
        grid.close().await.unwrap();
    }
    #[test]
    fn enable_stage_codes_discard_underlying_errors_before_ipc() {
        for (stage, code) in [
            (EnableStage::Identity, "REMOTE_ENABLE_IDENTITY"),
            (EnableStage::Gateway, "REMOTE_ENABLE_GATEWAY"),
            (EnableStage::Provider, "REMOTE_ENABLE_PROVIDER"),
            (EnableStage::GridClient, "REMOTE_ENABLE_GRID_CLIENT"),
            (EnableStage::GridConfig, "REMOTE_ENABLE_GRID_CONFIG"),
            (
                EnableStage::GridConfigUnavailable,
                "REMOTE_ENABLE_GRID_CONFIG_UNAVAILABLE",
            ),
            (EnableStage::ResourceToken, "REMOTE_ENABLE_RESOURCE_TOKEN"),
            (EnableStage::GridRegister, "REMOTE_ENABLE_GRID_REGISTER"),
            (EnableStage::GridExpose, "REMOTE_ENABLE_GRID_EXPOSE"),
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
            assert_eq!(stage.at::<_, String>(Ok(3)).unwrap(), 3);
        }
        let generic = safe_error(anyhow::anyhow!(
            "https://private.invalid/?token=never-display"
        ));
        assert!(!generic.contains("private.invalid") && !generic.contains("never-display"));
    }
    #[tokio::test]
    async fn actual_index_failures_have_specific_safe_stages_without_retries() {
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
                .route("/oidc/token", axum::routing::post(move || {
                    let calls = token_calls.clone();
                    async move {
                        calls.fetch_add(1, Ordering::SeqCst);
                        if stage == EnableStage::IndexToken {
                            (axum::http::StatusCode::BAD_GATEWAY, "private provider body".to_owned())
                        } else {
                            (axum::http::StatusCode::OK, json!({"access_token":"sample-access","refresh_token":"sample-rotated"}).to_string())
                        }
                    }
                }))
                .route("/api/my-account", axum::routing::get(move || {
                    let calls = get_reads.clone();
                    async move {
                        calls.fetch_add(1, Ordering::SeqCst);
                        if stage == EnableStage::IndexRead {
                            (axum::http::StatusCode::BAD_GATEWAY, "private read body".to_owned())
                        } else {
                            let data = if stage == EnableStage::IndexSchema {
                                json!({"anywork":{"schemaVersion":2,"devices":{}}})
                            } else { json!({}) };
                            // Readback intentionally returns old data after a successful PATCH.
                            (axum::http::StatusCode::OK, json!({"id":"sample-owner","customData":data}).to_string())
                        }
                    }
                }).patch(move || {
                    let calls = patch_writes.clone();
                    async move {
                        calls.fetch_add(1, Ordering::SeqCst);
                        let status = if stage == EnableStage::IndexWrite { axum::http::StatusCode::BAD_GATEWAY }
                        else { axum::http::StatusCode::OK };
                        (status, "{}")
                    }
                }));
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
                    h.publish_index(&owner, &installation, "sample-grid")
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
    fn handle(support: &std::path::Path) -> Handle {
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
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn native_ipc_requires_current_account_then_prepares_without_browser_ticket() {
        let dir = tempfile::tempdir().unwrap();
        let port = {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            listener.local_addr().unwrap().port()
        };
        // A real child process and HTTP boundary, confined to this fixture.
        let fixture = crate::test_service::Service::new(dir.path(), "normal");
        let config = config::Config {
            workspace: dir.path().display().to_string(),
            data_directory: dir.path().join("data").display().to_string(),
            server_binary: fixture.executable.display().to_string(),
            port,
            ..Default::default()
        };
        config::save(&dir.path().join("manager.json"), &config).unwrap();
        let cloud = PublicConfig {
            frontend_origin: "https://portal.example.test".into(),
            ..Default::default()
        };
        std::fs::write(
            dir.path().join("account-cloud.json"),
            serde_json::to_vec(&cloud).unwrap(),
        )
        .unwrap();
        let manager = manager::start(manager::Options {
            support: dir.path().into(),
            resources: dir.path().into(),
        })
        .unwrap();
        let account = Handle::new(dir.path().into(), manager.clone(), false).unwrap();
        let app = tauri::test::mock_builder()
            .manage(account.clone())
            .manage(crate::bridge::DesktopState {
                handle: manager.clone(),
                preview: None,
            })
            .manage(crate::updates::Handle::new(dir.path(), false))
            .invoke_handler(tauri::generate_handler![
                crate::bridge::desktop_start,
                crate::bridge::desktop_open,
                account_snapshot
            ])
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        let invoke = |cmd: &str| {
            tauri::test::get_ipc_response(
                &webview,
                tauri::webview::InvokeRequest {
                    cmd: cmd.into(),
                    callback: tauri::ipc::CallbackFn(0),
                    error: tauri::ipc::CallbackFn(1),
                    url: "tauri://localhost".parse().unwrap(),
                    body: tauri::ipc::InvokeBody::default(),
                    headers: Default::default(),
                    invoke_key: tauri::test::INVOKE_KEY.into(),
                },
            )
        };
        for status in [
            AuthorizationStatus::SignedOut,
            AuthorizationStatus::Authorizing,
            AuthorizationStatus::LoginInterrupted,
            AuthorizationStatus::ReauthRequired,
        ] {
            account.0.state.lock().await.snapshot.authorization_status = status;
            for command in ["desktop_start", "desktop_open"] {
                assert_eq!(
                    invoke(command).err(),
                    Some(json!("DESKTOP_SIGN_IN_REQUIRED"))
                );
            }
        }
        assert!(
            tokio::net::TcpStream::connect(("127.0.0.1", port))
                .await
                .is_err()
        );
        assert!(!dir.path().join("data/access-token").exists());
        let owner = Arc::new(
            GrantOwner::new(Grant {
                config: cloud,
                refresh: "synthetic-unused-grant".into(),
                subject: "fixture-owner".into(),
            })
            .unwrap(),
        );
        account.0.state.lock().await.owner = Some(owner.clone());
        let initial = invoke("account_snapshot")
            .unwrap()
            .deserialize::<Value>()
            .unwrap();
        assert_eq!(
            initial["accountPortalUrl"],
            "https://portal.example.test/app/"
        );
        assert_eq!(initial["remoteClients"], json!([]));
        assert!(initial["signedIn"].as_bool().unwrap());
        assert!(
            invoke("desktop_start")
                .unwrap_or_else(|error| panic!("{error:?}; {}", fixture.diagnostics()))
                .deserialize::<Value>()
                .unwrap()
                .is_null()
        );
        assert_eq!(fixture.status()["stage"], "ready");
        assert!(fixture.status()["authorizedInfoRequests"].as_u64().unwrap() > 0);
        assert_eq!(fixture.status()["unauthorizedInfoRequests"], 0);
        assert_eq!(fixture.status()["ticketRequests"], 0);
        assert!(manager.snapshot().owned && manager.snapshot().authorized);
        assert!(!manager.snapshot().external);
        assert!(!dir.path().join("data/unexpected-ticket").exists());
        // Reauthorization fences both new commands; an accepted local service
        // remains alive and unchanged. No browser is opened by this test.
        owner.state.lock().await.invalid = true;
        for command in ["desktop_start", "desktop_open"] {
            assert_eq!(
                invoke(command).err(),
                Some(json!("DESKTOP_SIGN_IN_REQUIRED"))
            );
        }
        assert!(
            tokio::net::TcpStream::connect(("127.0.0.1", port))
                .await
                .is_ok()
        );
        assert!(!dir.path().join("data/unexpected-ticket").exists());
        let token = config::read_token(&config);
        account.0.state.lock().await.owner = None;
        assert_eq!(
            invoke("desktop_start").err(),
            Some(json!("DESKTOP_SIGN_IN_REQUIRED"))
        );
        assert_eq!(config::read_token(&config), token);
        assert!(manager.snapshot().owned);
        manager.shutdown().await;
        assert!(
            tokio::net::TcpStream::connect(("127.0.0.1", port))
                .await
                .is_err()
        );
    }
    fn transaction() -> Arc<Transaction> {
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
        let app=axum::Router::new().route("/token",axum::routing::post(move |axum::Form(form):axum::Form<BTreeMap<String,String>>| {
            let latest=latest.clone();let calls=server_calls.clone();async move {
                let mut latest=latest.lock().await;
                assert_eq!(form.get("refresh_token"),Some(&*latest));
                let n=calls.fetch_add(1,Ordering::SeqCst)+1;*latest=format!("rotated-ram-{n}");
                if unknown { (axum::http::StatusCode::BAD_GATEWAY, "response lost".into()) }
                else { (axum::http::StatusCode::OK,json!({"access_token":"test-access","refresh_token":latest.clone()}).to_string()) }
            }
        }));
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
    #[tokio::test]
    async fn process_restart_has_no_account_but_same_public_id_and_fresh_keys() {
        let dir = tempfile::tempdir().unwrap();
        let first = handle(dir.path());
        let (owner, _) = provider(false).await;
        first.0.state.lock().await.owner = Some(owner);
        let i1 = first.installation("test-owner").await.unwrap();
        assert_eq!(
            first.installation("test-owner").await.unwrap().public_key,
            i1.public_key
        );
        assert!(first.snapshot().await.signed_in);
        drop(first);
        let second = handle(dir.path());
        let snapshot = second.snapshot().await;
        assert_eq!(
            snapshot.authorization_status,
            AuthorizationStatus::SignedOut
        );
        assert!(snapshot.subject.is_none() && !snapshot.enabled);
        assert!(second.0.state.lock().await.owner.is_none());
        let i2 = second.installation("test-owner").await.unwrap();
        assert_eq!(i1.id, i2.id);
        assert_ne!(i1.private_key, i2.private_key);
        assert_ne!(i1.public_key, i2.public_key);
        let paths = std::fs::read_dir(dir.path().join("account-installations"))
            .unwrap()
            .map(|p| p.unwrap().path())
            .collect::<Vec<_>>();
        assert_eq!(paths.len(), 1);
        let contents = std::fs::read_to_string(&paths[0]).unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&contents).unwrap(),
            json!({"installationId":i1.id})
        );
        for secret in [
            &i1.private_key,
            &i1.public_key,
            &i2.private_key,
            &i2.public_key,
            "initial-ram-grant",
            "test-owner",
        ] {
            assert!(!contents.contains(secret));
        }
        for _ in 0..4 {
            assert_eq!(
                handle(dir.path())
                    .installation("test-owner")
                    .await
                    .unwrap()
                    .id,
                i1.id
            );
        }
        assert_eq!(
            std::fs::read_dir(dir.path().join("account-installations"))
                .unwrap()
                .count(),
            1
        );
    }
    #[tokio::test]
    async fn owner_and_full_config_isolate_public_installations() {
        let dir = tempfile::tempdir().unwrap();
        let first = handle(dir.path());
        let a = first.installation("owner-a").await.unwrap();
        let b = first.installation("owner-b").await.unwrap();
        assert_ne!(a.id, b.id);
        assert_ne!(a.public_key, b.public_key);
        let config = PublicConfig {
            spa_client_id: "different-public-app".into(),
            ..Default::default()
        };
        std::fs::write(
            dir.path().join("account-cloud.json"),
            serde_json::to_vec(&config).unwrap(),
        )
        .unwrap();
        let changed = handle(dir.path()).installation("owner-a").await.unwrap();
        assert_ne!(a.id, changed.id);
    }
    #[test]
    fn public_identity_rejects_corruption_and_symlinks_without_replacing_them() {
        let dir = tempfile::tempdir().unwrap();
        let config = PublicConfig::default();
        public_installation_id(dir.path(), &config, "owner").unwrap();
        let directory = dir.path().join("account-installations");
        let path = std::fs::read_dir(&directory)
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        for corrupt in [
            "not json",
            r#"{"installationId":"not-a-uuid"}"#,
            r#"{"installationId":"00000000-0000-4000-8000-000000000001","refresh":"forbidden"}"#,
        ] {
            std::fs::write(&path, corrupt).unwrap();
            assert!(public_installation_id(dir.path(), &config, "owner").is_err());
            assert_eq!(std::fs::read_to_string(&path).unwrap(), corrupt);
        }
        std::fs::remove_file(&path).unwrap();
        let outside = dir.path().join("outside");
        std::fs::write(&outside, "untouched").unwrap();
        std::os::unix::fs::symlink(&outside, &path).unwrap();
        assert!(public_installation_id(dir.path(), &config, "owner").is_err());
        assert_eq!(std::fs::read_to_string(&outside).unwrap(), "untouched");
        std::fs::remove_file(&path).unwrap();
        std::fs::remove_dir(&directory).unwrap();
        std::os::unix::fs::symlink(dir.path(), &directory).unwrap();
        assert!(public_installation_id(dir.path(), &config, "owner").is_err());
    }
    #[tokio::test]
    async fn logout_keeps_ram_owner_on_revocation_failure_and_never_restores_it() {
        let calls = Arc::new(AtomicUsize::new(0));
        let server_calls = calls.clone();
        let app = axum::Router::new().route(
            "/token/revocation",
            axum::routing::post(
                move |axum::Form(form): axum::Form<BTreeMap<String, String>>| {
                    let calls = server_calls.clone();
                    async move {
                        assert_eq!(form["token"], "known-ram-grant");
                        if calls.fetch_add(1, Ordering::SeqCst) == 0 {
                            axum::http::StatusCode::SERVICE_UNAVAILABLE
                        } else {
                            axum::http::StatusCode::OK
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
        let dir = tempfile::tempdir().unwrap();
        let mut h = handle(dir.path());
        Arc::get_mut(&mut h.0).unwrap().config.issuer = format!("http://127.0.0.1:{port}");
        let owner = Arc::new(
            GrantOwner::new(Grant {
                config: h.0.config.clone(),
                refresh: "known-ram-grant".into(),
                subject: "owner".into(),
            })
            .unwrap(),
        );
        owner.state.lock().await.uncertain = true;
        h.0.state.lock().await.owner = Some(owner);
        assert!(h.logout().await.is_err());
        assert!(h.0.state.lock().await.owner.is_some());
        assert_eq!(
            h.snapshot().await.authorization_status,
            AuthorizationStatus::ReauthRequired
        );
        h.logout().await.unwrap();
        assert!(h.0.state.lock().await.owner.is_none());
        assert_eq!(calls.load(Ordering::SeqCst), 2);
        assert_eq!(
            handle(dir.path()).snapshot().await.authorization_status,
            AuthorizationStatus::SignedOut
        );
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
    }
    #[tokio::test]
    async fn restarting_updates_one_directory_record_and_increments_key_version() {
        let dir = tempfile::tempdir().unwrap();
        let i1 = handle(dir.path()).installation("owner").await.unwrap();
        let mut data = json!({"otherApp":{"keep":true},"anywork":{"schemaVersion":1,"preferences":{"appearance":"dark"},"devices":{}}});
        update_device_index(&mut data, &i1, "grid-1").unwrap();
        assert_eq!(data["anywork"]["devices"][&i1.id]["keyVersion"], 1);
        data["anywork"]["devices"][&i1.id]["label"] = json!("办公电脑");
        let i2 = handle(dir.path()).installation("owner").await.unwrap();
        update_device_index(&mut data, &i2, "grid-2").unwrap();
        assert_eq!(data["anywork"]["devices"].as_object().unwrap().len(), 1);
        let record = &data["anywork"]["devices"][&i1.id];
        assert_eq!(record["keyVersion"], 2);
        assert_eq!(record["publicKey"], i2.public_key);
        assert_eq!(record["label"], "办公电脑");
        update_device_index(&mut data, &i2, "grid-3").unwrap();
        assert_eq!(data["anywork"]["devices"][&i1.id]["keyVersion"], 2);
        assert_eq!(data["otherApp"], json!({"keep":true}));
        assert_eq!(data["anywork"]["preferences"], json!({"appearance":"dark"}));
        let mut exhausted = data["anywork"]["devices"][&i1.id].clone();
        exhausted["keyVersion"] = json!(9_007_199_254_740_991u64);
        assert!(device_record(&exhausted, &i1, "grid").is_err());
        exhausted["keyVersion"] = json!(0);
        assert!(device_record(&exhausted, &i2, "grid").is_err());
    }
    #[tokio::test]
    async fn interrupted_login_without_grant_can_cancel_and_no_secret_files_are_read() {
        let dir = tempfile::tempdir().unwrap();
        let old = dir.path().join("account-grant-v1");
        std::fs::write(&old, "ignored-old-sentinel").unwrap();
        let handle = handle(dir.path());
        let tx = transaction();
        handle.0.state.lock().await.transaction = Some(tx.clone());
        assert_eq!(
            handle.snapshot().await.authorization_status,
            AuthorizationStatus::Authorizing
        );
        tx.stop.cancel();
        assert_eq!(
            handle.snapshot().await.authorization_status,
            AuthorizationStatus::LoginInterrupted
        );
        handle.cancel(&tx.id).await.unwrap();
        assert_eq!(
            handle.snapshot().await.authorization_status,
            AuthorizationStatus::SignedOut
        );
        assert_eq!(
            std::fs::read_to_string(old).unwrap(),
            "ignored-old-sentinel"
        );
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }
    #[tokio::test]
    async fn broker_unknown_exchange_cannot_retry_the_code_or_grant() {
        let calls = Arc::new(AtomicUsize::new(0));
        let server_calls = calls.clone();
        let app = axum::Router::new().route(
            "/oidc/token",
            axum::routing::post(move || {
                let calls = server_calls.clone();
                async move {
                    calls.fetch_add(1, Ordering::SeqCst);
                    (axum::http::StatusCode::BAD_GATEWAY, "unknown result")
                }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        let dir = tempfile::tempdir().unwrap();
        let mut h = handle(dir.path());
        Arc::get_mut(&mut h.0).unwrap().config.issuer = format!("http://127.0.0.1:{port}/oidc");
        let tx = transaction();
        h.0.state.lock().await.transaction = Some(tx.clone());
        let request = || BrowserRequest {
            url: format!("{}/token", h.0.config.issuer),
            method: "POST".into(),
            headers: BTreeMap::new(),
            body: Some(format!(
                "grant_type=authorization_code&client_id={}",
                h.0.config.native_client_id
            )),
        };
        assert!(h.fetch(&tx.id, request()).await.is_err());
        assert!(h.fetch(&tx.id, request()).await.is_err());
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert_eq!(
            h.snapshot().await.authorization_status,
            AuthorizationStatus::LoginInterrupted
        );
        h.cancel(&tx.id).await.unwrap();
        assert_eq!(
            h.snapshot().await.authorization_status,
            AuthorizationStatus::SignedOut
        );
    }
    #[test]
    fn public_configuration_is_complete_validated_and_fully_isolated() {
        let dir = tempfile::tempdir().unwrap();
        let defaults = PublicConfig::load(dir.path()).unwrap();
        assert_eq!(
            serde_json::to_value(&defaults).unwrap(),
            json!({
                "endpoint":"https://auth.x.aixgg.com",
                "issuer":"https://auth.x.aixgg.com/oidc",
                "nativeClientId":"x7lzj58abb1sdp16lkd34",
                "spaClientId":"5ere2kbu9mugfu3xd8e90",
                "resource":"https://anywork-cybergrid-selfhost.vercel.app/api",
                "cybergridUrl":"https://anywork-cybergrid-selfhost.vercel.app",
                "frontendOrigin":"https://anywork-tau.vercel.app"
            })
        );
        let expected = defaults.namespace(dir.path()).unwrap();
        for field in [
            "endpoint",
            "issuer",
            "nativeClientId",
            "spaClientId",
            "resource",
            "cybergridUrl",
            "frontendOrigin",
        ] {
            let mut modified = serde_json::to_value(&defaults).unwrap();
            modified[field] = json!(format!("{}-different", modified[field].as_str().unwrap()));
            let changed: PublicConfig = serde_json::from_value(modified).unwrap();
            assert_ne!(changed.namespace(dir.path()).unwrap(), expected);
        }
        let custom = PublicConfig {
            endpoint: "https://identity.example.org".into(),
            issuer: "https://identity.example.org/oidc".into(),
            native_client_id: "self-native".into(),
            spa_client_id: "self-spa".into(),
            resource: "https://grid.example.org/api".into(),
            cybergrid_url: "https://grid.example.org".into(),
            frontend_origin: "https://work.example.org".into(),
        };
        let path = dir.path().join("account-cloud.json");
        std::fs::write(&path, serde_json::to_vec(&custom).unwrap()).unwrap();
        assert!(PublicConfig::load(dir.path()).unwrap() == custom);
        let mut incomplete = serde_json::to_value(custom).unwrap();
        incomplete.as_object_mut().unwrap().remove("spaClientId");
        std::fs::write(&path, serde_json::to_vec(&incomplete).unwrap()).unwrap();
        assert!(PublicConfig::load(dir.path()).is_err());
        let mut bad = defaults;
        bad.endpoint = "http://remote.invalid".into();
        assert!(bad.validate().is_err());
    }
    #[tokio::test]
    async fn self_hosted_default_does_not_reuse_cloud_installation_or_restore_an_account() {
        let dir = tempfile::tempdir().unwrap();
        let current = PublicConfig::default();
        let cloud = PublicConfig {
            endpoint: "https://ueg42e.logto.app".into(),
            issuer: "https://ueg42e.logto.app/oidc".into(),
            // Keep every other field identical to isolate the issuer boundary.
            ..current.clone()
        };
        cloud.validate().unwrap();
        let old_id = public_installation_id(dir.path(), &cloud, "same-owner").unwrap();
        let h = handle(dir.path());
        assert_eq!(
            h.snapshot().await.authorization_status,
            AuthorizationStatus::SignedOut
        );
        assert!(h.0.state.lock().await.owner.is_none());
        assert!(h.0.config == current);
        let new_id = h.installation("same-owner").await.unwrap().id;
        assert_ne!(new_id, old_id);
        assert_eq!(
            public_installation_id(dir.path(), &cloud, "same-owner").unwrap(),
            old_id
        );
        assert_eq!(
            public_installation_id(dir.path(), &current, "same-owner").unwrap(),
            new_id
        );
    }
    #[test]
    fn account_label_uses_existing_profile_or_short_subject_without_extra_request() {
        assert_eq!(
            account_label(
                &json!({"primaryEmail":"person@example.org","username":"name"}),
                "subject"
            ),
            "person@example.org"
        );
        assert_eq!(
            account_label(&json!({"username":"name"}), "subject"),
            "name"
        );
        assert_eq!(
            account_label(&json!({}), "abcdefghijklmnopqrst"),
            "账号 abcdefghijkl"
        );
    }
}
