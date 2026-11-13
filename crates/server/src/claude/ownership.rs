//! A cooperative AnyWork lease plus the native CLI's live session registry.
//! Registry observations only reject ownership; they never grant permission to
//! control a native process. Never remove native PID/lock/session records.
use super::Config;
use anyhow::{Context, Result, ensure};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    path::Path,
};

pub struct Lease {
    _file: File,
}
pub fn acquire(config: &Config, thread: &str) -> Result<Lease> {
    ensure!(
        config.root.is_absolute(),
        "Claude history root must be absolute"
    );
    let identity = config
        .root
        .canonicalize()
        .unwrap_or_else(|_| config.root.clone());
    let dir = std::env::temp_dir().join(format!(
        "anywork-claude-{:x}",
        Sha256::digest(identity.to_string_lossy().as_bytes())
    ));
    fs::create_dir_all(&dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        let meta = fs::symlink_metadata(&dir)?;
        ensure!(
            !meta.file_type().is_symlink() && meta.uid() == unsafe { libc::geteuid() },
            "Unsafe Claude lease directory"
        );
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o700))?;
    }
    let mut options = OpenOptions::new();
    options.read(true).write(true).create(true).truncate(false);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
    }
    let file = options.open(dir.join(format!("{thread}.lock")))?;
    fs2::FileExt::try_lock_exclusive(&file)
        .context("Claude session already has an AnyWork writer")?;
    reject_native_owner(&config.root, thread)?;
    Ok(Lease { _file: file })
}
fn reject_native_owner(root: &Path, thread: &str) -> Result<()> {
    let dir = root.join("sessions");
    if !dir.exists() {
        return Ok(());
    }
    ensure!(
        fs::symlink_metadata(&dir)?.file_type().is_dir(),
        "Claude native registry must be a real directory"
    );
    for (n, entry) in fs::read_dir(dir)?.enumerate() {
        ensure!(
            n < 10_000,
            "Claude native registry exceeds inspection limit"
        );
        let entry = entry?;
        if entry.path().extension().is_none_or(|s| s != "json") {
            continue;
        }
        let name = entry.file_name();
        let name = name.to_string_lossy();
        let Some(pid) = name
            .strip_suffix(".json")
            .and_then(|s| s.parse::<u32>().ok())
        else {
            continue;
        };
        if !alive(pid) {
            continue;
        }
        ensure!(
            entry.file_type()?.is_file(),
            "Unverifiable Claude native session registry"
        );
        let bytes = super::history::read_file(&entry.path(), 1024 * 1024)?;
        let row: serde_json::Value =
            serde_json::from_slice(&bytes).context("Invalid live Claude session registry")?;
        if row["sessionId"] != thread {
            continue;
        }
        // Claude 2.1.323 on macOS records the UTC/C-locale ps lstart string.
        // A mismatched start time proves PID reuse; an unavailable observation
        // remains uncertain and must never authorize a replacement writer.
        if let (Some(expected), Some(actual)) = (row["procStart"].as_str(), process_start(pid))
            && expected != actual
        {
            continue;
        }
        ensure!(
            row["sessionId"] != thread,
            "Claude session is owned by a live native process; stop it in its original host before resuming"
        );
    }
    Ok(())
}
#[cfg(target_os = "macos")]
fn process_start(pid: u32) -> Option<String> {
    let out = std::process::Command::new("/bin/ps")
        .args(["-o", "lstart=", "-p", &pid.to_string()])
        .env("LC_ALL", "C")
        .env("TZ", "UTC")
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let value = String::from_utf8(out.stdout).ok()?.trim().to_string();
    (!value.is_empty()).then_some(value)
}
#[cfg(not(target_os = "macos"))]
fn process_start(_pid: u32) -> Option<String> {
    None
}
#[cfg(unix)]
fn alive(pid: u32) -> bool {
    pid <= i32::MAX as u32
        && (unsafe { libc::kill(pid as i32, 0) } == 0
            || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM))
}
#[cfg(not(unix))]
fn alive(_pid: u32) -> bool {
    true
} // Fail closed when native liveness is unavailable.

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn excludes_other_anywork_and_native_writers() {
        let root = tempfile::tempdir().unwrap();
        let c = Config {
            root: root.path().into(),
            bin: "unused".into(),
        };
        let id = uuid::Uuid::new_v4().to_string();
        let lease = acquire(&c, &id).unwrap();
        assert!(acquire(&c, &id).is_err());
        drop(lease);
        fs::create_dir(root.path().join("sessions")).unwrap();
        fs::write(
            root.path()
                .join(format!("sessions/{}.json", std::process::id())),
            serde_json::json!({"sessionId":id} ).to_string(),
        )
        .unwrap();
        assert!(acquire(&c, &id).is_err());
        #[cfg(target_os = "macos")]
        {
            fs::write(
                root.path()
                    .join(format!("sessions/{}.json", std::process::id())),
                serde_json::json!({"sessionId":id,"procStart":"a different process incarnation"})
                    .to_string(),
            )
            .unwrap();
            assert!(acquire(&c, &id).is_ok());
        }
    }
}
