use std::io::Write;
use std::net::TcpListener;
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use crossterm::event::{
    Event as CrosstermEvent, KeyCode, KeyEvent, KeyModifiers, MouseEvent, MouseEventKind,
};
use futures_util::stream::FuturesUnordered;
use futures_util::StreamExt;
use ratatui::layout::Rect;
use serde_json::{json, Value};
use taskforceai_app_client::{AppClientError, AppServerClient};
use taskforceai_app_protocol::{
    AppServerEvent, DeviceLoginStartResult, ModelListResult, ModelOptionRecord,
    OllamaMemoryRecommendation, OllamaStatusResult, RunRecord, RunStatus,
    TaskMode as ProtocolTaskMode, ThreadItemType, ThreadRecord, ThreadState, TurnRecord,
    TurnStatus,
};

use super::dictation::{handle_space_dictation_pressed, remove_pending_space};
use super::format::{format_model_list, format_ollama_status};
use super::{
    after_response_conversation_id, apply_background_task_result, apply_finished_startup_update,
    apply_interactive_error, expand_workspace_mentions, handle_app_server_event,
    handle_character_input, handle_input_action, hydrate_startup_state,
    input_action_for_terminal_event, poll_login_if_due, poll_sync_if_due, refresh_file_suggestions,
    replay_pending_prompt_if_due, startup_update_result, startup_update_task, submit_task_prompt,
    BackgroundTaskResult, PromptSubmissionOutcome, PromptSubmissionResult, SpaceDictationState,
    StartupUpdateResult, UiTaskQueue,
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

#[test]
fn terminal_event_mapping_covers_keys_mouse_paste_focus_and_ignored_events() {
    let mut state = crate::state::AppState::new(initialized(), Vec::new());
    assert_eq!(
        input_action_for_terminal_event(
            CrosstermEvent::Key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE)),
            &mut state,
            false,
        ),
        Some(InputAction::SubmitPrompt)
    );
    assert!(matches!(
        input_action_for_terminal_event(
            CrosstermEvent::Mouse(MouseEvent {
                kind: MouseEventKind::ScrollUp,
                column: 1,
                row: 2,
                modifiers: KeyModifiers::NONE,
            }),
            &mut state,
            false,
        ),
        Some(InputAction::ScrollUpAt { .. })
    ));
    assert_eq!(
        input_action_for_terminal_event(
            CrosstermEvent::Paste("text".to_string()),
            &mut state,
            false,
        ),
        Some(InputAction::PastePrompt("text".to_string()))
    );
    assert!(
        input_action_for_terminal_event(CrosstermEvent::FocusLost, &mut state, false).is_none()
    );
    assert!(!state.terminal_focused);
    assert!(
        input_action_for_terminal_event(CrosstermEvent::FocusGained, &mut state, false).is_none()
    );
    assert!(state.terminal_focused);
    assert!(
        input_action_for_terminal_event(CrosstermEvent::Resize(80, 24), &mut state, false)
            .is_none()
    );
}

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

async fn apply_next_background_task(state: &mut crate::state::AppState, tasks: &mut UiTaskQueue) {
    let result = tasks
        .next()
        .await
        .expect("background task should be queued")
        .expect("background task should complete");
    apply_background_task_result(state, result);
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

fn ttft_thread(turns: Vec<TurnRecord>) -> ThreadRecord {
    ThreadRecord {
        id: "ttft-thread".to_string(),
        title: "TTFT benchmark".to_string(),
        objective: "Measure first visible assistant content".to_string(),
        state: ThreadState::Active,
        archived: false,
        source: "tui-benchmark".to_string(),
        task_mode: ProtocolTaskMode::Chat,
        parent_thread_id: None,
        turns,
        created_at: 1,
        updated_at: 1,
    }
}

fn ttft_turn() -> TurnRecord {
    TurnRecord {
        id: "ttft-turn".to_string(),
        thread_id: "ttft-thread".to_string(),
        run_id: "ttft-run".to_string(),
        status: TurnStatus::InProgress,
        items: Vec::new(),
        created_at: 1,
        updated_at: 1,
    }
}

fn start_tui_ttft_server(fixture_delay: Duration) -> (String, thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("TTFT server should bind");
    let address = listener.local_addr().expect("TTFT server address");
    let server = thread::spawn(move || {
        let (mut rpc_stream, _) = listener.accept().expect("turn/start request");
        let body = read_http_body(&mut rpc_stream);
        let request: Value = serde_json::from_str(&body).expect("turn/start request JSON");
        assert_eq!(request["method"], "turn/start");

        let turn = ttft_turn();
        let response_body = rpc_response(
            request["id"].clone(),
            json!({
                "thread": ttft_thread(vec![turn.clone()]),
                "turn": turn,
                "run": run("ttft-run", RunStatus::Processing),
            }),
        );
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            response_body.len(),
            response_body
        );
        rpc_stream
            .write_all(response.as_bytes())
            .expect("turn/start response");

        let (mut event_stream, _) = listener.accept().expect("event stream request");
        let _ = read_http_body(&mut event_stream);
        thread::sleep(fixture_delay);
        let event = AppServerEvent::ItemDelta {
            thread_id: "ttft-thread".to_string(),
            turn_id: "ttft-turn".to_string(),
            item_id: "ttft-message".to_string(),
            item_type: ThreadItemType::AgentMessage,
            field: "text".to_string(),
            delta: "Seeded TUI TTFT token".to_string(),
        };
        let event_body = format!(
            "{}\n",
            json!({
                "jsonrpc": "2.0",
                "method": "event",
                "params": event,
            })
        );
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/x-ndjson\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            event_body.len(),
            event_body
        );
        event_stream
            .write_all(response.as_bytes())
            .expect("TTFT event response");
    });
    (format!("http://{address}"), server)
}

async fn sample_tui_ttft(fixture_delay: Duration) -> f64 {
    let (base_url, server) = start_tui_ttft_server(fixture_delay);
    let mut client = AppServerClient::connect_http(base_url, "ttft-session").expect("TTFT client");
    let mut state = crate::state::AppState::new(initialized(), Vec::new());
    state.set_active_thread(ttft_thread(Vec::new()));
    let mut terminal =
        ratatui::Terminal::new(ratatui::backend::TestBackend::new(120, 30)).expect("TTFT terminal");

    let started_at = Instant::now();
    submit_task_prompt(&client, &mut state, "Measure TUI TTFT".to_string())
        .await
        .expect("submit TTFT prompt");
    let event = tokio::time::timeout(Duration::from_secs(5), client.next_event())
        .await
        .expect("TTFT event timeout")
        .expect("TTFT event result")
        .expect("TTFT event");
    handle_app_server_event(&client, &mut state, event)
        .await
        .expect("apply TTFT event");
    terminal
        .draw(|frame| crate::ui::render(frame, &state))
        .expect("render first TTFT token");
    let elapsed_ms = started_at.elapsed().as_secs_f64() * 1_000.0;
    let rendered = terminal
        .backend()
        .buffer()
        .content
        .iter()
        .map(|cell| cell.symbol())
        .collect::<String>();
    assert!(rendered.contains("Seeded TUI TTFT token"));
    server.join().expect("TTFT server");
    elapsed_ms
}

fn ttft_percentile(sorted: &[f64], percentile: usize) -> f64 {
    let index = ((percentile * sorted.len()).div_ceil(100)).saturating_sub(1);
    sorted[index.min(sorted.len().saturating_sub(1))]
}

#[tokio::test]
#[ignore = "release-mode seeded TTFT benchmark; run with --ignored --nocapture"]
async fn tui_seeded_ttft_latency_benchmark() {
    let samples = std::env::var("CLIENT_TTFT_SAMPLES")
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(20)
        .max(1);
    let warmup = std::env::var("CLIENT_TTFT_WARMUP")
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(3);
    let fixture_delay = Duration::from_millis(
        std::env::var("CLIENT_TTFT_FIXTURE_DELAY_MS")
            .ok()
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or(15),
    );

    for _ in 0..warmup {
        let _ = sample_tui_ttft(fixture_delay).await;
    }

    let mut values = Vec::with_capacity(samples);
    for _ in 0..samples {
        values.push(sample_tui_ttft(fixture_delay).await);
    }
    values.sort_by(f64::total_cmp);
    let average = values.iter().sum::<f64>() / values.len() as f64;
    println!(
        "tui-submit-to-first-visible-delta samples={} p50={:.3}ms p95={:.3}ms p99={:.3}ms avg={:.3}ms min={:.3}ms max={:.3}ms",
        samples,
        ttft_percentile(&values, 50),
        ttft_percentile(&values, 95),
        ttft_percentile(&values, 99),
        average,
        values[0],
        values[values.len() - 1]
    );
}

mod formatting;
mod input_actions;
mod startup_polling;
