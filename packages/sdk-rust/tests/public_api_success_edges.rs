mod common;

use bytes::Bytes;
use common::client_with_key;
use futures_util::StreamExt;
use mockito::{Matcher, Server};
use std::collections::HashMap;
use std::time::Duration;
use taskforceai_sdk::{
    CreateThreadOptions, FileUploadOptions, ImageAttachment, TaskForceAI, TaskForceAIError,
    TaskForceAIOptions, TaskStatusValue, TaskSubmissionOptions, ThreadRunOptions,
};

#[tokio::test]
async fn submit_task_sends_options_and_image_attachments() {
    let mut server = Server::new_async().await;
    let _mock = server
        .mock("POST", "/run")
        .match_body(Matcher::AllOf(vec![
            Matcher::Regex(r#""prompt":"describe image""#.to_string()),
            Matcher::Regex(r#""modelId":"model-1""#.to_string()),
            Matcher::Regex(r#""attachments":\[\{"data":"abc","#.to_string()),
        ]))
        .with_status(200)
        .with_body(r#"{"taskId":"task-with-options"}"#)
        .create_async()
        .await;

    let client = client_with_key(server.url());
    let task_id = client
        .submit_task(
            "describe image",
            Some(TaskSubmissionOptions {
                model_id: Some("model-1".to_string()),
                images: Some(vec![ImageAttachment {
                    data: "abc".to_string(),
                    mime_type: "image/png".to_string(),
                    name: Some("image.png".to_string()),
                    detail: None,
                }]),
                ..Default::default()
            }),
        )
        .await
        .unwrap();

    assert_eq!(task_id, "task-with-options");
}

#[tokio::test]
async fn wait_for_completion_maps_failed_without_error_and_timeout() {
    let mut failed_server = Server::new_async().await;
    let _failed = failed_server
        .mock("GET", "/status/task-failed")
        .with_status(200)
        .with_body(r#"{"taskId":"task-failed","status":"failed"}"#)
        .create_async()
        .await;

    let failed_client = client_with_key(failed_server.url());
    let failed = failed_client
        .wait_for_completion("task-failed", Some(Duration::from_millis(1)), Some(1))
        .await;
    assert!(matches!(
        failed,
        Err(TaskForceAIError::TaskFailed(ref message)) if message == "Unknown error"
    ));

    let mut processing_server = Server::new_async().await;
    let _processing = processing_server
        .mock("GET", "/status/task-processing")
        .with_status(200)
        .with_body(r#"{"taskId":"task-processing","status":"processing"}"#)
        .expect(1)
        .create_async()
        .await;

    let processing_client = client_with_key(processing_server.url());
    let timeout = processing_client
        .wait_for_completion("task-processing", Some(Duration::from_millis(1)), Some(1))
        .await;
    assert!(matches!(timeout, Err(TaskForceAIError::Timeout)));
}

#[tokio::test]
async fn file_success_paths_and_download_size_guard_work() {
    let mut server = Server::new_async().await;
    let file_json = r#"{"id":"file 1","filename":"note.txt","purpose":"assistants","bytes":4,"created_at":1672531200,"mime_type":"text/plain"}"#;

    let _upload = server
        .mock("POST", "/files")
        .match_body(Matcher::AllOf(vec![
            Matcher::Regex("name=\"purpose\"".to_string()),
            Matcher::Regex("assistants".to_string()),
            Matcher::Regex("name=\"mime_type\"".to_string()),
            Matcher::Regex("text/plain".to_string()),
        ]))
        .with_status(200)
        .with_body(file_json)
        .create_async()
        .await;
    let _list = server
        .mock("GET", "/files?limit=1&offset=0")
        .with_status(200)
        .with_body(format!(r#"{{"files":[{}],"total":1}}"#, file_json))
        .create_async()
        .await;
    let _get = server
        .mock("GET", "/files/file%201")
        .with_status(200)
        .with_body(file_json)
        .create_async()
        .await;
    let _delete = server
        .mock("DELETE", "/files/file%201")
        .with_status(200)
        .with_body("{}")
        .create_async()
        .await;
    let _download = server
        .mock("GET", "/files/file%201/content")
        .with_status(200)
        .with_body("data")
        .create_async()
        .await;
    let oversized_body = vec![b'x'; (50 * 1024 * 1024) + 1];
    let _too_large = server
        .mock("GET", "/files/huge/content")
        .with_status(200)
        .with_body(oversized_body)
        .create_async()
        .await;

    let client = client_with_key(server.url());
    let uploaded = client
        .upload_file(
            "note.txt",
            Bytes::from_static(b"data"),
            Some(FileUploadOptions {
                purpose: Some("assistants".to_string()),
                mime_type: Some("text/plain".to_string()),
            }),
        )
        .await
        .unwrap();
    assert_eq!(uploaded.id, "file 1");
    assert_eq!(client.list_files(1, 0).await.unwrap().total, 1);
    assert_eq!(
        client.get_file("file 1").await.unwrap().filename,
        "note.txt"
    );
    client.delete_file("file 1").await.unwrap();
    assert_eq!(
        client.download_file("file 1").await.unwrap(),
        Bytes::from_static(b"data")
    );

    let too_large = client.download_file("huge").await;
    assert!(
        matches!(too_large, Err(TaskForceAIError::Other(ref message)) if message.contains("too large"))
    );
}

#[tokio::test]
async fn mock_stream_and_final_sse_edges_are_publicly_observable() {
    let mock_client = TaskForceAI::new(TaskForceAIOptions {
        mock_mode: Some(true),
        ..Default::default()
    })
    .unwrap();
    let mut mock_stream = mock_client.stream_task_status("mock-task").await.unwrap();
    assert_eq!(
        mock_stream.next().await.unwrap().unwrap().status,
        TaskStatusValue::Completed
    );

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
async fn run_task_accepts_additional_options() {
    let mut server = Server::new_async().await;
    let _submit = server
        .mock("POST", "/run")
        .match_body(Matcher::Regex(r#""temperature":0.2"#.to_string()))
        .with_status(200)
        .with_body(r#"{"taskId":"task-1"}"#)
        .create_async()
        .await;
    let _status = server
        .mock("GET", "/status/task-1")
        .with_status(200)
        .with_body(r#"{"taskId":"task-1","status":"completed","result":"done"}"#)
        .create_async()
        .await;

    let client = client_with_key(server.url());
    let mut additional_options = HashMap::new();
    additional_options.insert("temperature".to_string(), serde_json::json!(0.2));
    let status = client
        .run_task(
            "hello",
            Some(TaskSubmissionOptions {
                additional_options,
                ..Default::default()
            }),
            Some(Duration::from_millis(1)),
            Some(1),
        )
        .await
        .unwrap();

    assert_eq!(status.result.as_deref(), Some("done"));
}

#[tokio::test]
async fn thread_success_paths_use_public_api_json_contract() {
    let mut server = Server::new_async().await;
    let thread_json =
        r#"{"id":7,"title":"Research","created_at":1672531200,"updated_at":1672531300}"#;
    let message_json =
        r#"{"id":11,"thread_id":7,"role":"user","content":"hello","created_at":1672531205}"#;

    let _create = server
        .mock("POST", "/threads")
        .match_body(Matcher::Regex(r#""title":"Research""#.to_string()))
        .with_status(200)
        .with_body(thread_json)
        .create_async()
        .await;
    let _list = server
        .mock("GET", "/threads?limit=5&offset=10")
        .with_status(200)
        .with_body(format!(r#"{{"threads":[{}],"total":1}}"#, thread_json))
        .create_async()
        .await;
    let _get = server
        .mock("GET", "/threads/7")
        .with_status(200)
        .with_body(thread_json)
        .create_async()
        .await;
    let _messages = server
        .mock("GET", "/threads/7/messages?limit=3&offset=0")
        .with_status(200)
        .with_body(format!(r#"{{"messages":[{}],"total":1}}"#, message_json))
        .create_async()
        .await;
    let _run = server
        .mock("POST", "/threads/7/runs")
        .match_body(Matcher::AllOf(vec![
            Matcher::Regex(r#""prompt":"continue""#.to_string()),
            Matcher::Regex(r#""modelId":"model-thread""#.to_string()),
            Matcher::Regex(r#""stream":true"#.to_string()),
        ]))
        .with_status(200)
        .with_body(r#"{"taskId":"task-thread","status":"processing"}"#)
        .create_async()
        .await;

    let client = client_with_key(server.url());

    let created = client
        .create_thread(Some(CreateThreadOptions {
            title: Some("Research".to_string()),
            ..Default::default()
        }))
        .await
        .unwrap();
    assert_eq!(created.id, 7);
    assert_eq!(created.title, "Research");

    let listed = client.list_threads(5, 10).await.unwrap();
    assert_eq!(listed.total, 1);
    assert_eq!(listed.threads[0].id, 7);

    let fetched = client.get_thread(7).await.unwrap();
    assert_eq!(fetched.updated_at.timestamp(), 1_672_531_300);

    let messages = client.get_thread_messages(7, 3, 0).await.unwrap();
    assert_eq!(messages.total, 1);
    assert_eq!(messages.messages[0].content, "hello");

    let run = client
        .run_in_thread(
            7,
            ThreadRunOptions {
                prompt: "continue".to_string(),
                model_id: Some("model-thread".to_string()),
                stream: Some(true),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(run.task_id, "task-thread");
    assert_eq!(run.status.as_deref(), Some("processing"));
    assert_eq!(run.thread_id, None);
    assert_eq!(run.message_id, None);
}
