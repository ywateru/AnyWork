use crate::{
    config::{self, Config, OsSecrets, RouteKind, Secrets},
    process::{LaunchPlan, Output, OwnedProcess},
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
#[derive(Clone, Default, Serialize)]
pub struct RouteState {
    pub phase: Phase,
    pub url: String,
    pub error: String,
    pub restart_attempts: u32,
    pub retry_in_seconds: u64,
    pub address_changed: bool,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct ServerInfo {
    pub hostname: String,
    pub workspace: String,
}
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
    pub token: String,
    pub secrets: [String; 3],
    pub secrets_loaded: bool,
    pub service: Phase,
    pub owned: bool,
    pub external: bool,
    pub authorized: bool,
    pub info: Option<ServerInfo>,
    pub clients: Vec<RemoteClient>,
    pub routes: [RouteState; 3],
    pub error: String,
    pub notice: String,
}
impl Snapshot {
    pub fn new(config: Config, token: String) -> Self {
        Self {
            config,
            token,
            secrets: Default::default(),
            secrets_loaded: false,
            service: Phase::Checking,
            owned: false,
            external: false,
            authorized: false,
            info: None,
            clients: vec![],
            routes: Default::default(),
            error: String::new(),
            notice: String::new(),
        }
    }
    pub fn locked(&self) -> bool {
        self.owned
            || self
                .routes
                .iter()
                .any(|r| r.phase.enabled() || r.phase == Phase::Stopping)
            || matches!(self.service, Phase::Starting | Phase::Stopping)
    }
    pub fn service_title(&self) -> &'static str {
        match self.service {
            Phase::Running if self.external && self.authorized => "命令行服务正在运行",
            Phase::Running if self.external => "发现已有服务 · 需要访问密钥",
            Phase::Running => "服务正在运行",
            Phase::Off => "服务已关闭",
            Phase::Error => "服务需要检查",
            Phase::Checking => "正在检查本地服务",
            Phase::Starting | Phase::Validating => "正在启动本地服务",
            Phase::Stopping => "正在关闭本地服务",
            Phase::Reconnecting => "正在恢复本地服务",
        }
    }
}
pub enum Command {
    SaveService(Config, String),
    SavePrograms(Config),
    SaveRoute(RouteKind, Config, String),
    Welcome,
    Authenticate(String),
    StartServer(Config, String),
    StopServer,
    StartRoute(RouteKind, Config, String),
    StopRoute(RouteKind),
    UseCloudflared(PathBuf, oneshot::Sender<Result<(), String>>),
    PauseForUpdate(oneshot::Sender<Result<(), String>>),
    Shutdown(oneshot::Sender<()>),
}
#[derive(Clone)]
pub struct Handle {
    pub state: Arc<Mutex<Snapshot>>,
    tx: mpsc::UnboundedSender<Command>,
}
impl Handle {
    /// Isolated UI previews never read credentials or start background processes.
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
    pub async fn use_cloudflared(&self, path: PathBuf) -> Result<(), String> {
        let (tx, rx) = oneshot::channel();
        self.tx
            .send(Command::UseCloudflared(path, tx))
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
    pub secrets: Arc<dyn Secrets>,
}
impl Default for Options {
    fn default() -> Self {
        Self {
            support: config::support_dir(),
            resources: config::resources_dir(),
            secrets: Arc::new(OsSecrets),
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

#[derive(Debug)]
struct ValidationFailure {
    message: String,
    rejected: bool,
}
impl From<String> for ValidationFailure {
    fn from(message: String) -> Self {
        Self {
            message,
            rejected: false,
        }
    }
}
impl From<&str> for ValidationFailure {
    fn from(message: &str) -> Self {
        message.to_string().into()
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
                .timeout(Duration::from_secs(5))
                .redirect(reqwest::redirect::Policy::none())
                .build()?,
            remote_direct: reqwest::Client::builder()
                .no_proxy()
                .timeout(Duration::from_secs(5))
                .redirect(reqwest::redirect::Policy::none())
                .build()?,
        })
    }
    pub async fn info(&self, origin: &str, token: &str, remote: bool) -> Result<ServerInfo> {
        let client = if remote { &self.remote } else { &self.local };
        let url = format!("{}/api/info", origin.trim_end_matches('/'));
        let response = client.get(&url).bearer_auth(token).send().await;
        let response = match response {
            Ok(response) => response,
            Err(error) if remote && (error.is_connect() || error.is_timeout()) => {
                // A desktop's system proxy can fail CONNECT/TLS for a newly created hostname.
                // A direct retry retains certificate checks, authentication and identity validation.
                self.remote_direct
                    .get(&url)
                    .bearer_auth(token)
                    .send()
                    .await
                    .with_context(|| format!("默认连接失败（{error}），直连重试也未成功。"))?
            }
            Err(error) => return Err(error.into()),
        };
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
        Ok(response.json().await?)
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
                rejected: false,
            };
        }
        let result = self.info(&c.local_url(), &token, false).await;
        let rejected = result
            .as_ref()
            .is_err_and(|e| e.downcast_ref::<IdentityRejected>().is_some());
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
            rejected,
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
    rejected: bool,
}
enum Event {
    Probe(u64, Probe),
    Validated(RouteKind, u64, String, Result<(), ValidationFailure>),
    Secrets([String; 3], String),
}
#[derive(Default)]
struct Slot {
    process: Option<OwnedProcess>,
    generation: u64,
    validation: Option<JoinHandle<()>>,
    started: Option<Instant>,
    origin_info: Option<ServerInfo>,
    token: String,
    // A stored plan is the user's intent to keep Quick Tunnel enabled. Never persist credentials.
    quick_plan: Option<LaunchPlan>,
    retry_at: Option<Instant>,
    restart_attempts: u32,
    candidate_url: String,
    remote_check_at: Option<Instant>,
    healthy_since: Option<Instant>,
}

fn reconnect_delay(attempt: u32) -> Duration {
    Duration::from_secs((2_u64 << attempt.saturating_sub(1).min(5)).min(60))
}

struct Worker {
    handle: Handle,
    options: Options,
    http: Http,
    rx: mpsc::UnboundedReceiver<Command>,
    events: mpsc::UnboundedReceiver<Event>,
    event_tx: mpsc::UnboundedSender<Event>,
    output: mpsc::Receiver<Output>,
    output_tx: mpsc::Sender<Output>,
    server: Option<OwnedProcess>,
    server_started: Option<Instant>,
    slots: [Slot; 3],
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
    let (output_tx, output) = mpsc::channel(64);
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
        output,
        output_tx,
        server: None,
        server_started: None,
        slots: Default::default(),
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
    async fn run(mut self) {
        let store = self.options.secrets.clone();
        let tx = self.event_tx.clone();
        tokio::task::spawn_blocking(move || {
            let mut values: [String; 3] = Default::default();
            let mut error = String::new();
            for kind in RouteKind::ALL {
                if let Some(account) = kind.account() {
                    match store.read(account) {
                        Ok(v) => values[kind.index()] = v,
                        Err(e) => error = e.to_string(),
                    }
                }
            }
            let _ = tx.send(Event::Secrets(values, error));
        });
        let mut tick = tokio::time::interval(Duration::from_millis(250));
        loop {
            tokio::select! {
                command=self.rx.recv()=> {match command {Some(Command::Shutdown(done))=>{self.cleanup().await;let _=done.send(());return},Some(c)=>self.command(c).await,None=>{self.cleanup().await;return}}},
                Some(event)=self.events.recv()=>self.event(event).await,
                Some(output)=self.output.recv()=>self.output(output),
                _=tick.tick()=>self.tick().await,
            }
        }
    }
    fn reset_probe(&mut self) {
        self.generation += 1;
        if let Some(task) = self.probe.take() {
            task.abort();
        }
        self.last_probe = Instant::now() - Duration::from_secs(4);
    }
    async fn command(&mut self, command: Command) {
        let result: Result<()> = match command {
            Command::SaveService(c, token) => self.save_service(c, token).await,
            Command::SavePrograms(c) => self.save_programs(c),
            Command::SaveRoute(kind, c, secret) => self.save_route(kind, c, secret).await,
            Command::Welcome => {
                let mut c = self.snapshot().config;
                c.welcomed = true;
                config::save(&self.options.support.join("manager.json"), &c)
                    .map(|()| self.edit(|s| s.config = c))
            }
            Command::Authenticate(token) => {
                self.edit(|s| {
                    s.token = token;
                    s.error.clear();
                    s.authorized = false;
                    s.clients.clear();
                    s.info = None;
                });
                self.reset_probe();
                Ok(())
            }
            Command::StartServer(c, token) => {
                let result = self.start_server(c, token).await;
                if result.is_err() && self.server.is_none() {
                    self.edit(|s| s.service = Phase::Error);
                }
                result
            }
            Command::StopServer => {
                self.stop_server().await;
                Ok(())
            }
            Command::StartRoute(kind, c, secret) => {
                if let Err(e) = self.start_route(kind, c, secret).await {
                    self.edit(|s| {
                        s.routes[kind.index()] = RouteState {
                            phase: Phase::Error,
                            error: e.to_string(),
                            ..Default::default()
                        }
                    });
                }
                Ok(())
            }
            Command::StopRoute(kind) => {
                self.stop_route(kind, String::new()).await;
                Ok(())
            }
            Command::UseCloudflared(path, done) => {
                let mut saved = self.snapshot().config;
                saved.cloudflared_binary = path.display().to_string();
                let result = config::save(&self.options.support.join("manager.json"), &saved);
                if result.is_ok() {
                    self.edit(|s| {
                        s.config = saved;
                        s.notice = "cloudflared 已安装，正在继续开启连接。".into();
                    });
                }
                let _ = done.send(result.map_err(|e| e.to_string()));
                Ok(())
            }
            Command::Shutdown(_) => Ok(()),
            Command::PauseForUpdate(done) => {
                let readiness = self.http.update_readiness(&self.snapshot()).await;
                if readiness.is_ok() {
                    self.stop_server().await;
                }
                let _ = done.send(readiness.map_err(|e| format!("{e:#}")));
                Ok(())
            }
        };
        if let Err(error) = result {
            self.edit(|s| {
                s.error = error.to_string();
                s.notice.clear();
            });
        }
    }
    async fn save_service(&mut self, c: Config, token: String) -> Result<()> {
        if self.snapshot().locked() {
            bail!("请先关闭本应用启动的服务和远程连接，再修改本地配置。")
        }
        c.validate()?;
        if !token.is_empty() {
            config::validate_token(&token)?;
        }
        // Never rotate a separately launched server's key file.
        let occupied = tokio::net::TcpStream::connect(("127.0.0.1", c.port))
            .await
            .is_ok();
        if !occupied && !token.is_empty() {
            config::write_token(&c, &token)?;
        }
        config::save(&self.options.support.join("manager.json"), &c)?;
        self.edit(|s| {
            s.config = c;
            s.token = token;
            s.service = Phase::Checking;
            s.authorized = false;
            s.external = false;
            s.clients.clear();
            s.info = None;
            s.error.clear();
            s.notice = "服务配置已保存".into();
        });
        self.reset_probe();
        Ok(())
    }
    fn save_programs(&mut self, c: Config) -> Result<()> {
        if self.snapshot().locked() {
            bail!("请先关闭本应用启动的服务和连接，再修改程序位置。")
        }
        let mut saved = self.snapshot().config;
        saved.server_binary = c.server_binary;
        saved.cloudflared_binary = c.cloudflared_binary;
        saved.tunwg_binary = c.tunwg_binary;
        config::save(&self.options.support.join("manager.json"), &saved)?;
        self.edit(|s| {
            s.config = saved;
            s.notice = "程序位置已保存".into();
            s.error.clear();
        });
        Ok(())
    }
    async fn save_route(&mut self, kind: RouteKind, c: Config, secret: String) -> Result<()> {
        if self.slots[kind.index()].process.is_some()
            || self.slots[kind.index()].quick_plan.is_some()
        {
            bail!("请先关闭这一路连接，再修改配置。")
        }
        c.validate_route(kind, &secret)?;
        let mut saved = self.snapshot().config;
        match kind {
            RouteKind::Quick => (),
            RouteKind::Named => saved.public_url = c.public_url,
            RouteKind::Relay => {
                saved.relay_domain = c.relay_domain;
                saved.force_relay = c.force_relay;
            }
        }
        if let Some(account) = kind.account() {
            let store = self.options.secrets.clone();
            let value = secret.clone();
            tokio::task::spawn_blocking(move || store.write(account, &value)).await??;
        }
        config::save(&self.options.support.join("manager.json"), &saved)?;
        self.edit(|s| {
            s.config = saved;
            s.secrets[kind.index()] = secret;
            s.routes[kind.index()] = RouteState::default();
            s.notice = format!("{}配置已保存", kind.title());
        });
        Ok(())
    }
    async fn start_server(&mut self, c: Config, mut token: String) -> Result<()> {
        if self.snapshot().locked() {
            bail!("服务或远程连接正在运行。")
        }
        c.validate()?;
        self.edit(|s| {
            s.service = Phase::Starting;
            s.error.clear();
        });
        if tokio::net::TcpStream::connect(("127.0.0.1", c.port))
            .await
            .is_ok()
        {
            self.edit(|s| s.service = Phase::Checking);
            self.reset_probe();
            bail!("此端口已有程序运行。请连接已有服务，或选择其他端口。")
        }
        if token.is_empty() {
            token = config::generate_token();
        }
        let plan = LaunchPlan::server(&c, &self.options.resources)?;
        config::write_token(&c, &token)?;
        config::save(&self.options.support.join("manager.json"), &c)?;
        let process = match OwnedProcess::spawn(&plan, None) {
            Ok(p) => p,
            Err(e) => {
                self.edit(|s| s.service = Phase::Error);
                return Err(e);
            }
        };
        self.server = Some(process);
        self.server_started = Some(Instant::now());
        self.edit(|s| {
            s.config = c;
            s.token = token;
            s.owned = true;
            s.external = false;
            s.authorized = false;
            s.service = Phase::Starting;
            s.notice.clear();
        });
        self.reset_probe();
        Ok(())
    }
    async fn stop_server(&mut self) {
        for kind in RouteKind::ALL {
            self.stop_route(kind, String::new()).await;
        }
        if let Some(mut process) = self.server.take() {
            self.edit(|s| s.service = Phase::Stopping);
            process.stop().await;
            self.edit(|s| {
                s.service = Phase::Off;
                s.owned = false;
                s.authorized = false;
                s.info = None;
                s.clients.clear();
            });
            self.reset_probe();
        }
    }
    async fn start_route(&mut self, kind: RouteKind, c: Config, secret: String) -> Result<()> {
        let i = kind.index();
        if self.slots[i].process.is_some() || self.slots[i].quick_plan.is_some() {
            return Ok(());
        }
        let state = self.snapshot();
        if !state.authorized || state.service != Phase::Running {
            bail!("请先启动或连接本地服务，并确认访问密钥有效。")
        }
        self.edit(|s| {
            s.routes[i] = RouteState {
                phase: Phase::Checking,
                ..Default::default()
            }
        });
        // Origin is immutable for this process; ignore unsaved local edits.
        let mut active = state.config.clone();
        match kind {
            RouteKind::Named => active.public_url = c.public_url.clone(),
            RouteKind::Relay => {
                active.relay_domain = c.relay_domain.clone();
                active.force_relay = c.force_relay;
            }
            _ => (),
        }
        let info = self
            .http
            .info(&active.local_url(), &state.token, false)
            .await
            .context("本地服务验证失败，请检查服务和访问密钥。")?;
        self.save_route(kind, c, secret.clone()).await?;
        let plan = LaunchPlan::route(
            &active,
            kind,
            &secret,
            &self.options.support,
            &self.options.resources,
        )?;
        if kind == RouteKind::Quick {
            let slot = &mut self.slots[i];
            slot.quick_plan = Some(plan);
            slot.origin_info = Some(info);
            slot.token = state.token;
            self.launch_quick();
            return Ok(());
        }
        self.slots[i].generation += 1;
        let generation = self.slots[i].generation;
        let process = OwnedProcess::spawn(&plan, Some((kind, generation, self.output_tx.clone())))?;
        let slot = &mut self.slots[i];
        slot.process = Some(process);
        slot.started = Some(Instant::now());
        slot.origin_info = Some(info);
        slot.token = state.token;
        self.edit(|s| {
            s.routes[i] = RouteState {
                phase: Phase::Starting,
                ..Default::default()
            };
            s.notice.clear();
        });
        if kind == RouteKind::Named {
            self.validate_route(kind, generation, active.public_url);
        }
        Ok(())
    }
    fn launch_quick(&mut self) {
        let slot = &mut self.slots[RouteKind::Quick.index()];
        let Some(plan) = slot.quick_plan.as_ref() else {
            return;
        };
        slot.generation += 1;
        slot.retry_at = None;
        slot.candidate_url.clear();
        slot.remote_check_at = None;
        slot.healthy_since = None;
        match OwnedProcess::spawn(
            plan,
            Some((RouteKind::Quick, slot.generation, self.output_tx.clone())),
        ) {
            Ok(process) => {
                slot.process = Some(process);
                slot.started = Some(Instant::now());
                let recovering = slot.restart_attempts > 0;
                self.edit(|s| {
                    s.routes[0].phase = if recovering {
                        Phase::Reconnecting
                    } else {
                        Phase::Starting
                    };
                    s.routes[0].retry_in_seconds = 0;
                    if !recovering {
                        s.notice.clear();
                    }
                });
            }
            Err(_) => self.schedule_quick_restart(
                "匿名隧道程序未能启动，正在自动重试；也可关闭连接后检查程序位置。".into(),
            ),
        }
    }
    fn schedule_quick_restart(&mut self, error: String) {
        let slot = &mut self.slots[0];
        if slot.quick_plan.is_none() {
            return;
        }
        slot.generation += 1;
        if let Some(task) = slot.validation.take() {
            task.abort();
        }
        slot.process = None;
        slot.started = None;
        slot.candidate_url.clear();
        slot.remote_check_at = None;
        slot.healthy_since = None;
        slot.restart_attempts = slot.restart_attempts.saturating_add(1);
        let delay = reconnect_delay(slot.restart_attempts);
        slot.retry_at = Some(Instant::now() + delay);
        let attempts = slot.restart_attempts;
        self.edit(|s| {
            let route = &mut s.routes[0];
            route.phase = Phase::Reconnecting;
            route.error = error;
            route.restart_attempts = attempts;
            route.retry_in_seconds = delay.as_secs();
        });
    }
    fn output(&mut self, output: Output) {
        let slot = &self.slots[output.kind.index()];
        if slot.generation != output.generation
            || slot.process.is_none()
            || slot.validation.is_some()
            || self.snapshot().routes[output.kind.index()].phase == Phase::Running
        {
            return;
        }
        self.validate_route(output.kind, output.generation, output.url);
    }
    fn validate_route(&mut self, kind: RouteKind, generation: u64, url: String) {
        let slot = &mut self.slots[kind.index()];
        if slot.generation != generation || slot.process.is_none() {
            return;
        }
        if let Some(task) = slot.validation.take() {
            task.abort();
        }
        let http = self.http.clone();
        let token = slot.token.clone();
        let expected = slot.origin_info.clone();
        let tx = self.event_tx.clone();
        slot.candidate_url = url.clone();
        if kind != RouteKind::Quick || self.snapshot().routes[kind.index()].phase != Phase::Running
        {
            self.edit(|s| {
                if s.routes[kind.index()].phase != Phase::Reconnecting {
                    s.routes[kind.index()].phase = Phase::Validating;
                }
            });
        }
        let slot = &mut self.slots[kind.index()];
        slot.validation = Some(tokio::spawn(async move {
            let mut result = Err(ValidationFailure::from("远程地址尚未就绪。"));
            for _ in 0..if kind == RouteKind::Quick { 1 } else { 30 } {
                match http.info(&url, &token, true).await {
                    Ok(actual) if expected.as_ref() == Some(&actual) => {
                        result = Ok(());
                        break;
                    }
                    Ok(_) => {
                        result = Err(ValidationFailure {
                            message:
                                "远程地址对应的 AnyWork 服务与本机不一致，请检查域名的源站配置。"
                                    .into(),
                            rejected: true,
                        });
                        break;
                    }
                    Err(e) => {
                        let rejected = e.downcast_ref::<IdentityRejected>().is_some();
                        // Do not display request URLs or raw transport errors containing credentials.
                        result = Err(ValidationFailure {
                            message: if rejected {
                                e.to_string()
                            } else {
                                "远程连接暂不可用，正在等待网络和 TLS 连接恢复。".into()
                            },
                            rejected,
                        });
                        if rejected {
                            break;
                        }
                    }
                }
                if kind != RouteKind::Quick {
                    tokio::time::sleep(Duration::from_secs(2)).await;
                }
            }
            let _ = tx.send(Event::Validated(kind, generation, url, result));
        }));
    }
    async fn stop_route(&mut self, kind: RouteKind, error: String) {
        let i = kind.index();
        self.slots[i].quick_plan = None;
        self.slots[i].retry_at = None;
        self.slots[i].remote_check_at = None;
        self.slots[i].healthy_since = None;
        self.slots[i].candidate_url.clear();
        self.slots[i].restart_attempts = 0;
        self.slots[i].generation += 1;
        if let Some(task) = self.slots[i].validation.take() {
            task.abort();
        }
        if let Some(mut process) = self.slots[i].process.take() {
            self.edit(|s| {
                s.routes[i].phase = Phase::Stopping;
                s.routes[i].url.clear();
            });
            process.stop().await;
        }
        self.slots[i].started = None;
        self.slots[i].origin_info = None;
        self.slots[i].token.clear();
        self.edit(|s| {
            s.routes[i] = RouteState {
                phase: if error.is_empty() {
                    Phase::Off
                } else {
                    Phase::Error
                },
                url: String::new(),
                error,
                ..Default::default()
            }
        });
    }
    async fn event(&mut self, event: Event) {
        match event {
            Event::Secrets(values, error) => self.edit(|s| {
                s.secrets = values;
                s.secrets_loaded = true;
                if !error.is_empty() {
                    s.error = error;
                }
            }),
            Event::Probe(generation, p) => {
                if generation != self.generation {
                    return;
                }
                self.probe = None;
                let authorized = p.info.is_some();
                let quick_identity_changed = p.info.as_ref().is_some_and(|info| {
                    self.slots[0]
                        .origin_info
                        .as_ref()
                        .is_some_and(|expected| expected != info)
                });
                let quick_rejected = p.rejected || quick_identity_changed;
                self.edit(|s| {
                    s.authorized = authorized;
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
                for kind in RouteKind::ALL {
                    let i = kind.index();
                    if kind == RouteKind::Quick && self.slots[i].quick_plan.is_some() {
                        if quick_rejected {
                            self.stop_route(kind, "本地服务的访问密钥或身份已变化，已停止自动重连；请核对后重新开启。".into()).await;
                        } else if !authorized {
                            self.slots[i].healthy_since = None;
                            self.edit(|s| {
                                s.routes[i].phase = Phase::Reconnecting;
                                s.routes[i].error =
                                    "本地服务暂不可用，保留匿名隧道并等待恢复。".into();
                            });
                        }
                    } else if !authorized && self.slots[i].process.is_some() {
                        self.stop_route(
                            kind,
                            "本地服务不可用或访问密钥已失效，请重新连接后重试。".into(),
                        )
                        .await;
                    }
                }
            }
            Event::Validated(kind, generation, url, result) => {
                let slot = &mut self.slots[kind.index()];
                if slot.generation != generation || slot.process.is_none() {
                    return;
                }
                slot.validation = None;
                if let Err(error) = result {
                    if kind == RouteKind::Quick && slot.quick_plan.is_some() && !error.rejected {
                        slot.healthy_since = None;
                        slot.remote_check_at = Some(Instant::now() + Duration::from_secs(5));
                        self.edit(|s| {
                            s.routes[0].phase = Phase::Reconnecting;
                            s.routes[0].error = error.message;
                        });
                    } else {
                        self.stop_route(
                            kind,
                            format!("远程地址未通过 TLS 与服务身份验证：{}", error.message),
                        )
                        .await;
                    }
                } else {
                    slot.healthy_since.get_or_insert_with(Instant::now);
                    slot.remote_check_at = Some(Instant::now() + Duration::from_secs(15));
                    // Only a sustained healthy process resets crash-loop backoff (see tick).
                    self.edit(|s| {
                        let route = &mut s.routes[kind.index()];
                        let changed = !route.url.is_empty() && route.url != url;
                        route.phase = Phase::Running;
                        route.url = url;
                        route.error.clear();
                        route.retry_in_seconds = 0;
                        if changed {
                            route.address_changed = true;
                        }
                    });
                }
            }
        }
    }
    async fn tick(&mut self) {
        if let Some(server) = self.server.as_mut()
            && let Some(status) = server.child.try_wait().ok().flatten()
        {
            self.server = None;
            self.server_started = None;
            self.edit(|s| {
                s.owned = false;
                s.service = Phase::Error;
                s.authorized = false;
                s.clients.clear();
                s.info = None;
                s.error = format!("本地服务已退出（{status}）。请检查端口、工作目录和程序位置。");
            });
            for kind in RouteKind::ALL {
                if kind == RouteKind::Quick && self.slots[0].quick_plan.is_some() {
                    self.edit(|s| {
                        s.routes[0].phase = Phase::Reconnecting;
                        s.routes[0].error = "本地服务已退出，保留匿名隧道并等待服务恢复。".into();
                    });
                } else {
                    self.stop_route(kind, "本地服务已关闭。".into()).await;
                }
            }
            self.reset_probe();
        }
        if self
            .server_started
            .is_some_and(|t| t.elapsed() > Duration::from_secs(30))
            && self.snapshot().service == Phase::Starting
        {
            self.edit(|s| {
                s.error = "服务尚未就绪，请检查程序和端口；可关闭后重试。".into();
            });
        }
        for kind in RouteKind::ALL {
            let i = kind.index();
            if let Some(process) = self.slots[i].process.as_mut()
                && let Some(status) = process.child.try_wait().ok().flatten()
            {
                let hint = process.failure_hint();
                let message = format!(
                    "这一路连接已退出（{status}）。{}",
                    if hint.is_empty() {
                        "请检查配置和网络后重试。"
                    } else {
                        &hint
                    }
                );
                if kind == RouteKind::Quick && self.slots[i].quick_plan.is_some() {
                    self.schedule_quick_restart(message);
                } else {
                    self.stop_route(kind, message).await;
                }
            }
            if kind == RouteKind::Quick && self.slots[i].quick_plan.is_some() {
                self.tick_quick().await;
                continue;
            }
            if self.slots[i]
                .started
                .is_some_and(|t| t.elapsed() > Duration::from_secs(120))
                && self.snapshot().routes[i].phase != Phase::Running
            {
                let hint = self.slots[i]
                    .process
                    .as_ref()
                    .map(|p| p.failure_hint())
                    .unwrap_or_default();
                self.stop_route(
                    kind,
                    format!(
                        "连接启动超时。{}",
                        if hint.is_empty() {
                            "请检查域名、连接凭据和网络后重试。"
                        } else {
                            &hint
                        }
                    ),
                )
                .await;
            }
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
    async fn tick_quick(&mut self) {
        let now = Instant::now();
        let slot = &self.slots[0];
        if let Some(deadline) = slot.retry_at {
            let remaining = deadline
                .saturating_duration_since(now)
                .as_secs()
                .saturating_add(u64::from(deadline > now));
            self.edit(|s| s.routes[0].retry_in_seconds = remaining);
            let state = self.snapshot();
            if deadline <= now && state.authorized && state.service == Phase::Running {
                self.launch_quick();
            }
            return;
        }
        if slot.process.is_none() {
            return;
        }
        if slot.candidate_url.is_empty()
            && slot
                .started
                .is_some_and(|t| t.elapsed() > Duration::from_secs(120))
        {
            // No address was ever provisioned. A stalled provisioning request cannot be recovered
            // by cloudflared's connection supervisor, so it is safe to retry this process.
            if let Some(mut process) = self.slots[0].process.take() {
                process.stop().await;
            }
            self.schedule_quick_restart("匿名地址申请超时，正在自动重试。".into());
            return;
        }
        if slot.validation.is_none()
            && !slot.candidate_url.is_empty()
            && slot.remote_check_at.is_some_and(|t| t <= now)
        {
            self.validate_route(
                RouteKind::Quick,
                slot.generation,
                slot.candidate_url.clone(),
            );
        }
        if self.snapshot().routes[0].phase == Phase::Running
            && self.slots[0]
                .healthy_since
                .is_some_and(|t| t.elapsed() > Duration::from_secs(300))
        {
            self.slots[0].restart_attempts = 0;
        }
    }
    async fn cleanup(&mut self) {
        if let Some(task) = self.probe.take() {
            task.abort();
        }
        self.stop_server().await;
    }
}

pub fn primary_lan_address(port: u16) -> Option<String> {
    let socket = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("192.0.2.1:80").ok()?;
    let ip = socket.local_addr().ok()?.ip();
    if ip.is_loopback() || ip.is_unspecified() {
        return None;
    }
    Some(format!("http://{ip}:{port}"))
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

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    #[derive(Default)]
    struct MemorySecrets(Mutex<std::collections::HashMap<String, String>>);
    impl Secrets for MemorySecrets {
        fn read(&self, account: &str) -> Result<String> {
            Ok(self
                .0
                .lock()
                .unwrap()
                .get(account)
                .cloned()
                .unwrap_or_default())
        }
        fn write(&self, account: &str, value: &str) -> Result<()> {
            self.0.lock().unwrap().insert(account.into(), value.into());
            Ok(())
        }
    }
    async fn fixture() -> (u16, JoinHandle<()>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let task = tokio::spawn(async move {
            loop {
                let (mut stream, _) = listener.accept().await.unwrap();
                tokio::spawn(async move {
                    let mut buf = [0u8; 4096];
                    let n = stream.read(&mut buf).await.unwrap_or(0);
                    let text = String::from_utf8_lossy(&buf[..n]);
                    let (status, body) = if text.contains("/api/health") {
                        ("200 OK", r#"{"status":"ok"}"#)
                    } else if !text
                        .to_lowercase()
                        .contains("authorization: bearer test-access-token-123456")
                    {
                        ("401 Unauthorized", "{}")
                    } else if text.contains("/api/clients") {
                        (
                            "200 OK",
                            r#"{"clients":[{"id":"android-fixture-000000","address":"192.0.2.4","user_agent":"AnyWork-Android","connected_at":1000,"last_seen":2000}]}"#,
                        )
                    } else {
                        ("200 OK", r#"{"hostname":"fixture","workspace":"/fixture"}"#)
                    };
                    let reply = format!(
                        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    );
                    let _ = stream.write_all(reply.as_bytes()).await;
                });
            }
        });
        (port, task)
    }
    fn worker(options: Options, c: Config) -> Worker {
        let (tx, rx) = mpsc::unbounded_channel();
        let (event_tx, events) = mpsc::unbounded_channel();
        let (output_tx, output) = mpsc::channel(64);
        let mut s = Snapshot::new(c, "test-access-token-123456".into());
        s.service = Phase::Running;
        s.authorized = true;
        s.external = true;
        Worker {
            handle: Handle {
                state: Arc::new(Mutex::new(s)),
                tx,
            },
            options,
            http: Http::new().unwrap(),
            rx,
            events,
            event_tx,
            output,
            output_tx,
            server: None,
            server_started: None,
            slots: Default::default(),
            generation: 0,
            probe: None,
            last_probe: Instant::now(),
        }
    }
    #[tokio::test]
    async fn updating_waits_for_owned_work_and_rejects_unknown_readiness() {
        for (status, body, allowed) in [
            ("200 OK", r#"{"busy_sessions":0}"#, true),
            ("200 OK", r#"{"busy_sessions":2}"#, false),
            ("200 OK", r#"{}"#, false),
            ("401 Unauthorized", r#"{}"#, false),
        ] {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let port = listener.local_addr().unwrap().port();
            let response = tokio::spawn(async move {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut buf = [0; 4096];
                let n = stream.read(&mut buf).await.unwrap();
                let request = String::from_utf8_lossy(&buf[..n]);
                assert!(request.starts_with("GET /api/update-readiness "));
                assert!(
                    request
                        .to_lowercase()
                        .contains("authorization: bearer test-access-token-123456")
                );
                stream.write_all(format!("HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes()).await.unwrap();
            });
            let dir = tempfile::tempdir().unwrap();
            let mut w = worker(
                Options {
                    support: dir.path().into(),
                    resources: dir.path().into(),
                    secrets: Arc::new(MemorySecrets::default()),
                },
                Config {
                    port,
                    ..Default::default()
                },
            );
            w.edit(|s| {
                s.owned = true;
                s.external = false;
            });
            let (tx, rx) = oneshot::channel();
            w.command(Command::PauseForUpdate(tx)).await;
            assert_eq!(rx.await.unwrap().is_ok(), allowed);
            if !allowed {
                assert_eq!(
                    w.snapshot().service,
                    Phase::Running,
                    "a refused update must leave service untouched"
                );
            }
            response.await.unwrap();
        }
    }
    #[tokio::test]
    async fn legacy_update_readiness_distinguishes_external_and_owned_tasks() {
        for external in [true, false] {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let port = listener.local_addr().unwrap().port();
            let response = tokio::spawn(async move {
                for index in 0..2 {
                    let (mut stream, _) = listener.accept().await.unwrap();
                    let mut buf = [0; 4096];
                    let n = stream.read(&mut buf).await.unwrap();
                    let request = String::from_utf8_lossy(&buf[..n]);
                    let (status, body) = if index == 0 {
                        assert!(request.starts_with("GET /api/update-readiness "));
                        ("404 Not Found", "{}".to_string())
                    } else {
                        assert!(request.starts_with("GET /api/sessions "));
                        (
                            "200 OK",
                            format!(
                                r#"{{"sessions":[{{"external":{external},"status":"running"}}]}}"#
                            ),
                        )
                    };
                    stream.write_all(format!("HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes()).await.unwrap();
                }
            });
            let mut state = Snapshot::new(
                Config {
                    port,
                    ..Default::default()
                },
                "test-access-token-123456".into(),
            );
            state.owned = true;
            state.authorized = true;
            assert_eq!(
                Http::new().unwrap().update_readiness(&state).await.is_ok(),
                external
            );
            response.await.unwrap();
            state.owned = false;
            assert!(
                Http::new().unwrap().update_readiness(&state).await.is_ok(),
                "external services must not be queried or stopped for an app update"
            );
        }
    }
    fn connector(dir: &Path) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let path = dir.join("connector");
        std::fs::write(&path,"#!/bin/sh\nif [ -n \"$TUNNEL_TOKEN\" ]; then kind=named; elif [ -n \"$TUNWG_AUTH\" ]; then kind=relay; else kind=quick; fi\nprintf '%s' \"$$\" > \"$kind.pid\"\nprintf '%s:%s' \"${TUNNEL_TOKEN:-}\" \"${TUNWG_AUTH:-}\" > \"$kind.env\"\nif [ \"$kind\" = quick ]; then printf '%s\\n' 'https://fixture.trycloudflare.com'; fi\nif [ \"$kind\" = relay ]; then printf '%s\\n' '{\"msg\":\"listener started\",\"url\":\"https://relay.example.com\"}'; fi\nexec sleep 120\n").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).unwrap();
        path
    }
    #[tokio::test]
    async fn quick_transient_outages_keep_the_process_and_verified_address() {
        let dir = tempfile::tempdir().unwrap();
        let (port, fixture) = fixture().await;
        let c = quick_config(dir.path(), port);
        let mut w = quick_worker(dir.path(), c.clone());
        w.start_route(RouteKind::Quick, c.clone(), String::new())
            .await
            .unwrap();
        let pid = w.slots[0].process.as_ref().unwrap().child.id();
        let generation = w.slots[0].generation;
        let url = "https://fixture.trycloudflare.com".to_string();
        w.slots[0].candidate_url = url.clone();
        w.event(Event::Validated(
            RouteKind::Quick,
            generation,
            url.clone(),
            Ok(()),
        ))
        .await;
        w.event(Event::Validated(
            RouteKind::Quick,
            generation,
            url.clone(),
            Err("fixture network outage".into()),
        ))
        .await;
        w.event(Event::Probe(
            0,
            Probe {
                healthy: false,
                info: None,
                clients: vec![],
                rejected: false,
            },
        ))
        .await;
        // The old startup timeout must never destroy a provisioned address, even while offline.
        w.slots[0].started = Some(Instant::now() - Duration::from_secs(600));
        w.tick().await;
        assert_eq!(w.slots[0].process.as_ref().unwrap().child.id(), pid);
        assert_eq!(w.snapshot().routes[0].phase, Phase::Reconnecting);
        assert_eq!(w.snapshot().routes[0].url, url);
        assert!(w.snapshot().locked());
        assert_eq!(w.slots[0].restart_attempts, 0);
        // Recovery rechecks the existing URL against the authenticated origin identity.
        w.event(Event::Probe(
            0,
            w.http.probe(c, "test-access-token-123456".into()).await,
        ))
        .await;
        w.event(Event::Validated(
            RouteKind::Quick,
            generation,
            url.clone(),
            Ok(()),
        ))
        .await;
        assert_eq!(w.snapshot().routes[0].phase, Phase::Running);
        assert_eq!(w.snapshot().routes[0].url, url);
        assert!(!w.snapshot().routes[0].address_changed);
        w.cleanup().await;
        fixture.abort();
    }
    fn quick_config(dir: &Path, port: u16) -> Config {
        Config {
            port,
            workspace: dir.display().to_string(),
            data_directory: dir.join("data").display().to_string(),
            cloudflared_binary: connector(dir).display().to_string(),
            ..Default::default()
        }
    }
    fn quick_worker(dir: &Path, c: Config) -> Worker {
        worker(
            Options {
                support: dir.into(),
                resources: dir.into(),
                secrets: Arc::new(MemorySecrets::default()),
            },
            c,
        )
    }
    #[tokio::test]
    async fn quick_crash_restarts_with_backoff_and_only_publishes_a_verified_new_url() {
        let dir = tempfile::tempdir().unwrap();
        let (port, fixture) = fixture().await;
        let c = quick_config(dir.path(), port);
        let mut w = quick_worker(dir.path(), c.clone());
        w.start_route(RouteKind::Quick, c, String::new())
            .await
            .unwrap();
        let old = w.slots[0].generation;
        let url = "https://before.trycloudflare.com".to_string();
        w.event(Event::Validated(RouteKind::Quick, old, url.clone(), Ok(())))
            .await;
        w.slots[0]
            .process
            .as_mut()
            .unwrap()
            .child
            .kill()
            .await
            .unwrap();
        w.tick().await;
        assert!(w.slots[0].process.is_none());
        assert_eq!(w.snapshot().routes[0].retry_in_seconds, 2);
        w.tick().await;
        assert!(w.slots[0].process.is_none());
        w.slots[0].retry_at = Some(Instant::now());
        w.tick().await;
        assert!(w.slots[0].process.is_some());
        assert_eq!(w.snapshot().routes[0].url, url);
        // Delayed output/validation from the dead process must not restore its status.
        w.event(Event::Validated(
            RouteKind::Quick,
            old,
            "https://stale.trycloudflare.com".into(),
            Ok(()),
        ))
        .await;
        assert_eq!(w.snapshot().routes[0].phase, Phase::Reconnecting);
        let new_generation = w.slots[0].generation;
        w.event(Event::Validated(
            RouteKind::Quick,
            new_generation,
            "https://after.trycloudflare.com".into(),
            Ok(()),
        ))
        .await;
        assert_eq!(
            w.snapshot().routes[0].url,
            "https://after.trycloudflare.com"
        );
        assert!(w.snapshot().routes[0].address_changed);
        // A crash shortly after reconnect continues backoff, rather than entering a hot loop.
        w.slots[0]
            .process
            .as_mut()
            .unwrap()
            .child
            .kill()
            .await
            .unwrap();
        w.tick().await;
        assert_eq!(w.snapshot().routes[0].retry_in_seconds, 4);
        w.stop_route(RouteKind::Quick, String::new()).await;
        w.tick().await;
        assert!(w.slots[0].quick_plan.is_none() && w.slots[0].retry_at.is_none());
        assert!(w.slots[0].process.is_none());
        assert_eq!(w.snapshot().routes[0].phase, Phase::Off);
        w.cleanup().await;
        fixture.abort();
    }
    #[tokio::test]
    async fn quick_health_checks_detect_outage_then_recover_on_the_same_process() {
        let dir = tempfile::tempdir().unwrap();
        let (port, fixture) = fixture().await;
        let c = quick_config(dir.path(), port);
        let mut w = quick_worker(dir.path(), c.clone());
        w.start_route(RouteKind::Quick, c.clone(), String::new())
            .await
            .unwrap();
        let pid = w.slots[0].process.as_ref().unwrap().child.id();
        let generation = w.slots[0].generation;
        w.slots[0].candidate_url = "http://127.0.0.1:9".into();
        w.slots[0].remote_check_at = Some(Instant::now());
        w.tick_quick().await;
        let event = tokio::time::timeout(Duration::from_secs(3), w.events.recv())
            .await
            .unwrap()
            .unwrap();
        w.event(event).await;
        assert_eq!(w.snapshot().routes[0].phase, Phase::Reconnecting);
        assert_eq!(w.slots[0].process.as_ref().unwrap().child.id(), pid);
        // Exercise actual authenticated HTTP, using loopback only in this isolated test.
        w.slots[0].candidate_url = c.local_url();
        w.slots[0].remote_check_at = Some(Instant::now());
        w.tick_quick().await;
        let event = tokio::time::timeout(Duration::from_secs(3), w.events.recv())
            .await
            .unwrap()
            .unwrap();
        w.event(event).await;
        assert_eq!(w.snapshot().routes[0].phase, Phase::Running);
        assert_eq!(w.slots[0].generation, generation);
        assert_eq!(w.slots[0].process.as_ref().unwrap().child.id(), pid);
        w.cleanup().await;
        fixture.abort();
    }
    #[tokio::test]
    async fn quick_spawn_failure_retries_until_stopped_and_shutdown_cancels_pending_work() {
        let dir = tempfile::tempdir().unwrap();
        let (port, fixture) = fixture().await;
        let c = quick_config(dir.path(), port);
        let mut w = quick_worker(dir.path(), c.clone());
        w.start_route(RouteKind::Quick, c, String::new())
            .await
            .unwrap();
        w.slots[0]
            .process
            .as_mut()
            .unwrap()
            .child
            .kill()
            .await
            .unwrap();
        w.tick().await;
        w.slots[0].quick_plan.as_mut().unwrap().program = dir.path().join("missing-program");
        w.slots[0].retry_at = Some(Instant::now());
        w.tick_quick().await;
        assert_eq!(w.slots[0].restart_attempts, 2);
        assert!(w.slots[0].retry_at.is_some());
        assert_eq!(w.snapshot().routes[0].phase, Phase::Reconnecting);
        assert!(w.save_programs(w.snapshot().config).is_err());
        assert!(
            w.save_route(RouteKind::Quick, w.snapshot().config, String::new())
                .await
                .is_err()
        );
        w.stop_server().await;
        w.tick_quick().await;
        assert!(w.slots[0].quick_plan.is_none() && w.slots[0].retry_at.is_none());
        assert!(w.slots[0].process.is_none());
        assert_eq!(reconnect_delay(u32::MAX), Duration::from_secs(60));
        w.cleanup().await;
        fixture.abort();
    }
    #[tokio::test]
    async fn quick_authentication_and_identity_rejection_cancel_automatic_recovery() {
        let dir = tempfile::tempdir().unwrap();
        let (port, fixture) = fixture().await;
        let c = quick_config(dir.path(), port);
        let mut w = quick_worker(dir.path(), c.clone());
        for local_rejection in [false, true] {
            w.edit(|s| {
                s.service = Phase::Running;
                s.authorized = true;
            });
            w.start_route(RouteKind::Quick, c.clone(), String::new())
                .await
                .unwrap();
            if local_rejection {
                let probe = w.http.probe(c.clone(), "wrong-key".into()).await;
                assert!(probe.rejected);
                w.event(Event::Probe(0, probe)).await;
            } else {
                // A real valid response with a different identity must fail, even over TLS.
                w.slots[0].origin_info.as_mut().unwrap().hostname = "different-origin".into();
                w.validate_route(RouteKind::Quick, w.slots[0].generation, c.local_url());
                let event = tokio::time::timeout(Duration::from_secs(3), w.events.recv())
                    .await
                    .unwrap()
                    .unwrap();
                w.event(event).await;
            }
            assert!(w.slots[0].quick_plan.is_none() && w.slots[0].process.is_none());
            assert_eq!(w.snapshot().routes[0].phase, Phase::Error);
        }
        w.cleanup().await;
        fixture.abort();
    }
    #[tokio::test]
    async fn three_processes_remain_independent_through_stop_failure_retry_and_stale_validation() {
        let dir = tempfile::tempdir().unwrap();
        let (port, http) = fixture().await;
        let executable = connector(dir.path()).display().to_string();
        let c = Config {
            workspace: dir.path().display().to_string(),
            data_directory: dir.path().join("data").display().to_string(),
            port,
            public_url: "https://named.example.com".into(),
            relay_domain: "relay.example.com".into(),
            cloudflared_binary: executable.clone(),
            tunwg_binary: executable,
            ..Default::default()
        };
        let store = Arc::new(MemorySecrets::default());
        let opts = Options {
            support: dir.path().into(),
            resources: dir.path().into(),
            secrets: store.clone(),
        };
        let mut w = worker(opts, c.clone());
        for kind in RouteKind::ALL {
            w.start_route(
                kind,
                c.clone(),
                match kind {
                    RouteKind::Quick => "",
                    RouteKind::Named => "named-secret",
                    RouteKind::Relay => "relay-secret",
                }
                .into(),
            )
            .await
            .unwrap();
        }
        for _ in 0..100 {
            if ["quick.env", "named.env", "relay.env"]
                .iter()
                .all(|name| dir.path().join(name).exists())
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        let pids: Vec<_> = w
            .slots
            .iter()
            .map(|s| s.process.as_ref().unwrap().child.id().unwrap())
            .collect();
        assert!(pids[0] != pids[1] && pids[1] != pids[2]);
        assert_eq!(
            std::fs::read_to_string(dir.path().join("named.env")).unwrap(),
            "named-secret:"
        );
        assert_eq!(
            std::fs::read_to_string(dir.path().join("relay.env")).unwrap(),
            ":relay-secret"
        );
        assert_eq!(
            std::fs::read_to_string(dir.path().join("quick.env")).unwrap(),
            ":"
        );
        // Simulate verified network replies; real public TLS is separately validated.
        for kind in RouteKind::ALL {
            let g = w.slots[kind.index()].generation;
            w.event(Event::Validated(
                kind,
                g,
                format!("https://{}.example.com", kind.index()),
                Ok(()),
            ))
            .await;
        }
        let old = w.slots[1].generation;
        w.stop_route(RouteKind::Named, String::new()).await;
        w.event(Event::Validated(
            RouteKind::Named,
            old,
            "https://stale.example.com".into(),
            Ok(()),
        ))
        .await;
        assert_eq!(w.snapshot().routes[1].phase, Phase::Off);
        assert_eq!(w.snapshot().routes[0].phase, Phase::Running);
        assert_eq!(w.snapshot().routes[2].phase, Phase::Running);
        assert!(
            w.slots[0]
                .process
                .as_mut()
                .unwrap()
                .child
                .try_wait()
                .unwrap()
                .is_none()
        );
        assert!(
            w.slots[2]
                .process
                .as_mut()
                .unwrap()
                .child
                .try_wait()
                .unwrap()
                .is_none()
        );
        let mut edited = c.clone();
        edited.public_url = "https://updated.example.com".into();
        w.save_route(RouteKind::Named, edited.clone(), "updated-secret".into())
            .await
            .unwrap();
        assert_eq!(w.snapshot().config.public_url, edited.public_url);
        assert_eq!(w.snapshot().config.relay_domain, c.relay_domain);
        w.start_route(RouteKind::Named, edited, "updated-secret".into())
            .await
            .unwrap();
        let generation = w.slots[1].generation;
        assert!(generation > old);
        w.event(Event::Validated(
            RouteKind::Named,
            generation,
            "https://updated.example.com".into(),
            Err("fixture TLS validation failed".into()),
        ))
        .await;
        assert_eq!(w.snapshot().routes[1].phase, Phase::Error);
        assert!(w.slots[1].process.is_none());
        assert_eq!(w.snapshot().routes[0].phase, Phase::Running);
        assert!(
            !std::fs::read_to_string(dir.path().join("manager.json"))
                .unwrap()
                .contains("secret")
        );
        w.cleanup().await;
        assert!(w.slots.iter().all(|s| s.process.is_none()));
        // External service is still alive and retains the same identity.
        assert!(
            w.http
                .info(&c.local_url(), "test-access-token-123456", false)
                .await
                .is_ok()
        );
        http.abort();
    }
    #[tokio::test]
    async fn authentication_and_external_ownership_are_enforced() {
        let dir = tempfile::tempdir().unwrap();
        let (port, http) = fixture().await;
        let c = Config {
            port,
            workspace: dir.path().display().to_string(),
            data_directory: dir.path().join("data").display().to_string(),
            ..Default::default()
        };
        config::write_token(&c, "original-file-token-123456").unwrap();
        let mut w = worker(
            Options {
                support: dir.path().into(),
                resources: dir.path().into(),
                secrets: Arc::new(MemorySecrets::default()),
            },
            c.clone(),
        );
        let p = w.http.probe(c.clone(), "incorrect-key".into()).await;
        assert!(p.healthy && p.info.is_none() && p.clients.is_empty());
        let p = w
            .http
            .probe(c.clone(), "test-access-token-123456".into())
            .await;
        assert_eq!(p.clients.len(), 1);
        w.event(Event::Probe(0, p)).await;
        assert!(w.snapshot().external && w.snapshot().authorized && !w.snapshot().owned);
        w.save_service(c.clone(), "test-access-token-123456".into())
            .await
            .unwrap();
        assert_eq!(config::read_token(&c), "original-file-token-123456");
        assert!(
            w.start_server(c.clone(), "test-access-token-123456".into())
                .await
                .is_err()
        );
        assert!(w.server.is_none());
        w.stop_server().await;
        assert!(
            w.http
                .info(&c.local_url(), "test-access-token-123456", false)
                .await
                .is_ok()
        );
        http.abort();
    }
    #[tokio::test]
    async fn remote_transport_failure_retries_direct_but_authentication_stays_enforced() {
        let (port, fixture) = fixture().await;
        let mut http = Http::new().unwrap();
        http.remote = reqwest::Client::builder()
            .proxy(reqwest::Proxy::all("http://127.0.0.1:9").unwrap())
            .timeout(Duration::from_secs(1))
            .build()
            .unwrap();
        let origin = format!("http://127.0.0.1:{port}");
        assert_eq!(
            http.info(&origin, "test-access-token-123456", true)
                .await
                .unwrap()
                .hostname,
            "fixture"
        );
        assert!(
            http.info(&origin, "wrong-access-key", true)
                .await
                .unwrap_err()
                .to_string()
                .contains("401")
        );
        fixture.abort();
    }
    #[tokio::test]
    async fn installed_connector_is_saved_without_stopping_other_routes_or_rotating_keys() {
        let dir = tempfile::tempdir().unwrap();
        let c = Config {
            data_directory: dir.path().join("data").display().to_string(),
            ..Default::default()
        };
        config::write_token(&c, "original-file-token-123456").unwrap();
        let mut w = worker(
            Options {
                support: dir.path().into(),
                resources: dir.path().into(),
                secrets: Arc::new(MemorySecrets::default()),
            },
            c,
        );
        w.edit(|s| {
            s.routes[2] = RouteState {
                phase: Phase::Running,
                url: "https://relay.example.com".into(),
                error: String::new(),
                ..Default::default()
            }
        });
        let path = connector(dir.path());
        let (done, rx) = oneshot::channel();
        w.command(Command::UseCloudflared(path.clone(), done)).await;
        rx.await.unwrap().unwrap();
        let s = w.snapshot();
        assert_eq!(s.config.cloudflared_binary, path.display().to_string());
        assert_eq!(
            config::load(&dir.path().join("manager.json"))
                .unwrap()
                .cloudflared_binary,
            s.config.cloudflared_binary
        );
        assert_eq!(s.routes[2].phase, Phase::Running);
        assert!(s.authorized);
        assert_eq!(config::read_token(&s.config), "original-file-token-123456");
    }
    #[tokio::test]
    #[ignore = "creates a real anonymous tunnel to an isolated fixture, requires Internet"]
    async fn real_quick_tunnel_validates_isolated_origin() {
        let dir = tempfile::tempdir().unwrap();
        let (port, http) = fixture().await;
        let c = Config {
            port,
            ..Default::default()
        };
        let mut w = worker(
            Options {
                support: dir.path().into(),
                resources: config::resources_dir(),
                secrets: Arc::new(MemorySecrets::default()),
            },
            c.clone(),
        );
        w.start_route(RouteKind::Quick, c, String::new())
            .await
            .unwrap();
        let result = tokio::time::timeout(Duration::from_secs(130), async {
            loop {
                tokio::select! {
                    Some(output) = w.output.recv() => w.output(output),
                    Some(event) = w.events.recv() => w.event(event).await,
                    _ = tokio::time::sleep(Duration::from_millis(250)) => w.tick().await,
                }
                let route = w.snapshot().routes[0].clone();
                if matches!(route.phase, Phase::Running | Phase::Error) {
                    return route;
                }
            }
        })
        .await;
        w.cleanup().await;
        http.abort();
        let route = result.expect("anonymous tunnel timed out");
        assert_eq!(route.phase, Phase::Running, "{}", route.error);
    }
    #[tokio::test]
    #[ignore = "requires the built AnyWork server and ANYWORK_CODEX_DISCOVERY=false"]
    async fn bundled_server_start_auth_presence_and_shutdown() {
        assert_eq!(
            std::env::var("ANYWORK_CODEX_DISCOVERY").as_deref(),
            Ok("false")
        );
        let dir = tempfile::tempdir().unwrap();
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .canonicalize()
            .unwrap();
        let server = root.join("target/release/anywork");
        assert!(server.is_file(), "build the server first");
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        let c = Config {
            workspace: dir.path().display().to_string(),
            data_directory: dir.path().join("data").display().to_string(),
            port,
            server_binary: server.display().to_string(),
            ..Default::default()
        };
        let opts = Options {
            support: dir.path().join("manager"),
            resources: root,
            secrets: Arc::new(MemorySecrets::default()),
        };
        let mut w = worker(opts, c.clone());
        w.edit(|s| {
            s.service = Phase::Off;
            s.external = false;
            s.authorized = false;
        });
        w.start_server(c.clone(), "test-access-token-123456".into())
            .await
            .unwrap();
        let mut ready = false;
        for _ in 0..60 {
            if w.http
                .info(&c.local_url(), "test-access-token-123456", false)
                .await
                .is_ok()
            {
                ready = true;
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        assert!(ready, "isolated bundled server failed to start");
        assert!(w.snapshot().owned);
        assert!(
            w.http
                .info(&c.local_url(), "incorrect-key", false)
                .await
                .is_err()
        );
        let response = w
            .http
            .local
            .post(format!("{}/api/clients/heartbeat", c.local_url()))
            .bearer_auth("test-access-token-123456")
            .header("X-AnyWork-Client-Id", "rust-desktop-test-android-0001")
            .header("User-Agent", "AnyWork-Android fixture")
            .send()
            .await
            .unwrap();
        assert!(response.status().is_success());
        let probe = w
            .http
            .probe(c.clone(), "test-access-token-123456".into())
            .await;
        assert_eq!(probe.clients.len(), 1);
        assert_eq!(probe.clients[0].name(), "AnyWork Android");
        w.stop_server().await;
        assert!(w.server.is_none());
        assert!(
            tokio::net::TcpStream::connect(("127.0.0.1", port))
                .await
                .is_err()
        );
        assert_eq!(config::read_token(&c), "test-access-token-123456");
    }

    #[test]
    fn rejects_second_manager_for_same_configuration_directory() {
        let dir = tempfile::tempdir().unwrap();
        let first = manager_lock(dir.path()).unwrap();
        assert!(manager_lock(dir.path()).is_err());
        let inherited = first.0.try_clone().unwrap();
        drop(first);
        let second = manager_lock(dir.path()).unwrap();
        drop(inherited);
        assert!(manager_lock(dir.path()).is_err());
        drop(second);
        assert!(manager_lock(dir.path()).is_ok());
    }
}
