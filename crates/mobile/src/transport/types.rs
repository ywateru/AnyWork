use serde::{Deserialize, Serialize};
use std::{future::Future, pin::Pin, sync::Arc};

pub const CHUNK: usize = 32_768;
pub const MAX_BODY: usize = 22 * 1024 * 1024;
pub const MOBILE_ORIGIN: &str = "https://tauri.localhost";
pub const NOISE_SUITE: &str = "Noise_IK_25519_ChaChaPoly_SHA256";

/// Native-only credential. Deliberately neither Debug nor Serialize.
pub struct AccessGrant {
    pub access_token: String,
    pub expires_at: u64,
    pub epoch: u64,
}
pub type AuthFuture<'a, T> = Pin<Box<dyn Future<Output = anyhow::Result<T>> + Send + 'a>>;

/// The account owner, not the transport, owns refresh serialization and rotation.
pub trait Authorization: Send + Sync {
    fn token(&self, force_refresh: bool, min_validity: u64) -> AuthFuture<'_, AccessGrant>;
    fn ensure_epoch(&self, epoch: u64) -> AuthFuture<'_, ()>;
}

pub use Authorization as TransportAuthorization;

/// Only constructed by the native account/directory layer; never a command DTO.
pub struct VerifiedTarget {
    pub gateway_url: String,
    pub installation_id: String,
    pub public_key: String,
    pub account_epoch: u64,
    pub scope_id: String,
    pub lifetime: tokio_util::sync::CancellationToken,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConnectionRef {
    pub connection_id: String,
    pub generation: u64,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionInfo {
    #[serde(flatten)]
    pub connection: ConnectionRef,
    pub scope_id: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationRef {
    pub connection: ConnectionRef,
    pub operation_id: String,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpBegin {
    #[serde(flatten)]
    pub operation: OperationRef,
    pub method: String,
    pub path: String,
    pub content_type: Option<String>,
    pub size: usize,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpWrite {
    #[serde(flatten)]
    pub operation: OperationRef,
    pub offset: usize,
    pub base64: String,
}
#[derive(Clone, Debug, Serialize)]
pub struct WriteAck {
    pub received: usize,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResponseHead {
    pub status: u16,
    pub content_type: Option<String>,
    pub size: usize,
}
#[derive(Clone, Debug, Serialize)]
pub struct ResponseChunk {
    pub base64: String,
    pub done: bool,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum PtyCommand {
    #[serde(rename_all = "camelCase")]
    Open {
        #[serde(flatten)]
        operation: OperationRef,
        session_id: String,
    },
    Input {
        #[serde(flatten)]
        operation: OperationRef,
        data: String,
    },
    Resize {
        #[serde(flatten)]
        operation: OperationRef,
        cols: u16,
        rows: u16,
    },
    Ack {
        #[serde(flatten)]
        operation: OperationRef,
        sequence: u64,
    },
    Close {
        #[serde(flatten)]
        operation: OperationRef,
    },
}
impl PtyCommand {
    pub fn operation(&self) -> &OperationRef {
        match self {
            Self::Open { operation, .. }
            | Self::Input { operation, .. }
            | Self::Resize { operation, .. }
            | Self::Ack { operation, .. }
            | Self::Close { operation } => operation,
        }
    }
}
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum TransportEvent {
    #[serde(rename = "connectionClosed")]
    Closed {
        connection: ConnectionRef,
        code: &'static str,
    },
    #[serde(rename_all = "camelCase")]
    #[serde(rename = "ready")]
    PtyReady {
        #[serde(flatten)]
        operation: OperationRef,
        sequence: u64,
    },
    #[serde(rename_all = "camelCase")]
    #[serde(rename = "data")]
    PtyData {
        #[serde(flatten)]
        operation: OperationRef,
        sequence: u64,
        base64: String,
    },
    #[serde(rename_all = "camelCase")]
    #[serde(rename = "closed")]
    PtyClosed {
        #[serde(flatten)]
        operation: OperationRef,
        sequence: u64,
        code: &'static str,
    },
}
/// Must only enqueue into a bounded native bridge. A false return closes the peer.
pub type EventSink = Arc<dyn Fn(TransportEvent) -> bool + Send + Sync>;

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Delivery {
    NotSent,
    OutcomeUnknown,
    ResponseComplete,
}
#[derive(Clone, Debug, Serialize)]
pub struct TransportError {
    pub code: &'static str,
    pub delivery: Delivery,
}
impl TransportError {
    pub(super) fn new(code: &'static str, delivery: Delivery) -> Self {
        Self { code, delivery }
    }
    pub(super) fn invalid() -> Self {
        Self::new("INVALID_REQUEST", Delivery::NotSent)
    }
}
impl std::fmt::Display for TransportError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.code)
    }
}
impl std::error::Error for TransportError {}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupState {
    pub cleanup_pending: bool,
}
pub type Result<T> = std::result::Result<T, TransportError>;
