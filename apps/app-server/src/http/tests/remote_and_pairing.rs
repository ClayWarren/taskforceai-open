#[tokio::test]
async fn remote_interaction_responses_require_a_pending_request_id() {
    let state = test_state("pair-code", "session-token").await;
    let response = remote_interaction_response(
        &json!({"id": 9, "params": {"result": {"decision": "accept"}}}),
        &state.interaction_broker,
    )
    .await;
    assert_eq!(response["error"]["code"], -32602);

    let response = remote_interaction_response(
        &json!({"id": 10, "params": {"requestId": 999, "result": {"decision": "accept"}}}),
        &state.interaction_broker,
    )
    .await;
    assert_eq!(response["error"]["code"], -32004);
}

#[tokio::test]
async fn remote_interaction_response_resolves_pending_requests() {
    let state = test_state("pair-code", "session-token").await;
    let waiting = {
        let broker = state.interaction_broker.clone();
        tokio::spawn(async move {
            broker
                .request(remote_tool_request(), Duration::from_secs(1))
                .await
        })
    };
    while state.interaction_broker.pending_count().await == 0 {
        tokio::task::yield_now().await;
    }

    let response = remote_interaction_response(
        &json!({"id": 11, "params": {"requestId": 1, "result": {"decision": "accept"}}}),
        &state.interaction_broker,
    )
    .await;

    assert_eq!(response["result"]["ok"], true);
    assert_eq!(
        waiting
            .await
            .expect("interaction task should join")
            .expect("interaction should resolve")["decision"],
        "accept"
    );
}

#[tokio::test]
async fn remote_command_responses_cover_allowed_branches_and_forwarding() {
    let state = test_state("pair-code", "session-token").await;
    state.event_backlog.lock().await.push_back(notification(7));
    let mut runtime = AppRuntime::new(RuntimeConfig::default());
    let mut connection = stdio::ConnectionState::default();
    let event_backlog = state.event_backlog.lock().await.clone();
    let mut notifications = Vec::new();

    let denied = remote_command_response(
        &mut runtime,
        &mut connection,
        &state.interaction_broker,
        &event_backlog,
        &json!({"jsonrpc": "2.0", "id": 1, "method": "settings.update"}),
        &mut notifications,
    )
    .await
    .expect("denied methods should return JSON-RPC errors");
    assert_eq!(denied["error"]["code"], -32601);

    let snapshot = remote_command_response(
        &mut runtime,
        &mut connection,
        &state.interaction_broker,
        &event_backlog,
        &json!({"jsonrpc": "2.0", "id": 2, "method": "remote.event.snapshot"}),
        &mut notifications,
    )
    .await
    .expect("snapshot should return backlog");
    assert_eq!(
        snapshot["result"]["events"].as_array().map(Vec::len),
        Some(1)
    );

    let interaction = remote_command_response(
        &mut runtime,
        &mut connection,
        &state.interaction_broker,
        &event_backlog,
        &json!({"jsonrpc": "2.0", "id": 3, "method": "remote.interaction.respond"}),
        &mut notifications,
    )
    .await
    .expect("interaction errors should remain JSON-RPC values");
    assert_eq!(interaction["error"]["code"], -32602);

    assert!(remote_command_response(
        &mut runtime,
        &mut connection,
        &state.interaction_broker,
        &event_backlog,
        &json!({"jsonrpc": 2, "id": 4, "method": "run.status"}),
        &mut notifications,
    )
    .await
    .is_err());

    let response = JsonRpcResponse {
        jsonrpc: JSONRPC_VERSION.to_string(),
        id: Some(json!(5)),
        result: Some(json!({"ok": true})),
        error: None,
    };
    let forwarded = split_remote_messages(
        vec![notification(8), OutgoingMessage::Response(response.clone())],
        &mut notifications,
    );
    assert_eq!(forwarded.and_then(|value| value.result), response.result);
    assert_eq!(notifications.len(), 1);

    let handled = remote_command_response(
        &mut runtime,
        &mut connection,
        &state.interaction_broker,
        &event_backlog,
        &json!({"jsonrpc": "2.0", "id": 6, "method": "server.ping"}),
        &mut notifications,
    )
    .await
    .expect("allowed methods should reach stdio dispatch");
    assert_eq!(handled["id"], 6);

    let notification_result = remote_command_response(
        &mut runtime,
        &mut connection,
        &state.interaction_broker,
        &event_backlog,
        &json!({"jsonrpc": "2.0", "method": "server.ping"}),
        &mut notifications,
    )
    .await
    .expect("allowed notifications should return an acknowledgement");
    assert_eq!(notification_result["result"], Value::Null);
}

#[tokio::test]
async fn remote_command_poll_handles_disabled_signed_out_and_submitted_commands() {
    let state = test_state("pair-code", "session-token").await;
    let mut connection = stdio::ConnectionState::default();
    let mut disabled = AppRuntime::new(RuntimeConfig::default());
    assert!(prepare_remote_poll(&mut disabled)
        .expect("disabled Remote should skip polling")
        .is_none());

    disabled
        .set_metadata_value("remote_allow_connections", "true")
        .expect("Remote should enable");
    assert!(prepare_remote_poll(&mut disabled)
        .expect("signed-out Remote should skip polling")
        .is_none());

    let poll = json!({
        "commands": [{
            "id": "command-1",
            "controllerDeviceId": "mobile-1",
            "request": {"jsonrpc": "2.0", "id": 7, "method": "forbidden.method"}
        }],
        "lastId": "command-1"
    });
    let (base_url, server) = start_remote_response_server(vec![
        (poll.to_string(), Vec::new()),
        ("{}".to_string(), Vec::new()),
    ]);
    let mut runtime = AppRuntime::new(RuntimeConfig {
        api_base_url: base_url,
        ..RuntimeConfig::default()
    });
    runtime
        .set_metadata_value("remote_allow_connections", "true")
        .expect("Remote should enable");
    runtime
        .set_auth_token(Some("remote-token"))
        .expect("auth token should persist");

    let completion = prepare_remote_poll(&mut runtime)
        .expect("Remote poll should prepare")
        .expect("enabled Remote should poll")
        .execute()
        .await
        .expect("Remote command should poll");
    process_remote_poll_completion(
        &mut runtime,
        &mut connection,
        &state.interaction_broker,
        &state.event_backlog.lock().await.clone(),
        completion,
    )
    .await
    .expect("Remote command should submit");

    assert_eq!(
        runtime
            .remote_last_command_id()
            .expect("last command should persist"),
        "command-1"
    );
    server.join().expect("mock Remote server should finish");

    let stale_completion = RemotePollCompletion {
        request: RemotePollRequest {
            api_client: runtime.remote_api_client().clone(),
            token: "stale-token".to_string(),
            device_id: "desktop-stale".to_string(),
            device_credential: "stale-credential".to_string(),
            last_id: "command-1".to_string(),
        },
        poll: ApiRemoteCommandPoll {
            commands: Vec::new(),
            last_id: "command-stale".to_string(),
        },
    };
    process_remote_poll_completion(
        &mut runtime,
        &mut connection,
        &state.interaction_broker,
        &state.event_backlog.lock().await.clone(),
        stale_completion,
    )
    .await
    .expect("stale Remote completion should be discarded");
    assert_eq!(
        runtime
            .remote_last_command_id()
            .expect("Remote cursor should remain current"),
        "command-1"
    );

    report_remote_poll_result(Ok(()));
    report_remote_poll_result(Err(RuntimeError::invalid_params("offline")));
}

#[tokio::test]
async fn remote_command_poll_submits_batch_results_concurrently() {
    let listener =
        std::net::TcpListener::bind("127.0.0.1:0").expect("mock Remote result server should bind");
    let address = listener.local_addr().expect("mock Remote result address");
    let barrier = Arc::new(std::sync::Barrier::new(3));
    let server = thread::spawn({
        let barrier = Arc::clone(&barrier);
        move || {
            let mut workers = Vec::new();
            for _ in 0..2 {
                let (mut stream, _) = listener.accept().expect("Remote result should arrive");
                let barrier = Arc::clone(&barrier);
                workers.push(thread::spawn(move || {
                    read_mock_http_request(&mut stream);
                    barrier.wait();
                    stream
                        .write_all(
                            b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}",
                        )
                        .expect("Remote result response should write");
                }));
            }
            barrier.wait();
            for worker in workers {
                worker.join().expect("Remote result worker should finish");
            }
        }
    });

    let state = test_state("pair-code", "session-token").await;
    let mut runtime = AppRuntime::new(RuntimeConfig {
        api_base_url: format!("http://{address}"),
        ..RuntimeConfig::default()
    });
    runtime
        .set_metadata_value("remote_allow_connections", "true")
        .expect("Remote should enable");
    runtime
        .set_auth_token(Some("remote-token"))
        .expect("auth token should persist");
    let mut connection = stdio::ConnectionState::default();
    let completion = RemotePollCompletion {
        request: RemotePollRequest {
            api_client: runtime.remote_api_client().clone(),
            token: "remote-token".to_string(),
            device_id: "desktop-1".to_string(),
            device_credential: "credential-1".to_string(),
            last_id: "0".to_string(),
        },
        poll: ApiRemoteCommandPoll {
            commands: ["command-1", "command-2"]
                .into_iter()
                .map(|id| ApiRemoteCommand {
                    id: id.to_string(),
                    controller_device_id: "mobile-1".to_string(),
                    request: json!({"jsonrpc": "2.0", "id": id, "method": "server.ping"}),
                })
                .collect(),
            last_id: "command-2".to_string(),
        },
    };

    tokio::time::timeout(
        Duration::from_secs(2),
        process_remote_poll_completion(
            &mut runtime,
            &mut connection,
            &state.interaction_broker,
            &state.event_backlog.lock().await.clone(),
            completion,
        ),
    )
    .await
    .expect("concurrent Remote result uploads should not deadlock")
    .expect("Remote result batch should submit");
    server.join().expect("Remote result server should finish");
    assert_eq!(
        runtime
            .remote_last_command_id()
            .expect("Remote cursor should persist"),
        "command-2"
    );
}

#[tokio::test]
async fn runtime_loop_executes_remote_polls_outside_the_command_loop() {
    let poll = json!({
        "commands": [{
            "id": "command-loop",
            "controllerDeviceId": "mobile-loop",
            "request": {"jsonrpc": "2.0", "id": 8, "method": "server.ping"}
        }],
        "lastId": "command-loop"
    });
    let (base_url, server) = start_remote_response_server(vec![
        (poll.to_string(), Vec::new()),
        (
            json!({"csrfToken": "csrf-loop"}).to_string(),
            vec![("Set-Cookie", "csrf_token=csrf-loop; Path=/")],
        ),
        ("{}".to_string(), Vec::new()),
    ]);
    let mut runtime = AppRuntime::new(RuntimeConfig {
        api_base_url: base_url,
        ..RuntimeConfig::default()
    });
    runtime
        .set_metadata_value("remote_allow_connections", "true")
        .expect("Remote should enable");
    runtime
        .set_auth_token(Some("remote-token"))
        .expect("auth token should persist");

    let server_info = runtime.config.server_info.clone();
    let (runtime_event_tx, runtime_event_rx) = mpsc::channel(8);
    runtime.set_event_sender(runtime_event_tx);
    let (runtime_commands, runtime_command_rx) = mpsc::channel(8);
    let (runtime_outputs, _runtime_output_rx) = mpsc::unbounded_channel();
    let (interaction_output_tx, _interaction_output_rx) = mpsc::channel(8);
    let interaction_broker = InteractionBroker::new(interaction_output_tx);
    runtime.set_interaction_broker(interaction_broker.clone());
    let (events, _) = broadcast::channel(8);
    let state = Arc::new(HttpServerState {
        runtime_commands,
        interaction_broker,
        server_info,
        pairing_code: Mutex::new(None),
        session_token: "session-loop".to_string(),
        mobile_session_tokens: Mutex::new(Vec::new()),
        mobile_push_tokens: Mutex::new(BTreeMap::new()),
        events,
        event_backlog: Mutex::new(VecDeque::with_capacity(EVENT_BACKLOG_CAPACITY)),
        connection_slots: Arc::new(Semaphore::new(MAX_HTTP_CONNECTIONS)),
        stats: HttpTransportStats::default(),
        shutdown: Notify::new(),
    });
    let loop_task = tokio::spawn(http_runtime_loop(
        runtime,
        runtime_command_rx,
        runtime_event_rx,
        runtime_outputs,
        state,
    ));

    tokio::task::spawn_blocking(move || server.join())
        .await
        .expect("mock Remote server join should complete")
        .expect("mock Remote server should finish");
    tokio::time::sleep(REMOTE_POLL_CHECK_INTERVAL + Duration::from_millis(100)).await;
    loop_task.abort();
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
    let deadline = Instant::now() + Duration::from_secs(10);
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
async fn read_request_times_out_incomplete_headers() {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("timeout listener should bind");
    let address = listener
        .local_addr()
        .expect("timeout listener address should be readable");
    let client = tokio::spawn(async move {
        let mut stream = TcpStream::connect(address)
            .await
            .expect("timeout client should connect");
        stream
            .write_all(b"GET /health HTTP/1.1\r\n")
            .await
            .expect("partial header should write");
        tokio::time::sleep(Duration::from_millis(100)).await;
    });
    let (mut stream, _) = listener
        .accept()
        .await
        .expect("timeout server should accept");
    let response = read_request_with_timeout(&mut stream, Duration::from_millis(10))
        .await
        .expect_err("partial headers should time out");
    assert!(String::from_utf8(response)
        .expect("timeout response should be utf8")
        .starts_with("HTTP/1.1 408 Request Timeout"));
    client.abort();
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
