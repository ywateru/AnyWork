//! The only remotely exposed AnyWork business endpoint: bounded Noise IK over WS.
//! The existing local bearer never crosses this gateway's trust boundary.
pub mod auth;
pub mod gateway;
pub mod protocol;
pub use auth::{AccountVerifier, JwtVerifier, VerifiedAccount};
pub use gateway::{ClientKind, Gateway, GatewayConfig, RemoteClient};
pub use protocol::{NOISE_SUITE, prologue};
