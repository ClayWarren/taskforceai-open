use serde::{Deserialize, Serialize};
use taskforceai_app_client::{AppClientError, AppServerRequestHandle};
use taskforceai_app_protocol::{
    AgentSessionCreateParams, AgentSessionIDParams, AgentSessionRecord, AgentSessionResult,
    AgentSessionRunParams, AgentSessionRunResult, ClientMcpTool, SubmitRunParams, SubmitRunResult,
    ThreadIDParams, ThreadResult, ThreadStartParams, TurnResult, TurnStartParams,
};

use super::{call_app_server, call_local_coding_app_server};
use crate::state::AppState;

#[tauri::command]
#[tracing::instrument(skip(state, params), err)]
pub async fn app_server_submit_run(
    state: tauri::State<'_, AppState>,
    params: SubmitRunParams,
) -> Result<SubmitRunResult, String> {
    let workspace_roots = state.local_coding_workspace_roots();
    call_local_coding_app_server(state, "submit_run", |client| {
        Box::pin(async move {
            if !workspace_roots.is_empty() {
                ensure_workspace_tools_for_roots(&client, &workspace_roots).await?;
            }
            client
                .run_submit(enrich_local_coding_submit_params_for_roots(
                    params,
                    &workspace_roots,
                ))
                .await
        })
    })
    .await
}

fn enrich_local_coding_submit_params_for_roots(
    mut params: SubmitRunParams,
    workspace_roots: &[std::path::PathBuf],
) -> SubmitRunParams {
    if workspace_roots.is_empty() {
        return params;
    }
    add_local_coding_client_tools(&mut params.client_mcp_tools);
    params.prompt = local_coding_prompt_for_roots(workspace_roots, &params.prompt);
    params
}

#[cfg(test)]
pub(super) fn enrich_local_coding_submit_params(
    mut params: SubmitRunParams,
    workspace: Option<std::path::PathBuf>,
) -> SubmitRunParams {
    let Some(workspace) = workspace else {
        return params;
    };
    let workspace = workspace.display().to_string();
    add_local_coding_client_tools(&mut params.client_mcp_tools);
    params.prompt = local_coding_prompt_for_request(&workspace, &params.prompt);
    params
}

pub(super) fn enrich_local_coding_agent_session_run_params(
    mut params: AgentSessionRunParams,
    workspace_roots: &[std::path::PathBuf],
    fallback_prompt: Option<String>,
) -> AgentSessionRunParams {
    add_local_coding_client_tools(&mut params.client_mcp_tools);
    let prompt = params
        .prompt
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or(fallback_prompt);
    if let Some(prompt) = prompt {
        params.prompt = Some(local_coding_prompt_for_roots(workspace_roots, &prompt));
    }
    params
}

pub(super) fn enrich_local_coding_turn_start_params(
    mut params: TurnStartParams,
    workspace_roots: &[std::path::PathBuf],
) -> TurnStartParams {
    add_local_coding_client_tools(&mut params.client_mcp_tools);
    params.input = local_coding_prompt_for_roots(workspace_roots, &params.input);
    params
}

#[cfg(test)]
fn local_coding_prompt_for_request(workspace: &str, request: &str) -> String {
    format!(
        "{}\n\nUser request:\n{}",
        local_coding_prompt_prefix(workspace),
        request
    )
}

fn local_coding_prompt_for_roots(workspace_roots: &[std::path::PathBuf], request: &str) -> String {
    let roots = workspace_roots
        .iter()
        .map(|root| format!("- `{}`", root.display()))
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        "You are operating in TaskForceAI Desktop local coding mode across these workspace roots:\n{roots}\n\nUse the available MCP tools from `workspace` for file reads, writes, edits, directory creation, and listings. Resolve relative paths against the appropriate root and do not move changes between repositories unless the user asks. Do not claim that files were created, read, or edited unless you used those tools and observed the result. Keep the final answer concise and mention the changed files and repository.\n\nUser request:\n{request}"
    )
}

#[cfg(test)]
fn local_coding_prompt_prefix(workspace: &str) -> String {
    format!(
	    "You are operating in TaskForceAI Desktop local coding mode for workspace `{workspace}`.\n\
Use the available MCP tools from `workspace` for file reads, writes, edits, directory creation, and listings. Do not claim that files were created, read, or edited unless you used those tools and observed the result. Keep the final answer concise and mention the changed files."
	)
}

fn local_coding_client_tools() -> Vec<ClientMcpTool> {
    const FILESYSTEM_TOOLS: &[(&str, &str)] = &[
        ("read_file", "Read a file in the selected local workspace"),
        (
            "read_multiple_files",
            "Read multiple files in the selected local workspace",
        ),
        (
            "write_file",
            "Create or overwrite a file in the selected local workspace",
        ),
        (
            "edit_file",
            "Edit an existing file in the selected local workspace",
        ),
        (
            "create_directory",
            "Create a directory in the selected local workspace",
        ),
        (
            "list_directory",
            "List a directory in the selected local workspace",
        ),
        (
            "directory_tree",
            "Inspect the directory tree in the selected local workspace",
        ),
        (
            "get_file_info",
            "Inspect file metadata in the selected local workspace",
        ),
        (
            "search_files",
            "Search files in the selected local workspace",
        ),
    ];
    FILESYSTEM_TOOLS
        .iter()
        .map(|(name, description)| ClientMcpTool {
            server_name: crate::local_coding::WORKSPACE_MCP_SERVER_NAME.to_string(),
            tool_name: (*name).to_string(),
            title: Some((*name).to_string()),
            description: Some((*description).to_string()),
        })
        .collect()
}

fn add_local_coding_client_tools(client_mcp_tools: &mut Vec<ClientMcpTool>) {
    for tool in local_coding_client_tools() {
        if !client_mcp_tools.iter().any(|existing| {
            existing.server_name == tool.server_name && existing.tool_name == tool.tool_name
        }) {
            client_mcp_tools.push(tool);
        }
    }
}

async fn ensure_workspace_tools_for_roots(
    client: &AppServerRequestHandle,
    workspace_roots: &[std::path::PathBuf],
) -> Result<(), AppClientError> {
    crate::local_coding::enable_workspace_tools_for_roots(client, workspace_roots)
        .await
        .map(|_| ())
}

fn agent_session_prompt(session: &AgentSessionRecord) -> String {
    match session.last_message.as_deref() {
        Some(message) if !message.trim().is_empty() => {
            format!("{}\n\nSteering: {}", session.objective, message.trim())
        }
        _ => session.objective.clone(),
    }
}

fn bind_result_workspace_roots(
    state: &AppState,
    session_id: &str,
    workspace_roots: Vec<std::path::PathBuf>,
) -> Result<(), String> {
    if !workspace_roots.is_empty() {
        state.bind_local_coding_session_roots(session_id.to_string(), workspace_roots)?;
    }
    Ok(())
}

#[tauri::command]
#[tracing::instrument(skip(state, params), err)]
pub async fn app_server_agent_session_create(
    state: tauri::State<'_, AppState>,
    params: AgentSessionCreateParams,
) -> Result<AgentSessionResult, String> {
    let workspace_roots = state.local_coding_workspace_roots();
    let result = call_app_server(state.clone(), "agent_session_create", |client| {
        Box::pin(async move { client.agent_session_create(params).await })
    })
    .await?;
    bind_result_workspace_roots(&state, &result.session.session_id, workspace_roots)?;
    Ok(result)
}

#[tauri::command]
#[tracing::instrument(skip(state, params), err)]
pub async fn app_server_thread_start(
    state: tauri::State<'_, AppState>,
    params: ThreadStartParams,
) -> Result<ThreadResult, String> {
    let workspace_roots = state.local_coding_workspace_roots();
    let result = call_app_server(state.clone(), "thread_start", |client| {
        Box::pin(async move { client.thread_start(params).await })
    })
    .await?;
    bind_result_workspace_roots(&state, &result.thread.id, workspace_roots)?;
    Ok(result)
}

#[tauri::command]
#[tracing::instrument(skip(state, params), err)]
pub async fn app_server_agent_session_run(
    state: tauri::State<'_, AppState>,
    params: AgentSessionRunParams,
) -> Result<AgentSessionRunResult, String> {
    let workspace_roots = state.local_coding_workspace_roots_for_session(&params.session_id)?;
    call_local_coding_app_server(state, "agent_session_run", |client| {
        Box::pin(async move {
            let mut params = params;
            if let Some(workspace_roots) = workspace_roots {
                ensure_workspace_tools_for_roots(&client, &workspace_roots).await?;
                let fallback_prompt = if params
                    .prompt
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .is_none()
                {
                    Some(
                        client
                            .agent_session_get(AgentSessionIDParams {
                                session_id: params.session_id.clone(),
                            })
                            .await
                            .map(|result| agent_session_prompt(&result.session))?,
                    )
                } else {
                    None
                };
                params = enrich_local_coding_agent_session_run_params(
                    params,
                    &workspace_roots,
                    fallback_prompt,
                );
            }
            client.agent_session_run(params).await
        })
    })
    .await
}

#[tauri::command]
#[tracing::instrument(skip(state, params), err)]
pub async fn app_server_turn_start(
    state: tauri::State<'_, AppState>,
    params: TurnStartParams,
) -> Result<TurnResult, String> {
    let workspace_roots = state.local_coding_workspace_roots_for_session(&params.thread_id)?;
    call_local_coding_app_server(state, "turn_start", |client| {
        Box::pin(async move {
            let mut params = params;
            if let Some(workspace_roots) = workspace_roots {
                ensure_workspace_tools_for_roots(&client, &workspace_roots).await?;
                params = enrich_local_coding_turn_start_params(params, &workspace_roots);
            }
            client.turn_start(params).await
        })
    })
    .await
}

#[tauri::command]
#[tracing::instrument(skip(state), err)]
pub async fn app_server_agent_session_fork(
    state: tauri::State<'_, AppState>,
    session_id: String,
) -> Result<AgentSessionResult, String> {
    let workspace_roots = state.local_coding_workspace_roots_for_session(&session_id)?;
    let result = call_app_server(state.clone(), "agent_session_fork", |client| {
        Box::pin(async move {
            client
                .agent_session_fork(AgentSessionIDParams { session_id })
                .await
        })
    })
    .await?;
    bind_result_workspace_roots(
        &state,
        &result.session.session_id,
        workspace_roots.unwrap_or_default(),
    )?;
    Ok(result)
}

#[tauri::command]
#[tracing::instrument(skip(state), err)]
pub async fn app_server_thread_fork(
    state: tauri::State<'_, AppState>,
    thread_id: String,
) -> Result<ThreadResult, String> {
    let workspace_roots = state.local_coding_workspace_roots_for_session(&thread_id)?;
    let result = call_app_server(state.clone(), "thread_fork", |client| {
        Box::pin(async move { client.thread_fork(ThreadIDParams { thread_id }).await })
    })
    .await?;
    bind_result_workspace_roots(
        &state,
        &result.thread.id,
        workspace_roots.unwrap_or_default(),
    )?;
    Ok(result)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopLocalCodingParams {
    pub workspace: Option<String>,
    #[serde(default)]
    pub workspace_roots: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopLocalCodingResult {
    pub workspace: String,
    pub workspace_roots: Vec<String>,
    pub server_name: String,
    pub server_names: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopLocalCodingStatus {
    pub enabled: bool,
    pub workspace: Option<String>,
    pub workspace_roots: Vec<String>,
}

#[tauri::command]
pub fn app_server_disable_local_coding(
    state: tauri::State<'_, AppState>,
) -> Result<DesktopLocalCodingStatus, String> {
    state.clear_local_coding_workspace()?;
    Ok(DesktopLocalCodingStatus {
        enabled: false,
        workspace: None,
        workspace_roots: Vec::new(),
    })
}

#[tauri::command]
#[tracing::instrument(skip(app, state), err)]
pub async fn app_server_enable_local_coding(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    params: Option<DesktopLocalCodingParams>,
) -> Result<DesktopLocalCodingResult, String> {
    let params = params.unwrap_or(DesktopLocalCodingParams {
        workspace: None,
        workspace_roots: Vec::new(),
    });
    let mut workspace_roots = params
        .workspace
        .into_iter()
        .chain(params.workspace_roots)
        .map(|workspace| workspace.trim().to_string())
        .filter(|workspace| !workspace.is_empty())
        .map(std::path::PathBuf::from)
        .collect::<Vec<_>>();
    workspace_roots.dedup();
    if workspace_roots.is_empty() {
        return Err("At least one local coding workspace root is required".to_string());
    }
    let activation_generation = state.begin_local_coding_activation()?;

    let enabled = call_local_coding_app_server(state.clone(), "enable_local_coding", |client| {
        Box::pin(async move {
            crate::local_coding::enable_workspace_tools_for_roots(&client, &workspace_roots).await
        })
    })
    .await?;

    if !state.complete_local_coding_roots_activation(
        activation_generation,
        enabled.workspace_roots.clone(),
    )? {
        return Err("Local coding activation was superseded.".to_string());
    }
    crate::commands::reset_browser_preview_workspace(&app, &state, &enabled.workspace)?;
    Ok(DesktopLocalCodingResult {
        workspace: enabled.workspace.display().to_string(),
        workspace_roots: enabled
            .workspace_roots
            .iter()
            .map(|root| root.display().to_string())
            .collect(),
        server_name: enabled.server_names.join(", "),
        server_names: enabled.server_names,
    })
}
