//! Lifetime ownership: inode-keyed Unix sidecar (hardlinks refused), reserved-byte Windows lock.
use anyhow::{Context, Result};
use std::{
    fs::{File, OpenOptions},
    path::{Path, PathBuf},
};

pub(crate) struct OwnerGuard {
    // Closing the OS handle releases the lock, including after process failure.
    _file: File,
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
        Ok((Self { _file: file }, canonical))
    }
}

#[cfg(unix)]
fn lock(file: &File) -> Result<()> {
    // Lock only the sidecar inode, never SQLite's DB inode (Darwin interaction).
    file.try_lock().map_err(anyhow::Error::from)
}

#[cfg(windows)]
fn lock(file: &File) -> Result<()> {
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
    // SAFETY: live synchronous file handle; valid OVERLAPPED for the duration of
    // a fail-immediately exclusive lock request. Handle drop releases the lock.
    if unsafe { LockFileEx(file.as_raw_handle(), 0x1 | 0x2, 0, 1, 0, &mut overlapped) } == 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    Ok(())
}

#[cfg(not(any(unix, windows)))]
fn lock(_file: &File) -> Result<()> {
    anyhow::bail!("This platform has no supported database ownership lock")
}
