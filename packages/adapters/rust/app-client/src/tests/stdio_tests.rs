use std::collections::HashMap;
use std::sync::Arc;

use serde_json::json;
use taskforceai_app_protocol::JsonRpcResponse;
use tokio::io::AsyncBufReadExt;

use super::{event_channel, init_test_logger};
use crate::client::decode_response;
use crate::transport::{
    read_stdio_lines, route_stdio_response, AppServerTransport, PendingResponses,
};
use crate::{AppClientError, AppServerClient};

fn pending_responses() -> PendingResponses {
    Arc::new(tokio::sync::Mutex::new(HashMap::new()))
}

#[tokio::test]
async fn stdio_response_routing_delivers_by_request_id() {
    let pending = pending_responses();
    let (response_tx, response_rx) = tokio::sync::oneshot::channel();
    pending.lock().await.insert(7, response_tx);

    route_stdio_response(
        &pending,
        JsonRpcResponse {
            jsonrpc: "2.0".to_string(),
            id: Some(json!(99)),
            result: Some(json!("wrong")),
            error: None,
        },
    )
    .await;
    assert!(pending.lock().await.contains_key(&7));

    route_stdio_response(
        &pending,
        JsonRpcResponse {
            jsonrpc: "2.0".to_string(),
            id: Some(json!(7)),
            result: Some(json!("right")),
            error: None,
        },
    )
    .await;

    let response = response_rx.await.expect("matching response should route");
    assert_eq!(
        decode_response::<serde_json::Value>(response).expect("response should decode"),
        json!("right")
    );
    assert!(!pending.lock().await.contains_key(&7));
}

#[tokio::test]
async fn stdio_response_routing_ignores_missing_numeric_id() {
    init_test_logger();
    let pending = pending_responses();
    let (response_tx, _response_rx) = tokio::sync::oneshot::channel();
    pending.lock().await.insert(7, response_tx);

    route_stdio_response(
        &pending,
        JsonRpcResponse {
            jsonrpc: "2.0".to_string(),
            id: None,
            result: Some(json!("ignored")),
            error: None,
        },
    )
    .await;
    route_stdio_response(
        &pending,
        JsonRpcResponse {
            jsonrpc: "2.0".to_string(),
            id: Some(json!("not-numeric")),
            result: Some(json!("ignored")),
            error: None,
        },
    )
    .await;

    assert!(pending.lock().await.contains_key(&7));
}

#[cfg(unix)]
#[tokio::test]
async fn request_handle_sends_stdio_voice_transcribe_requests() {
    use std::fs;
    use std::os::unix::fs::PermissionsExt;

    use taskforceai_app_protocol::VoiceTranscribeParams;

    let script_path = temp_script_path();
    fs::write(
        &script_path,
        concat!(
            "#!/bin/sh\n",
            "read -r line\n",
            "id=$(printf '%s\\n' \"$line\" | sed -n 's/.*\"id\":\\([0-9][0-9]*\\).*/\\1/p')\n",
            "printf '{\"jsonrpc\":\"2.0\",\"id\":%s,\"result\":{\"text\":\"from stdio handle\"}}\\n' \"${id:-1}\"\n"
        ),
    )
    .expect("write test script");
    let mut permissions = fs::metadata(&script_path)
        .expect("script metadata")
        .permissions();
    permissions.set_mode(0o700);
    fs::set_permissions(&script_path, permissions).expect("mark script executable");

    let mut client = AppServerClient::spawn(&script_path)
        .await
        .expect("client should spawn script");
    let handle = client.request_handle();
    let result = handle
        .voice_transcribe(VoiceTranscribeParams {
            audio_base64: "YXVkaW8=".to_string(),
            media_type: "audio/webm".to_string(),
            file_name: None,
        })
        .await
        .expect("request handle should transcribe over stdio");

    assert_eq!(result.text, "from stdio handle");
    client.kill().await;
    let _ = fs::remove_file(script_path);
}

#[cfg(unix)]
#[tokio::test]
async fn stdio_client_and_handle_respond_to_server_requests() {
    use std::fs;
    use std::os::unix::fs::PermissionsExt;

    let script_path = temp_script_path();
    let output_path = script_path.with_extension("responses");
    fs::write(
        &script_path,
        format!(
            "#!/bin/sh\nread -r first\nread -r second\nprintf '%s\\n%s\\n' \"$first\" \"$second\" > '{}'\n",
            output_path.display()
        ),
    )
    .expect("write response capture script");
    let mut permissions = fs::metadata(&script_path)
        .expect("script metadata")
        .permissions();
    permissions.set_mode(0o700);
    fs::set_permissions(&script_path, permissions).expect("mark script executable");

    let mut client = AppServerClient::spawn(&script_path)
        .await
        .expect("spawn response capture script");
    client
        .respond_server_request(json!(11), json!({"accepted": true}))
        .await
        .expect("client response");
    client
        .request_handle()
        .respond_server_request(json!(12), json!({"accepted": false}))
        .await
        .expect("handle response");
    for _ in 0..50 {
        if output_path.exists() {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    let output = fs::read_to_string(&output_path).expect("captured responses");
    assert!(output.contains("\"id\":11"));
    assert!(output.contains("\"id\":12"));
    assert!(output.contains("\"result\":{\"accepted\":true}"));
    client.kill().await;
    let _ = fs::remove_file(script_path);
    let _ = fs::remove_file(output_path);
}

#[cfg(unix)]
#[tokio::test]
async fn stdio_request_decode_error_clears_pending_response() {
    use std::fs;
    use std::os::unix::fs::PermissionsExt;

    use taskforceai_app_protocol::VoiceTranscribeParams;

    let script_path = temp_script_path();
    fs::write(
        &script_path,
        concat!(
            "#!/bin/sh\n",
            "read -r line\n",
            "id=$(printf '%s\\n' \"$line\" | sed -n 's/.*\"id\":\\([0-9][0-9]*\\).*/\\1/p')\n",
            "printf '{\"jsonrpc\":\"2.0\",\"id\":%s,\"result\":{\"wrong\":\"shape\"}}\\n' \"${id:-1}\"\n"
        ),
    )
    .expect("write test script");
    let mut permissions = fs::metadata(&script_path)
        .expect("script metadata")
        .permissions();
    permissions.set_mode(0o700);
    fs::set_permissions(&script_path, permissions).expect("mark script executable");

    let mut client = AppServerClient::spawn(&script_path)
        .await
        .expect("client should spawn script");
    let result = client
        .request_handle()
        .voice_transcribe(VoiceTranscribeParams {
            audio_base64: "YXVkaW8=".to_string(),
            media_type: "audio/webm".to_string(),
            file_name: None,
        })
        .await;

    assert!(matches!(result, Err(AppClientError::Decode(_))));
    if let AppServerTransport::Stdio {
        pending_responses, ..
    } = &client.transport
    {
        assert!(pending_responses.lock().await.is_empty());
    }
    client.kill().await;
    let _ = fs::remove_file(script_path);
}

#[cfg(unix)]
#[tokio::test]
async fn stdio_request_timeout_clears_pending_response() {
    use std::fs;
    use std::os::unix::fs::PermissionsExt;

    use taskforceai_app_protocol::VoiceTranscribeParams;

    let script_path = temp_script_path();
    fs::write(&script_path, "#!/bin/sh\nread -r _line\nsleep 1\n").expect("write test script");
    let mut permissions = fs::metadata(&script_path)
        .expect("script metadata")
        .permissions();
    permissions.set_mode(0o700);
    fs::set_permissions(&script_path, permissions).expect("mark script executable");

    let mut client = AppServerClient::spawn(&script_path)
        .await
        .expect("client should spawn script");
    let result = client
        .request_handle()
        .voice_transcribe(VoiceTranscribeParams {
            audio_base64: "YXVkaW8=".to_string(),
            media_type: "audio/webm".to_string(),
            file_name: None,
        })
        .await;

    assert!(matches!(
        result,
        Err(AppClientError::RequestTimeout {
            ref method,
            timeout_ms: 500
        }) if method == "voice.transcribe"
    ));
    if let AppServerTransport::Stdio {
        pending_responses, ..
    } = &client.transport
    {
        assert!(pending_responses.lock().await.is_empty());
    }
    client.kill().await;
    let _ = fs::remove_file(script_path);
}

#[cfg(unix)]
#[tokio::test]
async fn cloned_stdio_request_handles_can_complete_concurrent_requests_out_of_order() {
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::time::Duration;

    use taskforceai_app_protocol::VoiceTranscribeParams;

    let script_path = temp_script_path();
    fs::write(
        &script_path,
        concat!(
            "#!/bin/sh\n",
            "read -r _first\n",
            "read -r _second\n",
            "printf '%s\\n' '{\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{\"text\":\"second\"}}'\n",
            "printf '%s\\n' '{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"text\":\"first\"}}'\n"
        ),
    )
    .expect("write test script");
    let mut permissions = fs::metadata(&script_path)
        .expect("script metadata")
        .permissions();
    permissions.set_mode(0o700);
    fs::set_permissions(&script_path, permissions).expect("mark script executable");

    let mut client = AppServerClient::spawn(&script_path)
        .await
        .expect("client should spawn script");
    let first_handle = client.request_handle();
    let second_handle = first_handle.clone();
    let first = first_handle.voice_transcribe(VoiceTranscribeParams {
        audio_base64: "Zmlyc3Q=".to_string(),
        media_type: "audio/webm".to_string(),
        file_name: None,
    });
    let second = second_handle.voice_transcribe(VoiceTranscribeParams {
        audio_base64: "c2Vjb25k".to_string(),
        media_type: "audio/webm".to_string(),
        file_name: None,
    });

    let (first, second) = tokio::time::timeout(Duration::from_secs(1), async {
        tokio::join!(first, second)
    })
    .await
    .expect("concurrent stdio requests should not serialize on response wait");

    assert_eq!(first.expect("first request should complete").text, "first");
    assert_eq!(
        second.expect("second request should complete").text,
        "second"
    );
    client.kill().await;
    let _ = fs::remove_file(script_path);
}

#[tokio::test]
async fn stdio_reader_handles_invalid_lines_and_closed_response_receiver() {
    init_test_logger();
    let input = concat!(
        "not-json\n",
        "{\"jsonrpc\":\"2.0\",\"method\":\"log\",\"params\":{}}\n",
        "{\"method\":\"event\",\"params\":{}}\n",
        "{\"jsonrpc\":\"2.0\",\"method\":\"event\",\"params\":{\"type\":\"unknown\"}}\n",
        "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{}}\n"
    );
    let pending = pending_responses();
    let (response_tx, response_rx) = tokio::sync::oneshot::channel();
    pending.lock().await.insert(1, response_tx);
    drop(response_rx);
    let (event_tx, mut event_rx) = event_channel(1);

    read_stdio_lines(
        tokio::io::BufReader::new(input.as_bytes()).lines(),
        pending.clone(),
        event_tx,
    )
    .await;

    assert!(pending.lock().await.is_empty());
    assert!(event_rx.try_recv().is_err());
}

#[tokio::test]
async fn stdio_reader_routes_valid_and_rejects_malformed_server_requests() {
    init_test_logger();
    let input = concat!(
        "{\"jsonrpc\":\"2.0\",\"id\":7,\"method\":\"item/tool/call\",\"params\":{}}\n",
        "{\"jsonrpc\":\"2.0\",\"id\":8,\"method\":7,\"params\":{}}\n"
    );
    let pending = pending_responses();
    let (event_tx, mut event_rx) = event_channel(2);
    read_stdio_lines(
        tokio::io::BufReader::new(input.as_bytes()).lines(),
        pending,
        event_tx,
    )
    .await;
    assert!(matches!(
        event_rx.recv().await.expect("server request"),
        crate::transport::AppServerEventMessage::Event(
            taskforceai_app_protocol::AppServerEvent::ServerRequest { request }
        ) if request.id == json!(7)
    ));
    assert!(event_rx.try_recv().is_err());
}

#[tokio::test]
async fn stdio_reader_ignores_unrecognized_response_payloads() {
    let pending = pending_responses();
    let (event_tx, _event_rx) = event_channel(1);

    read_stdio_lines(
        tokio::io::BufReader::new(br#"[]"#.as_slice()).lines(),
        pending.clone(),
        event_tx,
    )
    .await;

    assert!(pending.lock().await.is_empty());
}

#[tokio::test]
async fn stdio_reader_stops_on_read_error() {
    init_test_logger();
    use std::io;
    use std::pin::Pin;
    use std::task::{Context, Poll};
    use tokio::io::{AsyncBufRead, AsyncRead, ReadBuf};

    struct FailingReader;

    impl AsyncRead for FailingReader {
        fn poll_read(
            self: Pin<&mut Self>,
            _cx: &mut Context<'_>,
            _buf: &mut ReadBuf<'_>,
        ) -> Poll<io::Result<()>> {
            Poll::Ready(Err(io::Error::other("boom")))
        }
    }

    impl AsyncBufRead for FailingReader {
        fn poll_fill_buf(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<io::Result<&[u8]>> {
            Poll::Ready(Err(io::Error::other("boom")))
        }

        fn consume(self: Pin<&mut Self>, _amount: usize) {}
    }

    let pending = pending_responses();
    let (event_tx, mut event_rx) = event_channel(1);

    read_stdio_lines(FailingReader.lines(), pending.clone(), event_tx).await;

    assert!(pending.lock().await.is_empty());
    assert!(event_rx.try_recv().is_err());
}

#[cfg(unix)]
#[tokio::test]
async fn dropping_stdio_client_kills_spawned_process() {
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::time::Duration;

    let script_path = temp_script_path();
    fs::write(&script_path, "#!/bin/sh\nwhile true; do sleep 1; done\n")
        .expect("write test script");
    let mut permissions = fs::metadata(&script_path)
        .expect("script metadata")
        .permissions();
    permissions.set_mode(0o700);
    fs::set_permissions(&script_path, permissions).expect("mark script executable");

    let mut client = AppServerClient::spawn(&script_path)
        .await
        .expect("client should spawn script");
    let pid = match &mut client.transport {
        AppServerTransport::Stdio { child, .. } => {
            child.id().expect("child should have process id")
        }
        AppServerTransport::Http { .. } => panic!("expected stdio transport"),
    };

    drop(client);

    let exited = tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            if !process_is_running(pid) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    })
    .await;

    let _ = fs::remove_file(script_path);
    assert!(
        exited.is_ok(),
        "dropped client should kill app-server child"
    );
}

#[cfg(unix)]
#[tokio::test]
async fn spawn_with_options_can_inherit_stderr_and_kill_child() {
    use std::fs;
    use std::os::unix::fs::PermissionsExt;

    let script_path = temp_script_path();
    fs::write(&script_path, "#!/bin/sh\nwhile true; do sleep 1; done\n")
        .expect("write test script");
    let mut permissions = fs::metadata(&script_path)
        .expect("script metadata")
        .permissions();
    permissions.set_mode(0o700);
    fs::set_permissions(&script_path, permissions).expect("mark script executable");

    let mut client = AppServerClient::spawn_with_options(
        &script_path,
        crate::client::AppServerSpawnOptions {
            inherit_stderr: true,
            ..Default::default()
        },
    )
    .await
    .expect("client should spawn script");
    client.kill().await;

    let _ = fs::remove_file(script_path);
}

#[tokio::test]
async fn spawn_reports_missing_binary_errors() {
    assert!(matches!(
        AppServerClient::spawn("/tmp/taskforceai-missing-app-server-binary").await,
        Err(AppClientError::Spawn(_))
    ));
}

#[cfg(unix)]
fn temp_script_path() -> std::path::PathBuf {
    static NEXT_SCRIPT_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
    let unique = format!(
        "taskforceai-app-client-drop-{}-{}-{}.sh",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock should be after epoch")
            .as_nanos(),
        NEXT_SCRIPT_ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed),
    );
    std::env::temp_dir().join(unique)
}

#[cfg(unix)]
fn process_is_running(pid: u32) -> bool {
    let Ok(output) = std::process::Command::new("ps")
        .arg("-p")
        .arg(pid.to_string())
        .arg("-o")
        .arg("stat=")
        .output()
    else {
        return false;
    };
    if !output.status.success() {
        return false;
    }
    let state = String::from_utf8_lossy(&output.stdout);
    !state.trim_start().starts_with('Z')
}
