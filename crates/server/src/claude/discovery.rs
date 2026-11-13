//! Read-only discovery of Desktop's separately downloaded host CLI. The VM
//! download root is deliberately excluded. This grants no Desktop control.
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
};

pub fn downloaded(home: &Path) -> Option<PathBuf> {
    let mut roots = vec![];
    if let Some(root) = std::env::var_os("ANYWORK_CLAUDE_DESKTOP_HISTORY_ROOT")
        && let Some(parent) = Path::new(&root).parent()
    {
        roots.push(parent.join("claude-code"));
    }
    #[cfg(target_os = "macos")]
    roots.extend(["Claude", "Claude-3p"].map(|profile| {
        home.join("Library/Application Support")
            .join(profile)
            .join("claude-code")
    }));
    #[cfg(target_os = "windows")]
    roots.push(
        std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.to_path_buf())
            .join("Claude/claude-code"),
    );
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    roots.push(home.join(".config/Claude/claude-code"));
    roots.into_iter().find_map(|root| in_root(&root))
}
fn in_root(root: &Path) -> Option<PathBuf> {
    let mut versions: Vec<_> = fs::read_dir(root)
        .ok()?
        .take(200)
        .flatten()
        .filter(|e| e.file_type().is_ok_and(|m| m.is_dir()))
        .map(|e| e.path())
        .collect();
    versions.sort_by_key(|p| {
        p.file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .split('.')
            .map(|v| v.parse::<u64>().unwrap_or(0))
            .collect::<Vec<_>>()
    });
    versions.reverse();
    for version in versions {
        let mut dirs: Vec<_> = fs::read_dir(&version)
            .ok()
            .into_iter()
            .flatten()
            .take(200)
            .flatten()
            .filter(|e| e.file_type().is_ok_and(|m| m.is_dir()))
            .map(|e| e.path())
            .collect();
        dirs.sort();
        dirs.reverse();
        dirs.push(version);
        for dir in dirs {
            let Some(verified) = super::history::read_file(&dir.join(".verified"), 256)
                .ok()
                .and_then(|v| String::from_utf8(v).ok())
            else {
                continue;
            };
            let checksum = verified.trim();
            if checksum.len() != 64 || !checksum.bytes().all(|b| b.is_ascii_hexdigit()) {
                continue;
            }
            let name = dir.file_name()?.to_string_lossy();
            if name.len() == 12 && !checksum[..12].eq_ignore_ascii_case(&name) {
                continue;
            }
            for path in [
                dir.join(if cfg!(windows) {
                    "claude.exe"
                } else {
                    "claude"
                }),
                dir.join("claude.app/Contents/MacOS/claude"),
            ] {
                let Ok(mut file) = fs::File::open(&path) else {
                    continue;
                };
                let mut magic = [0; 4];
                if file.read_exact(&mut magic).is_err() {
                    continue;
                }
                if matches!(
                    magic,
                    [0xcf, 0xfa, 0xed, 0xfe]
                        | [0xce, 0xfa, 0xed, 0xfe]
                        | [0xca, 0xfe, 0xba, 0xbe]
                        | [0xca, 0xfe, 0xba, 0xbf]
                        | [0x7f, b'E', b'L', b'F']
                ) || magic[..2] == *b"MZ"
                {
                    return Some(path);
                }
            }
        }
    }
    None
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn finds_only_verified_host_download_with_native_header() {
        let t = tempfile::tempdir().unwrap();
        let checksum = "a".repeat(64);
        let dir = t.path().join("2.1.323").join(&checksum[..12]);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(".verified"), &checksum).unwrap();
        let exe = dir.join(if cfg!(windows) {
            "claude.exe"
        } else {
            "claude"
        });
        fs::write(&exe, b"#!/bin/sh\n").unwrap();
        assert!(in_root(t.path()).is_none());
        fs::write(&exe, [0xcf, 0xfa, 0xed, 0xfe]).unwrap();
        assert_eq!(in_root(t.path()), Some(exe));
        fs::write(dir.join(".verified"), "b".repeat(64)).unwrap();
        assert!(in_root(t.path()).is_none());
    }
}
