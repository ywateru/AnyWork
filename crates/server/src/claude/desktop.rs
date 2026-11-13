//! Original Claude Code renderer carrier via a user-installed DevTools bridge.
//! No CDP startup, CLI spawn/resume, credential reads or arbitrary evaluation.
use anyhow::{Context, Result, ensure};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
use url::Url;

const MAX_REPLY: usize = 32 * 1024 * 1024;
const METHODS: &[&str] = &[
    "getSessionList",
    "getAll",
    "getSession",
    "start",
    "sendMessage",
    "send",
    "interrupt",
    "stop",
    "getTranscript",
    "getTranscriptTail",
    "getTranscriptPage",
    "respondToToolPermission",
    "setModel",
    "setEffort",
    "setPermissionMode",
    "getDefaultEffort",
    "getAdvisorSetting",
    "models",
];

#[derive(Clone)]
pub struct DesktopClient {
    path: PathBuf,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Descriptor {
    version: u32,
    agent: String,
    transport: String,
    app_version: String,
    asar_sha256: String,
    app_path: PathBuf,
    launcher_pid: u32,
    url: String,
    token: String,
    instance_id: String,
}

pub fn available() -> bool {
    DesktopClient::configured(None).is_ok_and(|c| c.available())
}

impl DesktopClient {
    pub fn configured(path: Option<PathBuf>) -> Result<Self> {
        let path = path
            .or_else(|| std::env::var_os("ANYWORK_CLAUDE_DESKTOP_DESCRIPTOR").map(PathBuf::from))
            .unwrap_or_else(|| {
                std::env::var_os("HOME")
                    .map(PathBuf::from)
                    .unwrap_or_default()
                    .join(".anywork/claude-desktop/host.json")
            });
        ensure!(
            path.is_absolute(),
            "Claude Desktop descriptor must be absolute"
        );
        Ok(Self { path })
    }
    /// Descriptor validity only; connect performs a live native handshake.
    pub fn available(&self) -> bool {
        self.descriptor().is_ok()
    }
    fn descriptor(&self) -> Result<Descriptor> {
        let d: Descriptor = serde_json::from_slice(&private_read(&self.path)?)
            .context("Invalid Claude Desktop descriptor")?;
        ensure!(
            d.version == 1 && d.agent == "claude-desktop" && d.transport == "devtools-loopback",
            "Unsupported Claude Desktop bridge protocol"
        );
        ensure!(
            matches!(d.app_version.as_str(), "5.11492.0" | "5.11492.2"),
            "Unreviewed Claude Desktop version"
        );
        ensure!(
            d.asar_sha256.len() == 64 && d.asar_sha256.bytes().all(|b| b.is_ascii_hexdigit()),
            "Invalid package observation"
        );
        ensure!(
            d.app_path.is_absolute() && d.launcher_pid > 1 && d.launcher_pid <= i32::MAX as u32,
            "Invalid bridge identity"
        );
        ensure!(
            d.token.len() == 43
                && d.token
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-'),
            "Invalid private bridge authentication"
        );
        ensure!(
            uuid::Uuid::parse_str(&d.instance_id).is_ok(),
            "Invalid bridge generation"
        );
        endpoint(&d.url)?;
        Ok(d)
    }
    pub async fn connect(&self) -> Result<DesktopCarrier> {
        let d = self.descriptor()?;
        let url = endpoint(&d.url)?.join("rpc")?;
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(60))
            .build()?;
        let carrier = DesktopCarrier {
            inner: Arc::new(Inner {
                client,
                url,
                token: d.token,
                id: uuid::Uuid::new_v4().to_string(),
                closed: AtomicBool::new(false),
            }),
        };
        carrier.command(json!({"op":"open"})).await?;
        let rows = carrier.invoke("getSessionList", json!([])).await?;
        ensure!(
            rows["sessions"].is_array(),
            "Native session-list handshake failed"
        );
        ensure!(
            self.descriptor()?.instance_id == d.instance_id,
            "Desktop bridge changed during handshake"
        );
        Ok(carrier)
    }
}

fn private_read(path: &Path) -> Result<Vec<u8>> {
    ensure!(path.is_absolute(), "Desktop setup path must be absolute");
    for ancestor in path.ancestors() {
        if let Ok(meta) = fs::symlink_metadata(ancestor) {
            ensure!(
                !meta.file_type().is_symlink(),
                "Desktop setup paths must not contain symbolic links"
            );
        }
    }
    let parent = path.parent().context("Missing descriptor directory")?;
    let pm = fs::symlink_metadata(parent)
        .context("Claude Desktop bridge unavailable; run scripts/claude-desktop-launch.py")?;
    ensure!(pm.is_dir(), "Invalid Desktop descriptor directory");
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt};
        ensure!(
            pm.uid() == unsafe { libc::geteuid() } && pm.permissions().mode() & 0o777 == 0o700,
            "Desktop descriptor directory must be private (0700)"
        );
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    let file = options
        .open(path)
        .context("Claude Desktop discovery entry unavailable")?;
    let meta = file.metadata()?;
    ensure!(
        meta.is_file() && meta.len() <= 16384,
        "Invalid Desktop descriptor file"
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        ensure!(
            meta.uid() == unsafe { libc::geteuid() } && meta.permissions().mode() & 0o777 == 0o600,
            "Desktop descriptor must be private (0600)"
        );
    }
    let mut bytes = Vec::new();
    file.take(16385).read_to_end(&mut bytes)?;
    ensure!(bytes.len() <= 16384, "Desktop descriptor exceeds limit");
    Ok(bytes)
}
fn endpoint(raw: &str) -> Result<Url> {
    let url = Url::parse(raw).context("Invalid local Desktop endpoint")?;
    // A bare numeric origin excludes credentials, path routing and query tokens.
    ensure!(
        url.scheme() == "http"
            && url.host_str() == Some("127.0.0.1")
            && url.port().is_some()
            && url.as_str() == format!("http://127.0.0.1:{}/", url.port().unwrap()),
        "Desktop endpoint must be a bare explicit 127.0.0.1 origin"
    );
    Ok(url)
}

async fn rpc(client: &reqwest::Client, url: &Url, token: &str, command: Value) -> Result<Value> {
    let mut response = client
        .post(url.clone())
        .bearer_auth(token)
        .json(&command)
        .send()
        .await
        .context(
            "Desktop bridge unavailable or call timed out; delivery outcome unknown; do not replay",
        )?;
    ensure!(
        response.status().as_u16() == 200,
        "Desktop bridge rejected the call; no automatic replay"
    );
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .context("Desktop reply interrupted; delivery outcome unknown")?
    {
        ensure!(
            bytes.len() + chunk.len() <= MAX_REPLY,
            "Desktop reply exceeds limit; outcome unknown"
        );
        bytes.extend_from_slice(&chunk);
    }
    let value: Value = serde_json::from_slice(&bytes).context("Invalid Desktop carrier reply")?;
    ensure!(
        value["ok"] == true,
        "{}",
        value["error"]
            .as_str()
            .unwrap_or("Desktop carrier unavailable")
    );
    Ok(value["value"].clone())
}
struct Inner {
    client: reqwest::Client,
    url: Url,
    token: String,
    id: String,
    closed: AtomicBool,
}
impl Drop for Inner {
    fn drop(&mut self) {
        if self.closed.swap(true, Ordering::AcqRel) {
            return;
        }
        if let Ok(runtime) = tokio::runtime::Handle::try_current() {
            let (client, url, token, id) = (
                self.client.clone(),
                self.url.clone(),
                self.token.clone(),
                self.id.clone(),
            );
            runtime.spawn(async move {
                let _ = rpc(&client, &url, &token, json!({"op":"close","id":id})).await;
            });
        }
    }
}
#[derive(Clone)]
pub struct DesktopCarrier {
    inner: Arc<Inner>,
}
impl DesktopCarrier {
    async fn command(&self, mut command: Value) -> Result<Value> {
        ensure!(
            !self.inner.closed.load(Ordering::Acquire),
            "Desktop carrier disconnected"
        );
        command["id"] = json!(self.inner.id);
        rpc(
            &self.inner.client,
            &self.inner.url,
            &self.inner.token,
            command,
        )
        .await
    }
    pub async fn invoke(&self, method: &str, args: Value) -> Result<Value> {
        ensure!(
            METHODS.contains(&method) && args.is_array(),
            "Unsupported Desktop method/arguments"
        );
        ensure!(
            args.to_string().len() <= 32_000_000,
            "Desktop request exceeds limit"
        );
        self.command(json!({"op":"invoke","method":method,"args":args}))
            .await
    }
    /// Cursor initially zero. A gap or generation change requires a native
    /// snapshot; user writes must never be replayed to recover lost events.
    pub async fn poll_events(&self, cursor: u64) -> Result<Value> {
        self.command(json!({"op":"poll","cursor":cursor})).await
    }
    /// Unsubscribe only this consumer. Never stop the native owner or its turn.
    pub async fn disconnect(&self) -> Result<()> {
        if self.inner.closed.swap(true, Ordering::AcqRel) {
            return Ok(());
        }
        rpc(
            &self.inner.client,
            &self.inner.url,
            &self.inner.token,
            json!({"op":"close","id":self.inner.id}),
        )
        .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    #[cfg(unix)]
    async fn client_round_trips_against_fixture_broker() {
        use std::os::unix::fs::PermissionsExt;
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let token = "a".repeat(43);
        let expected_token = token.clone();
        let server = tokio::spawn(async move {
            let mut generation = None;
            for _ in 0..6 {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut bytes = Vec::new();
                let split = loop {
                    let mut byte = [0];
                    stream.read_exact(&mut byte).await.unwrap();
                    bytes.push(byte[0]);
                    assert!(bytes.len() < 65536);
                    if bytes.ends_with(b"\r\n\r\n") {
                        break bytes.len();
                    }
                };
                let headers = String::from_utf8_lossy(&bytes).to_ascii_lowercase();
                assert!(headers.starts_with("post /rpc http/1.1\r\n"));
                assert!(headers.contains(&format!("authorization: bearer {expected_token}\r\n")));
                let length: usize = headers
                    .lines()
                    .find_map(|line| line.strip_prefix("content-length: "))
                    .unwrap()
                    .trim()
                    .parse()
                    .unwrap();
                bytes.resize(split + length, 0);
                stream.read_exact(&mut bytes[split..]).await.unwrap();
                let request: Value = serde_json::from_slice(&bytes[split..]).unwrap();
                let id = request["id"].as_str().unwrap().to_string();
                if let Some(expected) = &generation {
                    assert_eq!(expected, &id);
                } else {
                    generation = Some(id.clone());
                }
                let value = match request["op"].as_str().unwrap() {
                    "open" => json!({"version":1,"generation":id}),
                    "invoke" if request["method"] == "getSessionList" => {
                        json!({"sessions":[],"loadGeneration":1})
                    }
                    "invoke" if request["method"] == "getTranscriptTail" => {
                        json!({"messages":[],"hasMore":false})
                    }
                    "invoke" if request["method"] == "send" => Value::Null,
                    "poll" => json!({"events":[],"cursor":0,"gap":false,"generation":id}),
                    "close" => Value::Null,
                    _ => panic!("Unexpected fixture operation"),
                };
                let body = json!({"ok":true,"value":value}).to_string();
                stream.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}", body.len(), body).as_bytes()).await.unwrap();
            }
        });
        let root = tempfile::tempdir().unwrap();
        let private = root.path().canonicalize().unwrap().join("private");
        fs::create_dir(&private).unwrap();
        fs::set_permissions(&private, fs::Permissions::from_mode(0o700)).unwrap();
        let path = private.join("host.json");
        fs::write(&path, json!({"version":1,"agent":"claude-desktop","transport":"devtools-loopback","appVersion":"5.11492.2","asarSha256":"0".repeat(64),"appPath":"/fixture/Claude.app","launcherPid":42,"url":format!("http://127.0.0.1:{port}/"),"token":token,"instanceId":uuid::Uuid::new_v4().to_string()}).to_string()).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        let client = DesktopClient::configured(Some(path)).unwrap();
        assert!(client.available());
        let carrier = client.connect().await.unwrap();
        assert!(carrier.invoke("evaluate", json!([])).await.is_err());
        assert_eq!(
            carrier
                .invoke("getTranscriptTail", json!(["fixture", 1]))
                .await
                .unwrap()["hasMore"],
            false
        );
        carrier
            .invoke(
                "send",
                json!([{"sessionId":"fixture","message":"fixture only"}]),
            )
            .await
            .unwrap();
        assert_eq!(carrier.poll_events(0).await.unwrap()["gap"], false);
        carrier.disconnect().await.unwrap();
        carrier.disconnect().await.unwrap();
        assert!(carrier.poll_events(0).await.is_err());
        tokio::time::timeout(Duration::from_secs(3), server)
            .await
            .unwrap()
            .unwrap();
    }
    #[test]
    fn origin_is_literal_loopback_without_routing_or_secrets() {
        for raw in [
            "http://localhost:9/",
            "http://127.0.0.1:9/x",
            "http://127.0.0.1:9/?token=secret",
            "https://127.0.0.1:9/",
            "http://0.0.0.0:9/",
            "http://user@127.0.0.1:9/",
        ] {
            assert!(endpoint(raw).is_err());
        }
        assert!(endpoint("http://127.0.0.1:9222/").is_ok());
        assert!(!METHODS.contains(&"evaluate"));
    }
    #[test]
    #[cfg(unix)]
    fn private_descriptor_rejects_modes_and_symlinks() {
        use std::os::unix::fs::{PermissionsExt, symlink};
        let root = tempfile::tempdir().unwrap();
        let private = root.path().canonicalize().unwrap().join("private");
        fs::create_dir(&private).unwrap();
        fs::set_permissions(&private, fs::Permissions::from_mode(0o700)).unwrap();
        let file = private.join("host.json");
        fs::write(&file, b"{}").unwrap();
        fs::set_permissions(&file, fs::Permissions::from_mode(0o600)).unwrap();
        assert_eq!(private_read(&file).unwrap(), b"{}");
        fs::set_permissions(&file, fs::Permissions::from_mode(0o644)).unwrap();
        assert!(private_read(&file).is_err());
        fs::set_permissions(&file, fs::Permissions::from_mode(0o600)).unwrap();
        let link = private.join("link");
        symlink(&file, &link).unwrap();
        assert!(private_read(&link).is_err());
    }
}
