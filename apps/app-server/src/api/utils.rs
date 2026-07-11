use serde_json::Value;

use super::errors::ApiClientError;

pub const DEFAULT_API_BASE_URL: &str = "https://www.taskforceai.chat/api/v1";

pub(super) fn normalize_base_url(value: &str) -> String {
    value.trim().trim_end_matches('/').to_string()
}

pub(super) fn path_escape(value: &str) -> String {
    percent_escape(value, false)
}

pub(super) fn query_escape(value: &str) -> String {
    percent_escape(value, true)
}

fn percent_escape(value: &str, space_as_plus: bool) -> String {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";

    let mut escaped = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b' ' if space_as_plus => escaped.push('+'),
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                escaped.push(byte as char);
            }
            _ => {
                escaped.push('%');
                escaped.push(HEX[(byte >> 4) as usize] as char);
                escaped.push(HEX[(byte & 0x0F) as usize] as char);
            }
        }
    }
    escaped
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

#[cfg(test)]
mod tests {
    use std::{
        hint::black_box,
        time::{Duration, Instant},
    };

    use super::{message_from_json_response, path_escape, query_escape};

    #[test]
    fn message_from_json_response_returns_trimmed_messages_and_success_fallbacks() {
        let message = message_from_json_response(
            &serde_json::json!({"message": "  ready  ", "success": true}),
            "fallback",
        )
        .expect("message should be present");
        assert_eq!(message, "ready");

        assert_eq!(
            message_from_json_response(&serde_json::json!({"message": " ", "success": true}), "ok"),
            Some("ok".to_string())
        );
        assert!(message_from_json_response(&serde_json::json!({"success": false}), "ok").is_none());
    }

    #[test]
    #[ignore = "prints focused escaping performance timing"]
    fn bench_api_escaping() {
        let path = "project/TaskForceAI Research & Development/runs/session #42?";
        let query = "prompt=optimize Rust performance & tags=desktop app-server,sync,api&emoji=✓";
        const ITERATIONS: u32 = 250_000;

        let elapsed = time_iterations(ITERATIONS, || {
            black_box(path_escape(black_box(path)));
            black_box(query_escape(black_box(query)));
        });

        let ns_per_pair = elapsed.as_nanos() as f64 / f64::from(ITERATIONS);
        println!(
            "bench_api_escaping: {ITERATIONS} path+query pairs in {:?} ({ns_per_pair:.2} ns/pair)",
            elapsed
        );
    }

    fn time_iterations(iterations: u32, mut run: impl FnMut()) -> Duration {
        let start = Instant::now();
        for _ in 0..iterations {
            run();
        }
        start.elapsed()
    }
}
