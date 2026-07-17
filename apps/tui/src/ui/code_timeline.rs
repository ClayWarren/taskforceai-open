use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use serde_json::Value;
use taskforceai_app_protocol::{
    ThreadItemRecord, ThreadItemStatus, ThreadItemType, ThreadRecord, TurnRecord, TurnStatus,
};

use super::style::{accent, action, danger, ok, panel_alt, text, text_faint, text_muted, warn};

#[derive(Clone, Copy, Default)]
struct ToolCounts {
    edit: usize,
    explore: usize,
    run: usize,
    other: usize,
}

#[derive(Clone, Copy)]
enum ToolKind {
    Edit,
    Explore,
    Run,
    Other,
}

#[cfg(test)]
pub(super) fn code_thread_detail_lines(thread: &ThreadRecord) -> Vec<Line<'static>> {
    code_thread_detail_lines_with_tool_details(thread, false, true, 0)
}

pub(super) fn code_thread_detail_lines_with_tool_details(
    thread: &ThreadRecord,
    tool_details_expanded: bool,
    reasoning_visible: bool,
    animation_frame: u64,
) -> Vec<Line<'static>> {
    let mut lines = vec![
        Line::from(vec![
            Span::styled(
                thread.title.clone(),
                Style::default().fg(text()).add_modifier(Modifier::BOLD),
            ),
            Span::styled("  code", Style::default().fg(accent())),
        ]),
        Line::raw(""),
    ];

    if thread.turns.is_empty() {
        if !thread.objective.trim().is_empty() {
            lines.extend(prompt_lines(&thread.objective));
            lines.push(Line::raw(""));
        }
        lines.push(Line::styled(
            "* Waiting for code activity",
            Style::default().fg(text_faint()),
        ));
        return lines;
    }

    for turn in &thread.turns {
        lines.extend(code_turn_lines(
            turn,
            tool_details_expanded,
            reasoning_visible,
            animation_frame,
        ));
        lines.push(Line::raw(""));
    }
    lines
}

fn code_turn_lines(
    turn: &TurnRecord,
    tool_details_expanded: bool,
    reasoning_visible: bool,
    animation_frame: u64,
) -> Vec<Line<'static>> {
    let mut lines = Vec::new();
    let has_tools = turn.items.iter().any(|item| {
        matches!(
            item.item_type,
            ThreadItemType::ToolCall
                | ThreadItemType::CommandExecution
                | ThreadItemType::FileChange
        )
    });
    let mut index = 0;

    while index < turn.items.len() {
        let item = &turn.items[index];
        if !reasoning_visible && item.item_type == ThreadItemType::Reasoning {
            index += 1;
            continue;
        }
        if item.item_type == ThreadItemType::ToolCall {
            let start = index;
            while index < turn.items.len()
                && turn.items[index].item_type == ThreadItemType::ToolCall
            {
                index += 1;
            }
            lines.push(tool_summary_line(
                &turn.items[start..index],
                tool_details_expanded,
                animation_frame,
            ));
            if tool_details_expanded {
                for (offset, tool) in turn.items[start..index].iter().enumerate() {
                    lines.extend(tool_detail_lines(tool, offset + 1));
                }
            }
            continue;
        }

        lines.extend(code_item_lines(item, has_tools));
        index += 1;
    }

    lines.push(turn_status_line(turn, animation_frame));
    lines
}

fn code_item_lines(item: &ThreadItemRecord, _has_tools: bool) -> Vec<Line<'static>> {
    let content = readable_content(&item.content);
    match item.item_type {
        ThreadItemType::UserMessage | ThreadItemType::SteeringMessage => {
            if content.is_empty() {
                Vec::new()
            } else {
                prompt_lines(legacy_visible_user_input(&content))
            }
        }
        ThreadItemType::AgentMessage => narrative_lines(&content, text(), false),
        ThreadItemType::Reasoning => narrative_lines(&content, text_muted(), true),
        ThreadItemType::Plan => narrative_lines(&content, action(), false),
        ThreadItemType::Compaction => narrative_lines(&content, text_muted(), false),
        ThreadItemType::AgentStatus => narrative_lines(&content, text(), false),
        ThreadItemType::Approval => labeled_lines("! Approval", &content, warn()),
        ThreadItemType::Source => labeled_lines("  Source", &content, action()),
        ThreadItemType::Error => labeled_lines("! Error", &content, danger()),
        ThreadItemType::CommandExecution => command_activity_lines(item, None),
        ThreadItemType::FileChange => file_change_lines(item, None),
        ThreadItemType::ToolCall => Vec::new(),
    }
}

fn legacy_visible_user_input(content: &str) -> &str {
    const PLAN_PREFIX: &str = "Planning mode is enabled for this turn.";
    const CODE_PREFIX: &str =
        "You are operating in TaskForceAI Code mode with these working-directory roots:";
    const USER_REQUEST: &str = "\n\nUser request:\n";
    const PROJECT_END: &str = "</project_instructions>\n\n";
    const SKILLS_END: &str = "</skills>\n\n";
    const WORKSPACE_FILE: &str = "\n\n<workspace_file ";

    let mut visible = content;
    loop {
        let unwrapped = if visible.starts_with(PLAN_PREFIX) || visible.starts_with(CODE_PREFIX) {
            visible.split_once(USER_REQUEST).map(|(_, request)| request)
        } else if visible.starts_with("<project_instructions>") {
            visible.split_once(PROJECT_END).map(|(_, request)| request)
        } else if visible.starts_with("Use the following selected skills for this request.") {
            visible.rsplit_once(SKILLS_END).map(|(_, request)| request)
        } else {
            None
        };
        let Some(unwrapped) = unwrapped else {
            break;
        };
        visible = unwrapped;
    }

    visible
        .split_once(WORKSPACE_FILE)
        .map_or(visible, |(request, _)| request)
}

fn prompt_lines(content: &str) -> Vec<Line<'static>> {
    content
        .lines()
        .enumerate()
        .map(|(index, line)| {
            Line::from(vec![
                Span::styled(
                    if index == 0 { "> " } else { "  " },
                    Style::default().fg(accent()).bg(panel_alt()),
                ),
                Span::styled(
                    line.to_string(),
                    Style::default()
                        .fg(text())
                        .bg(panel_alt())
                        .add_modifier(Modifier::BOLD),
                ),
            ])
        })
        .collect()
}

fn narrative_lines(
    content: &str,
    color: ratatui::style::Color,
    italic: bool,
) -> Vec<Line<'static>> {
    if content.is_empty() {
        return Vec::new();
    }
    let mut lines = super::markdown::markdown_lines(content, color, "• ", "  ");
    if italic {
        for line in &mut lines {
            for span in &mut line.spans {
                span.style = span.style.add_modifier(Modifier::ITALIC);
            }
        }
    }
    lines
}

fn labeled_lines(label: &str, content: &str, color: ratatui::style::Color) -> Vec<Line<'static>> {
    let mut lines = vec![Line::styled(
        label.to_string(),
        Style::default().fg(color).add_modifier(Modifier::BOLD),
    )];
    if !content.is_empty() {
        lines.extend(
            content
                .lines()
                .map(|line| Line::styled(format!("  {line}"), Style::default().fg(text()))),
        );
    }
    lines
}

fn tool_summary_line(
    items: &[ThreadItemRecord],
    _expanded: bool,
    animation_frame: u64,
) -> Line<'static> {
    let counts = tool_counts(items);
    let summary = tool_summary(counts);
    let failed = items
        .iter()
        .any(|item| item.status == ThreadItemStatus::Failed);
    let running = items
        .iter()
        .any(|item| item.status == ThreadItemStatus::InProgress);
    let (marker, label, color, suffix) = if failed {
        ("!", summary, danger(), " · failed")
    } else if running {
        let active = items
            .iter()
            .rev()
            .find(|item| item.status == ThreadItemStatus::InProgress)
            .map(active_tool_summary)
            .unwrap_or(summary);
        (
            super::motion::spinner(animation_frame),
            active,
            warn(),
            " · running",
        )
    } else {
        (" ", summary, text_muted(), "")
    };
    Line::from(vec![
        Span::styled(format!("{marker} "), Style::default().fg(color)),
        Span::styled(label, Style::default().fg(text_muted())),
        Span::styled(suffix, Style::default().fg(color)),
    ])
}

fn active_tool_summary(item: &ThreadItemRecord) -> String {
    match tool_kind(&item.content) {
        ToolKind::Run => format!(
            "Running {}",
            string_field(&item.content, &["command", "cmd", "script", "title"])
                .unwrap_or("command")
        ),
        ToolKind::Edit => format!(
            "Editing {}",
            string_field(&item.content, &["path", "file", "filePath", "title"])
                .unwrap_or("workspace")
        ),
        ToolKind::Explore => format!(
            "Reading {}",
            string_field(
                &item.content,
                &["path", "file", "query", "pattern", "url", "title"]
            )
            .unwrap_or_else(|| tool_name(&item.content))
        ),
        ToolKind::Other => format!("Calling {}", tool_name(&item.content)),
    }
}

fn tool_detail_lines(item: &ThreadItemRecord, ordinal: usize) -> Vec<Line<'static>> {
    match tool_kind(&item.content) {
        ToolKind::Run => command_activity_lines(item, Some(ordinal)),
        ToolKind::Edit => file_change_lines(item, Some(ordinal)),
        ToolKind::Explore => explore_activity_lines(item, ordinal),
        ToolKind::Other => generic_tool_lines(item, ordinal),
    }
}

fn command_activity_lines(item: &ThreadItemRecord, ordinal: Option<usize>) -> Vec<Line<'static>> {
    let command = string_field(
        &item.content,
        &["command", "cmd", "script", "input", "title"],
    )
    .unwrap_or("command");
    let mut lines = vec![activity_header(
        ordinal,
        "Run",
        command,
        item.status,
        warn(),
    )];
    if let Some(cwd) = string_field(&item.content, &["cwd", "workingDirectory", "directory"]) {
        lines.push(detail_line("cwd", cwd, text_faint()));
    }
    if let Some(output) = string_field(&item.content, &["output", "stdout", "text", "result"]) {
        lines.extend(output_block(output, text_muted(), 24));
    }
    if let Some(stderr) = string_field(&item.content, &["stderr", "error"]) {
        lines.extend(output_block(stderr, danger(), 12));
    }
    if let Some(code) = integer_field(&item.content, &["exitCode", "exit_code", "code"]) {
        lines.push(detail_line(
            "exit",
            &code.to_string(),
            if code == 0 { ok() } else { danger() },
        ));
    }
    lines
}

fn file_change_lines(item: &ThreadItemRecord, ordinal: Option<usize>) -> Vec<Line<'static>> {
    let path = string_field(
        &item.content,
        &["path", "file", "filePath", "filename", "title"],
    )
    .unwrap_or("workspace change");
    let diff = string_field(&item.content, &["diff", "patch"]);
    let suffix = diff.map(diff_stat).unwrap_or_default();
    let title = if suffix.is_empty() {
        path.to_string()
    } else {
        format!("{path} · {suffix}")
    };
    let mut lines = vec![activity_header(
        ordinal,
        "Edit",
        &title,
        item.status,
        action(),
    )];
    if let Some(diff) = diff {
        lines.extend(super::markdown::diff_lines(diff, "    │ "));
    } else if let Some(output) = string_field(&item.content, &["output", "text", "result"]) {
        lines.extend(output_block(output, text_muted(), 16));
    }
    lines
}

fn explore_activity_lines(item: &ThreadItemRecord, ordinal: usize) -> Vec<Line<'static>> {
    let name = tool_name(&item.content);
    let subject = string_field(
        &item.content,
        &["path", "file", "query", "pattern", "url", "title"],
    )
    .unwrap_or(name);
    let mut lines = vec![activity_header(
        Some(ordinal),
        "Read",
        subject,
        item.status,
        accent(),
    )];
    if let Some(output) = string_field(&item.content, &["output", "result", "text", "content"]) {
        lines.extend(output_block(output, text_muted(), 12));
    }
    lines
}

fn generic_tool_lines(item: &ThreadItemRecord, ordinal: usize) -> Vec<Line<'static>> {
    let name = tool_name(&item.content);
    let mut lines = vec![activity_header(
        Some(ordinal),
        "Tool",
        name,
        item.status,
        warn(),
    )];
    for (label, keys) in [
        ("target", &["path", "url", "query", "title"][..]),
        ("result", &["output", "result", "text", "message"][..]),
    ] {
        if let Some(value) = string_field(&item.content, keys) {
            lines.extend(labeled_output_block(label, value, text_muted(), 12));
        }
    }
    lines
}

fn activity_header(
    ordinal: Option<usize>,
    kind: &str,
    title: &str,
    status: ThreadItemStatus,
    color: ratatui::style::Color,
) -> Line<'static> {
    let (marker, status_color) = match status {
        ThreadItemStatus::InProgress => ("◦", warn()),
        ThreadItemStatus::Completed => ("✓", ok()),
        ThreadItemStatus::Failed => ("!", danger()),
        ThreadItemStatus::Declined => ("−", text_faint()),
    };
    let ordinal = ordinal
        .map(|value| format!("{value}. "))
        .unwrap_or_default();
    Line::from(vec![
        Span::styled("    ├─ ", Style::default().fg(text_faint())),
        Span::styled(
            format!("{marker} {ordinal}{kind}"),
            Style::default().fg(color).add_modifier(Modifier::BOLD),
        ),
        Span::styled("  ", Style::default()),
        Span::styled(truncate(title, 180), Style::default().fg(text())),
        Span::styled(
            format!(" · {}", format!("{status:?}").to_ascii_lowercase()),
            Style::default().fg(status_color),
        ),
    ])
}

fn detail_line(label: &str, value: &str, color: ratatui::style::Color) -> Line<'static> {
    Line::from(vec![
        Span::styled("    │  ", Style::default().fg(text_faint())),
        Span::styled(format!("{label}: "), Style::default().fg(text_faint())),
        Span::styled(truncate(value, 220), Style::default().fg(color)),
    ])
}

fn output_block(value: &str, color: ratatui::style::Color, limit: usize) -> Vec<Line<'static>> {
    let mut lines = value
        .lines()
        .take(limit)
        .map(|line| {
            Line::from(vec![
                Span::styled("    │  ", Style::default().fg(text_faint())),
                Span::styled(truncate(line, 240), Style::default().fg(color)),
            ])
        })
        .collect::<Vec<_>>();
    if value.lines().count() > limit {
        lines.push(Line::styled(
            "    └─ [output truncated]",
            Style::default().fg(text_faint()),
        ));
    }
    lines
}

fn labeled_output_block(
    label: &str,
    value: &str,
    color: ratatui::style::Color,
    limit: usize,
) -> Vec<Line<'static>> {
    let mut lines = value
        .lines()
        .take(limit)
        .enumerate()
        .map(|(index, line)| {
            if index == 0 {
                detail_line(label, line, color)
            } else {
                Line::from(vec![
                    Span::styled("    │  ", Style::default().fg(text_faint())),
                    Span::styled(truncate(line, 240), Style::default().fg(color)),
                ])
            }
        })
        .collect::<Vec<_>>();
    if value.lines().count() > limit {
        lines.push(Line::styled(
            "    └─ [output truncated]",
            Style::default().fg(text_faint()),
        ));
    }
    lines
}

fn tool_name(content: &Value) -> &str {
    string_field(content, &["toolName", "tool_name", "name", "tool", "title"]).unwrap_or("tool")
}

fn string_field<'a>(value: &'a Value, keys: &[&str]) -> Option<&'a str> {
    for key in keys {
        if let Some(value) = value.get(*key).and_then(Value::as_str) {
            if !value.trim().is_empty() {
                return Some(value.trim());
            }
        }
    }
    for container in ["input", "args", "arguments", "parameters", "metadata"] {
        if let Some(nested) = value.get(container) {
            if let Some(found) = string_field(nested, keys) {
                return Some(found);
            }
        }
    }
    None
}

fn integer_field(value: &Value, keys: &[&str]) -> Option<i64> {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(Value::as_i64))
}

fn diff_stat(diff: &str) -> String {
    let additions = diff
        .lines()
        .filter(|line| line.starts_with('+') && !line.starts_with("+++"))
        .count();
    let deletions = diff
        .lines()
        .filter(|line| line.starts_with('-') && !line.starts_with("---"))
        .count();
    match (additions, deletions) {
        (0, 0) => String::new(),
        _ => format!("+{additions} -{deletions}"),
    }
}

fn truncate(value: &str, limit: usize) -> String {
    let truncated = value.chars().count() > limit;
    let mut output = value.chars().take(limit).collect::<String>();
    if truncated {
        output.push('…');
    }
    output
}

fn tool_counts(items: &[ThreadItemRecord]) -> ToolCounts {
    let mut counts = ToolCounts::default();
    for item in items {
        match tool_kind(&item.content) {
            ToolKind::Edit => counts.edit += 1,
            ToolKind::Explore => counts.explore += 1,
            ToolKind::Run => counts.run += 1,
            ToolKind::Other => counts.other += 1,
        }
    }
    counts
}

fn tool_kind(content: &Value) -> ToolKind {
    if string_field(content, &["command", "cmd", "script"]).is_some() {
        return ToolKind::Run;
    }
    let name = tool_name(content).to_ascii_lowercase();
    if contains_any(
        &name,
        &[
            "edit", "write", "patch", "create", "delete", "move", "rename",
        ],
    ) {
        ToolKind::Edit
    } else if contains_any(
        &name,
        &["read", "search", "find", "list", "glob", "grep", "inspect"],
    ) {
        ToolKind::Explore
    } else if contains_any(
        &name,
        &[
            "exec", "command", "shell", "terminal", "test", "build", "lint",
        ],
    ) {
        ToolKind::Run
    } else {
        ToolKind::Other
    }
}

fn contains_any(value: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| value.contains(needle))
}

fn tool_summary(counts: ToolCounts) -> String {
    let mut parts = Vec::new();
    if counts.edit > 0 {
        parts.push(format!(
            "Edited {} {}",
            counts.edit,
            plural(counts.edit, "file")
        ));
    }
    if counts.explore > 0 {
        let verb = if parts.is_empty() { "Read" } else { "read" };
        parts.push(format!(
            "{verb} {} {}",
            counts.explore,
            plural(counts.explore, "file")
        ));
    }
    if counts.run > 0 {
        let verb = if parts.is_empty() { "Ran" } else { "ran" };
        parts.push(format!(
            "{verb} {} {}",
            counts.run,
            plural(counts.run, "command")
        ));
    }
    if counts.other > 0 {
        let verb = if parts.is_empty() { "Used" } else { "used" };
        parts.push(format!(
            "{verb} {} {}",
            counts.other,
            plural(counts.other, "tool")
        ));
    }
    if parts.is_empty() {
        "Working".to_string()
    } else {
        parts.join(", ")
    }
}

fn plural(count: usize, singular: &str) -> String {
    if count == 1 {
        singular.to_string()
    } else {
        format!("{singular}s")
    }
}

fn turn_status_line(turn: &TurnRecord, animation_frame: u64) -> Line<'static> {
    let elapsed = turn.updated_at.saturating_sub(turn.created_at);
    let duration = (elapsed > 0).then(|| format!(" for {}", elapsed_label(elapsed)));
    let duration = duration.unwrap_or_default();
    let (label, color) = match turn.status {
        TurnStatus::Queued => (
            format!("{} Queued", super::motion::pulse(animation_frame)),
            text_faint(),
        ),
        TurnStatus::InProgress => (
            format!(
                "{} Working{duration}",
                super::motion::spinner(animation_frame)
            ),
            warn(),
        ),
        TurnStatus::Completed => (format!("* Worked{duration}"), text_faint()),
        TurnStatus::Failed => (format!("! Failed{duration}"), danger()),
        TurnStatus::Interrupted => (format!("- Interrupted{duration}"), warn()),
    };
    Line::styled(label, Style::default().fg(color))
}

pub(super) fn optimistic_submission_lines(
    prompt: &str,
    animation_frame: u64,
) -> Vec<Line<'static>> {
    let mut lines = vec![
        Line::from(vec![
            Span::styled(
                "TaskForceAI",
                Style::default().fg(text()).add_modifier(Modifier::BOLD),
            ),
            Span::styled("  code", Style::default().fg(accent())),
        ]),
        Line::raw(""),
    ];
    lines.extend(prompt_lines(prompt));
    lines.push(Line::raw(""));
    lines.push(Line::styled(
        format!("{} Working", super::motion::spinner(animation_frame)),
        Style::default().fg(warn()),
    ));
    lines
}

fn elapsed_label(seconds: u64) -> String {
    if seconds < 60 {
        return format!("{seconds}s");
    }
    format!("{}m {:02}s", seconds / 60, seconds % 60)
}

fn readable_content(value: &Value) -> String {
    if let Some(value) = value.as_str() {
        return value.trim().to_string();
    }
    for key in [
        "text",
        "message",
        "output",
        "diff",
        "patch",
        "reasoning",
        "result",
        "error",
        "command",
        "title",
        "url",
        "status",
    ] {
        if let Some(value) = value.get(key).and_then(Value::as_str) {
            if !value.trim().is_empty() {
                return value.trim().to_string();
            }
        }
    }
    String::new()
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use taskforceai_app_protocol::{TaskMode, ThreadState};

    use super::*;

    fn line_text(line: Line<'_>) -> String {
        line.spans
            .into_iter()
            .map(|span| span.content.into_owned())
            .collect()
    }

    fn item(
        id: &str,
        item_type: ThreadItemType,
        status: ThreadItemStatus,
        content: Value,
    ) -> ThreadItemRecord {
        ThreadItemRecord {
            id: id.to_string(),
            turn_id: "turn".to_string(),
            item_type,
            status,
            content,
            created_at: 1,
            updated_at: 62,
        }
    }

    #[test]
    fn code_timeline_replaces_generic_labels_with_inline_activity() {
        let thread = ThreadRecord {
            id: "thread".into(),
            title: "Ship TUI parity".into(),
            objective: "Update Code mode".into(),
            state: ThreadState::Active,
            archived: false,
            source: "test".into(),
            task_mode: TaskMode::Code,
            parent_thread_id: None,
            turns: vec![TurnRecord {
                id: "turn".into(),
                thread_id: "thread".into(),
                run_id: "run".into(),
                status: TurnStatus::Completed,
                items: vec![
                    item(
                        "user",
                        ThreadItemType::UserMessage,
                        ThreadItemStatus::Completed,
                        json!({"text":"Make Code mode compact"}),
                    ),
                    item(
                        "reasoning",
                        ThreadItemType::Reasoning,
                        ThreadItemStatus::Completed,
                        json!({"reasoning":"Tracing the renderer"}),
                    ),
                    item(
                        "edit",
                        ThreadItemType::ToolCall,
                        ThreadItemStatus::Completed,
                        json!({"toolName":"apply_patch"}),
                    ),
                    item(
                        "read",
                        ThreadItemType::ToolCall,
                        ThreadItemStatus::Completed,
                        json!({"tool":"read_file"}),
                    ),
                    item(
                        "run",
                        ThreadItemType::ToolCall,
                        ThreadItemStatus::Completed,
                        json!({"command":"cargo test"}),
                    ),
                    item(
                        "agent",
                        ThreadItemType::AgentMessage,
                        ThreadItemStatus::Completed,
                        json!({"text":"The focused tests pass."}),
                    ),
                ],
                created_at: 1,
                updated_at: 62,
            }],
            created_at: 1,
            updated_at: 62,
        };

        let rendered = code_thread_detail_lines(&thread)
            .into_iter()
            .map(line_text)
            .collect::<Vec<_>>();

        assert!(rendered
            .iter()
            .any(|line| line == "> Make Code mode compact"));
        assert!(rendered.iter().any(|line| line == "• Tracing the renderer"));
        assert!(rendered
            .iter()
            .any(|line| line == "  Edited 1 file, read 1 file, ran 1 command"));
        assert!(rendered
            .iter()
            .any(|line| line == "• The focused tests pass."));

        let hidden = code_thread_detail_lines_with_tool_details(&thread, false, false, 0)
            .into_iter()
            .map(line_text)
            .collect::<Vec<_>>();
        assert!(!hidden
            .iter()
            .any(|line| line.contains("Tracing the renderer")));
        assert!(rendered.iter().any(|line| line == "* Worked for 1m 01s"));
        assert!(!rendered.iter().any(|line| line.starts_with("Turn ")));
        assert!(!rendered.iter().any(|line| line == "TaskForceAI"));

        let expanded = code_thread_detail_lines_with_tool_details(&thread, true, true, 0)
            .into_iter()
            .map(line_text)
            .collect::<Vec<_>>();
        assert!(expanded.iter().any(|line| line.contains("1. Edit")));
        assert!(expanded.iter().any(|line| line.contains("2. Read")));
        assert!(expanded.iter().any(|line| line.contains("3. Run")));
        assert!(!expanded.iter().any(|line| line.contains("\"toolName\"")));
        assert!(expanded.iter().any(|line| line.contains("cargo test")));
    }

    #[test]
    fn legacy_enriched_prompts_render_only_the_original_user_request() {
        let legacy = "Planning mode is enabled for this turn. Analyze only.\n\nUser request:\nYou are operating in TaskForceAI Code mode with these working-directory roots:\n- `/workspace`\n\nUser request:\n<project_instructions>\n<instructions_file path=\"/workspace/AGENTS.md\">\ninternal rules\n</instructions_file>\n</project_instructions>\n\nUse the following selected skills for this request. Follow their instructions when they apply.\n<skills>\n<skill name=\"game\" path=\"/skill\">\nskill rules\n</skill>\n</skills>\n\nBuild a game\n\n<workspace_file path=\"src/game.rs\">\nsource\n</workspace_file>";

        assert_eq!(legacy_visible_user_input(legacy), "Build a game");
        assert_eq!(legacy_visible_user_input("Build a game"), "Build a game");
    }

    #[test]
    fn summaries_cover_plural_unknown_running_and_failure_states() {
        let tools = vec![
            item(
                "edit-1",
                ThreadItemType::ToolCall,
                ThreadItemStatus::Completed,
                json!({"name":"write_file"}),
            ),
            item(
                "edit-2",
                ThreadItemType::ToolCall,
                ThreadItemStatus::Completed,
                json!({"name":"rename_file"}),
            ),
            item(
                "other",
                ThreadItemType::ToolCall,
                ThreadItemStatus::InProgress,
                json!({"name":"custom_tool"}),
            ),
        ];
        assert_eq!(
            line_text(tool_summary_line(&tools, false, 0)),
            "⠋ Calling custom_tool · running"
        );

        let failed = vec![item(
            "failed",
            ThreadItemType::ToolCall,
            ThreadItemStatus::Failed,
            json!({"toolName":"shell_command"}),
        )];
        assert_eq!(
            line_text(tool_summary_line(&failed, false, 0)),
            "! Ran 1 command · failed"
        );
    }

    #[test]
    fn empty_thread_and_non_tool_items_have_clear_fallbacks() {
        let thread = ThreadRecord {
            id: "thread".into(),
            title: "Waiting".into(),
            objective: "Inspect the workspace".into(),
            state: ThreadState::Active,
            archived: false,
            source: "test".into(),
            task_mode: TaskMode::Code,
            parent_thread_id: None,
            turns: Vec::new(),
            created_at: 1,
            updated_at: 1,
        };
        let rendered = code_thread_detail_lines(&thread)
            .into_iter()
            .map(line_text)
            .collect::<Vec<_>>();
        assert!(rendered
            .iter()
            .any(|line| line == "> Inspect the workspace"));
        assert!(rendered
            .iter()
            .any(|line| line == "* Waiting for code activity"));

        assert!(readable_content(&json!({"text":null,"error":null})).is_empty());
        assert_eq!(elapsed_label(9), "9s");
        assert_eq!(tool_summary(ToolCounts::default()), "Working");

        let status = item(
            "status",
            ThreadItemType::AgentStatus,
            ThreadItemStatus::InProgress,
            json!({"status":"Reviewing changes"}),
        );
        assert_eq!(
            code_item_lines(&status, false)
                .into_iter()
                .map(line_text)
                .collect::<Vec<_>>(),
            vec!["• Reviewing changes"]
        );
        let tool = item(
            "tool",
            ThreadItemType::ToolCall,
            ThreadItemStatus::Completed,
            json!({"toolName":"read_file"}),
        );
        assert!(code_item_lines(&tool, true).is_empty());
    }

    #[test]
    fn timeline_helpers_cover_every_activity_shape_and_status() {
        for (index, item_type) in [
            ThreadItemType::UserMessage,
            ThreadItemType::SteeringMessage,
            ThreadItemType::AgentMessage,
            ThreadItemType::Reasoning,
            ThreadItemType::Plan,
            ThreadItemType::Compaction,
            ThreadItemType::AgentStatus,
            ThreadItemType::Approval,
            ThreadItemType::Source,
            ThreadItemType::Error,
            ThreadItemType::CommandExecution,
            ThreadItemType::FileChange,
        ]
        .into_iter()
        .enumerate()
        {
            let value = if index == 0 {
                json!("")
            } else {
                json!({"text":"detail"})
            };
            let _ = code_item_lines(
                &item("shape", item_type, ThreadItemStatus::Completed, value),
                false,
            );
        }

        let run = item(
            "run",
            ThreadItemType::ToolCall,
            ThreadItemStatus::Completed,
            json!({
                "command":"cargo test", "cwd":"/tmp", "stdout":"out", "stderr":"err",
                "exitCode":0
            }),
        );
        let failed_run = item(
            "failed-run",
            ThreadItemType::CommandExecution,
            ThreadItemStatus::Failed,
            json!({"cmd":"false", "output":"out", "exit_code":1}),
        );
        let edit = item(
            "edit",
            ThreadItemType::ToolCall,
            ThreadItemStatus::Completed,
            json!({"name":"edit_file", "path":"src/lib.rs", "diff":"--- a\n+++ b\n-old\n+new"}),
        );
        let edit_output = item(
            "edit-output",
            ThreadItemType::FileChange,
            ThreadItemStatus::Declined,
            json!({"file":"src/main.rs", "output":"unchanged"}),
        );
        let explore = item(
            "explore",
            ThreadItemType::ToolCall,
            ThreadItemStatus::InProgress,
            json!({"tool":"read_file", "input":{"path":"README.md"}, "result":"contents"}),
        );
        let other = item(
            "other",
            ThreadItemType::ToolCall,
            ThreadItemStatus::Completed,
            json!({"tool":"custom", "url":"https://example.com", "message":"done"}),
        );
        for (ordinal, tool) in [&run, &edit, &explore, &other].into_iter().enumerate() {
            let _ = active_tool_summary(tool);
            assert!(!tool_detail_lines(tool, ordinal + 1).is_empty());
        }
        assert!(!command_activity_lines(&failed_run, None).is_empty());
        assert!(!file_change_lines(&edit_output, None).is_empty());
        assert_eq!(diff_stat("context only"), "");

        let long = (0..30)
            .map(|index| format!("line {index}"))
            .collect::<Vec<_>>()
            .join("\n");
        assert!(output_block(&long, text(), 2)
            .iter()
            .any(|line| line_text(line.clone()).contains("truncated")));
        assert!(labeled_output_block("result", &long, text(), 2)
            .iter()
            .any(|line| line_text(line.clone()).contains("truncated")));
        assert_eq!(truncate("abcdef", 3), "abc…");
        assert_eq!(truncate("abc", 3), "abc");
        assert_eq!(
            string_field(&json!({"args":{"title":" nested "}}), &["title"]),
            Some("nested")
        );
        assert_eq!(integer_field(&json!({"code":7}), &["code"]), Some(7));

        let counts = tool_counts(&[edit.clone(), explore.clone(), run.clone(), other.clone()]);
        assert_eq!(
            tool_summary(counts),
            "Edited 1 file, read 1 file, ran 1 command, used 1 tool"
        );
        assert_eq!(plural(2, "tool"), "tools");

        for status in [
            TurnStatus::Queued,
            TurnStatus::InProgress,
            TurnStatus::Completed,
            TurnStatus::Failed,
            TurnStatus::Interrupted,
        ] {
            let turn = TurnRecord {
                id: "turn".into(),
                thread_id: "thread".into(),
                run_id: "run".into(),
                status,
                items: Vec::new(),
                created_at: 10,
                updated_at: 10,
            };
            assert!(!line_text(turn_status_line(&turn, 1)).is_empty());
        }
        assert!(!optimistic_submission_lines("ship it", 2).is_empty());

        assert_eq!(readable_content(&json!(" value ")), "value");
        assert!(narrative_lines("", text(), false).is_empty());
        for key in [
            "message",
            "output",
            "diff",
            "patch",
            "reasoning",
            "result",
            "error",
            "command",
            "title",
            "url",
            "status",
        ] {
            assert_eq!(readable_content(&json!({key:" value "})), "value");
        }
    }
}
