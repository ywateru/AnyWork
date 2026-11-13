//! Pure conversions between Anthropic content blocks and the AnyWork event ABI.
use serde_json::{Value, json};

pub fn text(content: &Value) -> String {
    if let Some(s) = content.as_str() {
        return s.into();
    }
    content
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|b| b["text"].as_str())
        .collect::<Vec<_>>()
        .join("\n")
}
pub fn is_user_prompt(row: &Value) -> bool {
    row["type"] == "user"
        && (row["message"]["content"].is_string()
            || row["message"]["content"]
                .as_array()
                .is_some_and(|items| items.iter().any(|b| b["type"] != "tool_result")))
}
pub fn item(block: &Value, id: &str) -> Value {
    match block["type"].as_str() {
        Some("text") => {
            json!({"id":id,"type":"agentMessage","text":block["text"].as_str().unwrap_or("")})
        }
        Some("thinking" | "redacted_thinking") => {
            json!({"id":id,"type":"reasoning","summary":[block["thinking"].as_str().unwrap_or("")]})
        }
        Some("tool_use") => {
            let name = block["name"].as_str().unwrap_or("unknown");
            let input = &block["input"];
            if matches!(name, "Bash" | "PowerShell") {
                json!({"id":id,"type":"commandExecution","command":input["command"],"status":"inProgress","aggregatedOutput":"","claudeToolName":name,"claudeInput":input})
            } else {
                json!({"id":id,"type":"mcpToolCall","server":"claude","tool":name,"arguments":input,"status":"inProgress"})
            }
        }
        _ => {
            json!({"id":id,"type":"mcpToolCall","server":"claude","tool":block["type"],"arguments":block,"status":"completed"})
        }
    }
}
pub fn row_events(thread: &str, turn: &str, row: &Value) -> Vec<(String, Value)> {
    let mut events = vec![];
    let uuid = row["uuid"].as_str().unwrap_or("unknown");
    let mut push = |method: &str, mut params: Value, suffix: String| {
        params["threadId"] = json!(thread);
        params["turnId"] = json!(turn);
        params["sourceEventKey"] = json!(format!("claude:{thread}:{uuid}:{suffix}"));
        events.push((method.into(), params));
    };
    let content = &row["message"]["content"];
    if is_user_prompt(row) {
        let attachments: Vec<_> = content
            .as_array()
            .into_iter()
            .flatten()
            .filter(|b| b["type"] == "image")
            .filter_map(|b| {
                b["source"]["url"].as_str().map(str::to_string).or_else(|| {
                    Some(format!(
                        "data:{};base64,{}",
                        b["source"]["media_type"].as_str()?,
                        b["source"]["data"].as_str()?
                    ))
                })
            })
            .collect();
        push(
            "user/message",
            json!({"text":text(content),"attachments":attachments,"history_item_id":uuid,"clientUserMessageId":row["clientUserMessageId"]}),
            "user".into(),
        );
    }
    for (n, block) in content.as_array().into_iter().flatten().enumerate() {
        if row["type"] == "assistant" {
            let offset = row["_anyworkBlockOffset"].as_u64().unwrap_or(0) as usize;
            let mid = row["message"]["id"].as_str().unwrap_or(uuid);
            let id = block["id"]
                .as_str()
                .map(str::to_string)
                .unwrap_or_else(|| format!("{mid}:{}", offset + n));
            let mut item = item(block, &id);
            if block["type"] != "tool_use" {
                item["status"] = json!("completed");
            }
            push(
                if block["type"] == "tool_use" {
                    "item/started"
                } else {
                    "item/completed"
                },
                json!({"item":item}),
                format!("block:{n}"),
            );
        } else if block["type"] == "tool_result" {
            let id = block["tool_use_id"].as_str().unwrap_or("unknown");
            let output = text(&block["content"]);
            push(
                "item/completed",
                json!({"item":{"id":id,"type":"mcpToolCall","server":"claude","tool":"tool_result","result":block["content"],"aggregatedOutput":output,"status":if block["is_error"] == true {"failed"}else{"completed"}}}),
                format!("result:{n}"),
            );
        }
    }
    events
}

pub fn models(init: &Value) -> Vec<Value> {
    init["models"].as_array().into_iter().flatten().filter_map(|m| {
        let id = m["value"].as_str().or_else(|| m["model"].as_str())?;
        Some(json!({"id":id,"model":id,"displayName":m["displayName"].as_str().unwrap_or(id),"description":m["description"],"supportedReasoningEfforts":[],"serviceTiers":[],"isDefault":false}))
    }).collect()
}
pub fn model_id(init: &Value, model: &str) -> String {
    init["models"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|m| m["value"] == model || m["resolvedModel"] == model)
        .and_then(|m| m["value"].as_str())
        .unwrap_or(model)
        .into()
}

/// AskUserQuestion answers are bound to the exact pending questions. Never
/// accept arbitrary tool input/permission updates from an HTTP result.
pub fn permission_response(request: &Value, result: &Value) -> anyhow::Result<Value> {
    use anyhow::{Context, ensure};
    let input = &request["input"];
    if request["tool_name"] == "AskUserQuestion" {
        let answers = result["answers"]
            .as_object()
            .context("Question answers must be an object")?;
        let questions = input["questions"]
            .as_array()
            .context("Invalid Claude questions")?;
        ensure!(
            answers.len() == questions.len(),
            "Answer every question in this request exactly once"
        );
        let mut updated = input.clone();
        let mut native = serde_json::Map::new();
        for (n, question) in questions.iter().enumerate() {
            let key = n.to_string();
            let texts = answers
                .get(&key)
                .and_then(|a| a["answers"].as_array())
                .context("Missing Claude question answer")?;
            ensure!(
                !texts.is_empty() && texts.iter().all(Value::is_string),
                "Answers must contain text"
            );
            ensure!(
                question["multiSelect"] == true || texts.len() == 1,
                "This question accepts one answer"
            );
            let prompt = question["question"]
                .as_str()
                .context("Missing Claude question text")?;
            native.insert(
                prompt.into(),
                json!(
                    texts
                        .iter()
                        .filter_map(Value::as_str)
                        .collect::<Vec<_>>()
                        .join(", ")
                ),
            );
        }
        updated["answers"] = Value::Object(native);
        Ok(json!({"behavior":"allow","updatedInput":updated}))
    } else {
        ensure!(
            result.as_object().is_some_and(|o| o.len() == 1),
            "Unknown Claude approval fields"
        );
        match result["decision"].as_str() {
            Some("accept") => Ok(json!({"behavior":"allow","updatedInput":input})),
            Some("decline") => Ok(json!({"behavior":"deny","message":"Denied by the user"})),
            _ => anyhow::bail!("Decision was not offered by this Claude request"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounds_approval_and_question_answers_to_original_request() {
        let req = json!({"tool_name":"Bash","input":{"command":"pwd"}});
        assert_eq!(
            permission_response(&req, &json!({"decision":"accept"})).unwrap()["updatedInput"],
            req["input"]
        );
        assert!(permission_response(&req, &json!({"decision":"acceptForSession"})).is_err());
        assert!(
            permission_response(&req, &json!({"decision":"accept","updatedInput":{}})).is_err()
        );
        let req = json!({"tool_name":"AskUserQuestion","input":{"questions":[{"question":"Which?","options":[]}]}});
        assert_eq!(
            permission_response(&req, &json!({"answers":{"0":{"answers":["free text"]}}})).unwrap()
                ["updatedInput"]["answers"]["Which?"],
            "free text"
        );
        assert!(
            permission_response(&req, &json!({"answers":{"wrong":{"answers":["x"]}}})).is_err()
        );
    }
}
