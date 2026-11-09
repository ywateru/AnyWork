//! Native account lifecycle. This module owns all refresh operations; the SDK
//! only asks its AuthProvider for a resource access token.
use crate::{
    config::{self, OsSecrets, Secrets},
    manager,
    process::{LaunchPlan, OwnedProcess},
};
use anyhow::{Result, bail};
use anywork_remote::{AccountVerifier, Gateway, GatewayConfig, JwtVerifier};
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

const GRANT_KEY: &str = "account-grant-v1";
const PENDING_KEY: &str = "account-pending-v1";
const INSTALL_KEY: &str = "account-installation-v1";
const CALLBACK: &str = "http://127.0.0.1:17897/callback";
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
            endpoint: "https://ueg42e.logto.app".into(),
            issuer: "https://ueg42e.logto.app/oidc".into(),
            native_client_id: "xfo4o0pmacag9qui4mrmf".into(),
            spa_client_id: "4wu64isauau1xh9gkrh85".into(),
            resource: "https://anywork-cybergrid-dev.vercel.app/api".into(),
            cybergrid_url: "https://anywork-cybergrid-dev.vercel.app".into(),
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
    CheckpointPending,
    ReauthRequired,
    CleanupRequired,
}
#[derive(Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub authorization_status: AuthorizationStatus,
    pub transaction_id: Option<String>,
    pub signed_in: bool,
    pub subject: Option<String>,
    pub enabled: bool,
    pub busy: bool,
    pub checkpoint_pending: bool,
    pub error: Option<String>,
    pub grid_device_id: Option<String>,
    pub installation_id: Option<String>,
    pub public_key: Option<String>,
}
#[derive(Clone, Serialize, Deserialize)]
struct Grant {
    config: PublicConfig,
    refresh: String,
    subject: String,
}
#[derive(Serialize, Deserialize)]
struct Installation {
    config: PublicConfig,
    subject: String,
    id: String,
    private_key: String,
    public_key: String,
}
struct GrantState {
    grant: Grant,
    pending: bool,
    invalid: bool,
    // A provider exchange may have rotated the grant, but its outcome is unknown.
    uncertain: bool,
}
struct GrantOwner {
    state: Mutex<GrantState>,
    secrets: Arc<dyn Secrets>,
    http: reqwest::Client,
}
impl GrantOwner {
    fn new(grant: Grant, secrets: Arc<dyn Secrets>) -> Result<Self> {
        Ok(Self {
            state: Mutex::new(GrantState {
                grant,
                pending: false,
                invalid: false,
                uncertain: false,
            }),
            secrets,
            http: client()?,
        })
    }
    async fn token(&self, resource: bool) -> Result<String> {
        let mut state = self.state.lock().await;
        if state.invalid || state.uncertain {
            bail!("ACCOUNT_REAUTH_REQUIRED")
        }
        // Checkpoint retry happens before another provider operation, retaining
        // the latest rotation and never reading a stale persisted grant.
        if state.pending {
            self.secrets
                .write(GRANT_KEY, &serde_json::to_string(&state.grant)?)?;
            self.secrets.write(PENDING_KEY, "")?;
            state.pending = false;
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
        // Durable write-ahead uncertainty must precede the first network byte.
        // It contains the last known grant for best-effort revocation, never
        // evidence that this grant is still safe to refresh after process loss.
        self.secrets.write(
            PENDING_KEY,
            &json!({
                "config": config, "refresh": state.grant.refresh, "uncertain": true
            })
            .to_string(),
        )?;
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
            state.pending = true;
            self.secrets
                .write(GRANT_KEY, &serde_json::to_string(&state.grant)?)?;
            self.secrets.write(PENDING_KEY, "")?;
            state.pending = false;
        }
        if !successful || value.get("error").is_some() {
            if value["error"] == "invalid_grant" {
                state.invalid = true;
                self.secrets.write(GRANT_KEY, "")?;
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
// Shared by the real startup path and process-loss recovery tests.
fn restore_grant(secrets: &dyn Secrets, config: &PublicConfig) -> Result<Option<Grant>> {
    let saved = secrets.read(GRANT_KEY)?;
    let pending = secrets.read(PENDING_KEY)?;
    let grant = if saved.is_empty() {
        None
    } else {
        Some(
            serde_json::from_str::<Grant>(&saved)
                .map_err(|_| anyhow::anyhow!("SAVED_AUTHORIZATION_NEEDS_CLEANUP"))?,
        )
    };
    if !pending.is_empty() {
        let value: Value = serde_json::from_str(&pending)
            .map_err(|_| anyhow::anyhow!("PENDING_AUTHORIZATION_NEEDS_CLEANUP"))?;
        let expected_config = serde_json::to_value(config)?;
        if value.get("uncertain").is_some_and(|flag| flag != false)
            || !grant.as_ref().is_some_and(|grant| {
                grant.config == *config
                    && value["config"] == expected_config
                    && value["refresh"].as_str() == Some(grant.refresh.as_str())
            })
        {
            bail!("PENDING_AUTHORIZATION_NEEDS_CLEANUP")
        }
        secrets.write(PENDING_KEY, "")?;
    }
    if grant.as_ref().is_some_and(|grant| grant.config != *config) {
        bail!("ACCOUNT_CONFIG_CHANGED")
    }
    Ok(grant)
}
// Configuration changes may prevent sign-in restoration while leaving a known
// grant in this same Keychain namespace. Cleanup still revokes every known
// token, using only the current pinned issuer/client for its network request.
fn persisted_cleanup_tokens(secrets: &dyn Secrets, config: &PublicConfig) -> Result<Vec<String>> {
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Pending {
        config: PublicConfig,
        refresh: String,
        #[serde(default)]
        uncertain: bool,
    }
    let saved = secrets.read(GRANT_KEY)?;
    let pending = secrets.read(PENDING_KEY)?;
    let saved = if saved.is_empty() {
        None
    } else {
        Some(serde_json::from_str::<Grant>(&saved)?)
    };
    let pending = if pending.is_empty() {
        None
    } else {
        Some(serde_json::from_str::<Pending>(&pending)?)
    };
    let validate = |stored: &PublicConfig, refresh: &str| -> Result<()> {
        if stored.issuer != config.issuer
            || stored.native_client_id != config.native_client_id
            || stored.endpoint != config.endpoint
            || refresh.is_empty()
        {
            bail!("ACCOUNT_CONFIG_CHANGED")
        }
        Ok(())
    };
    if let Some(saved) = &saved {
        validate(&saved.config, &saved.refresh)?;
        if saved.subject.is_empty() {
            bail!("ACCOUNT_IDENTITY_MISMATCH")
        }
    }
    if let Some(pending) = &pending {
        validate(&pending.config, &pending.refresh)?;
    }
    let mut tokens = Vec::new();
    // For an uncertainty marker the grant may already contain a newer durable
    // checkpoint. A known broker escrow instead precedes any old saved grant.
    if let Some(pending) = &pending
        && !pending.uncertain
    {
        tokens.push(pending.refresh.clone());
    }
    if let Some(saved) = saved
        && !tokens.contains(&saved.refresh)
    {
        tokens.push(saved.refresh);
    }
    if let Some(pending) = pending
        && !tokens.contains(&pending.refresh)
    {
        tokens.push(pending.refresh);
    }
    Ok(tokens)
}
fn clear_saved_grant(secrets: &dyn Secrets) -> Result<()> {
    // Clearing the uncertainty marker first could expose a stale saved grant.
    secrets.write(GRANT_KEY, "")?;
    secrets.write(PENDING_KEY, "")?;
    Ok(())
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
    let record = device_record(&data["anywork"]["devices"][&i.id], i, grid_id);
    data["anywork"]["devices"][&i.id] = record;
    if serde_json::to_vec(&data)?.len() > 32768 {
        bail!("ACCOUNT_DATA_LIMIT")
    };
    Ok(())
}
fn device_record(existing: &Value, installation: &Installation, grid_id: &str) -> Value {
    let label = existing["label"]
        .as_str()
        .filter(|label| {
            !label.is_empty()
                && label.encode_utf16().count() <= 80
                && !label.chars().any(|c| c <= '\u{1f}' || c == '\u{7f}')
        })
        .unwrap_or("AnyWork desktop");
    json!({"label":label,"platform":std::env::consts::OS,"publicKey":installation.public_key,"keyVersion":1,"gridDeviceId":grid_id})
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
    secrets: Arc<dyn Secrets>,
    state: Mutex<State>,
    operation: Mutex<()>,
    account_write: Mutex<()>,
}
#[derive(Clone)]
pub struct Handle(Arc<Inner>);
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Begin {
    restored: bool,
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
struct AccountSecrets {
    prefix: String,
}
impl Secrets for AccountSecrets {
    fn read(&self, key: &str) -> Result<String> {
        OsSecrets.read(&format!("{}-{key}", self.prefix))
    }
    fn write(&self, key: &str, value: &str) -> Result<()> {
        OsSecrets.write(&format!("{}-{key}", self.prefix), value)
    }
}
impl Handle {
    pub fn new(support: PathBuf, manager: manager::Handle, read_only: bool) -> Result<Self> {
        let config = PublicConfig::load(&support)?;
        let prefix = config.namespace(&support)?;
        Ok(Self(Arc::new(Inner {
            read_only,
            config,
            support,
            manager,
            secrets: Arc::new(AccountSecrets { prefix }),
            state: Mutex::new(State {
                transaction: None,
                owner: None,
                remote: None,
                snapshot: Snapshot::default(),
            }),
            operation: Mutex::new(()),
            account_write: Mutex::new(()),
        })))
    }
    pub async fn snapshot(&self) -> Snapshot {
        let state = self.0.state.lock().await;
        let mut snapshot = state.snapshot.clone();
        snapshot.transaction_id = state.transaction.as_ref().map(|tx| tx.id.clone());
        if let Some(owner) = &state.owner {
            let grant = owner.state.lock().await;
            snapshot.checkpoint_pending = grant.pending;
            snapshot.signed_in = !grant.pending && !grant.invalid && !grant.uncertain;
            snapshot.authorization_status = if grant.invalid || grant.uncertain {
                snapshot.error = Some("本机授权需要重新登录，请先清理已知授权。".into());
                AuthorizationStatus::ReauthRequired
            } else if grant.pending {
                AuthorizationStatus::CheckpointPending
            } else {
                AuthorizationStatus::SignedIn
            };
        } else if let Some(tx) = &state.transaction {
            snapshot.busy = !tx.stop.is_cancelled();
            snapshot.authorization_status = if tx.stop.is_cancelled() {
                AuthorizationStatus::LoginInterrupted
            } else {
                AuthorizationStatus::Authorizing
            };
        }
        snapshot
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
        let restored = match restore_grant(self.0.secrets.as_ref(), &self.0.config) {
            Ok(grant) => grant,
            Err(error) => {
                if [
                    "PENDING_AUTHORIZATION_NEEDS_CLEANUP",
                    "SAVED_AUTHORIZATION_NEEDS_CLEANUP",
                    "ACCOUNT_CONFIG_CHANGED",
                ]
                .contains(&error.to_string().as_str())
                {
                    state.snapshot.authorization_status = AuthorizationStatus::CleanupRequired;
                    state.snapshot.error =
                        Some("本机保存的授权需要检查；可重试读取或清理已知授权。".into());
                }
                return Err(error);
            }
        };
        state.snapshot.authorization_status = AuthorizationStatus::SignedOut;
        state.snapshot.error = None;
        if let Some(grant) = restored {
            state.owner = Some(Arc::new(GrantOwner::new(
                grant.clone(),
                self.0.secrets.clone(),
            )?));
            state.snapshot.signed_in = true;
            state.snapshot.subject = Some(grant.subject);
            return Ok(self.begin_result(String::new(), true));
        }
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
        });
        state.transaction = Some(tx.clone());
        state.snapshot.busy = true;
        state.snapshot.error = None;
        let task_tx = tx.clone();
        tokio::spawn(async move {
            callback_listener(listener, task_tx).await;
        });
        Ok(self.begin_result(tx.id.clone(), false))
    }
    fn begin_result(&self, id: String, restored: bool) -> Begin {
        let c = &self.0.config;
        Begin {
            restored,
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
        let response = builder.send().await?;
        let status = response.status().as_u16();
        let body = String::from_utf8(bounded(response).await?)?;
        if token {
            let value: Value = serde_json::from_str(&body)?;
            if let Some(refresh) = value["refresh_token"].as_str().filter(|v| !v.is_empty()) {
                // Native escrow exists before a minted grant crosses IPC. A failed
                // keychain checkpoint leaves the only live transaction owner intact.
                *tx.latest.lock().await = Some(refresh.into());
                self.0.secrets.write(
                    PENDING_KEY,
                    &json!({"config":self.0.config,"refresh":refresh}).to_string(),
                )?;
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
        let owner = Arc::new(GrantOwner::new(grant.clone(), self.0.secrets.clone())?);
        let checkpoint = self
            .0
            .secrets
            .write(GRANT_KEY, &serde_json::to_string(&grant)?)
            .and_then(|_| self.0.secrets.write(PENDING_KEY, ""));
        if checkpoint.is_err() {
            owner.state.lock().await.pending = true;
        }
        // Ownership ACK even when the durable checkpoint failed. The pending
        // native owner survives JS clearAllTokens and blocks all new logins.
        let mut state = self.0.state.lock().await;
        state.owner = Some(owner);
        state.transaction = None;
        tx.stop.cancel();
        state.snapshot.busy = false;
        state.snapshot.subject = Some(subject);
        state.snapshot.signed_in = checkpoint.is_ok();
        if checkpoint.is_ok() {
            Ok("OwnedPersisted".into())
        } else {
            state.snapshot.checkpoint_pending = true;
            Ok("OwnedPending".into())
        }
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
    fn installation(&self, subject: &str) -> Result<Installation> {
        let raw = self.0.secrets.read(INSTALL_KEY)?;
        if !raw.is_empty() {
            let i: Installation = serde_json::from_str(&raw)?;
            if URL_SAFE_NO_PAD.decode(&i.private_key)?.len() != 32
                || URL_SAFE_NO_PAD.decode(&i.public_key)?.len() != 32
            {
                bail!("INSTALLATION_KEY_REJECTED")
            };
            if i.config == self.0.config && i.subject == subject {
                return Ok(i);
            }
        };
        let keys = snow::Builder::new(anywork_remote::NOISE_SUITE.parse()?).generate_keypair()?;
        let i = Installation {
            config: self.0.config.clone(),
            subject: subject.into(),
            id: uuid::Uuid::new_v4().to_string(),
            private_key: URL_SAFE_NO_PAD.encode(keys.private),
            public_key: URL_SAFE_NO_PAD.encode(keys.public),
        };
        self.0
            .secrets
            .write(INSTALL_KEY, &serde_json::to_string(&i)?)?;
        Ok(i)
    }
    async fn publish_index(
        &self,
        owner: &Arc<GrantOwner>,
        i: &Installation,
        grid_id: &str,
    ) -> Result<()> {
        let _write = self.0.account_write.lock().await;
        let token = owner.token(false).await?;
        let mut account = self
            .account_request(&token, reqwest::Method::GET, None)
            .await?;
        if account["id"].as_str() != Some(owner.state.lock().await.grant.subject.as_str()) {
            bail!("ACCOUNT_IDENTITY_MISMATCH")
        }
        let mut data = account["customData"].take();
        if data.is_null() {
            data = json!({})
        };
        update_device_index(&mut data, i, grid_id)?;
        self.account_request(
            &token,
            reqwest::Method::PATCH,
            Some(json!({"customData":data.clone()})),
        )
        .await?;
        let after = self
            .account_request(&token, reqwest::Method::GET, None)
            .await?;
        if after["customData"] != data {
            bail!("ACCOUNT_WRITE_CONFLICT")
        };
        Ok(())
    }
    pub async fn recover_checkpoint(&self) -> Result<()> {
        if self.0.read_only {
            bail!("ACCOUNT_PREVIEW_READ_ONLY")
        }
        let _op = self.0.operation.lock().await;
        let owner = self
            .0
            .state
            .lock()
            .await
            .owner
            .clone()
            .ok_or_else(|| anyhow::anyhow!("PENDING_AUTHORIZATION_NEEDS_CLEANUP"))?;
        let mut grant = owner.state.lock().await;
        if grant.invalid || grant.uncertain {
            bail!("ACCOUNT_REAUTH_REQUIRED")
        }
        self.0
            .secrets
            .write(GRANT_KEY, &serde_json::to_string(&grant.grant)?)?;
        self.0.secrets.write(PENDING_KEY, "")?;
        grant.pending = false;
        drop(grant);
        let mut state = self.0.state.lock().await;
        state.snapshot.signed_in = true;
        state.snapshot.checkpoint_pending = false;
        Ok(())
    }
    pub async fn enable(&self) -> Result<()> {
        if self.0.read_only {
            bail!("ACCOUNT_PREVIEW_READ_ONLY")
        }
        let _op = self.0.operation.lock().await;
        let snapshot = self.0.manager.snapshot();
        if !snapshot.authorized || snapshot.service != manager::Phase::Running {
            bail!("LOCAL_SERVICE_NOT_READY")
        }
        let owner = {
            let state = self.0.state.lock().await;
            if state.remote.is_some() {
                bail!("REMOTE_ALREADY_ENABLED")
            };
            state
                .owner
                .clone()
                .ok_or_else(|| anyhow::anyhow!("ACCOUNT_SIGN_IN_REQUIRED"))?
        };
        let subject = owner.state.lock().await.grant.subject.clone();
        let i = self.installation(&subject)?;
        let verifier = JwtVerifier::new(
            self.0.config.issuer.clone(),
            self.0.config.resource.clone(),
            self.0.config.spa_client_id.clone(),
            subject,
        )?;
        let private: [u8; 32] = URL_SAFE_NO_PAD
            .decode(&i.private_key)?
            .try_into()
            .map_err(|_| anyhow::anyhow!("INSTALLATION_KEY_REJECTED"))?;
        let watched_token = snapshot.token.clone();
        let mut gateway = Gateway::start(GatewayConfig {
            installation_id: i.id.clone(),
            private_key: private,
            allowed_origins: vec![self.0.config.frontend_origin.clone()],
            local_port: snapshot.config.port,
            local_token: snapshot.token,
            verifier: Arc::new(verifier),
        })
        .await?;
        let binary = crate::cloudflared::resolve(
            &snapshot.config.cloudflared_binary,
            &self.0.support,
            &config::resources_dir(),
        )?;
        let path = self.0.support.join("account-tunnel.yml");
        config::atomic_private(&path, b"{}\n")?;
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
        let (tx, mut rx) = mpsc::channel(8);
        let mut provider = OwnedProcess::spawn(&plan, Some((config::RouteKind::Quick, 1, tx)))?;
        let url = match tokio::time::timeout(Duration::from_secs(45), rx.recv()).await {
            Ok(Some(output)) => output.url,
            _ => {
                gateway.close().await;
                provider.stop().await;
                bail!("REMOTE_PROVIDER_NOT_READY")
            }
        };
        let grid = cybergrid_sdk::Client::new(cybergrid_sdk::Config {
            base_url: self.0.config.cybergrid_url.clone(),
            app_id: self.0.config.native_client_id.clone(),
            cloudflared: None,
            ..Default::default()
        })?;
        grid.set_auth_provider(owner.clone()).await;
        let result = async {
            let auth = grid.auth_config().await?;
            if auth.issuer != self.0.config.issuer
                || auth.resource != self.0.config.resource
                || auth.client_id != self.0.config.native_client_id
            {
                bail!("GRID_AUTH_CONFIG_MISMATCH")
            }
            let token = owner.token(true).await?;
            let session = grid
                .login_with_access_token(&token, "AnyWork desktop")
                .await?;
            let mut port =
                cybergrid_sdk::Port::tcp("anywork-remote", gateway.port, "anywork-noise-v1");
            port.tunnel_url = Some(url);
            grid.expose(port).await?;
            self.publish_index(&owner, &i, &session.device_id).await?;
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
        let watched_port = snapshot.config.port;
        let watcher = tokio::spawn(async move {
            loop {
                let changed = tokio::select! {event=rx.recv()=>event.is_none()||event.is_some(),_=tokio::time::sleep(Duration::from_millis(500))=>false};
                let Some(inner) = inner.upgrade() else { break };
                let local = inner.manager.snapshot();
                let invalid_owner = {
                    let state = inner.state.lock().await;
                    if let Some(owner) = &state.owner {
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
                        Handle(inner).disable().await;
                    });
                    break;
                }
            }
        });
        let mut state = self.0.state.lock().await;
        state.remote = Some(Remote {
            gateway,
            provider,
            grid,
            watcher,
        });
        state.snapshot.enabled = true;
        state.snapshot.grid_device_id = Some(device);
        state.snapshot.installation_id = Some(i.id.clone());
        state.snapshot.public_key = Some(i.public_key.clone());
        state.snapshot.error = None;
        Ok(())
    }
    pub async fn disable(&self) {
        let _op = self.0.operation.lock().await;
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
            self.0.secrets.write(PENDING_KEY, "")?;
        }
        let mut state = self.0.state.lock().await;
        state.transaction = None;
        state.snapshot.busy = false;
        state.snapshot.authorization_status = AuthorizationStatus::SignedOut;
        state.snapshot.error = None;
        Ok(())
    }
    async fn revoke(&self, refresh: &str) -> Result<()> {
        let response = client()?
            .post(format!("{}/token/revocation", self.0.config.issuer))
            .form(&[
                ("client_id", self.0.config.native_client_id.as_str()),
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
        self.disable().await;
        let _op = self.0.operation.lock().await;
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
            self.revoke(&state.grant.refresh).await?;
        } else if let Some(refresh) = match &transaction {
            Some(tx) => tx.latest.lock().await.clone(),
            None => None,
        } {
            self.revoke(&refresh).await?;
        } else {
            for refresh in persisted_cleanup_tokens(self.0.secrets.as_ref(), &self.0.config)? {
                self.revoke(&refresh).await?;
            }
        }
        clear_saved_grant(self.0.secrets.as_ref())?;
        let mut state = self.0.state.lock().await;
        if let Some(tx) = state.transaction.take() {
            tx.stop.cancel()
        };
        state.owner = None;
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
    match error.to_string().as_str() {
        "PENDING_AUTHORIZATION_NEEDS_CLEANUP" => "上次授权尚未收尾，请先退出账号并重试。".into(),
        "LOGIN_CALLBACK_PORT_IN_USE" => "登录回调端口已被占用，请关闭其他登录窗口后重试。".into(),
        "LOCAL_SERVICE_NOT_READY" => "请先启动并连接本地服务。".into(),
        "ACCOUNT_REAUTH_REQUIRED" => "账号授权已失效，请退出账号后重新登录。".into(),
        _ => "账号操作未完成，请检查登录状态、系统钥匙串和网络后重试。".into(),
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
pub async fn account_recover(state: tauri::State<'_, Handle>) -> Result<(), String> {
    state.recover_checkpoint().await.map_err(safe_error)
}
#[tauri::command]
pub async fn account_enable(state: tauri::State<'_, Handle>) -> Result<(), String> {
    state.enable().await.map_err(safe_error)
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
mod tests {
    use super::*;
    use std::{
        collections::HashMap,
        sync::{
            Mutex as SyncMutex,
            atomic::{AtomicBool, AtomicUsize, Ordering},
        },
    };
    #[derive(Default)]
    struct MemorySecrets {
        values: SyncMutex<HashMap<String, String>>,
        fail: AtomicBool,
        fail_grant: AtomicBool,
        fail_pending_clear: AtomicBool,
    }
    impl Secrets for MemorySecrets {
        fn read(&self, key: &str) -> Result<String> {
            Ok(self
                .values
                .lock()
                .unwrap()
                .get(key)
                .cloned()
                .unwrap_or_default())
        }
        fn write(&self, key: &str, value: &str) -> Result<()> {
            if self.fail.load(Ordering::SeqCst)
                || (key == GRANT_KEY && self.fail_grant.load(Ordering::SeqCst))
                || (key == PENDING_KEY
                    && value.is_empty()
                    && self.fail_pending_clear.load(Ordering::SeqCst))
            {
                bail!("CHECKPOINT_FAILED")
            };
            self.values.lock().unwrap().insert(key.into(), value.into());
            Ok(())
        }
    }
    async fn owner() -> (Arc<GrantOwner>, Arc<MemorySecrets>, Arc<AtomicUsize>) {
        let calls = Arc::new(AtomicUsize::new(0));
        let server_calls = calls.clone();
        let latest = Arc::new(Mutex::new("initial-test-refresh".to_string()));
        let app=axum::Router::new().route("/token",axum::routing::post(move|axum::Form(form):axum::Form<HashMap<String,String>>|{let latest=latest.clone();let calls=server_calls.clone();async move{let mut last=latest.lock().await;assert_eq!(form.get("refresh_token"),Some(&*last));let n=calls.fetch_add(1,Ordering::SeqCst)+1;*last=format!("rotated-test-{n}");axum::Json(json!({"access_token":"opaque-test-access","refresh_token":last.clone()}))}}));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        let secrets = Arc::new(MemorySecrets::default());
        let grant = Grant {
            config: PublicConfig {
                issuer: format!("http://127.0.0.1:{port}"),
                ..Default::default()
            },
            refresh: "initial-test-refresh".into(),
            subject: "test-owner".into(),
        };
        secrets
            .write(GRANT_KEY, &serde_json::to_string(&grant).unwrap())
            .unwrap();
        (
            Arc::new(GrantOwner::new(grant, secrets.clone()).unwrap()),
            secrets,
            calls,
        )
    }
    #[tokio::test]
    async fn one_refresh_owner_serializes_real_provider_rotations() {
        let (owner, secrets, calls) = owner().await;
        let mut tasks = Vec::new();
        for _ in 0..8 {
            let owner = owner.clone();
            tasks.push(tokio::spawn(
                async move { owner.token(false).await.unwrap() },
            ));
        }
        for task in tasks {
            assert_eq!(task.await.unwrap(), "opaque-test-access");
        }
        assert_eq!(calls.load(Ordering::SeqCst), 8);
        let saved: Grant = serde_json::from_str(&secrets.read(GRANT_KEY).unwrap()).unwrap();
        assert_eq!(saved.refresh, "rotated-test-8");
    }
    #[tokio::test]
    async fn failed_checkpoint_holds_latest_rotation_and_blocks_next_network_request() {
        let (owner, secrets, calls) = owner().await;
        secrets.fail_grant.store(true, Ordering::SeqCst);
        assert!(owner.token(false).await.is_err());
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert_eq!(owner.state.lock().await.grant.refresh, "rotated-test-1");
        assert!(owner.state.lock().await.pending);
        assert!(owner.token(false).await.is_err());
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        secrets.fail_grant.store(false, Ordering::SeqCst);
        assert_eq!(owner.token(false).await.unwrap(), "opaque-test-access");
        assert_eq!(calls.load(Ordering::SeqCst), 2);
        assert!(!owner.state.lock().await.pending);
    }
    #[tokio::test]
    async fn preflight_write_failure_sends_no_refresh_and_old_grant_can_restore() {
        let (owner, secrets, calls) = owner().await;
        let config = owner.state.lock().await.grant.config.clone();
        secrets.fail.store(true, Ordering::SeqCst);
        assert!(owner.token(false).await.is_err());
        assert_eq!(calls.load(Ordering::SeqCst), 0);
        assert!(!owner.state.lock().await.uncertain);
        drop(owner);
        secrets.fail.store(false, Ordering::SeqCst);
        assert_eq!(
            restore_grant(secrets.as_ref(), &config)
                .unwrap()
                .unwrap()
                .refresh,
            "initial-test-refresh"
        );
    }
    #[tokio::test]
    async fn lost_ram_after_rotation_checkpoint_failure_cannot_restore_old_grant() {
        let (owner, secrets, calls) = owner().await;
        let config = owner.state.lock().await.grant.config.clone();
        secrets.fail_grant.store(true, Ordering::SeqCst);
        assert!(owner.token(false).await.is_err());
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        let saved: Grant = serde_json::from_str(&secrets.read(GRANT_KEY).unwrap()).unwrap();
        assert_eq!(saved.refresh, "initial-test-refresh");
        assert_eq!(
            serde_json::from_str::<Value>(&secrets.read(PENDING_KEY).unwrap()).unwrap()["uncertain"],
            true
        );
        drop(owner); // Only persistent state remains.
        secrets.fail_grant.store(false, Ordering::SeqCst);
        assert!(restore_grant(secrets.as_ref(), &config).is_err());
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }
    #[tokio::test]
    async fn pending_clear_failure_blocks_restart_even_after_new_grant_saved() {
        let (owner, secrets, calls) = owner().await;
        let config = owner.state.lock().await.grant.config.clone();
        secrets.fail_pending_clear.store(true, Ordering::SeqCst);
        assert!(owner.token(false).await.is_err());
        assert!(owner.state.lock().await.pending);
        assert!(owner.token(false).await.is_err());
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        let saved: Grant = serde_json::from_str(&secrets.read(GRANT_KEY).unwrap()).unwrap();
        assert_eq!(saved.refresh, "rotated-test-1");
        drop(owner);
        secrets.fail_pending_clear.store(false, Ordering::SeqCst);
        assert!(restore_grant(secrets.as_ref(), &config).is_err());
    }
    #[tokio::test]
    async fn successful_checkpoint_clears_uncertainty_and_restores_latest_grant() {
        let (owner, secrets, _) = owner().await;
        let config = owner.state.lock().await.grant.config.clone();
        owner.token(true).await.unwrap();
        assert!(secrets.read(PENDING_KEY).unwrap().is_empty());
        drop(owner);
        assert_eq!(
            restore_grant(secrets.as_ref(), &config)
                .unwrap()
                .unwrap()
                .refresh,
            "rotated-test-1"
        );
    }
    #[tokio::test]
    async fn process_loss_during_provider_exchange_leaves_restore_blocked() {
        let reached = Arc::new(Notify::new());
        let reached_handler = reached.clone();
        let app = axum::Router::new().route(
            "/token",
            axum::routing::post(move || {
                let reached = reached_handler.clone();
                async move {
                    reached.notify_one();
                    std::future::pending::<String>().await
                }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        let secrets = Arc::new(MemorySecrets::default());
        let grant = Grant {
            config: PublicConfig {
                issuer: format!("http://127.0.0.1:{port}"),
                ..Default::default()
            },
            refresh: "old".into(),
            subject: "owner".into(),
        };
        let config = grant.config.clone();
        secrets
            .write(GRANT_KEY, &serde_json::to_string(&grant).unwrap())
            .unwrap();
        let owner = Arc::new(GrantOwner::new(grant, secrets.clone()).unwrap());
        let task_owner = owner.clone();
        let operation = tokio::spawn(async move { task_owner.token(false).await });
        tokio::time::timeout(Duration::from_secs(2), reached.notified())
            .await
            .unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&secrets.read(PENDING_KEY).unwrap()).unwrap()["uncertain"],
            true
        );
        operation.abort();
        let _ = operation.await;
        drop(owner);
        assert!(restore_grant(secrets.as_ref(), &config).is_err());
        server.abort();
    }
    #[tokio::test]
    async fn unknown_provider_outcome_blocks_live_and_restored_refresh() {
        let app = axum::Router::new().route(
            "/token",
            axum::routing::post(|| async {
                (axum::http::StatusCode::BAD_GATEWAY, "lost provider outcome")
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        let secrets = Arc::new(MemorySecrets::default());
        let grant = Grant {
            config: PublicConfig {
                issuer: format!("http://127.0.0.1:{port}"),
                ..Default::default()
            },
            refresh: "old".into(),
            subject: "owner".into(),
        };
        secrets
            .write(GRANT_KEY, &serde_json::to_string(&grant).unwrap())
            .unwrap();
        let config = grant.config.clone();
        let owner = GrantOwner::new(grant, secrets.clone()).unwrap();
        assert!(owner.token(false).await.is_err());
        assert!(owner.state.lock().await.uncertain);
        assert!(owner.token(false).await.is_err());
        drop(owner);
        assert!(restore_grant(secrets.as_ref(), &config).is_err());
    }
    #[test]
    fn logout_cleanup_never_exposes_stale_grant_if_marker_clear_fails() {
        let secrets = MemorySecrets::default();
        let config = PublicConfig::default();
        let grant = Grant {
            config: config.clone(),
            refresh: "old".into(),
            subject: "owner".into(),
        };
        secrets
            .write(GRANT_KEY, &serde_json::to_string(&grant).unwrap())
            .unwrap();
        secrets
            .write(
                PENDING_KEY,
                &json!({"config":config,"refresh":"old","uncertain":true}).to_string(),
            )
            .unwrap();
        secrets.fail_grant.store(true, Ordering::SeqCst);
        assert!(clear_saved_grant(&secrets).is_err());
        assert!(!secrets.read(PENDING_KEY).unwrap().is_empty());
        assert!(restore_grant(&secrets, &config).is_err());
        secrets.fail_grant.store(false, Ordering::SeqCst);
        secrets.fail_pending_clear.store(true, Ordering::SeqCst);
        assert!(clear_saved_grant(&secrets).is_err());
        assert!(secrets.read(GRANT_KEY).unwrap().is_empty());
        assert!(restore_grant(&secrets, &config).is_err());
        secrets.fail_pending_clear.store(false, Ordering::SeqCst);
        clear_saved_grant(&secrets).unwrap();
        assert!(restore_grant(&secrets, &config).unwrap().is_none());
    }
    async fn cleanup_handle(
        status: axum::http::StatusCode,
    ) -> (Handle, Arc<MemorySecrets>, Arc<SyncMutex<Vec<String>>>) {
        let calls = Arc::new(SyncMutex::new(Vec::new()));
        let server_calls = calls.clone();
        let app = axum::Router::new().route(
            "/oidc/token/revocation",
            axum::routing::post(
                move |axum::Form(form): axum::Form<HashMap<String, String>>| {
                    let calls = server_calls.clone();
                    async move {
                        assert_eq!(
                            form.get("client_id").map(String::as_str),
                            Some("cleanup-client")
                        );
                        calls.lock().unwrap().push(form["token"].clone());
                        status
                    }
                },
            ),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        // Tests construct the private state directly; production Handle::new
        // still validates HTTPS public config and uses the OS secret store.
        let config = PublicConfig {
            endpoint: format!("http://127.0.0.1:{port}"),
            issuer: format!("http://127.0.0.1:{port}/oidc"),
            native_client_id: "cleanup-client".into(),
            ..Default::default()
        };
        let secrets = Arc::new(MemorySecrets::default());
        let manager = manager::Handle::preview(manager::Snapshot::new(
            config::Config::default(),
            String::new(),
        ));
        let handle = Handle(Arc::new(Inner {
            read_only: false,
            config,
            support: PathBuf::from("/isolated-unused-test-home"),
            manager,
            secrets: secrets.clone(),
            state: Mutex::new(State {
                transaction: None,
                owner: None,
                remote: None,
                snapshot: Snapshot::default(),
            }),
            operation: Mutex::new(()),
            account_write: Mutex::new(()),
        }));
        (handle, secrets, calls)
    }
    fn persist_cleanup_grant(handle: &Handle, secrets: &MemorySecrets, changed: bool) -> Grant {
        let mut config = handle.0.config.clone();
        if changed {
            config.frontend_origin = "https://old-frontend.invalid".into();
            config.resource = "https://old-resource.invalid/api".into();
        }
        let grant = Grant {
            config,
            refresh: "persisted-only-grant".into(),
            subject: "test-owner".into(),
        };
        secrets
            .write(GRANT_KEY, &serde_json::to_string(&grant).unwrap())
            .unwrap();
        grant
    }
    #[tokio::test]
    async fn fresh_owner_logout_revokes_saved_grant_after_public_config_change() {
        let (handle, secrets, calls) = cleanup_handle(axum::http::StatusCode::OK).await;
        persist_cleanup_grant(&handle, &secrets, true);
        assert!(handle.begin().await.is_err()); // No RAM owner after config mismatch.
        assert_eq!(
            handle.snapshot().await.authorization_status,
            AuthorizationStatus::CleanupRequired
        );
        assert!(handle.0.state.lock().await.owner.is_none());
        handle.logout().await.unwrap();
        assert_eq!(*calls.lock().unwrap(), vec!["persisted-only-grant"]);
        assert!(secrets.read(GRANT_KEY).unwrap().is_empty());
        assert!(secrets.read(PENDING_KEY).unwrap().is_empty());
    }
    #[tokio::test]
    async fn fresh_owner_logout_preserves_saved_grant_when_revocation_fails() {
        let (handle, secrets, calls) =
            cleanup_handle(axum::http::StatusCode::SERVICE_UNAVAILABLE).await;
        persist_cleanup_grant(&handle, &secrets, false);
        let before = secrets.read(GRANT_KEY).unwrap();
        assert!(handle.logout().await.is_err());
        assert_eq!(*calls.lock().unwrap(), vec!["persisted-only-grant"]);
        assert_eq!(secrets.read(GRANT_KEY).unwrap(), before);
        assert!(secrets.read(PENDING_KEY).unwrap().is_empty());
        secrets
            .write(
                PENDING_KEY,
                &json!({"config":handle.0.config,"refresh":"older-last-known","uncertain":true})
                    .to_string(),
            )
            .unwrap();
        let pending_before = secrets.read(PENDING_KEY).unwrap();
        assert!(handle.logout().await.is_err());
        assert_eq!(secrets.read(GRANT_KEY).unwrap(), before);
        assert_eq!(secrets.read(PENDING_KEY).unwrap(), pending_before);
        assert!(restore_grant(secrets.as_ref(), &handle.0.config).is_err());
    }
    #[tokio::test]
    async fn fresh_owner_logout_rejects_foreign_namespace_without_deleting_it() {
        let (handle, secrets, calls) = cleanup_handle(axum::http::StatusCode::OK).await;
        let grant = persist_cleanup_grant(&handle, &secrets, false);
        for field in ["client", "issuer", "endpoint"] {
            let mut foreign = grant.clone();
            match field {
                "client" => foreign.config.native_client_id = "foreign-client".into(),
                "issuer" => foreign.config.issuer = "https://foreign.invalid/oidc".into(),
                _ => foreign.config.endpoint = "https://foreign.invalid".into(),
            }
            secrets
                .write(GRANT_KEY, &serde_json::to_string(&foreign).unwrap())
                .unwrap();
            let before = secrets.read(GRANT_KEY).unwrap();
            assert!(handle.logout().await.is_err());
            assert!(calls.lock().unwrap().is_empty());
            assert_eq!(secrets.read(GRANT_KEY).unwrap(), before);
        }
    }
    #[tokio::test]
    async fn fresh_owner_logout_revokes_saved_checkpoint_and_uncertain_last_known_token() {
        let (handle, secrets, calls) = cleanup_handle(axum::http::StatusCode::OK).await;
        let grant = persist_cleanup_grant(&handle, &secrets, false);
        secrets
            .write(
                PENDING_KEY,
                &json!({"config":grant.config,"refresh":"older-last-known","uncertain":true})
                    .to_string(),
            )
            .unwrap();
        assert!(handle.begin().await.is_err());
        handle.logout().await.unwrap();
        assert_eq!(
            *calls.lock().unwrap(),
            vec!["persisted-only-grant", "older-last-known"]
        );
        assert!(secrets.read(GRANT_KEY).unwrap().is_empty());
        assert!(secrets.read(PENDING_KEY).unwrap().is_empty());
    }
    #[test]
    fn republish_preserves_alias_and_refreshes_public_metadata() {
        let installation = Installation {
            config: PublicConfig::default(),
            subject: "owner".into(),
            id: "installation".into(),
            private_key: "private-fixture".into(),
            public_key: "new-public".into(),
        };
        let existing =
            json!({"label":"我的工作电脑","publicKey":"old-public","gridDeviceId":"old-grid"});
        let updated = device_record(&existing, &installation, "new-grid");
        assert_eq!(updated["label"], existing["label"]);
        assert_eq!(updated["publicKey"], "new-public");
        assert_eq!(updated["gridDeviceId"], "new-grid");
        let mut data = json!({"anotherApp":{"keep":"untouched"},"anywork":{"schemaVersion":1,"preferences":{"appearance":"dark"},"devices":{"installation":existing,"other":{"label":"other-device"}}}});
        update_device_index(&mut data, &installation, "new-grid").unwrap();
        assert_eq!(data["anywork"]["devices"]["installation"], updated);
        assert_eq!(data["anotherApp"], json!({"keep":"untouched"}));
        assert_eq!(data["anywork"]["preferences"], json!({"appearance":"dark"}));
        assert_eq!(
            data["anywork"]["devices"]["other"],
            json!({"label":"other-device"})
        );
        for label in [
            json!(null),
            json!(""),
            json!("bad\nlabel"),
            json!("x".repeat(81)),
        ] {
            assert_eq!(
                device_record(&json!({"label":label}), &installation, "grid")["label"],
                "AnyWork desktop"
            );
        }
    }
    #[tokio::test]
    async fn malformed_provider_success_retains_rotation_before_rejecting_token() {
        let app = axum::Router::new().route(
            "/token",
            axum::routing::post(|| async {
                axum::Json(json!({"refresh_token":"newest-without-access"}))
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        let secrets = Arc::new(MemorySecrets::default());
        let owner = GrantOwner::new(
            Grant {
                config: PublicConfig {
                    issuer: format!("http://127.0.0.1:{port}"),
                    ..Default::default()
                },
                refresh: "previous".into(),
                subject: "owner".into(),
            },
            secrets.clone(),
        )
        .unwrap();
        assert!(owner.token(false).await.is_err());
        let saved: Grant = serde_json::from_str(&secrets.read(GRANT_KEY).unwrap()).unwrap();
        assert_eq!(saved.refresh, "newest-without-access");
        assert_eq!(owner.state.lock().await.grant.refresh, saved.refresh);
    }
    #[tokio::test]
    async fn interrupted_login_without_grant_can_cancel_back_to_signed_out() {
        let (handle, _, _) = cleanup_handle(axum::http::StatusCode::OK).await;
        let tx = Arc::new(Transaction {
            id: "test-login".into(),
            expected_state: Mutex::new(None),
            callback: Mutex::new(None),
            notify: Notify::new(),
            stop: CancellationToken::new(),
            operation: Mutex::new(()),
            latest: Mutex::new(None),
        });
        handle.0.state.lock().await.transaction = Some(tx.clone());
        assert_eq!(
            handle.snapshot().await.authorization_status,
            AuthorizationStatus::Authorizing
        );
        // A failed network request is not evidence of a grant or cleanup state.
        let response = handle
            .fetch(
                &tx.id,
                BrowserRequest {
                    url: format!("{}/jwks", handle.0.config.issuer),
                    method: "GET".into(),
                    headers: BTreeMap::new(),
                    body: None,
                },
            )
            .await
            .unwrap();
        assert_eq!(response.status, 404);
        assert_eq!(
            handle.snapshot().await.authorization_status,
            AuthorizationStatus::Authorizing
        );
        tx.stop.cancel(); // Models the bounded callback timeout.
        let interrupted = handle.snapshot().await;
        assert_eq!(
            interrupted.authorization_status,
            AuthorizationStatus::LoginInterrupted
        );
        assert_eq!(interrupted.transaction_id.as_deref(), Some("test-login"));
        handle.cancel(&tx.id).await.unwrap();
        let after = handle.snapshot().await;
        assert_eq!(after.authorization_status, AuthorizationStatus::SignedOut);
        assert!(!after.busy && !after.signed_in && !after.checkpoint_pending);
        assert!(after.transaction_id.is_none());
    }
    #[tokio::test]
    async fn checkpoint_and_uncertain_grants_remain_explicit_recovery_states() {
        let (handle, secrets, _) = cleanup_handle(axum::http::StatusCode::OK).await;
        let grant = persist_cleanup_grant(&handle, &secrets, false);
        let owner = Arc::new(GrantOwner::new(grant, secrets).unwrap());
        handle.0.state.lock().await.owner = Some(owner.clone());
        assert_eq!(
            handle.snapshot().await.authorization_status,
            AuthorizationStatus::SignedIn
        );
        owner.state.lock().await.pending = true;
        let pending = handle.snapshot().await;
        assert_eq!(
            pending.authorization_status,
            AuthorizationStatus::CheckpointPending
        );
        assert!(!pending.signed_in && pending.checkpoint_pending);
        {
            let mut state = owner.state.lock().await;
            state.pending = false;
            state.uncertain = true;
        }
        assert_eq!(
            handle.snapshot().await.authorization_status,
            AuthorizationStatus::ReauthRequired
        );
        assert!(handle.recover_checkpoint().await.is_err());
    }
    #[test]
    fn development_defaults_and_complete_self_hosted_override_are_validated() {
        let dir = tempfile::tempdir().unwrap();
        let defaults = PublicConfig::load(dir.path()).unwrap();
        assert_eq!(defaults.endpoint, "https://ueg42e.logto.app");
        assert_eq!(
            defaults.cybergrid_url,
            "https://anywork-cybergrid-dev.vercel.app"
        );
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
        let mut incomplete = serde_json::to_value(&custom).unwrap();
        incomplete.as_object_mut().unwrap().remove("spaClientId");
        std::fs::write(&path, serde_json::to_vec(&incomplete).unwrap()).unwrap();
        assert!(PublicConfig::load(dir.path()).is_err());
        let mut insecure = custom;
        insecure.endpoint = "http://identity.example.org".into();
        std::fs::write(&path, serde_json::to_vec(&insecure).unwrap()).unwrap();
        assert!(PublicConfig::load(dir.path()).is_err());
    }
    #[test]
    fn all_public_config_changes_isolate_grant_and_installation_namespace() {
        let support = std::path::Path::new("/isolated-manager");
        let defaults = PublicConfig::default();
        let expected = defaults.namespace(support).unwrap();
        assert_eq!(expected, defaults.clone().namespace(support).unwrap());
        for key in [
            "endpoint",
            "issuer",
            "nativeClientId",
            "spaClientId",
            "resource",
            "cybergridUrl",
            "frontendOrigin",
        ] {
            let mut changed = serde_json::to_value(&defaults).unwrap();
            changed[key] = json!(format!("{}-changed", changed[key].as_str().unwrap()));
            let config: PublicConfig = serde_json::from_value(changed).unwrap();
            assert_ne!(config.namespace(support).unwrap(), expected, "{key}");
        }
        assert_ne!(
            defaults
                .namespace(std::path::Path::new("/another-manager"))
                .unwrap(),
            expected
        );
    }
    #[test]
    fn public_configuration_rejects_insecure_or_crossissuer_endpoints() {
        let mut config = PublicConfig::default();
        assert!(config.validate().is_ok());
        config.endpoint = "http://remote.invalid".into();
        assert!(config.validate().is_err());
        let config = PublicConfig {
            issuer: "https://other.invalid/oidc".into(),
            ..Default::default()
        };
        assert!(config.validate().is_err());
    }
}
