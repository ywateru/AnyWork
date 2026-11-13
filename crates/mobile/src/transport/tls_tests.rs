use super::*;
use futures_util::{SinkExt, StreamExt};
use rustls::pki_types::{CertificateDer, PrivatePkcs8KeyDer};
use std::{net::SocketAddr, time::Duration};
use tokio_rustls::TlsAcceptor;
use tokio_tungstenite::{connect_async_tls_with_config, tungstenite::Message};

struct Fixture {
    address: SocketAddr,
    certificate: CertificateDer<'static>,
    task: tokio::task::JoinHandle<()>,
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.task.abort();
    }
}
impl Fixture {
    async fn new() -> Self {
        let generated = rcgen::generate_simple_self_signed(vec!["localhost".into()]).unwrap();
        let certificate = generated.cert.der().clone();
        let key = PrivatePkcs8KeyDer::from(generated.key_pair.serialize_der());
        let server = rustls::ServerConfig::builder_with_provider(Arc::new(
            rustls::crypto::ring::default_provider(),
        ))
        .with_safe_default_protocol_versions()
        .unwrap()
        .with_no_client_auth()
        .with_single_cert(vec![certificate.clone()], key.into())
        .unwrap();
        let acceptor = TlsAcceptor::from(Arc::new(server));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let task = tokio::spawn(async move {
            let (tcp, _) = listener.accept().await.unwrap();
            // A rejected certificate/hostname is an expected client failure.
            let Ok(tls) = acceptor.accept(tcp).await else {
                return;
            };
            let Ok(mut socket) = tokio_tungstenite::accept_async(tls).await else {
                return;
            };
            let Some(Ok(message)) = socket.next().await else {
                return;
            };
            let _ = socket.send(message).await;
        });
        Self {
            address,
            certificate,
            task,
        }
    }
    fn trusted_connector(&self) -> Connector {
        let mut roots = RootCertStore::empty();
        roots.add(self.certificate.clone()).unwrap();
        // The exact production builder, with a synthetic test-only trust anchor.
        Connector::Rustls(Arc::new(client_config(roots).unwrap()))
    }
    async fn exchange(
        &self,
        host: &str,
        connector: Connector,
    ) -> std::result::Result<bool, tokio_tungstenite::tungstenite::Error> {
        tokio::time::timeout(Duration::from_secs(3), async {
            let (mut socket, _) = connect_async_tls_with_config(
                format!("wss://{host}:{}/", self.address.port()),
                None,
                true,
                Some(connector),
            )
            .await?;
            socket
                .send(Message::Text("fixture WSS bytes".into()))
                .await?;
            let reply = socket.next().await;
            Ok::<_, tokio_tungstenite::tungstenite::Error>(matches!(
                reply, Some(Ok(Message::Text(text))) if text == "fixture WSS bytes"
            ))
        })
        .await
        .expect("WSS fixture timed out")
    }
}

fn certificate_error(
    error: &tokio_tungstenite::tungstenite::Error,
) -> Option<&rustls::CertificateError> {
    let tokio_tungstenite::tungstenite::Error::Io(error) = error else {
        return None;
    };
    match error.get_ref()?.downcast_ref::<rustls::Error>()? {
        rustls::Error::InvalidCertificate(error) => Some(error),
        _ => None,
    }
}

#[tokio::test]
async fn explicit_provider_completes_verified_wss_exchange() {
    let fixture = Fixture::new().await;
    assert!(
        fixture
            .exchange("localhost", fixture.trusted_connector())
            .await
            .unwrap()
    );
}

#[tokio::test]
async fn production_webpki_rejects_untrusted_certificate() {
    let fixture = Fixture::new().await;
    let error = fixture
        .exchange("localhost", connector().unwrap())
        .await
        .unwrap_err();
    assert!(
        matches!(
            certificate_error(&error),
            Some(rustls::CertificateError::UnknownIssuer)
        ),
        "{error}"
    );
}

#[tokio::test]
async fn explicit_provider_still_rejects_wrong_hostname() {
    let fixture = Fixture::new().await;
    // The synthetic certificate only names localhost, not its IP address.
    let error = fixture
        .exchange("127.0.0.1", fixture.trusted_connector())
        .await
        .unwrap_err();
    assert!(
        matches!(
            certificate_error(&error),
            Some(
                rustls::CertificateError::NotValidForName
                    | rustls::CertificateError::NotValidForNameContext { .. }
            )
        ),
        "{error}"
    );
}
