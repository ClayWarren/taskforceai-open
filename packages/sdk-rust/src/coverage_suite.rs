use super::*;
use bytes::Bytes;
use chrono::Utc;
use futures_util::StreamExt;
use mockito::Server;
use std::io;

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
        .mock("POST", "/run")
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
                    data: "abc".to_string(),
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
async fn final_stream_error_paths_are_stable() {
    let mut server = Server::new_async().await;
    let _bad_final = server
        .mock("GET", "/stream/bad-final")
        .with_status(200)
        .with_body("data: {bad json}")
        .create_async()
        .await;
    let _non_data_final = server
        .mock("GET", "/stream/non-data-final")
        .with_status(200)
        .with_body("event: done")
        .create_async()
        .await;

    let client = client_with_key(server.url());
    let mut bad_final = client.stream_task_status("bad-final").await.unwrap();
    assert!(matches!(
        bad_final.next().await.unwrap(),
        Err(TaskForceAIError::Serialization(_))
    ));

    let mut non_data_final = client.stream_task_status("non-data-final").await.unwrap();
    assert!(non_data_final.next().await.is_none());
}

#[tokio::test]
async fn stream_parser_and_network_error_paths_are_stable() {
    let parsed = crate::stream::parse_sse_line(b"data: \xff\n").expect("data line should parse");
    assert!(
        matches!(parsed, Err(TaskForceAIError::Stream(ref message)) if message.contains("Invalid UTF-8"))
    );

    let mut server = Server::new_async().await;
    let _network_error = server
        .mock("GET", "/stream/network-error")
        .with_status(200)
        .with_chunked_body(|writer| {
            writer
                .write_all(
                    br#"data: {"taskId":"task-network","status":"processing"}
"#,
                )
                .expect("write initial stream chunk");
            Err(io::Error::other("stream failed"))
        })
        .create_async()
        .await;

    let client = client_with_key(server.url());
    let mut stream = client.stream_task_status("network-error").await.unwrap();
    let first = stream.next().await.unwrap();
    let event = if matches!(first, Err(TaskForceAIError::Network(_))) {
        first
    } else {
        stream.next().await.unwrap()
    };
    assert!(
        matches!(event, Err(TaskForceAIError::Network(_))),
        "unexpected stream event: {event:?}"
    );
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
        title: "bad".to_string(),
        created_at: Utc::now(),
        updated_at: Utc::now(),
    };
    assert!(
        matches!(crate::validation::validate_thread(&thread, "thread"), Err(TaskForceAIError::Validation(ref message)) if message.contains("id must be positive"))
    );

    let bad_thread_id = ThreadRunResponse {
        task_id: "task-1".to_string(),
        status: None,
        thread_id: Some(0),
        message_id: None,
    };
    assert!(
        matches!(crate::validation::validate_thread_run(&bad_thread_id), Err(TaskForceAIError::Validation(ref message)) if message.contains("thread_id must be positive"))
    );

    let bad_message_id = ThreadRunResponse {
        task_id: "task-1".to_string(),
        status: None,
        thread_id: Some(1),
        message_id: Some(0),
    };
    assert!(
        matches!(crate::validation::validate_thread_run(&bad_message_id), Err(TaskForceAIError::Validation(ref message)) if message.contains("message_id must be positive"))
    );
}
