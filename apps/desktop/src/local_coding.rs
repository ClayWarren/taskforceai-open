use std::path::{Path, PathBuf};

use taskforceai_app_client::{AppClientError, AppServerClient};
use taskforceai_app_protocol::{McpServerAddParams, McpServerToolsParams};

pub const WORKSPACE_MCP_SERVER_NAME: &str = "workspace";

const FILESYSTEM_TOOLS: &[&str] = &[
    "read_file",
    "read_multiple_files",
    "write_file",
    "edit_file",
    "create_directory",
    "list_directory",
    "list_directory_with_sizes",
    "directory_tree",
    "move_file",
    "search_files",
    "get_file_info",
    "list_allowed_directories",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalCodingMcpServer {
    pub name: String,
    pub endpoint: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalCodingWorkspace {
    pub workspace: PathBuf,
    pub server_names: Vec<String>,
    pub servers: Vec<LocalCodingMcpServer>,
}

pub async fn enable_workspace_tools(
    client: &mut AppServerClient,
    workspace: impl AsRef<Path>,
) -> Result<LocalCodingWorkspace, AppClientError> {
    let workspace =
        validate_workspace_path(workspace.as_ref()).map_err(|message| AppClientError::Rpc {
            code: -32602,
            message,
        })?;
    let filesystem_tools = filesystem_tool_names();
    let servers = workspace_mcp_servers(&workspace);
    let filesystem_server = &servers[0];

    client
        .mcp_add(McpServerAddParams {
            name: filesystem_server.name.clone(),
            endpoint: filesystem_server.endpoint.clone(),
            tools: filesystem_tools.clone(),
            enabled: filesystem_server.enabled,
        })
        .await?;
    client
        .mcp_tools(McpServerToolsParams {
            name: filesystem_server.name.clone(),
            tools: filesystem_tools,
        })
        .await?;

    Ok(LocalCodingWorkspace {
        workspace,
        server_names: vec![WORKSPACE_MCP_SERVER_NAME.to_string()],
        servers,
    })
}

fn validate_workspace_path(path: &Path) -> Result<PathBuf, String> {
    let workspace = path
        .canonicalize()
        .map_err(|err| format!("Local coding workspace must be an existing directory: {err}"))?;
    if !workspace.is_dir() {
        return Err("Local coding workspace must be an existing directory".to_string());
    }
    if is_broad_workspace_root(&workspace) {
        return Err(format!(
            "Local coding workspace must be a specific project directory, not {}",
            workspace.display()
        ));
    }
    Ok(workspace)
}

fn is_broad_workspace_root(path: &Path) -> bool {
    if path.parent().is_none() {
        return true;
    }
    let broad_roots = [
        "/Users",
        "/home",
        "/tmp",
        "/private/tmp",
        "/var",
        "/private/var",
        "/workspace",
    ];
    if broad_roots.iter().any(|root| path == Path::new(root)) {
        return true;
    }
    if std::env::var_os("HOME").is_some_and(|home| path == Path::new(&home)) {
        return true;
    }
    [
        "/System",
        "/Library",
        "/Applications",
        "/bin",
        "/sbin",
        "/usr",
    ]
    .iter()
    .any(|root| path.starts_with(root))
}

fn filesystem_tool_names() -> Vec<String> {
    FILESYSTEM_TOOLS
        .iter()
        .map(|tool| (*tool).to_string())
        .collect()
}

pub fn workspace_mcp_servers(workspace: &Path) -> Vec<LocalCodingMcpServer> {
    vec![LocalCodingMcpServer {
        name: WORKSPACE_MCP_SERVER_NAME.to_string(),
        endpoint: filesystem_mcp_endpoint(workspace),
        enabled: true,
    }]
}

fn filesystem_mcp_endpoint(workspace: &Path) -> String {
    format!(
        "stdio:bunx @modelcontextprotocol/server-filesystem {}",
        quote_command_arg(&workspace.to_string_lossy())
    )
}

fn quote_command_arg(value: &str) -> String {
    let escaped = value.replace('\\', "\\\\").replace('"', "\\\"");
    format!("\"{escaped}\"")
}

#[cfg(test)]
#[path = "local_coding_tests.rs"]
mod tests;
