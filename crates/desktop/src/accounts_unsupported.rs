//! Upstream CyberGrid's current Unix-only credential module cannot be compiled
//! on Windows. Account-first Native startup is unavailable; CLI is independent.
use serde_json::{Value, json};
#[derive(Clone)]
pub struct Handle;
impl Handle {
    pub fn new(_: std::path::PathBuf, _: crate::manager::Handle, _: bool) -> anyhow::Result<Self> {
        Ok(Self)
    }
    pub async fn disable(&self) {}
    pub fn portal_url(&self) -> String {
        "https://anywork-tau.vercel.app/app/".into()
    }
}
fn unsupported() -> String {
    "当前平台尚未提供原生账号登录，无法在桌面程序中准备工作区。可使用独立 CLI。".into()
}
#[tauri::command]
pub async fn account_snapshot() -> Result<Value, String> {
    Ok(
        json!({"authorizationStatus":"unsupported","transactionId":null,"signedIn":false,"subject":null,"accountLabel":null,"enabled":false,"busy":false,"error":unsupported(),"gridDeviceId":null,"installationId":null,"publicKey":null,"remoteClients":[],"accountPortalUrl":"https://anywork-tau.vercel.app/app/"}),
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
pub async fn account_enable_default() -> Result<(), String> {
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
#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn snapshot_reports_unsupported_without_inventing_an_account_or_connections() {
        let snapshot = account_snapshot().await.unwrap();
        assert_eq!(snapshot["authorizationStatus"], "unsupported");
        assert_eq!(snapshot["signedIn"], false);
        assert_eq!(snapshot["remoteClients"], json!([]));
        assert_eq!(snapshot["accountPortalUrl"], Handle.portal_url());
        assert!(account_begin().await.is_err());
        assert!(account_enable().await.is_err());
        assert!(account_enable_default().await.is_err());
    }
}
