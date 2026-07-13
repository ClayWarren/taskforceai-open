use std::io::Write;
use std::net::TcpListener;
use std::sync::Mutex;
use std::thread;
use std::time::Instant;

use futures_util::stream::FuturesUnordered;
use ratatui::layout::Rect;
use serde_json::{json, Value};
use taskforceai_app_client::{AppClientError, AppServerClient};
use taskforceai_app_protocol::{
    AppServerEvent, DeviceLoginStartResult, ModelListResult, ModelOptionRecord,
    OllamaMemoryRecommendation, OllamaStatusResult, RunRecord, RunStatus,
};

use super::format::{format_model_list, format_ollama_status};
use super::{
    after_response_conversation_id, apply_background_task_result, apply_finished_startup_update,
    apply_interactive_error, expand_workspace_mentions, handle_app_server_event,
    handle_character_input, handle_input_action, hydrate_startup_state, poll_login_if_due,
    poll_sync_if_due, refresh_file_suggestions, remove_pending_space, replay_pending_prompt_if_due,
    startup_update_result, startup_update_task, submit_task_prompt, BackgroundTaskResult,
    SpaceDictationState, StartupUpdateResult, UiTaskQueue,
};
use crate::input::InputAction;
use crate::state::{FocusArea, UiAction};
use crate::test_support::{
    initialized, read_http_body, rpc_response, start_http_sink_server,
    start_recording_rpc_sequence_server, start_rpc_sequence_server,
};
use crate::update::{UpdateCheck, UpdateError};
use crate::voice::RealtimeTurnResult;

static APP_ENV_TEST_LOCK: Mutex<()> = Mutex::new(());

fn run(id: &str, status: RunStatus) -> RunRecord {
    RunRecord {
        id: id.to_string(),
        prompt: "hello".to_string(),
        model_id: None,
        project_id: None,
        status,
        output: None,
        error: None,
        created_at: 1,
        updated_at: 1,
        tool_events: Vec::new(),
        sources: Vec::new(),
        agent_statuses: Vec::new(),
        pending_approval: None,
    }
}

fn model_list(selected: Option<&str>) -> ModelListResult {
    ModelListResult {
        enabled: true,
        options: vec![
            ModelOptionRecord {
                id: "sentinel".to_string(),
                label: "Sentinel".to_string(),
                badge: "default".to_string(),
                description: Some("Default model".to_string()),
                usage_multiple: Some(1.0),
                reasoning_effort_levels: Vec::new(),
                default_reasoning_effort: None,
            },
            ModelOptionRecord {
                id: "gpt-5".to_string(),
                label: "GPT-5".to_string(),
                badge: "deep".to_string(),
                description: None,
                usage_multiple: None,
                reasoning_effort_levels: Vec::new(),
                default_reasoning_effort: None,
            },
        ],
        default_model_id: "sentinel".to_string(),
        selected_model_id: selected.map(ToOwned::to_owned),
        remote_catalog: false,
    }
}

fn empty_model_list() -> ModelListResult {
    ModelListResult {
        enabled: true,
        options: Vec::new(),
        default_model_id: "sentinel".to_string(),
        selected_model_id: None,
        remote_catalog: false,
    }
}

fn pet_json() -> Value {
    json!({
        "name": "Sentinel",
        "mood": "focus",
        "visible": true,
        "message": "Ready."
    })
}

fn status_summary_json() -> Value {
    json!({
        "transport": "http",
        "authenticated": true,
        "runCount": 1,
        "modelId": "sentinel",
        "quickMode": false,
        "autonomous": false,
        "computerUse": false,
        "pet": pet_json()
    })
}

fn run_json(id: &str, status: RunStatus) -> Value {
    serde_json::to_value(run(id, status)).expect("run should serialize")
}

fn start_rpc_capture_server(
    expected_method: &'static str,
    result: Value,
) -> (String, thread::JoinHandle<Value>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("rpc server should bind");
    let address = listener
        .local_addr()
        .expect("rpc address should be readable");
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("rpc request should connect");
        let body = read_http_body(&mut stream);
        let request: Value = serde_json::from_str(&body).expect("rpc request body should be json");
        assert_eq!(request["method"], expected_method);
        let response_body = rpc_response(request["id"].clone(), result);
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            response_body.len(),
            response_body
        );
        stream
            .write_all(response.as_bytes())
            .expect("rpc response should write");
        request
    });
    (format!("http://{address}"), server)
}

mod formatting;
mod input_actions;
mod startup_polling;
