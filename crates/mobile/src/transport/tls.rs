use super::{Delivery, Result, TransportError};
use rustls::{ClientConfig, RootCertStore};
use std::sync::Arc;
use tokio_tungstenite::Connector;

/// Select a provider locally: the Android dependency graph enables both ring
/// and aws-lc-rs. rustls' implicit provider selection can panic in that graph.
fn client_config(roots: RootCertStore) -> Result<ClientConfig> {
    ClientConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
        .with_safe_default_protocol_versions()
        .map_err(|_| TransportError::new("TLS_CONFIGURATION_FAILED", Delivery::NotSent))
        .map(|builder| builder.with_root_certificates(roots).with_no_client_auth())
}

pub(super) fn connector() -> Result<Connector> {
    let roots = RootCertStore::from_iter(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    Ok(Connector::Rustls(Arc::new(client_config(roots)?)))
}

#[cfg(test)]
#[path = "tls_tests.rs"]
mod tests;
