use std::env;
use std::process::{Command, Stdio};

use thiserror::Error;
use tokio::process::Command as TokioCommand;

pub const LISTEN_COMMAND_ENV: &str = "TASKFORCEAI_TUI_VOICE_LISTEN_COMMAND";

#[derive(Debug, Error)]
pub enum VoiceError {
    #[error("{0} is not set")]
    ListenCommandMissing(&'static str),
    #[error("voice command failed: {0}")]
    CommandFailed(String),
    #[error("voice command produced no transcript")]
    EmptyTranscript,
    #[error("voice command IO failed: {0}")]
    Io(#[from] std::io::Error),
}

pub fn status_message() -> String {
    let listen = match env::var(LISTEN_COMMAND_ENV) {
        Ok(command) if !command.trim().is_empty() => {
            format!("listen: configured via {LISTEN_COMMAND_ENV}")
        }
        _ => format!("listen: configure {LISTEN_COMMAND_ENV} to print a transcript"),
    };
    format!(
        "{listen}\nspeak: {}\ncancel: {}\nusage: /voice [status|listen|replace|speak <text>|cancel]\nexample: {LISTEN_COMMAND_ENV}='your-transcriber --single-utterance'",
        platform_speak_label(),
        platform_cancel_label()
    )
}

pub async fn listen_transcript() -> Result<String, VoiceError> {
    let command = env::var(LISTEN_COMMAND_ENV)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .ok_or(VoiceError::ListenCommandMissing(LISTEN_COMMAND_ENV))?;
    let output = shell_command(&command).output().await?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if !stderr.is_empty() { stderr } else { stdout };
        return Err(VoiceError::CommandFailed(if detail.is_empty() {
            output.status.to_string()
        } else {
            detail
        }));
    }
    let transcript = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if transcript.is_empty() {
        return Err(VoiceError::EmptyTranscript);
    }
    Ok(transcript)
}

pub fn speak_text(text: &str) -> Result<(), VoiceError> {
    let text = text.trim();
    if text.is_empty() {
        return Err(VoiceError::CommandFailed("nothing to speak".to_string()));
    }
    platform_speak_command(text).spawn()?;
    Ok(())
}

pub fn cancel_speech() -> Result<(), VoiceError> {
    platform_cancel_command().spawn()?;
    Ok(())
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

fn platform_speak_command(text: &str) -> Command {
    #[cfg(target_os = "macos")]
    {
        let mut command = Command::new("say");
        command.args(["--", text]).stdin(Stdio::null());
        command
    }
    #[cfg(target_os = "windows")]
    {
        let escaped = text.replace('\'', "''");
        let script = format!(
            "Add-Type -AssemblyName System.Speech; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Speak('{escaped}')"
        );
        let mut command = Command::new("powershell");
        command
            .args(["-NoProfile", "-Command", &script])
            .stdin(Stdio::null());
        command
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let mut command = Command::new("spd-say");
        command.arg(text).stdin(Stdio::null());
        command
    }
}

fn platform_cancel_command() -> Command {
    #[cfg(target_os = "macos")]
    {
        let mut command = Command::new("killall");
        command.arg("say").stdin(Stdio::null());
        command
    }
    #[cfg(target_os = "windows")]
    {
        let mut command = Command::new("cmd");
        command.args(["/C", "exit", "0"]).stdin(Stdio::null());
        command
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let mut command = Command::new("spd-say");
        command.arg("--cancel").stdin(Stdio::null());
        command
    }
}

fn platform_speak_label() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        "macOS say"
    }
    #[cfg(target_os = "windows")]
    {
        "Windows SpeechSynthesizer"
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        "Speech Dispatcher spd-say"
    }
}

fn platform_cancel_label() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        "killall say"
    }
    #[cfg(target_os = "windows")]
    {
        "not available for detached PowerShell speech"
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        "spd-say --cancel"
    }
}

#[cfg(test)]
mod tests {
    use super::{listen_transcript, status_message, LISTEN_COMMAND_ENV};

    #[test]
    fn status_mentions_configuration_env() {
        let message = status_message();

        assert!(message.contains(LISTEN_COMMAND_ENV));
        assert!(message.contains("/voice"));
    }

    #[cfg(not(target_os = "windows"))]
    #[tokio::test]
    async fn listen_uses_configured_transcript_command() {
        std::env::set_var(LISTEN_COMMAND_ENV, "printf 'hello from voice\\n'");

        let transcript = listen_transcript().await.expect("transcript");

        assert_eq!(transcript, "hello from voice");
        std::env::remove_var(LISTEN_COMMAND_ENV);
    }
}
