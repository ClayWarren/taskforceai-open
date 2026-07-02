use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::Path;
use std::thread;

use serde_json::{json, Value};
use taskforceai_app_client::AppServerClient;
use taskforceai_app_protocol::JSONRPC_VERSION;

use super::{
    enable_workspace_tools, filesystem_mcp_endpoint, filesystem_tool_names,
    is_broad_workspace_root, quote_command_arg, validate_workspace_path, WORKSPACE_MCP_SERVER_NAME,
};

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
fn workspace_validation_rejects_broad_roots() {
    let err = validate_workspace_path(Path::new("/")).expect_err("root must be rejected");
    assert!(err.contains("specific project directory"), "{err}");
    assert!(is_broad_workspace_root(Path::new("/private/var")));
    assert!(is_broad_workspace_root(Path::new("/usr/local/bin")));

    let home = std::env::var("HOME").expect("HOME should exist for broad root validation");
    assert!(is_broad_workspace_root(Path::new(&home)));

    let err = validate_workspace_path(Path::new("/definitely/not/a/taskforceai/workspace"))
        .expect_err("missing workspace should fail");
    assert!(err.contains("existing directory"), "{err}");
}

#[test]
fn workspace_validation_rejects_existing_files() {
    let file_path = std::env::temp_dir().join(format!(
        "taskforceai-local-coding-file-{}",
        std::process::id()
    ));
    std::fs::write(&file_path, b"not a directory").expect("fixture file");

    let err = validate_workspace_path(&file_path).expect_err("file should fail");

    assert_eq!(err, "Local coding workspace must be an existing directory");
    let _ = std::fs::remove_file(file_path);
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
