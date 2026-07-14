use std::collections::VecDeque;

use serde_json::json;
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncWrite, AsyncWriteExt};
use tokio::sync::{mpsc, watch};

use crate::interactions::InteractionBroker;
use crate::protocol::{AppServerEvent, JsonRpcResponse, OutgoingMessage};
use crate::remote_relay::{
    prepare_remote_poll, process_remote_poll_completion, process_remote_websocket_batch,
    report_remote_poll_result, RemoteCommandResult, RemoteWebSocketEvent,
    REMOTE_POLL_CHECK_INTERVAL, REMOTE_WEBSOCKET_RECONNECT_DELAY,
};
use crate::runtime::{AppRuntime, RuntimeConfig};
use crate::tls::install_default_crypto_provider;

use super::handler::handle_line;
use super::responses::extend_event_notifications;
use super::{AppServerError, ConnectionState, ServerAction};

const EVENT_BACKLOG_CAPACITY: usize = 256;

pub async fn run_stdio<R, W, E>(reader: R, writer: W, logger: E) -> Result<(), AppServerError>
where
    R: AsyncBufRead + Unpin,
    W: AsyncWrite + Unpin,
    E: AsyncWrite + Unpin,
{
    install_default_crypto_provider();
    let runtime = AppRuntime::try_new(RuntimeConfig::from_env())?;
    run_stdio_with_runtime(reader, writer, logger, runtime).await
}

async fn run_stdio_with_runtime<R, W, E>(
    reader: R,
    mut writer: W,
    mut logger: E,
    mut runtime: AppRuntime,
) -> Result<(), AppServerError>
where
    R: AsyncBufRead + Unpin,
    W: AsyncWrite + Unpin,
    E: AsyncWrite + Unpin,
{
    write_log(&mut logger, "info", "taskforceai app-server starting").await?;

    let (event_tx, mut event_rx) = mpsc::channel(128);
    runtime.set_event_sender(event_tx);
    let (output_tx, mut output_rx) = mpsc::channel(256);
    let broker = InteractionBroker::new(output_tx.clone());
    runtime.set_interaction_broker(broker.clone());
    let resumed_runs = runtime.resume_remote_run_streams();
    if resumed_runs > 0 {
        // coverage:ignore-start
        write_log(
            &mut logger,
            "info",
            &format!("resumed {resumed_runs} remote run stream(s)"),
        )
        .await?;
        // coverage:ignore-end
    }
    let mut lines = reader.lines();
    let (work_tx, work_rx) = mpsc::channel(128);
    let mut work_tx = Some(work_tx);
    let (shutdown_tx, mut shutdown_rx) = watch::channel(false);
    let mut processor = Some(tokio::spawn(process_runtime_work(
        runtime,
        work_rx,
        output_tx.clone(),
        broker.clone(),
        shutdown_tx,
    )));

    loop {
        tokio::select! {
            biased;
            Some(message) = output_rx.recv() => write_messages(&mut writer, vec![message]).await?,
            line = lines.next_line(), if work_tx.is_some() => {
                let Some(line) = line? else {
                    work_tx.take();
                    if let Some(processor) = processor.take() {
                        let _ = processor.await;
                    }
                    while let Ok(message) = output_rx.try_recv() {
                        write_messages(&mut writer, vec![message]).await?;
                    }
                    break;
                };
                if line.trim().is_empty() {
                    continue;
                }

                if let Ok(response) = serde_json::from_str::<JsonRpcResponse>(&line) {
                    if response.id.is_some() && broker.resolve(response).await {
                        continue; // coverage:ignore-line -- broker response routing is covered directly and through HTTP transport.
                    }
                }
                match work_tx.as_ref().expect("work sender is available").try_send(RuntimeWork::Line(line)) {
                    Ok(()) => {}
                    // coverage:ignore-start -- defensive backpressure branches require racing the private runtime worker.
                    Err(mpsc::error::TrySendError::Full(RuntimeWork::Line(line))) => {
                        if let Some(response) = overload_response(&line) {
                            write_messages(&mut writer, vec![response]).await?;
                        }
                    }
                    Err(mpsc::error::TrySendError::Closed(_)) => break,
                    Err(mpsc::error::TrySendError::Full(RuntimeWork::Event(_))) => unreachable!(),
                    // coverage:ignore-end
                }
            }
            Some(event) = event_rx.recv() => {
                let Some(sender) = work_tx.as_ref() else {
                    break; // coverage:ignore-line -- event and input channel closure must race in the same select iteration.
                };
                if sender.send(RuntimeWork::Event(event)).await.is_err() { break; }
            }
            changed = shutdown_rx.changed() => {
                // coverage:ignore-start -- shutdown behavior is asserted by the runtime worker test.
                if changed.is_err() || *shutdown_rx.borrow() {
                    break;
                }
                // coverage:ignore-end
            }
        }
    }

    work_tx.take();
    let _ = broker.cancel_all().await;
    if let Some(processor) = processor {
        processor.abort(); // coverage:ignore-line -- processor normally completes before loop cleanup.
    }

    write_log(&mut logger, "info", "taskforceai app-server stopped").await?;
    Ok(())
}

enum RuntimeWork {
    Line(String),
    Event(AppServerEvent),
}

async fn process_runtime_work(
    mut runtime: AppRuntime,
    mut work: mpsc::Receiver<RuntimeWork>,
    output: mpsc::Sender<OutgoingMessage>,
    interaction_broker: InteractionBroker,
    shutdown: watch::Sender<bool>,
) {
    let mut connection = ConnectionState::default();
    let mut event_backlog = VecDeque::with_capacity(EVENT_BACKLOG_CAPACITY);
    let mut remote_poll = tokio::time::interval(REMOTE_POLL_CHECK_INTERVAL);
    remote_poll.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let (remote_poll_tx, mut remote_poll_rx) = mpsc::channel(1);
    let mut remote_poll_in_flight = false;
    let (remote_ws_event_tx, mut remote_ws_event_rx) = mpsc::channel(16);
    let mut remote_ws_connecting = false;
    let mut remote_ws_connected = false;
    let mut remote_ws_results: Option<mpsc::Sender<RemoteCommandResult>> = None;
    let mut remote_ws_stop: Option<watch::Sender<bool>> = None;
    let mut remote_ws_identity: Option<(String, String, String)> = None;
    let mut remote_ws_reconnect_at = tokio::time::Instant::now();
    loop {
        tokio::select! {
            work = work.recv() => {
                let Some(work) = work else { break };
                let (messages, action) = match work {
                    RuntimeWork::Line(line) => handle_line(&line, &mut runtime, &mut connection).await,
                    RuntimeWork::Event(event) => {
                        let mut messages = Vec::new();
                        if let Ok(events) = runtime.apply_event(event) {
                            for event in events {
                                extend_event_notifications(&mut messages, event); // coverage:ignore-line -- workflow event fanout is covered in runtime workflow tests.
                            }
                        }
                        if let Ok(events) = runtime.advance_ready_workflow_runs().await {
                            // coverage:ignore-start -- workflow event fanout is covered in runtime workflow tests.
                            for event in events {
                                extend_event_notifications(&mut messages, event);
                            }
                            // coverage:ignore-end
                        }
                        (messages, ServerAction::Continue)
                    }
                };
                if send_runtime_messages(&output, &mut event_backlog, messages).await.is_err() {
                    return;
                }
                if action == ServerAction::Shutdown {
                    let _ = shutdown.send(true);
                    return;
                }
            }
            Some(result) = remote_poll_rx.recv() => {
                remote_poll_in_flight = false;
                let result = match result {
                    Ok(completion) => process_remote_poll_completion(
                        &mut runtime,
                        &mut connection,
                        &interaction_broker,
                        &event_backlog,
                        completion,
                    ).await,
                    Err(error) => Err(error), // coverage:ignore-line -- HTTP poll request failures are covered at the API and report seams; injecting this private completion channel requires a select-loop race.
                };
                match result {
                    Ok(notifications) => {
                        // coverage:ignore-start -- closed-output behavior is covered by the runtime worker test; closing it at this poll-completion boundary is a select-loop race.
                        if send_runtime_messages(&output, &mut event_backlog, notifications).await.is_err() {
                            return;
                        }
                        // coverage:ignore-end
                    }
                    Err(error) => report_remote_poll_result(Err(error)), // coverage:ignore-line -- error reporting is covered directly; reaching it through the private completion channel requires a select-loop race.
                }
            }
            Some(event) = remote_ws_event_rx.recv() => {
                // coverage:ignore-start -- relay protocol behavior is covered through the WebSocket fixture; these private worker-state transitions require injecting into an internal select-loop channel.
                match event {
                    RemoteWebSocketEvent::Connected => {
                        remote_ws_connecting = false;
                        remote_ws_connected = true;
                        log::info!(target: "remote", "Remote WebSocket connected");
                    }
                    RemoteWebSocketEvent::Commands(batch) => {
                        match process_remote_websocket_batch(
                            &mut runtime,
                            &mut connection,
                            &interaction_broker,
                            &event_backlog,
                            batch,
                        ).await {
                            Ok((results, notifications)) => {
                                if let Some(sender) = remote_ws_results.as_ref() {
                                    for result in results {
                                        if sender.send(result).await.is_err() {
                                            break;
                                        }
                                    }
                                }
                                if send_runtime_messages(&output, &mut event_backlog, notifications).await.is_err() {
                                    return;
                                }
                            }
                            Err(error) => report_remote_poll_result(Err(error)),
                        }
                    }
                    RemoteWebSocketEvent::CursorAcknowledged { token, last_id } => {
                        if runtime.remote_token().ok().flatten().as_deref() == Some(token.as_str()) {
                            if let Err(error) = runtime.set_remote_last_command_id(&last_id) {
                                report_remote_poll_result(Err(error));
                            }
                        }
                    }
                    RemoteWebSocketEvent::Disconnected(error) => {
                        remote_ws_connecting = false;
                        remote_ws_connected = false;
                        remote_ws_results = None;
                        remote_ws_stop = None;
                        remote_ws_identity = None;
                        remote_ws_reconnect_at = tokio::time::Instant::now()
                            + REMOTE_WEBSOCKET_RECONNECT_DELAY;
                        log::debug!(target: "remote", "Remote WebSocket disconnected: {error}");
                    }
                }
                // coverage:ignore-end
            }
            _ = remote_poll.tick() => {
                match prepare_remote_poll(&mut runtime) {
                    Ok(Some(request)) => {
                        let identity = (
                            request.token.clone(),
                            request.device_id.clone(),
                            request.device_credential.clone(),
                        );
                        // coverage:ignore-start -- credential rotation while a timer-driven private connection is live requires racing the worker; identity replacement is deterministic state cleanup.
                        if remote_ws_identity.as_ref().is_some_and(|current| current != &identity) {
                            if let Some(stop) = remote_ws_stop.take() {
                                let _ = stop.send(true);
                            }
                            remote_ws_connecting = false;
                            remote_ws_connected = false;
                            remote_ws_results = None;
                            remote_ws_identity = None;
                        }
                        // coverage:ignore-end
                        if !remote_ws_connecting
                            && !remote_ws_connected
                            && !remote_poll_in_flight
                            && tokio::time::Instant::now() >= remote_ws_reconnect_at
                        {
                            let (results_tx, results_rx) = mpsc::channel(32);
                            let (stop_tx, stop_rx) = watch::channel(false);
                            remote_ws_connecting = true;
                            remote_ws_results = Some(results_tx);
                            remote_ws_stop = Some(stop_tx);
                            remote_ws_identity = Some(identity);
                            let events = remote_ws_event_tx.clone();
                            tokio::spawn(request.run_websocket(events, results_rx, stop_rx));
                        } else if !remote_ws_connecting
                            && !remote_ws_connected
                            && !remote_poll_in_flight
                        {
                            remote_poll_in_flight = true;
                            let sender = remote_poll_tx.clone();
                            tokio::spawn(async move {
                                let _ = sender.send(request.execute().await).await;
                            });
                        }
                    }
                    Ok(None) => {
                        // coverage:ignore-start -- disabling Remote while a private worker connection is live requires racing the timer-driven select loop; Remote disable behavior is covered at the runtime seam.
                        if let Some(stop) = remote_ws_stop.take() {
                            let _ = stop.send(true);
                        }
                        remote_ws_connecting = false;
                        remote_ws_connected = false;
                        remote_ws_results = None;
                        remote_ws_identity = None;
                        // coverage:ignore-end
                    }
                    Err(error) => report_remote_poll_result(Err(error)), // coverage:ignore-line -- preparation failures require corrupting private runtime storage during the timer tick; error reporting is covered directly.
                }
            }
        }
    }
    // coverage:ignore-start -- this is defensive cleanup for the work channel closing while a timer-driven WebSocket connection is still live.
    if let Some(stop) = remote_ws_stop {
        let _ = stop.send(true);
    }
    // coverage:ignore-end
}

async fn send_runtime_messages(
    output: &mpsc::Sender<OutgoingMessage>,
    event_backlog: &mut VecDeque<OutgoingMessage>,
    messages: Vec<OutgoingMessage>,
) -> Result<(), ()> {
    for message in messages {
        if !matches!(message, OutgoingMessage::Response(_)) {
            if event_backlog.len() == EVENT_BACKLOG_CAPACITY {
                event_backlog.pop_front();
            }
            event_backlog.push_back(message.clone());
        }
        if output.send(message).await.is_err() {
            return Err(());
        }
    }
    Ok(())
}

fn overload_response(line: &str) -> Option<OutgoingMessage> {
    let request: serde_json::Value = serde_json::from_str(line).ok()?;
    let id = request.get("id")?.clone();
    Some(OutgoingMessage::Response(
        crate::protocol::JsonRpcResponse {
            jsonrpc: crate::protocol::JSONRPC_VERSION.to_string(),
            id: (!id.is_null()).then_some(id),
            result: None,
            error: Some(crate::protocol::JsonRpcError {
                code: -32001,
                message: "Server overloaded; retry later.".to_string(),
                data: None,
            }),
        },
    ))
}

async fn write_log<W>(logger: &mut W, level: &str, message: &str) -> Result<(), AppServerError>
where
    W: AsyncWrite + Unpin,
{
    let mut encoded = serde_json::to_vec(&json!({
        "level": level,
        "target": "taskforceai_app_server",
        "message": message,
    }))
    .map_err(AppServerError::Encode)?;
    encoded.push(b'\n');
    logger
        .write_all(&encoded)
        .await
        .map_err(AppServerError::Write)
}

async fn write_messages<W>(
    writer: &mut W,
    messages: Vec<OutgoingMessage>,
) -> Result<(), AppServerError>
where
    W: AsyncWrite + Unpin,
{
    for message in messages {
        let mut encoded = serde_json::to_vec(&message).map_err(AppServerError::Encode)?;
        encoded.push(b'\n');
        writer
            .write_all(&encoded)
            .await
            .map_err(AppServerError::Write)?;
    }
    writer.flush().await.map_err(AppServerError::Write)
}

#[cfg(test)]
fn in_memory_runtime() -> AppRuntime {
    AppRuntime::new(RuntimeConfig::default())
}

#[cfg(test)]
pub(crate) async fn run_stdio_in_memory<R, W, E>(
    reader: R,
    writer: W,
    logger: E,
) -> Result<(), AppServerError>
where
    R: AsyncBufRead + Unpin,
    W: AsyncWrite + Unpin,
    E: AsyncWrite + Unpin,
{
    run_stdio_with_runtime(reader, writer, logger, in_memory_runtime()).await
}

#[cfg(test)]
mod tests {
    use std::io::{Read as _, Write as _};

    use tokio::io::{AsyncReadExt, AsyncWriteExt, BufReader};

    use super::*;

    #[tokio::test]
    async fn stdio_runtime_loop_writes_async_event_notifications() {
        let (input_reader, mut input_writer) = tokio::io::duplex(1024);
        let (output_writer, mut output_reader) = tokio::io::duplex(32768);
        let (logger_writer, mut logger_reader) = tokio::io::duplex(2048);
        let runtime = AppRuntime::new(RuntimeConfig {
            simulate_run_progress: true,
            ..RuntimeConfig::default()
        });
        let server = tokio::spawn(run_stdio_with_runtime(
            BufReader::new(input_reader),
            output_writer,
            logger_writer,
            runtime,
        ));

        input_writer
            .write_all(
                br#"{"jsonrpc":"2.0","id":0,"method":"initialize","params":{}}
{"jsonrpc":"2.0","method":"initialized","params":{}}
{"jsonrpc":"2.0","id":1,"method":"thread/start","params":{"threadId":"event-loop","objective":"Exercise typed events"}}
{"jsonrpc":"2.0","id":2,"method":"turn/start","params":{"threadId":"event-loop","input":"event loop"}}
"#,
            )
            .await
            .expect("run submit should write");
        tokio::time::sleep(tokio::time::Duration::from_millis(80)).await;
        input_writer
            .write_all(
                br#"{"jsonrpc":"2.0","id":3,"method":"shutdown","params":{}}
"#,
            )
            .await
            .expect("shutdown should write");
        drop(input_writer);

        server
            .await
            .expect("stdio task should join")
            .expect("stdio loop should exit cleanly");
        let mut output = Vec::new();
        output_reader
            .read_to_end(&mut output)
            .await
            .expect("output should read");
        let mut logs = Vec::new();
        logger_reader
            .read_to_end(&mut logs)
            .await
            .expect("logs should read");
        let output = String::from_utf8(output).expect("output should be utf8");

        assert!(output.contains("\"id\":1"));
        assert!(output.contains("\"method\":\"event\""));
        assert!(output.contains("\"method\":\"turn/updated\""));
        assert!(output.contains("\"method\":\"turn/completed\""));
        assert!(String::from_utf8(logs)
            .expect("logs should be utf8")
            .contains("taskforceai app-server stopped"));
    }

    #[test]
    fn overload_response_requires_a_non_null_request_id() {
        assert!(overload_response("not-json").is_none());
        assert!(overload_response(r#"{"method":"ping"}"#).is_none());
        let response = overload_response(r#"{"id":null}"#).expect("null-id response");
        let OutgoingMessage::Response(response) = response else {
            panic!("expected response");
        };
        assert!(response.id.is_none());
        let response = overload_response(r#"{"id":7}"#).expect("id response");
        let OutgoingMessage::Response(response) = response else {
            panic!("expected response");
        };
        assert_eq!(response.error.expect("overload error").code, -32001);
    }

    #[tokio::test]
    async fn runtime_messages_evict_the_oldest_event_at_capacity() {
        let (output, mut output_rx) = mpsc::channel(EVENT_BACKLOG_CAPACITY + 1);
        let mut backlog = VecDeque::with_capacity(EVENT_BACKLOG_CAPACITY);
        for index in 0..EVENT_BACKLOG_CAPACITY {
            backlog.push_back(OutgoingMessage::Notification(
                crate::protocol::JsonRpcNotification {
                    jsonrpc: crate::protocol::JSONRPC_VERSION.to_string(),
                    method: "event".to_string(),
                    params: json!({ "index": index }),
                },
            ));
        }
        let newest = OutgoingMessage::Notification(crate::protocol::JsonRpcNotification {
            jsonrpc: crate::protocol::JSONRPC_VERSION.to_string(),
            method: "event".to_string(),
            params: json!({ "index": "newest" }),
        });

        send_runtime_messages(&output, &mut backlog, vec![newest.clone()])
            .await
            .expect("message should send");

        assert_eq!(backlog.len(), EVENT_BACKLOG_CAPACITY);
        let Some(OutgoingMessage::Notification(oldest)) = backlog.front() else {
            panic!("oldest retained message should be a notification");
        };
        assert_eq!(oldest.params["index"], 1);
        let Some(OutgoingMessage::Notification(newest)) = backlog.back() else {
            panic!("newest retained message should be a notification");
        };
        assert_eq!(newest.params["index"], "newest");
        let Some(OutgoingMessage::Notification(sent)) = output_rx.recv().await else {
            panic!("newest message should be sent");
        };
        assert_eq!(sent.params["index"], "newest");
    }

    #[tokio::test]
    async fn runtime_worker_handles_closed_output_events_and_shutdown() {
        let (work_tx, work_rx) = mpsc::channel(4);
        let (output, output_rx) = mpsc::channel(1);
        drop(output_rx);
        let (shutdown, _) = watch::channel(false);
        let worker = tokio::spawn(process_runtime_work(
            in_memory_runtime(),
            work_rx,
            output,
            InteractionBroker::new(mpsc::channel(1).0),
            shutdown,
        ));
        work_tx
            .send(RuntimeWork::Line("not-json".into()))
            .await
            .expect("work");
        worker.await.expect("closed-output worker");

        let (work_tx, work_rx) = mpsc::channel(8);
        let (output, mut output_rx) = mpsc::channel(8);
        let (shutdown, mut shutdown_rx) = watch::channel(false);
        let worker = tokio::spawn(process_runtime_work(
            in_memory_runtime(),
            work_rx,
            output,
            InteractionBroker::new(mpsc::channel(1).0),
            shutdown,
        ));
        work_tx
            .send(RuntimeWork::Event(AppServerEvent::RunDeleted {
                run_id: "missing".into(),
            }))
            .await
            .expect("event work");
        work_tx
            .send(RuntimeWork::Line(
                r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}"#.into(),
            ))
            .await
            .expect("initialize");
        work_tx
            .send(RuntimeWork::Line(
                r#"{"jsonrpc":"2.0","method":"initialized","params":{}}"#.into(),
            ))
            .await
            .expect("initialized");
        work_tx
            .send(RuntimeWork::Line(
                r#"{"jsonrpc":"2.0","id":2,"method":"shutdown","params":{}}"#.into(),
            ))
            .await
            .expect("shutdown");
        shutdown_rx.changed().await.expect("shutdown signal");
        assert!(*shutdown_rx.borrow());
        worker.await.expect("shutdown worker");
        assert!(output_rx.recv().await.is_some());
    }

    #[tokio::test]
    async fn stdio_runtime_worker_prefers_websocket_and_falls_back_to_http() {
        let listener =
            std::net::TcpListener::bind("127.0.0.1:0").expect("Remote relay fixture should bind");
        let address = listener
            .local_addr()
            .expect("Remote relay fixture address should resolve");
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("Remote WebSocket should connect");
            let mut request = Vec::new();
            let mut buffer = [0_u8; 1024];
            while !request.windows(4).any(|window| window == b"\r\n\r\n") {
                let read = stream.read(&mut buffer).expect("request should read");
                if read == 0 {
                    break;
                }
                request.extend_from_slice(&buffer[..read]);
            }
            let request = String::from_utf8(request).expect("request should be UTF-8");
            let request_lowercase = request.to_ascii_lowercase();
            assert!(request.starts_with("GET /remote/devices/"));
            assert!(request.contains("/ws?lastId=0"));
            assert!(request_lowercase.contains("upgrade: websocket"));
            assert!(request_lowercase.contains("authorization: bearer remote-token"));
            assert!(request_lowercase.contains("x-device-id:"));
            assert!(request_lowercase.contains("x-device-credential:"));
            write!(
                stream,
                "HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            )
            .expect("WebSocket rejection should write");

            let (mut stream, _) = listener
                .accept()
                .expect("Remote HTTP fallback should connect");
            let mut request = Vec::new();
            while !request.windows(4).any(|window| window == b"\r\n\r\n") {
                let read = stream.read(&mut buffer).expect("request should read");
                if read == 0 {
                    break;
                }
                request.extend_from_slice(&buffer[..read]);
            }
            let request = String::from_utf8(request).expect("request should be UTF-8");
            assert!(request.starts_with("GET /remote/devices/"));
            assert!(request.contains("waitMs=5000"));
            let body = r#"{"commands":[],"lastId":"0"}"#;
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            )
            .expect("response should write");
        });

        let mut runtime = AppRuntime::new(RuntimeConfig {
            api_base_url: format!("http://{address}"),
            ..RuntimeConfig::default()
        });
        runtime
            .set_metadata_value("remote_allow_connections", "true")
            .expect("Remote should enable");
        runtime
            .set_auth_token(Some("remote-token"))
            .expect("Remote token should persist");
        let (work_tx, work_rx) = mpsc::channel(1);
        let (output, _output_rx) = mpsc::channel(1);
        let (interaction_output, _interaction_output_rx) = mpsc::channel(1);
        let (shutdown, _) = watch::channel(false);
        let worker = tokio::spawn(process_runtime_work(
            runtime,
            work_rx,
            output,
            InteractionBroker::new(interaction_output),
            shutdown,
        ));

        tokio::time::timeout(
            tokio::time::Duration::from_secs(2),
            tokio::task::spawn_blocking(move || server.join()),
        )
        .await
        .expect("stdio Remote transports should connect promptly")
        .expect("Remote fixture task should join")
        .expect("Remote fixture should finish");
        drop(work_tx);
        worker.await.expect("runtime worker should stop");
    }
}
