//! The pinned Native broker owns admission, registration, leases and recovery.
//! It never owns an OAuth grant or opens the SDK's browser/device login flow.
use super::*;
use std::sync::Weak;

pub(super) struct NativeDirectory {
    client: Arc<cybergrid_sdk::Client>,
    epoch: u64,
    subject: String,
    registered: bool,
}

impl NativeDirectory {
    pub fn epoch(&self) -> u64 {
        self.epoch
    }
    pub async fn close(self) -> bool {
        // close fences locally before attempting exact-session revocation.
        self.client.close().await.is_ok()
    }
}

struct Authorization {
    owner: Weak<Inner>,
    client: Weak<cybergrid_sdk::Client>,
    epoch: u64,
}

impl Authorization {
    async fn grant(
        &self,
        client: &cybergrid_sdk::Client,
        request: &cybergrid_sdk::AuthTokenRequest,
    ) -> Result<String> {
        let handle = Handle(
            self.owner
                .upgrade()
                .ok_or_else(|| anyhow::anyhow!("CANCELLED"))?,
        );
        let check = || -> Result<()> {
            ensure!(
                self.client
                    .upgrade()
                    .is_some_and(|bound| std::ptr::eq(bound.as_ref(), client))
                    && !request.cancel.is_cancelled()
                    && request.generation == client.snapshot().generation
                    && request.min_validity == client.config().auth_min_validity,
                "MOBILE_ACCOUNT_CHANGED"
            );
            ensure!(
                request.issuer == handle.0.config.issuer
                    && request.client_id == handle.0.config.client_id
                    && request.resource == handle.0.config.resource
                    && valid_scopes(&request.scopes),
                "MOBILE_COORDINATION_CONFIGURATION"
            );
            Ok(())
        };
        check()?;
        handle.ensure_epoch(self.epoch).await?;
        // Do not race/cancel this future after dispatch: the Kotlin operation
        // serializes and retains any rotated grant independently of its caller.
        // The bound SDK also forces refresh on natural session expiry and
        // admission recovery. This is a cache instruction, not an identity
        // assertion tied exclusively to AuthorizationRejected.
        let grant = handle
            .token(
                TokenResource::Coordination,
                request.force_refresh,
                request.min_validity,
            )
            .await?;
        check()?;
        ensure!(grant.epoch == self.epoch, "MOBILE_ACCOUNT_CHANGED");
        Ok(grant.access_token)
    }
}

fn valid_scopes(scopes: &[String]) -> bool {
    scopes.iter().any(|s| s == "connect")
        && scopes.len() <= 8
        && scopes.iter().all(|s| {
            [
                "openid",
                "profile",
                "offline_access",
                "email",
                "phone",
                "custom_data",
                "identities",
                "connect",
            ]
            .contains(&s.as_str())
        })
        && scopes
            .iter()
            .collect::<std::collections::HashSet<_>>()
            .len()
            == scopes.len()
}

impl cybergrid_sdk::AuthProvider for Authorization {
    fn access_token_for<'a>(
        &'a self,
        client: &'a cybergrid_sdk::Client,
        request: &'a cybergrid_sdk::AuthTokenRequest,
    ) -> cybergrid_sdk::AuthFuture<'a> {
        Box::pin(async move {
            self.grant(client, request)
                .await
                .map_err(|_| cybergrid_sdk::Error::AuthorizationUnavailable)
        })
    }
}

pub(super) async fn devices(handle: &Handle, epoch: u64, subject: &str) -> Result<Vec<GridDevice>> {
    let mut slot = handle.0.grid.lock().await;
    handle.ensure_epoch(epoch).await?;
    if slot
        .as_ref()
        .is_some_and(|s| s.epoch != epoch || s.subject != subject)
    {
        if let Some(old) = slot.take() {
            old.close().await;
        }
    }
    if slot.is_none() {
        let client = cybergrid_sdk::Client::new(cybergrid_sdk::Config {
            base_url: handle.0.config.grid_url.clone(),
            app_id: handle.0.config.client_id.clone(),
            iroh_enabled: false,
            stun_servers: vec![],
            cloudflared: None,
            ..Default::default()
        })
        .map_err(|_| anyhow::anyhow!("MOBILE_COORDINATION_CONFIGURATION"))?;
        client
            .set_auth_provider(Arc::new(Authorization {
                owner: Arc::downgrade(&handle.0),
                client: Arc::downgrade(&client),
                epoch,
            }))
            .await;
        *slot = Some(NativeDirectory {
            client,
            epoch,
            subject: subject.into(),
            registered: false,
        });
    }
    let directory = slot.as_mut().expect("installed");
    let configuration = directory
        .client
        .auth_config()
        .await
        .map_err(|_| anyhow::anyhow!("MOBILE_COORDINATION_CONFIG_FETCH_FAILED"))?;
    let policy = EndpointPolicy::parse(&serde_json::to_value(&configuration)?, &handle.0.config)?;
    handle.ensure_epoch(epoch).await?;
    if !directory.registered {
        // Keep this same SDK instance on an unknown result. Its pinned Native
        // protocol retains registration/admission request IDs and RAM keys.
        let session = directory
            .client
            .login_with_auth_provider("AnyWork Android")
            .await
            .map_err(|_| anyhow::anyhow!("MOBILE_COORDINATION_REGISTRATION_FAILED"))?;
        if session.user.id != subject
            || session.purpose != "device"
            || session.app_id != handle.0.config.client_id
            || session.product_id.as_deref().unwrap_or(&session.app_id)
                != handle.0.config.host_product_id
        {
            if let Some(invalid) = slot.take() {
                invalid.close().await;
            }
            bail!("MOBILE_IDENTITY_MISMATCH");
        }
        handle.ensure_epoch(epoch).await?;
        directory.registered = true;
    }
    let devices = directory
        .client
        .devices()
        .await
        .map_err(|_| anyhow::anyhow!("MOBILE_COORDINATION_DIRECTORY_FETCH_FAILED"))?;
    handle.ensure_epoch(epoch).await?;
    GridDevice::parse(&json!({"devices":devices}), &policy)
}
