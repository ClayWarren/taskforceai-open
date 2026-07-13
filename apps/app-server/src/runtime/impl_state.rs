use serde_json::json;

mod agents;
mod modes_goal;
mod persistence;
mod settings_discovery;
mod workers;
mod workflows;

pub(crate) fn log_runtime(level: &str, message: &str, metadata: serde_json::Value) {
    eprintln!(
        "{}",
        json!({
            "level": level,
            "target": "taskforceai_app_server",
            "message": message,
            "metadata": metadata,
        })
    );
}
