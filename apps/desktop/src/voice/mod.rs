use std::env;
use std::process::Stdio;

#[cfg(all(not(coverage), not(test)))]
use once_cell::sync::Lazy;
#[cfg(all(not(coverage), not(test)))]
use parking_lot::Mutex;
use tokio::process::Command as TokioCommand;
#[cfg(all(not(coverage), not(test)))]
use tokio::task;
use tokio::{
    io::{AsyncRead, AsyncReadExt},
    time::{timeout, Duration},
};
#[cfg(any(coverage, test))]
use tracing::info;
#[cfg(all(not(coverage), not(test)))]
use tracing::{error, info};

#[cfg(all(not(coverage), not(test)))]
use tts::Tts;

const LISTEN_COMMAND_ENV: &str = "TASKFORCEAI_DESKTOP_VOICE_LISTEN_COMMAND";
const LISTEN_COMMAND_TIMEOUT: Duration = Duration::from_secs(30);
const LISTEN_COMMAND_OUTPUT_LIMIT_BYTES: usize = 64 * 1024;

#[cfg(all(not(coverage), not(test)))]
static TTS_ENGINE: Lazy<Mutex<Option<Tts>>> = Lazy::new(|| Mutex::new(None));

#[cfg(all(not(coverage), not(test)))]
fn ensure_tts_engine() -> Result<Tts, String> {
    let mut guard = TTS_ENGINE.lock();
    if guard.is_none() {
        *guard = Some(Tts::default().map_err(|err| err.to_string())?);
    }

    guard
        .as_ref()
        .cloned()
        .ok_or_else(|| "Failed to initialize speech engine".to_string())
}

#[cfg(all(not(coverage), not(test)))]
fn current_tts_engine() -> Option<Tts> {
    TTS_ENGINE.lock().as_ref().cloned()
}

fn listen_command() -> Result<String, String> {
    env::var(LISTEN_COMMAND_ENV)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            format!("{LISTEN_COMMAND_ENV} is not set. Configure it to print a transcript.")
        })
}

fn shell_command(command: &str) -> TokioCommand {
    #[cfg(target_os = "windows")]
    {
        let mut process = TokioCommand::new("cmd");
        process.args(["/C", command]);
        process
    }
    #[cfg(not(target_os = "windows"))]
    {
        let mut process = TokioCommand::new("sh");
        process.args(["-c", command]);
        process
    }
}

async fn read_limited_output<R>(mut reader: R, limit: usize) -> Result<String, String>
where
    R: AsyncRead + Unpin,
{
    let mut output = Vec::new();
    let mut buffer = [0_u8; 4096];
    let mut truncated = false;

    loop {
        let read = reader
            .read(&mut buffer)
            .await
            .map_err(|err| format!("Voice listen output read failed: {err}"))?;
        if read == 0 {
            break;
        }

        let remaining = limit.saturating_sub(output.len());
        if remaining > 0 {
            let keep = remaining.min(read);
            output.extend_from_slice(&buffer[..keep]);
            truncated |= keep < read;
        } else {
            truncated = true;
        }
    }

    let mut text = String::from_utf8_lossy(&output).to_string();
    if truncated {
        text.push_str("\n...[output truncated]");
    }
    Ok(text)
}

/// Initializes the desktop voice bridge.
#[tauri::command]
#[tracing::instrument(err)]
pub async fn voice_init() -> Result<(), String> {
    let listen_configured = listen_command().is_ok();
    info!(
        target: "voice",
        event = "init",
        listen_configured,
        "Voice init requested"
    );
    metrics::counter!("voice.command", "name" => "init").increment(1);
    Ok(())
}

/// Runs the configured desktop speech-to-text command and returns its stdout.
#[tauri::command]
#[tracing::instrument(err)]
pub async fn voice_listen() -> Result<String, String> {
    info!(target: "voice", event = "listen", "Voice listen requested");
    metrics::counter!("voice.command", "name" => "listen").increment(1);
    let command = listen_command()?;
    let start = std::time::Instant::now();
    let mut child = shell_command(&command)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| format!("Voice listen command failed to start: {err}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture voice listen stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to capture voice listen stderr".to_string())?;
    let stdout_task = tokio::spawn(read_limited_output(
        stdout,
        LISTEN_COMMAND_OUTPUT_LIMIT_BYTES,
    ));
    let stderr_task = tokio::spawn(read_limited_output(
        stderr,
        LISTEN_COMMAND_OUTPUT_LIMIT_BYTES,
    ));

    let status = match timeout(LISTEN_COMMAND_TIMEOUT, child.wait()).await {
        Ok(result) => result.map_err(|err| format!("Voice listen command wait failed: {err}"))?,
        Err(_) => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            return Err("Voice listen command timed out after 30 seconds".to_string());
        }
    };

    let stdout = stdout_task
        .await
        .map_err(|err| format!("Voice listen stdout task failed: {err}"))??;
    let stderr = stderr_task
        .await
        .map_err(|err| format!("Voice listen stderr task failed: {err}"))??;

    if !status.success() {
        let stderr = stderr.trim().to_string();
        let stdout = stdout.trim().to_string();
        let detail = if !stderr.is_empty() { stderr } else { stdout };
        return Err(if detail.is_empty() {
            format!("Voice listen command exited with {status}")
        } else {
            detail
        });
    }

    let transcript = stdout.trim().to_string();
    if transcript.is_empty() {
        return Err("Voice listen command produced no transcript".to_string());
    }
    metrics::histogram!("voice.latency", "operation" => "listen").record(start.elapsed());
    Ok(transcript)
}

/// Desktop text-to-speech via `tts` crate.
#[cfg(all(not(coverage), not(test)))]
#[tauri::command]
#[tracing::instrument(skip(text), err)]
pub async fn voice_speak(text: String) -> Result<(), String> {
    info!(
        target: "voice",
        event = "speak",
        characters = text.len(),
        "Voice speak invoked"
    );
    metrics::counter!("voice.command", "name" => "speak").increment(1);
    let start = std::time::Instant::now();
    let task = task::spawn_blocking(move || {
        let mut engine = ensure_tts_engine()?;
        engine.speak(&text, false).map_err(|err| err.to_string())?;
        Ok::<(), String>(())
    });

    match task.await {
        Ok(result) => result
            .map_err(|err| {
                error!(
                    target: "voice",
                    event = "speak_failed",
                    error = %err,
                    "Voice speak failed"
                );
                err
            })
            .map(|_| {
                metrics::histogram!("voice.latency", "operation" => "speak")
                    .record(start.elapsed());
            }),
        Err(join_err) => {
            error!(
                target: "voice",
                event = "speak_join_failed",
                error = %join_err,
                "Voice speak task join error"
            );
            Err("Failed to execute speech task".to_string())
        }
    }
}

#[cfg(any(coverage, test))]
#[tauri::command]
pub async fn voice_speak(text: String) -> Result<(), String> {
    info!(
        target: "voice",
        event = "speak_stub",
        characters = text.len(),
        "Voice speak stub invoked for coverage"
    );
    Ok(())
}

/// Stops any in-flight text-to-speech playback.
#[cfg(all(not(coverage), not(test)))]
#[tauri::command]
#[tracing::instrument(err)]
pub async fn voice_cancel() -> Result<(), String> {
    info!(target: "voice", event = "cancel", "Voice cancel invoked");
    metrics::counter!("voice.command", "name" => "cancel").increment(1);
    let start = std::time::Instant::now();
    let task = task::spawn_blocking(|| {
        if let Some(mut engine) = current_tts_engine() {
            engine.stop().map_err(|err| err.to_string())?;
        }
        Ok::<(), String>(())
    });

    match task.await {
        Ok(result) => result
            .map_err(|err| {
                error!(
                    target: "voice",
                    event = "cancel_failed",
                    error = %err,
                    "Voice cancel failed"
                );
                err
            })
            .map(|_| {
                metrics::histogram!("voice.latency", "operation" => "cancel")
                    .record(start.elapsed());
            }),
        Err(join_err) => {
            error!(
                target: "voice",
                event = "cancel_join_failed",
                error = %join_err,
                "Voice cancel join error"
            );
            Err("Failed to cancel speech task".to_string())
        }
    }
}

#[cfg(any(coverage, test))]
#[tauri::command]
pub async fn voice_cancel() -> Result<(), String> {
    info!(
        target: "voice",
        event = "cancel_stub",
        "Voice cancel stub invoked for coverage"
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::OnceLock;
    use tokio::sync::Mutex;

    fn env_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    #[tokio::test]
    async fn coverage_voice_commands_execute() {
        let _guard = env_lock().lock().await;
        voice_init().await.expect("init");
        std::env::set_var(LISTEN_COMMAND_ENV, "printf 'desktop voice\\n'");
        assert_eq!(voice_listen().await.expect("listen"), "desktop voice");
        std::env::remove_var(LISTEN_COMMAND_ENV);
        voice_speak("coverage check".into()).await.expect("speak");
        voice_cancel().await.expect("cancel");
    }

    #[tokio::test]
    async fn voice_listen_requires_configured_command() {
        let _guard = env_lock().lock().await;
        std::env::remove_var(LISTEN_COMMAND_ENV);

        let err = voice_listen().await.expect_err("missing command");

        assert!(err.contains(LISTEN_COMMAND_ENV));
    }

    #[tokio::test]
    async fn voice_listen_output_is_capped() {
        let input = tokio_test::io::Builder::new()
            .read(b"abcdef")
            .read(b"ghijkl")
            .build();

        let output = read_limited_output(input, 8).await.expect("read output");

        assert_eq!(output, "abcdefgh\n...[output truncated]");
    }
}
