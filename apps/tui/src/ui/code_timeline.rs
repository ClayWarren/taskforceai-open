use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use serde_json::Value;
use taskforceai_app_protocol::{
    ThreadItemRecord, ThreadItemStatus, ThreadItemType, ThreadRecord, TurnRecord, TurnStatus,
};

use super::style::{ACCENT, ACTION, DANGER, PANEL_ALT, TEXT, TEXT_FAINT, TEXT_MUTED, WARN};

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

pub(super) fn code_thread_detail_lines(thread: &ThreadRecord) -> Vec<Line<'static>> {
    let mut lines = vec![
        Line::from(vec![
            Span::styled(
                thread.title.clone(),
                Style::default().fg(TEXT).add_modifier(Modifier::BOLD),
            ),
            Span::styled("  code", Style::default().fg(ACCENT)),
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
            Style::default().fg(TEXT_FAINT),
        ));
        return lines;
    }

    for turn in &thread.turns {
        lines.extend(code_turn_lines(turn));
        lines.push(Line::raw(""));
    }
    lines
}

fn code_turn_lines(turn: &TurnRecord) -> Vec<Line<'static>> {
    let mut lines = Vec::new();
    let has_tools = turn
        .items
        .iter()
        .any(|item| item.item_type == ThreadItemType::ToolCall);
    let mut index = 0;

    while index < turn.items.len() {
        let item = &turn.items[index];
        if item.item_type == ThreadItemType::ToolCall {
            let start = index;
            while index < turn.items.len()
                && turn.items[index].item_type == ThreadItemType::ToolCall
            {
                index += 1;
            }
            lines.push(tool_summary_line(&turn.items[start..index]));
            continue;
        }

        lines.extend(code_item_lines(item, has_tools));
        index += 1;
    }

    lines.push(turn_status_line(turn));
    lines
}

fn code_item_lines(item: &ThreadItemRecord, has_tools: bool) -> Vec<Line<'static>> {
    let content = readable_content(&item.content);
    match item.item_type {
        ThreadItemType::UserMessage | ThreadItemType::SteeringMessage => {
            if content.is_empty() {
                Vec::new()
            } else {
                prompt_lines(&content)
            }
        }
        ThreadItemType::AgentMessage => narrative_lines(&content, TEXT, false),
        ThreadItemType::Reasoning => narrative_lines(&content, TEXT_MUTED, true),
        ThreadItemType::AgentStatus if !has_tools => narrative_lines(&content, TEXT_MUTED, false),
        ThreadItemType::AgentStatus => Vec::new(),
        ThreadItemType::Approval => labeled_lines("! Approval", &content, WARN),
        ThreadItemType::Source => labeled_lines("  Source", &content, ACTION),
        ThreadItemType::Error => labeled_lines("! Error", &content, DANGER),
        ThreadItemType::ToolCall => Vec::new(),
    }
}

fn prompt_lines(content: &str) -> Vec<Line<'static>> {
    content
        .lines()
        .enumerate()
        .map(|(index, line)| {
            Line::from(vec![
                Span::styled(
                    if index == 0 { "> " } else { "  " },
                    Style::default().fg(ACCENT).bg(PANEL_ALT),
                ),
                Span::styled(
                    line.to_string(),
                    Style::default()
                        .fg(TEXT)
                        .bg(PANEL_ALT)
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
    content
        .lines()
        .enumerate()
        .map(|(index, line)| {
            let mut style = Style::default().fg(color);
            if italic {
                style = style.add_modifier(Modifier::ITALIC);
            }
            Line::from(vec![
                Span::styled(if index == 0 { "• " } else { "  " }, style),
                Span::styled(line.to_string(), style),
            ])
        })
        .collect()
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
                .map(|line| Line::styled(format!("  {line}"), Style::default().fg(TEXT))),
        );
    }
    lines
}

fn tool_summary_line(items: &[ThreadItemRecord]) -> Line<'static> {
    let counts = tool_counts(items);
    let summary = tool_summary(counts);
    let failed = items
        .iter()
        .any(|item| item.status == ThreadItemStatus::Failed);
    let running = items
        .iter()
        .any(|item| item.status == ThreadItemStatus::InProgress);
    let (marker, color, suffix) = if failed {
        ("! ", DANGER, " · failed")
    } else if running {
        ("◦ ", WARN, " · running")
    } else {
        ("  ", TEXT_MUTED, "")
    };
    Line::from(vec![
        Span::styled(marker, Style::default().fg(color)),
        Span::styled(summary, Style::default().fg(TEXT_MUTED)),
        Span::styled(suffix, Style::default().fg(color)),
    ])
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
    if content.get("command").and_then(Value::as_str).is_some() {
        return ToolKind::Run;
    }
    let name = ["toolName", "tool_name", "name", "tool", "title"]
        .into_iter()
        .find_map(|key| content.get(key).and_then(Value::as_str))
        .unwrap_or_default()
        .to_ascii_lowercase();
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

fn turn_status_line(turn: &TurnRecord) -> Line<'static> {
    let elapsed = turn.updated_at.saturating_sub(turn.created_at);
    let duration = (elapsed > 0).then(|| format!(" for {}", elapsed_label(elapsed)));
    let duration = duration.unwrap_or_default();
    let (label, color) = match turn.status {
        TurnStatus::Queued => ("* Queued".to_string(), TEXT_FAINT),
        TurnStatus::InProgress => (format!("* Working{duration}"), WARN),
        TurnStatus::Completed => (format!("* Worked{duration}"), TEXT_FAINT),
        TurnStatus::Failed => (format!("! Failed{duration}"), DANGER),
        TurnStatus::Interrupted => (format!("- Interrupted{duration}"), WARN),
    };
    Line::styled(label, Style::default().fg(color))
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
        assert!(rendered.iter().any(|line| line == "* Worked for 1m 01s"));
        assert!(!rendered.iter().any(|line| line.starts_with("Turn ")));
        assert!(!rendered.iter().any(|line| line == "TaskForceAI"));
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
            line_text(tool_summary_line(&tools)),
            "◦ Edited 2 files, used 1 tool · running"
        );

        let failed = vec![item(
            "failed",
            ThreadItemType::ToolCall,
            ThreadItemStatus::Failed,
            json!({"toolName":"shell_command"}),
        )];
        assert_eq!(
            line_text(tool_summary_line(&failed)),
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
}
