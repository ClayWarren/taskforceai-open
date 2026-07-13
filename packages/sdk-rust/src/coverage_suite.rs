use super::*;
use bytes::Bytes;
use chrono::Utc;
use futures_util::StreamExt;
use mockito::Server;
use std::io::{self, Read, Write};
use std::net::TcpListener;
use std::thread;

fn mock_client() -> TaskForceAI {
    TaskForceAI::new(TaskForceAIOptions {
        mock_mode: Some(true),
        ..Default::default()
    })
    .unwrap()
}

fn client_with_key(base_url: String) -> TaskForceAI {
    TaskForceAI::new(TaskForceAIOptions {
        base_url: Some(base_url),
        api_key: Some("key".to_string()),
        ..Default::default()
    })
    .unwrap()
}

fn spawn_truncated_stream_server() -> (String, thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("stream fixture should bind");
    let address = listener.local_addr().expect("stream fixture address");
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("stream fixture should accept");
        let mut request = Vec::new();
        let mut buffer = [0_u8; 1024];
        loop {
            let read = stream
                .read(&mut buffer)
                .expect("stream fixture should read request");
            if read == 0 {
                break;
            }
            request.extend_from_slice(&buffer[..read]);
            if request.windows(4).any(|window| window == b"\r\n\r\n") {
                break;
            }
        }
        let request = String::from_utf8_lossy(&request);
        assert!(request.starts_with("GET /stream/network-error "));

        let first_chunk = br#"data: {"taskId":"task-network","status":"processing"}
"#;
        stream
            .write_all(
                b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n",
            )
            .expect("stream fixture should write response headers");
        write!(stream, "{:x}\r\n", first_chunk.len())
            .expect("stream fixture should write first chunk length");
        stream
            .write_all(first_chunk)
            .expect("stream fixture should write first chunk");
        stream
            .write_all(b"\r\n8\r\npartial")
            .expect("stream fixture should write truncated chunk");
        stream
            .flush()
            .expect("stream fixture should flush response");
    });
    (format!("http://{address}"), server)
}

fn spawn_delayed_stream_server() -> (String, thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("stream fixture should bind");
    let address = listener.local_addr().expect("stream fixture address");
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("stream fixture should accept");
        let mut request = [0_u8; 1024];
        let _ = stream.read(&mut request).expect("stream fixture request");
        thread::sleep(std::time::Duration::from_millis(30));
        let body =
            b"data: {\"taskId\":\"task-slow\",\"status\":\"completed\",\"result\":\"done\"}\n\n";
        write!(
            stream,
            "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        )
        .expect("stream fixture headers");
        stream.write_all(body).expect("stream fixture body");
    });
    (format!("http://{address}"), server)
}

#[tokio::test]
async fn stream_uses_client_without_total_request_timeout() {
    let (server_url, server) = spawn_delayed_stream_server();
    let client = TaskForceAI {
        api_key: "key".to_string(),
        base_url: server_url,
        mock_mode: false,
        client: reqwest::Client::builder()
            .timeout(std::time::Duration::from_millis(5))
            .build()
            .unwrap(),
        stream_client: reqwest::Client::builder().build().unwrap(),
    };

    let mut stream = client.stream_task_status("task-slow").await.unwrap();
    let status = stream.next().await.unwrap().unwrap();
    assert_eq!(status.status, TaskStatusValue::Completed);
    server.join().expect("stream fixture should finish");
}

#[tokio::test]
async fn mock_mode_covers_fallback_and_empty_status_validation() {
    let client = mock_client();
    let fallback: Result<serde_json::Value, TaskForceAIError> =
        client.request(reqwest::Method::GET, "/health", None).await;
    assert_eq!(fallback.unwrap(), serde_json::json!({ "status": "ok" }));

    let status = client.get_task_status("mock-task").await.unwrap();
    assert_eq!(status.status, TaskStatusValue::Completed);

    let empty = client.get_task_status(" \n\t").await;
    assert!(matches!(empty, Err(TaskForceAIError::EmptyTaskId)));
}

#[tokio::test]
async fn submit_task_handles_empty_and_populated_image_options() {
    let mut server = Server::new_async().await;
    let _empty_images = server
        .mock("POST", "/run")
        .with_status(200)
        .with_body(r#"{"taskId":"empty-images"}"#)
        .create_async()
        .await;
    let _with_images = server
        .mock("POST", "/attachments/upload")
        .with_status(200)
        .with_body(r#"{"id":"attachment-image-1","mime_type":"image/png","size":5}"#)
        .create_async()
        .await;
    let _run_with_images = server
        .mock("POST", "/run")
        .match_body(mockito::Matcher::Regex(
            r#""attachment_ids":\["attachment-image-1"\]"#.to_string(),
        ))
        .with_status(200)
        .with_body(r#"{"taskId":"with-images"}"#)
        .create_async()
        .await;

    let client = client_with_key(server.url());
    let empty = client
        .submit_task(
            "hello",
            Some(TaskSubmissionOptions {
                images: Some(vec![]),
                ..Default::default()
            }),
        )
        .await
        .unwrap();
    assert_eq!(empty, "empty-images");

    let with_images = client
        .submit_task(
            "hello",
            Some(TaskSubmissionOptions {
                images: Some(vec![ImageAttachment {
                    data: "aGVsbG8=".to_string(),
                    mime_type: "image/png".to_string(),
                    name: None,
                    detail: None,
                }]),
                ..Default::default()
            }),
        )
        .await
        .unwrap();
    assert_eq!(with_images, "with-images");
}

#[tokio::test]
async fn submit_task_handles_options_without_images() {
    let mut server = Server::new_async().await;
    let _task = server
        .mock("POST", "/run")
        .with_status(200)
        .with_body(r#"{"taskId":"without-images"}"#)
        .create_async()
        .await;

    let client = client_with_key(server.url());
    let task_id = client
        .submit_task(
            "hello",
            Some(TaskSubmissionOptions {
                model_id: Some("model-a".to_string()),
                ..Default::default()
            }),
        )
        .await
        .unwrap();
    assert_eq!(task_id, "without-images");
}

#[tokio::test]
async fn submit_task_reports_invalid_image_base64() {
    let client = client_with_key("http://127.0.0.1:1".to_string());

    let result = client
        .submit_task(
            "hello",
            Some(TaskSubmissionOptions {
                images: Some(vec![ImageAttachment {
                    data: "data:image/png;base64,not-base64!".to_string(),
                    mime_type: "image/png".to_string(),
                    name: Some("bad.png".to_string()),
                    detail: None,
                }]),
                ..Default::default()
            }),
        )
        .await;

    assert!(
        matches!(result, Err(TaskForceAIError::Other(ref message)) if message.contains("Failed to decode image attachment 0"))
    );
}

#[tokio::test]
async fn upload_attachment_error_paths_are_reported() {
    let invalid_mime_client = client_with_key("http://127.0.0.1:1".to_string());
    let invalid_mime = invalid_mime_client
        .upload_attachment("bad.bin", Bytes::from_static(b"bad"), Some("invalid mime"))
        .await;
    assert!(matches!(invalid_mime, Err(TaskForceAIError::Other(_))));

    let mut empty_id_server = Server::new_async().await;
    let _empty_id = empty_id_server
        .mock("POST", "/attachments/upload")
        .with_status(200)
        .with_body(r#"{"id":""}"#)
        .create_async()
        .await;
    let empty_id_client = client_with_key(empty_id_server.url());
    let empty_id = empty_id_client
        .upload_attachment("empty.bin", Bytes::from_static(b"empty"), None)
        .await;
    assert!(
        matches!(empty_id, Err(TaskForceAIError::Other(ref message)) if message.contains("id is required"))
    );

    let mut api_error_server = Server::new_async().await;
    let _api_error = api_error_server
        .mock("POST", "/attachments/upload")
        .with_status(413)
        .with_body("attachment too large")
        .create_async()
        .await;
    let api_error_client = client_with_key(api_error_server.url());
    let api_error = api_error_client
        .upload_attachment("large.bin", Bytes::from_static(b"large"), None)
        .await;
    assert!(matches!(
        api_error,
        Err(TaskForceAIError::Api { status, ref message })
            if status == reqwest::StatusCode::PAYLOAD_TOO_LARGE && message == "attachment too large"
    ));

    let mut body_error_server = Server::new_async().await;
    let _body_error = body_error_server
        .mock("POST", "/attachments/upload")
        .with_status(500)
        .with_chunked_body(|writer| {
            writer.write_all(b"partial")?;
            Err(io::Error::other("broken error body"))
        })
        .create_async()
        .await;
    let body_error_client = client_with_key(body_error_server.url());
    let body_error = body_error_client
        .upload_attachment("broken.bin", Bytes::from_static(b"broken"), None)
        .await;
    assert!(matches!(
        body_error,
        Err(TaskForceAIError::Api { status, ref message })
            if status == reqwest::StatusCode::INTERNAL_SERVER_ERROR
                && message == "Failed to read error message"
    ));
}

#[tokio::test]
async fn upload_error_and_download_size_guards_are_reported() {
    let mut server = Server::new_async().await;
    let _upload_error = server
        .mock("POST", "/files")
        .with_status(415)
        .with_body("Unsupported Media Type")
        .create_async()
        .await;
    let client = client_with_key(server.url());
    let upload = client
        .upload_file("bad.bin", Bytes::from_static(b"bad"), None)
        .await;
    assert!(matches!(
        upload,
        Err(TaskForceAIError::Api { status, ref message })
            if status == 415 && message == "Unsupported Media Type"
    ));
}

#[tokio::test]
async fn download_file_covers_content_length_and_streaming_size_guards() {
    let mut server = Server::new_async().await;
    let _small = server
        .mock("GET", "/files/small/content")
        .with_status(200)
        .with_header("content-length", "4")
        .with_body("data")
        .create_async()
        .await;
    let _chunked_too_large = server
        .mock("GET", "/files/chunked/content")
        .with_status(200)
        .with_chunked_body(|writer| writer.write_all(b"0123456789abcdef0"))
        .create_async()
        .await;

    let client = client_with_key(server.url());
    assert_eq!(
        client.download_file("small").await.unwrap(),
        Bytes::from_static(b"data")
    );
    let chunked = client.download_file("chunked").await;
    assert!(
        matches!(chunked, Err(TaskForceAIError::Other(ref message)) if message.contains("limit"))
    );
}

#[tokio::test]
async fn stream_parser_and_network_error_paths_are_stable() {
    let parsed = crate::stream::parse_sse_line(b"data: \xff\n").expect("data line should parse");
    assert!(
        matches!(parsed, Err(TaskForceAIError::Stream(ref message)) if message.contains("Invalid UTF-8"))
    );

    let (server_url, server) = spawn_truncated_stream_server();
    let client = client_with_key(server_url);
    let mut stream = client.stream_task_status("network-error").await.unwrap();
    let first = stream.next().await.unwrap().unwrap();
    assert_eq!(first.task_id, "task-network");
    let event = stream.next().await.unwrap();
    assert!(
        matches!(event, Err(TaskForceAIError::Network(_))),
        "unexpected stream event: {event:?}"
    );
    server.join().expect("stream fixture should finish");
}

#[test]
fn validation_numeric_edges_are_reported() {
    let file = File {
        id: "file-1".to_string(),
        filename: "bad.bin".to_string(),
        purpose: "assistants".to_string(),
        bytes: -1,
        created_at: Utc::now(),
        mime_type: None,
    };
    assert!(
        matches!(crate::validation::validate_file(&file, "file"), Err(TaskForceAIError::Validation(ref message)) if message.contains("bytes must be non-negative"))
    );

    let thread = Thread {
        id: 0,
        timestamp: "now".to_string(),
        user_input: "bad".to_string(),
        result: String::new(),
        execution_time: 0,
        model: String::new(),
        agent_count: 0,
        sources: Some(Vec::new()),
        agent_statuses: Some(Vec::new()),
        tool_events: Some(Vec::new()),
    };
    assert!(
        matches!(crate::validation::validate_thread(&thread, "thread"), Err(TaskForceAIError::Validation(ref message)) if message.contains("id must be positive"))
    );

    let missing_status = ThreadRunResponse {
        task_id: "task-1".to_string(),
        status: String::new(),
    };
    assert!(
        matches!(crate::validation::validate_thread_run(&missing_status), Err(TaskForceAIError::Validation(ref message)) if message.contains("status is required"))
    );
}
