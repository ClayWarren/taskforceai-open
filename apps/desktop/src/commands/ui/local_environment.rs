use std::path::Path;

use super::terminal::{
    terminal_execute_with_timeout, TerminalExecuteResult, TERMINAL_EXEC_TIMEOUT,
};
use super::workspace_root;
use crate::state::AppState;

#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalEnvironmentScripts {
    #[serde(default)]
    default: Option<String>,
    #[serde(default)]
    macos: Option<String>,
    #[serde(default)]
    windows: Option<String>,
    #[serde(default)]
    linux: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalEnvironmentAction {
    id: String,
    name: String,
    #[serde(default)]
    icon: Option<String>,
    scripts: LocalEnvironmentScripts,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalEnvironmentConfig {
    #[serde(default)]
    setup: LocalEnvironmentScripts,
    #[serde(default)]
    actions: Vec<LocalEnvironmentAction>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalEnvironmentStatus {
    workspace: String,
    config_path: String,
    exists: bool,
    config: LocalEnvironmentConfig,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalEnvironmentUpdateParams {
    config: LocalEnvironmentConfig,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalEnvironmentActionRunParams {
    action_id: String,
}

#[tauri::command]
pub async fn local_environment_status(
    state: tauri::State<'_, AppState>,
) -> Result<LocalEnvironmentStatus, String> {
    let workspace = workspace_root(&state)?;
    local_environment_status_for_workspace(&workspace)
}

#[tauri::command]
pub async fn local_environment_save(
    state: tauri::State<'_, AppState>,
    params: LocalEnvironmentUpdateParams,
) -> Result<LocalEnvironmentStatus, String> {
    let workspace = workspace_root(&state)?;
    save_local_environment_config(
        &workspace,
        &normalize_local_environment_config(params.config),
    )?;
    local_environment_status_for_workspace(&workspace)
}

#[tauri::command]
pub async fn local_environment_run_setup(
    state: tauri::State<'_, AppState>,
    window: tauri::WebviewWindow,
) -> Result<TerminalExecuteResult, String> {
    let url = window
        .url()
        .map_err(|error| format!("Failed to resolve desktop webview URL: {error}"))?;
    let workspace = workspace_root(&state)?;
    let status = local_environment_status_for_workspace(&workspace)?;
    let script = select_local_environment_script(&status.config.setup)
        .ok_or_else(|| "Local environment setup script is not configured.".to_string())?;
    terminal_execute_with_timeout(
        script.to_string(),
        TERMINAL_EXEC_TIMEOUT,
        window.label(),
        Some(&url),
        &workspace,
    )
    .await
}

#[tauri::command]
pub async fn local_environment_run_action(
    state: tauri::State<'_, AppState>,
    window: tauri::WebviewWindow,
    params: LocalEnvironmentActionRunParams,
) -> Result<TerminalExecuteResult, String> {
    let url = window
        .url()
        .map_err(|error| format!("Failed to resolve desktop webview URL: {error}"))?;
    let workspace = workspace_root(&state)?;
    let status = local_environment_status_for_workspace(&workspace)?;
    let action_id = params.action_id.trim();
    let action = status
        .config
        .actions
        .iter()
        .find(|action| action.id == action_id)
        .ok_or_else(|| format!("Local environment action `{action_id}` was not found."))?;
    let script = select_local_environment_script(&action.scripts).ok_or_else(|| {
        format!(
            "Local environment action `{}` has no script for this platform.",
            action.name
        )
    })?;
    terminal_execute_with_timeout(
        script.to_string(),
        TERMINAL_EXEC_TIMEOUT,
        window.label(),
        Some(&url),
        &workspace,
    )
    .await
}

fn local_environment_status_for_workspace(
    workspace: &Path,
) -> Result<LocalEnvironmentStatus, String> {
    let config_path = local_environment_config_path(workspace);
    let exists = config_path.exists();
    let config = if exists {
        let raw = std::fs::read_to_string(&config_path).map_err(|error| {
            format!(
                "Failed to read local environment config {}: {error}",
                config_path.display()
            )
        })?;
        serde_json::from_str(&raw).map_err(|error| {
            format!(
                "Failed to parse local environment config {}: {error}",
                config_path.display()
            )
        })?
    } else {
        LocalEnvironmentConfig::default()
    };
    Ok(LocalEnvironmentStatus {
        workspace: workspace.display().to_string(),
        config_path: config_path.display().to_string(),
        exists,
        config: normalize_local_environment_config(config),
    })
}

fn save_local_environment_config(
    workspace: &Path,
    config: &LocalEnvironmentConfig,
) -> Result<(), String> {
    let config_path = local_environment_config_path(workspace);
    let parent = config_path
        .parent()
        .expect("local environment config should have a parent directory");
    std::fs::create_dir_all(parent).map_err(|error| {
        format!(
            "Failed to create local environment config directory {}: {error}",
            parent.display()
        )
    })?;
    let raw =
        serde_json::to_string_pretty(config).expect("local environment config should serialize");
    std::fs::write(&config_path, raw).map_err(|error| {
        format!(
            "Failed to write local environment config {}: {error}",
            config_path.display()
        )
    })
}

fn local_environment_config_path(workspace: &Path) -> std::path::PathBuf {
    workspace
        .join(".codex")
        .join("environments")
        .join("environment.json")
}

fn normalize_local_environment_config(
    mut config: LocalEnvironmentConfig,
) -> LocalEnvironmentConfig {
    config.setup = normalize_local_environment_scripts(config.setup);
    config.actions = config
        .actions
        .into_iter()
        .filter_map(|action| {
            let id = action.id.trim();
            let name = action.name.trim();
            if id.is_empty() || name.is_empty() {
                return None;
            }
            Some(LocalEnvironmentAction {
                id: id.to_string(),
                name: name.to_string(),
                icon: action
                    .icon
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(ToString::to_string),
                scripts: normalize_local_environment_scripts(action.scripts),
            })
        })
        .collect();
    config
}

fn normalize_local_environment_scripts(
    scripts: LocalEnvironmentScripts,
) -> LocalEnvironmentScripts {
    LocalEnvironmentScripts {
        default: normalize_optional_script(scripts.default),
        macos: normalize_optional_script(scripts.macos),
        windows: normalize_optional_script(scripts.windows),
        linux: normalize_optional_script(scripts.linux),
    }
}

fn normalize_optional_script(script: Option<String>) -> Option<String> {
    script
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn select_local_environment_script(scripts: &LocalEnvironmentScripts) -> Option<&str> {
    let platform = if cfg!(target_os = "macos") {
        scripts.macos.as_deref()
    } else if cfg!(target_os = "windows") {
        scripts.windows.as_deref()
    } else {
        scripts.linux.as_deref()
    };
    platform
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .or_else(|| {
            scripts
                .default
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
        })
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::super::unique_test_dir;
    use super::*;

    #[test]
    fn local_environment_status_reads_and_normalizes_project_config() {
        let root = unique_test_dir("local-environment-status");
        let config = LocalEnvironmentConfig {
            setup: LocalEnvironmentScripts {
                default: Some(" bun install ".to_string()),
                macos: None,
                windows: None,
                linux: None,
            },
            actions: vec![
                LocalEnvironmentAction {
                    id: " test ".to_string(),
                    name: " Test ".to_string(),
                    icon: Some(" play ".to_string()),
                    scripts: LocalEnvironmentScripts {
                        default: Some(" bun test ".to_string()),
                        macos: None,
                        windows: None,
                        linux: None,
                    },
                },
                LocalEnvironmentAction {
                    id: " ".to_string(),
                    name: "Ignored".to_string(),
                    icon: None,
                    scripts: LocalEnvironmentScripts::default(),
                },
            ],
        };
        save_local_environment_config(&root, &config).expect("save config");

        let status = local_environment_status_for_workspace(&root).expect("read config");

        assert!(status.exists);
        assert_eq!(status.config.setup.default.as_deref(), Some("bun install"));
        assert_eq!(status.config.actions.len(), 1);
        assert_eq!(status.config.actions[0].id, "test");
        assert_eq!(status.config.actions[0].name, "Test");
        assert_eq!(status.config.actions[0].icon.as_deref(), Some("play"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn local_environment_script_selection_prefers_platform_then_default() {
        let scripts = LocalEnvironmentScripts {
            default: Some("default".to_string()),
            macos: Some("mac".to_string()),
            windows: Some("windows".to_string()),
            linux: Some("linux".to_string()),
        };
        let selected = select_local_environment_script(&scripts);

        #[cfg(target_os = "macos")]
        assert_eq!(selected, Some("mac"));
        #[cfg(target_os = "windows")]
        assert_eq!(selected, Some("windows"));
        #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
        assert_eq!(selected, Some("linux"));

        assert_eq!(
            select_local_environment_script(&LocalEnvironmentScripts {
                default: Some("fallback".to_string()),
                ..LocalEnvironmentScripts::default()
            }),
            Some("fallback")
        );
    }
}
