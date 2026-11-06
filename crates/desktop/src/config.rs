use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};
use url::Url;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct Config {
    pub workspace: String,
    pub data_directory: String,
    pub port: u16,
    #[serde(rename = "allowLAN")]
    pub allow_lan: bool,
    pub server_binary: String,
    pub cloudflared_binary: String,
    pub tunwg_binary: String,
    #[serde(rename = "publicURL")]
    pub public_url: String,
    pub relay_domain: String,
    pub force_relay: bool,
    pub welcomed: bool,
}
impl Default for Config {
    fn default() -> Self {
        Self {
            workspace: home().display().to_string(),
            data_directory: support_dir().join("data").display().to_string(),
            port: 3210,
            allow_lan: false,
            server_binary: String::new(),
            cloudflared_binary: String::new(),
            tunwg_binary: String::new(),
            public_url: String::new(),
            relay_domain: String::new(),
            force_relay: false,
            welcomed: false,
        }
    }
}
impl Config {
    pub fn local_url(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }
    pub fn validate(&self) -> Result<()> {
        if self.port < 1024 {
            bail!("端口需在 1024–65535 之间。")
        }
        if !Path::new(&self.workspace).is_dir() {
            bail!("请选择存在的工作目录。")
        }
        if !Path::new(&self.data_directory).is_absolute() {
            bail!("服务数据目录必须是绝对路径。")
        }
        Ok(())
    }
    pub fn validate_route(&self, kind: RouteKind, secret: &str) -> Result<()> {
        match kind {
            RouteKind::Quick => (),
            RouteKind::Named => {
                secure_url(&self.public_url)?;
                if secret.trim().is_empty() {
                    bail!("请填写 Cloudflare 连接器令牌。")
                }
            }
            RouteKind::Relay => {
                if self.relay_domain.is_empty()
                    || self.relay_domain.contains(['/', ':', '?', '#', '@'])
                    || self.relay_domain.chars().any(char::is_whitespace)
                {
                    bail!("请填写不含协议和路径的中继域名。")
                }
                secure_url(&format!("https://{}", self.relay_domain))?;
                if secret.trim().is_empty() {
                    bail!("请填写中继授权密钥。")
                }
            }
        }
        if secret.contains(['\r', '\n', '\0']) {
            bail!("连接凭据包含无效字符。")
        }
        Ok(())
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RouteKind {
    Quick,
    Named,
    Relay,
}
impl RouteKind {
    pub const ALL: [Self; 3] = [Self::Quick, Self::Named, Self::Relay];
    pub fn index(self) -> usize {
        match self {
            Self::Quick => 0,
            Self::Named => 1,
            Self::Relay => 2,
        }
    }
    pub fn title(self) -> &'static str {
        match self {
            Self::Quick => "匿名隧道",
            Self::Named => "固定隧道",
            Self::Relay => "WireGuard + TLS 中继",
        }
    }
    pub fn account(self) -> Option<&'static str> {
        match self {
            Self::Quick => None,
            Self::Named => Some("cloudflare-token"),
            Self::Relay => Some("relay-auth"),
        }
    }
}
pub fn home() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("."))
}
pub fn support_dir() -> PathBuf {
    if let Some(path) = std::env::var_os("ANYWORK_MANAGER_HOME") {
        return path.into();
    }
    dirs::data_local_dir().unwrap_or_else(home).join("AnyWork")
}
pub fn resources_dir() -> PathBuf {
    if let Some(path) = std::env::var_os("ANYWORK_RESOURCES") {
        return path.into();
    }
    let exe = std::env::current_exe().unwrap_or_default();
    let parent = exe.parent().unwrap_or(Path::new("."));
    #[cfg(target_os = "macos")]
    if parent.file_name().is_some_and(|s| s == "MacOS") {
        return parent.parent().unwrap_or(parent).join("Resources");
    }
    if parent.join("resources").is_dir() {
        return parent.join("resources");
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .unwrap_or_else(|_| parent.into())
}
pub fn prepare(path: &Path) -> Result<()> {
    fs::create_dir_all(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}
pub fn atomic_private(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path.parent().context("文件路径无效")?;
    prepare(parent)?;
    if fs::symlink_metadata(path).is_ok_and(|m| m.file_type().is_symlink()) {
        bail!("配置文件不能是符号链接。")
    }
    let mut tmp = tempfile::NamedTempFile::new_in(parent)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        tmp.as_file()
            .set_permissions(fs::Permissions::from_mode(0o600))?;
    }
    tmp.write_all(bytes)?;
    tmp.as_file().sync_all()?;
    tmp.persist(path).map_err(|e| e.error)?;
    Ok(())
}
pub fn load(path: &Path) -> Result<Config> {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .context("桌面配置无法读取，请检查 manager.json；原文件已保留。"),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Config::default()),
        Err(e) => Err(e.into()),
    }
}
pub fn save(path: &Path, config: &Config) -> Result<()> {
    config.validate()?;
    atomic_private(path, &serde_json::to_vec_pretty(config)?)
}
pub fn validate_token(token: &str) -> Result<()> {
    if !(16..=1024).contains(&token.len()) || !token.bytes().all(|b| b.is_ascii_graphic()) {
        bail!("访问密钥需为 16–1024 个可见 ASCII 字符，不能包含空白。")
    }
    Ok(())
}
pub fn write_token(config: &Config, token: &str) -> Result<()> {
    validate_token(token)?;
    atomic_private(
        &Path::new(&config.data_directory).join("access-token"),
        token.as_bytes(),
    )
}
pub fn read_token(config: &Config) -> String {
    fs::read_to_string(Path::new(&config.data_directory).join("access-token"))
        .unwrap_or_default()
        .trim()
        .into()
}
pub fn generate_token() -> String {
    format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}
pub fn secure_url(value: &str) -> Result<Url> {
    let url = Url::parse(value).context("请填写完整的 HTTPS 地址。")?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != "/"
    {
        bail!("请填写不含路径、查询参数和凭据的 HTTPS 地址。")
    }
    Ok(url)
}
pub fn pairing_link(server: &str, token: &str, transport: &str) -> String {
    let mut url = Url::parse("anywork://connect").expect("constant URL");
    url.query_pairs_mut()
        .append_pair("server", server)
        .append_pair("token", token)
        .append_pair("transport", transport);
    url.into()
}
/// OS credential storage; deliberately no plaintext fallback.
pub trait Secrets: Send + Sync {
    fn read(&self, account: &str) -> Result<String>;
    fn write(&self, account: &str, value: &str) -> Result<()>;
}
pub struct OsSecrets;
impl Secrets for OsSecrets {
    fn read(&self, account: &str) -> Result<String> {
        match keyring::Entry::new("dev.anywork.manager", account)?.get_password() {
            Ok(value) => Ok(value),
            Err(keyring::Error::NoEntry) => Ok(String::new()),
            Err(_) => bail!("无法读取系统凭据存储，请解锁钥匙串或 Secret Service。"),
        }
    }
    fn write(&self, account: &str, value: &str) -> Result<()> {
        let entry = keyring::Entry::new("dev.anywork.manager", account)?;
        let result = if value.is_empty() {
            entry.delete_credential()
        } else {
            entry.set_password(value)
        };
        match result {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => bail!("无法保存到系统凭据存储；连接凭据未写入普通配置文件。"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn migrates_swift_configuration_without_enabling_routes() {
        let c: Config = serde_json::from_value(serde_json::json!({"workspace":"/tmp", "dataDirectory":"/tmp/data", "port":3210, "allowLAN":true, "publicURL":"https://example.com", "tunnelMode":"tunwg"})).unwrap();
        assert!(c.allow_lan);
        assert!(!c.welcomed);
        assert_eq!(c.public_url, "https://example.com");
        let json = serde_json::to_string(&c).unwrap();
        assert!(!json.contains("tunnelMode"));
        assert!(!json.contains("token"));
    }
    #[test]
    fn private_atomic_writes_reject_symlinks() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config");
        atomic_private(&path, b"old").unwrap();
        atomic_private(&path, b"new").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"new");
        #[cfg(unix)]
        {
            use std::os::unix::fs::{PermissionsExt, symlink};
            assert_eq!(
                fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
            let link = dir.path().join("link");
            symlink(&path, &link).unwrap();
            assert!(atomic_private(&link, b"bad").is_err());
        }
    }
    #[test]
    fn pairing_roundtrip_preserves_reserved_characters() {
        let link = pairing_link(
            "https://example.com",
            "abcdefgh12345678&=?",
            "wireguard-relay",
        );
        let url = Url::parse(&link).unwrap();
        let pairs: std::collections::HashMap<_, _> = url.query_pairs().collect();
        assert_eq!(pairs["token"], "abcdefgh12345678&=?");
    }
    #[test]
    fn validates_origins_and_credentials() {
        for value in [
            "http://example.com",
            "https://u:p@example.com",
            "https://example.com/path",
            "https://example.com?token=x",
        ] {
            assert!(secure_url(value).is_err());
        }
        assert!(secure_url("https://example.com:443").is_ok());
        assert!(validate_token("abcdefghijklmnop\n").is_err());
        assert!(validate_token("abcdefghijklmnop").is_ok());
    }
}
