use std::{path::Path, process::Stdio};

use tokio::process::Command as TokioCommand;
use tokio::time::{timeout, Duration};
use tracing::info;
use url::Url;

use super::workspace_root;
use crate::process_output::read_limited_output;
use crate::state::AppState;

pub(super) const TERMINAL_EXEC_TIMEOUT: Duration = Duration::from_secs(30);
const TERMINAL_EXEC_OUTPUT_LIMIT_BYTES: usize = 64 * 1024;
const ENABLE_TERMINAL_EXECUTE_ENV: &str = "TASKFORCEAI_DESKTOP_ENABLE_TERMINAL_EXECUTE";
const OUTPUT_READ_ERROR: &str = "Failed to read command output";

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalExecuteResult {
    command: String,
    cwd: String,
    exit_code: Option<i32>,
    stdout: String,
    stderr: String,
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

pub(super) async fn terminal_execute_with_timeout(
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
    if !webview_url.is_some_and(super::privileged_origin_allowed) {
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
        OUTPUT_READ_ERROR,
    ));
    let stderr_task = tokio::spawn(read_limited_output(
        stderr,
        TERMINAL_EXEC_OUTPUT_LIMIT_BYTES,
        OUTPUT_READ_ERROR,
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

#[cfg(test)]
mod tests {
    use super::*;

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
    fn terminal_execute_defaults_to_debug_only() {
        if cfg!(debug_assertions) {
            assert!(terminal_execute_allowed());
        }
    }

    #[tokio::test]
    async fn read_limited_output_truncates_large_streams() {
        let input = tokio_test::io::Builder::new()
            .read(b"abcdef")
            .read(b"ghijkl")
            .build();

        let output = read_limited_output(input, 8, OUTPUT_READ_ERROR)
            .await
            .expect("read output");

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
}
