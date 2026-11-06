#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]
use anywork_desktop::{
    bridge::{self, DesktopState},
    config,
    manager::{self, Phase, Snapshot},
    updates,
};
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use tauri::Manager;
fn main() {
    if let Err(error) = run() {
        eprintln!("AnyWork: {error:#}");
        rfd::MessageDialog::new()
            .set_title("AnyWork")
            .set_description(format!("{error:#}"))
            .set_level(rfd::MessageLevel::Error)
            .show();
    }
}
fn run() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let preview = args
        .iter()
        .position(|s| s == "--preview")
        .and_then(|i| args.get(i + 1))
        .cloned();
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .worker_threads(3)
        .build()?;
    let _enter = runtime.enter();
    tauri::async_runtime::set(runtime.handle().clone());
    let context = tauri::generate_context!();
    let mut options = manager::Options::default();
    if std::env::var_os("ANYWORK_RESOURCES").is_none()
        && let Ok(resources) =
            tauri::utils::platform::resource_dir(context.package_info(), &Default::default())
        && resources.join("bin").is_dir()
    {
        options.resources = resources;
    }
    let updater = updates::Handle::new(&options.support, updates::supported(preview.is_some()));
    let update_service = preview.is_none();
    let _lock = if preview.is_none() {
        Some(manager::manager_lock(&options.support)?)
    } else {
        None
    };
    let handle = if preview.is_some() {
        let mut s = Snapshot::new(
            config::Config {
                workspace: "~/Workspace".into(),
                ..Default::default()
            },
            "preview-access-key-00000000000000".into(),
        );
        s.service = Phase::Running;
        s.authorized = true;
        s.external = true;
        s.secrets_loaded = true;
        manager::Handle::preview(s)
    } else {
        manager::start(options)?
    };
    let quitting = Arc::new(AtomicBool::new(false));
    let finished = Arc::new(AtomicBool::new(false));
    let finished_event = finished.clone();
    let quit_handle = handle.clone();
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(updater.clone())
        .manage(DesktopState {
            handle: handle.clone(),
            preview,
        })
        .invoke_handler(tauri::generate_handler![
            bridge::desktop_snapshot,
            bridge::desktop_preview,
            bridge::desktop_cloudflared_status,
            bridge::desktop_install_cloudflared,
            bridge::desktop_action,
            bridge::desktop_copy,
            bridge::desktop_pick,
            bridge::desktop_read_key,
            bridge::desktop_generate_token,
            bridge::desktop_lan,
            bridge::desktop_open,
            bridge::desktop_pairing,
            updates::desktop_update_snapshot,
            updates::desktop_update_check,
            updates::desktop_update_preferences,
            updates::desktop_update_defer,
            updates::desktop_update_install,
            updates::desktop_update_open_releases
        ])
        .setup(move |app| {
            if update_service {
                updater.start(
                    app.handle().clone(),
                    app.state::<DesktopState>().handle.clone(),
                );
            }
            if args.iter().any(|a| a == "--minimum-size")
                && let Some(window) = app.get_webview_window("main")
            {
                window.set_size(tauri::LogicalSize::new(800.0, 620.0))?;
            }
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                #[cfg(unix)]
                {
                    if let Ok(mut sigterm) =
                        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                    {
                        tokio::select! {_=tokio::signal::ctrl_c()=>(),_=sigterm.recv()=>()}
                    } else {
                        let _ = tokio::signal::ctrl_c().await;
                    }
                }
                #[cfg(not(unix))]
                {
                    let _ = tokio::signal::ctrl_c().await;
                }
                app_handle.exit(0);
            });
            Ok(())
        })
        .build(context)?;
    app.run(move |app, event| {
        if let tauri::RunEvent::ExitRequested { api, .. } = event
            && !finished_event.load(Ordering::SeqCst)
        {
            api.prevent_exit();
            if !quitting.swap(true, Ordering::SeqCst) {
                let handle = quit_handle.clone();
                let app = app.clone();
                let finished = finished_event.clone();
                tauri::async_runtime::spawn(async move {
                    handle.shutdown().await;
                    finished.store(true, Ordering::SeqCst);
                    app.exit(0);
                });
            }
        }
    });
    runtime.block_on(handle.shutdown());
    runtime.shutdown_timeout(std::time::Duration::from_secs(2));
    Ok(())
}
