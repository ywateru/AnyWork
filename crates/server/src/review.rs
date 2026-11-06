//! Read-only review comparisons. Turn patches and Git comparisons have distinct sources.
use crate::{ApiError, App};
use anyhow::{Context, Result, ensure};
use axum::{
    Json,
    extract::{Path, Query, State},
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{path::Path as FsPath, process::Stdio, sync::Arc, time::Duration};
use tokio::{io::AsyncReadExt, process::Command};

const LIMIT: usize = 8 * 1024 * 1024;
#[derive(Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Source {
    Branch,
    Uncommitted,
    Unstaged,
    Staged,
    Commit,
    LastTurn,
}
impl Source {
    fn name(&self) -> &'static str {
        match self {
            Self::Branch => "branch",
            Self::Uncommitted => "uncommitted",
            Self::Unstaged => "unstaged",
            Self::Staged => "staged",
            Self::Commit => "commit",
            Self::LastTurn => "last-turn",
        }
    }
}
#[derive(Deserialize)]
pub struct ReviewQuery {
    source: Option<Source>,
    base_branch: Option<String>,
    commit: Option<String>,
    #[serde(default)]
    hide_whitespace: bool,
}

struct GitOutput {
    ok: bool,
    stdout: Vec<u8>,
    stderr: String,
}
async fn git(cwd: &FsPath, args: &[&str]) -> Result<GitOutput> {
    git_limited(cwd, args, LIMIT).await
}
async fn git_limited(cwd: &FsPath, args: &[&str], limit: usize) -> Result<GitOutput> {
    let mut child = Command::new("git")
        .args(["-c", "core.quotePath=false", "-c", "color.ui=false"])
        .args(args)
        .current_dir(cwd)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_PAGER", "cat")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()?;
    async fn read(stream: impl tokio::io::AsyncRead + Unpin, limit: usize) -> Result<Vec<u8>> {
        let mut data = vec![];
        stream.take(limit as u64 + 1).read_to_end(&mut data).await?;
        ensure!(data.len() <= limit, "Review output exceeds the size limit");
        Ok(data)
    }
    tokio::time::timeout(Duration::from_secs(15), async {
        let (stdout, stderr) = tokio::try_join!(
            read(child.stdout.take().context("Missing Git output")?, limit),
            read(
                child.stderr.take().context("Missing Git error output")?,
                64 * 1024
            )
        )?;
        let status = child.wait().await?;
        Ok(GitOutput {
            ok: status.success(),
            stdout,
            stderr: String::from_utf8_lossy(&stderr).trim().to_string(),
        })
    })
    .await
    .context("Review request timed out")?
}
async fn text(cwd: &FsPath, args: &[&str]) -> Result<String> {
    let out = git(cwd, args).await?;
    ensure!(out.ok, "{}", out.stderr);
    Ok(String::from_utf8(out.stdout)?.trim().to_string())
}
fn expected(mut context: Value, reason: &str) -> Json<Value> {
    context["type"] = json!("expected");
    context["reason"] = json!(reason);
    Json(context)
}
async fn default_branch(root: &FsPath) -> Result<Option<String>> {
    let mut remotes: Vec<String> = text(root, &["remote"])
        .await?
        .lines()
        .map(str::to_owned)
        .collect();
    if let Some(i) = remotes.iter().position(|r| r == "origin") {
        let remote = remotes.remove(i);
        remotes.insert(0, remote);
    }
    for remote in remotes {
        // Read cached remote HEAD only: opening a panel never contacts a Git host.
        let head = git(
            root,
            &[
                "symbolic-ref",
                "--quiet",
                &format!("refs/remotes/{remote}/HEAD"),
            ],
        )
        .await?;
        if head.ok {
            return Ok(Some(
                String::from_utf8(head.stdout)?
                    .trim()
                    .trim_start_matches("refs/remotes/")
                    .to_string(),
            ));
        }
        for branch in ["main", "master"] {
            let reference = format!("refs/remotes/{remote}/{branch}");
            if git(root, &["show-ref", "--verify", "--quiet", &reference])
                .await?
                .ok
            {
                return Ok(Some(format!("{remote}/{branch}")));
            }
        }
    }
    Ok(None)
}

pub async fn read(
    State(app): State<Arc<App>>,
    Path(id): Path<String>,
    Query(q): Query<ReviewQuery>,
) -> Result<Json<Value>, ApiError> {
    Ok(build(&app, id, q).await?)
}
async fn build(app: &App, id: String, q: ReviewQuery) -> Result<Json<Value>> {
    let session = app.session(&id)?;
    let source = q.source.unwrap_or(Source::Branch);
    if matches!(source, Source::LastTurn) {
        let (turn_id, diff) = app.store.last_turn_diff(&id)?;
        return Ok(Json(
            json!({"type":"success", "source":"last-turn", "turn_id":turn_id, "diff":diff, "root":session.cwd, "branches":[]}),
        ));
    }
    let mut context = json!({"source":source.name(),"diff":null,"branches":[]});
    let Some(root) = repository(app, &session, &mut context).await? else {
        return Ok(expected(context, "not-a-repository"));
    };
    let mut comparison: Vec<String> = vec![];
    match source {
        Source::Branch => {
            let Some(merge) = branch_merge_base(&root, q.base_branch, &mut context).await? else {
                let reason = context["reason"].as_str().unwrap().to_string();
                return Ok(expected(context, &reason));
            };
            comparison.push(merge);
        }
        Source::Commit => {
            let sha = q.commit.context("Select a commit to review")?;
            ensure!(
                (7..=64).contains(&sha.len()) && sha.bytes().all(|b| b.is_ascii_hexdigit()),
                "Invalid commit SHA"
            );
            let sha = text(
                &root,
                &[
                    "rev-parse",
                    "--verify",
                    "--end-of-options",
                    &format!("{sha}^{{commit}}"),
                ],
            )
            .await?;
            let parent = git(
                &root,
                &["rev-parse", "--verify", "--quiet", &format!("{sha}^")],
            )
            .await?;
            comparison.push(if parent.ok {
                String::from_utf8(parent.stdout)?.trim().to_string()
            } else {
                text(&root, &["hash-object", "-t", "tree", "--stdin"]).await?
            });
            context["commit"] = json!(sha);
            comparison.push(sha);
        }
        Source::Uncommitted => {
            if git(&root, &["rev-parse", "--verify", "--quiet", "HEAD"])
                .await?
                .ok
            {
                comparison.push("HEAD".into());
            } else {
                comparison.push(text(&root, &["hash-object", "-t", "tree", "--stdin"]).await?);
            }
        }
        Source::Staged => comparison.push("--cached".into()),
        Source::Unstaged => {}
        Source::LastTurn => unreachable!(),
    }
    let mut args = vec![
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--no-color",
        "--find-renames",
        "--full-index",
    ];
    if q.hide_whitespace {
        args.push("--ignore-all-space");
    }
    args.extend(comparison.iter().map(String::as_str));
    args.push("--");
    let out = git(&root, &args).await?;
    ensure!(out.ok, "{}", out.stderr);
    let mut diff = out.stdout;
    if matches!(
        source,
        Source::Branch | Source::Uncommitted | Source::Unstaged
    ) {
        let out = git(&root, &["ls-files", "--others", "--exclude-standard", "-z"]).await?;
        ensure!(out.ok, "{}", out.stderr);
        let paths: Vec<&[u8]> = out
            .stdout
            .split(|c| *c == 0)
            .filter(|p| !p.is_empty())
            .collect();
        let mut omitted = paths.len().saturating_sub(500);
        for raw in paths.iter().take(500) {
            let path = std::str::from_utf8(raw).context("Unsupported Git filename encoding")?;
            // Embedded repositories are returned as directory entries, not file patches.
            // Never pass a directory to diff --no-index against /dev/null.
            if tokio::fs::symlink_metadata(root.join(path.trim_end_matches('/')))
                .await?
                .is_dir()
            {
                omitted += 1;
                continue;
            }
            let mut args = vec![
                "diff",
                "--no-index",
                "--no-ext-diff",
                "--no-textconv",
                "--no-color",
                "--full-index",
            ];
            if q.hide_whitespace {
                args.push("--ignore-all-space");
            }
            args.extend(["--", "/dev/null", path]);
            let out = git(&root, &args).await?;
            // diff --no-index exits 1 when a difference is present.
            ensure!(
                out.ok || !out.stdout.is_empty() && out.stderr.is_empty(),
                "{}",
                out.stderr
            );
            ensure!(
                diff.len() + out.stdout.len() <= LIMIT,
                "Review output exceeds the size limit"
            );
            diff.extend(out.stdout);
        }
        context["untracked_files_omitted"] = json!(omitted);
    }
    context["type"] = json!("success");
    context["diff"] = json!(String::from_utf8(diff)?);
    Ok(Json(context))
}

async fn repository(
    app: &App,
    session: &crate::store::Session,
    context: &mut Value,
) -> Result<Option<std::path::PathBuf>> {
    let cwd = FsPath::new(&session.cwd);
    let root = git(cwd, &["rev-parse", "--show-toplevel"]).await?;
    if !root.ok {
        return Ok(None);
    }
    let root = String::from_utf8(root.stdout)?.trim().to_string();
    let root = if session.external && app.codex_scope == crate::CodexScope::All {
        let root = FsPath::new(&root).canonicalize()?;
        crate::files::within(&root, cwd)?;
        root
    } else {
        // Restricted deployments must not expose repositories above their root.
        crate::files::within(&app.workspace, FsPath::new(&root))?
    };
    context["root"] = json!(root);
    let branch = git(&root, &["symbolic-ref", "--quiet", "--short", "HEAD"]).await?;
    context["current_branch"] = if branch.ok {
        json!(String::from_utf8(branch.stdout)?.trim())
    } else {
        Value::Null
    };
    let refs = text(
        &root,
        &[
            "for-each-ref",
            "--format=%(refname:short)",
            "refs/heads",
            "refs/remotes",
        ],
    )
    .await?;
    context["branches"] = json!(
        refs.lines()
            .filter(|r| !r.ends_with("/HEAD"))
            .collect::<Vec<_>>()
    );
    Ok(Some(root))
}

// Share the same merge base for branch review and its commit submenu.
async fn branch_merge_base(
    root: &FsPath,
    base: Option<String>,
    context: &mut Value,
) -> Result<Option<String>> {
    let base = if let Some(base) = base {
        ensure!(
            !base.is_empty()
                && base.len() <= 512
                && !base.starts_with('-')
                && !base.chars().any(char::is_control),
            "Invalid base branch"
        );
        Some(base)
    } else {
        default_branch(root).await?
    };
    let Some(base) = base else {
        context["reason"] = json!("default-branch-unavailable");
        return Ok(None);
    };
    context["base_branch"] = json!(base);
    let resolved = git(
        root,
        &[
            "rev-parse",
            "--verify",
            "--end-of-options",
            &format!("{base}^{{commit}}"),
        ],
    )
    .await?;
    if resolved.ok {
        let resolved = String::from_utf8(resolved.stdout)?.trim().to_string();
        let merge = git(root, &["merge-base", "HEAD", &resolved]).await?;
        if merge.ok {
            return Ok(Some(String::from_utf8(merge.stdout)?.trim().to_string()));
        }
    }
    context["reason"] = json!("merge-base-unavailable");
    Ok(None)
}

#[derive(Deserialize)]
pub struct CommitsQuery {
    base_branch: Option<String>,
}
pub async fn commits(
    State(app): State<Arc<App>>,
    Path(id): Path<String>,
    Query(q): Query<CommitsQuery>,
) -> Result<Json<Value>, ApiError> {
    Ok(branch_commits(&app, id, q).await?)
}
async fn branch_commits(app: &App, id: String, q: CommitsQuery) -> Result<Json<Value>> {
    let session = app.session(&id)?;
    let mut context = json!({"commits":[],"branches":[]});
    let Some(root) = repository(app, &session, &mut context).await? else {
        return Ok(expected(context, "not-a-repository"));
    };
    let Some(merge) = branch_merge_base(&root, q.base_branch, &mut context).await? else {
        let reason = context["reason"].as_str().unwrap().to_string();
        return Ok(expected(context, &reason));
    };
    // Branch-relative, bounded, read-only history. Never fall back to all history.
    let out = git_limited(
        &root,
        &[
            "log",
            "--max-count=100",
            "--format=%H%x00%cI%x00%s%x00%B%x1e",
            &format!("{merge}..HEAD"),
            "--",
        ],
        2 * 1024 * 1024,
    )
    .await?;
    ensure!(out.ok, "{}", out.stderr);
    let output = String::from_utf8(out.stdout)?;
    let commits: Vec<Value> = output
        .split('\x1e')
        .filter_map(|record| {
            let mut fields = record.trim().splitn(4, '\0');
            let sha = fields.next()?;
            let committed_at = fields.next()?;
            let subject = fields.next()?;
            let message = fields.next()?;
            if sha.is_empty() || committed_at.is_empty() {
                return None;
            }
            Some(json!({"sha":sha,"committed_at":committed_at,"subject":subject,"message":message}))
        })
        .collect();
    context["type"] = json!("success");
    context["commits"] = json!(commits);
    Ok(Json(context))
}
