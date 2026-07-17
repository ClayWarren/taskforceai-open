use std::fs;
use std::path::Path;
use std::process::Command;

use crate::protocol::{
    GitReviewCommentAddParams, GitReviewCommentListParams, GitReviewCommentListResult,
    GitReviewCommentResolveParams, GitReviewCommentResult, GitReviewDiffParams,
    GitReviewDiffResult, GitReviewScope, GitReviewStageParams, GitReviewStatusParams,
    GitReviewStatusResult, TaskMode, ThreadItemRecord, ThreadItemStatus, ThreadItemType,
    ThreadRecord, ThreadState, TurnRecord, TurnStatus, WorkspaceFileListParams,
    WorkspaceFileListResult,
};
use crate::runtime::{AppRuntime, RuntimeConfig};

use super::util::{from_value_response, unix_millis};

#[test]
fn git_review_status_reports_non_repository() {
    let workspace = temp_root("non-repo");
    let runtime = AppRuntime::new(RuntimeConfig::default());

    let response = runtime
        .git_review_status(GitReviewStatusParams {
            workspace: Some(workspace.display().to_string()),
        })
        .expect("status should load");
    let status: GitReviewStatusResult =
        from_value_response(response).expect("status should decode");

    assert!(!status.is_git_repository);
    assert_eq!(status.repository_root, None);
    assert!(status.files.is_empty());
    assert!(status.message.contains("not inside a Git repository"));
}

#[test]
fn git_review_status_and_diff_cover_worktree_states() {
    let repo = initialized_repo("worktree-states");
    fs::write(repo.join("tracked.txt"), "alpha\nbeta\n").expect("write tracked change");
    fs::write(repo.join("staged.txt"), "staged\n").expect("write staged file");
    run_git(&repo, &["add", "staged.txt"]);
    fs::write(repo.join("untracked.txt"), "draft\n").expect("write untracked file");

    let runtime = AppRuntime::new(RuntimeConfig::default());
    let status: GitReviewStatusResult = from_value_response(
        runtime
            .git_review_status(GitReviewStatusParams {
                workspace: Some(repo.display().to_string()),
            })
            .expect("status should load"),
    )
    .expect("status should decode");

    assert!(status.is_git_repository);
    assert!(status.has_staged_changes);
    assert!(status.has_unstaged_changes);
    assert!(status.has_untracked_files);
    assert!(status
        .files
        .iter()
        .any(|file| file.path == "staged.txt" && file.staged));
    assert!(status
        .files
        .iter()
        .any(|file| file.path == "tracked.txt" && file.unstaged));
    assert!(status
        .files
        .iter()
        .any(|file| file.path == "untracked.txt" && file.untracked));

    let uncommitted = git_diff(&runtime, &repo, GitReviewScope::Uncommitted);
    assert!(uncommitted.raw_diff.contains("+beta"));
    assert!(uncommitted.raw_diff.contains("+staged"));
    assert!(uncommitted.raw_diff.contains("+draft"));
    assert!(uncommitted
        .files
        .iter()
        .any(|file| file.path == "untracked.txt" && file.status == "A"));

    let staged = git_diff(&runtime, &repo, GitReviewScope::Staged);
    assert!(staged.raw_diff.contains("+staged"));
    assert!(!staged.raw_diff.contains("+beta"));
    assert!(!staged.raw_diff.contains("+draft"));

    let unstaged = git_diff(&runtime, &repo, GitReviewScope::Unstaged);
    assert!(unstaged.raw_diff.contains("+beta"));
    assert!(unstaged.raw_diff.contains("+draft"));
    assert!(!unstaged.raw_diff.contains("+staged"));
}

#[test]
fn git_review_stages_paths_and_persists_resolvable_inline_comments() {
    let repo = initialized_repo("review-actions");
    fs::write(repo.join("tracked.txt"), "alpha\nbeta\n").expect("write change");
    let store = temp_root("review-actions-store").join("runs.db");
    let mut runtime = AppRuntime::try_new(RuntimeConfig::default().with_run_store_path(&store))
        .expect("runtime should start");

    let staged: GitReviewStatusResult = from_value_response(
        runtime
            .git_review_stage(GitReviewStageParams {
                workspace: Some(repo.display().to_string()),
                paths: vec!["tracked.txt".to_string()],
                staged: true,
            })
            .expect("path should stage"),
    )
    .expect("stage result should decode");
    assert!(staged
        .files
        .iter()
        .any(|file| file.path == "tracked.txt" && file.staged));

    let added: GitReviewCommentResult = from_value_response(
        runtime
            .git_review_comment_add(GitReviewCommentAddParams {
                workspace: Some(repo.display().to_string()),
                path: "tracked.txt".to_string(),
                line: 2,
                end_line: Some(3),
                body: "Preserve the public behavior.".to_string(),
            })
            .expect("comment should save"),
    )
    .expect("comment should decode");
    assert!(!added.comment.resolved);

    let resolved: GitReviewCommentResult = from_value_response(
        runtime
            .git_review_comment_resolve(GitReviewCommentResolveParams {
                comment_id: added.comment.id.clone(),
                resolved: true,
            })
            .expect("comment should resolve"),
    )
    .expect("resolved comment should decode");
    assert!(resolved.comment.resolved);

    let listed: GitReviewCommentListResult = from_value_response(
        runtime
            .git_review_comment_list(GitReviewCommentListParams {
                workspace: Some(repo.display().to_string()),
            })
            .expect("comments should list"),
    )
    .expect("comments should decode");
    assert_eq!(listed.comments.len(), 1);
    assert!(listed.comments[0].resolved);

    let unstaged: GitReviewStatusResult = from_value_response(
        runtime
            .git_review_stage(GitReviewStageParams {
                workspace: Some(repo.display().to_string()),
                paths: vec!["tracked.txt".to_string()],
                staged: false,
            })
            .expect("path should unstage"),
    )
    .expect("unstage result should decode");
    assert!(unstaged
        .files
        .iter()
        .any(|file| file.path == "tracked.txt" && file.unstaged && !file.staged));

    fs::remove_dir_all(repo).ok();
    fs::remove_file(store).ok();
}

#[test]
fn git_review_last_turn_limits_diff_to_paths_recorded_by_that_code_turn() {
    let repo = initialized_repo("last-turn");
    fs::write(repo.join("other.txt"), "original\n").expect("write other file");
    run_git(&repo, &["add", "other.txt"]);
    run_git(&repo, &["commit", "-m", "add other"]);
    fs::write(repo.join("tracked.txt"), "alpha\nselected\n").expect("write selected change");
    fs::write(repo.join("other.txt"), "original\nexcluded\n").expect("write excluded change");

    let store = temp_root("last-turn-store").join("runs.db");
    let mut runtime = AppRuntime::try_new(RuntimeConfig::default().with_run_store_path(&store))
        .expect("runtime should start");
    runtime
        .save_thread_records(&[ThreadRecord {
            id: "code-thread".to_string(),
            title: "Code thread".to_string(),
            objective: "Edit one file".to_string(),
            state: ThreadState::Active,
            archived: false,
            source: "test".to_string(),
            task_mode: TaskMode::Code,
            parent_thread_id: None,
            turns: vec![TurnRecord {
                id: "turn-1".to_string(),
                thread_id: "code-thread".to_string(),
                run_id: "run-1".to_string(),
                status: TurnStatus::Completed,
                items: vec![ThreadItemRecord {
                    id: "tool-1".to_string(),
                    turn_id: "turn-1".to_string(),
                    item_type: ThreadItemType::ToolCall,
                    status: ThreadItemStatus::Completed,
                    content: serde_json::json!({"path": "tracked.txt"}),
                    created_at: 1,
                    updated_at: 1,
                }],
                created_at: 1,
                updated_at: 1,
            }],
            created_at: 1,
            updated_at: 1,
        }])
        .expect("thread history should save");

    let result: GitReviewDiffResult = from_value_response(
        runtime
            .git_review_diff(GitReviewDiffParams {
                workspace: Some(repo.display().to_string()),
                scope: GitReviewScope::LastTurn,
                base_ref: None,
                max_bytes: None,
                thread_id: Some("code-thread".to_string()),
            })
            .expect("last-turn diff should load"),
    )
    .expect("last-turn diff should decode");
    assert!(result.raw_diff.contains("selected"));
    assert!(!result.raw_diff.contains("excluded"));
    assert_eq!(result.files.len(), 1);
    assert_eq!(result.files[0].path, "tracked.txt");

    fs::remove_dir_all(repo).ok();
    fs::remove_file(store).ok();
}

#[cfg(unix)]
#[test]
fn git_review_diff_does_not_follow_untracked_symlinks() {
    let repo = initialized_repo("untracked-symlink");
    let outside = temp_root("outside-secret").join("outside.txt");
    fs::write(&outside, "TASKFORCEAI_SYMLINK_LEAK_SECRET=blocked\n").expect("write secret");
    std::os::unix::fs::symlink(&outside, repo.join("leak.txt")).expect("create symlink");

    let runtime = AppRuntime::new(RuntimeConfig::default());
    let diff = git_diff(&runtime, &repo, GitReviewScope::Uncommitted);

    assert!(diff.raw_diff.contains("diff --git a/leak.txt b/leak.txt"));
    assert!(diff.raw_diff.contains("new file mode 120000"));
    assert!(!diff.raw_diff.contains("TASKFORCEAI_SYMLINK_LEAK_SECRET"));
}

#[test]
fn workspace_file_list_is_scoped_fuzzy_and_works_without_git() {
    let workspace = temp_root("workspace-files");
    fs::create_dir_all(workspace.join("src/nested")).expect("create source tree");
    fs::create_dir_all(workspace.join("node_modules/pkg")).expect("create ignored tree");
    fs::write(workspace.join("src/app.rs"), "fn main() {}\n").expect("write app");
    fs::write(workspace.join("src/nested/state.rs"), "struct State;\n").expect("write state");
    fs::write(workspace.join("node_modules/pkg/index.js"), "ignored\n").expect("write ignored");
    let runtime = AppRuntime::new(RuntimeConfig::default());

    let result: WorkspaceFileListResult = from_value_response(
        runtime
            .workspace_file_list(WorkspaceFileListParams {
                workspace: Some(workspace.display().to_string()),
                query: Some("nestedstate".to_string()),
                limit: Some(20),
            })
            .expect("files should load"),
    )
    .expect("files should decode");

    assert_eq!(result.files, vec!["src/nested/state.rs"]);
    assert!(!result.truncated);
    assert!(!result
        .files
        .iter()
        .any(|path| path.contains("node_modules")));
}

#[test]
fn workspace_file_list_limits_git_results_to_selected_subdirectory() {
    let repo = initialized_repo("workspace-files-git");
    fs::create_dir_all(repo.join("apps/tui")).expect("create nested workspace");
    fs::write(repo.join("apps/tui/main.rs"), "fn main() {}\n").expect("write nested file");
    fs::write(repo.join("root-only.txt"), "root\n").expect("write root file");
    run_git(&repo, &["add", "."]);
    let runtime = AppRuntime::new(RuntimeConfig::default());

    let result: WorkspaceFileListResult = from_value_response(
        runtime
            .workspace_file_list(WorkspaceFileListParams {
                workspace: Some(repo.join("apps/tui").display().to_string()),
                query: None,
                limit: Some(20),
            })
            .expect("files should load"),
    )
    .expect("files should decode");

    assert_eq!(result.files, vec!["main.rs"]);
}

fn git_diff(runtime: &AppRuntime, repo: &Path, scope: GitReviewScope) -> GitReviewDiffResult {
    from_value_response(
        runtime
            .git_review_diff(GitReviewDiffParams {
                workspace: Some(repo.display().to_string()),
                scope,
                base_ref: None,
                max_bytes: Some(64 * 1024),
                thread_id: None,
            })
            .expect("diff should load"),
    )
    .expect("diff should decode")
}

fn initialized_repo(name: &str) -> std::path::PathBuf {
    let repo = temp_root(name);
    run_git(&repo, &["init"]);
    run_git(&repo, &["config", "user.email", "desktop@example.invalid"]);
    run_git(&repo, &["config", "user.name", "Desktop Test"]);
    fs::write(repo.join("tracked.txt"), "alpha\n").expect("write tracked file");
    run_git(&repo, &["add", "tracked.txt"]);
    run_git(&repo, &["commit", "-m", "initial"]);
    repo
}

fn run_git(dir: &Path, args: &[&str]) {
    let output = Command::new("git")
        .args(args)
        .current_dir(dir)
        .output()
        .expect("git command should run");
    assert!(
        output.status.success(),
        "git {} failed: {}",
        args.join(" "),
        String::from_utf8_lossy(&output.stderr)
    );
}

fn temp_root(name: &str) -> std::path::PathBuf {
    let root = std::env::temp_dir().join(format!(
        "taskforceai-app-server-git-review-{name}-{}-{}",
        std::process::id(),
        unix_millis()
    ));
    fs::create_dir_all(&root).expect("create temp root");
    root
}
