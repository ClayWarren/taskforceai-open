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
use crate::state::{AppState, FocusArea, PendingSubmission};

mod selectors;

use self::selectors::command_palette_lines;
pub(super) use self::selectors::{command_palette_scroll, picker_lines, picker_scroll};
#[cfg(test)]
pub(super) use self::selectors::{model_selector_lines, model_selector_scroll};

use super::layout::{root_chunks, run_chunks, run_scroll_offset};
use super::style::{
    accent, action, bg, border_focus, danger, ok, panel_alt, panel_block, text, text_faint,
    text_muted, warn,
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
                .map(|run| {
                    run_item(
                        run,
                        state.selected_run_id() == Some(run.id.as_str()),
                        state.animation_frame,
                    )
                })
                .collect()
        };
        frame.render_widget(
            List::new(items)
                .style(Style::default().fg(text()))
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
    let (title, mut lines, scroll) = if state.picker_active() {
        (" PICKER ", picker_lines(state), picker_scroll(area, state))
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
        let lines = command_output_lines(command_output);
        (" DETAILS ", lines, state.detail_scroll_offset)
    } else if let Some(thread) = state.active_thread() {
        let mut lines = navigable_thread_detail_lines(
            thread,
            &state.threads,
            state.tool_details_expanded,
            state.reasoning_visible,
            state.animation_frame,
        );
        if let Some(pending) = &state.pending_submission {
            lines.extend(optimistic_submission_lines(
                pending,
                state.task_mode,
                state.animation_frame,
            ));
        }
        (" TASK ", lines, state.detail_scroll_offset)
    } else if let Some(pending) = &state.pending_submission {
        (
            " TASK ",
            optimistic_submission_lines(pending, state.task_mode, state.animation_frame),
            0,
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

    if !state.picker_active()
        && !state.model_selector_active()
        && !state.file_suggestions_active()
        && !state.command_suggestions_active()
        && state.command_output.is_none()
        && !state.visible_todos().is_empty()
    {
        let mut progress = todo_lines(state);
        progress.push(Line::raw(""));
        progress.append(&mut lines);
        lines = progress;
    }

    frame.render_widget(
        Paragraph::new(lines)
            .scroll((scroll, 0))
            .style(Style::default().fg(text()))
            .wrap(Wrap { trim: false })
            .block(panel_block(title, false).padding(Padding::horizontal(1))),
        area,
    );
}

fn command_output_lines(command_output: &str) -> Vec<Line<'static>> {
    let (title, body) = command_output
        .split_once('\n')
        .unwrap_or((command_output, ""));
    let mut lines = vec![Line::styled(
        title.to_string(),
        Style::default().fg(accent()).add_modifier(Modifier::BOLD),
    )];
    if title.eq_ignore_ascii_case("diff") && !body.trim().is_empty() {
        lines.push(Line::raw(""));
        lines.extend(super::markdown::diff_lines(body, ""));
    } else {
        lines.extend(
            body.lines()
                .map(|line| Line::styled(line.to_string(), Style::default().fg(text()))),
        );
    }
    lines
}

fn todo_lines(state: &AppState) -> Vec<Line<'static>> {
    let completed = state
        .visible_todos()
        .iter()
        .filter(|todo| todo.status == "completed")
        .count();
    let mut lines = vec![Line::from(vec![
        Span::styled(
            "Task progress",
            Style::default().fg(accent()).add_modifier(Modifier::BOLD),
        ),
        Span::styled(
            format!("  {completed}/{} complete", state.visible_todos().len()),
            Style::default().fg(text_faint()),
        ),
    ])];
    for todo in state.visible_todos() {
        let (icon, color) = match todo.status.as_str() {
            "completed" => ("[x]", ok()),
            "in_progress" => ("[>]", accent()),
            "cancelled" | "canceled" => ("[-]", text_faint()),
            _ => ("[ ]", text_muted()),
        };
        let priority = todo
            .priority
            .as_deref()
            .filter(|priority| !priority.is_empty())
            .map_or_else(String::new, |priority| format!(" · {priority}"));
        lines.push(Line::from(vec![
            Span::styled(format!("{icon} "), Style::default().fg(color)),
            Span::styled(todo.content.clone(), Style::default().fg(text())),
            Span::styled(priority, Style::default().fg(text_faint())),
        ]));
    }
    lines
}

fn navigable_thread_detail_lines<'a>(
    thread: &'a ThreadRecord,
    threads: &'a [ThreadRecord],
    tool_details_expanded: bool,
    reasoning_visible: bool,
    animation_frame: u64,
) -> Vec<Line<'a>> {
    let mut lines = thread_detail_lines_with_tool_details(
        thread,
        tool_details_expanded,
        reasoning_visible,
        animation_frame,
    );
    let children = threads
        .iter()
        .filter(|candidate| candidate.parent_thread_id.as_deref() == Some(thread.id.as_str()))
        .count();
    if thread.parent_thread_id.is_some() || children > 0 {
        let parent = thread.parent_thread_id.as_deref().unwrap_or("root");
        lines.insert(
            1,
            Line::from(vec![
                Span::styled("Agent thread", Style::default().fg(accent())),
                Span::styled(
                    format!(" · parent {parent} · {children} children · Ctrl-G navigate"),
                    Style::default().fg(text_faint()),
                ),
            ]),
        );
    }
    lines
}

fn file_suggestion_lines(state: &AppState) -> Vec<Line<'_>> {
    let mut lines = vec![Line::from(vec![
        Span::styled(
            "Workspace files",
            Style::default().fg(accent()).add_modifier(Modifier::BOLD),
        ),
        Span::styled("  Enter inserts mention", Style::default().fg(text_faint())),
    ])];
    for (index, path) in state.file_suggestions.iter().enumerate() {
        let selected = state.selected_file_suggestion == Some(index);
        let style = if selected {
            Style::default()
                .fg(bg())
                .bg(border_focus())
                .add_modifier(Modifier::BOLD)
        } else {
            Style::default().fg(text())
        };
        lines.push(Line::from(vec![
            Span::styled(
                if selected { "> " } else { "  " },
                Style::default().fg(accent()),
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

#[cfg(test)]
pub(super) fn thread_detail_lines(thread: &ThreadRecord) -> Vec<Line<'_>> {
    thread_detail_lines_with_tool_details(thread, false, true, 0)
}

fn thread_detail_lines_with_tool_details(
    thread: &ThreadRecord,
    tool_details_expanded: bool,
    reasoning_visible: bool,
    animation_frame: u64,
) -> Vec<Line<'_>> {
    if thread.task_mode == taskforceai_app_protocol::TaskMode::Code {
        return super::code_timeline::code_thread_detail_lines_with_tool_details(
            thread,
            tool_details_expanded,
            reasoning_visible,
            animation_frame,
        );
    }

    let mut lines = vec![
        Line::from(vec![
            Span::styled(
                thread.title.clone(),
                Style::default().fg(text()).add_modifier(Modifier::BOLD),
            ),
            Span::raw("  "),
            Span::styled(
                format!("{:?}", thread.state).to_ascii_lowercase(),
                Style::default().fg(accent()),
            ),
        ]),
        Line::styled(thread.objective.clone(), Style::default().fg(text_muted())),
        Line::raw(""),
    ];
    for turn in &thread.turns {
        let turn_style = match turn.status {
            TurnStatus::Completed => Style::default().fg(ok()),
            TurnStatus::Failed => Style::default().fg(danger()),
            TurnStatus::Interrupted => Style::default().fg(warn()),
            TurnStatus::Queued | TurnStatus::InProgress => Style::default().fg(accent()),
        };
        let indicator = match turn.status {
            TurnStatus::Queued => super::motion::pulse(animation_frame),
            TurnStatus::InProgress => super::motion::spinner(animation_frame),
            TurnStatus::Completed => "✓",
            TurnStatus::Failed => "!",
            TurnStatus::Interrupted => "−",
        };
        lines.push(Line::from(vec![
            Span::styled(
                format!("{indicator} Turn "),
                Style::default().fg(text_faint()),
            ),
            Span::styled(
                format!("{:?}", turn.status).to_ascii_lowercase(),
                turn_style.add_modifier(Modifier::BOLD),
            ),
        ]));
        for item in &turn.items {
            if !reasoning_visible && item.item_type == ThreadItemType::Reasoning {
                continue;
            }
            lines.extend(thread_item_lines(item));
        }
        lines.push(Line::raw(""));
    }
    if thread.turns.is_empty() {
        lines.push(Line::styled(
            "Waiting for task activity",
            Style::default().fg(text_faint()),
        ));
    }
    lines
}

fn thread_item_lines(item: &ThreadItemRecord) -> Vec<Line<'_>> {
    let (label, color) = match item.item_type {
        ThreadItemType::UserMessage => ("You", accent()),
        ThreadItemType::AgentMessage => ("TaskForceAI", text()),
        ThreadItemType::Reasoning => ("Reasoning", text_muted()),
        ThreadItemType::ToolCall => ("Tool", warn()),
        ThreadItemType::CommandExecution => ("Command", warn()),
        ThreadItemType::FileChange => ("File", action()),
        ThreadItemType::Plan => ("Plan", action()),
        ThreadItemType::Compaction => ("Summary", text_muted()),
        ThreadItemType::Approval => ("Approval", warn()),
        ThreadItemType::Source => ("Source", action()),
        ThreadItemType::AgentStatus => ("Agent", accent()),
        ThreadItemType::Error => ("Error", danger()),
        ThreadItemType::SteeringMessage => ("Steer", action()),
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
        Span::styled(status, Style::default().fg(text_faint())),
    ])];
    let content = readable_item_content(&item.content);
    if !content.is_empty() {
        lines.extend(super::markdown::markdown_lines(
            &content,
            text(),
            "  ",
            "  ",
        ));
    }
    lines
}

fn readable_item_content(value: &Value) -> String {
    if let Some(value) = value.as_str() {
        return value.to_string();
    }
    for key in [
        "text", "message", "output", "diff", "patch", "command", "title", "url",
    ] {
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
                Style::default().fg(text()).add_modifier(Modifier::BOLD),
            ),
            Span::raw(" "),
            Span::styled(status_label(&run.status), status_style(&run.status)),
        ]),
        Line::raw(""),
        Line::from(vec![Span::styled(
            "Prompt",
            Style::default().fg(accent()).add_modifier(Modifier::BOLD),
        )]),
    ];
    lines.extend(styled_text_lines(&run.prompt, Style::default().fg(text())));
    lines.push(Line::raw(""));
    lines.push(Line::from(vec![Span::styled(
        "Response",
        Style::default().fg(accent()).add_modifier(Modifier::BOLD),
    )]));
    let output = run
        .output
        .as_ref()
        .map(|output| format_generated_media_output(output))
        .unwrap_or(Cow::Borrowed("Waiting for output"));
    lines.extend(super::markdown::markdown_lines(&output, text(), "", ""));

    if let Some(error) = &run.error {
        lines.push(Line::from(vec![
            Span::styled(
                "Error",
                Style::default().fg(danger()).add_modifier(Modifier::BOLD),
            ),
            Span::raw(" "),
            Span::styled(error.as_str(), Style::default().fg(danger())),
        ]));
    }

    if !run.sources.is_empty() {
        lines.push(Line::from(vec![
            Span::styled("Sources ", Style::default().fg(text_faint())),
            Span::styled(
                format_sources(&run.sources),
                Style::default()
                    .fg(action())
                    .add_modifier(Modifier::UNDERLINED),
            ),
        ]));
    }
    if !run.tool_events.is_empty() {
        lines.push(Line::from(vec![
            Span::styled("Tools ", Style::default().fg(text_faint())),
            Span::styled(
                format_records(&run.tool_events),
                Style::default().fg(text_muted()),
            ),
        ]));
    }
    if !run.agent_statuses.is_empty() {
        lines.push(Line::from(vec![
            Span::styled("Agents ", Style::default().fg(text_faint())),
            Span::styled(
                format_records(&run.agent_statuses),
                Style::default().fg(text_muted()),
            ),
        ]));
    }
    if let Some(approval) = &run.pending_approval {
        lines.push(Line::from(vec![
            Span::styled("Approval ", Style::default().fg(warn())),
            Span::styled(format_record(approval), Style::default().fg(warn())),
        ]));
    }

    lines
}

fn format_sources(records: &[Value]) -> String {
    records
        .iter()
        .map(|record| {
            let title = record
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let url = record
                .get("url")
                .and_then(Value::as_str)
                .unwrap_or_default();
            match (title.is_empty(), url.is_empty()) {
                (false, false) => format!("{title} ({url})"),
                (false, true) => title.to_string(),
                (true, false) => url.to_string(),
                (true, true) => format_record(record).into_owned(),
            }
        })
        .collect::<Vec<_>>()
        .join(", ")
}

pub(crate) fn url_at(root: Rect, column: u16, row: u16, state: &AppState) -> Option<String> {
    if state.model_selector_active()
        || state.file_suggestions_active()
        || state.command_suggestions_active()
    {
        return None;
    }
    let area = run_chunks(root_chunks(root)[1], state.sidebar_collapsed)[1];
    let content_x = area.x.saturating_add(2);
    let content_y = area.y.saturating_add(1);
    let content_width = area.width.saturating_sub(4).max(1);
    if column < content_x
        || column >= content_x.saturating_add(content_width)
        || row < content_y
        || row >= area.y.saturating_add(area.height.saturating_sub(1))
    {
        return None;
    }
    let mut lines = if let Some(command_output) = &state.command_output {
        command_output_lines(command_output)
    } else if let Some(thread) = state.active_thread() {
        navigable_thread_detail_lines(
            thread,
            &state.threads,
            state.tool_details_expanded,
            state.reasoning_visible,
            state.animation_frame,
        )
    } else if let Some(run) = state.selected_run() {
        run_detail_lines(run)
    } else {
        return None;
    };
    if !state.visible_todos().is_empty() {
        let mut progress = todo_lines(state);
        progress.push(Line::raw(""));
        progress.append(&mut lines);
        lines = progress;
    }
    let target_row = usize::from(row - content_y) + usize::from(state.detail_scroll_offset);
    let mut visual_row = 0_usize;
    let links = semantic_links(state);
    for line in lines {
        let text = line
            .spans
            .iter()
            .map(|span| span.content.as_ref())
            .collect::<String>();
        let rows = line.width().max(1).div_ceil(usize::from(content_width));
        if target_row >= visual_row && target_row < visual_row + rows {
            let wrapped_column = (target_row - visual_row) * usize::from(content_width)
                + usize::from(column - content_x);
            return url_at_column(&text, wrapped_column, &links);
        }
        visual_row += rows;
    }
    None
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct SemanticLink {
    label: String,
    url: String,
}

fn url_at_column(text: &str, column: usize, links: &[SemanticLink]) -> Option<String> {
    for link in links {
        let mut offset = 0_usize;
        while let Some(relative) = text[offset..].find(&link.label) {
            let start = offset + relative;
            let start_column = text[..start].chars().count();
            let end_column = start_column + link.label.chars().count();
            if (start_column..end_column).contains(&column) {
                return Some(link.url.clone());
            }
            offset = start + link.label.len();
            if offset >= text.len() {
                break;
            }
        }
    }
    for prefix in ["https://", "http://", "file://"] {
        let mut offset = 0_usize;
        while let Some(relative) = text[offset..].find(prefix) {
            let start = offset + relative;
            let rest = &text[start..];
            let raw_end = rest.find(char::is_whitespace).unwrap_or(rest.len());
            let raw = &rest[..raw_end];
            let url = raw.trim_end_matches(['.', ',', ';', ':', '!', '?', ')', ']']);
            let start_column = text[..start].chars().count();
            let end_column = start_column + url.chars().count();
            if (start_column..end_column).contains(&column) {
                return Some(url.to_string());
            }
            offset = start + raw_end;
            if offset >= text.len() {
                break;
            }
        }
    }
    None
}

fn semantic_links(state: &AppState) -> Vec<SemanticLink> {
    let mut links = Vec::new();
    if let Some(output) = &state.command_output {
        collect_markdown_links(output, &mut links);
    }
    if let Some(thread) = state.active_thread() {
        collect_markdown_links(&thread.objective, &mut links);
        for item in thread.turns.iter().flat_map(|turn| &turn.items) {
            collect_value_links(&item.content, &mut links);
        }
    } else if let Some(run) = state.selected_run() {
        if let Some(output) = &run.output {
            collect_markdown_links(output, &mut links);
        }
        for source in &run.sources {
            if let Some(url) = source.get("url").and_then(Value::as_str) {
                let label = source.get("title").and_then(Value::as_str).unwrap_or(url);
                links.push(SemanticLink {
                    label: label.to_string(),
                    url: url.to_string(),
                });
            }
        }
    }
    links.sort_by_key(|link| std::cmp::Reverse(link.label.len()));
    links.dedup();
    links
}

fn collect_value_links(value: &Value, links: &mut Vec<SemanticLink>) {
    match value {
        Value::String(value) => collect_markdown_links(value, links),
        Value::Array(values) => {
            for value in values {
                collect_value_links(value, links);
            }
        }
        Value::Object(values) => {
            if let Some(url) = values.get("url").and_then(Value::as_str) {
                let label = values
                    .get("title")
                    .or_else(|| values.get("label"))
                    .and_then(Value::as_str)
                    .unwrap_or(url);
                links.push(SemanticLink {
                    label: label.to_string(),
                    url: url.to_string(),
                });
            }
            for value in values.values() {
                collect_value_links(value, links);
            }
        }
        _ => {}
    }
}

fn collect_markdown_links(value: &str, links: &mut Vec<SemanticLink>) {
    let mut remaining = value;
    while let Some(open) = remaining.find('[') {
        let after_open = &remaining[open + 1..];
        let Some(label_end) = after_open.find("](") else {
            break;
        };
        let destination = &after_open[label_end + 2..];
        let Some(url_end) = destination.find(')') else {
            break;
        };
        let label = &after_open[..label_end];
        let url = &destination[..url_end];
        if !label.is_empty() && is_openable_url(url) {
            links.push(SemanticLink {
                label: label.to_string(),
                url: url.to_string(),
            });
        }
        remaining = &destination[url_end + 1..];
    }
}

fn is_openable_url(value: &str) -> bool {
    value.starts_with("https://") || value.starts_with("http://") || value.starts_with("file://")
}

fn styled_text_lines(value: &str, style: Style) -> Vec<Line<'static>> {
    value
        .split('\n')
        .map(|line| Line::styled(line.to_string(), style))
        .collect()
}

fn run_item(run: &RunRecord, selected: bool, animation_frame: u64) -> ListItem<'_> {
    ListItem::new(run_item_line(run, selected, animation_frame)).style(run_item_style(selected))
}

fn run_item_line(run: &RunRecord, selected: bool, animation_frame: u64) -> Line<'_> {
    let marker = if selected { "> " } else { "  " };
    let title = preview(&conversation_title(run), 40).into_owned();
    let snippet = conversation_snippet(run, 36);
    let mut spans = vec![
        Span::styled(marker, Style::default().fg(warn())),
        Span::styled(
            animated_status_bullet(&run.status, animation_frame),
            status_style(&run.status),
        ),
        Span::raw(" "),
        Span::styled(
            title,
            Style::default()
                .fg(if selected { text() } else { text_muted() })
                .add_modifier(Modifier::BOLD),
        ),
    ];
    if let Some(snippet) = snippet {
        spans.push(Span::styled("  ", Style::default().fg(text_faint())));
        spans.push(Span::styled(snippet, Style::default().fg(text_faint())));
    }
    Line::from(spans)
}

fn run_item_style(selected: bool) -> Style {
    if selected {
        Style::default()
            .fg(text())
            .bg(panel_alt())
            .add_modifier(Modifier::BOLD)
    } else {
        Style::default().fg(text_muted())
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

fn animated_status_bullet(status: &RunStatus, animation_frame: u64) -> &'static str {
    match status {
        RunStatus::Queued => super::motion::pulse(animation_frame),
        RunStatus::Processing => super::motion::spinner(animation_frame),
        _ => status_bullet(status),
    }
}

fn optimistic_submission_lines(
    pending: &PendingSubmission,
    mode: crate::state::TaskMode,
    animation_frame: u64,
) -> Vec<Line<'static>> {
    if mode == crate::state::TaskMode::Code {
        return super::code_timeline::optimistic_submission_lines(
            &pending.display_prompt,
            animation_frame,
        );
    }
    let mut lines = vec![Line::from(vec![
        Span::styled(
            "You",
            Style::default().fg(accent()).add_modifier(Modifier::BOLD),
        ),
        Span::styled(" · sending", Style::default().fg(text_faint())),
    ])];
    lines.extend(super::markdown::markdown_lines(
        &pending.display_prompt,
        text(),
        "  ",
        "  ",
    ));
    lines.push(Line::raw(""));
    lines.push(Line::styled(
        format!("{} Working", super::motion::spinner(animation_frame)),
        Style::default().fg(warn()),
    ));
    lines
}

fn status_style(status: &RunStatus) -> Style {
    match status {
        RunStatus::Queued => Style::default().fg(action()),
        RunStatus::Processing => Style::default().fg(warn()),
        RunStatus::Completed => Style::default().fg(ok()),
        RunStatus::Failed => Style::default().fg(danger()),
        RunStatus::Canceled => Style::default().fg(text_faint()),
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
mod tests;
