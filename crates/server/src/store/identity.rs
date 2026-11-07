//! Conservative SQL identity for the known schema, plus parsed SQLite metadata.
//! This is not a general SQL equivalence parser: unfamiliar syntax is refused.
use anyhow::Result;
use rusqlite::{Connection, types::Value};
use std::collections::BTreeMap;

/// Preserve token boundaries; fold ASCII unquoted words only. In particular,
/// TEXT NOT NULL is three tokens, whereas TEXTNOTNULL is one type-name token.
/// Quoted strings/identifiers keep their delimiters, escapes, case and Unicode.
/// Only SQLite's ASCII whitespace is ignored; Unicode whitespace can be part
/// of an SQLite identifier and must never disappear from a comparison.
pub(super) fn tokens(sql: &str) -> Result<Vec<String>> {
    let mut chars = sql.chars().peekable();
    let mut result = Vec::new();
    while let Some(char) = chars.next() {
        if matches!(char, ' ' | '\t' | '\n' | '\r' | '\x0c') {
            continue;
        }
        if matches!((char, chars.peek()), ('-', Some('-')) | ('/', Some('*'))) {
            anyhow::bail!("Schema SQL comments are not part of a recognized historical layout");
        }
        let mut token = String::from(char);
        if matches!(char, '\'' | '"' | '`' | '[') {
            let end = if char == '[' { ']' } else { char };
            let mut closed = false;
            while let Some(next) = chars.next() {
                token.push(next);
                if next == end {
                    if end != ']' && chars.peek() == Some(&end) {
                        token.push(chars.next().unwrap());
                    } else {
                        closed = true;
                        break;
                    }
                }
            }
            anyhow::ensure!(closed, "Unterminated quoted schema token");
        } else if char.is_ascii_alphanumeric() || char == '_' || !char.is_ascii() {
            while chars.peek().is_some_and(|next| {
                next.is_ascii_alphanumeric() || matches!(next, '_' | '$') || !next.is_ascii()
            }) {
                token.push(chars.next().unwrap());
            }
            token.make_ascii_lowercase();
        }
        result.push(token);
    }
    // SQLite normally omits the terminal semicolon from sqlite_schema.sql.
    // A semicolon anywhere else remains a token; none are stripped in quotes.
    if result.last().is_some_and(|last| last == ";") {
        result.pop();
    }
    Ok(result)
}

fn rows(db: &Connection, sql: &str, name: &str) -> Result<Vec<Vec<Value>>> {
    let mut query = db.prepare(sql)?;
    let count = query.column_count();
    Ok(query
        .query_map([name], |row| (0..count).map(|col| row.get(col)).collect())?
        .collect::<rusqlite::Result<_>>()?)
}

pub(super) fn validate_structure(
    db: &Connection,
    reference: &Connection,
    found: &BTreeMap<String, (String, String)>,
) -> Result<()> {
    for (name, (kind, _)) in found {
        let checks: &[&str] = match kind.as_str() {
            "table" => &[
                "SELECT cid,lower(name),upper(type),\"notnull\",dflt_value,pk,hidden FROM pragma_table_xinfo(?1) ORDER BY cid",
                "SELECT id,seq,lower(\"table\"),lower(\"from\"),lower(\"to\"),upper(on_update),upper(on_delete),upper(\"match\") FROM pragma_foreign_key_list(?1) ORDER BY id,seq",
            ],
            "index" => &[
                "SELECT seqno,cid,lower(name),\"desc\",upper(coll),\"key\" FROM pragma_index_xinfo(?1) ORDER BY seqno",
            ],
            _ => anyhow::bail!("Unrecognized schema object kind"),
        };
        for sql in checks {
            anyhow::ensure!(
                rows(db, sql, name)? == rows(reference, sql, name)?,
                "Malformed AnyWork schema object {name}; parsed columns, keys, defaults or foreign keys differ"
            );
        }
        if kind == "table" {
            let sql =
                "SELECT name,\"unique\",origin,partial FROM pragma_index_list(?1) ORDER BY name";
            let mut expected = rows(reference, sql, name)?;
            // Only the explicitly recognized historical replay indexes may be
            // absent before their transactional additive completion.
            expected.retain(|row| {
                !matches!(&row[0], Value::Text(index) if matches!(index.as_str(), "harness_replay_identity" | "source_replay_identity") && !found.contains_key(index))
            });
            anyhow::ensure!(
                rows(db, sql, name)? == expected,
                "Malformed AnyWork schema table {name}; parsed unique/primary index declarations differ"
            );
        }
    }
    Ok(())
}
