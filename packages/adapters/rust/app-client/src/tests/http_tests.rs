use std::time::{Duration, Instant};

use taskforceai_app_protocol::{AppServerEvent, VoiceTranscribeParams};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use super::{event_channel, init_test_logger};
use crate::client::receive_event;
use crate::transport::{
    handle_http_event_line, read_http_events, read_http_events_once, send_event_nonblocking,
    AppServerEventMessage, AppServerTransport, HttpEventStreamOutcome, MAX_HTTP_EVENT_LINE_BYTES,
};
use crate::{AppClientError, AppServerClient};

#[tokio::test]
async fn event_delivery_reports_lag_when_receiver_is_full() {
    let (tx, mut rx) = event_channel(1);
    send_event_nonblocking(
        &tx,
        AppServerEvent::RunDeleted {
            run_id: "run-1".to_string(),
        },
    );

    let result = tokio::time::timeout(Duration::from_millis(100), async {
        handle_http_event_line(
            br#"{"jsonrpc":"2.0","method":"event","params":{"type":"run_deleted","run_id":"run-2"}}"#,
            &tx,
        );
    })
    .await;

    assert!(result.is_ok(), "full event channel should not block");
    assert!(matches!(
        rx.recv().await,
        Err(tokio::sync::broadcast::error::RecvError::Lagged(1))
    ));
    match rx.recv().await.expect("newest event should remain queued") {
        AppServerEventMessage::Event(AppServerEvent::RunDeleted { run_id }) => {
            assert_eq!(run_id, "run-2")
        }
        _ => panic!("unexpected event"),
    }
}

#[tokio::test]
async fn receive_event_maps_stream_errors_and_lag() {
    let (tx, mut rx) = event_channel(1);
    tx.send(AppServerEventMessage::StreamError {
        message: "stream failed".to_string(),
    })
    .expect("stream error should enqueue");

    assert!(matches!(
        receive_event(&mut rx).await,
        Err(AppClientError::EventStream { ref message }) if message == "stream failed"
    ));

    let (tx, mut rx) = event_channel(1);
    tx.send(AppServerEventMessage::Event(AppServerEvent::RunDeleted {
        run_id: "run-1".to_string(),
    }))
    .expect("first event should enqueue");
    tx.send(AppServerEventMessage::Event(AppServerEvent::RunDeleted {
        run_id: "run-2".to_string(),
    }))
    .expect("second event should enqueue");

    assert!(matches!(
        receive_event(&mut rx).await,
        Err(AppClientError::EventsDropped { count: 1 })
    ));
}

#[tokio::test]
async fn event_delivery_logs_when_receiver_is_closed() {
    init_test_logger();
    let (tx, rx) = event_channel(1);
    drop(rx);

    send_event_nonblocking(
        &tx,
        AppServerEvent::RunDeleted {
            run_id: "run-closed".to_string(),
        },
    );
}

#[tokio::test]
async fn http_request_maps_json_rpc_error_response() {
    let (base_url, server) = spawn_rpc_error_server().await;
    let client =
        AppServerClient::connect_http(format!("{base_url}/"), "session-1").expect("connect");

    let result = client.initialize().await;

    assert!(matches!(
        result,
        Err(AppClientError::Rpc {
            code: -32000,
            ref message,
        }) if message == "server-side boom"
    ));
    server.await.expect("test server should finish");
}

#[tokio::test]
async fn http_request_maps_transport_status_and_decode_errors() {
    let refused =
        AppServerClient::connect_http("http://127.0.0.1:9", "session-1").expect("connect");
    assert!(matches!(
        refused.initialize().await,
        Err(AppClientError::Http(_))
    ));

    let (status_url, status_server) =
        spawn_raw_http_server("HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\n\r\n")
            .await;
    let status = AppServerClient::connect_http(status_url, "session-1").expect("connect");
    assert!(matches!(
        status.initialize().await,
        Err(AppClientError::Http(_))
    ));
    status_server.await.expect("status server should finish");

    let (decode_url, decode_server) =
        spawn_raw_http_server("HTTP/1.1 200 OK\r\nContent-Length: 8\r\n\r\nnot-json").await;
    let decode = AppServerClient::connect_http(decode_url, "session-1").expect("connect");
    assert!(matches!(
        decode.initialize().await,
        Err(AppClientError::Http(_))
    ));
    decode_server.await.expect("decode server should finish");
}

#[tokio::test]
async fn request_handle_sends_http_voice_transcribe_requests() {
    let (base_url, server) = spawn_voice_transcribe_server().await;
    let client =
        AppServerClient::connect_http(format!("{base_url}/"), "session-1").expect("connect");
    let handle = client.request_handle();

    let result = handle
        .voice_transcribe(VoiceTranscribeParams {
            audio_base64: "YXVkaW8=".to_string(),
            media_type: "audio/webm".to_string(),
            file_name: Some("sample.webm".to_string()),
        })
        .await
        .expect("request handle should transcribe over HTTP");

    assert_eq!(result.text, "from http handle");
    server.await.expect("test server should finish");
}

#[tokio::test]
async fn http_clients_respond_to_server_requests_and_cache_initialization() {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("response server should bind");
    let address = listener.local_addr().expect("response server address");
    let server = tokio::spawn(async move {
        for index in 0..5 {
            let (mut stream, _) = listener.accept().await.expect("accept rpc request");
            let request = read_http_request(&mut stream).await;
            assert!(request.starts_with("POST /rpc "));
            if index < 2 || index == 4 {
                if index == 4 {
                    assert!(request.contains("\"method\":\"initialized\""));
                } else {
                    assert!(request.contains("\"result\""));
                }
                write_http_response(&mut stream, "HTTP/1.1 204 No Content", "").await;
            } else {
                assert!(request.contains("\"method\":\"initialize\""));
                let body = format!(
                    r#"{{"jsonrpc":"2.0","id":{},"result":{{"server":{{"name":"fixture","version":"1","protocolVersion":"2026-07"}},"transport":{{"kind":"http","encoding":"json"}},"capabilities":{{}},"negotiated":{{}}}}}}"#,
                    index - 1
                );
                write_http_response(&mut stream, "HTTP/1.1 200 OK", &body).await;
            }
        }
    });
    let client = AppServerClient::connect_http(format!("http://{address}"), "session-1")
        .expect("connect HTTP client");
    client
        .respond_server_request(serde_json::json!(41), serde_json::json!({"ok": true}))
        .await
        .expect("client response");
    let handle = client.request_handle();
    handle
        .respond_server_request(serde_json::json!(42), serde_json::json!({"ok": false}))
        .await
        .expect("handle response");
    handle.initialize().await.expect("handle initialize");
    let first = client.initialize().await.expect("client initialize");
    let second = client.initialize().await.expect("cached initialize");
    assert_eq!(first.server.name, "fixture");
    assert_eq!(second.server.name, "fixture");
    server.await.expect("response server should finish");
}

#[tokio::test]
async fn http_event_lines_decode_app_server_events() {
    let (tx, mut rx) = event_channel(1);
    handle_http_event_line(
        br#"{"jsonrpc":"2.0","method":"event","params":{"type":"run_deleted","run_id":"run-1"}}"#,
        &tx,
    );

    let event = tokio::time::timeout(Duration::from_secs(1), rx.recv())
        .await
        .expect("event should decode before timeout")
        .expect("event channel should stay open");
    match event {
        AppServerEventMessage::Event(AppServerEvent::RunDeleted { run_id }) => {
            assert_eq!(run_id, "run-1")
        }
        _ => panic!("unexpected event"),
    }
}

#[tokio::test]
async fn http_event_lines_decode_bidirectional_server_requests() {
    let (tx, mut rx) = event_channel(1);
    handle_http_event_line(
        br#"{"jsonrpc":"2.0","id":7,"method":"item/tool/call","params":{"threadId":"thread-1"}}"#,
        &tx,
    );
    assert!(matches!(
        rx.recv().await.expect("server request event"),
        AppServerEventMessage::Event(AppServerEvent::ServerRequest { request })
            if request.id == serde_json::json!(7) && request.method == "item/tool/call"
    ));
}

#[tokio::test]
async fn http_event_lines_ignore_empty_invalid_and_non_event_payloads() {
    init_test_logger();
    let (tx, mut rx) = event_channel(1);

    handle_http_event_line(b" \r\n\t", &tx);
    handle_http_event_line(b"{", &tx);
    handle_http_event_line(b"[]", &tx);
    handle_http_event_line(br#"{"jsonrpc":"2.0","method":"log","params":{}}"#, &tx);
    handle_http_event_line(
        br#"{"jsonrpc":"2.0","method":"event","params":{"type":"unknown"}}"#,
        &tx,
    );
    handle_http_event_line(
        b" \t{\"jsonrpc\":\"2.0\",\"method\":\"event\",\"params\":{\"type\":\"run_deleted\",\"run_id\":\"run-trimmed\"}}\r\n",
        &tx,
    );

    let event = rx.recv().await.expect("trimmed event should decode");
    match event {
        AppServerEventMessage::Event(AppServerEvent::RunDeleted { run_id }) => {
            assert_eq!(run_id, "run-trimmed")
        }
        _ => panic!("unexpected event"),
    }
    assert!(rx.try_recv().is_err());
}

#[tokio::test(flavor = "current_thread")]
#[ignore = "performance baseline for HTTP event line parsing"]
async fn perf_http_event_line_parser_run_deleted() {
    const EVENTS: usize = 20_000;
    const SAMPLES: usize = 5;
    let line =
        br#"{"jsonrpc":"2.0","method":"event","params":{"type":"run_deleted","run_id":"run-12345"}}"#;
    let mut durations = Vec::with_capacity(SAMPLES);

    for _ in 0..SAMPLES {
        let (tx, mut rx) = event_channel(EVENTS.next_power_of_two());
        let started = Instant::now();
        for _ in 0..EVENTS {
            handle_http_event_line(line, &tx);
        }
        let elapsed = started.elapsed();
        drop(tx);

        let mut received = 0;
        while rx.try_recv().is_ok() {
            received += 1;
        }
        assert_eq!(received, EVENTS);
        durations.push(elapsed);
    }

    durations.sort_unstable();
    let best = durations[0];
    let median = durations[SAMPLES / 2];
    println!(
        "perf_http_event_line_parser_run_deleted best={}ns/event median={}ns/event best_total={best:?} median_total={median:?}",
        best.as_nanos() / EVENTS as u128,
        median.as_nanos() / EVENTS as u128,
    );
}

#[tokio::test]
async fn http_event_subscription_reuses_configured_auth_headers() {
    let (base_url, server) = spawn_event_server().await;
    let mut client =
        AppServerClient::connect_http(format!("{base_url}/"), "session-1").expect("connect");

    let event = tokio::time::timeout(Duration::from_secs(1), client.next_event())
        .await
        .expect("event should arrive")
        .expect("event stream should not error")
        .expect("event stream should stay open");

    match event {
        AppServerEvent::RunDeleted { run_id } => assert_eq!(run_id, "run-1"),
        _ => panic!("unexpected event"),
    }
    server.await.expect("test server should finish");
}

#[tokio::test]
async fn http_event_subscription_reconnects_after_empty_stream() {
    let (base_url, server) = spawn_empty_then_event_server().await;
    let mut client =
        AppServerClient::connect_http(format!("{base_url}/"), "session-1").expect("connect");

    let event = tokio::time::timeout(Duration::from_secs(2), client.next_event())
        .await
        .expect("reconnected event should arrive")
        .expect("event stream should not error")
        .expect("event stream should stay open");
    assert!(matches!(
        event,
        AppServerEvent::RunDeleted { ref run_id } if run_id == "run-after-reconnect"
    ));
    if let AppServerTransport::Http {
        events, event_task, ..
    } = &client.transport
    {
        assert!(events.is_some());
        assert!(event_task.is_some());
    }
    server.await.expect("test server should finish");
}

#[tokio::test]
async fn http_event_subscription_clears_closed_receiver_state() {
    let mut client = AppServerClient::connect_http("http://127.0.0.1:9", "session-1")
        .expect("connect configuration should be valid");
    let (tx, rx) = event_channel(1);
    drop(tx);
    if let AppServerTransport::Http {
        events, event_task, ..
    } = &mut client.transport
    {
        *events = Some(rx);
        *event_task = None;
    }

    assert!(client
        .next_event()
        .await
        .expect("closed event receiver should not error")
        .is_none());
    if let AppServerTransport::Http {
        events, event_task, ..
    } = &client.transport
    {
        assert!(events.is_none());
        assert!(event_task.is_none());
    }
}

#[tokio::test]
async fn http_shutdown_sends_rpc_and_kill_is_noop() {
    let (base_url, server) = spawn_rpc_success_server().await;
    let mut client =
        AppServerClient::connect_http(format!("{base_url}/"), "session-1").expect("connect");

    client.kill().await;
    client
        .shutdown()
        .await
        .expect("http shutdown should decode");
    server.await.expect("test server should finish");
}

#[tokio::test]
async fn http_event_reader_handles_connect_status_chunk_and_partial_line_edges() {
    init_test_logger();
    let (tx, mut rx) = event_channel(8);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(100))
        .build()
        .expect("client should build");
    assert_eq!(
        read_http_events_once(
            "http://127.0.0.1:9".to_string(),
            "session-1".to_string(),
            client,
            tx.clone(),
        )
        .await,
        HttpEventStreamOutcome::Retry
    );
    assert!(matches!(
        rx.recv().await,
        Ok(AppServerEventMessage::StreamError { .. })
    ));

    let (status_url, status_server) =
        spawn_raw_http_server("HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\n\r\n")
            .await;
    assert_eq!(
        read_http_events_once(
            status_url,
            "session-1".to_string(),
            reqwest::Client::new(),
            tx.clone(),
        )
        .await,
        HttpEventStreamOutcome::Retry
    );
    status_server.await.expect("status server should finish");
    assert!(matches!(
        rx.recv().await,
        Ok(AppServerEventMessage::StreamError { .. })
    ));

    let (chunk_url, chunk_server) =
        spawn_raw_http_server("HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\npartial").await;
    assert_eq!(
        read_http_events_once(
            chunk_url,
            "session-1".to_string(),
            reqwest::Client::new(),
            tx.clone(),
        )
        .await,
        HttpEventStreamOutcome::Retry
    );
    chunk_server.await.expect("chunk server should finish");
    assert!(matches!(
        rx.recv().await,
        Ok(AppServerEventMessage::StreamError { .. })
    ));

    let body = concat!(
        "{\"jsonrpc\":\"2.0\",\"method\":\"event\",\"params\":{\"type\":\"run_deleted\",\"run_id\":\"run-drain-1\"}}\n",
        "{\"jsonrpc\":\"2.0\",\"method\":\"event\",\"params\":{\"type\":\"run_deleted\",\"run_id\":\"run-drain-2\"}}"
    );
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",
        body.len()
    );
    let (drain_url, drain_server) = spawn_raw_http_server(&response).await;
    assert_eq!(
        read_http_events_once(
            drain_url,
            "session-1".to_string(),
            reqwest::Client::new(),
            tx,
        )
        .await,
        HttpEventStreamOutcome::Closed
    );
    drain_server.await.expect("drain server should finish");

    let first = rx.recv().await.expect("first event should decode");
    let second = rx.recv().await.expect("second event should decode");
    assert!(matches!(
        first,
        AppServerEventMessage::Event(AppServerEvent::RunDeleted { ref run_id }) if run_id == "run-drain-1"
    ));
    assert!(matches!(
        second,
        AppServerEventMessage::Event(AppServerEvent::RunDeleted { ref run_id }) if run_id == "run-drain-2"
    ));
}

#[tokio::test]
async fn http_event_reader_retries_after_stream_error() {
    init_test_logger();
    let (tx, mut rx) = event_channel(1);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(50))
        .build()
        .expect("client should build");
    let task = tokio::spawn(read_http_events(
        "http://127.0.0.1:9".to_string(),
        "session-1".to_string(),
        client,
        tx,
    ));

    assert!(matches!(
        rx.recv().await,
        Ok(AppServerEventMessage::StreamError { .. })
    ));
    tokio::time::sleep(Duration::from_millis(300)).await;
    task.abort();
}

#[tokio::test]
async fn http_event_reader_handles_closed_error_receiver() {
    init_test_logger();
    let (tx, rx) = event_channel(1);
    drop(rx);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(50))
        .build()
        .expect("client should build");

    assert_eq!(
        read_http_events_once(
            "http://127.0.0.1:9".to_string(),
            "session-1".to_string(),
            client,
            tx,
        )
        .await,
        HttpEventStreamOutcome::Retry
    );
}

#[tokio::test]
async fn http_event_reader_skips_oversized_newline_delimited_lines() {
    init_test_logger();
    let (tx, mut rx) = event_channel(1);
    let oversized = "x".repeat(MAX_HTTP_EVENT_LINE_BYTES + 1);
    let body = format!("{oversized}\n");
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",
        body.len()
    );
    let (base_url, server) = spawn_raw_http_server(&response).await;

    assert_eq!(
        read_http_events_once(
            base_url,
            "session-1".to_string(),
            reqwest::Client::new(),
            tx,
        )
        .await,
        HttpEventStreamOutcome::Closed
    );
    server.await.expect("oversized server should finish");
    assert!(rx.try_recv().is_err());
}

#[tokio::test]
async fn http_event_reader_caps_unterminated_lines() {
    init_test_logger();
    let (tx, mut rx) = event_channel(1);
    let oversized = "x".repeat(MAX_HTTP_EVENT_LINE_BYTES + 1);
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{oversized}",
        oversized.len()
    );
    let (base_url, server) = spawn_raw_http_server(&response).await;

    assert_eq!(
        read_http_events_once(
            base_url,
            "session-1".to_string(),
            reqwest::Client::new(),
            tx,
        )
        .await,
        HttpEventStreamOutcome::Closed
    );
    server.await.expect("oversized server should finish");
    assert!(rx.try_recv().is_err());
}

#[tokio::test]
async fn http_event_subscription_does_not_use_rpc_timeout_client() {
    let (base_url, server) = spawn_delayed_event_server().await;
    let mut client =
        AppServerClient::connect_http(format!("{base_url}/"), "session-1").expect("connect");
    if let AppServerTransport::Http { client, .. } = &mut client.transport {
        *client = reqwest::Client::builder()
            .timeout(Duration::from_millis(1))
            .build()
            .expect("short-timeout client should build");
    }

    let event = tokio::time::timeout(Duration::from_secs(1), client.next_event())
        .await
        .expect("event should arrive")
        .expect("event stream should not error")
        .expect("event stream should stay open");

    match event {
        AppServerEvent::RunDeleted { run_id } => assert_eq!(run_id, "run-delayed"),
        _ => panic!("unexpected event"),
    }
    server.await.expect("test server should finish");
}

#[tokio::test]
async fn http_event_reader_flushes_final_line_without_newline() {
    let (base_url, server) = spawn_event_server_without_trailing_newline().await;
    let (tx, mut rx) = event_channel(1);

    assert_eq!(
        read_http_events_once(
            base_url,
            "session-1".to_string(),
            reqwest::Client::new(),
            tx,
        )
        .await,
        HttpEventStreamOutcome::Closed
    );

    let event = tokio::time::timeout(Duration::from_secs(1), rx.recv())
        .await
        .expect("event should decode before timeout")
        .expect("event channel should stay open");
    match event {
        AppServerEventMessage::Event(AppServerEvent::RunDeleted { run_id }) => {
            assert_eq!(run_id, "run-final")
        }
        _ => panic!("unexpected event"),
    }
    server.await.expect("test server should finish");
}

async fn spawn_rpc_error_server() -> (String, tokio::task::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("test http server should bind");
    let address = listener.local_addr().expect("test server address");
    let server = tokio::spawn(async move {
        let mut saw_events = false;
        let mut saw_rpc = false;
        for _ in 0..1 {
            let (mut stream, _peer) = listener.accept().await.expect("accept request");
            let request = read_http_request(&mut stream).await;
            let normalized_request = request.to_ascii_lowercase();
            if request.starts_with("GET /events ") {
                assert!(normalized_request.contains("x-taskforce-session: session-1"));
                saw_events = true;
                write_http_response(&mut stream, "HTTP/1.1 200 OK", "").await;
            } else if request.starts_with("POST /rpc ") {
                assert!(normalized_request.contains("x-taskforce-session: session-1"));
                assert!(normalized_request.contains("authorization: bearer session-1"));
                saw_rpc = true;
                write_http_response(
                    &mut stream,
                    "HTTP/1.1 200 OK",
                    r#"{"jsonrpc":"2.0","id":1,"error":{"code":-32000,"message":"server-side boom"}}"#,
                )
                .await;
            } else {
                panic!("unexpected request: {request}");
            }
        }
        assert!(!saw_events, "events request should be lazy");
        assert!(saw_rpc, "rpc request should be sent");
    });
    (format!("http://{address}"), server)
}

async fn spawn_event_server() -> (String, tokio::task::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("test http server should bind");
    let address = listener.local_addr().expect("test server address");
    let server = tokio::spawn(async move {
        let (mut stream, _peer) = listener.accept().await.expect("accept request");
        let request = read_http_request(&mut stream).await;
        let normalized_request = request.to_ascii_lowercase();
        assert!(request.starts_with("GET /events "));
        assert!(normalized_request.contains("x-taskforce-session: session-1"));
        assert!(normalized_request.contains("authorization: bearer session-1"));
        write_http_response(
            &mut stream,
            "HTTP/1.1 200 OK",
            "{\"jsonrpc\":\"2.0\",\"method\":\"event\",\"params\":{\"type\":\"run_deleted\",\"run_id\":\"run-1\"}}\n",
        )
        .await;
    });
    (format!("http://{address}"), server)
}

async fn spawn_delayed_event_server() -> (String, tokio::task::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("test http server should bind");
    let address = listener.local_addr().expect("test server address");
    let server = tokio::spawn(async move {
        let (mut stream, _peer) = listener.accept().await.expect("accept request");
        let request = read_http_request(&mut stream).await;
        assert!(request.starts_with("GET /events "));
        tokio::time::sleep(Duration::from_millis(50)).await;
        write_http_response(
            &mut stream,
            "HTTP/1.1 200 OK",
            "{\"jsonrpc\":\"2.0\",\"method\":\"event\",\"params\":{\"type\":\"run_deleted\",\"run_id\":\"run-delayed\"}}\n",
        )
        .await;
    });
    (format!("http://{address}"), server)
}

async fn spawn_event_server_without_trailing_newline() -> (String, tokio::task::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("test http server should bind");
    let address = listener.local_addr().expect("test server address");
    let server = tokio::spawn(async move {
        let (mut stream, _peer) = listener.accept().await.expect("accept request");
        let request = read_http_request(&mut stream).await;
        assert!(request.starts_with("GET /events "));
        write_http_response(
            &mut stream,
            "HTTP/1.1 200 OK",
            "{\"jsonrpc\":\"2.0\",\"method\":\"event\",\"params\":{\"type\":\"run_deleted\",\"run_id\":\"run-final\"}}",
        )
        .await;
    });
    (format!("http://{address}"), server)
}

async fn spawn_empty_then_event_server() -> (String, tokio::task::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("test http server should bind");
    let address = listener.local_addr().expect("test server address");
    let server = tokio::spawn(async move {
        let (mut first_stream, _peer) = listener.accept().await.expect("accept first request");
        let first_request = read_http_request(&mut first_stream).await;
        assert!(first_request.starts_with("GET /events "));
        write_http_response(&mut first_stream, "HTTP/1.1 200 OK", "").await;
        drop(first_stream);

        let (mut second_stream, _peer) = listener.accept().await.expect("accept retry request");
        let second_request = read_http_request(&mut second_stream).await;
        assert!(second_request.starts_with("GET /events "));
        write_http_response(
            &mut second_stream,
            "HTTP/1.1 200 OK",
            "{\"jsonrpc\":\"2.0\",\"method\":\"event\",\"params\":{\"type\":\"run_deleted\",\"run_id\":\"run-after-reconnect\"}}\n",
        )
        .await;
    });
    (format!("http://{address}"), server)
}

async fn spawn_rpc_success_server() -> (String, tokio::task::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("test http server should bind");
    let address = listener.local_addr().expect("test server address");
    let server = tokio::spawn(async move {
        let (mut stream, _peer) = listener.accept().await.expect("accept request");
        let request = read_http_request(&mut stream).await;
        assert!(request.starts_with("POST /rpc "));
        assert!(request.contains("\"method\":\"shutdown\""));
        write_http_response(
            &mut stream,
            "HTTP/1.1 200 OK",
            r#"{"jsonrpc":"2.0","id":1,"result":{}}"#,
        )
        .await;
    });
    (format!("http://{address}"), server)
}

async fn spawn_voice_transcribe_server() -> (String, tokio::task::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("test http server should bind");
    let address = listener.local_addr().expect("test server address");
    let server = tokio::spawn(async move {
        let (mut stream, _peer) = listener.accept().await.expect("accept request");
        let request = read_http_request(&mut stream).await;
        let normalized_request = request.to_ascii_lowercase();
        assert!(request.starts_with("POST /rpc "));
        assert!(normalized_request.contains("x-taskforce-session: session-1"));
        assert!(normalized_request.contains("authorization: bearer session-1"));
        assert!(request.contains("\"method\":\"voice.transcribe\""));
        assert!(request.contains("\"mediaType\":\"audio/webm\""));
        write_http_response(
            &mut stream,
            "HTTP/1.1 200 OK",
            r#"{"jsonrpc":"2.0","id":1,"result":{"text":"from http handle"}}"#,
        )
        .await;
    });
    (format!("http://{address}"), server)
}

async fn spawn_raw_http_server(response: &str) -> (String, tokio::task::JoinHandle<()>) {
    let response = response.to_string();
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("test http server should bind");
    let address = listener.local_addr().expect("test server address");
    let server = tokio::spawn(async move {
        let (mut stream, _peer) = listener.accept().await.expect("accept request");
        let _request = read_http_request(&mut stream).await;
        stream
            .write_all(response.as_bytes())
            .await
            .expect("write raw response");
    });
    (format!("http://{address}"), server)
}

async fn read_http_request(stream: &mut tokio::net::TcpStream) -> String {
    let mut buffer = [0_u8; 4096];
    let size = stream.read(&mut buffer).await.expect("read request");
    String::from_utf8_lossy(&buffer[..size]).into_owned()
}

async fn write_http_response(stream: &mut tokio::net::TcpStream, status: &str, body: &str) {
    let response = format!(
        "{status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",
        body.len()
    );
    stream
        .write_all(response.as_bytes())
        .await
        .expect("write response");
}
