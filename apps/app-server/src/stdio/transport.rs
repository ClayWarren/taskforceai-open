use serde_json::json;
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncWrite, AsyncWriteExt};
use tokio::sync::mpsc;

use crate::protocol::OutgoingMessage;
use crate::runtime::{AppRuntime, RuntimeConfig};

use super::handler::handle_line;
use super::responses::extend_event_notifications;
use super::{AppServerError, ServerAction};

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

    loop {
        tokio::select! {
            line = lines.next_line() => {
                let Some(line) = line? else {
                    break;
                };
                if line.trim().is_empty() {
                    continue;
                }

                let (messages, action) = handle_line(&line, &mut runtime).await;
                write_messages(&mut writer, messages).await?;

                if action == ServerAction::Shutdown {
                    break;
                }
            }
            Some(event) = event_rx.recv() => {
                let events = match runtime.apply_event(event) { // coverage:ignore-line
                    Ok(events) => events, // coverage:ignore-line
        // coverage:ignore-start
                    Err(err) => {
                        write_log(&mut logger, "error", &err.to_string()).await?;
                        continue;
        // coverage:ignore-end
                    }
                };
                let mut messages = Vec::with_capacity(events.len() * 3);
                for event in events {
                    extend_event_notifications(&mut messages, event); // coverage:ignore-line
                } // coverage:ignore-line
                let workflow_events = match runtime.advance_ready_workflow_runs().await { // coverage:ignore-line
                    Ok(events) => events,
        // coverage:ignore-start
                    Err(err) => {
                        write_log(&mut logger, "error", &err.to_string()).await?;
                        continue;
        // coverage:ignore-end
                    }
                };
                messages.reserve(workflow_events.len() * 3);
                for event in workflow_events {
        // coverage:ignore-start
                    extend_event_notifications(&mut messages, event);
                }
        // coverage:ignore-end
                write_messages(&mut writer, messages).await?;
            }
        }
    }

    write_log(&mut logger, "info", "taskforceai app-server stopped").await?;
    Ok(())
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
        let (output_writer, mut output_reader) = tokio::io::duplex(8192);
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
                br#"{"jsonrpc":"2.0","id":1,"method":"run.submit","params":{"prompt":"event loop"}}
"#,
            )
            .await
            .expect("run submit should write");
        tokio::time::sleep(tokio::time::Duration::from_millis(80)).await;
        input_writer
            .write_all(
                br#"{"jsonrpc":"2.0","id":2,"method":"shutdown","params":{}}
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
}
