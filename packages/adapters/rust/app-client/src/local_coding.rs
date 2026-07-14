use std::path::{Path, PathBuf};

use taskforceai_app_protocol::{McpServerAddParams, McpServerToolsParams};
pub use taskforceai_core::local_coding::{filesystem_tool_names, WORKSPACE_MCP_SERVER_NAME};

use crate::{AppClientError, AppServerClient, AppServerRequestHandle};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalCodingMcpServer {
    pub name: String,
    pub endpoint: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalCodingWorkspace {
    pub workspace: PathBuf,
    pub workspace_roots: Vec<PathBuf>,
    pub server_names: Vec<String>,
    pub servers: Vec<LocalCodingMcpServer>,
}

pub fn validate_workspace_path(path: &Path) -> Result<PathBuf, String> {
    let workspace = canonicalize_existing_directory(path)?;
    let is_directory = workspace.is_dir();
    let home = std::env::var_os("HOME").map(PathBuf::from);
    taskforceai_core::local_coding::validate_workspace_path(
        workspace,
        is_directory,
        home.as_deref(),
    )
}

/// Resolves the directory that explicitly launched a local Code session.
///
/// Unlike project pickers, a terminal launch is already an explicit scope
/// choice, so the user's home directory remains a valid workspace.
pub fn resolve_launch_directory(path: &Path) -> Result<PathBuf, String> {
    canonicalize_existing_directory(path)
}

fn canonicalize_existing_directory(path: &Path) -> Result<PathBuf, String> {
    let workspace = path
        .canonicalize()
        .map_err(|err| format!("Local coding workspace must be an existing directory: {err}"))?;
    if !workspace.is_dir() {
        return Err("Local coding workspace must be an existing directory".to_string());
    }
    Ok(workspace)
}

pub fn is_broad_workspace_root(path: &Path) -> bool {
    let home = std::env::var_os("HOME").map(PathBuf::from);
    taskforceai_core::local_coding::is_broad_workspace_root(path, home.as_deref())
}

pub async fn enable_workspace_tools(
    client: &mut AppServerClient,
    workspace: impl AsRef<Path>,
) -> Result<LocalCodingWorkspace, AppClientError> {
    enable_workspace_tools_with_handle(&client.request_handle(), workspace).await
}

pub async fn enable_workspace_tools_with_handle(
    client: &AppServerRequestHandle,
    workspace: impl AsRef<Path>,
) -> Result<LocalCodingWorkspace, AppClientError> {
    enable_workspace_tools_for_roots_with_handle(client, [workspace.as_ref()]).await
}

pub async fn enable_workspace_tools_for_roots_with_handle(
    client: &AppServerRequestHandle,
    roots: impl IntoIterator<Item = impl AsRef<Path>>,
) -> Result<LocalCodingWorkspace, AppClientError> {
    let mut workspace_roots = Vec::new();
    for root in roots {
        let workspace =
            validate_workspace_path(root.as_ref()).map_err(|message| AppClientError::Rpc {
                code: -32602,
                message,
            })?;
        if !workspace_roots
            .iter()
            .any(|existing| existing == &workspace)
        {
            workspace_roots.push(workspace);
        }
    }
    register_workspace_tools(client, workspace_roots).await
}

pub async fn enable_workspace_tools_for_launch_directory_with_handle(
    client: &AppServerRequestHandle,
    workspace: impl AsRef<Path>,
) -> Result<LocalCodingWorkspace, AppClientError> {
    let workspace =
        resolve_launch_directory(workspace.as_ref()).map_err(|message| AppClientError::Rpc {
            code: -32602,
            message,
        })?;
    register_workspace_tools(client, vec![workspace]).await
}

async fn register_workspace_tools(
    client: &AppServerRequestHandle,
    workspace_roots: Vec<PathBuf>,
) -> Result<LocalCodingWorkspace, AppClientError> {
    let workspace = workspace_roots
        .first()
        .cloned()
        .ok_or_else(|| AppClientError::Rpc {
            code: -32602,
            message: "At least one local coding workspace root is required".to_string(),
        })?;
    let filesystem_tools = filesystem_tool_names();
    let servers = workspace_mcp_servers(&workspace_roots);
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
        workspace_roots,
        server_names: vec![WORKSPACE_MCP_SERVER_NAME.to_string()],
        servers,
    })
}

pub fn workspace_mcp_servers(workspaces: &[PathBuf]) -> Vec<LocalCodingMcpServer> {
    vec![LocalCodingMcpServer {
        name: WORKSPACE_MCP_SERVER_NAME.to_string(),
        endpoint: filesystem_mcp_endpoint_for_roots(workspaces),
        enabled: true,
    }]
}

pub fn prompt_for_workspace(workspace: &Path, request: &str) -> String {
    prompt_for_workspace_roots(&[workspace.to_path_buf()], request)
}

pub fn prompt_for_workspace_roots(workspace_roots: &[PathBuf], request: &str) -> String {
    taskforceai_core::local_coding::prompt_for_workspace_roots(workspace_roots, request)
}

pub fn filesystem_mcp_endpoint(workspace: &Path) -> String {
    filesystem_mcp_endpoint_for_roots(&[workspace.to_path_buf()])
}

pub fn filesystem_mcp_endpoint_for_roots(workspaces: &[PathBuf]) -> String {
    taskforceai_core::local_coding::filesystem_mcp_endpoint_for_roots(workspaces)
}

pub fn quote_command_arg(value: &str) -> String {
    taskforceai_core::local_coding::quote_command_arg(value)
}

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::path::{Path, PathBuf};
    use std::thread;

    use serde_json::{json, Value};
    use taskforceai_app_protocol::JSONRPC_VERSION;

    use super::{
        enable_workspace_tools, enable_workspace_tools_for_launch_directory_with_handle,
        enable_workspace_tools_for_roots_with_handle, enable_workspace_tools_with_handle,
        filesystem_mcp_endpoint, filesystem_mcp_endpoint_for_roots, filesystem_tool_names,
        is_broad_workspace_root, prompt_for_workspace, prompt_for_workspace_roots,
        quote_command_arg, resolve_launch_directory, validate_workspace_path,
        WORKSPACE_MCP_SERVER_NAME,
    };
    use crate::AppServerClient;

    enum RpcReply {
        Result(Value),
        Error(&'static str),
    }

    fn rpc_response(id: Value, reply: RpcReply) -> String {
        match reply {
            RpcReply::Result(result) => json!({
                "jsonrpc": JSONRPC_VERSION,
                "id": id,
                "result": result
            }),
            RpcReply::Error(message) => json!({
                "jsonrpc": JSONRPC_VERSION,
                "id": id,
                "error": {
                    "code": -32000,
                    "message": message
                }
            }),
        }
        .to_string()
    }

    fn start_rpc_sequence_server(
        responses: Vec<(&'static str, RpcReply)>,
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
    fn endpoint_scopes_filesystem_server_to_multiple_workspace_roots() {
        let endpoint = filesystem_mcp_endpoint_for_roots(&[
            PathBuf::from("/tmp/work dir"),
            PathBuf::from("/tmp/shared"),
        ]);

        assert_eq!(
            endpoint,
            "stdio:bunx @modelcontextprotocol/server-filesystem \"/tmp/work dir\" \"/tmp/shared\""
        );
    }

    #[test]
    fn code_prompt_names_the_working_directory_and_preserves_the_request() {
        let prompt = prompt_for_workspace(Path::new("/Users/example"), "List the files");

        assert!(prompt.contains("working-directory roots"));
        assert!(prompt.contains("- `/Users/example`"));
        assert!(prompt.ends_with("User request:\nList the files"));
    }

    #[test]
    fn code_prompt_supports_multiple_roots_and_empty_fallback() {
        let roots = vec![PathBuf::from("/tmp/one"), PathBuf::from("/tmp/two")];
        let prompt = prompt_for_workspace_roots(&roots, "Update both");

        assert!(prompt.contains("- `/tmp/one`\n- `/tmp/two`"));
        assert_eq!(prompt_for_workspace_roots(&[], "Untouched"), "Untouched");
    }

    #[test]
    fn workspace_validation_rejects_broad_roots() {
        let err = validate_workspace_path(Path::new("/")).expect_err("root must be rejected");
        assert!(err.contains("specific project directory"), "{err}");
        assert!(is_broad_workspace_root(Path::new("/private/var")));
        assert!(is_broad_workspace_root(Path::new("/usr/local/bin")));

        let home = std::env::var("HOME").expect("HOME should exist for broad root validation");
        assert!(is_broad_workspace_root(Path::new(&home)));
        assert_eq!(
            resolve_launch_directory(Path::new(&home)).expect("terminal launch may use home"),
            Path::new(&home)
                .canonicalize()
                .expect("home should canonicalize")
        );

        let err = validate_workspace_path(Path::new("/definitely/not/a/taskforceai/workspace"))
            .expect_err("missing workspace should fail");
        assert!(err.contains("existing directory"), "{err}");
    }

    #[test]
    fn workspace_validation_rejects_existing_files() {
        let file_path = Path::new(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml");

        let err = validate_workspace_path(&file_path).expect_err("file should fail");

        assert_eq!(err, "Local coding workspace must be an existing directory");
    }

    #[tokio::test]
    async fn workspace_tool_enablement_requires_at_least_one_root() {
        let client = AppServerClient::connect_http("http://127.0.0.1:9", "session-token")
            .expect("construct client");
        let error = enable_workspace_tools_for_roots_with_handle(
            &client.request_handle(),
            std::iter::empty::<&Path>(),
        )
        .await
        .expect_err("empty roots should fail before network access");
        assert!(matches!(
            error,
            crate::AppClientError::Rpc { code: -32602, .. }
        ));
    }

    #[test]
    fn command_args_escape_quotes_and_backslashes() {
        assert_eq!(
            quote_command_arg(r#"/tmp/a "quoted" dir"#),
            r#""/tmp/a \"quoted\" dir""#
        );
        assert_eq!(quote_command_arg(r#"/tmp/a\b"#), r#""/tmp/a\\b""#);
    }

    #[tokio::test]
    async fn enable_workspace_tools_registers_filesystem_server() {
        let workspace = Path::new(env!("CARGO_MANIFEST_DIR"))
            .canonicalize()
            .expect("canonical workspace");
        let endpoint = filesystem_mcp_endpoint(&workspace);
        let (base_url, server) = start_rpc_sequence_server(vec![
            ("mcp.add", RpcReply::Result(mcp_server_result(&endpoint))),
            ("mcp.tools", RpcReply::Result(mcp_server_result(&endpoint))),
        ]);
        let mut client = AppServerClient::connect_http(base_url, "session-token")
            .expect("test client should connect");

        let enabled = enable_workspace_tools(&mut client, &workspace)
            .await
            .expect("workspace tools should enable");

        assert_eq!(enabled.workspace, workspace);
        assert_eq!(
            enabled.server_names,
            vec![WORKSPACE_MCP_SERVER_NAME.to_string()]
        );
        assert_eq!(enabled.servers[0].endpoint, endpoint);
        server.join().expect("rpc sequence should finish");
    }

    #[tokio::test]
    async fn request_handle_can_register_workspace_tools_without_owning_client_lifecycle() {
        let workspace = Path::new(env!("CARGO_MANIFEST_DIR"))
            .canonicalize()
            .expect("canonical workspace");
        let endpoint = filesystem_mcp_endpoint(&workspace);
        let (base_url, server) = start_rpc_sequence_server(vec![
            ("mcp.add", RpcReply::Result(mcp_server_result(&endpoint))),
            ("mcp.tools", RpcReply::Result(mcp_server_result(&endpoint))),
        ]);
        let client = AppServerClient::connect_http(base_url, "session-token")
            .expect("test client should connect");

        let enabled = enable_workspace_tools_with_handle(&client.request_handle(), &workspace)
            .await
            .expect("workspace tools should enable through request handle");

        assert_eq!(enabled.workspace, workspace);
        server.join().expect("rpc sequence should finish");
    }

    #[tokio::test]
    async fn launch_directory_registration_allows_explicit_home_and_rejects_missing_paths() {
        let home = Path::new(&std::env::var("HOME").expect("HOME should exist"))
            .canonicalize()
            .expect("home should canonicalize");
        let endpoint = filesystem_mcp_endpoint(&home);
        let (base_url, server) = start_rpc_sequence_server(vec![
            ("mcp.add", RpcReply::Result(mcp_server_result(&endpoint))),
            ("mcp.tools", RpcReply::Result(mcp_server_result(&endpoint))),
        ]);
        let client = AppServerClient::connect_http(base_url, "session-token")
            .expect("test client should connect");

        let enabled = enable_workspace_tools_for_launch_directory_with_handle(
            &client.request_handle(),
            &home,
        )
        .await
        .expect("explicit launch directory should enable");

        assert_eq!(enabled.workspace, home);
        assert_eq!(enabled.servers[0].endpoint, endpoint);
        server.join().expect("rpc sequence should finish");

        let client = AppServerClient::connect_http("http://127.0.0.1:9", "session-token")
            .expect("test client should connect");
        let error = enable_workspace_tools_for_launch_directory_with_handle(
            &client.request_handle(),
            Path::new("/definitely/not/a/launch-workspace"),
        )
        .await
        .expect_err("missing launch directory should fail before network access");
        assert!(matches!(
            error,
            crate::AppClientError::Rpc { code: -32602, .. }
        ));
    }

    #[tokio::test]
    async fn enable_workspace_tools_propagates_rpc_failures() {
        let workspace = Path::new(env!("CARGO_MANIFEST_DIR"))
            .canonicalize()
            .expect("canonical workspace");
        let endpoint = filesystem_mcp_endpoint(&workspace);

        let (base_url, server) =
            start_rpc_sequence_server(vec![("mcp.add", RpcReply::Error("add failed"))]);
        let mut client = AppServerClient::connect_http(base_url, "session-token")
            .expect("test client should connect");

        let err = enable_workspace_tools(&mut client, &workspace)
            .await
            .expect_err("mcp.add failure should propagate");

        assert!(err.to_string().contains("add failed"));
        server.join().expect("rpc sequence should finish");

        let (base_url, server) = start_rpc_sequence_server(vec![
            ("mcp.add", RpcReply::Result(mcp_server_result(&endpoint))),
            ("mcp.tools", RpcReply::Error("tools failed")),
        ]);
        let mut client = AppServerClient::connect_http(base_url, "session-token")
            .expect("test client should connect");

        let err = enable_workspace_tools(&mut client, &workspace)
            .await
            .expect_err("mcp.tools failure should propagate");

        assert!(err.to_string().contains("tools failed"));
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

    #[tokio::test]
    async fn enable_workspace_tools_rejects_invalid_pathbuf_before_rpc() {
        let (base_url, server) = start_rpc_sequence_server(Vec::new());
        let mut client = AppServerClient::connect_http(base_url, "session-token")
            .expect("test client should connect");

        let err = enable_workspace_tools(
            &mut client,
            Path::new("/definitely/not/a/pathbuf-workspace").to_path_buf(),
        )
        .await
        .expect_err("missing pathbuf workspace should fail before rpc");

        assert!(err.to_string().contains("existing directory"));
        server.join().expect("empty rpc sequence should finish");
    }

    #[tokio::test]
    async fn enable_workspace_tools_rejects_invalid_pathbuf_reference_before_rpc() {
        let (base_url, server) = start_rpc_sequence_server(Vec::new());
        let mut client = AppServerClient::connect_http(base_url, "session-token")
            .expect("test client should connect");
        let workspace = Path::new("/definitely/not/a/pathbuf-reference-workspace").to_path_buf();

        let err = enable_workspace_tools(&mut client, &workspace)
            .await
            .expect_err("missing pathbuf reference workspace should fail before rpc");

        assert!(err.to_string().contains("existing directory"));
        server.join().expect("empty rpc sequence should finish");
    }

    #[tokio::test]
    async fn request_handle_rejects_invalid_workspace_before_rpc() {
        let (base_url, server) = start_rpc_sequence_server(Vec::new());
        let client = AppServerClient::connect_http(base_url, "session-token")
            .expect("test client should connect");

        let err = enable_workspace_tools_with_handle(
            &client.request_handle(),
            Path::new("/definitely/not/a/handle-workspace"),
        )
        .await
        .expect_err("missing workspace should fail before rpc");

        assert!(err.to_string().contains("existing directory"));
        server.join().expect("empty rpc sequence should finish");
    }
}
