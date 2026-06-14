use serde_json::json;
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncWrite, AsyncWriteExt};
use tokio::sync::mpsc;

use crate::protocol::OutgoingMessage;
use crate::runtime::{AppRuntime, RuntimeConfig};

use super::handler::handle_line;
use super::responses::event_notifications;
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
        write_log(
            &mut logger,
            "info",
            &format!("resumed {resumed_runs} remote run stream(s)"),
        )
        .await?;
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
                let events = match runtime.apply_event(event) {
                    Ok(events) => events,
                    Err(err) => {
                        write_log(&mut logger, "error", &err.to_string()).await?;
                        continue;
                    }
                };
                let mut messages = events.into_iter().flat_map(event_notifications).collect::<Vec<_>>();
                let workflow_events = match runtime.advance_ready_workflow_runs().await {
                    Ok(events) => events,
                    Err(err) => {
                        write_log(&mut logger, "error", &err.to_string()).await?;
                        continue;
                    }
                };
                messages.extend(workflow_events.into_iter().flat_map(event_notifications));
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
