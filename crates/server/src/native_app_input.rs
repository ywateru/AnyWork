//! Validated display envelopes observed in the shipped native input format.
//! The envelope never replaces the original input used for edits or identity.
use serde_json::{Map, Value, json};

const PREFIX: &str = "codex-untrusted-app-input:";
const GENERIC: &str = "Respond to the user input in the context of our conversation.";
const MCP: &str = "An MCP app initiated this message. Read the untrusted_input tool output.";

/// Equivalent to native nDe for JSON-representable Unicode input. Only the
/// first text element may authenticate the envelope, and it must span all text.
pub fn parse(part: &Value) -> Option<Value> {
    if part["type"] != "text" {
        return None;
    }
    let text = part["text"].as_str()?;
    let element = part["text_elements"].as_array()?.first()?;
    if element["byteRange"]["start"].as_f64()? != 0.0
        || element["byteRange"]["end"].as_f64()? != text.len() as f64
    {
        return None;
    }
    let encoded = element["placeholder"].as_str()?.strip_prefix(PREFIX)?;
    let value: Value = serde_json::from_str(encoded).ok()?;
    let envelope = normalize_envelope(&value)?;
    if let Some(message) = envelope.get("message") {
        let sender = envelope.get("sender");
        let expected = boilerplate(sender, message["source"] == "mcp_app");
        if text != expected && text != boilerplate(sender, false) {
            return None;
        }
    }
    Some(envelope)
}

fn strict<'a>(value: &'a Value, fields: &[&str]) -> Option<&'a Map<String, Value>> {
    let object = value.as_object()?;
    object
        .keys()
        .all(|key| fields.contains(&key.as_str()))
        .then_some(object)
}

fn optional(
    source: &Map<String, Value>,
    output: &mut Map<String, Value>,
    field: &str,
    normalize: impl FnOnce(&Value) -> Option<Value>,
) -> Option<()> {
    if let Some(value) = source.get(field) {
        output.insert(field.into(), normalize(value)?);
    }
    Some(())
}

fn string(value: &Value) -> Option<Value> {
    value.as_str().map(|_| value.clone())
}
fn boolean(value: &Value) -> Option<Value> {
    value.as_bool().map(|_| value.clone())
}
fn nullable_string(value: &Value) -> Option<Value> {
    if value.is_null() {
        Some(Value::Null)
    } else {
        string(value)
    }
}
fn object(value: &Value) -> Option<Value> {
    value.as_object().map(|_| value.clone())
}
fn number(value: &Value) -> Option<Value> {
    value
        .as_f64()
        .filter(|number| number.is_finite())
        .map(|_| value.clone())
}
fn array(value: &Value, normalize: impl Fn(&Value) -> Option<Value>) -> Option<Value> {
    Some(Value::Array(
        value
            .as_array()?
            .iter()
            .map(normalize)
            .collect::<Option<_>>()?,
    ))
}
fn strings(value: &Value) -> Option<Value> {
    array(value, string)
}

fn normalize_envelope(value: &Value) -> Option<Value> {
    let source = strict(
        value,
        &[
            "version",
            "sender",
            "message",
            "modelContextAttachments",
            "promptContextWithoutReviewedMessages",
            "reviewedMessageAttachments",
        ],
    )?;
    if source.get("version")?.as_f64()? != 1.0 {
        return None;
    }
    let mut result = Map::new();
    result.insert("version".into(), json!(1));
    optional(source, &mut result, "sender", normalize_sender)?;
    optional(source, &mut result, "message", normalize_message)?;
    optional(
        source,
        &mut result,
        "promptContextWithoutReviewedMessages",
        string,
    )?;
    for (field, reviewed) in [
        ("modelContextAttachments", false),
        ("reviewedMessageAttachments", true),
    ] {
        optional(source, &mut result, field, |value| {
            array(value, |attachment| {
                let normalized = normalize_attachment(attachment)?;
                let untrusted = normalized["untrusted"].as_bool()?;
                if reviewed {
                    (normalized["kind"] == "message" && !untrusted).then_some(normalized)
                } else {
                    untrusted.then_some(normalized)
                }
            })
        })?;
    }
    let nonempty_attachments = ["modelContextAttachments", "reviewedMessageAttachments"]
        .iter()
        .any(|field| {
            result
                .get(*field)
                .and_then(Value::as_array)
                .is_some_and(|items| !items.is_empty())
        });
    (result.contains_key("message")
        || result.contains_key("promptContextWithoutReviewedMessages")
        || nonempty_attachments)
        .then_some(Value::Object(result))
}

fn normalize_sender(value: &Value) -> Option<Value> {
    let source = strict(
        value,
        &["accountUserId", "email", "name", "profilePictureUrl"],
    )?;
    let mut result = Map::new();
    for field in ["accountUserId", "email", "name"] {
        result.insert(field.into(), string(source.get(field)?)?);
    }
    result.insert(
        "profilePictureUrl".into(),
        nullable_string(source.get("profilePictureUrl")?)?,
    );
    Some(Value::Object(result))
}

fn normalize_message(value: &Value) -> Option<Value> {
    let source = strict(
        value,
        &[
            "source",
            "sourceId",
            "text",
            "imageUrls",
            "structuredContent",
        ],
    )?;
    if !matches!(source.get("source")?.as_str()?, "mcp_app" | "visualization")
        || source.get("sourceId")?.as_str()?.is_empty()
    {
        return None;
    }
    let mut result = source.clone();
    string(source.get("text")?)?;
    optional(source, &mut result, "imageUrls", |value| {
        array(value, |item| {
            data_image(item.as_str()?).then(|| item.clone())
        })
    })?;
    optional(source, &mut result, "structuredContent", object)?;
    Some(Value::Object(result))
}

fn normalize_attachment(value: &Value) -> Option<Value> {
    const COMMON: &[&str] = &[
        "kind",
        "untrusted",
        "server",
        "composerAttachmentLayout",
        "composerIcon",
        "composerLabel",
        "composerTitle",
        "sourceName",
        "id",
        "modelContextUpdateId",
        "showInComposer",
        "structuredContent",
        "title",
    ];
    let source = value.as_object()?;
    let content = source.contains_key("content");
    if !source.keys().all(|field| {
        COMMON.contains(&field.as_str())
            || if content {
                field == "content"
            } else {
                field == "text" || field == "imageAttachments"
            }
    }) {
        return None;
    }
    let mut result = Map::new();
    let kind = source.get("kind").map_or(Some("context"), Value::as_str)?;
    if !matches!(kind, "context" | "message") || source.get("id")?.as_str()?.is_empty() {
        return None;
    }
    result.insert("kind".into(), json!(kind));
    result.insert("id".into(), source.get("id")?.clone());
    result.insert("untrusted".into(), boolean(source.get("untrusted")?)?);
    for field in [
        "server",
        "composerLabel",
        "composerTitle",
        "sourceName",
        "modelContextUpdateId",
        "title",
    ] {
        optional(source, &mut result, field, string)?;
    }
    optional(source, &mut result, "composerAttachmentLayout", |value| {
        matches!(value.as_str()?, "card" | "pill").then(|| value.clone())
    })?;
    optional(source, &mut result, "composerIcon", normalize_composer_icon)?;
    optional(source, &mut result, "showInComposer", boolean)?;
    optional(source, &mut result, "structuredContent", object)?;
    if content {
        result.insert(
            "content".into(),
            array(source.get("content")?, normalize_content)?,
        );
    } else {
        result.insert("text".into(), nullable_string(source.get("text")?)?);
        result.insert(
            "imageAttachments".into(),
            array(source.get("imageAttachments")?, |image| {
                let image = strict(image, &["src"])?;
                let src = image.get("src")?.as_str()?;
                data_image(src).then(|| json!({"src":src}))
            })?,
        );
    }
    // fDe transforms title/composerTitle into sourceName, retaining neither alias.
    let name = result
        .get("sourceName")
        .or_else(|| result.get("composerTitle"))
        .or_else(|| result.get("title"))?
        .clone();
    result.remove("composerTitle");
    result.remove("title");
    result.insert("sourceName".into(), name);
    Some(Value::Object(result))
}

fn normalize_composer_icon(value: &Value) -> Option<Value> {
    let source = strict(value, &["alt", "knownAppId", "logoDarkUrl", "logoUrl"])?;
    let mut result = Map::new();
    optional(source, &mut result, "alt", string)?;
    for field in ["knownAppId", "logoDarkUrl", "logoUrl"] {
        optional(source, &mut result, field, nullable_string)?;
    }
    Some(Value::Object(result))
}

// MCP content nodes use ordinary Zod objects: unknown fields are stripped.
fn normalize_content(value: &Value) -> Option<Value> {
    let source = value.as_object()?;
    let kind = source.get("type")?.as_str()?;
    let mut result = Map::new();
    result.insert("type".into(), json!(kind));
    match kind {
        "text" => {
            result.insert("text".into(), string(source.get("text")?)?);
        }
        "image" => {
            let mime = source.get("mimeType")?.as_str()?;
            let data = source.get("data")?.as_str()?;
            if !data_image(&format!("data:{mime};base64,{data}")) {
                return None;
            }
            result.insert("mimeType".into(), json!(mime));
            result.insert("data".into(), json!(data));
        }
        "resource" => {
            result.insert(
                "resource".into(),
                normalize_resource(source.get("resource")?)?,
            );
        }
        "resource_link" => {
            for field in ["name", "uri"] {
                result.insert(field.into(), string(source.get(field)?)?);
            }
            for field in ["title", "description", "mimeType"] {
                optional(source, &mut result, field, string)?;
            }
            optional(source, &mut result, "size", number)?;
            optional(source, &mut result, "icons", |value| {
                array(value, normalize_icon)
            })?;
        }
        _ => return None,
    }
    optional(source, &mut result, "annotations", normalize_annotations)?;
    optional(source, &mut result, "_meta", object)?;
    Some(Value::Object(result))
}

fn normalize_resource(value: &Value) -> Option<Value> {
    let source = value.as_object()?;
    let mut result = Map::new();
    result.insert("uri".into(), string(source.get("uri")?)?);
    optional(source, &mut result, "mimeType", string)?;
    optional(source, &mut result, "_meta", object)?;
    if let Some(text) = source.get("text").and_then(Value::as_str) {
        // The text-resource branch precedes blob in the native union.
        result.insert("text".into(), json!(text));
    } else {
        let blob = source.get("blob")?.as_str()?;
        if !forgiving_base64(blob) {
            return None;
        }
        result.insert("blob".into(), json!(blob));
    }
    Some(Value::Object(result))
}

fn normalize_icon(value: &Value) -> Option<Value> {
    let source = value.as_object()?;
    let mut result = Map::new();
    result.insert("src".into(), string(source.get("src")?)?);
    optional(source, &mut result, "mimeType", string)?;
    optional(source, &mut result, "sizes", strings)?;
    optional(source, &mut result, "theme", |value| {
        matches!(value.as_str()?, "light" | "dark").then(|| value.clone())
    })?;
    Some(Value::Object(result))
}

fn normalize_annotations(value: &Value) -> Option<Value> {
    let source = value.as_object()?;
    let mut result = Map::new();
    optional(source, &mut result, "audience", |value| {
        array(value, |role| {
            matches!(role.as_str()?, "user" | "assistant").then(|| role.clone())
        })
    })?;
    optional(source, &mut result, "priority", |value| {
        (0.0..=1.0)
            .contains(&value.as_f64()?)
            .then(|| value.clone())
    })?;
    optional(source, &mut result, "lastModified", |value| {
        datetime(value.as_str()?).then(|| value.clone())
    })?;
    Some(Value::Object(result))
}

fn alphabet(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'/')
}

/// lDe's exact base64 shape; it validates syntax, not decoded image file bytes.
fn data_image(value: &str) -> bool {
    let Some((mime, data)) = value
        .strip_prefix("data:image/")
        .and_then(|v| v.split_once(";base64,"))
    else {
        return false;
    };
    if !matches!(mime, "png" | "jpeg" | "webp" | "gif")
        || data.is_empty()
        || !data.len().is_multiple_of(4)
    {
        return false;
    }
    let bytes = data.as_bytes();
    let unpadded = bytes
        .iter()
        .position(|byte| *byte == b'=')
        .unwrap_or(bytes.len());
    let padding = bytes.len() - unpadded;
    padding <= 2
        && bytes[..unpadded].iter().copied().all(alphabet)
        && bytes[unpadded..].iter().all(|byte| *byte == b'=')
        && (padding == 0
            || (padding == 1 && unpadded % 4 == 3)
            || (padding == 2 && unpadded % 4 == 2))
}

// MCP blob's atob accepts ASCII whitespace and omitted padding.
fn forgiving_base64(value: &str) -> bool {
    let bytes: Vec<u8> = value
        .bytes()
        .filter(|byte| !matches!(byte, b'\t' | b'\n' | b'\x0c' | b'\r' | b' '))
        .collect();
    let mut end = bytes.len();
    if end.is_multiple_of(4) {
        for _ in 0..2 {
            if end > 0 && bytes[end - 1] == b'=' {
                end -= 1;
            }
        }
    }
    end % 4 != 1 && bytes[..end].iter().copied().all(alphabet)
}

// Native z.iso.datetime({offset:true}) requires seconds, with optional fraction,
// Z or a colon-separated 00:00..23:59 offset, and a real Gregorian date.
fn datetime(value: &str) -> bool {
    fn digits(value: &str) -> Option<u32> {
        value
            .bytes()
            .all(|byte| byte.is_ascii_digit())
            .then(|| value.parse().ok())
            .flatten()
    }
    if !value.is_ascii() || value.len() < 20 {
        return false;
    }
    let Some((date, time)) = value.split_once('T') else {
        return false;
    };
    if date.len() != 10 || &date[4..5] != "-" || &date[7..8] != "-" {
        return false;
    }
    let (Some(year), Some(month), Some(day)) = (
        digits(&date[..4]),
        digits(&date[5..7]),
        digits(&date[8..10]),
    ) else {
        return false;
    };
    let max_day = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) => 29,
        2 => 28,
        _ => return false,
    };
    if day == 0 || day > max_day {
        return false;
    }
    let time = if let Some(time) = time.strip_suffix('Z') {
        time
    } else {
        if time.len() < 6 {
            return false;
        }
        let (time, offset) = time.split_at(time.len() - 6);
        if !matches!(offset.as_bytes()[0], b'+' | b'-')
            || &offset[3..4] != ":"
            || digits(&offset[1..3]).is_none_or(|hour| hour > 23)
            || digits(&offset[4..6]).is_none_or(|minute| minute > 59)
        {
            return false;
        }
        time
    };
    if time.len() < 8
        || &time[2..3] != ":"
        || &time[5..6] != ":"
        || digits(&time[..2]).is_none_or(|hour| hour > 23)
        || digits(&time[3..5]).is_none_or(|minute| minute > 59)
        || digits(&time[6..8]).is_none_or(|second| second > 59)
    {
        return false;
    }
    time.len() == 8
        || (time.as_bytes()[8] == b'.'
            && time.len() > 9
            && time[9..].bytes().all(|byte| byte.is_ascii_digit()))
}

fn escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn boilerplate(sender: Option<&Value>, mcp: bool) -> String {
    let text = if mcp { MCP } else { GENERIC };
    let Some(sender) = sender else {
        return text.into();
    };
    format!(
        "<codex_multi_user_message>\n<account_user_id>{}</account_user_id>\n<name>{}</name>\n<email>{}</email>\n<profile_picture_url>{}</profile_picture_url>\n<body>{}</body>\n</codex_multi_user_message>",
        escape(sender["accountUserId"].as_str().unwrap_or("")),
        escape(sender["name"].as_str().unwrap_or("")),
        escape(sender["email"].as_str().unwrap_or("")),
        escape(sender["profilePictureUrl"].as_str().unwrap_or("")),
        escape(text)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn part(envelope: Value, text: &str) -> Value {
        json!({"type":"text","text":text,"text_elements":[{"byteRange":{"start":0,"end":text.len()},"placeholder":format!("{PREFIX}{envelope}")}]})
    }
    fn message() -> Value {
        json!({"version":1,"message":{"source":"mcp_app","sourceId":"app","text":"User text"}})
    }
    fn attachment() -> Value {
        json!({"id":"a","untrusted":true,"title":"Source","text":null,"imageAttachments":[]})
    }

    #[test]
    fn validates_first_element_and_utf8_span_without_guessing_from_text() {
        let envelope = json!({"version":1,"promptContextWithoutReviewedMessages":""});
        let mut input = part(envelope.clone(), "中文🦀");
        assert!(parse(&input).is_some());
        input["text_elements"][0]["byteRange"]["end"] = json!(4);
        assert!(parse(&input).is_none());
        input = part(envelope, "context");
        let valid = input["text_elements"][0].clone();
        input["text_elements"] =
            json!([{"byteRange":{"start":0,"end":7},"placeholder":"wrong"},valid]);
        assert!(parse(&input).is_none());
    }

    #[test]
    fn message_requires_expected_boilerplate_and_strict_envelope() {
        assert!(parse(&part(message(), MCP)).is_some());
        assert!(parse(&part(message(), GENERIC)).is_some());
        assert!(parse(&part(message(), "arbitrary user text")).is_none());
        for (field, value) in [
            ("version", json!(2)),
            ("unexpected", json!(true)),
            ("sender", Value::Null),
        ] {
            let mut envelope = message();
            envelope[field] = value;
            assert!(parse(&part(envelope, MCP)).is_none(), "{field}");
        }
        assert!(
            parse(&part(
                json!({"version":1,"modelContextAttachments":[]}),
                "raw"
            ))
            .is_none()
        );
        assert!(
            parse(&part(
                json!({"version":1,"promptContextWithoutReviewedMessages":""}),
                "raw"
            ))
            .is_some()
        );
    }

    #[test]
    fn sender_wrapper_uses_exact_escaping_and_all_required_fields() {
        let mut envelope = message();
        envelope["sender"] =
            json!({"accountUserId":"<&'\"","email":"a&b","name":"名<字>","profilePictureUrl":null});
        let text = boilerplate(envelope.get("sender"), true);
        assert!(text.contains("&lt;&amp;&apos;&quot;"));
        assert!(parse(&part(envelope.clone(), &text)).is_some());
        assert!(parse(&part(envelope.clone(), MCP)).is_none());
        envelope["sender"]
            .as_object_mut()
            .unwrap()
            .remove("profilePictureUrl");
        assert!(parse(&part(envelope, &text)).is_none());
    }

    #[test]
    fn legacy_attachments_default_kind_and_normalize_source_name() {
        let envelope = json!({"version":1,"modelContextAttachments":[attachment()]});
        let parsed = parse(&part(envelope, "context only")).unwrap();
        let item = &parsed["modelContextAttachments"][0];
        assert_eq!(item["kind"], "context");
        assert_eq!(item["sourceName"], "Source");
        assert!(item.get("title").is_none());
        let mut reviewed = attachment();
        reviewed["untrusted"] = json!(false);
        reviewed["kind"] = json!("message");
        reviewed["sourceName"] = json!("");
        assert!(
            parse(&part(
                json!({"version":1,"reviewedMessageAttachments":[reviewed.clone()]}),
                "raw"
            ))
            .is_some()
        );
        reviewed["untrusted"] = json!(true);
        assert!(
            parse(&part(
                json!({"version":1,"reviewedMessageAttachments":[reviewed]}),
                "raw"
            ))
            .is_none()
        );
    }

    #[test]
    fn validates_all_content_variants_and_strips_only_nonstrict_node_fields() {
        let item = json!({"id":"a","untrusted":true,"sourceName":"App","content":[
            {"type":"text","text":"A","unknown":"stripped"},
            {"type":"image","mimeType":"image/png","data":"YQ=="},
            {"type":"resource_link","name":"file","uri":"custom:uri","size":-2,"icons":[{"src":"icon","theme":"dark","unknown":1}],"annotations":{"audience":["user"],"priority":0.5,"lastModified":"2024-02-29T23:59:01.123+23:59"}},
            {"type":"resource","resource":{"uri":"custom:uri","blob":" YQ \n","_meta":{"keep":true}}}
        ]});
        let result = parse(&part(
            json!({"version":1,"modelContextAttachments":[item.clone()]}),
            "raw",
        ))
        .unwrap();
        assert!(
            result["modelContextAttachments"][0]["content"][0]
                .get("unknown")
                .is_none()
        );
        assert!(
            result["modelContextAttachments"][0]["content"][2]["icons"][0]
                .get("unknown")
                .is_none()
        );
        let mut bad = item;
        bad["unexpected"] = json!(1);
        assert!(
            parse(&part(
                json!({"version":1,"modelContextAttachments":[bad]}),
                "raw"
            ))
            .is_none()
        );
    }

    #[test]
    fn image_urls_use_native_shape_not_file_magic_or_generic_base64() {
        for valid in [
            "data:image/png;base64,YQ==",
            "data:image/gif;base64,YWI=",
            "data:image/webp;base64,YWJj",
            "data:image/jpeg;base64,AB==",
        ] {
            assert!(data_image(valid), "{valid}");
        }
        for invalid in [
            "data:image/png;base64,",
            "data:image/PNG;base64,YQ==",
            "data:image/svg+xml;base64,YQ==",
            "data:image/png;base64,YQ",
            "data:image/png;base64,YQ==\n",
            "data:image/png;base64,Y===",
            "data:image/png;base64,====",
        ] {
            assert!(!data_image(invalid), "{invalid}");
        }
        let mut envelope = message();
        envelope["message"]["imageUrls"] = json!(["data:image/png;base64,YQ=="]);
        assert!(parse(&part(envelope.clone(), MCP)).is_some());
        envelope["message"]["imageUrls"][0] = json!("https://example.com/image.png");
        assert!(parse(&part(envelope, MCP)).is_none());
    }

    #[test]
    fn rejects_wrong_nested_types_missing_names_and_conflicting_attachment_shapes() {
        for edit in [
            json!({"composerAttachmentLayout":"grid"}),
            json!({"composerIcon":{"unknown":true}}),
            json!({"structuredContent":[]}),
            json!({"content":[],"text":null}),
            json!({"imageAttachments":[{"src":"data:image/png;base64,YQ==","unknown":true}]}),
        ] {
            let mut item = attachment();
            item.as_object_mut()
                .unwrap()
                .extend(edit.as_object().unwrap().clone());
            assert!(
                parse(&part(
                    json!({"version":1,"modelContextAttachments":[item]}),
                    "raw"
                ))
                .is_none()
            );
        }
        let mut unnamed = attachment();
        unnamed.as_object_mut().unwrap().remove("title");
        assert!(
            parse(&part(
                json!({"version":1,"modelContextAttachments":[unnamed]}),
                "raw"
            ))
            .is_none()
        );
    }

    #[test]
    fn datetime_matches_native_gregorian_and_offset_rules() {
        for valid in [
            "0000-02-29T00:00:00Z",
            "2024-02-29T12:34:56Z",
            "2000-02-29T12:34:56.00001-23:59",
            "2024-01-01T00:00:00.123456789012345678901234567890Z",
        ] {
            assert!(datetime(valid), "{valid}");
        }
        for invalid in [
            "1900-02-29T12:34:56Z",
            "2024-02-30T12:34:56Z",
            "2024-01-01T12:34Z",
            "2024-01-01T12:34:56",
            "2024-01-01T24:00:00Z",
            "2024-01-01T00:00:60Z",
            "2024-01-01T12:34:56+2400",
            "2024-01-01T12:34:56+24:00",
        ] {
            assert!(!datetime(invalid), "{invalid}");
        }
        for valid in ["", "YQ", "YWI", "YQ==", "Y W\nI="] {
            assert!(forgiving_base64(valid), "{valid}");
        }
        for invalid in ["Y", "YQ=", "Y===", "YQ==!", "YQ===", "YQ_="] {
            assert!(!forgiving_base64(invalid), "{invalid}");
        }
    }
}
