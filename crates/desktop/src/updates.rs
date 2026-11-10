//! Background downloads never install or restart without a local confirmation.
//! Tauri verifies a version-bound signature both on download and on installation.
use crate::{config, manager};
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
    #[cfg(test)]
    executable_path: Option<PathBuf>,
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
            #[cfg(test)]
            executable_path: None,
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
    fn updater<R: tauri::Runtime>(
        &self,
        app: &AppHandle<R>,
    ) -> Result<tauri_plugin_updater::Updater> {
        let builder = app.updater_builder().timeout(Duration::from_secs(30));
        #[cfg(test)]
        let builder = if let Some(path) = &self.executable_path {
            builder.executable_path(path)
        } else {
            builder
        };
        Ok(builder.build()?)
    }
    async fn restore<R: tauri::Runtime>(&self, app: &AppHandle<R>) -> Result<()> {
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
    async fn check<R: tauri::Runtime>(&self, app: &AppHandle<R>, manual: bool) -> Result<()> {
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
        let oversized = Notify::new();
        let bytes = tokio::select! {
            result = update.download(|size, total| self.edit(|data| {
                data.snapshot.downloaded += size as u64;
                data.snapshot.total = total;
                if data.snapshot.downloaded > MAX_PACKAGE_SIZE || total.is_some_and(|size| size > MAX_PACKAGE_SIZE) {
                    oversized.notify_one();
                }
            }), || {}) => result?,
            _ = oversized.notified() => bail!("更新包超过大小限制，请从发行页面下载。"),
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
    pub fn start<R: tauri::Runtime>(&self, app: AppHandle<R>) {
        let handle = self.clone();
        tauri::async_runtime::spawn(async move {
            // A new process must complete account-first onboarding. Old disk
            // resume hints stay untouched and never admit a service startup.
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

// RAM-only recovery for a failed installation in this admitted lifecycle.
struct ResumePlan {
    service: Option<(config::Config, String)>,
}
impl ResumePlan {
    fn capture(snapshot: &manager::Snapshot) -> Self {
        Self {
            service: snapshot
                .owned
                .then(|| (snapshot.config.clone(), snapshot.token.clone())),
        }
    }
    async fn resume(&self, service: &manager::Handle) {
        if let Some((config, token)) = &self.service {
            service.send(manager::Command::StartServer(config.clone(), token.clone()));
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
            Some(tauri::utils::config::BundleType::Nsis | tauri::utils::config::BundleType::Msi)
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
pub fn desktop_update_defer(
    updates: State<'_, Handle>,
    version: String,
) -> Result<Snapshot, String> {
    if updates.snapshot().version != version {
        return Err("可用更新已改变，请重新查看。".into());
    }
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
    let service = app.state::<crate::bridge::DesktopState>().handle.clone();
    install_ready(&updates, &service, &version).await?;
    app.request_restart();
    Ok(())
}
async fn install_ready(
    updates: &Handle,
    service: &manager::Handle,
    version: &str,
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
    let bytes = match read_package(&updates.directory) {
        Ok(bytes) => bytes,
        Err(error) => {
            updates.clear_cache();
            updates.edit(|data| data.pending = None);
            updates.fail(error.context("更新缓存不可读取，请重新检查更新"));
            return Err(updates.snapshot().error);
        }
    };
    // Recheck before stopping any service, even when the cached bytes changed on disk.
    if update.verify(&bytes).is_err() {
        updates.clear_cache();
        updates.edit(|data| data.pending = None);
        updates.fail(anyhow::anyhow!("更新包校验失败，请重新检查更新。"));
        return Err(updates.snapshot().error);
    }
    let plan = ResumePlan::capture(&service.snapshot());
    updates.edit(|data| data.snapshot.phase = Phase::Installing);
    if let Err(error) = service.pause_for_update().await {
        updates.fail(error.context("无法安全暂停本应用的服务，未安装更新"));
        return Err(updates.snapshot().error);
    }
    let result = tauri::async_runtime::spawn_blocking(move || update.install(&bytes)).await;
    match result {
        Ok(Ok(())) => Ok(()),
        error => {
            let message = match error {
                Ok(Err(e)) => e.to_string(),
                Err(e) => e.to_string(),
                _ => unreachable!(),
            };
            updates.fail(anyhow::anyhow!("安装未完成，已保留当前版本：{message}"));
            plan.resume(service).await;
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
    #[cfg(target_os = "macos")]
    #[tokio::test]
    #[ignore = "downloads a published update and installs only into a fresh temporary app copy"]
    async fn published_update_installs_into_isolated_app() {
        use sha2::{Digest, Sha256};
        use std::process::Command;
        fn plist(app: &Path, key: &str) -> String {
            let result = Command::new("/usr/bin/plutil")
                .args(["-extract", key, "raw", "-o", "-"])
                .arg(app.join("Contents/Info.plist"))
                .output()
                .unwrap();
            assert!(result.status.success());
            String::from_utf8(result.stdout).unwrap().trim().into()
        }
        let base = PathBuf::from(
            std::env::var_os("ANYWORK_UPDATE_SMOKE_BASE_APP")
                .expect("Supply an already downloaded AnyWork.app"),
        );
        let from =
            std::env::var("ANYWORK_UPDATE_SMOKE_FROM").expect("Supply the expected old version");
        let to = std::env::var("ANYWORK_UPDATE_SMOKE_TO")
            .expect("Supply the exact published update version");
        assert_eq!(plist(&base, "CFBundleShortVersionString"), from);
        let old_name = plist(&base, "CFBundleExecutable");
        let original_executable = base.join("Contents/MacOS").join(&old_name);
        let original_hash = Sha256::digest(std::fs::read(&original_executable).unwrap());
        let sandbox = tempfile::Builder::new()
            .prefix("anywork-signed-update-smoke-")
            .tempdir()
            .unwrap();
        let installed = sandbox.path().join("AnyWork.app");
        assert!(
            Command::new("/usr/bin/ditto")
                .arg(&base)
                .arg(&installed)
                .status()
                .unwrap()
                .success()
        );
        let support = sandbox.path().join("support");
        let configuration: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let mut context = tauri::test::mock_context(tauri::test::noop_assets());
        context.package_info_mut().version = from.parse().unwrap();
        context.config_mut().plugins.0.insert(
            "updater".into(),
            configuration["plugins"]["updater"].clone(),
        );
        let app = tauri::test::mock_builder()
            .plugin(tauri_plugin_updater::Builder::new().build())
            .build(context)
            .unwrap();
        let mut updates = Handle::new(&support, true);
        updates.executable_path = Some(installed.join("Contents/MacOS").join(&old_name));
        updates.edit(|data| data.snapshot.current_version = from.clone());
        let download = updates.check(app.handle(), true);
        tokio::pin!(download);
        loop {
            tokio::select! {
                result = &mut download => { result.unwrap(); break; }
                _ = tokio::time::sleep(Duration::from_secs(15)) => {
                    let state = updates.snapshot();
                    println!("Published update: {:?}, {:.1} MB downloaded", state.phase, state.downloaded as f64 / 1_048_576.0);
                }
            }
        }
        assert_eq!(updates.snapshot().phase, Phase::Ready);
        assert_eq!(updates.snapshot().version, to);
        assert_eq!(
            plist(&installed, "CFBundleShortVersionString"),
            from,
            "background download must not install"
        );
        let cached = read_package(&updates.directory).unwrap();
        let manifest = std::fs::read(updates.directory.join("manifest.json")).unwrap();
        let mut corrupt = cached.clone();
        corrupt[0] ^= 1;
        config::atomic_private(&updates.directory.join("package"), &corrupt).unwrap();
        let preview = manager::Handle::preview(manager::Snapshot::new(
            config::Config::default(),
            String::new(),
        ));
        assert!(
            install_ready(&updates, &preview, &to).await.is_err(),
            "tampered cache must fail before touching any service or app"
        );
        assert_eq!(plist(&installed, "CFBundleShortVersionString"), from);
        config::atomic_private(&updates.directory.join("package"), &cached).unwrap();
        config::atomic_private(&updates.directory.join("manifest.json"), &manifest).unwrap();
        // Fresh process state restores and verifies the cache without a network check.
        let mut restored = Handle::new(&support, true);
        restored.executable_path = updates.executable_path.clone();
        restored.restore(app.handle()).await.unwrap();
        assert_eq!(restored.snapshot().phase, Phase::Ready);
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let settings = config::Config {
            workspace: sandbox.path().display().to_string(),
            data_directory: support.join("data").display().to_string(),
            port,
            ..Default::default()
        };
        config::save(&support.join("manager.json"), &settings).unwrap();
        drop(listener);
        let service = manager::start(manager::Options {
            support: support.clone(),
            resources: installed.join("Contents/Resources"),
        })
        .unwrap();
        assert!(
            install_ready(&restored, &service, "0.0.0").await.is_err(),
            "stale confirmation must not install"
        );
        install_ready(&restored, &service, &to).await.unwrap();
        service.shutdown().await;
        assert_eq!(plist(&installed, "CFBundleShortVersionString"), to);
        let executable = installed
            .join("Contents/MacOS")
            .join(plist(&installed, "CFBundleExecutable"));
        let launch = Command::new(&executable).arg("--version").output().unwrap();
        assert!(launch.status.success());
        assert_eq!(
            String::from_utf8_lossy(&launch.stdout).trim(),
            format!("AnyWork {to}")
        );
        let server = installed.join("Contents/Resources/bin/anywork");
        let server_version = Command::new(server).arg("--version").output().unwrap();
        assert!(String::from_utf8_lossy(&server_version.stdout).contains(&to));
        assert!(
            Command::new("/usr/bin/codesign")
                .args(["--verify", "--deep", "--strict"])
                .arg(&installed)
                .status()
                .unwrap()
                .success()
        );
        // Launch the installed GUI with isolated storage and inert preview IPC.
        // Never open a user's manager, credentials, service or agent connection.
        let gui_log = sandbox.path().join("gui.log");
        let output = std::fs::File::create(&gui_log).unwrap();
        let mut gui = Command::new(&executable)
            .args(["--preview", "overview"])
            .env("ANYWORK_MANAGER_HOME", sandbox.path().join("gui-support"))
            .stdout(output.try_clone().unwrap())
            .stderr(output)
            .spawn()
            .unwrap();
        let mut frontend_connected = false;
        for _ in 0..100 {
            let log = std::fs::read_to_string(&gui_log).unwrap_or_default();
            if log.contains("preview frontend connected to Rust/Tauri IPC") {
                frontend_connected = true;
                break;
            }
            if gui.try_wait().unwrap().is_some() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
        // The PID belongs to the disposable preview child created just above.
        unsafe {
            libc::kill(gui.id() as i32, libc::SIGTERM);
        }
        let _ = gui.wait();
        assert!(
            frontend_connected,
            "the updated GUI must load its bundled frontend and connect to IPC"
        );
        assert_eq!(
            Sha256::digest(std::fs::read(&original_executable).unwrap()),
            original_hash,
            "base app must remain untouched"
        );
        if let Some(path) = std::env::var_os("ANYWORK_UPDATE_SMOKE_REPORT") {
            std::fs::write(path, serde_json::to_vec_pretty(&serde_json::json!({"from":from,"to":to,"backgroundDownload":true,"signatureVerified":true,"tamperedCacheRejected":true,"offlineCacheRestored":true,"staleConfirmationRejected":true,"installedIntoTemporaryCopy":true,"newDesktopExecutableLaunched":true,"updatedGuiConnectedToIpc":frontend_connected,"serverVersionUpdated":true,"codesignVerified":true,"originalAppUnchanged":true})).unwrap()).unwrap();
        }
        println!(
            "Published update verified: {from} -> {to}; only a disposable app copy was changed."
        );
    }
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
    fn resume_plan_does_not_capture_external_service() {
        let mut snapshot = manager::Snapshot::new(config::Config::default(), "secret-token".into());
        snapshot.external = true;
        let plan = ResumePlan::capture(&snapshot);
        assert!(plan.service.is_none());
    }
    #[tokio::test]
    async fn failed_install_rollback_uses_only_the_captured_owned_service() {
        let mut snapshot = manager::Snapshot::new(config::Config::default(), "admitted-key".into());
        snapshot.owned = true;
        snapshot.config.port = 32651;
        let plan = ResumePlan::capture(&snapshot);
        let mut later = snapshot.clone();
        later.config.port = 32652;
        later.token = "later-key".into();
        let (service, mut commands) = manager::Handle::test_commands(later);
        plan.resume(&service).await;
        match commands.try_recv().unwrap() {
            manager::Command::StartServer(config, token) => {
                assert_eq!(config.port, 32651);
                assert_eq!(token, "admitted-key");
            }
            _ => panic!("expected only owned service recovery"),
        }
        snapshot.owned = false;
        ResumePlan::capture(&snapshot).resume(&service).await;
        assert!(commands.try_recv().is_err());
    }
    #[tokio::test]
    async fn startup_preserves_disk_resume_hints_without_starting_a_service() {
        let dir = tempfile::tempdir().unwrap();
        let updates = Handle::new(dir.path(), false);
        std::fs::create_dir_all(&updates.directory).unwrap();
        let path = updates.directory.join("resume.json");
        let bytes = serde_json::to_vec(&serde_json::json!({"owned":true,"created":now()})).unwrap();
        std::fs::write(&path, &bytes).unwrap();
        let (service, mut commands) = manager::Handle::test_commands(manager::Snapshot::new(
            config::Config::default(),
            String::new(),
        ));
        let app = tauri::test::mock_builder()
            .manage(crate::bridge::DesktopState {
                handle: service,
                preview: None,
            })
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        updates.start(app.handle().clone());
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert!(commands.try_recv().is_err());
        assert_eq!(std::fs::read(path).unwrap(), bytes);
    }
}
