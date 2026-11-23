use anyhow::{Result, bail};
use hkdf::Hkdf;
use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode, decode_header, jwk::JwkSet};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    sync::Arc,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tokio::sync::Mutex;
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

pub const CREDENTIAL_CLAIM: &str = "https://cyberbus.x.aixgg.com/easytier/credentials/v1";
const MAX_TOKEN: usize = 16_384;
const MAX_JWKS: usize = 131_072;

pub trait SystemClock: Send + Sync {
    fn now(&self) -> u64;
}

#[derive(Default)]
pub struct RealClock;
impl SystemClock for RealClock {
    fn now(&self) -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VerifiedNetwork {
    pub subject: String,
    pub expires_at: u64,
    pub credentials: Arc<NetworkCredentials>,
}

#[derive(Zeroize, ZeroizeOnDrop)]
pub struct NetworkCredentials {
    pub network_name: String,
    pub network_secret: String,
    pub app_psk: [u8; 32],
    pub binding_id: [u8; 32],
    pub credential_epoch: u64,
}
impl std::fmt::Debug for NetworkCredentials {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("NetworkCredentials([REDACTED])")
    }
}
impl NetworkCredentials {
    pub fn fingerprint(&self) -> [u8; 32] {
        let mut h = Sha256::new();
        for field in [
            self.network_name.as_bytes(),
            self.network_secret.as_bytes(),
            &self.app_psk,
            &self.binding_id,
            &self.credential_epoch.to_be_bytes(),
        ] {
            h.update((field.len() as u32).to_be_bytes());
            h.update(field);
        }
        h.finalize().into()
    }
}
impl PartialEq for NetworkCredentials {
    fn eq(&self, other: &Self) -> bool {
        self.network_name == other.network_name
            && self.network_secret == other.network_secret
            && self.app_psk == other.app_psk
            && self.binding_id == other.binding_id
            && self.credential_epoch == other.credential_epoch
    }
}
impl Eq for NetworkCredentials {}

#[derive(Deserialize)]
struct Claims {
    sub: String,
    exp: u64,
    scope: String,
    client_id: Option<String>,
    azp: Option<String>,
    gty: Option<String>,
    kind: Option<String>,
    #[serde(rename = "https://cyberbus.x.aixgg.com/easytier/credentials/v1")]
    credential: Option<CredentialClaim>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CredentialClaim {
    version: u64,
    product_id: String,
    credential_epoch: String,
    account_seed_secret_hex: String,
    max_devices: u64,
    virtual_cidr: String,
    control_port: u64,
    config_version: String,
}

pub struct NetworkVerifier {
    issuer: String,
    resource: String,
    clients: Vec<String>,
    product: String,
    clock: Arc<dyn SystemClock>,
    http: reqwest::Client,
    keys: Mutex<Option<(Instant, JwkSet)>>,
}
impl NetworkVerifier {
    pub fn new(
        issuer: String,
        resource: String,
        clients: Vec<String>,
        product: String,
        clock: Arc<dyn SystemClock>,
    ) -> Result<Self> {
        validate_https(&issuer)?;
        validate_https(&resource)?;
        if !issuer.ends_with("/oidc")
            || clients.is_empty()
            || clients.len() > 16
            || clients.iter().any(|v| !identifier(v))
            || clients.iter().collect::<HashSet<_>>().len() != clients.len()
            || product.is_empty()
            || product.len() > 64
        {
            bail!("INVALID_NETWORK_CONFIG")
        }
        Ok(Self {
            issuer,
            resource,
            clients,
            product,
            clock,
            http: reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .connect_timeout(Duration::from_secs(10))
                .timeout(Duration::from_secs(20))
                .build()?,
            keys: Mutex::new(None),
        })
    }

    pub async fn verify(&self, token: &str) -> Result<VerifiedNetwork> {
        if token.is_empty() || token.len() > MAX_TOKEN {
            bail!("NETWORK_TOKEN_REJECTED")
        }
        let header = decode_header(token)?;
        if !matches!(
            header.alg,
            Algorithm::RS256 | Algorithm::ES256 | Algorithm::ES384
        ) {
            bail!("NETWORK_TOKEN_REJECTED")
        }
        let kid = header
            .kid
            .ok_or_else(|| anyhow::anyhow!("NETWORK_TOKEN_REJECTED"))?;
        let mut cache = self.keys.lock().await;
        let stale = cache.as_ref().is_none_or(|(at, keys)| {
            at.elapsed() > Duration::from_secs(300) || keys.find(&kid).is_none()
        });
        if stale {
            let mut response = self
                .http
                .get(format!("{}/jwks", self.issuer.trim_end_matches('/')))
                .send()
                .await?
                .error_for_status()?;
            if response
                .content_length()
                .is_some_and(|v| v > MAX_JWKS as u64)
            {
                bail!("NETWORK_TOKEN_REJECTED")
            }
            let mut bytes = Vec::new();
            while let Some(chunk) = response.chunk().await? {
                if bytes.len() + chunk.len() > MAX_JWKS {
                    bail!("NETWORK_TOKEN_REJECTED")
                }
                bytes.extend_from_slice(&chunk);
            }
            *cache = Some((Instant::now(), serde_json::from_slice(&bytes)?));
        }
        let key = cache
            .as_ref()
            .and_then(|(_, keys)| keys.find(&kid))
            .ok_or_else(|| anyhow::anyhow!("NETWORK_TOKEN_REJECTED"))?;
        let mut validation = Validation::new(header.alg);
        validation.set_issuer(&[&self.issuer]);
        validation.set_audience(&[&self.resource]);
        validation.validate_nbf = true;
        validation.leeway = 0;
        let claims: Claims = decode(token, &DecodingKey::from_jwk(key)?, &validation)?.claims;
        let now = self.clock.now();
        let client = claims.client_id.as_deref().or(claims.azp.as_deref());
        if claims.sub.is_empty()
            || claims.sub.len() > 4096
            || !client.is_some_and(|c| self.clients.iter().any(|allowed| allowed == c))
            || claims
                .client_id
                .as_ref()
                .zip(claims.azp.as_ref())
                .is_some_and(|(a, b)| a != b)
            || !claims
                .scope
                .split_ascii_whitespace()
                .any(|s| s == "network:join")
            || claims.gty.as_deref().is_some_and(|g| {
                g.split_ascii_whitespace()
                    .any(|s| s == "client_credentials")
            })
            || claims.kind.as_deref().is_some_and(|k| k != "AccessToken")
            || claims.exp <= now
        {
            bail!("NETWORK_TOKEN_REJECTED")
        }
        let credential = claims
            .credential
            .ok_or_else(|| anyhow::anyhow!("NETWORK_TOKEN_REJECTED"))?;
        let credentials = derive(&self.issuer, &claims.sub, &self.product, credential)?;
        Ok(VerifiedNetwork {
            subject: claims.sub,
            expires_at: claims.exp,
            credentials: Arc::new(credentials),
        })
    }
}

fn validate_https(value: &str) -> Result<()> {
    let url = url::Url::parse(value)?;
    let authority = url
        .as_str()
        .split_once("://")
        .map(|(_, rest)| rest.split(['/', '?', '#']).next().unwrap_or_default())
        .unwrap_or_default();
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || authority.contains('@')
        || url.query().is_some()
        || url.fragment().is_some()
    {
        bail!("INVALID_NETWORK_CONFIG")
    }
    Ok(())
}
fn identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-'))
}
fn derive(
    issuer: &str,
    subject: &str,
    product: &str,
    claim: CredentialClaim,
) -> Result<NetworkCredentials> {
    let epoch = claim.credential_epoch.parse::<u64>().ok();
    if claim.version != 1
        || claim.product_id != product
        || claim.account_seed_secret_hex.len() != 64
        || !claim
            .account_seed_secret_hex
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        || claim.credential_epoch.is_empty()
        || (claim.credential_epoch.len() > 1 && claim.credential_epoch.starts_with('0'))
        || claim.max_devices != 256
        || claim.virtual_cidr != "10.144.0.0/20"
        || claim.control_port != 11_000
        || claim.config_version != "1"
        || epoch.is_none()
    {
        bail!("NETWORK_TOKEN_REJECTED")
    }
    let seed = Zeroizing::new(hex::decode(&claim.account_seed_secret_hex)?);
    if seed.len() != 32 {
        bail!("NETWORK_TOKEN_REJECTED")
    }
    let scope = encode(&[
        b"cyberbus/seed/v1",
        issuer.as_bytes(),
        subject.as_bytes(),
        product.as_bytes(),
        claim.credential_epoch.as_bytes(),
    ]);
    let salt = Sha256::digest(encode(&[b"cyberbus/v1", &scope]));
    let hk = Hkdf::<Sha256>::new(Some(&salt), &seed);
    let mut name = [0; 16];
    let mut secret = [0; 32];
    let mut app_psk = [0; 32];
    let mut binding_id = [0; 32];
    let rejected = || anyhow::anyhow!("NETWORK_TOKEN_REJECTED");
    hk.expand(b"network-name", &mut name)
        .map_err(|_| rejected())?;
    hk.expand(b"network-secret", &mut secret)
        .map_err(|_| rejected())?;
    hk.expand(b"app-handshake-psk", &mut app_psk)
        .map_err(|_| rejected())?;
    hk.expand(b"session-binding-id/v1", &mut binding_id)
        .map_err(|_| rejected())?;
    let network_secret =
        base64::Engine::encode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, secret);
    Ok(NetworkCredentials {
        network_name: format!("cg-et-mvp-{}", hex::encode(name)),
        network_secret,
        app_psk,
        binding_id,
        credential_epoch: epoch.unwrap_or_default(),
    })
}
fn encode(fields: &[&[u8]]) -> Vec<u8> {
    let mut out = Vec::new();
    for field in fields {
        out.extend_from_slice(&(field.len() as u32).to_be_bytes());
        out.extend_from_slice(field);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derivation_matches_cyberbus_fixture() {
        let fixture: serde_json::Value =
            serde_json::from_str(include_str!("../../../testdata/cyberbus-derivation.json"))
                .unwrap();
        let claim = CredentialClaim {
            version: 1,
            product_id: fixture["product_id"].as_str().unwrap().into(),
            credential_epoch: fixture["epoch"].as_str().unwrap().into(),
            account_seed_secret_hex: fixture["seed"].as_str().unwrap().into(),
            max_devices: 256,
            virtual_cidr: "10.144.0.0/20".into(),
            control_port: 11_000,
            config_version: "1".into(),
        };
        let derived = derive(
            fixture["issuer"].as_str().unwrap(),
            fixture["subject"].as_str().unwrap(),
            "product",
            claim,
        )
        .unwrap();
        assert_eq!(derived.network_name, fixture["network_name"]);
        assert_eq!(derived.network_secret, fixture["network_secret"]);
        assert_eq!(hex::encode(derived.app_psk), fixture["app_psk"]);
        assert_eq!(hex::encode(derived.binding_id), fixture["binding_id"]);
    }

    #[test]
    fn rejects_noncanonical_claims_and_mismatched_products() {
        let claim = CredentialClaim {
            version: 1,
            product_id: "other".into(),
            credential_epoch: "01".into(),
            account_seed_secret_hex: "11".repeat(32),
            max_devices: 256,
            virtual_cidr: "10.144.0.0/20".into(),
            control_port: 11_000,
            config_version: "1".into(),
        };
        assert!(derive("https://issuer/oidc", "subject", "anywork", claim).is_err());
    }

    #[test]
    fn algorithm_allowlist_matches_cyberbus() {
        assert!(matches!(
            Algorithm::ES384,
            Algorithm::RS256 | Algorithm::ES256 | Algorithm::ES384
        ));
        assert!(!matches!(
            Algorithm::HS256,
            Algorithm::RS256 | Algorithm::ES256 | Algorithm::ES384
        ));
    }
}
