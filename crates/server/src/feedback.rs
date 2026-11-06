//! Message ratings are saved only in AnyWork's database. No agent RPC or
//! vendor telemetry is involved, including for imported native conversations.
use crate::{ApiError, App};
use anyhow::ensure;
use axum::{
    Json,
    extract::{Path, State},
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::sync::Arc;

const TAGS: [&str; 6] = [
    "incorrect-or-incomplete",
    "not-what-i-asked-for",
    "slow-or-buggy",
    "style-or-tone",
    "safety-or-legal-concern",
    "other",
];
// Earlier AnyWork clients used these keys; keep existing saved feedback readable
// and editable while advertising only the native six choices to new clients.
const LEGACY_TAGS: [&str; 3] = ["incorrect", "incomplete", "unhelpful"];

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WriteFeedback {
    rating: String,
    #[serde(default)]
    tags: Vec<String>,
    text: Option<String>,
}
impl WriteFeedback {
    fn validated(mut self) -> anyhow::Result<Self> {
        ensure!(
            ["good", "bad"].contains(&self.rating.as_str()),
            "Invalid feedback rating"
        );
        ensure!(
            self.tags.len() <= TAGS.len(),
            "Feedback accepts at most 6 tags"
        );
        let mut tags = Vec::new();
        for tag in self.tags {
            ensure!(
                TAGS.contains(&tag.as_str()) || LEGACY_TAGS.contains(&tag.as_str()),
                "Invalid feedback tag"
            );
            if !tags.contains(&tag) {
                tags.push(tag);
            }
        }
        if let Some(text) = &self.text {
            ensure!(
                text.chars().count() <= 4000,
                "Feedback text exceeds 4000 characters"
            );
        }
        self.tags = tags;
        self.text = self
            .text
            .map(|text| text.trim().to_owned())
            .filter(|text| !text.is_empty());
        Ok(self)
    }
}

fn validate_message_id(id: &str) -> anyhow::Result<()> {
    ensure!(
        !id.trim().is_empty() && id.chars().count() <= 512 && !id.chars().any(char::is_control),
        "Message id must contain 1 to 512 characters without control characters"
    );
    Ok(())
}

pub async fn list(
    State(app): State<Arc<App>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    app.session(&id)?;
    Ok(Json(
        json!({"feedback":app.store.feedback_list(&id)?,"tags":TAGS,"scope":"local"}),
    ))
}

pub async fn read(
    State(app): State<Arc<App>>,
    Path((id, message_id)): Path<(String, String)>,
) -> Result<Json<Value>, ApiError> {
    app.session(&id)?;
    validate_message_id(&message_id)?;
    Ok(Json(
        json!({"feedback":app.store.feedback(&id,&message_id)?}),
    ))
}

pub async fn write(
    State(app): State<Arc<App>>,
    Path((id, message_id)): Path<(String, String)>,
    Json(input): Json<WriteFeedback>,
) -> Result<Json<Value>, ApiError> {
    app.session(&id)?;
    validate_message_id(&message_id)?;
    let input = input.validated()?;
    let saved = app
        .store
        .save_feedback(&id, &message_id, input.rating, input.tags, input.text)?;
    Ok(Json(json!({"feedback":saved})))
}

pub async fn delete(
    State(app): State<Arc<App>>,
    Path((id, message_id)): Path<(String, String)>,
) -> Result<Json<Value>, ApiError> {
    app.session(&id)?;
    validate_message_id(&message_id)?;
    app.store.delete_feedback(&id, &message_id)?;
    Ok(Json(json!({"ok":true})))
}
