use std::path::Path;
#[cfg(unix)]
use std::process::Command;
use std::sync::{Arc, Mutex};
#[cfg(unix)]
use std::time::Duration;

use taskforceai_app_protocol::{VoiceRealtimeSetupResult, VoiceSpeechGenerateResult};

#[cfg(not(target_os = "windows"))]
use super::quote_shell_arg;
use super::{
    audio_suffix, cancel_speech, capture_dictation, duration_from_env, f32_to_i16,
    has_realtime_partials, listen_duration, listen_transcript_from_command, pcm_i16_to_le_bytes,
    play_generated_speech, push_input_samples, realtime_session_update, realtime_setup_params,
    realtime_turn_duration, resample_pcm_i16, run_realtime_turn, spawn_tracked_playback,
    speak_with_platform_voice, status_message, transcribe_params, u16_to_i16,
    wav_bytes_from_pcm_i16, DictationCapture, RecordedAudio, VoiceError, LISTEN_COMMAND_ENV,
    REALTIME_TURN_DURATION_MS_ENV, VOICE_GATEWAY_BASE_URL_ENV, VOICE_LISTEN_DURATION_MS_ENV,
};

fn with_env<T>(key: &str, value: Option<&str>, run: impl FnOnce() -> T) -> T {
    let _guard = super::VOICE_ENV_TEST_LOCK
        .lock()
        .expect("voice env test lock");
    let previous = std::env::var_os(key);
    match value {
        Some(value) => std::env::set_var(key, value),
        None => std::env::remove_var(key),
    }
    let result = run();
    if let Some(previous) = previous {
        std::env::set_var(key, previous);
    } else {
        std::env::remove_var(key);
    }
    result
}

#[test]
fn status_mentions_voice_modes() {
    let message = status_message();

    assert!(message.contains("/voice"));
    assert!(message.contains("dictation"));
    assert!(message.contains("realtime"));
    assert!(message.contains("hold Space"));
}

#[cfg(unix)]
#[test]
fn cancellation_stops_only_tracked_playback_and_cleans_temporary_files() {
    let _guard = super::VOICE_ENV_TEST_LOCK
        .lock()
        .expect("voice playback test lock");
    let file = tempfile::NamedTempFile::new().expect("temporary audio");
    let (_file, path) = file.keep().expect("persist temporary audio");
    let mut command = Command::new("sleep");
    command.arg("5");
    spawn_tracked_playback(command, Some(path.clone())).expect("tracked playback");

    cancel_speech().expect("cancel tracked playback");
    for _ in 0..50 {
        if !path.exists() {
            return;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    panic!("tracked playback temporary file was not cleaned up");
}

#[test]
fn status_uses_configured_gateway_base() {
    with_env(
        VOICE_GATEWAY_BASE_URL_ENV,
        Some("https://voice.example/"),
        || {
            assert!(status_message().contains("base URL: https://voice.example"));
        },
    );
}

#[test]
fn status_mentions_configured_dictation_command() {
    with_env(LISTEN_COMMAND_ENV, Some("printf hello"), || {
        assert!(status_message().contains("configured via TASKFORCEAI_TUI_VOICE_LISTEN_COMMAND"));
    });
}

#[test]
fn wav_header_uses_pcm_payload_size() {
    let wav = wav_bytes_from_pcm_i16(&[0, 100, -100], 16_000);

    assert_eq!(&wav[0..4], b"RIFF");
    assert_eq!(&wav[8..12], b"WAVE");
    assert_eq!(&wav[36..40], b"data");
    assert_eq!(u32::from_le_bytes(wav[40..44].try_into().unwrap()), 6);
}

#[test]
fn converts_recording_to_transcribe_params() {
    let params = transcribe_params(&RecordedAudio {
        bytes: b"wav".to_vec(),
        media_type: "audio/wav",
        pcm_i16: Vec::new(),
        sample_rate: 16_000,
    });

    assert_eq!(params.audio_base64, "d2F2");
    assert_eq!(params.media_type, "audio/wav");
    assert_eq!(params.file_name.as_deref(), Some("dictation.wav"));
}

#[test]
fn realtime_setup_uses_audio_session_config() {
    let params = realtime_setup_params();
    let config = params.session_config.expect("session config");

    assert_eq!(
        config["inputAudioFormat"],
        serde_json::json!({"type": "audio/pcm", "rate": 16_000})
    );
    assert_eq!(config["outputModalities"], serde_json::json!(["audio"]));
}

#[test]
fn resamples_pcm_for_realtime_input() {
    let input = [0, 10, 20, 30, 40, 50];
    let output = resample_pcm_i16(&input, 48_000, 16_000);

    assert_eq!(output, vec![0, 30]);
    assert_eq!(resample_pcm_i16(&[], 48_000, 16_000), Vec::<i16>::new());
    assert_eq!(resample_pcm_i16(&[1, 2], 16_000, 16_000), vec![1, 2]);
    assert_eq!(pcm_i16_to_le_bytes(&[1, -2]), vec![1, 0, 254, 255]);
}

#[test]
fn input_sample_helpers_mix_and_convert_samples() {
    let samples = Arc::new(Mutex::new(Vec::new()));
    push_input_samples(&[1_i16, 3, 5, 7], 2, &samples, |value| value);

    assert_eq!(*samples.lock().expect("samples"), vec![2, 6]);
    let poisoned = Arc::new(Mutex::new(Vec::new()));
    let poisoned_for_thread = Arc::clone(&poisoned);
    let _ = std::thread::spawn(move || {
        let _guard = poisoned_for_thread.lock().expect("poison test lock");
        panic!("poison sample lock");
    })
    .join();
    push_input_samples(&[1_i16], 1, &poisoned, |value| value);
    assert_eq!(f32_to_i16(2.0), i16::MAX);
    assert_eq!(f32_to_i16(-2.0), i16::MIN + 1);
    assert_eq!(u16_to_i16(0), i16::MIN);
    assert_eq!(u16_to_i16(u16::MAX), i16::MAX);
}

#[test]
fn duration_env_helpers_ignore_invalid_and_zero_values() {
    with_env(VOICE_LISTEN_DURATION_MS_ENV, Some("0"), || {
        assert_eq!(duration_from_env(VOICE_LISTEN_DURATION_MS_ENV), None);
    });
    with_env(VOICE_LISTEN_DURATION_MS_ENV, Some("abc"), || {
        assert_eq!(duration_from_env(VOICE_LISTEN_DURATION_MS_ENV), None);
    });
    with_env(REALTIME_TURN_DURATION_MS_ENV, Some("125"), || {
        assert_eq!(realtime_turn_duration().as_millis(), 125);
    });
    with_env(VOICE_LISTEN_DURATION_MS_ENV, None, || {
        assert_eq!(listen_duration().as_secs(), 5);
    });
}

#[test]
fn realtime_session_update_wraps_audio_config() {
    let update = realtime_session_update();

    assert_eq!(update["type"], "session-update");
    assert_eq!(update["config"]["outputAudioFormat"]["rate"], 24_000);
}

#[test]
fn realtime_partials_detect_transcripts_and_audio() {
    assert!(!has_realtime_partials(&None, "  ", &[]));
    assert!(has_realtime_partials(&Some(" hello ".to_string()), "", &[]));
    assert!(!has_realtime_partials(&Some("   ".to_string()), "", &[]));
    assert!(has_realtime_partials(&None, "assistant", &[]));
    assert!(has_realtime_partials(&None, "", &[1, 2]));
}

#[test]
fn audio_suffix_and_shell_quoting_cover_supported_media() {
    assert_eq!(audio_suffix("audio/wav"), ".wav");
    assert_eq!(audio_suffix("audio/mp4"), ".m4a");
    assert_eq!(audio_suffix("audio/mpeg"), ".mp3");
}

#[cfg(not(target_os = "windows"))]
#[test]
fn shell_quoting_escapes_single_quotes() {
    assert_eq!(
        quote_shell_arg(Path::new("/tmp/voice clip's.wav")),
        "'/tmp/voice clip'\\''s.wav'"
    );
}

#[test]
fn generated_speech_rejects_invalid_or_empty_audio_before_playback() {
    let invalid = VoiceSpeechGenerateResult {
        audio_base64: "not base64".to_string(),
        media_type: "audio/mpeg".to_string(),
        format: Some("mp3".to_string()),
    };
    assert!(matches!(
        play_generated_speech(&invalid),
        Err(VoiceError::AudioPlayback(_))
    ));

    let empty = VoiceSpeechGenerateResult {
        audio_base64: "".to_string(),
        media_type: "audio/mpeg".to_string(),
        format: Some("mp3".to_string()),
    };
    assert!(matches!(
        play_generated_speech(&empty),
        Err(VoiceError::AudioPlayback(message)) if message.contains("empty audio")
    ));
}

#[test]
fn platform_speech_rejects_empty_text_before_spawning() {
    assert!(matches!(
        speak_with_platform_voice("   "),
        Err(VoiceError::CommandFailed(message)) if message == "nothing to speak"
    ));
}

#[tokio::test]
async fn realtime_turn_rejects_invalid_setup_before_recording() {
    let err = run_realtime_turn(VoiceRealtimeSetupResult {
        url: "".to_string(),
        token: "token".to_string(),
        expires_at: Some(123),
        tools: None,
    })
    .await
    .expect_err("missing url should fail before microphone access");

    assert!(matches!(err, VoiceError::Realtime(message) if message.contains("invalid session")));
}

#[test]
fn generated_speech_result_shape_matches_protocol() {
    let result = VoiceSpeechGenerateResult {
        audio_base64: "YWJj".to_string(),
        media_type: "audio/mpeg".to_string(),
        format: Some("mp3".to_string()),
    };

    assert_eq!(result.media_type, "audio/mpeg");
    assert_eq!(result.format.as_deref(), Some("mp3"));
}

#[cfg(not(target_os = "windows"))]
#[allow(clippy::await_holding_lock)]
#[tokio::test(flavor = "current_thread")]
async fn capture_dictation_uses_configured_transcript_command() {
    let _guard = super::VOICE_ENV_TEST_LOCK
        .lock()
        .expect("voice env test lock");
    let previous = std::env::var_os(LISTEN_COMMAND_ENV);
    std::env::set_var(LISTEN_COMMAND_ENV, "printf 'hello from voice\\n'");

    let capture = capture_dictation().await.expect("transcript");

    assert!(
        matches!(capture, DictationCapture::Transcript(transcript) if transcript == "hello from voice")
    );
    if let Some(previous) = previous {
        std::env::set_var(LISTEN_COMMAND_ENV, previous);
    } else {
        std::env::remove_var(LISTEN_COMMAND_ENV);
    }
}

#[cfg(not(target_os = "windows"))]
#[allow(clippy::await_holding_lock)]
#[tokio::test(flavor = "current_thread")]
async fn capture_dictation_reports_command_failures_and_empty_transcripts() {
    let _guard = super::VOICE_ENV_TEST_LOCK
        .lock()
        .expect("voice env test lock");
    let previous = std::env::var_os(LISTEN_COMMAND_ENV);
    std::env::set_var(LISTEN_COMMAND_ENV, "printf 'bad stdout'; exit 7");
    let err = capture_dictation()
        .await
        .expect_err("failing transcript command should fail");
    assert!(matches!(err, VoiceError::CommandFailed(message) if message == "bad stdout"));

    std::env::set_var(LISTEN_COMMAND_ENV, "exit 7");
    let err = capture_dictation()
        .await
        .expect_err("failing transcript command without output should fail");
    assert!(matches!(err, VoiceError::CommandFailed(message) if !message.is_empty()));

    std::env::set_var(LISTEN_COMMAND_ENV, "printf ''");
    let err = capture_dictation()
        .await
        .expect_err("empty transcript command should fail");
    assert!(matches!(err, VoiceError::EmptyTranscript));

    if let Some(previous) = previous {
        std::env::set_var(LISTEN_COMMAND_ENV, previous);
    } else {
        std::env::remove_var(LISTEN_COMMAND_ENV);
    }
}

#[cfg(not(target_os = "windows"))]
#[allow(clippy::await_holding_lock)]
#[tokio::test(flavor = "current_thread")]
async fn listen_transcript_without_command_returns_none() {
    let _guard = super::VOICE_ENV_TEST_LOCK
        .lock()
        .expect("voice env test lock");
    let previous = std::env::var_os(LISTEN_COMMAND_ENV);
    std::env::remove_var(LISTEN_COMMAND_ENV);

    let transcript = listen_transcript_from_command()
        .await
        .expect("missing command should not fail");
    assert!(transcript.is_none());

    if let Some(previous) = previous {
        std::env::set_var(LISTEN_COMMAND_ENV, previous);
    }
}
