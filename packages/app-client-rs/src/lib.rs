mod binary;
mod client;
mod error;
mod transport;

pub use binary::default_app_server_binary;
pub use client::{AppServerClient, AppServerSpawnOptions};
pub use error::AppClientError;

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::time::Duration;

    use serde_json::json;

    use taskforceai_app_protocol::{AppServerEvent, InitializeResult, JsonRpcResponse};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    use super::client::{
        decode_response, request_timeout_for_method, REQUEST_TIMEOUT, RUN_SUBMIT_TIMEOUT,
    };
    use super::transport::{
        handle_http_event_line, read_http_events, send_event_nonblocking, AppServerTransport,
    };
    use super::{default_app_server_binary, AppClientError, AppServerClient};

    #[test]
    fn response_id_matches_numeric_request_id() {
        let response: JsonRpcResponse = serde_json::from_value(json!({
            "jsonrpc": "2.0",
            "id": 7,
            "result": {"ok": true}
        }))
        .expect("response should decode");

        assert_eq!(response.id, Some(json!(7)));
    }

    #[test]
    fn decode_response_maps_json_rpc_error() {
        let response = JsonRpcResponse {
            jsonrpc: "2.0".to_string(),
            id: Some(json!(1)),
            result: None,
            error: Some(taskforceai_app_protocol::JsonRpcError {
                code: -32601,
                message: "missing method".to_string(),
                data: None,
            }),
        };

        let result = decode_response::<serde_json::Value>(response);

        assert!(matches!(
            result,
            Err(AppClientError::Rpc {
                code: -32601,
                ref message,
            }) if message == "missing method"
        ));
    }

    #[test]
    fn decode_response_accepts_null_result() {
        let response = JsonRpcResponse {
            jsonrpc: "2.0".to_string(),
            id: Some(json!(1)),
            result: Some(serde_json::Value::Null),
            error: None,
        };

        assert_eq!(
            decode_response::<serde_json::Value>(response).expect("null should be a result"),
            serde_json::Value::Null
        );
    }

    #[test]
    fn decode_response_reports_missing_result() {
        let response = JsonRpcResponse {
            jsonrpc: "2.0".to_string(),
            id: Some(json!(1)),
            result: None,
            error: None,
        };

        assert!(matches!(
            decode_response::<serde_json::Value>(response),
            Err(AppClientError::MissingResult)
        ));
    }

    #[test]
    fn decode_response_reports_result_type_mismatch() {
        let response = JsonRpcResponse {
            jsonrpc: "2.0".to_string(),
            id: Some(json!(1)),
            result: Some(json!({"transport": {"kind": 7}})),
            error: None,
        };

        assert!(matches!(
            decode_response::<InitializeResult>(response),
            Err(AppClientError::Decode(_))
        ));
    }

    #[test]
    fn default_app_server_binary_honors_env_override() {
        let previous = std::env::var_os("TASKFORCEAI_APP_SERVER");
        std::env::set_var("TASKFORCEAI_APP_SERVER", "/tmp/taskforceai-app-server");

        assert_eq!(
            default_app_server_binary(),
            PathBuf::from("/tmp/taskforceai-app-server")
        );

        if let Some(previous) = previous {
            std::env::set_var("TASKFORCEAI_APP_SERVER", previous);
        } else {
            std::env::remove_var("TASKFORCEAI_APP_SERVER");
        }
    }

    #[test]
    fn connect_http_rejects_invalid_auth_token() {
        assert!(matches!(
            AppServerClient::connect_http("http://127.0.0.1:1", "bad\nsession"),
            Err(AppClientError::InvalidAuthToken)
        ));
    }

    #[test]
    fn run_submit_uses_extended_timeout() {
        assert_eq!(request_timeout_for_method("initialize"), REQUEST_TIMEOUT);
        assert_eq!(request_timeout_for_method("run.submit"), RUN_SUBMIT_TIMEOUT);
    }

    #[tokio::test]
    async fn event_delivery_does_not_block_when_receiver_is_full() {
        let (tx, mut rx) = tokio::sync::mpsc::channel(1);
        send_event_nonblocking(
            &tx,
            AppServerEvent::RunDeleted {
                run_id: "run-1".to_string(),
            },
        );

        let result = tokio::time::timeout(Duration::from_millis(100), async {
            handle_http_event_line(
                br#"{"jsonrpc":"2.0","method":"event","params":{"type":"run_deleted","run_id":"run-2"}}"#,
                &tx,
            )
            .await;
        })
        .await;

        assert!(result.is_ok(), "full event channel should not block");
        match rx.recv().await.expect("first event should remain queued") {
            AppServerEvent::RunDeleted { run_id } => assert_eq!(run_id, "run-1"),
            _ => panic!("unexpected event"),
        }
    }

    #[tokio::test]
    async fn http_request_maps_json_rpc_error_response() {
        let (base_url, server) = spawn_rpc_error_server().await;
        let mut client =
            AppServerClient::connect_http(format!("{base_url}/"), "session-1").expect("connect");

        let result = client.initialize().await;

        assert!(matches!(
            result,
            Err(AppClientError::Rpc {
                code: -32000,
                ref message,
            }) if message == "server-side boom"
        ));
        server.await.expect("test server should finish");
    }

    #[tokio::test]
    async fn http_event_lines_decode_app_server_events() {
        let (tx, mut rx) = tokio::sync::mpsc::channel(1);
        handle_http_event_line(
            br#"{"jsonrpc":"2.0","method":"event","params":{"type":"run_deleted","run_id":"run-1"}}"#,
            &tx,
        )
        .await;

        let event = tokio::time::timeout(Duration::from_secs(1), rx.recv())
            .await
            .expect("event should decode before timeout")
            .expect("event channel should stay open");
        match event {
            AppServerEvent::RunDeleted { run_id } => assert_eq!(run_id, "run-1"),
            _ => panic!("unexpected event"),
        }
    }

    #[tokio::test]
    async fn http_event_subscription_reuses_configured_auth_headers() {
        let (base_url, server) = spawn_event_server().await;
        let mut client =
            AppServerClient::connect_http(format!("{base_url}/"), "session-1").expect("connect");

        let event = tokio::time::timeout(Duration::from_secs(1), client.next_event())
            .await
            .expect("event should arrive")
            .expect("event stream should stay open");

        match event {
            AppServerEvent::RunDeleted { run_id } => assert_eq!(run_id, "run-1"),
            _ => panic!("unexpected event"),
        }
        server.await.expect("test server should finish");
    }

    #[tokio::test]
    async fn http_event_subscription_does_not_use_rpc_timeout_client() {
        let (base_url, server) = spawn_delayed_event_server().await;
        let mut client =
            AppServerClient::connect_http(format!("{base_url}/"), "session-1").expect("connect");
        if let AppServerTransport::Http { client, .. } = &mut client.transport {
            *client = reqwest::Client::builder()
                .timeout(Duration::from_millis(1))
                .build()
                .expect("short-timeout client should build");
        }

        let event = tokio::time::timeout(Duration::from_secs(1), client.next_event())
            .await
            .expect("event should arrive")
            .expect("event stream should stay open");

        match event {
            AppServerEvent::RunDeleted { run_id } => assert_eq!(run_id, "run-delayed"),
            _ => panic!("unexpected event"),
        }
        server.await.expect("test server should finish");
    }

    #[tokio::test]
    async fn http_event_reader_flushes_final_line_without_newline() {
        let (base_url, server) = spawn_event_server_without_trailing_newline().await;
        let (tx, mut rx) = tokio::sync::mpsc::channel(1);

        read_http_events(
            base_url,
            "session-1".to_string(),
            reqwest::Client::new(),
            tx,
        )
        .await;

        let event = tokio::time::timeout(Duration::from_secs(1), rx.recv())
            .await
            .expect("event should decode before timeout")
            .expect("event channel should stay open");
        match event {
            AppServerEvent::RunDeleted { run_id } => assert_eq!(run_id, "run-final"),
            _ => panic!("unexpected event"),
        }
        server.await.expect("test server should finish");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn dropping_stdio_client_kills_spawned_process() {
        use std::fs;
        use std::os::unix::fs::PermissionsExt;

        let script_path = temp_script_path();
        fs::write(&script_path, "#!/bin/sh\nwhile true; do sleep 1; done\n")
            .expect("write test script");
        let mut permissions = fs::metadata(&script_path)
            .expect("script metadata")
            .permissions();
        permissions.set_mode(0o700);
        fs::set_permissions(&script_path, permissions).expect("mark script executable");

        let mut client = AppServerClient::spawn(&script_path)
            .await
            .expect("client should spawn script");
        let pid = match &mut client.transport {
            AppServerTransport::Stdio { child, .. } => {
                child.id().expect("child should have process id")
            }
            AppServerTransport::Http { .. } => panic!("expected stdio transport"),
        };

        drop(client);

        let exited = tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                if !process_is_running(pid) {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
        })
        .await;

        let _ = fs::remove_file(script_path);
        assert!(
            exited.is_ok(),
            "dropped client should kill app-server child"
        );
    }

    #[cfg(unix)]
    fn temp_script_path() -> PathBuf {
        let unique = format!(
            "taskforceai-app-client-drop-{}-{}.sh",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock should be after epoch")
                .as_nanos()
        );
        std::env::temp_dir().join(unique)
    }

    #[cfg(unix)]
    fn process_is_running(pid: u32) -> bool {
        let Ok(output) = std::process::Command::new("ps")
            .arg("-p")
            .arg(pid.to_string())
            .arg("-o")
            .arg("stat=")
            .output()
        else {
            return false;
        };
        if !output.status.success() {
            return false;
        }
        let state = String::from_utf8_lossy(&output.stdout);
        !state.trim_start().starts_with('Z')
    }

    async fn spawn_rpc_error_server() -> (String, tokio::task::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("test http server should bind");
        let address = listener.local_addr().expect("test server address");
        let server = tokio::spawn(async move {
            let mut saw_events = false;
            let mut saw_rpc = false;
            for _ in 0..1 {
                let (mut stream, _peer) = listener.accept().await.expect("accept request");
                let request = read_http_request(&mut stream).await;
                let normalized_request = request.to_ascii_lowercase();
                if request.starts_with("GET /events ") {
                    assert!(normalized_request.contains("x-taskforce-session: session-1"));
                    saw_events = true;
                    write_http_response(&mut stream, "HTTP/1.1 200 OK", "").await;
                } else if request.starts_with("POST /rpc ") {
                    assert!(normalized_request.contains("x-taskforce-session: session-1"));
                    assert!(normalized_request.contains("authorization: bearer session-1"));
                    saw_rpc = true;
                    write_http_response(
                        &mut stream,
                        "HTTP/1.1 200 OK",
                        r#"{"jsonrpc":"2.0","id":1,"error":{"code":-32000,"message":"server-side boom"}}"#,
                    )
                    .await;
                } else {
                    panic!("unexpected request: {request}");
                }
            }
            assert!(!saw_events, "events request should be lazy");
            assert!(saw_rpc, "rpc request should be sent");
        });
        (format!("http://{address}"), server)
    }

    async fn spawn_event_server() -> (String, tokio::task::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("test http server should bind");
        let address = listener.local_addr().expect("test server address");
        let server = tokio::spawn(async move {
            let (mut stream, _peer) = listener.accept().await.expect("accept request");
            let request = read_http_request(&mut stream).await;
            let normalized_request = request.to_ascii_lowercase();
            assert!(request.starts_with("GET /events "));
            assert!(normalized_request.contains("x-taskforce-session: session-1"));
            assert!(normalized_request.contains("authorization: bearer session-1"));
            write_http_response(
                &mut stream,
                "HTTP/1.1 200 OK",
                "{\"jsonrpc\":\"2.0\",\"method\":\"event\",\"params\":{\"type\":\"run_deleted\",\"run_id\":\"run-1\"}}\n",
            )
            .await;
        });
        (format!("http://{address}"), server)
    }

    async fn spawn_delayed_event_server() -> (String, tokio::task::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("test http server should bind");
        let address = listener.local_addr().expect("test server address");
        let server = tokio::spawn(async move {
            let (mut stream, _peer) = listener.accept().await.expect("accept request");
            let request = read_http_request(&mut stream).await;
            assert!(request.starts_with("GET /events "));
            tokio::time::sleep(Duration::from_millis(50)).await;
            write_http_response(
                &mut stream,
                "HTTP/1.1 200 OK",
                "{\"jsonrpc\":\"2.0\",\"method\":\"event\",\"params\":{\"type\":\"run_deleted\",\"run_id\":\"run-delayed\"}}\n",
            )
            .await;
        });
        (format!("http://{address}"), server)
    }

    async fn spawn_event_server_without_trailing_newline() -> (String, tokio::task::JoinHandle<()>)
    {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("test http server should bind");
        let address = listener.local_addr().expect("test server address");
        let server = tokio::spawn(async move {
            let (mut stream, _peer) = listener.accept().await.expect("accept request");
            let request = read_http_request(&mut stream).await;
            assert!(request.starts_with("GET /events "));
            write_http_response(
                &mut stream,
                "HTTP/1.1 200 OK",
                "{\"jsonrpc\":\"2.0\",\"method\":\"event\",\"params\":{\"type\":\"run_deleted\",\"run_id\":\"run-final\"}}",
            )
            .await;
        });
        (format!("http://{address}"), server)
    }

    async fn read_http_request(stream: &mut tokio::net::TcpStream) -> String {
        let mut buffer = [0_u8; 4096];
        let size = stream.read(&mut buffer).await.expect("read request");
        String::from_utf8_lossy(&buffer[..size]).into_owned()
    }

    async fn write_http_response(stream: &mut tokio::net::TcpStream, status: &str, body: &str) {
        let response = format!(
            "{status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",
            body.len()
        );
        stream
            .write_all(response.as_bytes())
            .await
            .expect("write response");
    }
}
