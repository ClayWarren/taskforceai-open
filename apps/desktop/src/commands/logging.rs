use serde::Deserialize;
use serde_json::{Map, Value};
use tracing::{debug, error, info, warn};

const MAX_JSON_LOG_LEN: usize = 2048;
const MAX_JSON_DEPTH: usize = 8;
const MAX_JSON_OBJECT_KEYS: usize = 64;
const MAX_JSON_ARRAY_ITEMS: usize = 128;
const MAX_JSON_STRING_LEN: usize = 512;
const MAX_JSON_KEY_LEN: usize = 128;
const MAX_JSON_TOTAL_NODES: usize = 2048;
const MAX_TAGS: usize = 32;
const MAX_TAG_LEN: usize = 64;

#[derive(Debug, Deserialize)]
pub struct FrontendLogEntry {
    level: String,
    message: String,
    timestamp: String,
    #[serde(default)]
    context: Option<serde_json::Value>,
    #[serde(default)]
    metadata: Option<serde_json::Value>,
    #[serde(default)]
    tags: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
pub struct FrontendLogPayload {
    entry: FrontendLogEntry,
}

#[tauri::command]
pub async fn log_event(payload: FrontendLogPayload) {
    let entry = payload.entry;
    let context = validated_json_field("context", &entry.context);
    let metadata = validated_json_field("metadata", &entry.metadata);
    let tags = format_tags(&entry.tags);

    match entry.level.as_str() {
        "debug" => debug!(
            target: "frontend",
            event = "frontend_log",
            frontend_level = %entry.level,
            frontend_timestamp = %entry.timestamp,
            frontend_context = context.as_deref(),
            frontend_metadata = metadata.as_deref(),
            frontend_tags = tags.as_deref(),
            "{message}",
            message = entry.message
        ),
        "info" => info!(
            target: "frontend",
            event = "frontend_log",
            frontend_level = %entry.level,
            frontend_timestamp = %entry.timestamp,
            frontend_context = context.as_deref(),
            frontend_metadata = metadata.as_deref(),
            frontend_tags = tags.as_deref(),
            "{message}",
            message = entry.message
        ),
        "warn" => warn!(
            target: "frontend",
            event = "frontend_log",
            frontend_level = %entry.level,
            frontend_timestamp = %entry.timestamp,
            frontend_context = context.as_deref(),
            frontend_metadata = metadata.as_deref(),
            frontend_tags = tags.as_deref(),
            "{message}",
            message = entry.message
        ),
        "error" => error!(
            target: "frontend",
            event = "frontend_log",
            frontend_level = %entry.level,
            frontend_timestamp = %entry.timestamp,
            frontend_context = context.as_deref(),
            frontend_metadata = metadata.as_deref(),
            frontend_tags = tags.as_deref(),
            "{message}",
            message = entry.message
        ),
        _ => info!(
            target: "frontend",
            event = "frontend_log",
            frontend_level = %entry.level,
            frontend_timestamp = %entry.timestamp,
            frontend_context = context.as_deref(),
            frontend_metadata = metadata.as_deref(),
            frontend_tags = tags.as_deref(),
            "{message}",
            message = entry.message
        ),
    }
}

fn truncate_json(value: &serde_json::Value) -> String {
    let raw = value.to_string();
    if raw.chars().count() > MAX_JSON_LOG_LEN {
        format!(
            "{}...",
            raw.chars().take(MAX_JSON_LOG_LEN).collect::<String>()
        )
    } else {
        raw
    }
}

#[derive(Debug)]
enum JsonFieldValidationError {
    MaxDepthExceeded { depth: usize, max: usize },
    TooManyObjectKeys { count: usize, max: usize },
    TooManyArrayItems { count: usize, max: usize },
    KeyTooLong { len: usize, max: usize },
    NodeBudgetExceeded { max: usize },
}

impl std::fmt::Display for JsonFieldValidationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            JsonFieldValidationError::MaxDepthExceeded { depth, max } => {
                write!(f, "max depth exceeded ({depth} > {max})")
            }
            JsonFieldValidationError::TooManyObjectKeys { count, max } => {
                write!(f, "too many object keys ({count} > {max})")
            }
            JsonFieldValidationError::TooManyArrayItems { count, max } => {
                write!(f, "too many array items ({count} > {max})")
            }
            JsonFieldValidationError::KeyTooLong { len, max } => {
                write!(f, "object key too long ({len} > {max})")
            }
            JsonFieldValidationError::NodeBudgetExceeded { max } => {
                write!(f, "node budget exceeded (>{max})")
            }
        }
    }
}

fn validated_json_field(field_name: &str, value: &Option<Value>) -> Option<String> {
    let raw_value = value.as_ref()?;

    match sanitize_json_field(raw_value) {
        Ok(normalized) => Some(truncate_json(&normalized)),
        Err(validation_error) => {
            warn!(
                target: "frontend",
                event = "frontend_log_payload_validation_failed",
                field = field_name,
                error = %validation_error,
                "Frontend log payload validation failed"
            );
            let fallback = serde_json::json!({
                "invalid_frontend_payload": true,
                "field": field_name,
                "reason": validation_error.to_string(),
            });
            Some(truncate_json(&fallback))
        }
    }
}

fn sanitize_json_field(value: &Value) -> Result<Value, JsonFieldValidationError> {
    let mut remaining_nodes = MAX_JSON_TOTAL_NODES;
    sanitize_json_value(value, 0, &mut remaining_nodes)
}

fn sanitize_json_value(
    value: &Value,
    depth: usize,
    remaining_nodes: &mut usize,
) -> Result<Value, JsonFieldValidationError> {
    if depth > MAX_JSON_DEPTH {
        return Err(JsonFieldValidationError::MaxDepthExceeded {
            depth,
            max: MAX_JSON_DEPTH,
        });
    }
    if *remaining_nodes == 0 {
        return Err(JsonFieldValidationError::NodeBudgetExceeded {
            max: MAX_JSON_TOTAL_NODES,
        });
    }
    *remaining_nodes -= 1;

    match value {
        Value::Null => Ok(Value::Null),
        Value::Bool(boolean_value) => Ok(Value::Bool(*boolean_value)),
        Value::Number(number_value) => Ok(Value::Number(number_value.clone())),
        Value::String(string_value) => Ok(Value::String(truncate_text(
            string_value,
            MAX_JSON_STRING_LEN,
        ))),
        Value::Array(items) => {
            if items.len() > MAX_JSON_ARRAY_ITEMS {
                return Err(JsonFieldValidationError::TooManyArrayItems {
                    count: items.len(),
                    max: MAX_JSON_ARRAY_ITEMS,
                });
            }

            let mut sanitized_items = Vec::with_capacity(items.len());
            for item in items {
                sanitized_items.push(sanitize_json_value(item, depth + 1, remaining_nodes)?);
            }
            Ok(Value::Array(sanitized_items))
        }
        Value::Object(entries) => {
            if entries.len() > MAX_JSON_OBJECT_KEYS {
                return Err(JsonFieldValidationError::TooManyObjectKeys {
                    count: entries.len(),
                    max: MAX_JSON_OBJECT_KEYS,
                });
            }

            let mut sanitized_entries = Map::with_capacity(entries.len());
            for (key, entry_value) in entries {
                if key.chars().count() > MAX_JSON_KEY_LEN {
                    return Err(JsonFieldValidationError::KeyTooLong {
                        len: key.chars().count(),
                        max: MAX_JSON_KEY_LEN,
                    });
                }
                sanitized_entries.insert(
                    key.clone(),
                    sanitize_json_value(entry_value, depth + 1, remaining_nodes)?,
                );
            }
            Ok(Value::Object(sanitized_entries))
        }
    }
}

fn truncate_text(input: &str, max_chars: usize) -> String {
    if input.chars().count() <= max_chars {
        input.to_owned()
    } else {
        format!("{}...", input.chars().take(max_chars).collect::<String>())
    }
}

fn format_tags(value: &Option<Vec<String>>) -> Option<String> {
    value
        .as_ref()
        .map(|tags| {
            tags.iter()
                .map(|tag| tag.trim())
                .filter(|tag| !tag.is_empty())
                .take(MAX_TAGS)
                .map(|tag| truncate_text(tag, MAX_TAG_LEN))
                .collect::<Vec<_>>()
        })
        .filter(|tags| !tags.is_empty())
        .map(|tags| tags.join(","))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn truncated_json_appends_ellipsis_for_large_payloads() {
        let big_value = serde_json::json!({
            "data": "a".repeat(3000)
        });
        let raw = big_value.to_string();
        let output = truncate_json(&big_value);
        assert!(output.ends_with("..."));
        assert!(output.len() < raw.len());
    }

    #[test]
    fn format_tags_filters_empty_values() {
        let tags = Some(vec!["first".into(), "".into(), "second".into()]);
        let formatted = format_tags(&tags);
        assert_eq!(formatted.as_deref(), Some("first,second"));
        assert!(format_tags(&Some(vec![])).is_none());
        assert!(format_tags(&None).is_none());
    }

    #[test]
    fn validated_json_field_rejects_too_deep_payloads() {
        let deep_payload = Some(serde_json::json!({
            "a": {"b": {"c": {"d": {"e": {"f": {"g": {"h": {"i": "value"}}}}}}}}
        }));
        let output = validated_json_field("context", &deep_payload);
        assert!(output.is_some());
        let rendered = output.unwrap_or_default();
        assert!(rendered.contains("invalid_frontend_payload"));
        assert!(rendered.contains("max depth exceeded"));
    }

    #[test]
    fn validated_json_field_truncates_long_strings() {
        let payload = Some(serde_json::json!({
            "message": "a".repeat(MAX_JSON_STRING_LEN + 50)
        }));
        let output = validated_json_field("context", &payload).unwrap_or_default();
        assert!(output.contains("..."));
    }

    #[test]
    fn validated_json_field_handles_all_primitive_values() {
        let payload = Some(serde_json::json!({
            "null": null,
            "bool": true,
            "number": 42,
            "array": [null, false, 7, "ok"],
        }));
        let output = validated_json_field("metadata", &payload).unwrap_or_default();
        assert!(output.contains("\"bool\":true"));
        assert!(output.contains("\"number\":42"));
        assert!(output.contains("\"array\""));
    }

    #[test]
    fn validated_json_field_rejects_large_objects_arrays_and_keys() {
        let too_many_keys = Some(Value::Object(
            (0..=MAX_JSON_OBJECT_KEYS)
                .map(|idx| (format!("key-{idx}"), Value::Bool(true)))
                .collect(),
        ));
        let output = validated_json_field("context", &too_many_keys).unwrap_or_default();
        assert!(output.contains("too many object keys"));

        let too_many_items = Some(Value::Array(vec![Value::Null; MAX_JSON_ARRAY_ITEMS + 1]));
        let output = validated_json_field("context", &too_many_items).unwrap_or_default();
        assert!(output.contains("too many array items"));

        let long_key = Some(Value::Object(Map::from_iter([(
            "k".repeat(MAX_JSON_KEY_LEN + 1),
            Value::Bool(true),
        )])));
        let output = validated_json_field("context", &long_key).unwrap_or_default();
        assert!(output.contains("object key too long"));
    }

    #[test]
    fn sanitize_json_field_enforces_node_budget() {
        let nested_entries = (0..MAX_JSON_OBJECT_KEYS)
            .map(|idx| (format!("child-{idx}"), Value::Null))
            .collect::<Map<_, _>>();
        let payload = Value::Object(
            (0..MAX_JSON_OBJECT_KEYS)
                .map(|idx| (format!("root-{idx}"), Value::Object(nested_entries.clone())))
                .collect(),
        );
        let err = sanitize_json_field(&payload).expect_err("node budget should fail");
        assert!(err.to_string().contains("node budget exceeded"));
    }

    #[test]
    fn format_tags_limits_count_and_tag_length() {
        let tags = Some(
            (0..(MAX_TAGS + 10))
                .map(|idx| format!("tag-{idx}-{}", "x".repeat(MAX_TAG_LEN + 5)))
                .collect::<Vec<_>>(),
        );
        let formatted = format_tags(&tags).unwrap_or_default();
        assert_eq!(formatted.split(',').count(), MAX_TAGS);
        for tag in formatted.split(',') {
            assert!(tag.chars().count() <= MAX_TAG_LEN + 3);
        }
    }

    #[tokio::test]
    async fn log_event_handles_all_levels_without_panicking() {
        let _observability = crate::observability::init();
        let original = std::env::var("RUST_LOG").ok();
        std::env::set_var("RUST_LOG", "debug");

        for level in ["debug", "info", "warn", "error", "unexpected"] {
            let payload = FrontendLogPayload {
                entry: FrontendLogEntry {
                    level: level.to_string(),
                    message: "hello".into(),
                    timestamp: "now".into(),
                    context: Some(serde_json::json!({"key": "value"})),
                    metadata: Some(serde_json::json!({"meta": true})),
                    tags: Some(vec!["alpha".into(), "".into(), "beta".into()]),
                },
            };
            log_event(payload).await;
        }

        match original {
            Some(value) => std::env::set_var("RUST_LOG", value),
            None => std::env::remove_var("RUST_LOG"),
        }
    }

    #[test]
    fn truncate_json_returns_full_string_when_short() {
        let value = serde_json::json!({"short": true});
        assert_eq!(truncate_json(&value), value.to_string());
    }

    #[test]
    fn truncate_json_handles_multibyte_characters() {
        let value = serde_json::json!({"emoji": "😀".repeat(MAX_JSON_LOG_LEN + 20)});
        let output = truncate_json(&value);
        assert!(output.ends_with("..."));
    }
}
