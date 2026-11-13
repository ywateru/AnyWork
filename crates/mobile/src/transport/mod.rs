//! Mobile outbound business transport. No Tauri or credential persistence here.
mod connection;
mod types;
pub use types::*;

use connection::{Command, Peer, Reply};
use std::{
    collections::HashMap,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
};
use tokio::sync::{Mutex, oneshot};
use tokio_util::sync::CancellationToken;

#[derive(Clone)]
pub struct TransportService {
    peers: Arc<Mutex<HashMap<String, Peer>>>,
    generation: Arc<AtomicU64>,
    slots: Arc<tokio::sync::Semaphore>,
}
impl Default for TransportService {
    fn default() -> Self {
        Self {
            peers: Default::default(),
            generation: Default::default(),
            slots: Arc::new(tokio::sync::Semaphore::new(2)),
        }
    }
}
impl TransportService {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn connect(
        &self,
        target: VerifiedTarget,
        auth: Arc<dyn Authorization>,
        cancel: CancellationToken,
        events: EventSink,
    ) -> Result<ConnectionInfo> {
        // Retire old sockets before allocating another; the shell also calls
        // close_all immediately when account ownership changes.
        self.peers.lock().await.retain(|_, p| !p.is_closed());
        if self.peers.lock().await.len() >= 2 {
            return Err(TransportError::new("CONNECTION_LIMIT", Delivery::NotSent));
        }
        let slot = self
            .slots
            .clone()
            .try_acquire_owned()
            .map_err(|_| TransportError::new("CONNECTION_LIMIT", Delivery::NotSent))?;
        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        let connection = ConnectionRef {
            connection_id: uuid::Uuid::new_v4().to_string(),
            generation,
        };
        let info = ConnectionInfo {
            connection: connection.clone(),
            scope_id: target.scope_id.clone(),
        };
        let peer = Peer::connect(connection, target, auth, cancel, events, slot).await?;
        let mut peers = self.peers.lock().await;
        if peers.len() >= 2 {
            peer.stop();
            return Err(TransportError::new("CONNECTION_LIMIT", Delivery::NotSent));
        }
        peers.insert(info.connection.connection_id.clone(), peer);
        Ok(info)
    }
    async fn peer(&self, reference: &ConnectionRef) -> Result<Peer> {
        let peers = self.peers.lock().await;
        peers
            .get(&reference.connection_id)
            .filter(|p| p.reference() == reference && !p.is_closed())
            .cloned()
            .ok_or_else(|| TransportError::new("CONNECTION_CLOSED", Delivery::NotSent))
    }
    async fn call<T>(
        &self,
        reference: &ConnectionRef,
        build: impl FnOnce(Reply<T>) -> Command,
    ) -> Result<T> {
        let peer = self.peer(reference).await?;
        peer.check().await?;
        let (reply, receive) = oneshot::channel();
        peer.send(build(reply)).await?;
        let result = receive
            .await
            .map_err(|_| TransportError::new("CONNECTION_CLOSED", Delivery::OutcomeUnknown))?;
        // A completed network result must not escape to a retired account.
        if let Err(mut error) = peer.check().await {
            error.delivery = Delivery::OutcomeUnknown;
            return Err(error);
        }
        result
    }
    pub async fn http_begin(&self, req: HttpBegin) -> Result<()> {
        let reference = req.operation.connection.clone();
        self.call(&reference, |reply| Command::Begin(req, reply))
            .await
    }
    pub async fn http_write(&self, req: HttpWrite) -> Result<WriteAck> {
        let reference = req.operation.connection.clone();
        self.call(&reference, |reply| Command::Write(req, reply))
            .await
    }
    pub async fn http_finish(&self, req: OperationRef) -> Result<ResponseHead> {
        let reference = req.connection.clone();
        self.call(&reference, |reply| Command::Finish(req, reply))
            .await
    }
    pub async fn http_read(&self, req: OperationRef) -> Result<ResponseChunk> {
        let reference = req.connection.clone();
        self.call(&reference, |reply| Command::Read(req, reply))
            .await
    }
    pub async fn cancel(&self, req: OperationRef) -> Result<()> {
        let reference = req.connection.clone();
        self.call(&reference, |reply| Command::Cancel(req, reply))
            .await
    }
    pub async fn pty(&self, req: PtyCommand) -> Result<()> {
        let reference = req.operation().connection.clone();
        self.call(&reference, |reply| Command::Pty(req, reply))
            .await
    }
    /// Revalidate existing connections after application foregrounding. This
    /// never reconnects, replays an operation, or extends an authenticated lease.
    pub async fn foreground_validate(&self) -> Result<()> {
        let references: Vec<_> = self
            .peers
            .lock()
            .await
            .values()
            .map(|peer| peer.reference().clone())
            .collect();
        let results = futures_util::future::join_all(
            references
                .iter()
                .map(|reference| self.call(reference, Command::Foreground)),
        )
        .await;
        // Check every connection even when one of them has already expired.
        results.into_iter().collect()
    }
    pub async fn close(&self, reference: ConnectionRef) -> CleanupState {
        let peer = {
            let mut peers = self.peers.lock().await;
            if peers
                .get(&reference.connection_id)
                .is_some_and(|p| p.reference() == &reference)
            {
                peers.remove(&reference.connection_id)
            } else {
                None
            }
        };
        if let Some(peer) = peer {
            return peer.close().await;
        }
        CleanupState {
            cleanup_pending: false,
        }
    }
    pub async fn close_all(&self) -> CleanupState {
        let peers = std::mem::take(&mut *self.peers.lock().await);
        for peer in peers.values() {
            peer.stop();
        }
        let mut pending = false;
        for peer in peers.into_values() {
            pending |= peer.close().await.cleanup_pending;
        }
        CleanupState {
            cleanup_pending: pending,
        }
    }
}

#[cfg(test)]
mod tests;
