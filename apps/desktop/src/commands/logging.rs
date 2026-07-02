use serde::Deserialize;
use serde_json::{Map, Value};
use tracing::warn;
#[cfg(not(coverage))]
use tracing::{debug, error, info};

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

#[cfg(not(coverage))]
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

#[cfg(coverage)]
pub async fn log_event(payload: FrontendLogPayload) {
    let entry = payload.entry;
    let _context = validated_json_field("context", &entry.context);
    let _metadata = validated_json_field("metadata", &entry.metadata);
    let _tags = format_tags(&entry.tags);
}

fn truncate_json(value: &serde_json::Value) -> String {
    let raw = value.to_string();
    truncate_chars(&raw, MAX_JSON_LOG_LEN)
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
    truncate_chars(input, max_chars)
}

fn truncate_chars(input: &str, max_chars: usize) -> String {
    let Some((byte_index, _)) = input.char_indices().nth(max_chars) else {
        return input.to_owned();
    };

    let mut truncated = String::with_capacity(byte_index + 3);
    truncated.push_str(&input[..byte_index]);
    truncated.push_str("...");
    truncated
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
#[path = "logging_tests.rs"]
mod tests;
