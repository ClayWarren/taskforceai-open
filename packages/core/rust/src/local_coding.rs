use std::path::{Path, PathBuf};

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

/// Applies workspace policy to path facts resolved by an outer host adapter.
pub fn validate_workspace_path(
    workspace: PathBuf,
    is_directory: bool,
    home: Option<&Path>,
) -> Result<PathBuf, String> {
    if !is_directory {
        return Err("Local coding workspace must be an existing directory".to_string());
    }
    if is_broad_workspace_root(&workspace, home) {
        return Err(format!(
            "Local coding workspace must be a specific project directory, not {}",
            workspace.display()
        ));
    }
    Ok(workspace)
}

pub fn is_broad_workspace_root(path: &Path, home: Option<&Path>) -> bool {
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
    if home.is_some_and(|home| path == home) {
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

pub fn filesystem_tool_names() -> Vec<String> {
    FILESYSTEM_TOOLS
        .iter()
        .map(|tool| (*tool).to_string())
        .collect()
}

pub fn prompt_for_workspace_roots(workspace_roots: &[PathBuf], request: &str) -> String {
    if workspace_roots.is_empty() {
        return request.to_string();
    }
    let roots = workspace_roots
        .iter()
        .map(|root| format!("- `{}`", root.display()))
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        "You are operating in TaskForceAI Code mode with these working-directory roots:\n{roots}\n\nUse the available MCP tools from `workspace` for file reads, writes, edits, directory creation, and listings. Resolve relative paths against the appropriate root and do not move changes between repositories unless the user asks. Do not claim that files were created, read, or edited unless you used those tools and observed the result. Keep the final answer concise and mention the changed files and repository.\n\nUser request:\n{request}"
    )
}

pub fn filesystem_mcp_endpoint_for_roots(workspaces: &[PathBuf]) -> String {
    let roots = workspaces
        .iter()
        .map(|workspace| quote_command_arg(&workspace.to_string_lossy()))
        .collect::<Vec<_>>()
        .join(" ");
    format!("stdio:bunx @modelcontextprotocol/server-filesystem {roots}")
}

pub fn quote_command_arg(value: &str) -> String {
    let escaped = value.replace('\\', "\\\\").replace('"', "\\\"");
    format!("\"{escaped}\"")
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::{
        filesystem_mcp_endpoint_for_roots, filesystem_tool_names, is_broad_workspace_root,
        prompt_for_workspace_roots, quote_command_arg, validate_workspace_path,
        WORKSPACE_MCP_SERVER_NAME,
    };

    #[test]
    fn workspace_server_name_is_stable() {
        assert_eq!(WORKSPACE_MCP_SERVER_NAME, "workspace");
    }

    #[test]
    fn filesystem_tool_policy_is_stable() {
        assert_eq!(
            filesystem_tool_names(),
            vec![
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
            ]
        );
    }

    #[test]
    fn workspace_validation_rejects_broad_roots() {
        let err = validate_workspace_path(Path::new("/").to_path_buf(), true, None)
            .expect_err("root must be rejected");
        assert!(err.contains("specific project directory"), "{err}");
        assert!(is_broad_workspace_root(Path::new("/private/var"), None));
        assert!(is_broad_workspace_root(Path::new("/usr/local/bin"), None));
        assert!(is_broad_workspace_root(
            Path::new("/home/example"),
            Some(Path::new("/home/example")),
        ));
    }

    #[test]
    fn workspace_validation_rejects_existing_files() {
        let file_path = Path::new("/projects/taskforceai/Cargo.toml").to_path_buf();

        let err = validate_workspace_path(file_path, false, None).expect_err("file should fail");

        assert_eq!(err, "Local coding workspace must be an existing directory");
    }

    #[test]
    fn workspace_prompt_and_endpoint_preserve_every_selected_root() {
        let roots = vec![
            Path::new("/projects/taskforceai").to_path_buf(),
            Path::new("/projects/shared tools").to_path_buf(),
        ];

        assert_eq!(
            filesystem_mcp_endpoint_for_roots(&roots),
            "stdio:bunx @modelcontextprotocol/server-filesystem \"/projects/taskforceai\" \"/projects/shared tools\""
        );
        let prompt = prompt_for_workspace_roots(&roots, "Fix the tests");
        assert!(prompt.contains("`/projects/taskforceai`"));
        assert!(prompt.contains("`/projects/shared tools`"));
        assert!(prompt.ends_with("User request:\nFix the tests"));
        assert_eq!(quote_command_arg("a\\b\"c"), "\"a\\\\b\\\"c\"");
    }
}
