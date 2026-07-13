use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::Duration;

use taskforceai_app_client::{AppServerClient, AppServerSpawnOptions};
use taskforceai_app_protocol::{
    AppServerEvent, ConversationIDParams, ConversationListParams, ConversationRecord,
    ConversationReplaceIDParams, DeviceLoginPollParams, McpServerAddParams, McpServerParams,
    MessageIDParams, MessageRecord, MetadataGetParams, MetadataSetParams, ModelSelectParams,
    PendingChangeIDParams, PendingChangeRecord, PendingChangeUpdateDataParams,
    PendingPromptIDParams, PendingPromptRecord, PendingPromptStatus, PromptQueueIDParams,
    PromptQueueRecord, RunIDParams, RunStatus, SubmitRunParams, SyncConfigureParams,
    SyncPullParams, SyncPushParams,
};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpListener;
use tokio::process::Command as TokioCommand;
use tokio::sync::Mutex;

static INTEGRATION_TEST_LOCK: Mutex<()> = Mutex::const_new(());

fn app_server_binary() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../../apps/app-server/target/debug/taskforceai-app-server")
}

#[tokio::test]
async fn client_spawns_app_server_and_receives_run_event() {
    let _guard = INTEGRATION_TEST_LOCK.lock().await;
    let binary = app_server_binary();
    let store_path = test_store_path();
    let api_base_url = spawn_api_server().await;

    let status = Command::new("cargo")
        .arg("build")
        .current_dir(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../../apps/app-server"))
        .status()
        .expect("cargo build should start");
    assert!(status.success(), "app-server build failed");

    let mut client = AppServerClient::spawn_with_options(
        &binary,
        AppServerSpawnOptions {
            run_store_path: Some(store_path.clone()),
            api_base_url: Some(api_base_url.clone()),
            inherit_stderr: false,
        },
    )
    .await
    .expect("client should spawn app-server");
    let initialized = client.initialize().await.expect("initialize should work");
    assert_eq!(initialized.transport.kind, "stdio");

    let api_health = client.api_health().await.expect("api.health should work");
    assert!(api_health.healthy);
    assert_eq!(api_health.status, 200);
    assert_eq!(api_health.base_url, api_base_url);

    let login = client
        .auth_device_start()
        .await
        .expect("device login should start");
    assert_eq!(login.user_code, "ABCD-1234");
    let poll = client
        .auth_device_poll(DeviceLoginPollParams {
            device_code: login.device_code,
        })
        .await
        .expect("device login should poll");
    assert_eq!(poll.status, "approved");

    let submitted = client
        .run_submit(SubmitRunParams {
            prompt: "integration run".to_string(),
            model_id: None,
            reasoning_effort: None,
            quick_mode: None,
            autonomous: None,
            computer_use: None,
            computer_use_target: None,
            use_logged_in_services: None,
            agent_count: None,
            project_id: None,
            attachment_ids: Vec::new(),
            client_mcp_tools: Vec::new(),
            research_workflow: None,
            private_chat: false,
        })
        .await
        .expect("run.submit should work");
    assert_eq!(submitted.run.id, "remote_task_1");

    let event = tokio::time::timeout(Duration::from_secs(2), client.next_event())
        .await
        .expect("event should arrive")
        .expect("event stream should not error")
        .expect("event stream should be open");
    match event {
        AppServerEvent::RunUpdated { run } => assert_eq!(run.id, "remote_task_1"),
        AppServerEvent::RunDeleted { run_id } => panic!("unexpected delete event for {run_id}"),
        AppServerEvent::TurnStarted { .. } => panic!("unexpected turn started event"),
        AppServerEvent::TurnInterrupted { .. } => panic!("unexpected turn interrupted event"),
        AppServerEvent::TurnUpdated { .. }
        | AppServerEvent::TurnCompleted { .. }
        | AppServerEvent::ItemStarted { .. }
        | AppServerEvent::ItemUpdated { .. }
        | AppServerEvent::ItemCompleted { .. }
        | AppServerEvent::ThreadUpdated { .. }
        | AppServerEvent::WorkflowRunUpdated { .. }
        | AppServerEvent::ServerRequest { .. } => {
            panic!("unexpected typed lifecycle, workflow, or interaction event")
        }
    }

    let event = tokio::time::timeout(Duration::from_secs(2), client.next_event())
        .await
        .expect("processing event should arrive")
        .expect("event stream should not error")
        .expect("event stream should be open");
    match event {
        AppServerEvent::RunUpdated { run } => {
            assert_eq!(run.status, RunStatus::Processing);
            assert_eq!(run.output.as_deref(), Some("streamed chunk"));
            assert_eq!(run.sources.len(), 1);
            assert_eq!(run.tool_events.len(), 1);
        }
        AppServerEvent::RunDeleted { run_id } => panic!("unexpected delete event for {run_id}"),
        AppServerEvent::TurnStarted { .. } => panic!("unexpected turn started event"),
        AppServerEvent::TurnInterrupted { .. } => panic!("unexpected turn interrupted event"),
        AppServerEvent::TurnUpdated { .. }
        | AppServerEvent::TurnCompleted { .. }
        | AppServerEvent::ItemStarted { .. }
        | AppServerEvent::ItemUpdated { .. }
        | AppServerEvent::ItemCompleted { .. }
        | AppServerEvent::ThreadUpdated { .. }
        | AppServerEvent::WorkflowRunUpdated { .. }
        | AppServerEvent::ServerRequest { .. } => {
            panic!("unexpected typed lifecycle, workflow, or interaction event")
        }
    }

    let event = tokio::time::timeout(Duration::from_secs(2), client.next_event())
        .await
        .expect("completed event should arrive")
        .expect("event stream should not error")
        .expect("event stream should be open");
    match event {
        AppServerEvent::RunUpdated { run } => {
            assert_eq!(run.status, RunStatus::Completed);
            assert_eq!(run.output.as_deref(), Some("remote done"));
            assert_eq!(run.sources.len(), 2);
            assert_eq!(run.tool_events.len(), 2);
            assert_eq!(run.agent_statuses[0]["status"], "completed");
        }
        AppServerEvent::RunDeleted { run_id } => panic!("unexpected delete event for {run_id}"),
        AppServerEvent::TurnStarted { .. } => panic!("unexpected turn started event"),
        AppServerEvent::TurnInterrupted { .. } => panic!("unexpected turn interrupted event"),
        AppServerEvent::TurnUpdated { .. }
        | AppServerEvent::TurnCompleted { .. }
        | AppServerEvent::ItemStarted { .. }
        | AppServerEvent::ItemUpdated { .. }
        | AppServerEvent::ItemCompleted { .. }
        | AppServerEvent::ThreadUpdated { .. }
        | AppServerEvent::WorkflowRunUpdated { .. }
        | AppServerEvent::ServerRequest { .. } => {
            panic!("unexpected typed lifecycle, workflow, or interaction event")
        }
    }

    let status = client
        .run_status(RunIDParams {
            run_id: "remote_task_1".to_string(),
        })
        .await
        .expect("run.status should work");
    assert_eq!(status.run.status, RunStatus::Completed);

    let conversations = client
        .conversation_list(ConversationListParams { limit: 10 })
        .await
        .expect("conversation.list should work");
    assert_eq!(conversations.conversations.len(), 1);
    assert_eq!(
        conversations.conversations[0].conversation_id,
        "remote_task_1"
    );

    let messages = client
        .message_list(ConversationIDParams {
            conversation_id: "remote_task_1".to_string(),
        })
        .await
        .expect("message.list should work");
    assert_eq!(messages.messages.len(), 2);
    assert_eq!(messages.messages[0].role, "user");
    assert_eq!(messages.messages[1].role, "assistant");

    let written_conversation = client
        .conversation_upsert(ConversationRecord {
            conversation_id: "conv-client-manual".to_string(),
            title: "Client manual".to_string(),
            created_at: 3,
            updated_at: 4,
            last_message_preview: Some("manual".to_string()),
            ..ConversationRecord::default()
        })
        .await
        .expect("conversation.upsert should work");
    assert_eq!(
        written_conversation
            .conversation
            .expect("conversation should be returned")
            .conversation_id,
        "conv-client-manual"
    );
    let fetched_conversation = client
        .conversation_get(ConversationIDParams {
            conversation_id: "conv-client-manual".to_string(),
        })
        .await
        .expect("conversation.get should work");
    assert_eq!(
        fetched_conversation
            .conversation
            .expect("conversation should persist")
            .title,
        "Client manual"
    );

    let written_message = client
        .message_upsert(MessageRecord {
            message_id: "msg-client-manual".to_string(),
            conversation_id: "conv-client-manual".to_string(),
            role: "assistant".to_string(),
            content: "manual response".to_string(),
            created_at: 5,
            updated_at: 6,
            ..MessageRecord::default()
        })
        .await
        .expect("message.upsert should work");
    assert_eq!(
        written_message
            .message
            .expect("message should be returned")
            .message_id,
        "msg-client-manual"
    );
    let fetched_message = client
        .message_get(MessageIDParams {
            message_id: "msg-client-manual".to_string(),
        })
        .await
        .expect("message.get should work");
    assert_eq!(
        fetched_message
            .message
            .expect("message should persist")
            .content,
        "manual response"
    );
    client
        .conversation_replace_id(ConversationReplaceIDParams {
            old_conversation_id: "conv-client-manual".to_string(),
            new_conversation_id: "conv-client-renamed".to_string(),
        })
        .await
        .expect("conversation.replaceId should work");
    assert!(client
        .conversation_get(ConversationIDParams {
            conversation_id: "conv-client-manual".to_string(),
        })
        .await
        .expect("old conversation id lookup should work")
        .conversation
        .is_none());
    assert_eq!(
        client
            .message_get(MessageIDParams {
                message_id: "msg-client-manual".to_string(),
            })
            .await
            .expect("message.get after replace should work")
            .message
            .expect("message should remain")
            .conversation_id,
        "conv-client-renamed"
    );
    let pending_change = client
        .pending_change_add(PendingChangeRecord {
            id: None,
            change_type: "message".to_string(),
            entity_id: "msg-client-manual".to_string(),
            operation: "update".to_string(),
            data: serde_json::json!({"messageId": "msg-client-manual"}),
            created_at: 7,
        })
        .await
        .expect("pendingChange.add should work")
        .pending_change;
    let pending_change_id = pending_change.id.expect("pending change id should exist");
    client
        .pending_change_update_data(PendingChangeUpdateDataParams {
            id: pending_change_id,
            data: serde_json::json!({"messageId": "msg-client-manual", "synced": true}),
        })
        .await
        .expect("pendingChange.updateData should work");
    let pending_changes = client
        .pending_change_list()
        .await
        .expect("pendingChange.list should work");
    assert_eq!(pending_changes.pending_changes.len(), 1);
    assert_eq!(pending_changes.pending_changes[0].data["synced"], true);
    client
        .pending_change_delete(PendingChangeIDParams {
            id: pending_change_id,
        })
        .await
        .expect("pendingChange.delete should work");
    assert!(client
        .pending_change_list()
        .await
        .expect("pendingChange.list after delete should work")
        .pending_changes
        .is_empty());
    client
        .pending_change_clear()
        .await
        .expect("pendingChange.clear should work");
    let pending_prompt = client
        .pending_prompt_add(PendingPromptRecord {
            id: "pp-client-manual".to_string(),
            prompt: "retry from client".to_string(),
            model_id: Some("openai/gpt-5.6-sol".to_string()),
            reasoning_effort: Some("max".to_string()),
            project_id: Some(1),
            status: PendingPromptStatus::Queued,
            retry_count: 0,
            last_error: None,
            created_at: 7,
            updated_at: 7,
        })
        .await
        .expect("pendingPrompt.add should work")
        .prompt;
    assert_eq!(pending_prompt.id, "pp-client-manual");
    assert!(client
        .pending_prompt_list()
        .await
        .expect("pendingPrompt.list should work")
        .prompts
        .iter()
        .any(|prompt| prompt.id == "pp-client-manual"));
    client
        .pending_prompt_delete(PendingPromptIDParams {
            pending_prompt_id: "pp-client-manual".to_string(),
        })
        .await
        .expect("pendingPrompt.delete should work");
    let queued_prompt = client
        .prompt_queue_add(PromptQueueRecord {
            id: None,
            conversation_id: "conv-client-renamed".to_string(),
            prompt: "send after response".to_string(),
            status: "queued".to_string(),
            dispatch_timing: "after_response".to_string(),
            created_at: 8,
            updated_at: 8,
            model_id: Some("openai/gpt-5.6-sol".to_string()),
            reasoning_effort: Some("max".to_string()),
            attachment_ids: vec!["att-client".to_string()],
        })
        .await
        .expect("promptQueue.add should work")
        .queued_prompt;
    let queued_prompt_id = queued_prompt.id.expect("queue id should exist");
    assert_eq!(queued_prompt.dispatch_timing, "after_response");
    assert_eq!(queued_prompt.reasoning_effort.as_deref(), Some("max"));
    assert!(client
        .prompt_queue_list()
        .await
        .expect("promptQueue.list should work")
        .queued_prompts
        .iter()
        .any(|prompt| prompt.dispatch_timing == "after_response"));
    client
        .prompt_queue_delete(PromptQueueIDParams {
            id: queued_prompt_id,
        })
        .await
        .expect("promptQueue.delete should work");
    client
        .prompt_queue_clear()
        .await
        .expect("promptQueue.clear should work");
    client
        .metadata_clear_all()
        .await
        .expect("metadata.clearAll should work");
    assert!(client
        .conversation_get(ConversationIDParams {
            conversation_id: "conv-client-renamed".to_string(),
        })
        .await
        .expect("conversation.get after clear should work")
        .conversation
        .is_none());
    assert!(client
        .metadata_get(MetadataGetParams {
            key: "device_id".to_string(),
        })
        .await
        .expect("metadata.get after clear should work")
        .value
        .is_none());

    client
        .conversation_upsert(ConversationRecord {
            conversation_id: "conv-client-renamed".to_string(),
            title: "Client renamed".to_string(),
            created_at: 8,
            updated_at: 9,
            last_message_preview: Some("manual".to_string()),
            ..ConversationRecord::default()
        })
        .await
        .expect("conversation.upsert after clear should work");
    client
        .message_upsert(MessageRecord {
            message_id: "msg-client-manual".to_string(),
            conversation_id: "conv-client-renamed".to_string(),
            role: "assistant".to_string(),
            content: "manual response".to_string(),
            created_at: 9,
            updated_at: 9,
            ..MessageRecord::default()
        })
        .await
        .expect("message.upsert after clear should work");
    client
        .message_delete(MessageIDParams {
            message_id: "msg-client-manual".to_string(),
        })
        .await
        .expect("message.delete should work");
    assert!(client
        .message_get(MessageIDParams {
            message_id: "msg-client-manual".to_string(),
        })
        .await
        .expect("message.get after delete should work")
        .message
        .is_none());
    client
        .conversation_delete(ConversationIDParams {
            conversation_id: "conv-client-renamed".to_string(),
        })
        .await
        .expect("conversation.delete should work");
    assert!(client
        .conversation_get(ConversationIDParams {
            conversation_id: "conv-client-renamed".to_string(),
        })
        .await
        .expect("conversation.get after delete should work")
        .conversation
        .is_none());

    client
        .metadata_set(MetadataSetParams {
            key: "device_id".to_string(),
            value: "integration-device".to_string(),
        })
        .await
        .expect("metadata.set should work");
    let metadata = client
        .metadata_get(MetadataGetParams {
            key: "device_id".to_string(),
        })
        .await
        .expect("metadata.get should work");
    assert_eq!(metadata.value.as_deref(), Some("integration-device"));

    client
        .metadata_set(MetadataSetParams {
            key: "last_sync_version".to_string(),
            value: "9".to_string(),
        })
        .await
        .expect("metadata.set should work");
    let sync_status = client.sync_status().await.expect("sync.status should work");
    assert_eq!(sync_status.device_id.as_deref(), Some("integration-device"));
    assert_eq!(sync_status.last_sync_version, 9);
    assert!(sync_status.configured);

    let sync_device = client
        .sync_ensure_device()
        .await
        .expect("sync.ensureDevice should work");
    assert_eq!(sync_device.device_id, "integration-device");
    assert!(!sync_device.generated);

    let sync_status = client
        .sync_configure(SyncConfigureParams {
            device_id: Some("integration-device-2".to_string()),
            last_sync_version: Some(10),
        })
        .await
        .expect("sync.configure should work");
    assert_eq!(
        sync_status.device_id.as_deref(),
        Some("integration-device-2")
    );
    assert_eq!(sync_status.last_sync_version, 10);

    let pushed = client
        .sync_push(SyncPushParams {
            conversations: vec![ConversationRecord {
                conversation_id: "conv-client-sync".to_string(),
                title: "Client sync".to_string(),
                created_at: 1,
                updated_at: 2,
                last_message_preview: Some("synced".to_string()),
                ..ConversationRecord::default()
            }],
            messages: vec![MessageRecord {
                message_id: "msg-client-sync".to_string(),
                conversation_id: "conv-client-sync".to_string(),
                role: "user".to_string(),
                content: "synced".to_string(),
                created_at: 1,
                updated_at: 1,
                ..MessageRecord::default()
            }],
            deletions: Vec::new(),
            new_version: Some(11),
        })
        .await
        .expect("sync.push should work");
    assert_eq!(pushed.new_version, 11);
    assert_eq!(pushed.accepted.len(), 2);

    let pulled = client
        .sync_pull(SyncPullParams { limit: Some(20) })
        .await
        .expect("sync.pull should work");
    assert_eq!(pulled.latest_version, 11);
    assert!(pulled
        .conversations
        .iter()
        .any(|conversation| conversation.conversation_id == "conv-client-sync"));
    assert!(pulled
        .messages
        .iter()
        .any(|message| message.message_id == "msg-client-sync"));

    let models = client.model_list().await.expect("model.list should work");
    assert!(models.enabled);
    assert!(models.remote_catalog);
    assert_eq!(models.default_model_id, "model-remote");
    assert_eq!(models.options[0].usage_multiple, Some(1.5));
    let models = client
        .model_select(ModelSelectParams {
            model_id: "gpt-5".to_string(),
        })
        .await
        .expect("model.select should work");
    assert_eq!(models.selected_model_id.as_deref(), Some("gpt-5"));
    let models = client.model_reset().await.expect("model.reset should work");
    assert!(models.selected_model_id.is_none());

    client
        .mcp_add(McpServerAddParams {
            name: "events".to_string(),
            endpoint: "sse+https://example.com/events".to_string(),
            tools: vec!["subscribe".to_string()],
            enabled: true,
        })
        .await
        .expect("mcp.add should work");
    let inspected = client
        .mcp_inspect(McpServerParams {
            name: "events".to_string(),
        })
        .await
        .expect("mcp.inspect should work");
    assert_eq!(inspected.transport, "sse");
    assert!(inspected.command.is_none());
    assert!(inspected.args.is_empty());

    client.shutdown().await.expect("shutdown should work");
    let _ = std::fs::remove_file(store_path);
}

#[tokio::test]
async fn http_client_receives_app_server_events() {
    let _guard = INTEGRATION_TEST_LOCK.lock().await;
    let binary = app_server_binary();
    let store_path = test_store_path();
    let api_base_url = spawn_api_server().await;

    let status = Command::new("cargo")
        .arg("build")
        .current_dir(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../../apps/app-server"))
        .status()
        .expect("cargo build should start");
    assert!(status.success(), "app-server build failed");

    let mut child = TokioCommand::new(&binary)
        .arg("serve")
        .arg("--port")
        .arg("0")
        .arg("--pairing-code")
        .arg("pair-http-events")
        .env("TASKFORCE_APP_SERVER_RUN_STORE", &store_path)
        .env("TASKFORCE_APP_SERVER_API_BASE_URL", &api_base_url)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .expect("http app-server should start");
    let stderr = child.stderr.take().expect("stderr should be piped");
    let mut lines = BufReader::new(stderr).lines();
    let base_url = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let line = lines
                .next_line()
                .await
                .expect("startup stderr should be readable")
                .expect("startup stderr should contain base URL");
            let value: serde_json::Value =
                serde_json::from_str(&line).expect("startup log should be json");
            if let Some(base_url) = value.get("baseUrl").and_then(|value| value.as_str()) {
                break base_url.to_string();
            }
        }
    })
    .await
    .expect("http app-server should report its base URL");

    let paired: serde_json::Value = reqwest::Client::new()
        .get(format!("{base_url}/pairing"))
        .header("X-Taskforce-Pairing-Code", "pair-http-events")
        .send()
        .await
        .expect("pairing request should send")
        .error_for_status()
        .expect("pairing should succeed")
        .json()
        .await
        .expect("pairing response should decode");
    let session_token = paired["sessionToken"]
        .as_str()
        .expect("pairing should return session token");

    let mut client =
        AppServerClient::connect_http(base_url, session_token).expect("http client should connect");
    let initialized = client
        .initialize()
        .await
        .expect("http initialize should work");
    assert!(initialized.capabilities.runs);
    let submitted = client
        .run_submit(SubmitRunParams {
            prompt: "http integration run".to_string(),
            model_id: None,
            reasoning_effort: None,
            quick_mode: None,
            autonomous: None,
            computer_use: None,
            computer_use_target: None,
            use_logged_in_services: None,
            agent_count: None,
            project_id: None,
            attachment_ids: Vec::new(),
            client_mcp_tools: Vec::new(),
            research_workflow: None,
            private_chat: false,
        })
        .await
        .expect("http run.submit should work");

    let event = tokio::time::timeout(Duration::from_secs(2), client.next_event())
        .await
        .expect("http event should arrive")
        .expect("event stream should not error")
        .expect("http event stream should stay open");
    match event {
        AppServerEvent::RunUpdated { run } => assert_eq!(run.id, submitted.run.id),
        AppServerEvent::RunDeleted { run_id } => panic!("unexpected delete event for {run_id}"),
        AppServerEvent::TurnStarted { .. } => panic!("unexpected turn started event"),
        AppServerEvent::TurnInterrupted { .. } => panic!("unexpected turn interrupted event"),
        AppServerEvent::TurnUpdated { .. }
        | AppServerEvent::TurnCompleted { .. }
        | AppServerEvent::ItemStarted { .. }
        | AppServerEvent::ItemUpdated { .. }
        | AppServerEvent::ItemCompleted { .. }
        | AppServerEvent::ThreadUpdated { .. }
        | AppServerEvent::WorkflowRunUpdated { .. }
        | AppServerEvent::ServerRequest { .. } => {
            panic!("unexpected typed lifecycle, workflow, or interaction event")
        }
    }

    let _ = child.kill().await;
    let _ = child.wait().await;
}

async fn spawn_api_server() -> String {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("health test server should bind");
    let address = listener
        .local_addr()
        .expect("health test server should expose address");
    tokio::spawn(async move {
        for _ in 0..20 {
            let Ok((mut stream, _peer)) = listener.accept().await else {
                return;
            };
            let mut buffer = [0_u8; 2048];
            let Ok(size) = stream.read(&mut buffer).await else {
                return;
            };
            let request = String::from_utf8_lossy(&buffer[..size]);
            let response = match request.lines().next().unwrap_or_default() {
                "GET /health HTTP/1.1" => http_json("HTTP/1.1 200 OK", "{}"),
                "GET /api/auth/csrf HTTP/1.1" => http_response(
                    "HTTP/1.1 200 OK",
                    "content-type: application/json\r\nset-cookie: csrf_token=csrf-1; Path=/",
                    r#"{"csrfToken":"csrf-1"}"#,
                ),
                "POST /auth/device/start HTTP/1.1" => {
                    assert!(request_header(&request, "user-agent")
                        .is_some_and(|value| value.starts_with("TaskForceAI-Desktop/")));
                    http_json(
                        "HTTP/1.1 200 OK",
                        r#"{"device_code":"device-1","user_code":"ABCD-1234","verification_uri":"https://example.test/device","verification_uri_complete":"https://example.test/device?code=ABCD-1234","expires_in":600,"interval":5}"#,
                    )
                }
                "POST /auth/device/token HTTP/1.1" => http_json(
                    "HTTP/1.1 200 OK",
                    r#"{"status":"approved","accessToken":"approved-token","expires_in":3600}"#,
                ),
                "POST /run HTTP/1.1" => {
                    assert!(request.contains("authorization: Bearer approved-token"));
                    http_json(
                        "HTTP/1.1 200 OK",
                        r#"{"taskId":"remote_task_1","conversationId":"remote_task_1"}"#,
                    )
                }
                "GET /stream/remote_task_1 HTTP/1.1" => http_sse(
                    "data: {\"type\":\"progress\",\"chunk\":\"streamed chunk\",\"sources\":[{\"url\":\"https://example.com\",\"title\":\"Example\"}],\"tool_event\":{\"toolName\":\"computer_use\",\"status\":\"running\"},\"agent_statuses\":[{\"status\":\"running\"}]}\n\n\
                     data: {\"type\":\"complete\",\"message\":\"remote done\",\"sources\":[{\"url\":\"https://docs.example.com\",\"title\":\"Docs\"}],\"tool_usage\":[{\"toolName\":\"browser\",\"success\":true}],\"agent_statuses\":[{\"status\":\"completed\"}]}\n\n",
                ),
                "GET /api/v1/models HTTP/1.1" => http_json(
                    "HTTP/1.1 200 OK",
                    r#"{"enabled":true,"options":[{"id":"model-remote","label":"Remote Model","badge":"remote","description":"From API","usageMultiple":1.5}],"defaultModelId":"model-remote"}"#,
                ),
                "POST /api/v1/sync/push HTTP/1.1" => {
                    assert!(request.contains("authorization: Bearer approved-token"));
                    http_json(
                        "HTTP/1.1 200 OK",
                        r#"{"accepted":["conv-client-sync","msg-client-sync"],"conflicts":[],"conversationIdMappings":{},"newVersion":11}"#,
                    )
                }
                "POST /api/v1/sync/pull HTTP/1.1" => {
                    assert!(request.contains("authorization: Bearer approved-token"));
                    http_json(
                        "HTTP/1.1 200 OK",
                        r#"{"conversations":[{"localId":"conv-client-sync","userInput":"Client sync","result":"synced","timestamp":"1","updatedAt":"2","syncVersion":11,"isDeleted":false}],"messages":[{"messageId":"msg-client-sync","conversationLocalId":"conv-client-sync","role":"user","content":"synced","createdAt":"1","updatedAt":"1","syncVersion":11,"isDeleted":false,"isStreaming":false,"isAgentStatus":false}],"deletions":[],"latestVersion":11}"#,
                    )
                }
                _ => http_json("HTTP/1.1 404 Not Found", "{}"),
            };
            let _ = stream.write_all(response.as_bytes()).await;
        }
    });
    format!("http://{address}")
}

fn http_json(status_line: &str, body: &str) -> String {
    http_response(status_line, "content-type: application/json", body)
}

fn http_response(status_line: &str, headers: &str, body: &str) -> String {
    format!(
        "{status_line}\r\n{headers}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
        body.len()
    )
}

fn http_sse(body: &str) -> String {
    format!(
        "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
        body.len()
    )
}

fn request_header<'a>(request: &'a str, name: &str) -> Option<&'a str> {
    request.lines().find_map(|line| {
        let (key, value) = line.split_once(':')?;
        key.eq_ignore_ascii_case(name).then(|| value.trim())
    })
}

fn test_store_path() -> PathBuf {
    std::env::temp_dir().join(format!(
        "taskforceai-app-client-integration-{}-{}.sqlite3",
        std::process::id(),
        unix_millis()
    ))
}

fn unix_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("system clock should be after unix epoch")
        .as_millis()
}
