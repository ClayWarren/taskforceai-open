use serde_json::json;
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncWrite, AsyncWriteExt};
use tokio::sync::{mpsc, watch};

use crate::interactions::InteractionBroker;
use crate::protocol::{AppServerEvent, JsonRpcResponse, OutgoingMessage};
use crate::runtime::{AppRuntime, RuntimeConfig};

use super::handler::handle_line;
use super::responses::extend_event_notifications;
use super::{AppServerError, ConnectionState, ServerAction};

pub async fn run_stdio<R, W, E>(reader: R, writer: W, logger: E) -> Result<(), AppServerError>
where
    R: AsyncBufRead + Unpin,
    W: AsyncWrite + Unpin,
    E: AsyncWrite + Unpin,
{
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
    shutdown: watch::Sender<bool>,
) {
    let mut connection = ConnectionState::default();
    while let Some(work) = work.recv().await {
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
        for message in messages {
            if output.send(message).await.is_err() {
                return;
            }
        }
        if action == ServerAction::Shutdown {
            let _ = shutdown.send(true);
            return;
        }
    }
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
    async fn runtime_worker_handles_closed_output_events_and_shutdown() {
        let (work_tx, work_rx) = mpsc::channel(4);
        let (output, output_rx) = mpsc::channel(1);
        drop(output_rx);
        let (shutdown, _) = watch::channel(false);
        let worker = tokio::spawn(process_runtime_work(
            in_memory_runtime(),
            work_rx,
            output,
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
}
