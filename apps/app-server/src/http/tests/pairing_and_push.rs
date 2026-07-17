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
    let trusted_root =
        std::env::temp_dir().join(format!("taskforceai-mobile-trusted-{}", std::process::id()));
    fs::create_dir_all(&trusted_root).expect("create trusted root");
    fs::write(trusted_root.join("README.md"), "TRUSTED_MOBILE_WORKSPACE\n")
        .expect("write trusted workspace file");
    let state = test_state_with_mobile_workspaces(
        "pair-mobile",
        "desktop-token",
        vec![trusted_root.display().to_string(), "/".to_string()],
    )
    .await;
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
    let untrusted_root = std::env::temp_dir().join(format!(
        "taskforceai-mobile-untrusted-{}",
        std::process::id()
    ));
    fs::create_dir_all(&untrusted_root).expect("create untrusted root");
    fs::write(
        untrusted_root.join("secret.txt"),
        "MOBILE_SCOPE_FILE_READ_POC\n",
    )
    .expect("write untrusted secret");
    let arbitrary_read = route_request(
        HttpRequest {
            method: "POST".to_string(),
            path: "/rpc".to_string(),
            headers: BTreeMap::from([(
                "authorization".to_string(),
                format!("Bearer {mobile_token}"),
            )]),
            body: format!(
                r#"{{"jsonrpc":"2.0","id":99,"method":"workspace.file.read","params":{{"workspace":{},"path":"secret.txt","maxBytes":128}}}}"#,
                serde_json::to_string(&untrusted_root.display().to_string())
                    .expect("serialize untrusted root")
            )
            .into_bytes(),
        },
        Arc::clone(&state),
    )
    .await;
    let arbitrary_read = String::from_utf8(arbitrary_read).expect("file response should be utf8");
    assert!(arbitrary_read.contains("\"code\":-32602"));
    assert!(arbitrary_read.contains("workspace is not authorized for this mobile session"));
    assert!(!arbitrary_read.contains("MOBILE_SCOPE_FILE_READ_POC"));
    let poisoned_root_read = route_request(
        HttpRequest {
            method: "POST".to_string(),
            path: "/rpc".to_string(),
            headers: BTreeMap::from([(
                "authorization".to_string(),
                format!("Bearer {mobile_token}"),
            )]),
            body: br#"{"jsonrpc":"2.0","id":102,"method":"workspace.file.read","params":{"workspace":"/","path":"etc/hosts","maxBytes":128}}"#.to_vec(),
        },
        Arc::clone(&state),
    )
    .await;
    let poisoned_root_read =
        String::from_utf8(poisoned_root_read).expect("root response should be utf8");
    assert!(poisoned_root_read.contains("\"code\":-32602"));
    assert!(poisoned_root_read.contains("workspace is not authorized for this mobile session"));
    let desktop_read = route_request(
        HttpRequest {
            method: "POST".to_string(),
            path: "/rpc".to_string(),
            headers: BTreeMap::from([(
                "authorization".to_string(),
                "Bearer desktop-token".to_string(),
            )]),
            body: format!(
                r#"{{"jsonrpc":"2.0","id":101,"method":"workspace.file.read","params":{{"workspace":{},"path":"secret.txt","maxBytes":128}}}}"#,
                serde_json::to_string(&untrusted_root.display().to_string())
                    .expect("serialize untrusted root")
            )
            .into_bytes(),
        },
        Arc::clone(&state),
    )
    .await;
    let desktop_read = String::from_utf8(desktop_read).expect("desktop response should be utf8");
    assert!(desktop_read.contains("MOBILE_SCOPE_FILE_READ_POC"));
    let self_authorize = route_request(
        HttpRequest {
            method: "POST".to_string(),
            path: "/rpc".to_string(),
            headers: BTreeMap::from([(
                "authorization".to_string(),
                format!("Bearer {mobile_token}"),
            )]),
            body: format!(
                r#"{{"jsonrpc":"2.0","id":100,"method":"project.workspace.set","params":{{"projectId":1,"workspaceRoots":[{}]}}}}"#,
                serde_json::to_string(&untrusted_root.display().to_string())
                    .expect("serialize untrusted root")
            )
            .into_bytes(),
        },
        Arc::clone(&state),
    )
    .await;
    let self_authorize = String::from_utf8(self_authorize).expect("workspace response utf8");
    assert!(self_authorize.contains("workspace is not authorized for this mobile session"));
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
    publish_http_event(
        &state,
        process_output_notification("MOBILE_MUST_NOT_RECEIVE_THIS_PTY_OUTPUT"),
    )
    .await;
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
    assert!(!snapshot.contains("MOBILE_MUST_NOT_RECEIVE_THIS_PTY_OUTPUT"));

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
                    r#"{{"jsonrpc":"2.0","id":4,"method":"{method}","params":{{"workspace":{},"path":"README.md"}}}}"#,
                    serde_json::to_string(&trusted_root.display().to_string())
                        .expect("serialize trusted root")
                )
                .into_bytes(),
            },
            Arc::clone(&state),
        )
        .await;
        let response = String::from_utf8(response).expect("file response should be utf8");
        assert!(!response.contains("not available to mobile control sessions"));
        assert!(
            !response.contains("workspace is not authorized"),
            "{method}: {response}"
        );
        if method == "workspace.file.read" {
            assert!(response.contains("TRUSTED_MOBILE_WORKSPACE"), "{response}");
        }
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
