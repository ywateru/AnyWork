//! Restore a saved grant without a browser or persisted device/Noise session.
use super::*;

#[cfg(test)]
pub(super) struct RestoreFixture {
    pub base: String,
    pub verifier: Arc<dyn AccountVerifier>,
}
impl Handle {
    fn restore_endpoint(&self, suffix: &str) -> String {
        #[cfg(test)]
        if let Some(fixture) = &self.0.restore_fixture {
            return format!("{}{suffix}", fixture.base);
        }
        format!("{}{suffix}", self.0.config.issuer)
    }
    async fn restore_preflight(&self) -> Result<()> {
        let response = client()?
            .get(self.restore_endpoint("/.well-known/openid-configuration"))
            .timeout(Duration::from_secs(8))
            .send()
            .await
            .map_err(|_| anyhow::anyhow!("ACCOUNT_RESTORE_NETWORK"))?;
        if !response.status().is_success() {
            bail!("ACCOUNT_RESTORE_NETWORK")
        }
        let value: Value = serde_json::from_slice(
            &bounded(response)
                .await
                .map_err(|_| anyhow::anyhow!("ACCOUNT_RESTORE_NETWORK"))?,
        )
        .map_err(|_| anyhow::anyhow!("ACCOUNT_STORE_REJECTED"))?;
        if value["issuer"] != self.0.config.issuer
            || value["token_endpoint"] != format!("{}/token", self.0.config.issuer)
            || value["jwks_uri"] != format!("{}/jwks", self.0.config.issuer)
        {
            bail!("ACCOUNT_STORE_REJECTED")
        }
        Ok(())
    }
    async fn verify_restored(&self, token: &str, subject: &str) -> Result<()> {
        #[cfg(test)]
        if let Some(fixture) = &self.0.restore_fixture {
            let verified = fixture.verifier.verify(token).await?;
            if verified.subject != subject {
                bail!("ACCOUNT_IDENTITY_MISMATCH")
            }
            return Ok(());
        }
        JwtVerifier::new(
            self.0.config.issuer.clone(),
            self.0.config.resource.clone(),
            self.0.config.native_client_id.clone(),
            subject.into(),
        )?
        .verify(token)
        .await?;
        Ok(())
    }
    async fn restored_profile(&self, token: &str) -> Result<Value> {
        #[cfg(test)]
        if let Some(fixture) = &self.0.restore_fixture {
            let response = client()?
                .get(format!("{}/account", fixture.base))
                .bearer_auth(token)
                .send()
                .await?
                .error_for_status()?;
            return Ok(serde_json::from_slice(&bounded(response).await?)?);
        }
        self.account_request(token, reqwest::Method::GET, None)
            .await
    }
    pub async fn restore_login(&self) -> Result<()> {
        if self.0.read_only {
            bail!("ACCOUNT_PREVIEW_READ_ONLY")
        }
        let _op = self.0.operation.lock().await;
        let mut completed = self.0.restore.lock().await;
        if *completed {
            if let Some(owner) = self.0.state.lock().await.owner.clone() {
                owner.recover_storage().await?;
            }
            return Ok(());
        }
        let Some(journal) = &self.0.journal else {
            *completed = true;
            return Ok(());
        };
        {
            let mut state = self.0.state.lock().await;
            state.snapshot.authorization_status = AuthorizationStatus::Restoring;
            state.snapshot.error = None;
        }
        let result = self.restore_saved(journal).await;
        match result {
            Ok(()) => {
                *completed = true;
                Ok(())
            }
            Err(error) => {
                let fixed = error.to_string();
                let mut retryable = matches!(
                    fixed.as_str(),
                    "ACCOUNT_STORE_UNAVAILABLE"
                        | "ACCOUNT_STORE_DELETE_FAILED"
                        | "ACCOUNT_RESTORE_NETWORK"
                ) || error.downcast_ref::<reqwest::Error>().is_some();
                if !retryable {
                    if let Some(owner) = self.0.state.lock().await.restoring_owner.clone() {
                        owner.policy().invalidate(true);
                    }
                    // Invalid identity and unknown dispatch outcomes must not
                    // become restorable again in a later process.
                    if journal.retire().await.is_err() {
                        retryable = true;
                    }
                }
                let mut state = self.0.state.lock().await;
                state.snapshot.signed_in = false;
                state.snapshot.authorization_status = if retryable {
                    AuthorizationStatus::RestoreRetry
                } else {
                    AuthorizationStatus::ReauthRequired
                };
                state.snapshot.error = Some(if retryable {
                    "暂时无法恢复保存的登录。请解锁系统凭据存储并检查网络，然后重试；保存的授权未删除。"
                } else {
                    "保存的授权已失效、结果未知或绑定未通过验证。请退出账号并重新登录；不会重放旧令牌。"
                }.into());
                Err(anyhow::anyhow!(if retryable {
                    "ACCOUNT_RESTORE_RETRY"
                } else {
                    "ACCOUNT_REAUTH_REQUIRED"
                }))
            }
        }
    }
    async fn restore_saved(&self, journal: &Arc<Journal>) -> Result<()> {
        let existing = self.0.state.lock().await.restoring_owner.clone();
        if let Some(owner) = &existing {
            owner.recover_storage().await?;
        }
        let Some(record) = journal.load().await? else {
            self.0.state.lock().await.snapshot.authorization_status =
                AuthorizationStatus::SignedOut;
            return Ok(());
        };
        if record.phase == SavedPhase::Retired {
            journal.delete().await?;
            let mut state = self.0.state.lock().await;
            state.restoring_owner = None;
            state.snapshot.authorization_status = AuthorizationStatus::SignedOut;
            return Ok(());
        }
        let grant = record.grant()?;
        // Check the idempotent public endpoint first. Offline startup should not
        // consume a rotating grant merely to discover it has no route.
        self.restore_preflight().await?;
        let owner = if let Some(owner) = existing {
            owner
        } else {
            let mut owner = GrantOwner::new(grant.clone())?;
            owner.saved = Some((journal.clone(), record.owner.clone()));
            #[cfg(test)]
            if let Some(fixture) = &self.0.restore_fixture {
                owner.token_endpoint = Some(format!("{}/token", fixture.base));
            }
            let owner = Arc::new(owner);
            self.0.state.lock().await.restoring_owner = Some(owner.clone());
            owner
        };
        if owner.policy().logged_out {
            bail!("ACCOUNT_OPERATION_CANCELLED")
        }
        let token = owner.token(true).await?;
        self.verify_restored(&token, &grant.subject).await?;
        // Profile is optional after verified resource identity. Never present
        // the opaque subject as a human name and never erase login for a GET.
        let account_token = owner.token(false).await?;
        let profile = self.restored_profile(&account_token).await.ok();
        if profile
            .as_ref()
            .and_then(|p| p["id"].as_str())
            .is_some_and(|id| id != grant.subject)
        {
            journal.retire().await?;
            bail!("ACCOUNT_IDENTITY_MISMATCH")
        }
        let profile = profile.filter(|p| p["id"].as_str() == Some(&grant.subject));
        let mut state = self.0.state.lock().await;
        if owner.policy().logged_out {
            bail!("ACCOUNT_OPERATION_CANCELLED")
        }
        state.snapshot.subject = Some(grant.subject);
        state.owner = Some(owner);
        state.restoring_owner = None;
        state.snapshot.account_label = profile.as_ref().map(account_label);
        state.snapshot.signed_in = true;
        state.snapshot.authorization_status = AuthorizationStatus::SignedIn;
        state.snapshot.error = None;
        Ok(())
    }
}
