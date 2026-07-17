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
    let mime_type = image_mime_type(relative).map(str::to_string);
    let content_base64 = mime_type
        .as_ref()
        .filter(|_| !truncated)
        .map(|_| BASE64_STANDARD.encode(visible));
    Ok(WorkspaceFileReadResult {
        workspace: canonical_root.display().to_string(),
        path: relative.to_string_lossy().to_string(),
        content,
        truncated,
        binary,
        content_base64,
        mime_type,
    })
}

fn image_mime_type(path: &Path) -> Option<&'static str> {
    match path
        .extension()?
        .to_string_lossy()
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "bmp" => Some("image/bmp"),
        _ => None,
    }
}

fn fs_read_directory_result(
    params: FsReadDirectoryParams,
) -> Result<FsReadDirectoryResult, RuntimeError> {
    let workspace = resolve_workspace(params.workspace.as_deref())?;
    let canonical_root = workspace
        .canonicalize()
        .map_err(|_| RuntimeError::not_found("workspace not found"))?;
    let relative = validated_workspace_relative_path(params.path.as_deref())?;
    let directory = canonical_workspace_entry(&canonical_root, &relative)?;
    if !directory.is_dir() {
        return Err(RuntimeError::invalid_params(
            "workspace path is not a directory",
        ));
    }
    let mut entries = fs::read_dir(&directory)
        .map_err(|error| {
            RuntimeError::storage(format!("workspace directory read failed: {error}"))
        })?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let metadata = fs::symlink_metadata(entry.path()).ok()?;
            let file_type = metadata.file_type();
            let file_name = entry.file_name().to_string_lossy().to_string();
            let path = relative
                .join(&file_name)
                .to_string_lossy()
                .replace('\\', "/");
            Some(FsDirectoryEntry {
                file_name,
                path,
                is_directory: file_type.is_dir(),
                is_file: file_type.is_file(),
                is_symlink: file_type.is_symlink(),
            })
        })
        .collect::<Vec<_>>();
    entries.sort_by(|left, right| left.file_name.cmp(&right.file_name));
    Ok(FsReadDirectoryResult {
        workspace: canonical_root.display().to_string(),
        path: display_workspace_relative_path(&relative),
        entries,
    })
}

fn fs_get_metadata_result(params: FsGetMetadataParams) -> Result<FsMetadataResult, RuntimeError> {
    let workspace = resolve_workspace(params.workspace.as_deref())?;
    let canonical_root = workspace
        .canonicalize()
        .map_err(|_| RuntimeError::not_found("workspace not found"))?;
    let relative = validated_workspace_relative_path(params.path.as_deref())?;
    let entry = if relative.as_os_str().is_empty() {
        canonical_root.clone()
    } else {
        let candidate = canonical_root.join(&relative);
        let parent = candidate
            .parent()
            .and_then(|parent| parent.canonicalize().ok())
            .ok_or_else(|| RuntimeError::not_found("workspace path not found"))?;
        if !parent.starts_with(&canonical_root) {
            return Err(RuntimeError::invalid_params(
                "workspace path escapes the workspace",
            ));
        }
        candidate
    };
    let metadata = fs::symlink_metadata(&entry)
        .map_err(|_| RuntimeError::not_found("workspace path not found"))?;
    let file_type = metadata.file_type();
    Ok(FsMetadataResult {
        workspace: canonical_root.display().to_string(),
        path: display_workspace_relative_path(&relative),
        is_directory: file_type.is_dir(),
        is_file: file_type.is_file(),
        is_symlink: file_type.is_symlink(),
        size_bytes: metadata.len(),
        created_at_ms: metadata.created().ok().and_then(system_time_millis),
        modified_at_ms: metadata.modified().ok().and_then(system_time_millis),
    })
}

fn validated_workspace_relative_path(path: Option<&str>) -> Result<PathBuf, RuntimeError> {
    let path = path
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .unwrap_or(".");
    let relative = Path::new(path);
    if relative.is_absolute()
        || relative.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err(RuntimeError::invalid_params(
            "workspace path must be relative",
        ));
    }
    Ok(if path == "." {
        PathBuf::new()
    } else {
        relative.to_path_buf()
    })
}

fn canonical_workspace_entry(root: &Path, relative: &Path) -> Result<PathBuf, RuntimeError> {
    let entry = root
        .join(relative)
        .canonicalize()
        .map_err(|_| RuntimeError::not_found("workspace path not found"))?;
    if !entry.starts_with(root) {
        return Err(RuntimeError::invalid_params(
            "workspace path escapes the workspace",
        ));
    }
    Ok(entry)
}

fn display_workspace_relative_path(path: &Path) -> String {
    if path.as_os_str().is_empty() {
        ".".to_string()
    } else {
        path.to_string_lossy().replace('\\', "/")
    }
}

fn system_time_millis(time: SystemTime) -> Option<u64> {
    time.duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| u64::try_from(duration.as_millis()).ok())
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
