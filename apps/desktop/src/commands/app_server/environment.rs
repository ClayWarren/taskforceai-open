use taskforceai_app_protocol::{CommandExecuteParams, CommandExecuteResult};
use tracing::{error, info};

use super::call_app_server;
use crate::{
    app_server::{
        DesktopAppServerEnvironmentStatus, DesktopHttpPairingInfo, DesktopSshConnectParams,
        DesktopSshConnectResult, DesktopSshProbeParams, DesktopSshProbeResult,
    },
    state::AppState,
};

#[tauri::command]
#[tracing::instrument(skip(state), err)]
pub async fn app_server_http_pairing_info(
    state: tauri::State<'_, AppState>,
) -> Result<DesktopHttpPairingInfo, String> {
    info!(target: "app_server", "Ensuring app-server http pairing transport");
    metrics::counter!("app_server.command", "name" => "http_pairing_info").increment(1);
    state.app_server.http_pairing_info().await.map_err(|err| {
        error!(
            target: "app_server",
            error = %err,
            "App-server http pairing transport failed"
        );
        err.to_string()
    })
}

#[tauri::command]
#[tracing::instrument(skip(state, params), err)]
pub async fn app_server_ssh_probe(
    state: tauri::State<'_, AppState>,
    params: DesktopSshProbeParams,
) -> Result<DesktopSshProbeResult, String> {
    info!(target: "app_server", target = %params.target, "Probing SSH app-server environment");
    metrics::counter!("app_server.command", "name" => "ssh_probe").increment(1);
    state.app_server.ssh_probe(params).await.map_err(|err| {
        error!(
            target: "app_server",
            error = %err,
            "SSH app-server environment probe failed"
        );
        err.to_string()
    })
}

#[tauri::command]
#[tracing::instrument(skip(state, params), err)]
pub async fn app_server_ssh_connect(
    state: tauri::State<'_, AppState>,
    params: DesktopSshConnectParams,
) -> Result<DesktopSshConnectResult, String> {
    info!(target: "app_server", target = %params.target, "Connecting SSH app-server environment");
    metrics::counter!("app_server.command", "name" => "ssh_connect").increment(1);
    state.app_server.ssh_connect(params).await.map_err(|err| {
        error!(
            target: "app_server",
            error = %err,
            "SSH app-server environment connection failed"
        );
        err.to_string()
    })
}

#[tauri::command]
#[tracing::instrument(skip(state), err)]
pub async fn app_server_environment_use_local(
    state: tauri::State<'_, AppState>,
) -> Result<DesktopAppServerEnvironmentStatus, String> {
    info!(target: "app_server", "Switching active app-server environment to local");
    metrics::counter!("app_server.command", "name" => "environment_use_local").increment(1);
    state.app_server.use_local_environment().await;
    Ok(state.app_server.environment_status().await)
}

#[tauri::command]
#[tracing::instrument(skip(state), err)]
pub async fn app_server_environment_disconnect_remote(
    state: tauri::State<'_, AppState>,
) -> Result<DesktopAppServerEnvironmentStatus, String> {
    info!(target: "app_server", "Disconnecting remote app-server environment");
    metrics::counter!("app_server.command", "name" => "environment_disconnect_remote").increment(1);
    state.app_server.disconnect_remote_environment().await;
    Ok(state.app_server.environment_status().await)
}

#[tauri::command]
#[tracing::instrument(skip(state), err)]
pub async fn app_server_environment_status(
    state: tauri::State<'_, AppState>,
) -> Result<DesktopAppServerEnvironmentStatus, String> {
    metrics::counter!("app_server.command", "name" => "environment_status").increment(1);
    Ok(state.app_server.environment_status().await)
}

#[tauri::command]
#[tracing::instrument(skip(state), err)]
pub async fn app_server_command_execute(
    state: tauri::State<'_, AppState>,
    params: CommandExecuteParams,
) -> Result<CommandExecuteResult, String> {
    let trimmed_input = params.input.trim();
    let mut parts = trimmed_input.split_whitespace();
    let command = parts.next().unwrap_or_default();
    if command == "/code" || command == "/coding" || command == "/workspace" {
        let workspace = parts.collect::<Vec<_>>().join(" ");
        if workspace.trim().is_empty() {
            return Ok(CommandExecuteResult {
                handled: true,
                title: "Code".to_string(),
                message: "Usage: /code <project-directory>".to_string(),
            });
        }
        let workspace = std::path::PathBuf::from(workspace.trim());

        let enabled = call_app_server(state.clone(), "enable_local_coding", |client| {
            Box::pin(
                async move { crate::local_coding::enable_workspace_tools(client, workspace).await },
            )
        })
        .await?;
        state.set_local_coding_workspace(enabled.workspace.clone());

        return Ok(CommandExecuteResult {
	        handled: true,
	        title: "Code".to_string(),
	        message: format!(
	            "Workspace tools enabled for {}.\nUse explicit local workspace actions for file operations. Enabled MCP servers: {}.",
	            enabled.workspace.display(),
	            enabled.server_names.join(", ")
	        ),
        });
    }

    call_app_server(state, "command_execute", |client| {
        Box::pin(async move { client.command_execute(params).await })
    })
    .await
}
