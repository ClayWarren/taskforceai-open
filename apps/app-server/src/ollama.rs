use futures_util::StreamExt;
use semver::Version;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;

pub const DEFAULT_OLLAMA_BASE_URL: &str = "http://localhost:11434/v1";
pub const DEFAULT_OLLAMA_MODEL: &str = "gemma4:e2b";
pub const OLLAMA_PROVIDER_ID: &str = "ollama";
const MIN_RESPONSES_VERSION: Version = Version::new(0, 13, 4);
const GENERATION_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5 * 60);
const CONNECTION_HINT: &str =
    "No running Ollama server detected. Start it with `ollama serve` after installing Ollama.";

#[derive(Debug, Clone)]
pub struct OllamaClient {
    http: reqwest::Client,
    host_root: String,
    openai_compatible: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OllamaStatus {
    pub provider_id: String,
    pub base_url: String,
    pub host_root: String,
    pub connected: bool,
    pub openai_compatible: bool,
    pub responses_supported: Option<bool>,
    pub version: Option<String>,
    pub models: Vec<String>,
    pub default_model: String,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OllamaEnsureResult {
    pub status: OllamaStatus,
    pub model: String,
    pub pulled: bool,
    pub pull_events: Vec<OllamaPullEvent>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum OllamaPullEvent {
    Status {
        message: String,
    },
    Progress {
        digest: Option<String>,
        completed: Option<u64>,
        total: Option<u64>,
    },
    Success,
    Error {
        message: String,
    },
}

#[derive(Debug, Error)]
pub enum OllamaError {
    #[error("{0}")]
    Connection(String),
    #[error("ollama {version} is too old; taskforceai requires ollama {minimum} or newer for Responses API support")]
    UnsupportedVersion { version: Version, minimum: Version },
    #[error("ollama request failed: {0}")]
    Request(#[from] reqwest::Error),
    #[error("ollama returned HTTP {status}")]
    Status { status: u16 },
    #[error("ollama pull failed: {0}")]
    Pull(String),
}

impl OllamaClient {
    pub fn new(base_url: impl Into<String>) -> Self {
        let base_url = normalize_base_url(&base_url.into());
        let openai_compatible = is_openai_compatible_base_url(&base_url);
        Self {
            http: reqwest::Client::builder()
                .connect_timeout(std::time::Duration::from_secs(5))
                .build()
                .unwrap_or_else(|_| reqwest::Client::new()),
            host_root: base_url_to_host_root(&base_url),
            openai_compatible,
        }
    }

    pub async fn status(&self, base_url: &str) -> OllamaStatus {
        match self.probe().await {
            Ok(()) => {
                let version = self.fetch_version().await.ok().flatten();
                let models = self.fetch_models().await.unwrap_or_default();
                let responses_supported = version.as_ref().map(supports_responses);
                let message = match responses_supported {
                    Some(false) => Some(format!(
                        "Ollama {} is too old. TaskForceAI requires Ollama {} or newer.",
                        version
                            .as_ref()
                            .map(Version::to_string)
                            .unwrap_or_else(|| "unknown".to_string()),
                        MIN_RESPONSES_VERSION
                    )),
                    _ => None,
                };
                OllamaStatus {
                    provider_id: OLLAMA_PROVIDER_ID.to_string(),
                    base_url: normalize_base_url(base_url),
                    host_root: self.host_root.clone(),
                    connected: true,
                    openai_compatible: self.openai_compatible,
                    responses_supported,
                    version: version.map(|value| value.to_string()),
                    models,
                    default_model: DEFAULT_OLLAMA_MODEL.to_string(),
                    message,
                }
            }
            Err(err) => disconnected_status(base_url, &self.host_root, self.openai_compatible, err),
        }
    }

    pub async fn ensure_ready(
        &self,
        base_url: &str,
        model: Option<&str>,
    ) -> Result<OllamaEnsureResult, OllamaError> {
        self.probe().await?;
        if let Some(version) = self.fetch_version().await? {
            if !supports_responses(&version) {
                return Err(OllamaError::UnsupportedVersion {
                    version,
                    minimum: MIN_RESPONSES_VERSION,
                });
            }
        }

        let model = model
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(DEFAULT_OLLAMA_MODEL)
            .to_string();
        let mut pulled = false;
        let mut pull_events = Vec::new();
        let models = self.fetch_models().await?;
        if !models.iter().any(|candidate| candidate == &model) {
            pull_events = self.pull_model(&model).await?;
            pulled = true;
        }

        Ok(OllamaEnsureResult {
            status: self.status(base_url).await,
            model,
            pulled,
            pull_events,
        })
    }

    pub async fn create_response(&self, model: &str, prompt: &str) -> Result<String, OllamaError> {
        let response = self
            .http
            .post(format!("{}/v1/responses", self.host_root))
            .json(&serde_json::json!({
                "model": model,
                "input": prompt,
            }))
            .timeout(GENERATION_TIMEOUT)
            .send()
            .await?;
        if !response.status().is_success() {
            return Err(OllamaError::Status {
                status: response.status().as_u16(),
            });
        }
        let value = response.json::<Value>().await?;
        extract_response_text(&value).ok_or_else(|| {
            OllamaError::Pull("ollama response did not include output text".to_string())
        })
    }

    async fn probe(&self) -> Result<(), OllamaError> {
        let url = if self.openai_compatible {
            format!("{}/v1/models", self.host_root)
        } else {
            format!("{}/api/tags", self.host_root)
        };
        let response = self
            .http
            .get(url)
            .send()
            .await
            .map_err(|_| OllamaError::Connection(CONNECTION_HINT.to_string()))?;
        if response.status().is_success() {
            Ok(())
        } else {
            Err(OllamaError::Connection(CONNECTION_HINT.to_string()))
        }
    }

    async fn fetch_models(&self) -> Result<Vec<String>, OllamaError> {
        let response = self
            .http
            .get(format!("{}/api/tags", self.host_root))
            .send()
            .await?;
        if !response.status().is_success() {
            return Ok(Vec::new());
        }
        let value = response.json::<Value>().await?;
        Ok(value
            .get("models")
            .and_then(Value::as_array)
            .map(|models| {
                models
                    .iter()
                    .filter_map(|model| model.get("name").and_then(Value::as_str))
                    .map(ToString::to_string)
                    .collect()
            })
            .unwrap_or_default())
    }

    async fn fetch_version(&self) -> Result<Option<Version>, OllamaError> {
        let response = self
            .http
            .get(format!("{}/api/version", self.host_root))
            .send()
            .await?;
        if !response.status().is_success() {
            return Ok(None);
        }
        let value = response.json::<Value>().await?;
        let Some(version) = value
            .get("version")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            return Ok(None);
        };
        Ok(Version::parse(version.trim_start_matches('v')).ok())
    }

    async fn pull_model(&self, model: &str) -> Result<Vec<OllamaPullEvent>, OllamaError> {
        let response = self
            .http
            .post(format!("{}/api/pull", self.host_root))
            .json(&serde_json::json!({ "model": model, "stream": true }))
            .send()
            .await?;
        if !response.status().is_success() {
            return Err(OllamaError::Status {
                status: response.status().as_u16(),
            });
        }

        let mut stream = response.bytes_stream();
        let mut buffer = Vec::new();
        let mut events = Vec::new();
        while let Some(chunk) = stream.next().await {
            buffer.extend_from_slice(&chunk?);
            while let Some(index) = buffer.iter().position(|byte| *byte == b'\n') {
                let line = buffer.drain(..=index).collect::<Vec<_>>();
                parse_pull_line(&line, &mut events)?;
                if matches!(events.last(), Some(OllamaPullEvent::Success)) {
                    return Ok(events);
                }
            }
        }
        if !buffer.is_empty() {
            parse_pull_line(&buffer, &mut events)?;
        } // coverage:ignore-line
        if matches!(events.last(), Some(OllamaPullEvent::Success)) {
            Ok(events) // coverage:ignore-line
        } else {
            Err(OllamaError::Pull(
                "pull stream ended without success".to_string(),
            ))
        }
    }
}

fn parse_pull_line(line: &[u8], events: &mut Vec<OllamaPullEvent>) -> Result<(), OllamaError> {
    let text = String::from_utf8_lossy(line).trim().to_string();
    if text.is_empty() {
        return Ok(());
    }
    let value = serde_json::from_str::<Value>(&text)
        .map_err(|err| OllamaError::Pull(format!("invalid pull event: {err}")))?;
    if let Some(message) = value.get("error").and_then(Value::as_str) {
        events.push(OllamaPullEvent::Error {
            message: message.to_string(),
        });
        return Err(OllamaError::Pull(message.to_string()));
    }
    if value
        .get("status")
        .and_then(Value::as_str)
        .is_some_and(|status| status == "success")
    {
        events.push(OllamaPullEvent::Success);
        return Ok(());
    }
    if value.get("total").is_some() || value.get("completed").is_some() {
        events.push(OllamaPullEvent::Progress {
            digest: value
                .get("digest")
                .and_then(Value::as_str)
                .map(ToString::to_string),
            completed: value.get("completed").and_then(Value::as_u64),
            total: value.get("total").and_then(Value::as_u64),
        });
        return Ok(());
    }
    if let Some(status) = value.get("status").and_then(Value::as_str) {
        events.push(OllamaPullEvent::Status {
            message: status.to_string(),
        });
    }
    Ok(())
}

fn extract_response_text(value: &Value) -> Option<String> {
    if let Some(text) = value.get("output_text").and_then(Value::as_str) {
        return Some(text.to_string());
    }
    let output = value.get("output")?.as_array()?;
    let mut text = String::new();
    for item in output {
        let Some(content) = item.get("content").and_then(Value::as_array) else {
            continue;
        };
        for part in content {
            let is_text = part
                .get("type")
                .and_then(Value::as_str)
                .is_none_or(|part_type| part_type == "output_text");
            if is_text {
                if let Some(part_text) = part.get("text").and_then(Value::as_str) {
                    text.push_str(part_text);
                }
            }
        }
    }
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

fn disconnected_status(
    base_url: &str,
    host_root: &str,
    openai_compatible: bool,
    err: OllamaError,
) -> OllamaStatus {
    OllamaStatus {
        provider_id: OLLAMA_PROVIDER_ID.to_string(),
        base_url: normalize_base_url(base_url),
        host_root: host_root.to_string(),
        connected: false,
        openai_compatible,
        responses_supported: None,
        version: None,
        models: Vec::new(),
        default_model: DEFAULT_OLLAMA_MODEL.to_string(),
        message: Some(err.to_string()),
    }
}

pub fn normalize_base_url(base_url: &str) -> String {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        DEFAULT_OLLAMA_BASE_URL.to_string()
    } else {
        trimmed.to_string()
    }
}

fn base_url_to_host_root(base_url: &str) -> String {
    let trimmed = base_url.trim().trim_end_matches('/');
    trimmed
        .strip_suffix("/v1")
        .unwrap_or(trimmed)
        .trim_end_matches('/')
        .to_string()
}

fn is_openai_compatible_base_url(base_url: &str) -> bool {
    base_url.trim().trim_end_matches('/').ends_with("/v1")
}

fn supports_responses(version: &Version) -> bool {
    *version == Version::new(0, 0, 0) || *version >= MIN_RESPONSES_VERSION
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    #[test]
    fn normalizes_openai_compatible_url_to_host_root() {
        assert_eq!(
            base_url_to_host_root("http://localhost:11434/v1"),
            "http://localhost:11434"
        );
        assert_eq!(
            base_url_to_host_root("http://localhost:11434/"),
            "http://localhost:11434"
        );
        assert_eq!(normalize_base_url("   "), DEFAULT_OLLAMA_BASE_URL);
    }

    #[test]
    fn detects_responses_support_cutoff() {
        assert!(supports_responses(&Version::new(0, 13, 4)));
        assert!(supports_responses(&Version::new(0, 0, 0)));
        assert!(!supports_responses(&Version::new(0, 13, 3)));
    }

    #[test]
    fn parses_stream_errors_as_pull_failures() {
        let mut events = Vec::new();
        parse_pull_line(b"   \n", &mut events).expect("blank pull line should be ignored");
        assert!(events.is_empty());

        let mut events = Vec::new();
        let err = parse_pull_line(br#"{"error":"model not found"}"#, &mut events)
            .expect_err("error event should fail the pull");
        assert!(err.to_string().contains("model not found"));
        assert_eq!(
            events,
            vec![OllamaPullEvent::Error {
                message: "model not found".to_string()
            }]
        );
    }

    #[test]
    fn extracts_responses_output_text() {
        assert_eq!(
            extract_response_text(&serde_json::json!({"output_text": "direct"})).as_deref(),
            Some("direct")
        );
        let value = serde_json::json!({
            "output": [{
                "type": "message",
                "content": [
                    {"type": "output_text", "text": "hello"},
                    {"type": "image", "text": "ignored"},
                    {"text": " world"}
                ]
            }, {
                "type": "message"
            }]
        });

        assert_eq!(
            extract_response_text(&value).as_deref(),
            Some("hello world")
        );
    }

    #[tokio::test]
    async fn status_reads_version_and_models_from_local_server() {
        let base_url = spawn_ollama_server(false);
        let client = OllamaClient::new(format!("{base_url}/v1"));

        let status = client.status(&format!("{base_url}/v1")).await;

        assert!(status.connected);
        assert_eq!(status.version.as_deref(), Some("0.13.4"));
        assert_eq!(status.models, vec!["gemma4:e2b".to_string()]);
        assert_eq!(status.host_root, base_url);
        assert_eq!(status.responses_supported, Some(true));
    }

    #[tokio::test]
    async fn ensure_pulls_missing_model_from_local_server() {
        let base_url = spawn_ollama_server(true);
        let client = OllamaClient::new(format!("{base_url}/v1"));

        let ensured = client
            .ensure_ready(&format!("{base_url}/v1"), Some("gemma4:e2b"))
            .await
            .expect("ollama should be prepared");

        assert!(ensured.pulled);
        assert_eq!(ensured.model, "gemma4:e2b");
        assert!(ensured
            .pull_events
            .iter()
            .any(|event| matches!(event, OllamaPullEvent::Success)));
    }

    #[tokio::test]
    async fn create_response_uses_responses_api() {
        let base_url = spawn_ollama_server(false);
        let client = OllamaClient::new(format!("{base_url}/v1"));

        let output = client
            .create_response("gemma4:e2b", "hello")
            .await
            .expect("response should parse");

        assert_eq!(output, "local response");
    }

    #[tokio::test]
    async fn status_and_ensure_ready_report_unsupported_ollama_versions() {
        let base_url = spawn_ollama_sequence_server(vec![
            (200, r#"{"data":[]}"#),
            (200, r#"{"version":"0.13.3"}"#),
            (200, r#"{"models":[]}"#),
        ]);
        let client = OllamaClient::new(format!("{base_url}/v1"));

        let status = client.status(&format!("{base_url}/v1")).await;

        assert!(status.connected);
        assert_eq!(status.responses_supported, Some(false));
        assert!(status
            .message
            .as_deref()
            .expect("old version should explain responses support")
            .contains("too old"));

        let base_url = spawn_ollama_sequence_server(vec![
            (200, r#"{"data":[]}"#),
            (200, r#"{"version":"0.13.3"}"#),
        ]);
        let client = OllamaClient::new(format!("{base_url}/v1"));
        let err = client
            .ensure_ready(&format!("{base_url}/v1"), Some("gemma4:e2b"))
            .await
            .expect_err("old ollama should be rejected");
        assert!(matches!(err, OllamaError::UnsupportedVersion { .. }));
    }

    #[tokio::test]
    async fn create_response_reports_status_and_missing_output_errors() {
        let base_url = spawn_ollama_sequence_server(vec![(500, r#"{"error":"down"}"#)]);
        let client = OllamaClient::new(format!("{base_url}/v1"));
        let status = client
            .create_response("gemma4:e2b", "hello")
            .await
            .expect_err("non-success response should fail");
        assert!(matches!(status, OllamaError::Status { status: 500 }));

        let base_url = spawn_ollama_sequence_server(vec![(200, r#"{"output":[]}"#)]);
        let client = OllamaClient::new(format!("{base_url}/v1"));
        let missing = client
            .create_response("gemma4:e2b", "hello")
            .await
            .expect_err("missing output text should fail");
        assert!(missing.to_string().contains("did not include output text"));
    }

    #[tokio::test]
    async fn status_tolerates_missing_version_and_model_fetch_failures() {
        let base_url = spawn_ollama_sequence_server(vec![
            (200, r#"{"models":[]}"#),
            (200, r#"{"version":""}"#),
            (503, r#"{"error":"tags down"}"#),
        ]);
        let client = OllamaClient::new(&base_url);

        let status = client.status(&base_url).await;

        assert!(status.connected);
        assert_eq!(status.responses_supported, None);
        assert!(status.models.is_empty());

        let base_url = spawn_ollama_sequence_server(vec![(500, r#"{"error":"down"}"#)]);
        let client = OllamaClient::new(format!("{base_url}/v1"));
        let status = client.status(&format!("{base_url}/v1")).await;
        assert!(!status.connected);
        assert!(status
            .message
            .as_deref()
            .expect("connection message")
            .contains("No running Ollama server"));
    }

    #[tokio::test]
    async fn ensure_ready_tolerates_missing_version_and_reports_pull_failures() {
        let base_url = spawn_ollama_sequence_server(vec![
            (200, r#"{"data":[]}"#),
            (503, r#"{"error":"version down"}"#),
            (200, r#"{"models":[{"name":"gemma4:e2b"}]}"#),
            (200, r#"{"data":[]}"#),
            (503, r#"{"error":"version down"}"#),
            (200, r#"{"models":[{"name":"gemma4:e2b"}]}"#),
        ]);
        let client = OllamaClient::new(format!("{base_url}/v1"));
        let ready = client
            .ensure_ready(&format!("{base_url}/v1"), Some("  "))
            .await
            .expect("missing version should not block ready check");
        assert_eq!(ready.model, DEFAULT_OLLAMA_MODEL);
        assert!(!ready.pulled);

        let base_url = spawn_ollama_sequence_server(vec![
            (200, r#"{"data":[]}"#),
            (200, r#"{"version":"0.13.4"}"#),
            (200, r#"{"models":[]}"#),
            (500, r#"{"error":"pull down"}"#),
        ]);
        let client = OllamaClient::new(format!("{base_url}/v1"));
        let err = client
            .ensure_ready(&format!("{base_url}/v1"), Some("missing:model"))
            .await
            .expect_err("pull status failure should be reported");
        assert!(matches!(err, OllamaError::Status { status: 500 }));

        let base_url = spawn_ollama_sequence_server(vec![
            (200, r#"{"data":[]}"#),
            (200, r#"{"version":"0.13.4"}"#),
            (200, r#"{"models":[]}"#),
            (200, r#"{"status":"pulling manifest"}"#),
        ]);
        let client = OllamaClient::new(format!("{base_url}/v1"));
        let err = client
            .ensure_ready(&format!("{base_url}/v1"), Some("missing:model"))
            .await
            .expect_err("pull stream without success should fail");
        assert!(err.to_string().contains("ended without success"));
    }

    fn spawn_ollama_server(model_missing: bool) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind mock ollama");
        let addr = listener.local_addr().expect("mock address");
        thread::spawn(move || {
            for stream in listener.incoming().take(8) {
                let Ok(mut stream) = stream else {
                    continue;
                };
                let mut request = [0_u8; 2048];
                let count = stream.read(&mut request).unwrap_or_default();
                let request = String::from_utf8_lossy(&request[..count]);
                let path = request
                    .lines()
                    .next()
                    .and_then(|line| line.split_whitespace().nth(1))
                    .unwrap_or("/");
                let body = match path {
                    "/v1/models" => r#"{"data":[]}"#,
                    "/api/version" => r#"{"version":"0.13.4"}"#,
                    "/api/tags" if model_missing => r#"{"models":[]}"#,
                    "/api/tags" => r#"{"models":[{"name":"gemma4:e2b"}]}"#,
                    "/api/pull" => {
                        r#"{"status":"pulling manifest"}
{"digest":"sha256:test","completed":1,"total":2}
{"status":"success"}
"#
                    }
                    "/v1/responses" => {
                        r#"{"output":[{"type":"message","content":[{"type":"output_text","text":"local response"}]}]}"#
                    }
                    _ => r#"{"error":"not found"}"#,
                };
                let response = format!(
                    "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                stream
                    .write_all(response.as_bytes())
                    .expect("write mock response");
            }
        });
        format!("http://{addr}")
    }

    fn spawn_ollama_sequence_server(responses: Vec<(u16, &'static str)>) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind mock ollama sequence");
        let addr = listener.local_addr().expect("mock sequence address");
        thread::spawn(move || {
            for (status, body) in responses {
                let Ok((mut stream, _)) = listener.accept() else {
                    continue;
                };
                let mut request = [0_u8; 2048];
                let _ = stream.read(&mut request);
                let status_text = if status == 200 { "OK" } else { "Error" };
                let response = format!(
                    "HTTP/1.1 {status} {status_text}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                stream
                    .write_all(response.as_bytes())
                    .expect("write mock sequence response");
            }
        });
        format!("http://{addr}")
    }
}
