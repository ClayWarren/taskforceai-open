use super::super::support::{
    json_response, result_value, start_recording_response_sequence_server,
    start_response_sequence_server, submit_run_params, test_store_path, MockHttpResponse,
};
use super::super::*;

#[test]
fn sync_status_reads_metadata() {
    let store_path = test_store_path("sync-status");
    let config = RuntimeConfig::default().with_run_store_path(&store_path);
    let mut runtime = AppRuntime::try_new(config).expect("runtime should start");
    runtime
        .metadata_set(MetadataSetParams {
            key: "device_id".to_string(),
            value: "device-sync".to_string(),
        })
        .expect("set device");
    runtime
        .metadata_set(MetadataSetParams {
            key: "last_sync_version".to_string(),
            value: "42".to_string(),
        })
        .expect("set sync version");

    let status = result_value(runtime.sync_status().expect("sync status should work"));

    assert_eq!(status["deviceId"], "device-sync");
    assert_eq!(status["lastSyncVersion"], 42);
    assert_eq!(status["configured"], true);

    let _ = std::fs::remove_file(store_path);
}

#[test]
fn sync_status_self_heals_corrupt_last_sync_version() {
    let store_path = test_store_path("sync-status-corrupt");
    let config = RuntimeConfig::default().with_run_store_path(&store_path);
    let mut runtime = AppRuntime::try_new(config).expect("runtime should start");
    runtime
        .metadata_set(MetadataSetParams {
            key: "last_sync_version".to_string(),
            value: "not-a-number".to_string(),
        })
        .expect("set corrupt sync version");

    let status = result_value(runtime.sync_status().expect("sync status should self-heal"));

    assert_eq!(status["lastSyncVersion"], 0);
    let _ = std::fs::remove_file(store_path);
}

#[test]
fn sync_configure_and_ensure_device_manage_shared_sync_metadata() {
    let store_path = test_store_path("sync-configure");
    let config = RuntimeConfig::default().with_run_store_path(&store_path);
    let mut runtime = AppRuntime::try_new(config).expect("runtime should start");

    let ensured = result_value(
        runtime
            .sync_ensure_device()
            .expect("device id should be ensured"),
    );
    assert_eq!(ensured["generated"], true);
    assert!(ensured["deviceId"]
        .as_str()
        .expect("device id should be string")
        .starts_with("taskforce-"));

    let configured = result_value(
        runtime
            .sync_configure(SyncConfigureParams {
                device_id: Some("desktop-device".to_string()),
                last_sync_version: Some(12),
            })
            .expect("sync metadata should configure"),
    );
    assert_eq!(configured["deviceId"], "desktop-device");
    assert_eq!(configured["lastSyncVersion"], 12);

    let ensured = result_value(
        runtime
            .sync_ensure_device()
            .expect("existing device id should be reused"),
    );
    assert_eq!(ensured["deviceId"], "desktop-device");
    assert_eq!(ensured["generated"], false);

    let _ = std::fs::remove_file(store_path);
}

#[test]
fn sync_configure_rejects_empty_device_and_negative_versions() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());

    let empty_device = runtime
        .sync_configure(SyncConfigureParams {
            device_id: Some("   ".to_string()),
            last_sync_version: None,
        })
        .expect_err("empty device id should be invalid");
    assert_eq!(empty_device.message, "deviceId cannot be empty");

    let negative_version = runtime
        .sync_configure(SyncConfigureParams {
            device_id: None,
            last_sync_version: Some(-1),
        })
        .expect_err("negative sync versions should be invalid");
    assert_eq!(
        negative_version.message,
        "lastSyncVersion cannot be negative"
    );
}

#[tokio::test]
async fn sync_push_and_pull_round_trip_local_conversations_and_messages() {
    let store_path = test_store_path("sync-push-pull");
    let config = RuntimeConfig::default().with_run_store_path(&store_path);
    let mut runtime = AppRuntime::try_new(config).expect("runtime should start");

    let pushed = result_value(
        runtime
            .sync_push(SyncPushParams {
                conversations: vec![ConversationRecord {
                    conversation_id: "conv-sync".to_string(),
                    title: "Synced conversation".to_string(),
                    created_at: 1,
                    updated_at: 2,
                    last_message_preview: Some("hello".to_string()),
                    ..ConversationRecord::default()
                }],
                messages: vec![MessageRecord {
                    message_id: "msg-sync".to_string(),
                    conversation_id: "conv-sync".to_string(),
                    role: "user".to_string(),
                    content: "hello".to_string(),
                    created_at: 1,
                    updated_at: 1,
                    ..MessageRecord::default()
                }],
                deletions: Vec::new(),
                new_version: Some(5),
            })
            .await
            .expect("sync push should work"),
    );

    assert_eq!(pushed["accepted"].as_array().expect("accepted").len(), 2);
    assert_eq!(pushed["newVersion"], 5);

    let pulled = result_value(
        runtime
            .sync_pull(SyncPullParams { limit: Some(10) })
            .await
            .expect("sync pull should work"),
    );
    assert_eq!(pulled["latestVersion"], 5);
    assert_eq!(pulled["conversations"][0]["conversationId"], "conv-sync");
    assert_eq!(pulled["messages"][0]["messageId"], "msg-sync");

    let _ = std::fs::remove_file(store_path);
}

#[tokio::test]
async fn local_sync_push_variants_apply_deletions_before_advancing_the_cursor() {
    let store_path = test_store_path("sync-local-deletions");
    let config = RuntimeConfig::default().with_run_store_path(&store_path);
    let mut runtime = AppRuntime::try_new(config).expect("runtime should start");

    for conversation_id in ["sync-delete", "desktop-delete"] {
        runtime
            .conversation_upsert(ConversationRecord {
                conversation_id: conversation_id.to_string(),
                title: "Delete me".to_string(),
                created_at: 1,
                updated_at: 1,
                ..ConversationRecord::default()
            })
            .expect("conversation should persist");
    }

    runtime
        .sync_push(SyncPushParams {
            conversations: Vec::new(),
            messages: Vec::new(),
            deletions: vec![json!({ "type": "conversation", "id": "sync-delete" })],
            new_version: Some(1),
        })
        .await
        .expect("local sync deletion should succeed");
    assert!(result_value(
        runtime
            .conversation_get(ConversationIDParams {
                conversation_id: "sync-delete".to_string(),
            })
            .expect("deleted conversation lookup should succeed")
    )["conversation"]
        .is_null());

    runtime
        .desktop_sync_push(DesktopSyncPushParams {
            device_id: "desktop-device".to_string(),
            conversations: Vec::new(),
            messages: Vec::new(),
            deletions: vec![json!({
                "type": "conversation",
                "id": "desktop-delete"
            })],
        })
        .await
        .expect("desktop sync deletion should succeed");
    assert!(result_value(
        runtime
            .conversation_get(ConversationIDParams {
                conversation_id: "desktop-delete".to_string(),
            })
            .expect("deleted desktop conversation lookup should succeed")
    )["conversation"]
        .is_null());

    let _ = std::fs::remove_file(store_path);
}

#[tokio::test]
async fn sync_push_rejects_missing_store_and_stale_versions() {
    let mut unconfigured = AppRuntime::new(RuntimeConfig::default());
    let missing_store = unconfigured
        .sync_push(SyncPushParams {
            conversations: Vec::new(),
            messages: Vec::new(),
            deletions: Vec::new(),
            new_version: None,
        })
        .await
        .expect_err("local sync push requires a store");
    assert!(missing_store
        .message
        .contains("sync.push requires a configured run store"));

    let store_path = test_store_path("sync-stale-version");
    let config = RuntimeConfig::default().with_run_store_path(&store_path);
    let mut runtime = AppRuntime::try_new(config).expect("runtime should start");
    runtime
        .sync_configure(SyncConfigureParams {
            device_id: None,
            last_sync_version: Some(5),
        })
        .expect("version should configure");
    let stale = runtime
        .sync_push(SyncPushParams {
            conversations: vec![ConversationRecord {
                conversation_id: "stale-conv".to_string(),
                title: "Stale write".to_string(),
                created_at: 1,
                updated_at: 1,
                ..ConversationRecord::default()
            }],
            messages: Vec::new(),
            deletions: Vec::new(),
            new_version: Some(4),
        })
        .await
        .expect_err("stale sync version should be rejected");
    assert_eq!(
        stale.message,
        "newVersion cannot be lower than the current sync version"
    );
    let conversations = result_value(
        runtime
            .conversation_list(ConversationListParams { limit: 10 })
            .expect("conversation list should work"),
    );
    assert!(
        conversations["conversations"]
            .as_array()
            .expect("conversations should be an array")
            .is_empty(),
        "stale sync push should not commit records: {conversations}"
    );

    let _ = std::fs::remove_file(store_path);
}

#[tokio::test]
async fn remote_sync_pull_persists_records_and_cursor() {
    let store_path = test_store_path("remote-sync-pull");
    let response = json!({
        "conversations": [{
            "localId": "remote-conv",
            "userInput": "Remote conversation",
            "result": "hello",
            "timestamp": "10",
            "updatedAt": "20",
            "syncVersion": 7
        }],
        "messages": [{
            "messageId": "remote-msg",
            "conversationLocalId": "remote-conv",
            "role": "assistant",
            "content": "hello",
            "createdAt": "11",
            "updatedAt": "21",
            "syncVersion": 7
        }],
        "deletions": [],
        "latestVersion": 7
    })
    .to_string();
    let (base_url, server) = start_response_sequence_server(vec![
        MockHttpResponse {
            body: json!({ "csrfToken": "test-csrf" }).to_string(),
            headers: vec![("Set-Cookie", "csrf_token=test-csrf; Path=/")],
        },
        json_response(response),
    ]);
    let config = RuntimeConfig {
        api_base_url: base_url,
        remote_sync: true,
        ..RuntimeConfig::default().with_run_store_path(&store_path)
    };
    let mut runtime = AppRuntime::try_new(config.clone()).expect("runtime should start");
    runtime
        .metadata_set(MetadataSetParams {
            key: "auth_token".to_string(),
            value: "token".to_string(),
        })
        .expect("auth token should persist");
    runtime
        .sync_configure(SyncConfigureParams {
            device_id: Some("device-1".to_string()),
            last_sync_version: Some(0),
        })
        .expect("sync metadata should configure");

    let pulled = result_value(
        runtime
            .sync_pull(SyncPullParams { limit: Some(50) })
            .await
            .expect("remote sync pull should work"),
    );
    assert_eq!(pulled["latestVersion"], 7);
    assert_eq!(pulled["conversations"][0]["conversationId"], "remote-conv");
    assert_eq!(pulled["messages"][0]["messageId"], "remote-msg");
    server.join().expect("mock sync server should exit");

    let runtime = AppRuntime::try_new(config).expect("runtime should reload pulled state");
    let status = result_value(runtime.sync_status().expect("sync status should work"));
    assert_eq!(status["lastSyncVersion"], 7);
    let conversations = result_value(
        runtime
            .conversation_list(ConversationListParams { limit: 10 })
            .expect("conversation list should work"),
    );
    assert_eq!(
        conversations["conversations"][0]["conversationId"],
        "remote-conv"
    );
    let messages = result_value(
        runtime
            .message_list(ConversationIDParams {
                conversation_id: "remote-conv".to_string(),
            })
            .expect("message list should work"),
    );
    assert_eq!(messages["messages"][0]["messageId"], "remote-msg");

    let _ = std::fs::remove_file(store_path);
}

#[tokio::test]
async fn desktop_sync_push_and_pull_round_trip_local_records() {
    let store_path = test_store_path("desktop-sync-local");
    let config = RuntimeConfig::default().with_run_store_path(&store_path);
    let mut runtime = AppRuntime::try_new(config).expect("runtime should start");

    let pushed = result_value(
        runtime
            .desktop_sync_push(DesktopSyncPushParams {
                device_id: "desktop-device".to_string(),
                conversations: vec![json!({
                    "local_id": "desktop-conv",
                    "user_input": "Desktop conversation",
                    "result": "hello",
                    "timestamp": "10",
                    "updated_at": "20",
                    "sync_version": 1,
                    "device_id": "desktop-device"
                })],
                messages: vec![json!({
                    "message_id": "desktop-msg",
                    "conversation_local_id": "desktop-conv",
                    "role": "user",
                    "content": "hello",
                    "created_at": "11",
                    "updated_at": "21",
                    "sync_version": 1,
                    "device_id": "desktop-device"
                })],
                deletions: Vec::new(),
            })
            .await
            .expect("desktop sync push should work"),
    );
    assert_eq!(pushed["accepted"][0], "desktop-conv");
    assert_eq!(pushed["accepted"][1], "desktop-msg");
    assert_eq!(pushed["new_version"], 1);
    assert_eq!(pushed["conversation_id_mappings"], json!({}));

    let pulled = result_value(
        runtime
            .desktop_sync_pull(DesktopSyncPullParams {
                device_id: "desktop-device".to_string(),
                last_sync_version: 0,
                limit: Some(10),
            })
            .await
            .expect("desktop sync pull should work"),
    );
    assert_eq!(pulled["latest_version"], 1);
    assert_eq!(pulled["conversations"][0]["local_id"], "desktop-conv");
    assert_eq!(pulled["messages"][0]["message_id"], "desktop-msg");
    assert_eq!(pulled["deletions"].as_array().expect("deletions").len(), 0);

    let _ = std::fs::remove_file(store_path);
}

#[tokio::test]
async fn sync_push_without_records_snapshots_local_conversations() {
    let store_path = test_store_path("sync-push-snapshot");
    let config = RuntimeConfig::default().with_run_store_path(&store_path);
    let mut runtime = AppRuntime::try_new(config).expect("runtime should start");
    runtime
        .run_submit(submit_run_params("snapshot this local thread"))
        .await
        .expect("submit should persist a conversation");

    let pushed = result_value(
        runtime
            .sync_push(SyncPushParams {
                conversations: Vec::new(),
                messages: Vec::new(),
                deletions: Vec::new(),
                new_version: Some(7),
            })
            .await
            .expect("empty sync push should snapshot local records"),
    );

    assert_eq!(pushed["newVersion"], 7);
    let accepted = pushed["accepted"].as_array().expect("accepted ids");
    assert!(accepted.iter().any(|id| id == "local_run_1"));
    assert!(accepted.iter().any(|id| id == "local_run_1_user"));

    let _ = std::fs::remove_file(store_path);
}

#[tokio::test]
async fn remote_desktop_sync_pull_and_push_use_hosted_sync_routes() {
    let store_path = test_store_path("desktop-sync-remote");
    let (base_url, server, requests) = start_recording_response_sequence_server(vec![
        MockHttpResponse {
            body: json!({ "csrfToken": "test-csrf" }).to_string(),
            headers: vec![("Set-Cookie", "csrf_token=test-csrf; Path=/")],
        },
        json_response(
            json!({
                "conversations": [{
                    "localId": "remote-desktop-conv",
                    "userInput": "Remote desktop conversation",
                    "result": "hello",
                    "timestamp": "10",
                    "updatedAt": "20",
                    "syncVersion": 4
                }],
                "messages": [{
                    "messageId": "remote-desktop-msg",
                    "conversationLocalId": "remote-desktop-conv",
                    "role": "assistant",
                    "content": "hello",
                    "createdAt": "11",
                    "updatedAt": "21",
                    "syncVersion": 4
                }],
                "deletions": [{ "type": "message", "id": "deleted-msg" }],
                "latestVersion": 4
            })
            .to_string(),
        ),
        MockHttpResponse {
            body: json!({ "csrfToken": "test-csrf" }).to_string(),
            headers: vec![("Set-Cookie", "csrf_token=test-csrf; Path=/")],
        },
        json_response(
            json!({
                "accepted": ["remote-desktop-conv"],
                "conflicts": [{ "id": "conflict-1" }],
                "newVersion": 5
            })
            .to_string(),
        ),
    ]);
    let config = RuntimeConfig {
        api_base_url: base_url,
        remote_sync: true,
        ..RuntimeConfig::default().with_run_store_path(&store_path)
    };
    let mut runtime = AppRuntime::try_new(config).expect("runtime should start");
    runtime
        .metadata_set(MetadataSetParams {
            key: "auth_token".to_string(),
            value: "token".to_string(),
        })
        .expect("auth token should persist");

    let pulled = result_value(
        runtime
            .desktop_sync_pull(DesktopSyncPullParams {
                device_id: "desktop-device".to_string(),
                last_sync_version: 3,
                limit: Some(25),
            })
            .await
            .expect("remote desktop pull should work"),
    );
    assert_eq!(pulled["latest_version"], 4);
    assert_eq!(pulled["conversations"][0]["localId"], "remote-desktop-conv");
    assert_eq!(pulled["messages"][0]["messageId"], "remote-desktop-msg");
    assert_eq!(pulled["deletions"][0]["id"], "deleted-msg");

    let pushed = result_value(
        runtime
            .desktop_sync_push(DesktopSyncPushParams {
                device_id: "desktop-device".to_string(),
                conversations: vec![json!({ "localId": "remote-desktop-conv" })],
                messages: Vec::new(),
                deletions: Vec::new(),
            })
            .await
            .expect("remote desktop push should work"),
    );
    assert_eq!(pushed["accepted"][0], "remote-desktop-conv");
    assert_eq!(pushed["conflicts"][0]["id"], "conflict-1");
    assert_eq!(pushed["new_version"], 5);
    assert_eq!(pushed["conversation_id_mappings"], json!({}));
    assert_eq!(
        result_value(runtime.sync_status().expect("sync status should work"))["lastSyncVersion"],
        5
    );

    server.join().expect("mock desktop sync server should exit");
    let requests = requests.lock().expect("requests should be recorded");
    assert_eq!(requests[1].path, "/api/v1/sync/pull");
    let pull_body: Value = serde_json::from_str(&requests[1].body).expect("pull body should parse");
    assert_eq!(pull_body["deviceId"], "desktop-device");
    assert_eq!(pull_body["lastSyncVersion"], 3);
    assert_eq!(pull_body["limit"], 25);
    assert_eq!(requests[3].path, "/api/v1/sync/push");
    let push_body: Value = serde_json::from_str(&requests[3].body).expect("push body should parse");
    assert_eq!(push_body["deviceId"], "desktop-device");
    assert_eq!(
        push_body["conversations"][0]["localId"],
        "remote-desktop-conv"
    );

    let _ = std::fs::remove_file(store_path);
}

#[tokio::test]
async fn remote_sync_push_sends_local_records_and_updates_cursor() {
    let store_path = test_store_path("remote-sync-push");
    let (base_url, server, requests) = start_recording_response_sequence_server(vec![
        MockHttpResponse {
            body: json!({ "csrfToken": "test-csrf" }).to_string(),
            headers: vec![("Set-Cookie", "csrf_token=test-csrf; Path=/")],
        },
        json_response(
            json!({
                "accepted": ["remote-conv", "remote-msg"],
                "conflicts": [],
                "newVersion": 9
            })
            .to_string(),
        ),
    ]);
    let config = RuntimeConfig {
        api_base_url: base_url,
        remote_sync: true,
        ..RuntimeConfig::default().with_run_store_path(&store_path)
    };
    let mut runtime = AppRuntime::try_new(config).expect("runtime should start");
    runtime
        .metadata_set(MetadataSetParams {
            key: "auth_token".to_string(),
            value: "token".to_string(),
        })
        .expect("auth token should persist");

    let pushed = result_value(
        runtime
            .sync_push(SyncPushParams {
                conversations: vec![ConversationRecord {
                    conversation_id: "remote-conv".to_string(),
                    title: "Remote conversation".to_string(),
                    created_at: 1,
                    updated_at: 2,
                    last_message_preview: Some("hello".to_string()),
                    ..ConversationRecord::default()
                }],
                messages: vec![MessageRecord {
                    message_id: "remote-msg".to_string(),
                    conversation_id: "remote-conv".to_string(),
                    role: "user".to_string(),
                    content: "hello".to_string(),
                    created_at: 1,
                    updated_at: 2,
                    ..MessageRecord::default()
                }],
                deletions: vec![json!({ "type": "message", "id": "deleted-msg" })],
                new_version: None,
            })
            .await
            .expect("remote sync push should work"),
    );

    assert_eq!(pushed["newVersion"], 9);
    assert_eq!(
        result_value(runtime.sync_status().expect("sync status should work"))["lastSyncVersion"],
        9
    );
    server.join().expect("mock sync server should exit");
    let requests = requests.lock().expect("requests should be recorded");
    assert_eq!(requests[1].path, "/api/v1/sync/push");
    assert_eq!(
        requests[1].headers.get("authorization").map(String::as_str),
        Some("Bearer token")
    );
    let body: Value = serde_json::from_str(&requests[1].body).expect("push body should be json");
    assert!(body["deviceId"]
        .as_str()
        .expect("device id should be generated")
        .starts_with("taskforce-"));
    assert_eq!(body["conversations"][0]["localId"], "remote-conv");
    assert_eq!(body["messages"][0]["messageId"], "remote-msg");
    assert_eq!(body["deletions"][0]["id"], "deleted-msg");

    let _ = std::fs::remove_file(store_path);
}

#[tokio::test]
async fn remote_realtime_poll_detects_sync_updates_and_preserves_cursor() {
    let (base_url, server, requests) = start_recording_response_sequence_server(vec![
        json_response(
            json!({
                "messages": [{ "type": "message_created" }],
                "lastId": "evt-2"
            })
            .to_string(),
        ),
        json_response(
            json!({
                "messages": [{ "type": "presence" }],
                "lastId": ""
            })
            .to_string(),
        ),
    ]);
    let mut runtime = AppRuntime::new(RuntimeConfig {
        api_base_url: base_url,
        remote_sync: true,
        ..RuntimeConfig::default()
    });
    runtime
        .metadata_set(MetadataSetParams {
            key: "auth_token".to_string(),
            value: "token".to_string(),
        })
        .expect("auth token should persist");

    let updated = result_value(
        runtime
            .sync_realtime_poll(SyncRealtimePollParams {
                last_event_id: Some("evt-1".to_string()),
            })
            .await
            .expect("realtime poll should work"),
    );
    assert_eq!(updated["hasUpdates"], true);
    assert_eq!(updated["lastEventId"], "evt-2");
    let quiet = result_value(
        runtime
            .sync_realtime_poll(SyncRealtimePollParams {
                last_event_id: Some("evt-2".to_string()),
            })
            .await
            .expect("second realtime poll should work"),
    );
    assert_eq!(quiet["hasUpdates"], false);
    assert_eq!(quiet["lastEventId"], "evt-2");
    server.join().expect("mock realtime server should exit");
    let requests = requests.lock().expect("requests should be recorded");
    assert_eq!(requests[0].method, "GET");
    assert_eq!(requests[0].path, "/sync/realtime?last_id=evt-1");
    assert_eq!(requests[1].path, "/sync/realtime?last_id=evt-2");
}
