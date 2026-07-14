use std::borrow::Cow;

use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{List, ListItem, Padding, Paragraph, Wrap};
use ratatui::Frame;
use serde_json::Value;
use taskforceai_app_protocol::{
    RunRecord, RunStatus, ThreadItemRecord, ThreadItemStatus, ThreadItemType, ThreadRecord,
    TurnStatus,
};

use crate::app::format::format_generated_media_output;
use crate::state::{AppState, FocusArea};

mod selectors;

use self::selectors::command_palette_lines;
pub(super) use self::selectors::{
    command_palette_scroll, model_selector_lines, model_selector_scroll,
};

use super::layout::{run_chunks, run_scroll_offset};
use super::style::{
    panel_block, ACCENT, ACTION, BG, BORDER_FOCUS, DANGER, OK, PANEL_ALT, TEXT, TEXT_FAINT,
    TEXT_MUTED, WARN,
};

pub(super) fn render_runs(frame: &mut Frame<'_>, area: Rect, state: &AppState) {
    let chunks = run_chunks(area, state.sidebar_collapsed);
    let visible_rows = usize::from(chunks[0].height.saturating_sub(2));
    let scroll_offset = run_scroll_offset(frame.area(), state);

    if !state.sidebar_collapsed {
        let items = if state.runs.is_empty() {
            vec![ListItem::new(
                "No conversations yet. Type a prompt and press Enter.",
            )]
        } else {
            state
                .runs
                .iter()
                .skip(scroll_offset)
                .take(visible_rows)
                .map(|run| run_item(run, state.selected_run_id() == Some(run.id.as_str())))
                .collect()
        };
        frame.render_widget(
            List::new(items)
                .style(Style::default().fg(TEXT))
                .block(panel_block(
                    " CONVERSATIONS ",
                    state.focus == FocusArea::Runs,
                )),
            chunks[0],
        );
    }
    render_run_detail(frame, chunks[1], state);
}

fn render_run_detail(frame: &mut Frame<'_>, area: Rect, state: &AppState) {
    let (title, lines, scroll) = if state.model_selector_active() {
        (
            " MODELS ",
            model_selector_lines(state),
            model_selector_scroll(area, state),
        )
    } else if state.file_suggestions_active() {
        (
            " FILES ",
            file_suggestion_lines(state),
            file_suggestion_scroll(area, state),
        )
    } else if state.command_suggestions_active() {
        (
            " COMMANDS ",
            command_palette_lines(state),
            command_palette_scroll(area, state),
        )
    } else if let Some(command_output) = &state.command_output {
        let lines = command_output
            .lines()
            .enumerate()
            .map(|(index, line)| {
                if index == 0 {
                    Line::styled(
                        line,
                        Style::default().fg(ACCENT).add_modifier(Modifier::BOLD),
                    )
                } else {
                    Line::styled(line, Style::default().fg(TEXT))
                }
            })
            .collect::<Vec<_>>();
        (" DETAILS ", lines, state.detail_scroll_offset)
    } else if let Some(thread) = state.active_thread() {
        (
            " TASK ",
            thread_detail_lines(thread),
            state.detail_scroll_offset,
        )
    } else if let Some(run) = state.selected_run() {
        (
            " CONVERSATION ",
            run_detail_lines(run),
            state.detail_scroll_offset,
        )
    } else {
        (
            " CONVERSATION ",
            vec![Line::from("No selected conversation.")],
            0,
        )
    };

    frame.render_widget(
        Paragraph::new(lines)
            .scroll((scroll, 0))
            .style(Style::default().fg(TEXT))
            .wrap(Wrap { trim: false })
            .block(panel_block(title, false).padding(Padding::horizontal(1))),
        area,
    );
}

fn file_suggestion_lines(state: &AppState) -> Vec<Line<'_>> {
    let mut lines = vec![Line::from(vec![
        Span::styled(
            "Workspace files",
            Style::default().fg(ACCENT).add_modifier(Modifier::BOLD),
        ),
        Span::styled("  Enter inserts mention", Style::default().fg(TEXT_FAINT)),
    ])];
    for (index, path) in state.file_suggestions.iter().enumerate() {
        let selected = state.selected_file_suggestion == Some(index);
        let style = if selected {
            Style::default()
                .fg(BG)
                .bg(BORDER_FOCUS)
                .add_modifier(Modifier::BOLD)
        } else {
            Style::default().fg(TEXT)
        };
        lines.push(Line::from(vec![
            Span::styled(
                if selected { "> " } else { "  " },
                Style::default().fg(ACCENT),
            ),
            Span::styled(path.clone(), style),
        ]));
    }
    lines
}

fn file_suggestion_scroll(area: Rect, state: &AppState) -> u16 {
    let visible = usize::from(area.height.saturating_sub(2)).max(1);
    state
        .selected_file_suggestion
        .unwrap_or(0)
        .saturating_sub(visible.saturating_sub(2))
        .min(usize::from(u16::MAX)) as u16
}

pub(super) fn thread_detail_lines(thread: &ThreadRecord) -> Vec<Line<'_>> {
    if thread.task_mode == taskforceai_app_protocol::TaskMode::Code {
        return super::code_timeline::code_thread_detail_lines(thread);
    }

    let mut lines = vec![
        Line::from(vec![
            Span::styled(
                thread.title.clone(),
                Style::default().fg(TEXT).add_modifier(Modifier::BOLD),
            ),
            Span::raw("  "),
            Span::styled(
                format!("{:?}", thread.state).to_ascii_lowercase(),
                Style::default().fg(ACCENT),
            ),
        ]),
        Line::styled(thread.objective.clone(), Style::default().fg(TEXT_MUTED)),
        Line::raw(""),
    ];
    for turn in &thread.turns {
        let turn_style = match turn.status {
            TurnStatus::Completed => Style::default().fg(OK),
            TurnStatus::Failed => Style::default().fg(DANGER),
            TurnStatus::Interrupted => Style::default().fg(WARN),
            TurnStatus::Queued | TurnStatus::InProgress => Style::default().fg(ACCENT),
        };
        lines.push(Line::from(vec![
            Span::styled("Turn ", Style::default().fg(TEXT_FAINT)),
            Span::styled(
                format!("{:?}", turn.status).to_ascii_lowercase(),
                turn_style.add_modifier(Modifier::BOLD),
            ),
        ]));
        for item in &turn.items {
            lines.extend(thread_item_lines(item));
        }
        lines.push(Line::raw(""));
    }
    if thread.turns.is_empty() {
        lines.push(Line::styled(
            "Waiting for task activity",
            Style::default().fg(TEXT_FAINT),
        ));
    }
    lines
}

fn thread_item_lines(item: &ThreadItemRecord) -> Vec<Line<'_>> {
    let (label, color) = match item.item_type {
        ThreadItemType::UserMessage => ("You", ACCENT),
        ThreadItemType::AgentMessage => ("TaskForceAI", TEXT),
        ThreadItemType::Reasoning => ("Reasoning", TEXT_MUTED),
        ThreadItemType::ToolCall => ("Tool", WARN),
        ThreadItemType::Approval => ("Approval", WARN),
        ThreadItemType::Source => ("Source", ACTION),
        ThreadItemType::AgentStatus => ("Agent", ACCENT),
        ThreadItemType::Error => ("Error", DANGER),
        ThreadItemType::SteeringMessage => ("Steer", ACTION),
    };
    let status = match item.status {
        ThreadItemStatus::InProgress => " · running",
        ThreadItemStatus::Completed => "",
        ThreadItemStatus::Failed => " · failed",
        ThreadItemStatus::Declined => " · declined",
    };
    let mut lines = vec![Line::from(vec![
        Span::styled(
            label,
            Style::default().fg(color).add_modifier(Modifier::BOLD),
        ),
        Span::styled(status, Style::default().fg(TEXT_FAINT)),
    ])];
    let content = readable_item_content(&item.content);
    if !content.is_empty() {
        lines.extend(
            content
                .lines()
                .map(|line| Line::styled(format!("  {line}"), Style::default().fg(TEXT))),
        );
    }
    lines
}

fn readable_item_content(value: &Value) -> String {
    if let Some(value) = value.as_str() {
        return value.to_string();
    }
    for key in ["text", "message", "output", "command", "title", "url"] {
        if let Some(value) = value.get(key).and_then(Value::as_str) {
            return value.to_string();
        }
    }
    serde_json::to_string_pretty(value).unwrap_or_else(|_| value.to_string())
}

pub(super) fn run_detail_lines(run: &RunRecord) -> Vec<Line<'_>> {
    let mut lines = vec![
        Line::from(vec![
            Span::styled(
                "Conversation",
                Style::default().fg(TEXT).add_modifier(Modifier::BOLD),
            ),
            Span::raw(" "),
            Span::styled(status_label(&run.status), status_style(&run.status)),
        ]),
        Line::raw(""),
        Line::from(vec![Span::styled(
            "Prompt",
            Style::default().fg(ACCENT).add_modifier(Modifier::BOLD),
        )]),
    ];
    lines.extend(styled_text_lines(&run.prompt, Style::default().fg(TEXT)));
    lines.push(Line::raw(""));
    lines.push(Line::from(vec![Span::styled(
        "Response",
        Style::default().fg(ACCENT).add_modifier(Modifier::BOLD),
    )]));
    let output = run
        .output
        .as_ref()
        .map(|output| format_generated_media_output(output))
        .unwrap_or(Cow::Borrowed("Waiting for output"));
    lines.extend(styled_text_lines(&output, Style::default().fg(TEXT)));

    if let Some(error) = &run.error {
        lines.push(Line::from(vec![
            Span::styled(
                "Error",
                Style::default().fg(DANGER).add_modifier(Modifier::BOLD),
            ),
            Span::raw(" "),
            Span::styled(error.as_str(), Style::default().fg(DANGER)),
        ]));
    }

    if !run.sources.is_empty() {
        lines.push(Line::from(vec![
            Span::styled("Sources ", Style::default().fg(TEXT_FAINT)),
            Span::styled(
                format_records(&run.sources),
                Style::default().fg(TEXT_MUTED),
            ),
        ]));
    }
    if !run.tool_events.is_empty() {
        lines.push(Line::from(vec![
            Span::styled("Tools ", Style::default().fg(TEXT_FAINT)),
            Span::styled(
                format_records(&run.tool_events),
                Style::default().fg(TEXT_MUTED),
            ),
        ]));
    }
    if !run.agent_statuses.is_empty() {
        lines.push(Line::from(vec![
            Span::styled("Agents ", Style::default().fg(TEXT_FAINT)),
            Span::styled(
                format_records(&run.agent_statuses),
                Style::default().fg(TEXT_MUTED),
            ),
        ]));
    }
    if let Some(approval) = &run.pending_approval {
        lines.push(Line::from(vec![
            Span::styled("Approval ", Style::default().fg(WARN)),
            Span::styled(format_record(approval), Style::default().fg(WARN)),
        ]));
    }

    lines
}

fn styled_text_lines(value: &str, style: Style) -> Vec<Line<'static>> {
    value
        .split('\n')
        .map(|line| Line::styled(line.to_string(), style))
        .collect()
}

fn run_item(run: &RunRecord, selected: bool) -> ListItem<'_> {
    ListItem::new(run_item_line(run, selected)).style(run_item_style(selected))
}

fn run_item_line(run: &RunRecord, selected: bool) -> Line<'_> {
    let marker = if selected { "> " } else { "  " };
    let title = preview(&conversation_title(run), 40).into_owned();
    let snippet = conversation_snippet(run, 36);
    let mut spans = vec![
        Span::styled(marker, Style::default().fg(WARN)),
        Span::styled(status_bullet(&run.status), status_style(&run.status)),
        Span::raw(" "),
        Span::styled(
            title,
            Style::default()
                .fg(if selected { TEXT } else { TEXT_MUTED })
                .add_modifier(Modifier::BOLD),
        ),
    ];
    if let Some(snippet) = snippet {
        spans.push(Span::styled("  ", Style::default().fg(TEXT_FAINT)));
        spans.push(Span::styled(snippet, Style::default().fg(TEXT_FAINT)));
    }
    Line::from(spans)
}

fn run_item_style(selected: bool) -> Style {
    if selected {
        Style::default()
            .fg(TEXT)
            .bg(PANEL_ALT)
            .add_modifier(Modifier::BOLD)
    } else {
        Style::default().fg(TEXT_MUTED)
    }
}

fn conversation_title(run: &RunRecord) -> Cow<'_, str> {
    let title = run.prompt.trim();
    if title.is_empty() {
        Cow::Borrowed("Untitled conversation")
    } else {
        Cow::Borrowed(title)
    }
}

fn conversation_snippet(run: &RunRecord, max_chars: usize) -> Option<String> {
    if let Some(error) = &run.error {
        let error = error.trim();
        if !error.is_empty() {
            return Some(format!("Error: {}", preview(error, max_chars)));
        }
    }

    if let Some(output) = &run.output {
        let output = format_generated_media_output(output);
        let output = output.trim();
        if !output.is_empty() && output != run.prompt.trim() {
            return Some(preview(output, max_chars).into_owned());
        }
    }

    None
}

fn status_label(status: &RunStatus) -> &'static str {
    match status {
        RunStatus::Queued => "queued",
        RunStatus::Processing => "processing",
        RunStatus::Completed => "completed",
        RunStatus::Failed => "failed",
        RunStatus::Canceled => "canceled",
    }
}

fn status_bullet(status: &RunStatus) -> &'static str {
    match status {
        RunStatus::Queued => "[~]",
        RunStatus::Processing => "[>]",
        RunStatus::Completed => "[+]",
        RunStatus::Failed => "[!]",
        RunStatus::Canceled => "[-]",
    }
}

fn status_style(status: &RunStatus) -> Style {
    match status {
        RunStatus::Queued => Style::default().fg(ACTION),
        RunStatus::Processing => Style::default().fg(WARN),
        RunStatus::Completed => Style::default().fg(OK),
        RunStatus::Failed => Style::default().fg(DANGER),
        RunStatus::Canceled => Style::default().fg(TEXT_FAINT),
    }
}

fn preview(value: &str, max_chars: usize) -> Cow<'_, str> {
    let mut chars = value.chars();
    let mut output = chars.by_ref().take(max_chars).collect::<String>();
    if chars.next().is_some() {
        output.push_str("...");
        Cow::Owned(output)
    } else {
        Cow::Borrowed(value)
    }
}

pub(super) fn format_records(records: &[Value]) -> String {
    let mut rendered = String::new();
    for (index, record) in records.iter().enumerate() {
        if index > 0 {
            rendered.push_str(", ");
        }
        rendered.push_str(&format_record(record));
    }
    rendered
}

fn format_record(record: &Value) -> Cow<'_, str> {
    if let Some(object) = record.as_object() {
        for key in [
            "title",
            "label",
            "name",
            "toolName",
            "tool",
            "agentName",
            "status",
            "url",
            "permission",
        ] {
            if let Some(value) = object.get(key).and_then(Value::as_str) {
                return Cow::Borrowed(value);
            }
        }
    }

    if let Some(value) = record.as_str() {
        return Cow::Borrowed(value);
    }

    Cow::Owned(record.to_string())
}

#[cfg(test)]
mod tests {
    use std::hint::black_box;
    use std::time::Instant;

    use ratatui::backend::TestBackend;
    use ratatui::layout::Rect;
    use ratatui::text::Line;
    use ratatui::Terminal;
    use serde_json::json;
    use taskforceai_app_protocol::{
        ModelListResult, ModelOptionRecord, RunRecord, RunStatus, TaskMode, ThreadItemRecord,
        ThreadItemStatus, ThreadItemType, ThreadRecord, ThreadState, TurnRecord, TurnStatus,
    };

    use super::{
        conversation_snippet, conversation_title, preview, render_runs, run_detail_lines, run_item,
        run_item_line, status_bullet, status_label, status_style, thread_detail_lines,
    };
    use crate::state::{AppState, UiAction};
    use crate::test_support::initialized_default_capabilities;

    #[test]
    fn status_helpers_cover_all_run_states() {
        let cases = [
            (RunStatus::Queued, "queued", "[~]"),
            (RunStatus::Processing, "processing", "[>]"),
            (RunStatus::Completed, "completed", "[+]"),
            (RunStatus::Failed, "failed", "[!]"),
            (RunStatus::Canceled, "canceled", "[-]"),
        ];

        for (status, label, bullet) in cases {
            assert_eq!(status_label(&status), label);
            assert_eq!(status_bullet(&status), bullet);
            let _style = status_style(&status);
        }
    }

    #[test]
    fn run_item_covers_unselected_rows_and_output_preview() {
        let statuses = [
            RunStatus::Queued,
            RunStatus::Processing,
            RunStatus::Completed,
            RunStatus::Failed,
            RunStatus::Canceled,
        ];

        for (index, status) in statuses.into_iter().enumerate() {
            let mut run = bench_run(index);
            run.status = status;
            run.output = Some("visible output".to_string());
            let _item = run_item(&run, false);
        }
    }

    #[test]
    fn run_item_line_uses_conversation_preview_without_run_id() {
        let mut run = bench_run(42);
        run.id = "local_run_42".to_string();
        run.prompt = "Plan the mobile sidebar parity work".to_string();
        run.output = Some("Use compact conversation previews".to_string());

        let rendered = line_text(run_item_line(&run, true));

        assert!(rendered.contains("Plan the mobile sidebar parity work"));
        assert!(rendered.contains("Use compact conversation previews"));
        assert!(!rendered.contains("local_run_42"));
    }

    #[test]
    fn conversation_preview_covers_empty_title_error_and_echo_output() {
        let mut untitled = bench_run(1);
        untitled.prompt = "   ".to_string();
        assert_eq!(conversation_title(&untitled), "Untitled conversation");

        let mut error_run = bench_run(2);
        error_run.output = None;
        error_run.error = Some(" backend unavailable ".to_string());
        assert_eq!(
            conversation_snippet(&error_run, 40).as_deref(),
            Some("Error: backend unavailable")
        );

        let mut empty_error_run = bench_run(4);
        empty_error_run.output = None;
        empty_error_run.error = Some("   ".to_string());
        assert_eq!(conversation_snippet(&empty_error_run, 40), None);

        let mut echoed_run = bench_run(3);
        echoed_run.prompt = "repeat this".to_string();
        echoed_run.output = Some(" repeat this ".to_string());
        echoed_run.error = None;
        assert_eq!(conversation_snippet(&echoed_run, 40), None);
    }

    #[test]
    fn preview_truncates_on_character_boundaries() {
        assert_eq!(preview("short", 10), "short");
        assert_eq!(preview("abcdef", 3), "abc...");
        assert_eq!(preview("áβçd", 3), "áβç...");
    }

    fn line_text(line: Line<'_>) -> String {
        line.spans
            .into_iter()
            .map(|span| span.content.into_owned())
            .collect::<String>()
    }

    fn bench_run(index: usize) -> RunRecord {
        RunRecord {
            id: format!("run-{index:04}-abcdefghijklmnopqrstuvwxyz"),
            prompt: format!("Investigate customer workflow regression number {index}"),
            model_id: None,
            project_id: None,
            status: RunStatus::Processing,
            output: Some(format!(
                "Detailed response for run {index} with enough text to require preview truncation"
            )),
            error: None,
            created_at: 1_720_000_000,
            updated_at: 1_720_000_100,
            tool_events: vec![json!({"toolName":"search","status":"completed"})],
            sources: vec![json!({"title":"Runbook","url":"https://example.test/runbook"})],
            agent_statuses: vec![json!({"agentName":"Research","status":"working"})],
            pending_approval: Some(json!({"permission":"mcp","agentName":"Research"})),
        }
    }

    fn model_list() -> ModelListResult {
        ModelListResult {
            enabled: true,
            options: vec![
                ModelOptionRecord {
                    id: "sentinel".to_string(),
                    label: "Sentinel".to_string(),
                    badge: "default".to_string(),
                    description: Some("Default model".to_string()),
                    usage_multiple: Some(1.0),
                    reasoning_effort_levels: Vec::new(),
                    default_reasoning_effort: None,
                },
                ModelOptionRecord {
                    id: "gpt-5".to_string(),
                    label: "GPT-5".to_string(),
                    badge: "deep".to_string(),
                    description: Some("".to_string()),
                    usage_multiple: Some(2.25),
                    reasoning_effort_levels: Vec::new(),
                    default_reasoning_effort: None,
                },
            ],
            default_model_id: "sentinel".to_string(),
            selected_model_id: Some("sentinel".to_string()),
            remote_catalog: true,
        }
    }

    #[test]
    fn render_runs_draws_empty_details_commands_and_model_selector() {
        let area = Rect::new(0, 0, 120, 20);
        let backend = TestBackend::new(120, 20);
        let mut terminal = Terminal::new(backend).expect("terminal");

        let empty = AppState::new(initialized_default_capabilities(), Vec::new());
        terminal
            .draw(|frame| render_runs(frame, area, &empty))
            .expect("empty runs should render");

        let selected = AppState::new(
            initialized_default_capabilities(),
            vec![bench_run(1), bench_run(2)],
        );
        terminal
            .draw(|frame| render_runs(frame, area, &selected))
            .expect("selected run should render");

        let mut collapsed = selected.clone();
        collapsed.apply(UiAction::ToggleSidebar);
        terminal
            .draw(|frame| render_runs(frame, area, &collapsed))
            .expect("collapsed sidebar should render");

        let mut command_output = selected.clone();
        command_output.apply(UiAction::CommandOutputDisplayed {
            title: "Status".to_string(),
            message: "Ready".to_string(),
        });
        terminal
            .draw(|frame| render_runs(frame, area, &command_output))
            .expect("command output should render");

        let mut commands = selected.clone();
        commands.apply(UiAction::AppendPrompt('/'));
        terminal
            .draw(|frame| render_runs(frame, area, &commands))
            .expect("command palette should render");

        let mut models = selected;
        models.apply(UiAction::ModelSelectorOpened(model_list()));
        models.apply(UiAction::SelectNextModel);
        terminal
            .draw(|frame| render_runs(frame, area, &models))
            .expect("model selector should render");
    }

    #[test]
    fn render_runs_draws_files_and_complete_thread_activity() {
        let area = Rect::new(0, 0, 120, 30);
        let backend = TestBackend::new(120, 30);
        let mut terminal = Terminal::new(backend).expect("terminal");
        let mut files = AppState::new(initialized_default_capabilities(), vec![bench_run(1)]);
        files.prompt_input = "review @src".into();
        files.prompt_cursor = files.prompt_input.len();
        files.set_file_suggestions(vec!["src/main.rs".into(), "src/lib.rs".into()]);
        files.select_file_suggestion(1);
        terminal
            .draw(|frame| render_runs(frame, area, &files))
            .expect("file suggestions should render");

        let item_types = [
            ThreadItemType::UserMessage,
            ThreadItemType::AgentMessage,
            ThreadItemType::Reasoning,
            ThreadItemType::ToolCall,
            ThreadItemType::Approval,
            ThreadItemType::Source,
            ThreadItemType::AgentStatus,
            ThreadItemType::Error,
            ThreadItemType::SteeringMessage,
        ];
        let statuses = [
            ThreadItemStatus::InProgress,
            ThreadItemStatus::Completed,
            ThreadItemStatus::Failed,
            ThreadItemStatus::Declined,
        ];
        let turn_statuses = [
            TurnStatus::Completed,
            TurnStatus::Failed,
            TurnStatus::Interrupted,
            TurnStatus::Queued,
            TurnStatus::InProgress,
        ];
        let turns = turn_statuses
            .into_iter()
            .enumerate()
            .map(|(turn_index, status)| TurnRecord {
                id: format!("turn-{turn_index}"),
                thread_id: "thread".into(),
                run_id: String::new(),
                status,
                items: item_types
                    .iter()
                    .enumerate()
                    .map(|(index, item_type)| ThreadItemRecord {
                        id: format!("item-{turn_index}-{index}"),
                        turn_id: format!("turn-{turn_index}"),
                        item_type: *item_type,
                        status: statuses[index % statuses.len()],
                        content: match index % 3 {
                            0 => json!("plain text"),
                            1 => json!({"message":"structured text"}),
                            _ => json!({"nested":{"value":index}}),
                        },
                        created_at: index as u64,
                        updated_at: index as u64,
                    })
                    .collect(),
                created_at: turn_index as u64,
                updated_at: turn_index as u64,
            })
            .collect();
        let mut thread_state =
            AppState::new(initialized_default_capabilities(), vec![bench_run(1)]);
        thread_state.set_active_thread(ThreadRecord {
            id: "thread".into(),
            title: "Ship release".into(),
            objective: "Verify every surface".into(),
            state: ThreadState::Active,
            archived: false,
            source: "test".into(),
            task_mode: TaskMode::Code,
            parent_thread_id: None,
            turns,
            created_at: 0,
            updated_at: 1,
        });
        terminal
            .draw(|frame| render_runs(frame, area, &thread_state))
            .expect("thread activity should render");

        thread_state.set_active_thread(ThreadRecord {
            id: "empty-thread".into(),
            title: "Waiting".into(),
            objective: String::new(),
            state: ThreadState::Paused,
            archived: false,
            source: "test".into(),
            task_mode: TaskMode::Work,
            parent_thread_id: None,
            turns: Vec::new(),
            created_at: 0,
            updated_at: 0,
        });
        terminal
            .draw(|frame| render_runs(frame, area, &thread_state))
            .expect("empty thread should render");
    }

    #[test]
    fn thread_detail_dispatches_code_without_changing_work_or_chat() {
        let thread = ThreadRecord {
            id: "thread".into(),
            title: "Mode boundary".into(),
            objective: "Keep presentation scoped".into(),
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
                items: vec![ThreadItemRecord {
                    id: "agent".into(),
                    turn_id: "turn".into(),
                    item_type: ThreadItemType::AgentMessage,
                    status: ThreadItemStatus::Completed,
                    content: json!({"text":"Finished the focused change."}),
                    created_at: 1,
                    updated_at: 2,
                }],
                created_at: 1,
                updated_at: 2,
            }],
            created_at: 1,
            updated_at: 2,
        };

        let code = thread_detail_lines(&thread)
            .into_iter()
            .map(line_text)
            .collect::<Vec<_>>();
        assert!(code
            .iter()
            .any(|line| line == "• Finished the focused change."));
        assert!(!code.iter().any(|line| line.starts_with("Turn ")));

        for mode in [TaskMode::Work, TaskMode::Chat] {
            let mut generic_thread = thread.clone();
            generic_thread.task_mode = mode;
            let generic = thread_detail_lines(&generic_thread)
                .into_iter()
                .map(line_text)
                .collect::<Vec<_>>();
            assert!(generic.iter().any(|line| line == "Turn completed"));
            assert!(generic.iter().any(|line| line == "TaskForceAI"));
        }
    }

    #[test]
    fn generic_thread_details_cover_every_turn_item_and_status() {
        let item_types = [
            ThreadItemType::UserMessage,
            ThreadItemType::AgentMessage,
            ThreadItemType::Reasoning,
            ThreadItemType::ToolCall,
            ThreadItemType::Approval,
            ThreadItemType::Source,
            ThreadItemType::AgentStatus,
            ThreadItemType::Error,
            ThreadItemType::SteeringMessage,
        ];
        let item_statuses = [
            ThreadItemStatus::InProgress,
            ThreadItemStatus::Completed,
            ThreadItemStatus::Failed,
            ThreadItemStatus::Declined,
        ];
        let turns = [
            TurnStatus::Completed,
            TurnStatus::Failed,
            TurnStatus::Interrupted,
            TurnStatus::Queued,
            TurnStatus::InProgress,
        ]
        .into_iter()
        .enumerate()
        .map(|(turn_index, status)| TurnRecord {
            id: format!("turn-{turn_index}"),
            thread_id: "generic".into(),
            run_id: String::new(),
            status,
            items: if turn_index == 0 {
                item_types
                    .into_iter()
                    .enumerate()
                    .map(|(index, item_type)| ThreadItemRecord {
                        id: format!("item-{index}"),
                        turn_id: "turn-0".into(),
                        item_type,
                        status: item_statuses[index % item_statuses.len()],
                        content: match index {
                            0 => json!("plain text"),
                            1 => json!({"nested":{"value":index}}),
                            _ => json!({"message":format!("item {index}")}),
                        },
                        created_at: 1,
                        updated_at: 2,
                    })
                    .collect()
            } else {
                Vec::new()
            },
            created_at: 1,
            updated_at: 2,
        })
        .collect();
        let thread = ThreadRecord {
            id: "generic".into(),
            title: "Generic timeline".into(),
            objective: "Cover generic rendering".into(),
            state: ThreadState::Active,
            archived: false,
            source: "test".into(),
            task_mode: TaskMode::Work,
            parent_thread_id: None,
            turns,
            created_at: 1,
            updated_at: 2,
        };

        let rendered = thread_detail_lines(&thread)
            .into_iter()
            .map(line_text)
            .collect::<Vec<_>>();

        for expected in [
            "Turn completed",
            "Turn failed",
            "Turn interrupted",
            "Turn queued",
            "Turn inprogress",
            "You · running",
            "TaskForceAI",
            "Reasoning · failed",
            "Tool · declined",
            "Approval · running",
            "Source",
            "Agent · failed",
            "Error · declined",
            "Steer · running",
            "  plain text",
        ] {
            assert!(rendered.iter().any(|line| line == expected), "{expected}");
        }
        assert!(rendered.iter().any(|line| line.contains("nested")));
    }

    #[test]
    #[ignore = "performance baseline: run explicitly with --ignored --nocapture"]
    fn perf_render_run_rows_and_detail_lines() {
        const RUN_COUNT: usize = 400;
        const ITERATIONS: usize = 2_000;
        let runs = (0..RUN_COUNT).map(bench_run).collect::<Vec<_>>();

        let started = Instant::now();
        let mut rendered = 0_usize;
        for iteration in 0..ITERATIONS {
            for (index, run) in runs.iter().take(40).enumerate() {
                black_box(run_item(run, iteration % RUN_COUNT == index));
                rendered += 1;
            }
            black_box(run_detail_lines(&runs[iteration % RUN_COUNT]));
            rendered += 1;
        }
        let elapsed = started.elapsed();
        let avg_nanos = elapsed.as_nanos() / rendered as u128;
        eprintln!(
            "perf_render_run_rows_and_detail_lines: rendered={rendered} total_ms={:.3} avg_ns={avg_nanos}",
            elapsed.as_secs_f64() * 1_000.0
        );
    }
}
