use std::{
    fs,
    io::Read as _,
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
    entries: Vec<WorkspaceFileTreeEntry>,
    truncated: bool,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFileTreeParams {
    max_entries: Option<usize>,
    max_depth: Option<usize>,
}

#[tauri::command]
pub async fn workspace_file_tree(
    state: tauri::State<'_, AppState>,
    params: Option<WorkspaceFileTreeParams>,
) -> Result<WorkspaceFileTreeResult, String> {
    let cwd = workspace_root(&state)?;
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
        entries,
        truncated,
    })
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFileReadParams {
    path: String,
    max_bytes: Option<usize>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFileReadResult {
    root: String,
    path: String,
    content: String,
    truncated: bool,
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
    params: WorkspaceFileReadParams,
) -> Result<WorkspaceFileReadResult, String> {
    let root = workspace_root(&state)?;
    let normalized_path = normalize_workspace_relative_path(&params.path)?;
    let file_path = root.join(&normalized_path);
    let canonical_file = file_path
        .canonicalize()
        .map_err(|error| format!("Failed to resolve {}: {error}", normalized_path.display()))?;
    if !canonical_file.starts_with(&root) {
        return Err("Workspace file path is outside the selected workspace.".to_string());
    }
    if !canonical_file.is_file() {
        return Err(format!("{} is not a file.", normalized_path.display()));
    }

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
    let mut content = String::from_utf8_lossy(visible).to_string();
    if truncated {
        content.push_str("\n...[file truncated]");
    }

    Ok(WorkspaceFileReadResult {
        root: root.display().to_string(),
        path: normalized_path
            .to_string_lossy()
            .replace(std::path::MAIN_SEPARATOR, "/"),
        content,
        truncated,
    })
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
    #[ignore = "release-mode performance benchmark; run with --ignored --nocapture"]
    fn workspace_tree_collector_large_workspace_benchmark() {
        let root = unique_test_dir("workspace-tree-benchmark");
        create_large_workspace_tree(&root);

        let mut timings = Vec::new();
        for _ in 0..40 {
            let mut entries = Vec::new();
            let mut truncated = false;
            let started = std::time::Instant::now();
            collect_workspace_tree_entries(&root, &root, 0, 4, 2_000, &mut entries, &mut truncated)
                .expect("collect large workspace tree");
            std::hint::black_box(&entries);
            std::hint::black_box(truncated);
            timings.push(started.elapsed());

            assert_eq!(entries.len(), 2_000);
            assert!(truncated);
        }
        timings.sort_unstable();
        let median = timings[timings.len() / 2];
        println!(
            "workspace_tree_collector_large_workspace median={}us iterations={}",
            median.as_micros(),
            timings.len()
        );

        let _ = fs::remove_dir_all(root);
    }

    fn create_large_workspace_tree(root: &Path) {
        fs::create_dir_all(root).expect("create benchmark root");
        fs::create_dir_all(root.join("node_modules/pkg")).expect("create skipped node_modules");
        fs::create_dir_all(root.join("target/debug")).expect("create skipped target");

        for index in 0..240 {
            fs::write(
                root.join(format!("ROOT_FILE_{index:04}.txt")),
                format!("root file {index}"),
            )
            .expect("write root file");
        }

        for directory in 0..44 {
            let dir = root.join(format!("Module_{directory:03}"));
            fs::create_dir_all(&dir).expect("create benchmark module dir");
            for file in 0..44 {
                fs::write(
                    dir.join(format!("Source_{directory:03}_{file:03}.rs")),
                    format!("fn source_{directory}_{file}() {{}}\n"),
                )
                .expect("write benchmark source file");
            }
        }
    }
}
