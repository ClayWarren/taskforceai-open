use std::{
    hint::black_box,
    time::{Duration, Instant},
};

use super::*;

async fn test_state(pairing_code: &str, session_token: &str) -> Arc<HttpServerState> {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());
    let server_info = runtime.config.server_info.clone();
    let (runtime_event_tx, runtime_event_rx) = mpsc::channel(128);
    runtime.set_event_sender(runtime_event_tx);
    let (runtime_commands, runtime_command_rx) = mpsc::channel(512);
    let (runtime_outputs, runtime_output_rx) = mpsc::unbounded_channel();
    let (interaction_output_tx, mut interaction_output_rx) = mpsc::channel(32);
    let interaction_broker = InteractionBroker::new(interaction_output_tx);
    runtime.set_interaction_broker(interaction_broker.clone());
    let (events, _) = broadcast::channel(128);
    let state = Arc::new(HttpServerState {
        runtime_commands,
        interaction_broker,
        server_info,
        pairing_code: Mutex::new(Some(pairing_code.to_string())),
        session_token: session_token.to_string(),
        mobile_session_tokens: Mutex::new(Vec::new()),
        mobile_push_tokens: Mutex::new(BTreeMap::new()),
        events,
        event_backlog: Mutex::new(VecDeque::with_capacity(EVENT_BACKLOG_CAPACITY)),
        stats: HttpTransportStats::default(),
        shutdown: Notify::new(),
    });
    tokio::spawn(http_runtime_loop(
        runtime,
        runtime_command_rx,
        runtime_event_rx,
        runtime_outputs.clone(),
        Arc::clone(&state),
    ));
    tokio::spawn(http_runtime_output_loop(
        Arc::clone(&state),
        runtime_output_rx,
    ));
    let interaction_outputs = runtime_outputs.clone();
    tokio::spawn(async move {
        while let Some(message) = interaction_output_rx.recv().await {
            if interaction_outputs.send(vec![message]).is_err() {
                break;
            }
        }
    });
    for raw in [
        r#"{"jsonrpc":"2.0","id":0,"method":"initialize","params":{}}"#,
        r#"{"jsonrpc":"2.0","method":"initialized","params":{}}"#,
    ] {
        let request = serde_json::from_str(raw).expect("test handshake should parse");
        let (response, _) = handle_rpc_request(request, Arc::clone(&state)).await;
        if raw.contains("\"id\":0") {
            assert!(response.is_some_and(|response| response.error.is_none()));
        }
    }
    state
}

fn notification(index: usize) -> OutgoingMessage {
    OutgoingMessage::Notification(crate::protocol::JsonRpcNotification {
        jsonrpc: JSONRPC_VERSION.to_string(),
        method: "event".to_string(),
        params: json!({ "index": index }),
    })
}

#[tokio::test]
async fn remote_interaction_responses_require_a_pending_request_id() {
    let state = test_state("pair-code", "session-token").await;
    let response = remote_interaction_response(
        &json!({"id": 9, "params": {"result": {"decision": "accept"}}}),
        &state,
    )
    .await;
    assert_eq!(response["error"]["code"], -32602);

    let response = remote_interaction_response(
        &json!({"id": 10, "params": {"requestId": 999, "result": {"decision": "accept"}}}),
        &state,
    )
    .await;
    assert_eq!(response["error"]["code"], -32004);
}

async fn read_request_from_parts(parts: Vec<Vec<u8>>) -> Result<HttpRequest, Vec<u8>> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("request parser listener should bind");
    let address = listener
        .local_addr()
        .expect("request parser address should be readable");
    let client = tokio::spawn(async move {
        let mut stream = TcpStream::connect(address)
            .await
            .expect("request parser client should connect");
        for part in parts {
            if stream.write_all(&part).await.is_err() {
                break;
            }
        }
    });
    let (mut stream, _) = listener
        .accept()
        .await
        .expect("request parser server should accept");
    let result = read_request(&mut stream).await;
    client.await.expect("request parser client should finish");
    result
}

fn reserve_loopback_port() -> u16 {
    let listener = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .expect("temporary port reservation should bind");
    listener
        .local_addr()
        .expect("temporary port should have address")
        .port()
}

async fn raw_http_request(port: u16, request: impl AsRef<[u8]>) -> std::io::Result<String> {
    let mut stream = TcpStream::connect((Ipv4Addr::LOCALHOST, port)).await?;
    stream.write_all(request.as_ref()).await?;
    stream.shutdown().await?;
    let mut output = Vec::new();
    stream.read_to_end(&mut output).await?;
    Ok(String::from_utf8(output).expect("HTTP response should be utf8"))
}

async fn wait_for_http_server(port: u16) {
    let request = b"GET /health HTTP/1.1\r\nHost: localhost\r\n\r\n";
    let deadline = Instant::now() + Duration::from_secs(2);
    while Instant::now() < deadline {
        match raw_http_request(port, request).await {
            Ok(response) if response.starts_with("HTTP/1.1 200 OK") => return,
            Ok(_) | Err(_) => tokio::time::sleep(Duration::from_millis(20)).await,
        }
    }
    panic!("HTTP server did not become ready on port {port}");
}

fn response_body(response: &str) -> &str {
    response
        .split_once("\r\n\r\n")
        .map(|(_, body)| body)
        .expect("HTTP response should include header separator")
}

#[test]
#[ignore = "prints focused HTTP header boundary performance timing"]
fn bench_http_header_end_scan() {
    let mut request = Vec::with_capacity(8 * 1024 + 128);
    request.extend_from_slice(b"POST /rpc HTTP/1.1\r\nHost: localhost\r\n");
    request.extend(std::iter::repeat_n(b'x', 8 * 1024));
    request.extend_from_slice(b"\r\n\r\n{}");
    const ITERATIONS: u32 = 200_000;

    let elapsed = time_iterations(ITERATIONS, || {
        black_box(find_header_end(black_box(&request)));
    });

    let ns_per_scan = elapsed.as_nanos() as f64 / f64::from(ITERATIONS);
    println!(
        "bench_http_header_end_scan: {ITERATIONS} scans in {:?} ({ns_per_scan:.2} ns/scan)",
        elapsed
    );
}

fn time_iterations(iterations: u32, mut run: impl FnMut()) -> Duration {
    let start = Instant::now();
    for _ in 0..iterations {
        run();
    }
    start.elapsed()
}

#[tokio::test]
async fn read_request_parses_split_bodies_and_reports_boundary_errors() {
    let request = read_request_from_parts(vec![
        b"POST /rpc HTTP/1.1\r\nHost: localhost\r\nContent-Length: 11\r\nX-Test: yes\r\n\r\nhello"
            .to_vec(),
        b" world".to_vec(),
    ])
    .await
    .expect("split request should parse");
    assert_eq!(request.method, "POST");
    assert_eq!(request.path, "/rpc");
    assert_eq!(
        request.headers.get("x-test").map(String::as_str),
        Some("yes")
    );
    assert_eq!(request.body, b"hello world");

    let empty = read_request_from_parts(Vec::new())
        .await
        .expect_err("empty connection should fail");
    assert!(String::from_utf8(empty)
        .expect("empty error should be utf8")
        .starts_with("HTTP/1.1 400 Bad Request"));

    let invalid_header = read_request_from_parts(vec![b"GET /\xFF HTTP/1.1\r\n\r\n".to_vec()])
        .await
        .expect_err("invalid utf8 header should fail");
    assert!(String::from_utf8(invalid_header)
        .expect("invalid header response should be utf8")
        .starts_with("HTTP/1.1 400 Bad Request"));

    let too_large_header = read_request_from_parts(vec![vec![b'x'; MAX_REQUEST_BYTES + 1]])
        .await
        .expect_err("oversized header should fail");
    assert!(String::from_utf8(too_large_header)
        .expect("oversized header response should be utf8")
        .starts_with("HTTP/1.1 413 Payload Too Large"));

    let too_large_body = read_request_from_parts(vec![format!(
        "POST /rpc HTTP/1.1\r\nContent-Length: {}\r\n\r\n",
        MAX_REQUEST_BYTES + 1
    )
    .into_bytes()])
    .await
    .expect_err("oversized content length should fail");
    assert!(String::from_utf8(too_large_body)
        .expect("oversized body response should be utf8")
        .starts_with("HTTP/1.1 413 Payload Too Large"));

    let truncated_body = read_request_from_parts(vec![
        b"POST /rpc HTTP/1.1\r\nContent-Length: 5\r\n\r\nhi".to_vec(),
    ])
    .await
    .expect_err("truncated body should fail");
    assert!(String::from_utf8(truncated_body)
        .expect("truncated body response should be utf8")
        .starts_with("HTTP/1.1 400 Bad Request"));
}

#[tokio::test]
async fn pairing_exchanges_code_for_session_token() {
    let state = test_state("pair-me", "session-token").await;
    let response = route_request(
        HttpRequest {
            method: "GET".to_string(),
            path: "/pairing".to_string(),
            headers: BTreeMap::from([(
                "x-taskforce-pairing-code".to_string(),
                "pair-me".to_string(),
            )]),
            body: Vec::new(),
        },
        Arc::clone(&state),
    )
    .await;
    let text = String::from_utf8(response).expect("response should be utf8");
    assert!(text.contains("\"sessionToken\":\"session-token\""));
}

#[tokio::test]
async fn mobile_pairing_uses_a_scoped_session_token() {
    let state = test_state("pair-mobile", "desktop-token").await;
    let paired = route_request(
        HttpRequest {
            method: "GET".to_string(),
            path: "/pairing".to_string(),
            headers: BTreeMap::from([
                (
                    "x-taskforce-pairing-code".to_string(),
                    "pair-mobile".to_string(),
                ),
                ("x-taskforce-client".to_string(), "mobile".to_string()),
            ]),
            body: Vec::new(),
        },
        Arc::clone(&state),
    )
    .await;
    let paired = String::from_utf8(paired).expect("pairing response should be utf8");
    assert!(paired.contains("\"sessionScope\":\"mobile-control\""));
    assert!(!paired.contains("desktop-token"));

    let mobile_token = state
        .mobile_session_tokens
        .lock()
        .await
        .first()
        .expect("mobile session should be registered")
        .clone();
    let allowed = route_request(
        HttpRequest {
            method: "POST".to_string(),
            path: "/rpc".to_string(),
            headers: BTreeMap::from([(
                "authorization".to_string(),
                format!("Bearer {mobile_token}"),
            )]),
            body: br#"{"jsonrpc":"2.0","id":1,"method":"server.ping","params":{}}"#.to_vec(),
        },
        Arc::clone(&state),
    )
    .await;
    assert!(String::from_utf8(allowed)
        .expect("allowed response should be utf8")
        .contains("\"result\":{\"ok\":true}"));

    publish_http_event(&state, notification(9)).await;
    let snapshot = route_request(
        HttpRequest {
            method: "GET".to_string(),
            path: "/events/snapshot".to_string(),
            headers: BTreeMap::from([(
                "authorization".to_string(),
                format!("Bearer {mobile_token}"),
            )]),
            body: Vec::new(),
        },
        Arc::clone(&state),
    )
    .await;
    let snapshot = String::from_utf8(snapshot).expect("snapshot response should be utf8");
    assert!(snapshot.contains("\"events\""));
    assert!(snapshot.contains("\"index\":9"));

    let denied = route_request(
        HttpRequest {
            method: "POST".to_string(),
            path: "/rpc".to_string(),
            headers: BTreeMap::from([(
                "authorization".to_string(),
                format!("Bearer {mobile_token}"),
            )]),
            body: br#"{"jsonrpc":"2.0","id":2,"method":"settings.get","params":{}}"#.to_vec(),
        },
        Arc::clone(&state),
    )
    .await;
    let denied = String::from_utf8(denied).expect("denied response should be utf8");
    assert!(denied.contains("\"code\":-32601"));
    assert!(denied.contains("not available to mobile control sessions"));

    for method in ["workspace.file.list", "workspace.file.read"] {
        let response = route_request(
            HttpRequest {
                method: "POST".to_string(),
                path: "/rpc".to_string(),
                headers: BTreeMap::from([(
                    "authorization".to_string(),
                    format!("Bearer {mobile_token}"),
                )]),
                body: format!(
                    r#"{{"jsonrpc":"2.0","id":4,"method":"{method}","params":{{"workspace":"/","path":"etc/passwd"}}}}"#
                )
                .into_bytes(),
            },
            Arc::clone(&state),
        )
        .await;
        let response = String::from_utf8(response).expect("file response should be utf8");
        assert!(
            !response.contains("not available to mobile control sessions"),
            "{method}: {response}"
        );
    }

    let mint_denied = route_request(
        HttpRequest {
            method: "POST".to_string(),
            path: "/pairing-code".to_string(),
            headers: BTreeMap::from([(
                "authorization".to_string(),
                format!("Bearer {mobile_token}"),
            )]),
            body: Vec::new(),
        },
        Arc::clone(&state),
    )
    .await;
    assert!(String::from_utf8(mint_denied)
        .expect("mint response should be utf8")
        .starts_with("HTTP/1.1 401 Unauthorized"));

    let revoked = route_request(
        HttpRequest {
            method: "DELETE".to_string(),
            path: "/session".to_string(),
            headers: BTreeMap::from([(
                "authorization".to_string(),
                format!("Bearer {mobile_token}"),
            )]),
            body: Vec::new(),
        },
        Arc::clone(&state),
    )
    .await;
    assert!(String::from_utf8(revoked)
        .expect("revoke response should be utf8")
        .starts_with("HTTP/1.1 204 No Content"));

    let after_revoke = route_request(
        HttpRequest {
            method: "POST".to_string(),
            path: "/rpc".to_string(),
            headers: BTreeMap::from([(
                "authorization".to_string(),
                format!("Bearer {mobile_token}"),
            )]),
            body: br#"{"jsonrpc":"2.0","id":3,"method":"server.ping","params":{}}"#.to_vec(),
        },
        state,
    )
    .await;
    assert!(String::from_utf8(after_revoke)
        .expect("post-revoke response should be utf8")
        .starts_with("HTTP/1.1 401 Unauthorized"));
}

#[tokio::test]
async fn mobile_session_registers_its_remote_push_token() {
    let state = test_state("pair-mobile-push", "desktop-token").await;
    state
        .mobile_session_tokens
        .lock()
        .await
        .push("mobile-token".to_string());
    let response = route_request(
        HttpRequest {
            method: "POST".to_string(),
            path: "/mobile-notifications".to_string(),
            headers: BTreeMap::from([(
                "authorization".to_string(),
                "Bearer mobile-token".to_string(),
            )]),
            body: br#"{"expoPushToken":"ExponentPushToken[remote-device]"}"#.to_vec(),
        },
        Arc::clone(&state),
    )
    .await;
    assert!(String::from_utf8(response)
        .expect("push registration response should be utf8")
        .contains("\"ok\":true"));
    assert_eq!(
        state
            .mobile_push_tokens
            .lock()
            .await
            .get("mobile-token")
            .map(String::as_str),
        Some("ExponentPushToken[remote-device]")
    );
}

#[tokio::test]
async fn mobile_routes_reject_wrong_sessions_and_invalid_payloads() {
    let state = test_state("pair-mobile-edges", "desktop-token").await;
    state
        .mobile_session_tokens
        .lock()
        .await
        .push("mobile-token".to_string());

    for (method, path) in [
        ("DELETE", "/session"),
        ("POST", "/mobile-notifications"),
        ("DELETE", "/mobile-notifications"),
        ("GET", "/events/snapshot"),
    ] {
        let response = route_request(
            HttpRequest {
                method: method.to_string(),
                path: path.to_string(),
                headers: BTreeMap::new(),
                body: Vec::new(),
            },
            Arc::clone(&state),
        )
        .await;
        assert!(
            String::from_utf8(response)
                .expect("unauthorized response")
                .starts_with("HTTP/1.1 401 Unauthorized"),
            "{method} {path}"
        );
    }

    for (method, path) in [
        ("DELETE", "/session"),
        ("POST", "/mobile-notifications"),
        ("DELETE", "/mobile-notifications"),
    ] {
        let response = route_request(
            HttpRequest {
                method: method.to_string(),
                path: path.to_string(),
                headers: BTreeMap::from([(
                    "authorization".to_string(),
                    "Bearer desktop-token".to_string(),
                )]),
                body: Vec::new(),
            },
            Arc::clone(&state),
        )
        .await;
        assert!(
            String::from_utf8(response)
                .expect("desktop response")
                .starts_with("HTTP/1.1 403 Forbidden"),
            "{method} {path}"
        );
    }

    for body in [Vec::new(), br#"{"expoPushToken":"bad-token"}"#.to_vec()] {
        let response = route_request(
            HttpRequest {
                method: "POST".to_string(),
                path: "/mobile-notifications".to_string(),
                headers: BTreeMap::from([(
                    "authorization".to_string(),
                    "Bearer mobile-token".to_string(),
                )]),
                body,
            },
            Arc::clone(&state),
        )
        .await;
        assert!(String::from_utf8(response)
            .expect("invalid push response")
            .starts_with("HTTP/1.1 400 Bad Request"));
    }

    state.mobile_push_tokens.lock().await.insert(
        "mobile-token".to_string(),
        "ExponentPushToken[device]".to_string(),
    );
    let response = route_request(
        HttpRequest {
            method: "DELETE".to_string(),
            path: "/mobile-notifications".to_string(),
            headers: BTreeMap::from([(
                "authorization".to_string(),
                "Bearer mobile-token".to_string(),
            )]),
            body: Vec::new(),
        },
        Arc::clone(&state),
    )
    .await;
    assert!(String::from_utf8(response)
        .expect("delete push response")
        .starts_with("HTTP/1.1 204 No Content"));
    assert!(state.mobile_push_tokens.lock().await.is_empty());
}

#[tokio::test]
async fn rpc_response_messages_cover_invalid_and_unmatched_interactions() {
    let state = test_state("pair-rpc-response", "session-token").await;
    for (body, expected_status) in [
        (br#"{"id":1}"#.as_slice(), "HTTP/1.1 200 OK"),
        (
            br#"{"jsonrpc":"2.0","id":999,"result":{"ok":true}}"#.as_slice(),
            "HTTP/1.1 204 No Content",
        ),
        (
            br#"{"jsonrpc":"2.0","method":7}"#.as_slice(),
            "HTTP/1.1 200 OK",
        ),
    ] {
        let response = route_request(
            HttpRequest {
                method: "POST".to_string(),
                path: "/rpc".to_string(),
                headers: BTreeMap::from([(
                    "authorization".to_string(),
                    "Bearer session-token".to_string(),
                )]),
                body: body.to_vec(),
            },
            Arc::clone(&state),
        )
        .await;
        assert!(
            String::from_utf8(response)
                .expect("rpc response")
                .starts_with(expected_status),
            "body={}",
            String::from_utf8_lossy(body)
        );
    }
}

#[test]
fn remote_lifecycle_messages_map_to_actionable_push_payloads() {
    let completed = OutgoingMessage::Notification(crate::protocol::JsonRpcNotification {
        jsonrpc: JSONRPC_VERSION.to_string(),
        method: "turn/completed".to_string(),
        params: json!({"threadId": "thread-7", "turn": {"status": "completed"}}),
    });
    let push = remote_push_notification(&completed).expect("completion should notify");
    assert_eq!(push.thread_id, "thread-7");
    assert_eq!(push.kind, "desktop.completed");
    for (method, params, expected_kind) in [
        (
            "turn/interrupted",
            json!({"threadId": "thread-7"}),
            "desktop.interrupted",
        ),
        (
            "item/requestUserInput",
            json!({"threadId": "thread-7"}),
            "desktop.needs_input",
        ),
        (
            "item/requestApproval",
            json!({"threadId": "thread-7"}),
            "desktop.needs_approval",
        ),
        (
            "turn/updated",
            json!({"thread": {"id": "thread-7"}, "turn": {"status": "failed"}}),
            "desktop.failed",
        ),
    ] {
        let message = OutgoingMessage::Notification(crate::protocol::JsonRpcNotification {
            jsonrpc: JSONRPC_VERSION.to_string(),
            method: method.to_string(),
            params,
        });
        let push = remote_push_notification(&message).expect("lifecycle should notify");
        assert_eq!(push.kind, expected_kind);
    }
    let running = OutgoingMessage::Notification(crate::protocol::JsonRpcNotification {
        jsonrpc: JSONRPC_VERSION.to_string(),
        method: "turn/updated".to_string(),
        params: json!({"threadId": "thread-7", "turn": {"status": "running"}}),
    });
    assert!(remote_push_notification(&running).is_none());
    assert!(remote_push_notification(&notification(1)).is_none());
    assert!(valid_expo_push_token("ExponentPushToken[remote-device]"));
    assert!(!valid_expo_push_token("not-a-token"));
}

#[tokio::test]
async fn route_request_covers_pairing_rpc_and_not_found_errors() {
    let state = test_state("pair-me", "session-token").await;

    let missing_pairing = route_request(
        HttpRequest {
            method: "GET".to_string(),
            path: "/pairing".to_string(),
            headers: BTreeMap::new(),
            body: Vec::new(),
        },
        Arc::clone(&state),
    )
    .await;
    assert!(String::from_utf8(missing_pairing)
        .expect("missing pairing response should be utf8")
        .starts_with("HTTP/1.1 401 Unauthorized"));

    let invalid_pairing = route_request(
        HttpRequest {
            method: "GET".to_string(),
            path: "/pairing".to_string(),
            headers: BTreeMap::from([(
                "x-taskforce-pairing-code".to_string(),
                "wrong".to_string(),
            )]),
            body: Vec::new(),
        },
        Arc::clone(&state),
    )
    .await;
    assert!(String::from_utf8(invalid_pairing)
        .expect("invalid pairing response should be utf8")
        .starts_with("HTTP/1.1 403 Forbidden"));

    let parse_error = route_request(
        HttpRequest {
            method: "POST".to_string(),
            path: "/rpc".to_string(),
            headers: BTreeMap::from([(
                "x-taskforce-session".to_string(),
                "session-token".to_string(),
            )]),
            body: b"not json".to_vec(),
        },
        Arc::clone(&state),
    )
    .await;
    let parse_error = String::from_utf8(parse_error).expect("parse error should be utf8");
    assert!(parse_error.contains("\"code\":-32700"));

    let not_found = route_request(
        HttpRequest {
            method: "GET".to_string(),
            path: "/missing".to_string(),
            headers: BTreeMap::new(),
            body: Vec::new(),
        },
        state,
    )
    .await;
    assert!(String::from_utf8(not_found)
        .expect("not found response should be utf8")
        .starts_with("HTTP/1.1 404 Not Found"));
}

#[tokio::test]
async fn health_exposes_http_transport_observability_snapshot() {
    let state = test_state("pair-me", "session-token").await;
    let _ = route_request(
        HttpRequest {
            method: "GET".to_string(),
            path: "/pairing".to_string(),
            headers: BTreeMap::from([(
                "x-taskforce-pairing-code".to_string(),
                "pair-me".to_string(),
            )]),
            body: Vec::new(),
        },
        Arc::clone(&state),
    )
    .await;
    let _ = route_request(
        HttpRequest {
            method: "POST".to_string(),
            path: "/rpc".to_string(),
            headers: BTreeMap::new(),
            body: Vec::new(),
        },
        Arc::clone(&state),
    )
    .await;

    let response = route_request(
        HttpRequest {
            method: "GET".to_string(),
            path: "/health".to_string(),
            headers: BTreeMap::new(),
            body: Vec::new(),
        },
        state,
    )
    .await;
    let text = String::from_utf8(response).expect("response should be utf8");

    assert!(text.contains("\"observability\":"));
    assert!(text.contains("\"requestTotal\":3"));
    assert!(text.contains("\"pairingSuccess\":1"));
    assert!(text.contains("\"authFailed\":1"));
    assert!(text.contains("\"rpcFailed\":1"));
}

#[tokio::test]
async fn runtime_unavailable_edges_return_json_rpc_internal_errors() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());
    let server_info = runtime.config.server_info.clone();
    let (runtime_commands, runtime_command_rx) = mpsc::channel(1);
    drop(runtime_command_rx);
    let (events, _) = broadcast::channel(1);
    let interaction_broker = InteractionBroker::new(mpsc::channel(1).0);
    let state = Arc::new(HttpServerState {
        runtime_commands,
        interaction_broker,
        server_info,
        pairing_code: Mutex::new(Some("pair-me".to_string())),
        session_token: "session-token".to_string(),
        mobile_session_tokens: Mutex::new(Vec::new()),
        mobile_push_tokens: Mutex::new(BTreeMap::new()),
        events,
        event_backlog: Mutex::new(VecDeque::with_capacity(EVENT_BACKLOG_CAPACITY)),
        stats: HttpTransportStats::default(),
        shutdown: Notify::new(),
    });

    let rpc_unavailable = route_request(
        HttpRequest {
            method: "POST".to_string(),
            path: "/rpc".to_string(),
            headers: BTreeMap::from([(
                "authorization".to_string(),
                "Bearer session-token".to_string(),
            )]),
            body: br#"{"jsonrpc":"2.0","id":1,"method":"server.ping","params":{}}"#.to_vec(),
        },
        Arc::clone(&state),
    )
    .await;
    let rpc_unavailable =
        String::from_utf8(rpc_unavailable).expect("rpc unavailable response should be utf8");
    assert!(rpc_unavailable.contains("Runtime unavailable"));

    let (runtime_commands, mut runtime_command_rx) = mpsc::channel(1);
    let interaction_broker = InteractionBroker::new(mpsc::channel(1).0);
    let state = Arc::new(HttpServerState {
        runtime_commands,
        interaction_broker,
        server_info: runtime.config.server_info.clone(),
        pairing_code: Mutex::new(Some("pair-me".to_string())),
        session_token: "session-token".to_string(),
        mobile_session_tokens: Mutex::new(Vec::new()),
        mobile_push_tokens: Mutex::new(BTreeMap::new()),
        events: broadcast::channel(1).0,
        event_backlog: Mutex::new(VecDeque::with_capacity(EVENT_BACKLOG_CAPACITY)),
        stats: HttpTransportStats::default(),
        shutdown: Notify::new(),
    });
    let request: JsonRpcRequest =
        serde_json::from_str(r#"{"jsonrpc":"2.0","id":2,"method":"server.ping","params":{}}"#)
            .expect("json-rpc request should parse");
    let receiver_dropper = tokio::spawn(async move {
        if let Some(HttpRuntimeCommand::Rpc { respond_to, .. }) = runtime_command_rx.recv().await {
            drop(respond_to);
        }
    });
    let (response, action) = handle_rpc_request(request, state).await;
    receiver_dropper.await.expect("dropper should finish");
    assert_eq!(action, stdio::ServerAction::Continue);
    assert_eq!(
        response
            .expect("runtime failure should return a response")
            .error
            .expect("runtime closed error")
            .message,
        "Runtime unavailable"
    );

    let request: JsonRpcRequest = serde_json::from_str(
        r#"{"jsonrpc":"2.0","id":3,"method":"run.submit","params":{"prompt":"notify"}}"#,
    )
    .expect("json-rpc request should parse");
    let (output_tx, output_rx) = mpsc::unbounded_channel();
    drop(output_rx);
    let (respond_to, response_rx) = oneshot::channel();
    drop(response_rx);
    handle_runtime_rpc(
        &mut runtime,
        &mut stdio::ConnectionState::default(),
        request,
        respond_to,
        &output_tx,
    )
    .await;
}

#[tokio::test]
async fn pairing_code_is_single_use() {
    let state = test_state("pair-me", "session-token").await;
    let headers = BTreeMap::from([(
        "x-taskforce-pairing-code".to_string(),
        "pair-me".to_string(),
    )]);
    let first = route_request(
        HttpRequest {
            method: "GET".to_string(),
            path: "/pairing".to_string(),
            headers: headers.clone(),
            body: Vec::new(),
        },
        Arc::clone(&state),
    )
    .await;
    let second = route_request(
        HttpRequest {
            method: "GET".to_string(),
            path: "/pairing".to_string(),
            headers,
            body: Vec::new(),
        },
        state,
    )
    .await;
    let first = String::from_utf8(first).expect("response should be utf8");
    let second = String::from_utf8(second).expect("response should be utf8");
    assert!(first.starts_with("HTTP/1.1 200 OK"));
    assert!(second.starts_with("HTTP/1.1 403 Forbidden"));
}

#[tokio::test]
async fn runtime_events_and_http_backlog_cover_output_edges() {
    let state = test_state("pair-me", "session-token").await;
    for index in 0..=EVENT_BACKLOG_CAPACITY {
        publish_http_event(&state, notification(index)).await;
    }
    let backlog = state.event_backlog.lock().await;
    assert_eq!(backlog.len(), EVENT_BACKLOG_CAPACITY);
    drop(backlog);
    assert_eq!(state.stats.event_backlog_dropped.load(Ordering::Relaxed), 1);

    let mut runtime = AppRuntime::new(RuntimeConfig::default());
    let (output_tx, mut output_rx) = mpsc::unbounded_channel();
    handle_runtime_event(
        &mut runtime,
        AppServerEvent::RunUpdated {
            run: Box::new(crate::protocol::RunRecord {
                id: "local_run_1".to_string(),
                prompt: "hello".to_string(),
                model_id: None,
                project_id: None,
                status: crate::protocol::RunStatus::Completed,
                output: Some("done".to_string()),
                error: None,
                created_at: 1,
                updated_at: 2,
                tool_events: Vec::new(),
                sources: Vec::new(),
                agent_statuses: Vec::new(),
                pending_approval: None,
            }),
        },
        &output_tx,
    )
    .await;
    let messages = output_rx.recv().await.expect("runtime event messages");
    assert!(!messages.is_empty());

    let (closed_tx, closed_rx) = mpsc::unbounded_channel();
    drop(closed_rx);
    handle_runtime_event(
        &mut runtime,
        AppServerEvent::RunDeleted {
            run_id: "local_run_1".to_string(),
        },
        &closed_tx,
    )
    .await;
}

#[tokio::test]
async fn authenticated_session_can_mint_pairing_code() {
    let state = test_state("old-code", "session-token").await;
    let response = route_request(
        HttpRequest {
            method: "POST".to_string(),
            path: "/pairing-code".to_string(),
            headers: BTreeMap::from([(
                "authorization".to_string(),
                "Bearer session-token".to_string(),
            )]),
            body: Vec::new(),
        },
        Arc::clone(&state),
    )
    .await;
    let text = String::from_utf8(response).expect("response should be utf8");
    assert!(text.starts_with("HTTP/1.1 200 OK"));
    assert!(text.contains("\"pairingCode\":"));

    let next_code = state
        .pairing_code
        .lock()
        .await
        .clone()
        .expect("pairing code should be minted");
    assert_ne!(next_code, "old-code");
}

#[tokio::test]
async fn unauthorized_event_stream_returns_json_error() {
    let state = test_state("pair-me", "session-token").await;
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("event stream listener should bind");
    let address = listener
        .local_addr()
        .expect("event stream address should be readable");
    let client = tokio::spawn(async move {
        let mut stream = TcpStream::connect(address)
            .await
            .expect("event stream client should connect");
        let mut output = Vec::new();
        stream
            .read_to_end(&mut output)
            .await
            .expect("event stream response should read");
        output
    });
    let (stream, _) = listener
        .accept()
        .await
        .expect("event stream server should accept");
    handle_event_stream(
        stream,
        HttpRequest {
            method: "GET".to_string(),
            path: "/events".to_string(),
            headers: BTreeMap::new(),
            body: Vec::new(),
        },
        state,
    )
    .await
    .expect("unauthorized event stream should write response");
    let output = client.await.expect("event stream client should finish");
    let text = String::from_utf8(output).expect("event stream response should be utf8");
    assert!(text.starts_with("HTTP/1.1 401 Unauthorized"));
}

#[tokio::test]
async fn authorized_event_stream_writes_backlog_and_live_events() {
    let state = test_state("pair-me", "session-token").await;
    state.event_backlog.lock().await.push_back(notification(1));
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("event stream listener should bind");
    let address = listener
        .local_addr()
        .expect("event stream address should be readable");
    let client = tokio::spawn(async move {
        let mut stream = TcpStream::connect(address)
            .await
            .expect("event stream client should connect");
        let mut output = Vec::new();
        let mut buffer = [0_u8; 512];
        loop {
            let read = stream
                .read(&mut buffer)
                .await
                .expect("event stream response should read");
            if read == 0 {
                break;
            }
            output.extend_from_slice(&buffer[..read]);
            let text = String::from_utf8_lossy(&output);
            if text.contains("\"index\":2") {
                break;
            }
        }
        output
    });
    let (stream, _) = listener
        .accept()
        .await
        .expect("event stream server should accept");
    let server_state = Arc::clone(&state);
    let server = tokio::spawn(async move {
        handle_event_stream(
            stream,
            HttpRequest {
                method: "GET".to_string(),
                path: "/events".to_string(),
                headers: BTreeMap::from([
                    (
                        "authorization".to_string(),
                        "Bearer session-token".to_string(),
                    ),
                    ("origin".to_string(), "http://localhost:3210".to_string()),
                ]),
                body: Vec::new(),
            },
            server_state,
        )
        .await
    });
    for _ in 0..50 {
        if state.stats.event_stream_total.load(Ordering::Relaxed) == 1 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    state
        .events
        .send(notification(2))
        .expect("live event should publish");
    let output = client.await.expect("event stream client should finish");
    server.abort();
    let text = String::from_utf8(output).expect("event stream response should be utf8");

    assert!(text.starts_with("HTTP/1.1 200 OK"));
    assert!(text.contains("Content-Type: application/x-ndjson"));
    assert!(text.contains("Access-Control-Allow-Origin: http://localhost:3210"));
    assert!(text.contains("\"index\":1"));
    assert!(text.contains("\"index\":2"));
    assert_eq!(state.stats.event_stream_total.load(Ordering::Relaxed), 1);
}

#[tokio::test]
async fn event_subscription_receives_each_event_from_backlog_or_live_stream_not_both() {
    let state = test_state("pair-me", "session-token").await;

    publish_http_event(&state, notification(1)).await;
    let (mut receiver, backlog) = subscribe_http_events(&state).await;
    assert_eq!(backlog.len(), 1);
    assert!(matches!(
        receiver.try_recv(),
        Err(broadcast::error::TryRecvError::Empty)
    ));

    let (mut receiver, backlog) = subscribe_http_events(&state).await;
    assert_eq!(backlog.len(), 1);
    publish_http_event(&state, notification(2)).await;
    let received = receiver.recv().await.expect("live event should arrive");
    assert!(matches!(
        received,
        OutgoingMessage::Notification(notification)
            if notification.params["index"] == 2
    ));
}

#[test]
fn response_helpers_cover_internal_status_and_json_rpc_success() {
    let internal = String::from_utf8(response(500, json!({"error": "boom"})))
        .expect("response should be utf8");
    assert!(internal.starts_with("HTTP/1.1 500 Internal Server Error"));
    assert!(internal.contains("\"boom\""));

    let ok = ok_response(Some(json!(7)), json!({"ok": true}));
    assert_eq!(ok.jsonrpc, JSONRPC_VERSION);
    assert_eq!(ok.id, Some(json!(7)));
    assert_eq!(ok.result, Some(json!({"ok": true})));
    assert!(ok.error.is_none());
}

#[tokio::test]
async fn http_transport_rejects_non_loopback_bindings() {
    let err = run_http(HttpServerConfig {
        host: IpAddr::V4(Ipv4Addr::UNSPECIFIED),
        port: 0,
        pairing_code: Some("pair-me".to_string()),
        ..HttpServerConfig::default()
    })
    .await
    .expect_err("non-loopback host should be rejected");

    assert!(matches!(err, HttpServerError::NonLoopbackHost));
}

#[test]
fn http_transport_allows_explicit_mobile_network_binding() {
    let config = HttpServerConfig {
        host: IpAddr::V4(Ipv4Addr::UNSPECIFIED),
        allow_non_loopback: true,
        advertise_host: Some(IpAddr::V4(Ipv4Addr::new(192, 168, 1, 20))),
        ..HttpServerConfig::default()
    };
    validate_bind_host(&config).expect("explicit mobile binding should be accepted");
}

#[tokio::test]
async fn run_http_serves_real_tcp_requests_until_shutdown_rpc() {
    let port = reserve_loopback_port();
    let server = tokio::spawn(run_http(HttpServerConfig {
        host: IpAddr::V4(Ipv4Addr::LOCALHOST),
        port,
        pairing_code: Some("pair-me".to_string()),
        ..HttpServerConfig::default()
    }));

    wait_for_http_server(port).await;

    let paired = raw_http_request(
        port,
        b"GET /pairing HTTP/1.1\r\nHost: localhost\r\nX-Taskforce-Pairing-Code: pair-me\r\n\r\n",
    )
    .await
    .expect("pairing request should complete");
    assert!(paired.starts_with("HTTP/1.1 200 OK"));
    let paired_body: Value =
        serde_json::from_str(response_body(&paired)).expect("pairing body should be json");
    let session_token = paired_body["sessionToken"]
        .as_str()
        .expect("pairing should return session token");

    for handshake_body in [
        r#"{"jsonrpc":"2.0","id":0,"method":"initialize","params":{}}"#,
        r#"{"jsonrpc":"2.0","method":"initialized","params":{}}"#,
    ] {
        let handshake_request = format!(
            "POST /rpc HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer {session_token}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{handshake_body}",
            handshake_body.len()
        );
        let handshake = raw_http_request(port, handshake_request)
            .await
            .expect("handshake request should complete");
        assert!(
            handshake.starts_with("HTTP/1.1 200 OK")
                || handshake.starts_with("HTTP/1.1 204 No Content")
        );
    }

    let shutdown_body = r#"{"jsonrpc":"2.0","id":1,"method":"shutdown","params":{}}"#;
    let shutdown_request = format!(
        "POST /rpc HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer {session_token}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{shutdown_body}",
        shutdown_body.len()
    );
    let shutdown = raw_http_request(port, shutdown_request)
        .await
        .expect("shutdown request should complete");
    assert!(shutdown.starts_with("HTTP/1.1 200 OK"));
    assert!(shutdown.contains("\"result\":{\"ok\":true}"));

    tokio::time::timeout(Duration::from_secs(2), server)
        .await
        .expect("HTTP server should stop after shutdown")
        .expect("HTTP task should join")
        .expect("HTTP server should exit cleanly");
}

#[tokio::test]
async fn mint_pairing_code_requires_session_token() {
    let state = test_state("pair-me", "session-token").await;
    let response = route_request(
        HttpRequest {
            method: "POST".to_string(),
            path: "/pairing-code".to_string(),
            headers: BTreeMap::new(),
            body: Vec::new(),
        },
        state,
    )
    .await;
    let text = String::from_utf8(response).expect("response should be utf8");
    assert!(text.starts_with("HTTP/1.1 401 Unauthorized"));
}

#[tokio::test]
async fn rpc_requires_session_token() {
    let state = test_state("pair-me", "session-token").await;
    let response = route_request(
        HttpRequest {
            method: "POST".to_string(),
            path: "/rpc".to_string(),
            headers: BTreeMap::new(),
            body: br#"{"jsonrpc":"2.0","id":1,"method":"server.ping","params":{}}"#.to_vec(),
        },
        state,
    )
    .await;
    let text = String::from_utf8(response).expect("response should be utf8");
    assert!(text.starts_with("HTTP/1.1 401 Unauthorized"));
}

#[tokio::test]
async fn options_returns_cors_preflight_headers() {
    let state = test_state("pair-me", "session-token").await;
    let response = route_request(
        HttpRequest {
            method: "OPTIONS".to_string(),
            path: "/rpc".to_string(),
            headers: BTreeMap::from([("origin".to_string(), "http://localhost:3210".to_string())]),
            body: Vec::new(),
        },
        state,
    )
    .await;
    let text = String::from_utf8(response).expect("response should be utf8");
    assert!(text.starts_with("HTTP/1.1 204"));
    assert!(text.contains("Content-Length: 0"));
    assert!(text.contains("Access-Control-Allow-Origin: http://localhost:3210"));
    assert!(text.contains("X-Taskforce-Pairing-Code"));
    assert!(!text.ends_with("null"));
}

#[tokio::test]
async fn options_rejects_unknown_cors_origin() {
    let state = test_state("pair-me", "session-token").await;
    let response = route_request(
        HttpRequest {
            method: "OPTIONS".to_string(),
            path: "/pairing".to_string(),
            headers: BTreeMap::from([("origin".to_string(), "https://evil.example".to_string())]),
            body: Vec::new(),
        },
        state,
    )
    .await;
    let text = String::from_utf8(response).expect("response should be utf8");
    assert!(text.starts_with("HTTP/1.1 204"));
    assert!(text.contains("Content-Length: 0"));
    assert!(!text.contains("Access-Control-Allow-Origin"));
    assert!(!text.ends_with("null"));
}

#[tokio::test]
async fn rpc_ping_accepts_session_token() {
    let state = test_state("pair-me", "session-token").await;
    let response = route_request(
        HttpRequest {
            method: "POST".to_string(),
            path: "/rpc".to_string(),
            headers: BTreeMap::from([(
                "authorization".to_string(),
                "Bearer session-token".to_string(),
            )]),
            body: br#"{"jsonrpc":"2.0","id":1,"method":"server.ping","params":{}}"#.to_vec(),
        },
        state,
    )
    .await;
    let text = String::from_utf8(response).expect("response should be utf8");
    assert!(text.contains("\"result\":{\"ok\":true}"));
}

#[tokio::test]
async fn rpc_notification_returns_no_json_rpc_response_body() {
    let state = test_state("pair-me", "session-token").await;
    let response = route_request(
        HttpRequest {
            method: "POST".to_string(),
            path: "/rpc".to_string(),
            headers: BTreeMap::from([(
                "authorization".to_string(),
                "Bearer session-token".to_string(),
            )]),
            body: br#"{"jsonrpc":"2.0","method":"server.ping","params":{}}"#.to_vec(),
        },
        state,
    )
    .await;
    let text = String::from_utf8(response).expect("response should be utf8");

    assert!(text.starts_with("HTTP/1.1 204 No Content"));
    assert_eq!(response_body(&text), "");
}

#[tokio::test]
async fn rpc_shutdown_notifies_http_listener() {
    let state = test_state("pair-me", "session-token").await;
    let response = route_request(
        HttpRequest {
            method: "POST".to_string(),
            path: "/rpc".to_string(),
            headers: BTreeMap::from([(
                "authorization".to_string(),
                "Bearer session-token".to_string(),
            )]),
            body: br#"{"jsonrpc":"2.0","id":1,"method":"shutdown","params":{}}"#.to_vec(),
        },
        Arc::clone(&state),
    )
    .await;
    let text = String::from_utf8(response).expect("response should be utf8");
    assert!(text.contains("\"result\":{\"ok\":true}"));
    tokio::time::timeout(Duration::from_secs(1), state.shutdown.notified())
        .await
        .expect("shutdown should notify listener");
}

#[tokio::test]
async fn rpc_dispatches_runtime_commands_over_http() {
    let state = test_state("pair-me", "session-token").await;
    let response = route_request(
        HttpRequest {
            method: "POST".to_string(),
            path: "/rpc".to_string(),
            headers: BTreeMap::from([(
                "authorization".to_string(),
                "Bearer session-token".to_string(),
            )]),
            body: br#"{"jsonrpc":"2.0","id":1,"method":"status.summary","params":{}}"#.to_vec(),
        },
        state,
    )
    .await;
    let text = String::from_utf8(response).expect("response should be utf8");
    assert!(text.contains("\"transport\":\"stdio/jsonl\""));
    assert!(text.contains("\"runCount\":0"));
}

#[tokio::test]
async fn rpc_publishes_event_notifications_to_http_backlog() {
    let state = test_state("pair-me", "session-token").await;
    let response = route_request(
        HttpRequest {
            method: "POST".to_string(),
            path: "/rpc".to_string(),
            headers: BTreeMap::from([(
                "authorization".to_string(),
                "Bearer session-token".to_string(),
            )]),
            body: br#"{"jsonrpc":"2.0","id":1,"method":"run.submit","params":{"prompt":"hello remote events"}}"#.to_vec(),
        },
        Arc::clone(&state),
    )
    .await;
    let text = String::from_utf8(response).expect("response should be utf8");
    assert!(text.contains("\"result\":{\"run\":"));

    let backlog = state.event_backlog.lock().await;
    assert!(
        backlog.iter().any(|message| matches!(
            message,
            OutgoingMessage::Notification(notification)
                if notification.method == "event"
                    && notification.params["type"] == "run_updated"
        )),
        "run.submit should publish its immediate run event"
    );
}
