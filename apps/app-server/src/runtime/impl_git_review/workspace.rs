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
