use crate::config::{self, Config};
use anyhow::{Context, Result, bail};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};
use tokio::{
    process::{Child, Command},
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
pub struct OwnedProcess {
    pub child: Child,
    readers: Vec<JoinHandle<()>>,
}
impl OwnedProcess {
    pub fn spawn(plan: &LaunchPlan) -> Result<Self> {
        Self::spawn_inner(plan, None)
    }
    /// Account gateway provider only. No standalone route configuration or recovery.
    pub fn spawn_account_provider(
        plan: &LaunchPlan,
        output: tokio::sync::mpsc::Sender<String>,
    ) -> Result<Self> {
        Self::spawn_inner(plan, Some(output))
    }
    fn spawn_inner(
        plan: &LaunchPlan,
        output: Option<tokio::sync::mpsc::Sender<String>>,
    ) -> Result<Self> {
        let mut child = plan
            .command()
            .spawn()
            .context("无法启动本地程序，请检查程序位置与权限。")?;
        let stdout = child.stdout.take().context("无法读取程序输出")?;
        let stderr = child.stderr.take().context("无法读取程序输出")?;
        let readers = vec![
            tokio::spawn(read_provider(stdout, output.clone())),
            tokio::spawn(read_provider(stderr, output)),
        ];
        Ok(Self { child, readers })
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

async fn read_provider(
    mut reader: impl tokio::io::AsyncRead + Unpin,
    output: Option<tokio::sync::mpsc::Sender<String>>,
) {
    use tokio::io::AsyncReadExt;
    let mut buf = [0; 4096];
    let mut line = Vec::new();
    let mut overflow = false;
    loop {
        let n = match reader.read(&mut buf).await {
            Ok(n) => n,
            Err(_) => return,
        };
        if n == 0 {
            if !overflow {
                publish_provider(&line, &output);
            }
            return;
        }
        for byte in &buf[..n] {
            if *byte == b'\n' {
                if !overflow {
                    publish_provider(&line, &output);
                }
                line.clear();
                overflow = false;
            } else if line.len() < 16384 && !overflow {
                line.push(*byte);
            } else {
                overflow = true;
            }
        }
    }
}
fn publish_provider(line: &[u8], output: &Option<tokio::sync::mpsc::Sender<String>>) {
    let Some(output) = output else { return };
    let line = String::from_utf8_lossy(line);
    for (start, _) in line.match_indices("https://") {
        let value: String = line[start..]
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric() || ":/.-".contains(*c))
            .collect();
        if let Ok(u) = url::Url::parse(&value)
            && u.scheme() == "https"
            && u.path() == "/"
            && u.query().is_none()
            && u.fragment().is_none()
            && u.username().is_empty()
            && u.port().is_none()
            && u.host_str().is_some_and(|h| {
                h.strip_suffix(".trycloudflare.com").is_some_and(|p| {
                    !p.is_empty()
                        && p.bytes()
                            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
                })
            })
        {
            let _ = output.try_send(u.origin().ascii_serialization());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn server_plan_is_local_and_does_not_include_old_providers() {
        let dir = tempfile::tempdir().unwrap();
        let c = Config {
            workspace: dir.path().display().to_string(),
            data_directory: dir.path().join("data").display().to_string(),
            server_binary: "/usr/bin/true".into(),
            ..Default::default()
        };
        let p = LaunchPlan::server(&c, dir.path()).unwrap();
        assert!(p.args.windows(2).any(|p| p == ["--bind", "127.0.0.1:3210"]));
        assert!(p.args.windows(2).any(|p| p == ["--agent-scope", "all"]));
        assert!(!p.args.iter().any(|x| x.contains("tunwg")));
    }
    #[tokio::test]
    async fn account_provider_only_emits_verified_root_tunnel_origins() {
        let (tx, mut rx) = tokio::sync::mpsc::channel(4);
        read_provider(&b"INF | https://owned-provider.trycloudflare.com |\nhttps://bad.trycloudflare.com.evil.test\nhttps://nested.bad.trycloudflare.com\nhttps://bad.trycloudflare.com/path\n"[..],Some(tx)).await;
        assert_eq!(
            rx.recv().await.as_deref(),
            Some("https://owned-provider.trycloudflare.com")
        );
        assert!(rx.recv().await.is_none());
    }
}
