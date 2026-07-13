use std::collections::BTreeSet;
use std::fs::{self, File};
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::process::Command;

use crate::protocol::{
    AppResponse, GitReviewActionResult, GitReviewCommentAddParams, GitReviewCommentListParams,
    GitReviewCommentListResult, GitReviewCommentRecord, GitReviewCommentResolveParams,
    GitReviewCommentResult, GitReviewDiffFile, GitReviewDiffParams, GitReviewDiffResult,
    GitReviewFileStatus, GitReviewPullRequest, GitReviewPullRequestAction,
    GitReviewPullRequestActionParams, GitReviewPullRequestReview, GitReviewScope,
    GitReviewStageParams, GitReviewStatusParams, GitReviewStatusResult, WorkspaceFileListParams,
    WorkspaceFileListResult, WorkspaceFileReadParams, WorkspaceFileReadResult,
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
}

fn workspace_file_read_result(
    params: WorkspaceFileReadParams,
) -> Result<WorkspaceFileReadResult, RuntimeError> {
    let workspace = resolve_workspace(params.workspace.as_deref())?;
    let root = workspace;
    let relative = std::path::Path::new(params.path.trim());
    if relative.as_os_str().is_empty()
        || relative.is_absolute()
        || relative.components().any(|component| {
            matches!(
                component,
                std::path::Component::ParentDir
                    | std::path::Component::RootDir
                    | std::path::Component::Prefix(_)
            )
        })
    {
        return Err(RuntimeError::invalid_params(
            "workspace file path must be relative",
        ));
    }
    let candidate = root.join(relative);
    let canonical = candidate
        .canonicalize()
        .map_err(|_| RuntimeError::not_found("workspace file not found"))?;
    let canonical_root = root
        .canonicalize()
        .map_err(|_| RuntimeError::not_found("workspace not found"))?;
    if !canonical.starts_with(&canonical_root) || !canonical.is_file() {
        return Err(RuntimeError::invalid_params(
            "workspace file escapes the workspace",
        ));
    }
    let max_bytes = params
        .max_bytes
        .unwrap_or(DEFAULT_WORKSPACE_READ_MAX_BYTES)
        .clamp(1, HARD_WORKSPACE_READ_MAX_BYTES);
    let mut bytes = Vec::with_capacity(max_bytes.saturating_add(1));
    File::open(&canonical)
        .and_then(|file| {
            file.take(max_bytes.saturating_add(1) as u64)
                .read_to_end(&mut bytes)
        })
        .map_err(|error| RuntimeError::storage(format!("workspace file read failed: {error}")))?;
    let truncated = bytes.len() > max_bytes;
    let visible = &bytes[..bytes.len().min(max_bytes)];
    let (content, binary) = match std::str::from_utf8(visible) {
        Ok(content) => (content.to_string(), false),
        Err(_) => (String::new(), true),
    };
    Ok(WorkspaceFileReadResult {
        workspace: canonical_root.display().to_string(),
        path: relative.to_string_lossy().to_string(),
        content,
        truncated,
        binary,
    })
}

fn workspace_file_list_result(
    params: WorkspaceFileListParams,
) -> Result<WorkspaceFileListResult, RuntimeError> {
    let workspace = resolve_workspace(params.workspace.as_deref())?;
    let workspace_display = workspace.display().to_string();
    let files = if let Some(root) = git_repository_root(&workspace)? {
        let prefix = workspace
            .strip_prefix(&root)
            .ok()
            .filter(|path| !path.as_os_str().is_empty())
            .map(|path| format!("{}/", path.to_string_lossy().replace('\\', "/")));
        let output = git_output_bytes(
            &root,
            &[
                "ls-files",
                "-z",
                "--cached",
                "--others",
                "--exclude-standard",
            ],
        )?; // coverage:ignore-line -- Git workspace listing success is asserted by the repository fixture test.
        String::from_utf8_lossy(&output)
            .split('\0')
            .filter(|path| !path.is_empty())
            .filter_map(|path| {
                prefix.as_deref().map_or_else(
                    || Some(path.to_string()),
                    |prefix| path.strip_prefix(prefix).map(ToOwned::to_owned),
                )
            })
            .collect::<Vec<_>>()
    } else {
        workspace_files_from_disk(&workspace)
    };
    let query = params
        .query
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_ascii_lowercase);
    let limit = params
        .limit
        .unwrap_or(DEFAULT_WORKSPACE_FILE_LIMIT)
        .clamp(1, HARD_WORKSPACE_FILE_LIMIT);
    let mut matches = files
        .into_iter()
        .filter(|path| {
            query
                .as_ref()
                .is_none_or(|query| fuzzy_path_matches(path, query))
        })
        .collect::<Vec<_>>();
    matches.sort_by(|left, right| {
        path_match_rank(left, query.as_deref()).cmp(&path_match_rank(right, query.as_deref()))
    });
    let truncated = matches.len() > limit;
    matches.truncate(limit);
    Ok(WorkspaceFileListResult {
        workspace: workspace_display,
        files: matches,
        truncated,
    })
}

fn workspace_files_from_disk(workspace: &Path) -> Vec<String> {
    const MAX_SCANNED_FILES: usize = 50_000;
    const IGNORED_DIRECTORIES: &[&str] = &[
        ".git",
        ".next",
        ".turbo",
        "node_modules",
        "target",
        "dist",
        "build",
    ];
    let mut files = Vec::new();
    let mut directories = vec![workspace.to_path_buf()];
    while let Some(directory) = directories.pop() {
        // coverage:ignore-start -- directory entries can disappear or become unreadable during a best-effort workspace scan.
        let Ok(entries) = fs::read_dir(&directory) else {
            continue;
        };
        for entry in entries.flatten() {
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            // coverage:ignore-end
            if file_type.is_symlink() {
                continue;
            }
            let path = entry.path();
            if file_type.is_dir() {
                let name = entry.file_name();
                if !IGNORED_DIRECTORIES.contains(&name.to_string_lossy().as_ref()) {
                    directories.push(path);
                }
                continue;
            }
            if !file_type.is_file() {
                continue;
            }
            if let Ok(relative) = path.strip_prefix(workspace) {
                files.push(relative.to_string_lossy().replace('\\', "/"));
            }
            if files.len() >= MAX_SCANNED_FILES {
                return files; // coverage:ignore-line -- defensive hard cap would require creating 50,000 fixture files.
            }
        }
    }
    files
}

fn fuzzy_path_matches(path: &str, query: &str) -> bool {
    let path = path.to_ascii_lowercase();
    if path.contains(query) {
        return true;
    }
    let mut query_chars = query.chars();
    let mut expected = query_chars.next();
    for character in path.chars() {
        if Some(character) == expected {
            expected = query_chars.next();
            if expected.is_none() {
                return true;
            }
        }
    }
    false
}

fn path_match_rank(path: &str, query: Option<&str>) -> (u8, usize, String) {
    let lower = path.to_ascii_lowercase();
    let class = match query {
        Some(query) if lower == query => 0,
        Some(query) if lower.rsplit('/').next() == Some(query) => 1,
        Some(query) if lower.contains(query) => 2,
        Some(_) => 3,
        None => 0,
    };
    (class, path.len(), lower)
}

fn git_review_status_result(
    params: GitReviewStatusParams,
) -> Result<GitReviewStatusResult, RuntimeError> {
    let workspace = resolve_workspace(params.workspace.as_deref())?;
    let workspace_display = workspace.display().to_string();
    let Some(root) = git_repository_root(&workspace)? else {
        return Ok(non_repository_status(workspace_display));
    };

    let status_output = git_output(
        &root,
        &["status", "--porcelain=v1", "--untracked-files=all"],
    )?; // coverage:ignore-line -- git execution failures are covered by the command helper.
    let files = parse_status_output(&status_output);
    let upstream = git_optional_output(
        &root,
        &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    )?; // coverage:ignore-line -- git execution failures are covered by the command helper.
    let base_ref = select_base_ref(&root, None, upstream.as_deref())?;

    Ok(GitReviewStatusResult {
        is_git_repository: true,
        workspace: workspace_display,
        repository_root: Some(root.display().to_string()),
        branch: git_optional_output(&root, &["symbolic-ref", "--quiet", "--short", "HEAD"])?,
        head: git_optional_output(&root, &["rev-parse", "--short", "HEAD"])?,
        upstream,
        base_ref,
        has_staged_changes: files.iter().any(|file| file.staged),
        has_unstaged_changes: files.iter().any(|file| file.unstaged),
        has_untracked_files: files.iter().any(|file| file.untracked),
        pull_request: pull_request_for_workspace(&root),
        files,
        message: "Git repository detected.".to_string(),
    })
}

fn git_review_diff_result(
    params: GitReviewDiffParams,
    last_turn_paths: &[String],
) -> Result<GitReviewDiffResult, RuntimeError> {
    let workspace = resolve_workspace(params.workspace.as_deref())?;
    let workspace_display = workspace.display().to_string();
    let Some(root) = git_repository_root(&workspace)? else {
        return Ok(GitReviewDiffResult {
            is_git_repository: false,
            workspace: workspace_display,
            repository_root: None,
            scope: params.scope,
            base_ref: params.base_ref,
            raw_diff: String::new(),
            files: Vec::new(),
            truncated: false,
            message: "Workspace is not inside a Git repository.".to_string(),
        });
    };

    let upstream = git_optional_output(
        &root,
        &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    )?; // coverage:ignore-line -- git execution failures are covered by the command helper.
    let base_ref = select_base_ref(&root, params.base_ref.as_deref(), upstream.as_deref())?;
    let status_files = parse_status_output(&git_output(
        &root,
        &["status", "--porcelain=v1", "--untracked-files=all"],
    )?); // coverage:ignore-line -- git execution failures are covered by the command helper.
    let mut untracked_paths = status_files
        .iter()
        .filter(|file| file.untracked)
        .map(|file| file.path.clone())
        .collect::<Vec<_>>();
    if params.scope == GitReviewScope::LastTurn {
        untracked_paths.retain(|path| last_turn_paths.iter().any(|candidate| candidate == path));
    }

    let mut raw_diff =
        diff_bytes_for_scope(&root, params.scope, base_ref.as_deref(), last_turn_paths)?;
    if includes_untracked(params.scope) {
        append_untracked_diffs(&root, &untracked_paths, &mut raw_diff);
    }

    let max_bytes = params
        .max_bytes
        .unwrap_or(DEFAULT_DIFF_MAX_BYTES)
        .clamp(1024, HARD_DIFF_MAX_BYTES);
    let truncated = raw_diff.len() > max_bytes;
    if truncated {
        raw_diff.truncate(max_bytes);
    }

    let mut files =
        diff_files_for_scope(&root, params.scope, base_ref.as_deref(), last_turn_paths)?;
    if includes_untracked(params.scope) {
        append_untracked_files(&mut files, &untracked_paths);
    }

    Ok(GitReviewDiffResult {
        is_git_repository: true,
        workspace: workspace_display,
        repository_root: Some(root.display().to_string()),
        scope: params.scope,
        base_ref,
        raw_diff: String::from_utf8_lossy(&raw_diff).into_owned(),
        files,
        truncated,
        message: "Git diff loaded.".to_string(),
    })
}

fn resolve_workspace(workspace: Option<&str>) -> Result<PathBuf, RuntimeError> {
    let path = workspace
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(expand_user_path)
        .map(Ok)
        .unwrap_or_else(std::env::current_dir)
        .map_err(|err| RuntimeError::invalid_params(format!("workspace unavailable: {err}")))?;
    let path = path
        .canonicalize()
        .map_err(|err| RuntimeError::invalid_params(format!("workspace not found: {err}")))?;
    if !path.is_dir() {
        return Err(RuntimeError::invalid_params(
            "workspace must be an existing directory",
        ));
    }
    Ok(path)
}

fn canonical_review_workspace(workspace: Option<&str>) -> Result<String, RuntimeError> {
    let workspace = resolve_workspace(workspace)?;
    let root = git_repository_root(&workspace)?
        .ok_or_else(|| RuntimeError::invalid_params("workspace is not a Git repository"))?;
    Ok(root.display().to_string())
}

fn validate_git_paths(paths: &[String]) -> Result<Vec<String>, RuntimeError> {
    if paths.is_empty() {
        return Err(RuntimeError::invalid_params(
            "at least one Git path is required",
        ));
    }
    if paths.len() > 200 {
        return Err(RuntimeError::invalid_params(
            "Git review actions are limited to 200 paths",
        ));
    }
    let mut validated = Vec::with_capacity(paths.len());
    for path in paths {
        let path = path.trim();
        let relative = Path::new(path);
        if !is_safe_relative_git_path(relative) || path == ".git" || path.starts_with(".git/") {
            return Err(RuntimeError::invalid_params(format!(
                "invalid Git review path `{path}`"
            )));
        }
        if !validated.iter().any(|existing| existing == path) {
            validated.push(path.to_string());
        }
    }
    Ok(validated)
}

fn unique_review_comment_id(comments: &[GitReviewCommentRecord], now: u64) -> String {
    let base = format!("review-comment-{now}");
    if !comments.iter().any(|comment| comment.id == base) {
        return base;
    }
    let mut suffix = 2;
    loop {
        let candidate = format!("{base}-{suffix}");
        if !comments.iter().any(|comment| comment.id == candidate) {
            return candidate;
        }
        suffix += 1;
    }
}

fn git_pull_request_args(
    action: GitReviewPullRequestAction,
    body: Option<&str>,
) -> Result<Vec<String>, RuntimeError> {
    let mut args = vec!["pr".to_string()];
    match action {
        GitReviewPullRequestAction::MarkReady => args.push("ready".to_string()),
        GitReviewPullRequestAction::Comment => {
            let body =
                body.ok_or_else(|| RuntimeError::invalid_params("review body is required"))?;
            args.extend(["review", "--comment", "--body"].map(str::to_string));
            args.push(body.to_string());
        }
        GitReviewPullRequestAction::Approve => {
            args.extend(["review", "--approve"].map(str::to_string));
            if let Some(body) = body {
                args.extend(["--body".to_string(), body.to_string()]);
            }
        }
        GitReviewPullRequestAction::RequestChanges => {
            let body =
                body.ok_or_else(|| RuntimeError::invalid_params("review body is required"))?;
            args.extend(["review", "--request-changes", "--body"].map(str::to_string));
            args.push(body.to_string());
        }
    }
    Ok(args)
}

fn git_review_action_message(output: &str) -> String {
    let output = output.trim();
    if output.is_empty() {
        "Pull request action completed.".to_string()
    } else {
        output.to_string()
    }
}

fn paths_from_turn_items(items: &[crate::protocol::ThreadItemRecord]) -> Vec<String> {
    let mut paths = BTreeSet::new();
    for item in items {
        collect_paths_from_value(&item.content, None, &mut paths);
    }
    paths.into_iter().collect()
}

fn collect_paths_from_value(
    value: &serde_json::Value,
    key: Option<&str>,
    paths: &mut BTreeSet<String>,
) {
    match value {
        serde_json::Value::String(candidate)
            if key.is_some_and(|key| {
                matches!(
                    key,
                    "path" | "file" | "filePath" | "file_path" | "relativePath" | "relative_path"
                )
            }) && is_safe_relative_git_path(Path::new(candidate)) =>
        {
            paths.insert(candidate.clone());
        }
        serde_json::Value::Array(values) => {
            for value in values {
                collect_paths_from_value(value, key, paths);
            }
        }
        serde_json::Value::Object(values) => {
            for (key, value) in values {
                collect_paths_from_value(value, Some(key), paths);
            }
        }
        _ => {}
    }
}

fn git_repository_root(workspace: &Path) -> Result<Option<PathBuf>, RuntimeError> {
    let Some(output) = git_optional_output(workspace, &["rev-parse", "--show-toplevel"])? else {
        return Ok(None);
    };
    Ok(Some(PathBuf::from(output)))
}

fn non_repository_status(workspace: String) -> GitReviewStatusResult {
    GitReviewStatusResult {
        is_git_repository: false,
        workspace,
        repository_root: None,
        branch: None,
        head: None,
        upstream: None,
        base_ref: None,
        has_staged_changes: false,
        has_unstaged_changes: false,
        has_untracked_files: false,
        pull_request: None,
        files: Vec::new(),
        message: "Workspace is not inside a Git repository.".to_string(),
    }
}

fn select_base_ref(
    root: &Path,
    requested: Option<&str>,
    upstream: Option<&str>,
) -> Result<Option<String>, RuntimeError> {
    if let Some(value) = requested.map(str::trim).filter(|value| !value.is_empty()) {
        if git_ref_exists(root, value)? {
            return Ok(Some(value.to_string()));
        }
        return Err(RuntimeError::invalid_params(format!(
            "base ref `{value}` was not found"
        )));
    }

    for candidate in upstream
        .into_iter()
        .chain(["origin/main", "origin/master", "main", "master"])
    {
        if git_ref_exists(root, candidate)? {
            return Ok(Some(candidate.to_string()));
        }
    }
    Ok(None)
}

fn git_ref_exists(root: &Path, value: &str) -> Result<bool, RuntimeError> {
    git_success(root, &["rev-parse", "--verify", "--quiet", value])
}

fn diff_bytes_for_scope(
    root: &Path,
    scope: GitReviewScope,
    base_ref: Option<&str>,
    last_turn_paths: &[String],
) -> Result<Vec<u8>, RuntimeError> {
    match scope {
        GitReviewScope::Staged => git_output_bytes(root, &["diff", "--cached", "--"]),
        GitReviewScope::Unstaged => git_output_bytes(root, &["diff", "--"]),
        GitReviewScope::Uncommitted => {
            if git_ref_exists(root, "HEAD")? {
                git_output_bytes(root, &["diff", "HEAD", "--"])
            } else {
                let mut output = git_output_bytes(root, &["diff", "--cached", "--"])?;
                output.extend(git_output_bytes(root, &["diff", "--"])?);
                Ok(output)
            }
        }
        GitReviewScope::AllBranchChanges => {
            let Some(base) = base_ref else {
                return Ok(Vec::new());
            };
            let diff_base = git_optional_output(root, &["merge-base", "HEAD", base])?
                .unwrap_or_else(|| base.to_string());
            git_output_bytes(root, &["diff", diff_base.as_str(), "--"])
        }
        GitReviewScope::LastTurn => {
            if last_turn_paths.is_empty() {
                return Ok(Vec::new());
            }
            let mut args = if git_ref_exists(root, "HEAD")? {
                vec!["diff".to_string(), "HEAD".to_string(), "--".to_string()]
            } else {
                vec!["diff".to_string(), "--".to_string()]
            };
            args.extend(validate_git_paths(last_turn_paths)?);
            git_output_owned_bytes(root, &args)
        }
    }
}

fn diff_files_for_scope(
    root: &Path,
    scope: GitReviewScope,
    base_ref: Option<&str>,
    last_turn_paths: &[String],
) -> Result<Vec<GitReviewDiffFile>, RuntimeError> {
    let output = match scope {
        GitReviewScope::Staged => {
            git_output(root, &["diff", "--cached", "--name-status", "-M", "--"])?
        }
        GitReviewScope::Unstaged => git_output(root, &["diff", "--name-status", "-M", "--"])?,
        GitReviewScope::Uncommitted => {
            if git_ref_exists(root, "HEAD")? {
                git_output(root, &["diff", "--name-status", "-M", "HEAD", "--"])?
            } else {
                let staged = git_output(root, &["diff", "--cached", "--name-status", "-M", "--"])?;
                let unstaged = git_output(root, &["diff", "--name-status", "-M", "--"])?;
                format!("{staged}{unstaged}")
            }
        }
        GitReviewScope::AllBranchChanges => {
            let Some(base) = base_ref else {
                return Ok(Vec::new());
            };
            let diff_base = git_optional_output(root, &["merge-base", "HEAD", base])?
                .unwrap_or_else(|| base.to_string());
            git_output(
                root,
                &["diff", "--name-status", "-M", diff_base.as_str(), "--"],
            )? // coverage:ignore-line -- git execution failures are covered by the command helper.
        }
        GitReviewScope::LastTurn => {
            if last_turn_paths.is_empty() {
                return Ok(Vec::new());
            }
            let mut args = if git_ref_exists(root, "HEAD")? {
                vec![
                    "diff".to_string(),
                    "--name-status".to_string(),
                    "-M".to_string(),
                    "HEAD".to_string(),
                    "--".to_string(),
                ]
            } else {
                vec![
                    "diff".to_string(),
                    "--name-status".to_string(),
                    "-M".to_string(),
                    "--".to_string(),
                ]
            };
            args.extend(validate_git_paths(last_turn_paths)?);
            git_output_owned(root, &args)?
        }
    };
    Ok(parse_name_status_output(&output))
}

fn includes_untracked(scope: GitReviewScope) -> bool {
    matches!(
        scope,
        GitReviewScope::Uncommitted
            | GitReviewScope::Unstaged
            | GitReviewScope::AllBranchChanges
            | GitReviewScope::LastTurn
    )
}

fn append_untracked_files(files: &mut Vec<GitReviewDiffFile>, paths: &[String]) {
    let mut seen = files
        .iter()
        .map(|file| file.path.clone())
        .collect::<BTreeSet<_>>();
    for path in paths {
        if seen.insert(path.clone()) {
            files.push(GitReviewDiffFile {
                path: path.clone(),
                old_path: None,
                status: "A".to_string(),
            });
        }
    }
}

fn append_untracked_diffs(root: &Path, paths: &[String], output: &mut Vec<u8>) {
    for path in paths {
        let diff = synthetic_untracked_diff(root, path);
        if diff.is_empty() {
            continue;
        }
        if !output.is_empty() && !output.ends_with(b"\n") {
            output.push(b'\n');
        }
        output.extend(diff);
    }
}

fn synthetic_untracked_diff(root: &Path, path: &str) -> Vec<u8> {
    let relative = Path::new(path);
    if !is_safe_relative_git_path(relative) {
        return Vec::new();
    }

    let absolute = root.join(path);
    let Ok(metadata) = fs::symlink_metadata(&absolute) else {
        return Vec::new();
    };
    if metadata.file_type().is_symlink() {
        return synthetic_untracked_symlink_diff(&absolute, path);
    }
    if !metadata.is_file() {
        return Vec::new();
    }
    let Ok(canonical_root) = root.canonicalize() else {
        return Vec::new(); // coverage:ignore-line -- only a filesystem race can invalidate the root here.
    };
    let Ok(canonical_file) = absolute.canonicalize() else {
        return Vec::new(); // coverage:ignore-line -- only a filesystem race can invalidate the file here.
    };
    if !canonical_file.starts_with(&canonical_root) {
        return Vec::new(); // coverage:ignore-line -- symlinks are handled before containment validation.
    }

    let mut data = Vec::new();
    let Ok(file) = File::open(&canonical_file) else {
        return Vec::new(); // coverage:ignore-line -- only a filesystem race can make the file unreadable here.
    };
    let _ = file
        .take((DEFAULT_DIFF_MAX_BYTES + 1) as u64)
        .read_to_end(&mut data);
    synthetic_untracked_file_diff(path, "100644", &data)
}

fn synthetic_untracked_symlink_diff(absolute: &Path, path: &str) -> Vec<u8> {
    let Ok(target) = fs::read_link(absolute) else {
        return Vec::new(); // coverage:ignore-line -- only a filesystem race can invalidate the symlink here.
    };
    synthetic_untracked_file_diff(path, "120000", target.to_string_lossy().as_bytes())
}

fn synthetic_untracked_file_diff(path: &str, mode: &str, data: &[u8]) -> Vec<u8> {
    if data.contains(&0) || std::str::from_utf8(data).is_err() {
        return format!(
            "diff --git a/{path} b/{path}\nnew file mode {mode}\n--- /dev/null\n+++ b/{path}\nBinary files /dev/null and b/{path} differ\n"
        )
        .into_bytes();
    }

    let text = String::from_utf8_lossy(data);
    let line_count = text.lines().count();
    let mut diff = format!(
        "diff --git a/{path} b/{path}\nnew file mode {mode}\n--- /dev/null\n+++ b/{path}\n"
    )
    .into_bytes();
    if line_count == 0 {
        return diff;
    }
    diff.extend(format!("@@ -0,0 +1,{line_count} @@\n").as_bytes());
    for line in text.split_inclusive('\n') {
        diff.push(b'+');
        diff.extend(line.as_bytes());
        if !line.ends_with('\n') {
            diff.extend(b"\n\\ No newline at end of file\n");
        }
    }
    diff
}

fn is_safe_relative_git_path(path: &Path) -> bool {
    !path.as_os_str().is_empty()
        && !path.is_absolute()
        && path
            .components()
            .all(|component| matches!(component, Component::Normal(_) | Component::CurDir))
}

fn parse_status_output(output: &str) -> Vec<GitReviewFileStatus> {
    output
        .lines()
        .filter_map(parse_status_line)
        .collect::<Vec<_>>()
}

fn parse_status_line(line: &str) -> Option<GitReviewFileStatus> {
    if line.len() < 3 {
        return None;
    }
    let bytes = line.as_bytes();
    let index = bytes[0] as char;
    let worktree = bytes[1] as char;
    let path_value = line[3..].trim();
    let (old_path, path) = split_rename_path(path_value);
    let untracked = index == '?' && worktree == '?';
    let staged = !untracked && index != ' ';
    let unstaged = untracked || worktree != ' ';

    Some(GitReviewFileStatus {
        path: path.to_string(),
        old_path: old_path.map(str::to_string),
        index_status: status_char(index),
        worktree_status: status_char(worktree),
        staged,
        unstaged,
        untracked,
    })
}

fn split_rename_path(value: &str) -> (Option<&str>, &str) {
    value
        .split_once(" -> ")
        .map(|(old_path, path)| (Some(old_path), path))
        .unwrap_or((None, value))
}

fn status_char(value: char) -> Option<String> {
    if value == ' ' {
        None
    } else {
        Some(value.to_string())
    }
}

fn pull_request_for_workspace(root: &Path) -> Option<GitReviewPullRequest> {
    let output = Command::new("gh")
        .args([
            "pr",
            "view",
            "--json",
            "number,title,url,state,headRefName,baseRefName,isDraft,reviewDecision,comments,latestReviews,files",
        ])
        .current_dir(root)
        .output()
        .ok()?;
    parse_pull_request_command_output(output.status.success(), &output.stdout)
}

fn parse_pull_request_command_output(success: bool, stdout: &[u8]) -> Option<GitReviewPullRequest> {
    if !success {
        return None;
    }
    parse_pull_request_json(stdout)
}

fn parse_pull_request_json(data: &[u8]) -> Option<GitReviewPullRequest> {
    let value: serde_json::Value = serde_json::from_slice(data).ok()?;
    let number = value.get("number")?.as_u64()?;
    let title = json_string(&value, "title")?;
    let url = json_string(&value, "url")?;
    let comments = value
        .get("comments")
        .and_then(serde_json::Value::as_array)
        .map_or(0, Vec::len);
    let latest_reviews = value
        .get("latestReviews")
        .and_then(serde_json::Value::as_array)
        .map(|reviews| {
            reviews
                .iter()
                .take(5)
                .map(parse_pull_request_review)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let review_count = latest_reviews.len();
    let changed_file_count = value
        .get("files")
        .and_then(serde_json::Value::as_array)
        .map_or(0, Vec::len);

    Some(GitReviewPullRequest {
        number,
        title,
        url,
        state: json_string(&value, "state"),
        head_ref_name: json_string(&value, "headRefName"),
        base_ref_name: json_string(&value, "baseRefName"),
        is_draft: value
            .get("isDraft")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false),
        review_decision: json_string(&value, "reviewDecision"),
        comment_count: comments,
        review_count,
        changed_file_count,
        latest_reviews,
    })
}

fn parse_pull_request_review(value: &serde_json::Value) -> GitReviewPullRequestReview {
    GitReviewPullRequestReview {
        author: value
            .get("author")
            .and_then(|author| json_string(author, "login")),
        state: json_string(value, "state"),
        submitted_at: json_string(value, "submittedAt"),
        body: json_string(value, "body").map(|body| truncate_review_body(&body)),
    }
}

fn truncate_review_body(value: &str) -> String {
    const LIMIT: usize = 500;
    if value.len() <= LIMIT {
        return value.to_string();
    }
    let mut end = LIMIT;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}...", &value[..end])
}

fn json_string(value: &serde_json::Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn parse_name_status_output(output: &str) -> Vec<GitReviewDiffFile> {
    let mut seen = BTreeSet::new();
    output
        .lines()
        .filter_map(parse_name_status_line)
        .filter(|file| seen.insert(file.path.clone()))
        .collect()
}

fn parse_name_status_line(line: &str) -> Option<GitReviewDiffFile> {
    let mut parts = line.split('\t').collect::<Vec<_>>();
    if parts.len() < 2 {
        parts = line.split_whitespace().collect::<Vec<_>>();
    }
    let status = parts.first()?.to_string();
    let is_rename_or_copy = status.starts_with('R') || status.starts_with('C');
    if is_rename_or_copy && parts.len() >= 3 {
        return Some(GitReviewDiffFile {
            path: parts[2].to_string(),
            old_path: Some(parts[1].to_string()),
            status,
        });
    }
    Some(GitReviewDiffFile {
        path: parts.get(1)?.to_string(),
        old_path: None,
        status,
    })
}

fn git_optional_output(root: &Path, args: &[&str]) -> Result<Option<String>, RuntimeError> {
    let output = git_command(root, args)?;
    if !output.status.success() {
        return Ok(None);
    }
    let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if value.is_empty() {
        Ok(None)
    } else {
        Ok(Some(value))
    }
}

fn git_output(root: &Path, args: &[&str]) -> Result<String, RuntimeError> {
    let output = git_command(root, args)?;
    if !output.status.success() {
        return Err(git_error(args, &output.stderr));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn git_output_bytes(root: &Path, args: &[&str]) -> Result<Vec<u8>, RuntimeError> {
    let output = git_command(root, args)?;
    if !output.status.success() {
        return Err(git_error(args, &output.stderr));
    }
    Ok(output.stdout)
}

fn git_output_owned(root: &Path, args: &[String]) -> Result<String, RuntimeError> {
    let output = Command::new("git")
        .arg("-c")
        .arg("core.quotePath=false")
        .args(args)
        .current_dir(root)
        .output()
        .map_err(|err| RuntimeError::not_configured(format!("git command unavailable: {err}")))?;
    if !output.status.success() {
        return Err(command_error("git", args, &output.stderr));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn git_output_owned_bytes(root: &Path, args: &[String]) -> Result<Vec<u8>, RuntimeError> {
    let output = Command::new("git")
        .arg("-c")
        .arg("core.quotePath=false")
        .args(args)
        .current_dir(root)
        .output()
        .map_err(|err| RuntimeError::not_configured(format!("git command unavailable: {err}")))?;
    if !output.status.success() {
        return Err(command_error("git", args, &output.stderr));
    }
    Ok(output.stdout)
}

fn command_output_owned(
    program: &str,
    root: &Path,
    args: &[String],
) -> Result<String, RuntimeError> {
    let output = Command::new(program)
        .args(args)
        .current_dir(root)
        .output()
        .map_err(|err| {
            RuntimeError::not_configured(format!("{program} command unavailable: {err}"))
        })?;
    if !output.status.success() {
        return Err(command_error(program, args, &output.stderr));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn command_error(program: &str, args: &[String], stderr: &[u8]) -> RuntimeError {
    let detail = String::from_utf8_lossy(stderr).trim().to_string();
    let command = args.join(" ");
    if detail.is_empty() {
        RuntimeError::invalid_params(format!("{program} {command} failed"))
    } else {
        RuntimeError::invalid_params(format!("{program} {command} failed: {detail}"))
    }
}

fn git_success(root: &Path, args: &[&str]) -> Result<bool, RuntimeError> {
    Ok(git_command(root, args)?.status.success())
}

fn git_command(root: &Path, args: &[&str]) -> Result<std::process::Output, RuntimeError> {
    Command::new("git")
        .arg("-c")
        .arg("core.quotePath=false")
        .args(args)
        .current_dir(root)
        .output()
        .map_err(|err| RuntimeError::not_configured(format!("git command unavailable: {err}")))
}

fn git_error(args: &[&str], stderr: &[u8]) -> RuntimeError {
    let detail = String::from_utf8_lossy(stderr).trim().to_string();
    let command = args.join(" ");
    if detail.is_empty() {
        RuntimeError::invalid_params(format!("git {command} failed"))
    } else {
        RuntimeError::invalid_params(format!("git {command} failed: {detail}"))
    }
}

#[cfg(test)]
mod pull_request_tests {
    use std::fs;
    use std::process::Command;
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;

    static TEST_SEQUENCE: AtomicUsize = AtomicUsize::new(0);

    #[test]
    fn parse_pull_request_json_summarizes_github_context() {
        let raw = br#"{
          "number": 42,
          "title": "Wire desktop review pane",
          "url": "https://github.com/taskforceai/taskforceai/pull/42",
          "state": "OPEN",
          "headRefName": "codex/review-pane",
          "baseRefName": "main",
          "isDraft": false,
          "reviewDecision": "CHANGES_REQUESTED",
          "comments": [{ "body": "thread note" }],
          "files": [{ "path": "apps/desktop/src/main.rs" }],
          "latestReviews": [
            {
              "author": { "login": "reviewer" },
              "state": "CHANGES_REQUESTED",
              "submittedAt": "2026-07-04T12:00:00Z",
              "body": "Please tighten the tests."
            }
          ]
        }"#;

        let pull_request = parse_pull_request_json(raw).expect("pull request should parse");

        assert_eq!(pull_request.number, 42);
        assert_eq!(pull_request.title, "Wire desktop review pane");
        assert_eq!(
            pull_request.review_decision.as_deref(),
            Some("CHANGES_REQUESTED")
        );
        assert_eq!(pull_request.comment_count, 1);
        assert_eq!(pull_request.review_count, 1);
        assert_eq!(pull_request.changed_file_count, 1);
        assert_eq!(
            pull_request.latest_reviews[0].author.as_deref(),
            Some("reviewer")
        );
    }

    #[test]
    fn git_review_helpers_cover_parsing_and_synthetic_diff_edges() {
        assert!(parse_status_line("??").is_none());
        let renamed =
            parse_name_status_line("R100\told.txt\tnew.txt").expect("rename status should parse");
        assert_eq!(renamed.path, "new.txt");
        assert_eq!(renamed.old_path.as_deref(), Some("old.txt"));
        assert_eq!(renamed.status, "R100");
        assert_eq!(
            parse_name_status_line("M changed.txt")
                .expect("whitespace status should parse")
                .path,
            "changed.txt"
        );

        let long_review = format!("{}🧪", "a".repeat(499));
        let truncated = truncate_review_body(&long_review);
        assert!(truncated.ends_with("..."));
        assert!(truncated.is_char_boundary(truncated.len()));

        let binary = synthetic_untracked_file_diff("binary.dat", "100644", b"a\0b");
        assert!(String::from_utf8_lossy(&binary).contains("Binary files"));
        let empty = synthetic_untracked_file_diff("empty.txt", "100644", b"");
        assert!(!String::from_utf8_lossy(&empty).contains("@@"));

        let root = test_root("synthetic-edges");
        fs::write(root.join("note.txt"), "note\n").expect("write note");
        let mut output = b"existing".to_vec();
        append_untracked_diffs(
            &root,
            &[
                "../unsafe".to_string(),
                "missing.txt".to_string(),
                "note.txt".to_string(),
            ],
            &mut output,
        );
        let rendered = String::from_utf8_lossy(&output);
        assert!(rendered.starts_with("existing\n"));
        assert!(rendered.contains("diff --git a/note.txt"));
        assert!(synthetic_untracked_diff(&root, ".").is_empty());

        let mut files = vec![GitReviewDiffFile {
            path: "note.txt".to_string(),
            old_path: None,
            status: "M".to_string(),
        }];
        append_untracked_files(&mut files, &["note.txt".to_string(), "new.txt".to_string()]);
        assert_eq!(files.len(), 2);
        assert!(fuzzy_path_matches("docs/readme.md", "readme"));
        let mut paths = BTreeSet::new();
        collect_paths_from_value(
            &serde_json::json!({
                "files": [{"path": "src/main.rs"}, {"other": true}],
                "filePath": ["src/lib.rs", "../unsafe"],
                "ignored": 7
            }),
            None,
            &mut paths,
        );
        assert_eq!(
            paths.into_iter().collect::<Vec<_>>(),
            vec!["src/lib.rs", "src/main.rs"]
        );
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn git_review_helpers_cover_refs_empty_repositories_and_command_errors() {
        let repo = initialized_repo("refs", "topic");
        assert_eq!(
            select_base_ref(&repo, Some(" HEAD "), None).expect("HEAD should resolve"),
            Some("HEAD".to_string())
        );
        assert!(select_base_ref(&repo, Some("missing-ref"), None).is_err());
        assert_eq!(
            select_base_ref(&repo, None, None).expect("fallbacks should resolve"),
            None
        );

        let file = repo.join("not-a-directory");
        fs::write(&file, "file").expect("write file");
        assert!(resolve_workspace(file.to_str()).is_err());

        assert_eq!(
            git_optional_output(&repo, &["diff", "--quiet"])
                .expect("empty output should be accepted"),
            None
        );
        assert!(git_output(&repo, &["definitely-not-a-git-command"]).is_err());
        assert!(git_output_bytes(&repo, &["definitely-not-a-git-command"]).is_err());
        assert!(git_error(&["status"], b"")
            .message
            .contains("git status failed"));

        let empty_repo = test_root("empty-repo");
        run_git(&empty_repo, &["init", "-b", "topic"]);
        fs::write(empty_repo.join("staged.txt"), "staged\n").expect("write staged");
        run_git(&empty_repo, &["add", "staged.txt"]);
        fs::write(empty_repo.join("unstaged.txt"), "unstaged\n").expect("write unstaged");

        let bytes = diff_bytes_for_scope(&empty_repo, GitReviewScope::Uncommitted, None, &[])
            .expect("unborn diff bytes should load");
        assert!(String::from_utf8_lossy(&bytes).contains("staged"));
        let files = diff_files_for_scope(&empty_repo, GitReviewScope::Uncommitted, None, &[])
            .expect("unborn diff files should load");
        assert!(files.iter().any(|file| file.path == "staged.txt"));
        fs::write(empty_repo.join("staged.txt"), "staged and changed\n")
            .expect("modify staged file");
        assert!(!diff_bytes_for_scope(
            &empty_repo,
            GitReviewScope::LastTurn,
            None,
            &["staged.txt".to_string()],
        )
        .expect("unborn last-turn bytes")
        .is_empty());
        assert_eq!(
            diff_files_for_scope(
                &empty_repo,
                GitReviewScope::LastTurn,
                None,
                &["staged.txt".to_string()],
            )
            .expect("unborn last-turn files")[0]
                .path,
            "staged.txt"
        );
        assert!(
            diff_bytes_for_scope(&repo, GitReviewScope::AllBranchChanges, None, &[])
                .expect("missing base should be empty")
                .is_empty()
        );
        assert!(
            diff_files_for_scope(&repo, GitReviewScope::AllBranchChanges, None, &[])
                .expect("missing base should be empty")
                .is_empty()
        );
        assert!(
            diff_bytes_for_scope(&repo, GitReviewScope::AllBranchChanges, Some("HEAD"), &[])
                .expect("branch diff bytes should load")
                .is_empty()
        );
        assert!(
            diff_files_for_scope(&repo, GitReviewScope::AllBranchChanges, Some("HEAD"), &[])
                .expect("branch diff files should load")
                .is_empty()
        );

        fs::remove_dir_all(repo).ok();
        fs::remove_dir_all(empty_repo).ok();
    }

    #[test]
    fn git_review_diff_truncates_large_untracked_content() {
        let repo = initialized_repo("truncation", "topic");
        fs::write(repo.join("large.txt"), "x".repeat(4096)).expect("write large file");

        let result = git_review_diff_result(
            GitReviewDiffParams {
                workspace: Some(repo.display().to_string()),
                scope: GitReviewScope::Uncommitted,
                base_ref: None,
                max_bytes: Some(1024),
                thread_id: None,
            },
            &[],
        )
        .expect("diff should load");

        assert!(result.truncated);
        assert_eq!(result.raw_diff.len(), 1024);
        assert!(result.files.iter().any(|file| file.path == "large.txt"));
        fs::remove_dir_all(repo).ok();
    }

    #[test]
    fn pull_request_command_output_requires_success() {
        let raw = br#"{
          "number": 7,
          "title": "Review",
          "url": "https://github.com/taskforceai/taskforceai/pull/7"
        }"#;

        assert!(parse_pull_request_command_output(false, raw).is_none());
        assert_eq!(
            parse_pull_request_command_output(true, raw)
                .expect("successful output should parse")
                .number,
            7
        );
    }

    #[test]
    fn workspace_file_read_is_bounded_and_rejects_traversal() {
        let repo = initialized_repo("workspace-read", "topic");
        fs::write(repo.join("preview.txt"), "abcdef").expect("write preview");

        let result = workspace_file_read_result(WorkspaceFileReadParams {
            workspace: Some(repo.display().to_string()),
            path: "preview.txt".to_string(),
            max_bytes: Some(4),
        })
        .expect("workspace file should load");
        assert_eq!(result.content, "abcd");
        assert!(result.truncated);
        assert!(!result.binary);

        let traversal = workspace_file_read_result(WorkspaceFileReadParams {
            workspace: Some(repo.display().to_string()),
            path: "../outside.txt".to_string(),
            max_bytes: None,
        })
        .expect_err("parent traversal must fail");
        assert_eq!(traversal.code, -32602);
        fs::remove_dir_all(repo).ok();
    }

    #[test]
    fn review_comments_validate_round_trip_and_resolve() {
        let repo = initialized_repo("comments", "topic");
        let mut runtime = crate::runtime::AppRuntime::new(crate::runtime::RuntimeConfig::default());
        for (line, end_line, body) in [
            (0, None, "body".to_string()),
            (2, Some(1), "body".to_string()),
            (1, None, " ".to_string()),
            (1, None, "x".repeat(8_001)),
        ] {
            assert!(runtime
                .git_review_comment_add(GitReviewCommentAddParams {
                    workspace: Some(repo.display().to_string()),
                    path: "tracked.txt".to_string(),
                    line,
                    end_line,
                    body,
                })
                .is_err());
        }

        let added = runtime
            .git_review_comment_add(GitReviewCommentAddParams {
                workspace: Some(repo.display().to_string()),
                path: "tracked.txt".to_string(),
                line: 1,
                end_line: Some(1),
                body: " Check this line ".to_string(),
            })
            .expect("add review comment");
        let AppResponse::Value(added) = added else {
            panic!("expected value response"); // coverage:ignore-line -- infallible response shape assertion.
        };
        let comment_id = added["comment"]["id"]
            .as_str()
            .expect("comment id")
            .to_string();
        let listed = runtime
            .git_review_comment_list(GitReviewCommentListParams {
                workspace: Some(repo.display().to_string()),
            })
            .expect("list review comments");
        let AppResponse::Value(listed) = listed else {
            panic!("expected value response"); // coverage:ignore-line -- infallible response shape assertion.
        };
        assert_eq!(listed["comments"].as_array().expect("comments").len(), 1);
        runtime
            .git_review_comment_resolve(GitReviewCommentResolveParams {
                comment_id,
                resolved: true,
            })
            .expect("resolve comment");
        assert!(runtime
            .git_review_comment_resolve(GitReviewCommentResolveParams {
                comment_id: "missing".to_string(),
                resolved: true,
            })
            .is_err());
        fs::remove_dir_all(repo).ok();
    }

    #[test]
    fn stage_and_last_turn_validation_cover_unborn_repository_paths() {
        let root = test_root("unborn-stage");
        run_git(&root, &["init", "-b", "topic"]);
        fs::write(root.join("new.txt"), "new\n").expect("write new file");
        let runtime = crate::runtime::AppRuntime::new(crate::runtime::RuntimeConfig::default());
        runtime
            .git_review_stage(GitReviewStageParams {
                workspace: Some(root.display().to_string()),
                paths: vec!["new.txt".to_string()],
                staged: true,
            })
            .expect("stage file");
        runtime
            .git_review_stage(GitReviewStageParams {
                workspace: Some(root.display().to_string()),
                paths: vec!["new.txt".to_string()],
                staged: false,
            })
            .expect("unstage unborn file");
        assert!(runtime
            .git_review_diff(GitReviewDiffParams {
                workspace: Some(root.display().to_string()),
                scope: GitReviewScope::LastTurn,
                base_ref: None,
                max_bytes: None,
                thread_id: None,
            })
            .is_err());
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn workspace_disk_listing_binary_reads_and_path_helpers_cover_edges() {
        let root = test_root("workspace-disk");
        fs::create_dir_all(root.join("src/nested")).expect("create nested directory");
        fs::create_dir_all(root.join("node_modules/pkg")).expect("create ignored directory");
        fs::write(root.join("src/nested/alpha.rs"), "fn alpha() {}\n").expect("write source");
        fs::write(root.join("binary.dat"), [0xff, 0xfe]).expect("write binary");
        fs::write(root.join("node_modules/pkg/ignored.js"), "ignored").expect("write ignored");

        let listed = workspace_file_list_result(WorkspaceFileListParams {
            workspace: Some(root.display().to_string()),
            query: Some("snar".to_string()),
            limit: Some(10),
        })
        .expect("list disk files");
        assert_eq!(listed.files, vec!["src/nested/alpha.rs"]);
        let binary = workspace_file_read_result(WorkspaceFileReadParams {
            workspace: Some(root.display().to_string()),
            path: "binary.dat".to_string(),
            max_bytes: None,
        })
        .expect("read binary");
        assert!(binary.binary);
        assert!(binary.content.is_empty());
        assert!(workspace_file_read_result(WorkspaceFileReadParams {
            workspace: Some(root.display().to_string()),
            path: "src".to_string(),
            max_bytes: None,
        })
        .is_err());

        assert!(validate_git_paths(&[]).is_err());
        assert!(validate_git_paths(&vec!["file".to_string(); 201]).is_err());
        for unsafe_path in ["../outside", ".git", ".git/config", "/absolute"] {
            assert!(validate_git_paths(&[unsafe_path.to_string()]).is_err());
        }
        assert_eq!(
            validate_git_paths(&[" a.rs ".to_string(), "a.rs".to_string()])
                .expect("deduplicate paths"),
            vec!["a.rs"]
        );
        assert!(fuzzy_path_matches("src/nested/alpha.rs", "snar"));
        assert!(!fuzzy_path_matches("src/nested/alpha.rs", "zzz"));
        assert_eq!(path_match_rank("readme.md", Some("readme.md")).0, 0);
        assert_eq!(path_match_rank("docs/readme.md", Some("readme.md")).0, 1);
        assert_eq!(path_match_rank("docs/readme.md", Some("readme")).0, 2);
        assert_eq!(path_match_rank("docs/readme.md", Some("drm")).0, 3);
        assert_eq!(path_match_rank("docs/readme.md", None).0, 0);
        let repo = initialized_repo("workspace-git-list", "topic");
        let listed = workspace_file_list_result(WorkspaceFileListParams {
            workspace: Some(repo.display().to_string()),
            query: None,
            limit: None,
        })
        .expect("list Git workspace");
        assert!(listed.files.iter().any(|path| path == "tracked.txt"));
        fs::remove_dir_all(repo).ok();
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn last_turn_diff_and_command_helpers_cover_empty_and_failure_results() {
        let repo = initialized_repo("last-turn", "topic");
        assert!(
            diff_bytes_for_scope(&repo, GitReviewScope::LastTurn, None, &[])
                .expect("empty last-turn bytes")
                .is_empty()
        );
        assert!(
            diff_files_for_scope(&repo, GitReviewScope::LastTurn, None, &[])
                .expect("empty last-turn files")
                .is_empty()
        );
        fs::write(repo.join("tracked.txt"), "changed\n").expect("change tracked file");
        assert!(!diff_bytes_for_scope(
            &repo,
            GitReviewScope::LastTurn,
            None,
            &["tracked.txt".to_string()],
        )
        .expect("last-turn bytes")
        .is_empty());
        assert_eq!(
            diff_files_for_scope(
                &repo,
                GitReviewScope::LastTurn,
                None,
                &["tracked.txt".to_string()],
            )
            .expect("last-turn files")[0]
                .path,
            "tracked.txt"
        );
        assert_eq!(
            command_output_owned("true", &repo, &[]).expect("true command"),
            ""
        );
        assert!(command_output_owned("false", &repo, &[]).is_err());
        assert!(
            command_output_owned("definitely-missing-taskforceai-command", &repo, &[]).is_err()
        );
        assert!(git_output_owned(&repo, &["definitely-not-a-command".to_string()]).is_err());
        assert!(git_output_owned_bytes(&repo, &["definitely-not-a-command".to_string()]).is_err());
        assert!(command_error("tool", &[], b"")
            .message
            .contains("tool  failed"));
        assert!(command_error("tool", &["arg".to_string()], b"detail")
            .message
            .contains("detail"));
        fs::remove_dir_all(repo).ok();
    }

    #[test]
    fn pull_request_arguments_messages_and_comment_ids_are_deterministic() {
        assert_eq!(
            git_pull_request_args(GitReviewPullRequestAction::MarkReady, None)
                .expect("mark ready args"),
            vec!["pr", "ready"]
        );
        assert!(git_pull_request_args(GitReviewPullRequestAction::Comment, None).is_err());
        assert_eq!(
            git_pull_request_args(GitReviewPullRequestAction::Comment, Some("note"))
                .expect("comment args"),
            vec!["pr", "review", "--comment", "--body", "note"]
        );
        assert_eq!(
            git_pull_request_args(GitReviewPullRequestAction::Approve, None).expect("approve args"),
            vec!["pr", "review", "--approve"]
        );
        assert_eq!(
            git_pull_request_args(GitReviewPullRequestAction::Approve, Some("looks good"))
                .expect("approve body args"),
            vec!["pr", "review", "--approve", "--body", "looks good"]
        );
        assert!(git_pull_request_args(GitReviewPullRequestAction::RequestChanges, None).is_err());
        assert_eq!(
            git_pull_request_args(
                GitReviewPullRequestAction::RequestChanges,
                Some("please fix"),
            )
            .expect("request changes args"),
            vec!["pr", "review", "--request-changes", "--body", "please fix"]
        );
        assert_eq!(
            git_review_action_message("  "),
            "Pull request action completed."
        );
        assert_eq!(git_review_action_message(" done \n"), "done");

        let comment = |id: &str| GitReviewCommentRecord {
            id: id.to_string(),
            workspace: "/tmp".to_string(),
            path: "file".to_string(),
            line: 1,
            end_line: None,
            body: "body".to_string(),
            resolved: false,
            created_at: 10,
            updated_at: 10,
        };
        assert_eq!(unique_review_comment_id(&[], 10), "review-comment-10");
        assert_eq!(
            unique_review_comment_id(
                &[comment("review-comment-10"), comment("review-comment-10-2")],
                10,
            ),
            "review-comment-10-3"
        );
    }

    fn initialized_repo(label: &str, branch: &str) -> PathBuf {
        let root = test_root(label);
        run_git(&root, &["init", "-b", branch]);
        run_git(&root, &["config", "user.email", "review@example.invalid"]);
        run_git(&root, &["config", "user.name", "Review Test"]);
        fs::write(root.join("tracked.txt"), "tracked\n").expect("write tracked");
        run_git(&root, &["add", "tracked.txt"]);
        run_git(&root, &["commit", "-m", "initial"]);
        root
    }

    fn test_root(label: &str) -> PathBuf {
        let sequence = TEST_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!(
            "taskforceai-git-review-helper-{label}-{}-{sequence}",
            std::process::id()
        ));
        fs::create_dir_all(&root).expect("create test root");
        root
    }

    fn run_git(root: &Path, args: &[&str]) {
        let output = Command::new("git")
            .args(args)
            .current_dir(root)
            .output()
            .expect("git should execute");
        // coverage:ignore-start -- only formats diagnostics when a test fixture command fails.
        assert!(
            output.status.success(),
            "git {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr)
        );
        // coverage:ignore-end
    }
}
