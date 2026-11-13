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
    client_ids: Vec<String>,
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
        Self::with_allowed_clients(issuer, audience, vec![client_id], owner)
    }
    /// Explicit exact client set. The original single-client constructor stays strict.
    pub fn with_allowed_clients(
        issuer: String,
        audience: String,
        client_ids: Vec<String>,
        owner: String,
    ) -> Result<Self> {
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
        if client_ids.is_empty()
            || client_ids.len() > 16
            || owner.is_empty()
            || client_ids.iter().any(|id| {
                id.is_empty()
                    || id.len() > 128
                    || !id
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-'))
            })
            || client_ids
                .iter()
                .collect::<std::collections::HashSet<_>>()
                .len()
                != client_ids.len()
        {
            bail!("INVALID_AUTH_CONFIG")
        }
        Ok(Self {
            issuer,
            audience,
            client_ids,
            owner,
            keys: Arc::new(Mutex::new(None)),
            http: reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .timeout(Duration::from_secs(10))
                .build()?,
        })
    }
    fn client_allowed(&self, claims: &Claims) -> bool {
        let client = claims.client_id.as_deref().or(claims.azp.as_deref());
        client.is_some_and(|id| self.client_ids.iter().any(|allowed| allowed == id))
            && !claims
                .client_id
                .as_ref()
                .zip(claims.azp.as_ref())
                .is_some_and(|(a, b)| a != b)
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
        if !self.client_allowed(&claims) {
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

#[cfg(test)]
mod client_tests {
    use super::*;
    fn verifier(ids: Vec<&str>) -> Result<JwtVerifier> {
        JwtVerifier::with_allowed_clients(
            "https://issuer.example/oidc".into(),
            "https://resource.example/api".into(),
            ids.into_iter().map(str::to_owned).collect(),
            "owner".into(),
        )
    }
    fn claims(client: Option<&str>, azp: Option<&str>) -> Claims {
        Claims {
            sub: "owner".into(),
            exp: now() + 300,
            scope: "connect".into(),
            client_id: client.map(str::to_owned),
            azp: azp.map(str::to_owned),
        }
    }
    #[test]
    fn exact_clients_preserve_legacy_and_reject_conflicting_authorized_presenters() {
        let verifier = verifier(vec!["spa", "native"]).unwrap();
        for id in ["spa", "native"] {
            assert!(verifier.client_allowed(&claims(Some(id), None)));
            assert!(verifier.client_allowed(&claims(None, Some(id))));
            assert!(verifier.client_allowed(&claims(Some(id), Some(id))));
        }
        for c in [
            claims(None, None),
            claims(Some("foreign"), None),
            claims(Some("SPA"), None),
            claims(Some("spa"), Some("native")),
            claims(Some("foreign"), Some("spa")),
        ] {
            assert!(!verifier.client_allowed(&c));
        }
        let legacy = JwtVerifier::new(
            "https://issuer.example/oidc".into(),
            "https://resource.example/api".into(),
            "spa".into(),
            "owner".into(),
        )
        .unwrap();
        assert!(legacy.client_allowed(&claims(Some("spa"), None)));
        assert!(!legacy.client_allowed(&claims(Some("native"), None)));
    }
    #[test]
    fn reject_empty_duplicate_wildcard_and_unbounded_client_sets() {
        for ids in [
            vec![],
            vec![""],
            vec!["*"],
            vec!["spa", "spa"],
            vec!["x"; 17],
        ] {
            assert!(verifier(ids).is_err());
        }
    }
    // Synthetic test-only signing key, generated for this isolated verifier test.
    const TEST_KEY: &str = r#"-----BEGIN PRIVATE KEY-----
MIG2AgEAMBAGByqGSM49AgEGBSuBBAAiBIGeMIGbAgEBBDABg/uGvV+09JozlfTp
2teJLjrne/MCpOPu9wtaR5rk6MSiZ20UFtsHLMhoa23YlJWhZANiAAS/Um0ctUHf
4KulIsNPyJG24UmY6EF2tNzNG5uDRB91MBrgg3tPgANKuNauRq+1GZSUwX/BwtEh
cJthF9ldEQhiB1PX9SUkydBaY/53rGfeCHMqrhqmy4bRTEe7afnwDnE=
-----END PRIVATE KEY-----
"#;
    const TEST_JWK: &str = r#"{"keys":[{"kty":"EC","crv":"P-384","kid":"fixture","use":"sig","alg":"ES384","x":"v1JtHLVB3-CrpSLDT8iRtuFJmOhBdrTczRubg0QfdTAa4IN7T4ADSrjWrkavtRmU","y":"lMF_wcLRIXCbYRfZXREIYgdT1_UlJMnQWmP-d6xn3ghzKq4apsuG0UxHu2n58A5x"}]}"#;
    #[tokio::test]
    async fn signed_spa_and_native_tokens_keep_every_existing_jwt_boundary() {
        let verifier = verifier(vec!["spa", "native"]).unwrap();
        *verifier.keys.lock().await =
            Some((Instant::now(), serde_json::from_str(TEST_JWK).unwrap()));
        let mut header = jsonwebtoken::Header::new(Algorithm::ES384);
        header.kid = Some("fixture".into());
        let key = jsonwebtoken::EncodingKey::from_ec_pem(TEST_KEY.as_bytes()).unwrap();
        let base = serde_json::json!({"iss":"https://issuer.example/oidc","aud":"https://resource.example/api",
            "sub":"owner","exp":now()+300,"nbf":now()-1,"scope":"connect","client_id":"spa"});
        for client in ["spa", "native"] {
            let mut claims = base.clone();
            claims["client_id"] = client.into();
            let token = jsonwebtoken::encode(&header, &claims, &key).unwrap();
            assert_eq!(verifier.verify(&token).await.unwrap().subject, "owner");
        }
        for (field, value) in [
            ("iss", serde_json::json!("https://foreign.example/oidc")),
            ("aud", serde_json::json!("https://foreign.example/api")),
            ("sub", serde_json::json!("another-owner")),
            ("scope", serde_json::json!("openid")),
            ("exp", serde_json::json!(now() - 1)),
            ("nbf", serde_json::json!(now() + 60)),
            ("client_id", serde_json::json!("foreign")),
            ("client_id", serde_json::Value::Null),
            ("azp", serde_json::json!("native")),
        ] {
            let mut claims = base.clone();
            claims[field] = value;
            let token = jsonwebtoken::encode(&header, &claims, &key).unwrap();
            assert!(
                verifier.verify(&token).await.is_err(),
                "accepted invalid {field}"
            );
        }
        let mut token = jsonwebtoken::encode(&header, &base, &key)
            .unwrap()
            .into_bytes();
        let last = token.len() - 4;
        token[last] = if token[last] == b'A' { b'B' } else { b'A' };
        assert!(
            verifier
                .verify(std::str::from_utf8(&token).unwrap())
                .await
                .is_err()
        );
    }
}
