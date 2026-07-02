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
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::path::Path;
    use std::thread;

    use serde_json::{json, Value};
    use taskforceai_app_client::AppServerClient;
    use taskforceai_app_protocol::JSONRPC_VERSION;

    use super::enable_workspace_tools;
    use super::{
        default_workspace, filesystem_mcp_endpoint, filesystem_tool_names, is_broad_workspace_root,
        quote_command_arg, validate_workspace_path, WORKSPACE_MCP_SERVER_NAME,
    };

    fn rpc_response(id: Value, result: Value) -> String {
        json!({
            "jsonrpc": JSONRPC_VERSION,
            "id": id,
            "result": result
        })
        .to_string()
    }

    fn start_rpc_sequence_server(
        responses: Vec<(&'static str, Value)>,
    ) -> (String, thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("rpc server should bind");
        let address = listener
            .local_addr()
            .expect("rpc address should be readable");
        let server = thread::spawn(move || {
            for (expected_method, result) in responses {
                let (mut stream, _) = listener.accept().expect("rpc request should connect");
                let body = read_http_body(&mut stream);
                let request: Value =
                    serde_json::from_str(&body).expect("rpc request body should be json");
                assert_eq!(request["method"], expected_method);
                let response_body = rpc_response(request["id"].clone(), result);
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    response_body.len(),
                    response_body
                );
                stream
                    .write_all(response.as_bytes())
                    .expect("rpc response should write");
            }
        });
        (format!("http://{address}"), server)
    }

    fn read_http_body(stream: &mut std::net::TcpStream) -> String {
        let mut buffer = Vec::new();
        let mut chunk = [0_u8; 1024];
        let header_end = loop {
            let read = stream.read(&mut chunk).expect("request should read");
            if read == 0 {
                break buffer.len();
            }
            buffer.extend_from_slice(&chunk[..read]);
            if let Some(index) = buffer.windows(4).position(|window| window == b"\r\n\r\n") {
                break index + 4;
            }
        };
        let headers = String::from_utf8_lossy(&buffer[..header_end]);
        let content_length = headers
            .lines()
            .find_map(|line| {
                let (name, value) = line.split_once(':')?;
                name.eq_ignore_ascii_case("content-length")
                    .then(|| value.trim().parse::<usize>().ok())
                    .flatten()
            })
            .unwrap_or(0);
        while buffer.len().saturating_sub(header_end) < content_length {
            let read = stream.read(&mut chunk).expect("request body should read");
            if read == 0 {
                break;
            }
            buffer.extend_from_slice(&chunk[..read]);
        }
        String::from_utf8_lossy(
            &buffer[header_end..header_end + content_length.min(buffer.len() - header_end)],
        )
        .to_string()
    }

    fn mcp_server_result(endpoint: &str) -> Value {
        json!({
            "server": {
                "name": WORKSPACE_MCP_SERVER_NAME,
                "endpoint": endpoint,
                "tools": filesystem_tool_names(),
                "enabled": true
            }
        })
    }

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
        assert!(is_broad_workspace_root(Path::new("/usr/local/bin")));

        let err = validate_workspace_path(Path::new("/definitely/not/a/taskforceai/workspace"))
            .expect_err("missing workspace should fail");
        assert!(err.contains("existing directory"), "{err}");

        let file = tempfile::NamedTempFile::new().expect("temp file");
        let err = validate_workspace_path(file.path()).expect_err("file workspace should fail");
        assert!(err.contains("existing directory"), "{err}");

        if let Some(home) = std::env::var_os("HOME") {
            assert!(is_broad_workspace_root(Path::new(&home)));
        }
    }

    #[test]
    fn command_args_escape_quotes_and_backslashes() {
        assert_eq!(
            quote_command_arg(r#"/tmp/a "quoted" dir"#),
            r#""/tmp/a \"quoted\" dir""#
        );
        assert_eq!(quote_command_arg(r#"/tmp/a\b"#), r#""/tmp/a\\b""#);
    }

    #[test]
    fn default_workspace_uses_current_directory() {
        assert!(default_workspace().is_absolute() || default_workspace() == Path::new("."));
    }

    #[tokio::test]
    async fn enable_workspace_tools_registers_filesystem_server() {
        let dir = tempfile::tempdir().expect("workspace temp dir");
        let workspace = dir.path().canonicalize().expect("canonical workspace");
        let endpoint = filesystem_mcp_endpoint(&workspace);
        let (base_url, server) = start_rpc_sequence_server(vec![
            ("mcp.add", mcp_server_result(&endpoint)),
            ("mcp.tools", mcp_server_result(&endpoint)),
        ]);
        let mut client = AppServerClient::connect_http(base_url, "session-token")
            .expect("test client should connect");

        let enabled = enable_workspace_tools(&mut client, &workspace)
            .await
            .expect("workspace tools should enable");

        assert_eq!(enabled, workspace);
        server.join().expect("rpc sequence should finish");
    }

    #[tokio::test]
    async fn enable_workspace_tools_rejects_invalid_workspace_before_rpc() {
        let (base_url, server) = start_rpc_sequence_server(Vec::new());
        let mut client = AppServerClient::connect_http(base_url, "session-token")
            .expect("test client should connect");

        let err = enable_workspace_tools(&mut client, Path::new("/definitely/not/a/workspace"))
            .await
            .expect_err("missing workspace should fail before rpc");

        assert!(err.to_string().contains("existing directory"));
        server.join().expect("empty rpc sequence should finish");
    }
}
