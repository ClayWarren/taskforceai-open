use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::thread;

use serde_json::{json, Value};
use taskforceai_app_protocol::JSONRPC_VERSION;
use taskforceai_app_protocol::{Capabilities, InitializeResult, ServerInfo, TransportInfo};

pub(crate) fn all_capabilities() -> Capabilities {
    Capabilities {
        auth: true,
        runs: true,
        history: true,
        pending_prompts: true,
        projects: true,
        attachments: true,
        context: true,
        memory: true,
        mcp: true,
        sync: true,
        events: true,
        skills: true,
        plugins: true,
        computer_use: true,
        browser: true,
        agent_sessions: true,
        threads: true,
        turns: true,
        diagnostics: true,
        channels: true,
        schedules: true,
        workflows: true,
        voice: true,
        git_review: true,
    }
}

pub(crate) fn initialized() -> InitializeResult {
    initialized_with_capabilities(all_capabilities())
}

pub(crate) fn initialized_default_capabilities() -> InitializeResult {
    initialized_with_capabilities(Capabilities::default())
}

pub(crate) fn initialized_with_capabilities(capabilities: Capabilities) -> InitializeResult {
    InitializeResult {
        server: ServerInfo::default(),
        transport: TransportInfo {
            kind: "stdio".to_string(),
            encoding: "jsonl".to_string(),
        },
        capabilities,
        negotiated: Default::default(),
    }
}

pub(crate) fn rpc_response(id: Value, result: Value) -> String {
    json!({
        "jsonrpc": JSONRPC_VERSION,
        "id": id,
        "result": result
    })
    .to_string()
}

pub(crate) fn start_rpc_sequence_server(
    responses: Vec<(&'static str, Value)>,
) -> (String, thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("rpc server should bind");
    let address = listener
        .local_addr()
        .expect("rpc address should be readable");
    let server = thread::spawn(move || {
        for (expected_method, result) in responses {
            let (mut stream, _) = listener.accept().expect("rpc request should connect");
            let body = read_http_body(&mut stream);
            let request: Value =
                serde_json::from_str(&body).expect("rpc request body should be json");
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
        }
    });
    (format!("http://{address}"), server)
}

pub(crate) fn start_recording_rpc_sequence_server(
    responses: Vec<(&'static str, Value)>,
) -> (String, thread::JoinHandle<()>, Arc<Mutex<Vec<Value>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("rpc server should bind");
    let address = listener
        .local_addr()
        .expect("rpc address should be readable");
    let requests = Arc::new(Mutex::new(Vec::new()));
    let captured = Arc::clone(&requests);
    let server = thread::spawn(move || {
        for (expected_method, result) in responses {
            let (mut stream, _) = listener.accept().expect("rpc request should connect");
            let body = read_http_body(&mut stream);
            let request: Value =
                serde_json::from_str(&body).expect("rpc request body should be json");
            assert_eq!(request["method"], expected_method);
            captured
                .lock()
                .expect("request capture lock")
                .push(request.clone());
            let response_body = rpc_response(request["id"].clone(), result);
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                response_body.len(),
                response_body
            );
            stream
                .write_all(response.as_bytes())
                .expect("rpc response should write");
        }
    });
    (format!("http://{address}"), server, requests)
}

pub(crate) fn start_http_sink_server(
    request_count: usize,
) -> (String, thread::JoinHandle<Vec<Value>>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("HTTP sink should bind");
    let address = listener.local_addr().expect("HTTP sink address");
    let server = thread::spawn(move || {
        let mut requests = Vec::with_capacity(request_count);
        for _ in 0..request_count {
            let (mut stream, _) = listener.accept().expect("HTTP sink request");
            let body = read_http_body(&mut stream);
            requests.push(serde_json::from_str(&body).expect("HTTP sink JSON body"));
            stream
                .write_all(
                    b"HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                )
                .expect("HTTP sink response");
        }
        requests
    });
    (format!("http://{address}"), server)
}

pub(crate) fn read_http_body(stream: &mut TcpStream) -> String {
    let mut buffer = Vec::new();
    let mut chunk = [0_u8; 1024];
    let header_end = loop {
        let read = stream.read(&mut chunk).expect("request should read");
        if read == 0 {
            break buffer.len();
        }
        buffer.extend_from_slice(&chunk[..read]);
        if let Some(index) = buffer.windows(4).position(|window| window == b"\r\n\r\n") {
            break index + 4;
        }
    };
    let headers = String::from_utf8_lossy(&buffer[..header_end]);
    let content_length = headers
        .lines()
        .find_map(|line| {
            let (name, value) = line.split_once(':')?;
            name.eq_ignore_ascii_case("content-length")
                .then(|| value.trim().parse::<usize>().ok())
                .flatten()
        })
        .unwrap_or(0);
    while buffer.len().saturating_sub(header_end) < content_length {
        let read = stream.read(&mut chunk).expect("request body should read");
        if read == 0 {
            break;
        }
        buffer.extend_from_slice(&chunk[..read]);
    }
    String::from_utf8_lossy(
        &buffer[header_end..header_end + content_length.min(buffer.len() - header_end)],
    )
    .to_string()
}
