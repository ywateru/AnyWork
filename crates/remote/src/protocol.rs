use anyhow::{Result, bail};
use serde::Deserialize;
use std::collections::HashSet;
pub const NOISE_SUITE: &str = "Noise_IK_25519_ChaChaPoly_SHA256";
pub const MAX_BODY: usize = 22 * 1024 * 1024;
pub const CHUNK: usize = 32768;
pub fn prologue(installation: &str) -> Vec<u8> {
    format!("AnyWork\0remote-v1\0{installation}").into_bytes()
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Authentication {
    pub r#type: String,
    #[serde(rename = "installationId")]
    pub installation_id: String,
    #[serde(rename = "accessToken")]
    pub access_token: String,
}
#[derive(Deserialize)]
#[serde(tag = "type", deny_unknown_fields)]
pub enum Incoming {
    #[serde(rename = "auth.renew")]
    AuthRenew {
        id: u64,
        #[serde(rename = "accessToken")]
        access_token: String,
    },
    #[serde(rename = "request")]
    Request {
        id: String,
        method: String,
        path: String,
        #[serde(rename = "contentType")]
        content_type: Option<String>,
        size: usize,
    },
    #[serde(rename = "chunk")]
    Chunk { id: String, data: String },
    #[serde(rename = "end")]
    End { id: String },
    #[serde(rename = "cancel")]
    Cancel { id: String },
    #[serde(rename = "pty.open")]
    PtyOpen {
        id: String,
        #[serde(rename = "sessionId")]
        session_id: String,
    },
    #[serde(rename = "pty.input")]
    PtyInput { id: String, data: String },
    #[serde(rename = "pty.resize")]
    PtyResize { id: String, cols: u16, rows: u16 },
    #[serde(rename = "pty.close")]
    PtyClose { id: String },
}
pub fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
}
/// Product request IDs are monotonic, so a renewed connection needs no growing
/// replay set. Preserve the bounded legacy namespace for older custom clients.
#[derive(Default)]
pub(crate) struct RequestIds {
    generated: u64,
    legacy: HashSet<String>,
}
impl RequestIds {
    pub(crate) fn insert(&mut self, id: &str) -> bool {
        if !valid_id(id) {
            return false;
        }
        if let Some(number) = id.strip_prefix('r').filter(|v| {
            v.as_bytes()
                .first()
                .is_some_and(|c| matches!(c, b'1'..=b'9'))
                && v.bytes().all(|c| c.is_ascii_digit())
        }) {
            let Ok(number) = number.parse::<u64>() else {
                return false;
            };
            if number <= self.generated || number > 9_007_199_254_740_991 {
                return false;
            }
            self.generated = number;
            return true;
        }
        self.legacy.len() < 1024 && self.legacy.insert(id.to_owned())
    }
}
fn resource_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 256 && id.bytes().all(|c| c >= 0x20 && c != 0x7f)
}
pub fn allowed_path(method: &str, raw: &str) -> Result<()> {
    if !["GET", "POST", "PUT", "PATCH", "DELETE"].contains(&method)
        || raw.len() > 16384
        || raw.contains(['#', '\\', '\r', '\n', '\0'])
    {
        bail!("INVALID_REQUEST")
    }
    let path = raw.split('?').next().unwrap_or("");
    if path.contains("//") || path.split('/').any(|p| p == "." || p == "..") {
        bail!("INVALID_REQUEST")
    }
    let decoded: Vec<String> = path
        .split('/')
        .map(|part| {
            percent_encoding::percent_decode_str(part)
                .decode_utf8()
                .map(|v| v.into_owned())
        })
        .collect::<std::result::Result<_, _>>()?;
    if decoded
        .iter()
        .any(|p| p == "." || p == ".." || p.contains(['/', '\\', '%', '\0', '\r', '\n']))
    {
        bail!("INVALID_REQUEST")
    }
    let parts: Vec<&str> = decoded.iter().map(String::as_str).collect();
    let allowed = match parts.as_slice() {
        ["", "api", endpoint] => match *endpoint {
            "info" | "update-readiness" | "plugins" | "workspaces" | "clients" => method == "GET",
            "sessions" => ["GET", "POST"].contains(&method),
            _ => false,
        },
        ["", "api", "clients", "heartbeat"] => method == "POST",
        ["", "api", "events", "poll"] => method == "GET",
        ["", "api", "sessions", id] if resource_id(id) => {
            ["GET", "PATCH", "DELETE"].contains(&method)
        }
        ["", "api", "sessions", id, endpoint] if resource_id(id) => match *endpoint {
            "messages" | "fork" | "interrupt" | "connect" | "respond" | "uploads" => {
                method == "POST"
            }
            "capabilities" | "history" | "export" | "models" | "image" | "document" | "git"
            | "review" => method == "GET",
            "edit" | "queue" | "composer" => ["GET", "POST"].contains(&method),
            "feedback" => method == "GET",
            "files" => ["GET", "PUT"].contains(&method),
            _ => false,
        },
        ["", "api", "sessions", id, group, endpoint] if resource_id(id) => {
            method == "GET"
                && [(*group, *endpoint)].iter().any(|p| {
                    [
                        ("events", "poll"),
                        ("history", "item"),
                        ("review", "commits"),
                    ]
                    .contains(p)
                })
        }
        ["", "api", "sessions", id, "feedback", item] if resource_id(id) && resource_id(item) => {
            ["GET", "PUT", "DELETE"].contains(&method)
        }
        ["", "api", "sessions", id, "edit", item] if resource_id(id) && resource_id(item) => {
            method == "DELETE"
        }
        _ => false,
    };
    if !allowed {
        bail!("ROUTE_REJECTED")
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn local_boundary_rejects_url_traversal_and_admin() {
        for path in [
            "http://localhost/api/info",
            "//evil/api/info",
            "/api/service/stop",
            "/api/health",
            "/api/sessions/a/../info",
            "/api/sessions/a%2fb",
            "/api/info#x",
        ] {
            assert!(allowed_path("GET", path).is_err(), "{path}");
        }
        assert!(allowed_path("GET", "/api/sessions/abc/files?path=%2Ftmp%2Fa").is_ok());
        assert!(allowed_path("GET", "/api/sessions/abc/events").is_err());
        assert!(allowed_path("GET", "/api/events/poll?after=123").is_ok());
    }
    #[test]
    fn reject_unknown_wire_variants_and_fields() {
        for raw in [
            r#"{"type":"future"}"#,
            r#"{"type":"end","id":"x","authorization":"s"}"#,
        ] {
            assert!(serde_json::from_str::<Incoming>(raw).is_err());
        }
    }
    #[test]
    fn generated_ids_are_bounded_monotonic_and_keep_legacy_replay_protection() {
        let mut ids = RequestIds::default();
        for n in 1..=2048 {
            assert!(ids.insert(&format!("r{n}")));
        }
        assert!(!ids.insert("r2048"));
        assert!(!ids.insert("r1"));
        for id in ["r01", "r0", "legacy", "r-not-decimal"] {
            assert!(ids.insert(id));
            assert!(!ids.insert(id));
        }
        assert!(!ids.insert("r9007199254740992"));
        assert!(!ids.insert("r9999999999999999999999999999999"));
        assert!(ids.insert("r9007199254740991"));
        assert!(!ids.insert("r9007199254740991"));
        assert_eq!(ids.legacy.len(), 4);
    }
}
