//! Internal staged ledger. Not wired to HTTP/native dispatch until I02b.
//! Typed methods are intentionally unused by the current sending API.
use super::{Event, Session, Store, now};
use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{fmt, sync::atomic::Ordering};
use uuid::Uuid;

pub(super) const DDL: &str = "
CREATE TABLE message_ledger_identity(singleton INTEGER PRIMARY KEY CHECK(singleton=1), store_id TEXT NOT NULL, ledger_incarnation TEXT NOT NULL, identity_version INTEGER NOT NULL CHECK(identity_version=1), created_at INTEGER NOT NULL);
CREATE TABLE message_operation_ids(operation_id TEXT PRIMARY KEY NOT NULL, session_id TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(operation_id,session_id));
CREATE TABLE message_operations(operation_id TEXT PRIMARY KEY NOT NULL, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, agent TEXT NOT NULL, thread_id TEXT, phase TEXT NOT NULL CHECK(phase IN ('recorded','queued','dispatching','accepted','rejected','uncertain','cancelled','superseded')), preparation TEXT NOT NULL CHECK(preparation IN ('not_started','preparing','prepared','failed','uncertain')), goal TEXT NOT NULL CHECK(goal IN ('not_requested','pending','accepted','rejected','uncertain')), recording TEXT NOT NULL CHECK(recording IN ('normal','result_pending','recovery_required')), revision INTEGER NOT NULL CHECK(revision>0), data TEXT NOT NULL, UNIQUE(operation_id,session_id), FOREIGN KEY(operation_id,session_id) REFERENCES message_operation_ids(operation_id,session_id));
CREATE INDEX message_operations_session ON message_operations(session_id,operation_id);
CREATE INDEX message_operations_binding ON message_operations(agent,thread_id,recording);
CREATE TABLE message_operation_preparation(operation_id TEXT NOT NULL REFERENCES message_operations(operation_id) ON DELETE CASCADE, ordinal INTEGER NOT NULL CHECK(ordinal>=0), claim_id TEXT NOT NULL UNIQUE, kind TEXT NOT NULL CHECK(kind IN ('snapshot','goal_artifact','thread_start','thread_resume','thread_fallback','upload')), phase TEXT NOT NULL CHECK(phase IN ('claimed','confirmed','failed','uncertain')), specification TEXT NOT NULL, receipt TEXT, PRIMARY KEY(operation_id,ordinal));
CREATE TABLE message_operation_queue(queue_seq INTEGER PRIMARY KEY CHECK(queue_seq>0), operation_id TEXT NOT NULL UNIQUE, session_id TEXT NOT NULL, location TEXT NOT NULL CHECK(location IN ('queue','editing')), FOREIGN KEY(operation_id,session_id) REFERENCES message_operations(operation_id,session_id) ON DELETE CASCADE);";

pub const MAX_CANONICAL: usize = 22 * 1024 * 1024;
const MAX_FILE: u64 = 20 * 1024 * 1024;
const MAX_TOTAL: u64 = 64 * 1024 * 1024;
const MAX_FILES: usize = 16;
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ErrorKind {
    Invalid,
    IdentityMismatch,
    BindingConflict,
    IntentConflict,
    UsedId,
    Missing,
    Conflict,
    IllegalTransition,
    Fenced,
    Corrupt,
    Storage,
    RecordingFailure,
}
#[derive(Debug)]
pub struct Error {
    pub kind: ErrorKind,
    pub message: String,
}
impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}: {}", self.kind, self.message)
    }
}
impl std::error::Error for Error {}
impl From<rusqlite::Error> for Error {
    fn from(e: rusqlite::Error) -> Self {
        err(ErrorKind::Storage, e.to_string())
    }
}
impl From<serde_json::Error> for Error {
    fn from(e: serde_json::Error) -> Self {
        err(ErrorKind::Corrupt, e.to_string())
    }
}
pub type Result<T> = std::result::Result<T, Error>;
fn err(kind: ErrorKind, message: impl Into<String>) -> Error {
    Error {
        kind,
        message: message.into(),
    }
}
fn require(yes: bool, kind: ErrorKind, message: &str) -> Result<()> {
    if yes { Ok(()) } else { Err(err(kind, message)) }
}
macro_rules! states { ($name:ident { $($variant:ident => $text:literal),+ $(,)? }) => {
    #[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
    pub enum $name { $(#[serde(rename=$text)] $variant),+ }
    impl $name { fn sql(self) -> &'static str { match self { $(Self::$variant => $text),+ } }
        fn parse(s:&str)->Result<Self>{match s{$($text=>Ok(Self::$variant)),+, _=>Err(err(ErrorKind::Corrupt,"Unknown ledger state"))}} }
};
 }
states!(InputPhase { Recorded=>"recorded", Queued=>"queued", Dispatching=>"dispatching", Accepted=>"accepted", Rejected=>"rejected", Uncertain=>"uncertain", Cancelled=>"cancelled", Superseded=>"superseded" });
states!(PreparationPhase { NotStarted=>"not_started", Preparing=>"preparing", Prepared=>"prepared", Failed=>"failed", Uncertain=>"uncertain" });
states!(GoalPhase { NotRequested=>"not_requested", Pending=>"pending", Accepted=>"accepted", Rejected=>"rejected", Uncertain=>"uncertain" });
states!(Recording { Normal=>"normal", ResultPending=>"result_pending", RecoveryRequired=>"recovery_required" });
states!(StepPhase { Claimed=>"claimed", Confirmed=>"confirmed", Failed=>"failed", Uncertain=>"uncertain" });
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Mode {
    #[default]
    Auto,
    Start,
    Steer,
    Queue,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Composer {
    pub markdown: String,
    pub document: Value,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Intent {
    pub text: String,
    #[serde(default)]
    pub attachments: Vec<String>,
    #[serde(default)]
    pub composer: Option<Composer>,
    #[serde(default)]
    pub goal: bool,
    #[serde(default, deserialize_with = "nullable_mode")]
    pub mode: Mode,
    #[serde(default)]
    pub queue_if_busy: bool,
}
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CanonicalIntent {
    pub version: u32,
    pub bytes: String,
    pub sha256: String,
}
fn nullable_mode<'de, D: serde::Deserializer<'de>>(d: D) -> std::result::Result<Mode, D::Error> {
    Ok(Option::<Mode>::deserialize(d)?.unwrap_or_default())
}
impl Intent {
    pub fn canonical(&self) -> Result<CanonicalIntent> {
        require(
            !self.text.trim().is_empty() || !self.attachments.is_empty(),
            ErrorKind::Invalid,
            "Empty message",
        )?;
        require(
            self.attachments.len() <= MAX_FILES,
            ErrorKind::Invalid,
            "Too many attachments",
        )?;
        require(
            self.attachments
                .iter()
                .all(|p| !p.is_empty() && !p.contains('\0')),
            ErrorKind::Invalid,
            "Invalid attachment reference",
        )?;
        if let Some(c) = &self.composer {
            require(
                c.document["type"] == "doc" && c.document["content"].is_array(),
                ErrorKind::Invalid,
                "Invalid composer",
            )?;
        }
        require(
            self.text.len() <= MAX_CANONICAL,
            ErrorKind::Invalid,
            "Text exceeds canonical budget",
        )?;
        if let Some(c) = &self.composer {
            require(
                c.markdown.len() <= MAX_CANONICAL,
                ErrorKind::Invalid,
                "Markdown exceeds canonical budget",
            )?;
            let mut used = 0;
            bounded_document(&c.document, 2, &mut used)?;
        }
        let value = serde_json::to_value(self)?;
        let mut bytes = String::new();
        canonical_json(&value, 0, &mut bytes)?;
        Ok(CanonicalIntent {
            version: 1,
            sha256: hash(bytes.as_bytes()),
            bytes,
        })
    }
}
fn bounded_document(value: &Value, depth: usize, used: &mut usize) -> Result<()> {
    require(
        depth <= 128,
        ErrorKind::Invalid,
        "Canonical depth exceeds 128",
    )?;
    let bytes = match value {
        Value::String(s) => s.len(),
        Value::Object(o) => o.keys().map(String::len).sum(),
        _ => 1,
    };
    *used = used
        .checked_add(bytes)
        .ok_or_else(|| err(ErrorKind::Invalid, "Canonical size overflow"))?;
    require(
        *used <= MAX_CANONICAL,
        ErrorKind::Invalid,
        "Document exceeds canonical budget",
    )?;
    match value {
        Value::Array(a) => {
            for v in a {
                bounded_document(v, depth + 1, used)?;
            }
        }
        Value::Object(o) => {
            for v in o.values() {
                bounded_document(v, depth + 1, used)?;
            }
        }
        _ => {}
    }
    Ok(())
}
fn canonical_json(v: &Value, depth: usize, out: &mut String) -> Result<()> {
    require(
        depth <= 128,
        ErrorKind::Invalid,
        "Canonical depth exceeds 128",
    )?;
    match v {
        Value::Object(map) => {
            out.push('{');
            let mut keys: Vec<_> = map.keys().collect();
            keys.sort();
            for (i, k) in keys.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                out.push_str(&serde_json::to_string(k)?);
                out.push(':');
                canonical_json(&map[*k], depth + 1, out)?;
            }
            out.push('}');
        }
        Value::Array(a) => {
            out.push('[');
            for (i, v) in a.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                canonical_json(v, depth + 1, out)?;
            }
            out.push(']');
        }
        _ => out.push_str(&serde_json::to_string(v)?),
    }
    require(
        out.len() <= MAX_CANONICAL,
        ErrorKind::Invalid,
        "Canonical request exceeds 22 MiB",
    )
}
// serde_json's default parser depth rejects some valid canonical depth-128
// intents. Bound bytes and lexical containers before enabling the explicitly
// bounded ledger decoder; other application deserializers keep their defaults.
fn decode_intent(raw: &str) -> Result<Intent> {
    require(
        raw.len() <= MAX_CANONICAL,
        ErrorKind::Corrupt,
        "Oversized saved intent",
    )?;
    let (mut depth, mut quoted, mut escaped) = (0usize, false, false);
    for byte in raw.bytes() {
        if quoted {
            if escaped {
                escaped = false;
            } else if byte == b'\\' {
                escaped = true;
            } else if byte == b'"' {
                quoted = false;
            }
        } else {
            match byte {
                b'"' => quoted = true,
                b'{' | b'[' => {
                    depth += 1;
                    // canonical_json labels the root value depth zero, hence
                    // a depth-128 empty container counts as 129 containers.
                    require(
                        depth <= 129,
                        ErrorKind::Corrupt,
                        "Saved intent depth exceeds 128",
                    )?;
                }
                b'}' | b']' => {
                    depth = depth
                        .checked_sub(1)
                        .ok_or_else(|| err(ErrorKind::Corrupt, "Unbalanced saved intent"))?
                }
                _ => {}
            }
        }
    }
    require(
        depth == 0 && !quoted,
        ErrorKind::Corrupt,
        "Unbalanced saved intent",
    )?;
    let mut decoder = serde_json::Deserializer::from_str(raw);
    decoder.disable_recursion_limit();
    let intent = Intent::deserialize(&mut decoder)?;
    decoder.end()?;
    Ok(intent)
}

fn hash(b: &[u8]) -> String {
    format!("{:x}", Sha256::digest(b))
}
fn uuid(s: &str) -> Result<()> {
    require(
        Uuid::parse_str(s).is_ok_and(|id| !id.is_nil() && id.to_string() == s),
        ErrorKind::Invalid,
        "Expected non-nil canonical UUID",
    )
}
fn hex(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn nonempty(s: &str) -> Result<()> {
    require(
        !s.is_empty() && s.len() <= 4096 && !s.contains('\0'),
        ErrorKind::Invalid,
        "Invalid native identity",
    )
}
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Identity {
    pub store_id: String,
    pub ledger_incarnation: String,
}
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Topology {
    Owned,
    SharedEngine,
    DesktopFollower,
    SharedHost,
    Unknown,
}
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Binding {
    pub agent: String,
    pub topology: Topology,
    pub thread_id: Option<String>,
    pub instance_id: Option<String>,
    pub native_version: Option<String>,
}
impl Binding {
    fn check(&self, s: &Session) -> Result<()> {
        require(
            self.agent == s.agent && self.thread_id == s.thread_id,
            ErrorKind::BindingConflict,
            "Agent/thread binding changed",
        )?;
        require(
            self.topology != Topology::Owned || !s.external,
            ErrorKind::BindingConflict,
            "External session cannot claim owned topology",
        )?;
        nonempty(&self.agent)?;
        require(
            match self.topology {
                Topology::DesktopFollower | Topology::SharedEngine => {
                    s.external && s.agent == "codex"
                }
                Topology::SharedHost => {
                    s.external && matches!(s.agent.as_str(), "deepseek-harness" | "workbuddy")
                }
                Topology::Owned => !s.external,
                Topology::Unknown => true,
            },
            ErrorKind::BindingConflict,
            "Topology does not match session owner",
        )?;
        for v in [
            self.thread_id.as_deref(),
            self.instance_id.as_deref(),
            self.native_version.as_deref(),
        ]
        .into_iter()
        .flatten()
        {
            nonempty(v)?;
        }
        Ok(())
    }
}
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Route {
    Start,
    Steer,
    Queue,
}
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Artifact {
    pub index: usize,
    pub relative_path: String,
    pub size: u64,
    pub sha256: String,
}
impl Artifact {
    fn check(&self, op: &str) -> Result<()> {
        let parts: Vec<_> = self.relative_path.split('/').collect();
        require(
            self.index < MAX_FILES
                && self.relative_path.len() <= 4096
                && self.size <= MAX_FILE
                && hex(&self.sha256)
                && parts.len() >= 2
                && parts[0] == op
                && parts.iter().all(|p| {
                    !p.is_empty() && *p != "." && *p != ".." && !p.contains(['\\', ':', '\0'])
                }),
            ErrorKind::Invalid,
            "Invalid operation artifact manifest",
        )
    }
}
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum PreparationSpec {
    Snapshot { index: usize },
    GoalArtifact,
    ThreadStart,
    ThreadResume,
    EmptyThreadFallback { missing_thread: String },
    Upload { index: usize },
}
impl PreparationSpec {
    fn kind(&self) -> &'static str {
        match self {
            Self::Snapshot { .. } => "snapshot",
            Self::GoalArtifact => "goal_artifact",
            Self::ThreadStart => "thread_start",
            Self::ThreadResume => "thread_resume",
            Self::EmptyThreadFallback { .. } => "thread_fallback",
            Self::Upload { .. } => "upload",
        }
    }
}
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum PreparationReceipt {
    Snapshot {
        artifact: Artifact,
    },
    GoalArtifact {
        artifact: Artifact,
    },
    Thread {
        thread_id: String,
        instance_id: Option<String>,
        native_version: Option<String>,
    },
    Upload {
        index: usize,
        native_file_id: String,
    },
}
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Prepared {
    pub artifacts: Vec<Artifact>,
    pub goal_artifact: Option<Artifact>,
    pub uploads: Vec<(usize, String)>,
}
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InputReceipt {
    pub thread_id: String,
    pub client_user_message_id: String,
    pub native_request_id: Option<String>,
    pub native_item_id: String,
    pub native_turn_id: Option<String>,
}
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Rejection {
    Validation,
    NativeExplicit,
    PreparationFailed,
}
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GoalReceipt {
    pub goal_id: String,
    pub thread_id: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Data {
    pub version: u32,
    pub intent: CanonicalIntent,
    pub binding: Binding,
    pub initial_thread_id: Option<String>,
    pub client_user_message_id: String,
    pub native_request_id: Option<String>,
    pub route: Option<Route>,
    pub expected_turn: Option<String>,
    pub dispatch_route: Option<Route>,
    pub dispatch_attempt_id: Option<String>,
    pub prepared: Option<Prepared>,
    pub input_receipt: Option<InputReceipt>,
    pub rejection: Option<Rejection>,
    pub rejection_proof: Option<String>,
    pub error_code: Option<String>,
    pub goal_claim_id: Option<String>,
    pub expected_goal_id: Option<String>,
    pub goal_receipt: Option<GoalReceipt>,
    pub replaces: Option<String>,
    pub superseded_by: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}
#[derive(Clone, Debug)]
pub struct Operation {
    pub id: String,
    pub session_id: String,
    pub phase: InputPhase,
    pub preparation: PreparationPhase,
    pub goal: GoalPhase,
    pub recording: Recording,
    pub revision: i64,
    pub data: Data,
}
impl Operation {
    pub fn intent(&self) -> Result<Intent> {
        decode_intent(&self.data.intent.bytes)
    }
}
#[derive(Debug)]
pub enum Lookup {
    Found(Box<Operation>),
    Tombstone,
    NeverRecorded,
}
#[derive(Debug)]
pub struct Admission {
    pub created: bool,
    pub operation: Operation,
}
#[derive(Debug)]
pub struct PreparationPermit {
    operation_id: String,
    claim_id: String,
    ordinal: i64,
}
impl PreparationPermit {
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "I02b adapter journals this exact durable qualification identity"
        )
    )]
    pub fn operation_id(&self) -> &str {
        &self.operation_id
    }
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "I02b adapter journals this exact durable qualification identity"
        )
    )]
    pub fn claim_id(&self) -> &str {
        &self.claim_id
    }
}
#[derive(Debug)]
#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "I02b preparation adapter consumes new qualifications or inspects existing receipts; remove at integration"
    )
)]
pub enum PreparationClaim {
    New(PreparationPermit),
    Existing {
        claim_id: String,
        phase: StepPhase,
        receipt: Option<PreparationReceipt>,
    },
}
#[derive(Debug)]
pub struct DispatchPermit {
    operation_id: String,
    attempt_id: String,
}
impl DispatchPermit {
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "I02b adapter journals this exact durable qualification identity"
        )
    )]
    pub fn operation_id(&self) -> &str {
        &self.operation_id
    }
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "I02b adapter journals this exact durable qualification identity"
        )
    )]
    pub fn attempt_id(&self) -> &str {
        &self.attempt_id
    }
}
#[derive(Debug)]
pub struct GoalPermit {
    operation_id: String,
    claim_id: String,
}
impl GoalPermit {
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "I02b adapter journals this exact durable qualification identity"
        )
    )]
    pub fn operation_id(&self) -> &str {
        &self.operation_id
    }
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "I02b adapter journals this exact durable qualification identity"
        )
    )]
    pub fn claim_id(&self) -> &str {
        &self.claim_id
    }
}

fn session(db: &Connection, id: &str) -> Result<Session> {
    let raw: Option<String> = db
        .query_row("SELECT data FROM sessions WHERE id=?1", [id], |r| r.get(0))
        .optional()?;
    let s: Session =
        serde_json::from_str(&raw.ok_or_else(|| err(ErrorKind::Missing, "Session not found"))?)?;
    require(s.id == id, ErrorKind::Corrupt, "Session identity mismatch")?;
    Ok(s)
}
fn identity(db: &Connection) -> Result<Identity> {
    let rows:Vec<(String,String,i64)>=db.prepare("SELECT store_id,ledger_incarnation,identity_version FROM message_ledger_identity WHERE singleton=1")?.query_map([],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?)))?.collect::<rusqlite::Result<_>>()?;
    let count: i64 = db.query_row("SELECT count(*) FROM message_ledger_identity", [], |r| {
        r.get(0)
    })?;
    require(
        rows.len() == 1 && count == 1,
        ErrorKind::Corrupt,
        "Missing or multiple ledger identities",
    )?;
    let (s, i, v) = &rows[0];
    uuid(s).map_err(|_| err(ErrorKind::Corrupt, "Malformed store identity"))?;
    uuid(i).map_err(|_| err(ErrorKind::Corrupt, "Malformed incarnation"))?;
    require(*v == 1, ErrorKind::Corrupt, "Unknown identity format")?;
    Ok(Identity {
        store_id: s.clone(),
        ledger_incarnation: i.clone(),
    })
}
fn pair(db: &Connection, expected: &Identity) -> Result<()> {
    require(
        identity(db)? == *expected,
        ErrorKind::IdentityMismatch,
        "Store/incarnation changed",
    )
}
fn load(db: &Connection, session_id: &str, id: &str) -> Result<Lookup> {
    let owner: Option<String> = db
        .query_row(
            "SELECT session_id FROM message_operation_ids WHERE operation_id=?1",
            [id],
            |r| r.get(0),
        )
        .optional()?;
    let Some(owner) = owner else {
        let orphan: bool = db.query_row(
            "SELECT EXISTS(SELECT 1 FROM message_operations WHERE operation_id=?1)",
            [id],
            |r| r.get(0),
        )?;
        require(
            !orphan,
            ErrorKind::Corrupt,
            "Missing used-ID registry for operation",
        )?;
        return Ok(Lookup::NeverRecorded);
    };
    require(
        owner == session_id,
        ErrorKind::BindingConflict,
        "Operation belongs to another session",
    )?;
    let row=db.query_row("SELECT session_id,agent,thread_id,phase,preparation,goal,recording,revision,data FROM message_operations WHERE operation_id=?1",[id],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,Option<String>>(2)?,r.get::<_,String>(3)?,r.get::<_,String>(4)?,r.get::<_,String>(5)?,r.get::<_,String>(6)?,r.get::<_,i64>(7)?,r.get::<_,String>(8)?))).optional()?;
    let Some((sid, agent, thread, phase, prep, goal, recording, revision, raw)) = row else {
        return Ok(Lookup::Tombstone);
    };
    require(
        raw.len() <= 2 * MAX_CANONICAL + 512 * 1024,
        ErrorKind::Corrupt,
        "Oversized operation payload",
    )?;
    let data: Data = serde_json::from_str(&raw)?;
    require(
        data.version == 1
            && sid == session_id
            && data.binding.agent == agent
            && data.binding.thread_id == thread
            && revision > 0,
        ErrorKind::Corrupt,
        "Operation binding mismatch",
    )?;
    let op = Operation {
        id: id.into(),
        session_id: sid,
        phase: InputPhase::parse(&phase)?,
        preparation: PreparationPhase::parse(&prep)?,
        goal: GoalPhase::parse(&goal)?,
        recording: Recording::parse(&recording)?,
        revision,
        data,
    };
    validate_operation(&op)?;
    Ok(Lookup::Found(Box::new(op)))
}
fn operation(db: &Connection, sid: &str, id: &str) -> Result<Operation> {
    match load(db, sid, id)? {
        Lookup::Found(op) => Ok(*op),
        Lookup::Tombstone => Err(err(ErrorKind::UsedId, "Used operation tombstone")),
        Lookup::NeverRecorded => Err(err(ErrorKind::Missing, "Operation not found")),
    }
}
fn validate_operation(op: &Operation) -> Result<()> {
    uuid(&op.id)?;
    uuid(&op.data.client_user_message_id)?;
    require(
        op.data.intent.version == 1
            && op.data.intent.bytes.len() <= MAX_CANONICAL
            && hex(&op.data.intent.sha256)
            && hash(op.data.intent.bytes.as_bytes()) == op.data.intent.sha256,
        ErrorKind::Corrupt,
        "Malformed immutable intent",
    )?;
    let intent = op.intent()?;
    require(
        intent.canonical()? == op.data.intent,
        ErrorKind::Corrupt,
        "Noncanonical intent",
    )?;
    require(
        op.data.binding.agent != "workbuddy" || op.data.native_request_id.is_some(),
        ErrorKind::Corrupt,
        "WorkBuddy request identity missing",
    )?;
    if let Some(id) = &op.data.native_request_id {
        native_request(id)?;
    }
    if let Some(id) = &op.data.dispatch_attempt_id {
        uuid(id)?;
    }
    if let Some(id) = &op.data.goal_claim_id {
        uuid(id)?;
    }
    require(
        (op.phase != InputPhase::Dispatching
            || (op.data.dispatch_attempt_id.is_some()
                && op.data.dispatch_route.is_some()
                && op.recording == Recording::ResultPending))
            && (op.phase != InputPhase::Accepted || op.data.input_receipt.is_some())
            && (op.preparation != PreparationPhase::Prepared || op.data.prepared.is_some())
            && (intent.goal || op.goal == GoalPhase::NotRequested),
        ErrorKind::Corrupt,
        "Invalid ledger state combination",
    )?;
    require(
        (op.goal == GoalPhase::NotRequested) == !intent.goal,
        ErrorKind::Corrupt,
        "Goal request flag mismatch",
    )?;
    if matches!(
        op.phase,
        InputPhase::Recorded | InputPhase::Queued | InputPhase::Cancelled | InputPhase::Superseded
    ) {
        require(
            op.data.dispatch_attempt_id.is_none()
                && op.data.input_receipt.is_none()
                && op.recording == Recording::Normal,
            ErrorKind::Corrupt,
            "Undispatched operation contains dispatch result",
        )?;
    }
    if matches!(
        op.phase,
        InputPhase::Dispatching | InputPhase::Uncertain | InputPhase::Accepted
    ) {
        require(
            op.data.dispatch_attempt_id.is_some() && op.preparation == PreparationPhase::Prepared,
            ErrorKind::Corrupt,
            "Dispatched operation lacks prepared identity",
        )?;
    }
    if let Some(receipt) = &op.data.input_receipt {
        match_receipt(op, receipt)?;
        require(
            op.phase == InputPhase::Accepted,
            ErrorKind::Corrupt,
            "Acceptance receipt in nonaccepted phase",
        )?;
    }
    if matches!(op.goal, GoalPhase::Accepted | GoalPhase::Uncertain) {
        require(
            op.phase == InputPhase::Accepted && op.data.goal_claim_id.is_some(),
            ErrorKind::Corrupt,
            "Goal result before accepted input/claim",
        )?;
    }
    if op.goal == GoalPhase::Accepted {
        let receipt = op
            .data
            .goal_receipt
            .as_ref()
            .ok_or_else(|| err(ErrorKind::Corrupt, "Missing accepted goal receipt"))?;
        nonempty(&receipt.goal_id)?;
        require(
            op.data.binding.thread_id.as_ref() == Some(&receipt.thread_id),
            ErrorKind::Corrupt,
            "Goal receipt binding changed",
        )?;
    }
    if let Some(bundle) = &op.data.prepared {
        check_bundle(op, bundle)?;
    }
    Ok(())
}
fn save(db: &Connection, op: &mut Operation) -> Result<()> {
    validate_operation(op)?;
    let previous = op.revision;
    op.revision = op
        .revision
        .checked_add(1)
        .ok_or_else(|| err(ErrorKind::Corrupt, "Revision overflow"))?;
    op.data.updated_at = now();
    let n=db.execute("UPDATE message_operations SET agent=?3,thread_id=?4,phase=?5,preparation=?6,goal=?7,recording=?8,revision=?9,data=?10 WHERE operation_id=?1 AND session_id=?2 AND revision=?11",params![op.id,op.session_id,op.data.binding.agent,op.data.binding.thread_id,op.phase.sql(),op.preparation.sql(),op.goal.sql(),op.recording.sql(),op.revision,serde_json::to_string(&op.data)?,previous])?;
    require(n == 1, ErrorKind::Conflict, "Operation revision changed")
}
fn revision(op: &Operation, v: i64) -> Result<()> {
    require(
        op.revision == v,
        ErrorKind::Conflict,
        "Operation revision changed",
    )
}
fn editable(op: &Operation) -> Result<()> {
    require(
        matches!(op.phase, InputPhase::Recorded | InputPhase::Queued)
            && !matches!(op.preparation, PreparationPhase::Preparing),
        ErrorKind::IllegalTransition,
        "Operation is not known-undispatched and editable",
    )
}
fn current(db: &Connection, op: &Operation) -> Result<Session> {
    let s = session(db, &op.session_id)?;
    op.data.binding.check(&s)?;
    Ok(s)
}
fn can_send(s: &Session) -> Result<()> {
    require(
        !s.archived && !(s.agent == "workbuddy" && s.auxiliary),
        ErrorKind::IllegalTransition,
        "Archived or read-only child session",
    )
}
fn native_request(id: &str) -> Result<()> {
    require(
        id.len() == 32
            && Uuid::parse_str(id)
                .is_ok_and(|u| u.get_version_num() == 7 && u.simple().to_string() == id),
        ErrorKind::Invalid,
        "Invalid canonical WorkBuddy request ID",
    )
}
fn new_native_request() -> String {
    let mut b = *Uuid::new_v4().as_bytes();
    b[..6].copy_from_slice(&(now() as u64).to_be_bytes()[2..]);
    b[6] = (b[6] & 15) | 0x70;
    Uuid::from_bytes(b).simple().to_string()
}
fn insert(
    db: &Connection,
    sid: &str,
    id: &str,
    intent: &Intent,
    binding: &Binding,
) -> Result<Admission> {
    uuid(id)?;
    let canonical = intent.canonical()?;
    match load(db, sid, id)? {
        Lookup::Found(op) => {
            require(
                op.data.intent == canonical,
                ErrorKind::IntentConflict,
                "Operation ID has different immutable intent",
            )?;
            return Ok(Admission {
                created: false,
                operation: *op,
            });
        }
        Lookup::Tombstone => {
            return Err(err(ErrorKind::UsedId, "Operation ID is permanently used"));
        }
        Lookup::NeverRecorded => {}
    }
    let s = session(db, sid)?;
    binding.check(&s)?;
    can_send(&s)?;
    let t = now();
    let data = Data {
        version: 1,
        intent: canonical,
        binding: binding.clone(),
        initial_thread_id: binding.thread_id.clone(),
        client_user_message_id: id.into(),
        native_request_id: (binding.agent == "workbuddy").then(new_native_request),
        route: None,
        expected_turn: None,
        dispatch_route: None,
        dispatch_attempt_id: None,
        prepared: None,
        input_receipt: None,
        rejection: None,
        rejection_proof: None,
        error_code: None,
        goal_claim_id: None,
        expected_goal_id: None,
        goal_receipt: None,
        replaces: None,
        superseded_by: None,
        created_at: t,
        updated_at: t,
    };
    db.execute(
        "INSERT INTO message_operation_ids VALUES(?1,?2,?3)",
        params![id, sid, t],
    )?;
    fault("after_registry")?;
    let goal = if intent.goal {
        GoalPhase::Pending
    } else {
        GoalPhase::NotRequested
    };
    db.execute("INSERT INTO message_operations VALUES(?1,?2,?3,?4,'recorded','not_started',?5,'normal',1,?6)",params![id,sid,binding.agent,binding.thread_id,goal.sql(),serde_json::to_string(&data)?])?;
    fault("after_intent")?;
    Ok(Admission {
        created: true,
        operation: operation(db, sid, id)?,
    })
}
fn event(db: &Connection, op: &Operation, method: &str, params: Value) -> Result<()> {
    let e = Event {
        seq: 0,
        session_id: op.session_id.clone(),
        method: method.into(),
        params,
        request_id: None,
        created_at: now(),
    };
    db.execute(
        "INSERT INTO events(session_id,data) VALUES(?1,?2)",
        params![op.session_id, serde_json::to_string(&e)?],
    )?;
    Ok(())
}
fn changed(db: &Connection, op: &Operation) -> Result<()> {
    event(
        db,
        op,
        "operation/changed",
        json!({"operation_id":op.id,"phase":op.phase,"revision":op.revision}),
    )
}
fn check_bundle(op: &Operation, b: &Prepared) -> Result<()> {
    let intent = op.intent()?;
    require(
        b.artifacts.len() == intent.attachments.len() && b.artifacts.len() <= MAX_FILES,
        ErrorKind::Invalid,
        "Snapshot manifest count mismatch",
    )?;
    let mut total = 0u64;
    let mut paths = std::collections::HashSet::new();
    for (i, a) in b.artifacts.iter().enumerate() {
        a.check(&op.id)?;
        require(
            a.index == i && paths.insert(&a.relative_path),
            ErrorKind::Invalid,
            "Snapshot index/path mismatch",
        )?;
        total = total
            .checked_add(a.size)
            .ok_or_else(|| err(ErrorKind::Invalid, "Manifest size overflow"))?;
    }
    require(
        total <= MAX_TOTAL,
        ErrorKind::Invalid,
        "Snapshots exceed 64 MiB",
    )?;
    if let Some(a) = &b.goal_artifact {
        a.check(&op.id)?;
        total = total
            .checked_add(a.size)
            .ok_or_else(|| err(ErrorKind::Invalid, "Manifest overflow"))?;
        require(
            b.artifacts.len() < MAX_FILES && total <= MAX_TOTAL,
            ErrorKind::Invalid,
            "Manifest budget exceeded",
        )?;
        require(
            intent.goal && paths.insert(&a.relative_path),
            ErrorKind::Invalid,
            "Unexpected goal artifact",
        )?;
    }
    for (i, id) in &b.uploads {
        require(
            *i < b.artifacts.len(),
            ErrorKind::Invalid,
            "Upload index mismatch",
        )?;
        nonempty(id)?;
    }
    Ok(())
}

fn prepared_from_steps(all: &[Step]) -> Result<Prepared> {
    let mut prepared = Prepared {
        artifacts: vec![],
        goal_artifact: None,
        uploads: vec![],
    };
    for step in all {
        require(
            step.phase == StepPhase::Confirmed,
            ErrorKind::Corrupt,
            "Prepared operation has unconfirmed step",
        )?;
        match step
            .receipt
            .as_ref()
            .ok_or_else(|| err(ErrorKind::Corrupt, "Receipt missing"))?
        {
            PreparationReceipt::Snapshot { artifact } => prepared.artifacts.push(artifact.clone()),
            PreparationReceipt::GoalArtifact { artifact } => {
                prepared.goal_artifact = Some(artifact.clone())
            }
            PreparationReceipt::Upload {
                index,
                native_file_id,
            } => prepared.uploads.push((*index, native_file_id.clone())),
            PreparationReceipt::Thread { .. } => {}
        }
    }
    prepared.artifacts.sort_by_key(|a| a.index);
    Ok(prepared)
}

impl Store {
    fn ledger_tx<T>(&self, f: impl FnOnce(&Transaction<'_>) -> Result<T>) -> Result<T> {
        let mut db = self
            .0
            .lock()
            .map_err(|_| err(ErrorKind::Storage, "Store lock poisoned"))?;
        let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let result = f(&tx)?;
        fault("before_commit")?;
        tx.commit()?;
        Ok(result)
    }
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "I02b will consume Store::ledger_identity; remove at dispatch integration"
        )
    )]
    pub fn ledger_identity(&self) -> Result<Identity> {
        let db = self
            .0
            .lock()
            .map_err(|_| err(ErrorKind::Storage, "Store lock poisoned"))?;
        identity(&db)
    }
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "I02b will consume Store::admit_operation; remove at dispatch integration"
        )
    )]
    pub fn admit_operation(
        &self,
        p: &Identity,
        sid: &str,
        id: &str,
        intent: &Intent,
        binding: &Binding,
    ) -> Result<Admission> {
        self.ledger_tx(|db| {
            pair(db, p)?;
            session(db, sid)?;
            insert(db, sid, id, intent, binding)
        })
    }
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "I02b will consume Store::lookup_operation; remove at dispatch integration"
        )
    )]
    pub fn lookup_operation(&self, p: &Identity, sid: &str, id: &str) -> Result<Lookup> {
        uuid(id)?;
        let db = self
            .0
            .lock()
            .map_err(|_| err(ErrorKind::Storage, "Store lock poisoned"))?;
        pair(&db, p)?;
        session(&db, sid)?;
        load(&db, sid, id)
    }
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "I02b will consume Store::list_session_operations; remove at dispatch integration"
        )
    )]
    pub fn list_session_operations(
        &self,
        p: &Identity,
        sid: &str,
        after: Option<&str>,
        limit: usize,
        unresolved: bool,
    ) -> Result<Vec<Operation>> {
        let db = self
            .0
            .lock()
            .map_err(|_| err(ErrorKind::Storage, "Store lock poisoned"))?;
        pair(&db, p)?;
        session(&db, sid)?;
        require(
            (1..=100).contains(&limit),
            ErrorKind::Invalid,
            "Invalid list limit",
        )?;
        let mut q=db.prepare("SELECT operation_id FROM message_operations WHERE session_id=?1 AND operation_id>?2 AND (?3=0 OR phase IN ('recorded','queued','dispatching','uncertain') OR goal IN ('pending','uncertain')) ORDER BY operation_id LIMIT ?4")?;
        let ids = q
            .query_map(params![sid, after.unwrap_or(""), unresolved, limit], |r| {
                r.get::<_, String>(0)
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        ids.iter().map(|id| operation(&db, sid, id)).collect()
    }
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "I02b will consume Store::select_operation_route; remove at dispatch integration"
        )
    )]
    pub fn select_operation_route(
        &self,
        p: &Identity,
        sid: &str,
        id: &str,
        v: i64,
        route: Route,
        turn: Option<&str>,
    ) -> Result<Operation> {
        self.ledger_tx(|db| {
            pair(db, p)?;
            let mut op = operation(db, sid, id)?;
            revision(&op, v)?;
            editable(&op)?;
            current(db, &op)?;
            require(
                op.data.route.is_none()
                    || op.data.route == Some(route) && op.data.expected_turn.as_deref() == turn,
                ErrorKind::Conflict,
                "Route already selected",
            )?;
            if route == Route::Steer {
                nonempty(
                    turn.ok_or_else(|| err(ErrorKind::Invalid, "Steer needs expected turn"))?,
                )?;
            }
            op.data.route = Some(route);
            op.data.expected_turn = turn.map(Into::into);
            save(db, &mut op)?;
            Ok(op)
        })
    }
}

#[cfg(not(test))]
fn fault(_: &str) -> Result<()> {
    Ok(())
}
#[cfg(test)]
thread_local! {static FAIL_AT:std::cell::RefCell<Option<&'static str>>=const{std::cell::RefCell::new(None)};
}
#[cfg(test)]
fn fault(stage: &str) -> Result<()> {
    let point = FAIL_AT.with(|p| *p.borrow());
    if point == Some("crash_dispatch") && stage == "before_commit_dispatch" {
        std::process::exit(29);
    }
    if point == Some("crash_identity") && stage == "after_identity" {
        std::process::exit(29);
    }
    require(
        point != Some(stage),
        ErrorKind::Storage,
        "Injected ledger failure",
    )
}

pub(super) fn initialize(db: &Connection) -> Result<()> {
    db.execute(
        "INSERT INTO message_ledger_identity VALUES(1,?1,?2,1,?3)",
        params![
            Uuid::new_v4().to_string(),
            Uuid::new_v4().to_string(),
            now()
        ],
    )?;
    fault("after_identity")?;
    Ok(())
}
pub(super) fn require_unlinked(db: &Connection, sid: &str, seq: i64) -> Result<()> {
    let linked: bool = db.query_row(
        "SELECT EXISTS(SELECT 1 FROM message_operation_queue WHERE queue_seq=?1 AND session_id=?2)",
        params![seq, sid],
        |r| r.get(0),
    )?;
    require(
        !linked,
        ErrorKind::IllegalTransition,
        "Ledger queue requires checked operation transaction",
    )
}
#[derive(Clone, Debug)]
struct Step {
    claim_id: String,
    phase: StepPhase,
    spec: PreparationSpec,
    receipt: Option<PreparationReceipt>,
}
fn steps(db: &Connection, id: &str) -> Result<Vec<Step>> {
    let mut q=db.prepare("SELECT ordinal,claim_id,kind,phase,specification,receipt FROM message_operation_preparation WHERE operation_id=?1 ORDER BY ordinal")?;
    let rows = q
        .query_map([id], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, Option<String>>(5)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    rows.into_iter()
        .enumerate()
        .map(|(i, (ordinal, claim_id, kind, phase, raw, receipt))| {
            uuid(&claim_id)?;
            let spec: PreparationSpec = serde_json::from_str(&raw)?;
            let phase = StepPhase::parse(&phase)?;
            require(
                ordinal == i as i64 && kind == spec.kind() && raw.len() <= 16384,
                ErrorKind::Corrupt,
                "Invalid preparation ordinal/kind",
            )?;
            let receipt: Option<PreparationReceipt> =
                receipt.map(|s| serde_json::from_str(&s)).transpose()?;
            require(
                (phase == StepPhase::Confirmed) == receipt.is_some(),
                ErrorKind::Corrupt,
                "Preparation receipt state mismatch",
            )?;
            Ok(Step {
                claim_id,
                phase,
                spec,
                receipt,
            })
        })
        .collect()
}
fn queue_link(db: &Connection, op: &Operation) -> Result<Option<(i64, String)>> {
    Ok(db.query_row("SELECT queue_seq,location FROM message_operation_queue WHERE operation_id=?1 AND session_id=?2",params![op.id,op.session_id],|r|Ok((r.get(0)?,r.get(1)?))).optional()?)
}
fn queue_data(db: &Connection, sid: &str, seq: i64, editing: bool) -> Result<Value> {
    let table = if editing {
        "queue_edits"
    } else {
        "message_queue"
    };
    let raw: Option<String> = db
        .query_row(
            &format!("SELECT data FROM {table} WHERE session_id=?1 AND seq=?2"),
            params![sid, seq],
            |r| r.get(0),
        )
        .optional()?;
    let raw = raw.ok_or_else(|| err(ErrorKind::Missing, "Queue item missing"))?;
    let data: Value = serde_json::from_str(&raw)?;
    require(data.is_object(), ErrorKind::Corrupt, "Invalid queue object")?;
    Ok(data)
}
fn queue_intent(value: &Value) -> Result<Intent> {
    // Decode only known message fields; legacy queue metadata stays untouched.
    let text = value["text"]
        .as_str()
        .ok_or_else(|| err(ErrorKind::Invalid, "Legacy queue text missing"))?
        .to_string();
    let attachments: Vec<String> = match value.get("attachments") {
        Some(v) => serde_json::from_value(v.clone())?,
        None => vec![],
    };
    let composer = match value.get("composer") {
        Some(v) if !v.is_null() => Some(serde_json::from_value(v.clone())?),
        _ => None,
    };
    let goal = match value.get("goal") {
        Some(Value::Bool(v)) => *v,
        None => false,
        _ => return Err(err(ErrorKind::Invalid, "Invalid queue goal")),
    };
    Ok(Intent {
        text,
        attachments,
        composer,
        goal,
        mode: Mode::Queue,
        queue_if_busy: false,
    })
}
fn queue_value(intent: &Intent) -> Value {
    json!({"text":intent.text,"attachments":intent.attachments,"composer":intent.composer,"goal":intent.goal,"status":"pending"})
}
fn update_queue_status(db: &Connection, op: &Operation, status: &str) -> Result<()> {
    if let Some((seq, location)) = queue_link(db, op)? {
        require(
            location == "queue",
            ErrorKind::IllegalTransition,
            "Queue item held by editor",
        )?;
        let n=db.execute("UPDATE message_queue SET data=json_set(data,'$.status',?3) WHERE session_id=?1 AND seq=?2",params![op.session_id,seq,status])?;
        require(
            n == 1,
            ErrorKind::Corrupt,
            "Queue association missing physical row",
        )?;
    }
    Ok(())
}
fn remove_queue(db: &Connection, op: &Operation) -> Result<()> {
    if let Some((seq, location)) = queue_link(db, op)? {
        let table = if location == "editing" {
            "queue_edits"
        } else {
            "message_queue"
        };
        let n = db.execute(
            &format!("DELETE FROM {table} WHERE session_id=?1 AND seq=?2"),
            params![op.session_id, seq],
        )?;
        require(
            n == 1,
            ErrorKind::Corrupt,
            "Queue association missing physical row",
        )?;
        fault("after_queue_remove")?;
        db.execute(
            "DELETE FROM message_operation_queue WHERE operation_id=?1",
            [&op.id],
        )?;
    }
    Ok(())
}
fn match_receipt(op: &Operation, receipt: &InputReceipt) -> Result<()> {
    require(
        op.data.binding.thread_id.as_ref() == Some(&receipt.thread_id)
            && receipt.client_user_message_id == op.data.client_user_message_id
            && receipt.native_request_id == op.data.native_request_id,
        ErrorKind::BindingConflict,
        "Acceptance identity mismatch",
    )?;
    nonempty(&receipt.native_item_id)?;
    if let Some(t) = &receipt.native_turn_id {
        nonempty(t)?;
    }
    Ok(())
}
fn check_fence(db: &Connection, op: &Operation) -> Result<()> {
    let blocked: bool = db.query_row(
        "SELECT EXISTS(SELECT 1 FROM message_operations o WHERE operation_id<>?1 AND (recording<>'normal' OR (preparation='uncertain' AND phase IN ('recorded','queued')) OR EXISTS(SELECT 1 FROM message_operation_preparation p WHERE p.operation_id=o.operation_id AND p.phase='claimed' AND p.kind NOT IN ('snapshot','goal_artifact'))) AND (session_id=?4 OR thread_id IS NULL OR ?3 IS NULL OR (agent=?2 AND thread_id=?3)))",
        params![op.id,op.data.binding.agent,op.data.binding.thread_id,op.session_id], |r| r.get(0),
    )?;
    require(
        !blocked,
        ErrorKind::Fenced,
        "Unreconciled result recording for this native binding",
    )
}

impl Store {
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "I02b will consume Store::claim_preparation_step; remove at dispatch integration"
        )
    )]
    pub fn claim_preparation_step(
        &self,
        p: &Identity,
        sid: &str,
        id: &str,
        v: i64,
        spec: &PreparationSpec,
    ) -> Result<PreparationClaim> {
        self.ledger_tx(|db| {
            pair(db, p)?;
            let mut op = operation(db, sid, id)?;
            let old = steps(db, id)?;
            if let Some(step) = old.iter().find(|step| step.spec == *spec) {
                return Ok(PreparationClaim::Existing {
                    claim_id: step.claim_id.clone(),
                    phase: step.phase,
                    receipt: step.receipt.clone(),
                });
            }
            require(!self.2.load(Ordering::SeqCst), ErrorKind::Fenced, "Store recording fence")?;
            can_send(&current(db, &op)?)?;
            check_fence(db, &op)?;
            revision(&op, v)?;
            require(
                matches!(op.phase, InputPhase::Recorded | InputPhase::Queued)
                    && matches!(op.preparation, PreparationPhase::NotStarted | PreparationPhase::Preparing)
                    && old.iter().all(|step| step.phase == StepPhase::Confirmed),
                ErrorKind::IllegalTransition,
                "Preparation is not safe to continue",
            )?;
            let intent = op.intent()?;
            match spec {
                PreparationSpec::Snapshot { index } => {
                    require(*index < intent.attachments.len(), ErrorKind::Invalid, "Invalid attachment step")?;
                }
                PreparationSpec::Upload { index } => {
                    require(*index < intent.attachments.len(), ErrorKind::Invalid, "Invalid attachment step")?;
                    require(
                        old.iter().any(|step| {
                            step.spec == PreparationSpec::Snapshot { index: *index }
                                && step.phase == StepPhase::Confirmed
                                && matches!(step.receipt, Some(PreparationReceipt::Snapshot { .. }))
                        }),
                        ErrorKind::IllegalTransition,
                        "Upload requires a confirmed frozen snapshot",
                    )?;
                }
                PreparationSpec::GoalArtifact => require(intent.goal, ErrorKind::Invalid, "Goal not requested")?,
                PreparationSpec::ThreadStart => require(op.data.binding.thread_id.is_none(), ErrorKind::BindingConflict, "Thread already exists")?,
                PreparationSpec::ThreadResume => require(op.data.binding.thread_id.is_some(), ErrorKind::BindingConflict, "Missing thread")?,
                PreparationSpec::EmptyThreadFallback { missing_thread } => {
                    require(
                        op.data.binding.agent == "codex"
                            && op.data.binding.topology == Topology::Owned
                            && op.data.binding.thread_id.as_ref() == Some(missing_thread),
                        ErrorKind::BindingConflict,
                        "Invalid empty-thread fallback binding",
                    )?;
                    let recorded: bool = db.query_row(
                        "SELECT EXISTS(SELECT 1 FROM events WHERE session_id=?1 AND (json_extract(data,'$.method') IN ('user/message','turn/started','turn/completed') OR json_extract(data,'$.params.item.type')='userMessage'))",
                        [sid], |r| r.get(0),
                    )?;
                    require(!recorded, ErrorKind::IllegalTransition, "Thread has recorded turn history")?;
                }
            }
            require(old.len() < 40, ErrorKind::Invalid, "Too many preparation steps")?;
            if !matches!(spec, PreparationSpec::Snapshot { .. } | PreparationSpec::GoalArtifact) {
                let inflight: bool = db.query_row(
                    "SELECT EXISTS(SELECT 1 FROM message_operation_preparation p JOIN message_operations o ON o.operation_id=p.operation_id WHERE p.phase='claimed' AND p.kind NOT IN ('snapshot','goal_artifact') AND o.phase IN ('recorded','queued') AND (o.session_id=?1 OR o.thread_id IS NULL OR ?3 IS NULL OR (o.agent=?2 AND o.thread_id=?3)))",
                    params![sid, op.data.binding.agent, op.data.binding.thread_id], |r| r.get(0),
                )?;
                require(!inflight, ErrorKind::Fenced, "Native preparation already in flight for binding")?;
            }
            let claim_id = Uuid::new_v4().to_string();
            let ordinal = old.len() as i64;
            db.execute(
                "INSERT INTO message_operation_preparation VALUES(?1,?2,?3,?4,'claimed',?5,NULL)",
                params![id, ordinal, claim_id, spec.kind(), serde_json::to_string(spec)?],
            )?;
            fault("after_preparation_claim")?;
            op.preparation = PreparationPhase::Preparing;
            save(db, &mut op)?;
            Ok(PreparationClaim::New(PreparationPermit { operation_id: id.into(), claim_id, ordinal }))
        })
    }
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "I02b will consume Store::confirm_preparation_step; remove at dispatch integration"
        )
    )]
    pub fn confirm_preparation_step(
        &self,
        p: &Identity,
        sid: &str,
        permit: &PreparationPermit,
        receipt: &PreparationReceipt,
    ) -> Result<Operation> {
        self.record_result(|db| {
            pair(db, p)?;
            let mut op = operation(db, sid, &permit.operation_id)?;
            let s = current(db, &op)?;
            require(
                matches!(op.phase, InputPhase::Recorded | InputPhase::Queued) && op.preparation == PreparationPhase::Preparing,
                ErrorKind::IllegalTransition, "Preparation claim is not active",
            )?;
            let all = steps(db, &op.id)?;
            let step = all.get(permit.ordinal as usize).ok_or_else(|| err(ErrorKind::Missing, "Preparation claim missing"))?;
            require(step.claim_id == permit.claim_id && step.phase == StepPhase::Claimed, ErrorKind::Conflict, "Preparation claim changed")?;
            check_preparation_receipt(db, &mut op, &s, &step.spec, receipt)?;
            db.execute(
                "UPDATE message_operation_preparation SET phase='confirmed',receipt=?2 WHERE claim_id=?1",
                params![permit.claim_id, serde_json::to_string(receipt)?],
            )?;
            fault("after_preparation_receipt")?;
            save(db, &mut op)?;
            Ok(op)
        })
    }
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "I02b will consume Store::fail_preparation_step; remove at dispatch integration"
        )
    )]
    pub fn fail_preparation_step(
        &self,
        p: &Identity,
        sid: &str,
        permit: &PreparationPermit,
        uncertain: bool,
    ) -> Result<Operation> {
        self.record_result(|db| {
            pair(db, p)?;
            let mut op = operation(db, sid, &permit.operation_id)?;
            require(
                matches!(op.phase, InputPhase::Recorded | InputPhase::Queued) && op.preparation == PreparationPhase::Preparing,
                ErrorKind::IllegalTransition, "Preparation is not active",
            )?;
            let phase = if uncertain { StepPhase::Uncertain } else { StepPhase::Failed };
            let n = db.execute(
                "UPDATE message_operation_preparation SET phase=?2 WHERE claim_id=?1 AND operation_id=?3 AND phase='claimed'",
                params![permit.claim_id, phase.sql(), op.id],
            )?;
            require(n == 1, ErrorKind::Conflict, "Preparation claim changed")?;
            op.preparation = if uncertain { PreparationPhase::Uncertain } else { PreparationPhase::Failed };
            op.data.error_code = Some(if uncertain { "preparation_uncertain" } else { "preparation_failed" }.into());
            save(db, &mut op)?;
            changed(db, &op)?;
            Ok(op)
        })
    }
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "I02b will consume Store::finish_preparation; remove at dispatch integration"
        )
    )]
    pub fn finish_preparation(
        &self,
        p: &Identity,
        sid: &str,
        id: &str,
        v: i64,
    ) -> Result<Operation> {
        self.ledger_tx(|db| {
            pair(db, p)?;
            let mut op = operation(db, sid, id)?;
            revision(&op, v)?;
            current(db, &op)?;
            require(
                matches!(op.phase, InputPhase::Recorded | InputPhase::Queued)
                    && matches!(
                        op.preparation,
                        PreparationPhase::NotStarted | PreparationPhase::Preparing
                    ),
                ErrorKind::IllegalTransition,
                "Cannot finalize preparation",
            )?;
            let all = steps(db, id)?;
            require(
                all.iter().all(|s| s.phase == StepPhase::Confirmed),
                ErrorKind::IllegalTransition,
                "Unconfirmed preparation",
            )?;
            let prepared = prepared_from_steps(&all)?;
            check_bundle(&op, &prepared)?;
            require(
                op.data.binding.thread_id.is_some()
                    && op.data.binding.topology != Topology::Unknown,
                ErrorKind::BindingConflict,
                "Native thread/topology not established",
            )?;
            op.preparation = PreparationPhase::Prepared;
            op.data.prepared = Some(prepared);
            save(db, &mut op)?;
            Ok(op)
        })
    }
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "I02b will consume Store::begin_operation_dispatch; remove at dispatch integration"
        )
    )]
    pub fn begin_operation_dispatch(
        &self,
        p: &Identity,
        sid: &str,
        id: &str,
        v: i64,
        route: Route,
        expected_turn: Option<&str>,
    ) -> Result<DispatchPermit> {
        require(
            !self.2.load(Ordering::SeqCst),
            ErrorKind::Fenced,
            "Store recording failure requires verified recovery",
        )?;
        self.ledger_tx(|db| {
            require(
                !self.2.load(Ordering::SeqCst),
                ErrorKind::Fenced,
                "Store recording fence",
            )?;
            pair(db, p)?;
            let mut op = operation(db, sid, id)?;
            revision(&op, v)?;
            let s = current(db, &op)?;
            can_send(&s)?;
            check_fence(db, &op)?;
            require(
                matches!(op.phase, InputPhase::Recorded | InputPhase::Queued)
                    && op.preparation == PreparationPhase::Prepared
                    && op.recording == Recording::Normal
                    && op.data.dispatch_attempt_id.is_none(),
                ErrorKind::IllegalTransition,
                "Input is not safe to dispatch",
            )?;
            require(
                route != Route::Queue && op.data.route.is_some(),
                ErrorKind::Invalid,
                "Dispatch route not selected",
            )?;
            if op.data.route != Some(Route::Queue) {
                require(
                    op.data.route == Some(route)
                        && op.data.expected_turn.as_deref() == expected_turn,
                    ErrorKind::BindingConflict,
                    "Saved dispatch route/turn changed",
                )?;
            }
            if route == Route::Steer {
                nonempty(
                    expected_turn
                        .ok_or_else(|| err(ErrorKind::Invalid, "Steer requires expected turn"))?,
                )?;
            }
            let link = queue_link(db, &op)?;
            require(
                (op.data.route == Some(Route::Queue))
                    == (op.phase == InputPhase::Queued && link.is_some()),
                ErrorKind::IllegalTransition,
                "Saved route/queue association mismatch",
            )?;
            if let Some((seq, location)) = link {
                if route == Route::Start {
                    let first: i64 = db.query_row(
                        "SELECT MIN(seq) FROM message_queue WHERE session_id=?1",
                        [sid],
                        |r| r.get(0),
                    )?;
                    require(seq == first, ErrorKind::Conflict, "FIFO queue head changed")?;
                }

                require(
                    location == "queue",
                    ErrorKind::IllegalTransition,
                    "Queue held for editing",
                )?;
                let paused: bool = db.query_row(
                    "SELECT COALESCE((SELECT paused FROM queue_settings WHERE session_id=?1),0)",
                    [sid],
                    |r| r.get(0),
                )?;
                require(
                    !paused,
                    ErrorKind::IllegalTransition,
                    "Local queue is paused",
                )?;
            }
            let attempt_id = Uuid::new_v4().to_string();
            op.data.dispatch_attempt_id = Some(attempt_id.clone());
            op.data.dispatch_route = Some(route);
            op.data.expected_turn = expected_turn.map(Into::into);
            op.phase = InputPhase::Dispatching;
            op.recording = Recording::ResultPending;
            save(db, &mut op)?;
            fault("after_dispatch_state")?;
            update_queue_status(db, &op, "sending")?;
            fault("before_commit_dispatch")?;
            changed(db, &op)?;
            Ok(DispatchPermit {
                operation_id: id.into(),
                attempt_id,
            })
        })
    }
    fn record_result<T>(&self, f: impl FnOnce(&Transaction<'_>) -> Result<T>) -> Result<T> {
        let mut db = self
            .0
            .lock()
            .map_err(|_| err(ErrorKind::Storage, "Store lock poisoned"))?;
        let result: Result<T> = (|| {
            let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
            let value = f(&tx)?;
            fault("before_commit")?;
            tx.commit()?;
            Ok(value)
        })();
        match result {
            Err(e) if matches!(e.kind, ErrorKind::Storage | ErrorKind::Corrupt) => {
                self.2.store(true, Ordering::SeqCst);
                Err(err(
                    ErrorKind::RecordingFailure,
                    "Native outcome may exist; result transaction failed, do not resend",
                ))
            }
            other => other,
        }
    }
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "I02b will consume Store::record_input_accepted; remove at dispatch integration"
        )
    )]
    pub fn record_input_accepted(
        &self,
        p: &Identity,
        sid: &str,
        permit: &DispatchPermit,
        receipt: &InputReceipt,
    ) -> Result<Operation> {
        self.record_result(|db| {
            pair(db, p)?;
            let mut op = operation(db, sid, &permit.operation_id)?;
            require(
                op.phase == InputPhase::Dispatching
                    && op.data.dispatch_attempt_id.as_deref() == Some(&permit.attempt_id),
                ErrorKind::IllegalTransition,
                "Dispatch attempt is not active",
            )?;
            accept(db, &mut op, receipt)?;
            Ok(op)
        })
    }
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "I02b will consume Store::record_input_rejected; remove at dispatch integration"
        )
    )]
    pub fn record_input_rejected(
        &self,
        p: &Identity,
        sid: &str,
        permit: &DispatchPermit,
        reason: Rejection,
    ) -> Result<Operation> {
        self.record_result(|db| {
            pair(db, p)?;
            let mut op = operation(db, sid, &permit.operation_id)?;
            require(
                op.phase == InputPhase::Dispatching
                    && op.data.dispatch_attempt_id.as_deref() == Some(&permit.attempt_id),
                ErrorKind::IllegalTransition,
                "Dispatch attempt is not active",
            )?;
            op.phase = InputPhase::Rejected;
            op.recording = Recording::Normal;
            op.data.rejection = Some(reason);
            if op.goal == GoalPhase::Pending {
                op.goal = GoalPhase::Rejected;
            }
            save(db, &mut op)?;
            update_queue_status(db, &op, "rejected")?;
            changed(db, &op)?;
            Ok(op)
        })
    }
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "I02b will consume Store::record_input_uncertain; remove at dispatch integration"
        )
    )]
    pub fn record_input_uncertain(
        &self,
        p: &Identity,
        sid: &str,
        permit: &DispatchPermit,
    ) -> Result<Operation> {
        self.record_result(|db| {
            pair(db, p)?;
            let mut op = operation(db, sid, &permit.operation_id)?;
            require(
                op.phase == InputPhase::Dispatching
                    && op.data.dispatch_attempt_id.as_deref() == Some(&permit.attempt_id),
                ErrorKind::IllegalTransition,
                "Dispatch attempt is not active",
            )?;
            op.phase = InputPhase::Uncertain;
            op.recording = Recording::Normal;
            op.data.error_code = Some("delivery_unknown".into());
            save(db, &mut op)?;
            update_queue_status(db, &op, "uncertain")?;
            changed(db, &op)?;
            Ok(op)
        })
    }
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "I02b will consume Store::reconcile_input_accepted; remove at dispatch integration"
        )
    )]
    pub fn reconcile_input_accepted(
        &self,
        p: &Identity,
        sid: &str,
        id: &str,
        receipt: &InputReceipt,
    ) -> Result<Operation> {
        self.record_result(|db| {
            pair(db, p)?;
            let mut op = operation(db, sid, id)?;
            require(
                op.phase == InputPhase::Uncertain,
                ErrorKind::IllegalTransition,
                "Only uncertain input can reconcile",
            )?;
            accept(db, &mut op, receipt)?;
            Ok(op)
        })
    }
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "I02b will consume Store::verify_ledger_storage_recovery; remove at dispatch integration"
        )
    )]
    pub fn verify_ledger_storage_recovery(&self, p: &Identity) -> Result<()> {
        let mut db = self
            .0
            .lock()
            .map_err(|_| err(ErrorKind::Storage, "Store lock poisoned"))?;
        {
            let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
            pair(&tx, p)?;
            validate(&tx)?;
            // The same production recovery also handles ambiguous preparation
            // receipts, not just input/goal results. No side effect is replayed.
            recover(&tx)?;
            fault("before_commit")?;
            tx.commit()?;
        }
        pair(&db, p)?;
        validate(&db)?;
        self.2.store(false, Ordering::SeqCst);
        Ok(())
    }
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "I02b will consume Store::claim_operation_goal; remove at dispatch integration"
        )
    )]
    pub fn claim_operation_goal(
        &self,
        p: &Identity,
        sid: &str,
        id: &str,
        v: i64,
        expected_goal_id: Option<&str>,
    ) -> Result<GoalPermit> {
        require(
            !self.2.load(Ordering::SeqCst),
            ErrorKind::Fenced,
            "Store recording fence",
        )?;
        self.ledger_tx(|db| {
            require(
                !self.2.load(Ordering::SeqCst),
                ErrorKind::Fenced,
                "Store recording fence",
            )?;
            pair(db, p)?;
            let mut op = operation(db, sid, id)?;
            revision(&op, v)?;
            can_send(&current(db, &op)?)?;
            check_fence(db, &op)?;
            require(
                op.phase == InputPhase::Accepted
                    && op.goal == GoalPhase::Pending
                    && op.data.goal_claim_id.is_none(),
                ErrorKind::IllegalTransition,
                "Goal cannot be activated again",
            )?;
            if let Some(g) = expected_goal_id {
                nonempty(g)?;
            }
            let claim_id = Uuid::new_v4().to_string();
            op.data.goal_claim_id = Some(claim_id.clone());
            op.recording = Recording::ResultPending;
            op.data.expected_goal_id = expected_goal_id.map(Into::into);
            save(db, &mut op)?;
            Ok(GoalPermit {
                operation_id: id.into(),
                claim_id,
            })
        })
    }
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "I02b will consume Store::record_operation_goal; remove at dispatch integration"
        )
    )]
    pub fn record_operation_goal(
        &self,
        p: &Identity,
        sid: &str,
        permit: &GoalPermit,
        outcome: GoalOutcome,
    ) -> Result<Operation> {
        self.record_result(|db| {
            pair(db, p)?;
            let mut op = operation(db, sid, &permit.operation_id)?;
            require(
                op.phase == InputPhase::Accepted
                    && op.goal == GoalPhase::Pending
                    && op.data.goal_claim_id.as_deref() == Some(&permit.claim_id),
                ErrorKind::IllegalTransition,
                "Goal claim not active",
            )?;
            op.recording = Recording::Normal;
            match outcome {
                GoalOutcome::Accepted(ref receipt) => {
                    require(
                        op.data.binding.thread_id.as_deref() == Some(&receipt.thread_id),
                        ErrorKind::BindingConflict,
                        "Goal thread changed",
                    )?;
                    nonempty(&receipt.goal_id)?;
                    op.goal = GoalPhase::Accepted;
                    op.data.goal_receipt = Some(receipt.clone());
                }
                GoalOutcome::Rejected => op.goal = GoalPhase::Rejected,
                GoalOutcome::Uncertain => op.goal = GoalPhase::Uncertain,
            }
            save(db, &mut op)?;
            changed(db, &op)?;
            Ok(op)
        })
    }
}
#[derive(Clone, Debug)]
#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "I02b goal adapter constructs typed accepted/rejected/uncertain outcomes; remove at integration"
    )
)]
pub enum GoalOutcome {
    Accepted(GoalReceipt),
    Rejected,
    Uncertain,
}
fn accept(db: &Connection, op: &mut Operation, receipt: &InputReceipt) -> Result<()> {
    match_receipt(op, receipt)?;
    op.phase = InputPhase::Accepted;
    op.recording = Recording::Normal;
    op.data.input_receipt = Some(receipt.clone());
    op.data.error_code = None;
    save(db, op)?;
    fault("after_acceptance")?;
    let intent = op.intent()?;
    event(
        db,
        op,
        "user/message",
        json!({"text":intent.text,"display_text":intent.text,"attachments":intent.attachments,"composer":intent.composer,"clientUserMessageId":op.data.client_user_message_id,"operation_id":op.id,"operation_accepted":true}),
    )?;
    fault("after_echo")?;
    remove_queue(db, op)?;
    changed(db, op)?;
    Ok(())
}
fn check_preparation_receipt(
    db: &Connection,
    op: &mut Operation,
    s: &Session,
    spec: &PreparationSpec,
    receipt: &PreparationReceipt,
) -> Result<()> {
    match (spec, receipt) {
        (PreparationSpec::Snapshot { index }, PreparationReceipt::Snapshot { artifact }) => {
            artifact.check(&op.id)?;
            require(
                index == &artifact.index,
                ErrorKind::BindingConflict,
                "Artifact index changed",
            )?;
        }
        (PreparationSpec::GoalArtifact, PreparationReceipt::GoalArtifact { artifact }) => {
            artifact.check(&op.id)?
        }
        (
            PreparationSpec::Upload { index },
            PreparationReceipt::Upload {
                index: actual,
                native_file_id,
            },
        ) => {
            require(
                index == actual,
                ErrorKind::BindingConflict,
                "Upload index changed",
            )?;
            nonempty(native_file_id)?;
        }
        (
            PreparationSpec::ThreadStart
            | PreparationSpec::ThreadResume
            | PreparationSpec::EmptyThreadFallback { .. },
            PreparationReceipt::Thread {
                thread_id,
                instance_id,
                native_version,
            },
        ) => {
            nonempty(thread_id)?;
            if matches!(spec, PreparationSpec::ThreadResume) {
                require(
                    s.thread_id.as_ref() == Some(thread_id),
                    ErrorKind::BindingConflict,
                    "Resume cannot retarget thread",
                )?;
            }
            for field in [instance_id, native_version].into_iter().flatten() {
                nonempty(field)?;
            }
            let n=db.execute("UPDATE sessions SET data=json_set(data,'$.thread_id',?2) WHERE id=?1 AND json_extract(data,'$.thread_id') IS ?3",params![op.session_id,thread_id,s.thread_id])?;
            require(
                n == 1,
                ErrorKind::Conflict,
                "Session thread changed during preparation",
            )?;
            op.data.binding.thread_id = Some(thread_id.clone());
            op.data.binding.instance_id = instance_id.clone();
            op.data.binding.native_version = native_version.clone();
        }
        _ => {
            return Err(err(
                ErrorKind::BindingConflict,
                "Preparation receipt kind changed",
            ));
        }
    }
    Ok(())
}

impl Store {
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "I02b will consume Store::admit_queued_operation; remove at dispatch integration"
        )
    )]
    pub fn admit_queued_operation(
        &self,
        p: &Identity,
        sid: &str,
        id: &str,
        intent: &Intent,
        binding: &Binding,
    ) -> Result<Admission> {
        self.ledger_tx(|db| {
            pair(db, p)?;
            let mut admitted = insert(db, sid, id, intent, binding)?;
            if !admitted.created {
                return Ok(admitted);
            }
            let op = &mut admitted.operation;
            op.phase = InputPhase::Queued;
            op.data.route = Some(Route::Queue);
            save(db, op)?;
            db.execute(
                "INSERT INTO message_queue(session_id,data) VALUES(?1,?2)",
                params![sid, queue_value(intent).to_string()],
            )?;
            let seq = db.last_insert_rowid();
            fault("after_queue_insert")?;
            db.execute(
                "INSERT INTO message_operation_queue VALUES(?1,?2,?3,'queue')",
                params![seq, id, sid],
            )?;
            changed(db, op)?;
            Ok(admitted)
        })
    }
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "I02b will consume Store::queue_recorded_operation; remove at dispatch integration"
        )
    )]
    pub fn queue_recorded_operation(
        &self,
        p: &Identity,
        sid: &str,
        id: &str,
        v: i64,
    ) -> Result<Operation> {
        self.ledger_tx(|db| {
            pair(db, p)?;
            let mut op = operation(db, sid, id)?;
            revision(&op, v)?;
            can_send(&current(db, &op)?)?;
            require(
                op.phase == InputPhase::Recorded
                    && matches!(
                        op.preparation,
                        PreparationPhase::NotStarted | PreparationPhase::Prepared
                    )
                    && matches!(op.data.route, None | Some(Route::Queue)),
                ErrorKind::IllegalTransition,
                "Recorded operation cannot enter queue",
            )?;
            let intent = op.intent()?;
            op.phase = InputPhase::Queued;
            op.data.route = Some(Route::Queue);
            save(db, &mut op)?;
            db.execute(
                "INSERT INTO message_queue(session_id,data) VALUES(?1,?2)",
                params![sid, queue_value(&intent).to_string()],
            )?;
            let seq = db.last_insert_rowid();
            fault("after_queue_insert")?;
            db.execute(
                "INSERT INTO message_operation_queue VALUES(?1,?2,?3,'queue')",
                params![seq, id, sid],
            )?;
            changed(db, &op)?;
            Ok(op)
        })
    }
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "I02b will consume Store::adopt_legacy_pending; remove at dispatch integration"
        )
    )]
    pub fn adopt_legacy_pending(
        &self,
        p: &Identity,
        sid: &str,
        seq: i64,
        id: &str,
        expected: &Value,
        binding: &Binding,
    ) -> Result<Admission> {
        self.ledger_tx(|db| {
            pair(db, p)?;
            require_unlinked(db, sid, seq)?;
            let editing: bool = db.query_row(
                "SELECT EXISTS(SELECT 1 FROM queue_edits WHERE session_id=?1 AND seq=?2)",
                params![sid, seq],
                |r| r.get(0),
            )?;
            let row = queue_data(db, sid, seq, editing)?;
            require(
                row == *expected,
                ErrorKind::Conflict,
                "Legacy queue changed",
            )?;
            require(
                row["status"] == "pending",
                ErrorKind::IllegalTransition,
                "Legacy unknown input cannot become executable",
            )?;
            let intent = queue_intent(&row)?;
            let mut a = insert(db, sid, id, &intent, binding)?;
            require(
                a.created,
                ErrorKind::Conflict,
                "Legacy adoption needs unused ID",
            )?;
            a.operation.phase = InputPhase::Queued;
            a.operation.data.route = Some(Route::Queue);
            save(db, &mut a.operation)?;
            db.execute(
                "INSERT INTO message_operation_queue VALUES(?1,?2,?3,?4)",
                params![seq, id, sid, if editing { "editing" } else { "queue" }],
            )?;
            changed(db, &a.operation)?;
            Ok(a)
        })
    }
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "I02b will consume Store::take_operation_queue_edit; remove at dispatch integration"
        )
    )]
    pub fn take_operation_queue_edit(
        &self,
        p: &Identity,
        sid: &str,
        id: &str,
        v: i64,
        seq: i64,
    ) -> Result<Operation> {
        self.ledger_tx(|db| {
            pair(db, p)?;
            let mut op = operation(db, sid, id)?;
            revision(&op, v)?;
            editable(&op)?;
            can_send(&current(db, &op)?)?;
            require(
                op.phase == InputPhase::Queued
                    && queue_link(db, &op)? == Some((seq, "queue".into())),
                ErrorKind::Conflict,
                "Queue identity changed",
            )?;
            let row = queue_data(db, sid, seq, false)?;
            require(
                row["status"] == "pending",
                ErrorKind::IllegalTransition,
                "Only pending queue can be edited",
            )?;
            db.execute(
                "INSERT INTO queue_edits VALUES(?1,?2,?3)",
                params![sid, seq, row.to_string()],
            )?;
            fault("after_queue_edit_copy")?;
            db.execute(
                "DELETE FROM message_queue WHERE session_id=?1 AND seq=?2",
                params![sid, seq],
            )?;
            db.execute(
                "UPDATE message_operation_queue SET location='editing' WHERE operation_id=?1",
                [id],
            )?;
            save(db, &mut op)?;
            changed(db, &op)?;
            Ok(op)
        })
    }
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "I02b will consume Store::restore_operation_queue_edit; remove at dispatch integration"
        )
    )]
    pub fn restore_operation_queue_edit(
        &self,
        p: &Identity,
        sid: &str,
        id: &str,
        v: i64,
        seq: i64,
    ) -> Result<Operation> {
        self.ledger_tx(|db| {
            pair(db, p)?;
            let mut op = operation(db, sid, id)?;
            revision(&op, v)?;
            editable(&op)?;
            require(
                op.phase == InputPhase::Queued
                    && queue_link(db, &op)? == Some((seq, "editing".into())),
                ErrorKind::Conflict,
                "Queue editor identity changed",
            )?;
            let row = queue_data(db, sid, seq, true)?;
            db.execute(
                "INSERT INTO message_queue VALUES(?1,?2,?3)",
                params![seq, sid, row.to_string()],
            )?;
            fault("after_queue_restore_copy")?;
            db.execute(
                "DELETE FROM queue_edits WHERE session_id=?1 AND seq=?2",
                params![sid, seq],
            )?;
            db.execute(
                "UPDATE message_operation_queue SET location='queue' WHERE operation_id=?1",
                [id],
            )?;
            save(db, &mut op)?;
            changed(db, &op)?;
            Ok(op)
        })
    }
    #[allow(
        clippy::too_many_arguments,
        reason = "Atomic replacement carries both expected old identity and immutable new intent"
    )]
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "I02b will consume Store::replace_operation_queue; remove at dispatch integration"
        )
    )]
    pub fn replace_operation_queue(
        &self,
        p: &Identity,
        sid: &str,
        old_id: &str,
        old_revision: i64,
        seq: i64,
        new_id: &str,
        intent: &Intent,
        binding: &Binding,
    ) -> Result<Admission> {
        self.ledger_tx(|db| {
            pair(db, p)?;
            session(db, sid)?;
            // Resolve a lost replacement response through its pre-journaled new ID.
            match load(db, sid, new_id)? {
                Lookup::Found(op) => {
                    require(
                        op.data.replaces.as_deref() == Some(old_id) && op.data.intent == intent.canonical()?,
                        ErrorKind::IntentConflict, "Replacement ID already has different intent",
                    )?;
                    return Ok(Admission { created: false, operation: *op });
                }
                Lookup::Tombstone => return Err(err(ErrorKind::UsedId, "Replacement ID permanently used")),
                Lookup::NeverRecorded => {}
            }
            let mut old = operation(db, sid, old_id)?;
            revision(&old, old_revision)?;
            editable(&old)?;
            can_send(&current(db, &old)?)?;
            let link = queue_link(db, &old)?.ok_or_else(|| err(ErrorKind::Missing, "Queue association missing"))?;
            require(link.0 == seq && old.phase == InputPhase::Queued, ErrorKind::Conflict, "Expected old queue identity changed")?;
            let mut a = insert(db, sid, new_id, intent, binding)?;
            require(a.created, ErrorKind::Conflict, "Replacement ID already used")?;
            old.phase = InputPhase::Superseded;
            if old.goal == GoalPhase::Pending { old.goal = GoalPhase::Rejected; }
            old.data.superseded_by = Some(new_id.into());
            save(db, &mut old)?;
            fault("after_supersession")?;
            a.operation.phase = InputPhase::Queued;
            a.operation.data.route = Some(Route::Queue);
            a.operation.data.replaces = Some(old_id.into());
            save(db, &mut a.operation)?;
            if link.1 == "editing" {
                db.execute("DELETE FROM queue_edits WHERE session_id=?1 AND seq=?2", params![sid, seq])?;
                db.execute("INSERT INTO message_queue VALUES(?1,?2,?3)", params![seq, sid, queue_value(intent).to_string()])?;
            } else {
                db.execute("UPDATE message_queue SET data=?3 WHERE session_id=?1 AND seq=?2", params![sid, seq, queue_value(intent).to_string()])?;
            }
            db.execute("UPDATE message_operation_queue SET operation_id=?2,location='queue' WHERE queue_seq=?1", params![seq, new_id])?;
            fault("after_queue_replace")?;
            changed(db, &old)?;
            changed(db, &a.operation)?;
            Ok(a)
        })
    }
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "I02b will consume Store::cancel_undispatched_operation; remove at dispatch integration"
        )
    )]
    pub fn cancel_undispatched_operation(
        &self,
        p: &Identity,
        sid: &str,
        id: &str,
        v: i64,
    ) -> Result<Operation> {
        self.ledger_tx(|db| {
            pair(db, p)?;
            let mut op = operation(db, sid, id)?;
            revision(&op, v)?;
            editable(&op)?;
            op.phase = InputPhase::Cancelled;
            if op.goal == GoalPhase::Pending {
                op.goal = GoalPhase::Rejected;
            }
            remove_queue(db, &op)?;
            save(db, &mut op)?;
            changed(db, &op)?;
            Ok(op)
        })
    }
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "I02b will consume Store::detach_uncertain_queue; remove at dispatch integration"
        )
    )]
    pub fn detach_uncertain_queue(
        &self,
        p: &Identity,
        sid: &str,
        id: &str,
        v: i64,
    ) -> Result<Operation> {
        self.ledger_tx(|db| {
            pair(db, p)?;
            let mut op = operation(db, sid, id)?;
            revision(&op, v)?;
            require(
                op.phase == InputPhase::Uncertain,
                ErrorKind::IllegalTransition,
                "Only uncertain queue display can detach",
            )?;
            remove_queue(db, &op)?;
            save(db, &mut op)?;
            changed(db, &op)?;
            Ok(op)
        })
    }
}

pub(super) fn validate(db: &Connection) -> Result<()> {
    identity(db)?;
    let mut q = db.prepare(
        "SELECT operation_id,session_id FROM message_operation_ids ORDER BY operation_id",
    )?;
    let ids = q
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for (id, sid) in ids {
        uuid(&id)?;
        nonempty(&sid)?;
        if let Lookup::Found(op) = load(db, &sid, &id)? {
            let s = session(db, &sid)?;
            require(
                s.agent == op.data.binding.agent,
                ErrorKind::Corrupt,
                "Operation Agent differs from session",
            )?;
            let all = steps(db, &id)?;
            require(
                all.len() <= 40,
                ErrorKind::Corrupt,
                "Too many preparation steps",
            )?;
            for step in &all {
                if let Some(receipt) = &step.receipt {
                    validate_saved_receipt(&op, &step.spec, receipt)?;
                }
            }
            if let Some(prepared) = &op.data.prepared {
                require(
                    *prepared == prepared_from_steps(&all)?,
                    ErrorKind::Corrupt,
                    "Prepared bundle differs from confirmed receipts",
                )?;
            }
            let inflight = all.iter().filter(|s| s.phase == StepPhase::Claimed).count();
            require(
                inflight <= 1 && (inflight == 0 || op.preparation == PreparationPhase::Preparing),
                ErrorKind::Corrupt,
                "Invalid in-flight preparation aggregate",
            )?;
            if let Some((seq, location)) = queue_link(db, &op)? {
                let value = queue_data(db, &sid, seq, location == "editing")?;
                let existing = op.intent()?;
                let queued = queue_intent(&value)?;
                require(
                    existing.text == queued.text
                        && existing.attachments == queued.attachments
                        && existing.composer == queued.composer
                        && existing.goal == queued.goal,
                    ErrorKind::Corrupt,
                    "Queue/intent content mismatch",
                )?;
                require(
                    matches!(
                        op.phase,
                        InputPhase::Queued
                            | InputPhase::Dispatching
                            | InputPhase::Uncertain
                            | InputPhase::Rejected
                    ),
                    ErrorKind::Corrupt,
                    "Terminal operation retained executable queue",
                )?;
                let status = value["status"]
                    .as_str()
                    .ok_or_else(|| err(ErrorKind::Corrupt, "Queue status missing"))?;
                let expected = match op.phase {
                    InputPhase::Queued => "pending",
                    InputPhase::Dispatching => "sending",
                    InputPhase::Uncertain => "uncertain",
                    InputPhase::Rejected => "rejected",
                    _ => unreachable!(),
                };
                require(
                    status == expected,
                    ErrorKind::Corrupt,
                    "Queue/ledger state mismatch",
                )?;
            } else {
                require(
                    op.phase != InputPhase::Queued,
                    ErrorKind::Corrupt,
                    "Queued operation missing association",
                )?;
            }
        }
    }
    // Check only newly introduced ledger relationships, never legacy orphan events.
    for sql in [
        "SELECT count(*) FROM message_operations o LEFT JOIN message_operation_ids i ON i.operation_id=o.operation_id AND i.session_id=o.session_id WHERE i.operation_id IS NULL",
        "SELECT count(*) FROM message_operation_preparation p LEFT JOIN message_operations o ON o.operation_id=p.operation_id WHERE o.operation_id IS NULL",
        "SELECT count(*) FROM message_operation_queue q LEFT JOIN message_operations o ON o.operation_id=q.operation_id AND o.session_id=q.session_id WHERE o.operation_id IS NULL",
    ] {
        let bad: i64 = db.query_row(sql, [], |r| r.get(0))?;
        require(bad == 0, ErrorKind::Corrupt, "Orphan ledger relationship")?;
    }
    Ok(())
}
fn validate_saved_receipt(
    op: &Operation,
    spec: &PreparationSpec,
    receipt: &PreparationReceipt,
) -> Result<()> {
    match (spec, receipt) {
        (PreparationSpec::Snapshot { index }, PreparationReceipt::Snapshot { artifact }) => {
            artifact.check(&op.id)?;
            require(
                index == &artifact.index,
                ErrorKind::Corrupt,
                "Saved snapshot mismatch",
            )?;
        }
        (PreparationSpec::GoalArtifact, PreparationReceipt::GoalArtifact { artifact }) => {
            artifact.check(&op.id)?
        }
        (
            PreparationSpec::ThreadStart
            | PreparationSpec::ThreadResume
            | PreparationSpec::EmptyThreadFallback { .. },
            PreparationReceipt::Thread {
                thread_id,
                instance_id,
                native_version,
            },
        ) => {
            nonempty(thread_id)?;
            for s in [instance_id, native_version].into_iter().flatten() {
                nonempty(s)?;
            }
        }
        (
            PreparationSpec::Upload { index },
            PreparationReceipt::Upload {
                index: actual,
                native_file_id,
            },
        ) => {
            require(index == actual, ErrorKind::Corrupt, "Saved upload mismatch")?;
            nonempty(native_file_id)?;
        }
        _ => return Err(err(ErrorKind::Corrupt, "Saved preparation kind mismatch")),
    }
    Ok(())
}
pub(super) fn recover(db: &Connection) -> Result<()> {
    let mut q =
        db.prepare("SELECT operation_id,session_id FROM message_operations ORDER BY operation_id")?;
    let ids = q
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    drop(q);
    for (id, sid) in ids {
        let mut op = operation(db, &sid, &id)?;
        let mut modified = false;
        if op.phase == InputPhase::Dispatching {
            op.phase = InputPhase::Uncertain;
            op.data.error_code = Some("restart_delivery_unknown".into());
            update_queue_status(db, &op, "uncertain")?;
            modified = true;
        }
        if op.recording == Recording::ResultPending {
            op.recording = Recording::RecoveryRequired;
            modified = true;
        }
        let count=db.execute("UPDATE message_operation_preparation SET phase='uncertain' WHERE operation_id=?1 AND phase='claimed'",[&id])?;
        if count > 0 {
            op.preparation = PreparationPhase::Uncertain;
            op.data.error_code = Some("restart_preparation_unknown".into());
            modified = true;
        }
        if op.goal == GoalPhase::Pending && op.data.goal_claim_id.is_some() {
            op.goal = GoalPhase::Uncertain;
            modified = true;
        }
        if modified {
            save(db, &mut op)?;
            fault("after_ledger_recovery")?;
            changed(db, &op)?;
        }
    }
    Ok(())
}

/// Adapter-provided exact occurrence evidence. Store checks identity binding;
/// native query semantics must be proved by the I02b adapter, never text matching.
#[derive(Clone, Debug)]
pub struct NotAcceptedObservation {
    pub thread_id: String,
    pub client_user_message_id: String,
    pub native_request_id: Option<String>,
    pub proof_id: String,
}
impl Store {
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "I02b will consume Store::reject_before_input; remove at dispatch integration"
        )
    )]
    pub fn reject_before_input(
        &self,
        p: &Identity,
        sid: &str,
        id: &str,
        v: i64,
        reason: Rejection,
    ) -> Result<Operation> {
        self.ledger_tx(|db| {
            pair(db, p)?;
            let mut op = operation(db, sid, id)?;
            revision(&op, v)?;
            editable(&op)?;
            require(
                op.preparation != PreparationPhase::Uncertain
                    && reason != Rejection::NativeExplicit,
                ErrorKind::IllegalTransition,
                "Cannot call uncertain preparation a definite rejection",
            )?;
            op.phase = InputPhase::Rejected;
            op.data.rejection = Some(reason);
            if op.goal == GoalPhase::Pending {
                op.goal = GoalPhase::Rejected;
            }
            save(db, &mut op)?;
            update_queue_status(db, &op, "rejected")?;
            changed(db, &op)?;
            Ok(op)
        })
    }
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "I02b will consume Store::reconcile_input_rejected; remove at dispatch integration"
        )
    )]
    pub fn reconcile_input_rejected(
        &self,
        p: &Identity,
        sid: &str,
        id: &str,
        observation: &NotAcceptedObservation,
    ) -> Result<Operation> {
        self.record_result(|db| {
            pair(db, p)?;
            let mut op = operation(db, sid, id)?;
            require(
                op.phase == InputPhase::Uncertain
                    && op.data.binding.thread_id.as_ref() == Some(&observation.thread_id)
                    && observation.client_user_message_id == op.data.client_user_message_id
                    && observation.native_request_id == op.data.native_request_id,
                ErrorKind::BindingConflict,
                "Rejection observation identity mismatch",
            )?;
            nonempty(&observation.proof_id)?;
            op.phase = InputPhase::Rejected;
            op.recording = Recording::Normal;
            op.data.rejection = Some(Rejection::NativeExplicit);
            op.data.rejection_proof = Some(observation.proof_id.clone());
            op.data.error_code = None;
            if op.goal == GoalPhase::Pending {
                op.goal = GoalPhase::Rejected;
            }
            save(db, &mut op)?;
            update_queue_status(db, &op, "rejected")?;
            changed(db, &op)?;
            Ok(op)
        })
    }
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "I02b will consume Store::reconcile_preparation_receipt; remove at dispatch integration"
        )
    )]
    pub fn reconcile_preparation_receipt(
        &self,
        p: &Identity,
        sid: &str,
        id: &str,
        claim_id: &str,
        receipt: &PreparationReceipt,
    ) -> Result<Operation> {
        self.record_result(|db| {
            pair(db, p)?;
            let mut op = operation(db, sid, id)?;
            let s = current(db, &op)?;
            require(
                matches!(op.phase, InputPhase::Recorded | InputPhase::Queued) && op.preparation == PreparationPhase::Uncertain,
                ErrorKind::IllegalTransition, "Preparation is not uncertain",
            )?;
            let all = steps(db, id)?;
            let step = all.iter().find(|s| s.claim_id == claim_id).ok_or_else(|| err(ErrorKind::Missing, "Preparation claim missing"))?;
            require(
                step.phase == StepPhase::Uncertain && all.iter().filter(|s| s.phase == StepPhase::Uncertain).count() == 1,
                ErrorKind::Conflict, "Preparation claim state changed",
            )?;
            check_preparation_receipt(db, &mut op, &s, &step.spec, receipt)?;
            db.execute(
                "UPDATE message_operation_preparation SET phase='confirmed',receipt=?2 WHERE claim_id=?1",
                params![claim_id, serde_json::to_string(receipt)?],
            )?;
            op.preparation = PreparationPhase::Preparing;
            op.data.error_code = None;
            save(db, &mut op)?;
            changed(db, &op)?;
            Ok(op)
        })
    }
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "I02b will consume Store::reconcile_operation_goal; remove at dispatch integration"
        )
    )]
    pub fn reconcile_operation_goal(
        &self,
        p: &Identity,
        sid: &str,
        id: &str,
        receipt: &GoalReceipt,
    ) -> Result<Operation> {
        self.record_result(|db| {
            pair(db, p)?;
            let mut op = operation(db, sid, id)?;
            require(
                op.phase == InputPhase::Accepted
                    && op.goal == GoalPhase::Uncertain
                    && op.data.goal_claim_id.is_some()
                    && op.data.binding.thread_id.as_ref() == Some(&receipt.thread_id),
                ErrorKind::BindingConflict,
                "Goal observation identity mismatch",
            )?;
            nonempty(&receipt.goal_id)?;
            op.goal = GoalPhase::Accepted;
            op.recording = Recording::Normal;
            op.data.goal_receipt = Some(receipt.clone());
            save(db, &mut op)?;
            changed(db, &op)?;
            Ok(op)
        })
    }
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "I02b will consume Store::detach_rejected_queue; remove at dispatch integration"
        )
    )]
    pub fn detach_rejected_queue(
        &self,
        p: &Identity,
        sid: &str,
        id: &str,
        v: i64,
    ) -> Result<Operation> {
        self.ledger_tx(|db| {
            pair(db, p)?;
            let mut op = operation(db, sid, id)?;
            revision(&op, v)?;
            require(
                op.phase == InputPhase::Rejected,
                ErrorKind::IllegalTransition,
                "Input is not rejected",
            )?;
            remove_queue(db, &op)?;
            save(db, &mut op)?;
            changed(db, &op)?;
            Ok(op)
        })
    }
}

#[cfg(test)]
mod tests;
