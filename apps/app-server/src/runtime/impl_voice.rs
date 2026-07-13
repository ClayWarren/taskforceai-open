use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use reqwest::multipart;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::protocol::{
    AppResponse, VoiceRealtimeSetupParams, VoiceRealtimeSetupResult, VoiceSpeechGenerateParams,
    VoiceSpeechGenerateResult, VoiceTranscribeParams, VoiceTranscribeResult,
};

use super::error::RuntimeError;
use super::util::{value, MAX_AUDIO_SIZE};

const VOICE_GATEWAY_BASE_URL_ENV: &str = "TASKFORCEAI_VOICE_GATEWAY_URL";
const DEFAULT_VOICE_GATEWAY_BASE_URL: &str = "https://www.taskforceai.chat";
const API_BASE_SUFFIX: &str = "/api/v1";
const DICTATION_TRANSCRIBE_ENDPOINT: &str = "/api/dictation/transcribe";
const SPEECH_GENERATE_ENDPOINT: &str = "/api/speech/generate";
const REALTIME_SETUP_ENDPOINT: &str = "/api/realtime/setup";

#[derive(Debug, Deserialize)]
struct VoiceErrorPayload {
    error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct VoiceTranscribePayload {
    text: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VoiceRealtimeSetupPayload {
    token: String,
    url: String,
    #[serde(default)]
    expires_at: Option<i64>,
    #[serde(default)]
    tools: Option<Value>,
}

impl super::AppRuntime {
    pub async fn voice_transcribe(
        &self,
        params: VoiceTranscribeParams,
    ) -> Result<AppResponse, RuntimeError> {
        let token = self.require_voice_auth_token()?;
        let encoded_audio = params.audio_base64.trim();
        let max_encoded_audio_size = MAX_AUDIO_SIZE.saturating_add(2) / 3 * 4;
        if encoded_audio.len() > max_encoded_audio_size {
            return Err(RuntimeError::invalid_params(format!(
                "audioBase64 exceeds the {} byte audio limit",
                MAX_AUDIO_SIZE
            )));
        }
        let audio = BASE64.decode(encoded_audio).map_err(|err| {
            RuntimeError::invalid_params(format!("audioBase64 is invalid: {err}"))
        })?;
        if audio.is_empty() {
            return Err(RuntimeError::invalid_params("audioBase64 is required"));
        }
        if audio.len() > MAX_AUDIO_SIZE {
            return Err(RuntimeError::invalid_params(format!(
                "audioBase64 exceeds the {} byte audio limit",
                MAX_AUDIO_SIZE
            )));
        }

        let media_type = params.media_type.trim();
        if media_type.is_empty() {
            return Err(RuntimeError::invalid_params("mediaType is required"));
        }

        let file_name = params
            .file_name
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("dictation.wav");
        let part = multipart::Part::bytes(audio)
            .file_name(file_name.to_string())
            .mime_str(media_type)
            .map_err(|err| RuntimeError::invalid_params(format!("mediaType is invalid: {err}")))?;
        let response = reqwest::Client::new()
            .post(self.voice_gateway_url(DICTATION_TRANSCRIBE_ENDPOINT))
            .bearer_auth(token)
            .multipart(multipart::Form::new().part("audio", part))
            .send()
            .await
            .map_err(|err| RuntimeError::network(err.to_string()))?;

        if !response.status().is_success() {
            return Err(RuntimeError::network(
                voice_gateway_error_message(response).await,
            ));
        }

        let payload = response
            .json::<VoiceTranscribePayload>()
            .await
            .map_err(|err| RuntimeError::network(err.to_string()))?;
        let text = payload.text.unwrap_or_default().trim().to_string();
        if text.is_empty() {
            return Err(RuntimeError::network(
                "dictation transcription returned empty text",
            ));
        }

        Ok(value(VoiceTranscribeResult { text }))
    }

    pub async fn voice_speech_generate(
        &self,
        params: VoiceSpeechGenerateParams,
    ) -> Result<AppResponse, RuntimeError> {
        let token = self.require_voice_auth_token()?;
        let text = params.text.trim();
        if text.is_empty() {
            return Err(RuntimeError::invalid_params("text is required"));
        }

        let response = reqwest::Client::new()
            .post(self.voice_gateway_url(SPEECH_GENERATE_ENDPOINT))
            .bearer_auth(token)
            .json(&json!({ "text": text }))
            .send()
            .await
            .map_err(|err| RuntimeError::network(err.to_string()))?;

        if !response.status().is_success() {
            return Err(RuntimeError::network(
                voice_gateway_error_message(response).await,
            ));
        }

        let media_type = response
            .headers()
            .get("content-type")
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.split(';').next())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("audio/mpeg")
            .to_string();
        let format = response
            .headers()
            .get("x-taskforceai-audio-format")
            .and_then(|value| value.to_str().ok())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned);
        let bytes = response
            .bytes()
            .await
            .map_err(|err| RuntimeError::network(err.to_string()))?;
        if bytes.is_empty() {
            return Err(RuntimeError::network(
                "speech generation returned empty audio",
            ));
        }

        Ok(value(VoiceSpeechGenerateResult {
            audio_base64: BASE64.encode(bytes),
            media_type,
            format,
        }))
    }

    pub async fn voice_realtime_setup(
        &self,
        params: VoiceRealtimeSetupParams,
    ) -> Result<AppResponse, RuntimeError> {
        let token = self.require_voice_auth_token()?;
        let response = reqwest::Client::new()
            .post(self.voice_gateway_url(REALTIME_SETUP_ENDPOINT))
            .bearer_auth(token)
            .json(&json!({ "sessionConfig": params.session_config }))
            .send()
            .await
            .map_err(|err| RuntimeError::network(err.to_string()))?;

        if !response.status().is_success() {
            return Err(RuntimeError::network(
                voice_gateway_error_message(response).await,
            ));
        }

        let payload = response
            .json::<VoiceRealtimeSetupPayload>()
            .await
            .map_err(|err| RuntimeError::network(err.to_string()))?;
        if payload.token.trim().is_empty() || payload.url.trim().is_empty() {
            return Err(RuntimeError::network(
                "realtime setup returned invalid session data",
            ));
        }

        Ok(value(VoiceRealtimeSetupResult {
            token: payload.token,
            url: payload.url,
            expires_at: payload.expires_at,
            tools: payload.tools,
        }))
    }

    fn require_voice_auth_token(&self) -> Result<String, RuntimeError> {
        self.auth_token()?
            .filter(|token| !token.trim().is_empty())
            .ok_or_else(|| RuntimeError::not_configured("sign in before using voice"))
    }

    fn voice_gateway_url(&self, endpoint: &str) -> String {
        format!("{}{}", self.voice_gateway_base_url(), endpoint)
    }

    fn voice_gateway_base_url(&self) -> String {
        std::env::var(VOICE_GATEWAY_BASE_URL_ENV)
            .ok()
            .map(|value| value.trim().trim_end_matches('/').to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| voice_gateway_base_url_from_api_base(&self.config.api_base_url))
    }
}

fn voice_gateway_base_url_from_api_base(api_base_url: &str) -> String {
    let base = api_base_url.trim().trim_end_matches('/');
    if let Some(web_base) = base.strip_suffix(API_BASE_SUFFIX) {
        return web_base.to_string();
    }
    if base.is_empty() {
        DEFAULT_VOICE_GATEWAY_BASE_URL.to_string() // coverage:ignore-line
    } else {
        base.to_string()
    }
}

async fn voice_gateway_error_message(response: reqwest::Response) -> String {
    let status = response.status();
    match response.json::<VoiceErrorPayload>().await {
        Ok(payload) => payload
            .error
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| format!("voice gateway returned HTTP {status}")),
        Err(_) => format!("voice gateway returned HTTP {status}"),
    }
}

#[cfg(test)]
mod tests {
    use super::voice_gateway_base_url_from_api_base;

    #[test]
    fn derives_voice_gateway_base_url_from_api_base() {
        assert_eq!(
            voice_gateway_base_url_from_api_base("https://www.taskforceai.chat/api/v1"),
            "https://www.taskforceai.chat"
        );
        assert_eq!(
            voice_gateway_base_url_from_api_base("http://127.0.0.1:1234"),
            "http://127.0.0.1:1234"
        );
        assert_eq!(
            voice_gateway_base_url_from_api_base("   "),
            super::DEFAULT_VOICE_GATEWAY_BASE_URL
        );
    }
}
