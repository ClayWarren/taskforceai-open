use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppClientError {
    #[error("spawn app-server: {0}")]
    Spawn(std::io::Error),
    #[error("app-server stdin unavailable")]
    MissingStdin,
    #[error("app-server stdout unavailable")]
    MissingStdout,
    #[error("write app-server request: {0}")]
    Write(std::io::Error),
    #[error("read app-server response: {0}")]
    Read(std::io::Error),
    #[error("encode app-server request: {0}")]
    Encode(serde_json::Error),
    #[error("decode app-server message: {0}")]
    Decode(serde_json::Error),
    #[error("app-server returned error {code}: {message}")]
    Rpc { code: i64, message: String },
    #[error("app-server exited before response")]
    Closed,
    #[error("app-server response missing result")]
    MissingResult,
    #[error("app-server request {method} timed out after {timeout_ms}ms")]
    RequestTimeout { method: String, timeout_ms: u64 },
    #[error("app-server event stream dropped {count} event(s)")]
    EventsDropped { count: u64 },
    #[error("app-server event stream error: {message}")]
    EventStream { message: String },
    #[error("http app-server request: {0}")]
    Http(#[from] reqwest::Error),
    #[error("http app-server auth token is invalid")]
    InvalidAuthToken,
}
