use super::*;
use crate::transport::Overlay;
use anywork_cyberbus::{DEFAULT_SERVICE_PORT, Network, NetworkVerifier, OverlayConfig, RealClock};
use std::net::Ipv4Addr;
use tokio::time::Instant;

pub(super) type NetworkFuture<'a> =
    std::pin::Pin<Box<dyn std::future::Future<Output = Result<Arc<dyn Overlay>>> + Send + 'a>>;
pub(super) trait NetworkStarter: Send + Sync {
    fn start<'a>(
        &'a self,
        token: &'a str,
        subject: &'a str,
        installation_id: &'a str,
    ) -> NetworkFuture<'a>;
}

pub(super) struct CyberbusNetworkStarter {
    verifier: std::result::Result<NetworkVerifier, String>,
    peers: Vec<String>,
}
impl CyberbusNetworkStarter {
    pub(super) fn new(config: &Config) -> Self {
        let verifier = if valid_configuration(config) {
            NetworkVerifier::new(
                config.issuer.clone(),
                config.resource.clone(),
                vec![config.client_id.clone()],
                config.product_id.clone(),
                Arc::new(RealClock),
            )
            .map_err(|_| "MOBILE_NETWORK_CONFIGURATION".to_string())
        } else {
            Err("MOBILE_NETWORK_CONFIGURATION".to_string())
        };
        Self {
            verifier,
            peers: config.bootstrap_peers.clone(),
        }
    }
}

fn valid_configuration(config: &Config) -> bool {
    !config.product_id.is_empty()
        && config.product_id.len() <= 64
        && !config.bootstrap_peers.is_empty()
        && config.bootstrap_peers.len() <= 64
        && config.bootstrap_peers.iter().all(|peer| {
            let Ok(url) = url::Url::parse(peer) else {
                return false;
            };
            matches!(url.scheme(), "tcp" | "udp" | "ws" | "wss")
                && url.host_str().is_some()
                && url.port_or_known_default().is_some()
                && url.username().is_empty()
                && url.password().is_none()
                && url.query().is_none()
                && url.fragment().is_none()
        })
}
impl NetworkStarter for CyberbusNetworkStarter {
    fn start<'a>(
        &'a self,
        token: &'a str,
        subject: &'a str,
        installation_id: &'a str,
    ) -> NetworkFuture<'a> {
        Box::pin(async move {
            let verifier = self
                .verifier
                .as_ref()
                .map_err(|_| anyhow::anyhow!("MOBILE_NETWORK_CONFIGURATION"))?;
            let verified = verifier
                .verify(token)
                .await
                .map_err(|_| anyhow::anyhow!("MOBILE_NETWORK_TOKEN_REJECTED"))?;
            ensure!(verified.subject == subject, "MOBILE_IDENTITY_MISMATCH");
            let network = Network::start(
                &verified.credentials,
                installation_id,
                &OverlayConfig {
                    bootstrap_peers: self.peers.clone(),
                    service_port: DEFAULT_SERVICE_PORT,
                    enable_p2p: true,
                },
            )
            .await
            .map_err(|_| anyhow::anyhow!("MOBILE_NETWORK_START"))?;
            Ok(Arc::new(CyberbusOverlay { network }) as Arc<dyn Overlay>)
        })
    }
}

struct CyberbusOverlay {
    network: Network,
}
impl Overlay for CyberbusOverlay {
    fn connect<'a>(
        &'a self,
        ipv4: Ipv4Addr,
        port: u16,
        cancel: &'a CancellationToken,
    ) -> crate::transport::OverlayFuture<'a> {
        Box::pin(async move {
            self.network
                .connect(ipv4, port, Instant::now() + Duration::from_secs(15), cancel)
                .await
                .map_err(|_| anyhow::anyhow!("MOBILE_NETWORK_CONNECT"))
        })
    }

    fn close(&self) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send + '_>> {
        Box::pin(async move {
            self.network.close().await;
        })
    }
}
