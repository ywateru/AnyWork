//! Local desktop IPC. Retired route actions and credential export are intentionally absent.
use crate::{
    config::Config,
    manager::{BrowserContext, Command, Handle, Snapshot},
};
use serde::Deserialize;
use tauri::State;
#[derive(Clone)]
pub struct DesktopState {
    pub handle: Handle,
    pub preview: Option<String>,
}
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Action {
    SaveService { config: Config },
    SavePrograms { config: Config },
    StopServer,
}
#[tauri::command]
pub fn desktop_snapshot(state: State<'_, DesktopState>) -> Snapshot {
    state.handle.snapshot()
}
#[tauri::command]
pub fn desktop_preview(state: State<'_, DesktopState>) -> Option<String> {
    state.preview.clone()
}
#[tauri::command]
pub fn desktop_chrome() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos-overlay"
    } else {
        "standard"
    }
}
#[tauri::command]
pub fn desktop_drag(window: tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("WINDOW_REJECTED".into());
    }
    window.start_dragging().map_err(|_| "无法移动窗口。".into())
}
#[tauri::command]
pub fn desktop_action(
    state: State<'_, DesktopState>,
    updates: State<'_, crate::updates::Handle>,
    action: Action,
) -> Result<(), String> {
    if state.preview.is_some() {
        return Err("界面预览不会修改配置或启动服务。".into());
    }
    if updates.snapshot().phase == crate::updates::Phase::Installing {
        return Err("正在安装更新，请稍后重试。".into());
    }
    state.handle.send(match action {
        Action::SaveService { config } => Command::SaveService(config),
        Action::SavePrograms { config } => Command::SavePrograms(config),
        Action::StopServer => Command::StopServer,
    });
    Ok(())
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
    .map_err(|_| "无法打开文件选择器。".into())
}
#[tauri::command]
pub async fn desktop_start(
    state: State<'_, DesktopState>,
    accounts: State<'_, crate::accounts::Handle>,
    updates: State<'_, crate::updates::Handle>,
) -> Result<(), String> {
    check_workspace_action(&state, &updates)?;
    authorized_context(&accounts).await?;
    state.handle.prepare_workspace().await
}
fn check_workspace_action(
    state: &DesktopState,
    updates: &crate::updates::Handle,
) -> Result<(), String> {
    if state.preview.is_some() {
        return Err("界面预览不会启动服务或打开工作区。".into());
    }
    if updates.snapshot().phase == crate::updates::Phase::Installing {
        return Err("正在安装更新，请稍后重试。".into());
    }
    Ok(())
}
async fn authorized_context(accounts: &crate::accounts::Handle) -> Result<BrowserContext, String> {
    #[cfg(unix)]
    {
        let snapshot = accounts.snapshot().await;
        if !snapshot.signed_in
            || snapshot.authorization_status != crate::accounts::AuthorizationStatus::SignedIn
        {
            return Err("DESKTOP_SIGN_IN_REQUIRED".into());
        }
        Ok(local_context(&snapshot))
    }
    #[cfg(not(unix))]
    {
        let _ = accounts;
        Err("DESKTOP_ACCOUNT_UNSUPPORTED".into())
    }
}
#[tauri::command]
pub async fn desktop_open(
    state: State<'_, DesktopState>,
    accounts: State<'_, crate::accounts::Handle>,
    updates: State<'_, crate::updates::Handle>,
) -> Result<(), String> {
    check_workspace_action(&state, &updates)?;
    let context = authorized_context(&accounts).await?;
    let url = state.handle.open_workspace(context).await?;
    open::that_detached(url).map_err(|_| "无法打开默认浏览器，请重试。".into())
}
#[tauri::command]
pub fn desktop_account_portal(accounts: State<'_, crate::accounts::Handle>) -> Result<(), String> {
    open::that_detached(accounts.portal_url()).map_err(|_| "无法打开默认浏览器。".into())
}
#[tauri::command]
pub fn desktop_open_source() -> Result<(), String> {
    open::that_detached("https://github.com/ywateru/AnyWork")
        .map_err(|_| "无法打开默认浏览器，请访问 https://github.com/ywateru/AnyWork。".into())
}
#[cfg(unix)]
fn local_context(s: &crate::accounts::Snapshot) -> BrowserContext {
    let derived = s
        .subject
        .as_ref()
        .map(|subject| format!("账号 {}", subject.chars().take(12).collect::<String>()));
    BrowserContext {
        account_label: s
            .account_label
            .as_ref()
            .filter(|label| s.signed_in && Some(label.as_str()) != derived.as_deref())
            .map(|label| label.chars().take(80).collect()),
        installation_id: s.installation_id.clone(),
        remote_enabled: s.enabled,
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[cfg(unix)]
    fn local_context_does_not_export_subject_or_derived_labels() {
        let s = crate::accounts::Snapshot {
            signed_in: true,
            subject: Some("private-owner-id".into()),
            account_label: Some("账号 private-owne".into()),
            ..Default::default()
        };
        let context = local_context(&s);
        assert!(context.account_label.is_none());
        let s = crate::accounts::Snapshot {
            account_label: Some("界".repeat(160)),
            ..s
        };
        assert_eq!(local_context(&s).account_label.unwrap().chars().count(), 80);
    }
    #[test]
    fn retired_route_and_credential_commands_cannot_deserialize() {
        for ty in [
            "start_route",
            "stop_route",
            "save_route",
            "authenticate",
            "start_server",
            "welcome",
        ] {
            assert!(
                serde_json::from_value::<Action>(
                    serde_json::json!({"type":ty,"kind":"quick","token":"legacy","secret":"legacy"})
                )
                .is_err()
            );
        }
        let s = Snapshot::new(Config::default(), "never-export-local-bearer".into());
        let json = serde_json::to_string(&s).unwrap();
        assert!(!json.contains("never-export"));
        assert!(!json.contains("secrets"));
    }
}
