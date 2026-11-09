use anyhow::{Result, bail};
use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode, decode_header, jwk::JwkSet};
use serde::Deserialize;
use std::{
    future::Future,
    pin::Pin,
    sync::Arc,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tokio::sync::Mutex;

pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
#[derive(Clone, Debug)]
pub struct VerifiedAccount {
    pub subject: String,
    pub expires_at: u64,
}
pub type VerifyFuture<'a> = Pin<Box<dyn Future<Output = Result<VerifiedAccount>> + Send + 'a>>;
pub trait AccountVerifier: Send + Sync {
    fn verify<'a>(&'a self, token: &'a str) -> VerifyFuture<'a>;
}
#[derive(Clone)]
pub struct JwtVerifier {
    issuer: String,
    audience: String,
    client_id: String,
    owner: String,
    http: reqwest::Client,
    keys: Arc<Mutex<Option<(Instant, JwkSet)>>>,
}
#[derive(Deserialize)]
struct Claims {
    sub: String,
    exp: u64,
    scope: String,
    client_id: Option<String>,
    azp: Option<String>,
}
impl JwtVerifier {
    pub fn new(issuer: String, audience: String, client_id: String, owner: String) -> Result<Self> {
        for value in [&issuer, &audience] {
            let url = url::Url::parse(value)?;
            if url.scheme() != "https"
                || url.host_str().is_none()
                || !url.username().is_empty()
                || url.password().is_some()
                || url.query().is_some()
                || url.fragment().is_some()
            {
                bail!("INVALID_AUTH_CONFIG")
            }
        }
        if client_id.is_empty() || owner.is_empty() {
            bail!("INVALID_AUTH_CONFIG")
        }
        Ok(Self {
            issuer,
            audience,
            client_id,
            owner,
            keys: Arc::new(Mutex::new(None)),
            http: reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .timeout(Duration::from_secs(10))
                .build()?,
        })
    }
    async fn check(&self, token: &str) -> Result<VerifiedAccount> {
        if token.len() > 16384 {
            bail!("AUTH_REJECTED")
        }
        let header = decode_header(token)?;
        if header.alg != Algorithm::ES384 {
            bail!("AUTH_REJECTED")
        }
        let kid = header.kid.ok_or_else(|| anyhow::anyhow!("AUTH_REJECTED"))?;
        let mut cache = self.keys.lock().await;
        if cache.as_ref().is_none_or(|(at, keys)| {
            at.elapsed() > Duration::from_secs(300) || keys.find(&kid).is_none()
        }) {
            let mut response = self
                .http
                .get(format!("{}/jwks", self.issuer.trim_end_matches('/')))
                .send()
                .await?
                .error_for_status()?;
            if response.content_length().is_some_and(|v| v > 131072) {
                bail!("AUTH_REJECTED")
            }
            let mut bytes = Vec::new();
            while let Some(chunk) = response.chunk().await? {
                if bytes.len() + chunk.len() > 131072 {
                    bail!("AUTH_REJECTED")
                };
                bytes.extend_from_slice(&chunk);
            }
            *cache = Some((Instant::now(), serde_json::from_slice(&bytes)?));
        }
        let key = cache
            .as_ref()
            .and_then(|(_, k)| k.find(&kid))
            .ok_or_else(|| anyhow::anyhow!("AUTH_REJECTED"))?;
        let mut validation = Validation::new(Algorithm::ES384);
        validation.set_issuer(&[&self.issuer]);
        validation.set_audience(&[&self.audience]);
        validation.validate_nbf = true;
        validation.leeway = 0;
        let claims = decode::<Claims>(token, &DecodingKey::from_jwk(key)?, &validation)?.claims;
        if claims.sub != self.owner
            || !claims.scope.split_whitespace().any(|s| s == "connect")
            || claims.exp <= now()
        {
            bail!("AUTH_REJECTED")
        }
        let client = claims.client_id.as_deref().or(claims.azp.as_deref());
        if client != Some(self.client_id.as_str())
            || claims
                .client_id
                .as_ref()
                .zip(claims.azp.as_ref())
                .is_some_and(|(a, b)| a != b)
        {
            bail!("AUTH_REJECTED")
        }
        Ok(VerifiedAccount {
            subject: claims.sub,
            expires_at: claims.exp.min(now() + 300),
        })
    }
}
impl AccountVerifier for JwtVerifier {
    fn verify<'a>(&'a self, token: &'a str) -> VerifyFuture<'a> {
        Box::pin(self.check(token))
    }
}
