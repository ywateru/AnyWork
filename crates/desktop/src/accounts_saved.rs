//! Native-only OAuth journal. Never imported into IPC serialization.
use super::{Grant, PublicConfig};
use anyhow::{Result, bail};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Mutex;

const SERVICE: &str = "dev.anywork.desktop.oauth.v1";
const LIMIT: usize = 32768;

pub(super) trait SecretStore: Send + Sync {
    fn read(&self) -> Result<Option<Vec<u8>>>;
    fn write(&self, value: &[u8]) -> Result<()>;
    fn delete(&self) -> Result<()>;
}
struct SystemStore(String);
impl SystemStore {
    fn entry(&self) -> Result<keyring_core::Entry> {
        use keyring_core::api::CredentialStoreApi;
        #[cfg(target_os = "macos")]
        let store = apple_native_keyring_store::keychain::Store::new();
        #[cfg(target_os = "linux")]
        let store = zbus_secret_service_keyring_store::Store::new();
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        {
            store
                .and_then(|store| store.build(SERVICE, &self.0, None))
                .map_err(|_| anyhow::anyhow!("ACCOUNT_STORE_UNAVAILABLE"))
        }
        #[cfg(not(any(target_os = "macos", target_os = "linux")))]
        bail!("ACCOUNT_STORE_UNAVAILABLE")
    }
}
impl SecretStore for SystemStore {
    fn read(&self) -> Result<Option<Vec<u8>>> {
        match self.entry()?.get_secret() {
            Ok(value) => Ok(Some(value)),
            Err(keyring_core::Error::NoEntry) => Ok(None),
            Err(_) => bail!("ACCOUNT_STORE_UNAVAILABLE"),
        }
    }
    fn write(&self, value: &[u8]) -> Result<()> {
        self.entry()?
            .set_secret(value)
            .map_err(|_| anyhow::anyhow!("ACCOUNT_STORE_UNAVAILABLE"))
    }
    fn delete(&self) -> Result<()> {
        match self.entry()?.delete_credential() {
            Ok(()) | Err(keyring_core::Error::NoEntry) => Ok(()),
            Err(_) => bail!("ACCOUNT_STORE_DELETE_FAILED"),
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) enum Phase {
    Provisional,
    Pending,
    Ready,
    Retired,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Record {
    schema: u8,
    config: PublicConfig,
    namespace: String,
    pub owner: String,
    pub subject: Option<String>,
    refresh: Option<String>,
    pub phase: Phase,
}
impl Record {
    pub fn grant(&self) -> Result<Grant> {
        if self.phase != Phase::Ready {
            bail!("ACCOUNT_REAUTH_REQUIRED")
        }
        Ok(Grant {
            config: self.config.clone(),
            subject: self
                .subject
                .clone()
                .ok_or_else(|| anyhow::anyhow!("ACCOUNT_REAUTH_REQUIRED"))?,
            refresh: self
                .refresh
                .clone()
                .ok_or_else(|| anyhow::anyhow!("ACCOUNT_REAUTH_REQUIRED"))?,
        })
    }
}
#[derive(Default)]
struct State {
    loaded: bool,
    retired: bool,
    record: Option<Record>,
}
pub(super) struct Journal {
    store: Arc<dyn SecretStore>,
    config: PublicConfig,
    namespace: String,
    state: Mutex<State>,
    io: Arc<std::sync::Mutex<()>>,
    generation: Arc<std::sync::atomic::AtomicU64>,
    pub(super) timeout: std::time::Duration,
}
impl Journal {
    pub fn system(config: &PublicConfig, support: &std::path::Path) -> Result<Arc<Self>> {
        let namespace = config.namespace(support)?;
        Ok(Self::new(
            config.clone(),
            namespace.clone(),
            Arc::new(SystemStore(namespace)),
        ))
    }
    pub fn new(config: PublicConfig, namespace: String, store: Arc<dyn SecretStore>) -> Arc<Self> {
        Arc::new(Self {
            store,
            config,
            namespace,
            state: Mutex::new(State::default()),
            io: Arc::new(std::sync::Mutex::new(())),
            generation: Arc::new(std::sync::atomic::AtomicU64::new(0)),
            timeout: std::time::Duration::from_secs(15),
        })
    }
    async fn blocking<T: Send + 'static>(
        &self,
        error: &'static str,
        operation: impl FnOnce() -> Result<T> + Send + 'static,
    ) -> Result<T> {
        // The closure owns its I/O lock and generation check even if the caller
        // times out or is cancelled. Never block the renderer indefinitely on
        // a locked or unavailable OS credential service.
        tokio::time::timeout(self.timeout, tokio::task::spawn_blocking(operation))
            .await
            .map_err(|_| anyhow::anyhow!(error))?
            .map_err(|_| anyhow::anyhow!(error))?
    }
    async fn read(&self) -> Result<Option<Vec<u8>>> {
        let store = self.store.clone();
        let io = self.io.clone();
        self.blocking("ACCOUNT_STORE_UNAVAILABLE", move || {
            let _io = io.lock().unwrap_or_else(|e| e.into_inner());
            store.read()
        })
        .await
    }
    async fn write(&self, record: &Record, generation: u64) -> Result<()> {
        if record
            .subject
            .as_ref()
            .is_some_and(|s| s.is_empty() || s.len() > 1024)
            || record
                .refresh
                .as_ref()
                .is_some_and(|s| s.is_empty() || s.len() > 16384)
            || (record.phase == Phase::Ready
                && (record.subject.is_none() || record.refresh.is_none()))
        {
            bail!("ACCOUNT_STORE_REJECTED")
        }
        let bytes = serde_json::to_vec(record)?;
        if bytes.len() > LIMIT {
            bail!("ACCOUNT_STORE_REJECTED")
        }
        let store = self.store.clone();
        let io = self.io.clone();
        let epoch = self.generation.clone();
        self.blocking("ACCOUNT_STORE_UNAVAILABLE", move || {
            let _io = io.lock().unwrap_or_else(|e| e.into_inner());
            if epoch.load(std::sync::atomic::Ordering::SeqCst) != generation {
                bail!("ACCOUNT_OPERATION_CANCELLED")
            }
            store.write(&bytes)?;
            if store.read()?.as_deref() != Some(bytes.as_slice()) {
                bail!("ACCOUNT_STORE_UNAVAILABLE")
            }
            Ok(())
        })
        .await
    }
    pub async fn load(&self) -> Result<Option<Record>> {
        let mut state = self.state.lock().await;
        if state.loaded {
            return Ok(state.record.clone());
        }
        let record = match self.read().await? {
            None => None,
            Some(bytes) => {
                if bytes.len() > LIMIT {
                    bail!("ACCOUNT_STORE_REJECTED")
                }
                let record: Record = serde_json::from_slice(&bytes)
                    .map_err(|_| anyhow::anyhow!("ACCOUNT_STORE_REJECTED"))?;
                if record.schema != 1
                    || record.config != self.config
                    || record.namespace != self.namespace
                    || uuid::Uuid::parse_str(&record.owner).is_err()
                    || record
                        .subject
                        .as_ref()
                        .is_some_and(|s| s.is_empty() || s.len() > 1024)
                    || record
                        .refresh
                        .as_ref()
                        .is_some_and(|s| s.is_empty() || s.len() > 16384)
                    || (record.phase == Phase::Ready
                        && (record.subject.is_none() || record.refresh.is_none()))
                {
                    bail!("ACCOUNT_STORE_REJECTED")
                }
                Some(record)
            }
        };
        state.loaded = true;
        state.retired = record.as_ref().is_some_and(|r| r.phase == Phase::Retired);
        state.record = record.clone();
        Ok(record)
    }
    pub async fn begin(&self, owner: &str) -> Result<()> {
        let mut state = self.state.lock().await;
        if !state.loaded || state.record.is_some() {
            bail!("ACCOUNT_RESTORE_REQUIRED")
        }
        let record = Record {
            schema: 1,
            config: self.config.clone(),
            namespace: self.namespace.clone(),
            owner: owner.into(),
            subject: None,
            refresh: None,
            phase: Phase::Provisional,
        };
        let generation = self
            .generation
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst)
            + 1;
        self.write(&record, generation).await?;
        state.retired = false;
        state.record = Some(record);
        Ok(())
    }
    pub async fn checkpoint(
        &self,
        owner: &str,
        phase: Phase,
        refresh: Option<&str>,
        subject: Option<&str>,
    ) -> Result<()> {
        let started = self.generation.load(std::sync::atomic::Ordering::SeqCst);
        let mut state = self.state.lock().await;
        if state.retired || self.generation.load(std::sync::atomic::Ordering::SeqCst) != started {
            bail!("ACCOUNT_OPERATION_CANCELLED")
        }
        let mut record = state
            .record
            .clone()
            .filter(|r| r.owner == owner)
            .ok_or_else(|| anyhow::anyhow!("ACCOUNT_OPERATION_CANCELLED"))?;
        if let Some(subject) = subject {
            if record.subject.as_deref().is_some_and(|s| s != subject) {
                bail!("ACCOUNT_IDENTITY_MISMATCH")
            }
            record.subject = Some(subject.into());
        }
        if let Some(refresh) = refresh {
            record.refresh = Some(refresh.into());
        }
        record.phase = phase;
        let generation = self
            .generation
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst)
            + 1;
        self.write(&record, generation).await?;
        state.record = Some(record);
        Ok(())
    }
    pub async fn retire(&self) -> Result<()> {
        let generation = self
            .generation
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst)
            + 1;
        let mut state = self.state.lock().await;
        // Fence late results even if the secure store is currently locked.
        state.retired = true;
        let mut record = state.record.clone().unwrap_or_else(|| Record {
            schema: 1,
            config: self.config.clone(),
            namespace: self.namespace.clone(),
            owner: uuid::Uuid::new_v4().to_string(),
            subject: None,
            refresh: None,
            phase: Phase::Retired,
        });
        record.phase = Phase::Retired;
        record.refresh = None;
        self.write(&record, generation).await?;
        state.record = Some(record);
        Ok(())
    }
    pub async fn delete(&self) -> Result<()> {
        let mut state = self.state.lock().await;
        if !state.retired {
            bail!("ACCOUNT_STORE_DELETE_FAILED")
        }
        let store = self.store.clone();
        let io = self.io.clone();
        let epoch = self.generation.clone();
        let generation = self
            .generation
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst)
            + 1;
        self.blocking("ACCOUNT_STORE_DELETE_FAILED", move || {
            let _io = io.lock().unwrap_or_else(|e| e.into_inner());
            if epoch.load(std::sync::atomic::Ordering::SeqCst) != generation {
                bail!("ACCOUNT_OPERATION_CANCELLED")
            }
            store.delete()?;
            if store.read()?.is_some() {
                bail!("ACCOUNT_STORE_DELETE_FAILED")
            }
            Ok(())
        })
        .await?;
        state.loaded = true;
        state.record = None;
        Ok(())
    }
}

#[cfg(test)]
#[derive(Default)]
pub(super) struct MemoryStore {
    pub bytes: std::sync::Mutex<Option<Vec<u8>>>,
    pub fail_read: std::sync::atomic::AtomicBool,
    pub fail_write: std::sync::atomic::AtomicBool,
    pub fail_delete: std::sync::atomic::AtomicBool,
}
#[cfg(test)]
impl SecretStore for MemoryStore {
    fn read(&self) -> Result<Option<Vec<u8>>> {
        if self.fail_read.load(std::sync::atomic::Ordering::SeqCst) {
            bail!("ACCOUNT_STORE_UNAVAILABLE")
        }
        Ok(self.bytes.lock().unwrap().clone())
    }
    fn write(&self, value: &[u8]) -> Result<()> {
        if self.fail_write.load(std::sync::atomic::Ordering::SeqCst) {
            bail!("ACCOUNT_STORE_UNAVAILABLE")
        }
        *self.bytes.lock().unwrap() = Some(value.into());
        Ok(())
    }
    fn delete(&self) -> Result<()> {
        if self.fail_delete.load(std::sync::atomic::Ordering::SeqCst) {
            bail!("ACCOUNT_STORE_DELETE_FAILED")
        }
        *self.bytes.lock().unwrap() = None;
        Ok(())
    }
}
