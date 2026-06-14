use serde_json::{json, Value};

use crate::protocol::{CommandExecuteResult, LocalSettings};

use super::error::RuntimeError;
use super::util::unix_millis;

pub(crate) fn orchestration_role_order(role: &str) -> usize {
    match role {
        "Researcher" => 0,
        "Analyst" => 1,
        "Skeptic" => 2,
        "Pragmatist" => 3,
        _ => usize::MAX,
    }
}

pub(crate) fn default_local_settings() -> LocalSettings {
    LocalSettings {
        theme: "system".to_string(),
        telemetry_enabled: false,
        telemetry_dsn: String::new(),
        telemetry_environment: "cli".to_string(),
        logging_level: "info".to_string(),
        logging_format: "text".to_string(),
        memory_enabled: true,
        web_search_enabled: true,
        code_execution_enabled: true,
        trust_layer_enabled: true,
        notifications_enabled: true,
    }
}

pub(crate) fn normalize_local_settings(
    settings: LocalSettings,
) -> Result<LocalSettings, RuntimeError> {
    Ok(LocalSettings {
        theme: normalize_theme(&settings.theme)?,
        telemetry_enabled: settings.telemetry_enabled,
        telemetry_dsn: settings.telemetry_dsn,
        telemetry_environment: if settings.telemetry_environment.trim().is_empty() {
            "cli".to_string()
        } else {
            settings.telemetry_environment
        },
        logging_level: normalize_logging_level(&settings.logging_level)?,
        logging_format: normalize_logging_format(&settings.logging_format)?,
        memory_enabled: settings.memory_enabled,
        web_search_enabled: settings.web_search_enabled,
        code_execution_enabled: settings.code_execution_enabled,
        trust_layer_enabled: settings.trust_layer_enabled,
        notifications_enabled: settings.notifications_enabled,
    })
}

pub(crate) fn normalize_theme(theme: &str) -> Result<String, RuntimeError> {
    match theme.trim().to_ascii_lowercase().as_str() {
        "" | "system" => Ok("system".to_string()),
        "light" => Ok("light".to_string()),
        "dark" => Ok("dark".to_string()),
        _ => Err(RuntimeError::invalid_params(
            "theme must be light, dark, or system",
        )),
    }
}

pub(crate) fn normalize_logging_level(level: &str) -> Result<String, RuntimeError> {
    match level.trim().to_ascii_lowercase().as_str() {
        "debug" => Ok("debug".to_string()),
        "" | "info" => Ok("info".to_string()),
        "warn" => Ok("warn".to_string()),
        "error" => Ok("error".to_string()),
        _ => Err(RuntimeError::invalid_params(
            "logging level must be debug, info, warn, or error",
        )),
    }
}

pub(crate) fn normalize_logging_format(format: &str) -> Result<String, RuntimeError> {
    match format.trim().to_ascii_lowercase().as_str() {
        "" | "text" => Ok("text".to_string()),
        "json" => Ok("json".to_string()),
        _ => Err(RuntimeError::invalid_params(
            "logging format must be text or json",
        )),
    }
}

pub(crate) fn format_local_settings(settings: &LocalSettings) -> String {
    [
        format!("Theme: {}", settings.theme),
        format!("Telemetry: {}", on_off(settings.telemetry_enabled)),
        format!("Telemetry DSN: {}", mask_sensitive(&settings.telemetry_dsn)),
        format!("Telemetry environment: {}", settings.telemetry_environment),
        format!("Logging level: {}", settings.logging_level),
        format!("Logging format: {}", settings.logging_format),
        format!("Memory: {}", on_off(settings.memory_enabled)),
        format!("Web search: {}", on_off(settings.web_search_enabled)),
        format!(
            "Code execution: {}",
            on_off(settings.code_execution_enabled)
        ),
        format!("Trust layer: {}", on_off(settings.trust_layer_enabled)),
        format!("Notifications: {}", on_off(settings.notifications_enabled)),
    ]
    .join("\n")
}

pub(crate) fn on_off(value: bool) -> &'static str {
    if value {
        "on"
    } else {
        "off"
    }
}

pub(crate) fn command_message(
    title: impl Into<String>,
    message: impl Into<String>,
) -> CommandExecuteResult {
    CommandExecuteResult {
        handled: true,
        title: title.into(),
        message: message.into(),
    }
}

pub(crate) fn required_arg<'a>(
    args: &'a [&str],
    index: usize,
    usage: &'static str,
) -> Result<&'a str, RuntimeError> {
    args.get(index)
        .copied()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| RuntimeError::invalid_params(usage))
}

pub(crate) fn value_string(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string()
}

pub(crate) fn value_bool(value: &Value, key: &str) -> bool {
    value.get(key).and_then(Value::as_bool).unwrap_or(false)
}

pub(crate) fn format_account_settings(user: &Value) -> String {
    [
        format!("Email: {}", value_string(user, "email")),
        format!(
            "Name: {}",
            fallback_text(&value_string(user, "full_name"), "not set")
        ),
        format!("Plan: {}", value_string(user, "plan")),
        format!("Theme: {}", value_string(user, "theme_preference")),
        format!(
            "Notifications: {}",
            on_off(value_bool(user, "notifications_enabled"))
        ),
        format!("Memory: {}", on_off(value_bool(user, "memory_enabled"))),
        format!(
            "Web search: {}",
            on_off(value_bool(user, "web_search_enabled"))
        ),
        format!(
            "Code execution: {}",
            on_off(value_bool(user, "code_execution_enabled"))
        ),
        format!(
            "Trust layer: {}",
            on_off(value_bool(user, "trust_layer_enabled"))
        ),
    ]
    .join("\n")
}

pub(crate) fn format_personalization_settings(user: &Value) -> String {
    [
        format!("Memory: {}", on_off(value_bool(user, "memory_enabled"))),
        format!("Web search: {}", on_off(value_bool(user, "web_search_enabled"))),
        format!(
            "Code execution: {}",
            on_off(value_bool(user, "code_execution_enabled"))
        ),
        format!("Trust layer: {}", on_off(value_bool(user, "trust_layer_enabled"))),
        format!("Direct chat: {}", on_off(value_bool(user, "quick_mode_enabled"))),
        String::new(),
        "Use /settings personalization <memory|web-search|code-execution|trust-layer|direct-chat> <on|off>.".to_string(),
    ]
    .join("\n")
}

pub(crate) fn format_subscription_settings(user: &Value, envelope: &Value) -> String {
    let subscription = envelope.get("subscription").unwrap_or(&Value::Null);
    [
        format!("Plan: {}", value_string(user, "plan")),
        format!(
            "Subscription status: {}",
            fallback_text(&value_string(user, "subscription_status"), "none")
        ),
        format!(
            "Subscription source: {}",
            fallback_text(&value_string(user, "subscription_source"), "none")
        ),
        format!(
            "Cancel at period end: {}",
            on_off(value_bool(subscription, "cancel_at_period_end"))
        ),
        String::new(),
        "Use /settings subscription <cancel|reactivate|upgrade <plan>>.".to_string(),
    ]
    .join("\n")
}

pub(crate) fn format_integrations(value: &Value) -> String {
    let Some(items) = value.as_array() else {
        return "No app integrations available.".to_string();
    };
    if items.is_empty() {
        return "No app integrations available.".to_string();
    }
    let mut lines = items
        .iter()
        .map(|item| {
            let provider_value = value_string(item, "provider");
            let provider = fallback_text(&provider_value, "unknown");
            let label = if value_bool(item, "connected") {
                "connected"
            } else {
                "disconnected"
            };
            format!("- {provider}: {label}")
        })
        .collect::<Vec<_>>();
    lines.push(String::new());
    lines.push(
        "Use /settings apps connect <provider> or /settings apps disconnect <provider>."
            .to_string(),
    );
    lines.join("\n")
}

pub(crate) fn fallback_text<'a>(value: &'a str, fallback: &'a str) -> &'a str {
    if value.trim().is_empty() {
        fallback
    } else {
        value
    }
}

pub(crate) fn parse_on_off(value: &str) -> Option<bool> {
    match value.trim().to_ascii_lowercase().as_str() {
        "on" | "true" | "1" | "yes" => Some(true),
        "off" | "false" | "0" | "no" => Some(false),
        _ => None,
    }
}

pub(crate) fn personalization_api_key(value: &str) -> Option<&'static str> {
    match value.trim().to_ascii_lowercase().as_str() {
        "memory" => Some("memory_enabled"),
        "web-search" | "websearch" => Some("web_search_enabled"),
        "code-execution" | "code" => Some("code_execution_enabled"),
        "trust-layer" | "trust" => Some("trust_layer_enabled"),
        "direct-chat" | "direct" | "quick-mode" | "quick" => Some("quick_mode_enabled"),
        _ => None,
    }
}

pub(crate) fn validate_plan(value: &str) -> Result<(), RuntimeError> {
    match value.trim().to_ascii_lowercase().as_str() {
        "free" | "pro" | "team" => Ok(()),
        _ => Err(RuntimeError::invalid_params(
            "plan must be one of: free, pro, team",
        )),
    }
}

pub(crate) fn data_export_path() -> Result<std::path::PathBuf, RuntimeError> {
    let base = std::env::var_os("TASKFORCEAI_CONFIG_DIR")
        .map(std::path::PathBuf::from)
        .or_else(|| {
            std::env::var_os("HOME")
                .map(std::path::PathBuf::from)
                .map(|path| path.join(".config").join("taskforceai"))
        })
        .ok_or_else(|| RuntimeError::storage("config directory unavailable"))?;
    std::fs::create_dir_all(&base).map_err(|err| RuntimeError::storage(err.to_string()))?;
    Ok(base.join(format!("taskforceai-data-export-{}.json", unix_millis())))
}

pub(crate) fn mask_sensitive(value: &str) -> String {
    if value.is_empty() {
        return "not set".to_string();
    }
    let chars = value.chars().collect::<Vec<_>>();
    if chars.len() <= 8 {
        return "********".to_string();
    }
    let prefix = chars.iter().take(4).collect::<String>();
    let suffix = chars
        .iter()
        .skip(chars.len().saturating_sub(4))
        .collect::<String>();
    format!("{prefix}...{suffix}")
}

pub(crate) fn parse_json_arg(arg: Option<&str>) -> Result<Value, RuntimeError> {
    let Some(arg) = arg else {
        return Ok(json!({}));
    };
    serde_json::from_str(arg).map_err(|err| RuntimeError::invalid_params(err.to_string()))
}

pub(crate) fn parse_project_id(value: Option<&str>) -> Result<i64, RuntimeError> {
    let Some(value) = value else {
        return Err(RuntimeError::invalid_params("project id is required"));
    };
    let project_id = value
        .parse::<i64>()
        .map_err(|_| RuntimeError::invalid_params("project id must be an integer"))?;
    if project_id <= 0 {
        return Err(RuntimeError::invalid_params("project id must be positive"));
    }
    Ok(project_id)
}

#[cfg(test)]
mod tests {
    use super::mask_sensitive;

    #[test]
    fn mask_sensitive_handles_non_ascii_boundaries() {
        assert_eq!(mask_sensitive("abcdéfghijk"), "abcd...hijk");
        assert_eq!(mask_sensitive("éééééééé"), "********");
    }
}
