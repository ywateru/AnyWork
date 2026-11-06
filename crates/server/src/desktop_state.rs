//! Preserve the desktop state verbatim; expose native-shaped read views separately.
//! acceptedTextChanges is a UI fast path for mutations already in the Immer patches.
use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};

pub struct Snapshot {
    pub raw: Value,
    pub revision: u64,
    pub synchronized: bool,
}

impl Snapshot {
    pub fn new(raw: Value, revision: u64, thread: &str, cwd: &str) -> Result<Self> {
        validate_state(&raw, thread, cwd)?;
        Ok(Self {
            raw,
            revision,
            synchronized: true,
        })
    }

    pub fn apply(&mut self, change: &Value) -> Result<()> {
        ensure!(
            self.synchronized && change["baseRevision"].as_u64() == Some(self.revision),
            "Desktop stream revision gap"
        );
        let revision = change["revision"]
            .as_u64()
            .context("Missing desktop revision")?;
        ensure!(
            revision > self.revision,
            "Desktop stream revision did not advance"
        );
        let mut next = self.raw.clone();
        for patch in change["patches"]
            .as_array()
            .context("Invalid desktop patches")?
        {
            apply_patch(&mut next, patch)?;
        }
        validate_state(
            &next,
            self.raw["id"]
                .as_str()
                .context("Invalid desktop identity")?,
            self.raw["cwd"]
                .as_str()
                .context("Invalid desktop directory")?,
        )?;
        if let Some(host) = self.raw.get("hostId") {
            ensure!(
                next.get("hostId") == Some(host),
                "Desktop snapshot host identity changed"
            );
        }
        // Commit both state and revision only after every patch and invariant succeeds.
        self.raw = next;
        self.revision = revision;
        Ok(())
    }

    pub fn history_complete(&self) -> bool {
        self.canonical_history()
            .is_none_or(|history| history["isComplete"] == true)
    }

    pub fn has_live_tail(&self) -> bool {
        self.canonical_history().is_none() || self.live_tail().is_some()
    }

    fn canonical_history(&self) -> Option<&Value> {
        (self.raw["turnHistory"]["kind"] == "canonical")
            .then_some(&self.raw["turnHistory"]["history"])
    }

    fn live_tail(&self) -> Option<&Value> {
        self.canonical_history()?["islands"]
            .as_array()?
            .last()
            .filter(|island| island["newerBoundary"]["status"] == "exhausted")
    }

    fn canonical_turns(&self) -> Option<Vec<Value>> {
        self.canonical_history().map(|history| {
            history["islands"]
                .as_array()
                .into_iter()
                .flatten()
                .flat_map(|island| {
                    island["entries"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter_map(|entry| {
                            let key = entry["value"].as_str()?;
                            history["entitiesByKey"][key]
                                .is_object()
                                .then(|| history["entitiesByKey"][key].clone())
                        })
                })
                .collect()
        })
    }

    pub fn turns(&self) -> Vec<Value> {
        let legacy = array(&self.raw["turns"]);
        let Some(canonical) = self.canonical_turns() else {
            return legacy.to_vec();
        };
        let ids: HashSet<&str> = canonical.iter().filter_map(turn_id).collect();
        let by_id: HashMap<&str, &Value> = legacy
            .iter()
            .filter_map(|turn| turn_id(turn).map(|id| (id, turn)))
            .collect();
        let mapped: Vec<Value> = canonical
            .iter()
            .filter(|turn| !empty_placeholder(turn))
            .map(|turn| {
                turn_id(turn)
                    .and_then(|id| by_id.get(id))
                    .map_or_else(|| turn.clone(), |incoming| merge_turn(turn, incoming))
            })
            .collect();
        let mut turns = insert_around_anchors(mapped, legacy, &ids, turn_id);
        relocate_steering(&mut turns);
        turns
    }

    pub fn active_turn(&self) -> Option<String> {
        // A loaded search island does not establish an executable current turn.
        if self.canonical_history().is_some()
            && self.live_tail().is_none()
            && !array(&self.raw["turns"])
                .iter()
                .any(|turn| turn_id(turn).is_some())
        {
            return None;
        }
        self.turns()
            .iter()
            .rev()
            .find(|turn| turn_id(turn).is_some())
            .filter(|turn| turn["status"] == "inProgress")
            .and_then(turn_id)
            .map(str::to_owned)
    }

    pub fn busy(&self) -> bool {
        // Owner runtime state wins over a partial display projection. In
        // particular, a completed synthetic goal marker is not proof of idle.
        if self.raw["threadRuntimeStatus"]["type"] == "active"
            || self.raw["resumeState"] == "resuming"
        {
            return true;
        }
        if array(&self.raw["unconfirmedTurnSubmissions"])
            .iter()
            .any(|entry| entry["terminal"] != true)
        {
            return true;
        }
        if self.raw["resumeState"] == "needs_resume" {
            return self.raw["threadRuntimeStatus"]["type"] == "active";
        }
        if self.canonical_history().is_some() && array(&self.raw["turns"]).is_empty() {
            let latest = self
                .live_tail()
                .and_then(|island| array(&island["entries"]).last())
                .and_then(|entry| entry["value"].as_str())
                .and_then(|key| {
                    self.canonical_history()
                        .map(|history| &history["entitiesByKey"][key])
                });
            let canonical = self.canonical_turns().unwrap_or_default();
            if let Some(turn) = latest.or_else(|| canonical.last())
                && turn_id(turn).is_some()
            {
                return turn["status"] == "inProgress";
            }
        }
        let turns = self.turns();
        if turns.is_empty() {
            return self.raw["resumeState"] == "resuming";
        }
        turns
            .iter()
            .rev()
            .find(|turn| {
                turn_id(turn).is_some()
                    || !matches!(turn["status"].as_str(), Some("completed" | "failed"))
            })
            .is_some_and(|turn| turn["status"] == "inProgress")
    }

    pub fn native_turns(&self) -> Vec<Value> {
        self.turns().into_iter().filter(|turn| turn_id(turn).is_some()).map(|mut turn| {
            let id = turn["turnId"].clone();
            let source = array(&turn["items"]);
            let input = &turn["params"]["input"];
            let client_id = &turn["params"]["clientUserMessageId"];
            let has_opening_user = source.iter().filter(|item| item["type"] == "userMessage").any(|item| {
                if !client_id.is_null() { item["clientId"] == *client_id }
                else { item["content"] == *input }
            });
            let mut items = Vec::new();
            if !has_opening_user && !array(input).is_empty() {
                items.push(json!({"id":format!("desktop-user:{}",id.as_str().unwrap_or_default()),"type":"userMessage","content":input,"clientId":client_id}));
            }
            let mut seen = HashSet::new();
            for item in source {
                if item["type"] == "steeringUserMessage" {
                    let matches_native = source.iter().any(|native| native["type"] == "userMessage" && steering_matches(item, native));
                    if !matches_native && item["input"].is_array() {
                        let mut native = item.clone();
                        native["type"] = json!("userMessage");
                        native["content"] = item["input"].clone();
                        native["clientId"] = item["clientUserMessageId"].clone();
                        if !item["serverUserMessageId"].is_null() { native["id"] = item["serverUserMessageId"].clone(); }
                        if remember_item(&mut seen, &native) { items.push(native); }
                    }
                } else if remember_item(&mut seen, item) { items.push(item.clone()); }
            }
            turn["id"] = id;
            turn["items"] = json!(items);
            if let Some(time) = turn["turnStartedAtMs"].as_i64() { turn["startedAt"] = json!(time / 1000); }
            turn
        }).collect()
    }

    pub fn settings(&self) -> Value {
        let mut settings = self.raw["latestThreadSettings"]
            .as_object()
            .cloned()
            .unwrap_or_default();
        for (key, source) in [
            ("model", "latestModel"),
            ("reasoningEffort", "latestReasoningEffort"),
            ("collaborationMode", "latestCollaborationMode"),
        ] {
            if let Some(value) = self.raw.get(source) {
                settings.insert(key.into(), value.clone());
            }
        }
        if let Some(effort) = self.raw.get("latestReasoningEffort") {
            settings.insert("effort".into(), effort.clone());
        }
        json!(settings)
    }

    pub fn status(&self) -> Value {
        let mut flags = Vec::new();
        for request in array(&self.raw["requests"]) {
            let flag = match request["method"].as_str() {
                Some(
                    "item/commandExecution/requestApproval"
                    | "item/fileChange/requestApproval"
                    | "item/permissions/requestApproval",
                ) => Some("waitingOnApproval"),
                Some(
                    "item/tool/requestUserInput"
                    | "item/tool/requestOptionPicker"
                    | "mcpServer/elicitation/request",
                ) => Some("waitingOnUserInput"),
                _ => None,
            };
            if let Some(flag) = flag
                && !flags.contains(&flag)
            {
                flags.push(flag);
            }
        }
        let runtime = &self.raw["threadRuntimeStatus"];
        let submitting = self.raw["resumeState"] == "resuming"
            || array(&self.raw["unconfirmedTurnSubmissions"])
                .iter()
                .any(|entry| entry["terminal"] != true);
        if runtime["type"] == "active" || submitting || !flags.is_empty() {
            for flag in array(&runtime["activeFlags"]) {
                if let Some(flag) = flag.as_str()
                    && !flags.contains(&flag)
                {
                    flags.push(flag);
                }
            }
            json!({"type":"active","activeFlags":flags})
        } else if runtime.is_object() {
            runtime.clone()
        } else if self.busy() {
            json!({"type":"active","activeFlags":flags})
        } else {
            json!({"type":"idle"})
        }
    }

    pub fn thread(&self) -> Value {
        json!({"id":self.raw["id"],"cwd":self.raw["cwd"],"name":self.raw["title"],"status":self.status(),"turns":self.native_turns()})
    }
}

fn validate_state(raw: &Value, thread: &str, cwd: &str) -> Result<()> {
    ensure!(
        raw["id"] == thread,
        "Desktop snapshot thread identity mismatch"
    );
    let path = raw["cwd"]
        .as_str()
        .context("Desktop snapshot has no working directory")?;
    ensure!(
        std::path::Path::new(path).canonicalize()? == std::path::Path::new(cwd).canonicalize()?,
        "Desktop snapshot working directory mismatch"
    );
    ensure!(
        raw["turns"].is_array(),
        "Desktop snapshot has no turns array"
    );
    ensure!(
        raw["requests"].is_array(),
        "Desktop snapshot has no requests array"
    );
    Ok(())
}

fn array(value: &Value) -> &[Value] {
    value.as_array().map(Vec::as_slice).unwrap_or_default()
}
fn turn_id(turn: &Value) -> Option<&str> {
    turn["turnId"].as_str()
}
fn item_id(item: &Value) -> Option<&str> {
    item["id"].as_str()
}
fn empty_placeholder(turn: &Value) -> bool {
    turn["turnId"].is_null()
        && turn["turnStartedAtMs"].is_null()
        && turn["status"] == "completed"
        && turn["error"].is_null()
        && array(&turn["items"]).is_empty()
}
fn remember_item(seen: &mut HashSet<String>, item: &Value) -> bool {
    item_id(item).is_none_or(|id| seen.insert(id.into()))
}

// Unmatched optimistic segments retain their position relative to canonical IDs.
fn insert_around_anchors(
    existing: Vec<Value>,
    incoming: &[Value],
    anchors: &HashSet<&str>,
    id: impl Fn(&Value) -> Option<&str>,
) -> Vec<Value> {
    let mut before: HashMap<String, Vec<Value>> = HashMap::new();
    let mut pending = Vec::new();
    for value in incoming {
        if let Some(key) = id(value).filter(|key| anchors.contains(key)) {
            if !pending.is_empty() {
                before.entry(key.into()).or_default().append(&mut pending);
            }
        } else {
            pending.push(value.clone());
        }
    }
    let mut result = Vec::new();
    for value in existing {
        if let Some(prefix) = id(&value).and_then(|key| before.remove(key)) {
            result.extend(prefix);
        }
        result.push(value);
    }
    result.extend(pending);
    result
}

fn nonnull_preferred(target: &mut Value, preferred: &Value, fallback: &Value, field: &str) {
    if let Some(value) = preferred
        .get(field)
        .filter(|value| !value.is_null())
        .or_else(|| fallback.get(field))
    {
        target[field] = value.clone();
    }
}
fn merged_object(existing: &Value, incoming: &Value) -> Value {
    let mut map = incoming.as_object().cloned().unwrap_or_default();
    if let Some(existing) = existing.as_object() {
        map.extend(existing.clone());
    }
    json!(map)
}
fn merge_turn(existing: &Value, incoming: &Value) -> Value {
    let mut merged = incoming.clone();
    let mut pagination = if existing["itemsPagination"].is_null() {
        incoming["itemsPagination"].clone()
    } else {
        merged_object(&existing["itemsPagination"], &incoming["itemsPagination"])
    };
    if incoming["itemsPagination"]["source"] == "timeline" {
        pagination = merged_object(&incoming["itemsPagination"], &existing["itemsPagination"]);
        pagination["hasLoadedOldest"] = json!(
            incoming["itemsPagination"]["hasLoadedOldest"] == true
                || existing["itemsPagination"]["hasLoadedOldest"] == true
        );
        if let Some(map) = pagination.as_object_mut() {
            map.remove("reconnect");
        }
    }
    for field in [
        "automationKind",
        "automationNotificationDecision",
        "localMetadata",
        "requestTraceId",
        "requestedReasoningEffort",
        "aeonAssistantMessageStartedAtMsById",
        "agentMessageCompletedAtMsById",
        "commandExecutionStartedAtMsById",
        "turnStartedAtMs",
        "durationMs",
        "rootTurnId",
        "finalAssistantStartedAtMs",
    ] {
        nonnull_preferred(&mut merged, existing, incoming, field);
    }
    for field in ["diff", "interruptedCommandExecutionItemIds"] {
        nonnull_preferred(&mut merged, incoming, existing, field);
    }
    if existing["status"] != "inProgress"
        && incoming["status"] == "inProgress"
        && !pagination.is_null()
    {
        merged["status"] = existing["status"].clone();
    }
    if !existing["params"]["clientUserMessageId"].is_null()
        && !array(&existing["params"]["input"]).is_empty()
        && array(&incoming["params"]["input"]).is_empty()
    {
        merged["params"] = existing["params"].clone();
    } else if incoming["params"]["cyberAccessProgram"].is_null()
        && !existing["params"]["cyberAccessProgram"].is_null()
    {
        for field in ["cyberAccessProgram", "model", "collaborationMode"] {
            merged["params"][field] = existing["params"][field].clone();
        }
    }
    merged["items"] = json!(merge_turn_items(existing, incoming));
    if !existing["completedItemIds"].is_null() && !incoming["completedItemIds"].is_null() {
        merged["completedItemIds"] =
            merged_object(&existing["completedItemIds"], &incoming["completedItemIds"]);
    } else {
        nonnull_preferred(&mut merged, existing, incoming, "completedItemIds");
    }
    if !pagination.is_null() {
        merged["itemsPagination"] = pagination;
    }
    if !array(&existing["hookRuns"]).is_empty() {
        merged["hookRuns"] = existing["hookRuns"].clone();
    }
    if existing["requiresMisalignmentReviewTarget"] == true
        || incoming["requiresMisalignmentReviewTarget"] == true
        || !existing["error"]["misalignment"]["reviewTarget"].is_null()
        || !incoming["error"]["misalignment"]["reviewTarget"].is_null()
    {
        merged["requiresMisalignmentReviewTarget"] = json!(true);
    }
    if let Some(map) = merged.as_object_mut() {
        map.remove("itemTimingsById");
    }
    reconcile_steering(&mut merged);
    merged
}

fn merge_turn_items(existing: &Value, incoming: &Value) -> Vec<Value> {
    let old = array(&existing["items"]);
    let new = array(&incoming["items"]);
    if !existing["itemsPagination"].is_null() || !incoming["itemsPagination"].is_null() {
        return merge_items(old, new);
    }
    if old.iter().any(|item| item["type"] == "steeringUserMessage") {
        let refreshed: Vec<Value> = old
            .iter()
            .map(|item| {
                if item["type"] == "agentMessage" {
                    new.iter()
                        .find(|candidate| candidate["id"] == item["id"])
                        .unwrap_or(item)
                        .clone()
                } else {
                    item.clone()
                }
            })
            .collect();
        return merge_items(&refreshed, new);
    }
    if old.len() <= new.len() {
        return new.to_vec();
    }
    let mut result = old.to_vec();
    if let Some(answer) = new
        .iter()
        .rev()
        .find(|item| item["type"] == "agentMessage" && item["phase"] == "final_answer")
    {
        let found = old.iter().position(|item| {
            item["type"] == "agentMessage"
                && (item["id"] == answer["id"]
                    || item["phase"] == "final_answer" && item["text"] == answer["text"])
        });
        match found {
            None => result.push(answer.clone()),
            Some(index) if old[index]["id"] != answer["id"] => {
                let mut item = merged_object(answer, &old[index]);
                item["id"] = old[index]["id"].clone();
                nonnull_preferred(&mut item, answer, &old[index], "memoryCitation");
                result[index] = item;
            }
            _ => {}
        }
    }
    result
}

fn final_answer_with_citation(item: &Value) -> bool {
    item["type"] == "agentMessage"
        && item["phase"] == "final_answer"
        && item["text"].is_string()
        && item
            .get("memoryCitation")
            .is_some_and(|value| value.is_object() || value.is_null())
}
fn merge_items(existing: &[Value], incoming: &[Value]) -> Vec<Value> {
    let mut mapped = existing.to_vec();
    let mut matched: HashMap<String, String> = HashMap::new();
    let mut used = HashSet::new();
    for item in incoming {
        let index = existing
            .iter()
            .position(|old| item_id(old).is_some() && item_id(old) == item_id(item))
            .or_else(|| {
                final_answer_with_citation(item)
                    .then(|| {
                        existing.iter().position(|old| {
                            !used.contains(&item_id(old))
                                && final_answer_with_citation(old)
                                && old["text"] == item["text"]
                        })
                    })
                    .flatten()
            });
        if let Some(index) = index {
            used.insert(item_id(&existing[index]));
            if let (Some(new_id), Some(old_id)) = (item_id(item), item_id(&existing[index])) {
                matched.insert(new_id.into(), old_id.into());
            }
            if existing[index]["id"] != item["id"] {
                mapped[index] = merged_object(item, &existing[index]);
                mapped[index]["id"] = existing[index]["id"].clone();
                nonnull_preferred(&mut mapped[index], item, &existing[index], "memoryCitation");
            }
        }
    }
    let mut before: HashMap<String, Vec<Value>> = HashMap::new();
    let mut pending = Vec::new();
    for item in incoming {
        if let Some(id) = item_id(item).and_then(|id| matched.get(id)) {
            if !pending.is_empty() {
                before.entry(id.clone()).or_default().append(&mut pending);
            }
        } else {
            pending.push(item.clone());
        }
    }
    let mut result = Vec::new();
    for item in mapped {
        if let Some(prefix) = item_id(&item).and_then(|id| before.remove(id)) {
            result.extend(prefix);
        }
        result.push(item);
    }
    result.extend(pending);
    result
}

fn steering_matches(steer: &Value, native: &Value) -> bool {
    (!steer["serverUserMessageId"].is_null() && steer["serverUserMessageId"] == native["id"])
        || (!native["clientId"].is_null()
            && ["clientUserMessageId", "serverClientUserMessageId"]
                .iter()
                .any(|key| steer[*key] == native["clientId"]))
}
fn reconcile_steering(turn: &mut Value) {
    let native: Vec<Value> = array(&turn["items"])
        .iter()
        .filter(|item| item["type"] == "userMessage")
        .cloned()
        .collect();
    for steer in turn["items"]
        .as_array_mut()
        .into_iter()
        .flatten()
        .filter(|item| item["type"] == "steeringUserMessage")
    {
        if let Some(user) = native.iter().find(|user| steering_matches(steer, user)) {
            steer["status"] = json!("accepted");
            steer["serverUserMessageId"] = user["id"].clone();
            if !user["clientId"].is_null() {
                steer["serverClientUserMessageId"] = user["clientId"].clone();
            }
        }
    }
}
fn relocate_steering(turns: &mut Vec<Value>) {
    let positions: HashMap<String, usize> = turns
        .iter()
        .enumerate()
        .filter_map(|(index, turn)| turn_id(turn).map(|id| (id.into(), index)))
        .collect();
    let mut moves = Vec::new();
    for (index, turn) in turns.iter_mut().enumerate() {
        let Some(items) = turn["items"].as_array_mut() else {
            continue;
        };
        items.retain(|item| {
            let target = (item["type"] == "steeringUserMessage")
                .then(|| {
                    item["targetTurnId"]
                        .as_str()
                        .and_then(|id| positions.get(id))
                        .copied()
                })
                .flatten();
            if let Some(target) = target.filter(|target| *target != index) {
                moves.push((target, item.clone()));
                false
            } else {
                true
            }
        });
    }
    let moved = !moves.is_empty();
    for (index, item) in moves {
        if let Some(items) = turns[index]["items"].as_array_mut()
            && !items.iter().any(|old| old["id"] == item["id"])
        {
            items.push(item);
        }
    }
    for turn in turns.iter_mut() {
        reconcile_steering(turn);
    }
    if moved {
        turns.retain(|turn| !empty_placeholder(turn));
    }
}

/// Join durable native history with a partial desktop read view. Only the live
/// view supplies execution state; older persisted items remain available.
pub fn merge_native_history(persisted: Vec<Value>, live: Vec<Value>) -> Vec<Value> {
    let live_by_id: HashMap<&str, &Value> = live
        .iter()
        .filter_map(|turn| item_id(turn).map(|id| (id, turn)))
        .collect();
    let anchors: HashSet<&str> = persisted.iter().filter_map(item_id).collect();
    let mapped = persisted
        .iter()
        .map(|turn| {
            item_id(turn).and_then(|id| live_by_id.get(id)).map_or_else(
                || turn.clone(),
                |current| {
                    let mut result = merged_object(current, turn);
                    let old_items = array(&turn["items"]);
                    let mut new_items = array(&current["items"]).to_vec();
                    let old_users: Vec<&Value> = old_items
                        .iter()
                        .filter(|item| item["type"] == "userMessage")
                        .collect();
                    let mut user_position = 0;
                    for item in &mut new_items {
                        if item["type"] != "userMessage" {
                            continue;
                        }
                        let ordinal = user_position;
                        user_position += 1;
                        let matched = old_users
                            .iter()
                            .copied()
                            .find(|old| {
                                item_id(old).is_some() && item_id(old) == item_id(item)
                                    || !item["clientId"].is_null()
                                        && old["clientId"] == item["clientId"]
                                    || !item["serverUserMessageId"].is_null()
                                        && old["id"] == item["serverUserMessageId"]
                            })
                            .or_else(|| {
                                // Opening input is synthesized solely from turn.params.input.
                                // Its first-user position + exact content establishes identity
                                // even in older rollouts without a clientId.
                                let synthetic_opening =
                                    item_id(item).is_some_and(|id| id.starts_with("desktop-user:"));
                                (synthetic_opening && ordinal == 0)
                                    .then(|| old_users.first().copied())
                                    .flatten()
                                    .filter(|old| old["content"] == item["content"])
                            });
                        if let Some(old) = matched {
                            let mut normalized = merged_object(item, old);
                            normalized["id"] = old["id"].clone();
                            if normalized["clientId"].is_null() && !old["clientId"].is_null() {
                                normalized["clientId"] = old["clientId"].clone();
                            }
                            *item = normalized;
                        }
                    }
                    let updates: HashMap<&str, &Value> = new_items
                        .iter()
                        .filter_map(|item| item_id(item).map(|id| (id, item)))
                        .collect();
                    let mapped_items = old_items
                        .iter()
                        .map(|item| {
                            item_id(item)
                                .and_then(|id| updates.get(id))
                                .map_or_else(|| item.clone(), |new| merged_object(new, item))
                        })
                        .collect();
                    let item_anchors = old_items.iter().filter_map(item_id).collect();
                    result["items"] = json!(insert_around_anchors(
                        mapped_items,
                        &new_items,
                        &item_anchors,
                        item_id
                    ));
                    result
                },
            )
        })
        .collect();
    insert_around_anchors(mapped, &live, &anchors, item_id)
}

fn patch_index(value: &Value) -> Result<usize> {
    if let Some(index) = value.as_u64() {
        return usize::try_from(index).context("Desktop array patch index overflow");
    }
    let key = value.as_str().context("Invalid array patch index")?;
    ensure!(
        !key.is_empty() && key.bytes().all(|byte| byte.is_ascii_digit()),
        "Invalid array patch index"
    );
    key.parse().context("Desktop array patch index overflow")
}
fn apply_patch(root: &mut Value, patch: &Value) -> Result<()> {
    let path = patch["path"]
        .as_array()
        .context("Desktop patch path must be an array")?;
    let op = patch["op"]
        .as_str()
        .context("Missing desktop patch operation")?;
    ensure!(
        matches!(op, "add" | "replace" | "remove"),
        "Unsupported desktop patch operation"
    );
    for part in path {
        ensure!(
            !matches!(
                part.as_str(),
                Some("__proto__" | "constructor" | "prototype")
            ),
            "Unsafe desktop patch path"
        );
        ensure!(
            part.is_string() || part.as_u64().is_some(),
            "Invalid desktop patch path component"
        );
    }
    if path.is_empty() {
        ensure!(
            op != "remove" && patch.get("value").is_some(),
            "Invalid desktop root patch"
        );
        *root = patch["value"].clone();
        return Ok(());
    }
    let mut parent = root;
    for part in &path[..path.len() - 1] {
        parent = match parent {
            Value::Object(map) => map.get_mut(part.as_str().context("Invalid object patch key")?),
            Value::Array(array) => array.get_mut(patch_index(part)?),
            _ => None,
        }
        .context("Desktop patch path not found")?;
    }
    let key = &path[path.len() - 1];
    ensure!(
        op == "remove" || patch.get("value").is_some(),
        "Missing desktop patch value"
    );
    match parent {
        Value::Object(map) => {
            let key = key.as_str().context("Invalid object patch key")?;
            ensure!(
                op == "add" || map.contains_key(key),
                "Desktop patch key not found"
            );
            if op == "remove" {
                map.remove(key);
            } else {
                map.insert(key.into(), patch["value"].clone());
            }
        }
        Value::Array(array) => {
            let index = if op == "add" && key == "-" {
                array.len()
            } else {
                patch_index(key)?
            };
            if op == "add" {
                ensure!(index <= array.len(), "Desktop array add out of bounds");
                array.insert(index, patch["value"].clone());
            } else {
                ensure!(index < array.len(), "Desktop array patch out of bounds");
                if op == "remove" {
                    array.remove(index);
                } else {
                    array[index] = patch["value"].clone();
                }
            }
        }
        _ => anyhow::bail!("Invalid desktop patch parent"),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn state() -> Snapshot {
        Snapshot::new(
            json!({"id":"thread","cwd":"/tmp","turns":[],"requests":[],"future":{"opaque":true}}),
            4,
            "thread",
            "/tmp",
        )
        .unwrap()
    }
    #[test]
    fn patches_are_atomic_and_preserve_unknown_fields_without_double_text() {
        let mut state = state();
        state.raw["text"] = json!("你");
        state.apply(&json!({"baseRevision":4,"revision":5,"patches":[{"op":"replace","path":["text"],"value":"你好"}],"acceptedTextChanges":[{"edits":[{"at":1,"deleteCount":0,"insert":"好"}]}]})).unwrap();
        assert_eq!(state.raw["text"], "你好");
        assert_eq!(state.raw["future"]["opaque"], true);
        let before = state.raw.clone();
        assert!(state.apply(&json!({"baseRevision":5,"revision":6,"patches":[{"op":"replace","path":["text"],"value":"bad"},{"op":"remove","path":["absent"]}]})).is_err());
        assert_eq!(state.raw, before);
        assert_eq!(state.revision, 5);
        assert!(
            state
                .apply(&json!({"baseRevision":2,"revision":6,"patches":[]}))
                .is_err()
        );
    }
    #[test]
    fn canonical_history_and_current_overlay_retain_original_turn_and_input() {
        let mut state = state();
        state.raw["turnHistory"] = json!({"kind":"canonical","history":{"islands":[{"newerBoundary":{"status":"exhausted"},"entries":[{"value":"entity"}]}],"entitiesByKey":{"entity":{"turnId":"original","status":"inProgress","params":{"clientUserMessageId":"opening","input":[{"type":"text","text":"原文"},{"type":"localImage","path":"/fixture/image.png"}]},"items":[{"id":"a","type":"agentMessage","text":"早期"}]}}}});
        state.raw["turns"] = json!([{"turnId":"original","status":"inProgress","params":{"input":[]},"items":[{"id":"a","type":"agentMessage","text":"最新"},{"id":"b","type":"future","opaque":true}]}]);
        assert_eq!(state.active_turn().as_deref(), Some("original"));
        let turns = state.native_turns();
        assert_eq!(turns.len(), 1);
        assert_eq!(turns[0]["id"], "original");
        assert_eq!(
            turns[0]["items"][0]["content"][1]["path"],
            "/fixture/image.png"
        );
        assert_eq!(turns[0]["items"][1]["text"], "最新");
        assert_eq!(turns[0]["items"][2]["opaque"], true);
    }

    fn turn(id: Option<&str>, status: &str) -> Value {
        json!({"turnId":id,"status":status,"params":{"input":[]},"items":[]})
    }
    fn canonical(state: &mut Snapshot, turns: Vec<Value>, live: bool) {
        let mut entities = serde_json::Map::new();
        let entries: Vec<Value> = turns
            .into_iter()
            .enumerate()
            .map(|(index, turn)| {
                let key = format!("entity-{index}");
                entities.insert(key.clone(), turn);
                json!({"value":key})
            })
            .collect();
        state.raw["turnHistory"] = json!({"kind":"canonical","history":{"isComplete":false,"islands":[{"entries":entries,"newerBoundary":{"status":if live {"exhausted"} else {"available"}}}],"entitiesByKey":entities}});
    }
    #[test]
    fn unmatched_optimistic_turns_keep_anchor_order_and_legacy_last_wins() {
        let mut state = state();
        canonical(
            &mut state,
            vec![turn(Some("a"), "completed"), turn(Some("b"), "completed")],
            true,
        );
        let mut optimistic = turn(None, "inProgress");
        optimistic["params"]["input"] = json!([{"type":"text","text":"pending"}]);
        state.raw["turns"] = json!([
            turn(Some("a"), "failed"),
            optimistic,
            turn(Some("b"), "inProgress"),
            turn(Some("b"), "completed"),
            turn(Some("c"), "inProgress")
        ]);
        let turns = state.turns();
        assert_eq!(
            turns
                .iter()
                .map(|turn| turn["turnId"].clone())
                .collect::<Vec<_>>(),
            vec![json!("a"), Value::Null, json!("b"), json!("c")]
        );
        assert_eq!(turns[2]["status"], "completed");
        assert_eq!(state.active_turn().as_deref(), Some("c"));
        assert!(!state.history_complete());
        assert!(state.has_live_tail());
    }
    #[test]
    fn terminal_paginated_turn_and_latest_completed_turn_do_not_reactivate() {
        let mut state = state();
        let mut old = turn(Some("a"), "completed");
        old["itemsPagination"] =
            json!({"source":"timeline","hasLoadedOldest":true,"opaque":"kept"});
        old["items"] = json!([{"id":"old","type":"reasoning","summary":["kept"]}]);
        canonical(&mut state, vec![old], true);
        state.raw["turns"] = json!([turn(Some("a"), "inProgress")]);
        assert_eq!(state.turns()[0]["status"], "completed");
        assert_eq!(state.turns()[0]["items"][0]["id"], "old");
        assert!(!state.busy());
        state.raw["turnHistory"] = Value::Null;
        state.raw["turns"] = json!([
            turn(Some("old"), "inProgress"),
            turn(Some("new"), "completed")
        ]);
        assert!(state.active_turn().is_none());
        assert!(!state.busy());
    }
    #[test]
    fn live_tail_search_islands_and_uncertain_submissions_are_distinct() {
        let mut state = state();
        canonical(&mut state, vec![turn(Some("search"), "inProgress")], false);
        assert!(!state.has_live_tail());
        assert!(state.active_turn().is_none());
        // The owner can report busy without establishing a safe expectedTurnId.
        assert!(state.busy());
        canonical(&mut state, vec![turn(Some("live"), "inProgress")], true);
        assert_eq!(state.active_turn().as_deref(), Some("live"));
        state.raw["turnHistory"] = Value::Null;
        state.raw["unconfirmedTurnSubmissions"] = json!([{"terminal":true}]);
        assert!(!state.busy());
        state.raw["unconfirmedTurnSubmissions"] = json!([{"terminal":false}]);
        assert!(state.busy());
        state.raw["unconfirmedTurnSubmissions"] = json!([]);
        state.raw["resumeState"] = json!("needs_resume");
        state.raw["threadRuntimeStatus"] = json!({"type":"active"});
        assert!(state.busy());
    }
    #[test]
    fn owner_runtime_and_resuming_status_override_completed_display_markers() {
        let mut state = state();
        state.raw["turns"] = json!([turn(Some("last"), "completed"), turn(None, "completed")]);
        state.raw["threadRuntimeStatus"] = json!({"type":"active","activeFlags":[]});
        assert!(state.busy());
        state.raw["threadRuntimeStatus"] = json!({"type":"idle"});
        state.raw["resumeState"] = json!("resuming");
        assert!(state.busy());
        assert_eq!(state.status()["type"], "active");
        state.raw["resumeState"] = json!("resumed");
        assert!(!state.busy());
        assert_eq!(state.status()["type"], "idle");
        state.raw["unconfirmedTurnSubmissions"] = json!([{"terminal":false}]);
        assert_eq!(state.status()["type"], "active");
        state.raw["unconfirmedTurnSubmissions"] = json!([{"terminal":true}]);
        assert_eq!(state.status()["type"], "idle");
        state.raw["requests"] = json!([{"id":1,"method":"item/commandExecution/requestApproval"}]);
        assert_eq!(state.status()["activeFlags"], json!(["waitingOnApproval"]));
    }
    #[test]
    fn opening_and_steering_inputs_survive_without_duplicate_accepted_users() {
        let mut state = state();
        let mut active = turn(Some("a"), "inProgress");
        active["params"] = json!({"clientUserMessageId":"opening","input":[{"type":"text","text":"first"},{"type":"localImage","path":"/fixture.png"}]});
        active["items"] = json!([
            {"id":"optimistic","type":"steeringUserMessage","clientUserMessageId":"steer-client","input":[{"type":"text","text":"second"}]},
            {"id":"native-steer","type":"userMessage","clientId":"steer-client","content":[{"type":"text","text":"second"}]}
        ]);
        state.raw["turns"] = json!([active]);
        let turns = state.native_turns();
        let users = &turns[0]["items"];
        assert_eq!(array(users).len(), 2);
        assert_eq!(users[0]["clientId"], "opening");
        assert_eq!(users[0]["content"][1]["path"], "/fixture.png");
        assert_eq!(users[1]["id"], "native-steer");
    }
    #[test]
    fn steering_moves_to_target_turn_and_retains_server_identity() {
        let mut state = state();
        canonical(&mut state, vec![turn(Some("target"), "inProgress")], true);
        let mut optimistic = turn(None, "inProgress");
        optimistic["items"] = json!([{"id":"steer","type":"steeringUserMessage","targetTurnId":"target","status":"accepted","serverUserMessageId":"server-user","clientUserMessageId":"client","input":[{"type":"text","text":"continue"}]}]);
        state.raw["turns"] = json!([optimistic]);
        let turns = state.native_turns();
        assert_eq!(turns[0]["items"][0]["id"], "server-user");
        assert_eq!(turns[0]["items"][0]["clientId"], "client");
    }
    #[test]
    fn explicit_null_effort_and_user_input_flags_are_preserved() {
        let mut state = state();
        state.raw["latestThreadSettings"] =
            json!({"effort":"high","reasoningEffort":"high","opaque":true});
        state.raw["latestReasoningEffort"] = Value::Null;
        assert!(state.settings()["reasoningEffort"].is_null());
        assert!(state.settings()["effort"].is_null());
        state.raw["latestReasoningEffort"] = json!("low");
        assert_eq!(state.settings()["reasoningEffort"], "low");
        assert_eq!(state.settings()["effort"], "low");
        assert_eq!(state.settings()["opaque"], true);
        state.raw["turns"] = json!([turn(Some("a"), "inProgress")]);
        state.raw["requests"] = json!([{"id":9,"method":"item/tool/requestUserInput","params":{}}]);
        assert_eq!(
            state.thread()["status"]["activeFlags"],
            json!(["waitingOnUserInput"])
        );
    }
    #[test]
    fn root_identity_shape_and_path_failures_roll_back_revision_and_state() {
        for patch in [
            json!({"op":"replace","path":[],"value":{"id":"other","cwd":"/tmp","turns":[],"requests":[]}}),
            json!({"op":"replace","path":["cwd"],"value":"/"}),
            json!({"op":"replace","path":["requests"],"value":{}}),
            json!({"op":"add","path":["future","__proto__"],"value":{}}),
            json!({"op":"add","path":["turns",2],"value":{}}),
            json!({"op":"add","path":["turns",-1],"value":{}}),
        ] {
            let mut state = state();
            let before = state.raw.clone();
            assert!(state.apply(&json!({"baseRevision":4,"revision":5,"patches":[{"op":"add","path":["transient"],"value":true},patch]})).is_err());
            assert_eq!(state.raw, before);
            assert_eq!(state.revision, 4);
        }
        let mut state = state();
        state.apply(&json!({"baseRevision":4,"revision":5,"patches":[{"op":"add","path":["turns","-"],"value":turn(Some("a"),"completed")},{"op":"replace","path":["turns","0","status"],"value":"failed"}]})).unwrap();
        assert_eq!(state.raw["turns"][0]["status"], "failed");
        let root = state.raw.clone();
        state.apply(&json!({"baseRevision":5,"revision":6,"patches":[{"op":"replace","path":[],"value":root}]})).unwrap();
        assert_eq!(state.revision, 6);
    }
    #[test]
    fn durable_history_keeps_old_items_and_reconciles_only_proven_user_identity() {
        let persisted = vec![
            json!({"id":"old","status":"completed","items":[]}),
            json!({"id":"live","status":"inProgress","items":[
                {"id":"opening-native","type":"userMessage","content":[{"type":"text","text":"first"}]},
                {"id":"reasoning","type":"reasoning","summary":["past"]},
                {"id":"user-native","type":"userMessage","clientId":"steer-client","content":[{"type":"text","text":"second"}]},
                {"id":"answer","type":"agentMessage","text":"before"}
            ]}),
        ];
        let live = vec![
            json!({"id":"live","status":"completed","items":[
                {"id":"desktop-user:live","type":"userMessage","content":[{"type":"text","text":"first"}]},
                {"id":"optimistic","type":"userMessage","clientId":"steer-client","content":[{"type":"text","text":"second"}]},
                {"id":"answer","type":"agentMessage","text":"after"}
            ]}),
            json!({"id":"next","items":[]}),
        ];
        let merged = merge_native_history(persisted, live);
        assert_eq!(
            merged
                .iter()
                .map(|turn| turn["id"].clone())
                .collect::<Vec<_>>(),
            vec![json!("old"), json!("live"), json!("next")]
        );
        assert_eq!(merged[1]["status"], "completed");
        let items = array(&merged[1]["items"]);
        assert_eq!(items.len(), 4);
        assert_eq!(items[0]["id"], "opening-native");
        assert_eq!(items[1]["id"], "reasoning");
        assert_eq!(items[2]["id"], "user-native");
        assert_eq!(items[3]["text"], "after");
    }
}
