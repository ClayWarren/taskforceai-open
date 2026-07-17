use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::{Arc, Mutex};

use super::mock_server::{mock_response, MockServerHandle};
use super::MOCK_RESULT;

#[test]
fn mock_response_covers_preflight_empty_ids_and_not_found() {
    let calls = Arc::new(Mutex::new(BTreeMap::new()));

    let (status, body) = mock_response("OPTIONS", "/anything", &calls);
    assert_eq!(status, "200 OK");
    assert_eq!(body, "{}");

    let (status, body) = mock_response("GET", "/api/v1/developer/status/", &calls);
    assert_eq!(status, "400 Bad Request");
    assert!(body.contains("Task ID required"));

    let (status, body) = mock_response("GET", "/api/v1/developer/results/", &calls);
    assert_eq!(status, "400 Bad Request");
    assert!(body.contains("Task ID required"));

    let (status, body) = mock_response("DELETE", "/missing", &calls);
    assert_eq!(status, "404 Not Found");
    assert!(body.contains("/missing"));
}

#[test]
fn mock_server_handle_serves_http_requests_and_rejects_busy_port() {
    let server = MockServerHandle::start(0).expect("mock server should start");
    let endpoint = server.endpoint();
    let port = endpoint_port(&endpoint);

    let busy = MockServerHandle::start(port).expect_err("busy port should fail");
    assert!(busy.message.contains("failed to start mock API"));

    let root = send_request_with_retry(port, "GET", "/", "TaskForceAI Mock API");
    assert!(root.contains("200 OK"));
    assert!(root.contains("TaskForceAI Mock API"));

    let created = send_request(port, "POST", "/api/v1/developer/run");
    assert!(created.contains("\"status\":\"processing\""));
    let task_id = created
        .split("\"taskId\":\"")
        .nth(1)
        .and_then(|rest| rest.split('"').next())
        .expect("task id should be present")
        .to_string();

    let processing = send_request(port, "GET", &format!("/api/v1/developer/status/{task_id}"));
    assert!(processing.contains("Mock task processing"));

    let completed = send_request(port, "GET", &format!("/api/v1/developer/status/{task_id}"));
    assert!(completed.contains(MOCK_RESULT));

    let result = send_request(port, "GET", &format!("/api/v1/developer/results/{task_id}"));
    assert!(result.contains(MOCK_RESULT));
}

fn endpoint_port(endpoint: &str) -> u16 {
    endpoint
        .strip_prefix("http://localhost:")
        .expect("mock endpoint should use localhost")
        .split('/')
        .next()
        .expect("port should be present")
        .parse()
        .expect("port should parse")
}

fn send_request(port: u16, method: &str, path: &str) -> String {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
    let mut last_error = None;
    while std::time::Instant::now() < deadline {
        match send_request_once(port, method, path) {
            Ok(response) if !response.is_empty() => return response,
            Ok(_) => {}
            Err(error) => last_error = Some(error),
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    }

    if let Some(error) = last_error {
        panic!("response should read: {error}");
    }

    panic!("response should not be empty");
}

fn send_request_once(port: u16, method: &str, path: &str) -> std::io::Result<String> {
    let mut stream = TcpStream::connect(("127.0.0.1", port))?;
    let request =
        format!("{method} {path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
    stream.write_all(request.as_bytes())?;
    let mut response = String::new();
    stream.read_to_string(&mut response)?;
    Ok(response)
}

fn send_request_with_retry(port: u16, method: &str, path: &str, expected: &str) -> String {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
    let mut last_response = String::new();
    while std::time::Instant::now() < deadline {
        last_response = send_request(port, method, path);
        if last_response.contains(expected) {
            return last_response;
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    last_response
}
