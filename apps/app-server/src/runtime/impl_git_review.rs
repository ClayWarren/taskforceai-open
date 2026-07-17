use std::collections::BTreeSet;
use std::fs::{self, File};
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};

use crate::protocol::{
    AppResponse, FsDirectoryEntry, FsGetMetadataParams, FsMetadataResult, FsReadDirectoryParams,
    FsReadDirectoryResult, GitBranchCheckoutParams, GitBranchCreateParams, GitBranchListParams,
    GitBranchListResult, GitBranchRecord, GitHubRepositoryListParams, GitHubRepositoryListResult,
    GitHubRepositoryRecord, GitPullRequestCreateParams, GitRepositoryActionParams,
    GitRepositoryCloneParams, GitRepositoryCloneResult, GitRepositoryCommitParams,
    GitReviewActionResult, GitReviewCommentAddParams, GitReviewCommentListParams,
    GitReviewCommentListResult, GitReviewCommentRecord, GitReviewCommentResolveParams,
    GitReviewCommentResult, GitReviewDiffFile, GitReviewDiffParams, GitReviewDiffResult,
    GitReviewFileStatus, GitReviewPullRequest, GitReviewPullRequestAction,
    GitReviewPullRequestActionParams, GitReviewPullRequestReview, GitReviewScope,
    GitReviewStageParams, GitReviewStatusParams, GitReviewStatusResult, GitWorktreeCreateParams,
    GitWorktreeListParams, GitWorktreeListResult, GitWorktreeRecord, GitWorktreeResult,
    WorkspaceFileListParams, WorkspaceFileListResult, WorkspaceFileReadParams,
    WorkspaceFileReadResult,
};

use super::error::RuntimeError;
use super::platform::expand_user_path;
use super::util::{unix_millis, value};

const DEFAULT_DIFF_MAX_BYTES: usize = 1024 * 1024;
const HARD_DIFF_MAX_BYTES: usize = 4 * 1024 * 1024;
const DEFAULT_WORKSPACE_FILE_LIMIT: usize = 2_000;
const HARD_WORKSPACE_FILE_LIMIT: usize = 10_000;
const DEFAULT_WORKSPACE_READ_MAX_BYTES: usize = 256 * 1024;
const HARD_WORKSPACE_READ_MAX_BYTES: usize = 1024 * 1024;

impl super::AppRuntime {
    pub fn git_review_status(
        &self,
        params: GitReviewStatusParams,
    ) -> Result<AppResponse, RuntimeError> {
        Ok(value(git_review_status_result(params)?))
    }

    pub fn git_review_diff(
        &self,
        params: GitReviewDiffParams,
    ) -> Result<AppResponse, RuntimeError> {
        let last_turn_paths = if params.scope == GitReviewScope::LastTurn {
            let thread_id = params
                .thread_id
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| {
                    RuntimeError::invalid_params("threadId is required for last-turn review")
                })?;
            let thread = self.find_thread_record(thread_id)?;
            let turn = thread
                .turns
                .last()
                .ok_or_else(|| RuntimeError::invalid_params("thread has no turns to review"))?;
            paths_from_turn_items(&turn.items)
        } else {
            Vec::new()
        };
        Ok(value(git_review_diff_result(params, &last_turn_paths)?))
    }

    pub fn git_review_stage(
        &self,
        params: GitReviewStageParams,
    ) -> Result<AppResponse, RuntimeError> {
        let workspace = resolve_workspace(params.workspace.as_deref())?;
        let root = git_repository_root(&workspace)?
            .ok_or_else(|| RuntimeError::invalid_params("workspace is not a Git repository"))?;
        let paths = validate_git_paths(&params.paths)?;
        let mut args = if params.staged {
            vec!["add".to_string(), "--".to_string()]
        } else if git_ref_exists(&root, "HEAD")? {
            vec![
                "restore".to_string(),
                "--staged".to_string(),
                "--".to_string(),
            ]
        } else {
            vec![
                "rm".to_string(),
                "--cached".to_string(),
                "--ignore-unmatch".to_string(),
                "--".to_string(),
            ]
        };
        args.extend(paths);
        git_output_owned(&root, &args)?;
        Ok(value(git_review_status_result(GitReviewStatusParams {
            workspace: Some(root.display().to_string()),
        })?))
    }

    pub fn git_review_comment_list(
        &self,
        params: GitReviewCommentListParams,
    ) -> Result<AppResponse, RuntimeError> {
        let workspace = canonical_review_workspace(params.workspace.as_deref())?;
        let comments = self
            .metadata_json::<Vec<GitReviewCommentRecord>>("git_review_comments")?
            .unwrap_or_default()
            .into_iter()
            .filter(|comment| comment.workspace == workspace)
            .collect();
        Ok(value(GitReviewCommentListResult { comments }))
    }

    pub fn git_review_comment_add(
        &mut self,
        params: GitReviewCommentAddParams,
    ) -> Result<AppResponse, RuntimeError> {
        let workspace = canonical_review_workspace(params.workspace.as_deref())?;
        let path = validate_git_paths(&[params.path])?
            .into_iter()
            .next()
            .expect("one validated review path");
        if params.line == 0 {
            return Err(RuntimeError::invalid_params(
                "comment line must be positive",
            ));
        }
        if params
            .end_line
            .is_some_and(|end_line| end_line < params.line)
        {
            return Err(RuntimeError::invalid_params(
                "comment endLine must not precede line",
            ));
        }
        let body = params.body.trim();
        if body.is_empty() {
            return Err(RuntimeError::invalid_params("comment body is required"));
        }
        if body.len() > 8_000 {
            return Err(RuntimeError::invalid_params("comment body is too long"));
        }
        let mut comments = self
            .metadata_json::<Vec<GitReviewCommentRecord>>("git_review_comments")?
            .unwrap_or_default();
        let now = unix_millis();
        let id = unique_review_comment_id(&comments, now);
        let comment = GitReviewCommentRecord {
            id,
            workspace,
            path,
            line: params.line,
            end_line: params.end_line,
            body: body.to_string(),
            resolved: false,
            created_at: now,
            updated_at: now,
        };
        comments.push(comment.clone());
        self.set_metadata_json("git_review_comments", &comments)?;
        Ok(value(GitReviewCommentResult { comment }))
    }

    pub fn git_review_comment_resolve(
        &mut self,
        params: GitReviewCommentResolveParams,
    ) -> Result<AppResponse, RuntimeError> {
        let mut comments = self
            .metadata_json::<Vec<GitReviewCommentRecord>>("git_review_comments")?
            .unwrap_or_default();
        let comment = comments
            .iter_mut()
            .find(|comment| comment.id == params.comment_id)
            .ok_or_else(|| RuntimeError::not_found("review comment not found"))?;
        comment.resolved = params.resolved;
        comment.updated_at = unix_millis();
        let result = comment.clone();
        self.set_metadata_json("git_review_comments", &comments)?;
        Ok(value(GitReviewCommentResult { comment: result }))
    }

    pub fn git_review_pull_request_action(
        &self,
        params: GitReviewPullRequestActionParams,
    ) -> Result<AppResponse, RuntimeError> {
        let workspace = resolve_workspace(params.workspace.as_deref())?;
        let root = git_repository_root(&workspace)?
            .ok_or_else(|| RuntimeError::invalid_params("workspace is not a Git repository"))?;
        let body = params
            .body
            .as_deref()
            .map(str::trim)
            .filter(|body| !body.is_empty());
        let args = git_pull_request_args(params.action, body)?;
        let output = command_output_owned("gh", &root, &args)?;
        // coverage:ignore-start -- gh execution is an external CLI boundary; argument and message mapping are tested as pure helpers.
        Ok(value(GitReviewActionResult {
            ok: true,
            message: git_review_action_message(&output),
        }))
        // coverage:ignore-end
    }

    pub fn workspace_file_list(
        &self,
        params: WorkspaceFileListParams,
    ) -> Result<AppResponse, RuntimeError> {
        Ok(value(workspace_file_list_result(params)?))
    }

    pub fn workspace_file_read(
        &self,
        params: WorkspaceFileReadParams,
    ) -> Result<AppResponse, RuntimeError> {
        Ok(value(workspace_file_read_result(params)?))
    }

    pub fn fs_read_directory(
        &self,
        params: FsReadDirectoryParams,
    ) -> Result<AppResponse, RuntimeError> {
        Ok(value(fs_read_directory_result(params)?))
    }

    pub fn fs_get_metadata(
        &self,
        params: FsGetMetadataParams,
    ) -> Result<AppResponse, RuntimeError> {
        Ok(value(fs_get_metadata_result(params)?))
    }

    pub fn git_branch_list(
        &self,
        params: GitBranchListParams,
    ) -> Result<AppResponse, RuntimeError> {
        let root = repository_root_for_workspace(params.workspace.as_deref())?;
        let current =
            git_output_owned(&root, &["branch".to_string(), "--show-current".to_string()])?;
        let output = git_output_owned(
            &root,
            &[
                "for-each-ref".to_string(),
                "--format=%(refname)".to_string(),
                "refs/heads".to_string(),
                "refs/remotes".to_string(),
            ],
        )?;
        let mut seen = BTreeSet::new();
        let branches = output
            .lines()
            .map(str::trim)
            .filter_map(|reference| {
                reference
                    .strip_prefix("refs/heads/")
                    .map(|name| (name, false))
                    .or_else(|| {
                        reference
                            .strip_prefix("refs/remotes/")
                            .map(|name| (name, true))
                    })
            })
            .filter(|(name, _)| !name.is_empty() && !name.ends_with("/HEAD"))
            .filter(|(name, remote)| seen.insert(((*name).to_string(), *remote)))
            .map(|(name, remote)| GitBranchRecord {
                name: name.to_string(),
                current: !remote && name == current.trim(),
                remote,
            })
            .collect();
        Ok(value(GitBranchListResult {
            repository_root: root.display().to_string(),
            branches,
        }))
    }

    pub fn git_branch_checkout(
        &self,
        params: GitBranchCheckoutParams,
    ) -> Result<AppResponse, RuntimeError> {
        let root = repository_root_for_workspace(params.workspace.as_deref())?;
        let branch = validate_branch_name(&root, &params.branch, params.remote)?;
        let args = if params.remote {
            vec![
                "switch".to_string(),
                "--track".to_string(),
                branch.to_string(),
            ]
        } else {
            vec!["switch".to_string(), branch.to_string()]
        };
        git_output_owned(&root, &args)?;
        Ok(value(GitReviewActionResult {
            ok: true,
            message: format!("Checked out {branch}."),
        }))
    }

    pub fn git_branch_create(
        &self,
        params: GitBranchCreateParams,
    ) -> Result<AppResponse, RuntimeError> {
        let root = repository_root_for_workspace(params.workspace.as_deref())?;
        let branch = validate_branch_name(&root, &params.branch, false)?;
        let mut args = vec!["switch".to_string(), "-c".to_string(), branch.to_string()];
        if let Some(base_ref) = validate_optional_ref(params.base_ref.as_deref())? {
            args.push(base_ref.to_string());
        }
        git_output_owned(&root, &args)?;
        Ok(value(GitReviewActionResult {
            ok: true,
            message: format!("Created and checked out {branch}."),
        }))
    }

    pub fn git_worktree_list(
        &self,
        params: GitWorktreeListParams,
    ) -> Result<AppResponse, RuntimeError> {
        let root = repository_root_for_workspace(params.workspace.as_deref())?;
        Ok(value(git_worktree_list_result(&root)?))
    }

    pub fn git_worktree_create(
        &self,
        params: GitWorktreeCreateParams,
    ) -> Result<AppResponse, RuntimeError> {
        let root = repository_root_for_workspace(params.workspace.as_deref())?;
        let branch = params.branch.trim();
        if branch.is_empty() || branch.len() > 240 {
            return Err(RuntimeError::invalid_params("branch is required"));
        }
        git_output_owned(
            &root,
            &[
                "check-ref-format".to_string(),
                "--branch".to_string(),
                branch.to_string(),
            ],
        )?;
        let base_ref = params
            .base_ref
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("HEAD");
        if base_ref.starts_with('-') || base_ref.len() > 240 {
            return Err(RuntimeError::invalid_params("invalid baseRef"));
        }
        let target = worktree_target_path(&root, params.path.as_deref(), branch)?;
        let args = vec![
            "worktree".to_string(),
            "add".to_string(),
            "-b".to_string(),
            branch.to_string(),
            "--".to_string(),
            target.display().to_string(),
            base_ref.to_string(),
        ];
        git_output_owned(&root, &args)?;
        let canonical_target = target.canonicalize().map_err(|error| {
            RuntimeError::invalid_params(format!("created worktree is unavailable: {error}"))
        })?;
        let list = git_worktree_list_result(&root)?;
        let target_display = canonical_target.display().to_string();
        let worktree = list
            .worktrees
            .into_iter()
            .find(|worktree| worktree.path == target_display)
            .unwrap_or(GitWorktreeRecord {
                path: target_display,
                head: None,
                branch: Some(branch.to_string()),
                bare: false,
                detached: false,
                prunable: false,
            });
        Ok(value(GitWorktreeResult {
            repository_root: root.display().to_string(),
            worktree,
            message: "Git worktree created.".to_string(),
        }))
    }

    pub fn git_repository_clone(
        &self,
        params: GitRepositoryCloneParams,
    ) -> Result<AppResponse, RuntimeError> {
        let remote_url = validate_clone_url(&params.remote_url)?;
        let destination = clone_destination_path(&params.destination)?;
        let parent = destination.parent().ok_or_else(|| {
            RuntimeError::invalid_params("clone destination must have a parent directory")
        })?;
        let output = Command::new("git")
            .args(["clone", "--", remote_url])
            .arg(&destination)
            .current_dir(parent)
            .output()
            .map_err(|error| {
                RuntimeError::not_configured(format!("git command unavailable: {error}"))
            })?;
        if !output.status.success() {
            let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(RuntimeError::invalid_params(if detail.is_empty() {
                "git clone failed".to_string()
            } else {
                format!("git clone failed: {detail}")
            }));
        }
        let root = repository_root_for_workspace(Some(&destination.display().to_string()))?;
        Ok(value(GitRepositoryCloneResult {
            repository_root: root.display().to_string(),
            message: "Repository cloned.".to_string(),
        }))
    }

    pub fn github_repository_list(
        &self,
        params: GitHubRepositoryListParams,
    ) -> Result<AppResponse, RuntimeError> {
        let output = Command::new("gh")
            .args([
                "repo",
                "list",
                "--limit",
                "100",
                "--json",
                "nameWithOwner,url,description,isPrivate,updatedAt",
            ])
            .output()
            .map_err(|error| {
                RuntimeError::not_configured(format!("GitHub CLI unavailable: {error}"))
            })?;
        if !output.status.success() {
            let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(RuntimeError::not_configured(if detail.is_empty() {
                "Sign in with GitHub CLI on the paired Mac to browse repositories.".to_string()
            } else {
                detail
            }));
        }
        let query = params
            .query
            .as_deref()
            .map(str::trim)
            .unwrap_or_default()
            .to_lowercase();
        let values: Vec<serde_json::Value> =
            serde_json::from_slice(&output.stdout).map_err(|error| {
                RuntimeError::storage(format!("invalid GitHub repository list: {error}"))
            })?;
        let repositories = values
            .into_iter()
            .filter_map(|value| {
                let name_with_owner = value.get("nameWithOwner")?.as_str()?.to_string();
                let url = value.get("url")?.as_str()?.to_string();
                let description = value
                    .get("description")
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_string);
                if !query.is_empty()
                    && !name_with_owner.to_lowercase().contains(&query)
                    && !description
                        .as_deref()
                        .unwrap_or_default()
                        .to_lowercase()
                        .contains(&query)
                {
                    return None;
                }
                Some(GitHubRepositoryRecord {
                    name_with_owner,
                    url,
                    description,
                    is_private: value
                        .get("isPrivate")
                        .and_then(serde_json::Value::as_bool)
                        .unwrap_or(false),
                    updated_at: value
                        .get("updatedAt")
                        .and_then(serde_json::Value::as_str)
                        .map(str::to_string),
                })
            })
            .take(50)
            .collect();
        Ok(value(GitHubRepositoryListResult { repositories }))
    }

    pub fn git_repository_commit(
        &self,
        params: GitRepositoryCommitParams,
    ) -> Result<AppResponse, RuntimeError> {
        let root = repository_root_for_workspace(params.workspace.as_deref())?;
        let message = params.message.trim();
        if message.is_empty() || message.len() > 4_000 {
            return Err(RuntimeError::invalid_params(
                "commit message must be between 1 and 4000 characters",
            ));
        }
        let status = git_review_status_result(GitReviewStatusParams {
            workspace: Some(root.display().to_string()),
        })?;
        if !status.has_staged_changes {
            return Err(RuntimeError::invalid_params(
                "stage at least one change before committing",
            ));
        }
        git_output_owned(
            &root,
            &["commit".to_string(), "-m".to_string(), message.to_string()],
        )?;
        Ok(value(GitReviewActionResult {
            ok: true,
            message: "Committed staged changes.".to_string(),
        }))
    }

    pub fn git_repository_pull(
        &self,
        params: GitRepositoryActionParams,
    ) -> Result<AppResponse, RuntimeError> {
        let root = repository_root_for_workspace(params.workspace.as_deref())?;
        git_output_owned(&root, &["pull".to_string(), "--ff-only".to_string()])?;
        Ok(value(GitReviewActionResult {
            ok: true,
            message: "Pulled the latest changes.".to_string(),
        }))
    }

    pub fn git_repository_push(
        &self,
        params: GitRepositoryActionParams,
    ) -> Result<AppResponse, RuntimeError> {
        let root = repository_root_for_workspace(params.workspace.as_deref())?;
        let upstream = git_optional_output(
            &root,
            &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
        )?;
        let args = if upstream.is_some() {
            vec!["push".to_string()]
        } else {
            let branch =
                git_optional_output(&root, &["symbolic-ref", "--quiet", "--short", "HEAD"])?
                    .ok_or_else(|| RuntimeError::invalid_params("cannot push a detached HEAD"))?;
            if !git_remote_exists(&root, "origin")? {
                return Err(RuntimeError::invalid_params(
                    "no origin remote is configured for this repository",
                ));
            }
            vec![
                "push".to_string(),
                "--set-upstream".to_string(),
                "origin".to_string(),
                branch,
            ]
        };
        git_output_owned(&root, &args)?;
        Ok(value(GitReviewActionResult {
            ok: true,
            message: "Pushed the current branch.".to_string(),
        }))
    }

    pub fn git_pull_request_create(
        &self,
        params: GitPullRequestCreateParams,
    ) -> Result<AppResponse, RuntimeError> {
        let root = repository_root_for_workspace(params.workspace.as_deref())?;
        let args = git_pull_request_create_args(&params)?;
        let output = command_output_owned("gh", &root, &args)?;
        Ok(value(GitReviewActionResult {
            ok: true,
            message: git_create_action_message(&output),
        }))
    }
}

fn repository_root_for_workspace(workspace: Option<&str>) -> Result<PathBuf, RuntimeError> {
    let workspace = resolve_workspace(workspace)?;
    git_repository_root(&workspace)?
        .ok_or_else(|| RuntimeError::invalid_params("workspace is not a Git repository"))
}

pub(crate) fn mobile_git_repository_root(workspace: &str) -> Result<Option<PathBuf>, RuntimeError> {
    let workspace = resolve_workspace(Some(workspace))?;
    git_repository_root(&workspace)
}

fn validate_branch_name<'a>(
    root: &Path,
    branch: &'a str,
    remote: bool,
) -> Result<&'a str, RuntimeError> {
    let branch = branch.trim();
    if branch.is_empty() || branch.len() > 240 || branch.starts_with('-') {
        return Err(RuntimeError::invalid_params("invalid branch name"));
    }
    let check = if remote {
        branch
            .split_once('/')
            .map(|(_, name)| name)
            .filter(|name| !name.is_empty())
            .ok_or_else(|| RuntimeError::invalid_params("invalid remote branch name"))?
    } else {
        branch
    };
    git_output_owned(
        root,
        &[
            "check-ref-format".to_string(),
            "--branch".to_string(),
            check.to_string(),
        ],
    )?;
    Ok(branch)
}

fn validate_optional_ref(value: Option<&str>) -> Result<Option<&str>, RuntimeError> {
    let value = value.map(str::trim).filter(|value| !value.is_empty());
    if value.is_some_and(|value| value.starts_with('-') || value.len() > 240) {
        return Err(RuntimeError::invalid_params("invalid Git ref"));
    }
    Ok(value)
}

fn git_remote_exists(root: &Path, remote: &str) -> Result<bool, RuntimeError> {
    Ok(git_optional_output(root, &["remote", "get-url", remote])?.is_some())
}

fn git_pull_request_create_args(
    params: &GitPullRequestCreateParams,
) -> Result<Vec<String>, RuntimeError> {
    let title = params
        .title
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let body = params
        .body
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let base = validate_optional_ref(params.base.as_deref())?;
    if title.is_some_and(|value| value.len() > 256) {
        return Err(RuntimeError::invalid_params(
            "pull request title is too long",
        ));
    }
    if body.is_some_and(|value| value.len() > 65_536) {
        return Err(RuntimeError::invalid_params(
            "pull request body is too long",
        ));
    }
    let mut args = vec!["pr".to_string(), "create".to_string()];
    if let Some(title) = title {
        args.extend(["--title".to_string(), title.to_string()]);
        args.extend(["--body".to_string(), body.unwrap_or_default().to_string()]);
    } else {
        args.push("--fill".to_string());
        if let Some(body) = body {
            args.extend(["--body".to_string(), body.to_string()]);
        }
    }
    if let Some(base) = base {
        args.extend(["--base".to_string(), base.to_string()]);
    }
    if params.draft {
        args.push("--draft".to_string());
    }
    Ok(args)
}

fn git_create_action_message(output: &str) -> String {
    let output = output.trim();
    if output.is_empty() {
        "Pull request created.".to_string()
    } else {
        output.to_string()
    }
}

fn git_worktree_list_result(root: &Path) -> Result<GitWorktreeListResult, RuntimeError> {
    let output = git_output_owned(
        root,
        &[
            "worktree".to_string(),
            "list".to_string(),
            "--porcelain".to_string(),
        ],
    )?;
    Ok(GitWorktreeListResult {
        repository_root: root.display().to_string(),
        worktrees: parse_git_worktrees(&output),
    })
}

fn parse_git_worktrees(output: &str) -> Vec<GitWorktreeRecord> {
    let mut worktrees = Vec::new();
    let mut current: Option<GitWorktreeRecord> = None;
    for line in output.lines() {
        let line = line.trim_end();
        if line.is_empty() {
            if let Some(worktree) = current.take() {
                worktrees.push(finalize_git_worktree(worktree));
            }
        } else if let Some(path) = line.strip_prefix("worktree ") {
            if let Some(worktree) = current.replace(GitWorktreeRecord {
                path: path.to_string(),
                head: None,
                branch: None,
                bare: false,
                detached: false,
                prunable: false,
            }) {
                worktrees.push(finalize_git_worktree(worktree));
            }
        } else if let Some(worktree) = current.as_mut() {
            if let Some(head) = line.strip_prefix("HEAD ") {
                worktree.head = Some(head.to_string());
            } else if let Some(branch) = line.strip_prefix("branch ") {
                worktree.branch = Some(
                    branch
                        .strip_prefix("refs/heads/")
                        .unwrap_or(branch)
                        .to_string(),
                );
            } else if line == "bare" {
                worktree.bare = true;
            } else if line == "detached" {
                worktree.detached = true;
            } else if line.starts_with("prunable") {
                worktree.prunable = true;
            }
        }
    }
    if let Some(worktree) = current {
        worktrees.push(finalize_git_worktree(worktree));
    }
    worktrees
}

fn finalize_git_worktree(mut worktree: GitWorktreeRecord) -> GitWorktreeRecord {
    worktree.detached |= worktree.branch.is_none() && !worktree.bare;
    worktree
}

fn worktree_target_path(
    root: &Path,
    requested: Option<&str>,
    branch: &str,
) -> Result<PathBuf, RuntimeError> {
    let target = requested
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(expand_user_path)
        .unwrap_or_else(|| {
            let repository = root
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("worktree");
            let suffix = branch
                .chars()
                .map(|character| {
                    if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.') {
                        character
                    } else {
                        '-'
                    }
                })
                .collect::<String>();
            root.parent()
                .unwrap_or(root)
                .join(format!("{repository}-{}", suffix.trim_matches('-')))
        });
    let target = if target.is_absolute() {
        target
    } else {
        root.parent().unwrap_or(root).join(target)
    };
    if target.exists() {
        return Err(RuntimeError::invalid_params(format!(
            "worktree path already exists: {}",
            target.display()
        )));
    }
    let parent = target
        .parent()
        .ok_or_else(|| RuntimeError::invalid_params("worktree path must have a parent"))?;
    parent.canonicalize().map_err(|error| {
        RuntimeError::invalid_params(format!("worktree parent is unavailable: {error}"))
    })?;
    Ok(target)
}

fn validate_clone_url(value: &str) -> Result<&str, RuntimeError> {
    let value = value.trim();
    let safe_scheme = value.starts_with("https://")
        || value.starts_with("http://")
        || value.starts_with("ssh://")
        || value.starts_with("git@");
    if value.is_empty()
        || value.len() > 2_048
        || value.starts_with('-')
        || value.chars().any(char::is_control)
        || !safe_scheme
    {
        return Err(RuntimeError::invalid_params(
            "remoteUrl must be an HTTP(S) or SSH Git URL",
        ));
    }
    Ok(value)
}

fn clone_destination_path(value: &str) -> Result<PathBuf, RuntimeError> {
    let value = value.trim();
    if value.is_empty() {
        return Err(RuntimeError::invalid_params("destination is required"));
    }
    let destination = expand_user_path(value);
    if destination.exists() {
        return Err(RuntimeError::invalid_params(
            "clone destination already exists",
        ));
    }
    let parent = destination
        .parent()
        .ok_or_else(|| RuntimeError::invalid_params("destination must have a parent directory"))?;
    let parent = parent.canonicalize().map_err(|error| {
        RuntimeError::invalid_params(format!("destination parent is unavailable: {error}"))
    })?;
    let name = destination
        .file_name()
        .ok_or_else(|| RuntimeError::invalid_params("destination must name a directory"))?;
    Ok(parent.join(name))
}

include!("impl_git_review/workspace.rs");
include!("impl_git_review/repository.rs");
include!("impl_git_review/tests.rs");
