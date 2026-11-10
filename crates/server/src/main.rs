mod api;
mod capabilities;
mod catalog;
mod clients;
mod composer;
mod control;
#[cfg(unix)]
mod desktop;
#[cfg(unix)]
mod desktop_ipc;
#[cfg(unix)]
mod desktop_observer;
#[cfg(unix)]
mod desktop_state;
mod editing;
mod feedback;
mod files;
mod harness;
mod local_session;
mod native_app_input;
mod native_image_context;
mod observer;
mod review;
mod runtime;
mod shared_host;
mod store;
mod terminal;
mod user_text;
mod workbuddy;

use anyhow::{Context, Result};
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, State},
    http::{HeaderValue, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use clap::{CommandFactory, FromArgMatches, Parser};
use remote_agent_sdk::{AgentPlugin, PluginManifest};
use serde_json::json;
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};
use store::{Session, Store};
use subtle::ConstantTimeEq;
use tokio::sync::{Mutex, Notify};
use tower_http::{
    cors::CorsLayer,
    services::{ServeDir, ServeFile},
    trace::TraceLayer,
};

#[derive(Parser, Debug)]
#[command(name = "anywork", version, about = "AnyWork — your agents, anywhere")]
struct Args {
    #[arg(long, env = "ANYWORK_CODEX_DISCOVERY", default_value_t = true, action = clap::ArgAction::Set)]
    codex_discovery: bool,
    /// Native dsh data home for passive persisted history, including custom hosts.
    #[arg(long, env = "ANYWORK_HARNESS_HISTORY_ROOT")]
    harness_history_root: Option<PathBuf>,
    /// Existing local Harness launch URL (with token); never starts another engine.
    #[arg(long, env = "ANYWORK_HARNESS_URL")]
    harness_url: Option<String>,
    #[arg(long, env = "ANYWORK_HARNESS_TOKEN_FILE")]
    harness_token_file: Option<PathBuf>,
    #[arg(long, env = "ANYWORK_HARNESS_DISCOVERY_FILE")]
    harness_discovery_file: Option<PathBuf>,
    #[arg(long, env = "ANYWORK_WORKBUDDY_DISCOVERY_FILE")]
    workbuddy_discovery_file: Option<PathBuf>,
    /// Discover every local Codex project, or restrict history to --workspace.
    #[arg(
        long,
        env = "ANYWORK_CODEX_SCOPE",
        value_enum,
        default_value = "workspace"
    )]
    codex_scope: CodexScope,
    /// Discover built-in Agent history across projects, or restrict it to --workspace.
    #[arg(
        long,
        env = "ANYWORK_AGENT_SCOPE",
        value_enum,
        default_value = "workspace"
    )]
    agent_scope: CodexScope,
    /// Existing desktop owner/follower socket; overrides desktop-host.json.
    #[arg(long, env = "ANYWORK_DESKTOP_IPC_SOCKET")]
    desktop_ipc_socket: Option<PathBuf>,
    #[arg(long, env = "ANYWORK_BIND", default_value = "127.0.0.1:3210")]
    bind: String,
    /// Accept Cloudflare client IP only from a loopback proxy.
    #[arg(long, default_value_t = false)]
    trust_local_proxy: bool,
    #[arg(long, env = "ANYWORK_WORKSPACE", default_value = ".")]
    workspace: PathBuf,
    #[arg(long, env = "ANYWORK_DATA", default_value = ".anywork")]
    data_dir: PathBuf,
    #[arg(long, env = "ANYWORK_WEB", default_value = "web/dist")]
    web_dir: PathBuf,
    #[arg(long, env = "ANYWORK_PLUGINS", default_value = "plugins")]
    plugins_dir: PathBuf,
    #[arg(long, env = "ANYWORK_TOKEN")]
    token: Option<String>,
    #[arg(
        long,
        env = "ANYWORK_ORIGINS",
        value_delimiter = ',',
        default_value = "http://localhost:5173,http://127.0.0.1:5173,https://appassets.androidplatform.net"
    )]
    origins: Vec<String>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, clap::ValueEnum)]
enum CodexScope {
    Workspace,
    All,
}
impl Args {
    fn parse_compatible() -> Self {
        let mut command = Self::command();
        for (argument, current, legacy) in [
            (
                "codex_discovery",
                "ANYWORK_CODEX_DISCOVERY",
                "REMOTE_AGENT_CODEX_DISCOVERY",
            ),
            ("bind", "ANYWORK_BIND", "REMOTE_AGENT_BIND"),
            ("workspace", "ANYWORK_WORKSPACE", "REMOTE_AGENT_WORKSPACE"),
            ("data_dir", "ANYWORK_DATA", "REMOTE_AGENT_DATA"),
            ("web_dir", "ANYWORK_WEB", "REMOTE_AGENT_WEB"),
            ("plugins_dir", "ANYWORK_PLUGINS", "REMOTE_AGENT_PLUGINS"),
            ("token", "ANYWORK_TOKEN", "REMOTE_AGENT_TOKEN"),
            ("origins", "ANYWORK_ORIGINS", "REMOTE_AGENT_ORIGINS"),
        ] {
            if std::env::var_os(current).is_none() && std::env::var_os(legacy).is_some() {
                command = command.mut_arg(argument, |arg| arg.env(legacy));
            }
        }
        // Reuse the existing database, credentials and uploads without moving user data.
        if !std::path::Path::new(".anywork").exists()
            && std::path::Path::new(".remote-agent").is_dir()
        {
            command = command.mut_arg("data_dir", |arg| arg.default_value(".remote-agent"));
        }
        let matches = command.get_matches();
        Self::from_arg_matches(&matches).unwrap_or_else(|error| error.exit())
    }
}
pub struct App {
    catalog: Mutex<catalog::Catalog>,
    harness: Option<harness::Config>,
    harness_history_root: Option<PathBuf>,
    harness_sync: Mutex<Option<std::time::Instant>>,
    workbuddy: workbuddy::Config,
    workbuddy_sync: Mutex<Option<std::time::Instant>>,
    codex_discovery: bool,
    codex_scope: CodexScope,
    agent_scope: CodexScope,
    #[cfg(unix)]
    desktop_ipc_socket: Option<PathBuf>,
    #[cfg(unix)]
    desktop_statuses: Mutex<desktop_observer::Statuses>,
    store: Store,
    workspace: PathBuf,
    data_dir: PathBuf,
    token: String,
    local_browser: local_session::BrowserSessions,
    clients: clients::Clients,
    trust_local_proxy: bool,
    plugins: HashMap<String, PluginManifest>,
    runtimes: Mutex<HashMap<String, Arc<runtime::Runtime>>>,
    gates: Mutex<HashMap<String, Arc<Mutex<()>>>>,
    changed: Notify,
    origins: Vec<String>,
    stopping: AtomicBool,
    shutdown: Notify,
    stop_requested: Notify,
}
impl App {
    fn session(&self, id: &str) -> Result<Session> {
        let s = self.store.session(id)?;
        if s.external {
            self.session_in_scope(&s.cwd, &s.agent)?;
        } else {
            self.session_directory(&s.cwd, false)?;
        }
        Ok(s)
    }
    fn history_all(&self, agent: &str) -> bool {
        (agent == "codex" && self.codex_scope == CodexScope::All)
            || (matches!(agent, "codex" | "deepseek-harness" | "workbuddy")
                && self.agent_scope == CodexScope::All)
    }
    fn session_in_scope(&self, cwd: &str, agent: &str) -> Result<PathBuf> {
        self.scoped_directory(cwd, self.history_all(agent))
    }
    fn session_directory(&self, cwd: &str, external: bool) -> Result<PathBuf> {
        self.scoped_directory(cwd, external && self.history_all("codex"))
    }
    fn scoped_directory(&self, cwd: &str, all: bool) -> Result<PathBuf> {
        let path = if all {
            let path = PathBuf::from(cwd);
            anyhow::ensure!(path.is_absolute(), "Invalid Agent working directory");
            match path.canonicalize() {
                Ok(path) => path,
                // A removed worktree must not hide its conversation history.
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(path),
                Err(error) => return Err(error.into()),
            }
        } else {
            files::within(&self.workspace, &PathBuf::from(cwd))?
        };
        anyhow::ensure!(path.is_dir(), "Workspace must be a directory");
        Ok(path)
    }
    fn authorized(&self, token: &str) -> bool {
        self.token.as_bytes().ct_eq(token.as_bytes()).into()
    }
}
pub struct ApiError(anyhow::Error);
impl<E> From<E> for ApiError
where
    E: Into<anyhow::Error>,
{
    fn from(e: E) -> Self {
        Self(e.into())
    }
}
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let message = self.0.to_string();
        let status = if message.contains("not found") {
            StatusCode::NOT_FOUND
        } else if message.contains("outside") {
            StatusCode::FORBIDDEN
        } else if message.contains("busy") || message.contains("pending") {
            StatusCode::CONFLICT
        } else {
            StatusCode::BAD_REQUEST
        };
        (status, Json(json!({"error":message}))).into_response()
    }
}
async fn auth(State(app): State<Arc<App>>, req: axum::extract::Request, next: Next) -> Response {
    let bearer = req.headers().get("authorization");
    let bearer_ok = bearer
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .is_some_and(|token| app.authorized(token));
    let control =
        req.uri().path().starts_with("/service/") || req.uri().path().starts_with("/api/service/");
    let peer = req
        .extensions()
        .get::<axum::extract::ConnectInfo<std::net::SocketAddr>>()
        .map(|v| v.0);
    let cookie_ok = bearer.is_none()
        && !control
        && peer.is_some_and(|peer| {
            app.local_browser
                .authorize(peer, req.headers(), false)
                .is_some()
        });
    if !bearer_ok && !cookie_ok {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"error":"LOCAL_SESSION_OR_BEARER_REQUIRED"})),
        )
            .into_response();
    }
    if app.stopping.load(Ordering::Relaxed) {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error":"Service is stopping"})),
        )
            .into_response();
    }
    if let Some(peer) = req
        .extensions()
        .get::<axum::extract::ConnectInfo<std::net::SocketAddr>>()
    {
        app.clients
            .record(req.headers(), peer.0, app.trust_local_proxy);
    }
    next.run(req).await
}
#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "anywork=info,tower_http=info".into()),
        )
        .init();
    let args = Args::parse_compatible();
    let workspace = args
        .workspace
        .canonicalize()
        .context("Workspace directory does not exist")?;
    std::fs::create_dir_all(&args.data_dir)?;
    let data_dir = args.data_dir.canonicalize()?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&data_dir, std::fs::Permissions::from_mode(0o700))?;
    }
    let token_path = data_dir.join("access-token");
    let token = match args.token {
        Some(t) => t,
        None => match std::fs::read_to_string(&token_path) {
            Ok(t) => t.trim().into(),
            Err(_) => {
                let t = format!(
                    "{}{}",
                    uuid::Uuid::new_v4().simple(),
                    uuid::Uuid::new_v4().simple()
                );
                use std::io::Write;
                let mut options = std::fs::OpenOptions::new();
                options.write(true).create_new(true);
                #[cfg(unix)]
                {
                    use std::os::unix::fs::OpenOptionsExt;
                    options.mode(0o600);
                }
                let mut f = options.open(&token_path)?;
                f.write_all(t.as_bytes())?;
                t
            }
        },
    };
    anyhow::ensure!(
        token.len() >= 16,
        "Access token must contain at least 16 characters"
    );
    let harness = harness::Config::configured(
        args.harness_url.as_deref(),
        args.harness_token_file.clone(),
        args.harness_discovery_file.clone(),
    )?;
    let workbuddy = workbuddy::Config::configured(args.workbuddy_discovery_file)?;
    let mut plugins = HashMap::new();
    let manifest = workbuddy.manifest();
    plugins.insert(manifest.id.clone(), manifest);
    let manifest = harness::Config::manifest();
    plugins.insert(manifest.id.clone(), manifest);
    let codex = remote_agent_codex::CodexPlugin.manifest();
    plugins.insert(codex.id.clone(), codex);
    if args.plugins_dir.exists() {
        for file in std::fs::read_dir(&args.plugins_dir)? {
            let path = file?.path();
            if path.extension().is_some_and(|e| e == "json") {
                let manifest: PluginManifest = serde_json::from_slice(&std::fs::read(&path)?)
                    .with_context(|| format!("Invalid plugin {}", path.display()))?;
                anyhow::ensure!(
                    manifest.protocol_version == 1,
                    "Unsupported plugin version: {}",
                    manifest.id
                );
                anyhow::ensure!(
                    !manifest.id.is_empty() && !plugins.contains_key(&manifest.id),
                    "Duplicate or empty plugin id"
                );
                plugins.insert(manifest.id.clone(), manifest);
            }
        }
    }
    let listener = tokio::net::TcpListener::bind(&args.bind).await?;
    let local_port = listener.local_addr()?.port();
    let app = Arc::new(App {
        catalog: Mutex::new(catalog::Catalog::default()),
        harness,
        harness_history_root: args.harness_history_root,
        harness_sync: Mutex::new(None),
        workbuddy,
        workbuddy_sync: Mutex::new(None),
        codex_discovery: args.codex_discovery,
        codex_scope: args.codex_scope,
        agent_scope: args.agent_scope,
        #[cfg(unix)]
        desktop_ipc_socket: desktop::configured(&data_dir, args.desktop_ipc_socket)?,
        #[cfg(unix)]
        desktop_statuses: Default::default(),
        store: Store::open(&data_dir.join("remote-agent.sqlite"))?,
        workspace,
        data_dir,
        token,
        local_browser: local_session::BrowserSessions::new(local_port),
        clients: Default::default(),
        trust_local_proxy: args.trust_local_proxy,
        plugins,
        runtimes: Mutex::new(HashMap::new()),
        gates: Mutex::new(HashMap::new()),
        changed: Notify::new(),
        stopping: AtomicBool::new(false),
        shutdown: Notify::new(),
        stop_requested: Notify::new(),
        origins: args.origins.clone(),
    });
    api::start_queue_worker(app.clone());
    #[cfg(unix)]
    desktop_observer::start(&app);
    let api = Router::new()
        .route("/info", get(api::info))
        .route("/update-readiness", get(api::update_readiness))
        .route("/service/stop", post(api::stop_service))
        .route(
            "/service/browser-ticket",
            post(local_session::ticket).layer(DefaultBodyLimit::max(1024)),
        )
        .route("/clients", get(clients::list))
        .route("/clients/heartbeat", post(clients::heartbeat))
        .route("/plugins", get(api::plugins))
        .route("/workspaces", get(catalog::workspaces))
        .route("/sessions", get(api::sessions).post(api::create))
        .route("/events", get(api::all_events))
        .route("/events/poll", get(api::poll_all_events))
        .route(
            "/sessions/{id}",
            get(api::session).patch(api::update).delete(api::remove),
        )
        .route("/sessions/{id}/messages", post(api::message))
        .route("/sessions/{id}/capabilities", get(capabilities::read))
        .route("/sessions/{id}/edit", get(editing::get).post(editing::post))
        .route(
            "/sessions/{id}/edit/{operation_id}",
            axum::routing::delete(editing::cancel),
        )
        .route(
            "/sessions/{id}/queue",
            get(api::queue_get).post(api::queue_action),
        )
        .route("/sessions/{id}/history", get(catalog::read_history))
        .route("/sessions/{id}/history/item", get(catalog::history_item))
        .route("/sessions/{id}/fork", post(catalog::fork))
        .route("/sessions/{id}/interrupt", post(api::interrupt))
        .route("/sessions/{id}/connect", post(api::connect))
        .route("/sessions/{id}/respond", post(api::respond))
        .route("/sessions/{id}/events", get(api::events))
        .route("/sessions/{id}/events/poll", get(api::poll_events))
        .route("/sessions/{id}/export", get(api::export))
        .route("/sessions/{id}/models", get(api::models))
        .route("/sessions/{id}/feedback", get(feedback::list))
        .route(
            "/sessions/{id}/feedback/{message_id}",
            get(feedback::read)
                .put(feedback::write)
                .delete(feedback::delete)
                .layer(DefaultBodyLimit::max(64 * 1024)),
        )
        .route(
            "/sessions/{id}/composer",
            get(composer::read).post(composer::update),
        )
        .route("/sessions/{id}/files", get(files::list).put(files::write))
        .route("/sessions/{id}/uploads", post(files::upload))
        .route("/sessions/{id}/image", get(files::image))
        .route("/sessions/{id}/document", get(files::document))
        .route("/sessions/{id}/git", get(files::git))
        .route("/sessions/{id}/review", get(review::read))
        .route("/sessions/{id}/review/commits", get(review::commits))
        .layer(middleware::from_fn_with_state(app.clone(), auth));
    let origins = args
        .origins
        .iter()
        .map(|s| s.parse::<HeaderValue>())
        .collect::<std::result::Result<Vec<_>, _>>()?;
    let cors = CorsLayer::new()
        .allow_origin(origins)
        .allow_methods([
            axum::http::Method::GET,
            axum::http::Method::POST,
            axum::http::Method::PATCH,
            axum::http::Method::PUT,
            axum::http::Method::DELETE,
        ])
        .allow_headers([
            axum::http::header::AUTHORIZATION,
            axum::http::header::CONTENT_TYPE,
            axum::http::HeaderName::from_static("x-anywork-client-id"),
        ]);
    let router = Router::new()
        .nest("/api", api)
        .route(
            "/api/health",
            get(|| async { Json(json!({"status":"ok","version":env!("CARGO_PKG_VERSION")})) }),
        )
        .route(
            "/api/local/session",
            post(local_session::create)
                .get(local_session::read)
                .delete(local_session::delete)
                .layer(DefaultBodyLimit::max(1024)),
        )
        .route("/ws/terminal/{id}", get(terminal::upgrade))
        .route_service("/source", ServeFile::new("artifacts/anywork-source.tar.gz"))
        .fallback_service(
            ServeDir::new(&args.web_dir)
                .not_found_service(ServeFile::new(args.web_dir.join("index.html"))),
        )
        .layer(DefaultBodyLimit::max(22 * 1024 * 1024))
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(app.clone());
    tracing::info!(
        "AnyWork listening at http://{}; access token file: {}",
        listener.local_addr()?,
        token_path.display()
    );
    let shutdown_app = app.clone();
    axum::serve(
        listener,
        router.into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .with_graceful_shutdown(async move {
        #[cfg(unix)]
        {
            let mut terminate =
                tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                    .expect("signal handler");
            tokio::select! {_=tokio::signal::ctrl_c()=>{},_=terminate.recv()=>{},_=shutdown_app.stop_requested.notified()=>{}}
        }
        #[cfg(not(unix))]
        {
            tokio::select! {_=tokio::signal::ctrl_c()=>{},_=shutdown_app.stop_requested.notified()=>{}}
        }
        shutdown_app.stopping.store(true, Ordering::Relaxed);
        shutdown_app.shutdown.notify_waiters();
        shutdown_app.changed.notify_waiters();
        for rt in shutdown_app.runtimes.lock().await.values() {
            rt.rpc.close().await;
        }
    })
    .await?;
    for rt in app.runtimes.lock().await.values() {
        rt.rpc.close().await;
    }
    app.catalog.lock().await.close().await;
    Ok(())
}
