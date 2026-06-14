use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::Value;

use crate::api::DEFAULT_API_BASE_URL;
use crate::ollama::{normalize_base_url, DEFAULT_OLLAMA_BASE_URL};
use crate::protocol::{
    AgentSessionRecord, AgentSessionRunResult, AppResponse, AppServerEvent, DiagnosticItem,
    RunRecord, RunStatus, SubmitRunResult,
};

use super::error::RuntimeError;

pub(crate) fn value<T: Serialize>(value: T) -> AppResponse {
    AppResponse::Value(to_value(value))
}

pub(crate) fn to_value<T: Serialize>(value: T) -> Value {
    serde_json::to_value(value).expect("app-server response serialization should not fail")
}

pub(crate) fn submit_run_result_and_events(
    response: AppResponse,
) -> Result<(SubmitRunResult, Vec<AppServerEvent>), RuntimeError> {
    match response {
        AppResponse::WithEvents { result, events } => {
            let result = serde_json::from_value(result)
                .map_err(|err| RuntimeError::storage(err.to_string()))?;
            Ok((result, events))
        }
        AppResponse::Value(result) => {
            let result = serde_json::from_value(result)
                .map_err(|err| RuntimeError::storage(err.to_string()))?;
            Ok((result, Vec::new()))
        }
        AppResponse::Shutdown(_) => Err(RuntimeError::storage("unexpected shutdown response")),
    }
}

pub(crate) fn agent_session_run_result_and_events(
    response: AppResponse,
) -> Result<(AgentSessionRunResult, Vec<AppServerEvent>), RuntimeError> {
    match response {
        AppResponse::WithEvents { result, events } => {
            let result = serde_json::from_value(result)
                .map_err(|err| RuntimeError::storage(err.to_string()))?;
            Ok((result, events))
        }
        AppResponse::Value(result) => {
            let result = serde_json::from_value(result)
                .map_err(|err| RuntimeError::storage(err.to_string()))?;
            Ok((result, Vec::new()))
        }
        AppResponse::Shutdown(_) => Err(RuntimeError::storage("unexpected shutdown response")),
    }
}

pub(crate) fn from_value_response<T: serde::de::DeserializeOwned>(
    response: AppResponse,
) -> Result<T, RuntimeError> {
    let AppResponse::Value(value) = response else {
        return Err(RuntimeError::storage("unexpected app-server response"));
    };
    serde_json::from_value(value).map_err(|err| RuntimeError::storage(err.to_string()))
}

pub(crate) fn from_response_result<T: serde::de::DeserializeOwned>(
    response: AppResponse,
) -> Result<T, RuntimeError> {
    match response {
        AppResponse::Value(value) | AppResponse::WithEvents { result: value, .. } => {
            serde_json::from_value(value).map_err(|err| RuntimeError::storage(err.to_string()))
        }
        AppResponse::Shutdown(_) => Err(RuntimeError::storage("unexpected shutdown response")),
    }
}

pub(crate) fn unix_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock should be after unix epoch")
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

pub(crate) fn agent_session_prompt(session: &AgentSessionRecord) -> String {
    match session.last_message.as_deref() {
        Some(message) if !message.trim().is_empty() => {
            format!("{}\n\nSteering: {}", session.objective, message.trim())
        }
        _ => session.objective.clone(),
    }
}

pub(crate) fn agent_session_state_for_run_status(status: &RunStatus) -> &'static str {
    match status {
        RunStatus::Queued | RunStatus::Processing => "running",
        RunStatus::Completed => "completed",
        RunStatus::Failed => "failed",
        RunStatus::Canceled => "cancelled",
    }
}

pub(crate) fn next_schedule_run_at(cadence: &str, from: u64) -> Result<u64, RuntimeError> {
    let interval = schedule_interval_millis(cadence)?;
    Ok(from.saturating_add(interval))
}

pub(crate) fn schedule_interval_millis(cadence: &str) -> Result<u64, RuntimeError> {
    let normalized = cadence.trim().to_ascii_lowercase();
    let interval = match normalized.as_str() {
        "hourly" | "hour" | "1h" => 60 * 60 * 1000,
        "daily" | "day" | "1d" => 24 * 60 * 60 * 1000,
        "weekly" | "week" | "1w" => 7 * 24 * 60 * 60 * 1000,
        value => {
            if let Some(minutes) = value
                .strip_prefix("every ")
                .and_then(|raw| raw.strip_suffix("m"))
                .or_else(|| value.strip_suffix("m"))
                .and_then(|raw| raw.trim().parse::<u64>().ok())
            {
                minutes.saturating_mul(60 * 1000)
            } else if let Some(hours) = value
                .strip_prefix("every ")
                .and_then(|raw| raw.strip_suffix("h"))
                .or_else(|| value.strip_suffix("h"))
                .and_then(|raw| raw.trim().parse::<u64>().ok())
            {
                hours.saturating_mul(60 * 60 * 1000)
            } else {
                return Err(RuntimeError::invalid_params(
                    "cadence must be hourly, daily, weekly, Nm, Nh, every Nm, or every Nh",
                ));
            }
        }
    };
    if interval == 0 {
        return Err(RuntimeError::invalid_params(
            "cadence interval must be positive",
        ));
    }
    Ok(interval)
}

pub(crate) fn load_metadata_vec<T>(raw: Option<String>) -> Result<Vec<T>, RuntimeError>
where
    T: serde::de::DeserializeOwned,
{
    let Some(raw) = raw else {
        return Ok(Vec::new());
    };
    if raw.trim().is_empty() {
        return Ok(Vec::new());
    }
    serde_json::from_str(&raw).map_err(|err| RuntimeError::storage(err.to_string()))
}

pub(crate) fn diagnostic_item(label: &str, value: &str) -> DiagnosticItem {
    DiagnosticItem {
        label: label.to_string(),
        value: value.to_string(),
    }
}

pub(crate) fn default_run_store_path() -> Option<PathBuf> {
    if let Ok(path) = std::env::var("TASKFORCE_APP_SERVER_RUN_STORE") {
        return Some(PathBuf::from(path));
    }

    let home = std::env::var_os("HOME")?;
    Some(
        PathBuf::from(home)
            .join(".taskforceai")
            .join("app-server.sqlite3"),
    )
}

pub(crate) fn api_base_url_from_env() -> String {
    std::env::var("TASKFORCE_APP_SERVER_API_BASE_URL")
        .or_else(|_| std::env::var("TASKFORCE_API_BASE_URL"))
        .unwrap_or_else(|_| DEFAULT_API_BASE_URL.to_string())
}

pub(crate) fn ollama_base_url_from_env() -> String {
    std::env::var("TASKFORCE_APP_SERVER_OLLAMA_BASE_URL")
        .or_else(|_| std::env::var("OLLAMA_BASE_URL"))
        .map(|value| normalize_base_url(&value))
        .unwrap_or_else(|_| DEFAULT_OLLAMA_BASE_URL.to_string())
}

pub(crate) const MAX_PENDING_ATTACHMENTS: usize = 5;
pub(crate) const MAX_IMAGE_SIZE: usize = 10 * 1024 * 1024;
pub(crate) const MAX_DOCUMENT_SIZE: usize = 20 * 1024 * 1024;
pub(crate) const MAX_AUDIO_SIZE: usize = 20 * 1024 * 1024;
pub(crate) const MAX_VIDEO_SIZE: usize = 100 * 1024 * 1024;

pub(crate) fn next_run_sequence(runs: &[RunRecord]) -> u64 {
    runs.iter()
        .filter_map(|run| run.id.strip_prefix("local_run_"))
        .filter_map(|suffix| suffix.parse::<u64>().ok())
        .max()
        .unwrap_or(0)
        + 1
}
