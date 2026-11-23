use serde::{Deserialize, Serialize};
use std::net::Ipv4Addr;

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum LocatorError {
    #[error("DEVICE_LOCATOR_REJECTED")]
    Invalid,
    #[error("DEVICE_LOCATOR_STALE")]
    Stale,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Locator {
    pub version: u8,
    pub product_id: String,
    pub ipv4: String,
    pub port: u16,
    pub key_version: u64,
    pub issued_at: u64,
    pub expires_at: u64,
}
impl Locator {
    pub fn new(
        product_id: String,
        ipv4: Ipv4Addr,
        port: u16,
        key_version: u64,
        issued_at: u64,
        expires_at: u64,
    ) -> Result<Self, LocatorError> {
        let value = Self {
            version: 1,
            product_id,
            ipv4: ipv4.to_string(),
            port,
            key_version,
            issued_at,
            expires_at,
        };
        value.validate(issued_at)?;
        Ok(value)
    }
    pub fn validate(&self, now: u64) -> Result<(), LocatorError> {
        let address = self
            .ipv4
            .parse::<Ipv4Addr>()
            .map_err(|_| LocatorError::Invalid)?;
        let octets = address.octets();
        if self.version != 1
            || self.product_id.is_empty()
            || self.product_id.len() > 64
            || self.port == 0
            || self.port == 11_000
            || self.key_version == 0
            || self.key_version > 9_007_199_254_740_991
            || self.expires_at <= self.issued_at
            || self.expires_at.saturating_sub(self.issued_at) > 86_400
            || octets[0] != 10
            || octets[1] != 144
            || octets[2] & 0xf0 != 0
        {
            return Err(LocatorError::Invalid);
        }
        if self.expires_at <= now {
            return Err(LocatorError::Stale);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounds_issued_address_port_and_lifetime() {
        let value = Locator::new(
            "anywork".into(),
            "10.144.7.8".parse().unwrap(),
            11_001,
            1,
            100,
            200,
        )
        .unwrap();
        assert_eq!(value.validate(150), Ok(()));
        assert_eq!(value.validate(200), Err(LocatorError::Stale));
        assert_eq!(value.validate(200).unwrap_err(), LocatorError::Stale);
        assert!(
            Locator::new(
                "anywork".into(),
                "10.145.7.8".parse().unwrap(),
                11_001,
                1,
                100,
                200
            )
            .is_err()
        );
        assert!(
            Locator::new(
                "anywork".into(),
                "10.144.7.8".parse().unwrap(),
                11_000,
                1,
                100,
                200
            )
            .is_err()
        );
    }
}
