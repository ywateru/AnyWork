//! RAM-only handoff from an authenticated desktop to an exact-origin loopback browser.
use crate::App;
use axum::{
    Json,
    extract::{ConnectInfo, State},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    net::SocketAddr,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tokio_util::sync::CancellationToken;

const TICKET_TTL: Duration = Duration::from_secs(60);
const IDLE_TTL: Duration = Duration::from_secs(3600);
const ABSOLUTE_TTL: Duration = Duration::from_secs(8 * 3600);
pub const PTY_MARKER: &str = "anywork-local-session";
#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublicContext {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account_label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub installation_id: Option<String>,
    #[serde(default)]
    pub remote_enabled: bool,
}
impl PublicContext {
    fn valid(&self) -> bool {
        self.account_label.as_ref().is_none_or(|s| {
            !s.is_empty() && s.chars().count() <= 80 && !s.chars().any(char::is_control)
        }) && self
            .installation_id
            .as_ref()
            .is_none_or(|s| uuid::Uuid::parse_str(s).is_ok())
    }
}
struct Ticket {
    deadline: Instant,
    context: PublicContext,
}
struct Session {
    created: Instant,
    touched: Instant,
    context: PublicContext,
    cancel: CancellationToken,
}
#[derive(Default)]
struct Records {
    tickets: HashMap<String, Ticket>,
    sessions: HashMap<String, Session>,
}
pub struct BrowserSessions {
    port: u16,
    records: Mutex<Records>,
}
#[derive(Clone)]
pub struct LocalAuthorization {
    key: String,
    pub cancel: CancellationToken,
}
fn secret() -> String {
    format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}
fn expired(s: &Session, now: Instant) -> bool {
    now.duration_since(s.created) >= ABSOLUTE_TTL || now.duration_since(s.touched) >= IDLE_TTL
}
impl Records {
    fn cleanup(&mut self, now: Instant) {
        self.tickets.retain(|_, t| now < t.deadline);
        self.sessions.retain(|_, s| {
            if expired(s, now) {
                s.cancel.cancel();
                false
            } else {
                true
            }
        });
    }
}
impl BrowserSessions {
    pub fn new(port: u16) -> Self {
        Self {
            port,
            records: Mutex::new(Records::default()),
        }
    }
    #[cfg(test)]
    pub(crate) fn expire_for_test(&self, absolute: bool) {
        let mut records = self.records.lock().unwrap();
        for session in records.sessions.values_mut() {
            if absolute {
                session.created = Instant::now() - ABSOLUTE_TTL;
            } else {
                session.touched = Instant::now() - IDLE_TTL;
            }
        }
    }
    fn cookie_name(&self) -> String {
        format!("anywork_local_{}", self.port)
    }
    fn cookie(&self, headers: &HeaderMap) -> Option<String> {
        let prefix = format!("{}=", self.cookie_name());
        let mut matches = headers
            .get_all(header::COOKIE)
            .iter()
            .filter_map(|h| h.to_str().ok())
            .flat_map(|s| s.split(';'))
            .filter_map(|s| s.trim().strip_prefix(&prefix));
        let value = matches.next()?;
        if matches.next().is_some()
            || value.len() != 64
            || !value.bytes().all(|b| b.is_ascii_hexdigit())
        {
            return None;
        }
        Some(value.into())
    }
    pub fn direct(&self, peer: SocketAddr, headers: &HeaderMap) -> bool {
        peer.ip().is_loopback()
            && !headers.keys().any(|k| {
                let k = k.as_str();
                k == "forwarded"
                    || k.starts_with("x-forwarded-")
                    || ["cf-connecting-ip", "true-client-ip", "x-real-ip", "via"].contains(&k)
            })
            && headers.get_all(header::HOST).iter().count() == 1
            && headers
                .get(header::HOST)
                .and_then(|h| h.to_str().ok())
                .is_some_and(|h| {
                    [
                        format!("127.0.0.1:{}", self.port),
                        format!("localhost:{}", self.port),
                        format!("[::1]:{}", self.port),
                    ]
                    .contains(&h.to_owned())
                })
    }
    pub fn browser(&self, peer: SocketAddr, headers: &HeaderMap, require_origin: bool) -> bool {
        if !self.direct(peer, headers) {
            return false;
        }
        if headers.get_all(header::ORIGIN).iter().count() > 1 {
            return false;
        }
        let site = headers.get("sec-fetch-site").and_then(|v| v.to_str().ok());
        if site.is_some_and(|s| s != "same-origin") {
            return false;
        }
        match headers.get(header::ORIGIN) {
            Some(origin) => origin.to_str().ok().is_some_and(|o| {
                Some(o)
                    == headers
                        .get(header::HOST)
                        .and_then(|h| h.to_str().ok())
                        .map(|h| format!("http://{h}"))
                        .as_deref()
            }),
            None => !require_origin && site == Some("same-origin"),
        }
    }
    fn mint(&self, context: PublicContext, now: Instant) -> Result<String, StatusCode> {
        if !context.valid() {
            return Err(StatusCode::BAD_REQUEST);
        }
        let mut r = self.records.lock().unwrap_or_else(|e| e.into_inner());
        r.cleanup(now);
        if r.tickets.len() >= 32 {
            return Err(StatusCode::TOO_MANY_REQUESTS);
        }
        let key = secret();
        r.tickets.insert(
            key.clone(),
            Ticket {
                deadline: now + TICKET_TTL,
                context,
            },
        );
        Ok(key)
    }
    fn exchange(&self, ticket: &str, now: Instant) -> Result<(String, PublicContext), StatusCode> {
        let mut r = self.records.lock().unwrap_or_else(|e| e.into_inner());
        r.cleanup(now);
        if r.sessions.len() >= 64 {
            return Err(StatusCode::TOO_MANY_REQUESTS);
        }
        let ticket = r.tickets.remove(ticket).ok_or(StatusCode::UNAUTHORIZED)?;
        let key = secret();
        let context = ticket.context.clone();
        r.sessions.insert(
            key.clone(),
            Session {
                created: now,
                touched: now,
                context: ticket.context,
                cancel: CancellationToken::new(),
            },
        );
        Ok((key, context))
    }
    pub fn authorize(
        &self,
        peer: SocketAddr,
        headers: &HeaderMap,
        require_origin: bool,
    ) -> Option<LocalAuthorization> {
        if headers.contains_key(header::AUTHORIZATION)
            || !self.browser(peer, headers, require_origin)
        {
            return None;
        }
        let key = self.cookie(headers)?;
        let mut r = self.records.lock().unwrap_or_else(|e| e.into_inner());
        let now = Instant::now();
        r.cleanup(now);
        let s = r.sessions.get_mut(&key)?;
        s.touched = now;
        Some(LocalAuthorization {
            key,
            cancel: s.cancel.clone(),
        })
    }
    pub fn live(&self, auth: &LocalAuthorization) -> bool {
        let mut r = self.records.lock().unwrap_or_else(|e| e.into_inner());
        r.cleanup(Instant::now());
        r.sessions.contains_key(&auth.key)
    }
    fn context(&self, auth: &LocalAuthorization) -> Option<PublicContext> {
        self.records
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .sessions
            .get(&auth.key)
            .map(|s| s.context.clone())
    }
    fn revoke(&self, auth: &LocalAuthorization) {
        if let Some(s) = self
            .records
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .sessions
            .remove(&auth.key)
        {
            s.cancel.cancel();
        }
    }
}
fn error(status: StatusCode) -> Response {
    (
        status,
        [(header::CACHE_CONTROL, "no-store")],
        Json(serde_json::json!({"error":"LOCAL_SESSION_UNAVAILABLE"})),
    )
        .into_response()
}
pub async fn ticket(
    State(app): State<Arc<App>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    context: Result<Json<PublicContext>, axum::extract::rejection::JsonRejection>,
) -> Response {
    if !app.local_browser.direct(peer, &headers)
        || headers.contains_key(header::ORIGIN)
        || headers
            .get("x-anywork-service-control")
            .and_then(|v| v.to_str().ok())
            != Some("desktop")
    {
        return error(StatusCode::FORBIDDEN);
    }
    let context = match context {
        Ok(Json(context)) => context,
        Err(error) => return error_response_json(error),
    };
    match app.local_browser.mint(context, Instant::now()) {
        Ok(ticket) => (
            [(header::CACHE_CONTROL, "no-store")],
            Json(serde_json::json!({"ticket":ticket,"expiresIn":60})),
        )
            .into_response(),
        Err(status) => error(status),
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Exchange {
    ticket: String,
}
pub async fn create(
    State(app): State<Arc<App>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    body: Result<Json<Exchange>, axum::extract::rejection::JsonRejection>,
) -> Response {
    if app.stopping.load(std::sync::atomic::Ordering::Relaxed) {
        return error(StatusCode::SERVICE_UNAVAILABLE);
    }
    if !app.local_browser.browser(peer, &headers, true) {
        return error(StatusCode::FORBIDDEN);
    }
    let body = match body {
        Ok(Json(body)) => body,
        Err(error) => return error_response_json(error),
    };
    if body.ticket.len() != 64 || !body.ticket.bytes().all(|b| b.is_ascii_hexdigit()) {
        return error(StatusCode::UNAUTHORIZED);
    }
    match app.local_browser.exchange(&body.ticket, Instant::now()) {
        Ok((key, context)) => (
            [
                (header::CACHE_CONTROL, "no-store".to_owned()),
                (
                    header::SET_COOKIE,
                    format!(
                        "{}={key}; HttpOnly; SameSite=Strict; Path=/",
                        app.local_browser.cookie_name()
                    ),
                ),
            ],
            Json(context),
        )
            .into_response(),
        Err(status) => error(status),
    }
}
pub async fn read(
    State(app): State<Arc<App>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
) -> Response {
    let Some(auth) = app.local_browser.authorize(peer, &headers, false) else {
        return error(StatusCode::UNAUTHORIZED);
    };
    match app.local_browser.context(&auth) {
        Some(context) => ([(header::CACHE_CONTROL, "no-store")], Json(context)).into_response(),
        None => error(StatusCode::UNAUTHORIZED),
    }
}
pub async fn delete(
    State(app): State<Arc<App>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
) -> Response {
    let Some(auth) = app.local_browser.authorize(peer, &headers, true) else {
        return error(StatusCode::UNAUTHORIZED);
    };
    app.local_browser.revoke(&auth);
    (
        [
            (header::CACHE_CONTROL, "no-store".to_owned()),
            (
                header::SET_COOKIE,
                format!(
                    "{}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
                    app.local_browser.cookie_name()
                ),
            ),
        ],
        Json(serde_json::json!({"ok":true})),
    )
        .into_response()
}

fn error_response_json(rejection: axum::extract::rejection::JsonRejection) -> Response {
    error(if rejection.status() == StatusCode::PAYLOAD_TOO_LARGE {
        StatusCode::PAYLOAD_TOO_LARGE
    } else {
        StatusCode::BAD_REQUEST
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn headers(port: u16) -> HeaderMap {
        let mut h = HeaderMap::new();
        h.insert(header::HOST, format!("127.0.0.1:{port}").parse().unwrap());
        h.insert(
            header::ORIGIN,
            format!("http://127.0.0.1:{port}").parse().unwrap(),
        );
        h
    }
    #[test]
    fn direct_origin_and_proxy_boundaries_are_exact() {
        let store = BrowserSessions::new(3210);
        let peer = "127.0.0.1:40000".parse().unwrap();
        let h = headers(3210);
        assert!(store.browser(peer, &h, true));
        assert!(!store.browser("192.0.2.4:40000".parse().unwrap(), &h, true));
        assert!(!store.browser(peer, &headers(3211), true));
        for field in [
            "forwarded",
            "x-forwarded-for",
            "x-forwarded-anything",
            "cf-connecting-ip",
            "x-real-ip",
            "true-client-ip",
            "via",
        ] {
            let mut bad = h.clone();
            bad.insert(
                axum::http::HeaderName::from_bytes(field.as_bytes()).unwrap(),
                "spoofed".parse().unwrap(),
            );
            assert!(!store.browser(peer, &bad, true));
        }
        for origin in [
            "null",
            "http://localhost:3210",
            "https://127.0.0.1:3210",
            "http://127.0.0.1:3210.evil.test",
        ] {
            let mut bad = h.clone();
            bad.insert(header::ORIGIN, origin.parse().unwrap());
            assert!(!store.browser(peer, &bad, false));
        }
        let mut duplicate = h.clone();
        duplicate.append(header::ORIGIN, h[header::ORIGIN].clone());
        assert!(!store.browser(peer, &duplicate, false));
        let mut no_origin = h.clone();
        no_origin.remove(header::ORIGIN);
        assert!(!store.browser(peer, &no_origin, false));
        no_origin.insert("sec-fetch-site", "same-origin".parse().unwrap());
        assert!(store.browser(peer, &no_origin, false));
        assert!(!store.browser(peer, &no_origin, true));
        for site in ["same-site", "none", "cross-site"] {
            no_origin.insert("sec-fetch-site", site.parse().unwrap());
            assert!(!store.browser(peer, &no_origin, false));
        }
    }
    #[test]
    fn tickets_are_atomic_one_use_expiring_and_bounded() {
        let store = Arc::new(BrowserSessions::new(3210));
        let now = Instant::now();
        let ticket = store.mint(PublicContext::default(), now).unwrap();
        let handles: Vec<_> = (0..8)
            .map(|_| {
                let s = store.clone();
                let t = ticket.clone();
                std::thread::spawn(move || s.exchange(&t, now).is_ok())
            })
            .collect();
        assert_eq!(
            handles
                .into_iter()
                .map(|h| h.join().unwrap() as usize)
                .sum::<usize>(),
            1
        );
        let ticket = store.mint(PublicContext::default(), now).unwrap();
        assert!(store.exchange(&ticket, now + TICKET_TTL).is_err());
        let store = BrowserSessions::new(3210);
        for _ in 0..32 {
            store.mint(PublicContext::default(), now).unwrap();
        }
        assert_eq!(
            store.mint(PublicContext::default(), now).err(),
            Some(StatusCode::TOO_MANY_REQUESTS)
        );
        assert!(
            store
                .mint(PublicContext::default(), now + TICKET_TTL)
                .is_ok()
        );
    }
    #[test]
    fn session_capacity_logout_idle_and_absolute_expiry_cancel_authorizations() {
        let store = BrowserSessions::new(3210);
        let now = Instant::now();
        let mut keys = vec![];
        for _ in 0..64 {
            let t = store.mint(PublicContext::default(), now).unwrap();
            keys.push(store.exchange(&t, now).unwrap().0);
        }
        let t = store.mint(PublicContext::default(), now).unwrap();
        assert_eq!(
            store.exchange(&t, now).err(),
            Some(StatusCode::TOO_MANY_REQUESTS)
        );
        let peer = "127.0.0.1:40000".parse().unwrap();
        let mut h = headers(3210);
        h.insert(
            header::COOKIE,
            format!("{}={}", store.cookie_name(), keys[0])
                .parse()
                .unwrap(),
        );
        let auth = store.authorize(peer, &h, true).unwrap();
        store.revoke(&auth);
        assert!(auth.cancel.is_cancelled());
        assert!(store.authorize(peer, &h, false).is_none());
        h.insert(
            header::COOKIE,
            format!("{}={}", store.cookie_name(), keys[1])
                .parse()
                .unwrap(),
        );
        let auth = store.authorize(peer, &h, true).unwrap();
        {
            let mut r = store.records.lock().unwrap();
            r.sessions.get_mut(&keys[1]).unwrap().touched = now - IDLE_TTL;
        }
        assert!(!store.live(&auth));
        assert!(auth.cancel.is_cancelled());
        h.insert(
            header::COOKIE,
            format!("{}={}", store.cookie_name(), keys[2])
                .parse()
                .unwrap(),
        );
        let auth = store.authorize(peer, &h, true).unwrap();
        {
            let mut r = store.records.lock().unwrap();
            r.sessions.get_mut(&keys[2]).unwrap().created = now - ABSOLUTE_TTL;
        }
        assert!(!store.live(&auth));
        assert!(auth.cancel.is_cancelled());
        h.insert(header::AUTHORIZATION, "Bearer invalid".parse().unwrap());
        assert!(store.authorize(peer, &h, true).is_none());
    }
    #[test]
    fn context_rejects_private_or_unbounded_fields() {
        assert!(
            serde_json::from_value::<PublicContext>(serde_json::json!({"subject":"forbidden"}))
                .is_err()
        );
        for label in ["".to_owned(), "x".repeat(81), "line\nbreak".to_owned()] {
            assert!(
                !PublicContext {
                    account_label: Some(label),
                    ..Default::default()
                }
                .valid()
            );
        }
        assert!(
            PublicContext {
                account_label: Some("界".repeat(80)),
                ..Default::default()
            }
            .valid()
        );
        assert!(
            !PublicContext {
                installation_id: Some("arbitrary".into()),
                ..Default::default()
            }
            .valid()
        );
    }
}
