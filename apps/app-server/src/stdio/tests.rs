use serde_json::Value;
use tokio::io::BufReader;

use super::{run_stdio, run_stdio_in_memory};

async fn run(input: &str) -> (String, String) {
    let add_handshake =
        input.contains("\"method\":") && !input.contains("\"method\":\"initialize\"");
    let owned_input = add_handshake.then(|| {
        format!(
            "{{\"jsonrpc\":\"2.0\",\"id\":\"__test_initialize\",\"method\":\"initialize\",\"params\":{{}}}}\n{{\"jsonrpc\":\"2.0\",\"method\":\"initialized\",\"params\":{{}}}}\n{input}"
        )
    });
    let input = owned_input.as_deref().unwrap_or(input);
    let mut output = Vec::new();
    let mut logs = Vec::new();
    run_stdio_in_memory(BufReader::new(input.as_bytes()), &mut output, &mut logs)
        .await
        .expect("stdio server should run");

    let mut output = String::from_utf8(output).expect("output should be utf8");
    if add_handshake {
        output = output
            .lines()
            .filter(|line| !line.contains("\"id\":\"__test_initialize\""))
            .collect::<Vec<_>>()
            .join("\n");
        if !output.is_empty() {
            output.push('\n');
        }
    }
    (
        output,
        String::from_utf8(logs).expect("logs should be utf8"),
    )
}

#[tokio::test]
async fn public_stdio_wrapper_handles_blank_lines_and_shutdown() {
    let mut output = Vec::new();
    let mut logs = Vec::new();

    run_stdio(
        BufReader::new(
            b"\n{\"jsonrpc\":\"2.0\",\"id\":0,\"method\":\"initialize\",\"params\":{}}\n{\"jsonrpc\":\"2.0\",\"method\":\"initialized\",\"params\":{}}\n{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"shutdown\"}\n"
                .as_slice(),
        ),
        &mut output,
        &mut logs,
    )
    .await
    .expect("public stdio wrapper should run");

    let lines = json_lines(&String::from_utf8(output).expect("output should be utf8"));
    assert_eq!(response_by_id(&lines, 1)["result"]["ok"], true);
    assert!(String::from_utf8(logs)
        .expect("logs should be utf8")
        .contains("taskforceai app-server stopped"));
}

fn json_lines(output: &str) -> Vec<Value> {
    output
        .lines()
        .map(|line| serde_json::from_str(line).expect("line should be json"))
        .collect()
}

fn response_by_id(lines: &[Value], id: i64) -> &Value {
    lines
        .iter()
        .find(|line| line["id"] == id)
        .expect("response should exist")
}

fn notifications_by_method<'a>(lines: &'a [Value], method: &str) -> Vec<&'a Value> {
    lines
        .iter()
        .filter(|line| line["method"] == method)
        .collect()
}

#[tokio::test]
async fn initialize_returns_server_metadata() {
    let (output, logs) = run(r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}"#).await;

    let lines = json_lines(&output);
    assert_eq!(lines[0]["jsonrpc"], "2.0");
    assert_eq!(lines[0]["id"], 1);
    assert_eq!(
        lines[0]["result"]["server"]["name"],
        "taskforceai-app-server"
    );
    assert_eq!(lines[0]["result"]["transport"]["kind"], "stdio");
    assert_eq!(lines[0]["result"]["capabilities"]["runs"], true);
    assert_eq!(lines[0]["result"]["capabilities"]["threads"], true);
    assert_eq!(lines[0]["result"]["capabilities"]["turns"], true);
    let log: Value = serde_json::from_str(logs.lines().next().expect("log line should exist"))
        .expect("log should be json");
    assert_eq!(log["level"], "info");
    assert_eq!(log["message"], "taskforceai app-server starting");
}

#[tokio::test]
async fn explicit_null_id_receives_a_response() {
    let (output, _logs) =
        run(r#"{"jsonrpc":"2.0","id":null,"method":"initialize","params":{}}"#).await;

    let lines = json_lines(&output);
    assert_eq!(lines.len(), 1);
    assert_eq!(lines[0]["jsonrpc"], "2.0");
    assert_eq!(lines[0]["id"], Value::Null);
    assert_eq!(lines[0]["result"]["transport"]["kind"], "stdio");
}

#[tokio::test]
async fn thread_and_turn_methods_control_agent_sessions() {
    let (output, _logs) = run(
            r#"{"jsonrpc":"2.0","id":1,"method":"thread/start","params":{"threadId":"thread-runtime","objective":"Keep the product runtime healthy","title":"Runtime steward"}}
{"jsonrpc":"2.0","id":2,"method":"turn/start","params":{"threadId":"thread-runtime","input":"Check local runtime status","quickMode":true}}
{"jsonrpc":"2.0","id":3,"method":"turn/steer","params":{"threadId":"thread-runtime","input":"Focus on app-server protocol"}}
{"jsonrpc":"2.0","id":4,"method":"thread/fork","params":{"threadId":"thread-runtime"}}
{"jsonrpc":"2.0","id":5,"method":"thread/archive","params":{"threadId":"thread-runtime"}}
{"jsonrpc":"2.0","id":6,"method":"thread/list","params":{}}"#,
        )
        .await;

    let lines = json_lines(&output);
    let start = response_by_id(&lines, 1);
    let turn = response_by_id(&lines, 2);
    let steer = response_by_id(&lines, 3);
    let fork = response_by_id(&lines, 4);
    let archive = response_by_id(&lines, 5);
    let list = response_by_id(&lines, 6);

    assert_eq!(start["result"]["thread"]["title"], "Runtime steward");
    assert_eq!(start["result"]["thread"]["source"], "thread");
    assert_eq!(turn["result"]["thread"]["id"], "thread-runtime");
    assert_eq!(
        turn["result"]["run"]["prompt"],
        "Check local runtime status"
    );
    assert!(notifications_by_method(&lines, "event")
        .iter()
        .any(|notification| notification["params"]["type"] == "run_updated"));
    assert_eq!(notifications_by_method(&lines, "turn/started").len(), 1);
    assert_eq!(notifications_by_method(&lines, "item/started").len(), 1);
    assert!(notifications_by_method(&lines, "turn/updated").is_empty());
    assert_eq!(
        steer["result"]["turn"]["items"]
            .as_array()
            .expect("steered turn should have items")
            .last()
            .expect("steering item should exist")["content"]["text"],
        "Focus on app-server protocol"
    );
    assert_eq!(
        fork["result"]["thread"]["parentThreadId"],
        start["result"]["thread"]["id"]
    );
    assert_eq!(archive["result"]["thread"]["state"], "active");
    assert_eq!(archive["result"]["thread"]["archived"], true);
    assert_eq!(
        list["result"]["threads"]
            .as_array()
            .expect("threads should be an array")
            .len(),
        2
    );
}

#[tokio::test]
async fn turn_interrupt_cancels_the_active_run_and_pauses_thread() {
    let (output, _logs) = run(
            r#"{"jsonrpc":"2.0","id":1,"method":"thread/start","params":{"threadId":"thread-interrupt","objective":"Pause safely"}}
{"jsonrpc":"2.0","id":2,"method":"turn/start","params":{"threadId":"thread-interrupt","input":"Long local task"}}
{"jsonrpc":"2.0","id":3,"method":"turn/interrupt","params":{"threadId":"thread-interrupt"}}"#,
        )
        .await;

    let lines = json_lines(&output);
    let turn = response_by_id(&lines, 2);
    let interrupt = response_by_id(&lines, 3);
    assert_eq!(turn["result"]["run"]["status"], "queued");
    assert_eq!(interrupt["result"]["run"]["status"], "canceled");
    assert_eq!(interrupt["result"]["thread"]["state"], "paused");
    assert_eq!(notifications_by_method(&lines, "turn/interrupted").len(), 1);
    assert_eq!(notifications_by_method(&lines, "item/completed").len(), 3);
    assert_eq!(
        notifications_by_method(&lines, "event")
            .last()
            .expect("event should exist")["params"]["run"]["status"],
        "canceled"
    );
}

#[tokio::test]
async fn attachment_list_and_clear_return_pending_state() {
    let (output, _logs) = run(
        r#"{"jsonrpc":"2.0","id":1,"method":"attachment.list","params":{}}
{"jsonrpc":"2.0","id":2,"method":"attachment.clear","params":{}}"#,
    )
    .await;

    let lines = json_lines(&output);
    assert_eq!(
        lines[0]["result"]["attachments"]
            .as_array()
            .expect("attachments")
            .len(),
        0
    );
    assert_eq!(lines[0]["result"]["maxAttachments"], 5);
    assert_eq!(
        lines[1]["result"]["attachments"]
            .as_array()
            .expect("attachments")
            .len(),
        0
    );
    assert_eq!(lines[1]["result"]["maxAttachments"], 5);
}

#[tokio::test]
async fn tui_agent_count_metadata_round_trips_and_unknown_keys_stay_rejected() {
    let (output, _logs) = run(
        r#"{"jsonrpc":"2.0","id":1,"method":"metadata.set","params":{"key":"tui_orchestration_agent_count","value":"6"}}
{"jsonrpc":"2.0","id":2,"method":"metadata.get","params":{"key":"tui_orchestration_agent_count"}}
{"jsonrpc":"2.0","id":3,"method":"metadata.set","params":{"key":"unsupported_tui_key","value":"1"}}"#,
    )
    .await;

    let lines = json_lines(&output);
    assert_eq!(response_by_id(&lines, 1)["result"]["ok"], true);
    assert_eq!(response_by_id(&lines, 2)["result"]["value"], "6");
    assert_eq!(response_by_id(&lines, 3)["error"]["code"], -32602);
    assert_eq!(
        response_by_id(&lines, 3)["error"]["message"],
        "unsupported metadata key"
    );
}

#[tokio::test]
async fn mcp_config_methods_return_configured_servers() {
    let (output, _logs) = run(
            r#"{"jsonrpc":"2.0","id":1,"method":"mcp.add","params":{"name":"files","endpoint":"https://example.com/mcp","tools":["read"],"enabled":true}}
{"jsonrpc":"2.0","id":2,"method":"mcp.disable","params":{"name":"files"}}
{"jsonrpc":"2.0","id":3,"method":"mcp.list","params":{}}
{"jsonrpc":"2.0","id":4,"method":"mcpServerStatus/list","params":{"detail":"toolsAndAuthOnly"}}"#,
        )
        .await;

    let lines = json_lines(&output);
    assert_eq!(lines[0]["result"]["server"]["name"], "files");
    assert_eq!(lines[1]["result"]["server"]["enabled"], false);
    assert_eq!(
        lines[2]["result"]["servers"]
            .as_array()
            .expect("servers")
            .len(),
        1
    );
    assert_eq!(lines[2]["result"]["servers"][0]["tools"][0], "read");
    assert_eq!(lines[3]["result"]["data"][0]["name"], "files");
    assert_eq!(
        lines[3]["result"]["data"][0]["connectionStatus"],
        "disabled"
    );
}

#[tokio::test]
async fn notification_does_not_emit_response() {
    let (output, _logs) = run(r#"{"jsonrpc":"2.0","method":"server.ping"}"#).await;

    assert!(output.is_empty());
}

#[tokio::test]
async fn unknown_method_returns_json_rpc_error() {
    let (output, _logs) = run(r#"{"jsonrpc":"2.0","id":"x","method":"missing"}"#).await;

    let lines = json_lines(&output);
    assert_eq!(lines[0]["id"], "x");
    assert_eq!(lines[0]["error"]["code"], -32601);
    assert_eq!(lines[0]["error"]["message"], "Method not found");
}

#[tokio::test]
async fn workspace_file_methods_are_exposed_over_json_rpc() {
    let (output, _logs) = run(
        r#"{"jsonrpc":"2.0","id":1,"method":"workspace.file.list","params":{"workspace":"/definitely-missing-taskforceai-workspace"}}
{"jsonrpc":"2.0","id":2,"method":"workspace.file.read","params":{"workspace":"/definitely-missing-taskforceai-workspace","path":"README.md"}}"#,
    )
    .await;

    let lines = json_lines(&output);
    assert_eq!(lines.len(), 2);
    for (index, line) in lines.iter().enumerate() {
        assert_eq!(line["id"], index + 1);
        assert_eq!(line["error"]["code"], -32602);
        assert!(line["error"]["message"]
            .as_str()
            .expect("error message")
            .starts_with("workspace not found:"));
    }
}

#[tokio::test]
async fn compatibility_methods_round_trip_over_json_rpc() {
    let (output, _logs) = run(
        r#"{"jsonrpc":"2.0","id":1,"method":"config/batch/write","params":{"values":{"runtime.simulateRunProgress":false,"ui.density":"compact"}}}
{"jsonrpc":"2.0","id":2,"method":"config/read","params":{}}
{"jsonrpc":"2.0","id":3,"method":"thread/start","params":{"threadId":"compat-thread","objective":"Keep settings","settings":{"modelId":"gpt-test","permissionProfile":"read_only"}}}
{"jsonrpc":"2.0","id":4,"method":"thread/settings/get","params":{"threadId":"compat-thread"}}
{"jsonrpc":"2.0","id":5,"method":"thread/tokenUsage","params":{"threadId":"compat-thread"}}
{"jsonrpc":"2.0","id":6,"method":"turn/diff","params":{"threadId":"compat-thread"}}
{"jsonrpc":"2.0","id":7,"method":"hooks/list","params":{}}"#,
    )
    .await;

    let lines = json_lines(&output);
    assert_eq!(
        response_by_id(&lines, 2)["result"]["values"]["ui.density"],
        "compact"
    );
    assert_eq!(
        response_by_id(&lines, 4)["result"]["settings"]["modelId"],
        "gpt-test"
    );
    assert_eq!(
        response_by_id(&lines, 5)["result"]["usage"]["totalTokens"],
        0
    );
    assert_eq!(response_by_id(&lines, 6)["result"]["diff"], "");
    assert_eq!(
        response_by_id(&lines, 7)["result"]["hooks"],
        serde_json::json!([])
    );
}

#[tokio::test]
async fn invalid_jsonrpc_shape_returns_invalid_request_errors() {
    let (output, _logs) = run(
        r#"{"jsonrpc":"1.0","id":1,"method":"initialize","params":{}}
{"jsonrpc":"2.0","id":2,"params":{}}"#,
    )
    .await;

    let lines = json_lines(&output);
    assert_eq!(lines[0]["id"], 1);
    assert_eq!(lines[0]["error"]["code"], -32600);
    assert_eq!(lines[0]["error"]["message"], "Invalid Request");
    assert_eq!(lines[1]["id"], 2);
    assert_eq!(lines[1]["error"]["code"], -32600);
    assert_eq!(lines[1]["error"]["message"], "Invalid Request");
}

#[tokio::test]
async fn invalid_json_returns_parse_error() {
    let (output, _logs) = run("not-json\n").await;

    let lines = json_lines(&output);
    assert_eq!(lines[0]["error"]["code"], -32700);
    assert_eq!(lines[0]["error"]["message"], "Parse error");
}

#[tokio::test]
async fn shutdown_stops_after_response() {
    let (output, _logs) = run(r#"{"jsonrpc":"2.0","id":1,"method":"shutdown"}"#).await;

    let lines = json_lines(&output);
    assert_eq!(lines[0]["result"]["ok"], true);
}

#[tokio::test]
async fn run_submit_emits_response_and_event() {
    let (output, _logs) = run(
            r#"{"jsonrpc":"2.0","id":1,"method":"run.submit","params":{"prompt":"hello","modelId":"sentinel"}}"#,
        )
        .await;

    let lines = json_lines(&output);
    assert_eq!(lines.len(), 2);
    assert_eq!(lines[0]["result"]["run"]["id"], "local_run_1");
    assert_eq!(lines[0]["result"]["run"]["status"], "queued");
    assert_eq!(lines[1]["method"], "event");
    assert_eq!(lines[1]["params"]["type"], "run_updated");
}

#[tokio::test]
async fn history_list_returns_submitted_runs() {
    let (output, _logs) = run(
        r#"{"jsonrpc":"2.0","id":1,"method":"run.submit","params":{"prompt":"hello"}}
{"jsonrpc":"2.0","id":2,"method":"history.list","params":{"limit":10}}"#,
    )
    .await;

    let lines = json_lines(&output);
    assert_eq!(lines[2]["id"], 2);
    assert_eq!(lines[2]["result"]["runs"][0]["prompt"], "hello");
}

#[tokio::test]
async fn conversation_and_message_single_record_methods_work() {
    let (output, _logs) = run(
            r#"{"jsonrpc":"2.0","id":1,"method":"run.submit","params":{"prompt":"hello"}}
{"jsonrpc":"2.0","id":2,"method":"conversation.get","params":{"conversationId":"local_run_1"}}
{"jsonrpc":"2.0","id":3,"method":"message.get","params":{"messageId":"local_run_1_user"}}
{"jsonrpc":"2.0","id":4,"method":"message.delete","params":{"messageId":"local_run_1_user"}}
{"jsonrpc":"2.0","id":5,"method":"conversation.delete","params":{"conversationId":"local_run_1"}}
{"jsonrpc":"2.0","id":6,"method":"conversation.upsert","params":{"conversationId":"manual_conv","title":"Manual","createdAt":1,"updatedAt":2,"lastMessagePreview":"preview"}}
{"jsonrpc":"2.0","id":7,"method":"message.upsert","params":{"messageId":"manual_msg","conversationId":"manual_conv","role":"user","content":"hello","createdAt":3,"updatedAt":4}}
{"jsonrpc":"2.0","id":8,"method":"conversation.replaceId","params":{"oldConversationId":"manual_conv","newConversationId":"manual_conv_remote"}}
{"jsonrpc":"2.0","id":9,"method":"conversation.deleteAll"}
{"jsonrpc":"2.0","id":10,"method":"conversation.get","params":{"conversationId":"manual_conv_remote"}}"#,
        )
        .await;

    let lines = json_lines(&output);
    assert_eq!(lines[2]["result"]["conversation"], serde_json::Value::Null);
    assert_eq!(lines[3]["result"]["message"], serde_json::Value::Null);
    assert_eq!(lines[4]["result"]["ok"], true);
    assert_eq!(lines[5]["result"]["ok"], true);
    assert_eq!(
        lines[6]["result"]["conversation"]["conversationId"],
        "manual_conv"
    );
    assert_eq!(lines[7]["result"]["message"]["messageId"], "manual_msg");
    assert_eq!(lines[8]["result"]["ok"], true);
    assert_eq!(lines[9]["result"]["ok"], true);
    assert_eq!(lines[10]["result"]["conversation"], serde_json::Value::Null);
}

#[tokio::test]
async fn usage_summary_returns_structured_counts() {
    let (output, _logs) = run(
        r#"{"jsonrpc":"2.0","id":1,"method":"run.submit","params":{"prompt":"hello"}}
{"jsonrpc":"2.0","id":2,"method":"usage.summary"}"#,
    )
    .await;

    let lines = json_lines(&output);
    assert_eq!(lines[2]["id"], 2);
    assert_eq!(lines[2]["result"]["totalRuns"], 1);
    assert!(lines[2]["result"]["queuedRuns"].is_number());
    assert!(lines[2]["result"]["completedRuns"].is_number());
}

#[tokio::test]
async fn status_summary_returns_structured_runtime_state() {
    let (output, _logs) = run(r#"{"jsonrpc":"2.0","id":1,"method":"status.summary"}"#).await;

    let lines = json_lines(&output);
    assert_eq!(lines[0]["result"]["transport"], "stdio/jsonl");
    assert_eq!(lines[0]["result"]["authenticated"], false);
    assert_eq!(lines[0]["result"]["runCount"], 0);
    assert_eq!(lines[0]["result"]["pet"]["name"], "Pulse");
}

#[tokio::test]
async fn pet_methods_manage_companion_state() {
    let (output, _logs) = run(r#"{"jsonrpc":"2.0","id":1,"method":"pet.get"}
{"jsonrpc":"2.0","id":2,"method":"pet.set","params":{"name":"Nova","mood":"celebrate","visible":true}}
{"jsonrpc":"2.0","id":3,"method":"pet.set","params":{"visible":false}}"#)
        .await;

    let lines = json_lines(&output);
    assert_eq!(lines[0]["result"]["pet"]["name"], "Pulse");
    assert_eq!(lines[1]["result"]["pet"]["name"], "Nova");
    assert_eq!(lines[1]["result"]["pet"]["mood"], "celebrate");
    assert_eq!(lines[2]["result"]["pet"]["visible"], false);
}

#[tokio::test]
async fn command_execute_returns_command_result() {
    let (output, _logs) =
        run(r#"{"jsonrpc":"2.0","id":1,"method":"command.execute","params":{"input":"/help"}}"#)
            .await;

    let lines = json_lines(&output);
    assert_eq!(lines[0]["id"], 1);
    assert_eq!(lines[0]["result"]["handled"], true);
    assert_eq!(lines[0]["result"]["title"], "Help");
}

#[tokio::test]
async fn goal_methods_manage_goal_state() {
    let (output, _logs) = run(r#"{"jsonrpc":"2.0","id":1,"method":"goal.get"}
{"jsonrpc":"2.0","id":2,"method":"goal.set","params":{"objective":"Reach Rust TUI parity"}}
{"jsonrpc":"2.0","id":3,"method":"goal.pause"}
{"jsonrpc":"2.0","id":4,"method":"goal.resume"}
{"jsonrpc":"2.0","id":5,"method":"goal.clear"}"#)
    .await;

    let lines = json_lines(&output);
    assert_eq!(lines[0]["result"]["goal"], serde_json::Value::Null);
    assert_eq!(
        lines[1]["result"]["goal"]["objective"],
        "Reach Rust TUI parity"
    );
    assert_eq!(lines[1]["result"]["goal"]["status"], "active");
    assert_eq!(lines[2]["result"]["goal"]["status"], "paused");
    assert_eq!(lines[3]["result"]["goal"]["status"], "active");
    assert_eq!(lines[4]["result"]["ok"], true);
}

#[tokio::test]
async fn orchestration_methods_manage_shared_config() {
    let (output, _logs) = run(r#"{"jsonrpc":"2.0","id":1,"method":"orchestration.get"}
{"jsonrpc":"2.0","id":2,"method":"orchestration.setRole","params":{"role":"Analyst","modelId":"gpt-5"}}
{"jsonrpc":"2.0","id":3,"method":"orchestration.setBudget","params":{"budget":25}}
{"jsonrpc":"2.0","id":4,"method":"orchestration.clear"}"#)
        .await;

    let lines = json_lines(&output);
    assert_eq!(
        lines[0]["result"]["orchestration"]["roles"][1]["name"],
        "Analyst"
    );
    assert_eq!(
        lines[1]["result"]["orchestration"]["roles"][1]["modelId"],
        "gpt-5"
    );
    assert_eq!(lines[2]["result"]["orchestration"]["budget"], 25.0);
    assert_eq!(
        lines[3]["result"]["orchestration"]["roles"][1]["modelId"],
        serde_json::Value::Null
    );
}

#[tokio::test]
async fn hybrid_methods_manage_local_reviewer_config() {
    let (output, _logs) = run(r#"{"jsonrpc":"2.0","id":1,"method":"hybridMode.get"}
{"jsonrpc":"2.0","id":2,"method":"hybridMode.set","params":{"enabled":true,"modelId":"ollama/gemma4:e4b"}}
{"jsonrpc":"2.0","id":3,"method":"hybridMode.set","params":{"enabled":false}}"#)
        .await;

    let lines = json_lines(&output);
    assert_eq!(lines[0]["result"]["enabled"], false);
    assert_eq!(lines[1]["result"]["enabled"], true);
    assert_eq!(lines[1]["result"]["modelId"], "ollama/gemma4:e4b");
    assert_eq!(lines[2]["result"]["enabled"], false);
}

#[tokio::test]
async fn local_settings_methods_manage_shared_config() {
    let (output, _logs) = run(r#"{"jsonrpc":"2.0","id":1,"method":"settings.local.get"}
{"jsonrpc":"2.0","id":2,"method":"settings.local.update","params":{"theme":"dark","telemetryEnabled":true,"telemetryEnvironment":"staging","loggingLevel":"debug","loggingFormat":"json"}}
{"jsonrpc":"2.0","id":3,"method":"command.execute","params":{"input":"/config theme light"}}"#)
        .await;

    let lines = json_lines(&output);
    assert_eq!(lines[0]["result"]["settings"]["theme"], "system");
    assert_eq!(lines[1]["result"]["settings"]["theme"], "dark");
    assert_eq!(lines[1]["result"]["settings"]["loggingFormat"], "json");
    assert_eq!(lines[2]["result"]["handled"], true);
    assert!(lines[2]["result"]["message"]
        .as_str()
        .expect("message should be string")
        .contains("light"));
}

#[tokio::test]
async fn sync_methods_manage_device_and_cursor() {
    let (output, _logs) = run(r#"{"jsonrpc":"2.0","id":1,"method":"sync.ensureDevice"}
{"jsonrpc":"2.0","id":2,"method":"sync.configure","params":{"deviceId":"device-rpc","lastSyncVersion":9}}
{"jsonrpc":"2.0","id":3,"method":"sync.status"}
{"jsonrpc":"2.0","id":4,"method":"sync.realtimePoll","params":{"lastEventId":"7-0"}}
{"jsonrpc":"2.0","id":5,"method":"sync.run","params":{"lastEventId":"7-0"}}
{"jsonrpc":"2.0","id":6,"method":"command.execute","params":{"input":"/sync status"}}"#)
        .await;

    let lines = json_lines(&output);
    assert_eq!(lines[0]["result"]["generated"], true);
    assert!(lines[0]["result"]["deviceId"]
        .as_str()
        .expect("device id should be string")
        .starts_with("taskforce-"));
    assert_eq!(lines[1]["result"]["deviceId"], "device-rpc");
    assert_eq!(lines[1]["result"]["lastSyncVersion"], 9);
    assert_eq!(lines[2]["result"]["configured"], false);
    assert_eq!(lines[2]["result"]["deviceId"], "device-rpc");
    assert_eq!(lines[3]["result"]["hasUpdates"], false);
    assert_eq!(lines[3]["result"]["lastEventId"], "7-0");
    assert_eq!(lines[4]["result"]["hasUpdates"], false);
    assert_eq!(lines[4]["result"]["lastEventId"], "7-0");
    assert_eq!(lines[5]["result"]["handled"], true);
}

#[tokio::test]
async fn model_methods_manage_shared_selector_state() {
    let (output, _logs) = run(r#"{"jsonrpc":"2.0","id":1,"method":"model.list"}
{"jsonrpc":"2.0","id":2,"method":"model.select","params":{"modelId":"gpt-5"}}
{"jsonrpc":"2.0","id":3,"method":"model.reset"}
{"jsonrpc":"2.0","id":4,"method":"command.execute","params":{"input":"/model list"}}"#)
    .await;

    let lines = json_lines(&output);
    assert!(lines[0]["result"]["options"].is_array());
    assert_eq!(lines[1]["result"]["selectedModelId"], "gpt-5");
    assert_eq!(
        lines[2]["result"]["selectedModelId"],
        serde_json::Value::Null
    );
    assert_eq!(lines[3]["result"]["handled"], true);
}

#[tokio::test]
async fn quick_mode_methods_manage_shared_state() {
    let (output, _logs) = run(r#"{"jsonrpc":"2.0","id":1,"method":"quickMode.get"}
{"jsonrpc":"2.0","id":2,"method":"quickMode.set","params":{"enabled":false}}
{"jsonrpc":"2.0","id":3,"method":"quickMode.get"}
{"jsonrpc":"2.0","id":4,"method":"quickMode.set","params":{"enabled":true}}
{"jsonrpc":"2.0","id":5,"method":"quickMode.get"}"#)
    .await;

    let lines = json_lines(&output);
    assert_eq!(lines[0]["result"]["enabled"], true);
    assert_eq!(lines[1]["result"]["enabled"], false);
    assert_eq!(lines[2]["result"]["enabled"], false);
    assert_eq!(lines[3]["result"]["enabled"], true);
    assert_eq!(lines[4]["result"]["enabled"], true);
}

#[tokio::test]
async fn sync_pull_reports_empty_local_snapshot_without_store() {
    let (output, _logs) =
        run(r#"{"jsonrpc":"2.0","id":1,"method":"sync.pull","params":{"limit":5}}"#).await;

    let lines = json_lines(&output);
    assert_eq!(lines[0]["result"]["latestVersion"], 0);
    assert!(lines[0]["result"]["conversations"].is_array());
    assert!(lines[0]["result"]["messages"].is_array());
}

#[tokio::test]
async fn pending_change_methods_return_structured_results() {
    let (output, _logs) = run(
            r#"{"jsonrpc":"2.0","id":1,"method":"pendingChange.list"}
{"jsonrpc":"2.0","id":2,"method":"pendingChange.add","params":{"type":"message","entityId":"msg-1","operation":"create","data":{"messageId":"msg-1"},"createdAt":1}}
{"jsonrpc":"2.0","id":3,"method":"pendingChange.updateData","params":{"id":1,"data":{"messageId":"msg-1","synced":true}}}
{"jsonrpc":"2.0","id":4,"method":"pendingChange.delete","params":{"id":1}}
{"jsonrpc":"2.0","id":5,"method":"pendingChange.clear"}"#,
        )
        .await;

    let lines = json_lines(&output);
    assert!(lines[0]["result"]["pendingChanges"].is_array());
    assert_eq!(lines[1]["result"]["pendingChange"]["entityId"], "msg-1");
    assert_eq!(lines[2]["result"]["ok"], true);
    assert_eq!(lines[3]["result"]["ok"], true);
    assert_eq!(lines[4]["result"]["ok"], true);
}

#[tokio::test]
async fn prompt_queue_methods_return_structured_results() {
    let (output, _logs) = run(
            r#"{"jsonrpc":"2.0","id":1,"method":"promptQueue.list"}
{"jsonrpc":"2.0","id":2,"method":"promptQueue.add","params":{"conversationId":"conv-1","prompt":"follow up","status":"queued","dispatchTiming":"after_response","createdAt":1,"updatedAt":2,"modelId":"openai/gpt-5.6-sol","reasoningEffort":"max","attachmentIds":["att-1"]}}
{"jsonrpc":"2.0","id":3,"method":"promptQueue.delete","params":{"id":1}}
{"jsonrpc":"2.0","id":4,"method":"promptQueue.clear"}"#,
        )
        .await;

    let lines = json_lines(&output);
    assert!(lines[0]["result"]["queuedPrompts"].is_array());
    assert_eq!(
        lines[1]["result"]["queuedPrompt"]["dispatchTiming"],
        "after_response"
    );
    assert_eq!(lines[1]["result"]["queuedPrompt"]["reasoningEffort"], "max");
    assert_eq!(lines[2]["result"]["ok"], true);
    assert_eq!(lines[3]["result"]["ok"], true);
}

#[tokio::test]
async fn skill_and_plugin_list_methods_return_arrays() {
    let (output, _logs) = run(r#"{"jsonrpc":"2.0","id":1,"method":"skill.list"}
{"jsonrpc":"2.0","id":2,"method":"plugin.list"}"#)
    .await;

    let lines = json_lines(&output);
    assert!(lines[0]["result"]["skills"].is_array());
    assert_eq!(lines[0]["result"]["truncated"], false);
    assert!(lines[1]["result"]["plugins"].is_array());
}

#[tokio::test]
async fn pending_prompt_list_returns_array() {
    let (output, _logs) = run(
            r#"{"jsonrpc":"2.0","id":1,"method":"pendingPrompt.add","params":{"id":"pp-manual","prompt":"retry me","modelId":"gpt-5","projectId":1,"status":"queued","retryCount":0,"lastError":null,"createdAt":1,"updatedAt":1}}
{"jsonrpc":"2.0","id":2,"method":"pendingPrompt.list"}"#,
        )
        .await;

    let lines = json_lines(&output);
    assert_eq!(lines[0]["result"]["prompt"]["id"], "pp-manual");
    assert_eq!(lines[1]["result"]["prompts"][0]["prompt"], "retry me");
}

#[tokio::test]
async fn metadata_clear_all_returns_ack() {
    let (output, _logs) = run(r#"{"jsonrpc":"2.0","id":1,"method":"metadata.clearAll"}"#).await;

    let lines = json_lines(&output);
    assert_eq!(lines[0]["result"]["ok"], true);
}

#[tokio::test]
async fn auth_logout_and_run_search_return_structured_results() {
    let (output, _logs) = run(
        r#"{"jsonrpc":"2.0","id":1,"method":"run.submit","params":{"prompt":"searchable prompt"}}
{"jsonrpc":"2.0","id":2,"method":"run.search","params":{"query":"searchable","limit":5}}
{"jsonrpc":"2.0","id":3,"method":"auth.logout"}"#,
    )
    .await;

    let lines = json_lines(&output);
    assert_eq!(lines[2]["result"]["query"], "searchable");
    assert_eq!(lines[2]["result"]["runs"][0]["prompt"], "searchable prompt");
    assert_eq!(lines[3]["result"]["authenticated"], false);
}

#[tokio::test]
async fn pending_prompt_replay_reports_empty_queue() {
    let (output, _logs) = run(r#"{"jsonrpc":"2.0","id":1,"method":"pendingPrompt.replay"}"#).await;

    let lines = json_lines(&output);
    assert_eq!(lines[0]["result"]["attempted"], false);
    assert_eq!(lines[0]["result"]["remaining"], 0);
}

#[tokio::test]
async fn project_use_and_clear_round_trip_active_project() {
    let (output, _logs) = run(
        r#"{"jsonrpc":"2.0","id":1,"method":"project.use","params":{"projectId":9}}
{"jsonrpc":"2.0","id":2,"method":"project.list"}
{"jsonrpc":"2.0","id":3,"method":"project.clear"}"#,
    )
    .await;

    let lines = json_lines(&output);
    assert_eq!(lines[0]["result"]["activeProjectId"], 9);
    assert_eq!(lines[1]["result"]["activeProjectId"], 9);
    assert!(lines[1]["result"]["projects"].is_array());
    assert_eq!(
        lines[2]["result"]["activeProjectId"],
        serde_json::Value::Null
    );
}

#[tokio::test]
async fn project_workspace_set_normalizes_local_roots() {
    let (output, _logs) = run(
        r#"{"jsonrpc":"2.0","id":1,"method":"project.workspace.set","params":{"projectId":9,"workspaceRoots":[" /tmp/project ","/tmp/project",""]}}"#,
    )
    .await;

    let lines = json_lines(&output);
    assert_eq!(lines[0]["result"]["projectId"], 9);
    assert_eq!(
        lines[0]["result"]["workspaceRoots"],
        serde_json::json!(["/tmp/project"])
    );
}

#[tokio::test]
async fn context_summary_returns_breakdown() {
    let (output, _logs) = run(r#"{"jsonrpc":"2.0","id":1,"method":"context.summary"}"#).await;

    let lines = json_lines(&output);
    assert!(lines[0]["result"]["estimatedTokens"].is_number());
    assert!(lines[0]["result"]["items"].is_array());
    assert!(lines[0]["result"]["suggestions"].is_array());
}

#[tokio::test]
async fn memory_summary_returns_sources() {
    let (output, _logs) = run(r#"{"jsonrpc":"2.0","id":1,"method":"memory.summary"}"#).await;

    let lines = json_lines(&output);
    assert!(lines[0]["result"]["estimatedTokens"].is_number());
    assert!(lines[0]["result"]["sources"].is_array());
    assert!(lines[0]["result"]["suggestions"].is_array());
}

#[tokio::test]
async fn computer_use_status_returns_capability_guidance() {
    let (output, _logs) = run(r#"{"jsonrpc":"2.0","id":1,"method":"computerUse.status"}"#).await;

    let lines = json_lines(&output);
    assert!(lines[0]["result"]["supported"].is_boolean());
    assert!(lines[0]["result"]["installed"].is_boolean());
    assert!(lines[0]["result"]["message"]
        .as_str()
        .expect("message should be string")
        .contains("Computer Use"));
}

#[tokio::test]
async fn browser_status_returns_capability_guidance() {
    let (output, _logs) = run(r#"{"jsonrpc":"2.0","id":1,"method":"browser.status"}"#).await;

    let lines = json_lines(&output);
    assert_eq!(lines[0]["result"]["supported"], true);
    assert_eq!(lines[0]["result"]["supportsAuth"], false);
    assert!(lines[0]["result"]["message"]
        .as_str()
        .expect("message should be string")
        .contains("browser"));
}

#[tokio::test]
async fn mcp_discover_alias_returns_available_inventory() {
    let (output, _logs) = run(r#"{"jsonrpc":"2.0","id":1,"method":"mcp.discover"}"#).await;

    let lines = json_lines(&output);
    assert_eq!(lines[0]["result"]["adapterReady"], false);
    assert!(lines[0]["result"]["servers"].is_array());
}

#[tokio::test]
async fn invalid_run_submit_params_return_invalid_params() {
    let (output, _logs) =
        run(r#"{"jsonrpc":"2.0","id":1,"method":"run.submit","params":{}}"#).await;

    let lines = json_lines(&output);
    assert_eq!(lines[0]["error"]["code"], -32602);
}

#[tokio::test]
async fn run_cancel_updates_status_and_emits_event() {
    let (output, _logs) = run(
        r#"{"jsonrpc":"2.0","id":1,"method":"run.submit","params":{"prompt":"hello"}}
{"jsonrpc":"2.0","id":2,"method":"run.cancel","params":{"runId":"local_run_1"}}"#,
    )
    .await;

    let lines = json_lines(&output);
    assert_eq!(lines[2]["result"]["run"]["status"], "canceled");
    assert_eq!(lines[3]["params"]["run"]["status"], "canceled");
}
