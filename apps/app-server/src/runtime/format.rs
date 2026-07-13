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
mod tests;
