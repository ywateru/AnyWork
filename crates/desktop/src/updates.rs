//! Background downloads never install or restart without a local confirmation.
//! Tauri verifies a version-bound signature both on download and on installation.
use crate::{config, config::RouteKind, manager};
use anyhow::{Result, bail};
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};
use tokio::sync::{Mutex as AsyncMutex, Notify};

const CHECK_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);
const MAX_PACKAGE_SIZE: u64 = 512 * 1024 * 1024;
const RELEASES: &str = "https://github.com/ywateru/AnyWork/releases";

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    #[default]
    Idle,
    Checking,
    Downloading,
    Ready,
    Installing,
    Error,
    Unsupported,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Preferences {
    pub enabled: bool,
    pub deferred_version: String,
    pub deferred_until: u64,
}
impl Default for Preferences {
    fn default() -> Self {
        Self {
            enabled: true,
            deferred_version: String::new(),
            deferred_until: 0,
        }
    }
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub current_version: String,
    pub version: String,
    pub notes: String,
    pub phase: Phase,
    pub downloaded: u64,
    pub total: Option<u64>,
    pub last_checked: Option<u64>,
    pub error: String,
    pub enabled: bool,
    pub show_notice: bool,
    pub supported: bool,
}
struct Data {
    snapshot: Snapshot,
    preferences: Preferences,
    pending: Option<Update>,
}
fn settle(data: &mut Data) {
    if let Some(update) = &data.pending {
        data.snapshot.phase = Phase::Ready;
        data.snapshot.version = update.version.clone();
        data.snapshot.notes = update.body.clone().unwrap_or_default();
    } else {
        data.snapshot.phase = Phase::Idle;
        data.snapshot.version.clear();
        data.snapshot.notes.clear();
    }
}
#[derive(Clone)]
pub struct Handle {
    data: Arc<Mutex<Data>>,
    operation: Arc<AsyncMutex<()>>,
    changed: Arc<Notify>,
    directory: PathBuf,
}
impl Handle {
    pub fn new(support: &Path, supported: bool) -> Self {
        let directory = support.join("updates");
        let preferences: Preferences = std::fs::read(directory.join("preferences.json"))
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        let snapshot = Snapshot {
            current_version: env!("CARGO_PKG_VERSION").into(),
            version: String::new(),
            notes: String::new(),
            phase: if supported {
                Phase::Idle
            } else {
                Phase::Unsupported
            },
            downloaded: 0,
            total: None,
            last_checked: None,
            error: String::new(),
            enabled: preferences.enabled,
            show_notice: false,
            supported,
        };
        Self {
            data: Arc::new(Mutex::new(Data {
                snapshot,
                preferences,
                pending: None,
            })),
            operation: Arc::new(AsyncMutex::new(())),
            changed: Arc::new(Notify::new()),
            directory,
        }
    }
    fn edit(&self, edit: impl FnOnce(&mut Data)) {
        edit(&mut self.data.lock().unwrap_or_else(|e| e.into_inner()));
    }
    pub fn snapshot(&self) -> Snapshot {
        let data = self.data.lock().unwrap_or_else(|e| e.into_inner());
        let mut snapshot = data.snapshot.clone();
        snapshot.show_notice = snapshot.phase == Phase::Ready
            && !(data.preferences.deferred_version == snapshot.version
                && data.preferences.deferred_until > now());
        snapshot
    }
    fn preferences(&self, edit: impl FnOnce(&mut Preferences)) -> Result<()> {
        let mut data = self.data.lock().unwrap_or_else(|e| e.into_inner());
        let mut preferences = data.preferences.clone();
        edit(&mut preferences);
        config::atomic_private(
            &self.directory.join("preferences.json"),
            &serde_json::to_vec(&preferences)?,
        )?;
        data.snapshot.enabled = preferences.enabled;
        data.preferences = preferences;
        Ok(())
    }
    fn fail(&self, error: anyhow::Error) {
        self.edit(|data| {
            // A failed refresh must not hide an already verified, installable update.
            if data.pending.is_none() {
                data.snapshot.phase = Phase::Error;
            } else {
                data.snapshot.phase = Phase::Ready;
            }
            if let Some(update) = &data.pending {
                data.snapshot.version = update.version.clone();
                data.snapshot.notes = update.body.clone().unwrap_or_default();
            }
            data.snapshot.error = format!("{error:#}");
        });
    }
    fn updater(&self, app: &AppHandle) -> Result<tauri_plugin_updater::Updater> {
        Ok(app
            .updater_builder()
            .timeout(Duration::from_secs(30))
            .build()?)
    }
    async fn restore(&self, app: &AppHandle) -> Result<()> {
        let Some(manifest) = read_manifest(&self.directory)? else {
            return Ok(());
        };
        let Some(update) = self.updater(app)?.restore_update(manifest)? else {
            self.clear_cache();
            return Ok(());
        };
        validate_update(&update)?;
        let bytes = read_package(&self.directory)?;
        update.verify(&bytes)?;
        self.ready(update, bytes.len() as u64);
        Ok(())
    }
    fn ready(&self, update: Update, size: u64) {
        self.edit(|data| {
            data.snapshot.version = update.version.clone();
            data.snapshot.notes = update.body.clone().unwrap_or_default();
            data.snapshot.phase = Phase::Ready;
            data.snapshot.downloaded = size;
            data.snapshot.total = Some(size);
            data.snapshot.error.clear();
            data.pending = Some(update);
        });
    }
    fn clear_cache(&self) {
        let _ = std::fs::remove_file(self.directory.join("manifest.json"));
        let _ = std::fs::remove_file(self.directory.join("package"));
    }
    async fn check(&self, app: &AppHandle, manual: bool) -> Result<()> {
        let Ok(_operation) = self.operation.try_lock() else {
            return Ok(());
        };
        let before = self.snapshot();
        if !before.supported || (!manual && !before.enabled) {
            return Ok(());
        }
        self.edit(|data| {
            data.snapshot.phase = Phase::Checking;
            data.snapshot.error.clear();
        });
        // Preference changes cancel a background request; explicit checks remain user initiated.
        let updater = self.updater(app)?;
        let update = tokio::select! {
            result = updater.check() => result?,
            _ = self.changed.notified(), if !manual => {
                self.edit(|data| data.snapshot.phase = before.phase);
                return Ok(());
            }
        };
        self.edit(|data| data.snapshot.last_checked = Some(now()));
        let Some(mut update) = update else {
            self.edit(|data| {
                data.snapshot.phase = if data.pending.is_some() {
                    Phase::Ready
                } else {
                    Phase::Idle
                }
            });
            return Ok(());
        };
        validate_update(&update)?;
        if before.phase == Phase::Ready && before.version == update.version {
            self.edit(|data| data.snapshot.phase = Phase::Ready);
            return Ok(());
        }
        // A newer release supersedes the old cache only after its complete signature verifies.
        self.edit(|data| {
            data.snapshot.phase = Phase::Downloading;
            data.snapshot.version = update.version.clone();
            data.snapshot.notes = update.body.clone().unwrap_or_default();
            data.snapshot.downloaded = 0;
            data.snapshot.total = None;
        });
        update.timeout = Some(Duration::from_secs(15 * 60));
        let bytes = tokio::select! {
            result = update.download(|size, total| self.edit(|data| {
                data.snapshot.downloaded += size as u64;
                data.snapshot.total = total;
            }), || {}) => result?,
            _ = self.changed.notified(), if !manual => {
                self.edit(settle);
                return Ok(());
            }
        };
        if bytes.len() as u64 > MAX_PACKAGE_SIZE {
            bail!("更新包超过大小限制，请从发行页面下载。");
        }
        config::atomic_private(&self.directory.join("package"), &bytes)?;
        config::atomic_private(
            &self.directory.join("manifest.json"),
            &serde_json::to_vec(&update.raw_json)?,
        )?;
        self.ready(update, bytes.len() as u64);
        Ok(())
    }
    pub fn start(&self, app: AppHandle, service: manager::Handle) {
        let handle = self.clone();
        tauri::async_runtime::spawn(async move {
            resume_saved(&handle.directory, &service).await;
            if !handle.snapshot().supported {
                return;
            }
            if let Err(error) = handle.restore(&app).await {
                handle.clear_cache();
                handle.fail(error.context("已丢弃无法验证的更新缓存"));
            }
            let mut delay = Duration::from_secs(30);
            let mut failures = 0;
            loop {
                tokio::select! { _ = tokio::time::sleep(delay) => (), _ = handle.changed.notified() => () }
                if handle.snapshot().enabled {
                    match handle.check(&app, false).await {
                        Ok(()) => {
                            failures = 0;
                            delay = CHECK_INTERVAL;
                        }
                        Err(error) => {
                            handle.fail(error);
                            failures += 1;
                            delay = retry_delay(failures);
                        }
                    }
                } else {
                    delay = CHECK_INTERVAL;
                }
            }
        });
    }
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn retry_delay(failures: u32) -> Duration {
    Duration::from_secs(match failures {
        0 | 1 => 5 * 60,
        2 => 15 * 60,
        3 => 60 * 60,
        _ => 6 * 60 * 60,
    })
}
fn validate_update(update: &Update) -> Result<()> {
    let version = semver::Version::parse(&update.version)?;
    let current = semver::Version::parse(&update.current_version)?;
    if version <= current || !version.pre.is_empty() {
        bail!("更新版本必须高于当前正式版本。");
    }
    let url = &update.download_url;
    if url.scheme() != "https"
        || url.host_str() != Some("github.com")
        || !url
            .path()
            .starts_with("/ywateru/AnyWork/releases/download/")
        || !url.username().is_empty()
        || url.password().is_some()
    {
        bail!("更新包必须来自 AnyWork 的官方 HTTPS 发行地址。");
    }
    Ok(())
}
fn read_manifest(directory: &Path) -> Result<Option<serde_json::Value>> {
    let path = directory.join("manifest.json");
    match std::fs::metadata(&path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
        Ok(metadata) => {
            if metadata.len() > 1024 * 1024 {
                bail!("更新清单过大。");
            }
            Ok(Some(serde_json::from_slice(&std::fs::read(path)?)?))
        }
    }
}
fn read_package(directory: &Path) -> Result<Vec<u8>> {
    let path = directory.join("package");
    let size = std::fs::metadata(&path)?.len();
    if size == 0 || size > MAX_PACKAGE_SIZE {
        bail!("更新缓存大小无效。");
    }
    Ok(std::fs::read(path)?)
}

// Only switches are persisted; access keys remain in their existing protected stores.
#[derive(Debug, Serialize, Deserialize)]
struct ResumePlan {
    owned: bool,
    routes: Vec<RouteKind>,
    created: u64,
}
impl ResumePlan {
    fn capture(snapshot: &manager::Snapshot) -> Self {
        Self {
            owned: snapshot.owned,
            routes: RouteKind::ALL
                .into_iter()
                .filter(|kind| snapshot.routes[kind.index()].phase.enabled())
                .collect(),
            created: now(),
        }
    }
    async fn resume(&self, service: &manager::Handle) {
        if !self.owned && self.routes.is_empty() {
            return;
        }
        if self.owned {
            let state = service.snapshot();
            service.send(manager::Command::StartServer(state.config, state.token));
        }
        for _ in 0..120 {
            let state = service.snapshot();
            if state.authorized && state.secrets_loaded {
                for kind in &self.routes {
                    service.send(manager::Command::StartRoute(
                        *kind,
                        state.config.clone(),
                        state.secrets[kind.index()].clone(),
                    ));
                }
                return;
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
    }
}
async fn resume_saved(directory: &Path, service: &manager::Handle) {
    let path = directory.join("resume.json");
    if let Ok(bytes) = std::fs::read(&path) {
        // Consume once, including after an unsuccessful restart into the previous version.
        let _ = std::fs::remove_file(path);
        if let Ok(plan) = serde_json::from_slice::<ResumePlan>(&bytes)
            && now().saturating_sub(plan.created) < 60 * 60
        {
            plan.resume(service).await;
        }
    }
}
pub fn supported(preview: bool) -> bool {
    if preview || cfg!(debug_assertions) {
        return false;
    }
    #[cfg(target_os = "macos")]
    {
        std::env::current_exe()
            .ok()
            .is_some_and(|path| path.parent().is_some_and(|p| p.ends_with("Contents/MacOS")))
    }
    #[cfg(target_os = "windows")]
    {
        matches!(
            tauri::utils::platform::bundle_type(),
            Some(
                tauri::utils::config::BundleType::Nsis | tauri::utils::config::BundleType::Msi
            )
        )
    }
    #[cfg(target_os = "linux")]
    {
        std::env::var_os("APPIMAGE").is_some()
    }
}

#[tauri::command]
pub fn desktop_update_snapshot(updates: State<'_, Handle>) -> Snapshot {
    updates.snapshot()
}
#[tauri::command]
pub async fn desktop_update_check(
    app: AppHandle,
    updates: State<'_, Handle>,
) -> Result<Snapshot, String> {
    if let Err(error) = updates.check(&app, true).await {
        updates.fail(error);
    }
    Ok(updates.snapshot())
}
#[tauri::command]
pub fn desktop_update_preferences(
    updates: State<'_, Handle>,
    enabled: bool,
) -> Result<Snapshot, String> {
    updates
        .preferences(|p| p.enabled = enabled)
        .map_err(|e| e.to_string())?;
    updates.changed.notify_waiters();
    Ok(updates.snapshot())
}
#[tauri::command]
pub fn desktop_update_defer(updates: State<'_, Handle>) -> Result<Snapshot, String> {
    let version = updates.snapshot().version;
    updates
        .preferences(|p| {
            p.deferred_version = version;
            p.deferred_until = now() + 24 * 60 * 60;
        })
        .map_err(|e| e.to_string())?;
    Ok(updates.snapshot())
}
#[tauri::command]
pub async fn desktop_update_install(
    app: AppHandle,
    updates: State<'_, Handle>,
    version: String,
) -> Result<(), String> {
    let _operation = updates
        .operation
        .try_lock()
        .map_err(|_| "更新操作正在进行，请稍候。")?;
    let state = updates.snapshot();
    if !state.supported || state.phase != Phase::Ready || state.version != version {
        return Err("更新状态已改变，请重新查看后确认。".into());
    }
    let update = updates
        .data
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .pending
        .clone()
        .ok_or("更新包未准备好。")?;
    let bytes = read_package(&updates.directory).map_err(|e| e.to_string())?;
    // Recheck before stopping any service, even when the cached bytes changed on disk.
    if update.verify(&bytes).is_err() {
        updates.clear_cache();
        updates.edit(|data| data.pending = None);
        updates.fail(anyhow::anyhow!("更新包校验失败，请重新检查更新。"));
        return Err(updates.snapshot().error);
    }
    let service = app.state::<crate::bridge::DesktopState>().handle.clone();
    let plan = ResumePlan::capture(&service.snapshot());
    let resume_path = updates.directory.join("resume.json");
    config::atomic_private(
        &resume_path,
        &serde_json::to_vec(&plan).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    updates.edit(|data| data.snapshot.phase = Phase::Installing);
    if let Err(error) = service.pause_for_update().await {
        let _ = std::fs::remove_file(resume_path);
        updates.fail(error.context("无法安全暂停本应用的服务，未安装更新"));
        plan.resume(&service).await;
        return Err(updates.snapshot().error);
    }
    let result = tauri::async_runtime::spawn_blocking(move || update.install(&bytes)).await;
    match result {
        Ok(Ok(())) => {
            app.request_restart();
            Ok(())
        }
        error => {
            let _ = std::fs::remove_file(resume_path);
            let message = match error {
                Ok(Err(e)) => e.to_string(),
                Err(e) => e.to_string(),
                _ => unreachable!(),
            };
            updates.fail(anyhow::anyhow!("安装未完成，已保留当前版本：{message}"));
            plan.resume(&service).await;
            Err(updates.snapshot().error)
        }
    }
}
#[tauri::command]
pub fn desktop_update_open_releases() -> Result<(), String> {
    open::that_detached(RELEASES).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn signed_fixture() -> (tauri_plugin_updater::Updater, serde_json::Value, Vec<u8>) {
        let fixture: serde_json::Value =
            serde_json::from_str(include_str!("../tests/fixtures/signed-update.json")).unwrap();
        let mut context = tauri::test::mock_context(tauri::test::noop_assets());
        context.config_mut().plugins.0.insert(
            "updater".into(),
            serde_json::json!({"pubkey":fixture["publicKey"], "requireSignedVersion":true}),
        );
        let app = tauri::test::mock_builder()
            .plugin(
                tauri_plugin_updater::Builder::new()
                    .target("fixture")
                    .pubkey(fixture["publicKey"].as_str().unwrap())
                    .build(),
            )
            .build(context)
            .unwrap();
        let updater = app
            .updater_builder()
            .endpoints(vec!["https://example.invalid/update".parse().unwrap()])
            .unwrap()
            .configure_client(|_| panic!("signature tests must never make network requests"))
            .build()
            .unwrap();
        let manifest = serde_json::json!({"version":"9.0.0", "platforms":{"fixture":{
            "url":"https://github.com/ywateru/AnyWork/releases/download/v9.0.0/fixture",
            "signature":fixture["signature"]}}});
        (
            updater,
            manifest,
            fixture["payload"].as_str().unwrap().as_bytes().to_vec(),
        )
    }
    #[test]
    fn signed_cache_can_be_restored_offline_and_tampering_is_rejected() {
        let (updater, mut manifest, mut bytes) = signed_fixture();
        let update = updater.restore_update(manifest.clone()).unwrap().unwrap();
        validate_update(&update).unwrap();
        update.verify(&bytes).unwrap();
        bytes.push(0);
        assert!(update.verify(&bytes).is_err());
        bytes.pop();
        manifest["version"] = serde_json::json!("9.0.1");
        let update = updater.restore_update(manifest).unwrap().unwrap();
        assert!(
            update.verify(&bytes).is_err(),
            "manifest must not relabel an older signed package"
        );
    }
    #[test]
    fn lower_versions_prereleases_and_foreign_download_origins_are_rejected() {
        let (updater, mut manifest, _) = signed_fixture();
        for version in ["0.0.0", "0.1.0"] {
            manifest["version"] = serde_json::json!(version);
            assert!(updater.restore_update(manifest.clone()).unwrap().is_none());
        }
        manifest["version"] = serde_json::json!("9.0.0-beta.1");
        assert!(
            validate_update(&updater.restore_update(manifest.clone()).unwrap().unwrap()).is_err()
        );
        manifest["version"] = serde_json::json!("9.0.0");
        for url in [
            "http://github.com/ywateru/AnyWork/releases/download/v9/fixture",
            "https://github.com/other/project/releases/download/v9/fixture",
            "https://example.com/payload",
        ] {
            manifest["platforms"]["fixture"]["url"] = serde_json::json!(url);
            assert!(
                validate_update(&updater.restore_update(manifest.clone()).unwrap().unwrap())
                    .is_err()
            );
        }
    }
    #[test]
    fn preferences_survive_restart_and_defer_only_the_selected_version() {
        let dir = tempfile::tempdir().unwrap();
        let updates = Handle::new(dir.path(), true);
        updates
            .preferences(|p| {
                p.enabled = false;
                p.deferred_version = "1.0.0".into();
                p.deferred_until = now() + 86400;
            })
            .unwrap();
        let updates = Handle::new(dir.path(), true);
        assert!(!updates.snapshot().enabled);
        updates.edit(|d| {
            d.snapshot.phase = Phase::Ready;
            d.snapshot.version = "1.0.0".into();
        });
        assert!(!updates.snapshot().show_notice);
        updates.edit(|d| d.snapshot.version = "1.0.1".into());
        assert!(updates.snapshot().show_notice);
        updates.preferences(|p| p.deferred_until = 0).unwrap();
        updates.edit(|d| d.snapshot.version = "1.0.0".into());
        assert!(updates.snapshot().show_notice);
    }
    #[test]
    fn backoff_is_bounded_and_background_failures_do_not_raise_notices() {
        assert_eq!(retry_delay(1), Duration::from_secs(300));
        assert_eq!(retry_delay(20), CHECK_INTERVAL);
        let dir = tempfile::tempdir().unwrap();
        let updates = Handle::new(dir.path(), true);
        updates.fail(anyhow::anyhow!("offline"));
        assert_eq!(updates.snapshot().phase, Phase::Error);
        assert!(!updates.snapshot().show_notice);
    }
    #[test]
    fn corrupt_or_oversized_cache_is_rejected() {
        let dir = tempfile::tempdir().unwrap();
        assert!(read_manifest(dir.path()).unwrap().is_none());
        std::fs::write(dir.path().join("manifest.json"), "invalid").unwrap();
        assert!(read_manifest(dir.path()).is_err());
        let f = std::fs::File::create(dir.path().join("package")).unwrap();
        assert!(read_package(dir.path()).is_err());
        f.set_len(MAX_PACKAGE_SIZE + 1).unwrap();
        assert!(read_package(dir.path()).is_err());
    }
    #[test]
    fn resume_plan_never_contains_credentials_or_external_service_ownership() {
        let mut snapshot = manager::Snapshot::new(config::Config::default(), "secret-token".into());
        snapshot.external = true;
        snapshot.routes[0].phase = manager::Phase::Running;
        let plan = ResumePlan::capture(&snapshot);
        assert!(!plan.owned);
        assert_eq!(plan.routes, vec![RouteKind::Quick]);
        assert!(!serde_json::to_string(&plan).unwrap().contains("secret"));
    }
}
