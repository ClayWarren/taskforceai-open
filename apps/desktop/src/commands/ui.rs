use std::{
    fs,
    io::Read as _,
    path::{Component, Path, PathBuf},
    process::Stdio,
};

use tauri::{Manager, Window};
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::Command as TokioCommand;
use tokio::time::{timeout, Duration};
use tracing::{info, warn};
use url::Url;

use crate::state::{AppState, BootstrapState};

const TERMINAL_EXEC_TIMEOUT: Duration = Duration::from_secs(30);
const TERMINAL_EXEC_OUTPUT_LIMIT_BYTES: usize = 64 * 1024;
const ENABLE_TERMINAL_EXECUTE_ENV: &str = "TASKFORCEAI_DESKTOP_ENABLE_TERMINAL_EXECUTE";
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

pub(crate) fn display_main_window(
    window: &Window,
    bootstrap: &BootstrapState,
    reason: &str,
) -> bool {
    if bootstrap.has_displayed() {
        return false;
    }
    if !bootstrap.mark_displayed() {
        return false;
    }

    if let Err(error) = window.show() {
        bootstrap.reset_displayed();
        warn!(
            target: "bootstrap",
            error = ?error,
            "Failed to show main window after frontend readiness"
        );
        return false;
    }
    let _ = window.set_focus();
    info!(
        target: "bootstrap",
        reason,
        "Frontend signaled readiness; main window displayed"
    );
    true
}

#[tauri::command]
pub async fn frontend_ready(
    window: tauri::Window,
    bootstrap: tauri::State<'_, BootstrapState>,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    display_main_window(&window, &bootstrap, "frontend_ready");
    let app_server = state.app_server.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = app_server.initialize().await {
            warn!(
                target: "app_server",
                error = %error,
                "Failed to initialize app-server after frontend readiness"
            );
        }
    });
    Ok(())
}

fn terminal_command(cwd: &std::path::Path) -> std::process::Command {
    #[cfg(target_os = "macos")]
    {
        let mut command = std::process::Command::new("open");
        command.arg("-a").arg("Terminal").arg(cwd);
        command
    }
    #[cfg(target_os = "windows")]
    {
        let mut command = std::process::Command::new("cmd");
        command
            .arg("/C")
            .arg("start")
            .arg("")
            .arg("cmd")
            .arg("/K")
            .arg(format!("cd /d {}", cwd.display()));
        command
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let mut command = std::process::Command::new("sh");
        command
            .arg("-c")
            .arg("x-terminal-emulator || gnome-terminal || konsole || xterm")
            .current_dir(cwd);
        command
    }
}

fn show_terminal_impl(cwd: &std::path::Path) -> Result<(), String> {
    terminal_command(cwd)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Failed to open terminal: {error}"))
}

#[tauri::command]
pub async fn show_terminal(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let cwd = workspace_root(&state)?;
    show_terminal_impl(&cwd)?;
    info!(
        target: "desktop_ui",
        cwd = %cwd.display(),
        "Terminal reveal requested"
    );
    Ok(())
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

fn workspace_root(state: &AppState) -> Result<PathBuf, String> {
    let root = state
        .local_coding_workspace()
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
    root.canonicalize().map_err(|error| {
        format!(
            "Failed to resolve workspace root {}: {error}",
            root.display()
        )
    })
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
    if entries.len() >= max_entries || depth >= max_depth {
        *truncated = true;
        return Ok(());
    }

    let mut children = fs::read_dir(dir)
        .map_err(|error| format!("Failed to read {}: {error}", dir.display()))?
        .filter_map(Result::ok)
        .filter(|entry| !should_skip_workspace_entry(&entry.path()))
        .collect::<Vec<_>>();

    children.sort_by(|left, right| {
        let left_is_dir = left.file_type().map(|kind| kind.is_dir()).unwrap_or(false);
        let right_is_dir = right.file_type().map(|kind| kind.is_dir()).unwrap_or(false);
        right_is_dir.cmp(&left_is_dir).then_with(|| {
            left.file_name()
                .to_string_lossy()
                .to_ascii_lowercase()
                .cmp(&right.file_name().to_string_lossy().to_ascii_lowercase())
        })
    });

    for child in children {
        if entries.len() >= max_entries {
            *truncated = true;
            break;
        }

        let path = child.path();
        let file_type = match child.file_type() {
            Ok(file_type) => file_type,
            Err(_) => continue,
        };
        let is_directory = file_type.is_dir();
        let rel_path = path.strip_prefix(root).unwrap_or(&path);
        let normalized_path = rel_path
            .to_string_lossy()
            .replace(std::path::MAIN_SEPARATOR, "/");
        let name = child.file_name().to_string_lossy().to_string();

        entries.push(WorkspaceFileTreeEntry {
            path: normalized_path,
            name,
            depth,
            is_directory,
        });

        if is_directory {
            collect_workspace_tree_entries(
                root,
                &path,
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

fn should_skip_workspace_entry(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
        return true;
    };

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

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalExecuteResult {
    command: String,
    cwd: String,
    exit_code: Option<i32>,
    stdout: String,
    stderr: String,
}

fn terminal_shell_command(command: &str, cwd: &std::path::Path) -> TokioCommand {
    #[cfg(target_os = "windows")]
    {
        let mut process = TokioCommand::new("cmd");
        process.arg("/C").arg(command).current_dir(cwd);
        process
    }
    #[cfg(not(target_os = "windows"))]
    {
        let mut process = TokioCommand::new("sh");
        process.arg("-lc").arg(command).current_dir(cwd);
        process
    }
}

async fn read_limited_output<R>(mut reader: R, limit: usize) -> Result<String, String>
where
    R: AsyncRead + Unpin,
{
    let mut output = Vec::new();
    let mut buffer = [0_u8; 4096];
    let mut truncated = false;

    loop {
        let read = reader
            .read(&mut buffer)
            .await
            .map_err(|error| format!("Failed to read command output: {error}"))?;
        if read == 0 {
            break;
        }

        let remaining = limit.saturating_sub(output.len());
        if remaining > 0 {
            let keep = remaining.min(read);
            output.extend_from_slice(&buffer[..keep]);
            truncated |= keep < read;
        } else {
            truncated = true;
        }
    }

    let mut text = String::from_utf8_lossy(&output).to_string();
    if truncated {
        text.push_str("\n...[output truncated]");
    }
    Ok(text)
}

/// Runs a user-entered command for the VS Code-like integrated terminal.
///
/// This is an intentional privileged desktop feature, not an accidental command
/// bridge. Keep it scoped to the main desktop webview, preserve the timeout and
/// output caps, and treat frontend access to this command as equivalent to
/// access to a local developer terminal.
#[tauri::command]
pub async fn terminal_execute(
    state: tauri::State<'_, AppState>,
    window: tauri::WebviewWindow,
    command: String,
) -> Result<TerminalExecuteResult, String> {
    let url = window
        .url()
        .map_err(|error| format!("Failed to resolve desktop webview URL: {error}"))?;
    let cwd = workspace_root(&state)?;
    terminal_execute_with_timeout(command, TERMINAL_EXEC_TIMEOUT, Some(&url), &cwd).await
}

async fn terminal_execute_with_timeout(
    command: String,
    command_timeout: Duration,
    webview_url: Option<&Url>,
    cwd: &Path,
) -> Result<TerminalExecuteResult, String> {
    if !terminal_execute_allowed() {
        return Err(
            "Integrated terminal execution is disabled for this desktop build.".to_string(),
        );
    }
    if !webview_url.is_some_and(terminal_execute_origin_allowed) {
        return Err(
            "Integrated terminal execution is only available to local desktop origins.".to_string(),
        );
    }

    let trimmed = command.trim();
    if trimmed.is_empty() {
        return Err("Command is required".to_string());
    }

    let mut process = terminal_shell_command(trimmed, cwd);
    process.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = process
        .spawn()
        .map_err(|error| format!("Failed to run command: {error}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture command stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to capture command stderr".to_string())?;

    let stdout_task = tokio::spawn(read_limited_output(
        stdout,
        TERMINAL_EXEC_OUTPUT_LIMIT_BYTES,
    ));
    let stderr_task = tokio::spawn(read_limited_output(
        stderr,
        TERMINAL_EXEC_OUTPUT_LIMIT_BYTES,
    ));

    let command_result = timeout(command_timeout, async {
        let status = child
            .wait()
            .await
            .map_err(|error| format!("Failed to wait for command: {error}"))?;
        let stdout = stdout_task
            .await
            .map_err(|error| format!("Failed to join stdout reader: {error}"))??;
        let stderr = stderr_task
            .await
            .map_err(|error| format!("Failed to join stderr reader: {error}"))??;
        Ok::<_, String>((status, stdout, stderr))
    })
    .await;

    let (status, stdout, stderr) = match command_result {
        Ok(result) => result?,
        Err(_) => {
            let _ = child.kill().await;
            return Err(format!(
                "Command timed out after {} seconds",
                command_timeout.as_secs()
            ));
        }
    };

    info!(
        target: "desktop_ui",
        cwd = %cwd.display(),
        exit_code = ?status.code(),
        "Integrated terminal command completed"
    );

    Ok(TerminalExecuteResult {
        command: trimmed.to_string(),
        cwd: cwd.display().to_string(),
        exit_code: status.code(),
        stdout,
        stderr,
    })
}

fn terminal_execute_allowed() -> bool {
    cfg!(debug_assertions)
        || matches!(
            std::env::var(ENABLE_TERMINAL_EXECUTE_ENV),
            Ok(value) if value == "1" || value.eq_ignore_ascii_case("true")
        )
}

fn terminal_execute_origin_allowed(url: &Url) -> bool {
    match url.scheme() {
        "tauri" | "asset" => true,
        "http" | "https" => {
            let Some(host) = url.host_str() else {
                return false;
            };
            matches!(host, "localhost" | "127.0.0.1" | "::1") || host.ends_with(".localhost")
        }
        _ => false,
    }
}

fn open_external_url_impl(url: &str) -> Result<(), String> {
    let parsed = url::Url::parse(url).map_err(|error| format!("Invalid URL: {error}"))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("Only http and https URLs can be opened externally".to_string());
    }

    let mut command = external_url_command(parsed.as_str());
    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Failed to open external URL: {error}"))
}

fn external_url_command(url: &str) -> std::process::Command {
    #[cfg(target_os = "macos")]
    {
        let mut command = std::process::Command::new("open");
        command.arg(url);
        command
    }

    #[cfg(target_os = "windows")]
    {
        let mut command = std::process::Command::new("rundll32");
        command.arg("url.dll,FileProtocolHandler").arg(url);
        command
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let mut command = std::process::Command::new("xdg-open");
        command.arg(url);
        command
    }
}

#[tauri::command]
pub async fn open_external_url(url: String) -> Result<(), String> {
    open_external_url_impl(&url)?;
    info!(target: "desktop_ui", url = %url, "External URL open requested");
    Ok(())
}

#[tauri::command]
pub async fn locked_computer_use_status(
    app: tauri::AppHandle,
) -> Result<crate::locked_computer_use::LockedComputerUseStatus, String> {
    Ok(locked_computer_use_manager(&app).status())
}

#[tauri::command]
pub async fn install_locked_computer_use(
    app: tauri::AppHandle,
) -> Result<crate::locked_computer_use::LockedComputerUseStatus, String> {
    locked_computer_use_manager(&app).install()
}

#[tauri::command]
pub async fn set_locked_computer_use_enabled(
    app: tauri::AppHandle,
    enabled: bool,
) -> Result<crate::locked_computer_use::LockedComputerUseStatus, String> {
    let status = locked_computer_use_manager(&app).set_enabled(enabled)?;
    info!(
        target: "desktop_ui",
        enabled,
        "Locked computer use setting requested"
    );
    Ok(status)
}

fn locked_computer_use_manager(
    app: &tauri::AppHandle,
) -> crate::locked_computer_use::LockedComputerUseManager {
    crate::locked_computer_use::LockedComputerUseManager::with_resource_dir(
        app.path().resource_dir().ok(),
    )
}

#[tauri::command]
pub async fn screen_memory_status(
    app: tauri::AppHandle,
) -> Result<crate::screen_memory::ScreenMemoryStatus, String> {
    Ok(crate::screen_memory::ScreenMemoryManager::with_app_handle(&app).status())
}

#[tauri::command]
pub async fn set_screen_memory_enabled(
    app: tauri::AppHandle,
    enabled: bool,
) -> Result<crate::screen_memory::ScreenMemoryStatus, String> {
    let status =
        crate::screen_memory::ScreenMemoryManager::with_app_handle(&app).set_enabled(enabled)?;
    info!(
        target: "desktop_ui",
        enabled,
        "Screen Memory enabled setting changed"
    );
    Ok(status)
}

#[tauri::command]
pub async fn set_screen_memory_paused(
    app: tauri::AppHandle,
    paused: bool,
) -> Result<crate::screen_memory::ScreenMemoryStatus, String> {
    let status =
        crate::screen_memory::ScreenMemoryManager::with_app_handle(&app).set_paused(paused)?;
    info!(
        target: "desktop_ui",
        paused,
        "Screen Memory pause setting changed"
    );
    Ok(status)
}

#[tauri::command]
pub async fn screen_memory_capture_now(
    app: tauri::AppHandle,
) -> Result<crate::screen_memory::ScreenMemoryStatus, String> {
    crate::screen_memory::ScreenMemoryManager::with_app_handle(&app)
        .capture_now()
        .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bootstrap_state_starts_hidden_for_frontend_ready() {
        let bootstrap = BootstrapState::new();
        assert!(!bootstrap.has_displayed());
    }

    #[test]
    fn terminal_command_targets_current_directory() {
        let cwd = std::path::Path::new("/tmp/taskforceai-terminal-test");
        let command = terminal_command(cwd);
        let args = command
            .get_args()
            .map(|arg| arg.to_string_lossy().to_string())
            .collect::<Vec<_>>();

        #[cfg(target_os = "macos")]
        assert!(args
            .iter()
            .any(|arg| arg == "/tmp/taskforceai-terminal-test"));
        #[cfg(target_os = "windows")]
        assert!(args
            .iter()
            .any(|arg| arg.contains("/tmp/taskforceai-terminal-test")));
        #[cfg(all(unix, not(target_os = "macos")))]
        assert_eq!(command.get_current_dir(), Some(cwd));
    }

    #[test]
    fn rejects_non_web_external_urls() {
        assert!(open_external_url_impl("file:///tmp/secret").is_err());
    }

    #[test]
    fn external_url_opener_uses_shell_free_command() {
        let command = external_url_command("https://example.com/?x=1&calc");
        let program = command.get_program().to_string_lossy().to_string();
        let args = command
            .get_args()
            .map(|arg| arg.to_string_lossy().to_string())
            .collect::<Vec<_>>();

        #[cfg(target_os = "windows")]
        {
            assert_ne!(program.to_ascii_lowercase(), "cmd");
            assert_eq!(program.to_ascii_lowercase(), "rundll32");
            assert_eq!(
                args,
                vec![
                    "url.dll,FileProtocolHandler".to_string(),
                    "https://example.com/?x=1&calc".to_string()
                ]
            );
        }
        #[cfg(not(target_os = "windows"))]
        {
            assert_ne!(program.to_ascii_lowercase(), "cmd");
            assert_eq!(args, vec!["https://example.com/?x=1&calc".to_string()]);
        }
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
    fn terminal_execute_defaults_to_debug_only() {
        if cfg!(debug_assertions) {
            assert!(terminal_execute_allowed());
        }
    }

    #[test]
    fn terminal_execute_origin_must_be_local() {
        assert!(terminal_execute_origin_allowed(
            &Url::parse("http://localhost:3210").expect("local URL")
        ));
        assert!(terminal_execute_origin_allowed(
            &Url::parse("tauri://localhost").expect("tauri URL")
        ));
        assert!(terminal_execute_origin_allowed(
            &Url::parse("https://tauri.localhost").expect("asset URL")
        ));
        assert!(!terminal_execute_origin_allowed(
            &Url::parse("https://www.taskforceai.chat").expect("remote URL")
        ));
    }

    #[tokio::test]
    async fn read_limited_output_truncates_large_streams() {
        let input = tokio_test::io::Builder::new()
            .read(b"abcdef")
            .read(b"ghijkl")
            .build();

        let output = read_limited_output(input, 8).await.expect("read output");

        assert_eq!(output, "abcdefgh\n...[output truncated]");
    }

    #[tokio::test]
    async fn terminal_execute_rejects_blank_commands() {
        let local_url = Url::parse("http://localhost:3210").expect("local URL");
        let err = terminal_execute_with_timeout(
            "   ".to_string(),
            TERMINAL_EXEC_TIMEOUT,
            Some(&local_url),
            Path::new("."),
        )
        .await
        .expect_err("blank command should fail");

        assert_eq!(err, "Command is required");
    }

    #[tokio::test]
    async fn terminal_execute_captures_stdout_stderr_and_exit_code() {
        if !terminal_execute_allowed() {
            return;
        }

        let local_url = Url::parse("http://localhost:3210").expect("local URL");
        let result = terminal_execute_with_timeout(
            "printf 'desktop stdout'; printf 'desktop stderr' >&2; exit 7".to_string(),
            TERMINAL_EXEC_TIMEOUT,
            Some(&local_url),
            Path::new("."),
        )
        .await
        .expect("command should execute");

        assert_eq!(
            result.command,
            "printf 'desktop stdout'; printf 'desktop stderr' >&2; exit 7"
        );
        assert_eq!(result.exit_code, Some(7));
        assert_eq!(result.stdout, "desktop stdout");
        assert_eq!(result.stderr, "desktop stderr");
        assert!(!result.cwd.is_empty());
    }

    #[tokio::test]
    async fn terminal_execute_timeout_covers_inherited_output_pipes() {
        if !terminal_execute_allowed() {
            return;
        }

        let err = terminal_execute_with_timeout(
            "sleep 1 & exit 0".to_string(),
            Duration::from_millis(50),
            Some(&Url::parse("http://localhost:3210").expect("local URL")),
            Path::new("."),
        )
        .await
        .expect_err("background child holding inherited pipes should time out");

        assert!(err.starts_with("Command timed out after "));
    }

    fn unique_test_dir(prefix: &str) -> PathBuf {
        let suffix = format!(
            "{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system clock should be after epoch")
                .as_nanos()
        );
        std::env::temp_dir().join(format!("taskforceai-desktop-{prefix}-{suffix}"))
    }
}
