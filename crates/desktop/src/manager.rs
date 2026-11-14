use crate::{
    config::{self, Config},
    process::{LaunchPlan, OwnedProcess},
};
use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tokio::{
    sync::{mpsc, oneshot},
    task::JoinHandle,
};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Phase {
    #[default]
    Off,
    Checking,
    Starting,
    Validating,
    Running,
    Reconnecting,
    Stopping,
    Error,
}
impl Phase {
    pub fn enabled(self) -> bool {
        matches!(
            self,
            Self::Checking | Self::Starting | Self::Validating | Self::Running | Self::Reconnecting
        )
    }
    pub fn busy(self) -> bool {
        matches!(
            self,
            Self::Checking
                | Self::Starting
                | Self::Validating
                | Self::Stopping
                | Self::Reconnecting
        )
    }
    pub fn title(self) -> &'static str {
        match self {
            Self::Off => "未开启",
            Self::Checking => "正在检查",
            Self::Starting => "正在启动",
            Self::Validating => "正在验证连接",
            Self::Running => "已连接",
            Self::Reconnecting => "正在恢复连接",
            Self::Stopping => "正在关闭",
            Self::Error => "连接失败",
        }
    }
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ServerInfo {
    pub hostname: String,
    pub product: String,
    pub workspace: String,
    #[serde(default)]
    pub local_service_control: bool,
    #[serde(default)]
    pub local_browser_session: bool,
}
impl PartialEq for ServerInfo {
    fn eq(&self, other: &Self) -> bool {
        self.hostname == other.hostname && self.workspace == other.workspace
    }
}
impl Eq for ServerInfo {}
#[derive(Clone, Deserialize, Serialize)]
pub struct RemoteClient {
    pub id: String,
    pub address: String,
    pub user_agent: String,
    pub connected_at: u64,
    pub last_seen: u64,
}
impl RemoteClient {
    pub fn name(&self) -> &'static str {
        let ua = &self.user_agent;
        if ua.contains("AnyWork-Android") {
            "AnyWork Android"
        } else if ua.contains("Android") {
            "Android 设备"
        } else if ua.contains("iPhone") || ua.contains("iPad") {
            "iPhone / iPad"
        } else if ua.contains("Macintosh") {
            "Mac 浏览器"
        } else if ua.contains("Windows") {
            "Windows 浏览器"
        } else {
            "远程客户端"
        }
    }
}
#[derive(Clone, Serialize)]
pub struct Snapshot {
    pub config: Config,
    #[serde(skip_serializing)]
    pub token: String,
    pub service: Phase,
    pub owned: bool,
    pub external: bool,
    pub authorized: bool,
    pub info: Option<ServerInfo>,
    pub clients: Vec<RemoteClient>,
    pub error: String,
    pub notice: String,
}
impl Snapshot {
    pub fn new(config: Config, token: String) -> Self {
        Self {
            config,
            token,
            service: Phase::Checking,
            owned: false,
            external: false,
            authorized: false,
            info: None,
            clients: vec![],
            error: String::new(),
            notice: String::new(),
        }
    }
    pub fn locked(&self) -> bool {
        self.owned || matches!(self.service, Phase::Starting | Phase::Stopping)
    }
}
pub enum Command {
    SaveService(Config),
    SavePrograms(Config),
    StartServer(Config, String),
    StopServer,
    PrepareWorkspace(oneshot::Sender<Result<(), String>>),
    OpenWorkspace(BrowserContext, oneshot::Sender<Result<String, String>>),
    PauseForUpdate(oneshot::Sender<Result<(), String>>),
    Shutdown(oneshot::Sender<()>),
}
#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserContext {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account_label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub installation_id: Option<String>,
    pub remote_enabled: bool,
}
#[derive(Clone)]
pub struct Handle {
    pub state: Arc<Mutex<Snapshot>>,
    tx: mpsc::UnboundedSender<Command>,
}
impl Handle {
    #[cfg(test)]
    pub(crate) fn test_commands(snapshot: Snapshot) -> (Self, mpsc::UnboundedReceiver<Command>) {
        let (tx, rx) = mpsc::unbounded_channel();
        (
            Self {
                state: Arc::new(Mutex::new(snapshot)),
                tx,
            },
            rx,
        )
    }
    pub fn preview(snapshot: Snapshot) -> Self {
        let (tx, _) = mpsc::unbounded_channel();
        Self {
            state: Arc::new(Mutex::new(snapshot)),
            tx,
        }
    }
    pub fn snapshot(&self) -> Snapshot {
        self.state.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }
    pub fn send(&self, command: Command) {
        let _ = self.tx.send(command);
    }
    pub async fn open_workspace(&self, context: BrowserContext) -> Result<String, String> {
        let (tx, rx) = oneshot::channel();
        self.tx
            .send(Command::OpenWorkspace(context, tx))
            .map_err(|_| "桌面服务已关闭。".to_string())?;
        rx.await.map_err(|_| "桌面服务已关闭。".to_string())?
    }
    pub async fn prepare_workspace(&self) -> Result<(), String> {
        let (tx, rx) = oneshot::channel();
        self.tx
            .send(Command::PrepareWorkspace(tx))
            .map_err(|_| "桌面服务已关闭。".to_string())?;
        rx.await.map_err(|_| "桌面服务已关闭。".to_string())?
    }
    pub async fn shutdown(&self) {
        let (tx, rx) = oneshot::channel();
        self.send(Command::Shutdown(tx));
        let _ = tokio::time::timeout(Duration::from_secs(14), rx).await;
    }
    pub async fn pause_for_update(&self) -> Result<()> {
        let (tx, rx) = oneshot::channel();
        self.tx.send(Command::PauseForUpdate(tx))?;
        tokio::time::timeout(Duration::from_secs(20), rx)
            .await??
            .map_err(anyhow::Error::msg)?;
        Ok(())
    }
}
#[derive(Clone)]
pub struct Options {
    pub support: PathBuf,
    pub resources: PathBuf,
}
impl Default for Options {
    fn default() -> Self {
        Self {
            support: config::support_dir(),
            resources: config::resources_dir(),
        }
    }
}
#[derive(Debug)]
struct IdentityRejected(String);
impl std::fmt::Display for IdentityRejected {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}
impl std::error::Error for IdentityRejected {}

fn transport_hint(error: &reqwest::Error) -> &'static str {
    // Inspect internally, but never expose request URLs, proxy credentials or provider output.
    let detail = format!("{error:?}").to_ascii_lowercase();
    if error.is_timeout() {
        "远程验证超时，请检查网络或代理；将继续自动重试。"
    } else if detail.contains("certificate") || detail.contains("tls") || detail.contains("ssl") {
        "远程 TLS 证书或握手验证失败，请检查系统时间、证书和代理设置。"
    } else if detail.contains("dns")
        || detail.contains("resolve")
        || detail.contains("no such host")
    {
        "远程域名解析失败，请检查 DNS 和代理设置；将继续自动重试。"
    } else if error.is_decode() {
        "远程返回了无法识别的服务响应，请检查代理和隧道源站。"
    } else {
        "无法建立远程连接，请检查网络、防火墙和代理；将继续自动重试。"
    }
}

#[derive(Clone)]
pub struct Http {
    local: reqwest::Client,
    remote: reqwest::Client,
    remote_direct: reqwest::Client,
}
impl Http {
    async fn update_readiness(&self, state: &Snapshot) -> Result<()> {
        if !state.owned {
            return Ok(());
        }
        anyhow::ensure!(state.authorized, "无法确认任务状态，请稍后再更新。");
        let response = self
            .local
            .get(format!("{}/api/update-readiness", state.config.local_url()))
            .bearer_auth(&state.token)
            .send()
            .await?;
        let busy = if response.status() == reqwest::StatusCode::NOT_FOUND {
            // 0.1.1 hosts predate the dedicated endpoint. Keep the first upgrade safe too.
            #[derive(Deserialize)]
            struct Session {
                external: bool,
                status: String,
            }
            #[derive(Deserialize)]
            struct Sessions {
                sessions: Vec<Session>,
            }
            let sessions = self
                .local
                .get(format!("{}/api/sessions", state.config.local_url()))
                .bearer_auth(&state.token)
                .send()
                .await?
                .error_for_status()?
                .json::<Sessions>()
                .await?;
            sessions
                .sessions
                .iter()
                .filter(|s| {
                    !s.external && ["running", "starting", "waiting"].contains(&s.status.as_str())
                })
                .count()
        } else {
            #[derive(Deserialize)]
            struct Readiness {
                busy_sessions: usize,
            }
            response
                .error_for_status()?
                .json::<Readiness>()
                .await?
                .busy_sessions
        };
        anyhow::ensure!(
            busy == 0,
            "仍有 {busy} 个本应用管理的会话正在执行或等待确认，请任务结束后再更新。更新包已保留。"
        );
        Ok(())
    }
    pub fn new() -> Result<Self> {
        Ok(Self {
            local: reqwest::Client::builder()
                .no_proxy()
                .timeout(Duration::from_secs(3))
                .redirect(reqwest::redirect::Policy::none())
                .build()?,
            remote: reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(5))
                .timeout(Duration::from_secs(12))
                .redirect(reqwest::redirect::Policy::none())
                .build()?,
            remote_direct: reqwest::Client::builder()
                .no_proxy()
                .connect_timeout(Duration::from_secs(5))
                .timeout(Duration::from_secs(12))
                .redirect(reqwest::redirect::Policy::none())
                .build()?,
        })
    }
    pub async fn info(&self, origin: &str, token: &str, remote: bool) -> Result<ServerInfo> {
        let client = if remote { &self.remote } else { &self.local };
        let url = format!("{}/api/info", origin.trim_end_matches('/'));
        match Self::read_info(client, &url, token).await {
            Ok(info) => Ok(info),
            Err(error) if remote && error.downcast_ref::<IdentityRejected>().is_none() => {
                // Proxies can also return HTTP 502/503 or an HTML error page.
                // Retry the complete authenticated check, preserving TLS and identity checks.
                Self::read_info(&self.remote_direct, &url, token)
                    .await
                    .map_err(|direct| {
                        if direct.downcast_ref::<IdentityRejected>().is_some() {
                            direct
                        } else {
                            anyhow::anyhow!("默认连接：{error} 直连重试：{direct}")
                        }
                    })
            }
            Err(error) => Err(error),
        }
    }
    async fn read_info(client: &reqwest::Client, url: &str, token: &str) -> Result<ServerInfo> {
        let response = client
            .get(url)
            .bearer_auth(token)
            .send()
            .await
            .map_err(|error| anyhow::anyhow!(transport_hint(&error)))?;
        if !response.status().is_success() {
            if matches!(response.status().as_u16(), 401 | 403) {
                return Err(IdentityRejected(format!(
                    "服务返回 HTTP {}，访问密钥未通过验证。",
                    response.status().as_u16()
                ))
                .into());
            }
            if response.status().as_u16() == 530 {
                bail!("Cloudflare 隧道尚未连通（HTTP 530），请检查到 Cloudflare 的网络连接。")
            }
            if matches!(response.status().as_u16(), 502..=504) {
                bail!(
                    "远程隧道或本地服务暂不可用（HTTP {}）。",
                    response.status().as_u16()
                )
            }
            bail!(
                "服务返回 HTTP {}，未通过身份验证。",
                response.status().as_u16()
            )
        }
        if response.content_length().is_some_and(|n| n > 65536) {
            bail!("响应过大")
        }
        let info: ServerInfo = response
            .json()
            .await
            .map_err(|error| anyhow::anyhow!(transport_hint(&error)))?;
        anyhow::ensure!(info.product == "AnyWork", "本地服务身份不符。");
        Ok(info)
    }
    async fn probe(&self, c: Config, token: String) -> Probe {
        let healthy = match self
            .local
            .get(format!("{}/api/health", c.local_url()))
            .send()
            .await
        {
            Ok(r) if r.status().is_success() => r
                .json::<serde_json::Value>()
                .await
                .is_ok_and(|v| v["status"] == "ok"),
            _ => false,
        };
        if !healthy {
            return Probe {
                healthy: false,
                info: None,
                clients: vec![],
            };
        }
        let result = self.info(&c.local_url(), &token, false).await;
        let info = result.ok();
        let clients = if info.is_some() {
            match self
                .local
                .get(format!("{}/api/clients", c.local_url()))
                .bearer_auth(&token)
                .send()
                .await
            {
                Ok(r) if r.status().is_success() => r
                    .json::<Clients>()
                    .await
                    .map(|r| r.clients)
                    .unwrap_or_default(),
                _ => vec![],
            }
        } else {
            vec![]
        };
        Probe {
            healthy,
            info,
            clients,
        }
    }
}
#[derive(Deserialize)]
struct Clients {
    clients: Vec<RemoteClient>,
}
struct Probe {
    healthy: bool,
    info: Option<ServerInfo>,
    clients: Vec<RemoteClient>,
}
enum Event {
    Probe(u64, Probe),
}
struct Worker {
    handle: Handle,
    options: Options,
    http: Http,
    rx: mpsc::UnboundedReceiver<Command>,
    events: mpsc::UnboundedReceiver<Event>,
    event_tx: mpsc::UnboundedSender<Event>,
    server: Option<OwnedProcess>,
    server_started: Option<Instant>,
    generation: u64,
    probe: Option<JoinHandle<()>>,
    last_probe: Instant,
}
pub fn start(options: Options) -> Result<Handle> {
    config::prepare(&options.support)?;
    let (config, error) = match config::load(&options.support.join("manager.json")) {
        Ok(c) => (c, String::new()),
        Err(e) => (Config::default(), e.to_string()),
    };
    let token = config::read_token(&config);
    let mut snapshot = Snapshot::new(config, token);
    snapshot.error = error;
    let (tx, rx) = mpsc::unbounded_channel();
    let (event_tx, events) = mpsc::unbounded_channel();
    let handle = Handle {
        state: Arc::new(Mutex::new(snapshot)),
        tx,
    };
    let worker = Worker {
        handle: handle.clone(),
        options,
        http: Http::new()?,
        rx,
        events,
        event_tx,
        server: None,
        server_started: None,
        generation: 0,
        probe: None,
        last_probe: Instant::now() - Duration::from_secs(4),
    };
    tokio::spawn(worker.run());
    Ok(handle)
}
impl Worker {
    fn edit(&self, f: impl FnOnce(&mut Snapshot)) {
        f(&mut self.handle.state.lock().unwrap_or_else(|e| e.into_inner()));
    }
    fn snapshot(&self) -> Snapshot {
        self.handle.snapshot()
    }
    fn reset_probe(&mut self) {
        self.generation += 1;
        if let Some(t) = self.probe.take() {
            t.abort();
        }
        self.last_probe = Instant::now() - Duration::from_secs(4);
    }
    async fn run(mut self) {
        let mut tick = tokio::time::interval(Duration::from_millis(250));
        loop {
            tokio::select! {
                command=self.rx.recv()=>match command { Some(Command::Shutdown(done))=>{self.cleanup().await;let _=done.send(());return}, Some(c)=>self.command(c).await, None=>{self.cleanup().await;return} },
                Some(event)=self.events.recv()=>self.event(event), _=tick.tick()=>self.tick().await,
            }
        }
    }
    async fn command(&mut self, command: Command) {
        let result = match command {
            Command::SaveService(c) => self.save_service(c).await,
            Command::SavePrograms(c) => self.save_programs(c),
            Command::StartServer(c, token) => self.start_server(c, token).await,
            Command::StopServer => {
                if self.server.is_some() {
                    match self.http.update_readiness(&self.snapshot()).await {
                        Ok(()) => {
                            self.stop_server().await;
                            Ok(())
                        }
                        Err(e) => Err(e),
                    }
                } else {
                    Err(anyhow::anyhow!(
                        "已有服务由其他进程管理，本应用不会停止它。"
                    ))
                }
            }
            Command::PrepareWorkspace(done) => {
                let result = self.prepare_workspace().await.map_err(|e| e.to_string());
                let _ = done.send(result);
                Ok(())
            }
            Command::OpenWorkspace(context, done) => {
                let result = self
                    .open_workspace(context)
                    .await
                    .map_err(|e| e.to_string());
                let _ = done.send(result);
                Ok(())
            }
            Command::PauseForUpdate(done) => {
                let readiness = self.http.update_readiness(&self.snapshot()).await;
                if readiness.is_ok() {
                    self.stop_server().await;
                }
                let _ = done.send(readiness.map_err(|e| e.to_string()));
                Ok(())
            }
            Command::Shutdown(_) => Ok(()),
        };
        if let Err(error) = result {
            self.edit(|s| {
                s.error = error.to_string();
                s.notice.clear();
            });
        }
    }
    async fn save_service(&mut self, c: Config) -> Result<()> {
        if self.snapshot().locked() {
            bail!("请先停止本应用启动的本地服务，再修改配置。")
        }
        c.validate()?;
        // Preserve retired fields and their files; this version neither reads secrets nor starts old routes.
        let mut saved = self.snapshot().config;
        saved.workspace = c.workspace;
        saved.data_directory = c.data_directory;
        saved.port = c.port;
        saved.allow_lan = false;
        config::save(&self.options.support.join("manager.json"), &saved)?;
        let token = config::read_token(&saved);
        self.edit(|s| {
            s.config = saved;
            s.token = token;
            s.service = Phase::Checking;
            s.authorized = false;
            s.info = None;
            s.clients.clear();
            s.error.clear();
        });
        self.reset_probe();
        Ok(())
    }
    fn save_programs(&mut self, c: Config) -> Result<()> {
        if self.snapshot().locked() {
            bail!("请先停止本应用启动的本地服务，再修改配置。")
        }
        let mut saved = self.snapshot().config;
        saved.server_binary = c.server_binary;
        config::save(&self.options.support.join("manager.json"), &saved)?;
        self.edit(|s| s.config = saved);
        Ok(())
    }
    async fn start_server(&mut self, mut c: Config, mut token: String) -> Result<()> {
        if self.snapshot().locked() {
            bail!("本地服务正在运行。")
        }
        c.validate()?;
        c.allow_lan = false;
        if tokio::net::TcpStream::connect(("127.0.0.1", c.port))
            .await
            .is_ok()
        {
            bail!("此端口已有服务；请选择其数据目录后重试，不会替换已有服务。")
        }
        if token.is_empty() {
            token = config::read_token(&c);
        }
        if token.is_empty() {
            token = config::generate_token();
        }
        config::validate_token(&token)?;
        let plan = LaunchPlan::server(&c, &self.options.resources)?;
        if config::read_token(&c).is_empty() {
            config::write_token(&c, &token)?;
        }
        config::save(&self.options.support.join("manager.json"), &c)?;
        let process = OwnedProcess::spawn(&plan)?;
        self.server = Some(process);
        self.server_started = Some(Instant::now());
        self.edit(|s| {
            s.config = c;
            s.token = token;
            s.owned = true;
            s.external = false;
            s.authorized = false;
            s.service = Phase::Starting;
            s.error.clear();
        });
        self.reset_probe();
        Ok(())
    }
    async fn prepare_workspace(&mut self) -> Result<()> {
        let mut s = self.snapshot();
        let occupied = tokio::net::TcpStream::connect(("127.0.0.1", s.config.port))
            .await
            .is_ok();
        if !occupied && self.server.is_none() {
            self.start_server(s.config.clone(), s.token.clone()).await?;
        } else if s.token.is_empty() {
            s.token = config::read_token(&s.config);
            self.edit(|v| v.token = s.token.clone());
        }
        let deadline = tokio::time::Instant::now() + Duration::from_secs(30);
        let info = loop {
            match self
                .http
                .info(&s.config.local_url(), &self.snapshot().token, false)
                .await
            {
                Ok(info) => break info,
                Err(e) if occupied || tokio::time::Instant::now() >= deadline => {
                    return Err(e.context("无法验证本地服务，请在设置中选择该服务的数据目录。"));
                }
                Err(_) => tokio::time::sleep(Duration::from_millis(200)).await,
            }
        };
        anyhow::ensure!(
            info.local_browser_session,
            "当前本地服务不支持安全浏览器交接，请先升级本地服务。不会退回访问密钥链接。"
        );
        // This authenticated check supersedes polls begun before preparation.
        // Even a completed poll can still have an event queued in run().
        self.reset_probe();
        self.last_probe = Instant::now();
        self.edit(|v| {
            v.authorized = true;
            v.service = Phase::Running;
            v.info = Some(info);
            v.external = !v.owned;
        });
        Ok(())
    }
    async fn open_workspace(&mut self, context: BrowserContext) -> Result<String> {
        self.prepare_workspace().await?;
        let current = self.snapshot();
        #[derive(Deserialize)]
        struct Ticket {
            ticket: String,
            #[serde(rename = "expiresIn")]
            expires_in: u64,
        }
        let response = self
            .http
            .local
            .post(format!(
                "{}/api/service/browser-ticket",
                current.config.local_url()
            ))
            .bearer_auth(&current.token)
            .header("x-anywork-service-control", "desktop")
            .json(&context)
            .send()
            .await
            .context("无法建立本机浏览器会话。")?;
        anyhow::ensure!(
            response.status().is_success(),
            "本地服务未接受浏览器交接，请检查版本与服务状态。"
        );
        let ticket: Ticket = response
            .json()
            .await
            .context("本地服务未确认浏览器交接。")?;
        anyhow::ensure!(
            ticket.expires_in == 60
                && ticket.ticket.len() == 64
                && ticket.ticket.bytes().all(|b| b.is_ascii_hexdigit()),
            "本地服务返回了无效交接响应。"
        );
        Ok(format!(
            "{}/#local-ticket={}",
            current.config.local_url(),
            ticket.ticket
        ))
    }
    async fn stop_server(&mut self) {
        if let Some(mut p) = self.server.take() {
            self.edit(|s| s.service = Phase::Stopping);
            p.stop().await;
            self.edit(|s| {
                s.owned = false;
                s.authorized = false;
                s.info = None;
                s.clients.clear();
                s.service = Phase::Off;
            });
            self.reset_probe();
        }
    }
    fn event(&mut self, event: Event) {
        let Event::Probe(generation, p) = event;
        if generation != self.generation {
            return;
        }
        self.probe = None;
        self.edit(|s| {
            s.authorized = p.info.is_some();
            s.info = p.info;
            s.clients = p.clients;
            if p.healthy {
                s.external = !s.owned;
                s.service = Phase::Running;
            } else if s.owned {
                s.service = Phase::Starting;
            } else if s.service != Phase::Error {
                s.service = Phase::Off;
                s.external = false;
            }
        });
    }
    async fn tick(&mut self) {
        if let Some(p) = self.server.as_mut()
            && p.child.try_wait().ok().flatten().is_some()
        {
            self.server = None;
            self.server_started = None;
            self.edit(|s| {
                s.owned = false;
                s.authorized = false;
                s.service = Phase::Error;
                s.info = None;
                s.clients.clear();
                s.error = "本地服务已退出，请检查设置后重试。".into();
            });
            self.reset_probe();
        }
        if self
            .server_started
            .is_some_and(|t| t.elapsed() > Duration::from_secs(30))
            && self.snapshot().service == Phase::Starting
        {
            self.edit(|s| s.error = "本地服务尚未就绪，请检查程序与端口。".into());
        }
        if self.probe.is_none() && self.last_probe.elapsed() > Duration::from_secs(3) {
            self.last_probe = Instant::now();
            let http = self.http.clone();
            let s = self.snapshot();
            let generation = self.generation;
            let tx = self.event_tx.clone();
            self.probe = Some(tokio::spawn(async move {
                let p = http.probe(s.config, s.token).await;
                let _ = tx.send(Event::Probe(generation, p));
            }));
        }
    }
    async fn cleanup(&mut self) {
        if let Some(t) = self.probe.take() {
            t.abort();
        }
        self.stop_server().await;
    }
}
pub struct ManagerLock(std::fs::File);

impl Drop for ManagerLock {
    fn drop(&mut self) {
        // A concurrent spawn can briefly inherit the descriptor before exec on
        // macOS. Explicitly release our lock rather than waiting for every copy
        // of the open file description to close.
        let _ = fs2::FileExt::unlock(&self.0);
    }
}

pub fn manager_lock(support: &Path) -> Result<ManagerLock> {
    config::prepare(support)?;
    let file = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(support.join("manager.lock"))?;
    fs2::FileExt::try_lock_exclusive(&file)
        .context("AnyWork 桌面程序已在运行。请使用已打开的窗口。")?;
    Ok(ManagerLock(file))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn workspace_preparation_fences_older_probe_results_before_remote_enable() {
        use axum::{Json, Router, routing::get};

        let dir = tempfile::tempdir().unwrap();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let healthy = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let health = healthy.clone();
        let app = Router::new()
            // A background poll saw a transient startup failure. Its event can
            // already be queued when the explicit prepare command is selected.
            .route(
                "/api/health",
                get(move || {
                    let health = health.clone();
                    async move {
                        (
                            if health.load(std::sync::atomic::Ordering::SeqCst) {
                                axum::http::StatusCode::OK
                            } else {
                                axum::http::StatusCode::SERVICE_UNAVAILABLE
                            },
                            Json(serde_json::json!({"status":"ok"})),
                        )
                    }
                }),
            )
            .route(
                "/api/info",
                get(|headers: axum::http::HeaderMap| async move {
                    assert_eq!(headers["authorization"], "Bearer fixture-local-bearer");
                    Json(serde_json::json!({
                        "hostname":"fixture", "product":"AnyWork",
                        "workspace":"/isolated-workspace", "local_browser_session":true
                    }))
                }),
            )
            .route(
                "/api/clients",
                get(|| async { Json(serde_json::json!({"clients":[]})) }),
            );
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let config = Config {
            workspace: dir.path().display().to_string(),
            data_directory: dir.path().join("data").display().to_string(),
            port,
            ..Default::default()
        };
        let (tx, rx) = mpsc::unbounded_channel();
        let (event_tx, events) = mpsc::unbounded_channel();
        let handle = Handle {
            state: Arc::new(Mutex::new(Snapshot::new(
                config,
                "fixture-local-bearer".into(),
            ))),
            tx,
        };
        let mut worker = Worker {
            handle: handle.clone(),
            options: Options {
                support: dir.path().into(),
                resources: dir.path().into(),
            },
            http: Http::new().unwrap(),
            rx,
            events,
            event_tx,
            server: None,
            server_started: None,
            generation: 0,
            probe: None,
            last_probe: Instant::now() - Duration::from_secs(4),
        };
        worker.tick().await;
        let stale = tokio::time::timeout(Duration::from_secs(3), worker.events.recv())
            .await
            .unwrap()
            .unwrap();
        // Exercise the real authenticated preparation, then the older HTTP
        // poll event in the other valid order of the actor's select branches.
        worker.prepare_workspace().await.unwrap();
        assert!(handle.snapshot().authorized);
        assert_eq!(handle.snapshot().service, Phase::Running);
        worker.event(stale);
        assert!(
            handle.snapshot().authorized,
            "an older probe erased successful workspace preparation"
        );
        assert_eq!(handle.snapshot().service, Phase::Running);
        crate::accounts::default_tests::assert_remote_enables_with_prepared_manager(handle.clone())
            .await;
        // A newer failure must still close readiness; this is an ordering fence,
        // not a permanent exemption from the normal background health checks.
        worker.last_probe = Instant::now() - Duration::from_secs(4);
        worker.tick().await;
        let current = tokio::time::timeout(Duration::from_secs(3), worker.events.recv())
            .await
            .unwrap()
            .unwrap();
        worker.event(current);
        assert!(!handle.snapshot().authorized);
        assert_eq!(handle.snapshot().service, Phase::Off);
        // A queued positive result from the old host cannot authorize a newly
        // selected host either. Use a real successful HTTP poll as that event.
        healthy.store(true, std::sync::atomic::Ordering::SeqCst);
        worker.last_probe = Instant::now() - Duration::from_secs(4);
        worker.tick().await;
        let previous_host = tokio::time::timeout(Duration::from_secs(3), worker.events.recv())
            .await
            .unwrap()
            .unwrap();
        let next_port = std::net::TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        worker
            .save_service(Config {
                port: next_port,
                data_directory: dir.path().join("other-data").display().to_string(),
                ..handle.snapshot().config
            })
            .await
            .unwrap();
        worker.event(previous_host);
        assert!(!handle.snapshot().authorized);
        assert_eq!(handle.snapshot().service, Phase::Checking);
        assert_eq!(handle.snapshot().config.port, next_port);
        worker.cleanup().await;
        server.abort();
    }

    #[tokio::test]
    async fn open_reuses_verified_external_service_and_hands_off_only_short_lived_ticket() {
        use axum::{
            Json, Router,
            routing::{get, post},
        };
        let dir = tempfile::tempdir().unwrap();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let tickets = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let issued = tickets.clone();
        let app=Router::new().route("/api/health",get(||async{Json(serde_json::json!({"status":"ok"}))})).route("/api/info",get(||async{Json(serde_json::json!({"hostname":"fixture","product":"AnyWork","workspace":"/existing-workspace","local_browser_session":true}))})).route("/api/service/browser-ticket",post(move |headers:axum::http::HeaderMap,Json(body):Json<serde_json::Value>|{let issued=issued.clone();async move{
            issued.fetch_add(1,std::sync::atomic::Ordering::SeqCst);
            assert_eq!(headers["authorization"],"Bearer selected-local-service-bearer");assert_eq!(headers["x-anywork-service-control"],"desktop");assert_eq!(body["remoteEnabled"],false);assert!(body.get("subject").is_none());Json(serde_json::json!({"ticket":"a".repeat(64),"expiresIn":60}))}}));
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let c = Config {
            workspace: dir.path().display().to_string(),
            data_directory: dir.path().join("data").display().to_string(),
            port,
            ..Default::default()
        };
        config::save(&dir.path().join("manager.json"), &c).unwrap();
        config::write_token(&c, "selected-local-service-bearer").unwrap();
        let handle = start(Options {
            support: dir.path().into(),
            resources: dir.path().into(),
        })
        .unwrap();
        let saved = std::fs::read(dir.path().join("manager.json")).unwrap();
        handle.prepare_workspace().await.unwrap();
        assert_eq!(tickets.load(std::sync::atomic::Ordering::SeqCst), 0);
        assert!(handle.snapshot().external && handle.snapshot().authorized);
        let url = handle
            .open_workspace(BrowserContext::default())
            .await
            .unwrap();
        assert_eq!(
            url,
            format!("http://127.0.0.1:{port}/#local-ticket={}", "a".repeat(64))
        );
        assert_eq!(tickets.load(std::sync::atomic::Ordering::SeqCst), 1);
        assert_eq!(
            std::fs::read(dir.path().join("manager.json")).unwrap(),
            saved
        );
        assert!(handle.snapshot().authorized);
        assert!(!handle.snapshot().owned);
        assert!(handle.snapshot().external);
        assert!(
            !serde_json::to_string(&handle.snapshot())
                .unwrap()
                .contains("selected-local-service-bearer")
        );
        handle.shutdown().await;
        assert!(
            tokio::net::TcpStream::connect(("127.0.0.1", port))
                .await
                .is_ok()
        );
        assert_eq!(config::read_token(&c), "selected-local-service-bearer");
        server.abort();
    }
    #[tokio::test]
    async fn preparation_rejects_external_identity_auth_and_old_capability_without_mutation() {
        use axum::{
            Json, Router,
            http::StatusCode,
            routing::{get, post},
        };
        for mode in ["unauthorized", "wrong-product", "old-service"] {
            let dir = tempfile::tempdir().unwrap();
            let tickets = Arc::new(std::sync::atomic::AtomicUsize::new(0));
            let issued = tickets.clone();
            let app = Router::new()
                .route("/api/health",get(||async {Json(serde_json::json!({"status":"ok"}))}))
                .route("/api/info", get(move ||async move {
                    (if mode=="unauthorized" {StatusCode::UNAUTHORIZED}else{StatusCode::OK},Json(serde_json::json!({
                        "product":if mode=="wrong-product" {"Other"}else{"AnyWork"},
                        "hostname":"fixture","workspace":"/external-unchanged","local_browser_session":false
                    })))
                }))
                .route("/api/service/browser-ticket",post(move ||{let issued=issued.clone();async move {issued.fetch_add(1,std::sync::atomic::Ordering::SeqCst);StatusCode::INTERNAL_SERVER_ERROR}}));
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let port = listener.local_addr().unwrap().port();
            let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
            let config = Config {
                workspace: dir.path().display().to_string(),
                data_directory: dir.path().join("data").display().to_string(),
                port,
                ..Default::default()
            };
            config::save(&dir.path().join("manager.json"), &config).unwrap();
            config::write_token(&config, "selected-external-service-key").unwrap();
            let saved = std::fs::read(dir.path().join("manager.json")).unwrap();
            let handle = start(Options {
                support: dir.path().into(),
                resources: dir.path().into(),
            })
            .unwrap();
            assert!(
                handle.prepare_workspace().await.is_err(),
                "must reject {mode}"
            );
            assert_eq!(tickets.load(std::sync::atomic::Ordering::SeqCst), 0);
            assert!(!handle.snapshot().authorized);
            assert!(!handle.snapshot().owned);
            assert_eq!(
                std::fs::read(dir.path().join("manager.json")).unwrap(),
                saved
            );
            assert_eq!(config::read_token(&config), "selected-external-service-key");
            handle.shutdown().await;
            assert!(
                tokio::net::TcpStream::connect(("127.0.0.1", port))
                    .await
                    .is_ok()
            );
            server.abort();
        }
    }
    #[test]
    fn manager_lock_rejects_a_second_owner() {
        let dir = tempfile::tempdir().unwrap();
        let first = manager_lock(dir.path()).unwrap();
        assert!(manager_lock(dir.path()).is_err());
        drop(first);
        assert!(manager_lock(dir.path()).is_ok());
    }
}
