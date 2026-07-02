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
    millis_since_unix_epoch(SystemTime::now())
}

fn millis_since_unix_epoch(now: SystemTime) -> u64 {
    match now.duration_since(UNIX_EPOCH) {
        Ok(duration) => duration_millis_saturating(duration),
        Err(_) => 0,
    }
}

fn duration_millis_saturating(duration: std::time::Duration) -> u64 {
    duration.as_millis().try_into().unwrap_or(u64::MAX)
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::{AgentSessionRecord, AppResponse, SubmitRunResult};
    use serde_json::json;
    use std::time::Duration;

    #[test]
    fn millis_since_unix_epoch_handles_clock_before_epoch() {
        assert_eq!(
            millis_since_unix_epoch(UNIX_EPOCH - Duration::from_millis(1)),
            0
        );
    }

    #[test]
    fn millis_since_unix_epoch_saturates_large_values() {
        assert_eq!(
            duration_millis_saturating(Duration::from_secs(u64::MAX)),
            u64::MAX
        );
    }

    #[test]
    fn response_result_helpers_accept_values_events_and_reject_shutdown() {
        let run = run_record("local_run_7", RunStatus::Completed);
        let result = SubmitRunResult { run: run.clone() };
        let event = AppServerEvent::RunUpdated {
            run: Box::new(run.clone()),
        };

        let (parsed, events) = submit_run_result_and_events(AppResponse::WithEvents {
            result: to_value(result.clone()),
            events: vec![event.clone()],
        })
        .expect("submit run result should parse");
        assert_eq!(parsed.run.id, "local_run_7");
        assert_eq!(events.len(), 1);

        let (parsed, events) = submit_run_result_and_events(value(result.clone()))
            .expect("value result should parse without events");
        assert_eq!(parsed.run.status, RunStatus::Completed);
        assert!(events.is_empty());

        assert!(
            submit_run_result_and_events(AppResponse::Shutdown(json!({ "ok": true }))).is_err()
        );

        let agent_result = AgentSessionRunResult {
            session: agent_session(Some("run the analysis")),
            run,
        };
        let (parsed, events) = agent_session_run_result_and_events(AppResponse::WithEvents {
            result: to_value(agent_result.clone()),
            events: vec![event],
        })
        .expect("agent run result should parse");
        assert_eq!(parsed.session.session_id, "session-1");
        assert_eq!(events.len(), 1);

        let (parsed, events) = agent_session_run_result_and_events(value(agent_result))
            .expect("agent value result should parse without events");
        assert_eq!(parsed.session.session_id, "session-1");
        assert!(events.is_empty());
        assert!(agent_session_run_result_and_events(AppResponse::Shutdown(json!({}))).is_err());

        let parsed: SubmitRunResult = from_value_response(value(result.clone())).unwrap();
        assert_eq!(parsed.run.id, "local_run_7");
        assert!(from_value_response::<SubmitRunResult>(AppResponse::Shutdown(json!({}))).is_err());

        let parsed: SubmitRunResult = from_response_result(AppResponse::WithEvents {
            result: to_value(result.clone()),
            events: Vec::new(),
        })
        .unwrap();
        assert_eq!(parsed.run.id, "local_run_7");
        let parsed: SubmitRunResult = from_response_result(value(result)).unwrap();
        assert_eq!(parsed.run.id, "local_run_7");
        assert!(from_response_result::<SubmitRunResult>(AppResponse::Shutdown(json!({}))).is_err());
    }

    #[test]
    fn scheduling_agent_metadata_and_sequence_helpers_cover_boundaries() {
        let session = agent_session(Some("  follow the evidence  "));
        assert_eq!(
            agent_session_prompt(&session),
            "Investigate\n\nSteering: follow the evidence"
        );
        assert_eq!(
            agent_session_prompt(&AgentSessionRecord {
                last_message: Some("   ".to_string()),
                ..session.clone()
            }),
            "Investigate"
        );

        for (status, expected) in [
            (RunStatus::Queued, "running"),
            (RunStatus::Processing, "running"),
            (RunStatus::Completed, "completed"),
            (RunStatus::Failed, "failed"),
            (RunStatus::Canceled, "cancelled"),
        ] {
            assert_eq!(agent_session_state_for_run_status(&status), expected);
        }

        assert_eq!(
            schedule_interval_millis(" hourly ").unwrap(),
            60 * 60 * 1000
        );
        assert_eq!(
            schedule_interval_millis("day").unwrap(),
            24 * 60 * 60 * 1000
        );
        assert_eq!(
            schedule_interval_millis("1w").unwrap(),
            7 * 24 * 60 * 60 * 1000
        );
        assert_eq!(
            schedule_interval_millis("every 15m").unwrap(),
            15 * 60 * 1000
        );
        assert_eq!(schedule_interval_millis("2h").unwrap(), 2 * 60 * 60 * 1000);
        assert_eq!(next_schedule_run_at("1h", u64::MAX - 1).unwrap(), u64::MAX);
        assert!(schedule_interval_millis("0m").is_err());
        assert!(schedule_interval_millis("soon").is_err());

        assert_eq!(
            load_metadata_vec::<String>(None).unwrap(),
            Vec::<String>::new()
        );
        assert_eq!(
            load_metadata_vec::<String>(Some("   ".to_string())).unwrap(),
            Vec::<String>::new()
        );
        assert_eq!(
            load_metadata_vec::<String>(Some(r#"["a","b"]"#.to_string())).unwrap(),
            vec!["a".to_string(), "b".to_string()]
        );
        assert!(load_metadata_vec::<String>(Some("not-json".to_string())).is_err());

        let diagnostic = diagnostic_item("API", "healthy");
        assert_eq!(diagnostic.label, "API");
        assert_eq!(diagnostic.value, "healthy");

        assert_eq!(
            next_run_sequence(&[
                run_record("local_run_2", RunStatus::Queued),
                run_record("remote_9", RunStatus::Queued),
                run_record("local_run_10", RunStatus::Queued),
                run_record("local_run_bad", RunStatus::Queued),
            ]),
            11
        );
        assert_eq!(next_run_sequence(&[]), 1);
    }

    #[test]
    fn environment_helpers_prefer_specific_env_then_fallback_defaults() {
        let _guard = crate::runtime::ENV_LOCK
            .lock()
            .expect("env lock should not poison");
        let saved_run_store = std::env::var_os("TASKFORCE_APP_SERVER_RUN_STORE");
        let saved_home = std::env::var_os("HOME");
        let saved_api = std::env::var_os("TASKFORCE_APP_SERVER_API_BASE_URL");
        let saved_legacy_api = std::env::var_os("TASKFORCE_API_BASE_URL");
        let saved_ollama = std::env::var_os("TASKFORCE_APP_SERVER_OLLAMA_BASE_URL");
        let saved_legacy_ollama = std::env::var_os("OLLAMA_BASE_URL");

        std::env::set_var("TASKFORCE_APP_SERVER_RUN_STORE", "/tmp/taskforce.sqlite3");
        assert_eq!(
            default_run_store_path().unwrap(),
            std::path::PathBuf::from("/tmp/taskforce.sqlite3")
        );
        std::env::remove_var("TASKFORCE_APP_SERVER_RUN_STORE");
        std::env::set_var("HOME", "/tmp/home");
        assert_eq!(
            default_run_store_path().unwrap(),
            std::path::PathBuf::from("/tmp/home/.taskforceai/app-server.sqlite3")
        );
        std::env::remove_var("HOME");
        assert!(default_run_store_path().is_none());

        std::env::set_var("TASKFORCE_APP_SERVER_API_BASE_URL", "https://api.specific/");
        std::env::set_var("TASKFORCE_API_BASE_URL", "https://api.legacy/");
        assert_eq!(api_base_url_from_env(), "https://api.specific/");
        std::env::remove_var("TASKFORCE_APP_SERVER_API_BASE_URL");
        assert_eq!(api_base_url_from_env(), "https://api.legacy/");
        std::env::remove_var("TASKFORCE_API_BASE_URL");
        assert_eq!(api_base_url_from_env(), DEFAULT_API_BASE_URL);

        std::env::set_var(
            "TASKFORCE_APP_SERVER_OLLAMA_BASE_URL",
            "http://ollama.specific/",
        );
        std::env::set_var("OLLAMA_BASE_URL", "http://ollama.legacy/");
        assert_eq!(ollama_base_url_from_env(), "http://ollama.specific");
        std::env::remove_var("TASKFORCE_APP_SERVER_OLLAMA_BASE_URL");
        assert_eq!(ollama_base_url_from_env(), "http://ollama.legacy");
        std::env::remove_var("OLLAMA_BASE_URL");
        assert_eq!(ollama_base_url_from_env(), DEFAULT_OLLAMA_BASE_URL);

        restore_env("TASKFORCE_APP_SERVER_RUN_STORE", saved_run_store);
        restore_env("HOME", saved_home);
        restore_env("TASKFORCE_APP_SERVER_API_BASE_URL", saved_api);
        restore_env("TASKFORCE_API_BASE_URL", saved_legacy_api);
        restore_env("TASKFORCE_APP_SERVER_OLLAMA_BASE_URL", saved_ollama);
        restore_env("OLLAMA_BASE_URL", saved_legacy_ollama);
    }

    fn agent_session(last_message: Option<&str>) -> AgentSessionRecord {
        AgentSessionRecord {
            session_id: "session-1".to_string(),
            title: "Session".to_string(),
            objective: "Investigate".to_string(),
            state: "active".to_string(),
            source: "test".to_string(),
            parent_session_id: None,
            last_message: last_message.map(ToOwned::to_owned),
            run_ids: Vec::new(),
            active_run_id: None,
            last_error: None,
            created_at: 1,
            updated_at: 2,
        }
    }

    fn run_record(id: &str, status: RunStatus) -> RunRecord {
        RunRecord {
            id: id.to_string(),
            prompt: "prompt".to_string(),
            model_id: None,
            project_id: None,
            status,
            output: None,
            error: None,
            created_at: 1,
            updated_at: 1,
            tool_events: Vec::new(),
            sources: Vec::new(),
            agent_statuses: Vec::new(),
            pending_approval: None,
        }
    }

    fn restore_env(key: &str, value: Option<std::ffi::OsString>) {
        if let Some(value) = value {
            std::env::set_var(key, value);
        } else {
            std::env::remove_var(key);
        }
    }
}
