mod binary;
mod client;
mod error;
mod transport;

pub use binary::default_app_server_binary;
pub use client::{AppServerClient, AppServerRequestHandle, AppServerSpawnOptions};
pub use error::AppClientError;

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::sync::Once;
    use std::time::{Duration, Instant};

    use serde_json::json;

    use taskforceai_app_protocol::{AppServerEvent, InitializeResult, JsonRpcResponse};
    use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    use super::client::{
        decode_response, encode_stdio_request, receive_stdio_response, request_timeout_error,
        request_timeout_for_method, REQUEST_TIMEOUT, RUN_SUBMIT_TIMEOUT,
    };
    use super::transport::{
        handle_http_event_line, read_http_events, read_stdio_lines, send_event_nonblocking,
        AppServerTransport,
    };
    use super::{default_app_server_binary, AppClientError, AppServerClient};

    static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    static LOGGER: TestLogger = TestLogger;
    static LOG_INIT: Once = Once::new();

    struct TestLogger;

    impl log::Log for TestLogger {
        fn enabled(&self, metadata: &log::Metadata<'_>) -> bool {
            metadata.level() <= log::Level::Warn
        }

        fn log(&self, _record: &log::Record<'_>) {}

        fn flush(&self) {}
    }

    fn init_test_logger() {
        LOG_INIT.call_once(|| {
            let _ = log::set_logger(&LOGGER);
            log::set_max_level(log::LevelFilter::Warn);
        });
    }

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
        let _guard = ENV_LOCK.lock().expect("env lock should not be poisoned");
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
    fn default_app_server_binary_prefers_sibling_then_manifest_fallback() {
        let _guard = ENV_LOCK.lock().expect("env lock should not be poisoned");
        let previous = std::env::var_os("TASKFORCEAI_APP_SERVER");
        std::env::remove_var("TASKFORCEAI_APP_SERVER");

        let exe = std::env::current_exe().expect("test binary path should resolve");
        let sibling = exe
            .parent()
            .expect("test binary should have a parent")
            .join(if cfg!(windows) {
                "taskforceai-app-server.exe"
            } else {
                "taskforceai-app-server"
            });
        let created_sibling = !sibling.exists();
        if created_sibling {
            std::fs::write(&sibling, b"").expect("write sibling app-server marker");
        }

        assert_eq!(default_app_server_binary(), sibling);

        if created_sibling {
            std::fs::remove_file(&sibling).expect("remove sibling app-server marker");
            assert!(default_app_server_binary()
                .ends_with("apps/app-server/target/debug/taskforceai-app-server"));
        }

        if let Some(previous) = previous {
            std::env::set_var("TASKFORCEAI_APP_SERVER", previous);
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
        assert!(matches!(
            request_timeout_error("slow.method", Duration::from_millis(123)),
            AppClientError::RequestTimeout {
                ref method,
                timeout_ms: 123
            } if method == "slow.method"
        ));
    }

    #[tokio::test]
    async fn receive_stdio_response_skips_unrelated_ids_and_reports_closed_channel() {
        let (tx, mut rx) = tokio::sync::mpsc::channel(2);
        tx.send(JsonRpcResponse {
            jsonrpc: "2.0".to_string(),
            id: Some(json!(99)),
            result: Some(json!("wrong")),
            error: None,
        })
        .await
        .expect("send unrelated response");
        tx.send(JsonRpcResponse {
            jsonrpc: "2.0".to_string(),
            id: Some(json!(7)),
            result: Some(json!("right")),
            error: None,
        })
        .await
        .expect("send matching response");

        let value: serde_json::Value = receive_stdio_response(&mut rx, 7)
            .await
            .expect("matching response should decode");
        assert_eq!(value, json!("right"));

        let (tx, mut rx) = tokio::sync::mpsc::channel(1);
        drop(tx);
        assert!(matches!(
            receive_stdio_response::<serde_json::Value>(&mut rx, 1).await,
            Err(AppClientError::Closed)
        ));
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
            );
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
    async fn http_request_maps_transport_status_and_decode_errors() {
        let mut refused =
            AppServerClient::connect_http("http://127.0.0.1:9", "session-1").expect("connect");
        assert!(matches!(
            refused.initialize().await,
            Err(AppClientError::Http(_))
        ));

        let (status_url, status_server) = spawn_raw_http_server(
            "HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\n\r\n",
        )
        .await;
        let mut status = AppServerClient::connect_http(status_url, "session-1").expect("connect");
        assert!(matches!(
            status.initialize().await,
            Err(AppClientError::Http(_))
        ));
        status_server.await.expect("status server should finish");

        let (decode_url, decode_server) =
            spawn_raw_http_server("HTTP/1.1 200 OK\r\nContent-Length: 8\r\n\r\nnot-json").await;
        let mut decode = AppServerClient::connect_http(decode_url, "session-1").expect("connect");
        assert!(matches!(
            decode.initialize().await,
            Err(AppClientError::Http(_))
        ));
        decode_server.await.expect("decode server should finish");
    }

    #[tokio::test]
    async fn http_event_lines_decode_app_server_events() {
        let (tx, mut rx) = tokio::sync::mpsc::channel(1);
        handle_http_event_line(
            br#"{"jsonrpc":"2.0","method":"event","params":{"type":"run_deleted","run_id":"run-1"}}"#,
            &tx,
        );

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
    async fn http_event_lines_ignore_empty_invalid_and_non_event_payloads() {
        init_test_logger();
        let (tx, mut rx) = tokio::sync::mpsc::channel(1);

        handle_http_event_line(b" \r\n\t", &tx);
        handle_http_event_line(b"{", &tx);
        handle_http_event_line(b"[]", &tx);
        handle_http_event_line(br#"{"jsonrpc":"2.0","method":"log","params":{}}"#, &tx);
        handle_http_event_line(
            br#"{"jsonrpc":"2.0","method":"event","params":{"type":"unknown"}}"#,
            &tx,
        );
        handle_http_event_line(
            b" \t{\"jsonrpc\":\"2.0\",\"method\":\"event\",\"params\":{\"type\":\"run_deleted\",\"run_id\":\"run-trimmed\"}}\r\n",
            &tx,
        );

        let event = rx.recv().await.expect("trimmed event should decode");
        match event {
            AppServerEvent::RunDeleted { run_id } => assert_eq!(run_id, "run-trimmed"),
            _ => panic!("unexpected event"),
        }
        assert!(rx.try_recv().is_err());
    }

    #[tokio::test]
    async fn stdio_reader_handles_invalid_lines_and_closed_response_receiver() {
        init_test_logger();
        let input = concat!(
            "not-json\n",
            "{\"jsonrpc\":\"2.0\",\"method\":\"log\",\"params\":{}}\n",
            "{\"method\":\"event\",\"params\":{}}\n",
            "{\"jsonrpc\":\"2.0\",\"method\":\"event\",\"params\":{\"type\":\"unknown\"}}\n",
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{}}\n"
        );
        let (response_tx, response_rx) = tokio::sync::mpsc::channel(1);
        let (event_tx, mut event_rx) = tokio::sync::mpsc::channel(1);
        drop(response_rx);

        read_stdio_lines(
            tokio::io::BufReader::new(input.as_bytes()).lines(),
            response_tx,
            event_tx,
        )
        .await;

        assert!(event_rx.try_recv().is_err());
    }

    #[tokio::test]
    async fn stdio_reader_ignores_unrecognized_response_payloads() {
        let (response_tx, mut response_rx) = tokio::sync::mpsc::channel(1);
        let (event_tx, _event_rx) = tokio::sync::mpsc::channel(1);

        read_stdio_lines(
            tokio::io::BufReader::new(br#"[]"#.as_slice()).lines(),
            response_tx,
            event_tx,
        )
        .await;

        assert!(response_rx.try_recv().is_err());
    }

    #[tokio::test]
    async fn stdio_reader_stops_on_read_error() {
        init_test_logger();
        use std::io;
        use std::pin::Pin;
        use std::task::{Context, Poll};
        use tokio::io::{AsyncBufRead, AsyncRead, ReadBuf};

        struct FailingReader;

        impl AsyncRead for FailingReader {
            fn poll_read(
                self: Pin<&mut Self>,
                _cx: &mut Context<'_>,
                _buf: &mut ReadBuf<'_>,
            ) -> Poll<io::Result<()>> {
                Poll::Ready(Err(io::Error::other("boom")))
            }
        }

        impl AsyncBufRead for FailingReader {
            fn poll_fill_buf(
                self: Pin<&mut Self>,
                _cx: &mut Context<'_>,
            ) -> Poll<io::Result<&[u8]>> {
                Poll::Ready(Err(io::Error::other("boom")))
            }

            fn consume(self: Pin<&mut Self>, _amount: usize) {}
        }

        let (response_tx, mut response_rx) = tokio::sync::mpsc::channel(1);
        let (event_tx, mut event_rx) = tokio::sync::mpsc::channel(1);

        read_stdio_lines(FailingReader.lines(), response_tx, event_tx).await;

        assert!(response_rx.try_recv().is_err());
        assert!(event_rx.try_recv().is_err());
    }

    #[tokio::test(flavor = "current_thread")]
    #[ignore = "performance baseline for HTTP event line parsing"]
    async fn perf_http_event_line_parser_run_deleted() {
        const EVENTS: usize = 20_000;
        const SAMPLES: usize = 5;
        let line =
            br#"{"jsonrpc":"2.0","method":"event","params":{"type":"run_deleted","run_id":"run-12345"}}"#;
        let mut durations = Vec::with_capacity(SAMPLES);

        for _ in 0..SAMPLES {
            let (tx, mut rx) = tokio::sync::mpsc::channel(EVENTS);
            let started = Instant::now();
            for _ in 0..EVENTS {
                handle_http_event_line(line, &tx);
            }
            let elapsed = started.elapsed();
            drop(tx);

            let mut received = 0;
            while rx.try_recv().is_ok() {
                received += 1;
            }
            assert_eq!(received, EVENTS);
            durations.push(elapsed);
        }

        durations.sort_unstable();
        let best = durations[0];
        let median = durations[SAMPLES / 2];
        println!(
            "perf_http_event_line_parser_run_deleted best={}ns/event median={}ns/event best_total={best:?} median_total={median:?}",
            best.as_nanos() / EVENTS as u128,
            median.as_nanos() / EVENTS as u128,
        );
    }

    #[test]
    #[ignore = "performance baseline for stdio request encoding"]
    fn perf_stdio_request_encoding_conversation_upsert() {
        const REQUESTS: usize = 20_000;
        const SAMPLES: usize = 5;
        let params = json!({
            "conversation_id": "conv-perf",
            "title": "Performance conversation",
            "created_at": 1_783_000_000_000_i64,
            "updated_at": 1_783_000_001_000_i64,
            "last_message_preview": "A representative request payload for stdio RPC encoding",
            "archived": false
        });
        let mut durations = Vec::with_capacity(SAMPLES);
        let mut encoded_bytes = 0;

        for _ in 0..SAMPLES {
            let started = Instant::now();
            for id in 0..REQUESTS {
                let line = encode_stdio_request(id as u64, "conversation.upsert", &params)
                    .expect("request should encode");
                encoded_bytes += line.len();
            }
            durations.push(started.elapsed());
        }

        assert!(encoded_bytes > 0);
        durations.sort_unstable();
        let best = durations[0];
        let median = durations[SAMPLES / 2];
        println!(
            "perf_stdio_request_encoding_conversation_upsert best={}ns/request median={}ns/request best_total={best:?} median_total={median:?}",
            best.as_nanos() / REQUESTS as u128,
            median.as_nanos() / REQUESTS as u128,
        );
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
        assert!(
            tokio::time::timeout(Duration::from_secs(1), client.next_event())
                .await
                .expect("event stream should close")
                .is_none()
        );
        server.await.expect("test server should finish");
    }

    #[tokio::test]
    async fn http_event_subscription_resets_after_empty_stream() {
        let (base_url, server) = spawn_empty_event_server().await;
        let mut client =
            AppServerClient::connect_http(format!("{base_url}/"), "session-1").expect("connect");

        assert!(
            tokio::time::timeout(Duration::from_secs(1), client.next_event())
                .await
                .expect("stream should close")
                .is_none()
        );
        if let AppServerTransport::Http {
            events, event_task, ..
        } = &client.transport
        {
            assert!(events.is_none());
            assert!(event_task.is_none());
        }
        server.await.expect("test server should finish");
    }

    #[tokio::test]
    async fn http_shutdown_sends_rpc_and_kill_is_noop() {
        let (base_url, server) = spawn_rpc_success_server().await;
        let mut client =
            AppServerClient::connect_http(format!("{base_url}/"), "session-1").expect("connect");

        client.kill().await;
        client
            .shutdown()
            .await
            .expect("http shutdown should decode");
        server.await.expect("test server should finish");
    }

    #[tokio::test]
    async fn http_event_reader_handles_connect_status_chunk_and_partial_line_edges() {
        init_test_logger();
        let (tx, mut rx) = tokio::sync::mpsc::channel(2);
        let client = reqwest::Client::builder()
            .timeout(Duration::from_millis(100))
            .build()
            .expect("client should build");
        read_http_events(
            "http://127.0.0.1:9".to_string(),
            "session-1".to_string(),
            client,
            tx.clone(),
        )
        .await;

        let (status_url, status_server) = spawn_raw_http_server(
            "HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\n\r\n",
        )
        .await;
        read_http_events(
            status_url,
            "session-1".to_string(),
            reqwest::Client::new(),
            tx.clone(),
        )
        .await;
        status_server.await.expect("status server should finish");

        let (chunk_url, chunk_server) =
            spawn_raw_http_server("HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\npartial").await;
        read_http_events(
            chunk_url,
            "session-1".to_string(),
            reqwest::Client::new(),
            tx.clone(),
        )
        .await;
        chunk_server.await.expect("chunk server should finish");

        let body = concat!(
            "{\"jsonrpc\":\"2.0\",\"method\":\"event\",\"params\":{\"type\":\"run_deleted\",\"run_id\":\"run-drain-1\"}}\n",
            "{\"jsonrpc\":\"2.0\",\"method\":\"event\",\"params\":{\"type\":\"run_deleted\",\"run_id\":\"run-drain-2\"}}"
        );
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",
            body.len()
        );
        let (drain_url, drain_server) = spawn_raw_http_server(&response).await;
        read_http_events(
            drain_url,
            "session-1".to_string(),
            reqwest::Client::new(),
            tx,
        )
        .await;
        drain_server.await.expect("drain server should finish");

        let first = rx.recv().await.expect("first event should decode");
        let second = rx.recv().await.expect("second event should decode");
        assert!(matches!(
            first,
            AppServerEvent::RunDeleted { ref run_id } if run_id == "run-drain-1"
        ));
        assert!(matches!(
            second,
            AppServerEvent::RunDeleted { ref run_id } if run_id == "run-drain-2"
        ));
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
    #[tokio::test]
    async fn spawn_with_options_can_inherit_stderr_and_kill_child() {
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

        let mut client = AppServerClient::spawn_with_options(
            &script_path,
            super::client::AppServerSpawnOptions {
                inherit_stderr: true,
                ..Default::default()
            },
        )
        .await
        .expect("client should spawn script");
        client.kill().await;

        let _ = fs::remove_file(script_path);
    }

    #[tokio::test]
    async fn spawn_reports_missing_binary_errors() {
        assert!(matches!(
            AppServerClient::spawn("/tmp/taskforceai-missing-app-server-binary").await,
            Err(AppClientError::Spawn(_))
        ));
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

    async fn spawn_empty_event_server() -> (String, tokio::task::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("test http server should bind");
        let address = listener.local_addr().expect("test server address");
        let server = tokio::spawn(async move {
            let (mut stream, _peer) = listener.accept().await.expect("accept request");
            let request = read_http_request(&mut stream).await;
            assert!(request.starts_with("GET /events "));
            write_http_response(&mut stream, "HTTP/1.1 200 OK", "").await;
        });
        (format!("http://{address}"), server)
    }

    async fn spawn_rpc_success_server() -> (String, tokio::task::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("test http server should bind");
        let address = listener.local_addr().expect("test server address");
        let server = tokio::spawn(async move {
            let (mut stream, _peer) = listener.accept().await.expect("accept request");
            let request = read_http_request(&mut stream).await;
            assert!(request.starts_with("POST /rpc "));
            assert!(request.contains("\"method\":\"shutdown\""));
            write_http_response(
                &mut stream,
                "HTTP/1.1 200 OK",
                r#"{"jsonrpc":"2.0","id":1,"result":{}}"#,
            )
            .await;
        });
        (format!("http://{address}"), server)
    }

    async fn spawn_raw_http_server(response: &str) -> (String, tokio::task::JoinHandle<()>) {
        let response = response.to_string();
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("test http server should bind");
        let address = listener.local_addr().expect("test server address");
        let server = tokio::spawn(async move {
            let (mut stream, _peer) = listener.accept().await.expect("accept request");
            let _request = read_http_request(&mut stream).await;
            stream
                .write_all(response.as_bytes())
                .await
                .expect("write raw response");
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
