use super::{
    branch_path_suffix, create_git_worktree, default_worktree_branch, default_worktree_path,
    git_error, list_git_worktrees, parse_worktree_porcelain, resolve_repository_root,
};
use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

static COUNTER: AtomicUsize = AtomicUsize::new(0);
static ENV_LOCK: Mutex<()> = Mutex::new(());

#[test]
fn parse_worktree_porcelain_reads_branch_and_flags() {
    let worktrees = parse_worktree_porcelain(
        "worktree /repo\nHEAD abc\nbranch refs/heads/main\n\nworktree /repo-codex\nHEAD def\ndetached\nprunable gitdir file points to missing location\n",
    );

    assert_eq!(worktrees.len(), 2);
    assert_eq!(worktrees[0].branch.as_deref(), Some("main"));
    assert!(!worktrees[0].detached);
    assert!(worktrees[1].detached);
    assert!(worktrees[1].prunable);
}

#[test]
fn parse_worktree_porcelain_handles_boundaries() {
    let worktrees = parse_worktree_porcelain(
        "ignored before worktree\nworktree /bare\nbare\nworktree /detached\nHEAD abc\n",
    );

    assert_eq!(worktrees.len(), 2);
    assert!(worktrees[0].bare);
    assert!(!worktrees[0].detached);
    assert!(worktrees[1].detached);
}

#[test]
fn branch_path_suffix_sanitizes_slashes() {
    assert_eq!(branch_path_suffix("codex/review pane"), "codex-review-pane");
    assert_eq!(branch_path_suffix("///"), "worktree");
}

#[test]
fn default_branch_and_path_use_safe_fallbacks() {
    let branch = default_worktree_branch();
    assert!(branch.starts_with("codex/worktree-"));
    assert!(
        default_worktree_path(PathBuf::from("/").as_path(), "feature/test")
            .ends_with("worktree-feature-test")
    );
}

#[test]
fn git_error_formats_empty_and_detailed_stderr() {
    assert_eq!(git_error("worktree list", b""), "git worktree list failed");
    assert_eq!(
        git_error("worktree add", b"fatal: bad ref\n"),
        "git worktree add failed: fatal: bad ref"
    );
}

#[test]
fn resolve_repository_root_rejects_file_paths() {
    let root = unique_test_dir("git-worktree-file-root");
    std::fs::create_dir_all(&root).expect("create root");
    let file = root.join("not-a-directory");
    std::fs::write(&file, "not a repo").expect("write file");

    let error = resolve_repository_root(&file).expect_err("file path should be rejected");

    assert_eq!(error, "Repository path must be an existing directory.");
    std::fs::remove_dir_all(root).ok();
}

#[test]
fn resolve_repository_root_reports_missing_paths_and_unavailable_git() {
    let _guard = lock_env();
    let root = unique_test_dir("git-worktree-unavailable-git");
    let missing = root.join("missing-repo");
    let missing_error =
        resolve_repository_root(&missing).expect_err("missing path should be rejected");
    assert!(missing_error.contains("Failed to resolve repository path:"));

    let repo = root.join("repo");
    std::fs::create_dir_all(&repo).expect("create repo");
    let original_path = std::env::var_os("PATH");
    std::env::set_var("PATH", "");
    let git_error = resolve_repository_root(&repo).expect_err("missing git should be reported");
    assert!(git_error.contains("git command unavailable:"));

    restore_env("PATH", original_path);
    std::fs::remove_dir_all(root).ok();
}

#[test]
fn create_git_worktree_rejects_existing_relative_target() {
    let _guard = lock_env();
    let root = unique_test_dir("git-worktree-existing-target");
    let repo = root.join("repo");
    init_git_repo(&repo);

    let error = create_git_worktree(
        &repo,
        Some("repo/README.md"),
        Some("codex/existing-target"),
        Some("HEAD"),
    )
    .expect_err("existing target should be rejected");

    assert!(error.contains("Worktree path already exists:"));
    std::fs::remove_dir_all(root).ok();
}

#[test]
fn create_git_worktree_reports_add_failure() {
    let _guard = lock_env();
    let root = unique_test_dir("git-worktree-add-failure");
    let repo = root.join("repo");
    init_git_repo(&repo);

    let error = create_git_worktree(
        &repo,
        Some(
            root.join("missing-base-worktree")
                .to_str()
                .expect("utf8 path"),
        ),
        Some("codex/missing-base"),
        Some("missing-base"),
    )
    .expect_err("missing base ref should fail");

    assert!(error.contains("git worktree add failed:"));
    std::fs::remove_dir_all(root).ok();
}

#[test]
fn create_git_worktree_does_not_parse_base_ref_as_an_option() {
    let _guard = lock_env();
    let root = unique_test_dir("git-worktree-option-like-base");
    let repo = root.join("repo");
    init_git_repo(&repo);

    let target = root.join("option-like-worktree");
    let error = create_git_worktree(
        &repo,
        Some(target.to_string_lossy().as_ref()),
        Some("codex/option-like-base"),
        Some("--detach"),
    )
    .expect_err("option-like base ref should be treated as an invalid ref");

    assert!(error.contains("invalid reference: --detach"));
    assert!(!error.contains("cannot be used together"));
    std::fs::remove_dir_all(root).ok();
}

#[test]
fn git_command_error_paths_are_reported() {
    let _guard = lock_env();
    let root = unique_test_dir("git-worktree-fake-git");
    let repo = root.join("repo");
    std::fs::create_dir_all(&repo).expect("create repo");
    let fake_bin = root.join("bin");
    std::fs::create_dir_all(&fake_bin).expect("create fake bin");
    let fake_git = fake_bin.join("git");
    std::fs::write(
        &fake_git,
        "#!/bin/sh\nif [ \"$1\" = \"-c\" ]; then shift 2; fi\ncase \"$1 $2\" in\n  \"rev-parse --show-toplevel\") if [ -n \"${TASKFORCEAI_FAKE_GIT_REV_PARSE_FAIL:-}\" ]; then echo 'rev parse failed' >&2; exit 2; fi; printf '%s\\n' \"${TASKFORCEAI_FAKE_GIT_ROOT:-}\"; exit 0 ;;\n  \"worktree list\") if [ -n \"${TASKFORCEAI_FAKE_GIT_LIST_FAIL:-}\" ]; then echo 'list failed' >&2; exit 2; fi; printf 'worktree %s\\nHEAD abc\\nbranch refs/heads/main\\n\\n' \"${TASKFORCEAI_FAKE_GIT_ROOT:-}\"; exit 0 ;;\n  \"worktree add\") if [ -n \"${TASKFORCEAI_FAKE_GIT_ADD_NO_CREATE:-}\" ]; then exit 0; fi; mkdir -p \"$6\"; exit 0 ;;\nesac\necho 'unexpected git command' >&2\nexit 1\n",
    )
    .expect("write fake git");
    let mut permissions = std::fs::metadata(&fake_git)
        .expect("fake git metadata")
        .permissions();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        permissions.set_mode(0o755);
    }
    std::fs::set_permissions(&fake_git, permissions).expect("chmod fake git");

    let original_path = std::env::var_os("PATH");
    let original_fake_root = std::env::var_os("TASKFORCEAI_FAKE_GIT_ROOT");
    let original_rev_parse_fail = std::env::var_os("TASKFORCEAI_FAKE_GIT_REV_PARSE_FAIL");
    let original_list_fail = std::env::var_os("TASKFORCEAI_FAKE_GIT_LIST_FAIL");
    let original_add_no_create = std::env::var_os("TASKFORCEAI_FAKE_GIT_ADD_NO_CREATE");
    std::env::set_var(
        "PATH",
        format!(
            "{}:{}",
            fake_bin.display(),
            std::env::var("PATH").unwrap_or_default()
        ),
    );
    std::env::set_var("TASKFORCEAI_FAKE_GIT_ROOT", "");
    let empty_root_error =
        resolve_repository_root(&repo).expect_err("empty git root should be rejected");
    assert_eq!(
        empty_root_error,
        "Repository path is not inside a Git repository."
    );

    std::env::set_var("TASKFORCEAI_FAKE_GIT_ROOT", repo.display().to_string());
    std::env::set_var("TASKFORCEAI_FAKE_GIT_REV_PARSE_FAIL", "1");
    let rev_parse_error = resolve_repository_root(&repo).expect_err("fake rev-parse should fail");
    assert_eq!(
        rev_parse_error,
        "git rev-parse --show-toplevel failed: rev parse failed"
    );
    std::env::remove_var("TASKFORCEAI_FAKE_GIT_REV_PARSE_FAIL");

    std::env::set_var("TASKFORCEAI_FAKE_GIT_ROOT", repo.display().to_string());
    std::env::set_var("TASKFORCEAI_FAKE_GIT_LIST_FAIL", "1");
    let list_error = list_git_worktrees(&repo).expect_err("fake list should fail");
    assert_eq!(
        list_error,
        "git worktree list --porcelain failed: list failed"
    );

    std::env::remove_var("TASKFORCEAI_FAKE_GIT_LIST_FAIL");
    let fallback_target = root.join("fallback-worktree");
    let created = create_git_worktree(
        &repo,
        Some(fallback_target.to_str().expect("utf8 path")),
        Some("codex/fallback"),
        Some("HEAD"),
    )
    .expect("fake add should create fallback worktree result");
    assert_eq!(created.worktree.branch.as_deref(), Some("codex/fallback"));
    assert_eq!(
        created.worktree.path,
        fallback_target
            .canonicalize()
            .expect("canonical fallback target")
            .display()
            .to_string()
    );

    std::env::set_var("TASKFORCEAI_FAKE_GIT_ADD_NO_CREATE", "1");
    let unresolved_target = root.join("unresolved-worktree");
    let unresolved_error = create_git_worktree(
        &repo,
        Some(unresolved_target.to_str().expect("utf8 path")),
        Some("codex/unresolved-target"),
        Some("HEAD"),
    )
    .expect_err("missing created path should fail canonicalization");
    assert!(unresolved_error.contains("Failed to resolve created worktree:"));

    restore_env("PATH", original_path);
    restore_env("TASKFORCEAI_FAKE_GIT_ROOT", original_fake_root);
    restore_env(
        "TASKFORCEAI_FAKE_GIT_REV_PARSE_FAIL",
        original_rev_parse_fail,
    );
    restore_env("TASKFORCEAI_FAKE_GIT_LIST_FAIL", original_list_fail);
    restore_env("TASKFORCEAI_FAKE_GIT_ADD_NO_CREATE", original_add_no_create);
    std::fs::remove_dir_all(root).ok();
}

#[test]
fn create_git_worktree_creates_branch_checkout() {
    let _guard = lock_env();
    let root = unique_test_dir("git-worktree-create");
    let repo = root.join("repo");
    init_git_repo(&repo);

    let result = create_git_worktree(&repo, None, Some("codex/test-worktree"), Some("HEAD"))
        .expect("create worktree");

    assert!(PathBuf::from(&result.worktree.path)
        .join("README.md")
        .exists());
    assert_eq!(
        result.worktree.branch.as_deref(),
        Some("codex/test-worktree")
    );
    let list = list_git_worktrees(&repo).expect("list worktrees");
    assert!(list
        .worktrees
        .iter()
        .any(|worktree| worktree.branch.as_deref() == Some("codex/test-worktree")));

    std::fs::remove_dir_all(root).ok();
}

fn unique_test_dir(label: &str) -> PathBuf {
    let id = COUNTER.fetch_add(1, Ordering::Relaxed);
    std::env::temp_dir().join(format!("taskforceai-{label}-{}-{id}", std::process::id()))
}

fn lock_env() -> std::sync::MutexGuard<'static, ()> {
    ENV_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn init_git_repo(repo: &std::path::Path) {
    std::fs::create_dir_all(repo).expect("create repo");
    git(repo, &["init"]);
    git(repo, &["config", "user.name", "TaskForceAI Test"]);
    git(repo, &["config", "user.email", "test@example.com"]);
    std::fs::write(repo.join("README.md"), "hello\n").expect("write readme");
    git(repo, &["add", "README.md"]);
    git(repo, &["commit", "-m", "initial"]);
}

fn restore_env(key: &str, value: Option<std::ffi::OsString>) {
    if let Some(value) = value {
        std::env::set_var(key, value);
    } else {
        std::env::remove_var(key);
    }
}

fn git(cwd: &std::path::Path, args: &[&str]) {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .expect("git should run");
    assert!(output.status.success());
}
