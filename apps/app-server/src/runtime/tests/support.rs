use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::thread;

use serde_json::Value;

use crate::protocol::{AppResponse, MetadataSetParams, SubmitRunParams};

use super::{unix_millis, AppRuntime};

pub(super) fn result_value(response: AppResponse) -> Value {
    match response {
        AppResponse::Value(value) => value,
        AppResponse::WithEvents { result, .. } | AppResponse::Shutdown(result) => result,
    }
}

pub(super) fn submit_run_params(prompt: &str) -> SubmitRunParams {
    SubmitRunParams {
        prompt: prompt.to_string(),
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
        private_chat: false,
        research_workflow: None,
    }
}

pub(super) fn set_auth_token(runtime: &mut AppRuntime, token: &str) {
    runtime
        .metadata_set(MetadataSetParams {
            key: "auth_token".to_string(),
            value: token.to_string(),
        })
        .expect("auth token should persist");
}

pub(super) struct MockHttpResponse {
    pub(super) body: String,
    pub(super) headers: Vec<(&'static str, &'static str)>,
}

#[derive(Debug, Clone)]
pub(super) struct RecordedHttpRequest {
    pub(super) method: String,
    pub(super) path: String,
    pub(super) headers: BTreeMap<String, String>,
    pub(super) body: String,
}

pub(super) fn json_response(body: String) -> MockHttpResponse {
    MockHttpResponse {
        body,
        headers: Vec::new(),
    }
}

pub(super) fn start_response_sequence_server(
    responses: Vec<MockHttpResponse>,
) -> (String, thread::JoinHandle<()>) {
    let (base_url, handle, _) = start_recording_response_sequence_server(responses);
    (base_url, handle)
}

pub(super) fn start_recording_response_sequence_server(
    responses: Vec<MockHttpResponse>,
) -> (
    String,
    thread::JoinHandle<()>,
    Arc<Mutex<Vec<RecordedHttpRequest>>>,
) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("mock sync server should bind");
    let address = listener
        .local_addr()
        .expect("mock sync address should be readable");
    let requests = Arc::new(Mutex::new(Vec::new()));
    let recorded_requests = Arc::clone(&requests);
    let handle = thread::spawn(move || {
        for mock_response in responses {
            let (mut stream, _) = listener.accept().expect("mock sync request should arrive");
            let request = read_http_request(&mut stream);
            recorded_requests
                .lock()
                .expect("recorded requests lock should not poison")
                .push(request);
            let mut response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n",
                mock_response.body.len()
            );
            for (name, value) in mock_response.headers {
                response.push_str(name);
                response.push_str(": ");
                response.push_str(value);
                response.push_str("\r\n");
            }
            response.push_str("\r\n");
            response.push_str(&mock_response.body);
            stream
                .write_all(response.as_bytes())
                .expect("mock sync response should write");
        }
    });
    (format!("http://{address}"), handle, requests)
}

fn read_http_request(stream: &mut std::net::TcpStream) -> RecordedHttpRequest {
    let mut buffer = Vec::new();
    let mut chunk = [0_u8; 1024];
    let header_end = loop {
        let read = stream
            .read(&mut chunk)
            .expect("mock request should be readable");
        if read == 0 {
            break buffer.len();
        }
        buffer.extend_from_slice(&chunk[..read]);
        if let Some(index) = buffer.windows(4).position(|window| window == b"\r\n\r\n") {
            break index + 4;
        }
    };
    let headers_text = String::from_utf8_lossy(&buffer[..header_end]).to_string();
    let mut lines = headers_text.split("\r\n");
    let request_line = lines.next().unwrap_or_default();
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts.next().unwrap_or_default().to_string();
    let path = request_parts.next().unwrap_or_default().to_string();
    let mut headers = BTreeMap::new();
    for line in lines.filter(|line| !line.is_empty()) {
        if let Some((name, value)) = line.split_once(':') {
            headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_string());
        }
    }

    let content_length = headers
        .get("content-length")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0);
    while buffer.len().saturating_sub(header_end) < content_length {
        let read = stream
            .read(&mut chunk)
            .expect("mock request body should be readable");
        if read == 0 {
            break;
        }
        buffer.extend_from_slice(&chunk[..read]);
    }
    let body = String::from_utf8_lossy(
        &buffer
            [header_end..header_end + content_length.min(buffer.len().saturating_sub(header_end))],
    )
    .to_string();

    RecordedHttpRequest {
        method,
        path,
        headers,
        body,
    }
}

pub(super) fn test_store_path(name: &str) -> PathBuf {
    std::env::temp_dir().join(format!(
        "taskforceai-app-server-{name}-{}-{}.sqlite3",
        std::process::id(),
        unix_millis()
    ))
}
