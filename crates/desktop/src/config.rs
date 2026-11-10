use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

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
    let bytes = match fs::read(path) {
        Ok(bytes) => Some(bytes),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(error.into()),
    };
    if let Some(raw) = &bytes {
        let backup = path.with_file_name("manager-before-unified.json");
        if !backup.try_exists()? {
            atomic_private(&backup, raw)?;
        }
    }
    let mut merged = match bytes {
        Some(raw) => serde_json::from_slice::<serde_json::Value>(&raw)?,
        None => serde_json::json!({}),
    };
    let object = merged
        .as_object_mut()
        .context("桌面配置格式不正确，原文件已保留。")?;
    for (key, value) in serde_json::to_value(config)?
        .as_object()
        .context("无效配置")?
    {
        object.insert(key.clone(), value.clone());
    }
    atomic_private(path, &serde_json::to_vec_pretty(&merged)?)
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
    let path = Path::new(&config.data_directory).join("access-token");
    let Ok(meta) = fs::symlink_metadata(&path) else {
        return String::new();
    };
    if !meta.is_file() || meta.file_type().is_symlink() || meta.len() > 1024 {
        return String::new();
    }
    let value = fs::read_to_string(path)
        .unwrap_or_default()
        .trim()
        .to_owned();
    if validate_token(&value).is_ok() {
        value
    } else {
        String::new()
    }
}
pub fn generate_token() -> String {
    format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
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
    fn validates_origins_and_credentials() {
        assert!(validate_token("abcdefghijklmnop\n").is_err());
        assert!(validate_token("abcdefghijklmnop").is_ok());
    }
}

#[cfg(test)]
mod unified_tests {
    use super::*;
    #[test]
    fn saving_preserves_original_and_unknown_legacy_settings_without_reading_secrets() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("manager.json");
        let original=serde_json::to_vec(&serde_json::json!({"workspace":dir.path(),"dataDirectory":dir.path().join("data"),"tunnelMode":"legacy","oldProvider":{"neverActivate":true}})).unwrap();
        atomic_private(&path, &original).unwrap();
        let mut c = load(&path).unwrap();
        c.port = 4567;
        save(&path, &c).unwrap();
        save(&path, &c).unwrap();
        assert_eq!(
            fs::read(dir.path().join("manager-before-unified.json")).unwrap(),
            original
        );
        let merged: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(merged["tunnelMode"], "legacy");
        assert_eq!(merged["oldProvider"]["neverActivate"], true);
    }
    #[test]
    fn selected_data_directory_token_is_bounded_and_never_changed_by_reading() {
        let dir = tempfile::tempdir().unwrap();
        let c = Config {
            data_directory: dir.path().to_string_lossy().into(),
            ..Default::default()
        };
        let path = dir.path().join("access-token");
        fs::write(&path, "local-selected-bearer-value").unwrap();
        assert_eq!(read_token(&c), "local-selected-bearer-value");
        assert_eq!(
            fs::read_to_string(path).unwrap(),
            "local-selected-bearer-value"
        );
    }
}
