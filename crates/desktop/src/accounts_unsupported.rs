//! Upstream CyberGrid's current Unix-only credential module cannot be compiled
//! on Windows. Preserve the existing manager/manual transports and fail clearly.
use serde_json::{Value, json};
#[derive(Clone)]
pub struct Handle;
impl Handle {
    pub fn new(_: std::path::PathBuf, _: crate::manager::Handle, _: bool) -> anyhow::Result<Self> {
        Ok(Self)
    }
    pub async fn disable(&self) {}
}
fn unsupported() -> String {
    "当前平台尚未提供账号远程访问，请使用已有的高级连接方式。".into()
}
#[tauri::command]
pub async fn account_snapshot() -> Result<Value, String> {
    Ok(
        json!({"authorizationStatus":"unsupported","transactionId":null,"signedIn":false,"subject":null,"accountLabel":null,"enabled":false,"busy":false,"error":"当前平台尚未提供账号远程访问。","gridDeviceId":null,"installationId":null,"publicKey":null}),
    )
}
#[tauri::command]
pub async fn account_begin() -> Result<Value, String> {
    Err(unsupported())
}
#[tauri::command]
pub async fn account_open(transaction_id: String, url: String) -> Result<(), String> {
    let _ = (transaction_id, url);
    Err(unsupported())
}
#[tauri::command]
pub async fn account_fetch(transaction_id: String, request: Value) -> Result<Value, String> {
    let _ = (transaction_id, request);
    Err(unsupported())
}
#[tauri::command]
pub async fn account_wait_callback(transaction_id: String) -> Result<String, String> {
    let _ = transaction_id;
    Err(unsupported())
}
#[tauri::command]
pub async fn account_commit(transaction_id: String, tokens: Value) -> Result<String, String> {
    let _ = (transaction_id, tokens);
    Err(unsupported())
}
#[tauri::command]
pub async fn account_cancel(transaction_id: String) -> Result<(), String> {
    let _ = transaction_id;
    Err(unsupported())
}
#[tauri::command]
pub async fn account_enable() -> Result<(), String> {
    Err(unsupported())
}
#[tauri::command]
pub async fn account_disable() -> Result<(), String> {
    Ok(())
}
#[tauri::command]
pub async fn account_logout() -> Result<(), String> {
    Ok(())
}
