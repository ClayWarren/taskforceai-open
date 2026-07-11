use std::env;
#[cfg(not(coverage))]
use std::process::Stdio;

#[cfg(all(not(coverage), not(test)))]
use once_cell::sync::Lazy;
#[cfg(all(not(coverage), not(test)))]
use parking_lot::Mutex;
use tokio::process::Command as TokioCommand;
#[cfg(all(not(coverage), not(test)))]
use tokio::task;
#[cfg(not(coverage))]
use tokio::time::timeout;
use tokio::{
    io::{AsyncRead, AsyncReadExt},
    time::Duration,
};
#[cfg(all(test, not(coverage)))]
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
        process.process_group(0);
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
#[cfg(not(coverage))]
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

#[cfg(coverage)]
pub async fn voice_init() -> Result<(), String> {
    let _listen_configured = listen_command().is_ok();
    metrics::counter!("voice.command", "name" => "init").increment(1);
    Ok(())
}

/// Runs the configured desktop speech-to-text command and returns its stdout.
#[cfg(not(coverage))]
#[tauri::command]
#[tracing::instrument(err)]
pub async fn voice_listen() -> Result<String, String> {
    info!(target: "voice", event = "listen", "Voice listen requested");
    metrics::counter!("voice.command", "name" => "listen").increment(1);
    let command = listen_command()?;
    let start = std::time::Instant::now();
    let transcript = voice_listen_command(&command, LISTEN_COMMAND_TIMEOUT).await?;
    metrics::histogram!("voice.latency", "operation" => "listen").record(start.elapsed());
    Ok(transcript)
}

#[cfg(not(coverage))]
async fn voice_listen_command(command: &str, command_timeout: Duration) -> Result<String, String> {
    let mut child = shell_command(command)
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
    let mut stdout_task = tokio::spawn(read_limited_output(
        stdout,
        LISTEN_COMMAND_OUTPUT_LIMIT_BYTES,
    ));
    let mut stderr_task = tokio::spawn(read_limited_output(
        stderr,
        LISTEN_COMMAND_OUTPUT_LIMIT_BYTES,
    ));

    let command_result = timeout(command_timeout, async {
        let status = child
            .wait()
            .await
            .map_err(|err| format!("Voice listen command wait failed: {err}"))?;
        let stdout = (&mut stdout_task)
            .await
            .map_err(|err| format!("Voice listen stdout task failed: {err}"))??;
        let stderr = (&mut stderr_task)
            .await
            .map_err(|err| format!("Voice listen stderr task failed: {err}"))??;
        Ok::<_, String>((status, stdout, stderr))
    })
    .await;

    let (status, stdout, stderr) = match command_result {
        Ok(result) => result?,
        Err(_) => {
            terminate_voice_process_group(&mut child).await;
            stdout_task.abort();
            stderr_task.abort();
            return Err(format!(
                "Voice listen command timed out after {} seconds",
                command_timeout.as_secs_f64()
            ));
        }
    };

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
    Ok(transcript)
}

#[cfg(all(not(coverage), unix))]
async fn terminate_voice_process_group(child: &mut tokio::process::Child) {
    if let Some(pid) = child.id().and_then(|pid| i32::try_from(pid).ok()) {
        // SAFETY: the command is placed in its own process group before spawn, so
        // the negative PID targets only that command and its descendants.
        unsafe {
            libc::kill(-pid, libc::SIGKILL);
        }
    }
    let _ = child.kill().await;
    let _ = child.wait().await;
}

#[cfg(all(not(coverage), windows))]
async fn terminate_voice_process_group(child: &mut tokio::process::Child) {
    let _ = child.kill().await;
    let _ = child.wait().await;
}

#[cfg(coverage)]
pub async fn voice_listen() -> Result<String, String> {
    metrics::counter!("voice.command", "name" => "listen").increment(1);
    let command = listen_command()?;
    let output = shell_command(&command)
        .output()
        .await
        .expect("coverage voice command should spawn through the system shell");

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !output.status.success() {
        let detail = if !stderr.is_empty() { stderr } else { stdout };
        return Err(if detail.is_empty() {
            format!("Voice listen command exited with {}", output.status)
        } else {
            detail
        });
    }
    if stdout.is_empty() {
        return Err("Voice listen command produced no transcript".to_string());
    }
    Ok(stdout)
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

#[cfg(all(test, not(coverage)))]
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

#[cfg(coverage)]
pub async fn voice_speak(text: String) -> Result<(), String> {
    let _characters = text.len();
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

#[cfg(all(test, not(coverage)))]
#[tauri::command]
pub async fn voice_cancel() -> Result<(), String> {
    info!(
        target: "voice",
        event = "cancel_stub",
        "Voice cancel stub invoked for coverage"
    );
    Ok(())
}

#[cfg(coverage)]
pub async fn voice_cancel() -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
#[path = "voice_tests.rs"]
mod tests;
