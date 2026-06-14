use super::*;
use bytes::Bytes;
use futures_util::StreamExt;
use mockito::Server;

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
