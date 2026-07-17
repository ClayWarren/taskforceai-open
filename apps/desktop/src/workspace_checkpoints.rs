use std::{
    fs,
    path::{Component, Path, PathBuf},
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

const CHECKPOINTS_DIR: &str = "workspace-checkpoints";
const MAX_CHECKPOINTS_PER_CONVERSATION: usize = 50;

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceCheckpointMetadata {
    conversation_id: String,
    captured_at: u64,
    workspace: String,
    head: String,
    untracked_paths: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceCheckpointResult {
    pub supported: bool,
    pub conversation_id: String,
    pub captured_at: u64,
    pub workspace: String,
    pub message: String,
}

pub fn capture(
    app_data_dir: &Path,
    workspace: &Path,
    conversation_id: &str,
) -> Result<WorkspaceCheckpointResult, String> {
    let conversation_id = normalized_conversation_id(conversation_id)?;
    let workspace = workspace
        .canonicalize()
        .map_err(|error| format!("Failed to resolve checkpoint workspace: {error}"))?;
    let root = match repository_root(&workspace) {
        Ok(root) => root,
        Err(_) => {
            return Ok(WorkspaceCheckpointResult {
                supported: false,
                conversation_id,
                captured_at: unix_millis_now(),
                workspace: workspace.display().to_string(),
                message: "Workspace checkpoints require a Git repository.".to_string(),
            });
        }
    };
    let captured_at = unix_millis_now();
    let conversation_dir = checkpoint_conversation_dir(app_data_dir, &conversation_id);
    let checkpoint_dir = conversation_dir.join(captured_at.to_string());
    write_checkpoint(&root, &checkpoint_dir, &conversation_id, captured_at)?;
    prune_old_checkpoints(&conversation_dir)?;

    Ok(WorkspaceCheckpointResult {
        supported: true,
        conversation_id,
        captured_at,
        workspace: root.display().to_string(),
        message: "Workspace checkpoint captured.".to_string(),
    })
}

pub fn restore(
    app_data_dir: &Path,
    conversation_id: &str,
    before_timestamp: u64,
) -> Result<WorkspaceCheckpointResult, String> {
    let conversation_id = normalized_conversation_id(conversation_id)?;
    let conversation_dir = checkpoint_conversation_dir(app_data_dir, &conversation_id);
    let checkpoint_dir = matching_checkpoint(&conversation_dir, before_timestamp)?
        .ok_or_else(|| "No workspace checkpoint exists for this turn.".to_string())?;
    let metadata = read_checkpoint_metadata(&checkpoint_dir)?;
    if metadata.conversation_id != conversation_id {
        return Err("Workspace checkpoint conversation does not match.".to_string());
    }
    let root = PathBuf::from(&metadata.workspace)
        .canonicalize()
        .map_err(|error| format!("Failed to resolve checkpoint workspace: {error}"))?;
    if repository_root(&root)? != root {
        return Err("Workspace checkpoint repository no longer matches.".to_string());
    }

    let recovery_dir = conversation_dir.join(format!(
        ".recovery-{}-{}-{}",
        metadata.captured_at,
        unix_millis_now(),
        std::process::id()
    ));
    let recovery = write_checkpoint(&root, &recovery_dir, &conversation_id, unix_millis_now())?;
    apply_with_recovery(
        || apply_checkpoint(&root, &checkpoint_dir, &metadata),
        || apply_checkpoint(&root, &recovery_dir, &recovery),
        &recovery_dir,
    )?;

    Ok(WorkspaceCheckpointResult {
        supported: true,
        conversation_id,
        captured_at: metadata.captured_at,
        workspace: metadata.workspace,
        message: "Workspace restored to the selected turn.".to_string(),
    })
}

fn write_checkpoint(
    root: &Path,
    checkpoint_dir: &Path,
    conversation_id: &str,
    captured_at: u64,
) -> Result<WorkspaceCheckpointMetadata, String> {
    fs::create_dir_all(checkpoint_dir.join("files"))
        .map_err(|error| format!("Failed to create workspace checkpoint: {error}"))?;
    let head = git_text(root, &["rev-parse", "HEAD"])?;
    let patch = git_checked_output(root, &["diff", "--binary", "HEAD"])?;
    fs::write(checkpoint_dir.join("changes.patch"), patch.stdout)
        .map_err(|error| format!("Failed to save workspace checkpoint patch: {error}"))?;

    let untracked_output =
        git_checked_output(root, &["ls-files", "--others", "--exclude-standard", "-z"])?;
    let mut untracked_paths = Vec::new();
    for bytes in untracked_output.stdout.split(|byte| *byte == 0) {
        if bytes.is_empty() {
            continue;
        }
        let relative = String::from_utf8(bytes.to_vec())
            .map_err(|_| "An untracked workspace path is not valid UTF-8.".to_string())?;
        let relative_path = safe_relative_path(&relative)?;
        let source = root.join(&relative_path);
        if !source.is_file() {
            continue;
        }
        let destination = checkpoint_dir.join("files").join(&relative_path);
        let parent = destination.parent().expect("checkpoint file has a parent");
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to save untracked file: {error}"))?;
        fs::copy(&source, &destination)
            .map_err(|error| format!("Failed to save untracked file {relative}: {error}"))?;
        untracked_paths.push(relative);
    }

    let metadata = WorkspaceCheckpointMetadata {
        conversation_id: conversation_id.to_string(),
        captured_at,
        workspace: root.display().to_string(),
        head,
        untracked_paths,
    };
    fs::write(
        checkpoint_dir.join("metadata.json"),
        serde_json::to_vec_pretty(&metadata)
            .map_err(|error| format!("Failed to serialize workspace checkpoint: {error}"))?,
    )
    .map_err(|error| format!("Failed to save workspace checkpoint metadata: {error}"))?;
    Ok(metadata)
}

fn read_checkpoint_metadata(checkpoint_dir: &Path) -> Result<WorkspaceCheckpointMetadata, String> {
    serde_json::from_slice(
        &fs::read(checkpoint_dir.join("metadata.json"))
            .map_err(|error| format!("Failed to read workspace checkpoint metadata: {error}"))?,
    )
    .map_err(|error| format!("Failed to parse workspace checkpoint metadata: {error}"))
}

fn apply_checkpoint(
    root: &Path,
    checkpoint_dir: &Path,
    metadata: &WorkspaceCheckpointMetadata,
) -> Result<(), String> {
    git_success(root, &["reset", "--hard", &metadata.head])?;
    git_success(root, &["clean", "-fd"])?;
    let patch_path = checkpoint_dir.join("changes.patch");
    if fs::metadata(&patch_path)
        .map(|metadata| metadata.len())
        .unwrap_or(0)
        > 0
    {
        let patch_arg = patch_path.to_string_lossy().to_string();
        git_success(
            root,
            &["apply", "--binary", "--whitespace=nowarn", &patch_arg],
        )?;
    }
    for relative in &metadata.untracked_paths {
        let relative_path = safe_relative_path(relative)?;
        let source = checkpoint_dir.join("files").join(&relative_path);
        let destination = root.join(&relative_path);
        let parent = destination.parent().expect("workspace file has a parent");
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to restore untracked file: {error}"))?;
        fs::copy(&source, &destination)
            .map_err(|error| format!("Failed to restore untracked file {relative}: {error}"))?;
    }

    Ok(())
}

fn apply_with_recovery<T, R>(
    apply_target: T,
    apply_recovery: R,
    recovery_dir: &Path,
) -> Result<(), String>
where
    T: FnOnce() -> Result<(), String>,
    R: FnOnce() -> Result<(), String>,
{
    match apply_target() {
        Ok(()) => {
            fs::remove_dir_all(recovery_dir).ok();
            Ok(())
        }
        Err(restore_error) => match apply_recovery() {
            Ok(()) => {
                fs::remove_dir_all(recovery_dir).ok();
                Err(format!(
                    "Workspace restore failed; the pre-restore workspace was recovered: {restore_error}"
                ))
            }
            Err(recovery_error) => Err(format!(
                "Workspace restore failed: {restore_error}. Automatic recovery also failed: {recovery_error}. Recovery data remains at {}.",
                recovery_dir.display()
            )),
        },
    }
}

fn matching_checkpoint(root: &Path, before_timestamp: u64) -> Result<Option<PathBuf>, String> {
    let mut checkpoints = checkpoint_directories(root)?;
    checkpoints.sort_by_key(|(timestamp, _)| *timestamp);
    if let Some((_, path)) = checkpoints
        .iter()
        .find(|(timestamp, _)| *timestamp >= before_timestamp)
    {
        return Ok(Some(path.clone()));
    }
    Ok(checkpoints.pop().map(|(_, path)| path))
}

fn prune_old_checkpoints(root: &Path) -> Result<(), String> {
    let mut checkpoints = checkpoint_directories(root)?;
    checkpoints.sort_by_key(|(timestamp, _)| *timestamp);
    let remove_count = checkpoints
        .len()
        .saturating_sub(MAX_CHECKPOINTS_PER_CONVERSATION);
    for (_, path) in checkpoints.into_iter().take(remove_count) {
        fs::remove_dir_all(&path)
            .map_err(|error| format!("Failed to prune workspace checkpoint: {error}"))?;
    }
    Ok(())
}

fn checkpoint_directories(root: &Path) -> Result<Vec<(u64, PathBuf)>, String> {
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut checkpoints = Vec::new();
    for entry in fs::read_dir(root)
        .map_err(|error| format!("Failed to read workspace checkpoints: {error}"))?
    {
        let entry =
            entry.map_err(|error| format!("Failed to read workspace checkpoint: {error}"))?;
        if !entry.path().is_dir() {
            continue;
        }
        if let Ok(timestamp) = entry.file_name().to_string_lossy().parse::<u64>() {
            checkpoints.push((timestamp, entry.path()));
        }
    }
    Ok(checkpoints)
}

fn checkpoint_conversation_dir(app_data_dir: &Path, conversation_id: &str) -> PathBuf {
    app_data_dir
        .join(CHECKPOINTS_DIR)
        .join(conversation_id.replace(|character: char| !character.is_ascii_alphanumeric(), "-"))
}

fn normalized_conversation_id(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() || value.len() > 200 {
        return Err("Conversation ID is required for workspace checkpoints.".to_string());
    }
    Ok(value.to_string())
}

fn safe_relative_path(value: &str) -> Result<PathBuf, String> {
    let path = Path::new(value);
    if path.is_absolute()
        || path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err(format!("Unsafe workspace checkpoint path: {value}"));
    }
    Ok(path.to_path_buf())
}

fn repository_root(workspace: &Path) -> Result<PathBuf, String> {
    let root = git_text(workspace, &["rev-parse", "--show-toplevel"])?;
    PathBuf::from(root)
        .canonicalize()
        .map_err(|error| format!("Failed to resolve Git repository: {error}"))
}

fn git_text(root: &Path, args: &[&str]) -> Result<String, String> {
    let output = git_checked_output(root, args)?;
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn git_success(root: &Path, args: &[&str]) -> Result<(), String> {
    git_checked_output(root, args).map(|_| ())
}

fn git_checked_output(root: &Path, args: &[&str]) -> Result<std::process::Output, String> {
    checked_git_output(&args.join(" "), git_output(root, args)?)
}

fn checked_git_output(
    command: &str,
    output: std::process::Output,
) -> Result<std::process::Output, String> {
    if output.status.success() {
        Ok(output)
    } else {
        Err(git_error(command, &output.stderr))
    }
}

fn git_output(root: &Path, args: &[&str]) -> Result<std::process::Output, String> {
    Command::new("git")
        .arg("-c")
        .arg("core.quotePath=false")
        .args(args)
        .current_dir(root)
        .output()
        .map_err(|error| format!("git command unavailable: {error}"))
}

fn git_error(command: &str, stderr: &[u8]) -> String {
    let detail = String::from_utf8_lossy(stderr).trim().to_string();
    if detail.is_empty() {
        format!("git {command} failed")
    } else {
        format!("git {command} failed: {detail}")
    }
}

fn unix_millis_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static COUNTER: AtomicUsize = AtomicUsize::new(0);

    #[test]
    fn capture_and_restore_rewinds_tracked_and_untracked_files() {
        let root = std::env::temp_dir().join(format!(
            "taskforceai-checkpoint-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        let repo = root.join("repo");
        let app_data = root.join("app-data");
        fs::create_dir_all(&repo).expect("create repo");
        run_git(&repo, &["init"]);
        run_git(&repo, &["config", "user.email", "test@example.com"]);
        run_git(&repo, &["config", "user.name", "Checkpoint Test"]);
        fs::write(repo.join("tracked.txt"), "base").expect("write base");
        run_git(&repo, &["add", "tracked.txt"]);
        run_git(&repo, &["commit", "-m", "base"]);

        fs::write(repo.join("tracked.txt"), "before turn").expect("write tracked checkpoint");
        fs::write(repo.join("kept.txt"), "untracked before turn")
            .expect("write untracked checkpoint");
        let checkpoint = capture(&app_data, &repo, "conversation/one").expect("capture checkpoint");

        fs::write(repo.join("tracked.txt"), "after turn").expect("write after turn");
        fs::remove_file(repo.join("kept.txt")).expect("remove checkpoint file");
        fs::write(repo.join("new.txt"), "created after turn").expect("write new file");

        let restored = restore(
            &app_data,
            "conversation/one",
            checkpoint.captured_at.saturating_sub(1),
        )
        .expect("restore checkpoint");

        assert!(restored.supported);
        assert_eq!(
            fs::read_to_string(repo.join("tracked.txt")).unwrap(),
            "before turn"
        );
        assert_eq!(
            fs::read_to_string(repo.join("kept.txt")).unwrap(),
            "untracked before turn"
        );
        assert!(!repo.join("new.txt").exists());
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn failed_restore_recovers_the_pre_restore_workspace() {
        let root = test_root("checkpoint-recovery");
        let repo = root.join("repo");
        let app_data = root.join("app-data");
        init_repo(&repo);
        fs::write(repo.join("tracked.txt"), "checkpoint state").expect("checkpoint tracked state");
        let checkpoint = capture(&app_data, &repo, "conversation-recovery")
            .expect("capture recovery checkpoint");
        let checkpoint_dir = checkpoint_conversation_dir(&app_data, "conversation-recovery")
            .join(checkpoint.captured_at.to_string());
        fs::write(checkpoint_dir.join("changes.patch"), "not a valid patch")
            .expect("corrupt checkpoint patch");

        fs::write(repo.join("tracked.txt"), "current state").expect("current tracked state");
        fs::write(repo.join("current.txt"), "current untracked state")
            .expect("current untracked state");

        let error = restore(&app_data, "conversation-recovery", checkpoint.captured_at)
            .expect_err("invalid target patch should fail");

        assert!(error.contains("pre-restore workspace was recovered"));
        assert_eq!(
            fs::read_to_string(repo.join("tracked.txt")).unwrap(),
            "current state"
        );
        assert_eq!(
            fs::read_to_string(repo.join("current.txt")).unwrap(),
            "current untracked state"
        );
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn checkpoint_validation_selection_and_pruning_cover_boundaries() {
        let root = test_root("checkpoint-boundaries");
        let app_data = root.join("app-data");
        let plain_workspace = root.join("plain-workspace");
        fs::create_dir_all(&plain_workspace).expect("create plain workspace");

        assert!(
            !capture(&app_data, &plain_workspace, "plain")
                .expect("non-repository capture result")
                .supported
        );
        assert!(normalized_conversation_id("   ").is_err());
        assert!(normalized_conversation_id(&"x".repeat(201)).is_err());
        assert!(safe_relative_path("../escape").is_err());
        assert!(safe_relative_path("/absolute").is_err());
        assert!(restore(&app_data, "missing", 1).is_err());

        let checkpoints = root.join("selection");
        fs::create_dir_all(checkpoints.join("100")).expect("create first checkpoint");
        fs::create_dir_all(checkpoints.join("200")).expect("create second checkpoint");
        fs::create_dir_all(checkpoints.join("not-a-timestamp")).expect("create ignored directory");
        fs::write(checkpoints.join("300"), "not a directory").expect("create ignored file");
        assert_eq!(
            matching_checkpoint(&checkpoints, 150).expect("select next checkpoint"),
            Some(checkpoints.join("200"))
        );
        assert_eq!(
            matching_checkpoint(&checkpoints, 999).expect("select latest checkpoint"),
            Some(checkpoints.join("200"))
        );

        let prune_root = root.join("prune");
        for timestamp in 0..=MAX_CHECKPOINTS_PER_CONVERSATION {
            fs::create_dir_all(prune_root.join(timestamp.to_string()))
                .expect("create prune checkpoint");
        }
        prune_old_checkpoints(&prune_root).expect("prune oldest checkpoint");
        assert!(!prune_root.join("0").exists());
        assert!(prune_root.join("1").exists());
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn restore_rejects_missing_invalid_and_mismatched_metadata() {
        let root = test_root("checkpoint-metadata");
        let repo = root.join("repo");
        let app_data = root.join("app-data");
        init_repo(&repo);

        let missing_dir = checkpoint_conversation_dir(&app_data, "missing-metadata").join("1");
        fs::create_dir_all(&missing_dir).expect("create metadata-less checkpoint");
        assert!(restore(&app_data, "missing-metadata", 1)
            .expect_err("missing metadata should fail")
            .contains("Failed to read workspace checkpoint metadata"));

        let invalid_dir = checkpoint_conversation_dir(&app_data, "invalid-metadata").join("1");
        fs::create_dir_all(&invalid_dir).expect("create invalid checkpoint");
        fs::write(invalid_dir.join("metadata.json"), "not json").expect("write invalid metadata");
        assert!(restore(&app_data, "invalid-metadata", 1)
            .expect_err("invalid metadata should fail")
            .contains("Failed to parse workspace checkpoint metadata"));

        let mismatch =
            capture(&app_data, &repo, "expected-conversation").expect("capture mismatch");
        let mismatch_dir = checkpoint_conversation_dir(&app_data, "expected-conversation")
            .join(mismatch.captured_at.to_string());
        let mut mismatch_metadata = read_checkpoint_metadata(&mismatch_dir).expect("read metadata");
        mismatch_metadata.conversation_id = "different-conversation".to_string();
        fs::write(
            mismatch_dir.join("metadata.json"),
            serde_json::to_vec(&mismatch_metadata).expect("encode mismatch metadata"),
        )
        .expect("write mismatch metadata");
        assert_eq!(
            restore(&app_data, "expected-conversation", mismatch.captured_at)
                .expect_err("conversation mismatch should fail"),
            "Workspace checkpoint conversation does not match."
        );

        let nested = capture(&app_data, &repo, "nested-workspace").expect("capture nested");
        let nested_dir = checkpoint_conversation_dir(&app_data, "nested-workspace")
            .join(nested.captured_at.to_string());
        let nested_workspace = repo.join("nested");
        fs::create_dir_all(&nested_workspace).expect("create nested workspace");
        let mut nested_metadata =
            read_checkpoint_metadata(&nested_dir).expect("read nested metadata");
        nested_metadata.workspace = nested_workspace.display().to_string();
        fs::write(
            nested_dir.join("metadata.json"),
            serde_json::to_vec(&nested_metadata).expect("encode nested metadata"),
        )
        .expect("write nested metadata");
        assert_eq!(
            restore(&app_data, "nested-workspace", nested.captured_at)
                .expect_err("nested repository path should fail"),
            "Workspace checkpoint repository no longer matches."
        );
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn checkpoint_file_and_git_failures_are_reported() {
        let root = test_root("checkpoint-errors");
        let repo = root.join("repo");
        init_repo(&repo);

        let create_blocker = root.join("create-blocker");
        fs::write(&create_blocker, "file").expect("write create blocker");
        assert!(
            write_checkpoint(&repo, &create_blocker.join("checkpoint"), "errors", 1)
                .expect_err("checkpoint directory creation should fail")
                .contains("Failed to create workspace checkpoint")
        );

        let patch_blocked = root.join("patch-blocked");
        fs::create_dir_all(patch_blocked.join("files")).expect("create patch checkpoint");
        fs::create_dir_all(patch_blocked.join("changes.patch")).expect("block patch file");
        assert!(write_checkpoint(&repo, &patch_blocked, "errors", 2)
            .expect_err("patch write should fail")
            .contains("Failed to save workspace checkpoint patch"));

        let metadata_blocked = root.join("metadata-blocked");
        fs::create_dir_all(metadata_blocked.join("metadata.json")).expect("block metadata file");
        assert!(write_checkpoint(&repo, &metadata_blocked, "errors", 3)
            .expect_err("metadata write should fail")
            .contains("Failed to save workspace checkpoint metadata"));

        fs::write(repo.join("nested"), "parent blocker").expect("write destination blocker");
        run_git(&repo, &["add", "nested"]);
        run_git(&repo, &["commit", "-m", "add parent blocker"]);
        let metadata = WorkspaceCheckpointMetadata {
            conversation_id: "errors".to_string(),
            captured_at: 4,
            workspace: repo.display().to_string(),
            head: git_text(&repo, &["rev-parse", "HEAD"]).expect("read head"),
            untracked_paths: vec!["missing.txt".to_string()],
        };
        let missing_source = root.join("missing-source");
        fs::create_dir_all(&missing_source).expect("create missing source checkpoint");
        fs::write(missing_source.join("changes.patch"), "").expect("write empty patch");
        assert!(apply_checkpoint(&repo, &missing_source, &metadata)
            .expect_err("missing untracked source should fail")
            .contains("Failed to restore untracked file missing.txt"));

        let parent_blocked = root.join("parent-blocked");
        fs::create_dir_all(parent_blocked.join("files/nested")).expect("create source parent");
        fs::write(parent_blocked.join("files/nested/file.txt"), "content")
            .expect("write source file");
        fs::write(parent_blocked.join("changes.patch"), "").expect("write empty patch");
        let blocked_metadata = WorkspaceCheckpointMetadata {
            untracked_paths: vec!["nested/file.txt".to_string()],
            ..metadata.clone()
        };
        assert!(apply_checkpoint(&repo, &parent_blocked, &blocked_metadata)
            .expect_err("destination parent creation should fail")
            .contains("Failed to restore untracked file"));

        let failed = Command::new("false").output().expect("run false");
        assert_eq!(
            checked_git_output("silent", failed).expect_err("false should fail"),
            "git silent failed"
        );
        let succeeded = Command::new("true").output().expect("run true");
        checked_git_output("true", succeeded).expect("true should succeed");
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn recovery_outcomes_preserve_or_remove_recovery_data() {
        fn succeed() -> Result<(), String> {
            Ok(())
        }

        fn fail_target() -> Result<(), String> {
            Err("target failed".to_string())
        }

        fn fail_recovery() -> Result<(), String> {
            Err("recovery failed".to_string())
        }

        let root = test_root("checkpoint-recovery-outcomes");
        let recovery_dir = root.join("recovery");
        fs::create_dir_all(&recovery_dir).expect("create successful recovery directory");
        apply_with_recovery(succeed, succeed, &recovery_dir).expect("target should apply");
        assert!(!recovery_dir.exists());

        fs::create_dir_all(&recovery_dir).expect("recreate recovery directory");
        assert!(apply_with_recovery(fail_target, succeed, &recovery_dir)
            .expect_err("recovered target failure should remain an error")
            .contains("pre-restore workspace was recovered"));
        assert!(!recovery_dir.exists());

        fs::create_dir_all(&recovery_dir).expect("recreate retained recovery directory");
        let error = apply_with_recovery(fail_target, fail_recovery, &recovery_dir)
            .expect_err("double failure should retain recovery data");
        assert!(error.contains("Automatic recovery also failed"));
        assert!(error.contains(recovery_dir.to_string_lossy().as_ref()));
        assert!(recovery_dir.exists());
        fs::remove_dir_all(root).ok();
    }

    #[cfg(unix)]
    #[test]
    fn checkpoint_skips_broken_untracked_symlinks() {
        use std::os::unix::fs::symlink;

        let root = test_root("checkpoint-broken-symlink");
        let repo = root.join("repo");
        init_repo(&repo);
        symlink("missing-target", repo.join("broken-link")).expect("create broken symlink");
        let checkpoint = write_checkpoint(&repo, &root.join("checkpoint"), "symlink", 1)
            .expect("capture checkpoint with broken symlink");
        assert!(checkpoint.untracked_paths.is_empty());
        fs::remove_dir_all(root).ok();
    }

    fn test_root(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "taskforceai-{label}-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::Relaxed)
        ))
    }

    fn init_repo(repo: &Path) {
        fs::create_dir_all(repo).expect("create repo");
        run_git(repo, &["init"]);
        run_git(repo, &["config", "user.email", "test@example.com"]);
        run_git(repo, &["config", "user.name", "Checkpoint Test"]);
        fs::write(repo.join("tracked.txt"), "base").expect("write base");
        run_git(repo, &["add", "tracked.txt"]);
        run_git(repo, &["commit", "-m", "base"]);
    }

    fn run_git(root: &Path, args: &[&str]) {
        git_success(root, args).expect("git test setup command should succeed");
    }
}
