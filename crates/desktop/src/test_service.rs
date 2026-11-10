//! Test-only child service: pin a preflighted interpreter and retain safe fixture diagnostics.
use crate::{config, process};
use std::{
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    time::Duration,
};

pub(crate) struct Service {
    root: PathBuf,
    pub executable: PathBuf,
}
fn quoted(path: &Path) -> String {
    format!("'{}'", path.to_str().unwrap().replace('\'', "'\\''"))
}
impl Service {
    pub fn new(root: &Path, mode: &str) -> Self {
        assert!(["normal", "startup-error", "bind-conflict", "unauthorized"].contains(&mode));
        // Resolve before the manager prepends its production PATH. -I ignores
        // Python environment/site customizations; preflight the exact stdlib used.
        let preflight = std::process::Command::new("python3")
            .args(["-I", "-c", "import argparse,http.server,json,pathlib,socket,sys,threading; print(sys.executable)"])
            .output().expect("Native fixture requires Python 3");
        assert!(
            preflight.status.success(),
            "Native fixture Python preflight failed: {}",
            preflight.status
        );
        let python = PathBuf::from(String::from_utf8(preflight.stdout).unwrap().trim());
        assert!(python.is_absolute() && python.is_file());
        let script = root.join("service.py");
        std::fs::write(&script, include_str!("test_service.py")).unwrap();
        let executable = root.join("fixture-service");
        // exec preserves the single owned PID for the manager's termination.
        // This log contains only the synthetic fixture's fixed codes, never a
        // real service's output, token, environment or request headers.
        std::fs::write(
            &executable,
            format!(
                "#!/bin/sh\nexec {} -I -u {} --fixture-root {} --fixture-mode {} \"$@\" >{} 2>&1\n",
                quoted(&python),
                quoted(&script),
                quoted(root),
                mode,
                quoted(&root.join("service-stderr.log"))
            ),
        )
        .unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700)).unwrap();
        Self {
            root: root.into(),
            executable,
        }
    }
    pub fn status(&self) -> serde_json::Value {
        std::fs::read(self.root.join("service-status.json"))
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or(serde_json::Value::Null)
    }
    pub fn diagnostics(&self) -> String {
        // Fixed-code output only, even if the interpreter fails before startup.
        let stderr = std::fs::read(self.root.join("service-stderr.log")).unwrap_or_default();
        format!(
            "fixture status={}; stderrPresent={}; startupError={}; bindError={}",
            self.status(),
            !stderr.is_empty(),
            stderr
                .windows(b"NATIVE_FIXTURE_STARTUP_ERROR".len())
                .any(|w| w == b"NATIVE_FIXTURE_STARTUP_ERROR"),
            stderr
                .windows(b"NATIVE_FIXTURE_BIND_ERROR".len())
                .any(|w| w == b"NATIVE_FIXTURE_BIND_ERROR")
        )
    }
    async fn ready(&self, child: &mut tokio::process::Child) {
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                if self.status()["stage"] == "ready" {
                    break;
                }
                assert!(
                    child.try_wait().unwrap().is_none(),
                    "{}",
                    self.diagnostics()
                );
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap_or_else(|_| panic!("{}", self.diagnostics()));
    }
}
fn fixture_config(root: &Path, service: &Service) -> config::Config {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    config::Config {
        workspace: root.display().to_string(),
        data_directory: root.join("data").display().to_string(),
        server_binary: service.executable.display().to_string(),
        port: listener.local_addr().unwrap().port(),
        ..Default::default()
    }
}

#[tokio::test]
async fn pinned_fixture_ignores_path_shadow_and_preserves_single_owned_child() {
    let dir = tempfile::tempdir().unwrap();
    let service = Service::new(dir.path(), "normal");
    let config = fixture_config(dir.path(), &service);
    config::write_token(&config, "synthetic-fixture-token").unwrap();
    let shadow = dir.path().join("shadow");
    std::fs::create_dir(&shadow).unwrap();
    let marker = dir.path().join("shadow-ran");
    let impostor = shadow.join("python3");
    std::fs::write(
        &impostor,
        format!("#!/bin/sh\nprintf hit >{}\nexit 87\n", quoted(&marker)),
    )
    .unwrap();
    std::fs::set_permissions(&impostor, std::fs::Permissions::from_mode(0o700)).unwrap();
    let old = std::process::Command::new("/usr/bin/env")
        .arg("python3")
        .env("PATH", &shadow)
        .status()
        .unwrap();
    assert_eq!(old.code(), Some(87));
    assert!(marker.exists());
    std::fs::remove_file(&marker).unwrap();
    let plan = process::LaunchPlan::server(&config, dir.path()).unwrap();
    let mut child = plan.command().env("PATH", &shadow).spawn().unwrap();
    service.ready(&mut child).await;
    assert!(!marker.exists());
    let info = crate::manager::Http::new()
        .unwrap()
        .info(&config.local_url(), &config::read_token(&config), false)
        .await
        .unwrap();
    assert_eq!(info.workspace, config.workspace);
    assert!(info.local_browser_session);
    unsafe {
        libc::kill(child.id().unwrap() as i32, libc::SIGTERM);
    }
    assert!(
        !tokio::time::timeout(Duration::from_secs(5), child.wait())
            .await
            .unwrap()
            .unwrap()
            .success()
    );
    assert!(
        tokio::net::TcpStream::connect(("127.0.0.1", config.port))
            .await
            .is_err()
    );
    assert_eq!(service.status()["ticketRequests"], 0);
}
#[tokio::test]
async fn fixture_startup_and_bind_failures_preserve_exit_and_safe_stderr_evidence() {
    for (mode, code, stage) in [
        ("startup-error", 73, "startup-error"),
        ("bind-conflict", 74, "bind-error"),
    ] {
        let dir = tempfile::tempdir().unwrap();
        let service = Service::new(dir.path(), mode);
        let config = fixture_config(dir.path(), &service);
        let plan = process::LaunchPlan::server(&config, dir.path()).unwrap();
        let mut process = process::OwnedProcess::spawn(&plan).unwrap();
        assert_eq!(
            tokio::time::timeout(Duration::from_secs(5), process.child.wait())
                .await
                .unwrap()
                .unwrap()
                .code(),
            Some(code)
        );
        assert_eq!(service.status()["stage"], stage);
        assert_eq!(service.status()["infoRequests"], 0);
        assert_eq!(service.status()["ticketRequests"], 0);
        assert!(service.diagnostics().contains("stderrPresent=true"));
        assert!(
            crate::manager::Http::new()
                .unwrap()
                .info(&config.local_url(), "synthetic-fixture-token", false)
                .await
                .is_err()
        );
        process.stop().await;
    }
}
#[tokio::test]
async fn fixture_auth_failure_is_observed_and_external_service_is_preserved() {
    let dir = tempfile::tempdir().unwrap();
    let service = Service::new(dir.path(), "unauthorized");
    let config = fixture_config(dir.path(), &service);
    config::save(&dir.path().join("manager.json"), &config).unwrap();
    config::write_token(&config, "synthetic-fixture-token").unwrap();
    let plan = process::LaunchPlan::server(&config, dir.path()).unwrap();
    let mut process = process::OwnedProcess::spawn(&plan).unwrap();
    service.ready(&mut process.child).await;
    let manager = crate::manager::start(crate::manager::Options {
        support: dir.path().into(),
        resources: dir.path().into(),
    })
    .unwrap();
    assert!(manager.prepare_workspace().await.is_err());
    assert!(!manager.snapshot().authorized);
    assert!(!manager.snapshot().owned);
    assert!(
        service.status()["unauthorizedInfoRequests"]
            .as_u64()
            .unwrap()
            > 0
    );
    assert_eq!(service.status()["authorizedInfoRequests"], 0);
    assert_eq!(service.status()["ticketRequests"], 0);
    manager.shutdown().await;
    assert!(process.child.try_wait().unwrap().is_none());
    assert_eq!(config::read_token(&config), "synthetic-fixture-token");
    process.stop().await;
}

#[tokio::test]
async fn owned_startup_failure_stays_closed_until_explicit_retry() {
    let dir = tempfile::tempdir().unwrap();
    let fixture = Service::new(dir.path(), "startup-error");
    let config = fixture_config(dir.path(), &fixture);
    config::save(&dir.path().join("manager.json"), &config).unwrap();
    let manager = crate::manager::start(crate::manager::Options {
        support: dir.path().into(),
        resources: dir.path().into(),
    })
    .unwrap();
    assert!(manager.prepare_workspace().await.is_err());
    assert!(!manager.snapshot().authorized);
    assert_eq!(fixture.status()["stage"], "startup-error");
    assert_eq!(fixture.status()["infoRequests"], 0);
    assert_eq!(fixture.status()["ticketRequests"], 0);
    assert!(fixture.diagnostics().contains("startupError=true"));
    tokio::time::timeout(Duration::from_secs(2), async {
        while manager.snapshot().owned {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    assert_eq!(manager.snapshot().service, crate::manager::Phase::Error);
    assert!(
        tokio::net::TcpStream::connect(("127.0.0.1", config.port))
            .await
            .is_err()
    );
    let token = config::read_token(&config);
    let recovered = Service::new(dir.path(), "normal");
    // Replacing the fixture's child implementation does not issue a manager
    // command; recovery starts only through this explicit second preparation.
    assert_eq!(manager.snapshot().service, crate::manager::Phase::Error);
    manager.prepare_workspace().await.unwrap();
    assert!(manager.snapshot().owned && manager.snapshot().authorized);
    assert_eq!(config::read_token(&config), token);
    assert_eq!(recovered.status()["ticketRequests"], 0);
    manager.shutdown().await;
    assert!(
        tokio::net::TcpStream::connect(("127.0.0.1", config.port))
            .await
            .is_err()
    );
}
