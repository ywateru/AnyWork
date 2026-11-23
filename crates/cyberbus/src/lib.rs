//! CyberBus overlay integration without transferring OAuth ownership away from AnyWork.
//!
//! The host obtains a `network:join` access token from its existing Logto owner.
//! This crate verifies that token, derives the CyberBus network material, and
//! exposes a bounded overlay listener. It never accepts or persists a refresh token.
mod auth;
mod locator;
mod overlay;

pub use auth::{
    CREDENTIAL_CLAIM, NetworkCredentials, NetworkVerifier, RealClock, SystemClock, VerifiedNetwork,
};
pub use cyberbus_transport::AsyncStream;
pub use locator::{Locator, LocatorError};
pub use overlay::{
    DEFAULT_SERVICE_PORT, Network, Overlay, OverlayConfig, OverlayError, SERVICE_PROTOCOL,
};
