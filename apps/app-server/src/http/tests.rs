use std::{
    hint::black_box,
    io::{Read as _, Write as _},
    thread,
    time::{Duration, Instant},
};

use super::*;
use crate::api::{ApiRemoteCommand, ApiRemoteCommandPoll};
use taskforceai_app_protocol::{DynamicToolCallParams, InteractionContext, ServerRequestPayload};

async fn test_state(pairing_code: &str, session_token: &str) -> Arc<HttpServerState> {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());
    let server_info = runtime.config.server_info.clone();
    let (runtime_event_tx, runtime_event_rx) = mpsc::channel(128);
    runtime.set_event_sender(runtime_event_tx);
    let (runtime_commands, runtime_command_rx) = mpsc::channel(512);
    let (runtime_outputs, runtime_output_rx) = mpsc::unbounded_channel();
    let (interaction_output_tx, mut interaction_output_rx) = mpsc::channel(32);
    let interaction_broker = InteractionBroker::new(interaction_output_tx);
    runtime.set_interaction_broker(interaction_broker.clone());
    let (events, _) = broadcast::channel(128);
    let state = Arc::new(HttpServerState {
        runtime_commands,
        interaction_broker,
        server_info,
        pairing_code: Mutex::new(Some(pairing_code.to_string())),
        session_token: session_token.to_string(),
        mobile_session_tokens: Mutex::new(Vec::new()),
        mobile_push_tokens: Mutex::new(BTreeMap::new()),
        events,
        event_backlog: Mutex::new(VecDeque::with_capacity(EVENT_BACKLOG_CAPACITY)),
        connection_slots: Arc::new(Semaphore::new(MAX_HTTP_CONNECTIONS)),
        stats: HttpTransportStats::default(),
        shutdown: Notify::new(),
    });
    tokio::spawn(http_runtime_loop(
        runtime,
        runtime_command_rx,
        runtime_event_rx,
        runtime_outputs.clone(),
        Arc::clone(&state),
    ));
    tokio::spawn(http_runtime_output_loop(
        Arc::clone(&state),
        runtime_output_rx,
    ));
    let interaction_outputs = runtime_outputs.clone();
    tokio::spawn(async move {
        while let Some(message) = interaction_output_rx.recv().await {
            if interaction_outputs.send(vec![message]).is_err() {
                break;
            }
        }
    });
    for raw in [
        r#"{"jsonrpc":"2.0","id":0,"method":"initialize","params":{}}"#,
        r#"{"jsonrpc":"2.0","method":"initialized","params":{}}"#,
    ] {
        let request = serde_json::from_str(raw).expect("test handshake should parse");
        let (response, _) = handle_rpc_request(request, Arc::clone(&state)).await;
        if raw.contains("\"id\":0") {
            assert!(response.is_some_and(|response| response.error.is_none()));
        }
    }
    state
}

fn notification(index: usize) -> OutgoingMessage {
    OutgoingMessage::Notification(crate::protocol::JsonRpcNotification {
        jsonrpc: JSONRPC_VERSION.to_string(),
        method: "event".to_string(),
        params: json!({ "index": index }),
    })
}

fn start_remote_response_server(
    responses: Vec<(String, Vec<(&'static str, &'static str)>)>,
) -> (String, thread::JoinHandle<()>) {
    let listener =
        std::net::TcpListener::bind("127.0.0.1:0").expect("mock Remote server should bind");
    let address = listener
        .local_addr()
        .expect("mock Remote server address should be readable");
    let handle = thread::spawn(move || {
        for (body, headers) in responses {
            let (mut stream, _) = listener.accept().expect("Remote request should arrive");
            read_mock_http_request(&mut stream);
            let mut response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n",
                body.len()
            );
            for (name, value) in headers {
                response.push_str(name);
                response.push_str(": ");
                response.push_str(value);
                response.push_str("\r\n");
            }
            response.push_str("\r\n");
            response.push_str(&body);
            stream
                .write_all(response.as_bytes())
                .expect("Remote response should write");
        }
    });
    (format!("http://{address}"), handle)
}

fn read_mock_http_request(stream: &mut std::net::TcpStream) {
    let mut buffer = Vec::new();
    let mut chunk = [0_u8; 1024];
    let header_end = loop {
        let read = stream.read(&mut chunk).expect("request should be readable");
        if read == 0 {
            return;
        }
        buffer.extend_from_slice(&chunk[..read]);
        if let Some(index) = buffer.windows(4).position(|window| window == b"\r\n\r\n") {
            break index + 4;
        }
    };
    let content_length = String::from_utf8_lossy(&buffer[..header_end])
        .lines()
        .find_map(|line| {
            let (name, value) = line.split_once(':')?;
            name.eq_ignore_ascii_case("content-length")
                .then(|| value.trim().parse::<usize>().ok())
                .flatten()
        })
        .unwrap_or(0);
    while buffer.len().saturating_sub(header_end) < content_length {
        let read = stream.read(&mut chunk).expect("body should be readable");
        if read == 0 {
            break;
        }
        buffer.extend_from_slice(&chunk[..read]);
    }
}

fn remote_tool_request() -> ServerRequestPayload {
    ServerRequestPayload::DynamicToolCall(DynamicToolCallParams {
        context: InteractionContext {
            thread_id: "thread-remote".to_string(),
            turn_id: Some("turn-remote".to_string()),
        },
        call_id: "call-remote".to_string(),
        namespace: Some("browser".to_string()),
        tool: "navigate".to_string(),
        arguments: json!({"url": "https://example.com"}),
    })
}

include!("tests/remote_and_pairing.rs");
include!("tests/routes_and_transport.rs");
