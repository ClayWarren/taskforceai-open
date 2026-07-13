use std::{
    fs,
    io::{Read as _, Write as _},
    path::{Component, Path, PathBuf},
};

use tracing::info;

use super::workspace_root;
use crate::state::AppState;

const WORKSPACE_TREE_DEFAULT_MAX_ENTRIES: usize = 500;
const WORKSPACE_TREE_MAX_ENTRIES: usize = 2_000;
const WORKSPACE_TREE_DEFAULT_MAX_DEPTH: usize = 5;
const WORKSPACE_TREE_MAX_DEPTH: usize = 12;
const WORKSPACE_FILE_READ_DEFAULT_MAX_BYTES: usize = 128 * 1024;
const WORKSPACE_FILE_READ_MAX_BYTES: usize = 512 * 1024;
const WORKSPACE_FILE_WRITE_MAX_BYTES: usize = 512 * 1024;

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFileTreeEntry {
    path: String,
    name: String,
    depth: usize,
    is_directory: bool,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFileTreeResult {
    root: String,
    roots: Vec<String>,
    entries: Vec<WorkspaceFileTreeEntry>,
    truncated: bool,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFileTreeParams {
    root: Option<String>,
    max_entries: Option<usize>,
    max_depth: Option<usize>,
}

#[tauri::command]
pub async fn workspace_file_tree(
    state: tauri::State<'_, AppState>,
    params: Option<WorkspaceFileTreeParams>,
) -> Result<WorkspaceFileTreeResult, String> {
    let cwd = selected_workspace_root(
        &state,
        params.as_ref().and_then(|params| params.root.as_deref()),
    )?;
    let roots = available_workspace_roots(&state)?;
    let max_entries = params
        .as_ref()
        .and_then(|params| params.max_entries)
        .unwrap_or(WORKSPACE_TREE_DEFAULT_MAX_ENTRIES)
        .clamp(1, WORKSPACE_TREE_MAX_ENTRIES);
    let max_depth = params
        .as_ref()
        .and_then(|params| params.max_depth)
        .unwrap_or(WORKSPACE_TREE_DEFAULT_MAX_DEPTH)
        .clamp(1, WORKSPACE_TREE_MAX_DEPTH);
    let mut entries = Vec::new();
    let mut truncated = false;

    collect_workspace_tree_entries(
        &cwd,
        &cwd,
        0,
        max_depth,
        max_entries,
        &mut entries,
        &mut truncated,
    )?;

    info!(
        target: "desktop_ui",
        cwd = %cwd.display(),
        entries = entries.len(),
        truncated,
        "Workspace file tree requested"
    );

    Ok(WorkspaceFileTreeResult {
        root: cwd.display().to_string(),
        roots,
        entries,
        truncated,
    })
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopWorkspaceFileReadParams {
    root: Option<String>,
    path: String,
    max_bytes: Option<usize>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopWorkspaceFileReadResult {
    root: String,
    path: String,
    content: String,
    truncated: bool,
    editable: bool,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopWorkspaceFileWriteParams {
    root: Option<String>,
    path: String,
    content: String,
    expected_content: String,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopWorkspaceOpenParams {
    root: Option<String>,
    target: String,
}

fn workspace_open_command(target: &str, root: &Path) -> Result<std::process::Command, String> {
    #[cfg(target_os = "macos")]
    {
        let application = match target {
            "vscode" => Some("Visual Studio Code"),
            "cursor" => Some("Cursor"),
            "finder" => None,
            "terminal" => Some("Terminal"),
            "xcode" => Some("Xcode"),
            _ => return Err(format!("Unsupported workspace application: {target}")),
        };
        let mut command = std::process::Command::new("open");
        if let Some(application) = application {
            command.arg("-a").arg(application);
        }
        command.arg(root);
        Ok(command)
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = root;
        Err(format!(
            "Opening a workspace in {target} is currently supported only on macOS."
        ))
    }
}

#[tauri::command]
pub async fn desktop_workspace_open_in(
    state: tauri::State<'_, AppState>,
    params: DesktopWorkspaceOpenParams,
) -> Result<(), String> {
    let root = selected_workspace_root(&state, params.root.as_deref())?;
    workspace_open_command(params.target.trim(), &root)?
        .spawn()
        .map_err(|error| format!("Failed to open workspace: {error}"))?;
    info!(
        target: "desktop_ui",
        cwd = %root.display(),
        application = %params.target,
        "Workspace application open requested"
    );
    Ok(())
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopWorktreeListParams {
    repository: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopWorktreeCreateParams {
    repository: Option<String>,
    path: Option<String>,
    branch: Option<String>,
    base_ref: Option<String>,
}

#[tauri::command]
pub async fn workspace_file_read(
    state: tauri::State<'_, AppState>,
    params: DesktopWorkspaceFileReadParams,
) -> Result<DesktopWorkspaceFileReadResult, String> {
    let root = selected_workspace_root(&state, params.root.as_deref())?;
    read_workspace_file(&root, params)
}

#[tauri::command]
pub async fn workspace_file_write(
    state: tauri::State<'_, AppState>,
    params: DesktopWorkspaceFileWriteParams,
) -> Result<DesktopWorkspaceFileReadResult, String> {
    let root = selected_workspace_root(&state, params.root.as_deref())?;
    write_workspace_file(&root, &params)?;
    read_workspace_file(
        &root,
        DesktopWorkspaceFileReadParams {
            root: Some(root.display().to_string()),
            path: params.path,
            max_bytes: Some(WORKSPACE_FILE_READ_MAX_BYTES),
        },
    )
}

fn available_workspace_roots(state: &AppState) -> Result<Vec<String>, String> {
    let roots = state.local_coding_workspace_roots();
    if roots.is_empty() {
        return Ok(vec![workspace_root(state)?.display().to_string()]);
    }
    Ok(roots
        .into_iter()
        .map(|root| root.display().to_string())
        .collect())
}

fn selected_workspace_root(state: &AppState, requested: Option<&str>) -> Result<PathBuf, String> {
    let available = state.local_coding_workspace_roots();
    if available.is_empty() {
        return workspace_root(state);
    }
    let requested = requested
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| available[0].clone())
        .canonicalize()
        .map_err(|error| format!("Failed to resolve selected workspace root: {error}"))?;
    available
        .into_iter()
        .filter_map(|root| root.canonicalize().ok())
        .find(|root| root == &requested)
        .ok_or_else(|| "Selected workspace root is not active for this Code task.".to_string())
}

fn read_workspace_file(
    root: &Path,
    params: DesktopWorkspaceFileReadParams,
) -> Result<DesktopWorkspaceFileReadResult, String> {
    let normalized_path = normalize_workspace_relative_path(&params.path)?;
    let canonical_file = resolve_existing_workspace_file(root, &normalized_path)?;

    let max_bytes = params
        .max_bytes
        .unwrap_or(WORKSPACE_FILE_READ_DEFAULT_MAX_BYTES)
        .clamp(1, WORKSPACE_FILE_READ_MAX_BYTES);
    let file = fs::File::open(&canonical_file)
        .map_err(|error| format!("Failed to read {}: {error}", normalized_path.display()))?;
    let mut bytes = Vec::with_capacity(max_bytes.saturating_add(1));
    std::io::Read::take(file, max_bytes.saturating_add(1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Failed to read {}: {error}", normalized_path.display()))?;
    let truncated = bytes.len() > max_bytes;
    let visible = if truncated {
        &bytes[..max_bytes]
    } else {
        bytes.as_slice()
    };
    let valid_utf8 = std::str::from_utf8(visible).ok();
    let editable = !truncated && valid_utf8.is_some() && !visible.contains(&0);
    let mut content = valid_utf8
        .map(str::to_string)
        .unwrap_or_else(|| String::from_utf8_lossy(visible).to_string());
    if truncated {
        content.push_str("\n...[file truncated]");
    }

    Ok(DesktopWorkspaceFileReadResult {
        root: root.display().to_string(),
        path: normalized_path
            .to_string_lossy()
            .replace(std::path::MAIN_SEPARATOR, "/"),
        content,
        truncated,
        editable,
    })
}

fn write_workspace_file(
    root: &Path,
    params: &DesktopWorkspaceFileWriteParams,
) -> Result<(), String> {
    if params.content.len() > WORKSPACE_FILE_WRITE_MAX_BYTES {
        return Err(format!(
            "Workspace file edits are limited to {} bytes.",
            WORKSPACE_FILE_WRITE_MAX_BYTES
        ));
    }
    if params.content.as_bytes().contains(&0) {
        return Err("Workspace file edits must contain text, not binary data.".to_string());
    }

    let normalized_path = normalize_workspace_relative_path(&params.path)?;
    let canonical_file = resolve_existing_workspace_file(root, &normalized_path)?;
    let current_content = fs::read_to_string(&canonical_file).map_err(|error| {
        format!(
            "Failed to read {} before saving: {error}",
            normalized_path.display()
        )
    })?;
    if current_content != params.expected_content {
        return Err(format!(
            "{} changed on disk. Reload it before saving your edits.",
            normalized_path.display()
        ));
    }

    let metadata = fs::metadata(&canonical_file)
        .map_err(|error| format!("Failed to inspect {}: {error}", normalized_path.display()))?;
    let file_name = canonical_file
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("workspace-file");
    let temp_path = canonical_file.with_file_name(format!(
        ".{file_name}.taskforceai-{}-{}.tmp",
        std::process::id(),
        rand::random::<u64>()
    ));
    let write_result = (|| -> Result<(), String> {
        let mut temp_file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)
            .map_err(|error| {
                format!(
                    "Failed to prepare {} for saving: {error}",
                    normalized_path.display()
                )
            })?;
        temp_file
            .write_all(params.content.as_bytes())
            .and_then(|_| temp_file.sync_all())
            .map_err(|error| format!("Failed to save {}: {error}", normalized_path.display()))?;
        fs::set_permissions(&temp_path, metadata.permissions()).map_err(|error| {
            format!(
                "Failed to preserve permissions for {}: {error}",
                normalized_path.display()
            )
        })?;
        fs::rename(&temp_path, &canonical_file)
            .map_err(|error| format!("Failed to replace {}: {error}", normalized_path.display()))
    })();
    if write_result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }
    write_result
}

fn resolve_existing_workspace_file(root: &Path, normalized_path: &Path) -> Result<PathBuf, String> {
    let canonical_root = root.canonicalize().map_err(|error| {
        format!(
            "Failed to resolve workspace root {}: {error}",
            root.display()
        )
    })?;
    let file_path = canonical_root.join(normalized_path);
    let canonical_file = file_path
        .canonicalize()
        .map_err(|error| format!("Failed to resolve {}: {error}", normalized_path.display()))?;
    if !canonical_file.starts_with(&canonical_root) {
        return Err("Workspace file path is outside the selected workspace.".to_string());
    }
    if !canonical_file.is_file() {
        return Err(format!("{} is not a file.", normalized_path.display()));
    }
    Ok(canonical_file)
}

#[tauri::command]
pub async fn desktop_worktree_list(
    state: tauri::State<'_, AppState>,
    params: Option<DesktopWorktreeListParams>,
) -> Result<crate::worktrees::GitWorktreeListResult, String> {
    let repository =
        repository_path_from_params(&state, params.and_then(|params| params.repository))?;
    crate::worktrees::list_git_worktrees(&repository)
}

#[tauri::command]
pub async fn desktop_worktree_create(
    state: tauri::State<'_, AppState>,
    params: DesktopWorktreeCreateParams,
) -> Result<crate::worktrees::GitWorktreeCreateResult, String> {
    let repository = repository_path_from_params(&state, params.repository)?;
    crate::worktrees::create_git_worktree(
        &repository,
        params.path.as_deref(),
        params.branch.as_deref(),
        params.base_ref.as_deref(),
    )
}

fn repository_path_from_params(
    state: &AppState,
    repository: Option<String>,
) -> Result<PathBuf, String> {
    repository
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(expand_home_path)
        .map(Ok)
        .unwrap_or_else(|| workspace_root(state))
}

fn expand_home_path(path: &str) -> PathBuf {
    if path == "~" {
        return std::env::var_os("HOME").map_or_else(|| PathBuf::from(path), PathBuf::from);
    }
    if let Some(rest) = path.strip_prefix("~/") {
        if let Some(home) = std::env::var_os("HOME") {
            return PathBuf::from(home).join(rest);
        }
    }
    PathBuf::from(path)
}

fn normalize_workspace_relative_path(path: &str) -> Result<PathBuf, String> {
    if path.trim().is_empty() {
        return Err("Workspace file path is required.".to_string());
    }

    let mut normalized = PathBuf::new();
    for component in Path::new(path).components() {
        match component {
            Component::Normal(value) => normalized.push(value),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err("Workspace file path must stay inside the selected workspace.".into());
            }
        }
    }
    if normalized.as_os_str().is_empty() {
        return Err("Workspace file path is required.".to_string());
    }
    Ok(normalized)
}

fn collect_workspace_tree_entries(
    root: &Path,
    dir: &Path,
    depth: usize,
    max_depth: usize,
    max_entries: usize,
    entries: &mut Vec<WorkspaceFileTreeEntry>,
    truncated: &mut bool,
) -> Result<(), String> {
    if entries.len() >= max_entries {
        *truncated = true;
        return Ok(());
    }

    if depth >= max_depth {
        let has_visible_children = fs::read_dir(dir)
            .map_err(|error| format!("Failed to read {}: {error}", dir.display()))?
            .filter_map(|entry| WorkspaceTreeChild::from_dir_entry(entry.ok()?))
            .next()
            .is_some();
        if has_visible_children {
            *truncated = true;
        }
        return Ok(());
    }

    let mut children = fs::read_dir(dir)
        .map_err(|error| format!("Failed to read {}: {error}", dir.display()))?
        .filter_map(|entry| WorkspaceTreeChild::from_dir_entry(entry.ok()?))
        .collect::<Vec<_>>();

    children.sort_by(|left, right| {
        right
            .is_directory
            .cmp(&left.is_directory)
            .then_with(|| left.sort_name.cmp(&right.sort_name))
    });

    for child in children {
        if entries.len() >= max_entries {
            *truncated = true;
            break;
        }

        let rel_path = child.path.strip_prefix(root).unwrap_or(&child.path);
        let normalized_path = rel_path
            .to_string_lossy()
            .replace(std::path::MAIN_SEPARATOR, "/");

        entries.push(WorkspaceFileTreeEntry {
            path: normalized_path,
            name: child.name,
            depth,
            is_directory: child.is_directory,
        });

        if child.is_directory {
            collect_workspace_tree_entries(
                root,
                &child.path,
                depth + 1,
                max_depth,
                max_entries,
                entries,
                truncated,
            )?;
        }
    }

    Ok(())
}

struct WorkspaceTreeChild {
    path: PathBuf,
    name: String,
    sort_name: String,
    is_directory: bool,
}

impl WorkspaceTreeChild {
    fn from_dir_entry(entry: fs::DirEntry) -> Option<Self> {
        let name = entry.file_name().to_string_lossy().to_string();
        if should_skip_workspace_entry_name(&name) {
            return None;
        }

        let file_type = entry.file_type().ok()?;
        let sort_name = name.to_ascii_lowercase();

        Some(Self {
            path: entry.path(),
            name,
            sort_name,
            is_directory: file_type.is_dir(),
        })
    }
}

fn should_skip_workspace_entry_name(name: &str) -> bool {
    matches!(
        name,
        ".git"
            | ".next"
            | ".taskforceai"
            | ".turbo"
            | ".vercel"
            | "build"
            | "coverage"
            | "dist"
            | "node_modules"
            | "target"
    )
}

#[cfg(test)]
mod tests {
    use super::super::unique_test_dir;
    use super::*;

    #[cfg(target_os = "macos")]
    #[test]
    fn workspace_open_targets_use_explicit_macos_applications() {
        let root = Path::new("/tmp/taskforceai");
        let vscode = workspace_open_command("vscode", root).expect("build VS Code command");
        assert_eq!(
            vscode
                .get_args()
                .map(|argument| argument.to_string_lossy().into_owned())
                .collect::<Vec<_>>(),
            vec!["-a", "Visual Studio Code", "/tmp/taskforceai"]
        );
        let finder = workspace_open_command("finder", root).expect("build Finder command");
        assert_eq!(
            finder
                .get_args()
                .map(|argument| argument.to_string_lossy().into_owned())
                .collect::<Vec<_>>(),
            vec!["/tmp/taskforceai"]
        );
        assert!(workspace_open_command("unknown", root).is_err());
    }

    #[test]
    fn workspace_relative_path_normalization_rejects_escape_paths() {
        assert_eq!(
            normalize_workspace_relative_path("./src/../main.rs")
                .expect_err("parent traversal should fail"),
            "Workspace file path must stay inside the selected workspace."
        );
        assert_eq!(
            normalize_workspace_relative_path("/tmp/main.rs")
                .expect_err("absolute path should fail"),
            "Workspace file path must stay inside the selected workspace."
        );
        assert_eq!(
            normalize_workspace_relative_path("   ").expect_err("blank path should fail"),
            "Workspace file path is required."
        );

        assert_eq!(
            normalize_workspace_relative_path("./src/main.rs")
                .expect("workspace-relative path should normalize"),
            PathBuf::from("src").join("main.rs")
        );
    }

    #[test]
    fn workspace_tree_skips_build_artifacts_and_orders_directories_first() {
        let root = unique_test_dir("workspace-tree");
        let src_dir = root.join("src");
        fs::create_dir_all(&src_dir).expect("create src dir");
        fs::create_dir_all(root.join("node_modules/pkg")).expect("create skipped node_modules");
        fs::create_dir_all(root.join("target/debug")).expect("create skipped target");
        fs::write(root.join("README.md"), "hello").expect("write readme");
        fs::write(src_dir.join("main.rs"), "fn main() {}").expect("write source");

        let mut entries = Vec::new();
        let mut truncated = false;
        collect_workspace_tree_entries(&root, &root, 0, 4, 10, &mut entries, &mut truncated)
            .expect("collect workspace tree");

        let paths = entries
            .iter()
            .map(|entry| entry.path.as_str())
            .collect::<Vec<_>>();
        assert_eq!(paths, vec!["src", "src/main.rs", "README.md"]);
        assert!(!paths.iter().any(|path| path.contains("node_modules")));
        assert!(!paths.iter().any(|path| path.contains("target")));
        assert!(!truncated);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn workspace_tree_only_marks_depth_limit_truncated_when_children_exist() {
        let root = unique_test_dir("workspace-tree-depth-limit");
        let src_dir = root.join("src");
        fs::create_dir_all(&src_dir).expect("create src dir");

        let mut entries = Vec::new();
        let mut truncated = false;
        collect_workspace_tree_entries(&root, &root, 0, 1, 10, &mut entries, &mut truncated)
            .expect("collect workspace tree");
        assert_eq!(
            entries
                .iter()
                .map(|entry| entry.path.as_str())
                .collect::<Vec<_>>(),
            vec!["src"]
        );
        assert!(!truncated);

        fs::write(src_dir.join("main.rs"), "fn main() {}").expect("write source");
        let mut entries = Vec::new();
        let mut truncated = false;
        collect_workspace_tree_entries(&root, &root, 0, 1, 10, &mut entries, &mut truncated)
            .expect("collect workspace tree");
        assert!(truncated);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn workspace_tree_marks_truncated_when_entry_limit_is_reached() {
        let root = unique_test_dir("workspace-tree-limit");
        fs::create_dir_all(&root).expect("create root");
        fs::write(root.join("a.txt"), "a").expect("write a");
        fs::write(root.join("b.txt"), "b").expect("write b");

        let mut entries = Vec::new();
        let mut truncated = false;
        collect_workspace_tree_entries(&root, &root, 0, 4, 1, &mut entries, &mut truncated)
            .expect("collect limited workspace tree");

        assert_eq!(entries.len(), 1);
        assert!(truncated);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn workspace_file_write_is_atomic_and_rejects_stale_edits() {
        let root = unique_test_dir("workspace-file-write");
        fs::create_dir_all(&root).expect("create root");
        let path = root.join("notes.md");
        fs::write(&path, "first\n").expect("write source");

        write_workspace_file(
            &root,
            &DesktopWorkspaceFileWriteParams {
                root: None,
                path: "notes.md".to_string(),
                content: "second\n".to_string(),
                expected_content: "first\n".to_string(),
            },
        )
        .expect("matching revision should save");
        assert_eq!(
            fs::read_to_string(&path).expect("read saved file"),
            "second\n"
        );

        let error = write_workspace_file(
            &root,
            &DesktopWorkspaceFileWriteParams {
                root: None,
                path: "notes.md".to_string(),
                content: "third\n".to_string(),
                expected_content: "first\n".to_string(),
            },
        )
        .expect_err("stale content should not overwrite the file");
        assert!(error.contains("changed on disk"));
        assert_eq!(
            fs::read_to_string(&path).expect("read unchanged file"),
            "second\n"
        );
        assert!(fs::read_dir(&root).expect("read root").all(|entry| !entry
            .expect("entry")
            .file_name()
            .to_string_lossy()
            .contains(".tmp")));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn workspace_file_read_marks_binary_and_truncated_content_read_only() {
        let root = unique_test_dir("workspace-file-editability");
        fs::create_dir_all(&root).expect("create root");
        fs::write(root.join("binary.dat"), [0, 1, 2]).expect("write binary");
        fs::write(root.join("large.txt"), "abcdef").expect("write text");

        let binary = read_workspace_file(
            &root,
            DesktopWorkspaceFileReadParams {
                root: None,
                path: "binary.dat".to_string(),
                max_bytes: None,
            },
        )
        .expect("read binary preview");
        assert!(!binary.editable);

        let truncated = read_workspace_file(
            &root,
            DesktopWorkspaceFileReadParams {
                root: None,
                path: "large.txt".to_string(),
                max_bytes: Some(3),
            },
        )
        .expect("read truncated preview");
        assert!(truncated.truncated);
        assert!(!truncated.editable);

        let _ = fs::remove_dir_all(root);
    }
}
