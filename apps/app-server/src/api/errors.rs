use std::error::Error as StdError;

use thiserror::Error;

#[derive(Debug, Error)]
pub enum ApiClientError {
    #[error("request failed: {0}")]
    Request(#[from] reqwest::Error),
    #[error("decode response: {0}")]
    Decode(#[from] serde_json::Error),
    #[error("unexpected {context} response: {reason}; body preview: {preview}")]
    UnexpectedResponse {
        context: String,
        reason: String,
        preview: String,
    },
    #[error("api returned status {status}")]
    Status { status: u16 },
    #[error("api csrf cookie missing")]
    MissingCsrfCookie,
    #[error("invalid api header: {0}")]
    InvalidHeader(String),
    #[error("invalid api url: {0}")]
    InvalidUrl(String),
}

impl ApiClientError {
    pub fn is_unauthorized(&self) -> bool {
        matches!(self, Self::Status { status: 401 })
    }

    pub fn detailed_message(&self) -> String {
        let mut message = self.to_string();
        let mut source = self.source();
        while let Some(err) = source {
            let detail = err.to_string();
            if !detail.is_empty() && !message.contains(&detail) {
                message.push_str(": ");
                message.push_str(&detail);
            }
            source = err.source();
        }
        message
    }
}
