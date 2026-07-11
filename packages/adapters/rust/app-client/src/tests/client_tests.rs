use std::path::PathBuf;
use std::time::{Duration, Instant};

use serde_json::json;
use taskforceai_app_protocol::{InitializeResult, JsonRpcResponse};

use crate::client::{
    decode_response, encode_stdio_request, request_timeout_error, request_timeout_for_method,
    REQUEST_TIMEOUT, RUN_SUBMIT_TIMEOUT,
};
use crate::{default_app_server_binary, AppClientError, AppServerClient};

static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[test]
fn response_id_matches_numeric_request_id() {
    let response: JsonRpcResponse = serde_json::from_value(json!({
        "jsonrpc": "2.0",
        "id": 7,
        "result": {"ok": true}
    }))
    .expect("response should decode");

    assert_eq!(response.id, Some(json!(7)));
}

#[test]
fn decode_response_maps_json_rpc_error() {
    let response = JsonRpcResponse {
        jsonrpc: "2.0".to_string(),
        id: Some(json!(1)),
        result: None,
        error: Some(taskforceai_app_protocol::JsonRpcError {
            code: -32601,
            message: "missing method".to_string(),
            data: None,
        }),
    };

    let result = decode_response::<serde_json::Value>(response);

    assert!(matches!(
        result,
        Err(AppClientError::Rpc {
            code: -32601,
            ref message,
        }) if message == "missing method"
    ));
}

#[test]
fn decode_response_accepts_null_result() {
    let response = JsonRpcResponse {
        jsonrpc: "2.0".to_string(),
        id: Some(json!(1)),
        result: Some(serde_json::Value::Null),
        error: None,
    };

    assert_eq!(
        decode_response::<serde_json::Value>(response).expect("null should be a result"),
        serde_json::Value::Null
    );
}

#[test]
fn decode_response_reports_missing_result() {
    let response = JsonRpcResponse {
        jsonrpc: "2.0".to_string(),
        id: Some(json!(1)),
        result: None,
        error: None,
    };

    assert!(matches!(
        decode_response::<serde_json::Value>(response),
        Err(AppClientError::MissingResult)
    ));
}

#[test]
fn decode_response_reports_result_type_mismatch() {
    let response = JsonRpcResponse {
        jsonrpc: "2.0".to_string(),
        id: Some(json!(1)),
        result: Some(json!({"transport": {"kind": 7}})),
        error: None,
    };

    assert!(matches!(
        decode_response::<InitializeResult>(response),
        Err(AppClientError::Decode(_))
    ));
}

#[test]
fn default_app_server_binary_honors_env_override() {
    let _guard = ENV_LOCK.lock().expect("env lock should not be poisoned");
    let previous = std::env::var_os("TASKFORCEAI_APP_SERVER");
    std::env::set_var("TASKFORCEAI_APP_SERVER", "/tmp/taskforceai-app-server");

    assert_eq!(
        default_app_server_binary(),
        PathBuf::from("/tmp/taskforceai-app-server")
    );

    if let Some(previous) = previous {
        std::env::set_var("TASKFORCEAI_APP_SERVER", previous);
    } else {
        std::env::remove_var("TASKFORCEAI_APP_SERVER");
    }
}

#[test]
fn default_app_server_binary_prefers_sibling_then_manifest_fallback() {
    let _guard = ENV_LOCK.lock().expect("env lock should not be poisoned");
    let previous = std::env::var_os("TASKFORCEAI_APP_SERVER");
    std::env::remove_var("TASKFORCEAI_APP_SERVER");

    let exe = std::env::current_exe().expect("test binary path should resolve");
    let sibling = exe
        .parent()
        .expect("test binary should have a parent")
        .join(if cfg!(windows) {
            "taskforceai-app-server.exe"
        } else {
            "taskforceai-app-server"
        });
    let created_sibling = !sibling.exists();
    if created_sibling {
        std::fs::write(&sibling, b"").expect("write sibling app-server marker");
    }

    assert_eq!(default_app_server_binary(), sibling);

    if created_sibling {
        std::fs::remove_file(&sibling).expect("remove sibling app-server marker");
        let fallback_name = if cfg!(windows) {
            "taskforceai-app-server.exe"
        } else {
            "taskforceai-app-server"
        };
        assert!(default_app_server_binary()
            .ends_with(format!("apps/app-server/target/debug/{fallback_name}")));
    }

    if let Some(previous) = previous {
        std::env::set_var("TASKFORCEAI_APP_SERVER", previous);
    }
}

#[test]
fn connect_http_rejects_invalid_auth_token() {
    assert!(matches!(
        AppServerClient::connect_http("http://127.0.0.1:1", "bad\nsession"),
        Err(AppClientError::InvalidAuthToken)
    ));
}

#[test]
fn run_submit_uses_extended_timeout() {
    assert_eq!(request_timeout_for_method("initialize"), REQUEST_TIMEOUT);
    assert_eq!(request_timeout_for_method("run.submit"), RUN_SUBMIT_TIMEOUT);
    assert!(matches!(
        request_timeout_error("slow.method", Duration::from_millis(123)),
        AppClientError::RequestTimeout {
            ref method,
            timeout_ms: 123
        } if method == "slow.method"
    ));
}

#[test]
#[ignore = "performance baseline for stdio request encoding"]
fn perf_stdio_request_encoding_conversation_upsert() {
    const REQUESTS: usize = 20_000;
    const SAMPLES: usize = 5;
    let params = json!({
        "conversation_id": "conv-perf",
        "title": "Performance conversation",
        "created_at": 1_783_000_000_000_i64,
        "updated_at": 1_783_000_001_000_i64,
        "last_message_preview": "A representative request payload for stdio RPC encoding",
        "archived": false
    });
    let mut durations = Vec::with_capacity(SAMPLES);
    let mut encoded_bytes = 0;

    for _ in 0..SAMPLES {
        let started = Instant::now();
        for id in 0..REQUESTS {
            let line = encode_stdio_request(id as u64, "conversation.upsert", &params)
                .expect("request should encode");
            encoded_bytes += line.len();
        }
        durations.push(started.elapsed());
    }

    assert!(encoded_bytes > 0);
    durations.sort_unstable();
    let best = durations[0];
    let median = durations[SAMPLES / 2];
    println!(
        "perf_stdio_request_encoding_conversation_upsert best={}ns/request median={}ns/request best_total={best:?} median_total={median:?}",
        best.as_nanos() / REQUESTS as u128,
        median.as_nanos() / REQUESTS as u128,
    );
}
