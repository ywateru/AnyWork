//! Native composer controls. Mutations are explicit user actions and never
//! replace the original thread or change its permission/approval policy.
use crate::{ApiError, App, runtime::Runtime, store::Session};
use anyhow::{Context, Result, ensure};
use axum::{
    Json,
    extract::{Path, Query, State},
};
use serde::{Deserialize, Deserializer};
use serde_json::{Value, json};
use std::{collections::HashSet, sync::Arc};

#[path = "goal_objective.rs"]
pub(crate) mod goal_objective;

const DESKTOP_GOAL_REASON: &str = "当前桌面的会话跟随接口只支持读取和暂停目标；新建、恢复、编辑和删除目标需要以共享引擎方式启动桌面。输入和附件已保留，未发送消息。";

pub(crate) fn require_goal_control(rt: &Runtime, pause: bool) -> Result<()> {
    ensure!(!rt.desktop || pause, "{DESKTOP_GOAL_REASON}");
    Ok(())
}
fn goal_capabilities(desktop: bool, connected: bool) -> Value {
    let writable = connected && !desktop;
    json!({"create":writable,"edit":writable,"resume":writable,"clear":writable,"pause":connected,
        "reason":if desktop { Some(DESKTOP_GOAL_REASON) } else if !connected { Some("连接原执行进程后检查目标操作能力") } else { None }})
}

fn current_model(settings: &Value) -> Option<&str> {
    settings["model"]
        .as_str()
        .or_else(|| settings["collaborationMode"]["settings"]["model"].as_str())
}
fn current_effort(settings: &Value) -> Option<&str> {
    settings["effort"]
        .as_str()
        .or_else(|| settings["reasoningEffort"].as_str())
        .or_else(|| settings["collaborationMode"]["settings"]["reasoning_effort"].as_str())
}
fn supports_settings(app: &App, session: &Session) -> bool {
    app.plugins
        .get(&session.agent)
        .is_some_and(|p| p.capabilities.iter().any(|cap| cap == "models"))
}
async fn models(rt: &Runtime) -> Result<Vec<Value>> {
    let mut result = Vec::new();
    let mut cursor = None;
    let mut seen = HashSet::new();
    loop {
        let mut params = json!({"limit":100});
        if let Some(cursor) = &cursor {
            params["cursor"] = json!(cursor);
        }
        let page = rt.rpc.call("model/list", params).await?;
        result.extend(
            page["data"]
                .as_array()
                .context("Agent 未返回可用模型列表")?
                .iter()
                .cloned(),
        );
        cursor = page["nextCursor"].as_str().map(str::to_string);
        let Some(next) = &cursor else { break };
        ensure!(seen.insert(next.clone()), "Agent 模型列表游标重复");
        ensure!(seen.len() < 100, "Agent 模型列表超过读取上限");
    }
    Ok(result)
}
async fn service_tiers(rt: &Runtime, catalog: &mut [Value]) -> (Value, Option<String>) {
    let (access, error) = match rt.rpc.call("configRequirements/read", json!({})).await {
        Ok(value) => {
            let requirements = &value["requirements"]["featureRequirements"];
            let fast = requirements["fast_mode"] != false;
            let ultrafast = (value["supportsIndependentSpeedModes"] == true || fast)
                && requirements["ultrafast_mode"] != false;
            (json!({"fast":fast,"ultrafast":ultrafast}), None)
        }
        Err(error) => (
            Value::Null,
            Some(format!("当前 Agent 无法读取服务等级限制：{error}")),
        ),
    };
    for entry in catalog {
        if let Some(tiers) = entry["serviceTiers"].as_array_mut() {
            tiers.retain(|tier| {
                tier["id"].as_str().is_some_and(|id| {
                    if id == "default" {
                        return true;
                    }
                    if access.is_null() {
                        return false;
                    }
                    id == "flex"
                        || access[if id == "ultrafast" {
                            "ultrafast"
                        } else {
                            "fast"
                        }] == true
                })
            });
        }
    }
    (access, error)
}
fn controls(
    settings: &Value,
    catalog: &[Value],
    available: bool,
    error: Option<String>,
    tier_access: &Value,
    tier_error: Option<String>,
) -> Value {
    let tiers_available = available
        && current_model(settings).is_some_and(|model| {
            catalog
                .iter()
                .find(|entry| entry["model"].as_str() == Some(model))
                .and_then(|entry| entry["serviceTiers"].as_array())
                .is_some_and(|tiers| !tiers.is_empty())
        });
    json!({
        "model":current_model(settings),
        "effort":current_effort(settings),
        "models":catalog,
        "settings_available":available && current_model(settings).is_some() && !catalog.is_empty(),
        "settings_error":error,
        "service_tier":settings["serviceTier"],
        "service_tier_available":tiers_available,
        "service_tier_access":tier_access,
        "service_tier_error":tier_error.or_else(|| (!tiers_available).then(|| "当前 Agent 未提供可用的模型服务等级选项".to_string())),
        "plan":settings["collaborationMode"]["mode"]=="plan",
        "plan_available":current_model(settings).is_some(),
    })
}

// serde's ordinary Option treats a missing field and explicit null identically.
// Thread settings require all three states: unchanged, clear, and a tier id.
fn present_nullable<'de, D: Deserializer<'de>>(d: D) -> Result<Option<Option<String>>, D::Error> {
    Option::<String>::deserialize(d).map(Some)
}
async fn require_idle(app: &App, session: &Session, rt: &Runtime) -> Result<()> {
    let busy = if rt.shared_host {
        crate::runtime::session_state(
            rt,
            session
                .thread_id
                .as_deref()
                .context("Missing shared conversation")?,
        )
        .await?["status"]
            != "idle"
    } else if session.external {
        crate::runtime::active_turn(
            rt,
            session
                .thread_id
                .as_deref()
                .context("Missing Codex thread")?,
        )
        .await?
        .is_some()
    } else {
        rt.turn.lock().await.is_some()
            || ["running", "waiting", "starting"]
                .contains(&app.session(&session.id)?.status.as_str())
    };
    ensure!(
        !busy,
        "Agent is busy; wait for completion before changing settings"
    );
    Ok(())
}

#[derive(Default, Deserialize)]
pub struct ReadQuery {
    #[serde(default)]
    goal_editor: bool,
}

pub async fn read(
    State(app): State<Arc<App>>,
    Path(id): Path<String>,
    Query(query): Query<ReadQuery>,
) -> Result<Json<Value>, ApiError> {
    let s = app.session(&id)?;
    // Reading the composer must never cold-resume a thread. An unrelated CLI
    // can hold its writer while metadata and saved history remain readable.
    if s.agent == crate::workbuddy::AGENT && s.auxiliary {
        return Ok(Json(
            json!({"model":null,"models":[],"settings_available":false,"read_only":true,"read_only_reason":"WorkBuddy 子 Agent 仅支持查看","settings_error":"WorkBuddy child conversations are read-only","plan_available":false,"service_tier_available":false,"goal":null,"goal_capabilities":{"create":false,"edit":false,"resume":false,"clear":false,"pause":false}}),
        ));
    }
    if crate::shared_host::is_shared(&s.agent) {
        let Some(rt) = app.runtimes.lock().await.get(&id).cloned() else {
            let mut result = controls(
                &json!({"model":s.model}),
                &[],
                false,
                Some("连接原生 Agent 后可修改设置；本地历史仍可查看".into()),
                &Value::Null,
                None,
            );
            result["plan_available"] = json!(false);
            result["goal"] = Value::Null;
            result["goal_capabilities"] =
                json!({"create":false,"edit":false,"resume":false,"clear":false,"pause":false});
            return Ok(Json(result));
        };
        let settings = rt
            .rpc
            .call(crate::shared_host::settings_method(&s.agent), json!({}))
            .await?;
        *rt.settings.lock().await = settings.clone();
        let catalog = models(&rt).await?;
        let mut result = controls(&settings, &catalog, true, None, &Value::Null, None);
        if s.agent == crate::claude::DESKTOP {
            result["model_catalog_complete"] = json!(false);
            result["settings_notice"] =
                json!("模型列表仅包含本机 Desktop Code 会话中已观察到的模型，并非完整模型目录");
        }
        if s.agent == crate::claude::CODE && !catalog.is_empty() {
            // Claude's native initialization returns a catalog but may not
            // reveal the effective default model until its first system/init.
            // Selection is still supported; never guess the first catalog row.
            result["settings_available"] = json!(true);
        }
        result["plan_available"] = json!(false);
        result["goal"] = Value::Null;
        result["goal_capabilities"] = json!({"create":false,"edit":false,"resume":false,"clear":false,"pause":false,"reason":"当前 Agent 目标控制暂未接入"});
        return Ok(Json(result));
    }
    let gate = app.gate(&id).await;
    let _lock = gate.lock().await;
    let existing = app.runtimes.lock().await.get(&id).cloned();
    if s.external && existing.is_none() || s.archived {
        // Metadata reads must not keep message submission behind slow catalog IO.
        drop(_lock);
        let mut catalog = app.catalog.lock().await;
        let models = catalog.query(&app, "model/list", json!({})).await;
        let goal = catalog
            .query(&app, "thread/goal/get", json!({"threadId":s.thread_id}))
            .await;
        let reason = if s.archived {
            "归档会话可查看历史；取消归档后可继续工作"
        } else {
            "已加载历史；连接原执行进程后可修改设置"
        };
        let mut result = controls(
            &json!({"model":s.model}),
            models
                .as_ref()
                .ok()
                .and_then(|v| v["data"].as_array())
                .map(Vec::as_slice)
                .unwrap_or(&[]),
            false,
            Some(reason.into()),
            &Value::Null,
            None,
        );
        result["plan_available"] = json!(false);
        result["goal_capabilities"] = goal_capabilities(false, false);
        result["goal"] = goal
            .as_ref()
            .ok()
            .map(|v| v["goal"].clone())
            .unwrap_or(Value::Null);
        result["goal_error"] = json!(goal.err().map(|error| format!("当前无法读取目标：{error}")));
        let goal = result["goal"].clone();
        resolve_goal_objective(&mut result, &goal, query.goal_editor).await?;
        return Ok(Json(result));
    }
    let rt = match existing {
        Some(rt) => rt,
        None => app.ensure_runtime(&s).await?,
    };
    drop(_lock);
    let s = app.session(&id)?;
    let available = supports_settings(&app, &s);
    let (mut catalog, settings_error) = if available {
        match models(&rt).await {
            Ok(catalog) => (catalog, None),
            Err(e) => (vec![], Some(format!("当前 Agent 无法读取模型设置：{e}"))),
        }
    } else {
        (vec![], Some("当前 Agent 未提供模型设置能力".into()))
    };
    let (tier_access, tier_error) = if available {
        service_tiers(&rt, &mut catalog).await
    } else {
        (Value::Null, None)
    };
    let settings = rt.settings.lock().await.clone();
    let mut result = controls(
        &settings,
        &catalog,
        available,
        settings_error,
        &tier_access,
        tier_error,
    );
    let goal = rt
        .rpc
        .call("thread/goal/get", json!({"threadId":s.thread_id}))
        .await;
    let (goal, goal_error) = match goal {
        Ok(value) => (value["goal"].clone(), None),
        Err(e) => (Value::Null, Some(format!("当前 Agent 无法读取目标：{e}"))),
    };
    resolve_goal_objective(&mut result, &goal, query.goal_editor).await?;
    result["goal"] = goal;
    result["goal_capabilities"] = goal_capabilities(rt.desktop, goal_error.is_none());
    result["goal_error"] = json!(goal_error);
    Ok(Json(result))
}
async fn resolve_goal_objective(result: &mut Value, goal: &Value, enabled: bool) -> Result<()> {
    if enabled && let Some(objective) = goal["objective"].as_str() {
        let objective = objective.to_owned();
        let resolved = tokio::task::spawn_blocking(move || {
            goal_objective::resolve(&crate::observer::codex_home()?, &objective)
        })
        .await?;
        match resolved {
            Ok(objective) => result["goal_objective"] = json!(objective),
            Err(error) => {
                // Native load failures retain the original objective so the
                // editor still opens, and report the file error separately.
                result["goal_objective"] = goal["objective"].clone();
                result["goal_objective_error"] = json!(format!("无法读取目标正文：{error}"));
            }
        }
    }
    Ok(())
}
#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum Update {
    Plan {
        enabled: bool,
    },
    Settings {
        model: Option<String>,
        effort: Option<String>,
        #[serde(default, deserialize_with = "present_nullable")]
        service_tier: Option<Option<String>>,
    },
    Goal {
        objective: String,
    },
    GoalStatus {
        status: GoalStatus,
    },
    ClearGoal,
}
#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GoalStatus {
    Active,
    Paused,
}
pub async fn update(
    State(app): State<Arc<App>>,
    Path(id): Path<String>,
    Json(body): Json<Update>,
) -> Result<Json<Value>, ApiError> {
    let gate = app.gate(&id).await;
    let _lock = gate.lock().await;
    let s = app.session(&id)?;
    if s.archived {
        return Err(anyhow::anyhow!("Unarchive this session first").into());
    }
    if let Update::Goal { objective } = &body
        && (objective.trim().is_empty() || objective.len() > 20 * 1024 * 1024)
    {
        return Err(anyhow::anyhow!("目标不能为空，且不能超过 20 MiB").into());
    }
    if s.agent == crate::workbuddy::AGENT && s.auxiliary {
        return Err(anyhow::anyhow!("WorkBuddy child conversations are read-only").into());
    }
    if crate::shared_host::is_shared(&s.agent) {
        let Update::Settings {
            model,
            effort,
            service_tier,
        } = body
        else {
            return Err(
                anyhow::anyhow!("当前 Agent 暂不支持目标或计划模式；未发送任何控制命令").into(),
            );
        };
        if service_tier.is_some() {
            return Err(anyhow::anyhow!("当前 Agent does not support service tiers").into());
        }
        let rt = app.ensure_runtime(&s).await?;
        require_idle(&app, &s, &rt).await?;
        let before = rt
            .rpc
            .call(crate::shared_host::settings_method(&s.agent), json!({}))
            .await?;
        let selected = model
            .as_deref()
            .or_else(|| current_model(&before))
            .context("Select a 当前 Agent model")?;
        let catalog = models(&rt).await?;
        let entry = catalog
            .iter()
            .find(|entry| entry["model"] == selected)
            .context("Model is not in the 当前 Agent catalog")?;
        if let Some(effort) = &effort
            && !entry["supportedReasoningEfforts"]
                .as_array()
                .is_some_and(|items| items.iter().any(|item| item["reasoningEffort"] == *effort))
        {
            return Err(
                anyhow::anyhow!("当前 Agent model does not support this reasoning effort").into(),
            );
        }
        rt.rpc
            .call(
                "thread/settings/update",
                json!({"model":selected,"effort":effort}),
            )
            .await?;
        let settings = rt
            .rpc
            .call(crate::shared_host::settings_method(&s.agent), json!({}))
            .await?;
        *rt.settings.lock().await = settings.clone();
        let mut result = controls(&settings, &catalog, true, None, &Value::Null, None);
        result["plan_available"] = json!(false);
        return Ok(Json(result));
    }
    let rt = app.ensure_runtime(&s).await?;
    let s = app.session(&id)?;
    if matches!(
        &body,
        Update::Goal { .. }
            | Update::ClearGoal
            | Update::GoalStatus {
                status: GoalStatus::Active
            }
    ) {
        require_goal_control(&rt, false)?;
    }
    let thread = s.thread_id.as_deref().context("Missing Codex thread")?;
    match body {
        Update::Plan { enabled } => {
            require_idle(&app, &s, &rt).await?;
            let settings = rt.settings.lock().await.clone();
            let model =
                current_model(&settings).context("当前 Agent 未提供模式设置，无法切换计划模式")?;
            let mode = json!({"mode":if enabled {"plan"} else {"default"},"settings":{"model":model,"reasoning_effort":current_effort(&settings),"developer_instructions":null}});
            rt.rpc
                .call(
                    "thread/settings/update",
                    json!({"threadId":thread,"collaborationMode":mode}),
                )
                .await?;
            rt.settings.lock().await["collaborationMode"] = mode;
            Ok(Json(json!({"plan":enabled})))
        }
        Update::Settings {
            model,
            effort,
            service_tier,
        } => {
            // Native engines accept effort-only updates during an active turn.
            // Model, tier and collaboration changes retain their idle guard.
            if model.is_some() || service_tier.is_some() {
                require_idle(&app, &s, &rt).await?;
            }
            if !supports_settings(&app, &s) {
                return Err(anyhow::anyhow!("当前 Agent 未提供模型设置能力").into());
            }
            if model.is_none() && effort.is_none() && service_tier.is_none() {
                return Err(anyhow::anyhow!("请选择模型、推理强度或服务等级").into());
            }
            let mut catalog = models(&rt).await?;
            let (tier_access, tier_error) = service_tiers(&rt, &mut catalog).await;
            let before = rt.settings.lock().await.clone();
            let selected_model = model
                .as_deref()
                .or_else(|| current_model(&before))
                .context("当前 Agent 未提供模型设置")?;
            let selected = catalog
                .iter()
                .find(|entry| entry["model"].as_str() == Some(selected_model))
                .context("所选模型不在 Agent 提供的可用列表中")?;
            let desired_effort = effort.as_deref().or_else(|| current_effort(&before));
            if let Some(desired) = desired_effort
                && !selected["supportedReasoningEfforts"]
                    .as_array()
                    .is_some_and(|options| {
                        options
                            .iter()
                            .any(|option| option["reasoningEffort"].as_str() == Some(desired))
                    })
            {
                return Err(
                    anyhow::anyhow!("所选模型不支持此推理强度，请同时选择支持的推理强度").into(),
                );
            }
            let tier_supported = |tier: &str| {
                selected["serviceTiers"].as_array().is_some_and(|tiers| {
                    tiers
                        .iter()
                        .any(|option| option["id"].as_str() == Some(tier))
                })
            };
            if let Some(Some(tier)) = &service_tier
                && !tier_supported(tier)
            {
                return Err(anyhow::anyhow!("所选模型未公布此服务等级").into());
            }
            if model
                .as_deref()
                .is_some_and(|model| Some(model) != current_model(&before))
                && service_tier.is_none()
                && before["serviceTier"]
                    .as_str()
                    .is_some_and(|tier| !tier_supported(tier))
            {
                return Err(anyhow::anyhow!(
                    "当前服务等级不适用于所选模型，请同时选择支持的服务等级或明确清除"
                )
                .into());
            }
            let mut params = json!({"threadId":thread});
            if let Some(model) = &model {
                params["model"] = json!(model);
            }
            if let Some(effort) = &effort {
                params["effort"] = json!(effort);
            }
            if let Some(tier) = &service_tier {
                params["serviceTier"] = json!(tier);
            }
            rt.rpc.call("thread/settings/update", params).await?;
            {
                let mut settings = rt.settings.lock().await;
                if let Some(model) = &model {
                    settings["model"] = json!(model);
                }
                if let Some(effort) = &effort {
                    settings["effort"] = json!(effort);
                }
                if let Some(tier) = &service_tier {
                    settings["serviceTier"] = json!(tier);
                }
            }
            // Managed turns explicitly send their saved model. Keep that existing
            // metadata aligned only after the user-requested native change succeeds.
            if !s.external
                && let Some(model) = model
            {
                app.store
                    .update(&id, |session| session.model = Some(model))?;
            }
            Ok(Json(controls(
                &rt.settings.lock().await.clone(),
                &catalog,
                true,
                None,
                &tier_access,
                tier_error,
            )))
        }
        Update::Goal { objective } => {
            let materialized = tokio::task::spawn_blocking(move || {
                goal_objective::materialize(&crate::observer::codex_home()?, &objective)
            })
            .await??;
            let result = rt.rpc.call("thread/goal/set", json!({"threadId":thread,"objective":materialized.objective,"status":"active","origin":"user"})).await;
            match result {
                Ok(result) => Ok(Json(result)),
                Err(error) => {
                    tokio::task::spawn_blocking(move || materialized.discard()).await?;
                    Err(error.into())
                }
            }
        }
        Update::GoalStatus { status } => {
            let current = rt
                .rpc
                .call("thread/goal/get", json!({"threadId":thread}))
                .await?;
            if !current["goal"].is_object() {
                return Err(anyhow::anyhow!("当前会话没有持续目标").into());
            }
            let status = match status {
                GoalStatus::Active => "active",
                GoalStatus::Paused => "paused",
            };
            let result = rt
                .rpc
                .call(
                    "thread/goal/set",
                    json!({"threadId":thread,"status":status,"origin":"user"}),
                )
                .await?;
            Ok(Json(result))
        }
        Update::ClearGoal => {
            let result = rt
                .rpc
                .call(
                    "thread/goal/clear",
                    json!({"threadId":thread,"origin":"user"}),
                )
                .await?;
            Ok(Json(result))
        }
    }
}
