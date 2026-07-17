use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;

use super::workspace_root;
use crate::state::AppState;

const MAX_RECORDED_STEPS: usize = 100;
const MAX_STEP_JSON_BYTES: usize = 32 * 1024;

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordReplaySkillParams {
    name: String,
    description: String,
    steps: Vec<RecordReplayStep>,
    scope: Option<String>,
}

#[derive(Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordReplayStep {
    tool_name: String,
    arguments: Value,
    success: bool,
    duration_ms: u64,
    result_preview: Option<String>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordReplaySkillResult {
    name: String,
    path: String,
    step_count: usize,
    scope: String,
}

#[tauri::command]
pub async fn record_replay_skill_create(
    state: tauri::State<'_, AppState>,
    params: RecordReplaySkillParams,
) -> Result<RecordReplaySkillResult, String> {
    let scope = params.scope.clone().unwrap_or_else(|| "user".to_string());
    let root = match scope.as_str() {
        "user" => user_skill_root()?,
        "repo" => workspace_root(&state)?.join(".agents").join("skills"),
        _ => return Err("Record & Replay skill scope must be user or repo.".to_string()),
    };
    create_record_replay_skill(&root, params, &scope)
}

fn create_record_replay_skill(
    root: &Path,
    params: RecordReplaySkillParams,
    scope: &str,
) -> Result<RecordReplaySkillResult, String> {
    let name = params.name.trim();
    let description = params.description.trim();
    if name.is_empty() || name.len() > 80 {
        return Err("Skill name must be between 1 and 80 characters.".to_string());
    }
    if description.is_empty() || description.len() > 500 {
        return Err("Skill description must be between 1 and 500 characters.".to_string());
    }
    if params.steps.is_empty() || params.steps.len() > MAX_RECORDED_STEPS {
        return Err(format!(
            "Record & Replay skills require 1 to {MAX_RECORDED_STEPS} Computer Use steps."
        ));
    }
    if params
        .steps
        .iter()
        .any(|step| step.tool_name != "computer_use")
    {
        return Err("Record & Replay accepts only Computer Use steps.".to_string());
    }

    let slug = skill_slug(name)?;
    fs::create_dir_all(root)
        .map_err(|error| format!("Failed to create skill root {}: {error}", root.display()))?;
    let destination = root.join(&slug);
    if destination.exists() {
        return Err(format!("A skill named `{slug}` already exists."));
    }

    let sanitized_steps = params
        .steps
        .into_iter()
        .enumerate()
        .map(|(index, step)| sanitize_recorded_step(step, index + 1))
        .collect::<Result<Vec<_>, _>>()?;
    let temp = root.join(format!(
        ".{slug}.recording-{}-{}",
        std::process::id(),
        rand::random::<u64>()
    ));
    fs::create_dir(&temp).map_err(|error| format!("Failed to prepare recorded skill: {error}"))?;
    let write_result = (|| -> Result<(), String> {
        let recording = serde_json::to_string_pretty(&sanitized_steps)
            .map_err(|error| format!("Failed to encode recorded steps: {error}"))?;
        fs::write(temp.join("recording.json"), recording)
            .map_err(|error| format!("Failed to write recorded steps: {error}"))?;
        fs::write(
            temp.join("SKILL.md"),
            record_replay_skill_markdown(&slug, name, description, &sanitized_steps),
        )
        .map_err(|error| format!("Failed to write recorded skill: {error}"))?;
        fs::rename(&temp, &destination)
            .map_err(|error| format!("Failed to install recorded skill: {error}"))
    })();
    if write_result.is_err() {
        let _ = fs::remove_dir_all(&temp);
    }
    write_result?;

    Ok(RecordReplaySkillResult {
        name: name.to_string(),
        path: destination.display().to_string(),
        step_count: sanitized_steps.len(),
        scope: scope.to_string(),
    })
}

fn sanitize_recorded_step(
    mut step: RecordReplayStep,
    step_number: usize,
) -> Result<RecordReplayStep, String> {
    if serde_json::to_vec(&step.arguments)
        .map_err(|error| format!("Failed to inspect recorded step: {error}"))?
        .len()
        > MAX_STEP_JSON_BYTES
    {
        return Err(format!("Recorded step {step_number} is too large."));
    }
    let action = step
        .arguments
        .get("action")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_ascii_lowercase();
    sanitize_value(
        &mut step.arguments,
        None,
        action.contains("type"),
        step_number,
    );
    step.result_preview = step
        .result_preview
        .as_deref()
        .map(|value| value.chars().take(500).collect());
    Ok(step)
}

fn sanitize_value(value: &mut Value, key: Option<&str>, typing: bool, step_number: usize) {
    if key.is_some_and(is_sensitive_key) {
        *value = Value::String("<redacted>".to_string());
        return;
    }
    match value {
        Value::String(text) => {
            if typing && key.is_some_and(|key| matches!(key, "text" | "value" | "input")) {
                *text = format!("{{{{USER_INPUT_{step_number}}}}}");
            } else if text.len() > 2_000 {
                text.truncate(2_000);
            }
        }
        Value::Array(values) => {
            for value in values.iter_mut().take(100) {
                sanitize_value(value, key, typing, step_number);
            }
            values.truncate(100);
        }
        Value::Object(values) => {
            values.retain(|key, _| !matches!(key.as_str(), "image_base64" | "screenshot"));
            for (key, value) in values.iter_mut() {
                sanitize_value(value, Some(key), typing, step_number);
            }
        }
        _ => {}
    }
}

fn is_sensitive_key(key: &str) -> bool {
    let key = key.to_ascii_lowercase();
    [
        "password",
        "passwd",
        "secret",
        "token",
        "authorization",
        "cookie",
        "api_key",
        "apikey",
    ]
    .iter()
    .any(|candidate| key.contains(candidate))
}

fn skill_slug(name: &str) -> Result<String, String> {
    let slug = name
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    if slug.is_empty() || slug.len() > 64 {
        return Err("Skill name cannot be converted to a safe directory name.".to_string());
    }
    Ok(slug)
}

fn record_replay_skill_markdown(
    slug: &str,
    name: &str,
    description: &str,
    steps: &[RecordReplayStep],
) -> String {
    let escaped_description = description.replace('"', "\\\"");
    let summary = steps
        .iter()
        .enumerate()
        .map(|(index, step)| {
            let action = step
                .arguments
                .get("action")
                .and_then(Value::as_str)
                .unwrap_or("observe");
            format!("{}. `{action}`", index + 1)
        })
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        "---\nname: {slug}\ndescription: \"{escaped_description}\"\n---\n\n# {name}\n\nReplay the demonstrated Computer Use workflow from `recording.json`.\n\n## Safety\n\n- Re-observe the screen before every action; recorded coordinates and UI state are hints, not authority.\n- Ask for confirmation before purchases, submissions, deletions, messages, or other consequential external actions.\n- Never reuse recorded secrets. Values such as `{{{{USER_INPUT_N}}}}` must be requested at replay time.\n- Stop if the current UI no longer matches the demonstrated target.\n\n## Demonstrated steps\n\n{summary}\n\n## Replay procedure\n\n1. Read `recording.json`.\n2. Validate prerequisites and gather any `USER_INPUT` placeholders.\n3. Execute one Computer Use step at a time, observing between steps.\n4. Report deviations instead of guessing.\n"
    )
}

fn user_skill_root() -> Result<PathBuf, String> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .map(|home| home.join(".agents").join("skills"))
        .ok_or_else(|| "Cannot locate the user skill directory because HOME is unset.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recorded_skill_redacts_secrets_and_parameterizes_typed_text() {
        let root = std::env::temp_dir().join(format!(
            "taskforceai-record-replay-{}-{}",
            std::process::id(),
            rand::random::<u64>()
        ));
        let result = create_record_replay_skill(
            &root,
            RecordReplaySkillParams {
                name: "Submit weekly report".to_string(),
                description: "Replay the weekly report workflow".to_string(),
                steps: vec![RecordReplayStep {
                    tool_name: "computer_use".to_string(),
                    arguments: serde_json::json!({
                        "action": "type",
                        "text": "private report",
                        "apiToken": "secret-value",
                        "screenshot": "large-image"
                    }),
                    success: true,
                    duration_ms: 50,
                    result_preview: Some("typed".to_string()),
                }],
                scope: None,
            },
            "user",
        )
        .expect("recorded skill should create");

        let recording = fs::read_to_string(Path::new(&result.path).join("recording.json"))
            .expect("recording should exist");
        assert!(recording.contains("{{USER_INPUT_1}}"));
        assert!(recording.contains("<redacted>"));
        assert!(!recording.contains("private report"));
        assert!(!recording.contains("large-image"));
        let skill = fs::read_to_string(Path::new(&result.path).join("SKILL.md"))
            .expect("skill should exist");
        assert!(skill.contains("Ask for confirmation"));
        assert!(skill.contains("recording.json"));

        fs::remove_dir_all(root).ok();
    }
}
