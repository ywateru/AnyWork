//! Upstream CyberGrid's current Unix-only credential module cannot be compiled
//! on Windows. Account-first Native startup is unavailable; CLI is independent.
use serde_json::{Value, json};
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};
#[derive(Clone)]
pub struct Handle {
    support: PathBuf,
    name: Arc<Mutex<String>>,
    read_only: bool,
}
impl Handle {
    pub fn new(
        support: PathBuf,
        _: crate::manager::Handle,
        read_only: bool,
    ) -> anyhow::Result<Self> {
        let name = crate::device_name::load_device_name(&support, read_only)?;
        Ok(Self {
            support,
            name: Arc::new(Mutex::new(name)),
            read_only,
        })
    }
    pub async fn disable(&self) {}
    pub fn portal_url(&self) -> String {
        "https://anywork.aixgg.com/app/".into()
    }
    fn snapshot(&self) -> Value {
        let name = self.name.lock().unwrap_or_else(|e| e.into_inner()).clone();
        json!({"authorizationStatus":"unsupported","transactionId":null,"signedIn":false,"subject":null,"accountLabel":null,"deviceName":name,"deviceNameSynced":false,"enabled":false,"busy":false,"error":unsupported(),"gridDeviceId":null,"installationId":null,"publicKey":null,"remoteClients":[],"accountPortalUrl":self.portal_url()})
    }
    fn rename_device(&self, name: &str, expected: &str) -> Result<Value, String> {
        if self.read_only {
            return Err("界面预览不会修改配置。".into());
        }
        let name = crate::device_name::normalized_device_name(name)
            .map_err(|_| "名称需为 1–80 个字符，且不能包含控制字符。".to_string())?;
        let mut current = self.name.lock().unwrap_or_else(|e| e.into_inner());
        if *current != expected {
            return Err("设备名称已变化，请重新编辑。".into());
        }
        crate::device_name::save_device_name(&self.support, &name)
            .map_err(|_| "无法保存设备名称。".to_string())?;
        *current = name;
        drop(current);
        Ok(self.snapshot())
    }
}
fn unsupported() -> String {
    "当前平台尚未提供原生账号登录，无法在桌面程序中准备工作区。可使用独立 CLI。".into()
}
#[cfg_attr(not(unix), tauri::command)]
pub async fn account_snapshot(state: tauri::State<'_, Handle>) -> Result<Value, String> {
    Ok(state.snapshot())
}
#[cfg_attr(not(unix), tauri::command)]
pub async fn account_rename_device(
    state: tauri::State<'_, Handle>,
    name: String,
    expected_name: String,
) -> Result<Value, String> {
    state.rename_device(&name, &expected_name)
}
#[cfg_attr(not(unix), tauri::command)]
pub async fn account_begin() -> Result<Value, String> {
    Err(unsupported())
}
#[cfg_attr(not(unix), tauri::command)]
pub async fn account_open(transaction_id: String, url: String) -> Result<(), String> {
    let _ = (transaction_id, url);
    Err(unsupported())
}
#[cfg_attr(not(unix), tauri::command)]
pub async fn account_fetch(transaction_id: String, request: Value) -> Result<Value, String> {
    let _ = (transaction_id, request);
    Err(unsupported())
}
#[cfg_attr(not(unix), tauri::command)]
pub async fn account_wait_callback(transaction_id: String) -> Result<String, String> {
    let _ = transaction_id;
    Err(unsupported())
}
#[cfg_attr(not(unix), tauri::command)]
pub async fn account_commit(transaction_id: String, tokens: Value) -> Result<String, String> {
    let _ = (transaction_id, tokens);
    Err(unsupported())
}
#[cfg_attr(not(unix), tauri::command)]
pub async fn account_cancel(transaction_id: String) -> Result<(), String> {
    let _ = transaction_id;
    Err(unsupported())
}
#[cfg_attr(not(unix), tauri::command)]
pub async fn account_enable() -> Result<(), String> {
    Err(unsupported())
}
#[cfg_attr(not(unix), tauri::command)]
pub async fn account_enable_default() -> Result<(), String> {
    Err(unsupported())
}
#[cfg_attr(not(unix), tauri::command)]
pub async fn account_disable() -> Result<(), String> {
    Ok(())
}
#[cfg_attr(not(unix), tauri::command)]
pub async fn account_logout() -> Result<(), String> {
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn snapshot_reports_unsupported_without_inventing_an_account_or_connections() {
        let dir = tempfile::tempdir().unwrap();
        let handle = Handle::new(
            dir.path().into(),
            crate::manager::Handle::preview(crate::manager::Snapshot::new(
                Default::default(),
                String::new(),
            )),
            false,
        )
        .unwrap();
        let snapshot = handle.snapshot();
        assert_eq!(snapshot["authorizationStatus"], "unsupported");
        assert_eq!(snapshot["signedIn"], false);
        assert_eq!(snapshot["remoteClients"], json!([]));
        assert_eq!(snapshot["accountPortalUrl"], handle.portal_url());
        let renamed = handle
            .rename_device("My PC", snapshot["deviceName"].as_str().unwrap())
            .unwrap();
        assert_eq!(renamed["deviceName"], "My PC");
        assert_eq!(renamed["deviceNameSynced"], false);
        assert!(account_begin().await.is_err());
        assert!(account_enable().await.is_err());
        assert!(account_enable_default().await.is_err());
    }
}
