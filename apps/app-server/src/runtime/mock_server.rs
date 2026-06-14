use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::thread;

use serde_json::json;

use super::error::RuntimeError;
use super::util::unix_millis;
use super::MOCK_RESULT;

#[derive(Debug)]
pub(crate) struct MockServerHandle {
    port: u16,
    stop: Arc<AtomicBool>,
    thread: Option<thread::JoinHandle<()>>,
}

impl MockServerHandle {
    pub(super) fn start(port: u16) -> Result<Self, RuntimeError> {
        let listener = TcpListener::bind(("127.0.0.1", port)).map_err(|err| {
            RuntimeError::not_configured(format!("failed to start mock API: {err}"))
        })?;
        let port = listener
            .local_addr()
            .map_err(|err| {
                RuntimeError::not_configured(format!("failed to read mock API port: {err}"))
            })?
            .port();
        listener.set_nonblocking(true).map_err(|err| {
            RuntimeError::not_configured(format!("failed to configure mock API: {err}"))
        })?;

        let stop = Arc::new(AtomicBool::new(false));
        let stop_thread = Arc::clone(&stop);
        let calls = Arc::new(Mutex::new(BTreeMap::new()));
        let calls_thread = Arc::clone(&calls);
        let thread = thread::spawn(move || {
            while !stop_thread.load(Ordering::SeqCst) {
                match listener.accept() {
                    Ok((stream, _)) => handle_mock_stream(stream, &calls_thread),
                    Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(std::time::Duration::from_millis(20));
                    }
                    Err(_) => break,
                }
            }
        });

        Ok(Self {
            port,
            stop,
            thread: Some(thread),
        })
    }

    pub(super) fn endpoint(&self) -> String {
        format!("http://localhost:{}/api/v1/developer", self.port)
    }

    pub(super) fn stop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        let _ = TcpStream::connect(("127.0.0.1", self.port));
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

impl Drop for MockServerHandle {
    fn drop(&mut self) {
        self.stop();
    }
}

fn handle_mock_stream(mut stream: TcpStream, calls: &Arc<Mutex<BTreeMap<String, u32>>>) {
    let mut buffer = [0_u8; 4096];
    let read = stream.read(&mut buffer).unwrap_or(0);
    let request = String::from_utf8_lossy(&buffer[..read]);
    let mut lines = request.lines();
    let request_line = lines.next().unwrap_or_default();
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or_default();
    let path = parts.next().unwrap_or("/");

    let (status, body) = mock_response(method, path, calls);
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, x-api-key\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

pub(crate) fn mock_response(
    method: &str,
    path: &str,
    calls: &Arc<Mutex<BTreeMap<String, u32>>>,
) -> (&'static str, String) {
    if method == "OPTIONS" {
        return ("200 OK", "{}".to_string());
    }

    if method == "POST" && path == "/api/v1/developer/run" {
        let task_id = format!("mock-{}", unix_millis());
        calls
            .lock()
            .expect("mock calls mutex should lock")
            .insert(task_id.clone(), 0);
        return (
            "200 OK",
            json!({"taskId": task_id, "status": "processing"}).to_string(),
        );
    }

    if method == "GET" && path.starts_with("/api/v1/developer/status/") {
        let task_id = path.trim_start_matches("/api/v1/developer/status/");
        if task_id.is_empty() {
            return (
                "400 Bad Request",
                json!({"error":"Task ID required"}).to_string(),
            );
        }
        let count = {
            let mut guard = calls.lock().expect("mock calls mutex should lock");
            let count = *guard.get(task_id).unwrap_or(&0);
            guard.insert(task_id.to_string(), count + 1);
            count
        };
        if count < 1 {
            return (
                "200 OK",
                json!({"taskId": task_id, "status": "processing", "message": "Mock task processing..."})
                    .to_string(),
            );
        }
        return (
            "200 OK",
            json!({"taskId": task_id, "status": "completed", "result": MOCK_RESULT}).to_string(),
        );
    }

    if method == "GET" && path.starts_with("/api/v1/developer/results/") {
        let task_id = path.trim_start_matches("/api/v1/developer/results/");
        if task_id.is_empty() {
            return (
                "400 Bad Request",
                json!({"error":"Task ID required"}).to_string(),
            );
        }
        return (
            "200 OK",
            json!({"taskId": task_id, "status": "completed", "result": MOCK_RESULT}).to_string(),
        );
    }

    if method == "GET" && path == "/" {
        return (
            "200 OK",
            json!({
                "service": "TaskForceAI Mock API",
                "status": "running",
                "endpoints": [
                    "POST /api/v1/developer/run",
                    "GET /api/v1/developer/status/:taskId",
                    "GET /api/v1/developer/results/:taskId"
                ]
            })
            .to_string(),
        );
    }

    (
        "404 Not Found",
        json!({"error":"Not found", "path": path}).to_string(),
    )
}
