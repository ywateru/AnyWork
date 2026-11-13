//! Android local-asset shell with native account, bounded transport and system IPC.
use serde::Deserialize;
use std::{collections::HashMap, sync::Arc};
use tauri::{
    AppHandle, Emitter, Listener, Manager, State,
    ipc::{Channel, JavaScriptChannelId},
};
use tokio::sync::{Mutex, mpsc};
use transport::*;

pub mod account;
pub mod transport;
type RouteKey = (String, u64, String);
type Routes = Arc<Mutex<HashMap<RouteKey, Channel<TransportEvent>>>>;

struct TransportBridge {
    service: TransportService,
    routes: Routes,
    events: mpsc::Sender<TransportEvent>,
}
fn route_key(operation: &OperationRef) -> RouteKey {
    (
        operation.connection.connection_id.clone(),
        operation.connection.generation,
        operation.operation_id.clone(),
    )
}
fn bridge_error(code: &'static str) -> TransportError {
    TransportError {
        code,
        delivery: Delivery::NotSent,
    }
}
impl TransportBridge {
    fn new(app: AppHandle) -> Self {
        let service = TransportService::new();
        let routes: Routes = Default::default();
        let (events, mut receive) = mpsc::channel::<TransportEvent>(64);
        let event_routes = routes.clone();
        let event_service = service.clone();
        tauri::async_runtime::spawn(async move {
            while let Some(event) = receive.recv().await {
                let operation = match &event {
                    TransportEvent::Closed { connection, code } => {
                        event_routes.lock().await.retain(|(id, generation, _), _| {
                            id != &connection.connection_id || generation != &connection.generation
                        });
                        let _ = app.emit_to(
                            "main",
                            "mobile-transport-closed",
                            serde_json::json!({"connection":connection,"code":code}),
                        );
                        continue;
                    }
                    TransportEvent::PtyReady { operation, .. }
                    | TransportEvent::PtyData { operation, .. }
                    | TransportEvent::PtyClosed { operation, .. } => operation,
                };
                let key = route_key(operation);
                let channel = {
                    let mut routes = event_routes.lock().await;
                    if matches!(event, TransportEvent::PtyClosed { .. }) {
                        routes.remove(&key)
                    } else {
                        routes.get(&key).cloned()
                    }
                };
                // Dropped/failed consumer cannot leave a terminal producing unbounded data.
                if channel.is_none_or(|channel| channel.send(event.clone()).is_err()) {
                    event_routes.lock().await.remove(&key);
                    event_service.close(operation.connection.clone()).await;
                }
            }
        });
        Self {
            service,
            routes,
            events,
        }
    }
    fn sink(&self) -> EventSink {
        let events = self.events.clone();
        Arc::new(move |event| events.try_send(event).is_ok())
    }
}
macro_rules! transport_command {
    ($name:ident, $method:ident, $request:ty, $response:ty) => {
        #[tauri::command]
        async fn $name(
            state: State<'_, TransportBridge>,
            request: $request,
        ) -> transport::Result<$response> {
            state.service.$method(request).await
        }
    };
}
transport_command!(mobile_transport_http_begin, http_begin, HttpBegin, ());
transport_command!(mobile_transport_http_write, http_write, HttpWrite, WriteAck);
transport_command!(
    mobile_transport_http_finish,
    http_finish,
    OperationRef,
    ResponseHead
);
transport_command!(
    mobile_transport_http_read,
    http_read,
    OperationRef,
    ResponseChunk
);
#[tauri::command]
async fn mobile_transport_cancel(
    state: State<'_, TransportBridge>,
    request: OperationRef,
) -> transport::Result<()> {
    let result = state.service.cancel(request.clone()).await;
    state.routes.lock().await.remove(&route_key(&request));
    result
}
#[tauri::command]
async fn mobile_transport_close(
    state: State<'_, TransportBridge>,
    request: ConnectionRef,
) -> transport::Result<CleanupState> {
    let result = state.service.close(request.clone()).await;
    state.routes.lock().await.retain(|(id, generation, _), _| {
        id != &request.connection_id || generation != &request.generation
    });
    Ok(result)
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PtyRequest {
    #[serde(flatten)]
    command: PtyCommand,
    on_event: Option<JavaScriptChannelId>,
}
#[tauri::command]
async fn mobile_transport_pty(
    webview: tauri::Webview,
    state: State<'_, TransportBridge>,
    request: PtyRequest,
) -> transport::Result<()> {
    let key = route_key(request.command.operation());
    let opening = matches!(request.command, PtyCommand::Open { .. });
    if opening {
        let channel = request
            .on_event
            .ok_or_else(|| bridge_error("INVALID_REQUEST"))?
            .channel_on(webview);
        let mut routes = state.routes.lock().await;
        if routes.contains_key(&key) {
            return Err(bridge_error("INVALID_REQUEST"));
        }
        if routes.len() >= 4 {
            return Err(bridge_error("LIMIT_EXCEEDED"));
        }
        routes.insert(key.clone(), channel);
    } else if request.on_event.is_some() {
        return Err(bridge_error("INVALID_REQUEST"));
    }
    let result = state.service.pty(request.command).await;
    if opening && result.is_err() {
        state.routes.lock().await.remove(&key);
    }
    result
}

pub const BUSINESS_ORIGIN: &str = "https://tauri.localhost";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ConnectRequest {
    device_ref: String,
    expected_epoch: u64,
    expected_revision: u64,
    key_confirmation: Option<String>,
}
fn account_connect_error(error: anyhow::Error) -> TransportError {
    let code = match error.to_string().as_str() {
        "CANCELLED" => "CANCELLED",
        "LOGIN_REQUIRED" => "LOGIN_REQUIRED",
        "DIRECTORY_CONFLICT" => "DIRECTORY_CONFLICT",
        "KEY_CONFIRMATION_REQUIRED" => "KEY_CONFIRMATION_REQUIRED",
        "TRUST_STORAGE_UNAVAILABLE" => "TRUST_STORAGE_UNAVAILABLE",
        "DEVICE_NOT_FOUND" | "DEVICE_NOT_READY" => "DEVICE_NOT_READY",
        "INVALID_REQUEST" => "INVALID_REQUEST",
        "SYSTEM_UNAVAILABLE" => "SYSTEM_UNAVAILABLE",
        _ => "DEVICE_NOT_READY",
    };
    bridge_error(code)
}
#[tauri::command]
async fn mobile_transport_connect(
    account: State<'_, account::Handle>,
    transport: State<'_, TransportBridge>,
    request: ConnectRequest,
) -> transport::Result<ConnectionInfo> {
    let prepared = account
        .prepare_target(
            &request.device_ref,
            request.expected_epoch,
            request.expected_revision,
            request.key_confirmation.as_deref(),
        )
        .await
        .map_err(account_connect_error)?;
    let cancel = prepared.target.lifetime.child_token();
    let connected = transport
        .service
        .connect(
            prepared.target,
            prepared.authorization,
            cancel,
            transport.sink(),
        )
        .await?;
    if let Err(error) = account.ensure_epoch(request.expected_epoch).await {
        transport.service.close(connected.connection.clone()).await;
        return Err(account_connect_error(error));
    }
    // Trust is committed only after authenticated Noise succeeds. A failed pin
    // or retired account must never leave a live connection behind.
    if let Err(error) = account.commit_trust(prepared.trust).await {
        transport.service.close(connected.connection.clone()).await;
        return Err(account_connect_error(error));
    }
    if let Err(error) = account.ensure_epoch(request.expected_epoch).await {
        transport.service.close(connected.connection.clone()).await;
        return Err(account_connect_error(error));
    }
    Ok(connected)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // reqwest enables aws-lc while the pinned SDK enables ring. Rustls cannot
    // infer a default when both are linked. Select one before any native I/O;
    // a repeated Android entry retains the already installed valid provider.
    let _ = rustls::crypto::ring::default_provider().install_default();
    tauri::Builder::default()
        .plugin(tauri_plugin_mobile_system::init())
        .plugin(tauri_plugin_mobile_auth::init())
        .plugin(
            tauri::plugin::Builder::<tauri::Wry>::new("local-navigation")
                .on_navigation(|_, url| url.origin().ascii_serialization() == BUSINESS_ORIGIN)
                .build(),
        )
        .setup(|app| {
            let bridge = TransportBridge::new(app.handle().clone());
            let account = account::Handle::new(app.handle().clone());
            let cleanup_app = app.handle().clone();
            let cleanup_service = bridge.service.clone();
            let cleanup_routes = bridge.routes.clone();
            account.set_retire_hook(Arc::new(move || {
                let app = cleanup_app.clone();
                let service = cleanup_service.clone();
                let routes = cleanup_routes.clone();
                tauri::async_runtime::spawn(async move {
                    routes.lock().await.clear();
                    let _ = tokio::join!(
                        service.close_all(),
                        tauri_plugin_mobile_system::abort_all(&app)
                    );
                });
            }));
            let foreground_account = account.clone();
            let foreground_service = bridge.service.clone();
            app.listen("mobile-system-lifecycle", move |event| {
                if serde_json::from_str::<serde_json::Value>(event.payload())
                    .ok()
                    .is_some_and(|payload| payload["foreground"] == true)
                {
                    let account = foreground_account.clone();
                    let service = foreground_service.clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = tokio::join!(account.refresh(), service.foreground_validate());
                    });
                }
            });
            app.manage(account);
            app.manage(bridge);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            account::mobile_account_snapshot,
            account::mobile_account_login,
            account::mobile_account_cancel,
            account::mobile_account_logout,
            account::mobile_account_refresh,
            account::mobile_account_device_update,
            mobile_transport_connect,
            mobile_transport_http_begin,
            mobile_transport_http_write,
            mobile_transport_http_finish,
            mobile_transport_http_read,
            mobile_transport_cancel,
            mobile_transport_close,
            mobile_transport_pty
        ])
        .run(tauri::generate_context!())
        .expect("run AnyWork mobile");
}
