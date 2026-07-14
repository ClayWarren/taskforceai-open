use super::support::{
    json_response, result_value, set_auth_token, start_recording_response_sequence_server,
    start_status_response_sequence_server, MockHttpResponse, MockStatusHttpResponse,
};
use super::*;
use crate::protocol::{RemoteControllerRevokeParams, RemoteSettingsUpdateParams};
use taskforceai_app_protocol::InitializeParams;

#[test]
fn environment_runtime_uses_an_in_memory_keychain_in_tests() {
    let config = RuntimeConfig::from_env();

    assert_eq!(
        config.auth_token_storage,
        AuthTokenStorage::KeyringWithMemoryFallback
    );
    assert!(config.auth_keychain.is_some());
}

#[test]
fn initialize_advertises_tui_ready_capabilities() {
    let runtime = AppRuntime::new(RuntimeConfig::default());
    let result = result_value(runtime.initialize(InitializeParams::default()));

    assert_eq!(result["capabilities"]["runs"], true);
    assert_eq!(result["capabilities"]["history"], true);
    assert_eq!(result["capabilities"]["attachments"], true);
    assert_eq!(result["capabilities"]["events"], true);
    assert_eq!(result["capabilities"]["agentSessions"], true);
    assert_eq!(result["capabilities"]["diagnostics"], true);
    assert_eq!(result["capabilities"]["channels"], true);
    assert_eq!(result["capabilities"]["schedules"], true);
    assert_eq!(result["capabilities"]["workflows"], true);

    let negotiated = result_value(runtime.initialize(InitializeParams {
        capabilities: taskforceai_app_protocol::ClientCapabilities {
            experimental_api: true,
            bidirectional_requests: true,
            request_user_input: true,
            mcp_elicitation: true,
            dynamic_tools: true,
            opt_out_notification_methods: Vec::new(),
        },
        ..InitializeParams::default()
    }));
    assert_eq!(negotiated["negotiated"]["dynamicTools"], true);
}

#[test]
fn remote_device_credential_is_random_strength_and_stable() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());
    let first = runtime
        .remote_device_credential()
        .expect("Remote credential should be generated");
    let second = runtime
        .remote_device_credential()
        .expect("Remote credential should be reused");

    assert_eq!(first, second);
    assert_eq!(first.len(), 43);
}

#[test]
fn remote_device_credentials_cover_metadata_and_keychain_storage() {
    let mut invalid_metadata = AppRuntime::new(RuntimeConfig::default());
    invalid_metadata
        .set_metadata_value("remote_device_credential", "short")
        .expect("short credential fixture should persist");
    let replacement = invalid_metadata
        .remote_device_credential()
        .expect("short metadata credential should be replaced");
    assert_eq!(replacement.len(), 43);
    assert_ne!(replacement, "short");

    let valid = "v".repeat(43);
    let existing_keychain = TestAuthKeychain::new(Some(&valid));
    let mut existing = AppRuntime::new(RuntimeConfig {
        auth_token_storage: AuthTokenStorage::KeyringWithMemoryFallback,
        auth_keychain: Some(existing_keychain),
        ..RuntimeConfig::default()
    });
    assert_eq!(
        existing
            .remote_device_credential()
            .expect("valid keychain credential should load"),
        valid
    );

    let generated_keychain = TestAuthKeychain::new(None);
    let mut generated = AppRuntime::new(RuntimeConfig {
        auth_token_storage: AuthTokenStorage::KeyringWithMemoryFallback,
        auth_keychain: Some(generated_keychain.clone()),
        ..RuntimeConfig::default()
    });
    let credential = generated
        .remote_device_credential()
        .expect("missing keychain credential should generate");
    assert_eq!(credential.len(), 43);
    assert_eq!(
        generated_keychain
            .get("com.taskforceai.app-server.auth")
            .expect("generated credential should be readable")
            .as_deref(),
        Some(credential.as_str())
    );

    let mut read_failure = AppRuntime::new(RuntimeConfig {
        auth_token_storage: AuthTokenStorage::KeyringWithMemoryFallback,
        auth_keychain: Some(TestAuthKeychain::with_failures(None, true, false, false)),
        ..RuntimeConfig::default()
    });
    assert!(read_failure
        .remote_device_credential()
        .expect_err("keychain read failures should be reported")
        .message
        .contains("keychain read failed"));

    let mut write_failure = AppRuntime::new(RuntimeConfig {
        auth_token_storage: AuthTokenStorage::KeyringWithMemoryFallback,
        auth_keychain: Some(TestAuthKeychain::with_failures(None, false, true, false)),
        ..RuntimeConfig::default()
    });
    assert!(write_failure
        .remote_device_credential()
        .expect_err("keychain write failures should be reported")
        .message
        .contains("keychain write failed"));
}

#[test]
fn remote_device_name_prefers_configured_then_hostname_then_fallback() {
    use crate::runtime::impl_remote::resolve_local_device_name;

    assert_eq!(
        resolve_local_device_name(Some("Studio Mac".to_string()), Some("host".to_string())),
        "Studio Mac"
    );
    assert_eq!(
        resolve_local_device_name(Some("  ".to_string()), Some("host".to_string())),
        "host"
    );
    assert_eq!(
        resolve_local_device_name(None, Some("  ".to_string())),
        "This Mac"
    );
}

#[tokio::test]
async fn remote_settings_pairing_and_controllers_round_trip() {
    let mut local = AppRuntime::new(RuntimeConfig::default());
    let initial = result_value(
        local
            .remote_settings_get()
            .expect("Remote settings should read"),
    );
    assert_eq!(initial["allowConnections"], false);
    let updated = result_value(
        local
            .remote_settings_update(RemoteSettingsUpdateParams {
                allow_connections: Some(false),
                keep_awake: Some(true),
            })
            .await
            .expect("signed-out Remote settings should update locally"),
    );
    assert_eq!(updated["keepAwake"], true);
    assert!(local
        .remote_pairing_code_create()
        .await
        .expect_err("disabled Remote pairing should fail")
        .message
        .contains("Enable Remote connections"));
    local
        .set_metadata_value("remote_allow_connections", "true")
        .expect("Remote fixture should enable");
    assert!(local
        .remote_pairing_code_create()
        .await
        .expect_err("signed-out Remote pairing should fail")
        .message
        .contains("Sign in"));
    assert!(local
        .remote_controller_list()
        .await
        .expect_err("signed-out controller listing should fail")
        .message
        .contains("Sign in"));
    assert!(local
        .remote_controller_revoke(RemoteControllerRevokeParams {
            device_id: "mobile-1".to_string(),
        })
        .await
        .expect_err("signed-out controller revocation should fail")
        .message
        .contains("Sign in"));

    let target = json!({
        "deviceId": "desktop-1",
        "deviceName": "Studio",
        "allowConnections": true,
        "keepAwake": true,
        "lastSeenAt": "2026-07-13T00:00:00Z"
    });
    let (base_url, server, requests) = start_recording_response_sequence_server(vec![
        MockHttpResponse {
            body: json!({"csrfToken": "csrf-1"}).to_string(),
            headers: vec![("Set-Cookie", "csrf_token=csrf-1; Path=/")],
        },
        json_response(target.to_string()),
        MockHttpResponse {
            body: json!({"csrfToken": "csrf-2"}).to_string(),
            headers: vec![("Set-Cookie", "csrf_token=csrf-2; Path=/")],
        },
        json_response(target.to_string()),
        MockHttpResponse {
            body: json!({"csrfToken": "csrf-3"}).to_string(),
            headers: vec![("Set-Cookie", "csrf_token=csrf-3; Path=/")],
        },
        json_response(json!({"code": "PAIR-123", "expiresIn": 600}).to_string()),
        MockHttpResponse {
            body: json!({"csrfToken": "csrf-list"}).to_string(),
            headers: vec![("Set-Cookie", "csrf_token=csrf-list; Path=/")],
        },
        json_response(target.to_string()),
        json_response(
            json!({
                "devices": [{
                    "deviceId": "mobile-1",
                    "deviceName": "Phone",
                    "userAgent": "TaskForceAI Mobile",
                    "lastConnectedAt": "2026-07-13T00:00:00Z",
                    "capabilities": ["threads"]
                }]
            })
            .to_string(),
        ),
        MockHttpResponse {
            body: json!({"csrfToken": "csrf-4"}).to_string(),
            headers: vec![("Set-Cookie", "csrf_token=csrf-4; Path=/")],
        },
        json_response("{}".to_string()),
    ]);
    let mut runtime = AppRuntime::new(RuntimeConfig {
        api_base_url: base_url,
        ..RuntimeConfig::default()
    });
    set_auth_token(&mut runtime, "token");

    let settings = result_value(
        runtime
            .remote_settings_update(RemoteSettingsUpdateParams {
                allow_connections: Some(true),
                keep_awake: Some(true),
            })
            .await
            .expect("Remote settings should sync"),
    );
    assert_eq!(settings["allowConnections"], true);
    assert!(runtime.remote_enabled().expect("Remote state should read"));
    assert_eq!(
        runtime
            .remote_token()
            .expect("Remote token should read")
            .as_deref(),
        Some("token")
    );
    let (device_id, device_name) = runtime
        .remote_identity()
        .expect("Remote identity should resolve");
    assert!(!device_id.is_empty());
    assert!(!device_name.is_empty());
    assert_eq!(
        runtime
            .remote_last_command_id()
            .expect("default Remote cursor should read"),
        "0"
    );
    runtime
        .set_remote_last_command_id("command-2")
        .expect("Remote cursor should persist");
    assert_eq!(
        runtime
            .remote_last_command_id()
            .expect("Remote cursor should read"),
        "command-2"
    );

    let pairing = result_value(
        runtime
            .remote_pairing_code_create()
            .await
            .expect("Remote pairing code should create"),
    );
    assert_eq!(pairing["code"], "PAIR-123");
    let controllers = result_value(
        runtime
            .remote_controller_list()
            .await
            .expect("Remote controllers should list"),
    );
    assert_eq!(controllers["devices"][0]["deviceId"], "mobile-1");
    let revoked = result_value(
        runtime
            .remote_controller_revoke(RemoteControllerRevokeParams {
                device_id: " mobile-1 ".to_string(),
            })
            .await
            .expect("Remote controller should revoke"),
    );
    assert_eq!(revoked["ok"], true);
    runtime
        .remote_disable_on_logout()
        .expect("logout should disable Remote");
    assert!(!runtime.remote_enabled().expect("Remote state should read"));

    server.join().expect("Remote mock server should exit");
    let requests = requests.lock().expect("Remote requests should record");
    assert!(requests.iter().any(|request| {
        request.path == "/remote/target" && request.headers.contains_key("x-device-credential")
    }));
    assert!(requests
        .iter()
        .any(|request| request.path == "/remote/controllers/mobile-1"));
}

#[tokio::test]
async fn remote_controller_list_recovers_from_a_stale_device_credential_binding() {
    let target = json!({
        "deviceId": "replacement",
        "deviceName": "Studio",
        "allowConnections": true,
        "keepAwake": false,
        "lastSeenAt": "2026-07-13T00:00:00Z"
    });
    let (base_url, server, requests) = start_status_response_sequence_server(vec![
        MockStatusHttpResponse {
            status: 200,
            body: json!({"csrfToken": "csrf-stale"}).to_string(),
            headers: vec![("Set-Cookie", "csrf_token=csrf-stale; Path=/")],
        },
        MockStatusHttpResponse {
            status: 403,
            body: json!({"detail": "Remote device credential mismatch"}).to_string(),
            headers: vec![],
        },
        MockStatusHttpResponse {
            status: 200,
            body: json!({"csrfToken": "csrf-retry"}).to_string(),
            headers: vec![("Set-Cookie", "csrf_token=csrf-retry; Path=/")],
        },
        MockStatusHttpResponse {
            status: 200,
            body: target.to_string(),
            headers: vec![],
        },
        MockStatusHttpResponse {
            status: 200,
            body: json!({"devices": []}).to_string(),
            headers: vec![],
        },
    ]);
    let mut runtime = AppRuntime::new(RuntimeConfig {
        api_base_url: base_url,
        ..RuntimeConfig::default()
    });
    set_auth_token(&mut runtime, "token");
    runtime
        .set_metadata_value("device_id", "sync-device-stays-stable")
        .expect("sync identity fixture should persist");
    runtime
        .set_metadata_value("remote_allow_connections", "true")
        .expect("Remote fixture should enable");

    let controllers = result_value(
        runtime
            .remote_controller_list()
            .await
            .expect("credential mismatch should recover with a new Remote identity"),
    );
    assert_eq!(controllers["devices"], json!([]));
    let (remote_device_id, _) = runtime
        .remote_identity()
        .expect("recovered Remote identity should persist");
    assert!(remote_device_id.starts_with("taskforce-remote-"));
    assert_eq!(
        runtime
            .sync_status_result()
            .expect("sync status should remain readable")
            .device_id
            .as_deref(),
        Some("sync-device-stays-stable")
    );

    server.join().expect("Remote mock server should exit");
    let requests = requests.lock().expect("Remote requests should record");
    let target_device_ids = requests
        .iter()
        .filter(|request| request.path == "/remote/target")
        .filter_map(|request| request.headers.get("x-device-id"))
        .collect::<Vec<_>>();
    assert_eq!(target_device_ids.len(), 2);
    assert_eq!(target_device_ids[0], "sync-device-stays-stable");
    assert!(target_device_ids[1].starts_with("taskforce-remote-"));
}

#[tokio::test]
async fn remote_unauthorized_clears_stale_auth_without_updating_local_settings() {
    use std::io::{Read, Write};
    use std::net::TcpListener;

    let listener = TcpListener::bind("127.0.0.1:0").expect("Remote mock server should bind");
    let address = listener
        .local_addr()
        .expect("Remote mock address should resolve");
    let server = std::thread::spawn(move || {
        for (status, body, headers) in [
            (
                "HTTP/1.1 200 OK",
                r#"{"csrfToken":"csrf-stale"}"#,
                vec![("Set-Cookie", "csrf_token=csrf-stale; Path=/")],
            ),
            ("HTTP/1.1 401 Unauthorized", "unauthorized", Vec::new()),
        ] {
            let (mut stream, _) = listener.accept().expect("Remote request should arrive");
            let mut request = [0_u8; 4096];
            let _ = stream.read(&mut request);
            let mut response = format!(
                "{status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n",
                body.len()
            );
            for (name, value) in headers {
                response.push_str(name);
                response.push_str(": ");
                response.push_str(value);
                response.push_str("\r\n");
            }
            response.push_str("\r\n");
            response.push_str(body);
            stream
                .write_all(response.as_bytes())
                .expect("Remote response should write");
        }
    });

    let mut runtime = AppRuntime::new(RuntimeConfig {
        api_base_url: format!("http://{address}"),
        ..RuntimeConfig::default()
    });
    set_auth_token(&mut runtime, "stale-token");

    let error = runtime
        .remote_settings_update(RemoteSettingsUpdateParams {
            allow_connections: Some(true),
            keep_awake: None,
        })
        .await
        .expect_err("stale Remote auth should fail");

    assert_eq!(error.code, -32010);
    assert_eq!(error.message, "Your session expired. Sign in again.");
    assert_eq!(result_value(runtime.auth_status())["authenticated"], false);
    assert!(!runtime.remote_enabled().expect("Remote state should read"));
    server.join().expect("Remote mock server should exit");
}

#[tokio::test]
async fn remote_settings_commands_cover_account_subscription_data_and_apps() {
    let user = json!({
        "email": "ops@example.com",
        "full_name": "Ops Lead",
        "plan": "pro",
        "theme_preference": "dark",
        "notifications_enabled": true,
        "memory_enabled": true,
        "web_search_enabled": true,
        "code_execution_enabled": false,
        "trust_layer_enabled": true,
        "quick_mode_enabled": false,
        "subscription_status": "active",
        "subscription_source": "stripe"
    });
    let csrf = || MockHttpResponse {
        body: json!({ "csrfToken": "test-csrf" }).to_string(),
        headers: vec![("Set-Cookie", "csrf_token=test-csrf; Path=/")],
    };
    let (base_url, server, requests) = start_recording_response_sequence_server(vec![
        json_response(user.to_string()),
        json_response(user.to_string()),
        csrf(),
        json_response(json!({ "success": true, "message": "Notifications saved" }).to_string()),
        json_response(user.to_string()),
        csrf(),
        json_response(json!({ "success": true, "message": "Personalization saved" }).to_string()),
        json_response(user.to_string()),
        json_response(
            json!({
                "subscription": {
                    "cancel_at_period_end": false
                }
            })
            .to_string(),
        ),
        csrf(),
        json_response(json!({ "success": true, "message": "Subscription canceled" }).to_string()),
        csrf(),
        json_response(
            json!({ "success": true, "message": "Subscription reactivated" }).to_string(),
        ),
        csrf(),
        json_response(json!({ "success": true, "message": "Plan updated" }).to_string()),
        json_response(user.to_string()),
        json_response(user.to_string()),
        csrf(),
        json_response(json!({ "success": true, "message": "Account deleted" }).to_string()),
        json_response(
            json!([
                {"provider": "github", "connected": true},
                {"provider": "slack", "connected": false}
            ])
            .to_string(),
        ),
        csrf(),
        json_response(
            json!({ "success": true, "message": "Integration disconnected" }).to_string(),
        ),
    ]);
    let mut runtime = AppRuntime::new(RuntimeConfig {
        api_base_url: base_url,
        ..RuntimeConfig::default()
    });
    set_auth_token(&mut runtime, "token");

    let account = result_value(
        runtime
            .remote_settings_command(RemoteSettingsCommandParams {
                area: "account".to_string(),
                args: Vec::new(),
            })
            .await
            .expect("account settings should load"),
    );
    assert!(account["message"]
        .as_str()
        .expect("message")
        .contains("Ops Lead"));

    let notifications = result_value(
        runtime
            .remote_settings_command(RemoteSettingsCommandParams {
                area: "notifications".to_string(),
                args: Vec::new(),
            })
            .await
            .expect("notification settings should load"),
    );
    assert!(notifications["message"]
        .as_str()
        .expect("message")
        .contains("Notifications: on"));
    let notifications_saved = result_value(
        runtime
            .remote_settings_command(RemoteSettingsCommandParams {
                area: "notifications".to_string(),
                args: vec!["off".to_string()],
            })
            .await
            .expect("notification settings should save"),
    );
    assert_eq!(notifications_saved["message"], "Notifications saved");

    let personalization = result_value(
        runtime
            .remote_settings_command(RemoteSettingsCommandParams {
                area: "personalization".to_string(),
                args: Vec::new(),
            })
            .await
            .expect("personalization settings should load"),
    );
    assert!(personalization["message"]
        .as_str()
        .expect("message")
        .contains("Direct chat: off"));
    let personalization_saved = result_value(
        runtime
            .remote_settings_command(RemoteSettingsCommandParams {
                area: "personalization".to_string(),
                args: vec!["memory".to_string(), "off".to_string()],
            })
            .await
            .expect("personalization settings should save"),
    );
    assert_eq!(personalization_saved["message"], "Personalization saved");

    let subscription = result_value(
        runtime
            .remote_settings_command(RemoteSettingsCommandParams {
                area: "subscription".to_string(),
                args: Vec::new(),
            })
            .await
            .expect("subscription should load"),
    );
    assert!(subscription["message"]
        .as_str()
        .expect("message")
        .contains("Subscription status: active"));
    for (action, expected) in [
        ("cancel", "Subscription canceled"),
        ("reactivate", "Subscription reactivated"),
    ] {
        let result = result_value(
            runtime
                .remote_settings_command(RemoteSettingsCommandParams {
                    area: "subscription".to_string(),
                    args: vec![action.to_string()],
                })
                .await
                .expect("subscription action should save"),
        );
        assert_eq!(result["message"], expected);
    }
    let upgraded = result_value(
        runtime
            .remote_settings_command(RemoteSettingsCommandParams {
                area: "subscription".to_string(),
                args: vec!["upgrade".to_string(), "team".to_string()],
            })
            .await
            .expect("subscription upgrade should save"),
    );
    assert_eq!(upgraded["message"], "Plan updated");

    let data_help = result_value(
        runtime
            .remote_settings_command(RemoteSettingsCommandParams {
                area: "data".to_string(),
                args: Vec::new(),
            })
            .await
            .expect("data help should render"),
    );
    assert!(data_help["message"]
        .as_str()
        .expect("message")
        .contains("Use /settings data export"));
    let mismatch = runtime
        .remote_settings_command(RemoteSettingsCommandParams {
            area: "data".to_string(),
            args: vec!["delete".to_string(), "wrong@example.com".to_string()],
        })
        .await
        .expect_err("email mismatch should fail");
    assert_eq!(mismatch.code, -32602);
    let deleted = result_value(
        runtime
            .remote_settings_command(RemoteSettingsCommandParams {
                area: "data".to_string(),
                args: vec!["delete".to_string(), "ops@example.com".to_string()],
            })
            .await
            .expect("account delete should save"),
    );
    assert_eq!(deleted["message"], "Account deleted");
    set_auth_token(&mut runtime, "token");

    let apps = result_value(
        runtime
            .remote_settings_command(RemoteSettingsCommandParams {
                area: "apps".to_string(),
                args: Vec::new(),
            })
            .await
            .expect("apps should list"),
    );
    assert!(apps["message"]
        .as_str()
        .expect("message")
        .contains("github"));
    let connect = result_value(
        runtime
            .remote_settings_command(RemoteSettingsCommandParams {
                area: "apps".to_string(),
                args: vec!["connect".to_string(), "github".to_string()],
            })
            .await
            .expect("connect should render guidance"),
    );
    assert!(connect["message"]
        .as_str()
        .expect("message")
        .contains("/api/auth/signin/github"));
    let disconnected = result_value(
        runtime
            .remote_settings_command(RemoteSettingsCommandParams {
                area: "apps".to_string(),
                args: vec!["disconnect".to_string(), "github".to_string()],
            })
            .await
            .expect("disconnect should save"),
    );
    assert_eq!(disconnected["message"], "Integration disconnected");

    server.join().expect("remote settings server should finish");
    let requests = requests.lock().expect("requests should be recorded");
    assert!(requests
        .iter()
        .any(|request| request.path == "/auth/settings"));
    assert!(requests
        .iter()
        .any(|request| request.path == "/gdpr/delete-account"));
}
