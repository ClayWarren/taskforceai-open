use super::*;
use crate::runtime::{DEFAULT_KEYCHAIN_SERVICE, DESKTOP_KEYCHAIN_SERVICE, LEGACY_KEYCHAIN_SERVICE};

#[tokio::test]
async fn auth_status_tracks_cached_token_and_logout_clears_it() {
    use base64::Engine as _;

    fn token_with_claims(claims: Value) -> String {
        let header = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(r#"{"alg":"none"}"#);
        let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(claims.to_string());
        format!("{header}.{payload}.sig")
    }

    let mut runtime = AppRuntime::new(RuntimeConfig::default());
    set_auth_token(
        &mut runtime,
        &token_with_claims(json!({
            "id": 42,
            "email": "ops@example.com",
            "full_name": "Ops User",
            "picture": "https://example.com/avatar.png"
        })),
    );

    let authenticated = result_value(runtime.auth_status());
    assert_eq!(authenticated["authenticated"], true);
    assert_eq!(authenticated["user"]["id"], "42");
    assert_eq!(authenticated["user"]["email"], "ops@example.com");
    assert_eq!(authenticated["user"]["fullName"], "Ops User");
    assert_eq!(
        authenticated["user"]["image"],
        "https://example.com/avatar.png"
    );
    assert!(authenticated.get("token").is_none());

    set_auth_token(
        &mut runtime,
        &token_with_claims(json!({
            "id": "user-42",
            "email": "named@example.com",
            "name": "Named User",
            "image": "https://example.com/named.png"
        })),
    );
    let named = result_value(runtime.auth_status());
    assert_eq!(named["user"]["id"], "user-42");
    assert_eq!(named["user"]["fullName"], "Named User");
    assert_eq!(named["user"]["image"], "https://example.com/named.png");

    set_auth_token(&mut runtime, &token_with_claims(json!({})));
    let empty_claims = result_value(runtime.auth_status());
    assert_eq!(empty_claims["authenticated"], true);
    assert_eq!(empty_claims["user"], Value::Null);

    set_auth_token(
        &mut runtime,
        &token_with_claims(json!({
            "id": "expired-user",
            "exp": 1
        })),
    );
    let expired = result_value(runtime.auth_status());
    assert_eq!(expired["authenticated"], false);
    let expired_summary = result_value(
        runtime
            .status_summary()
            .expect("status summary should read expired auth safely"),
    );
    assert_eq!(expired_summary["authenticated"], false);

    let logout = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/logout".to_string(),
            })
            .await
            .expect("logout command should succeed"),
    );
    assert_eq!(logout["handled"], true);
    let unauthenticated = result_value(runtime.auth_status());
    assert_eq!(unauthenticated["authenticated"], false);
    assert!(unauthenticated.get("token").is_none());
}

#[tokio::test]
async fn api_health_reports_remote_status_and_base_url() {
    let (base_url, server, requests) =
        start_recording_response_sequence_server(vec![json_response("{}".to_string())]);
    let runtime = AppRuntime::new(RuntimeConfig {
        api_base_url: base_url.clone(),
        ..RuntimeConfig::default()
    });

    let health = result_value(
        runtime
            .api_health()
            .await
            .expect("api health should succeed"),
    );

    assert_eq!(health["healthy"], true);
    assert_eq!(health["status"], 200);
    assert_eq!(health["baseUrl"], base_url);
    server.join().expect("mock health server should exit");
    assert_eq!(
        requests.lock().expect("requests should be recorded")[0].path,
        "/health"
    );
}

#[tokio::test]
async fn device_login_poll_stores_approved_access_token() {
    let (base_url, server, requests) = start_recording_response_sequence_server(vec![
        MockHttpResponse {
            body: json!({ "csrfToken": "test-csrf" }).to_string(),
            headers: vec![("Set-Cookie", "csrf_token=test-csrf; Path=/")],
        },
        json_response(
            json!({
                "device_code": "device-123",
                "user_code": "ABCD",
                "verification_uri": "https://example.com/device",
                "verification_uri_complete": "https://example.com/device?user_code=ABCD",
                "expires_in": 600,
                "interval": 5
            })
            .to_string(),
        ),
        MockHttpResponse {
            body: json!({ "csrfToken": "test-csrf" }).to_string(),
            headers: vec![("Set-Cookie", "csrf_token=test-csrf; Path=/")],
        },
        json_response(
            json!({
                "status": "approved",
                "access_token": "approved-token",
                "accessToken": "approved-token",
                "expires_in": 3600
            })
            .to_string(),
        ),
    ]);
    let mut runtime = AppRuntime::new(RuntimeConfig {
        api_base_url: base_url,
        ..RuntimeConfig::default()
    });

    let started = result_value(
        runtime
            .auth_device_start()
            .await
            .expect("device login should start"),
    );
    assert_eq!(started["deviceCode"], "device-123");
    let polled = result_value(
        runtime
            .auth_device_poll(DeviceLoginPollParams {
                device_code: "device-123".to_string(),
            })
            .await
            .expect("device login should poll"),
    );
    assert_eq!(polled["status"], "approved");
    assert_eq!(polled["token"], "approved-token");
    assert_eq!(result_value(runtime.auth_status())["authenticated"], true);
    assert_eq!(
        result_value(
            runtime
                .metadata_get(MetadataGetParams {
                    key: "auth_token".to_string(),
                })
                .expect("auth token should be readable")
        )["value"],
        "approved-token"
    );
    server.join().expect("mock auth server should exit");

    let requests = requests.lock().expect("requests should be recorded");
    assert_eq!(requests[1].path, "/auth/device/start");
    assert_eq!(requests[3].path, "/auth/device/token");
    let body: Value = serde_json::from_str(&requests[3].body).expect("poll body should be json");
    assert_eq!(body["device_code"], "device-123");
}

#[tokio::test]
async fn device_login_approved_without_token_keeps_existing_auth() {
    let (base_url, server, _requests) = start_recording_response_sequence_server(vec![
        MockHttpResponse {
            body: json!({ "csrfToken": "test-csrf" }).to_string(),
            headers: vec![("Set-Cookie", "csrf_token=test-csrf; Path=/")],
        },
        json_response(json!({ "status": "approved", "expires_in": 60 }).to_string()),
    ]);
    let mut runtime = AppRuntime::new(RuntimeConfig {
        api_base_url: base_url,
        ..RuntimeConfig::default()
    });
    set_auth_token(&mut runtime, "existing-token");

    let polled = result_value(
        runtime
            .auth_device_poll(DeviceLoginPollParams {
                device_code: "device-123".to_string(),
            })
            .await
            .expect("approved poll without token should not replace auth"),
    );

    assert_eq!(polled["status"], "approved");
    assert_eq!(
        result_value(
            runtime
                .metadata_get(MetadataGetParams {
                    key: "auth_token".to_string(),
                })
                .expect("auth token should be readable")
        )["value"],
        "existing-token"
    );
    server.join().expect("mock auth server should exit");
}

#[tokio::test]
async fn device_login_pending_does_not_replace_existing_token() {
    let (base_url, server, _requests) = start_recording_response_sequence_server(vec![
        MockHttpResponse {
            body: json!({ "csrfToken": "test-csrf" }).to_string(),
            headers: vec![("Set-Cookie", "csrf_token=test-csrf; Path=/")],
        },
        json_response(json!({ "status": "pending", "interval": 5 }).to_string()),
    ]);
    let mut runtime = AppRuntime::new(RuntimeConfig {
        api_base_url: base_url,
        ..RuntimeConfig::default()
    });
    set_auth_token(&mut runtime, "existing-token");

    let polled = result_value(
        runtime
            .auth_device_poll(DeviceLoginPollParams {
                device_code: "device-123".to_string(),
            })
            .await
            .expect("pending device login should poll"),
    );

    assert_eq!(polled["status"], "pending");
    assert_eq!(
        result_value(
            runtime
                .metadata_get(MetadataGetParams {
                    key: "auth_token".to_string(),
                })
                .expect("auth token should be readable")
        )["value"],
        "existing-token"
    );
    server.join().expect("mock auth server should exit");
}

#[test]
fn auth_token_is_not_persisted_to_plaintext_metadata_store() {
    let store_path = test_store_path("auth-token-restart");
    let config = RuntimeConfig {
        auth_token_storage: AuthTokenStorage::KeyringWithMemoryFallback,
        auth_keychain: Some(TestAuthKeychain::new(None)),
        ..RuntimeConfig::default().with_run_store_path(&store_path)
    };
    let mut runtime = AppRuntime::try_new(config).expect("runtime should start");

    runtime.set_auth_token(Some("persisted-token")).unwrap();
    assert_eq!(
        runtime
            .auth_token()
            .expect("auth token should read")
            .as_deref(),
        Some("persisted-token")
    );
    assert_ne!(
        runtime
            .metadata_value("auth_token")
            .expect("metadata should read")
            .as_deref(),
        Some("persisted-token")
    );
    assert_store_file_does_not_contain_auth_token(&store_path, "persisted-token");

    let _ = std::fs::remove_file(store_path);
}

#[test]
fn auth_token_reloads_from_keychain_after_restart() {
    let store_path = test_store_path("auth-token-keychain-restart");
    let config = RuntimeConfig {
        auth_token_storage: AuthTokenStorage::KeyringWithMemoryFallback,
        auth_keychain: Some(TestAuthKeychain::new(None)),
        ..RuntimeConfig::default().with_run_store_path(&store_path)
    };
    let mut runtime = AppRuntime::try_new(config.clone()).expect("runtime should start");

    runtime.set_auth_token(Some("persisted-token")).unwrap();
    assert_store_file_does_not_contain_auth_token(&store_path, "persisted-token");
    drop(runtime);

    let restarted = AppRuntime::try_new(config).expect("runtime should restart");
    assert_eq!(
        restarted
            .auth_token()
            .expect("auth token should read")
            .as_deref(),
        Some("persisted-token")
    );

    let _ = std::fs::remove_file(store_path);
}

#[test]
fn auth_token_migrates_from_legacy_keychain_service() {
    let store_path = test_store_path("auth-token-keychain-service-migration");
    let keychain = TestAuthKeychain::with_legacy_token("legacy-token");
    let config = RuntimeConfig {
        auth_token_storage: AuthTokenStorage::KeyringWithMemoryFallback,
        auth_keychain_service: "com.taskforceai.desktop.auth".to_string(),
        auth_keychain: Some(keychain.clone()),
        ..RuntimeConfig::default().with_run_store_path(&store_path)
    };
    let runtime = AppRuntime::try_new(config).expect("runtime should start");

    assert_eq!(
        runtime
            .auth_token()
            .expect("legacy auth token should migrate")
            .as_deref(),
        Some("legacy-token")
    );
    assert_eq!(
        keychain
            .token_for_service("com.taskforceai.desktop.auth")
            .as_deref(),
        Some("legacy-token")
    );
    assert_eq!(
        keychain
            .token_for_service("com.taskforceai.app-server.auth")
            .as_deref(),
        Some("legacy-token")
    );
    assert_eq!(keychain.token_for_service("taskforceai"), None);

    let _ = std::fs::remove_file(store_path);
}

#[test]
fn auth_token_uses_legacy_entry_when_keychain_migration_write_fails() {
    let store_path = test_store_path("auth-token-keychain-service-migration-write-failure");
    let keychain =
        TestAuthKeychain::with_legacy_token_and_failures("legacy-token", false, true, false);
    let config = RuntimeConfig {
        auth_token_storage: AuthTokenStorage::KeyringWithMemoryFallback,
        auth_keychain_service: "com.taskforceai.desktop.auth".to_string(),
        auth_keychain: Some(keychain.clone()),
        ..RuntimeConfig::default().with_run_store_path(&store_path)
    };
    let runtime = AppRuntime::try_new(config).expect("runtime should start");

    assert_eq!(
        runtime
            .auth_token()
            .expect("legacy auth token should remain usable")
            .as_deref(),
        Some("legacy-token")
    );
    assert_eq!(
        keychain.token_for_service("com.taskforceai.desktop.auth"),
        None
    );
    assert_eq!(
        keychain.token_for_service("taskforceai").as_deref(),
        Some("legacy-token")
    );

    let _ = std::fs::remove_file(store_path);
}

#[test]
fn auth_token_remains_available_when_legacy_keychain_delete_fails() {
    let store_path = test_store_path("auth-token-keychain-service-migration-delete-failure");
    let keychain =
        TestAuthKeychain::with_legacy_token_and_failures("legacy-token", false, false, true);
    let config = RuntimeConfig {
        auth_token_storage: AuthTokenStorage::KeyringWithMemoryFallback,
        auth_keychain_service: "com.taskforceai.desktop.auth".to_string(),
        auth_keychain: Some(keychain.clone()),
        ..RuntimeConfig::default().with_run_store_path(&store_path)
    };
    let runtime = AppRuntime::try_new(config).expect("runtime should start");

    assert_eq!(
        runtime
            .auth_token()
            .expect("migrated auth token should remain usable")
            .as_deref(),
        Some("legacy-token")
    );
    assert_eq!(
        keychain
            .token_for_service("com.taskforceai.desktop.auth")
            .as_deref(),
        Some("legacy-token")
    );
    assert_eq!(
        keychain.token_for_service("taskforceai").as_deref(),
        Some("legacy-token")
    );

    let _ = std::fs::remove_file(store_path);
}

#[test]
fn auth_token_clear_removes_keychain_and_runtime_state() {
    let store_path = test_store_path("auth-token-keychain-clear");
    let config = RuntimeConfig {
        auth_token_storage: AuthTokenStorage::KeyringWithMemoryFallback,
        auth_keychain: Some(TestAuthKeychain::new(None)),
        ..RuntimeConfig::default().with_run_store_path(&store_path)
    };
    let mut runtime = AppRuntime::try_new(config.clone()).expect("runtime should start");

    runtime.set_auth_token(Some("persisted-token")).unwrap();
    runtime.set_auth_token(None).unwrap();
    assert_eq!(runtime.auth_token().expect("auth token should read"), None);
    drop(runtime);

    let restarted = AppRuntime::try_new(config).expect("runtime should restart");
    assert_eq!(
        restarted.auth_token().expect("auth token should read"),
        None
    );

    let _ = std::fs::remove_file(store_path);
}

#[test]
fn auth_token_clear_removes_every_migrated_keychain_copy() {
    for service in [DEFAULT_KEYCHAIN_SERVICE, DESKTOP_KEYCHAIN_SERVICE] {
        let store_path = test_store_path(&format!("auth-token-migrated-clear-{service}"));
        let keychain = TestAuthKeychain::with_legacy_token("legacy-token");
        let config = RuntimeConfig {
            auth_token_storage: AuthTokenStorage::KeyringWithMemoryFallback,
            auth_keychain_service: service.to_string(),
            auth_keychain: Some(keychain.clone()),
            ..RuntimeConfig::default().with_run_store_path(&store_path)
        };
        let mut runtime = AppRuntime::try_new(config).expect("runtime should start");

        assert_eq!(
            runtime
                .auth_token()
                .expect("legacy token should migrate")
                .as_deref(),
            Some("legacy-token")
        );
        assert_eq!(
            keychain
                .token_for_service(DEFAULT_KEYCHAIN_SERVICE)
                .as_deref(),
            Some("legacy-token")
        );
        assert_eq!(
            keychain
                .token_for_service(DESKTOP_KEYCHAIN_SERVICE)
                .as_deref(),
            Some("legacy-token")
        );

        runtime
            .set_auth_token(None)
            .expect("logout should clear every migrated token");
        for cleared_service in [
            DEFAULT_KEYCHAIN_SERVICE,
            DESKTOP_KEYCHAIN_SERVICE,
            LEGACY_KEYCHAIN_SERVICE,
        ] {
            assert_eq!(keychain.token_for_service(cleared_service), None);
        }

        let _ = std::fs::remove_file(store_path);
    }
}

#[test]
fn auth_token_stays_in_memory_when_keychain_write_cannot_be_verified() {
    let store_path = test_store_path("auth-token-keychain-fallback");
    let config = RuntimeConfig {
        auth_token_storage: AuthTokenStorage::KeyringWithMemoryFallback,
        auth_keychain: Some(TestAuthKeychain::with_failures(None, false, true, false)),
        ..RuntimeConfig::default().with_run_store_path(&store_path)
    };
    let mut runtime = AppRuntime::try_new(config.clone()).expect("runtime should start");

    runtime.set_auth_token(Some("fallback-token")).unwrap();
    assert_eq!(
        runtime
            .auth_token()
            .expect("auth token should read")
            .as_deref(),
        Some("fallback-token")
    );
    assert_ne!(
        runtime
            .metadata_value("auth_token")
            .expect("metadata should read")
            .as_deref(),
        Some("fallback-token")
    );
    assert_store_file_does_not_contain_auth_token(&store_path, "fallback-token");
    drop(runtime);

    let restarted = AppRuntime::try_new(config).expect("runtime should restart");
    assert_eq!(
        restarted
            .auth_token()
            .expect("auth token should read")
            .as_deref(),
        None
    );

    let _ = std::fs::remove_file(store_path);
}

#[test]
fn auth_token_clears_legacy_metadata_fallback_on_startup() {
    let store_path = test_store_path("auth-token-keychain-legacy-cleanup");
    let mut legacy_runtime = AppRuntime::try_new(RuntimeConfig {
        auth_token_storage: AuthTokenStorage::Memory,
        ..RuntimeConfig::default().with_run_store_path(&store_path)
    })
    .expect("legacy runtime should start");
    legacy_runtime
        .set_metadata_value("auth_token", "metadata-token")
        .expect("legacy metadata token should persist");
    drop(legacy_runtime);

    let config = RuntimeConfig {
        auth_token_storage: AuthTokenStorage::KeyringWithMemoryFallback,
        auth_keychain: Some(TestAuthKeychain::with_failures(None, true, false, false)),
        ..RuntimeConfig::default().with_run_store_path(&store_path)
    };
    let runtime = AppRuntime::try_new(config).expect("runtime should start");

    assert_eq!(
        runtime
            .auth_token()
            .expect("auth token should read")
            .as_deref(),
        None
    );
    assert_ne!(
        runtime
            .metadata_value("auth_token")
            .expect("metadata should read")
            .as_deref(),
        Some("metadata-token")
    );

    let _ = std::fs::remove_file(store_path);
}

#[test]
fn auth_token_ignores_metadata_fallback_when_keychain_read_fails() {
    let store_path = test_store_path("auth-token-keychain-read-ignore-fallback");
    let config = RuntimeConfig {
        auth_token_storage: AuthTokenStorage::KeyringWithMemoryFallback,
        auth_keychain: Some(TestAuthKeychain::with_failures(None, true, false, false)),
        ..RuntimeConfig::default().with_run_store_path(&store_path)
    };
    let mut runtime = AppRuntime::try_new(config).expect("runtime should start");

    runtime
        .set_metadata_value("auth_token", "metadata-token")
        .expect("metadata token should persist");

    assert_eq!(
        runtime
            .auth_token()
            .expect("auth token should read")
            .as_deref(),
        None
    );

    let _ = std::fs::remove_file(store_path);
}

#[test]
fn auth_token_stays_in_memory_when_keychain_replacement_fails() {
    let store_path = test_store_path("auth-token-keychain-delete-fallback");
    let config = RuntimeConfig {
        auth_token_storage: AuthTokenStorage::KeyringWithMemoryFallback,
        auth_keychain: Some(TestAuthKeychain::with_failures(None, false, true, true)),
        ..RuntimeConfig::default().with_run_store_path(&store_path)
    };
    let mut runtime = AppRuntime::try_new(config).expect("runtime should start");

    runtime.set_auth_token(Some("fallback-token")).unwrap();
    assert_eq!(
        runtime
            .auth_token()
            .expect("auth token should read")
            .as_deref(),
        Some("fallback-token")
    );
    assert_ne!(
        runtime
            .metadata_value("auth_token")
            .expect("metadata should read")
            .as_deref(),
        Some("fallback-token")
    );
    assert_store_file_does_not_contain_auth_token(&store_path, "fallback-token");

    let _ = std::fs::remove_file(store_path);
}

#[test]
fn auth_token_stays_in_memory_when_keychain_readback_fails() {
    let store_path = test_store_path("auth-token-keychain-readback-fallback");
    let config = RuntimeConfig {
        auth_token_storage: AuthTokenStorage::KeyringWithMemoryFallback,
        auth_keychain: Some(TestAuthKeychain::with_failures(None, true, false, false)),
        ..RuntimeConfig::default().with_run_store_path(&store_path)
    };
    let mut runtime = AppRuntime::try_new(config).expect("runtime should start");

    runtime.set_auth_token(Some("fallback-token")).unwrap();
    assert_eq!(
        runtime
            .auth_token()
            .expect("auth token should read")
            .as_deref(),
        Some("fallback-token")
    );
    assert_ne!(
        runtime
            .metadata_value("auth_token")
            .expect("metadata should read")
            .as_deref(),
        Some("fallback-token")
    );
    assert_store_file_does_not_contain_auth_token(&store_path, "fallback-token");

    let _ = std::fs::remove_file(store_path);
}

#[test]
fn auth_logout_reports_keychain_delete_failure_and_keeps_runtime_authenticated() {
    let store_path = test_store_path("auth-token-keychain-logout-delete-failure");
    let config = RuntimeConfig {
        auth_token_storage: AuthTokenStorage::KeyringWithMemoryFallback,
        auth_keychain: Some(TestAuthKeychain::with_failures(
            Some("persisted-token"),
            false,
            false,
            true,
        )),
        ..RuntimeConfig::default().with_run_store_path(&store_path)
    };
    let mut runtime = AppRuntime::try_new(config.clone()).expect("runtime should start");

    let error = runtime
        .auth_logout()
        .expect_err("failed keychain deletion should fail logout");
    assert!(error
        .message
        .contains("failed to delete desktop auth token"));
    assert_eq!(
        runtime
            .auth_token()
            .expect("auth token should remain readable")
            .as_deref(),
        Some("persisted-token")
    );
    drop(runtime);

    let restarted = AppRuntime::try_new(config).expect("runtime should restart");
    assert_eq!(
        restarted
            .auth_token()
            .expect("persisted token should still be readable")
            .as_deref(),
        Some("persisted-token")
    );

    let _ = std::fs::remove_file(store_path);
}

fn assert_store_file_does_not_contain_auth_token(store_path: &std::path::Path, token: &str) {
    let bytes = std::fs::read(store_path).unwrap_or_default();
    assert!(
        !bytes
            .windows(token.len())
            .any(|window| window == token.as_bytes()),
        "SQLite metadata store should not contain auth token bytes"
    );
}
