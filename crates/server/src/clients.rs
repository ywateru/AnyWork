//! Authenticated device presence. Entries expire; no credential is retained.
use crate::{ApiError, App};
use axum::{Json, extract::State, http::HeaderMap};
use serde::Serialize;
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    net::{IpAddr, SocketAddr},
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

const TTL_MS: u64 = 90_000;
#[derive(Clone, Serialize)]
pub struct Client {
    id: String,
    address: String,
    user_agent: String,
    connected_at: u64,
    last_seen: u64,
}
#[derive(Default)]
pub struct Clients(Mutex<HashMap<String, Client>>);
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn address(peer: SocketAddr, headers: &HeaderMap, trust_local_proxy: bool) -> IpAddr {
    if trust_local_proxy
        && peer.ip().is_loopback()
        && let Some(ip) = headers
            .get("cf-connecting-ip")
            .and_then(|h| h.to_str().ok())
            .and_then(|v| v.parse().ok())
    {
        return ip;
    }
    peer.ip()
}
impl Clients {
    pub fn record(&self, headers: &HeaderMap, peer: SocketAddr, trust_local_proxy: bool) {
        let Some(id) = headers
            .get("x-anywork-client-id")
            .and_then(|h| h.to_str().ok())
            .filter(|s| {
                (16..=80).contains(&s.len())
                    && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
            })
        else {
            return;
        };
        self.record_at(
            id,
            address(peer, headers, trust_local_proxy).to_string(),
            headers
                .get("user-agent")
                .and_then(|h| h.to_str().ok())
                .unwrap_or("Unknown")
                .chars()
                .take(240)
                .collect(),
            now(),
        );
    }
    fn record_at(&self, id: &str, address: String, user_agent: String, time: u64) {
        let mut entries = self.0.lock().unwrap_or_else(|e| e.into_inner());
        entries.retain(|_, c| time.saturating_sub(c.last_seen) < TTL_MS);
        if !entries.contains_key(id) && entries.len() >= 256 {
            return;
        }
        let client = entries.entry(id.into()).or_insert_with(|| Client {
            id: id.into(),
            address: address.clone(),
            user_agent: user_agent.clone(),
            connected_at: time,
            last_seen: time,
        });
        client.address = address;
        client.user_agent = user_agent;
        client.last_seen = time;
    }
    fn list_at(&self, time: u64) -> Vec<Client> {
        let mut entries = self.0.lock().unwrap_or_else(|e| e.into_inner());
        entries.retain(|_, c| time.saturating_sub(c.last_seen) < TTL_MS);
        let mut clients: Vec<_> = entries.values().cloned().collect();
        clients.sort_by_key(|c| std::cmp::Reverse(c.last_seen));
        clients
    }
}
pub async fn list(State(app): State<Arc<App>>) -> Result<Json<Value>, ApiError> {
    Ok(Json(
        json!({"clients":app.clients.list_at(now()), "expires_after_seconds":90}),
    ))
}
pub async fn heartbeat() -> Json<Value> {
    Json(json!({"ok":true}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_explicit_loopback_proxy_can_supply_client_address() {
        let mut headers = HeaderMap::new();
        headers.insert("cf-connecting-ip", "203.0.113.5".parse().unwrap());
        let local = "127.0.0.1:4321".parse().unwrap();
        assert_eq!(address(local, &headers, false).to_string(), "127.0.0.1");
        assert_eq!(address(local, &headers, true).to_string(), "203.0.113.5");
        assert_eq!(
            address("192.0.2.1:4321".parse().unwrap(), &headers, true).to_string(),
            "192.0.2.1"
        );
    }
    #[test]
    fn devices_update_and_expire_without_saving_secrets() {
        let clients = Clients::default();
        clients.record_at("device", "192.0.2.1".into(), "Android".into(), 1000);
        clients.record_at("device", "192.0.2.2".into(), "Android".into(), 2000);
        let list = clients.list_at(3000);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].connected_at, 1000);
        assert_eq!(list[0].last_seen, 2000);
        assert_eq!(list[0].address, "192.0.2.2");
        assert!(clients.list_at(92_000).is_empty());
    }
    #[test]
    fn presence_is_bounded() {
        let clients = Clients::default();
        for i in 0..300 {
            clients.record_at(&i.to_string(), "127.0.0.1".into(), "test".into(), 0);
        }
        assert_eq!(clients.list_at(0).len(), 256);
    }
}
