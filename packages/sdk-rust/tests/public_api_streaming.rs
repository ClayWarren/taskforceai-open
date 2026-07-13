mod common;

use common::{client_with_key, TEST_API_KEY};
use futures_util::StreamExt;
use mockito::Server;
use taskforceai_sdk::{TaskForceAI, TaskForceAIError, TaskForceAIOptions, TaskStatusValue};

#[tokio::test]
async fn stream_task_status_empty_task_id_returns_empty_task_id() {
    let client = TaskForceAI::new(TaskForceAIOptions {
        api_key: Some(TEST_API_KEY.to_string()),
        ..Default::default()
    })
    .unwrap();

    let res = client.stream_task_status(" \n\t ").await;
    assert!(matches!(res, Err(TaskForceAIError::EmptyTaskId)));
}

#[tokio::test]
async fn stream_task_status_maps_non_2xx_to_api_error() {
    let mut server = Server::new_async().await;
    let _mock = server
        .mock("GET", "/stream/task-1")
        .with_status(503)
        .with_body("service unavailable")
        .create_async()
        .await;

    let client = client_with_key(server.url());
    let res = client.stream_task_status("task-1").await;
    assert!(matches!(
        res,
        Err(TaskForceAIError::Api { status, ref message })
            if status == 503 && message == "service unavailable"
    ));
}

#[tokio::test]
async fn stream_task_status_parses_crlf_separated_events() {
    let mut server = Server::new_async().await;
    let _mock = server
        .mock("GET", "/stream/task-1")
        .with_status(200)
        .with_header("content-type", "text/event-stream")
        .with_body(
            "data: {\"taskId\":\"task-1\",\"status\":\"processing\"}\r\ndata: {\"taskId\":\"task-1\",\"status\":\"completed\",\"result\":\"done\"}\r\n",
        )
        .create_async()
        .await;

    let client = client_with_key(server.url());
    let mut stream = client.stream_task_status("task-1").await.unwrap();

    let first = stream.next().await.unwrap().unwrap();
    assert_eq!(first.status, TaskStatusValue::Processing);

    let second = stream.next().await.unwrap().unwrap();
    assert_eq!(second.status, TaskStatusValue::Completed);
    assert_eq!(second.result.unwrap(), "done");

    assert!(stream.next().await.is_none());
}

#[tokio::test]
async fn stream_task_status_ignores_non_data_lines() {
    let mut server = Server::new_async().await;
    let _mock = server
        .mock("GET", "/stream/task-1")
        .with_status(200)
        .with_body(
            ":comment\nevent: update\nretry: 1000\ndata: {\"taskId\":\"task-1\",\"status\":\"completed\"}\n",
        )
        .create_async()
        .await;

    let client = client_with_key(server.url());
    let mut stream = client.stream_task_status("task-1").await.unwrap();
    let event = stream.next().await.unwrap().unwrap();

    assert_eq!(event.status, TaskStatusValue::Completed);
    assert!(stream.next().await.is_none());
}

#[tokio::test]
async fn stream_task_status_parses_awaiting_approval_as_terminal_event() {
    let mut server = Server::new_async().await;
    let _mock = server
        .mock("GET", "/stream/task-approval")
        .with_status(200)
        .with_body(
            "data: {\"taskId\":\"task-approval\",\"status\":\"processing\"}\ndata: {\"taskId\":\"task-approval\",\"status\":\"awaiting_approval\",\"error\":\"Approval required\"}\n",
        )
        .create_async()
        .await;

    let client = client_with_key(server.url());
    let mut stream = client.stream_task_status("task-approval").await.unwrap();

    let first = stream.next().await.unwrap().unwrap();
    assert_eq!(first.status, TaskStatusValue::Processing);

    let second = stream.next().await.unwrap().unwrap();
    assert_eq!(second.status, TaskStatusValue::AwaitingApproval);
    assert_eq!(second.error.unwrap(), "Approval required");
    assert!(stream.next().await.is_none());
}

#[tokio::test]
async fn stream_task_status_returns_serialization_error_for_empty_data_payload() {
    let mut server = Server::new_async().await;
    let _mock = server
        .mock("GET", "/stream/task-1")
        .with_status(200)
        .with_body("data:\n")
        .create_async()
        .await;

    let client = client_with_key(server.url());
    let mut stream = client.stream_task_status("task-1").await.unwrap();
    let event = stream.next().await.unwrap();

    assert!(matches!(event, Err(TaskForceAIError::Serialization(_))));
}

#[tokio::test]
async fn stream_task_status_recovers_after_invalid_event_line() {
    let mut server = Server::new_async().await;
    let _mock = server
        .mock("GET", "/stream/task-1")
        .with_status(200)
        .with_body("data: {bad json}\ndata: {\"taskId\":\"task-1\",\"status\":\"completed\"}\n")
        .create_async()
        .await;

    let client = client_with_key(server.url());
    let mut stream = client.stream_task_status("task-1").await.unwrap();

    let first = stream.next().await.unwrap();
    assert!(matches!(first, Err(TaskForceAIError::Serialization(_))));

    let second = stream.next().await.unwrap().unwrap();
    assert_eq!(second.status, TaskStatusValue::Completed);
    assert!(stream.next().await.is_none());
}

#[tokio::test]
async fn stream_task_status_handles_final_line_without_newline() {
    let mut server = Server::new_async().await;
    let _mock = server
        .mock("GET", "/stream/task-1")
        .with_status(200)
        .with_body(
            "data: {\"taskId\":\"task-1\",\"status\":\"processing\"}\ndata: {\"taskId\":\"task-1\",\"status\":\"completed\"}",
        )
        .create_async()
        .await;

    let client = client_with_key(server.url());
    let mut stream = client.stream_task_status("task-1").await.unwrap();

    let first = stream.next().await.unwrap().unwrap();
    assert_eq!(first.status, TaskStatusValue::Processing);

    let second = stream.next().await.unwrap().unwrap();
    assert_eq!(second.status, TaskStatusValue::Completed);
    assert!(stream.next().await.is_none());
}

#[tokio::test]
async fn stream_task_status_returns_stream_error_when_event_line_exceeds_limit() {
    let mut server = Server::new_async().await;
    let oversized_payload = "a".repeat((1024 * 1024) + 1);
    let _mock = server
        .mock("GET", "/stream/task-1")
        .with_status(200)
        .with_body(format!("data: {}", oversized_payload))
        .create_async()
        .await;

    let client = client_with_key(server.url());
    let mut stream = client.stream_task_status("task-1").await.unwrap();
    let event = stream.next().await.unwrap();

    assert!(
        matches!(event, Err(TaskForceAIError::Stream(message)) if message.contains("exceeded maximum size"))
    );
}

#[tokio::test]
async fn run_task_stream_submits_and_streams_completion_event() {
    let mut server = Server::new_async().await;
    let _submit_mock = server
        .mock("POST", "/run")
        .with_status(200)
        .with_body(r#"{"taskId":"task-2"}"#)
        .create_async()
        .await;
    let _stream_mock = server
        .mock("GET", "/stream/task-2")
        .with_status(200)
        .with_header("content-type", "text/event-stream")
        .with_body("data: {\"taskId\":\"task-2\",\"status\":\"completed\"}\n")
        .create_async()
        .await;

    let client = client_with_key(server.url());
    let mut stream = client.run_task_stream("hello", None).await.unwrap();

    let event = stream.next().await.unwrap().unwrap();
    assert_eq!(event.task_id, "task-2");
    assert_eq!(event.status, TaskStatusValue::Completed);
    assert!(stream.next().await.is_none());
}
