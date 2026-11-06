//! Plain user-message context wrappers observed in the installed desktop UI.
//! Woe/Ooe and native input display projection. Original inputs stay separate
//! from display text for editing, revision checks and recovery.
use serde_json::{Value, json};
use std::ops::Range;
const PAGE_OPEN: &str = "<page-comment-context>\n";
const PAGE_CLOSE: &str = "\n</page-comment-context>\n";
const REQUEST: &str = "## My request:";
const CODEX_REQUEST: &str = "## My request for Codex:";
const REQUEST_LINE: &str = "## My request:\n";

// ECMAScript trim/trimEnd, including BOM and excluding U+0085 (which Rust's
// char::is_whitespace includes). This keeps the reference helper's semantics.
fn whitespace(ch: char) -> bool {
    matches!(ch,'\u{0009}'..='\u{000d}'|'\u{0020}'|'\u{00a0}'|'\u{1680}'|'\u{2000}'..='\u{200a}'|'\u{2028}'|'\u{2029}'|'\u{202f}'|'\u{205f}'|'\u{3000}'|'\u{feff}')
}
pub fn trim(text: &str) -> &str {
    text.trim_matches(whitespace)
}

fn page_body_offset(text: &str) -> Option<usize> {
    if !text.starts_with(PAGE_OPEN) {
        return None;
    }
    let close = text[PAGE_OPEN.len()..].find(PAGE_CLOSE)? + PAGE_OPEN.len() + PAGE_CLOSE.len();
    text[close..]
        .starts_with(REQUEST_LINE)
        .then_some(close + REQUEST_LINE.len())
}
fn last_request(text: &str) -> Option<(usize, usize)> {
    // Equivalent to /## My request(?: for Codex)?:/g: case-sensitive and not
    // anchored to a line. Both alternatives share a prefix and cannot overlap.
    [REQUEST, CODEX_REQUEST]
        .into_iter()
        .filter_map(|marker| {
            text.rfind(marker)
                .map(|start| (start, start + marker.len()))
        })
        .max_by_key(|(start, _)| *start)
}

/// One native Woe pass. Without a recognized marker, preserve the input exactly.
pub fn body(text: &str) -> &str {
    if let Some(offset) = page_body_offset(text) {
        return trim(&text[offset..]);
    }
    last_request(text).map_or(text, |(_, offset)| trim(&text[offset..]))
}

/// The observed ordinary-message path applies Woe in its source adapter and
/// again in the user-message component. Keep this distinct from the raw helper.
pub fn rendered_body(text: &str) -> &str {
    body(body(text))
}

/// Final display text only. Never use this projection as the original native
/// input, an edit template, or a revision fingerprint.
pub fn display_input(input: &[Value]) -> String {
    display_input_with_options(input, &[], false, false)
}

fn display_input_with_options(
    input: &[Value],
    comments: &[Value],
    strip_lines: bool,
    allow_adjacent: bool,
) -> String {
    let skipped = crate::native_image_context::auxiliary_image_indices(input, comments);
    let mut first_app_has_message = None;
    let mut image_count = 0;
    let mut texts = input
        .iter()
        .enumerate()
        .filter_map(|(index, part)| {
            if matches!(part["type"].as_str(), Some("image" | "localImage")) {
                image_count += 1;
            }
            if part["type"] != "text" || skipped.contains(&index) {
                return None;
            }
            let raw = part["text"].as_str()?;
            let app = crate::native_app_input::parse(part);
            if let Some(app) = &app {
                first_app_has_message.get_or_insert(app["message"].is_object());
                image_count += app["message"]["imageUrls"].as_array().map_or(0, Vec::len);
            }
            Some(
                app.as_ref()
                    .and_then(|app| app["message"]["text"].as_str())
                    .map(str::to_owned)
                    .unwrap_or_else(|| restore_library_placeholders(part, raw)),
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    if first_app_has_message != Some(true) {
        if image_count > 0 {
            texts = crate::native_image_context::strip_image_descriptions(&texts);
        }
        if strip_lines {
            texts =
                crate::native_image_context::strip_image_placeholder_lines(&texts, allow_adjacent);
        }
    }
    // Ggn returns early for the first recognized app input with a message.
    if first_app_has_message == Some(true) {
        body(&texts).to_owned()
    } else {
        rendered_body(&texts).to_owned()
    }
}

/// The local echo intentionally contains only the first text block. Native
/// document helper text and other preserved inputs were never part of it.
pub fn display_first_text(input: &[Value]) -> String {
    let mut found_text = false;
    let input = input
        .iter()
        .filter(|part| {
            if part["type"] != "text" {
                return true;
            }
            if found_text {
                return false;
            }
            found_text = true;
            true
        })
        .cloned()
        .collect::<Vec<_>>();
    display_input(&input)
}

fn library_source(href: &str) -> Option<String> {
    if !href.starts_with("chatgpt-library-file://") {
        return None;
    }
    let parsed = url::Url::parse(href).ok()?;
    if parsed.host_str().is_none_or(str::is_empty) {
        return None;
    }
    let query = parsed.query_pairs().collect::<Vec<_>>();
    if query.iter().find(|(key, _)| key == "asUrl")?.1 != "1" {
        return None;
    }
    let source = query.iter().find(|(key, _)| key == "sourceUrl")?.1.as_ref();
    if !source
        .get(..7)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("http://"))
        && !source
            .get(..8)
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case("https://"))
    {
        return None;
    }
    url::Url::parse(source)
        .ok()?
        .host_str()
        .filter(|host| !host.is_empty())?;
    Some(source.to_owned())
}

fn library_links(text: &str) -> Vec<(Range<usize>, String)> {
    use pulldown_cmark::{Event, LinkType, Parser, Tag};
    let mut links = Vec::new();
    if !text.contains("chatgpt-library-file://") {
        return links;
    }
    let mut opaque_depth = 0;
    for (event, range) in Parser::new(text).into_offset_iter() {
        if opaque_depth > 0 {
            match event {
                Event::Start(_) => opaque_depth += 1,
                Event::End(_) => opaque_depth -= 1,
                _ => {}
            }
            continue;
        }
        match event {
            Event::Start(Tag::Link {
                link_type: LinkType::Inline | LinkType::Autolink | LinkType::Email,
                dest_url,
                ..
            }) => {
                // ZEe never recurses into a link, including an ordinary link
                // whose URL is not a valid library address.
                if let Some(source) = library_source(&dest_url) {
                    links.push((range, source));
                }
                opaque_depth = 1;
            }
            // mdast images have an alt string rather than children. Suppress
            // pulldown's image-label events to keep that AST distinction.
            Event::Start(Tag::Image { .. }) => opaque_depth = 1,
            _ => {}
        }
    }
    links
}

fn placeholder_source(placeholder: &str) -> Option<String> {
    let mut links = library_links(placeholder);
    if links.len() != 1 {
        return None;
    }
    let (range, source) = links.pop()?;
    (range.start == 0 && range.end == placeholder.len()).then_some(source)
}

/// Native YEe: prepare user-authored Markdown for the model while retaining
/// exact library-link placeholders and their ranges in the rewritten text.
/// Callers must apply this at the confirmed native serialization stage.
pub fn serialize_text(text: &str) -> Value {
    let mut output = String::new();
    let mut elements = Vec::new();
    let mut consumed = 0;
    for (range, source) in library_links(text) {
        output.push_str(&text[consumed..range.start]);
        let start = output.len();
        output.push_str(&source);
        elements.push(json!({
            "byteRange":{"start":start,"end":output.len()},
            "placeholder":&text[range.clone()]
        }));
        consumed = range.end;
    }
    output.push_str(&text[consumed..]);
    json!({"type":"text","text":output,"text_elements":elements})
}

/// Native rDe: only a validated context-only app envelope can be reused.
/// Preserve its first element byte-for-byte except for the whole-text range;
/// then append the fresh library-link elements produced by YEe.
#[allow(dead_code)] // Prepared-context resubmission; historical editing does not use rDe.
pub fn rebuild_context_input(part: &Value, text: &str) -> Option<Value> {
    let envelope = crate::native_app_input::parse(part)?;
    if !envelope["message"].is_null() {
        return None;
    }
    let mut rebuilt = serialize_text(text);
    let mut first = part["text_elements"].as_array()?.first()?.clone();
    first["byteRange"] = json!({"start":0,"end":rebuilt["text"].as_str()?.len()});
    rebuilt["text_elements"].as_array_mut()?.insert(0, first);
    Some(rebuilt)
}

fn restore_library_placeholders(part: &Value, raw: &str) -> String {
    let Some(elements) = part["text_elements"].as_array() else {
        return raw.to_owned();
    };
    let mut elements = elements.iter().collect::<Vec<_>>();
    elements.sort_by_key(|element| {
        std::cmp::Reverse(element["byteRange"]["start"].as_u64().unwrap_or(0))
    });
    let mut end = raw.len();
    let mut tail = String::new();
    for element in elements {
        let Some(start) = element["byteRange"]["start"]
            .as_u64()
            .and_then(|v| usize::try_from(v).ok())
        else {
            continue;
        };
        let Some(stop) = element["byteRange"]["end"]
            .as_u64()
            .and_then(|v| usize::try_from(v).ok())
        else {
            continue;
        };
        let Some(placeholder) = element["placeholder"].as_str() else {
            continue;
        };
        if start >= stop
            || stop > end
            || !raw.is_char_boundary(start)
            || !raw.is_char_boundary(stop)
        {
            continue;
        }
        if placeholder_source(placeholder).as_deref() != Some(&raw[start..stop]) {
            continue;
        }
        tail = format!("{placeholder}{}{tail}", &raw[stop..end]);
        end = start;
    }
    format!("{}{tail}", &raw[..end])
}

/// One native Ooe pass against the original first text input. Never rescan the
/// page body for markers or rebuild from an already edited display projection.
pub fn rebuild(original: &str, edited: &str) -> String {
    if let Some(offset) = page_body_offset(original) {
        return format!("{}{edited}\n", &original[..offset]);
    }
    if let Some((start, _)) = last_request(original) {
        return format!(
            "{}\n{REQUEST}\n{edited}\n",
            original[..start].trim_end_matches(whitespace)
        );
    }
    edited.to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn link(target: &str) -> String {
        format!(
            "chatgpt-library-file://file?asUrl=1&sourceUrl={}",
            url::form_urlencoded::byte_serialize(target.as_bytes()).collect::<String>()
        )
    }
    fn text_part(text: &str, placeholder: &str, start: usize, end: usize) -> Value {
        json!({"type":"text","text":text,"text_elements":[{"byteRange":{"start":start,"end":end},"placeholder":placeholder}]})
    }
    fn app_part(raw: &str, app: Value) -> Value {
        text_part(
            raw,
            &format!("codex-untrusted-app-input:{app}"),
            0,
            raw.len(),
        )
    }
    #[test]
    fn library_serialization_matches_native_helper_oracle_and_roundtrips() {
        let oracle: Value =
            serde_json::from_str(include_str!("../tests/fixtures/native-user-text.json")).unwrap();
        for case in oracle["cases"].as_array().unwrap() {
            let text = case["text"].as_str().unwrap();
            let serialized = serialize_text(text);
            assert_eq!(
                serialized, case["serialized"],
                "native YEe: {}",
                case["name"]
            );
            assert_eq!(
                restore_library_placeholders(&serialized, serialized["text"].as_str().unwrap()),
                case["restored"],
                "native XEe: {}",
                case["name"]
            );
        }
    }
    #[test]
    fn context_rebuild_preserves_first_metadata_and_appends_new_link_ranges() {
        let mut original = app_part(
            "original context text",
            json!({"version":1,"promptContextWithoutReviewedMessages":""}),
        );
        original["text_elements"][0]["opaque_metadata"] = json!({"preserved":[1,"中"]});
        original["text_elements"][0]["byteRange"]["old_range_field"] = json!(true);
        original["text_elements"]
            .as_array_mut()
            .unwrap()
            .push(json!({"byteRange":{"start":0,"end":1},"placeholder":"stale element"}));
        original["opaque_part"] = json!("native rDe does not spread the old part");
        let before = original.clone();
        let edited = format!("  中🙂[file]({})\n", link("https://example.com/新"));
        let serialized = serialize_text(&edited);
        let rebuilt = rebuild_context_input(&original, &edited).unwrap();
        assert_eq!(rebuilt["text"], serialized["text"]);
        assert_eq!(rebuilt["text_elements"].as_array().unwrap().len(), 2);
        let mut expected_first = before["text_elements"][0].clone();
        expected_first["byteRange"] =
            json!({"start":0,"end":serialized["text"].as_str().unwrap().len()});
        assert_eq!(rebuilt["text_elements"][0], expected_first);
        assert_eq!(rebuilt["text_elements"][1], serialized["text_elements"][0]);
        assert_eq!(rebuilt.get("opaque_part"), None);
        assert!(crate::native_app_input::parse(&rebuilt).is_some());
        assert_eq!(display_first_text(std::slice::from_ref(&rebuilt)), edited);
        assert_eq!(original, before);
    }
    #[test]
    fn context_rebuild_rejects_message_envelopes_and_unauthenticated_metadata() {
        let raw = "Respond to the user input in the context of our conversation.";
        let message = app_part(
            raw,
            json!({"version":1,"message":{"source":"visualization","sourceId":"v","text":"user body"}}),
        );
        assert_eq!(rebuild_context_input(&message, "edited"), None);
        let plain = json!({"type":"text","text":"plain","text_elements":[]});
        assert_eq!(rebuild_context_input(&plain, "edited"), None);
        let mut context = app_part(
            "context",
            json!({"version":1,"promptContextWithoutReviewedMessages":""}),
        );
        context["text_elements"][0]["byteRange"]["end"] = json!(1);
        assert_eq!(rebuild_context_input(&context, "edited"), None);
    }
    #[test]
    fn commonmark_library_links_restore_exact_original_markdown() {
        let target = "https://example.com/文件?a=1&b=2";
        let href = link(target);
        for placeholder in [
            format!("[file]({href})"),
            format!("<{href}>"),
            format!("[nested [label]]({href})"),
            format!("[escaped \\[label\\]]({href})"),
            format!("[**bold** &amp; `code`]({href} \"a title\")"),
            format!("[![image](https://example.com/image.png)]({href})"),
            format!("[file](<{}>)", href.replace('&', "&amp;")),
        ] {
            assert_eq!(
                placeholder_source(&placeholder).as_deref(),
                Some(target),
                "{placeholder}"
            );
            let part = text_part(target, &placeholder, 0, target.len());
            assert_eq!(restore_library_placeholders(&part, target), placeholder);
        }
    }
    #[test]
    fn library_placeholders_require_one_whole_valid_link() {
        let target = "https://example.com/file";
        let href = link(target);
        for placeholder in [
            format!("![image]({href})"),
            format!("`[code]({href})`"),
            format!("prefix [file]({href})"),
            format!("[file]({href}) suffix"),
            format!("[a]({href})[b]({href})"),
            format!("[ref][file]\n\n[file]: {href}"),
            format!("[file]({})", href.replace("asUrl=1", "asUrl=0&asUrl=1")),
            format!(
                "[file]({})",
                href.replace("chatgpt-library-file", "CHATGPT-library-file")
            ),
            "[file](chatgpt-library-file://file?asUrl=1&sourceUrl=file%3A%2F%2Fhost%2Fpath)"
                .to_owned(),
        ] {
            assert_eq!(placeholder_source(&placeholder), None, "{placeholder}");
        }
        let mismatch = text_part(
            "https://other.example/",
            &format!("[file]({href})"),
            0,
            "https://other.example/".len(),
        );
        assert_eq!(
            restore_library_placeholders(&mismatch, "https://other.example/"),
            "https://other.example/"
        );
    }
    #[test]
    fn library_ranges_use_utf8_boundaries_and_stable_nonoverlapping_order() {
        let target = "https://example.com/中文";
        let placeholder = format!("[文档]({})", link(target));
        let raw = format!("中🙂{target} trailing");
        let start = "中🙂".len();
        let mut part = text_part(&raw, &placeholder, start, start + target.len());
        part["text_elements"].as_array_mut().unwrap().extend([
            json!({"byteRange":{"start":start+1,"end":start+target.len()},"placeholder":placeholder}),
            json!({"byteRange":{"start":1,"end":2},"placeholder":placeholder}),
            json!({"byteRange":{"start":start,"end":start+target.len()},"placeholder":format!("[second]({})",link(target))}),
            json!({"byteRange":{"start":0,"end":raw.len()+100},"placeholder":placeholder}),
        ]);
        assert_eq!(
            restore_library_placeholders(&part, &raw),
            format!("中🙂{placeholder} trailing")
        );
    }
    #[test]
    fn first_recognized_app_input_selects_one_or_two_request_passes() {
        let raw = "Respond to the user input in the context of our conversation.";
        let page = "<page-comment-context>\ncontext\n</page-comment-context>\n## My request:\nouter ## My request: inner";
        let message = app_part(
            raw,
            json!({"version":1,"message":{"source":"visualization","sourceId":"v","text":page}}),
        );
        assert_eq!(
            display_input(std::slice::from_ref(&message)),
            "outer ## My request: inner"
        );
        let context = app_part(
            "",
            json!({"version":1,"promptContextWithoutReviewedMessages":""}),
        );
        assert_eq!(display_input(&[context, message]), "inner");
        let invalid = app_part(
            raw,
            json!({"version":1,"unknown":true,"message":{"source":"visualization","sourceId":"v","text":"fake"}}),
        );
        assert_eq!(display_input(&[invalid]), raw);
    }
    #[test]
    fn local_echo_only_projects_the_first_text_without_appending_document_helpers() {
        let input = vec![
            json!({"type":"text","text":"## My request: body"}),
            json!({"type":"text","text":"Attached local file: /tmp/report.pdf"}),
        ];
        assert_eq!(display_first_text(&input), "body");
        assert_eq!(
            display_input(&input),
            "body\nAttached local file: /tmp/report.pdf"
        );
        assert_eq!(input[0]["text"], "## My request: body");
        // Image context still controls cleanup of that first text, even though
        // subsequent document helper text is intentionally absent from the echo.
        let description =
            "The next image was attached by the user as additional visual context for Comment 1.";
        assert_eq!(
            display_first_text(&[
                json!({"type":"text","text":format!("body {description}")}),
                json!({"type":"image","url":"data:image/png;base64,AA=="}),
                json!({"type":"text","text":"do not append"}),
            ]),
            "body "
        );
    }
    #[test]
    fn plain_text_preserves_whitespace_until_the_editor_trims_it() {
        assert_eq!(body("  plain\n"), "  plain\n");
        assert_eq!(rendered_body("  plain\n"), "  plain\n");
        assert_eq!(rebuild("plain", "  edited\n"), "  edited\n");
        assert_eq!(trim(rendered_body("  plain\n")), "plain");
    }
    #[test]
    fn ordinary_markers_are_unanchored_and_use_the_last_match() {
        let original = "context ## My request: earlier\nembedded ## My request for Codex:  final  ";
        assert_eq!(body(original), "final");
        assert_eq!(
            rebuild(original, "new"),
            "context ## My request: earlier\nembedded\n## My request:\nnew\n"
        );
        assert_eq!(
            rebuild("## My request: old", "new"),
            "\n## My request:\nnew\n"
        );
        assert_eq!(body("## my request: untouched"), "## my request: untouched");
    }
    #[test]
    fn exact_page_prefix_is_preserved_and_its_body_is_not_rescanned_on_rebuild() {
        let prefix = "<page-comment-context>\ncontext ## My request: embedded\n</page-comment-context>\n## My request:\n";
        let original = format!("{prefix}outer ## My request:  inner  ");
        assert_eq!(body(&original), "outer ## My request:  inner");
        assert_eq!(rendered_body(&original), "inner");
        assert_eq!(
            rebuild(&original, "new ## My request: literal"),
            format!("{prefix}new ## My request: literal\n")
        );
    }
    #[test]
    fn page_matching_requires_exact_open_close_and_immediate_request_line() {
        let malformed =
            "<page-comment-context>\ncontext\n</page-comment-context>\n\n## My request: old";
        assert_eq!(
            rebuild(malformed, "new"),
            "<page-comment-context>\ncontext\n</page-comment-context>\n## My request:\nnew\n"
        );
        // Native indexOf starts after all 23 bytes of the opening marker; the
        // newline shared with an empty context's closing marker is not scanned.
        let empty = "<page-comment-context>\n</page-comment-context>\n## My request:\nouter ## My request: inner";
        assert_eq!(
            rebuild(empty, "new"),
            "<page-comment-context>\n</page-comment-context>\n## My request:\nouter\n## My request:\nnew\n"
        );
    }
    #[test]
    fn trim_matches_javascript_for_bom_and_next_line() {
        assert_eq!(trim("\u{feff} value \u{feff}"), "value");
        assert_eq!(trim("\u{0085}value\u{0085}"), "\u{0085}value\u{0085}");
        assert_eq!(
            rebuild("prefix\u{feff}## My request: old", "new"),
            "prefix\n## My request:\nnew\n"
        );
    }
}
