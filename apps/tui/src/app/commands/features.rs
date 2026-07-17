use std::collections::{BTreeMap, BTreeSet};
use std::env;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Duration;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::json;
use taskforceai_app_client::{AppClientError, AppServerClient};
use taskforceai_app_protocol::{
    ThreadImportParams, ThreadItemRecord, ThreadItemStatus, ThreadItemType, TurnRecord, TurnStatus,
};
use tokio::process::Command;

use crate::state::{AppState, PickerKind, PickerOption};

use super::show_command;

const PLAN_INSTRUCTION: &str = "Planning mode is enabled for this turn. Analyze and propose a concrete plan only. You may inspect or search read-only sources, but do not edit files, run mutating commands, call mutating tools, or make external changes. Ask for approval before implementation.";
const RECENT_TURNS_TO_KEEP: usize = 2;
const MAX_COMPACT_SUMMARY_CHARS: usize = 24_000;
const HOOK_TRUST_FILE: &str = "hook-trust.json";
const TUI_SETTINGS_FILE: &str = "tui.json";
const BUILT_IN_THEMES: &[&str] = &["taskforce-dark", "light", "nord", "high-contrast"];

pub(crate) fn plan_prompt(state: &AppState, prompt: String) -> String {
    if state.plan_mode_enabled {
        format!("{PLAN_INSTRUCTION}\n\nUser request:\n{prompt}")
    } else {
        prompt
    }
}

pub(super) fn handle_plan(state: &mut AppState, args: Vec<&str>) -> bool {
    let requested = args.first().map(|value| value.to_ascii_lowercase());
    let enabled = match requested.as_deref() {
        None => !state.plan_mode_enabled,
        Some("on" | "true" | "1") => true,
        Some("off" | "false" | "0") => false,
        Some("status") => {
            let status = if state.plan_mode_enabled {
                "enabled"
            } else {
                "disabled"
            };
            show_command(
                state,
                "Plan",
                format!(
                    "Read-only planning is {status}. Task mode remains {}.",
                    state.task_mode.label()
                ),
            );
            return true;
        }
        Some(_) => {
            show_command(state, "Plan", "Usage: /plan [on|off|status]");
            return true;
        }
    };
    state.plan_mode_enabled = enabled;
    show_command(
        state,
        "Plan",
        if enabled {
            format!(
                "Read-only planning enabled. Task mode remains {}; no implementation or mutating tools will be requested.",
                state.task_mode.label()
            )
        } else {
            format!(
                "Planning disabled. Task mode remains {}.",
                state.task_mode.label()
            )
        },
    );
    true
}

pub(super) async fn handle_shell(state: &mut AppState, command: &str) -> bool {
    if state.plan_mode_enabled {
        show_command(
            state,
            "Shell",
            "Direct shell execution is disabled while read-only planning is enabled.",
        );
        return true;
    }
    let command = command.trim();
    if command.is_empty() {
        show_command(state, "Shell", "Usage: !<command>");
        return true;
    }
    let workspace = state.workspace.as_deref().map(Path::new);
    let result = run_command(command, workspace, &[]).await;
    match result {
        Ok(output) => show_command(state, "Shell", output),
        Err(error) => show_command(state, "Shell", format!("Failed to start command: {error}")),
    }
    true
}

// coverage:ignore-start -- compaction is an app-server import adapter bracketed by live lifecycle hooks.
pub(super) async fn handle_compact(
    client: &AppServerClient,
    state: &mut AppState,
    args: Vec<&str>,
) -> Result<bool, AppClientError> {
    let Some(mut thread) = state.active_thread().cloned() else {
        show_command(
            state,
            "Compact",
            "Resume a task before compacting its context.",
        );
        return Ok(true);
    };
    if state.active_turn().is_some() {
        show_command(
            state,
            "Compact",
            "Wait for the active turn to finish before compacting.",
        );
        return Ok(true);
    }
    if thread.turns.len() <= RECENT_TURNS_TO_KEEP + 1 {
        show_command(
            state,
            "Compact",
            "There is not enough older context to compact yet.",
        );
        return Ok(true);
    }

    let instructions = args.join(" ");
    let compact_count = thread.turns.len() - RECENT_TURNS_TO_KEEP;
    let old_turns = thread.turns.drain(..compact_count).collect::<Vec<_>>();
    run_hooks(state, "pre_compact").await;
    let summary = compact_summary(&old_turns, &instructions);
    let compacted_turn = compacted_turn(&thread.id, old_turns[0].created_at, summary);
    thread.turns.insert(0, compacted_turn);
    let result = client
        .thread_import(ThreadImportParams {
            thread,
            overwrite: true,
        })
        .await?;
    state.set_active_thread(result.thread);
    run_hooks(state, "post_compact").await;
    show_command(
        state,
        "Compact",
        format!("Compacted {compact_count} older turns and kept the {RECENT_TURNS_TO_KEEP} most recent turns intact."),
    );
    Ok(true)
}
// coverage:ignore-end

// coverage:ignore-start -- hook commands read trust/config from the host and may execute user processes.
pub(super) async fn handle_hooks(state: &mut AppState, args: Vec<&str>) -> bool {
    if args
        .first()
        .is_some_and(|arg| matches!(*arg, "trust" | "untrust"))
    {
        let trusted = args[0] == "trust";
        let Some(workspace) = state.workspace.as_deref() else {
            show_command(
                state,
                "Hooks",
                "Workspace hook trust requires an active Work or Code workspace.",
            );
            return true;
        };
        let Some(config_dir) = taskforce_config_dir() else {
            show_command(
                state,
                "Hooks",
                "Could not locate the user configuration directory because HOME is unset.",
            );
            return true;
        };
        let message = match set_workspace_hook_trust_in(workspace, &config_dir, trusted) {
            Ok(path) if trusted => format!(
                "Trusted workspace hooks in {}. Repository commands may now run automatically for lifecycle events.",
                path.display()
            ),
            Ok(path) => format!(
                "Removed workspace hook trust for {}. Repository hooks are now blocked.",
                path.display()
            ),
            Err(error) => format!("Could not update workspace hook trust: {error}"),
        };
        show_command(state, "Hooks", message);
        return true;
    }
    let selection = load_hook_selection(state.workspace.as_deref());
    if args.first().is_some_and(|arg| *arg == "run") {
        let Some(event) = args.get(1) else {
            show_command(state, "Hooks", "Usage: /hooks run <event>");
            return true;
        };
        let results = execute_hooks(state, event, &selection.config).await;
        show_command(state, "Hooks", results.join("\n"));
        return true;
    }
    let mut lines = vec![
        "Configure user hooks in ~/.config/taskforceai/hooks.json. Workspace hooks require /hooks trust before they can run.".to_string(),
        "Events: session_start, prompt_submit, pre_tool, post_tool, run_complete, run_failed, run_stop, pre_compact, post_compact.".to_string(),
        selection.workspace_status,
        format!("Active hook source: {}.", selection.source),
    ];
    if selection.config.hooks.is_empty() {
        lines.push("No hooks configured.".to_string());
    } else {
        for (event, commands) in selection.config.hooks {
            lines.push(format!("{event}: {}", commands.len()));
        }
    }
    show_command(state, "Hooks", lines.join("\n"));
    true
}

pub(crate) async fn run_hooks(state: &AppState, event: &str) {
    let config = load_hooks(state.workspace.as_deref());
    let _ = execute_hooks(state, event, &config).await;
}
// coverage:ignore-end

pub(super) fn handle_thinking(state: &mut AppState, args: Vec<&str>) -> bool {
    let requested = args.first().map(|value| value.to_ascii_lowercase());
    let visible = match requested.as_deref() {
        None => !state.reasoning_visible, // coverage:ignore-line -- default toggle proceeds directly into live preference persistence.
        Some("show" | "on" | "true" | "1") => true,
        Some("hide" | "off" | "false" | "0") => false,
        Some("status") => {
            let status = if state.reasoning_visible {
                "shown"
            } else {
                "hidden"
            };
            show_command(state, "Thinking", format!("Reasoning is {status}."));
            return true;
        }
        Some(_) => {
            show_command(state, "Thinking", "Usage: /thinking [show|hide|status]");
            return true;
        }
    };
    // coverage:ignore-start -- applies UI state only after writing the user's live preference file.
    match persist_reasoning_visibility(visible) {
        Ok(()) => {
            state.reasoning_visible = visible;
            show_command(
                state,
                "Thinking",
                if visible {
                    "Reasoning is now shown."
                } else {
                    "Reasoning is now hidden."
                },
            );
        }
        Err(error) => show_command(state, "Thinking", error),
    }
    // coverage:ignore-end
    true // coverage:ignore-line -- reached only after the live preference write above.
}

pub(super) fn handle_theme(state: &mut AppState, args: Vec<&str>) -> bool {
    if args.is_empty() {
        let mut options = theme_picker_options(state.workspace.as_deref());
        let current = state.theme_name.clone();
        let selected = if current == "auto-light" {
            "light"
        } else {
            &current
        };
        if !options.iter().any(|option| option.value == selected) {
            options.push(PickerOption::new(
                selected,
                selected,
                "current custom theme",
                selected,
            ));
        }
        state.open_picker(
            PickerKind::Theme,
            "Choose a theme",
            options,
            Some(current.clone()),
        );
        state.select_picker_value(selected);
        return true;
    }
    if args[0] == "list" {
        show_command(
            state,
            "Theme",
            format!(
                "Current: {}\nBuilt-ins: taskforce-dark, light, nord, high-contrast\nCustom: /theme <path-to-json>",
                state.theme_name
            ),
        );
        return true;
    }
    let requested = args.join(" ");
    apply_requested_theme(state, &requested, true);
    true
}

fn apply_requested_theme(state: &mut AppState, requested: &str, persist: bool) {
    match apply_theme(state, requested, persist) {
        Ok(name) => show_command(state, "Theme", format!("Applied {name}.")),
        Err(error) => show_command(state, "Theme", error),
    }
}

#[derive(Debug, Default, Deserialize, Serialize)]
struct TuiSettings {
    #[serde(default)]
    theme: Option<String>,
    #[serde(default)]
    reasoning_visible: Option<bool>,
}

pub(crate) fn theme_picker_options(workspace: Option<&str>) -> Vec<PickerOption> {
    let mut names = BUILT_IN_THEMES
        .iter()
        .map(|name| (*name).to_string())
        .collect::<Vec<_>>();
    if let Some(workspace) = workspace {
        let theme_dir = Path::new(workspace).join(".taskforceai/themes");
        if let Ok(entries) = std::fs::read_dir(theme_dir) {
            names.extend(entries.flatten().filter_map(|entry| {
                let path = entry.path();
                (path.extension().and_then(|value| value.to_str()) == Some("json"))
                    .then(|| path.file_stem()?.to_str().map(ToOwned::to_owned))
                    .flatten()
            }));
        }
    }
    names.sort();
    names.dedup();
    names
        .into_iter()
        .map(|name| {
            let detail = if BUILT_IN_THEMES.contains(&name.as_str()) {
                "built-in theme"
            } else {
                "workspace theme"
            };
            PickerOption::new(name.clone(), name.clone(), detail, name)
        })
        .collect()
}

pub(crate) fn apply_theme(
    state: &mut AppState,
    requested: &str,
    persist: bool,
) -> Result<String, String> {
    let (name, colors) = load_theme(requested, state.workspace.as_deref())?;
    // coverage:ignore-start -- optional persistence writes the user's live preference file.
    if persist {
        persist_theme(&name)?;
    }
    // coverage:ignore-end
    crate::ui::style::set_palette(colors);
    state.theme_name = name.clone();
    Ok(name)
}

// coverage:ignore-start -- startup preference adapters read the user's live configuration directory.
pub(crate) fn apply_saved_theme(state: &mut AppState) {
    let Some(theme) = load_tui_settings().and_then(|settings| settings.theme) else {
        return;
    };
    if let Err(error) = apply_theme(state, &theme, false) {
        tracing::warn!(%error, %theme, "could not restore saved TUI theme");
    }
}

pub(crate) fn apply_saved_reasoning_visibility(state: &mut AppState) {
    if let Some(visible) = load_tui_settings().and_then(|settings| settings.reasoning_visible) {
        state.reasoning_visible = visible;
    }
}
// coverage:ignore-end

// coverage:ignore-start -- reads the user's live TUI settings file.
fn load_tui_settings() -> Option<TuiSettings> {
    load_tui_settings_from(&taskforce_config_dir()?)
}
// coverage:ignore-end

fn load_tui_settings_from(config_dir: &Path) -> Option<TuiSettings> {
    let contents = std::fs::read_to_string(config_dir.join(TUI_SETTINGS_FILE)).ok()?;
    serde_json::from_str(&contents).ok()
}

// coverage:ignore-start -- resolves and writes the user's live configuration directory.
fn persist_theme(theme: &str) -> Result<(), String> {
    let Some(config_dir) = taskforce_config_dir() else {
        return Err("Could not persist the theme because HOME is unset.".to_string());
    };
    persist_theme_in(&config_dir, theme)
}
// coverage:ignore-end

fn persist_theme_in(config_dir: &Path, theme: &str) -> Result<(), String> {
    let mut settings = load_tui_settings_from(config_dir).unwrap_or_default();
    settings.theme = Some(theme.to_string());
    persist_tui_settings_in(config_dir, &settings)
}

// coverage:ignore-start -- resolves and writes the user's live configuration directory.
fn persist_reasoning_visibility(visible: bool) -> Result<(), String> {
    let Some(config_dir) = taskforce_config_dir() else {
        return Err("Could not persist the thinking preference because HOME is unset.".to_string());
    };
    persist_reasoning_visibility_in(&config_dir, visible)
}
// coverage:ignore-end

fn persist_reasoning_visibility_in(config_dir: &Path, visible: bool) -> Result<(), String> {
    let mut settings = load_tui_settings_from(config_dir).unwrap_or_default();
    settings.reasoning_visible = Some(visible);
    persist_tui_settings_in(config_dir, &settings)
}

fn persist_tui_settings_in(config_dir: &Path, settings: &TuiSettings) -> Result<(), String> {
    std::fs::create_dir_all(config_dir)
        .map_err(|error| format!("Could not create {}: {error}", config_dir.display()))?;
    let contents = serde_json::to_vec_pretty(&settings)
        .map_err(|error| format!("Could not serialize TUI settings: {error}"))?;
    let mut file = tempfile::NamedTempFile::new_in(config_dir)
        .map_err(|error| format!("Could not create TUI settings: {error}"))?;
    file.write_all(&contents)
        .map_err(|error| format!("Could not write TUI settings: {error}"))?;
    file.persist(config_dir.join(TUI_SETTINGS_FILE))
        .map_err(|error| format!("Could not save TUI settings: {}", error.error))?;
    Ok(())
}

#[derive(Debug, Default, Deserialize)]
struct HookConfig {
    #[serde(default)]
    hooks: BTreeMap<String, Vec<String>>,
}

#[derive(Debug, Default, Deserialize, Serialize)]
struct HookTrust {
    #[serde(default)]
    trusted_workspaces: BTreeSet<PathBuf>,
}

struct HookSelection {
    config: HookConfig,
    source: &'static str,
    workspace_status: String,
}

fn load_hooks(workspace: Option<&str>) -> HookConfig {
    load_hook_selection(workspace).config
}

fn load_hook_selection(workspace: Option<&str>) -> HookSelection {
    let config_dir = taskforce_config_dir();
    load_hook_selection_from(workspace, config_dir.as_deref())
}

fn load_hook_selection_from(workspace: Option<&str>, config_dir: Option<&Path>) -> HookSelection {
    let user_config = config_dir
        .map(|directory| directory.join("hooks.json"))
        .and_then(read_hook_config)
        .unwrap_or_default();
    let Some(workspace) = workspace.map(PathBuf::from) else {
        return HookSelection {
            config: user_config,
            source: "user configuration",
            workspace_status:
                "Workspace hooks: unavailable without an active Work or Code workspace.".to_string(),
        };
    };
    let workspace_hooks = workspace.join(".taskforceai/hooks.json");
    if !workspace_hooks.is_file() {
        return HookSelection {
            config: user_config,
            source: "user configuration",
            workspace_status: "Workspace hooks: no .taskforceai/hooks.json found.".to_string(),
        };
    }
    if !workspace_is_trusted(&workspace, config_dir) {
        return HookSelection {
            config: user_config,
            source: "user configuration",
            workspace_status: format!(
                "Workspace hooks: blocked as untrusted ({}). Run /hooks trust to enable them.",
                workspace_hooks.display()
            ),
        };
    }
    HookSelection {
        config: read_hook_config(workspace_hooks.clone()).unwrap_or_default(),
        source: "trusted workspace configuration",
        workspace_status: format!(
            "Workspace hooks: trusted ({}). Run /hooks untrust to block them.",
            workspace_hooks.display()
        ),
    }
}

fn read_hook_config(path: PathBuf) -> Option<HookConfig> {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|contents| serde_json::from_str(&contents).ok())
}

fn taskforce_config_dir() -> Option<PathBuf> {
    env::var_os("HOME").map(|home| PathBuf::from(home).join(".config/taskforceai"))
}

fn workspace_is_trusted(workspace: &Path, config_dir: Option<&Path>) -> bool {
    let Ok(workspace) = workspace.canonicalize() else {
        return false;
    };
    config_dir
        .and_then(read_hook_trust)
        .is_some_and(|trust| trust.trusted_workspaces.contains(&workspace))
}

fn read_hook_trust(config_dir: &Path) -> Option<HookTrust> {
    std::fs::read_to_string(config_dir.join(HOOK_TRUST_FILE))
        .ok()
        .and_then(|contents| serde_json::from_str(&contents).ok())
}

fn set_workspace_hook_trust_in(
    workspace: &str,
    config_dir: &Path,
    trusted: bool,
) -> Result<PathBuf, String> {
    let workspace = Path::new(workspace)
        .canonicalize()
        .map_err(|error| format!("could not resolve the workspace: {error}"))?;
    let mut trust = read_hook_trust(config_dir).unwrap_or_default();
    if trusted {
        trust.trusted_workspaces.insert(workspace.clone());
    } else {
        trust.trusted_workspaces.remove(&workspace);
    }
    std::fs::create_dir_all(config_dir)
        .map_err(|error| format!("could not create {}: {error}", config_dir.display()))?;
    let contents = serde_json::to_vec_pretty(&trust)
        .map_err(|error| format!("could not serialize hook trust: {error}"))?;
    let mut file = tempfile::NamedTempFile::new_in(config_dir)
        .map_err(|error| format!("could not create hook trust file: {error}"))?;
    file.write_all(&contents)
        .map_err(|error| format!("could not write hook trust: {error}"))?;
    file.persist(config_dir.join(HOOK_TRUST_FILE))
        .map_err(|error| format!("could not save hook trust: {}", error.error))?;
    Ok(workspace)
}

async fn execute_hooks(state: &AppState, event: &str, config: &HookConfig) -> Vec<String> {
    let Some(commands) = config.hooks.get(event) else {
        return vec![format!("No {event} hooks configured.")];
    };
    let env_vars = [
        ("TASKFORCE_HOOK_EVENT", event),
        ("TASKFORCE_TASK_MODE", state.task_mode.label()),
        (
            "TASKFORCE_THREAD_ID",
            state.active_thread_id.as_deref().unwrap_or_default(),
        ),
    ];
    let mut results = Vec::new();
    for command in commands {
        match tokio::time::timeout(
            Duration::from_secs(30),
            run_command(
                command,
                state.workspace.as_deref().map(Path::new),
                &env_vars,
            ),
        )
        .await
        {
            Ok(Ok(output)) => results.push(format!("{command}\n{output}")),
            Ok(Err(error)) => results.push(format!("{command}\nFailed: {error}")),
            // coverage:ignore-start -- requires intentionally blocking a user hook for the full 30-second safety timeout.
            Err(_) => results.push(format!("{command}\nTimed out after 30 seconds")),
            // coverage:ignore-end
        }
    }
    results
}

async fn run_command(
    command: &str,
    workspace: Option<&Path>,
    env_vars: &[(&str, &str)],
) -> std::io::Result<String> {
    let shell = env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
    let mut process = Command::new(shell);
    process
        .arg("-lc")
        .arg(command)
        .envs(env_vars.iter().copied());
    if let Some(workspace) = workspace {
        process.current_dir(workspace);
    }
    let output = process.output().await?;
    let mut rendered = String::from_utf8_lossy(&output.stdout)
        .trim_end()
        .to_string();
    let stderr = String::from_utf8_lossy(&output.stderr);
    if !stderr.trim().is_empty() {
        if !rendered.is_empty() {
            rendered.push('\n');
        }
        rendered.push_str(stderr.trim_end());
    }
    if rendered.is_empty() {
        rendered = "(no output)".to_string();
    }
    rendered = rendered
        .chars()
        .filter(|character| matches!(*character, '\n' | '\r' | '\t') || !character.is_control())
        .take(100_000)
        .collect();
    let status = output
        .status
        .code()
        .map_or_else(|| "signal".to_string(), |code| format!("exit {code}"));
    Ok(format!("$ {command}\n{rendered}\n[{status}]"))
}

fn compact_summary(turns: &[TurnRecord], instructions: &str) -> String {
    let mut summary = String::from("Manual context summary\n");
    if !instructions.trim().is_empty() {
        summary.push_str(&format!("Focus: {}\n", instructions.trim()));
    }
    for turn in turns {
        for item in &turn.items {
            let label = match item.item_type {
                ThreadItemType::UserMessage | ThreadItemType::SteeringMessage => "User",
                ThreadItemType::AgentMessage => "Assistant",
                ThreadItemType::Reasoning => "Reasoning",
                ThreadItemType::ToolCall => "Tool",
                ThreadItemType::CommandExecution => "Command",
                ThreadItemType::FileChange => "File change",
                ThreadItemType::Plan => "Plan",
                ThreadItemType::Compaction => "Compaction",
                ThreadItemType::Approval => "Approval",
                ThreadItemType::Source => "Source",
                ThreadItemType::AgentStatus => "Status",
                ThreadItemType::Error => "Error",
            };
            if let Some(text) = readable_text(&item.content) {
                summary.push_str(&format!("\n{label}: {}", text.trim()));
            }
            if summary.chars().count() >= MAX_COMPACT_SUMMARY_CHARS {
                summary = summary.chars().take(MAX_COMPACT_SUMMARY_CHARS).collect();
                summary.push_str("\n[summary truncated]");
                return summary;
            }
        }
    }
    summary
}

fn readable_text(value: &serde_json::Value) -> Option<String> {
    value.as_str().map(ToOwned::to_owned).or_else(|| {
        [
            "text", "message", "output", "diff", "patch", "command", "title", "url",
        ]
        .into_iter()
        .find_map(|key| value.get(key).and_then(serde_json::Value::as_str))
        .map(ToOwned::to_owned)
    })
}

fn compacted_turn(thread_id: &str, created_at: u64, summary: String) -> TurnRecord {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(created_at, |duration| duration.as_millis() as u64);
    let turn_id = format!("{thread_id}:manual-compact:{now}");
    TurnRecord {
        id: turn_id.clone(),
        thread_id: thread_id.to_string(),
        run_id: format!("manual-compact:{now}"),
        status: TurnStatus::Completed,
        items: vec![ThreadItemRecord {
            id: format!("{turn_id}:summary"),
            turn_id,
            item_type: ThreadItemType::AgentMessage,
            status: ThreadItemStatus::Completed,
            content: json!({"text": summary, "compacted": true}),
            created_at,
            updated_at: now,
        }],
        created_at,
        updated_at: now,
    }
}

#[derive(Debug, Deserialize)]
struct ThemeFile {
    background: String,
    panel: String,
    panel_alt: String,
    border: String,
    focus: String,
    text: String,
    text_muted: String,
    text_faint: String,
    accent: String,
    action: String,
    warn: String,
    danger: String,
    ok: String,
}

pub(crate) fn load_theme(
    requested: &str,
    workspace: Option<&str>,
) -> Result<(String, [[u8; 3]; 13]), String> {
    let built_in = match requested {
        "taskforce-dark" | "dark" => Some([
            [5, 9, 21],
            [9, 14, 27],
            [12, 18, 34],
            [47, 64, 92],
            [34, 211, 238],
            [226, 232, 240],
            [148, 163, 184],
            [100, 116, 139],
            [56, 189, 248],
            [96, 165, 250],
            [250, 204, 21],
            [248, 113, 113],
            [52, 211, 153],
        ]),
        "light" | "auto-light" => Some([
            [245, 247, 250],
            [255, 255, 255],
            [235, 239, 245],
            [148, 163, 184],
            [2, 132, 199],
            [15, 23, 42],
            [71, 85, 105],
            [100, 116, 139],
            [2, 132, 199],
            [29, 78, 216],
            [161, 98, 7],
            [185, 28, 28],
            [4, 120, 87],
        ]),
        "nord" => Some([
            [46, 52, 64],
            [59, 66, 82],
            [67, 76, 94],
            [76, 86, 106],
            [136, 192, 208],
            [236, 239, 244],
            [216, 222, 233],
            [129, 161, 193],
            [136, 192, 208],
            [129, 161, 193],
            [235, 203, 139],
            [191, 97, 106],
            [163, 190, 140],
        ]),
        "high-contrast" => Some([
            [0, 0, 0],
            [0, 0, 0],
            [18, 18, 18],
            [255, 255, 255],
            [0, 255, 255],
            [255, 255, 255],
            [220, 220, 220],
            [180, 180, 180],
            [0, 255, 255],
            [102, 178, 255],
            [255, 255, 0],
            [255, 80, 80],
            [0, 255, 128],
        ]),
        _ => None,
    };
    if let Some(colors) = built_in {
        return Ok((requested.to_string(), colors));
    }
    let path = resolve_theme_path(requested, workspace);
    let contents = std::fs::read_to_string(&path)
        .map_err(|error| format!("Could not read {}: {error}", path.display()))?;
    let theme: ThemeFile =
        serde_json::from_str(&contents).map_err(|error| format!("Invalid theme JSON: {error}"))?;
    let colors = [
        parse_color(&theme.background)?,
        parse_color(&theme.panel)?,
        parse_color(&theme.panel_alt)?,
        parse_color(&theme.border)?,
        parse_color(&theme.focus)?,
        parse_color(&theme.text)?,
        parse_color(&theme.text_muted)?,
        parse_color(&theme.text_faint)?,
        parse_color(&theme.accent)?,
        parse_color(&theme.action)?,
        parse_color(&theme.warn)?,
        parse_color(&theme.danger)?,
        parse_color(&theme.ok)?,
    ];
    Ok((path.display().to_string(), colors))
}

fn resolve_theme_path(requested: &str, workspace: Option<&str>) -> PathBuf {
    let direct = PathBuf::from(requested);
    if direct.is_file() {
        return direct;
    }
    workspace
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".taskforceai/themes")
        .join(format!("{requested}.json"))
}

fn parse_color(value: &str) -> Result<[u8; 3], String> {
    let hex = value.trim().strip_prefix('#').unwrap_or(value.trim());
    if hex.len() != 6 {
        return Err(format!("Theme color must be #RRGGBB, got {value}"));
    }
    let parsed = u32::from_str_radix(hex, 16)
        .map_err(|_| format!("Theme color must be #RRGGBB, got {value}"))?;
    Ok([(parsed >> 16) as u8, (parsed >> 8) as u8, parsed as u8])
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;
    use taskforceai_app_protocol::{
        ThreadItemRecord, ThreadItemStatus, ThreadItemType, TurnStatus,
    };

    use crate::state::{AppState, TaskMode};
    use crate::test_support::initialized;

    #[test]
    fn parses_theme_colors() {
        assert_eq!(parse_color("#22d3ee").unwrap(), [34, 211, 238]);
        assert!(parse_color("cyan").is_err());
        let mut state = AppState::new(initialized(), Vec::new());
        apply_requested_theme(&mut state, "nord", false);
        assert!(state
            .command_output
            .as_deref()
            .is_some_and(|output| output.contains("Applied nord")));
    }

    #[test]
    fn theme_picker_discovers_workspace_themes_and_persists_selection() {
        let temp = tempfile::tempdir().expect("tempdir");
        let workspace = temp.path().join("workspace");
        let themes = workspace.join(".taskforceai/themes");
        fs::create_dir_all(&themes).expect("theme directory");
        fs::write(themes.join("ocean.json"), "{}").expect("theme file");

        let options = theme_picker_options(workspace.to_str());
        assert!(options.iter().any(|option| option.value == "ocean"));
        persist_theme_in(temp.path(), "nord").expect("persist theme");
        persist_reasoning_visibility_in(temp.path(), false).expect("persist reasoning preference");
        let settings = load_tui_settings_from(temp.path()).expect("saved TUI settings");
        assert_eq!(settings.theme, Some("nord".to_string()));
        assert_eq!(settings.reasoning_visible, Some(false));
    }

    #[test]
    fn empty_compaction_has_stable_heading() {
        assert_eq!(
            compact_summary(&Vec::<TurnRecord>::new(), ""),
            "Manual context summary\n"
        );
    }

    #[test]
    fn plan_is_orthogonal_to_task_mode_and_guards_prompts() {
        let mut state = AppState::new(initialized(), Vec::new());
        state.task_mode = TaskMode::Work;

        assert!(handle_plan(&mut state, vec!["status"]));
        assert!(handle_plan(&mut state, vec!["on"]));
        assert_eq!(state.task_mode, TaskMode::Work);
        assert!(state.plan_mode_enabled);
        let guarded = plan_prompt(&state, "Investigate this".to_string());
        assert!(guarded.contains("do not edit files"));
        assert!(guarded.ends_with("Investigate this"));

        assert!(handle_plan(&mut state, vec!["status"]));
        assert!(handle_plan(&mut state, vec!["invalid"]));
        assert!(handle_plan(&mut state, vec!["off"]));
        assert!(!state.plan_mode_enabled);
        assert_eq!(plan_prompt(&state, "plain".to_string()), "plain");
        assert!(handle_plan(&mut state, Vec::new()));
    }

    #[tokio::test]
    async fn shell_thinking_theme_and_compact_commands_cover_local_edges() {
        let mut state = AppState::new(initialized(), Vec::new());
        state.plan_mode_enabled = true;
        assert!(handle_shell(&mut state, "printf blocked").await);
        state.plan_mode_enabled = false;
        assert!(handle_shell(&mut state, " ").await);
        assert!(handle_shell(&mut state, "printf shell-ok").await);
        assert!(state
            .command_output
            .as_deref()
            .unwrap()
            .contains("shell-ok"));
        state.workspace = Some("/definitely/missing/workspace".to_string());
        assert!(handle_shell(&mut state, "printf cannot-start").await);
        assert!(state
            .command_output
            .as_deref()
            .unwrap()
            .contains("Failed to start"));
        state.workspace = None;

        assert!(handle_thinking(&mut state, vec!["status"]));
        state.reasoning_visible = true;
        assert!(handle_thinking(&mut state, vec!["status"]));
        assert!(handle_thinking(&mut state, vec!["invalid"]));
        assert!(handle_theme(&mut state, vec!["list"]));
        state.theme_name = "auto-light".to_string();
        assert!(handle_theme(&mut state, Vec::new()));
        assert!(state.picker_active());
        state.close_picker("closed");
        state.theme_name = "custom-current".to_string();
        assert!(handle_theme(&mut state, Vec::new()));
        state.close_picker("closed");
        assert!(handle_theme(&mut state, vec!["definitely-missing-theme"]));

        let client = AppServerClient::connect_http("http://127.0.0.1:1", "token")
            .expect("client construction");
        assert!(handle_compact(&client, &mut state, Vec::new())
            .await
            .expect("no active thread"));
    }

    #[test]
    fn theme_settings_hook_selection_and_compaction_helpers_cover_edge_shapes() {
        let temp = tempfile::tempdir().expect("tempdir");
        let workspace = temp.path().join("workspace");
        let config = temp.path().join("config");
        fs::create_dir_all(&workspace).expect("workspace");
        fs::create_dir_all(&config).expect("config");

        assert!(load_tui_settings_from(&config).is_none());
        fs::write(config.join(TUI_SETTINGS_FILE), "not json").expect("invalid settings");
        assert!(load_tui_settings_from(&config).is_none());
        assert!(set_workspace_hook_trust_in("/definitely/missing", &config, true).is_err());
        assert!(!workspace_is_trusted(
            Path::new("/definitely/missing"),
            Some(&config)
        ));
        assert_eq!(
            load_hook_selection_from(None, Some(&config)).source,
            "user configuration"
        );
        let selection = load_hook_selection_from(workspace.to_str(), Some(&config));
        assert!(selection.workspace_status.contains("no .taskforceai"));

        let hooks_dir = workspace.join(".taskforceai");
        fs::create_dir_all(&hooks_dir).expect("hooks dir");
        fs::write(hooks_dir.join("hooks.json"), "not json").expect("invalid hooks");
        let selection = load_hook_selection_from(workspace.to_str(), Some(&config));
        assert!(selection.workspace_status.contains("blocked"));
        assert!(read_hook_config(hooks_dir.join("hooks.json")).is_none());

        for name in [
            "taskforce-dark",
            "dark",
            "light",
            "auto-light",
            "nord",
            "high-contrast",
        ] {
            assert!(load_theme(name, None).is_ok());
        }
        assert!(load_theme("missing", workspace.to_str()).is_err());
        let custom = workspace.join("custom.json");
        fs::write(
            &custom,
            r##"{"background":"#000000","panel":"#010101","panel_alt":"#020202","border":"#030303","focus":"#040404","text":"#050505","text_muted":"#060606","text_faint":"#070707","accent":"#080808","action":"#090909","warn":"#0a0a0a","danger":"#0b0b0b","ok":"#0c0c0c"}"##,
        )
        .expect("custom theme");
        assert!(load_theme(custom.to_str().unwrap(), None).is_ok());
        assert_eq!(resolve_theme_path(custom.to_str().unwrap(), None), custom);
        assert!(parse_color("#zzzzzz").is_err());

        let item_types = [
            ThreadItemType::UserMessage,
            ThreadItemType::SteeringMessage,
            ThreadItemType::AgentMessage,
            ThreadItemType::Reasoning,
            ThreadItemType::ToolCall,
            ThreadItemType::CommandExecution,
            ThreadItemType::FileChange,
            ThreadItemType::Plan,
            ThreadItemType::Compaction,
            ThreadItemType::Approval,
            ThreadItemType::Source,
            ThreadItemType::AgentStatus,
            ThreadItemType::Error,
        ];
        let items = item_types
            .into_iter()
            .enumerate()
            .map(|(index, item_type)| ThreadItemRecord {
                id: format!("item-{index}"),
                turn_id: "turn".to_string(),
                item_type,
                status: ThreadItemStatus::Completed,
                content: if index == 0 {
                    json!("plain")
                } else {
                    json!({"message": format!("message-{index}")})
                },
                created_at: 1,
                updated_at: 1,
            })
            .collect();
        let turn = TurnRecord {
            id: "turn".to_string(),
            thread_id: "thread".to_string(),
            run_id: "run".to_string(),
            status: TurnStatus::Completed,
            items,
            created_at: 1,
            updated_at: 1,
        };
        let summary = compact_summary(&[turn], " focus ");
        assert!(summary.contains("Focus: focus"));
        assert!(summary.contains("User: plain"));
        assert!(readable_text(&json!({"none": true})).is_none());
        let compacted = compacted_turn("thread", 1, summary);
        assert_eq!(compacted.items.len(), 1);

        let huge = TurnRecord {
            id: "huge".to_string(),
            thread_id: "thread".to_string(),
            run_id: "run".to_string(),
            status: TurnStatus::Completed,
            items: vec![ThreadItemRecord {
                id: "huge-item".to_string(),
                turn_id: "huge".to_string(),
                item_type: ThreadItemType::AgentMessage,
                status: ThreadItemStatus::Completed,
                content: json!({"text": "x".repeat(MAX_COMPACT_SUMMARY_CHARS + 100)}),
                created_at: 1,
                updated_at: 1,
            }],
            created_at: 1,
            updated_at: 1,
        };
        assert!(compact_summary(&[huge], "").contains("summary truncated"));
    }

    #[tokio::test]
    async fn command_and_hook_process_rendering_covers_stderr_and_spawn_failure() {
        let both = run_command("printf out; printf err >&2", None, &[])
            .await
            .expect("shell command");
        assert!(both.contains("out\nerr"));
        let stderr = run_command("printf err >&2", None, &[])
            .await
            .expect("stderr command");
        assert!(stderr.contains("err"));

        let mut config = HookConfig::default();
        config
            .hooks
            .insert("event".into(), vec!["printf hook".into()]);
        let mut state = AppState::new(initialized(), Vec::new());
        state.workspace = Some("/definitely/missing/workspace".into());
        let results = execute_hooks(&state, "event", &config).await;
        assert!(results[0].contains("Failed"));
    }

    #[tokio::test]
    async fn untrusted_workspace_hooks_cannot_reach_the_shell() {
        let temp = tempfile::tempdir().expect("temporary hook directory should be created");
        let workspace = temp.path().join("workspace");
        let config_dir = temp.path().join("config");
        let hooks_dir = workspace.join(".taskforceai");
        fs::create_dir_all(&hooks_dir).expect("workspace hook directory should be created");
        fs::create_dir_all(&config_dir).expect("user config directory should be created");
        fs::write(
            hooks_dir.join("hooks.json"),
            r#"{"hooks":{"security_probe":["printf exploited > hook-marker"]}}"#,
        )
        .expect("workspace hook config should be written");
        fs::write(
            hooks_dir.join("hook-trust.json"),
            format!(r#"{{"trusted_workspaces":["{}"]}}"#, workspace.display()),
        )
        .expect("repository-controlled trust config should be written");
        fs::write(
            config_dir.join("hooks.json"),
            r#"{"hooks":{"user_probe":["printf user-configured"]}}"#,
        )
        .expect("user hook config should be written");
        let mut state = AppState::new(initialized(), Vec::new());
        state.workspace = Some(workspace.display().to_string());

        let selection = load_hook_selection_from(state.workspace.as_deref(), Some(&config_dir));
        let results = execute_hooks(&state, "security_probe", &selection.config).await;

        assert!(!selection.config.hooks.contains_key("security_probe"));
        assert!(selection.config.hooks.contains_key("user_probe"));
        assert!(results[0].contains("No security_probe hooks configured"));
        assert!(!workspace.join("hook-marker").exists());
    }

    #[tokio::test]
    async fn explicitly_trusted_workspace_hooks_still_execute() {
        let temp = tempfile::tempdir().expect("temporary hook directory should be created");
        let workspace = temp.path().join("workspace");
        let config_dir = temp.path().join("config");
        let hooks_dir = workspace.join(".taskforceai");
        fs::create_dir_all(&hooks_dir).expect("workspace hook directory should be created");
        fs::write(
            hooks_dir.join("hooks.json"),
            r#"{"hooks":{"security_probe":["printf trusted > hook-marker"]}}"#,
        )
        .expect("workspace hook config should be written");
        let workspace_string = workspace.display().to_string();
        set_workspace_hook_trust_in(&workspace_string, &config_dir, true)
            .expect("workspace trust should be persisted outside the repository");
        let mut state = AppState::new(initialized(), Vec::new());
        state.workspace = Some(workspace_string);

        let selection = load_hook_selection_from(state.workspace.as_deref(), Some(&config_dir));
        let results = execute_hooks(&state, "security_probe", &selection.config).await;

        assert!(selection.config.hooks.contains_key("security_probe"));
        assert!(results[0].contains("[exit 0]"));
        assert_eq!(
            fs::read_to_string(workspace.join("hook-marker"))
                .expect("trusted hook should create the marker"),
            "trusted"
        );

        fs::remove_file(workspace.join("hook-marker"))
            .expect("trusted hook marker should be removed");
        set_workspace_hook_trust_in(
            state
                .workspace
                .as_deref()
                .expect("workspace should remain set"),
            &config_dir,
            false,
        )
        .expect("workspace trust should be revoked");
        let selection = load_hook_selection_from(state.workspace.as_deref(), Some(&config_dir));
        let results = execute_hooks(&state, "security_probe", &selection.config).await;
        assert!(results[0].contains("No security_probe hooks configured"));
        assert!(!workspace.join("hook-marker").exists());
    }
}
