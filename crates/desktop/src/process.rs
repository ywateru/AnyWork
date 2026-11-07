use crate::config::{self, Config, RouteKind};
use anyhow::{Context, Result, bail};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncReadExt},
    process::{Child, Command},
    sync::mpsc,
    task::JoinHandle,
};

const CLEARED_ENV: &[&str] = &[
    "ANYWORK_TOKEN",
    "REMOTE_AGENT_TOKEN",
    "ANYWORK_BIND",
    "ANYWORK_DATA",
    "ANYWORK_WEB",
    "ANYWORK_WORKSPACE",
    "TUNWG_AUTH",
    "TUNWG_API",
    "TUNWG_PATH",
    "TUNWG_RELAY",
    "TUNNEL_TOKEN",
];
#[derive(Clone)]
pub struct LaunchPlan {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub env: BTreeMap<String, String>,
    pub cwd: PathBuf,
}
impl LaunchPlan {
    pub fn server(c: &Config, resources: &Path) -> Result<Self> {
        c.validate()?;
        let mut args = vec![
            "--bind".into(),
            format!(
                "{}:{}",
                if c.allow_lan { "0.0.0.0" } else { "127.0.0.1" },
                c.port
            ),
            "--workspace".into(),
            c.workspace.clone(),
            "--data-dir".into(),
            c.data_directory.clone(),
            "--web-dir".into(),
            resources
                .join(if resources.join("web/dist").is_dir() {
                    "web/dist"
                } else {
                    "web"
                })
                .display()
                .to_string(),
            "--plugins-dir".into(),
            resources.join("plugins").display().to_string(),
            "--codex-scope".into(),
            "all".into(),
            "--agent-scope".into(),
            "all".into(),
            "--trust-local-proxy".into(),
        ];
        let socket = config::home().join(".codex/ipc/ipc.sock");
        if socket.exists() {
            args.extend(["--desktop-ipc-socket".into(), socket.display().to_string()]);
        }
        Ok(Self {
            program: executable("anywork", &c.server_binary, resources)?,
            args,
            env: BTreeMap::new(),
            cwd: resources.into(),
        })
    }
    pub fn route(
        c: &Config,
        kind: RouteKind,
        secret: &str,
        support: &Path,
        resources: &Path,
    ) -> Result<Self> {
        c.validate_route(kind, secret)?;
        config::prepare(support)?;
        let mut env = BTreeMap::new();
        let (program, args) = match kind {
            RouteKind::Quick => {
                let file = support.join("quick-tunnel.yml");
                config::atomic_private(&file, b"{}\n")?;
                (
                    crate::cloudflared::resolve(&c.cloudflared_binary, support, resources)?,
                    vec![
                        "tunnel".into(),
                        "--config".into(),
                        file.display().to_string(),
                        "--no-autoupdate".into(),
                        "--protocol".into(),
                        "http2".into(),
                        "--url".into(),
                        c.local_url(),
                    ],
                )
            }
            RouteKind::Named => {
                env.insert("TUNNEL_TOKEN".into(), secret.into());
                (
                    crate::cloudflared::resolve(&c.cloudflared_binary, support, resources)?,
                    vec!["tunnel".into(), "--no-autoupdate".into(), "run".into()],
                )
            }
            RouteKind::Relay => {
                env.insert("TUNWG_API".into(), c.relay_domain.clone());
                env.insert("TUNWG_AUTH".into(), secret.into());
                env.insert(
                    "TUNWG_PATH".into(),
                    support.join("tunwg").display().to_string(),
                );
                if c.force_relay {
                    env.insert("TUNWG_RELAY".into(), "true".into());
                }
                (
                    executable("tunwg", &c.tunwg_binary, resources)?,
                    vec![
                        "--json".into(),
                        "--log_level=0".into(),
                        format!("--forward={}", c.local_url()),
                    ],
                )
            }
        };
        Ok(Self {
            program,
            args,
            env,
            cwd: support.into(),
        })
    }
    pub fn command(&self) -> Command {
        let mut cmd = Command::new(&self.program);
        cmd.args(&self.args)
            .current_dir(&self.cwd)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        for key in CLEARED_ENV {
            cmd.env_remove(key);
        }
        cmd.envs(&self.env);
        #[cfg(unix)]
        {
            let mut paths = vec![
                PathBuf::from("/opt/homebrew/bin"),
                PathBuf::from("/opt/zerobrew/bin"),
                PathBuf::from("/usr/local/bin"),
                PathBuf::from("/usr/bin"),
                PathBuf::from("/bin"),
            ];
            if let Some(path) = std::env::var_os("PATH") {
                paths.extend(std::env::split_paths(&path));
            }
            if let Ok(path) = std::env::join_paths(paths) {
                cmd.env("PATH", path);
            }
        }
        #[cfg(windows)]
        {
            cmd.creation_flags(0x08000000);
        }
        cmd
    }
}
pub fn executable(name: &str, configured: &str, resources: &Path) -> Result<PathBuf> {
    if !configured.is_empty() {
        let path = PathBuf::from(configured);
        if is_executable(&path) {
            return Ok(path);
        }
        bail!("程序位置无效：{name}，请在高级选项中重新选择。")
    }
    let name = if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.into()
    };
    let mut candidates = vec![
        resources.join("bin").join(&name),
        resources.join("target/release").join(&name),
    ];
    if let Some(path) = std::env::var_os("PATH") {
        candidates.extend(std::env::split_paths(&path).map(|p| p.join(&name)));
    }
    for dir in [
        "/opt/homebrew/bin",
        "/opt/zerobrew/bin",
        "/usr/local/bin",
        "/usr/bin",
    ] {
        candidates.push(Path::new(dir).join(&name));
    }
    candidates
        .into_iter()
        .find(|p| is_executable(p))
        .with_context(|| format!("找不到 {name}。请在高级选项中选择程序，或重新安装完整桌面包。"))
}
pub(crate) fn is_executable(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        path.metadata()
            .is_ok_and(|m| m.permissions().mode() & 0o111 != 0)
    }
    #[cfg(not(unix))]
    {
        true
    }
}
#[derive(Debug)]
pub struct Output {
    pub kind: RouteKind,
    pub generation: u64,
    pub url: String,
}
pub struct OwnedProcess {
    pub child: Child,
    readers: Vec<JoinHandle<()>>,
    failure: Arc<Mutex<Option<String>>>,
}
impl OwnedProcess {
    pub fn spawn(
        plan: &LaunchPlan,
        route: Option<(RouteKind, u64, mpsc::Sender<Output>)>,
    ) -> Result<Self> {
        let mut child = plan
            .command()
            .spawn()
            .context("无法启动程序，请检查程序位置及运行权限。")?;
        let stdout = child.stdout.take().context("无法读取程序输出")?;
        let stderr = child.stderr.take().context("无法读取程序输出")?;
        let failure = Arc::new(Mutex::new(None));
        let readers = vec![
            tokio::spawn(read_output(stdout, route.clone(), failure.clone())),
            tokio::spawn(read_output(stderr, route, failure.clone())),
        ];
        Ok(Self {
            child,
            readers,
            failure,
        })
    }
    pub fn failure_hint(&self) -> String {
        self.failure
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
            .unwrap_or_default()
    }
    pub async fn stop(&mut self) {
        if self.child.try_wait().ok().flatten().is_none() {
            #[cfg(unix)]
            if let Some(pid) = self.child.id() {
                unsafe {
                    libc::kill(pid as i32, libc::SIGTERM);
                }
            }
            #[cfg(not(unix))]
            {
                let _ = self.child.start_kill();
            }
            if tokio::time::timeout(Duration::from_secs(3), self.child.wait())
                .await
                .is_err()
            {
                let _ = self.child.kill().await;
            }
        }
        for task in self.readers.drain(..) {
            task.abort();
        }
    }
}
impl Drop for OwnedProcess {
    fn drop(&mut self) {
        for task in &self.readers {
            task.abort();
        }
    }
}
async fn read_output(
    mut reader: impl AsyncRead + Unpin,
    route: Option<(RouteKind, u64, mpsc::Sender<Output>)>,
    failure: Arc<Mutex<Option<String>>>,
) {
    let mut chunk = [0u8; 4096];
    let mut line = Vec::new();
    let mut overflow = false;
    loop {
        let count = match reader.read(&mut chunk).await {
            Ok(0) | Err(_) => {
                if !overflow && !line.is_empty() {
                    output_line(&line, &route, &failure);
                }
                break;
            }
            Ok(n) => n,
        };
        for &byte in &chunk[..count] {
            if byte == b'\n' {
                if !overflow {
                    output_line(&line, &route, &failure);
                }
                line.clear();
                overflow = false;
            } else if line.len() < 16384 && !overflow {
                line.push(byte);
            } else {
                overflow = true;
            }
        }
    }
}
fn output_line(
    line: &[u8],
    route: &Option<(RouteKind, u64, mpsc::Sender<Output>)>,
    failure: &Mutex<Option<String>>,
) {
    let line = String::from_utf8_lossy(line);
    if let Some(hint) = failure_hint(&line) {
        *failure.lock().unwrap_or_else(|e| e.into_inner()) = Some(hint.into());
    }
    if let Some((kind, generation, tx)) = route
        && let Some(url) = tunnel_url(&line, *kind)
    {
        let _ = tx.try_send(Output {
            kind: *kind,
            generation: *generation,
            url,
        });
    }
}
// Classify errors without retaining provider output, which can include credentials.
fn failure_hint(line: &str) -> Option<&'static str> {
    let text = line.to_ascii_lowercase();
    if text.contains("failed to request quick tunnel")
        || text.contains("error requesting quick tunnel")
    {
        Some("无法向 Cloudflare 申请临时地址，请检查网络后重试。")
    } else if text.contains("x509:") || text.contains("certificate verify failed") {
        Some("Cloudflare 连接证书验证失败，请检查系统时间、证书和代理设置。")
    } else if text.contains("failed to dial to edge with quic")
        || text.contains("failed to dial a quic connection")
    {
        Some("无法连接 Cloudflare 边缘网络，请检查防火墙和网络是否允许隧道连接。")
    } else if text.contains("no such host") || text.contains("dns lookup failed") {
        Some("Cloudflare 域名解析失败，请检查 DNS 和网络。")
    } else if text.contains("cannot read configuration") || text.contains("error parsing yaml") {
        Some("cloudflared 无法读取隧道配置，请检查配置文件权限。")
    } else if text.contains("unauthorized") || text.contains("invalid tunnel token") {
        Some("Cloudflare 连接器令牌无效，请重新配置固定隧道。")
    } else {
        None
    }
}
pub fn tunnel_url(line: &str, kind: RouteKind) -> Option<String> {
    match kind {
        RouteKind::Quick => {
            for (index, _) in line.match_indices("https://") {
                let candidate: String = line[index..]
                    .chars()
                    .take_while(|c| c.is_ascii_alphanumeric() || ":/.-".contains(*c))
                    .collect();
                if let Ok(url) = config::secure_url(&candidate)
                    && let Some(host) = url.host_str()
                    && let Some(label) = host.strip_suffix(".trycloudflare.com")
                    && !label.is_empty()
                    && label
                        .bytes()
                        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
                {
                    return Some(url.as_str().trim_end_matches('/').into());
                }
            }
            None
        }
        RouteKind::Relay => {
            let record: serde_json::Value = serde_json::from_str(line).ok()?;
            if record["msg"] != "listener started" {
                return None;
            }
            config::secure_url(record["url"].as_str()?)
                .ok()
                .map(|u| u.as_str().trim_end_matches('/').into())
        }
        RouteKind::Named => None,
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[cfg(unix)]
    fn desktop_service_explicitly_enables_cross_project_agent_history() {
        let dir = tempfile::tempdir().unwrap();
        let c = Config {
            workspace: dir.path().display().to_string(),
            data_directory: dir.path().join("data").display().to_string(),
            server_binary: "/usr/bin/true".into(),
            ..Default::default()
        };
        let plan = LaunchPlan::server(&c, dir.path()).unwrap();
        assert!(plan.args.windows(2).any(|p| p == ["--agent-scope", "all"]));
        assert!(plan.args.windows(2).any(|p| p == ["--codex-scope", "all"]));
    }
    #[tokio::test]
    async fn output_without_final_newline_is_read_and_diagnostics_do_not_echo_credentials() {
        let (tx, mut rx) = mpsc::channel(2);
        let failure = Arc::new(Mutex::new(None));
        let bytes = b"ERR Failed to request quick Tunnel token=secret-value\nhttps://fixture.trycloudflare.com";
        read_output(&bytes[..], Some((RouteKind::Quick, 4, tx)), failure.clone()).await;
        assert_eq!(
            rx.recv().await.unwrap().url,
            "https://fixture.trycloudflare.com"
        );
        let hint = failure.lock().unwrap().clone().unwrap();
        assert!(hint.contains("临时地址"));
        assert!(!hint.contains("secret-value"));
    }
    #[test]
    fn parses_only_expected_route_events() {
        assert_eq!(
            tunnel_url(
                "INF | https://quiet-sun.trycloudflare.com |",
                RouteKind::Quick
            )
            .as_deref(),
            Some("https://quiet-sun.trycloudflare.com")
        );
        for bad in [
            "https://a.trycloudflare.com.evil.test",
            "https://a.b.trycloudflare.com",
            "https://example.com",
            "https://a.trycloudflare.com/path",
        ] {
            assert!(tunnel_url(bad, RouteKind::Quick).is_none());
        }
        assert!(
            tunnel_url(
                r#"{"msg":"other","url":"https://example.com"}"#,
                RouteKind::Relay
            )
            .is_none()
        );
        assert!(
            tunnel_url(
                r#"{"msg":"listener started","url":"https://example.com"}"#,
                RouteKind::Relay
            )
            .is_some()
        );
    }
    #[test]
    #[cfg(unix)]
    fn quick_tunnel_uses_tcp_http2_and_an_isolated_config() {
        let dir = tempfile::tempdir().unwrap();
        let c = Config {
            cloudflared_binary: "/usr/bin/true".into(),
            ..Default::default()
        };
        let plan = LaunchPlan::route(&c, RouteKind::Quick, "", dir.path(), dir.path()).unwrap();
        assert!(plan.args.windows(2).any(|p| p == ["--protocol", "http2"]));
        assert!(plan.args.windows(2).any(|p| p == ["--url", &c.local_url()]));
        assert_eq!(
            std::fs::read_to_string(dir.path().join("quick-tunnel.yml")).unwrap(),
            "{}\n"
        );
    }
    #[test]
    #[cfg(unix)]
    fn provider_credentials_are_not_in_arguments_or_other_routes() {
        let dir = tempfile::tempdir().unwrap();
        let c = Config {
            cloudflared_binary: "/usr/bin/true".into(),
            tunwg_binary: "/usr/bin/true".into(),
            public_url: "https://example.com".into(),
            relay_domain: "relay.example.com".into(),
            ..Default::default()
        };
        let named = LaunchPlan::route(&c, RouteKind::Named, "named-secret", dir.path(), dir.path())
            .unwrap();
        let relay = LaunchPlan::route(&c, RouteKind::Relay, "relay-secret", dir.path(), dir.path())
            .unwrap();
        assert!(!named.args.join(" ").contains("named-secret"));
        assert_eq!(named.env.len(), 1);
        assert!(!relay.env.contains_key("TUNNEL_TOKEN"));
        let env: std::collections::HashMap<_, _> = named
            .command()
            .as_std()
            .get_envs()
            .map(|(k, v)| (k.to_os_string(), v.map(|s| s.to_os_string())))
            .collect();
        assert_eq!(env[std::ffi::OsStr::new("TUNWG_AUTH")], None);
    }
}
