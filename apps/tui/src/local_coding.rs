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

pub async fn enable_workspace_tools(
    client: &mut AppServerClient,
    workspace: impl AsRef<Path>,
) -> Result<PathBuf, AppClientError> {
    let workspace =
        validate_workspace_path(workspace.as_ref()).map_err(|message| AppClientError::Rpc {
            code: -32602,
            message,
        })?;
    let endpoint = filesystem_mcp_endpoint(&workspace);
    let tools = filesystem_tool_names();

    client
        .mcp_add(McpServerAddParams {
            name: WORKSPACE_MCP_SERVER_NAME.to_string(),
            endpoint,
            tools: tools.clone(),
            enabled: true,
        })
        .await?;
    client
        .mcp_tools(McpServerToolsParams {
            name: WORKSPACE_MCP_SERVER_NAME.to_string(),
            tools,
        })
        .await?;

    Ok(workspace)
}

pub fn default_workspace() -> PathBuf {
    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
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
mod tests {
    use std::path::Path;

    use super::{
        filesystem_mcp_endpoint, is_broad_workspace_root, quote_command_arg,
        validate_workspace_path, WORKSPACE_MCP_SERVER_NAME,
    };

    #[test]
    fn workspace_server_name_is_stable() {
        assert_eq!(WORKSPACE_MCP_SERVER_NAME, "workspace");
    }

    #[test]
    fn endpoint_scopes_filesystem_server_to_workspace_path() {
        let endpoint = filesystem_mcp_endpoint(Path::new("/tmp/work dir"));

        assert_eq!(
            endpoint,
            "stdio:bunx @modelcontextprotocol/server-filesystem \"/tmp/work dir\""
        );
    }

    #[test]
    fn workspace_validation_rejects_broad_roots() {
        let err = validate_workspace_path(Path::new("/")).expect_err("root must be rejected");
        assert!(err.contains("specific project directory"), "{err}");
        assert!(is_broad_workspace_root(Path::new("/private/var")));
    }

    #[test]
    fn command_args_escape_quotes_and_backslashes() {
        assert_eq!(
            quote_command_arg(r#"/tmp/a "quoted" dir"#),
            r#""/tmp/a \"quoted\" dir""#
        );
        assert_eq!(quote_command_arg(r#"/tmp/a\b"#), r#""/tmp/a\\b""#);
    }
}
