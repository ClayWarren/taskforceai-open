use std::fs;
use std::path::Path;
use std::process::Command;

use crate::protocol::{
    GitReviewDiffParams, GitReviewDiffResult, GitReviewScope, GitReviewStatusParams,
    GitReviewStatusResult,
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

fn git_diff(runtime: &AppRuntime, repo: &Path, scope: GitReviewScope) -> GitReviewDiffResult {
    from_value_response(
        runtime
            .git_review_diff(GitReviewDiffParams {
                workspace: Some(repo.display().to_string()),
                scope,
                base_ref: None,
                max_bytes: Some(64 * 1024),
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
