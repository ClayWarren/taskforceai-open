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
