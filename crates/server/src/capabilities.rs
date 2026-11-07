//! Additive policy advice, never command authorization or a native probe.
//!
//! Current runtimes have no trusted native generation/expiry observations.
//! An Arc, stored status or descriptor cannot establish native readiness.
use crate::{ApiError, App, store::Session};
use axum::{
    Json,
    extract::{Path, State},
};
use remote_agent_sdk::PluginManifest;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, sync::Arc};

pub const VERSION: u32 = 1;
const LOCAL_VALID_FOR_MS: i64 = 5_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
enum Support {
    Yes,
    No,
    Unknown,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
enum Topology {
    CodexManaged,
    CodexExternalUnknown,
    HarnessGateway,
    WorkbuddyDesktop,
    CustomUnknown,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
enum Action {
    #[serde(rename = "history.read")]
    HistoryRead,
    #[serde(rename = "session.create")]
    SessionCreate,
    #[serde(rename = "session.connect")]
    SessionConnect,
    #[serde(rename = "session.fork")]
    SessionFork,
    #[serde(rename = "message.start")]
    MessageStart,
    #[serde(rename = "message.steer")]
    MessageSteer,
    #[serde(rename = "interrupt")]
    Interrupt,
    #[serde(rename = "approvals.respond")]
    ApprovalRespond,
    #[serde(rename = "questions.respond")]
    QuestionRespond,
    #[serde(rename = "model.set")]
    ModelSet,
    #[serde(rename = "effort.set")]
    EffortSet,
    #[serde(rename = "tier.set")]
    TierSet,
    #[serde(rename = "plan.set")]
    PlanSet,
    #[serde(rename = "goal.get")]
    GoalGet,
    #[serde(rename = "goal.create")]
    GoalCreate,
    #[serde(rename = "goal.edit")]
    GoalEdit,
    #[serde(rename = "goal.pause")]
    GoalPause,
    #[serde(rename = "goal.resume")]
    GoalResume,
    #[serde(rename = "goal.clear")]
    GoalClear,
    #[serde(rename = "message.edit")]
    MessageEdit,
    #[serde(rename = "local_queue.enqueue")]
    QueueEnqueue,
    #[serde(rename = "local_queue.edit")]
    QueueEdit,
    #[serde(rename = "local_queue.pause")]
    QueuePause,
    #[serde(rename = "local_queue.resume")]
    QueueResume,
    #[serde(rename = "local_queue.delete")]
    QueueDelete,
    #[serde(rename = "local_queue.steer")]
    QueueSteer,
}
const ACTIONS: [Action; 26] = [
    Action::HistoryRead,
    Action::SessionCreate,
    Action::SessionConnect,
    Action::SessionFork,
    Action::MessageStart,
    Action::MessageSteer,
    Action::Interrupt,
    Action::ApprovalRespond,
    Action::QuestionRespond,
    Action::ModelSet,
    Action::EffortSet,
    Action::TierSet,
    Action::PlanSet,
    Action::GoalGet,
    Action::GoalCreate,
    Action::GoalEdit,
    Action::GoalPause,
    Action::GoalResume,
    Action::GoalClear,
    Action::MessageEdit,
    Action::QueueEnqueue,
    Action::QueueEdit,
    Action::QueuePause,
    Action::QueueResume,
    Action::QueueDelete,
    Action::QueueSteer,
];
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
enum Owner {
    Anywork,
    Native,
    AnyworkThenNative,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
enum Reason {
    CachedHistory,
    LocalQueue,
    UnsupportedOperation,
    SupportUnknown,
    NativeObservationMissing,
    NotConfigured,
    IntegrationDisabled,
    Archived,
    ReadOnlyChild,
    StoredBusy,
    CurrentOccurrenceUnknown,
    NoEditableQueueItem,
    NoDeletableQueueItem,
    QueueEditPending,
    SessionCreationScope,
}
impl Reason {
    fn explanation(self) -> &'static str {
        match self {
            Self::CachedHistory => {
                "AnyWork cached history can be read; native completeness is not asserted."
            }
            Self::LocalQueue => {
                "This action affects only the AnyWork queue, not native queued or running work."
            }
            Self::UnsupportedOperation => {
                "The bound adapter policy does not implement this operation."
            }
            Self::SupportUnknown => {
                "Support is not established for this topology or native thread."
            }
            Self::NativeObservationMissing => {
                "No current identity-bound native generation observation is available."
            }
            Self::NotConfigured => {
                "The integration configuration is unavailable or cannot be interpreted."
            }
            Self::IntegrationDisabled => "This session's integration is not registered.",
            Self::Archived => "Unarchive the session before requesting native changes.",
            Self::ReadOnlyChild => "WorkBuddy auxiliary conversations are read-only.",
            Self::StoredBusy => {
                "The stored session is busy; this is not a fresh native observation."
            }
            Self::CurrentOccurrenceUnknown => {
                "A current unresolved request and its native generation are not established."
            }
            Self::NoEditableQueueItem => {
                "No pending AnyWork queue item is currently available for editing."
            }
            Self::NoDeletableQueueItem => {
                "No non-sending AnyWork queue item is currently available for removal."
            }
            Self::QueueEditPending => "An AnyWork queue item is already held by the queue editor.",
            Self::SessionCreationScope => {
                "Creation is an integration/workspace action, not an operation on this session."
            }
        }
    }
}
#[derive(Serialize)]
struct ActionProjection {
    supported: Support,
    allowed_now: bool,
    reason_code: Reason,
    reason: &'static str,
    owner: Owner,
    limitations: Vec<&'static str>,
    source: &'static str,
}
impl ActionProjection {
    fn new(supported: Support, allowed_now: bool, reason: Reason, owner: Owner) -> Self {
        Self {
            supported,
            allowed_now,
            reason_code: reason,
            reason: reason.explanation(),
            owner,
            limitations: vec![],
            source: "adapter_policy_and_anywork_store",
        }
    }
}
#[derive(Serialize)]
struct Readiness {
    enabled: bool,
    configured: bool,
    // None means unknown, not false or a request to probe.
    installed: Option<bool>,
    transport_reachable: Option<bool>,
    identity_verified: Option<bool>,
    readable: bool,
    writable: Option<bool>,
}
#[derive(Serialize)]
struct Binding<'a> {
    session_id: &'a str,
    agent: &'a str,
    thread_id: Option<&'a str>,
    topology: Topology,
    auxiliary: bool,
    archived: bool,
    native_version: Option<&'a str>,
    native_instance: Option<&'a str>,
    generation: Option<&'a str>,
}
#[derive(Serialize)]
struct Evidence {
    execution: &'static str,
    version_scope: Option<&'static str>,
    reference: &'static str,
}
fn evidence(agent: &str) -> Evidence {
    let (execution, version_scope) = match agent {
        crate::workbuddy::AGENT => (
            "experimental",
            Some("WorkBuddy Desktop 5.9.3 adapter policy; native version unobserved"),
        ),
        crate::harness::AGENT => (
            "version_bounded",
            Some("Harness 0.2.2-rc.1 gateway adapter policy; native version unobserved"),
        ),
        "codex" => ("topology_and_version_bounded", None),
        _ => ("unverified", None),
    };
    Evidence {
        execution,
        version_scope,
        reference: "docs/support-matrix.md",
    }
}
#[derive(Serialize)]
struct Observation {
    source: &'static str,
    // Timestamps refer only to this local read. Native observation is absent.
    observed_at: i64,
    expires_at: i64,
    native_state: &'static str,
    native_observed_at: Option<i64>,
    native_expires_at: Option<i64>,
}
impl Observation {
    fn local(now: i64) -> Self {
        Self {
            source: "local_policy_and_store_only",
            observed_at: now,
            expires_at: now.saturating_add(LOCAL_VALID_FOR_MS),
            native_state: "unknown",
            native_observed_at: None,
            native_expires_at: None,
        }
    }
}
#[derive(Default)]
struct QueueFacts {
    pending: bool,
    deletable: bool,
    editing: bool,
}
fn topology(s: &Session) -> Topology {
    match (s.agent.as_str(), s.external) {
        ("codex", false) => Topology::CodexManaged,
        ("codex", true) => Topology::CodexExternalUnknown,
        (crate::harness::AGENT, _) => Topology::HarnessGateway,
        (crate::workbuddy::AGENT, _) => Topology::WorkbuddyDesktop,
        _ => Topology::CustomUnknown,
    }
}
fn is_local(action: Action) -> bool {
    matches!(
        action,
        Action::HistoryRead | Action::QueueEdit | Action::QueuePause | Action::QueueDelete
    )
}
fn support(action: Action, topology: Topology) -> Support {
    use Action::*;
    if matches!(
        action,
        HistoryRead
            | QueueEnqueue
            | QueueEdit
            | QueuePause
            | QueueResume
            | QueueDelete
            | QueueSteer
    ) {
        return Support::Yes;
    }
    if action == SessionCreate {
        return Support::No;
    }
    match topology {
        Topology::CustomUnknown | Topology::CodexExternalUnknown => Support::Unknown,
        Topology::HarnessGateway | Topology::WorkbuddyDesktop => {
            if matches!(
                action,
                SessionFork
                    | TierSet
                    | PlanSet
                    | GoalGet
                    | GoalCreate
                    | GoalEdit
                    | GoalPause
                    | GoalResume
                    | GoalClear
                    | MessageEdit
            ) {
                Support::No
            } else {
                Support::Yes
            }
        }
        Topology::CodexManaged => {
            // Goal writes and history modes need thread/version evidence. A
            // manifest or a successful goal read cannot establish these writes.
            if matches!(
                action,
                GoalCreate | GoalEdit | GoalPause | GoalResume | GoalClear | MessageEdit
            ) {
                Support::Unknown
            } else {
                Support::Yes
            }
        }
    }
}
fn action_projection(
    action: Action,
    s: &Session,
    enabled: bool,
    configured: bool,
    queue: &QueueFacts,
) -> ActionProjection {
    let support = support(action, topology(s));
    let owner = if is_local(action) {
        Owner::Anywork
    } else if matches!(
        action,
        Action::QueueEnqueue | Action::QueueResume | Action::QueueSteer
    ) {
        Owner::AnyworkThenNative
    } else {
        Owner::Native
    };
    let reason = if action == Action::HistoryRead {
        Reason::CachedHistory
    } else if action == Action::QueuePause {
        Reason::LocalQueue
    } else if action == Action::QueueDelete {
        if queue.deletable {
            Reason::LocalQueue
        } else {
            Reason::NoDeletableQueueItem
        }
    } else if s.auxiliary && s.agent == crate::workbuddy::AGENT {
        Reason::ReadOnlyChild
    } else if action == Action::SessionCreate {
        Reason::SessionCreationScope
    } else if support == Support::No {
        Reason::UnsupportedOperation
    } else if s.archived {
        Reason::Archived
    } else if action == Action::QueueEdit {
        if queue.editing {
            Reason::QueueEditPending
        } else if queue.pending {
            Reason::LocalQueue
        } else {
            Reason::NoEditableQueueItem
        }
    } else if !enabled {
        Reason::IntegrationDisabled
    } else if !configured {
        Reason::NotConfigured
    } else if matches!(action, Action::ApprovalRespond | Action::QuestionRespond) {
        Reason::CurrentOccurrenceUnknown
    } else if support == Support::Unknown {
        Reason::SupportUnknown
    } else if matches!(
        action,
        Action::MessageStart
            | Action::SessionFork
            | Action::ModelSet
            | Action::TierSet
            | Action::PlanSet
    ) && matches!(s.status.as_str(), "running" | "starting" | "waiting")
    {
        Reason::StoredBusy
    } else {
        Reason::NativeObservationMissing
    };
    let allowed = matches!(reason, Reason::CachedHistory | Reason::LocalQueue);
    let mut result = ActionProjection::new(support, allowed, reason, owner);
    if matches!(
        action,
        Action::QueueEnqueue
            | Action::QueueEdit
            | Action::QueuePause
            | Action::QueueResume
            | Action::QueueDelete
            | Action::QueueSteer
    ) {
        result
            .limitations
            .push("AnyWork queue only; no native queue synchronization.");
    }
    if action == Action::QueueDelete {
        result
            .limitations
            .push("Removing an uncertain local row does not cancel native execution.");
    }
    if action == Action::MessageEdit {
        result.limitations.push(
            "Native history edits do not provide a cross-client compare-and-swap transaction.",
        );
    }
    result
}
#[derive(Serialize)]
pub struct CatalogProjection {
    version: u32,
    revision: String,
    enabled: bool,
    configured: bool,
    installed: Option<bool>,
    transport_reachable: Option<bool>,
    identity_verified: Option<bool>,
    configuration_source: &'static str,
    reason_code: Reason,
    reason: &'static str,
    observation: Observation,
    support_evidence: Evidence,
}
fn configured(manifest: &PluginManifest, legacy_available: bool) -> bool {
    if crate::shared_host::is_shared(&manifest.id) {
        legacy_available
    } else {
        !manifest.command.trim().is_empty()
    }
}
pub fn catalog(manifest: &PluginManifest, legacy_available: bool) -> CatalogProjection {
    let configured = configured(manifest, legacy_available);
    let reason = if configured {
        Reason::NativeObservationMissing
    } else {
        Reason::NotConfigured
    };
    let mut result = CatalogProjection {
        version: VERSION,
        revision: String::new(),
        enabled: true,
        configured,
        installed: None,
        transport_reachable: None,
        identity_verified: None,
        configuration_source: "configuration_metadata_only",
        reason_code: reason,
        reason: reason.explanation(),
        observation: Observation::local(crate::store::now()),
        support_evidence: evidence(&manifest.id),
    };
    result.revision = revision(&(VERSION, &manifest.id, configured, &result.support_evidence));
    result
}
fn revision(value: &impl Serialize) -> String {
    // Raw descriptors, manifest environment and native objects never enter it.
    format!(
        "sha256:{:x}",
        Sha256::digest(serde_json::to_vec(value).expect("typed capability serialization"))
    )
}
#[derive(Serialize)]
pub struct SessionProjection<'a> {
    version: u32,
    revision: String,
    binding: Binding<'a>,
    readiness: Readiness,
    observation: Observation,
    support_evidence: Evidence,
    actions: BTreeMap<Action, ActionProjection>,
}
fn project<'a>(
    s: &'a Session,
    enabled: bool,
    configured: bool,
    queue: &QueueFacts,
) -> SessionProjection<'a> {
    let read_only = s.archived || (s.agent == crate::workbuddy::AGENT && s.auxiliary);
    let mut result = SessionProjection {
        version: VERSION,
        revision: String::new(),
        binding: Binding {
            session_id: &s.id,
            agent: &s.agent,
            thread_id: s.thread_id.as_deref(),
            topology: topology(s),
            auxiliary: s.auxiliary,
            archived: s.archived,
            native_version: None,
            native_instance: None,
            generation: None,
        },
        readiness: Readiness {
            enabled,
            configured,
            installed: None,
            transport_reachable: None,
            identity_verified: None,
            readable: true,
            writable: if read_only { Some(false) } else { None },
        },
        observation: Observation::local(crate::store::now()),
        support_evidence: evidence(&s.agent),
        actions: ACTIONS
            .into_iter()
            .map(|a| (a, action_projection(a, s, enabled, configured, queue)))
            .collect(),
    };
    result.revision = revision(&(
        VERSION,
        &result.binding,
        &result.readiness,
        &result.support_evidence,
        &result.actions,
    ));
    result
}
pub async fn read(
    State(app): State<Arc<App>>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    // Authorize current scope before configuration, queue or cached-event reads.
    let s = app.session(&id)?;
    app.store.events(&id, 0, 1)?;
    let queue = app.store.queue(&id)?;
    let items = queue["items"].as_array().expect("Store queue contract");
    let facts = QueueFacts {
        pending: items.iter().any(|i| i["status"] == "pending"),
        deletable: items.iter().any(|i| i["status"] != "sending"),
        editing: !queue["editing"].is_null(),
    };
    let manifest = app.plugins.get(&s.agent);
    let config =
        manifest.is_some_and(|m| configured(m, crate::shared_host::available(&app, &s.agent)));
    Ok(Json(serde_json::to_value(project(
        &s,
        manifest.is_some(),
        config,
        &facts,
    ))?))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn session(agent: &str, external: bool) -> Session {
        Session {
            id: "s".into(),
            thread_id: Some("thread".into()),
            title: "test".into(),
            cwd: "/fixture".into(),
            agent: agent.into(),
            model: None,
            policy: "manual".into(),
            status: "idle".into(),
            archived: false,
            created_at: 0,
            updated_at: 0,
            external,
            auxiliary: false,
        }
    }
    #[test]
    fn stored_status_never_establishes_native_readiness() {
        for agent in [
            "codex",
            crate::harness::AGENT,
            crate::workbuddy::AGENT,
            "custom",
        ] {
            for status in ["idle", "running", "disconnected", "waiting"] {
                let mut s = session(agent, true);
                s.status = status.into();
                let p = project(&s, true, true, &QueueFacts::default());
                assert_eq!(p.readiness.transport_reachable, None);
                assert_eq!(p.readiness.identity_verified, None);
                assert_eq!(p.readiness.writable, None);
                assert!(
                    p.actions
                        .values()
                        .filter(|a| a.owner != Owner::Anywork)
                        .all(|a| !a.allowed_now)
                );
                assert_eq!(p.binding.generation, None);
            }
        }
    }
    #[test]
    fn external_codex_never_guesses_follower_or_shared_engine() {
        let s = session("codex", true);
        let p = project(&s, true, true, &QueueFacts::default());
        assert_eq!(p.binding.topology, Topology::CodexExternalUnknown);
        for a in [Action::GoalPause, Action::GoalResume, Action::MessageStart] {
            assert_eq!(p.actions[&a].supported, Support::Unknown);
            assert!(!p.actions[&a].allowed_now);
        }
    }
    #[test]
    fn unsupported_and_busy_are_not_unknown_or_permission() {
        let mut s = session(crate::harness::AGENT, true);
        s.status = "running".into();
        let p = project(&s, true, true, &QueueFacts::default());
        assert_eq!(p.actions[&Action::GoalCreate].supported, Support::No);
        assert_eq!(p.actions[&Action::ModelSet].supported, Support::Yes);
        assert_eq!(p.actions[&Action::ModelSet].reason_code, Reason::StoredBusy);
        assert_eq!(
            p.actions[&Action::EffortSet].reason_code,
            Reason::NativeObservationMissing
        );
        assert!(!p.actions[&Action::EffortSet].allowed_now);
    }
    #[test]
    fn offline_queue_and_cache_are_independent_of_native_writable() {
        let s = session(crate::workbuddy::AGENT, true);
        let p = project(
            &s,
            true,
            false,
            &QueueFacts {
                pending: true,
                deletable: true,
                editing: false,
            },
        );
        for a in [
            Action::HistoryRead,
            Action::QueueEdit,
            Action::QueuePause,
            Action::QueueDelete,
        ] {
            assert!(p.actions[&a].allowed_now);
        }
        for a in [
            Action::QueueEnqueue,
            Action::QueueResume,
            Action::QueueSteer,
        ] {
            assert!(!p.actions[&a].allowed_now);
        }
        assert_eq!(p.support_evidence.execution, "experimental");
        assert_eq!(p.readiness.writable, None);
    }
    #[test]
    fn archive_auxiliary_and_queue_edit_invalidate_advice() {
        let mut s = session(crate::workbuddy::AGENT, true);
        let facts = QueueFacts {
            pending: true,
            deletable: false,
            editing: false,
        };
        let original = project(&s, true, true, &facts).revision;
        s.auxiliary = true;
        let p = project(&s, true, true, &facts);
        assert_ne!(original, p.revision);
        assert_eq!(
            p.actions[&Action::MessageStart].reason_code,
            Reason::ReadOnlyChild
        );
        assert!(!p.actions[&Action::QueueEdit].allowed_now);
        assert!(p.actions[&Action::HistoryRead].allowed_now);
        s.auxiliary = false;
        s.archived = true;
        assert_eq!(
            project(&s, true, true, &facts).actions[&Action::QueueEdit].reason_code,
            Reason::Archived
        );
        s.archived = false;
        assert_eq!(
            project(
                &s,
                true,
                true,
                &QueueFacts {
                    editing: true,
                    ..facts
                }
            )
            .actions[&Action::QueueEdit]
                .reason_code,
            Reason::QueueEditPending
        );
    }
    #[test]
    fn request_occurrence_and_identity_are_required() {
        let s = session("codex", false);
        let p = project(&s, true, true, &QueueFacts::default());
        for a in [Action::ApprovalRespond, Action::QuestionRespond] {
            assert!(!p.actions[&a].allowed_now);
            assert_eq!(p.actions[&a].reason_code, Reason::CurrentOccurrenceUnknown);
        }
    }
    #[test]
    fn catalog_is_not_liveness_and_does_not_serialize_secrets() {
        let manifest = PluginManifest {
            id: "codex".into(),
            name: "test".into(),
            protocol_version: 1,
            command: "/not-installed/private/command".into(),
            args: vec!["private-argument".into()],
            env: [("SECRET".into(), "private-secret".into())].into(),
            capabilities: vec!["everything".into()],
        };
        let p = catalog(&manifest, true);
        assert!(p.configured);
        assert_eq!(p.installed, None);
        assert_eq!(p.transport_reachable, None);
        let raw = serde_json::to_string(&p).unwrap();
        for secret in ["private", "SECRET", "everything"] {
            assert!(!raw.contains(secret));
        }
    }
}
