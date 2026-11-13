//! Bounded Android system operations. Only explicit commands are granted to main.
use serde::{Deserialize, Serialize};
#[cfg(target_os = "android")]
use tauri::Manager;
use tauri::{
    AppHandle, Runtime,
    plugin::{Builder, TauriPlugin},
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemError {
    pub code: String,
}
impl From<&str> for SystemError {
    fn from(code: &str) -> Self {
        Self { code: code.into() }
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExportBegin {
    name: String,
    mime: String,
    expected_bytes: u64,
    purpose: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExportWrite {
    handle: String,
    sequence: u64,
    base64: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExportHandle {
    handle: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExternalRequest {
    url: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackState {
    can_go_back: bool,
    blocking: bool,
    handled_event_id: Option<u64>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Appearance {
    dark: bool,
}

#[cfg(target_os = "android")]
struct Native<R: Runtime>(tauri::plugin::PluginHandle<R>);

async fn call<R: Runtime, T: Serialize>(
    app: &AppHandle<R>,
    command: &str,
    request: T,
) -> Result<serde_json::Value, SystemError> {
    #[cfg(target_os = "android")]
    {
        app.state::<Native<R>>()
            .0
            .run_mobile_plugin_async(command, request)
            .await
            .map_err(|error| SystemError {
                code: match error {
                    tauri::plugin::mobile::PluginInvokeError::InvokeRejected(e) => {
                        e.code.unwrap_or_else(|| "SYSTEM_FAILED".into())
                    }
                    _ => "SYSTEM_UNAVAILABLE".into(),
                },
            })
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, command, request);
        Err("SYSTEM_UNAVAILABLE".into())
    }
}

/// Called after account lifetime cancellation. It never restores account state.
pub async fn abort_all<R: Runtime>(app: &AppHandle<R>) -> Result<(), SystemError> {
    call(app, "abortAll", serde_json::json!({}))
        .await
        .map(|_| ())
}

macro_rules! forward {
    ($name:ident, $native:literal, $request:ty) => {
        #[tauri::command]
        async fn $name<R: Runtime>(
            app: AppHandle<R>,
            request: $request,
        ) -> Result<serde_json::Value, SystemError> {
            call(&app, $native, request).await
        }
    };
}
forward!(export_begin, "exportBegin", ExportBegin);
forward!(export_write, "exportWrite", ExportWrite);
forward!(export_finish, "exportFinish", ExportHandle);
forward!(export_abort, "exportAbort", ExportHandle);
forward!(back_set_state, "backSetState", BackState);
forward!(appearance_set, "appearanceSet", Appearance);
#[tauri::command]
async fn open_external<R: Runtime>(
    app: AppHandle<R>,
    request: ExternalRequest,
) -> Result<serde_json::Value, SystemError> {
    let url = url::Url::parse(&request.url).map_err(|_| SystemError::from("INVALID_REQUEST"))?;
    if url.scheme() != "https" || url.host_str().is_none() || !url.username().is_empty() {
        return Err("INVALID_REQUEST".into());
    }
    call(&app, "openExternal", request).await
}
#[tauri::command]
async fn insets_get<R: Runtime>(app: AppHandle<R>) -> Result<serde_json::Value, SystemError> {
    call(&app, "insetsGet", serde_json::json!({})).await
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("mobile-system")
        .invoke_handler(tauri::generate_handler![
            export_begin,
            export_write,
            export_finish,
            export_abort,
            open_external,
            back_set_state,
            appearance_set,
            insets_get
        ])
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            {
                use tauri::{
                    Emitter,
                    ipc::{Channel, InvokeResponseBody},
                };
                let native = api
                    .register_android_plugin("dev.remoteagent.app.system", "MobileSystemPlugin")?;
                app.manage(Native(native.clone()));
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    let event_app = app.clone();
                    let channel = Channel::<serde_json::Value>::new(move |body| {
                        if let InvokeResponseBody::Json(json) = body {
                            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&json) {
                                if let Some(event) = value["event"].as_str() {
                                    if matches!(
                                        event,
                                        "mobile-system-back"
                                            | "mobile-system-insets"
                                            | "mobile-system-lifecycle"
                                    ) {
                                        event_app.emit(event, &value["payload"])?;
                                    }
                                }
                            }
                        }
                        Ok(())
                    });
                    let _ = native
                        .run_mobile_plugin_async::<serde_json::Value>(
                            "subscribe",
                            serde_json::json!({"channel": channel}),
                        )
                        .await;
                });
            }
            #[cfg(not(target_os = "android"))]
            let _ = (app, api);
            Ok(())
        })
        .build()
}
