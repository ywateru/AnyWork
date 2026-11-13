//! Android local-asset shell. Account and transport registration is integrated
//! only after their real modules are available; no substitute command handlers.

pub const BUSINESS_ORIGIN: &str = "https://tauri.localhost";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_mobile_system::init())
        .plugin(tauri::plugin::Builder::<tauri::Wry>::new("local-navigation")
            .on_navigation(|_, url| url.origin().ascii_serialization() == BUSINESS_ORIGIN)
            .build())
        .run(tauri::generate_context!())
        .expect("run AnyWork mobile");
}
