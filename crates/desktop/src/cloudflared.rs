//! Download only official, checksummed release assets into the user's app data.
use crate::{config, process};
use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    io::Write,
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};

const RELEASE_API: &str = "https://api.github.com/repos/cloudflare/cloudflared/releases/latest";
const MAX_DOWNLOAD: u64 = 96 * 1024 * 1024;

pub fn installed_path(support: &Path) -> PathBuf {
    support.join("bin").join(if cfg!(windows) {
        "cloudflared.exe"
    } else {
        "cloudflared"
    })
}
pub fn resolve(configured: &str, support: &Path, resources: &Path) -> Result<PathBuf> {
    if configured.is_empty() && process::is_executable(&installed_path(support)) {
        return Ok(installed_path(support));
    }
    process::executable("cloudflared", configured, resources)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Availability {
    available: bool,
    path: Option<String>,
    reason: String,
    can_download: bool,
}
pub fn availability(configured: &str, support: &Path, resources: &Path) -> Availability {
    match resolve(configured, support, resources) {
        Ok(path) => Availability {
            available: true,
            path: Some(path.display().to_string()),
            reason: String::new(),
            can_download: true,
        },
        Err(e) => Availability {
            available: false,
            path: None,
            reason: e.to_string(),
            can_download: asset_name(std::env::consts::OS, std::env::consts::ARCH).is_ok(),
        },
    }
}
fn asset_name(os: &str, arch: &str) -> Result<&'static str> {
    match (os, arch) {
        ("macos", "aarch64") => Ok("cloudflared-darwin-arm64.tgz"),
        ("macos", "x86_64") => Ok("cloudflared-darwin-amd64.tgz"),
        ("linux", "aarch64") => Ok("cloudflared-linux-arm64"),
        ("linux", "x86_64") => Ok("cloudflared-linux-amd64"),
        ("windows", "x86_64") => Ok("cloudflared-windows-amd64.exe"),
        ("windows", "x86") => Ok("cloudflared-windows-386.exe"),
        _ => bail!("此系统架构尚无自动下载支持，请在高级选项中选择 cloudflared 程序。"),
    }
}
#[derive(Deserialize)]
struct Release {
    assets: Vec<Asset>,
}
#[derive(Deserialize)]
struct Asset {
    name: String,
    size: u64,
    digest: Option<String>,
    browser_download_url: String,
}
fn official_url(value: &str) -> bool {
    url::Url::parse(value).is_ok_and(|u| {
        u.scheme() == "https"
            && u.username().is_empty()
            && u.password().is_none()
            && u.port_or_known_default() == Some(443)
            && matches!(
                u.host_str(),
                Some(
                    "api.github.com"
                        | "github.com"
                        | "release-assets.githubusercontent.com"
                        | "objects.githubusercontent.com"
                )
            )
    })
}
fn select_asset(release: Release, name: &str) -> Result<Asset> {
    let asset = release
        .assets
        .into_iter()
        .find(|a| a.name == name)
        .context("官方发布中没有此平台的下载文件。")?;
    if !asset
        .browser_download_url
        .starts_with("https://github.com/cloudflare/cloudflared/releases/download/")
        || !official_url(&asset.browser_download_url)
        || asset.size == 0
        || asset.size > MAX_DOWNLOAD
    {
        bail!("官方发布的下载信息无效。")
    }
    let digest = asset
        .digest
        .as_deref()
        .and_then(|s| s.strip_prefix("sha256:"))
        .unwrap_or_default();
    if digest.len() != 64 || !digest.bytes().all(|c| c.is_ascii_hexdigit()) {
        bail!("官方发布没有提供 SHA-256 校验值，未安装下载文件。")
    }
    Ok(asset)
}
async fn response_bytes(mut response: reqwest::Response, limit: u64) -> Result<Vec<u8>> {
    response
        .error_for_status_ref()
        .context("无法访问官方发布服务，请检查网络后重试。")?;
    if response.content_length().is_some_and(|size| size > limit) {
        bail!("下载响应超过大小限制。")
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        if bytes.len() as u64 + chunk.len() as u64 > limit {
            bail!("下载响应超过大小限制。")
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}
fn verify_download(asset: &Asset, bytes: &[u8]) -> Result<()> {
    if bytes.len() as u64 != asset.size {
        bail!("下载文件不完整，请重试。")
    }
    let actual = format!("sha256:{:x}", Sha256::digest(bytes));
    if Some(actual.as_str()) != asset.digest.as_deref() {
        bail!("下载文件的 SHA-256 校验失败，未安装。")
    }
    Ok(())
}
async fn validate_binary(path: &Path) -> Result<()> {
    let mut command = tokio::process::Command::new(path);
    command
        .arg("--version")
        .kill_on_drop(true)
        .stdin(Stdio::null());
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let output = tokio::time::timeout(Duration::from_secs(10), command.output())
        .await
        .context("cloudflared 运行验证超时。")?
        .context("cloudflared 无法运行，请检查系统架构和运行权限。")?;
    if !output.status.success()
        || !String::from_utf8_lossy(&output.stdout).starts_with("cloudflared version ")
    {
        bail!("下载程序未通过 cloudflared 运行验证。")
    }
    Ok(())
}

pub async fn install(support: &Path) -> Result<PathBuf> {
    let name = asset_name(std::env::consts::OS, std::env::consts::ARCH)?;
    config::prepare(support)?;
    let lock = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(support.join("cloudflared-install.lock"))?;
    fs2::FileExt::try_lock_exclusive(&lock)
        .context("cloudflared 正在下载，请等待当前下载完成。")?;
    let destination = installed_path(support);
    if process::is_executable(&destination) && validate_binary(&destination).await.is_ok() {
        return Ok(destination);
    }
    let client = reqwest::Client::builder()
        .https_only(true)
        .user_agent("AnyWork-Desktop/0.1 cloudflared-installer")
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(180))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 || !official_url(attempt.url().as_str()) {
                attempt.error("下载重定向不是受信任的 GitHub 发布地址")
            } else {
                attempt.follow()
            }
        }))
        .build()?;
    let metadata = response_bytes(
        client
            .get(RELEASE_API)
            .timeout(Duration::from_secs(20))
            .send()
            .await
            .context("无法获取 cloudflared 官方版本，请检查网络后重试。")?,
        2 * 1024 * 1024,
    )
    .await?;
    let asset = select_asset(
        serde_json::from_slice(&metadata).context("官方版本信息无法读取。")?,
        name,
    )?;
    let bytes = response_bytes(
        client
            .get(&asset.browser_download_url)
            .send()
            .await
            .context("cloudflared 下载失败，请检查网络后重试。")?,
        MAX_DOWNLOAD,
    )
    .await?;
    verify_download(&asset, &bytes)?;
    let bin = support.join("bin");
    config::prepare(&bin)?;
    let mut candidate = tempfile::Builder::new()
        .prefix("cloudflared-")
        .suffix(if cfg!(windows) { ".exe" } else { ".tmp" })
        .tempfile_in(&bin)?;
    if name.ends_with(".tgz") {
        // Extract exactly one named member to stdout: never expand an archive into the app directory.
        let mut archive = tempfile::NamedTempFile::new_in(&bin)?;
        archive.write_all(&bytes)?;
        let mut command = tokio::process::Command::new("/usr/bin/tar");
        command
            .arg("-xOzf")
            .arg(archive.path())
            .arg("cloudflared")
            .stdin(Stdio::null())
            .stdout(candidate.as_file().try_clone()?)
            .stderr(Stdio::null())
            .kill_on_drop(true);
        let status = tokio::time::timeout(Duration::from_secs(15), command.status())
            .await
            .context("cloudflared 解压超时。")??;
        if !status.success() {
            bail!("cloudflared 解压失败，原有程序保持不变。")
        }
    } else {
        candidate.write_all(&bytes)?;
    }
    if candidate.as_file().metadata()?.len() == 0
        || candidate.as_file().metadata()?.len() > 128 * 1024 * 1024
    {
        bail!("cloudflared 程序大小无效。")
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        candidate
            .as_file()
            .set_permissions(std::fs::Permissions::from_mode(0o700))?;
    }
    candidate.as_file().sync_all()?;
    // Close the writable file handle before executing (required on Linux/Windows).
    let candidate = candidate.into_temp_path();
    validate_binary(&candidate).await?;
    candidate
        .persist(&destination)
        .map_err(|e| e.error)
        .context("无法保存 cloudflared 程序。")?;
    Ok(destination)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn platform_assets_and_official_urls_are_restricted() {
        assert_eq!(
            asset_name("macos", "aarch64").unwrap(),
            "cloudflared-darwin-arm64.tgz"
        );
        assert_eq!(
            asset_name("windows", "x86_64").unwrap(),
            "cloudflared-windows-amd64.exe"
        );
        assert!(asset_name("linux", "mips").is_err());
        assert!(official_url(
            "https://release-assets.githubusercontent.com/test"
        ));
        for bad in [
            "http://github.com/a",
            "https://github.com.evil.test/a",
            "https://u:p@github.com/a",
            "https://github.com:444/a",
        ] {
            assert!(!official_url(bad));
        }
    }
    #[test]
    fn corrupt_incomplete_and_untrusted_downloads_are_rejected() {
        let data = b"official fixture";
        let mut asset = Asset {
            name: "fixture".into(),
            size: data.len() as u64,
            digest: Some(format!("sha256:{:x}", Sha256::digest(data))),
            browser_download_url:
                "https://github.com/cloudflare/cloudflared/releases/download/fixture/fixture".into(),
        };
        verify_download(&asset, data).unwrap();
        assert!(verify_download(&asset, b"corrupt! fixture").is_err());
        assert!(verify_download(&asset, b"short").is_err());
        asset.digest = None;
        assert!(
            select_asset(
                Release {
                    assets: vec![asset]
                },
                "fixture"
            )
            .is_err()
        );
    }
    #[test]
    #[cfg(unix)]
    fn installed_program_is_found_without_path_and_explicit_paths_are_respected() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        config::prepare(&dir.path().join("bin")).unwrap();
        let path = installed_path(dir.path());
        std::fs::write(&path, "fixture").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).unwrap();
        assert_eq!(resolve("", dir.path(), dir.path()).unwrap(), path);
        assert!(resolve("/missing/custom/cloudflared", dir.path(), dir.path()).is_err());
        assert!(!availability("/missing/custom/cloudflared", dir.path(), dir.path()).available);
    }
    #[tokio::test]
    #[ignore = "downloads and verifies the official cloudflared release, requires Internet"]
    async fn official_download_installs_and_reuses_verified_binary() {
        let dir = tempfile::tempdir().unwrap();
        let path = install(dir.path()).await.unwrap();
        validate_binary(&path).await.unwrap();
        assert_eq!(install(dir.path()).await.unwrap(), path);
    }
}
