use anyhow::{Context, Result};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{path::Path, sync::Mutex};

pub fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub id: String,
    pub thread_id: Option<String>,
    pub title: String,
    pub cwd: String,
    pub agent: String,
    pub model: Option<String>,
    pub policy: String,
    pub status: String,
    pub archived: bool,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(default)]
    pub external: bool,
    #[serde(default)]
    pub auxiliary: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Event {
    pub seq: i64,
    pub session_id: String,
    pub method: String,
    pub params: Value,
    pub request_id: Option<Value>,
    pub created_at: i64,
}

/// A bounded scan of the global log. Cursor advancement is independent of visibility.
pub struct ScopedEventPage {
    pub events: Vec<Event>,
    pub cursor: i64,
    pub has_more: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Feedback {
    pub session_id: String,
    pub message_id: String,
    pub rating: String,
    pub tags: Vec<String>,
    pub text: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

pub(crate) mod operations;
mod schema;

pub struct Store(
    Mutex<Connection>,
    #[allow(dead_code)] Option<schema::OwnerGuard>,
    std::sync::atomic::AtomicBool,
);
impl Store {
    pub fn open(path: &Path) -> Result<Self> {
        let (db, owner) = schema::open(path)?;
        Ok(Self(
            Mutex::new(db),
            owner,
            std::sync::atomic::AtomicBool::new(false),
        ))
    }
    /// Local editing metadata is associated only with the client id supplied to
    /// the native request. Text, item order and turn ids are never identities.
    pub fn save_composer_metadata(
        &self,
        id: &str,
        client_id: &str,
        composer: &Value,
    ) -> Result<()> {
        anyhow::ensure!(!client_id.is_empty(), "Missing composer client id");
        anyhow::ensure!(
            composer["markdown"].is_string()
                && composer["document"]["type"] == "doc"
                && composer["document"]["content"].is_array(),
            "Invalid composer metadata"
        );
        let db = self.0.lock().unwrap();
        let existing: Option<String> = db
            .query_row(
                "SELECT data FROM composer_metadata WHERE session_id=?1 AND client_id=?2",
                params![id, client_id],
                |row| row.get(0),
            )
            .optional()?;
        if let Some(existing) = existing {
            anyhow::ensure!(
                serde_json::from_str::<Value>(&existing)? == *composer,
                "Composer client id is already registered"
            );
        } else {
            db.execute(
                "INSERT INTO composer_metadata(session_id,client_id,data) VALUES(?1,?2,?3)",
                params![id, client_id, composer.to_string()],
            )?;
        }
        Ok(())
    }
    #[cfg(test)]
    fn delete_composer_metadata(&self, id: &str, client_id: &str) -> Result<()> {
        self.0.lock().unwrap().execute(
            "DELETE FROM composer_metadata WHERE session_id=?1 AND client_id=?2",
            params![id, client_id],
        )?;
        Ok(())
    }
    pub fn composer_metadata_for_item(&self, id: &str, item: &Value) -> Result<Option<Value>> {
        if item["type"] != "userMessage" {
            return Ok(None);
        }
        let Some(client_id) = item["clientId"].as_str().filter(|id| !id.is_empty()) else {
            return Ok(None);
        };
        let raw: Option<String> = self
            .0
            .lock()
            .unwrap()
            .query_row(
                "SELECT data FROM composer_metadata WHERE session_id=?1 AND client_id=?2",
                params![id, client_id],
                |row| row.get(0),
            )
            .optional()?;
        raw.map(|raw| Ok(serde_json::from_str(&raw)?)).transpose()
    }
    pub fn feedback_list(&self, id: &str) -> Result<Vec<Feedback>> {
        let db = self.0.lock().unwrap();
        let mut stmt = db
            .prepare("SELECT data FROM message_feedback WHERE session_id=?1 ORDER BY message_id")?;
        stmt.query_map([id], |r| r.get::<_, String>(0))?
            .map(|r| Ok(serde_json::from_str(&r?)?))
            .collect()
    }
    pub fn edit_operation(&self, id: &str, operation: &str) -> Result<Option<Value>> {
        let raw: Option<String> = self
            .0
            .lock()
            .unwrap()
            .query_row(
                "SELECT data FROM message_edits WHERE session_id=?1 AND operation_id=?2",
                params![id, operation],
                |row| row.get(0),
            )
            .optional()?;
        raw.map(|raw| Ok(serde_json::from_str(&raw)?)).transpose()
    }
    pub fn active_edit(&self, id: &str) -> Result<Option<Value>> {
        let raw: Option<String> = self.0.lock().unwrap().query_row(
            "SELECT data FROM message_edits WHERE session_id=?1 AND json_extract(data,'$.phase') NOT IN ('completed','failed','cancelled') ORDER BY rowid DESC LIMIT 1",
            [id], |row| row.get(0),
        ).optional()?;
        raw.map(|raw| Ok(serde_json::from_str(&raw)?)).transpose()
    }
    pub fn unfinished_edit(&self, id: &str) -> Result<Option<Value>> {
        let raw: Option<String> = self.0.lock().unwrap().query_row(
            "SELECT data FROM message_edits WHERE session_id=?1 AND rowid=(SELECT MAX(rowid) FROM message_edits WHERE session_id=?1) AND json_extract(data,'$.phase') NOT IN ('completed','cancelled')",
            [id], |row| row.get(0),
        ).optional()?;
        raw.map(|raw| Ok(serde_json::from_str(&raw)?)).transpose()
    }
    pub fn save_edit(&self, id: &str, operation: &Value) -> Result<()> {
        let count=self.0.lock().unwrap().execute(
            "INSERT INTO message_edits(operation_id,session_id,data) VALUES(?1,?2,?3) ON CONFLICT(operation_id) DO UPDATE SET data=excluded.data WHERE message_edits.session_id=excluded.session_id",
            params![operation["id"].as_str().context("Missing edit operation id")?, id, operation.to_string()],
        )?;
        anyhow::ensure!(
            count == 1,
            "Edit operation id is already in use by another conversation"
        );
        Ok(())
    }
    pub fn latest_user_event(&self, id: &str) -> Result<Option<Event>> {
        let raw: Option<(i64, String)> = self.0.lock().unwrap().query_row(
            "SELECT seq,data FROM events WHERE session_id=?1 AND json_extract(data,'$.method')='user/message' ORDER BY seq DESC LIMIT 1",
            [id], |row| Ok((row.get(0)?, row.get(1)?)),
        ).optional()?;
        raw.map(|(seq, raw)| {
            let mut event: Event = serde_json::from_str(&raw)?;
            event.seq = seq;
            Ok(event)
        })
        .transpose()
    }
    /// Keep AUTOINCREMENT's high-water mark: existing SSE cursors must never rewind.
    pub fn commit_edit_revert(
        &self,
        id: &str,
        operation: &Value,
        cutoff: Option<i64>,
    ) -> Result<()> {
        let mut db = self.0.lock().unwrap();
        let tx = db.transaction()?;
        if let Some(cutoff) = cutoff {
            tx.execute(
                "DELETE FROM events WHERE session_id=?1 AND seq>=?2",
                params![id, cutoff],
            )?;
        }
        let marker = Event {
            seq: 0,
            session_id: id.into(),
            method: "history/reset".into(),
            params: json!({"operation_id":operation["id"],"reason":"message_edit","thread_id":operation["thread_id"]}),
            request_id: None,
            created_at: now(),
        };
        tx.execute(
            "INSERT INTO events(session_id,data) VALUES(?1,?2)",
            params![id, serde_json::to_string(&marker)?],
        )?;
        tx.execute(
            "UPDATE message_edits SET data=?3 WHERE session_id=?1 AND operation_id=?2",
            params![id, operation["id"].as_str(), operation.to_string()],
        )?;
        tx.commit()?;
        Ok(())
    }
    pub fn remove_edit_echo(&self, id: &str, operation: &Value) -> Result<()> {
        let mut db = self.0.lock().unwrap();
        let tx = db.transaction()?;
        tx.execute("DELETE FROM events WHERE session_id=?1 AND json_extract(data,'$.method')='user/message' AND json_extract(data,'$.params.edit_operation_id')=?2",params![id,operation["id"].as_str()])?;
        let marker = Event {
            seq: 0,
            session_id: id.into(),
            method: "history/reset".into(),
            params: json!({"operation_id":operation["id"],"reason":"message_edit_send_failed","thread_id":operation["thread_id"]}),
            request_id: None,
            created_at: now(),
        };
        tx.execute(
            "INSERT INTO events(session_id,data) VALUES(?1,?2)",
            params![id, serde_json::to_string(&marker)?],
        )?;
        tx.commit()?;
        Ok(())
    }
    pub fn feedback(&self, id: &str, message_id: &str) -> Result<Option<Feedback>> {
        let raw: Option<String> = self
            .0
            .lock()
            .unwrap()
            .query_row(
                "SELECT data FROM message_feedback WHERE session_id=?1 AND message_id=?2",
                params![id, message_id],
                |r| r.get(0),
            )
            .optional()?;
        raw.map(|raw| Ok(serde_json::from_str(&raw)?)).transpose()
    }
    pub fn save_feedback(
        &self,
        id: &str,
        message_id: &str,
        rating: String,
        tags: Vec<String>,
        text: Option<String>,
    ) -> Result<Feedback> {
        let db = self.0.lock().unwrap();
        let previous: Option<String> = db
            .query_row(
                "SELECT data FROM message_feedback WHERE session_id=?1 AND message_id=?2",
                params![id, message_id],
                |r| r.get(0),
            )
            .optional()?;
        let timestamp = now();
        let created_at = previous
            .map(|raw| serde_json::from_str::<Feedback>(&raw))
            .transpose()?
            .map_or(timestamp, |saved| saved.created_at);
        let feedback = Feedback {
            session_id: id.into(),
            message_id: message_id.into(),
            rating,
            tags,
            text,
            created_at,
            updated_at: timestamp,
        };
        db.execute(
            "INSERT INTO message_feedback(session_id,message_id,data) VALUES(?1,?2,?3) ON CONFLICT(session_id,message_id) DO UPDATE SET data=excluded.data",
            params![id, message_id, serde_json::to_string(&feedback)?],
        )?;
        Ok(feedback)
    }
    pub fn delete_feedback(&self, id: &str, message_id: &str) -> Result<()> {
        self.0.lock().unwrap().execute(
            "DELETE FROM message_feedback WHERE session_id=?1 AND message_id=?2",
            params![id, message_id],
        )?;
        Ok(())
    }
    pub fn queue(&self, id: &str) -> Result<Value> {
        let db = self.0.lock().unwrap();
        let mut stmt =
            db.prepare("SELECT seq,data FROM message_queue WHERE session_id=?1 ORDER BY seq")?;
        let items = stmt
            .query_map([id], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?
            .map(|r| {
                let (seq, raw) = r?;
                let mut item: Value = serde_json::from_str(&raw)?;
                item["id"] = json!(seq);
                Ok(item)
            })
            .collect::<Result<Vec<_>>>()?;
        let paused: bool = db
            .query_row(
                "SELECT paused FROM queue_settings WHERE session_id=?1",
                [id],
                |r| r.get(0),
            )
            .optional()?
            .unwrap_or(false);
        let editing = db
            .query_row(
                "SELECT seq,data FROM queue_edits WHERE session_id=?1",
                [id],
                |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)),
            )
            .optional()?
            .map(|(seq, raw)| -> Result<Value> {
                let mut item: Value = serde_json::from_str(&raw)?;
                item["id"] = json!(seq);
                Ok(item)
            })
            .transpose()?;
        Ok(json!({"items":items,"paused":paused,"editing":editing}))
    }
    /// Keep a removed queue item recoverable, including its original FIFO position.
    pub fn queue_begin_edit(&self, id: &str, seq: i64) -> Result<()> {
        let mut db = self.0.lock().unwrap();
        let tx = db.transaction()?;
        operations::require_unlinked(&tx, id, seq)?;
        let data: String = tx.query_row(
            "SELECT data FROM message_queue WHERE session_id=?1 AND seq=?2",
            params![id, seq],
            |r| r.get(0),
        )?;
        let item: Value = serde_json::from_str(&data)?;
        anyhow::ensure!(
            item["status"] == "pending",
            "Only pending queue messages can be edited"
        );
        tx.execute(
            "INSERT INTO queue_edits(session_id,seq,data) VALUES(?1,?2,?3)",
            params![id, seq, data],
        )?;
        tx.execute(
            "DELETE FROM message_queue WHERE session_id=?1 AND seq=?2",
            params![id, seq],
        )?;
        tx.commit()?;
        Ok(())
    }
    pub fn queue_restore_edit(&self, id: &str, seq: i64, replacement: Option<Value>) -> Result<()> {
        let mut db = self.0.lock().unwrap();
        let tx = db.transaction()?;
        operations::require_unlinked(&tx, id, seq)?;
        let original: String = tx.query_row(
            "SELECT data FROM queue_edits WHERE session_id=?1 AND seq=?2",
            params![id, seq],
            |r| r.get(0),
        )?;
        let data = replacement
            .map(|value| value.to_string())
            .unwrap_or(original);
        tx.execute(
            "INSERT INTO message_queue(seq,session_id,data) VALUES(?1,?2,?3)",
            params![seq, id, data],
        )?;
        tx.execute(
            "DELETE FROM queue_edits WHERE session_id=?1 AND seq=?2",
            params![id, seq],
        )?;
        tx.commit()?;
        Ok(())
    }
    pub fn enqueue(&self, id: &str, data: Value) -> Result<()> {
        self.0.lock().unwrap().execute(
            "INSERT INTO message_queue(session_id,data) VALUES(?1,?2)",
            params![id, data.to_string()],
        )?;
        Ok(())
    }
    pub fn queue_write(&self, id: &str, seq: i64, data: Option<Value>) -> Result<()> {
        let db = self.0.lock().unwrap();
        operations::require_unlinked(&db, id, seq)?;
        let count = if let Some(data) = data {
            db.execute(
                "UPDATE message_queue SET data=?3 WHERE session_id=?1 AND seq=?2",
                params![id, seq, data.to_string()],
            )?
        } else {
            db.execute(
                "DELETE FROM message_queue WHERE session_id=?1 AND seq=?2",
                params![id, seq],
            )?
        };
        anyhow::ensure!(count == 1, "Queue message not found");
        Ok(())
    }
    pub fn pause_queue(&self, id: &str, paused: bool) -> Result<()> {
        self.0.lock().unwrap().execute("INSERT INTO queue_settings(session_id,paused) VALUES(?1,?2) ON CONFLICT(session_id) DO UPDATE SET paused=excluded.paused",params![id,paused])?;
        Ok(())
    }
    pub fn save(&self, session: &Session) -> Result<()> {
        self.0.lock().unwrap().execute("INSERT INTO sessions(id,data) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET data=excluded.data", params![session.id, serde_json::to_string(session)?])?;
        Ok(())
    }
    /// A shared host's catalog only reports a coarse running flag. Preserve the
    /// current peer's disconnected state and unresolved interactions atomically
    /// with the catalog write; neither is superseded by that coarse observation.
    pub fn save_shared_observation(&self, session: &Session) -> Result<()> {
        let db = self.0.lock().unwrap();
        let mut observed = session.clone();
        let previous: Option<String> = db
            .query_row(
                "SELECT json_extract(data,'$.status') FROM sessions WHERE id=?1",
                [&session.id],
                |row| row.get(0),
            )
            .optional()?;
        let pending: bool = db.query_row(
            "SELECT EXISTS(SELECT 1 FROM events request WHERE request.session_id=?1
              AND json_extract(request.data,'$.request_id') IS NOT NULL
              AND NOT EXISTS(SELECT 1 FROM events resolution
                WHERE resolution.session_id=request.session_id AND resolution.seq>request.seq
                AND (json_extract(resolution.data,'$.method') IN ('turn/completed','plugin/exited','connection/interrupted')
                  OR (json_extract(resolution.data,'$.method')='serverRequest/resolved'
                    AND json_extract(resolution.data,'$.params.requestId')=json_extract(request.data,'$.request_id')))))",
            [&session.id], |row| row.get(0),
        )?;
        if previous.as_deref() == Some("disconnected") {
            observed.status = "disconnected".into();
        } else if pending {
            observed.status = "waiting".into();
        }
        db.execute("INSERT INTO sessions(id,data) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET data=excluded.data", params![observed.id, serde_json::to_string(&observed)?])?;
        Ok(())
    }
    pub fn refresh_imports(&self, agent: &str, sessions: &[Session]) -> Result<()> {
        anyhow::ensure!(
            sessions.iter().all(|s| s.external && s.agent == agent),
            "Import Agent mismatch"
        );
        let mut db = self.0.lock().unwrap();
        let tx = db.transaction()?;
        tx.execute(
            "DELETE FROM sessions WHERE json_extract(data,'$.external')=1 AND json_extract(data,'$.agent')=?2 AND id NOT IN (SELECT value FROM json_each(?1))",
            params![serde_json::to_string(&sessions.iter().map(|s| &s.id).collect::<Vec<_>>())?, agent],
        )?;
        for s in sessions {
            tx.execute(
                "INSERT INTO sessions(id,data) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
                params![s.id, serde_json::to_string(s)?],
            )?;
        }
        tx.commit()?;
        Ok(())
    }
    pub fn session(&self, id: &str) -> Result<Session> {
        let raw: String = self
            .0
            .lock()
            .unwrap()
            .query_row("SELECT data FROM sessions WHERE id=?1", [id], |r| r.get(0))
            .context("Session not found")?;
        Ok(serde_json::from_str(&raw)?)
    }
    pub fn sessions(&self) -> Result<Vec<Session>> {
        let db = self.0.lock().unwrap();
        let mut stmt = db.prepare("SELECT data FROM sessions")?;
        let mut sessions = stmt
            .query_map([], |r| r.get::<_, String>(0))?
            .map(|r| Ok(serde_json::from_str(&r?)?))
            .collect::<Result<Vec<Session>>>()?;
        sessions.sort_by_key(|s| std::cmp::Reverse(s.updated_at));
        Ok(sessions)
    }
    pub fn update(&self, id: &str, apply: impl FnOnce(&mut Session)) -> Result<Session> {
        // One DB lock for read/modify/write prevents notification and HTTP updates from clobbering each other.
        let db = self.0.lock().unwrap();
        let raw: String =
            db.query_row("SELECT data FROM sessions WHERE id=?1", [id], |r| r.get(0))?;
        let mut s: Session = serde_json::from_str(&raw)?;
        apply(&mut s);
        s.updated_at = now();
        db.execute(
            "UPDATE sessions SET data=?2 WHERE id=?1",
            params![id, serde_json::to_string(&s)?],
        )?;
        Ok(s)
    }
    /// Observing status must not change the conversation's last-activity time.
    pub fn set_status(&self, id: &str, status: &str) -> Result<Session> {
        let raw: String = self
            .0
            .lock()
            .unwrap()
            .query_row(
                "UPDATE sessions SET data=json_set(data,'$.status',?2) WHERE id=?1 RETURNING data",
                params![id, status],
                |row| row.get(0),
            )
            .context("Session not found")?;
        Ok(serde_json::from_str(&raw)?)
    }
    pub fn delete(&self, id: &str) -> Result<()> {
        self.0
            .lock()
            .unwrap()
            .execute("DELETE FROM sessions WHERE id=?1", [id])?;
        Ok(())
    }
    /// An authoritative WorkBuddy display snapshot can repair the same native
    /// user's older passive/live projection without inventing a second input.
    fn reconcile_workbuddy_user(&self, id: &str, data: &Value) -> Result<()> {
        let session = self.session(id)?;
        anyhow::ensure!(
            session.agent == "workbuddy" && session.external,
            "Invalid WorkBuddy user snapshot owner"
        );
        let thread = session
            .thread_id
            .as_deref()
            .context("Missing WorkBuddy native identity")?;
        let key = data["sourceEventKey"]
            .as_str()
            .context("Missing WorkBuddy user snapshot identity")?;
        anyhow::ensure!(
            key.starts_with(&format!("workbuddy:{thread}:")) && key.ends_with(":user"),
            "Invalid WorkBuddy user snapshot identity"
        );
        let mut db = self.0.lock().unwrap();
        let tx = db.transaction()?;
        let previous: Option<(i64,String)> = tx.query_row("SELECT seq,data FROM events WHERE session_id=?1 AND json_extract(data,'$.params.sourceEventKey')=?2",params![id,key],|r|Ok((r.get(0)?,r.get(1)?))).optional()?;
        let Some((seq, raw)) = previous else {
            return Ok(());
        };
        let mut event: Event = serde_json::from_str(&raw)?;
        if event.method != "user/message" || event.request_id.is_some() {
            return Ok(());
        }
        if data["persisted_history"] == true
            && event.params["workbuddy_user_snapshot"] == true
            && event.params["persisted_history"] != true
        {
            // A possibly lagging transcript must not replace canonical live display.
            return Ok(());
        }
        let hidden = data["workbuddy_user_hidden"] == true;
        let before = event.params.clone();
        for field in [
            "text",
            "display_text",
            "input",
            "attachments",
            "history_id",
            "history_turn_id",
            "workbuddy_user_snapshot",
            "workbuddy_user_hidden",
        ] {
            event.params[field] = data[field].clone();
        }
        if data["clientUserMessageId"].is_string() {
            event.params["clientUserMessageId"] = data["clientUserMessageId"].clone();
        }
        // A native live observation supersedes passive provenance, while a later
        // offline read must never downgrade a previously live user's ownership.
        if data["persisted_history"] != true {
            event
                .params
                .as_object_mut()
                .unwrap()
                .remove("persisted_history");
        }
        if !hidden && before == event.params {
            return Ok(());
        }
        if hidden {
            tx.execute(
                "DELETE FROM events WHERE session_id=?1 AND seq=?2",
                params![id, seq],
            )?;
        } else {
            tx.execute(
                "UPDATE events SET data=?3 WHERE session_id=?1 AND seq=?2",
                params![id, seq, serde_json::to_string(&event)?],
            )?;
        }
        let reset = Event {
            seq: 0,
            session_id: id.into(),
            method: "history/reset".into(),
            params: json!({"reason":"workbuddy_user_display","history_turn_id":data["history_turn_id"]}),
            request_id: None,
            created_at: now(),
        };
        tx.execute(
            "INSERT INTO events(session_id,data) VALUES(?1,?2)",
            params![id, serde_json::to_string(&reset)?],
        )?;
        tx.commit()?;
        Ok(())
    }
    pub fn event(
        &self,
        id: &str,
        method: &str,
        data: Value,
        request_id: Option<Value>,
    ) -> Result<Event> {
        let mut data = data;
        let hidden = method == "user/message"
            && data["workbuddy_user_snapshot"] == true
            && data["workbuddy_user_hidden"] == true;
        if method == "user/message" && data["workbuddy_user_snapshot"] == true {
            anyhow::ensure!(
                request_id.is_none(),
                "WorkBuddy user snapshots cannot replace pending requests"
            );
            self.reconcile_workbuddy_user(id, &data)?;
            if hidden {
                data["sourceEventKey"] = json!(format!(
                    "{}:hidden",
                    data["sourceEventKey"].as_str().unwrap()
                ));
            }
        }
        let method = if hidden {
            "workbuddy/user/hidden"
        } else {
            method
        };
        let db = self.0.lock().unwrap();
        if let Some(key) = data["sourceEventKey"]
            .as_str()
            .or_else(|| data["harnessEventKey"].as_str())
        {
            let saved: Option<(i64, String)> = db.query_row("SELECT seq,data FROM events WHERE session_id=?1 AND json_extract(data,'$.params.sourceEventKey')=?2 UNION ALL SELECT seq,data FROM events WHERE session_id=?1 AND json_extract(data,'$.params.harnessEventKey')=?2 AND json_extract(data,'$.params.sourceEventKey') IS NULL ORDER BY seq LIMIT 1", params![id,key], |r| Ok((r.get(0)?,r.get(1)?))).optional()?;
            if let Some((seq, raw)) = saved {
                let mut event: Event = serde_json::from_str(&raw)?;
                event.seq = seq;
                return Ok(event);
            }
        }
        let mut event = Event {
            seq: 0,
            session_id: id.into(),
            method: method.into(),
            created_at: data
                .get("sourceEventTime")
                .unwrap_or(&data["harnessEventTime"])
                .as_i64()
                .filter(|time| *time > 0)
                .unwrap_or_else(now),
            params: data,
            request_id,
        };
        db.execute(
            "INSERT INTO events(session_id,data) VALUES(?1,?2)",
            params![id, serde_json::to_string(&event)?],
        )?;
        event.seq = db.last_insert_rowid();
        Ok(event)
    }
    /// Reconcile only passive WorkBuddy rows after a complete native branch read.
    /// Live events and requests always retain their original replay identity.
    pub fn prune_persisted_history(
        &self,
        id: &str,
        keys: &std::collections::HashSet<String>,
    ) -> Result<bool> {
        let mut db = self.0.lock().unwrap();
        let tx = db.transaction()?;
        let stale = {
            let mut query = tx.prepare("SELECT seq,data FROM events WHERE session_id=?1 AND json_extract(data,'$.params.persisted_history')=1")?;
            let rows =
                query.query_map([id], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?;
            let mut stale = vec![];
            for row in rows {
                let (seq, raw) = row?;
                let event: Event = serde_json::from_str(&raw)?;
                if event.request_id.is_none()
                    && event.params["sourceEventKey"]
                        .as_str()
                        .is_some_and(|key| !keys.contains(key))
                {
                    stale.push(seq);
                }
            }
            stale
        };
        let changed = !stale.is_empty();
        for seq in stale {
            tx.execute(
                "DELETE FROM events WHERE session_id=?1 AND seq=?2",
                params![id, seq],
            )?;
        }
        if changed {
            let marker = Event {
                seq: 0,
                session_id: id.into(),
                method: "history/reset".into(),
                params: json!({"reason":"native_history_branch"}),
                request_id: None,
                created_at: now(),
            };
            tx.execute(
                "INSERT INTO events(session_id,data) VALUES(?1,?2)",
                params![id, serde_json::to_string(&marker)?],
            )?;
        }
        tx.commit()?;
        Ok(changed)
    }
    pub fn events(&self, id: &str, after: i64, limit: usize) -> Result<Vec<Event>> {
        let db = self.0.lock().unwrap();
        let mut stmt = db.prepare(
            "SELECT seq,data FROM events WHERE session_id=?1 AND seq>?2 ORDER BY seq LIMIT ?3",
        )?;
        stmt.query_map(params![id, after, limit.min(5000)], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
        })?
        .map(|r| {
            let (seq, raw) = r?;
            let mut e: Event = serde_json::from_str(&raw)?;
            e.seq = seq;
            Ok(e)
        })
        .collect()
    }
    pub fn event_cursor(&self) -> Result<i64> {
        Ok(self.0.lock().unwrap().query_row(
            "SELECT COALESCE(MAX(seq),0) FROM events",
            [],
            |row| row.get(0),
        )?)
    }
    pub fn control_events(&self, id: &str, after: i64, limit: usize) -> Result<Vec<Event>> {
        let db = self.0.lock().unwrap();
        let mut stmt = db.prepare("SELECT seq,data FROM events WHERE session_id=?1 AND seq>?2 AND (json_extract(data,'$.request_id') IS NOT NULL OR json_extract(data,'$.method') IN ('serverRequest/resolved','turn/started','turn/completed','thread/status/changed','plugin/exited','connection/interrupted')) ORDER BY seq LIMIT ?3")?;
        stmt.query_map(params![id, after, limit.min(5000)], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })?
        .map(|row| {
            let (seq, raw) = row?;
            let mut event: Event = serde_json::from_str(&raw)?;
            event.seq = seq;
            Ok(event)
        })
        .collect()
    }
    /// Scan a bounded global page before applying current session visibility.
    /// Hidden/deleted sessions advance the cursor without exposing their payload.
    pub fn scoped_events(
        &self,
        after: i64,
        limit: usize,
        mut visible: impl FnMut(&Session) -> bool,
    ) -> Result<ScopedEventPage> {
        anyhow::ensure!(after >= 0, "Event cursor must be non-negative");
        let limit = limit.clamp(1, 5000);
        let db = self.0.lock().unwrap();
        let mut stmt = db.prepare(
            "SELECT e.seq,e.data,s.data FROM events e LEFT JOIN sessions s ON s.id=e.session_id WHERE e.seq>?1 ORDER BY e.seq LIMIT ?2",
        )?;
        let rows = stmt
            .query_map(params![after, limit + 1], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let has_more = rows.len() > limit;
        let mut page = ScopedEventPage {
            events: vec![],
            cursor: after,
            has_more,
        };
        for (seq, raw, session) in rows.into_iter().take(limit) {
            page.cursor = seq;
            let Some(session) = session else { continue };
            let session: Session = serde_json::from_str(&session)?;
            if !visible(&session) {
                continue;
            }
            let mut event: Event = serde_json::from_str(&raw)?;
            anyhow::ensure!(
                event.session_id == session.id,
                "Event session identity mismatch"
            );
            event.seq = seq;
            page.events.push(event);
        }
        Ok(page)
    }
    /// The most recent native turn owns its patch, including an empty patch.
    /// A newer turn or a history reset must never inherit an earlier diff.
    pub fn last_turn_diff(&self, id: &str) -> Result<(Option<String>, Option<String>)> {
        let db = self.0.lock().unwrap();
        let mut raw: Option<String> = db.query_row(
            "SELECT data FROM events WHERE session_id=?1 AND (json_extract(data,'$.method') IN ('user/message','turn/started','turn/completed','history/reset') OR json_extract(data,'$.params.history_turn_id') IS NOT NULL) ORDER BY seq DESC LIMIT 1",
            [id], |r| r.get(0),
        ).optional()?;
        if raw.is_none() {
            raw = db.query_row(
                "SELECT data FROM events WHERE session_id=?1 AND json_extract(data,'$.method')='turn/diff/updated' ORDER BY seq DESC LIMIT 1",
                [id], |r| r.get(0),
            ).optional()?;
        }
        let Some(raw) = raw else {
            return Ok((None, None));
        };
        let event: Event = serde_json::from_str(&raw)?;
        if event.method == "history/reset" {
            return Ok((None, None));
        }
        let turn = event.params["turnId"]
            .as_str()
            .or_else(|| event.params["turn"]["id"].as_str())
            .or_else(|| event.params["history_turn_id"].as_str());
        let Some(turn) = turn else {
            return Ok((None, None));
        };
        let raw: Option<String> = db.query_row(
            "SELECT data FROM events WHERE session_id=?1 AND json_extract(data,'$.method')='turn/diff/updated' AND json_extract(data,'$.params.turnId')=?2 ORDER BY seq DESC LIMIT 1",
            params![id,turn], |r| r.get(0),
        ).optional()?;
        let diff = raw
            .map(|raw| -> Result<Option<String>> {
                let e: Event = serde_json::from_str(&raw)?;
                Ok(e.params["diff"].as_str().map(str::to_owned))
            })
            .transpose()?
            .flatten();
        Ok((Some(turn.to_string()), diff))
    }
    /// Page at visible message boundaries, retaining prior lifecycle and pending state.
    pub fn history_page(
        &self,
        id: &str,
        before: i64,
        turns: usize,
    ) -> Result<(Vec<Event>, Option<String>)> {
        let db = self.0.lock().unwrap();
        let start = db.query_row(
            "SELECT seq FROM events WHERE session_id=?1 AND seq<?2 AND (json_extract(data,'$.method')='user/message' OR (json_extract(data,'$.method')='item/completed' AND json_extract(data,'$.params.item.type')!='userMessage')) ORDER BY seq DESC LIMIT 1 OFFSET ?3",
            params![id, before, turns.clamp(1, 20) - 1], |r| r.get::<_, i64>(0)
        ).optional()?.unwrap_or(0);
        let mut stmt = db.prepare(
            "SELECT seq,data FROM events WHERE session_id=?1 AND seq>=?2 AND seq<?3 ORDER BY seq",
        )?;
        let mut events = stmt
            .query_map(params![id, start, before], |r| {
                Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
            })?
            .map(|r| {
                let (seq, raw) = r?;
                let mut e: Event = serde_json::from_str(&raw)?;
                e.seq = seq;
                Ok(e)
            })
            .collect::<Result<Vec<_>>>()?;
        let mut prefix = db.prepare("SELECT seq,data FROM events WHERE session_id=?1 AND seq<?2 AND (json_extract(data,'$.request_id') IS NOT NULL OR json_extract(data,'$.method') IN ('turn/started','turn/completed','serverRequest/resolved','plugin/exited','connection/interrupted') OR ((json_extract(data,'$.method')='item/started' OR json_extract(data,'$.method') LIKE 'item/%/delta' OR json_extract(data,'$.method') LIKE 'item/%Delta') AND COALESCE(json_extract(data,'$.params.itemId'),json_extract(data,'$.params.item.id')) NOT IN (SELECT json_extract(data,'$.params.item.id') FROM events WHERE session_id=?1 AND json_extract(data,'$.method')='item/completed' AND json_extract(data,'$.params.item.id') IS NOT NULL))) ORDER BY seq")?;
        let mut controls = prefix
            .query_map(params![id, start], |r| {
                Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
            })?
            .map(|r| {
                let (seq, raw) = r?;
                let mut e: Event = serde_json::from_str(&raw)?;
                e.seq = seq;
                Ok(e)
            })
            .collect::<Result<Vec<_>>>()?;
        controls.append(&mut events);
        events = controls;
        let older: bool = db.query_row(
            "SELECT EXISTS(SELECT 1 FROM events WHERE session_id=?1 AND seq<?2)",
            params![id, start],
            |r| r.get(0),
        )?;
        Ok((events, older.then(|| start.to_string())))
    }
    pub fn completed_item_ids(&self, id: &str) -> Result<std::collections::HashSet<String>> {
        let db = self.0.lock().unwrap();
        let mut stmt = db.prepare("SELECT json_extract(data,'$.params.item.id') FROM events WHERE session_id=?1 AND json_extract(data,'$.method')='item/completed' AND json_extract(data,'$.params.item.id') IS NOT NULL")?;
        Ok(stmt
            .query_map([id], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<_>>()?)
    }
    pub fn has_turn_history(&self, id: &str) -> Result<bool> {
        Ok(self.0.lock().unwrap().query_row(
            "SELECT EXISTS(SELECT 1 FROM events WHERE session_id=?1 AND (json_extract(data,'$.method')='user/message' OR json_extract(data,'$.method') LIKE 'turn/%' OR json_extract(data,'$.method') LIKE 'item/%'))",
            [id],
            |r| r.get(0),
        )?)
    }
    pub fn request(&self, id: &str, request_id: &Value) -> Result<Event> {
        let mut after = 0;
        let mut found = None;
        loop {
            let events = self.events(id, after, 5000)?;
            if events.is_empty() {
                break;
            }
            for e in events {
                after = e.seq;
                if e.request_id.as_ref() == Some(request_id) {
                    found = Some(e.clone());
                }
                if e.method == "serverRequest/resolved" && e.params["requestId"] == *request_id {
                    found = None;
                }
                if ["turn/completed", "plugin/exited", "connection/interrupted"]
                    .contains(&e.method.as_str())
                {
                    found = None;
                }
            }
        }
        found.context("Approval is no longer pending")
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn scoped_import_refresh_is_atomic_and_preserves_other_agents_and_managed_rows() {
        let db = Store::open(Path::new(":memory:")).unwrap();
        for (id, agent, external) in [
            ("c", "codex", true),
            ("h", "deepseek-harness", true),
            ("w", "workbuddy", true),
            ("owned", "codex", false),
        ] {
            let mut row = composer_session(id);
            row.agent = agent.into();
            row.external = external;
            db.save(&row).unwrap();
            db.event(id, "user/message", json!({"text":id}), None)
                .unwrap();
        }
        let invalid = db.session("h").unwrap();
        assert!(db.refresh_imports("codex", &[invalid]).is_err());
        assert_eq!(db.sessions().unwrap().len(), 4);
        let invalid = db.session("owned").unwrap();
        assert!(db.refresh_imports("codex", &[invalid]).is_err());
        assert_eq!(db.sessions().unwrap().len(), 4);
        db.refresh_imports("codex", &[]).unwrap();
        assert!(db.session("c").is_err());
        for id in ["h", "w", "owned"] {
            assert!(db.session(id).is_ok());
            assert_eq!(db.events(id, 0, 10).unwrap().len(), 1);
        }
    }
    #[test]
    fn replay_lookup_retains_coalesce_precedence_and_indexed_large_import_speed() {
        let db = Store::open(Path::new(":memory:")).unwrap();
        db.save(&composer_session("s")).unwrap();
        let source = db
            .event(
                "s",
                "item/completed",
                json!({"sourceEventKey":"source","harnessEventKey":"shadowed"}),
                None,
            )
            .unwrap();
        let harness = db
            .event(
                "s",
                "item/completed",
                json!({"harnessEventKey":"legacy"}),
                None,
            )
            .unwrap();
        assert_eq!(
            db.event("s", "x", json!({"harnessEventKey":"source"}), None)
                .unwrap()
                .seq,
            source.seq
        );
        assert_eq!(
            db.event("s", "x", json!({"sourceEventKey":"legacy"}), None)
                .unwrap()
                .seq,
            harness.seq
        );
        assert_ne!(
            db.event("s", "x", json!({"sourceEventKey":"shadowed"}), None)
                .unwrap()
                .seq,
            source.seq
        );
        let start = std::time::Instant::now();
        for n in 0..6000 {
            db.event(
                "s",
                "item/completed",
                json!({"sourceEventKey":format!("bulk-{n}"),"item":{"text":"x".repeat(400)}}),
                None,
            )
            .unwrap();
        }
        // A generous bound catches the old quadratic scan without requiring a fast disk.
        assert!(
            start.elapsed() < std::time::Duration::from_secs(5),
            "indexed replay import regressed: {:?}",
            start.elapsed()
        );
    }
    #[test]
    fn authoritative_workbuddy_user_repairs_old_cache_without_replaying_or_hiding_other_events() {
        let db = Store::open(Path::new(":memory:")).unwrap();
        let mut row = composer_session("s");
        row.agent = "workbuddy".into();
        row.external = true;
        row.thread_id = Some("native".into());
        db.save(&row).unwrap();
        let key = "workbuddy:native:turn:user";
        let old=db.event("s","user/message",json!({"sourceEventKey":key,"text":"SECRET_IDENTITY","display_text":"SECRET_IDENTITY","input":[{"type":"text","text":"SECRET_IDENTITY"}],"persisted_history":true,"clientUserMessageId":"retained-client"}),None).unwrap();
        let pending = db
            .event(
                "s",
                "requestApproval",
                json!({"tool":"bash"}),
                Some(json!(55)),
            )
            .unwrap();
        let answer = db
            .event(
                "s",
                "item/completed",
                json!({"item":{"id":"answer","text":"keep answer"}}),
                None,
            )
            .unwrap();
        let clean = json!({"sourceEventKey":key,"text":"clean literal <system-reminder>keep</system-reminder>","display_text":"clean literal <system-reminder>keep</system-reminder>","input":[{"type":"text","text":"clean literal <system-reminder>keep</system-reminder>"}],"attachments":[],"history_turn_id":"turn","history_id":"turn:user","workbuddy_user_snapshot":true,"workbuddy_user_hidden":false});
        let updated = db.event("s", "user/message", clean.clone(), None).unwrap();
        assert_eq!(updated.seq, old.seq);
        assert_eq!(updated.params["clientUserMessageId"], "retained-client");
        let events = db.events("s", 0, 30).unwrap();
        assert!(
            !serde_json::to_string(&events)
                .unwrap()
                .contains("SECRET_IDENTITY")
        );
        assert!(
            events
                .iter()
                .any(|e| e.seq == pending.seq && e.request_id == Some(json!(55)))
        );
        assert!(events.iter().any(|e| e.seq == answer.seq));
        assert_eq!(
            events
                .iter()
                .filter(|e| e.method == "history/reset")
                .count(),
            1
        );
        db.event("s", "user/message", clean.clone(), None).unwrap();
        assert_eq!(db.events("s", 0, 30).unwrap().len(), events.len());
        let mut lagging = clean.clone();
        lagging["persisted_history"] = json!(true);
        lagging["text"] = json!("lagging disk");
        lagging["input"] = json!([]);
        assert_eq!(
            db.event("s", "user/message", lagging, None).unwrap().params["text"],
            clean["text"]
        );
        let mut hidden = clean;
        hidden["workbuddy_user_hidden"] = json!(true);
        hidden["text"] = json!("");
        hidden["display_text"] = json!("");
        hidden["input"] = json!([]);
        db.event("s", "user/message", hidden, None).unwrap();
        let events = db.events("s", 0, 30).unwrap();
        assert!(!events.iter().any(|e| e.method == "user/message"));
        assert!(events.iter().any(|e| e.seq == pending.seq));
        assert!(events.iter().any(|e| e.seq == answer.seq));
    }
    #[test]
    fn persisted_branch_reconciliation_preserves_live_and_requests_and_marks_reset() {
        let db = Store::open(Path::new(":memory:")).unwrap();
        db.save(&composer_session("s")).unwrap();
        for (key, disk, request) in [
            ("old", true, None),
            ("kept", true, None),
            ("live", false, None),
            ("pending", true, Some(json!(7))),
        ] {
            db.event(
                "s",
                "item/completed",
                json!({"sourceEventKey":key,"persisted_history":disk}),
                request,
            )
            .unwrap();
        }
        db.prune_persisted_history("s", &std::collections::HashSet::from(["kept".into()]))
            .unwrap();
        let events = db.events("s", 0, 20).unwrap();
        assert_eq!(events.len(), 4);
        assert!(!events.iter().any(|e| e.params["sourceEventKey"] == "old"));
        assert!(events.iter().any(|e| e.params["sourceEventKey"] == "live"));
        assert!(events.iter().any(|e| e.request_id == Some(json!(7))));
        assert_eq!(events.last().unwrap().method, "history/reset");
        db.prune_persisted_history("s", &std::collections::HashSet::from(["kept".into()]))
            .unwrap();
        assert_eq!(db.events("s", 0, 20).unwrap().len(), 4);
    }
    #[test]
    fn generic_shared_event_identity_deduplicates_without_changing_old_harness_keys() {
        let db = Store::open(Path::new(":memory:")).unwrap();
        db.save(&composer_session("s")).unwrap();
        let first = db
            .event(
                "s",
                "item/completed",
                json!({"sourceEventKey":"wb:r:i","sourceEventTime":1234}),
                None,
            )
            .unwrap();
        let repeat = db
            .event(
                "s",
                "item/completed",
                json!({"sourceEventKey":"wb:r:i","sourceEventTime":5678}),
                None,
            )
            .unwrap();
        assert_eq!(first.seq, repeat.seq);
        assert_eq!(repeat.created_at, 1234);
        db.event(
            "s",
            "item/completed",
            json!({"harnessEventKey":"h:1"}),
            None,
        )
        .unwrap();
        db.event(
            "s",
            "item/completed",
            json!({"harnessEventKey":"h:1"}),
            None,
        )
        .unwrap();
        assert_eq!(db.events("s", 0, 10).unwrap().len(), 2);
    }
    #[test]
    fn shared_catalog_preserves_only_current_pending_interactions() {
        let store = Store::open(Path::new(":memory:")).unwrap();
        let mut observed = composer_session("shared");
        observed.status = "running".into();
        store.save(&observed).unwrap();
        store
            .event(
                "shared",
                "item/commandExecution/requestApproval",
                json!({}),
                Some(json!("old:request")),
            )
            .unwrap();
        store.save_shared_observation(&observed).unwrap();
        assert_eq!(store.session("shared").unwrap().status, "waiting");
        store
            .event(
                "shared",
                "serverRequest/resolved",
                json!({"requestId":"another-request"}),
                None,
            )
            .unwrap();
        store.save_shared_observation(&observed).unwrap();
        assert_eq!(store.session("shared").unwrap().status, "waiting");
        store
            .event(
                "shared",
                "serverRequest/resolved",
                json!({"requestId":"old:request"}),
                None,
            )
            .unwrap();
        store.save_shared_observation(&observed).unwrap();
        assert_eq!(store.session("shared").unwrap().status, "running");
        store
            .event(
                "shared",
                "item/tool/requestUserInput",
                json!({}),
                Some(json!("new:request")),
            )
            .unwrap();
        store
            .event("shared", "connection/interrupted", json!({}), None)
            .unwrap();
        store.set_status("shared", "disconnected").unwrap();
        store.save_shared_observation(&observed).unwrap();
        assert_eq!(store.session("shared").unwrap().status, "disconnected");
        store.set_status("shared", "running").unwrap();
        store.save_shared_observation(&observed).unwrap();
        assert_eq!(store.session("shared").unwrap().status, "running");
        // Terminal events also invalidate an unresolved historical request.
        store
            .event(
                "shared",
                "item/tool/requestUserInput",
                json!({}),
                Some(json!("third:request")),
            )
            .unwrap();
        store
            .event("shared", "turn/completed", json!({}), None)
            .unwrap();
        store.save_shared_observation(&observed).unwrap();
        assert_eq!(store.session("shared").unwrap().status, "running");
    }
    #[test]
    fn control_replay_excludes_message_payloads_and_preserves_native_id_types() {
        let store = Store::open(Path::new(":memory:")).unwrap();
        store.save(&composer_session("one")).unwrap();
        store.save(&composer_session("two")).unwrap();
        store
            .event(
                "one",
                "item/agentMessage/delta",
                json!({"delta":"large output"}),
                None,
            )
            .unwrap();
        for id in [json!(17), json!("17")] {
            store
                .event("one", "item/tool/requestUserInput", json!({}), Some(id))
                .unwrap();
        }
        store
            .event(
                "two",
                "item/tool/requestUserInput",
                json!({}),
                Some(json!(99)),
            )
            .unwrap();
        store
            .event(
                "one",
                "serverRequest/resolved",
                json!({"requestId":17}),
                None,
            )
            .unwrap();
        let controls = store.control_events("one", 0, 500).unwrap();
        assert_eq!(controls.len(), 3);
        assert_eq!(controls[0].request_id, Some(json!(17)));
        assert_eq!(controls[1].request_id, Some(json!("17")));
        assert_eq!(controls[2].method, "serverRequest/resolved");
        assert_eq!(
            store.control_events("one", controls[1].seq, 1).unwrap()[0].seq,
            controls[2].seq
        );
    }
    #[test]
    fn multiplexed_events_preserve_cross_session_order_and_page_boundaries() {
        let store = Store::open(Path::new(":memory:")).unwrap();
        store.save(&composer_session("one")).unwrap();
        store.save(&composer_session("two")).unwrap();
        assert_eq!(store.event_cursor().unwrap(), 0);
        for index in 0..1005 {
            store
                .event(
                    if index % 2 == 0 { "one" } else { "two" },
                    "test/event",
                    json!({"index":index}),
                    None,
                )
                .unwrap();
        }
        let watermark = store.event_cursor().unwrap();
        let mut cursor = 0;
        let mut seen = Vec::new();
        loop {
            let page = store.scoped_events(cursor, 500, |_| true).unwrap().events;
            if page.is_empty() {
                break;
            }
            for event in page {
                assert!(event.seq > cursor);
                cursor = event.seq;
                seen.push((event.session_id, event.params["index"].as_u64().unwrap()));
            }
        }
        assert_eq!(cursor, watermark);
        assert_eq!(seen.len(), 1005);
        for (index, (session, value)) in seen.iter().enumerate() {
            assert_eq!(*value, index as u64);
            assert_eq!(session, if index % 2 == 0 { "one" } else { "two" });
        }
        store.event("two", "test/late", json!({}), None).unwrap();
        let late = store.scoped_events(cursor, 500, |_| true).unwrap().events;
        assert_eq!(late.len(), 1);
        assert_eq!(late[0].method, "test/late");
    }
    #[test]
    fn scoped_scan_advances_past_hidden_or_orphaned_rows_and_fails_closed() {
        let store = Store::open(Path::new(":memory:")).unwrap();
        store.save(&composer_session("hidden")).unwrap();
        let mut visible = composer_session("visible");
        visible.archived = true;
        store.save(&visible).unwrap();
        for _ in 0..501 {
            store
                .event("hidden", "test/secret", json!({"secret":"hidden"}), None)
                .unwrap();
        }
        let shown = store
            .event("visible", "test/visible", json!({"text":"shown"}), None)
            .unwrap();
        store
            .event("hidden", "test/secret", json!({"secret":"tail"}), None)
            .unwrap();
        {
            let db = store.0.lock().unwrap();
            // Invisible payload need not be parsed to establish its watermark.
            db.execute("UPDATE events SET data='{}' WHERE session_id='hidden'", [])
                .unwrap();
        }
        let page = store
            .scoped_events(0, 500, |session| session.id == "visible")
            .unwrap();
        assert!(page.events.is_empty());
        assert_eq!(page.cursor, 500);
        assert!(page.has_more);
        let page = store
            .scoped_events(page.cursor, 500, |session| session.id == "visible")
            .unwrap();
        assert_eq!(page.events.len(), 1);
        assert_eq!(page.events[0].seq, shown.seq);
        assert_eq!(page.cursor, 503);
        assert!(!page.has_more);
        {
            let db = store.0.lock().unwrap();
            db.execute_batch("PRAGMA foreign_keys=OFF; INSERT INTO events(session_id,data) VALUES('deleted','{}'); PRAGMA foreign_keys=ON;").unwrap();
        }
        let page = store.scoped_events(503, 500, |_| true).unwrap();
        assert!(page.events.is_empty());
        assert_eq!(page.cursor, 504);
        assert!(!page.has_more);
        assert!(store.scoped_events(-1, 500, |_| true).is_err());
        assert!(store.scoped_events(0, 500, |_| true).is_err());
        store
            .0
            .lock()
            .unwrap()
            .execute_batch("DROP TABLE events")
            .unwrap();
        assert!(store.scoped_events(504, 500, |_| true).is_err());
    }
    fn composer_session(id: &str) -> Session {
        Session {
            id: id.into(),
            thread_id: Some(format!("thread-{id}")),
            title: id.into(),
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
        }
    }
    #[test]
    fn composer_metadata_uses_exact_native_client_identity_and_session_scope() {
        let store = Store::open(Path::new(":memory:")).unwrap();
        store.save(&composer_session("one")).unwrap();
        store.save(&composer_session("two")).unwrap();
        let composer = json!({"markdown":"\\*\\*same\\*\\*","document":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"**same**"}]}]}});
        store
            .save_composer_metadata("one", "client", &composer)
            .unwrap();
        let item = json!({"id":"server-id","type":"userMessage","clientId":"client","content":[{"type":"text","text":"**same**"}]});
        assert_eq!(
            store.composer_metadata_for_item("one", &item).unwrap(),
            Some(composer.clone())
        );
        assert_eq!(
            store.composer_metadata_for_item("two", &item).unwrap(),
            None
        );
        for modified in [
            json!({"type":"userMessage","id":"client","content":item["content"]}),
            json!({"type":"userMessage","clientUserMessageId":"client","content":item["content"]}),
            json!({"type":"userMessage","clientId":"other","content":item["content"]}),
            json!({"type":"agentMessage","clientId":"client"}),
            json!({"type":"userMessage","clientId":""}),
            json!({"type":"userMessage","clientId":42}),
        ] {
            assert_eq!(
                store.composer_metadata_for_item("one", &modified).unwrap(),
                None
            );
        }
        store
            .save_composer_metadata("one", "client", &composer)
            .unwrap();
        let changed = json!({"markdown":"same","document":{"type":"doc","content":[]}});
        assert!(
            store
                .save_composer_metadata("one", "client", &changed)
                .is_err()
        );
        assert!(store.save_composer_metadata("one", "", &composer).is_err());
        assert!(
            store
                .save_composer_metadata("one", "invalid", &json!({"markdown":"invalid"}))
                .is_err()
        );
        store.delete_composer_metadata("two", "client").unwrap();
        assert_eq!(
            store.composer_metadata_for_item("one", &item).unwrap(),
            Some(composer)
        );
        store.delete_composer_metadata("one", "client").unwrap();
        assert_eq!(
            store.composer_metadata_for_item("one", &item).unwrap(),
            None
        );
    }
    #[test]
    fn composer_metadata_survives_restart_and_is_removed_with_its_session() {
        let directory =
            std::env::temp_dir().join(format!("anywork-composer-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&directory).unwrap();
        let path = directory.join("store.db");
        let store = Store::open(&path).unwrap();
        store.save(&composer_session("one")).unwrap();
        let composer = json!({"markdown":"literal","document":{"type":"doc","content":[]}});
        store
            .save_composer_metadata("one", "client", &composer)
            .unwrap();
        drop(store);
        let store = Store::open(&path).unwrap();
        let item = json!({"type":"userMessage","clientId":"client"});
        assert_eq!(
            store.composer_metadata_for_item("one", &item).unwrap(),
            Some(composer)
        );
        store.delete("one").unwrap();
        store.save(&composer_session("one")).unwrap();
        assert_eq!(
            store.composer_metadata_for_item("one", &item).unwrap(),
            None
        );
        drop(store);
        std::fs::remove_dir_all(directory).unwrap();
    }
    #[test]
    fn queued_edit_survives_restart_and_restores_its_fifo_position() {
        let directory =
            std::env::temp_dir().join(format!("anywork-queue-edit-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&directory).unwrap();
        let path = directory.join("store.db");
        let store = Store::open(&path).unwrap();
        for id in ["one", "two"] {
            store
                .save(&Session {
                    id: id.into(),
                    thread_id: None,
                    title: id.into(),
                    cwd: "/tmp".into(),
                    agent: "fixture".into(),
                    model: None,
                    policy: "manual".into(),
                    status: "idle".into(),
                    archived: false,
                    created_at: 0,
                    updated_at: 0,
                    external: false,
                    auxiliary: false,
                })
                .unwrap();
        }
        for text in ["first", "middle", "last"] {
            store
                .enqueue(
                    "one",
                    json!({"text":text,"attachments":["/tmp/image.png"],"status":"pending"}),
                )
                .unwrap();
        }
        let queue = store.queue("one").unwrap();
        let ids: Vec<i64> = queue["items"]
            .as_array()
            .unwrap()
            .iter()
            .map(|item| item["id"].as_i64().unwrap())
            .collect();
        store.queue_begin_edit("one", ids[1]).unwrap();
        assert!(store.queue_begin_edit("one", ids[0]).is_err());
        assert!(store.queue_restore_edit("two", ids[1], None).is_err());
        assert_eq!(
            store.queue("one").unwrap()["items"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
        drop(store);
        let store = Store::open(&path).unwrap();
        assert_eq!(store.queue("one").unwrap()["editing"]["text"], "middle");
        store.queue_restore_edit("one", ids[1], None).unwrap();
        assert_eq!(store.queue("one").unwrap()["items"], queue["items"]);
        store.queue_begin_edit("one", ids[1]).unwrap();
        store
            .queue_restore_edit(
                "one",
                ids[1],
                Some(json!({"text":"revised","attachments":[],"status":"pending"})),
            )
            .unwrap();
        let replaced = store.queue("one").unwrap();
        assert_eq!(replaced["items"][1]["id"], ids[1]);
        assert_eq!(replaced["items"][1]["text"], "revised");
        assert!(replaced["editing"].is_null());
        assert!(store.queue_restore_edit("one", ids[1], None).is_err());
        store.queue_begin_edit("one", ids[0]).unwrap();
        store.delete("one").unwrap();
        assert!(store.queue("one").unwrap()["editing"].is_null());
        drop(store);
        std::fs::remove_dir_all(directory).unwrap();
    }
    use super::*;
    #[test]
    fn last_turn_patch_is_scoped_and_never_inherits_an_older_turn() {
        let path =
            std::env::temp_dir().join(format!("anywork-review-{}.sqlite", uuid::Uuid::new_v4()));
        let store = Store::open(&path).unwrap();
        store.save(&composer_session("one")).unwrap();
        store.save(&composer_session("two")).unwrap();
        let event = |id: &str, method: &str, params| {
            store.event(id, method, params, None).unwrap();
        };
        assert_eq!(store.last_turn_diff("one").unwrap(), (None, None));
        event("one", "turn/started", json!({"turn":{"id":"a"}}));
        event(
            "one",
            "turn/diff/updated",
            json!({"turnId":"a","diff":"first"}),
        );
        event(
            "two",
            "turn/diff/updated",
            json!({"turnId":"a","diff":"other session"}),
        );
        event(
            "one",
            "turn/diff/updated",
            json!({"turnId":"a","diff":"latest"}),
        );
        assert_eq!(
            store.last_turn_diff("one").unwrap(),
            (Some("a".into()), Some("latest".into()))
        );
        event("one", "user/message", json!({"text":"steer","turnId":"a"}));
        assert_eq!(
            store.last_turn_diff("one").unwrap().1.as_deref(),
            Some("latest")
        );
        event("one", "turn/completed", json!({"turn":{"id":"a"}}));
        assert_eq!(
            store.last_turn_diff("one").unwrap().1.as_deref(),
            Some("latest")
        );
        event("one", "user/message", json!({"text":"new message"}));
        assert_eq!(store.last_turn_diff("one").unwrap(), (None, None));
        event("one", "turn/started", json!({"turn":{"id":"b"}}));
        event(
            "one",
            "turn/diff/updated",
            json!({"turnId":"a","diff":"late old notification"}),
        );
        assert_eq!(
            store.last_turn_diff("one").unwrap(),
            (Some("b".into()), None)
        );
        event(
            "one",
            "turn/diff/updated",
            json!({"turnId":"b","diff":"new"}),
        );
        event("one", "turn/diff/updated", json!({"turnId":"b","diff":""}));
        assert_eq!(
            store.last_turn_diff("one").unwrap(),
            (Some("b".into()), Some("".into()))
        );
        event("one", "history/reset", json!({}));
        event(
            "one",
            "turn/diff/updated",
            json!({"turnId":"b","diff":"late after reset"}),
        );
        assert_eq!(store.last_turn_diff("one").unwrap(), (None, None));
        event(
            "one",
            "item/completed",
            json!({"history_turn_id":"cold","item":{"type":"fileChange","changes":[{"diff":"item patch"}]}}),
        );
        assert_eq!(
            store.last_turn_diff("one").unwrap(),
            (Some("cold".into()), None)
        );
        assert_eq!(
            store.last_turn_diff("two").unwrap().1.as_deref(),
            Some("other session")
        );
        drop(store);
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn restart_does_not_interrupt_external_execution() {
        let path = std::env::temp_dir().join(format!(
            "remote-agent-restart-{}.sqlite",
            uuid::Uuid::new_v4()
        ));
        let store = Store::open(&path).unwrap();
        let mut session = Session {
            id: "external".into(),
            thread_id: Some("ordinary".into()),
            title: "ordinary".into(),
            cwd: "/tmp".into(),
            agent: "codex".into(),
            model: None,
            policy: "manual".into(),
            status: "running".into(),
            archived: false,
            created_at: 0,
            updated_at: 0,
            external: true,
            auxiliary: false,
        };
        store.save(&session).unwrap();
        session.id = "managed".into();
        session.external = false;
        store.save(&session).unwrap();
        store.save_edit("managed",&json!({"id":"interrupted-edit","phase":"starting","stage":"start","history_changed":true})).unwrap();
        drop(store);
        let store = Store::open(&path).unwrap();
        let sessions = store.sessions().unwrap();
        assert_eq!(
            sessions.iter().find(|s| s.external).unwrap().status,
            "running"
        );
        assert_eq!(
            sessions.iter().find(|s| !s.external).unwrap().status,
            "disconnected"
        );
        assert!(store.events("external", 0, 100).unwrap().is_empty());
        assert_eq!(
            store.events("managed", 0, 100).unwrap()[0].method,
            "connection/interrupted"
        );
        assert_eq!(
            store
                .edit_operation("managed", "interrupted-edit")
                .unwrap()
                .unwrap()["phase"],
            "uncertain"
        );
        drop(store);
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn persistence_order_and_cascade() {
        let db = Store::open(Path::new(":memory:")).unwrap();
        db.save(&Session {
            id: "s".into(),
            thread_id: None,
            title: "test".into(),
            cwd: "/tmp".into(),
            agent: "codex".into(),
            model: None,
            policy: "manual".into(),
            status: "idle".into(),
            archived: false,
            created_at: 0,
            updated_at: 0,
            external: false,
            auxiliary: false,
        })
        .unwrap();
        assert!(!db.has_turn_history("s").unwrap());
        let first = db.event("s", "one", json!({}), Some(json!(42))).unwrap();
        db.event("s", "two", json!({}), None).unwrap();
        assert_eq!(db.events("s", first.seq, 100).unwrap().len(), 1);
        assert!(db.request("s", &json!(42)).is_ok());
        db.event("s", "turn/completed", json!({}), None).unwrap();
        assert!(db.has_turn_history("s").unwrap());
        assert!(db.request("s", &json!(42)).is_err());
        let mut imported = db.session("s").unwrap();
        imported.external = true;
        db.save(&imported).unwrap();
        let before = db.events("s", 0, 100).unwrap().len();
        db.refresh_imports("codex", &[imported]).unwrap();
        assert_eq!(db.events("s", 0, 100).unwrap().len(), before);
        db.delete("s").unwrap();
        assert!(db.events("s", 0, 100).unwrap().is_empty());
    }
    #[test]
    fn edit_revert_is_atomic_and_event_cursors_never_rewind() {
        let db = Store::open(Path::new(":memory:")).unwrap();
        db.save(&Session {
            id: "s".into(),
            thread_id: Some("native".into()),
            title: "test".into(),
            cwd: "/tmp".into(),
            agent: "codex".into(),
            model: None,
            policy: "manual".into(),
            status: "idle".into(),
            archived: false,
            created_at: 0,
            updated_at: 0,
            external: false,
            auxiliary: false,
        })
        .unwrap();
        let retained = db
            .event("s", "user/message", json!({"text":"retained"}), None)
            .unwrap();
        let removed = db
            .event("s", "user/message", json!({"text":"removed"}), None)
            .unwrap();
        let last = db.event("s", "turn/completed", json!({}), None).unwrap();
        let mut operation = json!({"id":"operation","phase":"reverting","thread_id":"native"});
        db.save_edit("s", &operation).unwrap();
        operation["phase"] = json!("reverted");
        db.commit_edit_revert("s", &operation, Some(removed.seq))
            .unwrap();
        let events = db.events("s", 0, 100).unwrap();
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].seq, retained.seq);
        assert_eq!(events[1].method, "history/reset");
        assert!(events[1].seq > last.seq);
        assert_eq!(
            db.events("s", last.seq, 100).unwrap()[0].method,
            "history/reset"
        );
        assert_eq!(
            db.edit_operation("s", "operation").unwrap().unwrap()["phase"],
            "reverted"
        );
        operation["phase"] = json!("completed");
        db.save_edit("s", &operation).unwrap();
        assert!(db.active_edit("s").unwrap().is_none());
        assert!(db.unfinished_edit("s").unwrap().is_none());
        operation["phase"] = json!("cancelled");
        db.save_edit("s", &operation).unwrap();
        assert!(db.active_edit("s").unwrap().is_none());
        assert!(db.unfinished_edit("s").unwrap().is_none());
        db.delete("s").unwrap();
        assert!(db.edit_operation("s", "operation").unwrap().is_none());
    }
}
