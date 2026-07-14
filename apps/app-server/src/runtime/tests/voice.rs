use super::support::{
    json_response, result_value, start_recording_response_sequence_server, MockHttpResponse,
};
use super::*;
use crate::protocol::{VoiceRealtimeSetupParams, VoiceSpeechGenerateParams, VoiceTranscribeParams};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::thread;

fn runtime_with_auth(base_url: &str) -> AppRuntime {
    let mut runtime = AppRuntime::new(RuntimeConfig {
        api_base_url: format!("{base_url}/api/v1"),
        auth_token_storage: AuthTokenStorage::Memory,
        ..RuntimeConfig::default()
    });
    runtime
        .set_auth_token(Some("token"))
        .expect("auth token should set");
    runtime
}

fn start_voice_status_server(status: &str, body: &str) -> (String, thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("voice status server should bind");
    let address = listener
        .local_addr()
        .expect("voice status address should be readable");
    let status = status.to_string();
    let body = body.to_string();
    let handle = thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("voice request should arrive");
        let mut buffer = [0_u8; 1024];
        let _ = stream.read(&mut buffer).expect("voice request should read");
        let response = format!(
            "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        stream
            .write_all(response.as_bytes())
            .expect("voice response should write");
    });
    (format!("http://{address}"), handle)
}

fn start_oversized_voice_server() -> (String, thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("voice size server should bind");
    let address = listener
        .local_addr()
        .expect("voice size address should be readable");
    let handle = thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("voice request should arrive");
        let mut buffer = [0_u8; 1024];
        let _ = stream.read(&mut buffer).expect("voice request should read");
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: audio/mpeg\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            crate::runtime::util::MAX_AUDIO_SIZE + 1
        );
        stream
            .write_all(response.as_bytes())
            .expect("voice response should write");
    });
    (format!("http://{address}"), handle)
}

#[tokio::test]
async fn voice_transcribe_posts_audio_to_hosted_route() {
    let (base_url, handle, requests) =
        start_recording_response_sequence_server(vec![json_response(
            json!({"text": "captured text"}).to_string(),
        )]);
    let runtime = runtime_with_auth(&base_url);

    let response = runtime
        .voice_transcribe(VoiceTranscribeParams {
            audio_base64: "d2F2".to_string(),
            media_type: "audio/wav".to_string(),
            file_name: Some("dictation.wav".to_string()),
        })
        .await
        .expect("voice transcribe should succeed");
    let result = result_value(response);

    assert_eq!(result["text"], "captured text");
    handle.join().expect("mock server should stop");
    let recorded = requests.lock().expect("requests lock").clone();
    assert_eq!(recorded[0].method, "POST");
    assert_eq!(recorded[0].path, "/api/dictation/transcribe");
    assert_eq!(
        recorded[0].headers.get("authorization").map(String::as_str),
        Some("Bearer token")
    );
    assert!(recorded[0]
        .headers
        .get("content-type")
        .is_some_and(|value| value.starts_with("multipart/form-data")));
    assert!(recorded[0].body.contains("dictation.wav"));
}

#[tokio::test]
async fn voice_speech_generate_returns_base64_audio() {
    let (base_url, handle, requests) =
        start_recording_response_sequence_server(vec![MockHttpResponse {
            body: "audio".to_string(),
            headers: vec![("x-taskforceai-audio-format", "mp3")],
        }]);
    let runtime = runtime_with_auth(&base_url);

    let response = runtime
        .voice_speech_generate(VoiceSpeechGenerateParams {
            text: "read this".to_string(),
        })
        .await
        .expect("voice speech should succeed");
    let result = result_value(response);

    assert_eq!(result["audioBase64"], "YXVkaW8=");
    assert_eq!(result["format"], "mp3");
    handle.join().expect("mock server should stop");
    let recorded = requests.lock().expect("requests lock").clone();
    assert_eq!(recorded[0].method, "POST");
    assert_eq!(recorded[0].path, "/api/speech/generate");
    assert_eq!(
        recorded[0].headers.get("authorization").map(String::as_str),
        Some("Bearer token")
    );
    assert!(recorded[0].body.contains("read this"));
}

#[tokio::test]
async fn voice_speech_generate_rejects_oversized_responses() {
    let (base_url, handle) = start_oversized_voice_server();
    let runtime = runtime_with_auth(&base_url);

    let error = runtime
        .voice_speech_generate(VoiceSpeechGenerateParams {
            text: "read this".to_string(),
        })
        .await
        .expect_err("oversized speech response should fail");
    assert!(error.message.contains("response exceeds"));
    handle.join().expect("voice size server should stop");
}

#[tokio::test]
async fn voice_realtime_setup_forwards_session_config() {
    let (base_url, handle, requests) =
        start_recording_response_sequence_server(vec![json_response(
            json!({
                "token": "session-token",
                "url": "wss://gateway.example/realtime",
                "expiresAt": 1234,
                "tools": []
            })
            .to_string(),
        )]);
    let runtime = runtime_with_auth(&base_url);

    let response = runtime
        .voice_realtime_setup(VoiceRealtimeSetupParams {
            session_config: Some(json!({
                "outputModalities": ["audio"]
            })),
        })
        .await
        .expect("voice realtime setup should succeed");
    let result = result_value(response);

    assert_eq!(result["token"], "session-token");
    assert_eq!(result["url"], "wss://gateway.example/realtime");
    handle.join().expect("mock server should stop");
    let recorded = requests.lock().expect("requests lock").clone();
    assert_eq!(recorded[0].method, "POST");
    assert_eq!(recorded[0].path, "/api/realtime/setup");
    assert_eq!(
        recorded[0].headers.get("authorization").map(String::as_str),
        Some("Bearer token")
    );
    assert!(recorded[0].body.contains("sessionConfig"));
    assert!(recorded[0].body.contains("outputModalities"));
}

#[tokio::test]
async fn voice_requires_auth_token() {
    let runtime = AppRuntime::new(RuntimeConfig::default());

    let error = runtime
        .voice_realtime_setup(VoiceRealtimeSetupParams::default())
        .await
        .expect_err("voice should require auth");

    assert_eq!(error.code, -32010);
}

#[tokio::test]
async fn voice_validation_rejects_invalid_input_before_network_calls() {
    let runtime = runtime_with_auth("http://127.0.0.1:9");

    let invalid_audio = runtime
        .voice_transcribe(VoiceTranscribeParams {
            audio_base64: "not base64".to_string(),
            media_type: "audio/wav".to_string(),
            file_name: None,
        })
        .await
        .expect_err("invalid base64 should fail");
    assert_eq!(invalid_audio.code, -32602);

    let empty_audio = runtime
        .voice_transcribe(VoiceTranscribeParams {
            audio_base64: "   ".to_string(),
            media_type: "audio/wav".to_string(),
            file_name: None,
        })
        .await
        .expect_err("empty audio should fail");
    assert!(empty_audio.message.contains("audioBase64 is required"));

    let oversized_audio = runtime
        .voice_transcribe(VoiceTranscribeParams {
            audio_base64: "A"
                .repeat((crate::runtime::util::MAX_AUDIO_SIZE.saturating_add(2) / 3 * 4) + 1),
            media_type: "audio/wav".to_string(),
            file_name: None,
        })
        .await
        .expect_err("oversized audio should fail before decoding");
    assert!(oversized_audio.message.contains("audio limit"));

    let decoded_oversized_audio = runtime
        .voice_transcribe(VoiceTranscribeParams {
            audio_base64: "A"
                .repeat(crate::runtime::util::MAX_AUDIO_SIZE.saturating_add(2) / 3 * 4),
            media_type: "audio/wav".to_string(),
            file_name: None,
        })
        .await
        .expect_err("decoded audio over the limit should fail");
    assert!(decoded_oversized_audio.message.contains("audio limit"));

    let missing_media_type = runtime
        .voice_transcribe(VoiceTranscribeParams {
            audio_base64: "d2F2".to_string(),
            media_type: "   ".to_string(),
            file_name: Some("   ".to_string()),
        })
        .await
        .expect_err("missing media type should fail");
    assert!(missing_media_type.message.contains("mediaType is required"));

    let invalid_media_type = runtime
        .voice_transcribe(VoiceTranscribeParams {
            audio_base64: "d2F2".to_string(),
            media_type: "not a media type".to_string(),
            file_name: None,
        })
        .await
        .expect_err("invalid media type should fail");
    assert!(invalid_media_type.message.contains("mediaType is invalid"));

    let empty_text = runtime
        .voice_speech_generate(VoiceSpeechGenerateParams {
            text: "   ".to_string(),
        })
        .await
        .expect_err("empty speech text should fail");
    assert!(empty_text.message.contains("text is required"));
}

#[tokio::test]
async fn voice_gateway_errors_and_invalid_payloads_are_reported() {
    let (base_url, handle) =
        start_voice_status_server("400 Bad Request", r#"{"error":"bad audio"}"#);
    let runtime = runtime_with_auth(&base_url);
    let err = runtime
        .voice_transcribe(VoiceTranscribeParams {
            audio_base64: "d2F2".to_string(),
            media_type: "audio/wav".to_string(),
            file_name: None,
        })
        .await
        .expect_err("gateway error should fail transcription");
    assert!(err.message.contains("bad audio"));
    handle.join().expect("voice status server should stop");

    let (base_url, handle) = start_voice_status_server("503 Service Unavailable", "{}");
    let runtime = runtime_with_auth(&base_url);
    let err = runtime
        .voice_speech_generate(VoiceSpeechGenerateParams {
            text: "hello".to_string(),
        })
        .await
        .expect_err("gateway error should fail speech");
    assert!(err.message.contains("HTTP 503"));
    handle.join().expect("voice status server should stop");

    let (base_url, handle) = start_voice_status_server("502 Bad Gateway", "not json");
    let runtime = runtime_with_auth(&base_url);
    let err = runtime
        .voice_realtime_setup(VoiceRealtimeSetupParams::default())
        .await
        .expect_err("gateway error should fail realtime setup");
    assert!(err.message.contains("HTTP 502"));
    handle.join().expect("voice status server should stop");

    let (base_url, handle, _) = start_recording_response_sequence_server(vec![json_response(
        json!({"text":"   "}).to_string(),
    )]);
    let runtime = runtime_with_auth(&base_url);
    let err = runtime
        .voice_transcribe(VoiceTranscribeParams {
            audio_base64: "d2F2".to_string(),
            media_type: "audio/wav".to_string(),
            file_name: None,
        })
        .await
        .expect_err("empty transcription should fail");
    assert!(err.message.contains("empty text"));
    handle.join().expect("mock server should stop");

    let (base_url, handle, _) = start_recording_response_sequence_server(vec![MockHttpResponse {
        body: String::new(),
        headers: Vec::new(),
    }]);
    let runtime = runtime_with_auth(&base_url);
    let err = runtime
        .voice_speech_generate(VoiceSpeechGenerateParams {
            text: "hello".to_string(),
        })
        .await
        .expect_err("empty audio should fail");
    assert!(err.message.contains("empty audio"));
    handle.join().expect("mock server should stop");

    let (base_url, handle, _) = start_recording_response_sequence_server(vec![json_response(
        json!({"token":" ","url":""}).to_string(),
    )]);
    let runtime = runtime_with_auth(&base_url);
    let err = runtime
        .voice_realtime_setup(VoiceRealtimeSetupParams::default())
        .await
        .expect_err("invalid realtime setup should fail");
    assert!(err.message.contains("invalid session data"));
    handle.join().expect("mock server should stop");
}
