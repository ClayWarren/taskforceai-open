use serde_json::{json, Value};

use crate::protocol::LocalSettings;

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
            // coverage:ignore-start
            std::env::var_os("HOME")
                .map(std::path::PathBuf::from)
                .map(|path| path.join(".config").join("taskforceai"))
        })
        // coverage:ignore-end
        .ok_or_else(|| RuntimeError::storage("config directory unavailable"))?;
    std::fs::create_dir_all(&base)?;
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
    use super::*;

    fn restore_env(key: &str, value: Option<std::ffi::OsString>) {
        match value {
            Some(value) => std::env::set_var(key, value),
            None => std::env::remove_var(key),
        }
    }

    #[test]
    fn mask_sensitive_handles_non_ascii_boundaries() {
        assert_eq!(mask_sensitive("abcdéfghijk"), "abcd...hijk");
        assert_eq!(mask_sensitive("éééééééé"), "********");
    }

    #[test]
    fn settings_helpers_cover_normalization_formatting_and_parsers() {
        assert_eq!(orchestration_role_order("Researcher"), 0);
        assert_eq!(orchestration_role_order("Other"), usize::MAX);

        let normalized = normalize_local_settings(LocalSettings {
            telemetry_environment: String::new(),
            logging_level: "warn".to_string(),
            logging_format: String::new(),
            ..default_local_settings()
        })
        .expect("settings should normalize");
        assert_eq!(normalized.telemetry_environment, "cli");
        assert_eq!(normalized.logging_level, "warn");
        assert_eq!(normalized.logging_format, "text");
        assert_eq!(normalize_logging_level("error").unwrap(), "error");
        assert!(normalize_logging_level("trace").is_err());
        assert!(normalize_logging_format("yaml").is_err());

        let formatted = format_local_settings(&LocalSettings {
            telemetry_enabled: true,
            telemetry_dsn: "abcd1234wxyz".to_string(),
            ..normalized
        });
        assert!(formatted.contains("Telemetry: on"));
        assert!(formatted.contains("Telemetry DSN: abcd...wxyz"));

        assert_eq!(
            format_integrations(&json!(null)),
            "No app integrations available."
        );
        assert_eq!(
            format_integrations(&json!([])),
            "No app integrations available."
        );
        assert!(format_integrations(&json!([{}])).contains("unknown: disconnected"));
        assert_eq!(fallback_text(" ", "fallback"), "fallback");
        assert_eq!(fallback_text("value", "fallback"), "value");

        assert_eq!(parse_on_off("YES"), Some(true));
        assert_eq!(parse_on_off("0"), Some(false));
        assert_eq!(parse_on_off("maybe"), None);
        assert_eq!(
            personalization_api_key("websearch"),
            Some("web_search_enabled")
        );
        assert_eq!(
            personalization_api_key("code"),
            Some("code_execution_enabled")
        );
        assert_eq!(
            personalization_api_key("trust"),
            Some("trust_layer_enabled")
        );
        assert_eq!(personalization_api_key("quick"), Some("quick_mode_enabled"));
        assert_eq!(personalization_api_key("unknown"), None);
        assert!(validate_plan("enterprise").is_err());

        assert_eq!(parse_json_arg(None).unwrap(), json!({}));
        assert!(parse_json_arg(Some("{")).is_err());
        assert!(parse_project_id(None).is_err());
        assert!(parse_project_id(Some("0")).is_err());
        assert_eq!(parse_project_id(Some("42")).unwrap(), 42);
    }

    #[test]
    fn data_export_path_uses_config_dir_and_creates_it() {
        let _guard = crate::runtime::ENV_LOCK
            .lock()
            .expect("env lock should not poison");
        let saved_config_dir = std::env::var_os("TASKFORCEAI_CONFIG_DIR");
        let saved_home = std::env::var_os("HOME");
        let dir = std::env::temp_dir().join(format!("taskforceai-settings-util-{}", unix_millis()));
        let _ = std::fs::remove_dir_all(&dir);
        std::env::set_var("TASKFORCEAI_CONFIG_DIR", &dir);

        let path = data_export_path().expect("export path should resolve");

        assert!(path.starts_with(&dir));
        assert!(path
            .file_name()
            .and_then(|value| value.to_str())
            .expect("filename should be utf8")
            .starts_with("taskforceai-data-export-"));
        assert!(dir.is_dir());

        std::env::remove_var("TASKFORCEAI_CONFIG_DIR");
        let home =
            std::env::temp_dir().join(format!("taskforceai-settings-home-{}", unix_millis()));
        let _ = std::fs::remove_dir_all(&home);
        std::env::set_var("HOME", &home);
        let home_path = data_export_path().expect("home export path should resolve");
        assert!(home_path.starts_with(home.join(".config").join("taskforceai")));

        restore_env("TASKFORCEAI_CONFIG_DIR", saved_config_dir);
        restore_env("HOME", saved_home);
        let _ = std::fs::remove_dir_all(dir);
        let _ = std::fs::remove_dir_all(home);
    }
}
