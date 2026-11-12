use crate::config;
use anyhow::{Result, bail};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

pub(crate) fn valid_device_name(name: &str) -> bool {
    !name.is_empty() && name.encode_utf16().count() <= 80 && !name.chars().any(char::is_control)
}
pub(crate) fn normalized_device_name(name: &str) -> Result<String> {
    let name = name.trim();
    if !valid_device_name(name) {
        bail!("DEVICE_NAME_REJECTED")
    }
    Ok(name.into())
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct DeviceName {
    name: String,
}
fn device_name_path(support: &std::path::Path) -> Result<PathBuf> {
    let path = support.join("device-name.json");
    if let Ok(metadata) = std::fs::symlink_metadata(&path)
        && (!metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > 1024)
    {
        bail!("DEVICE_NAME_STORAGE_REJECTED")
    }
    Ok(path)
}
pub(crate) fn save_device_name(support: &std::path::Path, name: &str) -> Result<()> {
    let name = normalized_device_name(name)?;
    config::atomic_private(
        &device_name_path(support)?,
        &serde_json::to_vec(&DeviceName { name })?,
    )
}
pub(crate) fn load_device_name(support: &std::path::Path, read_only: bool) -> Result<String> {
    let path = device_name_path(support)?;
    match std::fs::read(&path) {
        Ok(bytes) => {
            let saved: DeviceName = serde_json::from_slice(&bytes)?;
            normalized_device_name(&saved.name)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let platform = match std::env::consts::OS {
                "macos" => "Mac",
                "windows" => "Windows",
                "linux" => "Linux",
                _ => "电脑",
            };
            let name = format!(
                "{platform} · {}",
                uuid::Uuid::new_v4().simple().to_string()[..4].to_uppercase()
            );
            if !read_only {
                save_device_name(support, &name)?;
            }
            Ok(name)
        }
        Err(error) => Err(error.into()),
    }
}
