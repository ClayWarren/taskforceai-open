use crate::api::ApiArtifact;
use crate::protocol::*;
use serde_json::Value;

use super::error::RuntimeError;

pub(crate) fn command_help_message() -> String {
    [
        "/help",
        "/status",
        "/usage",
        "/account",
        "/artifacts",
        "/search <query>",
        "/goal [pause|resume|clear|<objective>]",
        "/agents [list|create|pause|resume|cancel|message|fork]",
        "/inspect",
        "/doctor",
        "/channel [list|add|push|delete]",
        "/schedule [list|add|enable|disable|delete]",
        "/pet [status|show|hide|name <name>|mood <focus|idle|celebrate|alert>]",
        "/skills",
        "/plugins",
        "/computer",
        "/browser",
        "/pending",
        "/context",
        "/memory",
        "/login",
        "/logout",
        "/upgrade",
        "/sync",
        "/settings",
        "/model",
        "/direct",
        "/orchestrate",
        "/project",
        "/attach",
        "/mcp",
        "/mock",
        "/clear",
        "/new",
        "/reset-local",
        "/quit",
    ]
    .join("\n")
}

pub(crate) fn format_account_usage(user: &Value, balance: Option<&Value>) -> String {
    let user = user.get("user").unwrap_or(user);
    let plan = user
        .get("plan")
        .and_then(Value::as_str)
        .unwrap_or("free")
        .to_ascii_lowercase();
    let message_count = user
        .get("message_count")
        .or_else(|| user.get("messageCount"))
        .and_then(Value::as_i64)
        .unwrap_or(0)
        .max(0);
    let messages = if plan == "free" {
        let remaining = (1 - message_count).max(0);
        format!("{message_count} used · {remaining} remaining this week")
    } else {
        let throughput = if plan == "super" {
            "20 per hour"
        } else {
            "2 per hour"
        };
        format!("{message_count} used · {throughput}")
    };
    let credit_balance = balance.and_then(|value| {
        value
            .get("creditBalance")
            .or_else(|| value.get("credit_balance"))
            .and_then(Value::as_f64)
    });
    let period_end = balance
        .and_then(|value| {
            value
                .get("currentPeriodEnd")
                .or_else(|| value.get("current_period_end"))
        })
        .or_else(|| {
            user.get("current_period_end")
                .or_else(|| user.get("currentPeriodEnd"))
        })
        .and_then(|value| match value {
            Value::String(value) if !value.is_empty() => Some(value.clone()),
            Value::Number(value) => Some(value.to_string()),
            _ => None, // coverage:ignore-line
        });

    let mut lines = vec![format!("plan: {plan}"), format!("messages: {messages}")];
    if let Some(credit_balance) = credit_balance {
        lines.push(format!("credits: ${credit_balance:.2}"));
    }
    if let Some(period_end) = period_end {
        lines.push(format!("usage window: resets {period_end}"));
    }
    lines.join("\n")
}

pub(crate) fn format_artifacts(artifacts: &[ApiArtifact]) -> String {
    if artifacts.is_empty() {
        return "No artifacts yet. Generated files will appear here after completed runs."
            .to_string();
    }

    let mut lines = vec![format!(
        "Recent artifacts: {} shown\nOpen: https://taskforceai.chat/artifacts",
        artifacts.len()
    )];
    lines.extend(artifacts.iter().map(format_artifact_line));
    lines.join("\n")
}

fn format_artifact_line(artifact: &ApiArtifact) -> String {
    let filename = artifact
        .current_version
        .as_ref()
        .and_then(|version| version.filename.as_deref())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(&artifact.title);
    let updated = artifact.updated_at.as_deref().unwrap_or("unknown");
    let version = artifact.current_version.as_ref();
    let detail = match version {
        Some(version) => {
            let mime = version.mime_type.as_deref().unwrap_or("unknown");
            let size = version
                .size_bytes
                .map(format_bytes)
                .unwrap_or_else(|| "unknown size".to_string());
            format!("{mime}, {size}, version {}", version.id)
        }
        None => "no current version".to_string(),
    };
    format!(
        "- {} [{} · {} · {}] updated {}\n  /artifacts/{}\n  {}",
        filename,
        artifact.artifact_type,
        artifact.status,
        artifact.visibility,
        updated,
        artifact.id,
        detail
    )
}

fn format_bytes(bytes: i64) -> String {
    let bytes = bytes.max(0) as f64;
    const UNITS: [&str; 4] = ["B", "KB", "MB", "GB"];
    let mut value = bytes;
    let mut unit_index = 0;
    while value >= 1024.0 && unit_index < UNITS.len() - 1 {
        value /= 1024.0;
        unit_index += 1;
    }
    if unit_index == 0 {
        format!("{} {}", value as i64, UNITS[unit_index]) // coverage:ignore-line
    } else {
        format!("{value:.1} {}", UNITS[unit_index])
    }
}

pub(crate) fn format_usage_summary(summary: &UsageSummaryResult) -> String {
    format!(
        "runs: {}\ncompleted: {}\ncanceled: {}\nfailed: {}",
        summary.total_runs, summary.completed_runs, summary.canceled_runs, summary.failed_runs
    )
}

pub(crate) fn format_status_summary(summary: &StatusSummaryResult) -> String {
    format!(
        "app-server: local\ntransport: {}\nauthenticated: {}\nruns: {}\nmodel: {}\ndirect chat: {}\nautonomous mode: {}\ncomputer use: {}\ncompanion: {}",
        summary.transport,
        summary.authenticated,
        summary.run_count,
        summary.model_id,
        if summary.quick_mode { "on" } else { "off" },
        if summary.autonomous { "on" } else { "off" },
        if summary.computer_use { "on" } else { "off" },
        format_pet_state(&summary.pet)
    )
}

pub(crate) fn default_pet_state() -> PetState {
    let mut pet = PetState {
        name: "Pulse".to_string(),
        mood: "focus".to_string(),
        visible: true,
        message: String::new(),
    };
    pet.message = pet_message(&pet);
    pet
}

pub(crate) fn normalize_pet_name(value: &str) -> Result<String, RuntimeError> {
    let value = value.trim();
    if value.is_empty() {
        return Err(RuntimeError::invalid_params("companion name is required"));
    }
    if value.chars().count() > 24 {
        return Err(RuntimeError::invalid_params(
            "companion name must be 24 characters or fewer",
        ));
    }
    Ok(value.to_string())
}

pub(crate) fn normalize_pet_mood(value: &str) -> Result<String, RuntimeError> {
    match value.trim().to_ascii_lowercase().as_str() {
        "focus" | "idle" | "celebrate" | "alert" => Ok(value.trim().to_ascii_lowercase()),
        _ => Err(RuntimeError::invalid_params(
            "companion mood must be focus, idle, celebrate, or alert",
        )),
    }
}

pub(crate) fn pet_message(pet: &PetState) -> String {
    match pet.mood.as_str() {
        "celebrate" => format!("{} is celebrating a clean run.", pet.name),
        "alert" => format!(
            "{} is watching for anything that needs attention.",
            pet.name
        ),
        "idle" => format!("{} is standing by.", pet.name),
        _ => format!("{} is focused with you.", pet.name),
    }
}

pub(crate) fn format_pet_state(pet: &PetState) -> String {
    format!(
        "{} [{}] {} - {}",
        pet.name,
        pet.mood,
        if pet.visible { "visible" } else { "hidden" },
        pet.message
    )
}

pub(crate) fn search_message<'a>(runs: impl Iterator<Item = &'a RunRecord>, query: &str) -> String {
    let query = query.trim().to_ascii_lowercase();
    if query.is_empty() {
        return "Usage: /search <query>".to_string();
    }

    let matches = runs
        .filter(|run| run_matches_query(run, &query))
        .take(10)
        .map(|run| format!("{} [{:?}] {}", run.id, run.status, run.prompt))
        .collect::<Vec<_>>();

    if matches.is_empty() {
        format!("No local runs matched {query:?}.")
    } else {
        matches.join("\n")
    }
}

pub(crate) fn run_matches_query(run: &RunRecord, query: &str) -> bool {
    run.prompt.to_ascii_lowercase().contains(query)
        || run
            .output
            .as_deref()
            .unwrap_or_default()
            .to_ascii_lowercase()
            .contains(query)
        || run
            .error
            .as_deref()
            .unwrap_or_default()
            .to_ascii_lowercase()
            .contains(query)
}

pub(crate) fn format_goal_state(goal: Option<GoalRecord>) -> String {
    match goal {
        Some(goal) => format!(
            "status: {:?}\nobjective: {}\nupdated: {}",
            goal.status, goal.objective, goal.updated_at
        ),
        None => "No active goal. Use /goal <objective>.".to_string(),
    }
}

pub(crate) fn format_agent_sessions(sessions: Vec<AgentSessionRecord>) -> String {
    if sessions.is_empty() {
        return "No agent sessions. Use /agents create <objective>.".to_string();
    }
    sessions
        .into_iter()
        .map(|session| {
            format!(
                "{} [{}] {} - {}{}{}",
                session.session_id,
                session.state,
                session.title,
                session.objective,
                session
                    .active_run_id
                    .map(|run_id| format!("\n  active run: {run_id}"))
                    .unwrap_or_else(|| format!("\n  runs: {}", session.run_ids.len())),
                session
                    .last_message
                    .map(|message| format!("\n  steering: {message}"))
                    .unwrap_or_default()
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

pub(crate) fn format_channels(channels: Vec<ChannelRecord>) -> String {
    if channels.is_empty() {
        return "No channels. Use /channel add <name> [session-id].".to_string();
    }
    channels
        .into_iter()
        .map(|channel| {
            format!(
                "{} [{}] {} target={}{}",
                channel.channel_id,
                if channel.enabled { "on" } else { "off" },
                channel.name,
                channel.target_session_id.as_deref().unwrap_or("none"),
                channel
                    .last_message
                    .map(|message| format!("\n  last: {message}"))
                    .unwrap_or_default()
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

pub(crate) fn format_schedules(schedules: Vec<ScheduleRecord>) -> String {
    if schedules.is_empty() {
        return "No schedules. Use /schedule add <name> <cadence> <prompt>.".to_string();
    }
    schedules
        .into_iter()
        .map(|schedule| {
            format!(
                "{} [{}] {} every {} - {}",
                schedule.schedule_id,
                if schedule.enabled { "on" } else { "off" },
                schedule.name,
                schedule.cadence,
                schedule.prompt
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

pub(crate) fn format_workflows(workflows: Vec<WorkflowDefinitionRecord>) -> String {
    if workflows.is_empty() {
        return "No workflows. Use /workflows save after creating a workflow definition."
            .to_string();
    }
    workflows
        .into_iter()
        .map(|workflow| {
            format!(
                "{} v{} [{}] {} phases - {}",
                workflow.workflow_id,
                workflow.version,
                serde_json::to_string(&workflow.visibility)
                    .unwrap_or_else(|_| "personal".to_string())
                    .trim_matches('"'),
                workflow.phases.len(),
                workflow.name
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

pub(crate) fn format_workflow_runs(runs: Vec<WorkflowRunRecord>) -> String {
    if runs.is_empty() {
        return "No workflow runs.".to_string();
    }
    runs.into_iter()
        .map(|run| {
            format!(
                "{} [{:?}] {}@{} phases={}",
                run.run_id,
                run.state,
                run.workflow_id,
                run.workflow_version,
                run.phase_runs.len()
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

pub(crate) fn format_diagnostics(result: DiagnosticsInspectResult) -> String {
    let mut lines = Vec::new();
    for section in result.sections {
        lines.push(section.title);
        lines.extend(
            section
                .items
                .into_iter()
                .map(|item| format!("- {}: {}", item.label, item.value)),
        );
        lines.push(String::new());
    }
    if !result.suggestions.is_empty() {
        lines.push("Suggestions".to_string());
        lines.extend(
            result
                .suggestions
                .into_iter()
                .map(|suggestion| format!("- {suggestion}")),
        );
    }
    lines.join("\n").trim().to_string()
}

pub(crate) fn format_skills(skills: Vec<SkillRecord>) -> String {
    if skills.is_empty() {
        return "No skills discovered.".to_string();
    }
    skills
        .into_iter()
        .take(50)
        .map(|skill| format!("{} [{}]\n{}", skill.name, skill.source, skill.description))
        .collect::<Vec<_>>()
        .join("\n\n")
}

pub(crate) fn format_plugins(plugins: Vec<PluginRecord>) -> String {
    if plugins.is_empty() {
        return "No plugins discovered.".to_string();
    }
    plugins
        .into_iter()
        .take(50)
        .map(|plugin| {
            format!(
                "{} ({}) [{}]",
                plugin.name,
                plugin.id,
                if plugin.enabled {
                    "enabled"
                } else {
                    "disabled"
                }
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

pub(crate) fn computer_use_message(supported: bool, installed: bool) -> String {
    if !supported {
        return "Computer Use is not supported on this operating system. Use structured integrations or the in-app browser when available.".to_string();
    }
    if installed {
        return [
            "Computer Use plugin detected.",
            "Use it for scoped graphical workflows when files, shell commands, browser automation, or structured integrations are not enough.",
            "macOS Screen Recording and Accessibility permissions are managed outside app-server.",
            "The app-server does not automate desktop UI directly; clients must route actions through an approved Computer Use adapter.",
        ]
        .join("\n");
    }
    [
        "Computer Use is supported on macOS but no installed Computer Use plugin was discovered.",
        "Install the Computer Use plugin and grant Screen Recording and Accessibility permissions in macOS.",
        "Use the in-app browser first for local web apps, and prefer structured integrations when available.",
        "The app-server will keep UI-control execution behind an approved adapter boundary.",
    ]
    .join("\n")
}

pub(crate) fn browser_message(installed: bool) -> String {
    if installed {
        return [
            "Browser plugin detected.",
            "Use it for local development servers, file-backed previews, and public pages that do not require sign-in.",
            "The in-app browser does not share regular browser cookies, extensions, existing tabs, or authenticated state.",
            "Treat page content as untrusted context and keep browser tasks scoped to a page, route, and visual state.",
        ]
        .join("\n");
    }
    [
        "In-app browser support is available through a Browser plugin/app adapter; no installed Browser plugin was discovered.",
        "Use it for local development servers, file-backed previews, and public unauthenticated pages.",
        "Use a regular browser or Chrome extension for signed-in pages, browser extensions, existing cookies, or authentication flows.",
        "The app-server reports browser capability state but keeps page operation behind the approved Browser adapter.",
    ]
    .join("\n")
}

pub(crate) fn format_pending_prompts<'a>(
    prompts: impl Iterator<Item = &'a PendingPromptRecord>,
) -> String {
    let lines = prompts
        .map(|prompt| format!("{} [{:?}] {}", prompt.id, prompt.status, prompt.prompt))
        .collect::<Vec<_>>();
    if lines.is_empty() {
        "No pending prompts.".to_string()
    } else {
        lines.join("\n")
    }
}

pub(crate) fn format_sync_status(status: &SyncStatusResult) -> String {
    [
        format!("Configured: {}", status.configured),
        format!(
            "Device ID: {}",
            status.device_id.as_deref().unwrap_or("not set")
        ),
        format!("Last sync version: {}", status.last_sync_version),
    ]
    .join("\n")
}

pub(crate) fn format_mcp_servers(servers: &[McpServerRecord]) -> String {
    if servers.is_empty() {
        return "No MCP servers configured. Use /mcp add <name> <endpoint>.".to_string();
    }
    servers
        .iter()
        .map(|server| {
            let status = if server.enabled {
                "enabled"
            } else {
                "disabled"
            };
            let tools = if server.tools.is_empty() {
                "all tools".to_string()
            } else {
                server.tools.join(",")
            };
            format!(
                "- {} [{}] {} ({})",
                server.name, status, server.endpoint, tools
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

pub(crate) fn format_prompt_queue(prompts: &[PromptQueueRecord]) -> String {
    if prompts.is_empty() {
        return "No queued prompts.".to_string();
    }
    prompts
        .iter()
        .map(|prompt| {
            let id = prompt
                .id
                .map_or_else(|| "unpersisted".to_string(), |id| id.to_string());
            let mut line = format!(
                "{} [{}:{}] {}",
                id, prompt.status, prompt.dispatch_timing, prompt.prompt
            );
            line.push_str(&format!(" conversation={}", prompt.conversation_id));
            if let Some(model_id) = &prompt.model_id {
                line.push_str(&format!(" model={model_id}"));
            }
            if !prompt.attachment_ids.is_empty() {
                line.push_str(&format!(" attachments={}", prompt.attachment_ids.len()));
            }
            line
        })
        .collect::<Vec<_>>()
        .join("\n")
}

pub(crate) fn format_pending_changes(changes: &[PendingChangeRecord]) -> String {
    if changes.is_empty() {
        return "No pending changes.".to_string();
    }
    changes
        .iter()
        .map(|change| {
            let id = change
                .id
                .map_or_else(|| "unpersisted".to_string(), |id| id.to_string());
            format!(
                "{} [{}:{}] {}",
                id, change.change_type, change.operation, change.entity_id
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

pub(crate) fn format_mcp_available(result: &McpAvailableResult) -> String {
    let mut lines = vec![result.message.clone()];
    if result.servers.is_empty() {
        lines.push("No enabled MCP servers configured.".to_string());
    } else {
        lines.push("Enabled MCP servers:".to_string());
        lines.push(format_mcp_servers(&result.servers));
    }
    lines.join("\n")
}

pub(crate) fn format_mcp_inspect(result: &McpInspectResult) -> String {
    let mut lines = vec![
        format!("{} [{}]", result.server.name, result.server.endpoint),
        format!("transport: {}", result.transport),
        format!(
            "status: {}",
            if result.server.enabled {
                "enabled"
            } else {
                "disabled"
            }
        ),
        format!(
            "tools: {}",
            if result.server.tools.is_empty() {
                "all tools".to_string() // coverage:ignore-line
            } else {
                result.server.tools.join(",")
            }
        ),
    ];
    if let Some(command) = &result.command {
        lines.push(format!("command: {}", command));
    }
    if !result.args.is_empty() {
        lines.push(format!("args: {}", result.args.join(" ")));
    }
    lines.push(result.message.clone());
    lines.join("\n")
}

pub(crate) fn format_mcp_call_result(result: &McpToolCallResult) -> String {
    [
        format!("{}/{}", result.server_name, result.tool_name),
        result.message.clone(),
    ]
    .join("\n")
}

pub(crate) fn format_orchestration_config(config: &OrchestrationConfig) -> String {
    let mut lines = vec![
        "Custom Orchestration".to_string(),
        format_orchestration_budget(config.budget),
        "Role Assignments:".to_string(),
    ];
    lines.extend(config.roles.iter().map(|role| {
        format!(
            "- {}: {} ({})",
            role.name,
            role.model_id.as_deref().unwrap_or("default"),
            role.description
        )
    }));
    lines.push(
        "Use /orchestrate set <role> <model-id>, /orchestrate budget <amount>, or /orchestrate clear."
            .to_string(),
    );
    lines.join("\n")
}

pub(crate) fn format_orchestration_budget(budget: Option<f64>) -> String {
    match budget {
        Some(value) => format!("Budget: ${value:.2}"),
        None => "Budget: Unlimited".to_string(),
    }
}

pub(crate) fn format_context_summary(summary: ContextSummaryResult) -> String {
    let mut lines = vec![
        format!(
            "estimated: {} / {} tokens",
            summary.estimated_tokens, summary.max_tokens
        ),
        String::new(),
        "Breakdown:".to_string(),
    ];
    lines.extend(summary.items.into_iter().map(|item| {
        format!(
            "- {}: {} (~{} tokens)",
            item.category, item.label, item.estimated_tokens
        )
    }));
    if !summary.suggestions.is_empty() {
        lines.push(String::new());
        lines.push("Suggestions:".to_string());
        lines.extend(
            summary
                .suggestions
                .into_iter()
                .map(|suggestion| format!("- {suggestion}")),
        );
    } // coverage:ignore-line
    lines.join("\n")
}

pub(crate) fn format_memory_summary(summary: MemorySummaryResult) -> String {
    let mut lines = vec![
        format!(
            "estimated memory context: {} tokens",
            summary.estimated_tokens
        ),
        String::new(),
        "Sources:".to_string(),
    ];
    lines.extend(summary.sources.into_iter().map(|source| {
        let status = if source.exists { "found" } else { "missing" };
        format!(
            "- {}: {} [{}] ({} bytes, ~{} tokens)",
            source.scope, source.path, status, source.bytes, source.estimated_tokens
        )
    }));
    if !summary.suggestions.is_empty() {
        lines.push(String::new());
        lines.push("Suggestions:".to_string());
        lines.extend(
            summary
                .suggestions
                .into_iter()
                .map(|suggestion| format!("- {suggestion}")),
        );
    } // coverage:ignore-line
    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use crate::api::ApiArtifactVersion;

    use super::*;

    fn run(id: &str, status: RunStatus) -> RunRecord {
        RunRecord {
            id: id.to_string(),
            prompt: "Write a launch brief".to_string(),
            model_id: Some("sentinel".to_string()),
            project_id: Some(7),
            status,
            output: Some("Finished launch notes".to_string()),
            error: Some("No risk found".to_string()),
            created_at: 1,
            updated_at: 2,
            tool_events: Vec::new(),
            sources: Vec::new(),
            agent_statuses: Vec::new(),
            pending_approval: None,
        }
    }

    fn artifact(id: &str, current_version: Option<ApiArtifactVersion>) -> ApiArtifact {
        ApiArtifact {
            id: id.to_string(),
            title: "Launch plan".to_string(),
            artifact_type: "document".to_string(),
            status: "ready".to_string(),
            visibility: "private".to_string(),
            current_version_id: Some("v1".to_string()),
            created_at: Some("2026-01-01".to_string()),
            updated_at: Some("2026-01-02".to_string()),
            current_version,
        }
    }

    #[test]
    fn core_status_and_search_formatters_cover_empty_and_populated_paths() {
        assert!(command_help_message().contains("/settings"));

        let free_usage = format_account_usage(
            &json!({
                "user": {
                    "plan": "free",
                    "messageCount": 2,
                    "currentPeriodEnd": "tomorrow"
                }
            }),
            Some(&json!({ "credit_balance": 12.345 })),
        );
        assert!(free_usage.contains("plan: free"));
        assert!(free_usage.contains("2 used"));
        assert!(free_usage.contains("credits: $12.35"));
        assert!(free_usage.contains("resets tomorrow"));

        let super_usage = format_account_usage(
            &json!({ "plan": "super", "message_count": 4 }),
            Some(&json!({ "currentPeriodEnd": 123 })),
        );
        assert!(super_usage.contains("20 per hour"));
        assert!(super_usage.contains("resets 123"));

        assert_eq!(
            format_artifacts(&[]),
            "No artifacts yet. Generated files will appear here after completed runs."
        );
        let artifact_output = format_artifacts(&[
            artifact(
                "art-1",
                Some(ApiArtifactVersion {
                    id: "version-1".to_string(),
                    artifact_id: Some("art-1".to_string()),
                    version: Some(1),
                    file_id: Some("file-1".to_string()),
                    filename: Some("launch.md".to_string()),
                    mime_type: Some("text/markdown".to_string()),
                    size_bytes: Some(1536),
                    created_at: Some("2026-01-02".to_string()),
                }),
            ),
            artifact("art-2", None),
        ]);
        assert!(artifact_output.contains("Recent artifacts: 2 shown"));
        assert!(artifact_output.contains("launch.md"));
        assert!(artifact_output.contains("1.5 KB"));
        assert!(artifact_output.contains("no current version"));

        let usage = format_usage_summary(&UsageSummaryResult {
            total_runs: 4,
            completed_runs: 2,
            canceled_runs: 1,
            failed_runs: 1,
            queued_runs: 0,
            processing_runs: 0,
        });
        assert!(usage.contains("completed: 2"));

        let pet = default_pet_state();
        let status = format_status_summary(&StatusSummaryResult {
            transport: "http".to_string(),
            authenticated: true,
            run_count: 3,
            model_id: "sentinel".to_string(),
            quick_mode: true,
            autonomous: false,
            computer_use: true,
            pet: pet.clone(),
        });
        assert!(status.contains("direct chat: on"));
        assert!(status.contains("companion: Pulse"));

        assert!(normalize_pet_name("").is_err());
        assert!(normalize_pet_name("x".repeat(25).as_str()).is_err());
        assert_eq!(normalize_pet_name(" Sentinel ").unwrap(), "Sentinel");
        assert!(normalize_pet_mood("sleepy").is_err());
        assert_eq!(normalize_pet_mood(" Alert ").unwrap(), "alert");
        assert!(pet_message(&PetState {
            mood: "celebrate".to_string(),
            ..pet.clone()
        })
        .contains("celebrating"));
        assert!(pet_message(&PetState {
            mood: "alert".to_string(),
            ..pet.clone()
        })
        .contains("watching"));
        assert!(pet_message(&PetState {
            mood: "idle".to_string(),
            ..pet.clone()
        })
        .contains("standing by"));

        assert_eq!(search_message([].iter(), ""), "Usage: /search <query>");
        let records = [run("run-1", RunStatus::Completed)];
        assert!(search_message(records.iter(), "launch").contains("run-1"));
        assert!(search_message(records.iter(), "finished").contains("run-1"));
        assert!(search_message(records.iter(), "risk").contains("run-1"));
        assert!(search_message(records.iter(), "missing").contains("No local runs"));
        assert!(run_matches_query(&records[0], "launch"));
    }

    #[test]
    fn automation_discovery_and_plugin_formatters_cover_empty_and_populated_paths() {
        assert!(format_goal_state(None).contains("No active goal"));
        assert!(format_goal_state(Some(GoalRecord {
            objective: "Reach coverage".to_string(),
            status: GoalStatus::Active,
            created_at: 1,
            updated_at: 2,
        }))
        .contains("Reach coverage"));

        assert!(format_agent_sessions(Vec::new()).contains("No agent sessions"));
        let session = AgentSessionRecord {
            session_id: "agent-1".to_string(),
            title: "Reviewer".to_string(),
            objective: "Review code".to_string(),
            state: "running".to_string(),
            source: "local".to_string(),
            parent_session_id: None,
            last_message: Some("tighten tests".to_string()),
            run_ids: vec!["run-a".to_string(), "run-b".to_string()],
            active_run_id: Some("run-b".to_string()),
            last_error: None,
            created_at: 1,
            updated_at: 2,
        };
        assert!(format_agent_sessions(vec![session.clone()]).contains("active run: run-b"));
        let idle_session = AgentSessionRecord {
            active_run_id: None,
            last_message: None,
            ..session
        };
        assert!(format_agent_sessions(vec![idle_session]).contains("runs: 2"));

        assert!(format_channels(Vec::new()).contains("No channels"));
        assert!(format_channels(vec![ChannelRecord {
            channel_id: "chan-1".to_string(),
            name: "ops".to_string(),
            kind: "local".to_string(),
            enabled: false,
            target_session_id: Some("agent-1".to_string()),
            last_message: Some("ship it".to_string()),
            created_at: 1,
            updated_at: 2,
        }])
        .contains("last: ship it"));

        assert!(format_schedules(Vec::new()).contains("No schedules"));
        assert!(format_schedules(vec![ScheduleRecord {
            schedule_id: "sched-1".to_string(),
            name: "daily".to_string(),
            prompt: "summarize".to_string(),
            cadence: "daily".to_string(),
            enabled: true,
            target_session_id: None,
            next_run_at: Some(10),
            created_at: 1,
            updated_at: 2,
        }])
        .contains("every daily"));

        assert!(format_workflows(Vec::new()).contains("No workflows"));
        let workflow = WorkflowDefinitionRecord {
            workflow_id: "wf-1".to_string(),
            name: "Coverage".to_string(),
            description: None,
            version: "1".to_string(),
            visibility: WorkflowVisibility::Organization,
            args_schema: None,
            budget: None,
            phases: vec![WorkflowPhaseDefinition {
                phase_id: "phase-1".to_string(),
                name: "Test".to_string(),
                kind: WorkflowPhaseKind::Prompt,
                prompt: Some("cover".to_string()),
                depends_on: Vec::new(),
                agent_count: Some(1),
                output_schema: None,
            }],
            output_schema: None,
            tags: Vec::new(),
            created_at: 1,
            updated_at: 2,
        };
        assert!(format_workflows(vec![workflow]).contains("organization"));
        assert!(format_workflow_runs(Vec::new()).contains("No workflow runs"));
        assert!(format_workflow_runs(vec![WorkflowRunRecord {
            run_id: "wr-1".to_string(),
            workflow_id: "wf-1".to_string(),
            workflow_version: "1".to_string(),
            state: WorkflowRunState::Running,
            args: json!({}),
            phase_runs: vec![WorkflowPhaseRunRecord {
                phase_id: "phase-1".to_string(),
                state: WorkflowRunState::Queued,
                agent_run_ids: Vec::new(),
                result: None,
                error: None,
                started_at: None,
                completed_at: None,
            }],
            agent_run_ids: Vec::new(),
            output: None,
            error: None,
            created_at: 1,
            updated_at: 2,
        }])
        .contains("phases=1"));

        assert_eq!(
            format_diagnostics(DiagnosticsInspectResult {
                sections: Vec::new(),
                suggestions: Vec::new(),
            }),
            ""
        );
        let diagnostics = format_diagnostics(DiagnosticsInspectResult {
            sections: vec![DiagnosticSection {
                title: "Runtime".to_string(),
                items: vec![DiagnosticItem {
                    label: "status".to_string(),
                    value: "ok".to_string(),
                }],
            }],
            suggestions: vec!["add tests".to_string()],
        });
        assert!(diagnostics.contains("Runtime"));
        assert!(diagnostics.contains("Suggestions"));

        assert!(format_skills(Vec::new()).contains("No skills"));
        assert!(format_skills(vec![SkillRecord {
            name: "rust".to_string(),
            description: "Rust skill".to_string(),
            path: "/tmp/skill".to_string(),
            source: "local".to_string(),
        }])
        .contains("Rust skill"));
        assert!(format_plugins(Vec::new()).contains("No plugins"));
        let plugins = format_plugins(vec![
            PluginRecord {
                id: "browser".to_string(),
                name: "Browser".to_string(),
                path: "/tmp/browser".to_string(),
                enabled: true,
                description: None,
                source: None,
            },
            PluginRecord {
                id: "disabled".to_string(),
                name: "Disabled".to_string(),
                path: "/tmp/disabled".to_string(),
                enabled: false,
                description: None,
                source: None,
            },
        ]);
        assert!(plugins.contains("[enabled]"));
        assert!(plugins.contains("[disabled]"));
    }

    #[test]
    fn integration_queue_and_context_formatters_cover_optional_paths() {
        assert!(computer_use_message(false, false).contains("not supported"));
        assert!(computer_use_message(true, true).contains("plugin detected"));
        assert!(computer_use_message(true, false).contains("no installed"));
        assert!(browser_message(true).contains("Browser plugin detected"));
        assert!(browser_message(false).contains("no installed Browser plugin"));

        assert_eq!(format_pending_prompts([].iter()), "No pending prompts.");
        let pending = [PendingPromptRecord {
            id: "prompt-1".to_string(),
            prompt: "finish".to_string(),
            model_id: None,
            project_id: None,
            status: PendingPromptStatus::Queued,
            retry_count: 0,
            last_error: None,
            created_at: 1,
            updated_at: 2,
        }];
        assert!(format_pending_prompts(pending.iter()).contains("prompt-1"));

        assert!(format_sync_status(&SyncStatusResult {
            device_id: None,
            last_sync_version: 0,
            configured: false,
        })
        .contains("not set"));

        assert!(format_mcp_servers(&[]).contains("No MCP servers"));
        let server = McpServerRecord {
            name: "files".to_string(),
            endpoint: "stdio:files".to_string(),
            tools: Vec::new(),
            enabled: true,
        };
        assert!(format_mcp_servers(std::slice::from_ref(&server)).contains("all tools"));
        let server_with_tools = McpServerRecord {
            tools: vec!["read".to_string(), "write".to_string()],
            enabled: false,
            ..server.clone()
        };
        assert!(format_mcp_servers(std::slice::from_ref(&server_with_tools)).contains("read,write"));

        assert!(format_prompt_queue(&[]).contains("No queued"));
        assert!(format_prompt_queue(&[PromptQueueRecord {
            id: None,
            conversation_id: "conv-1".to_string(),
            prompt: "continue".to_string(),
            status: "queued".to_string(),
            dispatch_timing: "after_response".to_string(),
            created_at: 1,
            updated_at: 2,
            model_id: Some("sentinel".to_string()),
            attachment_ids: vec!["att-1".to_string()],
        }])
        .contains("attachments=1"));

        assert!(format_pending_changes(&[]).contains("No pending"));
        assert!(format_pending_changes(&[PendingChangeRecord {
            id: None,
            change_type: "message".to_string(),
            entity_id: "msg-1".to_string(),
            operation: "upsert".to_string(),
            data: json!({}),
            created_at: 1,
        }])
        .contains("unpersisted"));

        assert!(format_mcp_available(&McpAvailableResult {
            servers: Vec::new(),
            adapter_ready: false,
            message: "MCP unavailable".to_string(),
        })
        .contains("No enabled"));
        assert!(format_mcp_available(&McpAvailableResult {
            servers: vec![server_with_tools.clone()],
            adapter_ready: true,
            message: "MCP ready".to_string(),
        })
        .contains("Enabled MCP servers"));
        assert!(format_mcp_inspect(&McpInspectResult {
            server: server_with_tools,
            transport: "stdio".to_string(),
            command: Some("bunx".to_string()),
            args: vec!["server".to_string()],
            adapter_ready: true,
            message: "ready".to_string(),
        })
        .contains("args: server"));
        assert!(format_mcp_call_result(&McpToolCallResult {
            server_name: "files".to_string(),
            tool_name: "read".to_string(),
            adapter_ready: true,
            result: Some(json!({ "ok": true })),
            message: "called".to_string(),
        })
        .contains("files/read"));

        let orchestration = OrchestrationConfig {
            roles: vec![
                OrchestrationRole {
                    name: "reviewer".to_string(),
                    description: "reviews".to_string(),
                    model_id: Some("sentinel".to_string()),
                },
                OrchestrationRole {
                    name: "writer".to_string(),
                    description: "writes".to_string(),
                    model_id: None,
                },
            ],
            budget: Some(12.0),
        };
        assert!(format_orchestration_config(&orchestration).contains("reviewer"));
        assert_eq!(format_orchestration_budget(None), "Budget: Unlimited");
        assert_eq!(format_orchestration_budget(Some(1.5)), "Budget: $1.50");

        let context = format_context_summary(ContextSummaryResult {
            max_tokens: 100,
            estimated_tokens: 20,
            items: vec![ContextItem {
                category: "code".to_string(),
                label: "format.rs".to_string(),
                estimated_tokens: 12,
            }],
            suggestions: vec!["trim".to_string()],
        });
        assert!(context.contains("Suggestions:"));

        let memory = format_memory_summary(MemorySummaryResult {
            sources: vec![
                MemorySourceRecord {
                    scope: "repo".to_string(),
                    path: "/tmp/memory".to_string(),
                    exists: true,
                    bytes: 10,
                    estimated_tokens: 2,
                },
                MemorySourceRecord {
                    scope: "missing".to_string(),
                    path: "/tmp/missing".to_string(),
                    exists: false,
                    bytes: 0,
                    estimated_tokens: 0,
                },
            ],
            estimated_tokens: 2,
            suggestions: vec!["refresh".to_string()],
        });
        assert!(memory.contains("[found]"));
        assert!(memory.contains("[missing]"));
        assert!(memory.contains("Suggestions:"));
    }
}
