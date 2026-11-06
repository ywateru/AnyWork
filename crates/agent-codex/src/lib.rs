use remote_agent_sdk::{AgentPlugin, PluginManifest};
use serde_json::{Value, json};

pub struct CodexPlugin;
impl AgentPlugin for CodexPlugin {
    fn manifest(&self) -> PluginManifest {
        PluginManifest {
            id: "codex".into(),
            name: "Codex".into(),
            protocol_version: 1,
            command: std::env::var("CODEX_BIN").unwrap_or_else(|_| "codex".into()),
            args: vec!["app-server".into()],
            env: Default::default(),
            capabilities: [
                "chat",
                "resume",
                "interrupt",
                "approvals",
                "questions",
                "images",
                "models",
                "tools",
                "message-edit",
            ]
            .map(str::to_string)
            .to_vec(),
        }
    }
}

pub fn thread_options(cwd: &str, model: Option<&str>, policy: &str) -> Value {
    let mut value = json!({"cwd":cwd,"approvalPolicy":if policy == "auto" {"never"} else {"on-request"},
        "sandbox":"workspace-write"});
    if let Some(model) = model.filter(|s| !s.is_empty()) {
        value["model"] = json!(model);
    }
    value
}

type ApprovalResult<T> = Result<T, String>;

fn fields<'a>(
    value: &'a Value,
    required: &[&str],
    optional: &[&str],
) -> ApprovalResult<&'a serde_json::Map<String, Value>> {
    let object = value
        .as_object()
        .ok_or("Approval value must be an object")?;
    if required.iter().any(|key| !object.contains_key(*key))
        || object
            .keys()
            .any(|key| !required.contains(&key.as_str()) && !optional.contains(&key.as_str()))
    {
        return Err("Missing or unknown approval field".into());
    }
    Ok(object)
}

fn command_decision(decision: &Value, command: bool) -> ApprovalResult<()> {
    if let Some(value) = decision.as_str() {
        if ["accept", "acceptForSession", "decline", "cancel"].contains(&value) {
            return Ok(());
        }
    } else if command
        && let Some(object) = decision.as_object()
        && object.len() == 1
    {
        if let Some(amendment) = object.get("acceptWithExecpolicyAmendment") {
            fields(amendment, &["execpolicy_amendment"], &[])?;
            if amendment["execpolicy_amendment"]
                .as_array()
                .is_some_and(|items| items.iter().all(Value::is_string))
            {
                return Ok(());
            }
        } else if let Some(amendment) = object.get("applyNetworkPolicyAmendment") {
            fields(amendment, &["network_policy_amendment"], &[])?;
            let policy = &amendment["network_policy_amendment"];
            fields(policy, &["action", "host"], &[])?;
            if policy["host"].is_string()
                && policy["action"]
                    .as_str()
                    .is_some_and(|action| ["allow", "deny"].contains(&action))
            {
                return Ok(());
            }
        }
    }
    Err("Unknown or malformed approval decision".into())
}

/// Validate the exact result against its original request before any response is sent.
pub fn validate_approval_result(
    method: &str,
    params: &Value,
    result: &Value,
) -> ApprovalResult<Value> {
    match method {
        "item/commandExecution/requestApproval" | "item/fileChange/requestApproval" => {
            fields(result, &["decision"], &[])?;
            let decision = &result["decision"];
            let command = method == "item/commandExecution/requestApproval";
            command_decision(decision, command)?;
            if command {
                match params.get("availableDecisions") {
                    Some(Value::Array(available)) => {
                        if !available.contains(decision) {
                            return Err("Approval decision is not offered by this request".into());
                        }
                    }
                    None | Some(Value::Null) => {
                        if let Some(amendment) = decision.get("acceptWithExecpolicyAmendment") {
                            if amendment["execpolicy_amendment"]
                                != params["proposedExecpolicyAmendment"]
                            {
                                return Err(
                                    "Execpolicy amendment does not match the request proposal"
                                        .into(),
                                );
                            }
                        } else if let Some(amendment) = decision.get("applyNetworkPolicyAmendment")
                            && !params["proposedNetworkPolicyAmendments"]
                                .as_array()
                                .is_some_and(|proposals| {
                                    proposals.contains(&amendment["network_policy_amendment"])
                                })
                        {
                            return Err(
                                "Network policy amendment does not match a request proposal".into(),
                            );
                        }
                    }
                    _ => return Err("Malformed available approval decisions".into()),
                }
            }
            Ok(result.clone())
        }
        "item/permissions/requestApproval" => {
            let object = fields(result, &["permissions"], &["scope", "strictAutoReview"])?;
            let granted = &result["permissions"];
            if !granted.is_object() || (*granted != json!({}) && *granted != params["permissions"])
            {
                return Err(
                    "Permissions must exactly match the original request or be empty".into(),
                );
            }
            if granted.as_object().is_some_and(|p| {
                p.keys()
                    .any(|key| !["network", "fileSystem"].contains(&key.as_str()))
            }) {
                return Err("Unknown permission field".into());
            }
            let scope = object
                .get("scope")
                .and_then(Value::as_str)
                .unwrap_or("turn");
            if object.get("scope").is_some_and(|scope| !scope.is_string())
                || !["turn", "session"].contains(&scope)
            {
                return Err("Permission scope must be turn or session".into());
            }
            if object
                .get("strictAutoReview")
                .is_some_and(|value| !value.is_null() && !value.is_boolean())
            {
                return Err("strictAutoReview must be boolean or null".into());
            }
            let mut result = result.clone();
            result["scope"] = json!(scope);
            Ok(result)
        }
        _ => Err("Unsupported approval request method".into()),
    }
}

/// Compatibility and automatic responses always retain once/turn scope.
pub fn approval_result(method: &str, params: &Value, accept: bool) -> ApprovalResult<Value> {
    let result = if method == "item/permissions/requestApproval" {
        json!({"permissions": if accept { params["permissions"].clone() } else {json!({})}, "scope":"turn"})
    } else {
        json!({"decision": if accept { "accept" } else { "decline" }})
    };
    validate_approval_result(method, params, &result)
}

#[cfg(test)]
mod tests {
    use super::*;
    const COMMAND: &str = "item/commandExecution/requestApproval";
    const FILE: &str = "item/fileChange/requestApproval";
    const PERMISSIONS: &str = "item/permissions/requestApproval";

    #[test]
    fn command_whitelist_is_authoritative_including_empty_and_unknown_decisions() {
        let params = json!({"availableDecisions":["acceptForSession","cancel"]});
        assert!(approval_result(COMMAND, &params, true).is_err());
        assert!(approval_result(COMMAND, &params, false).is_err());
        for decision in ["acceptForSession", "cancel"] {
            let result = json!({"decision":decision});
            assert_eq!(
                validate_approval_result(COMMAND, &params, &result).unwrap(),
                result
            );
        }
        for decision in ["accept", "acceptForSession", "decline", "cancel"] {
            assert!(
                validate_approval_result(
                    COMMAND,
                    &json!({"availableDecisions":[]}),
                    &json!({"decision":decision})
                )
                .is_err()
            );
            assert!(
                validate_approval_result(
                    COMMAND,
                    &json!({"availableDecisions":null}),
                    &json!({"decision":decision})
                )
                .is_ok()
            );
        }
        let unknown = json!({"futureDecision":{}});
        assert!(
            validate_approval_result(
                COMMAND,
                &json!({"availableDecisions":[unknown]}),
                &json!({"decision":unknown})
            )
            .is_err()
        );
        assert!(approval_result(COMMAND, &json!({"availableDecisions":"accept"}), true).is_err());
    }

    #[test]
    fn amendments_must_match_offered_decision_or_exact_original_proposal() {
        let exec =
            json!({"acceptWithExecpolicyAmendment":{"execpolicy_amendment":["npm","install"]}});
        let network = json!({"applyNetworkPolicyAmendment":{"network_policy_amendment":{"host":"example.com","action":"allow"}}});
        let params = json!({"proposedExecpolicyAmendment":["npm","install"],"proposedNetworkPolicyAmendments":[{"host":"example.com","action":"allow"}]});
        for decision in [&exec, &network] {
            assert!(
                validate_approval_result(COMMAND, &params, &json!({"decision":decision})).is_ok()
            );
            assert!(
                validate_approval_result(COMMAND, &json!({}), &json!({"decision":decision}))
                    .is_err()
            );
            assert!(
                validate_approval_result(
                    COMMAND,
                    &json!({"availableDecisions":[decision]}),
                    &json!({"decision":decision})
                )
                .is_ok()
            );
            assert!(validate_approval_result(COMMAND, &json!({"availableDecisions":[],"proposedExecpolicyAmendment":["npm","install"],"proposedNetworkPolicyAmendments":[{"host":"example.com","action":"allow"}]}), &json!({"decision":decision})).is_err());
            assert!(
                validate_approval_result(FILE, &params, &json!({"decision":decision})).is_err()
            );
        }
        for decision in [
            json!({"acceptWithExecpolicyAmendment":{"execpolicy_amendment":["npm"]}}),
            json!({"acceptWithExecpolicyAmendment":{"execpolicy_amendment":["npm","install"],"extra":true}}),
            json!({"applyNetworkPolicyAmendment":{"network_policy_amendment":{"host":"other.com","action":"allow"}}}),
            json!({"applyNetworkPolicyAmendment":{"network_policy_amendment":{"host":"example.com","action":"deny"}}}),
            json!({"applyNetworkPolicyAmendment":{"network_policy_amendment":{"host":"example.com","action":"allow","extra":true}}}),
        ] {
            assert!(
                validate_approval_result(COMMAND, &params, &json!({"decision":decision})).is_err()
            );
        }
    }

    #[test]
    fn permissions_require_full_requested_profile_and_explicit_bounded_scope() {
        let requested =
            json!({"network":{"enabled":true},"fileSystem":{"write":["/tmp/requested"]}});
        let params = json!({"permissions":requested});
        for scope in ["turn", "session"] {
            for permissions in [&requested, &json!({})] {
                let result =
                    json!({"permissions":permissions,"scope":scope,"strictAutoReview":true});
                assert_eq!(
                    validate_approval_result(PERMISSIONS, &params, &result).unwrap(),
                    result
                );
            }
        }
        assert_eq!(
            validate_approval_result(PERMISSIONS, &params, &json!({"permissions":requested}))
                .unwrap()["scope"],
            "turn"
        );
        for result in [
            json!({"permissions":{"network":{"enabled":true}},"scope":"turn"}),
            json!({"permissions":{"network":{"enabled":true},"fileSystem":{"write":["/"]}},"scope":"session"}),
            json!({"permissions":requested,"scope":"forever"}),
            json!({"permissions":requested,"scope":null}),
            json!({"permissions":requested,"strictAutoReview":"yes"}),
            json!({"permissions":requested,"decision":"accept"}),
            json!({"permissions":null}),
        ] {
            assert!(validate_approval_result(PERMISSIONS, &params, &result).is_err());
        }
        assert_eq!(
            approval_result(PERMISSIONS, &params, true).unwrap(),
            json!({"permissions":requested,"scope":"turn"})
        );
        assert_eq!(
            approval_result(PERMISSIONS, &params, false).unwrap(),
            json!({"permissions":{},"scope":"turn"})
        );
    }

    #[test]
    fn decisions_reject_extra_fields_and_unsupported_methods() {
        for method in [COMMAND, FILE] {
            for decision in ["accept", "acceptForSession", "decline", "cancel"] {
                assert!(
                    validate_approval_result(method, &json!({}), &json!({"decision":decision}))
                        .is_ok()
                );
            }
            for result in [
                Value::Null,
                json!("accept"),
                json!({}),
                json!({"decision":"unknown"}),
                json!({"decision":"accept","permissions":{}}),
            ] {
                assert!(validate_approval_result(method, &json!({}), &result).is_err());
            }
        }
        assert!(approval_result("item/unknown/requestApproval", &json!({}), true).is_err());
    }
    #[test]
    fn approval_scopes_and_defaults() {
        assert_eq!(
            thread_options("/tmp", None, "manual")["approvalPolicy"],
            "on-request"
        );
        assert_eq!(
            thread_options("/tmp", None, "auto")["sandbox"],
            "workspace-write"
        );
        assert_eq!(
            approval_result(
                "item/permissions/requestApproval",
                &json!({"permissions":{"network":{"enabled":true}}}),
                false
            )
            .unwrap()["permissions"],
            json!({})
        );
    }
}
