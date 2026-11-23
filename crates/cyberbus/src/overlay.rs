use crate::NetworkCredentials;
use cyberbus_transport::{AsyncStream, CancellationToken, Transport, TransportConfig};
use std::{
    net::{Ipv4Addr, SocketAddr, SocketAddrV4},
    sync::Arc,
    time::Duration,
};
use tokio::time::Instant;

pub const DEFAULT_SERVICE_PORT: u16 = 11_001;
pub const SERVICE_PROTOCOL: &str = "anywork-noise-v1";

#[derive(Debug, thiserror::Error)]
pub enum OverlayError {
    #[error("OVERLAY_CONFIGURATION_REJECTED")]
    Configuration,
    #[error("OVERLAY_UNAVAILABLE")]
    Unavailable,
    #[error("OVERLAY_CLOSED")]
    Closed,
}

#[derive(Clone)]
pub struct OverlayConfig {
    pub bootstrap_peers: Vec<String>,
    pub service_port: u16,
    pub enable_p2p: bool,
}
impl Default for OverlayConfig {
    fn default() -> Self {
        Self {
            bootstrap_peers: Vec::new(),
            service_port: DEFAULT_SERVICE_PORT,
            enable_p2p: true,
        }
    }
}

pub struct Network {
    transport: Arc<Transport>,
    stop: CancellationToken,
}
impl Network {
    pub async fn start(
        credentials: &NetworkCredentials,
        installation_id: &str,
        config: &OverlayConfig,
    ) -> Result<Self, OverlayError> {
        if config.service_port == 0
            || config.service_port == 11_000
            || config.bootstrap_peers.len() > 64
            || installation_id.is_empty()
            || installation_id.len() > 128
        {
            return Err(OverlayError::Configuration);
        }
        let installation = installation_seed(installation_id);
        let mut native = TransportConfig::new(
            credentials.network_name.clone(),
            credentials.network_secret.clone(),
            installation,
        );
        native.peers = config.bootstrap_peers.clone();
        native.enable_p2p = config.enable_p2p;
        let transport = Arc::new(
            Transport::start(native)
                .await
                .map_err(|_| OverlayError::Unavailable)?,
        );
        let stop = CancellationToken::new();
        let deadline = Instant::now() + Duration::from_secs(30);
        if transport.wait_ready(deadline, &stop).await.is_err() {
            let _ = transport.close().await;
            return Err(OverlayError::Unavailable);
        }
        Ok(Self { transport, stop })
    }
    pub fn ipv4(&self) -> Ipv4Addr {
        self.transport.status().ipv4
    }
    pub fn is_ready(&self) -> bool {
        self.transport.status().phase == cyberbus_transport::AddressPhase::Ready
    }
    pub async fn connect(
        &self,
        ipv4: Ipv4Addr,
        port: u16,
        deadline: Instant,
        cancel: &CancellationToken,
    ) -> Result<Box<dyn AsyncStream>, OverlayError> {
        self.transport
            .connect(SocketAddrV4::new(ipv4, port), deadline, cancel)
            .await
            .map_err(|_| OverlayError::Unavailable)
    }
    pub async fn close(&self) {
        self.stop.cancel();
        let _ = self.transport.close().await;
    }
}
impl Drop for Network {
    fn drop(&mut self) {
        self.stop.cancel();
    }
}

pub struct Overlay {
    network: Network,
    listener: Option<cyberbus_transport::Listener>,
    service_port: u16,
}
impl Overlay {
    pub async fn start(
        credentials: &NetworkCredentials,
        installation_id: &str,
        config: OverlayConfig,
    ) -> Result<Self, OverlayError> {
        let network = Network::start(credentials, installation_id, &config).await?;
        let transport = &network.transport;
        let listener = match transport.listen(config.service_port).await {
            Ok(listener) => listener,
            Err(_) => {
                let _ = transport.close().await;
                return Err(OverlayError::Unavailable);
            }
        };
        Ok(Self {
            network,
            listener: Some(listener),
            service_port: config.service_port,
        })
    }
    pub fn ipv4(&self) -> Ipv4Addr {
        self.network.ipv4()
    }
    pub fn service_port(&self) -> u16 {
        self.service_port
    }
    pub async fn accept(
        &mut self,
        cancel: &CancellationToken,
    ) -> Result<(Box<dyn AsyncStream>, SocketAddr), OverlayError> {
        let listener = self.listener.as_mut().ok_or(OverlayError::Closed)?;
        tokio::select! {
            _=self.network.stop.cancelled()=>Err(OverlayError::Closed),
            _=cancel.cancelled()=>Err(OverlayError::Closed),
            result=listener.accept(cancel)=>result.map_err(|_| OverlayError::Closed),
        }
    }
    pub async fn connect(
        &self,
        ipv4: Ipv4Addr,
        port: u16,
        deadline: Instant,
        cancel: &CancellationToken,
    ) -> Result<Box<dyn AsyncStream>, OverlayError> {
        self.network.connect(ipv4, port, deadline, cancel).await
    }
    pub async fn close(&mut self) {
        self.network.stop.cancel();
        if let Some(listener) = &mut self.listener {
            listener.close();
        }
        self.listener = None;
        self.network.close().await;
    }
}
impl Drop for Overlay {
    fn drop(&mut self) {
        self.network.stop.cancel();
    }
}
fn installation_seed(installation_id: &str) -> [u8; 32] {
    use sha2::Digest;
    sha2::Sha256::digest(installation_id.as_bytes()).into()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_control_port_and_bad_installation() {
        let config = OverlayConfig {
            service_port: 11_000,
            ..Default::default()
        };
        let credentials = NetworkCredentials {
            network_name: "n".into(),
            network_secret: "s".into(),
            app_psk: [1; 32],
            binding_id: [2; 32],
            credential_epoch: 1,
        };
        let result = tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(Overlay::start(&credentials, "installation", config));
        let Err(error) = result else {
            panic!("control port must be rejected");
        };
        assert!(matches!(error, OverlayError::Configuration));
    }
}
