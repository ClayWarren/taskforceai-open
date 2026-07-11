mod common;

use common::{client_with_key, TEST_API_KEY};
use mockito::{Matcher, Server};
use taskforceai_sdk::{
    FileUploadOptions, TaskForceAI, TaskForceAIError, TaskForceAIOptions, TaskStatusValue,
    ThreadRunOptions,
};

#[test]
fn new_requires_api_key_when_not_in_mock_mode() {
    let res = TaskForceAI::new(TaskForceAIOptions {
        api_key: None,
        mock_mode: Some(false),
        ..Default::default()
    });
    assert!(matches!(res, Err(TaskForceAIError::MissingApiKey)));
}

#[tokio::test]
async fn new_allows_empty_api_key_in_mock_mode() {
    let client = TaskForceAI::new(TaskForceAIOptions {
        mock_mode: Some(true),
        ..Default::default()
    })
    .unwrap();

    let status = client.run_task("hello", None, None, Some(1)).await.unwrap();
    assert_eq!(status.task_id, "mock-task-123");
    assert_eq!(status.status, TaskStatusValue::Completed);
}

#[tokio::test]
async fn wait_for_completion_returns_awaiting_approval_error() {
    let mut server = Server::new_async().await;
    let _mock = server
        .mock("GET", "/status/task-approval")
        .with_status(200)
        .with_body(
            r#"{"taskId":"task-approval","status":"awaiting_approval","error":"Approval required"}"#,
        )
        .create_async()
        .await;

    let client = client_with_key(server.url());
    let res = client
        .wait_for_completion(
            "task-approval",
            Some(std::time::Duration::from_millis(1)),
            Some(1),
        )
        .await;

    assert!(matches!(
        res,
        Err(TaskForceAIError::TaskAwaitingApproval(ref message))
            if message == "Approval required"
    ));
}

#[tokio::test]
async fn wait_for_completion_returns_canceled_error() {
    let mut server = Server::new_async().await;
    let _mock = server
        .mock("GET", "/status/task-canceled")
        .with_status(200)
        .with_body(r#"{"taskId":"task-canceled","status":"canceled","error":"Run canceled"}"#)
        .create_async()
        .await;

    let client = client_with_key(server.url());
    let res = client
        .wait_for_completion("task-canceled", None, Some(1))
        .await;

    assert!(matches!(
        res,
        Err(TaskForceAIError::TaskCanceled(ref message)) if message == "Run canceled"
    ));
}

#[tokio::test]
async fn client_does_not_follow_redirects_with_api_key() {
    let mut server = Server::new_async().await;
    let _redirect = server
        .mock("GET", "/status/task-redirect")
        .with_status(302)
        .with_header("location", "https://example.invalid/collect")
        .create_async()
        .await;

    let client = client_with_key(server.url());
    let res = client.get_task_status("task-redirect").await;

    assert!(matches!(
        res,
        Err(TaskForceAIError::Api { status, .. }) if status == 302
    ));
}

#[tokio::test]
async fn submit_task_maps_non_2xx_to_api_error() {
    let mut server = Server::new_async().await;
    let _mock = server
        .mock("POST", "/run")
        .with_status(429)
        .with_body("too many requests")
        .create_async()
        .await;

    let client = client_with_key(server.url());
    let res = client.submit_task("ping", None).await;
    assert!(matches!(
        res,
        Err(TaskForceAIError::Api { status, ref message })
            if status == 429 && message == "too many requests"
    ));
}

#[tokio::test]
async fn submit_task_empty_prompt_returns_empty_prompt() {
    let client = TaskForceAI::new(TaskForceAIOptions {
        api_key: Some(TEST_API_KEY.to_string()),
        ..Default::default()
    })
    .unwrap();

    let res = client.submit_task(" \n\t ", None).await;
    assert!(matches!(res, Err(TaskForceAIError::EmptyPrompt)));
}

#[tokio::test]
async fn task_responses_validate_required_fields() {
    let mut submit_server = Server::new_async().await;
    let _submit = submit_server
        .mock("POST", "/run")
        .with_status(200)
        .with_body(r#"{"taskId":""}"#)
        .create_async()
        .await;

    let client = client_with_key(submit_server.url());
    let res = client.submit_task("ping", None).await;
    assert!(matches!(
        res,
        Err(TaskForceAIError::Validation(ref message))
            if message.contains("taskId is required")
    ));

    let mut status_server = Server::new_async().await;
    let _status = status_server
        .mock("GET", "/status/task-empty")
        .with_status(200)
        .with_body(r#"{"taskId":"","status":"processing"}"#)
        .create_async()
        .await;

    let client = client_with_key(status_server.url());
    let res = client.get_task_status("task-empty").await;
    assert!(matches!(
        res,
        Err(TaskForceAIError::Validation(ref message))
            if message.contains("taskId is required")
    ));
}

#[tokio::test]
async fn upload_file_invalid_mime_maps_to_other_error() {
    let client = TaskForceAI::new(TaskForceAIOptions {
        api_key: Some(TEST_API_KEY.to_string()),
        ..Default::default()
    })
    .unwrap();

    let res = client
        .upload_file(
            "broken.txt",
            "data".as_bytes().to_vec().into(),
            Some(FileUploadOptions {
                purpose: None,
                mime_type: Some("invalid mime".to_string()),
            }),
        )
        .await;

    assert!(matches!(res, Err(TaskForceAIError::Other(_))));
}

#[tokio::test]
async fn upload_file_default_options_use_octet_stream_mime() {
    let mut server = Server::new_async().await;
    let _mock = server
        .mock("POST", "/files")
        .match_body(Matcher::Regex(
            "(?s)Content-Type: application/octet-stream".to_string(),
        ))
        .with_status(200)
        .with_body(
            r#"{"id":"file-1","filename":"blob.bin","purpose":"test","bytes":4,"created_at":1672531200}"#,
        )
        .create_async()
        .await;

    let client = client_with_key(server.url());
    let file = client
        .upload_file(
            "blob.bin",
            "blob".as_bytes().to_vec().into(),
            Some(FileUploadOptions::default()),
        )
        .await
        .unwrap();
    assert_eq!(file.id, "file-1");
}

#[tokio::test]
async fn list_files_maps_non_2xx_to_api_error() {
    let mut server = Server::new_async().await;
    let _mock = server
        .mock("GET", "/files?limit=2&offset=4")
        .with_status(503)
        .with_body("upstream unavailable")
        .create_async()
        .await;

    let client = client_with_key(server.url());
    let res = client.list_files(2, 4).await;
    assert!(matches!(
        res,
        Err(TaskForceAIError::Api { status, ref message })
            if status == 503 && message == "upstream unavailable"
    ));
}

#[tokio::test]
async fn file_responses_validate_required_fields() {
    let mut server = Server::new_async().await;
    let _list = server
        .mock("GET", "/files?limit=1&offset=0")
        .with_status(200)
        .with_body(r#"{"files":[{"id":"file-1","filename":"","purpose":"assistants","bytes":1,"created_at":1672531200}],"total":1}"#)
        .create_async()
        .await;
    let _get = server
        .mock("GET", "/files/file-1")
        .with_status(200)
        .with_body(
            r#"{"id":"file-1","filename":"note.txt","purpose":"","bytes":1,"created_at":1672531200}"#,
        )
        .create_async()
        .await;

    let client = client_with_key(server.url());
    let list_res = client.list_files(1, 0).await;
    assert!(matches!(
        list_res,
        Err(TaskForceAIError::Validation(ref message))
            if message.contains("filename is required")
    ));

    let get_res = client.get_file("file-1").await;
    assert!(matches!(
        get_res,
        Err(TaskForceAIError::Validation(ref message))
            if message.contains("purpose is required")
    ));
}

#[tokio::test]
async fn get_file_maps_non_2xx_to_api_error() {
    let mut server = Server::new_async().await;
    let _mock = server
        .mock("GET", "/files/missing")
        .with_status(404)
        .with_body("missing file")
        .create_async()
        .await;

    let client = client_with_key(server.url());
    let res = client.get_file("missing").await;
    assert!(matches!(
        res,
        Err(TaskForceAIError::Api { status, ref message })
            if status == 404 && message == "missing file"
    ));
}

#[tokio::test]
async fn delete_file_maps_non_2xx_to_api_error() {
    let mut server = Server::new_async().await;
    let _mock = server
        .mock("DELETE", "/files/file-9")
        .with_status(500)
        .with_body("delete failed")
        .create_async()
        .await;

    let client = client_with_key(server.url());
    let res = client.delete_file("file-9").await;
    assert!(matches!(
        res,
        Err(TaskForceAIError::Api { status, ref message })
            if status == 500 && message == "delete failed"
    ));
}

#[tokio::test]
async fn download_file_maps_non_2xx_to_api_error() {
    let mut server = Server::new_async().await;
    let _mock = server
        .mock("GET", "/files/file-9/content")
        .with_status(404)
        .with_body("missing content")
        .create_async()
        .await;

    let client = client_with_key(server.url());
    let res = client.download_file("file-9").await;
    assert!(matches!(
        res,
        Err(TaskForceAIError::Api { status, ref message })
            if status == 404 && message == "missing content"
    ));
}

#[tokio::test]
async fn create_thread_with_none_options_sends_empty_json_body() {
    let mut server = Server::new_async().await;
    let _mock = server
        .mock("POST", "/threads")
        .match_body(Matcher::Regex("\\{\\s*\\}".to_string()))
        .with_status(200)
        .with_body(r#"{"id":1,"timestamp":"2023-01-01T00:00:00Z","user_input":"Untitled","result":"","execution_time":0,"model":"","agent_count":0,"sources":[],"agentStatuses":[],"toolEvents":[]}"#)
        .create_async()
        .await;

    let client = client_with_key(server.url());
    let thread = client.create_thread(None).await.unwrap();
    assert_eq!(thread.id, 1);
    assert_eq!(thread.user_input, "Untitled");
}

#[tokio::test]
async fn create_thread_maps_non_2xx_to_api_error() {
    let mut server = Server::new_async().await;
    let _mock = server
        .mock("POST", "/threads")
        .with_status(409)
        .with_body("conflict")
        .create_async()
        .await;

    let client = client_with_key(server.url());
    let res = client.create_thread(None).await;
    assert!(matches!(
        res,
        Err(TaskForceAIError::Api { status, ref message })
            if status == 409 && message == "conflict"
    ));
}

#[tokio::test]
async fn list_threads_maps_non_2xx_to_api_error() {
    let mut server = Server::new_async().await;
    let _mock = server
        .mock("GET", "/threads?limit=5&offset=7")
        .with_status(500)
        .with_body("internal error")
        .create_async()
        .await;

    let client = client_with_key(server.url());
    let res = client.list_threads(5, 7).await;
    assert!(matches!(
        res,
        Err(TaskForceAIError::Api { status, ref message })
            if status == 500 && message == "internal error"
    ));
}

#[tokio::test]
async fn get_thread_maps_non_2xx_to_api_error() {
    let mut server = Server::new_async().await;
    let _mock = server
        .mock("GET", "/threads/88")
        .with_status(404)
        .with_body("thread not found")
        .create_async()
        .await;

    let client = client_with_key(server.url());
    let res = client.get_thread(88).await;
    assert!(matches!(
        res,
        Err(TaskForceAIError::Api { status, ref message })
            if status == 404 && message == "thread not found"
    ));
}

#[tokio::test]
async fn get_thread_messages_maps_non_2xx_to_api_error() {
    let mut server = Server::new_async().await;
    let _mock = server
        .mock("GET", "/threads/10/messages?limit=1&offset=0")
        .with_status(502)
        .with_body("bad gateway")
        .create_async()
        .await;

    let client = client_with_key(server.url());
    let res = client.get_thread_messages(10, 1, 0).await;
    assert!(matches!(
        res,
        Err(TaskForceAIError::Api { status, ref message })
            if status == 502 && message == "bad gateway"
    ));
}

#[tokio::test]
async fn delete_thread_returns_unsupported_error_with_thread_id() {
    let client = TaskForceAI::new(TaskForceAIOptions {
        api_key: Some(TEST_API_KEY.to_string()),
        ..Default::default()
    })
    .unwrap();

    let err = client.delete_thread(42).await.unwrap_err();
    assert!(matches!(
        err,
        TaskForceAIError::Other(message) if message.contains("thread_id=42")
    ));
}

#[tokio::test]
async fn run_in_thread_empty_prompt_returns_empty_prompt() {
    let client = TaskForceAI::new(TaskForceAIOptions {
        api_key: Some(TEST_API_KEY.to_string()),
        ..Default::default()
    })
    .unwrap();

    let opts = ThreadRunOptions {
        prompt: " \n\t ".to_string(),
        ..Default::default()
    };
    let res = client.run_in_thread(5, opts).await;
    assert!(matches!(res, Err(TaskForceAIError::EmptyPrompt)));
}

#[tokio::test]
async fn run_in_thread_maps_non_2xx_to_api_error() {
    let mut server = Server::new_async().await;
    let _mock = server
        .mock("POST", "/threads/5/runs")
        .with_status(400)
        .with_body("invalid thread")
        .create_async()
        .await;

    let client = client_with_key(server.url());
    let opts = ThreadRunOptions {
        prompt: "run this".to_string(),
        ..Default::default()
    };
    let res = client.run_in_thread(5, opts).await;
    assert!(matches!(
        res,
        Err(TaskForceAIError::Api { status, ref message })
            if status == 400 && message == "invalid thread"
    ));
}

#[tokio::test]
async fn thread_responses_validate_required_fields() {
    let mut server = Server::new_async().await;
    let _list = server
        .mock("GET", "/threads?limit=1&offset=0")
        .with_status(200)
        .with_body(r#"{"conversations":[{"id":1,"timestamp":"","user_input":"","result":"","execution_time":0,"model":"","agent_count":0,"sources":[],"agentStatuses":[],"toolEvents":[]}],"total":1,"limit":1,"offset":0,"has_more":false}"#)
        .create_async()
        .await;
    let _messages = server
        .mock("GET", "/threads/1/messages?limit=1&offset=0")
        .with_status(200)
        .with_body(r#"{"messages":[{"id":1,"thread_id":1,"role":"system","content":"bad"}]}"#)
        .create_async()
        .await;
    let _run = server
        .mock("POST", "/threads/1/runs")
        .with_status(200)
        .with_body(r#"{"taskId":"","status":"processing"}"#)
        .create_async()
        .await;

    let client = client_with_key(server.url());
    let list_res = client.list_threads(1, 0).await;
    assert!(matches!(
        list_res,
        Err(TaskForceAIError::Validation(ref message)) if message.contains("timestamp is required")
    ));

    let message_res = client.get_thread_messages(1, 1, 0).await;
    assert!(matches!(
        message_res,
        Err(TaskForceAIError::Validation(ref message)) if message.contains("role is unsupported")
    ));

    let run_res = client
        .run_in_thread(
            1,
            ThreadRunOptions {
                prompt: "hello".to_string(),
                ..Default::default()
            },
        )
        .await;
    assert!(matches!(
        run_res,
        Err(TaskForceAIError::Validation(ref message)) if message.contains("taskId is required")
    ));
}
