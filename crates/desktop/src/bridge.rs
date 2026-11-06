//! Local Tauri IPC only. Service processes and credentials remain in Rust.
use crate::{
    config::{self, Config, RouteKind},
    manager::{Command, Handle, Phase, Snapshot},
};
use serde::{Deserialize, Serialize};
use tauri::State;
#[derive(Clone)]
pub struct DesktopState {
    pub handle: Handle,
    pub preview: Option<String>,
}
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Action {
    Welcome,
    SaveService {
        config: Config,
        token: String,
    },
    SavePrograms {
        config: Config,
    },
    SaveRoute {
        kind: RouteKind,
        config: Config,
        secret: String,
    },
    Authenticate {
        token: String,
    },
    StartServer {
        config: Config,
        token: String,
    },
    StopServer,
    StartRoute {
        kind: RouteKind,
        config: Config,
        secret: String,
    },
    StopRoute {
        kind: RouteKind,
    },
}
#[tauri::command]
pub fn desktop_snapshot(state: State<'_, DesktopState>) -> Snapshot {
    state.handle.snapshot()
}
#[tauri::command]
pub fn desktop_preview(state: State<'_, DesktopState>) -> Option<String> {
    if state.preview.is_some() {
        eprintln!("AnyWork: preview frontend connected to Rust/Tauri IPC");
    }
    state.preview.clone()
}
#[tauri::command]
pub fn desktop_cloudflared_status(
    state: State<'_, DesktopState>,
) -> crate::cloudflared::Availability {
    crate::cloudflared::availability(
        &state.handle.snapshot().config.cloudflared_binary,
        &config::support_dir(),
        &config::resources_dir(),
    )
}
#[tauri::command]
pub async fn desktop_install_cloudflared(state: State<'_, DesktopState>) -> Result<String, String> {
    if state.preview.is_some() {
        return Err("界面预览不会下载或安装程序。".into());
    }
    let path = crate::cloudflared::install(&config::support_dir())
        .await
        .map_err(|e| format!("{e:#}"))?;
    state.handle.use_cloudflared(path.clone()).await?;
    Ok(path.display().to_string())
}
#[tauri::command]
pub fn desktop_action(state: State<'_, DesktopState>, action: Action) -> Result<(), String> {
    if state.preview.is_some() {
        return Err("界面预览不会修改配置或启动服务。".into());
    }
    let command = match action {
        Action::Welcome => Command::Welcome,
        Action::SaveService { config, token } => Command::SaveService(config, token),
        Action::SavePrograms { config } => Command::SavePrograms(config),
        Action::SaveRoute {
            kind,
            config,
            secret,
        } => Command::SaveRoute(kind, config, secret),
        Action::Authenticate { token } => Command::Authenticate(token),
        Action::StartServer { config, token } => Command::StartServer(config, token),
        Action::StopServer => Command::StopServer,
        Action::StartRoute {
            kind,
            config,
            secret,
        } => Command::StartRoute(kind, config, secret),
        Action::StopRoute { kind } => Command::StopRoute(kind),
    };
    state.handle.send(command);
    Ok(())
}
#[tauri::command]
pub async fn desktop_copy(value: String) -> Result<(), String> {
    if value.len() > 65536 {
        return Err("复制内容过长。".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        arboard::Clipboard::new()
            .and_then(|mut c| c.set_text(value))
            .map_err(|_| "无法访问系统剪贴板。".into())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn desktop_generate_token() -> String {
    config::generate_token()
}
#[tauri::command]
pub async fn desktop_pick(folder: bool) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let d = rfd::FileDialog::new();
        if folder {
            d.pick_folder()
        } else {
            d.pick_file()
        }
        .map(|p| p.display().to_string())
    })
    .await
    .map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn desktop_read_key() -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = rfd::FileDialog::new()
            .set_title("选择服务数据目录中的 access-token 文件")
            .pick_file()
        else {
            return Ok(None);
        };
        if std::fs::metadata(&path).map_err(|e| e.to_string())?.len() > 4096 {
            return Err("访问密钥文件过大。".into());
        }
        let token = std::fs::read_to_string(path).map_err(|_| "无法读取密钥文件。")?;
        let token = token.trim();
        config::validate_token(token).map_err(|e| e.to_string())?;
        Ok(Some(token.into()))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn desktop_lan(port: u16) -> Option<String> {
    crate::manager::primary_lan_address(port)
}
fn active_url(s: &Snapshot, kind: Option<RouteKind>) -> Result<String, String> {
    if let Some(kind) = kind {
        let route = &s.routes[kind.index()];
        if route.phase == Phase::Running && !route.url.is_empty() {
            return Ok(route.url.clone());
        }
    } else if s.authorized {
        return Ok(s.config.local_url());
    }
    Err("请先连接本地服务并开启所选连接。".into())
}
#[tauri::command]
pub fn desktop_open(state: State<'_, DesktopState>, kind: Option<RouteKind>) -> Result<(), String> {
    let url = active_url(&state.handle.snapshot(), kind)?;
    open::that_detached(url).map_err(|_| "无法打开默认浏览器。".into())
}
#[derive(Serialize)]
pub struct Pairing {
    link: String,
    svg: String,
    url: String,
}
#[tauri::command]
pub fn desktop_pairing(state: State<'_, DesktopState>, kind: RouteKind) -> Result<Pairing, String> {
    let s = state.handle.snapshot();
    let url = active_url(&s, Some(kind))?;
    let link = config::pairing_link(
        &url,
        &s.token,
        if kind == RouteKind::Relay {
            "wireguard-relay"
        } else {
            "https"
        },
    );
    let code =
        qrcode::QrCode::new(link.as_bytes()).map_err(|_| "配对链接过长，请缩短访问密钥。")?;
    let width = code.width();
    let dim = width + 8;
    let mut svg = format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 {dim} {dim}\" shape-rendering=\"crispEdges\"><rect width=\"{dim}\" height=\"{dim}\" fill=\"white\"/><path fill=\"black\" d=\""
    );
    for y in 0..width {
        for x in 0..width {
            if code[(x, y)] == qrcode::Color::Dark {
                svg.push_str(&format!("M{} {}h1v1h-1z", x + 4, y + 4));
            }
        }
    }
    svg.push_str("\"/></svg>");
    Ok(Pairing { link, svg, url })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cannot_open_unverified_or_failed_addresses() {
        let mut s = Snapshot::new(Config::default(), String::new());
        assert!(active_url(&s, None).is_err());
        s.routes[0].url = "https://example.com".into();
        s.routes[0].phase = Phase::Validating;
        assert!(active_url(&s, Some(RouteKind::Quick)).is_err());
        s.routes[0].phase = Phase::Running;
        assert_eq!(
            active_url(&s, Some(RouteKind::Quick)).unwrap(),
            "https://example.com"
        );
    }
}
