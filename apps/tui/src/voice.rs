use std::env;
#[cfg(all(unix, not(target_os = "macos")))]
use std::fs;
use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::json;
use taskforceai_app_protocol::{
    VoiceRealtimeSetupParams, VoiceRealtimeSetupResult, VoiceSpeechGenerateResult,
    VoiceTranscribeParams,
};
use thiserror::Error;
use tokio::process::Command as TokioCommand;
use tokio::time;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::Message;

pub const LISTEN_COMMAND_ENV: &str = "TASKFORCEAI_TUI_VOICE_LISTEN_COMMAND";
pub const VOICE_GATEWAY_BASE_URL_ENV: &str = "TASKFORCEAI_VOICE_GATEWAY_URL";
pub const VOICE_LISTEN_DURATION_MS_ENV: &str = "TASKFORCEAI_TUI_VOICE_LISTEN_DURATION_MS";
pub const REALTIME_TURN_DURATION_MS_ENV: &str = "TASKFORCEAI_TUI_REALTIME_TURN_DURATION_MS";

#[cfg(test)]
pub(crate) static VOICE_ENV_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

const DEFAULT_VOICE_GATEWAY_BASE_URL: &str = "https://www.taskforceai.chat";
const REALTIME_INPUT_SAMPLE_RATE: u32 = 16_000;
const REALTIME_OUTPUT_SAMPLE_RATE: u32 = 24_000;
const REALTIME_PROTOCOL_VERSION: &str = "ai-gateway-realtime.v1";
const REALTIME_AUTH_PROTOCOL_PREFIX: &str = "ai-gateway-auth.";
const DEFAULT_LISTEN_DURATION: Duration = Duration::from_secs(5);
const DEFAULT_REALTIME_TURN_DURATION: Duration = Duration::from_secs(8);
const MIN_RECORDED_SAMPLES: usize = 800;

#[derive(Debug, Error)]
pub enum VoiceError {
    #[error("voice command failed: {0}")]
    CommandFailed(String),
    #[error("voice command produced no transcript")]
    EmptyTranscript,
    #[error("audio input failed: {0}")]
    AudioInput(String),
    #[error("audio playback failed: {0}")]
    AudioPlayback(String),
    #[error("realtime voice failed: {0}")]
    Realtime(String),
    #[error("voice command IO failed: {0}")]
    Io(#[from] std::io::Error),
}

#[derive(Debug)]
pub enum DictationCapture {
    Transcript(String),
    Audio(RecordedAudio),
}

pub struct ActiveRecording {
    samples: Arc<Mutex<Vec<i16>>>,
    sample_rate: u32,
    stream: cpal::Stream,
}

#[derive(Debug, Clone)]
pub struct RecordedAudio {
    bytes: Vec<u8>,
    media_type: &'static str,
    pcm_i16: Vec<i16>,
    sample_rate: u32,
}

#[derive(Debug, Clone)]
pub struct RealtimeTurnResult {
    pub user_transcript: Option<String>,
    pub assistant_transcript: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RealtimeServerEvent {
    #[serde(rename = "type")]
    event_type: String,
    #[serde(default)]
    delta: Option<String>,
    #[serde(default)]
    transcript: Option<String>,
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    message: Option<String>,
}

pub fn status_message() -> String {
    let listen = match env::var(LISTEN_COMMAND_ENV) {
        Ok(command) if !command.trim().is_empty() => {
            format!("dictation: configured via {LISTEN_COMMAND_ENV}")
        }
        _ => "dictation: hosted xai/grok-stt with microphone capture".to_string(),
    };
    format!(
        "{listen}\nrealtime: hosted xai/grok-voice-think-fast-1.0 via /voice realtime\nspeak: hosted xai/grok-tts when signed in, otherwise {}\ncancel: {}\nusage: /voice [status|listen|replace|realtime|speak <text>|cancel]\nkeyboard: hold Space to dictate when the terminal supports key release events\nbase URL: {}",
        platform_speak_label(),
        platform_cancel_label(),
        voice_gateway_base_url()
    )
}

// coverage:ignore-start -- may fall back to live microphone capture.
pub async fn capture_dictation() -> Result<DictationCapture, VoiceError> {
    if let Some(transcript) = listen_transcript_from_command().await? {
        return Ok(DictationCapture::Transcript(transcript));
    }

    let audio = record_for_duration(listen_duration()).await?;
    Ok(DictationCapture::Audio(audio))
}
// coverage:ignore-end

pub fn transcribe_params(audio: &RecordedAudio) -> VoiceTranscribeParams {
    VoiceTranscribeParams {
        audio_base64: BASE64.encode(&audio.bytes),
        media_type: audio.media_type.to_string(),
        file_name: Some("dictation.wav".to_string()),
    }
}

pub fn realtime_setup_params() -> VoiceRealtimeSetupParams {
    VoiceRealtimeSetupParams {
        session_config: Some(realtime_session_config()),
    }
}

// coverage:ignore-start -- successful path spawns host audio playback.
pub fn play_generated_speech(result: &VoiceSpeechGenerateResult) -> Result<(), VoiceError> {
    let bytes = BASE64
        .decode(result.audio_base64.trim())
        .map_err(|err| VoiceError::AudioPlayback(err.to_string()))?;
    if bytes.is_empty() {
        return Err(VoiceError::AudioPlayback(
            "speech generation returned empty audio".to_string(),
        ));
    }
    play_audio_bytes(&bytes, &result.media_type)
}
// coverage:ignore-end

// coverage:ignore-start -- spawns the host speech synthesizer.
pub fn speak_with_platform_voice(text: &str) -> Result<(), VoiceError> {
    let text = text.trim();
    if text.is_empty() {
        return Err(VoiceError::CommandFailed("nothing to speak".to_string()));
    }
    platform_speak_command(text).spawn()?;
    Ok(())
}
// coverage:ignore-end

// coverage:ignore-start -- spawns host speech/audio cancellation commands.
pub fn cancel_speech() -> Result<(), VoiceError> {
    platform_cancel_command().spawn()?;
    Ok(())
}
// coverage:ignore-end

// coverage:ignore-start -- captures microphone audio and exchanges a live realtime WebSocket turn.
pub async fn run_realtime_turn(
    setup: VoiceRealtimeSetupResult,
) -> Result<RealtimeTurnResult, VoiceError> {
    if setup.token.trim().is_empty() || setup.url.trim().is_empty() {
        return Err(VoiceError::Realtime(
            "realtime setup returned invalid session data".to_string(),
        ));
    }

    let audio = record_for_duration(realtime_turn_duration()).await?;
    let realtime_pcm = resample_pcm_i16(
        &audio.pcm_i16,
        audio.sample_rate,
        REALTIME_INPUT_SAMPLE_RATE,
    );
    let realtime_audio = BASE64.encode(pcm_i16_to_le_bytes(&realtime_pcm));
    let mut request = setup
        .url
        .as_str()
        .into_client_request()
        .map_err(|err| VoiceError::Realtime(err.to_string()))?;
    let protocols = format!(
        "{REALTIME_PROTOCOL_VERSION}, {REALTIME_AUTH_PROTOCOL_PREFIX}{}",
        setup.token
    );
    request.headers_mut().insert(
        "Sec-WebSocket-Protocol",
        HeaderValue::from_str(&protocols).map_err(|err| VoiceError::Realtime(err.to_string()))?,
    );

    let (mut socket, _) = connect_async(request)
        .await
        .map_err(|err| VoiceError::Realtime(err.to_string()))?;
    send_realtime_event(&mut socket, realtime_session_update()).await?;
    send_realtime_event(
        &mut socket,
        json!({"type": "input-audio-append", "audio": realtime_audio}),
    )
    .await?;
    send_realtime_event(&mut socket, json!({"type": "input-audio-commit"})).await?;
    send_realtime_event(&mut socket, json!({"type": "response-create"})).await?;

    let mut user_transcript = None;
    let mut assistant_transcript = String::new();
    let mut response_audio = Vec::new();
    let deadline = time::Instant::now() + Duration::from_secs(30);
    while time::Instant::now() < deadline {
        let message = match time::timeout(Duration::from_secs(5), socket.next()).await {
            Ok(Some(message)) => message,
            Ok(None) => break,
            Err(_)
                if has_realtime_partials(
                    &user_transcript,
                    &assistant_transcript,
                    &response_audio,
                ) =>
            {
                break;
            }
            Err(_) => {
                return Err(VoiceError::Realtime(
                    "timed out waiting for realtime response".into(),
                ));
            }
        };
        let message = message.map_err(|err| VoiceError::Realtime(err.to_string()))?;
        let Message::Text(text) = message else {
            continue;
        };
        let Ok(event) = serde_json::from_str::<RealtimeServerEvent>(text.as_str()) else {
            continue;
        };
        match event.event_type.as_str() {
            "input-transcription-completed" => {
                user_transcript = event.transcript.filter(|value| !value.trim().is_empty());
            }
            "audio-transcript-delta" | "text-delta" => {
                if let Some(delta) = event.delta {
                    assistant_transcript.push_str(&delta);
                }
            }
            "audio-transcript-done" => {
                if let Some(transcript) = event.transcript {
                    assistant_transcript = transcript;
                }
            }
            "text-done" => {
                if let Some(text) = event.text {
                    assistant_transcript = text;
                }
            }
            "audio-delta" => {
                if let Some(delta) = event.delta {
                    let chunk = BASE64
                        .decode(delta)
                        .map_err(|err| VoiceError::Realtime(err.to_string()))?;
                    response_audio.extend_from_slice(&chunk);
                }
            }
            "response-done" => break,
            "error" => {
                return Err(VoiceError::Realtime(
                    event.message.unwrap_or_else(|| "gateway error".to_string()),
                ));
            }
            _ => {
                if matches!(event.status.as_deref(), Some("failed" | "cancelled")) {
                    return Err(VoiceError::Realtime(
                        event
                            .status
                            .unwrap_or_else(|| "response failed".to_string()),
                    ));
                }
            }
        }
    }

    let _ = socket.close(None).await;
    if !response_audio.is_empty() {
        let wav = wav_bytes_from_pcm_i16_bytes(&response_audio, REALTIME_OUTPUT_SAMPLE_RATE);
        play_audio_bytes(&wav, "audio/wav")?;
    }

    let assistant_transcript = assistant_transcript.trim().to_string();
    Ok(RealtimeTurnResult {
        user_transcript,
        assistant_transcript: (!assistant_transcript.is_empty()).then_some(assistant_transcript),
    })
}
// coverage:ignore-end

fn has_realtime_partials(
    user_transcript: &Option<String>,
    assistant_transcript: &str,
    response_audio: &[u8],
) -> bool {
    user_transcript
        .as_ref()
        .is_some_and(|value| !value.trim().is_empty())
        || !assistant_transcript.trim().is_empty()
        || !response_audio.is_empty()
}

// coverage:ignore-start -- opens the system microphone input stream.
pub fn start_recording() -> Result<ActiveRecording, VoiceError> {
    let host = cpal::default_host();
    let device = host.default_input_device().ok_or_else(|| {
        VoiceError::AudioInput("no default microphone input device was found".to_string())
    })?;
    let supported_config = device
        .default_input_config()
        .map_err(|err| VoiceError::AudioInput(err.to_string()))?;
    let sample_rate = supported_config.sample_rate().0;
    let channels = supported_config.channels().max(1) as usize;
    let config = supported_config.config();
    let samples = Arc::new(Mutex::new(Vec::<i16>::new()));
    let stream = match supported_config.sample_format() {
        cpal::SampleFormat::F32 => {
            build_input_stream(&device, &config, channels, &samples, f32_to_i16)
        }
        cpal::SampleFormat::I16 => {
            build_input_stream(&device, &config, channels, &samples, |value| value)
        }
        cpal::SampleFormat::U16 => {
            build_input_stream(&device, &config, channels, &samples, u16_to_i16)
        }
        other => Err(VoiceError::AudioInput(format!(
            "unsupported microphone sample format: {other:?}"
        ))),
    }?;
    stream
        .play()
        .map_err(|err| VoiceError::AudioInput(err.to_string()))?;
    Ok(ActiveRecording {
        samples,
        sample_rate,
        stream,
    })
}
// coverage:ignore-end

// coverage:ignore-start -- waits on live microphone input.
pub async fn record_for_duration(duration: Duration) -> Result<RecordedAudio, VoiceError> {
    tokio::task::spawn_blocking(move || {
        let recording = start_recording()?;
        std::thread::sleep(duration);
        recording.finish()
    })
    .await
    .map_err(|err| VoiceError::AudioInput(format!("recording task failed: {err}")))?
}
// coverage:ignore-end

// coverage:ignore-start -- finishes a live CPAL input stream.
impl ActiveRecording {
    pub fn finish(self) -> Result<RecordedAudio, VoiceError> {
        drop(self.stream);
        let pcm_i16 = self
            .samples
            .lock()
            .map_err(|_| VoiceError::AudioInput("recording buffer lock failed".to_string()))?
            .clone();
        if pcm_i16.len() < MIN_RECORDED_SAMPLES {
            return Err(VoiceError::AudioInput(
                "recorded audio was too short".to_string(),
            ));
        }
        let bytes = wav_bytes_from_pcm_i16(&pcm_i16, self.sample_rate);
        Ok(RecordedAudio {
            bytes,
            media_type: "audio/wav",
            pcm_i16,
            sample_rate: self.sample_rate,
        })
    }
}
// coverage:ignore-end

async fn listen_transcript_from_command() -> Result<Option<String>, VoiceError> {
    let Some(command) = env::var(LISTEN_COMMAND_ENV)
        .ok()
        .filter(|value| !value.trim().is_empty())
    else {
        return Ok(None);
    };
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
    Ok(Some(transcript))
}

// coverage:ignore-start -- writes to a live realtime WebSocket.
async fn send_realtime_event(
    socket: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    value: serde_json::Value,
) -> Result<(), VoiceError> {
    socket
        .send(Message::Text(value.to_string().into()))
        .await
        .map_err(|err| VoiceError::Realtime(err.to_string()))
}
// coverage:ignore-end

// coverage:ignore-start -- builds a live CPAL input stream.
fn build_input_stream<T, F>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    channels: usize,
    samples: &Arc<Mutex<Vec<i16>>>,
    convert: F,
) -> Result<cpal::Stream, VoiceError>
where
    T: cpal::SizedSample + Copy + Send + 'static,
    F: Fn(T) -> i16 + Copy + Send + 'static,
{
    let samples = Arc::clone(samples);
    device
        .build_input_stream(
            config,
            move |data: &[T], _| push_input_samples(data, channels, &samples, convert),
            |err| tracing::warn!("TUI voice input stream error: {err}"),
            None,
        )
        .map_err(|err| VoiceError::AudioInput(err.to_string()))
}
// coverage:ignore-end

fn push_input_samples<T, F>(data: &[T], channels: usize, samples: &Arc<Mutex<Vec<i16>>>, convert: F)
where
    T: Copy,
    F: Fn(T) -> i16,
{
    let Ok(mut output) = samples.lock() else {
        return;
    };
    for frame in data.chunks(channels) {
        let mixed = frame
            .iter()
            .map(|sample| convert(*sample) as i32)
            .sum::<i32>()
            / frame.len().max(1) as i32;
        output.push(mixed.clamp(i16::MIN as i32, i16::MAX as i32) as i16);
    }
}

fn f32_to_i16(value: f32) -> i16 {
    (value.clamp(-1.0, 1.0) * i16::MAX as f32) as i16
}

fn u16_to_i16(value: u16) -> i16 {
    (value as i32 - 32_768).clamp(i16::MIN as i32, i16::MAX as i32) as i16
}

fn voice_gateway_base_url() -> String {
    env::var(VOICE_GATEWAY_BASE_URL_ENV)
        .ok()
        .map(|value| value.trim().trim_end_matches('/').to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_VOICE_GATEWAY_BASE_URL.to_string())
}

fn listen_duration() -> Duration {
    duration_from_env(VOICE_LISTEN_DURATION_MS_ENV).unwrap_or(DEFAULT_LISTEN_DURATION)
}

fn realtime_turn_duration() -> Duration {
    duration_from_env(REALTIME_TURN_DURATION_MS_ENV).unwrap_or(DEFAULT_REALTIME_TURN_DURATION)
}

fn duration_from_env(key: &str) -> Option<Duration> {
    let millis = env::var(key).ok()?.trim().parse::<u64>().ok()?;
    (millis > 0).then(|| Duration::from_millis(millis))
}

fn realtime_session_config() -> serde_json::Value {
    json!({
        "instructions": "You are TaskForceAI in a live voice conversation. Keep replies concise, useful, and easy to interrupt.",
        "inputAudioFormat": { "type": "audio/pcm", "rate": REALTIME_INPUT_SAMPLE_RATE },
        "inputAudioTranscription": {},
        "outputAudioFormat": { "type": "audio/pcm", "rate": REALTIME_OUTPUT_SAMPLE_RATE },
        "outputAudioTranscription": {},
        "outputModalities": ["audio"],
        "turnDetection": { "type": "server-vad" }
    })
}

fn realtime_session_update() -> serde_json::Value {
    json!({
        "type": "session-update",
        "config": realtime_session_config()
    })
}

fn pcm_i16_to_le_bytes(samples: &[i16]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(samples.len() * 2);
    for sample in samples {
        bytes.extend_from_slice(&sample.to_le_bytes());
    }
    bytes
}

fn resample_pcm_i16(samples: &[i16], from_rate: u32, to_rate: u32) -> Vec<i16> {
    if samples.is_empty() || from_rate == to_rate {
        return samples.to_vec();
    }
    let ratio = from_rate as f64 / to_rate as f64;
    let output_len = ((samples.len() as f64) / ratio).max(1.0).round() as usize;
    let mut output = Vec::with_capacity(output_len);
    for index in 0..output_len {
        let source = index as f64 * ratio;
        let left = source.floor() as usize;
        let right = (left + 1).min(samples.len().saturating_sub(1));
        let fraction = source - left as f64;
        let sample = samples[left] as f64 * (1.0 - fraction) + samples[right] as f64 * fraction;
        output.push(sample.round().clamp(i16::MIN as f64, i16::MAX as f64) as i16);
    }
    output
}

fn wav_bytes_from_pcm_i16(samples: &[i16], sample_rate: u32) -> Vec<u8> {
    wav_bytes_from_pcm_i16_bytes(&pcm_i16_to_le_bytes(samples), sample_rate)
}

fn wav_bytes_from_pcm_i16_bytes(pcm_bytes: &[u8], sample_rate: u32) -> Vec<u8> {
    let channels = 1_u16;
    let bytes_per_sample = 2_u16;
    let byte_rate = sample_rate * channels as u32 * bytes_per_sample as u32;
    let block_align = channels * bytes_per_sample;
    let data_len = pcm_bytes.len() as u32;
    let mut bytes = Vec::with_capacity(44 + pcm_bytes.len());
    bytes.extend_from_slice(b"RIFF");
    bytes.extend_from_slice(&(36 + data_len).to_le_bytes());
    bytes.extend_from_slice(b"WAVE");
    bytes.extend_from_slice(b"fmt ");
    bytes.extend_from_slice(&16_u32.to_le_bytes());
    bytes.extend_from_slice(&1_u16.to_le_bytes());
    bytes.extend_from_slice(&channels.to_le_bytes());
    bytes.extend_from_slice(&sample_rate.to_le_bytes());
    bytes.extend_from_slice(&byte_rate.to_le_bytes());
    bytes.extend_from_slice(&block_align.to_le_bytes());
    bytes.extend_from_slice(&(bytes_per_sample * 8).to_le_bytes());
    bytes.extend_from_slice(b"data");
    bytes.extend_from_slice(&data_len.to_le_bytes());
    bytes.extend_from_slice(pcm_bytes);
    bytes
}

// coverage:ignore-start -- writes a temp audio file and spawns host playback.
fn play_audio_bytes(bytes: &[u8], media_type: &str) -> Result<(), VoiceError> {
    let suffix = audio_suffix(media_type);
    let mut file = tempfile::Builder::new()
        .prefix("taskforceai-tui-voice-")
        .suffix(suffix)
        .tempfile()?;
    file.write_all(bytes)?;
    let (_file, path) = file.keep().map_err(|err| err.error)?;
    platform_audio_play_command(&path)?.spawn()?;
    Ok(())
}
// coverage:ignore-end

fn audio_suffix(media_type: &str) -> &'static str {
    if media_type.contains("wav") {
        ".wav"
    } else if media_type.contains("mp4") || media_type.contains("m4a") {
        ".m4a"
    } else {
        ".mp3"
    }
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

// coverage:ignore-start -- host OS speech command builder.
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
// coverage:ignore-end

// coverage:ignore-start -- host OS audio playback command builder.
fn platform_audio_play_command(path: &Path) -> Result<Command, VoiceError> {
    #[cfg(target_os = "macos")]
    {
        let mut command = Command::new("sh");
        let quoted = quote_shell_arg(path);
        command
            .args(["-c", &format!("afplay {quoted}; rm -f {quoted}")])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        Ok(command)
    }
    #[cfg(target_os = "windows")]
    {
        let mut command = Command::new("powershell");
        let escaped = path.to_string_lossy().replace('\'', "''");
        command
            .args([
                "-NoProfile",
                "-Command",
                &format!(
                    "Add-Type -AssemblyName PresentationCore; $p=New-Object System.Windows.Media.MediaPlayer; $p.Open([uri]'{escaped}'); $p.Play(); Start-Sleep -Seconds 30; Remove-Item -LiteralPath '{escaped}' -ErrorAction SilentlyContinue"
                ),
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        Ok(command)
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        if command_exists("ffplay") {
            let mut command = Command::new("sh");
            let quoted = quote_shell_arg(path);
            command
                .args([
                    "-c",
                    &format!("ffplay -nodisp -autoexit {quoted}; rm -f {quoted}"),
                ])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null());
            return Ok(command);
        }
        if command_exists("mpg123") {
            let mut command = Command::new("sh");
            let quoted = quote_shell_arg(path);
            command
                .args(["-c", &format!("mpg123 -q {quoted}; rm -f {quoted}")])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null());
            return Ok(command);
        }
        let _ = fs::remove_file(path);
        Err(VoiceError::AudioPlayback(
            "install ffplay or mpg123 to play generated speech audio".to_string(),
        ))
    }
}
// coverage:ignore-end

// coverage:ignore-start -- host OS speech/audio cancellation command builder.
fn platform_cancel_command() -> Command {
    #[cfg(target_os = "macos")]
    {
        let mut command = Command::new("sh");
        command
            .args(["-c", "killall say afplay >/dev/null 2>&1 || true"])
            .stdin(Stdio::null());
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
        let mut command = Command::new("sh");
        command
            .args(["-c", "spd-say --cancel >/dev/null 2>&1 || true; pkill -f 'ffplay -nodisp -autoexit' >/dev/null 2>&1 || true; pkill mpg123 >/dev/null 2>&1 || true"])
            .stdin(Stdio::null());
        command
    }
}
// coverage:ignore-end

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
        "killall say/afplay"
    }
    #[cfg(target_os = "windows")]
    {
        "not available for detached PowerShell speech"
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        "spd-say --cancel plus generated audio player stop"
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
fn command_exists(name: &str) -> bool {
    env::var_os("PATH")
        .map(|paths| env::split_paths(&paths).any(|path| path.join(name).is_file()))
        .unwrap_or(false)
}

#[cfg(not(target_os = "windows"))]
fn quote_shell_arg(path: &Path) -> String {
    let value = path.to_string_lossy();
    format!("'{}'", value.replace('\'', "'\\''"))
}

#[cfg(test)]
mod tests;
