//! Android owns the only Logto client. Refresh and ID tokens never cross JNI.
use anyhow::{Result, bail};
use serde::{Deserialize, Serialize};
use tauri::{Manager, Runtime, plugin::TauriPlugin};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub subject: String,
    pub display_name: String,
    pub username: Option<String>,
    pub email: Option<String>,
    pub picture: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub generation: u64,
    pub status: String,
    pub profile: Option<Profile>,
    pub error_code: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Configuration {
    pub endpoint: String,
    pub client_id: String,
    pub resource: String,
    pub redirect_uri: String,
}

// Deliberately neither Debug nor Serialize. Returned only to Rust native callers.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccessGrant {
    pub access_token: String,
    pub expires_at: u64,
    pub generation: u64,
}

pub struct MobileAuth<R: Runtime> {
    #[cfg(target_os = "android")]
    handle: tauri::plugin::PluginHandle<R>,
    #[cfg(not(target_os = "android"))]
    runtime: std::marker::PhantomData<fn() -> R>,
}

impl<R: Runtime> MobileAuth<R> {
    async fn call<T: serde::de::DeserializeOwned>(
        &self,
        command: &str,
        payload: impl Serialize,
    ) -> Result<T> {
        #[cfg(target_os = "android")]
        {
            self.handle
                .run_mobile_plugin_async(command, payload)
                .await
                // Native errors must never include provider responses, URLs or tokens.
                .map_err(|_| anyhow::anyhow!("MOBILE_AUTH_OPERATION_FAILED"))
        }
        #[cfg(not(target_os = "android"))]
        {
            let _ = (command, payload);
            bail!("MOBILE_AUTH_UNSUPPORTED")
        }
    }

    pub async fn configure(&self, configuration: Configuration) -> Result<Snapshot> {
        self.call("configure", configuration).await
    }
    pub async fn snapshot(&self) -> Result<Snapshot> {
        self.call("snapshot", ()).await
    }
    pub async fn sign_in(&self, register: bool) -> Result<Snapshot> {
        #[derive(Serialize)]
        struct Args {
            register: bool,
        }
        self.call("signIn", Args { register }).await
    }
    pub async fn logout(&self) -> Result<Snapshot> {
        self.call("logout", ()).await
    }
    pub async fn profile(&self, generation: u64) -> Result<Snapshot> {
        #[derive(Serialize)]
        struct Args {
            generation: u64,
        }
        self.call("profile", Args { generation }).await
    }
    pub async fn token(
        &self,
        generation: u64,
        resource: bool,
        force_refresh: bool,
        min_validity: u64,
    ) -> Result<AccessGrant> {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Args {
            generation: u64,
            resource: bool,
            force_refresh: bool,
            min_validity: u64,
        }
        self.call(
            "token",
            Args {
                generation,
                resource,
                force_refresh,
                min_validity,
            },
        )
        .await
    }
}

pub trait MobileAuthExt<R: Runtime> {
    fn mobile_auth(&self) -> &MobileAuth<R>;
}
impl<R: Runtime, T: Manager<R>> MobileAuthExt<R> for T {
    fn mobile_auth(&self) -> &MobileAuth<R> {
        self.state::<MobileAuth<R>>().inner()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    tauri::plugin::Builder::new("mobile-auth")
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            let auth = MobileAuth {
                handle: api.register_android_plugin("dev.anywork.auth", "MobileAuthPlugin")?,
            };
            #[cfg(not(target_os = "android"))]
            let auth = {
                let _ = api;
                MobileAuth::<R> {
                    runtime: std::marker::PhantomData,
                }
            };
            app.manage(auth);
            Ok(())
        })
        .build()
}
