use std::fs;

use futures_util::{SinkExt as _, StreamExt as _};
use serde_json::json;
use tokio::net::TcpListener;
use tokio::sync::{mpsc, watch};
use tokio_tungstenite::tungstenite::Message;

use super::*;

#[test]
fn websocket_url_preserves_the_versioned_api_base_and_cursor() {
    assert_eq!(
        remote_websocket_url("https://sync.example/api/v1", "mac id", "17-4")
            .expect("WebSocket URL"),
        "wss://sync.example/api/v1/remote/devices/mac%20id/ws?lastId=17-4"
    );
    assert!(
        remote_websocket_url("ftp://sync.example/api/v1", "mac-1", "0")
            .expect_err("unsupported schemes should fail")
            .to_string()
            .contains("does not support ftp URLs")
    );
}

#[test]
fn websocket_envelope_defaults_a_missing_cursor() {
    let envelope: RemoteWebSocketEnvelope = serde_json::from_value(json!({
        "type": "commands",
        "commands": []
    }))
    .expect("command envelope");
    assert_eq!(envelope.last_id, "0");
}

#[test]
fn mobile_remote_can_manage_project_workspaces_without_deleting_projects() {
    assert!(mobile_rpc_method_allowed(Some("project.use")));
    assert!(mobile_rpc_method_allowed(Some("project.clear")));
    assert!(mobile_rpc_method_allowed(Some("project.create")));
    assert!(mobile_rpc_method_allowed(Some("project.workspace.set")));
    assert!(!mobile_rpc_method_allowed(Some("project.delete")));
}

#[test]
fn mobile_github_repository_listing_does_not_require_a_workspace() {
    let connection = stdio::ConnectionState::authenticated_mobile(Vec::new());
    let request = serde_json::from_value::<JsonRpcRequest>(json!({
        "jsonrpc": JSONRPC_VERSION,
        "id": 1,
        "method": "github.repository.list",
        "params": {"query": "taskforce"}
    }))
    .expect("valid GitHub repository list request");

    assert!(mobile_rpc_method_allowed(request.method.as_deref()));
    assert!(mobile_rpc_workspace_request_allowed(&connection, &request));
}

#[test]
fn mobile_path_bearing_requests_stay_within_attached_roots() {
    let base = std::env::temp_dir().join(format!(
        "taskforceai-mobile-path-scope-{}-{}",
        std::process::id(),
        crate::runtime::unix_millis()
    ));
    let trusted = base.join("trusted");
    let untrusted = base.join("untrusted");
    fs::create_dir_all(&trusted).expect("create trusted workspace");
    fs::create_dir_all(&untrusted).expect("create untrusted workspace");
    let connection = stdio::ConnectionState::authenticated_mobile(vec![trusted
        .canonicalize()
        .expect("canonical trusted workspace")]);
    let request = |method: &str, params: Value| {
        serde_json::from_value::<JsonRpcRequest>(json!({
            "jsonrpc": JSONRPC_VERSION,
            "id": 1,
            "method": method,
            "params": params
        }))
        .expect("valid request")
    };

    assert!(mobile_rpc_workspace_request_allowed(
        &connection,
        &request(
            "git.repository.clone",
            json!({
                "remoteUrl": "https://example.com/repo.git",
                "destination": trusted.join("clone").display().to_string()
            })
        )
    ));
    assert!(!mobile_rpc_workspace_request_allowed(
        &connection,
        &request(
            "git.repository.clone",
            json!({
                "remoteUrl": "https://example.com/repo.git",
                "destination": untrusted.join("clone").display().to_string()
            })
        )
    ));
    assert!(mobile_rpc_workspace_request_allowed(
        &connection,
        &request(
            "git.worktree.create",
            json!({
                "workspace": trusted.display().to_string(),
                "path": trusted.join("worktree").display().to_string(),
                "branch": "mobile-safe"
            })
        )
    ));
    assert!(!mobile_rpc_workspace_request_allowed(
        &connection,
        &request(
            "git.worktree.create",
            json!({
                "workspace": trusted.display().to_string(),
                "path": untrusted.join("worktree").display().to_string(),
                "branch": "mobile-escape"
            })
        )
    ));
    assert!(!mobile_rpc_workspace_request_allowed(
        &connection,
        &request(
            "git.worktree.create",
            json!({
                "workspace": trusted.display().to_string(),
                "branch": "mobile-default-escape"
            })
        )
    ));
    assert!(!mobile_rpc_workspace_request_allowed(
        &connection,
        &request(
            "thread.start",
            json!({
                "objective": "outside",
                "settings": { "workspaceRoot": untrusted.display().to_string() }
            })
        )
    ));

    let repository = base.join("repository");
    let nested = repository.join("packages/mobile-only");
    fs::create_dir_all(&nested).expect("create nested Git workspace");
    let initialized = std::process::Command::new("git")
        .args(["init", "--quiet"])
        .current_dir(&repository)
        .status()
        .expect("run git init");
    assert!(initialized.success());
    let nested_connection = stdio::ConnectionState::authenticated_mobile(vec![nested
        .canonicalize()
        .expect("canonical nested workspace")]);
    for method in [
        "git.review.status",
        "git.review.diff",
        "git.review.stage",
        "git.review.comment.list",
        "git.review.comment.add",
        "git.review.pullRequest.action",
        "git.branch.list",
        "git.branch.checkout",
        "git.branch.create",
        "git.worktree.list",
        "git.worktree.create",
        "git.repository.commit",
        "git.repository.pull",
        "git.repository.push",
        "git.pullRequest.create",
    ] {
        assert!(
            !mobile_rpc_workspace_request_allowed(
                &nested_connection,
                &request(
                    method,
                    json!({
                        "workspace": nested.display().to_string(),
                        "path": nested.join("worktree").display().to_string()
                    })
                )
            ),
            "{method} must not act on a repository root outside the authorized workspace"
        );
    }
    let repository_connection = stdio::ConnectionState::authenticated_mobile(vec![repository
        .canonicalize()
        .expect("canonical repository root")]);
    assert!(mobile_rpc_workspace_request_allowed(
        &repository_connection,
        &request(
            "git.branch.checkout",
            json!({
                "workspace": repository.display().to_string(),
                "branch": "main",
                "remote": false
            })
        )
    ));

    fs::remove_dir_all(base).ok();
}

#[tokio::test]
async fn remote_workspace_requests_are_scoped_to_desktop_attached_roots() {
    let base = std::env::temp_dir().join(format!(
        "taskforceai-remote-workspace-scope-{}",
        std::process::id()
    ));
    let trusted = base.join("trusted");
    let untrusted = base.join("untrusted");
    fs::create_dir_all(&trusted).expect("create trusted workspace");
    fs::create_dir_all(&untrusted).expect("create untrusted workspace");
    fs::write(trusted.join("README.md"), "TRUSTED_REMOTE_WORKSPACE\n").expect("write trusted file");
    fs::write(untrusted.join("secret.txt"), "REMOTE_SCOPE_FILE_READ_POC\n")
        .expect("write untrusted file");

    let mut runtime = AppRuntime::new(crate::runtime::RuntimeConfig::default());
    let mut connection = stdio::ConnectionState::authenticated_mobile(vec![trusted
        .canonicalize()
        .expect("canonical trusted workspace")]);
    let (interaction_output, _interaction_rx) = mpsc::channel(1);
    let broker = InteractionBroker::new(interaction_output);
    let backlog = VecDeque::new();
    let mut notifications = Vec::new();

    let trusted_response = remote_command_response(
        &mut runtime,
        &mut connection,
        &broker,
        &backlog,
        &json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "workspace.file.read",
            "params": {
                "workspace": trusted.display().to_string(),
                "path": "README.md",
                "maxBytes": 128
            }
        }),
        &mut notifications,
    )
    .await
    .expect("trusted Remote workspace should be readable");
    assert_eq!(
        trusted_response["result"]["content"],
        "TRUSTED_REMOTE_WORKSPACE\n"
    );

    let denied = remote_command_response(
        &mut runtime,
        &mut connection,
        &broker,
        &backlog,
        &json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "workspace.file.read",
            "params": {
                "workspace": untrusted.display().to_string(),
                "path": "secret.txt",
                "maxBytes": 128
            }
        }),
        &mut notifications,
    )
    .await
    .expect("untrusted Remote workspace should return a JSON-RPC error");
    assert_eq!(denied["error"]["code"], -32602);
    assert_eq!(
        denied["error"]["message"],
        "workspace is not authorized for this mobile session"
    );
    assert!(!denied.to_string().contains("REMOTE_SCOPE_FILE_READ_POC"));

    let denied_git = remote_command_response(
        &mut runtime,
        &mut connection,
        &broker,
        &backlog,
        &json!({
            "jsonrpc": "2.0",
            "id": 4,
            "method": "git.repository.commit",
            "params": {
                "workspace": untrusted.display().to_string(),
                "message": "must not run"
            }
        }),
        &mut notifications,
    )
    .await
    .expect("untrusted Remote Git action should return a JSON-RPC error");
    assert_eq!(denied_git["error"]["code"], -32602);
    assert_eq!(
        denied_git["error"]["message"],
        "workspace is not authorized for this mobile session"
    );

    let clone_destination = untrusted.join("remote-clone-escape");
    let denied_clone = remote_command_response(
        &mut runtime,
        &mut connection,
        &broker,
        &backlog,
        &json!({
            "jsonrpc": "2.0",
            "id": 5,
            "method": "git.repository.clone",
            "params": {
                "remoteUrl": "https://example.com/attacker/repository.git",
                "destination": clone_destination.display().to_string()
            }
        }),
        &mut notifications,
    )
    .await
    .expect("out-of-scope clone should return a JSON-RPC error");
    assert_eq!(denied_clone["error"]["code"], -32602);
    assert!(
        !clone_destination.exists(),
        "the denied clone must not create its destination"
    );

    let self_authorize = remote_command_response(
        &mut runtime,
        &mut connection,
        &broker,
        &backlog,
        &json!({
            "jsonrpc": "2.0",
            "id": 3,
            "method": "project.workspace.set",
            "params": {
                "projectId": 1,
                "workspaceRoots": [untrusted.display().to_string()]
            }
        }),
        &mut notifications,
    )
    .await
    .expect("Remote self-authorization should return a JSON-RPC error");
    assert_eq!(self_authorize["error"]["code"], -32602);
}

#[tokio::test]
async fn websocket_batches_require_the_current_remote_session_and_ack_the_cursor() {
    let mut runtime = AppRuntime::new(crate::runtime::RuntimeConfig::default());
    runtime
        .set_metadata_value("remote_allow_connections", "true")
        .expect("Remote should enable");
    runtime
        .set_auth_token(Some("token-1"))
        .expect("Remote token should persist");
    let mut connection = stdio::ConnectionState::default();
    let (interaction_output, _interaction_rx) = mpsc::channel(1);
    let broker = InteractionBroker::new(interaction_output);
    let backlog = VecDeque::new();

    let stale = process_remote_websocket_batch(
        &mut runtime,
        &mut connection,
        &broker,
        &backlog,
        RemoteWebSocketBatch {
            token: "stale-token".to_string(),
            poll: ApiRemoteCommandPoll {
                commands: Vec::new(),
                last_id: "stale-cursor".to_string(),
            },
        },
    )
    .await
    .expect("stale batch should be ignored");
    assert!(stale.0.is_empty());
    assert!(stale.1.is_empty());

    let (results, notifications) = process_remote_websocket_batch(
        &mut runtime,
        &mut connection,
        &broker,
        &backlog,
        RemoteWebSocketBatch {
            token: "token-1".to_string(),
            poll: ApiRemoteCommandPoll {
                commands: vec![ApiRemoteCommand {
                    id: "command-1".to_string(),
                    controller_device_id: "phone-1".to_string(),
                    request: json!({
                        "jsonrpc": "2.0",
                        "id": 8,
                        "method": "server.ping"
                    }),
                }],
                last_id: "10-0".to_string(),
            },
        },
    )
    .await
    .expect("current batch should execute");
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].command_id, "command-1");
    assert_eq!(results[0].last_id.as_deref(), Some("10-0"));
    assert!(notifications.is_empty());
}

#[tokio::test]
#[allow(clippy::result_large_err)] // tungstenite's server handshake callback owns this signature.
async fn websocket_transport_authenticates_receives_commands_and_returns_results() {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("WebSocket fixture should bind");
    let address = listener.local_addr().expect("fixture address");
    let fixture = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.expect("client should connect");
        let mut socket = tokio_tungstenite::accept_hdr_async(
            stream,
            |request: &tokio_tungstenite::tungstenite::handshake::server::Request,
             response: tokio_tungstenite::tungstenite::handshake::server::Response| {
                assert_eq!(
                    request.uri().path_and_query().map(ToString::to_string),
                    Some("/api/v1/remote/devices/mac-1/ws?lastId=9-0".to_string())
                );
                assert_eq!(
                    request
                        .headers()
                        .get(AUTHORIZATION)
                        .and_then(|value| value.to_str().ok()),
                    Some("Bearer token-1")
                );
                assert_eq!(
                    request
                        .headers()
                        .get("X-Device-Id")
                        .and_then(|value| value.to_str().ok()),
                    Some("mac-1")
                );
                assert_eq!(
                    request
                        .headers()
                        .get("X-Device-Credential")
                        .and_then(|value| value.to_str().ok()),
                    Some("credential-1")
                );
                Ok(response)
            },
        )
        .await
        .expect("WebSocket upgrade should succeed");
        socket
            .send(Message::Ping(b"heartbeat".to_vec().into()))
            .await
            .expect("ping should send");
        loop {
            let message = socket
                .next()
                .await
                .expect("pong frame")
                .expect("valid pong frame");
            if matches!(message, Message::Pong(payload) if payload.as_ref() == b"heartbeat") {
                break;
            }
        }
        socket
            .send(Message::Text(
                json!({
                    "type": "commands",
                    "lastId": "10-0",
                    "commands": [{
                        "id": "command-1",
                        "controllerDeviceId": "phone-1",
                        "request": {"jsonrpc": "2.0", "id": 8, "method": "server.ping"}
                    }]
                })
                .to_string()
                .into(),
            ))
            .await
            .expect("command should send");
        loop {
            let message = socket
                .next()
                .await
                .expect("result frame")
                .expect("valid frame");
            if let Message::Text(payload) = message {
                let value: Value = serde_json::from_str(&payload).expect("result JSON");
                assert_eq!(value["type"], "result");
                assert_eq!(value["commandId"], "command-1");
                assert_eq!(value["controllerDeviceId"], "phone-1");
                assert_eq!(value["response"]["result"]["ok"], true);
                assert_eq!(value["lastId"], "10-0");
                socket
                    .send(Message::Text(
                        json!({
                            "type": "resultAck",
                            "commandId": "command-1",
                            "lastId": "10-0"
                        })
                        .to_string()
                        .into(),
                    ))
                    .await
                    .expect("result acknowledgement should send");
                socket
                    .send(Message::Close(None))
                    .await
                    .expect("close should send");
                break;
            }
        }
    });

    let request = RemotePollRequest {
        api_client: ApiClient::new(format!("http://{address}/api/v1")),
        token: "token-1".to_string(),
        device_id: "mac-1".to_string(),
        device_credential: "credential-1".to_string(),
        last_id: "9-0".to_string(),
    };
    let (events_tx, mut events_rx) = mpsc::channel(4);
    let (results_tx, results_rx) = mpsc::channel(4);
    let (stop_tx, stop_rx) = watch::channel(false);
    let transport = tokio::spawn(request.run_websocket(events_tx, results_rx, stop_rx));

    assert!(matches!(
        events_rx.recv().await,
        Some(RemoteWebSocketEvent::Connected)
    ));
    let Some(RemoteWebSocketEvent::Commands(batch)) = events_rx.recv().await else {
        panic!("expected a command batch");
    };
    assert_eq!(batch.poll.last_id, "10-0");
    assert_eq!(batch.poll.commands.len(), 1);
    results_tx
        .send(RemoteCommandResult {
            kind: "result",
            command_id: "command-1".to_string(),
            controller_device_id: "phone-1".to_string(),
            response: json!({"jsonrpc": "2.0", "id": 8, "result": {"ok": true}}),
            last_id: Some("10-0".to_string()),
        })
        .await
        .expect("result should queue");

    let Some(RemoteWebSocketEvent::CursorAcknowledged { token, last_id }) = events_rx.recv().await
    else {
        panic!("expected a result acknowledgement");
    };
    assert_eq!(token, "token-1");
    assert_eq!(last_id, "10-0");

    fixture.await.expect("fixture should finish");
    let _ = stop_tx.send(true);
    transport.await.expect("transport task should finish");
}

#[tokio::test]
async fn websocket_transport_stops_when_requested() {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("WebSocket fixture should bind");
    let address = listener.local_addr().expect("fixture address");
    let fixture = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.expect("client should connect");
        let mut socket = tokio_tungstenite::accept_async(stream)
            .await
            .expect("WebSocket upgrade should succeed");
        while let Some(message) = socket.next().await {
            if matches!(message.expect("valid frame"), Message::Close(_)) {
                return;
            }
        }
        panic!("client should send a close frame");
    });

    let request = RemotePollRequest {
        api_client: ApiClient::new(format!("http://{address}")),
        token: "token-1".to_string(),
        device_id: "mac-1".to_string(),
        device_credential: "credential-1".to_string(),
        last_id: "0".to_string(),
    };
    let (events_tx, mut events_rx) = mpsc::channel(4);
    let (_results_tx, results_rx) = mpsc::channel(1);
    let (stop_tx, stop_rx) = watch::channel(false);
    let transport = tokio::spawn(request.run_websocket(events_tx, results_rx, stop_rx));

    assert!(matches!(
        events_rx.recv().await,
        Some(RemoteWebSocketEvent::Connected)
    ));
    stop_tx.send(true).expect("stop should signal");
    fixture.await.expect("fixture should finish");
    transport.await.expect("transport task should finish");
    assert!(matches!(
        events_rx.recv().await,
        Some(RemoteWebSocketEvent::Disconnected(_))
    ));
}
