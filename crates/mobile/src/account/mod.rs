//! Mobile account boundary: Kotlin is the sole OAuth owner; Rust owns directory
//! requests and account epochs. No refresh/ID token is accepted by this module.
use anyhow::{Result, bail, ensure};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    future::Future,
    pin::Pin,
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{Emitter, Runtime};
use tauri_plugin_mobile_auth::{MobileAuthExt, Snapshot as NativeSnapshot};
use tokio::sync::{Mutex, OnceCell};

#[cfg(any(target_os = "android", test))]
mod grid;
mod trust;
mod types;
#[cfg(not(any(target_os = "android", test)))]
mod grid {
    use super::*;
    pub(super) struct NativeDirectory;
    impl NativeDirectory {
        pub fn epoch(&self) -> u64 {
            0
        }
        pub async fn close(self) -> bool {
            true
        }
    }
    pub(super) async fn devices(_: &Handle, _: u64, _: &str) -> Result<Vec<GridDevice>> {
        bail!("SYSTEM_UNAVAILABLE")
    }
}
use tauri::Manager;
use tokio_util::sync::CancellationToken;
use trust::{Pin as TrustPin, TrustStore};
pub use types::*;
type AuthFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T>> + Send + 'a>>;

/// Native backend is injectable for protocol/lifecycle tests without an account.
pub trait AuthBackend: Send + Sync {
    fn configure(
        &self,
        config: tauri_plugin_mobile_auth::Configuration,
    ) -> AuthFuture<'_, NativeSnapshot>;
    fn snapshot(&self) -> AuthFuture<'_, NativeSnapshot>;
    fn sign_in(&self, register: bool) -> AuthFuture<'_, NativeSnapshot>;
    fn logout(&self) -> AuthFuture<'_, NativeSnapshot>;
    fn profile(&self, generation: u64) -> AuthFuture<'_, NativeSnapshot>;
    fn token(
        &self,
        generation: u64,
        resource: bool,
        force: bool,
        validity: u64,
    ) -> AuthFuture<'_, tauri_plugin_mobile_auth::AccessGrant>;
}

struct NativeBackend<R: Runtime>(tauri::AppHandle<R>);
impl<R: Runtime> AuthBackend for NativeBackend<R> {
    fn configure(
        &self,
        config: tauri_plugin_mobile_auth::Configuration,
    ) -> AuthFuture<'_, NativeSnapshot> {
        Box::pin(self.0.mobile_auth().configure(config))
    }
    fn snapshot(&self) -> AuthFuture<'_, NativeSnapshot> {
        Box::pin(self.0.mobile_auth().snapshot())
    }
    fn sign_in(&self, register: bool) -> AuthFuture<'_, NativeSnapshot> {
        Box::pin(self.0.mobile_auth().sign_in(register))
    }
    fn logout(&self) -> AuthFuture<'_, NativeSnapshot> {
        Box::pin(self.0.mobile_auth().logout())
    }
    fn profile(&self, generation: u64) -> AuthFuture<'_, NativeSnapshot> {
        Box::pin(self.0.mobile_auth().profile(generation))
    }
    fn token(
        &self,
        generation: u64,
        resource: bool,
        force: bool,
        validity: u64,
    ) -> AuthFuture<'_, tauri_plugin_mobile_auth::AccessGrant> {
        Box::pin(
            self.0
                .mobile_auth()
                .token(generation, resource, force, validity),
        )
    }
}

#[derive(Clone)]
pub struct Config {
    pub endpoint: String,
    pub issuer: String,
    pub client_id: String,
    pub resource: String,
    pub grid_url: String,
    pub host_product_id: String,
    pub redirect_uri: String,
}
impl Default for Config {
    fn default() -> Self {
        Self {
            endpoint: "https://auth.x.aixgg.com".into(),
            issuer: "https://auth.x.aixgg.com/oidc".into(),
            client_id: "x7lzj58abb1sdp16lkd34".into(),
            resource: "https://anywork-cybergrid-selfhost.vercel.app/api".into(),
            grid_url: "https://anywork-cybergrid-selfhost.vercel.app".into(),
            host_product_id: "x7lzj58abb1sdp16lkd34".into(),
            redirect_uri: "http://127.0.0.1:17897/callback".into(),
        }
    }
}

struct State {
    snapshot: AccountSnapshot,
    native_generation: u64,
    subject: Option<String>,
    profile_warning: Option<String>,
    records: Vec<DeviceRecord>,
    directory_hash: String,
    sampled_at: u64,
    lifetime: CancellationToken,
}
struct Inner {
    backend: Arc<dyn AuthBackend>,
    config: Config,
    http: reqwest::Client,
    configured: OnceCell<()>,
    state: Mutex<State>,
    grid: Mutex<Option<grid::NativeDirectory>>,
    writes: Mutex<()>,
    refreshes: Mutex<()>,
    trust: Mutex<std::result::Result<TrustStore, String>>,
    notify: Arc<dyn Fn(AccountSnapshot) + Send + Sync>,
    retire: std::sync::Mutex<Option<Arc<dyn Fn() + Send + Sync>>>,
}
#[derive(Clone)]
pub struct Handle(Arc<Inner>);

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn digest(parts: &[&str]) -> String {
    format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(parts).expect("string array"))
    )
}
fn safe_text(value: &str, max: usize) -> bool {
    !value.trim().is_empty() && value.chars().count() <= max && !value.chars().any(char::is_control)
}
fn identifier(value: &str, max: usize) -> bool {
    !value.is_empty()
        && value.len() <= max
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'-'))
}
fn text<'a>(value: &'a Value, key: &str, max: usize) -> Result<&'a str> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|s| safe_text(s, max))
        .ok_or_else(|| anyhow::anyhow!("MOBILE_INVALID_RESPONSE"))
}
fn key_valid(key: &str) -> bool {
    key.len() == 43
        && URL_SAFE_NO_PAD
            .decode(key)
            .is_ok_and(|v| v.len() == 32 && URL_SAFE_NO_PAD.encode(v) == key)
}
fn next(value: u64) -> u64 {
    assert!(value < 9_007_199_254_740_991);
    value + 1
}

impl Handle {
    pub fn new<R: Runtime>(app: tauri::AppHandle<R>) -> Self {
        let events = app.clone();
        let path = app
            .path()
            .app_local_data_dir()
            .map(|p| p.join("mobile-trust-v1.json"));
        let handle = Self::with_backend(
            Config::default(),
            Arc::new(NativeBackend(app)),
            Arc::new(move |snapshot| {
                let _ = events.emit("mobile://account-state", snapshot);
            }),
        );
        // No legacy account storage or KeyStore is read. Only this public pin file.
        let store = path
            .map_err(|_| "TRUST_STORAGE_UNAVAILABLE".into())
            .and_then(|p| {
                TrustStore::load(Some(p)).map_err(|_| "TRUST_STORAGE_UNAVAILABLE".into())
            });
        *handle.0.trust.try_lock().expect("new state") = store;
        handle
    }
    pub fn set_retire_hook(&self, hook: Arc<dyn Fn() + Send + Sync>) {
        *self.0.retire.lock().unwrap_or_else(|e| e.into_inner()) = Some(hook);
    }
    fn retire_grid(&self, epoch: u64) {
        let owner = self.clone();
        tokio::spawn(async move {
            let mut slot = owner.0.grid.lock().await;
            if slot
                .as_ref()
                .is_some_and(|directory| directory.epoch() < epoch)
                && let Some(directory) = slot.take()
            {
                directory.close().await;
            }
        });
    }
    fn retired(&self) {
        let hook = self
            .0
            .retire
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        if let Some(hook) = hook {
            hook();
        }
    }
    pub fn with_backend(
        config: Config,
        backend: Arc<dyn AuthBackend>,
        notify: Arc<dyn Fn(AccountSnapshot) + Send + Sync>,
    ) -> Self {
        let http = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(30))
            .build()
            .expect("mobile HTTP client initialization");
        Self(Arc::new(Inner {
            backend,
            config,
            http,
            configured: OnceCell::new(),
            grid: Mutex::new(None),
            writes: Mutex::new(()),
            refreshes: Mutex::new(()),
            notify,
            retire: std::sync::Mutex::new(None),
            trust: Mutex::new(Ok(TrustStore::load(None).expect("memory store"))),
            state: Mutex::new(State {
                native_generation: 0,
                subject: None,
                profile_warning: None,
                records: vec![],
                directory_hash: String::new(),
                sampled_at: 0,
                lifetime: CancellationToken::new(),
                snapshot: AccountSnapshot {
                    protocol_version: 1,
                    epoch: 0,
                    phase: Phase::SignedOut,
                    account: None,
                    devices: vec![],
                    directory_state: DirectoryState::Idle,
                    revision: 0,
                    error_code: None,
                },
            }),
        }))
    }
    async fn prepare(&self) -> Result<()> {
        self.0
            .configured
            .get_or_try_init(|| async {
                let c = &self.0.config;
                self.0
                    .backend
                    .configure(tauri_plugin_mobile_auth::Configuration {
                        endpoint: c.endpoint.clone(),
                        client_id: c.client_id.clone(),
                        resource: c.resource.clone(),
                        redirect_uri: c.redirect_uri.clone(),
                    })
                    .await?;
                Ok::<(), anyhow::Error>(())
            })
            .await?;
        Ok(())
    }
    fn clear_directory(state: &mut State) {
        state.lifetime.cancel();
        state.lifetime = CancellationToken::new();
        state.records.clear();
        state.directory_hash.clear();
        state.sampled_at = 0;
        state.snapshot.devices.clear();
        state.snapshot.directory_state = DirectoryState::Idle;
        state.snapshot.revision = next(state.snapshot.revision);
    }
    async fn apply(&self, epoch: u64, native: NativeSnapshot) -> Result<AccountSnapshot> {
        let phase = match native.status.as_str() {
            "signedOut" => Phase::SignedOut,
            "authorizing" => Phase::SigningIn,
            "signedIn" => Phase::SignedIn,
            "reauthRequired" => Phase::ReauthRequired,
            _ => bail!("MOBILE_INVALID_AUTH_STATE"),
        };
        if phase == Phase::SignedIn {
            let p = native
                .profile
                .as_ref()
                .ok_or_else(|| anyhow::anyhow!("MOBILE_PROFILE_UNAVAILABLE"))?;
            ensure!(
                safe_text(&p.subject, 128) && safe_text(&p.display_name, 160),
                "MOBILE_INVALID_PROFILE"
            );
        }
        let mut state = self.0.state.lock().await;
        ensure!(state.snapshot.epoch == epoch, "CANCELLED");
        // A snapshot cannot reopen a locally retired owner while the native
        // logout dispatch/rotation is still settling.
        ensure!(
            phase != Phase::SignedIn
                || matches!(state.snapshot.phase, Phase::SigningIn | Phase::SignedIn),
            "CANCELLED"
        );
        let changed = state.snapshot.phase == Phase::SignedIn
            && (phase != Phase::SignedIn
                || native.generation != state.native_generation
                || native.profile.as_ref().map(|p| p.subject.as_str()) != state.subject.as_deref());
        if changed {
            state.snapshot.epoch = next(state.snapshot.epoch);
            Self::clear_directory(&mut state);
        }
        state.native_generation = native.generation;
        state.snapshot.phase = phase;
        state.subject = native
            .profile
            .as_ref()
            .filter(|_| phase == Phase::SignedIn)
            .map(|p| p.subject.clone());
        state.snapshot.account = native
            .profile
            .filter(|_| phase == Phase::SignedIn)
            .map(|p| Account {
                scope_id: digest(&[
                    "anywork-mobile-account-v1",
                    &self.0.config.issuer,
                    &self.0.config.client_id,
                    &p.subject,
                ]),
                label: p.display_name,
                email: p.email.filter(|s| safe_text(s, 160)),
            });
        state.profile_warning = native
            .error_code
            .as_ref()
            .filter(|s| s.as_str() == "MOBILE_PROFILE_UNAVAILABLE" && phase == Phase::SignedIn)
            .cloned();
        state.snapshot.error_code = native.error_code.filter(|s| {
            matches!(
                s.as_str(),
                "MOBILE_AUTH_SIGN_IN"
                    | "MOBILE_AUTH_REAUTH_REQUIRED"
                    | "MOBILE_REVOCATION_UNCONFIRMED"
                    | "MOBILE_PROFILE_UNAVAILABLE"
            )
        });
        let snapshot = state.snapshot.clone();
        drop(state);
        if changed {
            self.retire_grid(snapshot.epoch);
            self.retired();
        }
        (self.0.notify)(snapshot.clone());
        Ok(snapshot)
    }
    pub async fn snapshot(&self) -> Result<AccountSnapshot> {
        self.prepare().await?;
        let epoch = self.0.state.lock().await.snapshot.epoch;
        let native = self.0.backend.snapshot().await?;
        self.apply(epoch, native).await
    }
    pub async fn login(&self, signup: bool) -> Result<AccountSnapshot> {
        self.prepare().await?;
        if self.0.state.lock().await.snapshot.phase == Phase::ReauthRequired {
            self.logout().await?;
        }
        let mut state = self.0.state.lock().await;
        ensure!(state.snapshot.phase == Phase::SignedOut, "MOBILE_AUTH_BUSY");
        state.snapshot.epoch = next(state.snapshot.epoch);
        state.snapshot.phase = Phase::SigningIn;
        state.snapshot.error_code = None;
        let epoch = state.snapshot.epoch;
        let snapshot = state.snapshot.clone();
        drop(state);
        (self.0.notify)(snapshot);
        let result = self.0.backend.sign_in(signup).await;
        ensure!(
            self.0.state.lock().await.snapshot.epoch == epoch,
            "CANCELLED"
        );
        match result {
            Ok(native) => {
                self.apply(epoch, native).await?;
                if self.0.state.lock().await.snapshot.phase == Phase::SignedIn {
                    self.refresh_inner(false).await
                } else {
                    bail!("CANCELLED")
                }
            }
            Err(_) => {
                self.reauth(epoch).await;
                bail!("MOBILE_AUTH_SIGN_IN")
            }
        }
    }
    pub async fn cancel(&self) -> Result<AccountSnapshot> {
        let phase = self.0.state.lock().await.snapshot.phase;
        ensure!(phase != Phase::SignedIn, "MOBILE_AUTH_BUSY");
        self.logout().await
    }
    pub async fn logout(&self) -> Result<AccountSnapshot> {
        let mut state = self.0.state.lock().await;
        state.snapshot.epoch = next(state.snapshot.epoch);
        state.snapshot.phase = Phase::SignedOut;
        state.snapshot.account = None;
        state.subject = None;
        state.profile_warning = None;
        state.snapshot.error_code = None;
        Self::clear_directory(&mut state);
        let epoch = state.snapshot.epoch;
        let snapshot = state.snapshot.clone();
        drop(state);
        self.retired();
        (self.0.notify)(snapshot);
        // Native fencing begins immediately; started token rotation is never cancelled.
        let mut native = self.0.backend.logout().await;
        let cleanup_confirmed = {
            let mut slot = self.0.grid.lock().await;
            if slot
                .as_ref()
                .is_some_and(|directory| directory.epoch() < epoch)
            {
                if let Some(directory) = slot.take() {
                    directory.close().await
                } else {
                    true
                }
            } else {
                true
            }
        };
        if !cleanup_confirmed && let Ok(snapshot) = &mut native {
            snapshot.error_code = Some("MOBILE_REVOCATION_UNCONFIRMED".into());
        }
        match native {
            Ok(native) => self.apply(epoch, native).await,
            Err(_) => {
                let mut state = self.0.state.lock().await;
                ensure!(state.snapshot.epoch == epoch, "CANCELLED");
                state.snapshot.error_code = Some("MOBILE_LOGOUT_UNCONFIRMED".into());
                let snapshot = state.snapshot.clone();
                drop(state);
                (self.0.notify)(snapshot.clone());
                Ok(snapshot)
            }
        }
    }
    pub async fn ensure_epoch(&self, epoch: u64) -> Result<()> {
        let state = self.0.state.lock().await;
        ensure!(
            state.snapshot.epoch == epoch && state.snapshot.phase == Phase::SignedIn,
            "MOBILE_ACCOUNT_CHANGED"
        );
        Ok(())
    }
    async fn owner(&self) -> Result<(u64, u64, String)> {
        let state = self.0.state.lock().await;
        ensure!(state.snapshot.phase == Phase::SignedIn, "LOGIN_REQUIRED");
        Ok((
            state.snapshot.epoch,
            state.native_generation,
            state
                .subject
                .clone()
                .ok_or_else(|| anyhow::anyhow!("MOBILE_PROFILE_UNAVAILABLE"))?,
        ))
    }
    async fn reauth(&self, epoch: u64) {
        let mut state = self.0.state.lock().await;
        if state.snapshot.epoch != epoch {
            return;
        }
        state.snapshot.epoch = next(state.snapshot.epoch);
        state.snapshot.phase = Phase::ReauthRequired;
        state.snapshot.account = None;
        state.subject = None;
        state.profile_warning = None;
        Self::clear_directory(&mut state);
        state.snapshot.error_code = Some("MOBILE_AUTH_REAUTH_REQUIRED".into());
        let snapshot = state.snapshot.clone();
        drop(state);
        self.retire_grid(snapshot.epoch);
        self.retired();
        (self.0.notify)(snapshot);
    }
    pub async fn token(
        &self,
        resource: TokenResource,
        force_refresh: bool,
        min_validity: u64,
    ) -> Result<AccessGrant> {
        ensure!(
            (1..=3600).contains(&min_validity),
            "MOBILE_INVALID_TOKEN_REQUEST"
        );
        let (epoch, generation, _) = self.owner().await?;
        let grant = match self
            .0
            .backend
            .token(
                generation,
                !matches!(resource, TokenResource::Account),
                force_refresh,
                min_validity,
            )
            .await
        {
            Ok(value) => value,
            Err(_) => {
                self.reauth(epoch).await;
                bail!("MOBILE_AUTH_REAUTH_REQUIRED")
            }
        };
        self.ensure_epoch(epoch).await?;
        if grant.generation != generation
            || !safe_text(&grant.access_token, 16384)
            || grant.expires_at < now().saturating_add(min_validity)
        {
            self.reauth(epoch).await;
            bail!("MOBILE_INVALID_TOKEN_RESPONSE");
        }
        Ok(AccessGrant {
            access_token: grant.access_token,
            expires_at: grant.expires_at,
            epoch,
        })
    }
    pub async fn scope_id(&self) -> Result<String> {
        self.0
            .state
            .lock()
            .await
            .snapshot
            .account
            .as_ref()
            .map(|a| a.scope_id.clone())
            .ok_or_else(|| anyhow::anyhow!("LOGIN_REQUIRED"))
    }
    async fn response_json(response: reqwest::Response, limit: usize) -> Result<Value> {
        ensure!(response.status().is_success(), "MOBILE_SERVICE_REJECTED");
        ensure!(
            response.content_length().is_none_or(|n| n <= limit as u64),
            "MOBILE_RESPONSE_TOO_LARGE"
        );
        let mut response = response;
        let mut body = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| anyhow::anyhow!("MOBILE_NETWORK_ERROR"))?
        {
            ensure!(
                body.len() + chunk.len() <= limit,
                "MOBILE_RESPONSE_TOO_LARGE"
            );
            body.extend_from_slice(&chunk);
        }
        serde_json::from_slice(&body).map_err(|_| anyhow::anyhow!("MOBILE_INVALID_RESPONSE"))
    }
    async fn account_read(&self, epoch: u64, subject: &str) -> Result<Value> {
        let grant = self.token(TokenResource::Account, false, 30).await?;
        self.ensure_epoch(epoch).await?;
        let response = self
            .0
            .http
            .get(format!("{}/api/my-account", self.0.config.endpoint))
            .bearer_auth(&grant.access_token)
            .send()
            .await
            .map_err(|_| anyhow::anyhow!("MOBILE_NETWORK_ERROR"))?;
        let value = Self::response_json(response, 65536).await?;
        self.ensure_epoch(epoch).await?;
        ensure!(
            value["id"].as_str() == Some(subject),
            "MOBILE_IDENTITY_MISMATCH"
        );
        Ok(value)
    }
    fn account_devices(account: &Value) -> Result<Vec<DeviceRecord>> {
        let custom = account
            .get("customData")
            .ok_or_else(|| anyhow::anyhow!("MOBILE_INVALID_DIRECTORY"))?;
        ensure!(
            custom.is_object() && serde_json::to_vec(custom)?.len() <= 32768,
            "MOBILE_INVALID_DIRECTORY"
        );
        let Some(anywork) = custom.get("anywork") else {
            return Ok(vec![]);
        };
        ensure!(anywork["schemaVersion"] == 1, "MOBILE_INVALID_DIRECTORY");
        if let Some(preferences) = anywork.get("preferences") {
            ensure!(
                preferences.is_object()
                    && preferences
                        .get("locale")
                        .is_none_or(|v| v == "zh-CN" || v == "en")
                    && preferences
                        .get("appearance")
                        .is_none_or(|v| v == "light" || v == "dark" || v == "system"),
                "MOBILE_INVALID_DIRECTORY"
            );
        }
        let devices = anywork["devices"]
            .as_object()
            .ok_or_else(|| anyhow::anyhow!("MOBILE_INVALID_DIRECTORY"))?;
        ensure!(devices.len() <= 32, "MOBILE_INVALID_DIRECTORY");
        devices
            .iter()
            .map(|(id, value)| {
                ensure!(
                    identifier(id, 128)
                        && !["__proto__", "constructor", "prototype", "toString"]
                            .contains(&id.as_str()),
                    "MOBILE_INVALID_DIRECTORY"
                );
                let public_key = text(value, "publicKey", 43)?.to_owned();
                let key_version = value["keyVersion"]
                    .as_u64()
                    .filter(|n| *n >= 1 && *n <= 9_007_199_254_740_991)
                    .ok_or_else(|| anyhow::anyhow!("MOBILE_INVALID_DEVICE_KEY"))?;
                ensure!(key_valid(&public_key), "MOBILE_INVALID_DEVICE_KEY");
                let grid_device_id = value
                    .get("gridDeviceId")
                    .map(|_| text(value, "gridDeviceId", 128).map(str::to_owned))
                    .transpose()?;
                Ok(DeviceRecord {
                    installation_id: id.clone(),
                    label: text(value, "label", 80)?.into(),
                    platform: text(value, "platform", 32)?.into(),
                    public_key,
                    key_version,
                    grid_device_id,
                    online: None,
                    gateway_url: None,
                })
            })
            .collect()
    }
    pub async fn refresh(&self) -> Result<AccountSnapshot> {
        self.refresh_inner(true).await
    }
    async fn refresh_inner(&self, read_profile: bool) -> Result<AccountSnapshot> {
        let _refresh = self.0.refreshes.lock().await;
        let (epoch, generation, subject) = self.owner().await?;
        if read_profile {
            let native = match self.0.backend.profile(generation).await {
                Ok(snapshot) => Ok(snapshot),
                Err(_) => self.0.backend.snapshot().await,
            };
            if let Ok(native) = native {
                self.apply(epoch, native).await?;
            } else {
                let mut state = self.0.state.lock().await;
                ensure!(state.snapshot.epoch == epoch, "CANCELLED");
                state.profile_warning = Some("MOBILE_PROFILE_UNAVAILABLE".into());
            }
            self.ensure_epoch(epoch).await?;
        }
        {
            let mut state = self.0.state.lock().await;
            state.snapshot.directory_state = DirectoryState::Loading;
            let snapshot = state.snapshot.clone();
            drop(state);
            (self.0.notify)(snapshot);
        }
        let result = async {
            let account = self.account_read(epoch, &subject).await?;
            let mut records = Self::account_devices(&account)?;
            let online = if records.is_empty() {
                Ok(vec![])
            } else {
                grid::devices(self, epoch, &subject).await
            };
            // Retain only the boundary's fixed public error code. Never expose
            // an SDK error, service response, URL or authorization material.
            let (online, failure) = match online {
                Ok(grid) => (Some(grid), None),
                Err(error) => (None, Some(public_error(error))),
            };
            if let Some(grid) = online {
                for record in &mut records {
                    let remote = grid
                        .iter()
                        .find(|g| record.grid_device_id.as_deref() == Some(&g.id));
                    record.online = Some(remote.is_some_and(|g| g.online));
                    record.gateway_url = remote.and_then(|g| g.gateway.clone());
                }
            }
            Ok::<_, anyhow::Error>((records, failure))
        }
        .await;
        self.ensure_epoch(epoch).await?;
        let (records, failure) = match result {
            Ok(value) => value,
            Err(error) => {
                let mut state = self.0.state.lock().await;
                ensure!(state.snapshot.epoch == epoch, "CANCELLED");
                state.lifetime.cancel();
                state.lifetime = CancellationToken::new();
                state.snapshot.directory_state = DirectoryState::Unknown;
                state.snapshot.error_code = Some(public_error(error));
                log_directory_failure(state.snapshot.error_code.as_deref());
                for device in &mut state.snapshot.devices {
                    device.online = None;
                }
                let snapshot = state.snapshot.clone();
                drop(state);
                (self.0.notify)(snapshot.clone());
                return Ok(snapshot);
            }
        };
        let unknown = failure.is_some();
        let scope = self.scope_id().await?;
        let hash = format!("{:x}", Sha256::digest(serde_json::to_vec(&records)?));
        let devices = {
            let trust = self.0.trust.lock().await;
            let trust = trust
                .as_ref()
                .map_err(|_| anyhow::anyhow!("TRUST_STORAGE_UNAVAILABLE"))?;
            records
                .iter()
                .map(|d| Device {
                    device_ref: digest(&["mobile-device-ref-v1", &scope, &d.installation_id]),
                    installation_id: d.installation_id.clone(),
                    label: d.label.clone(),
                    platform: d.platform.clone(),
                    public_key: d.public_key.clone(),
                    key_version: d.key_version,
                    online: d.online,
                    trusted_public_key: trust
                        .get(&scope, &d.installation_id)
                        .map(|p| p.public_key.clone()),
                })
                .collect()
        };
        let mut state = self.0.state.lock().await;
        ensure!(
            state.snapshot.epoch == epoch && state.snapshot.phase == Phase::SignedIn,
            "CANCELLED"
        );
        if hash != state.directory_hash || (!unknown && state.lifetime.is_cancelled()) {
            state.lifetime.cancel();
            state.lifetime = CancellationToken::new();
            state.snapshot.revision = next(state.snapshot.revision);
            state.directory_hash = hash;
        }
        state.records = records;
        state.sampled_at = now();
        state.snapshot.devices = devices;
        state.snapshot.directory_state = if unknown {
            DirectoryState::Unknown
        } else {
            DirectoryState::Ready
        };
        state.snapshot.error_code = failure.or_else(|| state.profile_warning.clone());
        if unknown {
            state.lifetime.cancel();
            log_directory_failure(state.snapshot.error_code.as_deref());
        }
        let snapshot = state.snapshot.clone();
        drop(state);
        (self.0.notify)(snapshot.clone());
        Ok(snapshot)
    }
    pub async fn devices(&self) -> Result<Vec<Device>> {
        Ok(self.refresh().await?.devices)
    }
    pub async fn prepare_target(
        &self,
        device_ref: &str,
        expected_epoch: u64,
        expected_revision: u64,
        key_confirmation: Option<&str>,
    ) -> Result<PreparedTarget> {
        self.ensure_epoch(expected_epoch).await?;
        // Re-read authoritative identity and endpoint, then require the UI's exact revision.
        self.refresh().await?;
        self.prepare_current_target(
            device_ref,
            expected_epoch,
            expected_revision,
            key_confirmation,
        )
        .await
    }
    async fn prepare_current_target(
        &self,
        device_ref: &str,
        expected_epoch: u64,
        expected_revision: u64,
        key_confirmation: Option<&str>,
    ) -> Result<PreparedTarget> {
        let state = self.0.state.lock().await;
        ensure!(
            state.snapshot.epoch == expected_epoch && state.snapshot.phase == Phase::SignedIn,
            "CANCELLED"
        );
        ensure!(
            state.snapshot.revision == expected_revision,
            "DIRECTORY_CONFLICT"
        );
        ensure!(
            state.snapshot.directory_state == DirectoryState::Ready,
            "DEVICE_NOT_READY"
        );
        let device = state
            .snapshot
            .devices
            .iter()
            .find(|d| d.device_ref == device_ref)
            .ok_or_else(|| anyhow::anyhow!("DEVICE_NOT_FOUND"))?;
        let record = state
            .records
            .iter()
            .find(|d| d.installation_id == device.installation_id)
            .ok_or_else(|| anyhow::anyhow!("DEVICE_NOT_FOUND"))?;
        ensure!(record.online == Some(true), "DEVICE_NOT_READY");
        let gateway = record
            .gateway_url
            .clone()
            .ok_or_else(|| anyhow::anyhow!("DEVICE_NOT_READY"))?;
        let scope = state
            .snapshot
            .account
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("LOGIN_REQUIRED"))?
            .scope_id
            .clone();
        let trust = self.0.trust.lock().await;
        let trust = trust
            .as_ref()
            .map_err(|_| anyhow::anyhow!("TRUST_STORAGE_UNAVAILABLE"))?;
        let pinned = trust.get(&scope, &record.installation_id);
        let needs_confirmation = pinned.is_none_or(|p| {
            p.public_key != record.public_key || p.key_version != record.key_version
        });
        if needs_confirmation {
            ensure!(
                key_confirmation == Some(record.public_key.as_str()),
                "KEY_CONFIRMATION_REQUIRED"
            );
        } else if let Some(key) = key_confirmation {
            ensure!(key == record.public_key, "KEY_CONFIRMATION_REQUIRED");
        }
        let lifetime = state.lifetime.child_token();
        ensure!(!lifetime.is_cancelled(), "DEVICE_NOT_READY");
        Ok(PreparedTarget {
            target: crate::transport::VerifiedTarget {
                gateway_url: gateway,
                installation_id: record.installation_id.clone(),
                public_key: record.public_key.clone(),
                account_epoch: expected_epoch,
                scope_id: scope.clone(),
                lifetime,
            },
            authorization: Arc::new(AccountAuthorization {
                handle: self.clone(),
                epoch: expected_epoch,
            }),
            trust: TrustCommit {
                epoch: expected_epoch,
                revision: expected_revision,
                scope_id: scope,
                installation_id: record.installation_id.clone(),
                public_key: record.public_key.clone(),
                key_version: record.key_version,
            },
        })
    }
    pub async fn commit_trust(&self, confirmation: TrustCommit) -> Result<()> {
        let mut state = self.0.state.lock().await;
        ensure!(
            state.snapshot.epoch == confirmation.epoch && state.snapshot.phase == Phase::SignedIn,
            "CANCELLED"
        );
        ensure!(
            state.snapshot.revision == confirmation.revision
                && state.sampled_at + 60 >= now()
                && !state.lifetime.is_cancelled(),
            "DIRECTORY_CONFLICT"
        );
        ensure!(
            state
                .snapshot
                .account
                .as_ref()
                .is_some_and(|a| a.scope_id == confirmation.scope_id)
                && state
                    .records
                    .iter()
                    .any(|d| d.installation_id == confirmation.installation_id
                        && d.public_key == confirmation.public_key
                        && d.key_version == confirmation.key_version),
            "DIRECTORY_CONFLICT"
        );
        let mut trust = self.0.trust.lock().await;
        trust
            .as_mut()
            .map_err(|_| anyhow::anyhow!("TRUST_STORAGE_UNAVAILABLE"))?
            .save(
                &confirmation.scope_id,
                &confirmation.installation_id,
                TrustPin {
                    public_key: confirmation.public_key.clone(),
                    key_version: confirmation.key_version,
                },
            )?;
        for device in &mut state.snapshot.devices {
            if device.installation_id == confirmation.installation_id {
                device.trusted_public_key = Some(confirmation.public_key.clone());
            }
        }
        state.snapshot.revision = next(state.snapshot.revision);
        let snapshot = state.snapshot.clone();
        drop(state);
        (self.0.notify)(snapshot);
        Ok(())
    }
    pub async fn device_update(&self, request: DeviceUpdateRequest) -> Result<AccountSnapshot> {
        ensure!(
            request.remove.unwrap_or(false) != request.label.is_some(),
            "INVALID_REQUEST"
        );
        self.ensure_epoch(request.expected_epoch).await?;
        let _write = self.0.writes.lock().await;
        let refresh_guard = self.0.refreshes.lock().await;
        let state = self.0.state.lock().await;
        ensure!(
            state.snapshot.revision == request.expected_revision,
            "DIRECTORY_CONFLICT"
        );
        let device = state
            .snapshot
            .devices
            .iter()
            .find(|d| d.device_ref == request.device_ref)
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("DEVICE_NOT_FOUND"))?;
        drop(state);
        let (epoch, _, subject) = self.owner().await?;
        ensure!(epoch == request.expected_epoch, "CANCELLED");
        let mut account = self.account_read(epoch, &subject).await?;
        let records = Self::account_devices(&account)?;
        let record = records
            .iter()
            .find(|d| d.installation_id == device.installation_id)
            .ok_or_else(|| anyhow::anyhow!("DIRECTORY_CONFLICT"))?;
        ensure!(
            record.public_key == device.public_key
                && record.key_version == device.key_version
                && record.label == device.label,
            "DIRECTORY_CONFLICT"
        );
        let before = account["customData"].clone();
        let map = account["customData"]["anywork"]["devices"]
            .as_object_mut()
            .ok_or_else(|| anyhow::anyhow!("MOBILE_INVALID_DIRECTORY"))?;
        if let Some(label) = request.label {
            ensure!(
                safe_text(&label, 80) && label.trim() == label,
                "INVALID_REQUEST"
            );
            map.get_mut(&device.installation_id).unwrap()["label"] = label.into();
        } else {
            map.remove(&device.installation_id);
        }
        let custom = account["customData"].clone();
        ensure!(
            serde_json::to_vec(&custom)?.len() <= 32768,
            "MOBILE_INVALID_DIRECTORY"
        );
        let grant = self.token(TokenResource::Account, false, 30).await?;
        let latest = self.account_read(epoch, &subject).await?;
        ensure!(latest["customData"] == before, "DIRECTORY_CONFLICT");
        {
            let state = self.0.state.lock().await;
            ensure!(
                state.snapshot.epoch == epoch
                    && state.snapshot.revision == request.expected_revision,
                "DIRECTORY_CONFLICT"
            );
        }
        let response = self
            .0
            .http
            .patch(format!("{}/api/my-account", self.0.config.endpoint))
            .bearer_auth(&grant.access_token)
            .json(&json!({"customData":custom}))
            .send()
            .await
            .map_err(|_| anyhow::anyhow!("WRITE_OUTCOME_UNKNOWN"))?;
        ensure!(
            response.status().is_success(),
            "MOBILE_ACCOUNT_WRITE_REJECTED"
        );
        self.ensure_epoch(epoch).await?;
        let after = self
            .account_read(epoch, &subject)
            .await
            .map_err(|_| anyhow::anyhow!("WRITE_OUTCOME_UNKNOWN"))?;
        ensure!(after["customData"] == custom, "DIRECTORY_CONFLICT");
        drop(refresh_guard);
        self.refresh().await
    }
}

struct AccountAuthorization {
    handle: Handle,
    epoch: u64,
}
impl crate::transport::Authorization for AccountAuthorization {
    fn token(
        &self,
        force_refresh: bool,
        min_validity: u64,
    ) -> crate::transport::AuthFuture<'_, crate::transport::AccessGrant> {
        Box::pin(async move {
            self.handle.ensure_epoch(self.epoch).await?;
            let grant = self
                .handle
                .token(TokenResource::Business, force_refresh, min_validity)
                .await?;
            ensure!(grant.epoch == self.epoch, "MOBILE_ACCOUNT_CHANGED");
            Ok(crate::transport::AccessGrant {
                access_token: grant.access_token,
                expires_at: grant.expires_at,
                epoch: grant.epoch,
            })
        })
    }
    fn ensure_epoch(&self, epoch: u64) -> crate::transport::AuthFuture<'_, ()> {
        Box::pin(async move {
            ensure!(epoch == self.epoch, "MOBILE_ACCOUNT_CHANGED");
            self.handle.ensure_epoch(epoch).await
        })
    }
}

// The Android native directory and host conformance tests share these parsers.
#[cfg(any(target_os = "android", test))]
fn timestamp(value: &str) -> Result<u64> {
    chrono::DateTime::parse_from_rfc3339(value)
        .ok()
        .and_then(|v| u64::try_from(v.timestamp()).ok())
        .ok_or_else(|| anyhow::anyhow!("MOBILE_INVALID_RESPONSE"))
}

#[cfg(any(target_os = "android", test))]
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct Provider {
    id: String,
    origins: Vec<String>,
    paths: Vec<String>,
}
#[cfg(any(target_os = "android", test))]
struct EndpointPolicy {
    providers: Vec<Provider>,
}
#[cfg(any(target_os = "android", test))]
impl EndpointPolicy {
    fn parse(value: &Value, config: &Config) -> Result<Self> {
        ensure!(
            value["provider"] == "logto"
                && value["issuer"] == config.issuer
                && value["clientId"] == config.client_id
                && value["resource"] == config.resource
                && value["deviceAuthorizationEndpoint"] == format!("{}/device/auth", config.issuer)
                && value["tokenEndpoint"] == format!("{}/token", config.issuer)
                && value["revocationEndpoint"] == format!("{}/token/revocation", config.issuer),
            "MOBILE_COORDINATION_CONFIGURATION"
        );
        ensure!(
            value["coordination"]["protocol"] == "memory-v1"
                && uuid::Uuid::parse_str(text(&value["coordination"], "epoch", 36)?).is_ok(),
            "MOBILE_COORDINATION_CONFIGURATION"
        );
        let scopes: Vec<_> = text(value, "scope", 512)?.split_whitespace().collect();
        ensure!(
            scopes.contains(&"connect")
                && scopes.len() <= 8
                && scopes.iter().all(|s| [
                    "openid",
                    "profile",
                    "offline_access",
                    "email",
                    "phone",
                    "custom_data",
                    "identities",
                    "connect"
                ]
                .contains(s))
                && scopes
                    .iter()
                    .collect::<std::collections::HashSet<_>>()
                    .len()
                    == scopes.len(),
            "MOBILE_COORDINATION_CONFIGURATION"
        );
        if let Some(products) = value.get("products") {
            let products = products
                .as_array()
                .ok_or_else(|| anyhow::anyhow!("MOBILE_COORDINATION_CONFIGURATION"))?;
            ensure!(
                !products.is_empty()
                    && products.len() <= 32
                    && products.iter().any(|p| p["id"] == config.host_product_id),
                "MOBILE_COORDINATION_CONFIGURATION"
            );
        }
        let Some(policy) = value.get("endpointPolicy") else {
            return Ok(Self { providers: vec![] });
        };
        ensure!(policy["version"] == 1, "MOBILE_INVALID_ENDPOINT_POLICY");
        let mut providers: Vec<Provider> = serde_json::from_value(policy["providers"].clone())
            .map_err(|_| anyhow::anyhow!("MOBILE_INVALID_ENDPOINT_POLICY"))?;
        ensure!(
            providers.len() <= 16 && serde_json::to_vec(&policy["providers"])?.len() <= 32768,
            "MOBILE_INVALID_ENDPOINT_POLICY"
        );
        for p in &mut providers {
            ensure!(
                identifier(&p.id, 64)
                    && p.id != "quick-tunnel"
                    && !p.origins.is_empty()
                    && p.origins.len() <= 16
                    && !p.paths.is_empty()
                    && p.paths.len() <= 16,
                "MOBILE_INVALID_ENDPOINT_POLICY"
            );
            for origin in &p.origins {
                let u = url::Url::parse(origin)
                    .map_err(|_| anyhow::anyhow!("MOBILE_INVALID_ENDPOINT_POLICY"))?;
                ensure!(
                    u.scheme() == "https" && u.origin().ascii_serialization() == *origin,
                    "MOBILE_INVALID_ENDPOINT_POLICY"
                );
            }
            for path in &p.paths {
                ensure!(
                    path.starts_with('/')
                        && path.len() <= 256
                        && path.is_ascii()
                        && !path.contains(['%', '?', '#', '\\'])
                        && !path.contains("//")
                        && !path.split('/').any(|s| s == "." || s == ".."),
                    "MOBILE_INVALID_ENDPOINT_POLICY"
                );
            }
            p.origins.sort();
            p.paths.sort();
            ensure!(
                p.origins.windows(2).all(|w| w[0] != w[1])
                    && p.paths.windows(2).all(|w| w[0] != w[1]),
                "MOBILE_INVALID_ENDPOINT_POLICY"
            );
        }
        providers.sort_by(|a, b| a.id.cmp(&b.id));
        ensure!(
            providers.windows(2).all(|w| w[0].id != w[1].id),
            "MOBILE_INVALID_ENDPOINT_POLICY"
        );
        let normalized: Vec<_> = providers
            .iter()
            .map(|p| json!([p.id, p.origins, p.paths]))
            .collect();
        let digest = format!(
            "{:x}",
            Sha256::digest(serde_json::to_vec(&json!([
                "cybergrid-endpoint-policy-v1",
                normalized
            ]))?)
        );
        ensure!(
            policy["policyVersion"].as_str() == Some(&digest),
            "MOBILE_INVALID_ENDPOINT_POLICY"
        );
        Ok(Self { providers })
    }
    fn endpoint(&self, raw: &str) -> Result<String> {
        ensure!(
            raw.len() <= 1024
                && raw.is_ascii()
                && !raw.contains(['%', '?', '#', '\\'])
                && raw.bytes().all(|b| b > 32 && b < 127),
            "MOBILE_INVALID_GATEWAY"
        );
        let url = url::Url::parse(raw).map_err(|_| anyhow::anyhow!("MOBILE_INVALID_GATEWAY"))?;
        ensure!(
            url.scheme() == "https"
                && url.username().is_empty()
                && url.password().is_none()
                && url.query().is_none()
                && url.fragment().is_none(),
            "MOBILE_INVALID_GATEWAY"
        );
        ensure!(
            raw == url.as_str() || (url.path() == "/" && raw == url.origin().ascii_serialization()),
            "MOBILE_INVALID_GATEWAY"
        );
        let host = url
            .host_str()
            .ok_or_else(|| anyhow::anyhow!("MOBILE_INVALID_GATEWAY"))?;
        let quick = host
            .strip_suffix(".trycloudflare.com")
            .is_some_and(|label| {
                identifier(label, 63)
                    && label
                        .bytes()
                        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
                    && !label.starts_with('-')
                    && !label.ends_with('-')
            })
            && url.port().is_none()
            && url.path() == "/";
        ensure!(
            quick
                || self
                    .providers
                    .iter()
                    .any(|p| p.origins.contains(&url.origin().ascii_serialization())
                        && p.paths.iter().any(|p| p == url.path())),
            "MOBILE_INVALID_GATEWAY"
        );
        Ok(if url.path() == "/" {
            url.origin().ascii_serialization()
        } else {
            url.to_string()
        })
    }
}
struct GridDevice {
    id: String,
    online: bool,
    gateway: Option<String>,
}
#[cfg(any(target_os = "android", test))]
impl GridDevice {
    fn parse(value: &Value, policy: &EndpointPolicy) -> Result<Vec<Self>> {
        let devices = value["devices"]
            .as_array()
            .ok_or_else(|| anyhow::anyhow!("MOBILE_INVALID_DIRECTORY"))?;
        ensure!(devices.len() <= 5000, "MOBILE_INVALID_DIRECTORY");
        let mut ids = std::collections::HashSet::new();
        devices
            .iter()
            .map(|device| {
                let id = text(device, "id", 96)?.to_owned();
                ensure!(ids.insert(id.clone()), "MOBILE_INVALID_DIRECTORY");
                let online = device["online"]
                    .as_bool()
                    .ok_or_else(|| anyhow::anyhow!("MOBILE_INVALID_DIRECTORY"))?;
                let last_seen = text(device, "lastSeen", 40)?.to_owned();
                timestamp(&last_seen)?;
                let ports = device["ports"]
                    .as_array()
                    .ok_or_else(|| anyhow::anyhow!("MOBILE_INVALID_DIRECTORY"))?;
                ensure!(ports.len() <= 32, "MOBILE_INVALID_DIRECTORY");
                let mut gateway = None;
                let mut port_ids = std::collections::HashSet::new();
                for port in ports {
                    let id = text(port, "id", 64)?;
                    ensure!(
                        port_ids.insert(id)
                            && port["transport"] == "tcp"
                            && port["port"]
                                .as_u64()
                                .is_some_and(|n| (1..=65535).contains(&n)),
                        "MOBILE_INVALID_DIRECTORY"
                    );
                    let kind = text(port, "type", 128)?;
                    let url = if port["tunnelUrl"].is_null() {
                        None
                    } else {
                        Some(policy.endpoint(text(port, "tunnelUrl", 1024)?)?)
                    };
                    if id == "anywork-remote" {
                        ensure!(kind == "anywork-noise-v1", "MOBILE_INVALID_GATEWAY");
                        gateway = url;
                    }
                }
                Ok(Self {
                    id,
                    online,
                    gateway,
                })
            })
            .collect()
    }
}

fn directory_diagnostic_code(code: Option<&str>) -> &'static str {
    match code {
        Some("MOBILE_COORDINATION_CONFIG_FETCH_FAILED") => {
            "MOBILE_COORDINATION_CONFIG_FETCH_FAILED"
        }
        Some("MOBILE_COORDINATION_CONFIGURATION") => "MOBILE_COORDINATION_CONFIGURATION",
        Some("MOBILE_COORDINATION_REGISTRATION_FAILED") => {
            "MOBILE_COORDINATION_REGISTRATION_FAILED"
        }
        Some("MOBILE_COORDINATION_DIRECTORY_FETCH_FAILED") => {
            "MOBILE_COORDINATION_DIRECTORY_FETCH_FAILED"
        }
        Some("MOBILE_IDENTITY_MISMATCH") => "MOBILE_IDENTITY_MISMATCH",
        Some("MOBILE_INVALID_ENDPOINT_POLICY") => "MOBILE_INVALID_ENDPOINT_POLICY",
        Some("MOBILE_INVALID_DIRECTORY") => "MOBILE_INVALID_DIRECTORY",
        Some("MOBILE_INVALID_GATEWAY") => "MOBILE_INVALID_GATEWAY",
        Some("MOBILE_INVALID_RESPONSE") => "MOBILE_INVALID_RESPONSE",
        Some("MOBILE_NETWORK_ERROR") => "MOBILE_NETWORK_ERROR",
        Some("MOBILE_SERVICE_REJECTED") => "MOBILE_SERVICE_REJECTED",
        Some("MOBILE_RESPONSE_TOO_LARGE") => "MOBILE_RESPONSE_TOO_LARGE",
        _ => "MOBILE_OPERATION_FAILED",
    }
}
fn log_directory_failure(code: Option<&str>) {
    // Only constants above enter the platform log. Never format an SDK error,
    // account, endpoint, request or response into this diagnostic.
    eprintln!("AnyWorkDirectory: {}", directory_diagnostic_code(code));
}
fn public_error(error: anyhow::Error) -> String {
    let code = error.to_string();
    if code.len() <= 80
        && !code.is_empty()
        && code.bytes().all(|b| b.is_ascii_uppercase() || b == b'_')
    {
        code
    } else {
        "MOBILE_OPERATION_FAILED".into()
    }
}
#[tauri::command]
pub async fn mobile_account_snapshot(
    state: tauri::State<'_, Handle>,
) -> Result<AccountSnapshot, String> {
    state.snapshot().await.map_err(public_error)
}
#[tauri::command]
pub async fn mobile_account_login(
    state: tauri::State<'_, Handle>,
    request: LoginRequest,
) -> Result<AccountSnapshot, String> {
    state.login(request.signup).await.map_err(public_error)
}
#[tauri::command]
pub async fn mobile_account_cancel(
    state: tauri::State<'_, Handle>,
) -> Result<AccountSnapshot, String> {
    state.cancel().await.map_err(public_error)
}
#[tauri::command]
pub async fn mobile_account_logout(
    state: tauri::State<'_, Handle>,
) -> Result<AccountSnapshot, String> {
    state.logout().await.map_err(public_error)
}
#[tauri::command]
pub async fn mobile_account_refresh(
    state: tauri::State<'_, Handle>,
) -> Result<AccountSnapshot, String> {
    state.refresh().await.map_err(public_error)
}
#[tauri::command]
pub async fn mobile_account_device_update(
    state: tauri::State<'_, Handle>,
    request: DeviceUpdateRequest,
) -> Result<AccountSnapshot, String> {
    state.device_update(request).await.map_err(public_error)
}
#[cfg(test)]
mod tests;
