use serde::{Deserialize, Serialize};
use taskforceai_app_protocol::{ClientMcpTool, SubmitRunParams, SubmitRunResult};

use super::call_app_server;
use crate::state::AppState;

#[tauri::command]
#[tracing::instrument(skip(state, params), err)]
pub async fn app_server_submit_run(
    state: tauri::State<'_, AppState>,
    params: SubmitRunParams,
) -> Result<SubmitRunResult, String> {
    let params = enrich_local_coding_submit_params(params, state.local_coding_workspace());
    call_app_server(state, "submit_run", |client| {
        Box::pin(async move { client.run_submit(params).await })
    })
    .await
}

pub(super) fn enrich_local_coding_submit_params(
    mut params: SubmitRunParams,
    workspace: Option<std::path::PathBuf>,
) -> SubmitRunParams {
    let Some(workspace) = workspace else {
        return params;
    };
    let workspace = workspace.display().to_string();
    for tool in local_coding_client_tools() {
        if !params.client_mcp_tools.iter().any(|existing| {
            existing.server_name == tool.server_name && existing.tool_name == tool.tool_name
        }) {
            params.client_mcp_tools.push(tool);
        }
    }
    params.prompt = format!(
        "{}\n\nUser request:\n{}",
        local_coding_prompt_prefix(&workspace),
        params.prompt
    );
    params
}

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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopLocalCodingParams {
    pub workspace: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopLocalCodingResult {
    pub workspace: String,
    pub server_name: String,
    pub server_names: Vec<String>,
}

#[tauri::command]
#[tracing::instrument(skip(state), err)]
pub async fn app_server_enable_local_coding(
    state: tauri::State<'_, AppState>,
    params: Option<DesktopLocalCodingParams>,
) -> Result<DesktopLocalCodingResult, String> {
    let workspace = params
        .and_then(|params| params.workspace)
        .filter(|workspace| !workspace.trim().is_empty())
        .map(|workspace| std::path::PathBuf::from(workspace.trim()))
        .ok_or_else(|| "Local coding workspace is required".to_string())?;

    let enabled = call_app_server(state.clone(), "enable_local_coding", |client| {
        Box::pin(
            async move { crate::local_coding::enable_workspace_tools(client, workspace).await },
        )
    })
    .await?;

    state.set_local_coding_workspace(enabled.workspace.clone());
    Ok(DesktopLocalCodingResult {
        workspace: enabled.workspace.display().to_string(),
        server_name: enabled.server_names.join(", "),
        server_names: enabled.server_names,
    })
}
