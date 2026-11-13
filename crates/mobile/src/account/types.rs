use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Phase {
    SignedOut,
    SigningIn,
    SignedIn,
    ReauthRequired,
}

#[derive(Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DirectoryState {
    Idle,
    Loading,
    Ready,
    Unknown,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub scope_id: String,
    pub label: String,
    pub email: Option<String>,
}

#[derive(Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    pub device_ref: String,
    pub installation_id: String,
    pub label: String,
    pub platform: String,
    pub public_key: String,
    pub key_version: u64,
    pub online: Option<bool>,
    pub trusted_public_key: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountSnapshot {
    pub protocol_version: u8,
    pub epoch: u64,
    pub phase: Phase,
    pub account: Option<Account>,
    pub devices: Vec<Device>,
    pub directory_state: DirectoryState,
    pub revision: u64,
    pub error_code: Option<String>,
}

#[derive(Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EmptyRequest {}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LoginRequest {
    pub signup: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeviceUpdateRequest {
    pub device_ref: String,
    pub expected_epoch: u64,
    pub expected_revision: u64,
    pub label: Option<String>,
    pub remove: Option<bool>,
}

pub enum TokenResource {
    Account,
    Business,
    Coordination,
}
/// Deliberately not Serialize or Debug; an access token never enters guest IPC.
pub struct AccessGrant {
    pub access_token: String,
    pub expires_at: u64,
    pub epoch: u64,
}

#[derive(Clone, Serialize)]
pub(super) struct DeviceRecord {
    pub installation_id: String,
    pub label: String,
    pub platform: String,
    pub public_key: String,
    pub key_version: u64,
    pub grid_device_id: Option<String>,
    pub online: Option<bool>,
    pub gateway_url: Option<String>,
}

pub struct PreparedTarget {
    pub target: crate::transport::VerifiedTarget,
    pub authorization: std::sync::Arc<dyn crate::transport::Authorization>,
    pub trust: TrustCommit,
}
/// Opaque, single-use evidence of the exact confirmed directory target.
pub struct TrustCommit {
    pub(super) epoch: u64,
    pub(super) revision: u64,
    pub(super) scope_id: String,
    pub(super) installation_id: String,
    pub(super) public_key: String,
    pub(super) key_version: u64,
}
