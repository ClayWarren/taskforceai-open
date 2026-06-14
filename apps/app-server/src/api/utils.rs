use serde_json::Value;

use super::errors::ApiClientError;

pub const DEFAULT_API_BASE_URL: &str = "https://www.taskforceai.chat/api/v1";

pub(super) fn normalize_base_url(value: &str) -> String {
    value.trim().trim_end_matches('/').to_string()
}

pub(super) fn path_escape(value: &str) -> String {
    value
        .bytes()
        .flat_map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                vec![byte as char]
            }
            _ => format!("%{byte:02X}").chars().collect(),
        })
        .collect()
}

pub(super) fn query_escape(value: &str) -> String {
    value
        .bytes()
        .flat_map(|byte| match byte {
            b' ' => vec!['+'],
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                vec![byte as char]
            }
            _ => format!("%{byte:02X}").chars().collect(),
        })
        .collect()
}

pub(super) fn preview_body(body: &str) -> String {
    const MAX_PREVIEW_CHARS: usize = 240;
    let normalized = body.split_whitespace().collect::<Vec<_>>().join(" ");
    normalized.chars().take(MAX_PREVIEW_CHARS).collect()
}

pub(super) fn message_from_json_response(value: &Value, fallback: &str) -> Option<String> {
    if let Some(message) = value.get("message").and_then(Value::as_str) {
        let message = message.trim();
        if !message.is_empty() {
            return Some(message.to_string());
        }
    }
    if value.get("success").and_then(Value::as_bool) == Some(true) {
        return Some(fallback.to_string());
    }
    None
}

pub(super) fn csrf_url_for_base(base_url: &str) -> Result<String, ApiClientError> {
    let parsed =
        reqwest::Url::parse(base_url).map_err(|err| ApiClientError::InvalidUrl(err.to_string()))?;
    Ok(format!(
        "{}/api/auth/csrf",
        parsed.origin().ascii_serialization()
    ))
}

pub(super) fn csrf_cookie_from_set_cookie(value: &str) -> Option<String> {
    value
        .split(';')
        .next()
        .map(str::trim)
        .filter(|cookie| cookie.starts_with("csrf_token=") && cookie.len() > "csrf_token=".len())
        .map(ToOwned::to_owned)
}
