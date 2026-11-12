#[cfg(unix)]
pub mod accounts;
#[cfg(not(unix))]
#[path = "accounts_unsupported.rs"]
pub mod accounts;
pub mod bridge;
pub mod cloudflared;
pub mod config;
mod device_name;
pub mod manager;
pub mod process;
pub mod updates;

// Compile and exercise the account-unavailable platform's public naming
// boundary on Unix too, without pretending its OAuth flow is supported.
#[cfg(all(test, unix))]
#[allow(dead_code)]
#[path = "accounts_unsupported.rs"]
mod unsupported_account_contract;

#[cfg(all(test, unix))]
mod test_service;
