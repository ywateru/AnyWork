//! Native file-backed goal objectives. Only the current goal's exact wrapper is
//! interpreted, and it can resolve only to Codex's UUID attachment directory.
use anyhow::{Context, Result, ensure};
use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};
use uuid::Uuid;

const PREFIX: &str = "Read the Codex goal objective file at ";
const SUFFIX: &str = " before continuing.";
const FILENAME: &str = "goal-objective.md";
const INLINE_CHARACTERS: usize = 4000;
// The HTTP request limit is 22 MiB; leave room for its JSON envelope.
const MAX_BYTES: usize = 20 * 1024 * 1024;

pub struct Materialized {
    pub objective: String,
    directory: Option<PathBuf>,
}

impl Materialized {
    /// Discard a rejected editor save before a message could reference it. Never
    /// discard after an accepted or unconfirmed send; older goals stay intact.
    pub fn discard(self) {
        if let Some(directory) = self.directory {
            let _ = fs::remove_dir_all(directory);
        }
    }
}

fn uuid_directory(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 36
        && bytes.iter().enumerate().all(|(index, byte)| {
            if [8, 13, 18, 23].contains(&index) {
                *byte == b'-'
            } else {
                byte.is_ascii_digit() || (b'a'..=b'f').contains(byte)
            }
        })
        && (b'1'..=b'8').contains(&bytes[14])
        && b"89ab".contains(&bytes[19])
}

fn regular_directory(path: &Path) -> Result<()> {
    let metadata = fs::symlink_metadata(path)?;
    ensure!(
        metadata.is_dir() && !metadata.file_type().is_symlink(),
        "目标附件目录无效"
    );
    Ok(())
}

fn attachment_root(home: &Path, create: bool) -> Result<PathBuf> {
    if create {
        fs::create_dir_all(home)?;
    }
    let home = home.canonicalize().context("无法读取 Codex 目标目录")?;
    let root = home.join("attachments");
    if create && !root.exists() {
        fs::create_dir(&root)?;
    }
    regular_directory(&root)?;
    ensure!(root.canonicalize()? == root, "目标附件目录超出 Codex 目录");
    Ok(root)
}

pub fn materialize(home: &Path, objective: &str) -> Result<Materialized> {
    materialize_message(home, objective, &[])
}

/// Goal creation uses the normal message attachments, while durable goal state
/// must retain their references after the first turn. Native cxi copies images.
pub fn materialize_message(
    home: &Path,
    objective: &str,
    attachments: &[PathBuf],
) -> Result<Materialized> {
    let mut objective = objective.trim().to_owned();
    ensure!(
        !objective.is_empty() || !attachments.is_empty(),
        "目标不能为空"
    );
    ensure!(objective.len() <= MAX_BYTES, "目标不能超过 20 MiB");
    if attachments.is_empty() && objective.chars().count() <= INLINE_CHARACTERS {
        return Ok(Materialized {
            objective,
            directory: None,
        });
    }
    let root = attachment_root(home, true)?;
    let directory = root.join(Uuid::new_v4().to_string());
    let mut builder = fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(&directory)?;
    let mut materialized = Materialized {
        objective: String::new(),
        directory: Some(directory.clone()),
    };
    let write = (|| -> Result<()> {
        let mut images = Vec::new();
        let mut files = Vec::new();
        for source in attachments {
            let extension = source
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            if ["png", "jpg", "jpeg", "webp", "gif"].contains(&extension.as_str()) {
                let metadata = fs::symlink_metadata(source)?;
                ensure!(
                    metadata.is_file() && !metadata.file_type().is_symlink(),
                    "目标图片文件无效"
                );
                ensure!(metadata.len() <= MAX_BYTES as u64, "目标图片超过 20 MiB");
                let position = images.len() + 1;
                let target = directory.join(format!("image-{position}.{extension}"));
                let mut input = fs::File::open(source)?;
                let mut options = OpenOptions::new();
                options.write(true).create_new(true);
                #[cfg(unix)]
                {
                    use std::os::unix::fs::OpenOptionsExt;
                    options.mode(0o600);
                }
                let mut output = options.open(&target)?;
                let copied = std::io::copy(
                    &mut std::io::Read::by_ref(&mut input).take(MAX_BYTES as u64 + 1),
                    &mut output,
                )?;
                ensure!(copied <= MAX_BYTES as u64, "目标图片超过 20 MiB");
                output.sync_all()?;
                images.push(format!("- [Image #{position}]: {}", target.display()));
            } else {
                files.push(format!(
                    "- [File #{}]: {}",
                    files.len() + 1,
                    source.display()
                ));
            }
        }
        for (heading, references) in [
            ("Referenced image files:", images),
            ("Referenced files:", files),
        ] {
            if !references.is_empty() {
                if !objective.is_empty() {
                    objective.push_str("\n\n");
                }
                objective.push_str(heading);
                objective.push('\n');
                objective.push_str(&references.join("\n"));
            }
        }
        ensure!(objective.len() <= MAX_BYTES, "目标不能超过 20 MiB");
        if objective.chars().count() <= INLINE_CHARACTERS {
            materialized.objective = objective.clone();
            return Ok(());
        }
        let path = directory.join(FILENAME);
        let wrapped = format!(
            "{PREFIX}{}{SUFFIX}",
            path.to_str().context("目标目录不是有效的 UTF-8 路径")?
        );
        ensure!(
            wrapped.chars().count() <= INLINE_CHARACTERS,
            "目标文件引用超过 4000 字"
        );
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(path)?;
        file.write_all(objective.as_bytes())?;
        file.sync_all()?;
        materialized.objective = wrapped;
        Ok(())
    })();
    if let Err(error) = write {
        materialized.discard();
        return Err(error);
    }
    Ok(materialized)
}

pub fn resolve(home: &Path, objective: &str) -> Result<String> {
    let Some(path) = objective
        .strip_prefix(PREFIX)
        .and_then(|value| value.strip_suffix(SUFFIX))
    else {
        return Ok(objective.to_owned());
    };
    let raw_path = path;
    let path = Path::new(path);
    // Nonmatching strings stay literal, as in the native fxi/dxi loader.
    let Some(directory) = path.parent() else {
        return Ok(objective.to_owned());
    };
    let Some(id) = directory.file_name().and_then(|name| name.to_str()) else {
        return Ok(objective.to_owned());
    };
    if !uuid_directory(id)
        || Some(raw_path) != home.join("attachments").join(id).join(FILENAME).to_str()
    {
        // Canonical HOME aliases are also emitted by this module itself.
        let canonical = home.canonicalize().ok();
        if !uuid_directory(id)
            || canonical.as_ref().is_none_or(|home| {
                Some(raw_path) != home.join("attachments").join(id).join(FILENAME).to_str()
            })
        {
            return Ok(objective.to_owned());
        }
    }
    let root = attachment_root(home, false)?;
    let expected = root.join(id).join(FILENAME);
    regular_directory(&root.join(id))?;
    let metadata = fs::symlink_metadata(&expected)?;
    ensure!(
        metadata.is_file() && !metadata.file_type().is_symlink(),
        "目标文件无效"
    );
    ensure!(
        expected.canonicalize()? == expected,
        "目标文件超出 Codex 目录"
    );
    ensure!(metadata.len() <= MAX_BYTES as u64, "目标文件超过 20 MiB");
    let file = fs::File::open(expected)?;
    let mut contents = String::new();
    file.take(MAX_BYTES as u64 + 1)
        .read_to_string(&mut contents)?;
    ensure!(contents.len() <= MAX_BYTES, "目标文件超过 20 MiB");
    Ok(contents)
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("anywork-goal-{}", Uuid::new_v4()));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn native_threshold_counts_unicode_scalars_and_keeps_small_goals_inline() {
        let fixture = Fixture::new();
        let text = "😀".repeat(4000);
        assert_eq!(
            materialize(&fixture.0, &format!("  {text}\n"))
                .unwrap()
                .objective,
            text
        );
        assert!(!fixture.0.join("attachments").exists());
        let text = format!("{text}中");
        let saved = materialize(&fixture.0, &text).unwrap();
        assert!(saved.objective.starts_with(PREFIX));
        assert_eq!(resolve(&fixture.0, &saved.objective).unwrap(), text);
        let directory = saved.directory.clone().unwrap();
        saved.discard();
        assert!(!directory.exists());
    }

    #[test]
    fn image_only_goal_copies_durable_images_and_cleanup_removes_only_owned_copy() {
        let fixture = Fixture::new();
        let source = fixture.0.join("upload.PNG");
        fs::write(&source, b"fixture-image").unwrap();
        let saved = materialize_message(&fixture.0, "", std::slice::from_ref(&source)).unwrap();
        let directory = saved.directory.clone().unwrap();
        let copied = directory.join("image-1.png");
        assert_eq!(fs::read(&copied).unwrap(), b"fixture-image");
        assert_eq!(
            saved.objective,
            format!(
                "Referenced image files:\n- [Image #1]: {}",
                copied.display()
            )
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&directory).unwrap().permissions().mode() & 0o777,
                0o700
            );
            assert_eq!(
                fs::metadata(&copied).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        saved.discard();
        assert!(!directory.exists());
        assert!(source.exists());
    }

    #[test]
    fn long_goal_file_keeps_image_and_generic_file_references() {
        let fixture = Fixture::new();
        let image = fixture.0.join("image.webp");
        let document = fixture.0.join("notes.md");
        fs::write(&image, b"fixture-image").unwrap();
        fs::write(&document, "fixture-document").unwrap();
        let saved = materialize_message(&fixture.0, &"字".repeat(4001), &[document.clone(), image])
            .unwrap();
        let text = resolve(&fixture.0, &saved.objective).unwrap();
        assert!(text.starts_with(&"字".repeat(4001)));
        assert!(text.contains("[Image #1]:"));
        assert!(text.contains(&format!("[File #1]: {}", document.display())));
        assert!(
            saved
                .directory
                .as_ref()
                .unwrap()
                .join("image-1.webp")
                .exists()
        );
    }

    #[test]
    fn invalid_or_oversized_images_leave_no_materialized_directory() {
        let fixture = Fixture::new();
        let image = fixture.0.join("image.png");
        fs::File::create(&image)
            .unwrap()
            .set_len(MAX_BYTES as u64 + 1)
            .unwrap();
        assert!(materialize_message(&fixture.0, "goal", std::slice::from_ref(&image)).is_err());
        assert_eq!(
            fs::read_dir(fixture.0.join("attachments")).unwrap().count(),
            0
        );
        fs::remove_file(&image).unwrap();
        fs::create_dir(&image).unwrap();
        assert!(materialize_message(&fixture.0, "goal", &[image]).is_err());
        assert_eq!(
            fs::read_dir(fixture.0.join("attachments")).unwrap().count(),
            0
        );
    }

    #[cfg(unix)]
    #[test]
    fn goal_image_symlink_is_rejected() {
        use std::os::unix::fs::symlink;
        let fixture = Fixture::new();
        let source = fixture.0.join("image-source");
        fs::write(&source, b"fixture-image").unwrap();
        let linked = fixture.0.join("image.png");
        symlink(source, &linked).unwrap();
        assert!(materialize_message(&fixture.0, "goal", &[linked]).is_err());
        assert_eq!(
            fs::read_dir(fixture.0.join("attachments")).unwrap().count(),
            0
        );
    }

    #[test]
    fn only_exact_native_wrappers_in_codex_uuid_directories_are_read() {
        let fixture = Fixture::new();
        let secret = fixture.0.join("private.txt");
        fs::write(&secret, "must stay private").unwrap();
        let cases = [
            format!("{PREFIX}{}{SUFFIX}", secret.display()),
            format!(
                "{PREFIX}{}/attachments/../private.txt{SUFFIX}",
                fixture.0.display()
            ),
            format!(
                "{PREFIX}{}/attachments/not-a-uuid/{FILENAME}{SUFFIX}",
                fixture.0.display()
            ),
            format!(" {PREFIX}{}{SUFFIX}", secret.display()),
            format!("{PREFIX}{}{SUFFIX}\n", secret.display()),
        ];
        for value in cases {
            assert_eq!(resolve(&fixture.0, &value).unwrap(), value);
        }
        let saved = materialize(&fixture.0, &"字".repeat(4001)).unwrap();
        fs::remove_file(saved.directory.as_ref().unwrap().join(FILENAME)).unwrap();
        assert!(resolve(&fixture.0, &saved.objective).is_err());
    }

    #[test]
    fn failed_replacement_cleanup_keeps_accepted_goal() {
        let fixture = Fixture::new();
        let first = materialize(&fixture.0, &"原".repeat(4001)).unwrap();
        let replacement = materialize(&fixture.0, &"新".repeat(4001)).unwrap();
        replacement.discard();
        assert_eq!(
            resolve(&fixture.0, &first.objective).unwrap(),
            "原".repeat(4001)
        );
    }

    #[cfg(unix)]
    #[test]
    fn attachment_and_file_symlinks_cannot_escape_the_owned_directory() {
        use std::os::unix::fs::symlink;
        let fixture = Fixture::new();
        let outside = Fixture::new();
        symlink(&outside.0, fixture.0.join("attachments")).unwrap();
        assert!(materialize(&fixture.0, &"x".repeat(4001)).is_err());
        fs::remove_file(fixture.0.join("attachments")).unwrap();
        let saved = materialize(&fixture.0, &"x".repeat(4001)).unwrap();
        let path = saved.directory.as_ref().unwrap().join(FILENAME);
        fs::remove_file(&path).unwrap();
        let private = outside.0.join("private.txt");
        fs::write(&private, "private").unwrap();
        symlink(private, path).unwrap();
        assert!(resolve(&fixture.0, &saved.objective).is_err());
    }
}
