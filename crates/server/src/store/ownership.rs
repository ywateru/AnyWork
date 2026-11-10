//! Lifetime ownership: inode-keyed Unix sidecar (hardlinks refused), reserved-byte Windows lock.
use anyhow::{Context, Result};
use std::{
    fs::{File, OpenOptions},
    path::{Path, PathBuf},
};

pub(crate) struct OwnerGuard {
    // Normal teardown unlocks explicitly; OS handle close also covers crashes.
    _file: File,
}
impl Drop for OwnerGuard {
    fn drop(&mut self) {
        // Store drops its SQLite connection before this guard. Closing only our
        // fd is insufficient while a forked child still shares its description.
        // If unlock fails, handle close remains the fail-closed OS cleanup path.
        if unlock(&self._file).is_err() {
            tracing::warn!("Database ownership unlock failed during teardown");
        }
    }
}
impl OwnerGuard {
    pub(super) fn acquire(path: &Path) -> Result<(Self, PathBuf)> {
        let mut options = OpenOptions::new();
        options.read(true).write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        match options.open(path) {
            Ok(file) => drop(file), // Before SQLite owns any handle/record lock.
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error.into()),
        }
        let canonical = path.canonicalize()?;
        let metadata = canonical.metadata()?;
        anyhow::ensure!(metadata.is_file(), "Database must be a regular local file");
        #[cfg(unix)]
        let file = {
            use std::os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt};
            // Darwin flock conflicts with SQLite's DB locks, while closing an
            // independently opened DB fd can release SQLite POSIX locks. Use a
            // separate inode-identified guard and never open an existing DB fd.
            anyhow::ensure!(
                metadata.nlink() == 1,
                "Hard-linked database files are unsupported; use one local database path"
            );
            let guard = canonical
                .parent()
                .context("Database parent is missing")?
                .join(format!(
                    ".anywork-db-{}-{}.lock",
                    metadata.dev(),
                    metadata.ino()
                ));
            let file = OpenOptions::new()
                .read(true)
                .write(true)
                .create(true)
                .truncate(false)
                .mode(0o600)
                .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
                .open(&guard)?;
            let info = file.metadata()?;
            // SAFETY: geteuid has no arguments or borrowed memory.
            let uid = unsafe { libc::geteuid() };
            anyhow::ensure!(
                info.is_file()
                    && info.nlink() == 1
                    && info.uid() == uid
                    && info.permissions().mode() & 0o077 == 0,
                "Database owner guard must be a private regular file owned by the service user; inspect it only while the service is stopped"
            );
            file
        };
        #[cfg(windows)]
        let file = OpenOptions::new().read(true).write(true).open(&canonical)?;
        #[cfg(not(any(unix, windows)))]
        let file = OpenOptions::new().read(true).write(true).open(&canonical)?;
        lock(&file).context("Database ownership unavailable; it may already be in use by another AnyWork service. Close that service before retrying; never delete a lock to force recovery")?;
        let owner = Self { _file: file };
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            let named = path.metadata()?;
            anyhow::ensure!(
                metadata.dev() == named.dev()
                    && metadata.ino() == named.ino()
                    && named.nlink() == 1,
                "Database identity changed during opening"
            );
        }
        Ok((owner, canonical))
    }
}

#[cfg(unix)]
fn lock(file: &File) -> Result<()> {
    // Lock only the sidecar inode, never SQLite's DB inode (Darwin interaction).
    file.try_lock().map_err(anyhow::Error::from)
}

#[cfg(unix)]
fn unlock(file: &File) -> Result<()> {
    file.unlock().map_err(anyhow::Error::from)
}

#[cfg(windows)]
fn lock(file: &File) -> Result<()> {
    windows_lock(file, true)
}

#[cfg(windows)]
fn unlock(file: &File) -> Result<()> {
    windows_lock(file, false)
}

#[cfg(windows)]
fn windows_lock(file: &File, acquire: bool) -> Result<()> {
    use std::{ffi::c_void, os::windows::io::AsRawHandle};
    #[repr(C)]
    struct Overlapped {
        internal: usize,
        internal_high: usize,
        offset: u32,
        offset_high: u32,
        event: *mut c_void,
    }
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn LockFileEx(
            file: *mut c_void,
            flags: u32,
            reserved: u32,
            low: u32,
            high: u32,
            overlapped: *mut Overlapped,
        ) -> i32;
        fn UnlockFileEx(
            file: *mut c_void,
            reserved: u32,
            low: u32,
            high: u32,
            overlapped: *mut Overlapped,
        ) -> i32;
    }
    // One byte at 2^62: outside SQLite's <=2^48 byte database range and its
    // reserved locking page near 2^30. No data is written/extended. Whole-file
    // std locks would block SQLite's separate file handle on Windows.
    let mut overlapped = Overlapped {
        internal: 0,
        internal_high: 0,
        offset: 0,
        offset_high: 0x4000_0000,
        event: std::ptr::null_mut(),
    };
    // SAFETY: live synchronous handle and OVERLAPPED. Both operations use the
    // same reserved byte; never use whole-file std unlock on the SQLite inode.
    let result = unsafe {
        if acquire {
            LockFileEx(file.as_raw_handle(), 0x1 | 0x2, 0, 1, 0, &mut overlapped)
        } else {
            UnlockFileEx(file.as_raw_handle(), 0, 1, 0, &mut overlapped)
        }
    };
    if result == 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    Ok(())
}

#[cfg(not(any(unix, windows)))]
fn lock(_file: &File) -> Result<()> {
    anyhow::bail!("This platform has no supported database ownership lock")
}

#[cfg(not(any(unix, windows)))]
fn unlock(_file: &File) -> Result<()> {
    anyhow::bail!("This platform has no supported database ownership lock")
}

#[cfg(all(test, unix))]
mod tests {
    use crate::store::Store;
    use std::process::{Child, Command, Stdio};

    struct OwnedChild(Child);
    impl Drop for OwnedChild {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }

    #[test]
    fn store_drop_unlocks_while_a_child_retains_the_inherited_guard_description() {
        let folder = tempfile::Builder::new()
            .prefix("anywork-owner-inherited-")
            .tempdir()
            .unwrap();
        let path = folder.path().join("store.db");
        let store = Store::open(&path).unwrap();
        assert!(
            Store::open(&path)
                .err()
                .unwrap()
                .to_string()
                .contains("ownership unavailable")
        );
        let inherited = store.1.as_ref().unwrap()._file.try_clone().unwrap();
        // Passing the shared description as stdin keeps it open across exec
        // without custom fork hooks or unsafe post-fork Rust. The peer never
        // reads stdin, opens this database or acquires a second ownership lock.
        let mut child = OwnedChild(
            Command::new(std::env::current_exe().unwrap())
                .args(["--exact", "store::schema::tests::ownership_child"])
                .env("ANYWORK_TEST_SCHEMA_CHILD_PATH", &path)
                .env("ANYWORK_TEST_SCHEMA_CHILD_MODE", "inheritedguard")
                .stdin(Stdio::from(inherited))
                .spawn()
                .unwrap(),
        );
        let ready = path.with_extension("db.ready");
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
        while !ready.exists() && std::time::Instant::now() < deadline {
            assert!(child.0.try_wait().unwrap().is_none());
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        assert!(
            ready.exists(),
            "owned child did not acknowledge its descriptor"
        );
        assert!(child.0.try_wait().unwrap().is_none());
        drop(store);
        // No retry or delay: the child still owns the inherited description.
        let reopened = Store::open(&path).unwrap();
        assert!(child.0.try_wait().unwrap().is_none());
        child.0.kill().unwrap();
        child.0.wait().unwrap();
        // Closing the old inherited description cannot release the new owner.
        assert!(
            Store::open(&path)
                .err()
                .unwrap()
                .to_string()
                .contains("ownership unavailable")
        );
        drop(reopened);
    }
}
