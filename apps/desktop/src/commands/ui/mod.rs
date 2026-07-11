mod local_environment;
mod system;
mod terminal;
mod workspace;

pub use local_environment::*;
pub use system::*;
pub use terminal::*;
pub use workspace::*;

use std::path::PathBuf;

use tauri::Window;
use tracing::{info, warn};

use crate::state::{AppState, BootstrapState};

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

#[cfg(test)]
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bootstrap_state_starts_hidden_for_frontend_ready() {
        let bootstrap = BootstrapState::new();
        assert!(!bootstrap.has_displayed());
    }
}
