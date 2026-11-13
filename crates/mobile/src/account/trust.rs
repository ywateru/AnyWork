//! Only public key confirmations are persisted. No account subject or credential.
use anyhow::{Result, ensure};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, io::Write, path::PathBuf};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Pin {
    pub public_key: String,
    pub key_version: u64,
}
#[derive(Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct File {
    version: u8,
    pins: BTreeMap<String, Pin>,
}
pub(super) struct TrustStore {
    path: Option<PathBuf>,
    pins: BTreeMap<String, Pin>,
}
impl TrustStore {
    pub fn load(path: Option<PathBuf>) -> Result<Self> {
        let mut pins = BTreeMap::new();
        if let Some(path) = &path {
            match std::fs::symlink_metadata(path) {
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
                Err(_) => anyhow::bail!("TRUST_STORAGE_UNAVAILABLE"),
                Ok(metadata) => {
                    ensure!(
                        metadata.is_file()
                            && !metadata.file_type().is_symlink()
                            && metadata.len() <= 524288,
                        "INVALID_TRUST_STORAGE"
                    );
                    let file: File = serde_json::from_slice(&std::fs::read(path)?)
                        .map_err(|_| anyhow::anyhow!("INVALID_TRUST_STORAGE"))?;
                    ensure!(
                        file.version == 1 && file.pins.len() <= 2048,
                        "INVALID_TRUST_STORAGE"
                    );
                    ensure!(
                        file.pins.iter().all(|(id, p)| id.len() == 64
                            && id.bytes().all(|b| b.is_ascii_hexdigit())
                            && super::key_valid(&p.public_key)
                            && p.key_version > 0),
                        "INVALID_TRUST_STORAGE"
                    );
                    pins = file.pins;
                }
            }
        }
        Ok(Self { path, pins })
    }
    fn id(scope: &str, installation: &str) -> String {
        super::digest(&["mobile-trust-v1", scope, installation])
    }
    pub fn get(&self, scope: &str, installation: &str) -> Option<&Pin> {
        self.pins.get(&Self::id(scope, installation))
    }
    pub fn save(&mut self, scope: &str, installation: &str, pin: Pin) -> Result<()> {
        let id = Self::id(scope, installation);
        ensure!(
            self.pins.contains_key(&id) || self.pins.len() < 2048,
            "TRUST_STORAGE_FULL"
        );
        let mut pins = self.pins.clone();
        pins.insert(id, pin);
        if let Some(path) = &self.path {
            let parent = path
                .parent()
                .ok_or_else(|| anyhow::anyhow!("TRUST_STORAGE_UNAVAILABLE"))?;
            std::fs::create_dir_all(parent)?;
            ensure!(
                !std::fs::symlink_metadata(parent)?.file_type().is_symlink(),
                "INVALID_TRUST_STORAGE"
            );
            let mut file = tempfile::NamedTempFile::new_in(parent)?;
            file.write_all(&serde_json::to_vec(&File {
                version: 1,
                pins: pins.clone(),
            })?)?;
            file.as_file().sync_all()?;
            file.persist(path)
                .map_err(|_| anyhow::anyhow!("TRUST_STORAGE_UNAVAILABLE"))?;
        }
        self.pins = pins;
        Ok(())
    }
}
