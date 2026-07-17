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
        .arg("-c")
        .arg("core.fsmonitor=false")
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
