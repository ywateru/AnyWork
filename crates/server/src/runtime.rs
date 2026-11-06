use crate::{App, store::Session};
use anyhow::{Context, Result};
use remote_agent_sdk::RpcProcess;
use serde_json::{Value, json};
use std::sync::Arc;
use tokio::sync::Mutex;

pub struct Runtime {
    pub rpc: Arc<RpcProcess>,
    /// The bridge hydrates its owner's snapshot; it never resumes another engine.
    pub desktop: bool,
    pub turn: Mutex<Option<String>>,
    pub settings: Mutex<Value>,
}

fn retain_composer_metadata(
    store: &crate::store::Store,
    id: &str,
    params: &mut Value,
) -> Result<()> {
    if let Some(composer) = store.composer_metadata_for_item(id, &params["item"])? {
        if let Some(display) = composer["goal_display_text"].as_str() {
            params["display_text"] = json!(display);
        }
        params["composer"] = composer;
    }
    Ok(())
}

impl App {
    pub async fn gate(&self, id: &str) -> Arc<Mutex<()>> {
        self.gates
            .lock()
            .await
            .entry(id.into())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }
    pub fn emit(&self, id: &str, method: &str, mut params: Value, request_id: Option<Value>) {
        if method == "user/message" && !params["display_text"].is_string() {
            if let Some(text) = params["text"].as_str() {
                params["display_text"] = json!(crate::user_text::rendered_body(text));
            }
        } else if matches!(method, "item/started" | "item/completed")
            && params["item"]["type"] == "userMessage"
            && let Some(input) = params["item"]["content"].as_array()
        {
            let display = if self.session(id).is_ok_and(|session| session.external) {
                crate::user_text::display_input(input)
            } else {
                crate::user_text::display_first_text(input)
            };
            params["display_text"] = json!(display);
            if let Err(error) = retain_composer_metadata(&self.store, id, &mut params) {
                tracing::error!("Loading composer metadata: {error}");
            }
        }
        match self.store.event(id, method, params, request_id) {
            Ok(_) => {
                self.changed.notify_waiters();
            }
            Err(e) => tracing::error!("Persisting event: {e}"),
        }
    }
    pub async fn ensure_runtime(self: &Arc<Self>, session: &Session) -> Result<Arc<Runtime>> {
        if let Some(runtime) = self.runtimes.lock().await.get(&session.id).cloned() {
            return Ok(runtime);
        }
        let manifest = self
            .plugins
            .get(&session.agent)
            .context("Plugin is not installed")?;
        let (rpc, mut events, desktop) = if session.external {
            #[cfg(unix)]
            {
                crate::control::connect_owner(self, session).await?
            }
            #[cfg(not(unix))]
            {
                anyhow::bail!("当前平台尚不支持连接原 Codex 执行进程");
            }
        } else {
            let (rpc, events) = RpcProcess::spawn(manifest).await?;
            (rpc, events, false)
        };
        let setup=async {
            if !session.external {
                rpc.call("initialize",json!({"clientInfo":{"name":"anywork","version":"0.1.0"},"capabilities":{"experimentalApi":true}})).await?;
                rpc.send(json!({"method":"initialized","params":{}})).await?;
            }
            let mut params=if session.external { json!({"excludeTurns":true}) } else { remote_agent_codex::thread_options(&session.cwd,session.model.as_deref(),&session.policy) };
            let method=if let Some(thread)=&session.thread_id { params["threadId"]=json!(thread); "thread/resume" } else { "thread/start" };
            let result=match rpc.call(method,params).await {
                // Codex does not persist a rollout until the first turn. Only
                // replace a missing thread when no conversation was recorded.
                Err(e) if !session.external && session.agent == "codex" && method == "thread/resume"
                    && e.to_string().contains("no rollout found for thread id")
                    && !self.store.has_turn_history(&session.id)? => {
                        rpc.call("thread/start", remote_agent_codex::thread_options(&session.cwd,session.model.as_deref(),&session.policy)).await?
                    }
                result => result?,
            };
            let thread=result["thread"]["id"].as_str().context("Plugin did not return a thread id")?.to_string();
            self.store.update(&session.id,|s|{s.thread_id=Some(thread);if !s.external { s.status="idle".into(); }})?;
            Ok::<_,anyhow::Error>(json!({"model":result["model"],"reasoningEffort":result["reasoningEffort"],"collaborationMode":result["collaborationMode"],"serviceTier":result["serviceTier"]}))
        }.await;
        let settings = match setup {
            Ok(settings) => settings,
            Err(e) => {
                rpc.close().await;
                return Err(e);
            }
        };
        let runtime = Arc::new(Runtime {
            rpc,
            desktop,
            turn: Mutex::new(None),
            settings: Mutex::new(settings),
        });
        self.runtimes
            .lock()
            .await
            .insert(session.id.clone(), runtime.clone());
        let app = self.clone();
        let id = session.id.clone();
        let rt = runtime.clone();
        tokio::spawn(async move {
            while let Some(event) = events.recv().await {
                let method = event["method"].as_str().unwrap_or("unknown");
                let params = event.get("params").cloned().unwrap_or(json!({}));
                let request_id = event.get("id").cloned();
                // A shared daemon can publish other thread notifications. Only
                // the selected thread may enter this session's event history.
                if session_thread_mismatch(&app, &id, &params) {
                    continue;
                }
                app.emit(&id, method, params.clone(), request_id.clone());
                match method {
                    "thread/settings/updated" => {
                        if params["threadSettings"].is_object() {
                            *rt.settings.lock().await = params["threadSettings"].clone();
                        }
                    }
                    "turn/started" => {
                        *rt.turn.lock().await = params["turn"]["id"].as_str().map(str::to_string);
                        let _ = app.store.update(&id, |s| s.status = "running".into());
                    }
                    "turn/completed" => {
                        *rt.turn.lock().await = None;
                        let _ = app.store.update(&id, |s| {
                            s.status = if params["turn"]["status"] == "failed" {
                                "error"
                            } else {
                                "idle"
                            }
                            .into()
                        });
                    }
                    "thread/status/changed" => {
                        let status = crate::catalog::external_status(&params["status"]);
                        if matches!(status, "idle" | "error" | "external") {
                            *rt.turn.lock().await = None;
                        }
                        let _ = app.store.set_status(&id, status);
                    }
                    "serverRequest/resolved" => {
                        if rt.turn.lock().await.is_some() {
                            let _ = app.store.update(&id, |s| s.status = "running".into());
                        }
                    }
                    "plugin/exited" => {
                        let mut runtimes = app.runtimes.lock().await;
                        if runtimes.get(&id).is_some_and(|r| Arc::ptr_eq(r, &rt)) {
                            runtimes.remove(&id);
                        }
                        let _ = app.store.update(&id, |s| s.status = "disconnected".into());
                        break;
                    }
                    _ => {}
                }
                if let Some(request_id) = request_id {
                    // Share the HTTP response gate so auto/manual responses cannot
                    // race or restore waiting after a user already resolved it.
                    let gate = app.gate(&id).await;
                    let _lock = gate.lock().await;
                    if app.store.request(&id, &request_id).is_err() {
                        continue;
                    }
                    let policy = app.store.session(&id).map(|s| s.policy).unwrap_or_default();
                    let automatic = if policy == "auto"
                        && !app.store.session(&id).is_ok_and(|s| s.external)
                        && method.ends_with("/requestApproval")
                    {
                        remote_agent_codex::approval_result(method, &params, true).ok()
                    } else {
                        None
                    };
                    if let Some(result) = automatic {
                        if rt
                            .rpc
                            .send(json!({"id":request_id,"result":result}))
                            .await
                            .is_ok()
                        {
                            app.emit(
                                &id,
                                "serverRequest/resolved",
                                json!({"requestId":request_id,"automatic":true}),
                                None,
                            );
                        } else {
                            let _ = app.store.update(&id, |s| s.status = "waiting".into());
                        }
                    } else {
                        let _ = app.store.update(&id, |s| s.status = "waiting".into());
                    }
                }
            }
            app.changed.notify_waiters();
        });
        Ok(runtime)
    }
}

fn session_thread_mismatch(app: &App, id: &str, params: &Value) -> bool {
    let thread = params["threadId"]
        .as_str()
        .or_else(|| params["thread"]["id"].as_str());
    thread.is_some_and(|thread| {
        app.store
            .session(id)
            .ok()
            .and_then(|s| s.thread_id)
            .as_deref()
            != Some(thread)
    })
}

pub async fn active_turn(rt: &Runtime, thread: &str) -> Result<Option<String>> {
    if rt.desktop {
        let result = rt
            .rpc
            .call("anywork/active-turn", json!({"threadId":thread}))
            .await?;
        return Ok(result["turnId"].as_str().map(str::to_owned));
    }
    let page = rt
        .rpc
        .call(
            "thread/turns/list",
            json!({"threadId":thread,"limit":1,"sortDirection":"desc","itemsView":"notLoaded"}),
        )
        .await?;
    Ok(page["data"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|t| t["status"] == "inProgress")
        .and_then(|t| t["id"].as_str())
        .map(str::to_string))
}

#[cfg(test)]
mod composer_metadata_tests {
    use super::*;
    #[test]
    fn live_user_items_keep_native_text_and_receive_only_matching_edit_metadata() {
        let store = crate::store::Store::open(std::path::Path::new(":memory:")).unwrap();
        store
            .save(&Session {
                id: "session".into(),
                thread_id: Some("thread".into()),
                title: "fixture".into(),
                cwd: "/tmp".into(),
                agent: "codex".into(),
                model: None,
                policy: "manual".into(),
                status: "idle".into(),
                archived: false,
                created_at: 0,
                updated_at: 0,
                external: true,
                auxiliary: false,
            })
            .unwrap();
        let composer =
            json!({"markdown":"\\*\\*literal\\*\\*","document":{"type":"doc","content":[]}});
        store
            .save_composer_metadata("session", "client", &composer)
            .unwrap();
        let mut params = json!({"threadId":"thread","turnId":"turn","display_text":"**literal**","item":{"id":"native-user","type":"userMessage","clientId":"client","content":[{"type":"text","text":"**literal**"}]}});
        let original = params.clone();
        retain_composer_metadata(&store, "session", &mut params).unwrap();
        assert_eq!(params["composer"], composer);
        params.as_object_mut().unwrap().remove("composer");
        assert_eq!(params, original);
        for client in [Value::Null, json!("different"), json!(42)] {
            params["item"]["clientId"] = client;
            retain_composer_metadata(&store, "session", &mut params).unwrap();
            assert!(params.get("composer").is_none());
        }
    }
}
