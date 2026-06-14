use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{List, ListItem, Padding, Paragraph, Wrap};
use ratatui::Frame;
use serde_json::Value;
use taskforceai_app_protocol::{RunRecord, RunStatus};

use crate::app::format::format_generated_media_output;
use crate::state::{AppState, FocusArea};

use super::layout::{run_chunks, run_scroll_offset};
use super::style::{
    focused_block, panel_block, ACCENT, ACTION, BG, BORDER_FOCUS, DANGER, OK, PANEL_ALT, TEXT,
    TEXT_FAINT, TEXT_MUTED, WARN,
};

pub(super) fn render_runs(frame: &mut Frame<'_>, area: Rect, state: &AppState) {
    let chunks = run_chunks(area);
    let visible_rows = usize::from(chunks[0].height.saturating_sub(2));
    let scroll_offset = run_scroll_offset(frame.area(), state);

    let items = if state.runs.is_empty() {
        vec![ListItem::new("No runs yet. Type a prompt and press Enter.")]
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
            .block(focused_block(" RUNS ", state.focus == FocusArea::Runs)),
        chunks[0],
    );
    render_run_detail(frame, chunks[1], state);
}

fn render_run_detail(frame: &mut Frame<'_>, area: Rect, state: &AppState) {
    let (title, lines, scroll) = if state.model_selector_active() {
        (
            " MODELS ",
            model_selector_lines(state),
            model_selector_scroll(area, state),
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
                        line.to_string(),
                        Style::default().fg(ACCENT).add_modifier(Modifier::BOLD),
                    )
                } else {
                    Line::styled(line.to_string(), Style::default().fg(TEXT))
                }
            })
            .collect::<Vec<_>>();
        (" DETAILS ", lines, state.detail_scroll_offset)
    } else if let Some(run) = state.selected_run() {
        (
            " DETAILS ",
            run_detail_lines(run),
            state.detail_scroll_offset,
        )
    } else {
        (" DETAILS ", vec![Line::from("No selected run.")], 0)
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

pub(super) fn model_selector_scroll(area: Rect, state: &AppState) -> u16 {
    let visible_rows = area.height.saturating_sub(2);
    if visible_rows == 0 {
        return 0;
    }
    let selected_line = state
        .model_selector
        .as_ref()
        .map(model_selector_selected_line)
        .unwrap_or(0);
    let visible_rows = usize::from(visible_rows);
    selected_line
        .saturating_sub(visible_rows.saturating_sub(1))
        .min(usize::from(u16::MAX)) as u16
}

fn model_selector_selected_line(selector: &crate::state::ModelSelectorState) -> usize {
    let prior_option_lines = selector
        .options
        .iter()
        .take(selector.selected_index)
        .map(|option| {
            1 + usize::from(
                option
                    .description
                    .as_ref()
                    .is_some_and(|description| !description.is_empty()),
            )
        })
        .sum::<usize>();
    3 + prior_option_lines
}

fn model_selector_lines(state: &AppState) -> Vec<Line<'static>> {
    let Some(selector) = &state.model_selector else {
        return vec![Line::from("No models loaded.")];
    };
    let catalog = if selector.remote_catalog {
        "remote"
    } else {
        "local"
    };
    let selected = selector
        .selected_model_id
        .as_deref()
        .unwrap_or(&selector.default_model_id);
    let mut lines = vec![
        Line::from(vec![
            Span::styled(
                "Model selector",
                Style::default().fg(ACCENT).add_modifier(Modifier::BOLD),
            ),
            Span::styled(
                "  Up/Down choose, Enter select, Esc close",
                Style::default().fg(TEXT_FAINT),
            ),
        ]),
        Line::from(vec![
            Span::styled("current ", Style::default().fg(TEXT_FAINT)),
            Span::styled(selected.to_string(), Style::default().fg(ACCENT)),
            Span::styled("  catalog ", Style::default().fg(TEXT_FAINT)),
            Span::styled(catalog, Style::default().fg(TEXT_MUTED)),
        ]),
        Line::raw(""),
    ];

    for (index, option) in selector.options.iter().enumerate() {
        let highlighted = selector.selected_index == index;
        let active = selected == option.id;
        let marker = match (highlighted, active) {
            (true, true) => "> *",
            (true, false) => ">  ",
            (false, true) => "  *",
            (false, false) => "   ",
        };
        let style = if highlighted {
            Style::default()
                .fg(BG)
                .bg(BORDER_FOCUS)
                .add_modifier(Modifier::BOLD)
        } else if active {
            Style::default().fg(OK).add_modifier(Modifier::BOLD)
        } else {
            Style::default().fg(TEXT)
        };
        let mut label = format!("{marker} {} [{}]", option.id, option.badge);
        if let Some(usage) = option.usage_multiple {
            label.push_str(&format!(" {}x", compact_float(usage)));
        }
        lines.push(Line::styled(label, style));
        if let Some(description) = &option.description {
            if !description.is_empty() {
                lines.push(Line::styled(
                    format!("    {description}"),
                    Style::default().fg(TEXT_MUTED),
                ));
            }
        }
    }
    lines
}

fn compact_float(value: f64) -> String {
    let mut rendered = format!("{value:.2}");
    while rendered.contains('.') && rendered.ends_with('0') {
        rendered.pop();
    }
    if rendered.ends_with('.') {
        rendered.pop();
    }
    rendered
}

pub(super) fn command_palette_scroll(area: Rect, state: &AppState) -> u16 {
    let visible_rows = area.height.saturating_sub(2);
    if visible_rows == 0 {
        return 0;
    }
    let selected_line = state
        .selected_command_suggestion
        .unwrap_or(0)
        .saturating_add(2);
    let visible_rows = usize::from(visible_rows);
    selected_line
        .saturating_sub(visible_rows.saturating_sub(1))
        .min(usize::from(u16::MAX)) as u16
}

fn command_palette_lines(state: &AppState) -> Vec<Line<'static>> {
    let mut lines = vec![
        Line::from(vec![
            Span::styled(
                "Slash commands",
                Style::default().fg(ACCENT).add_modifier(Modifier::BOLD),
            ),
            Span::styled(
                "  Up/Down select, Enter run",
                Style::default().fg(TEXT_FAINT),
            ),
        ]),
        Line::raw(""),
    ];

    for (index, command) in state.command_suggestions.iter().enumerate() {
        let selected = state.selected_command_suggestion == Some(index);
        let marker = if selected { ">" } else { " " };
        let style = if selected {
            Style::default()
                .fg(BG)
                .bg(BORDER_FOCUS)
                .add_modifier(Modifier::BOLD)
        } else {
            Style::default().fg(TEXT)
        };
        lines.push(Line::from(vec![
            Span::styled(format!("{marker} "), Style::default().fg(ACCENT)),
            Span::styled(command.clone(), style),
        ]));
    }

    lines
}

pub(super) fn run_detail_lines(run: &RunRecord) -> Vec<Line<'static>> {
    let mut lines = vec![
        Line::from(vec![
            Span::styled("Run ", Style::default().fg(TEXT_FAINT)),
            Span::styled(
                run.id.clone(),
                Style::default().fg(TEXT).add_modifier(Modifier::BOLD),
            ),
            Span::raw(" "),
            Span::styled(status_label(&run.status), status_style(&run.status)),
        ]),
        Line::from(vec![
            Span::styled("Created ", Style::default().fg(TEXT_FAINT)),
            Span::styled(run.created_at.to_string(), Style::default().fg(TEXT_MUTED)),
            Span::styled("  Updated ", Style::default().fg(TEXT_FAINT)),
            Span::styled(run.updated_at.to_string(), Style::default().fg(TEXT_MUTED)),
        ]),
        Line::raw(""),
        Line::from(vec![Span::styled(
            "Prompt",
            Style::default().fg(ACCENT).add_modifier(Modifier::BOLD),
        )]),
        Line::styled(run.prompt.clone(), Style::default().fg(TEXT)),
        Line::raw(""),
        Line::from(vec![Span::styled(
            "Response",
            Style::default().fg(ACCENT).add_modifier(Modifier::BOLD),
        )]),
        Line::styled(
            run.output
                .as_ref()
                .map(|output| format_generated_media_output(output))
                .unwrap_or_else(|| "Waiting for output".to_string()),
            Style::default().fg(TEXT),
        ),
    ];

    if let Some(error) = &run.error {
        lines.push(Line::from(vec![
            Span::styled(
                "Error",
                Style::default().fg(DANGER).add_modifier(Modifier::BOLD),
            ),
            Span::raw(" "),
            Span::styled(error.clone(), Style::default().fg(DANGER)),
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

fn run_item(run: &RunRecord, selected: bool) -> ListItem<'static> {
    let marker = if selected { "> " } else { "  " };
    let output = run
        .output
        .as_ref()
        .map(|value| preview(value, 48))
        .unwrap_or_default();
    let prompt = preview(&run.prompt, 54);
    let id = preview(&run.id, 10);
    let line = Line::from(vec![
        Span::styled(marker.to_string(), Style::default().fg(WARN)),
        Span::styled(status_bullet(&run.status), status_style(&run.status)),
        Span::raw(" "),
        Span::styled(
            id,
            Style::default()
                .fg(if selected { TEXT } else { TEXT_MUTED })
                .add_modifier(Modifier::BOLD),
        ),
        Span::styled("  ", Style::default().fg(TEXT_FAINT)),
        Span::styled(
            prompt,
            Style::default().fg(if selected { TEXT } else { TEXT_MUTED }),
        ),
        Span::styled(
            output
                .is_empty()
                .then(String::new)
                .unwrap_or_else(|| format!("  {output}")),
            Style::default().fg(TEXT_FAINT),
        ),
    ]);
    let style = if selected {
        Style::default()
            .fg(TEXT)
            .bg(PANEL_ALT)
            .add_modifier(Modifier::BOLD)
    } else {
        Style::default().fg(TEXT_MUTED)
    };
    ListItem::new(line).style(style)
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

fn preview(value: &str, max_chars: usize) -> String {
    let mut chars = value.chars();
    let mut output = chars.by_ref().take(max_chars).collect::<String>();
    if chars.next().is_some() {
        output.push_str("...");
    }
    output
}

pub(super) fn format_records(records: &[Value]) -> String {
    records
        .iter()
        .map(format_record)
        .collect::<Vec<_>>()
        .join(", ")
}

fn format_record(record: &Value) -> String {
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
                return value.to_string();
            }
        }
    }

    if let Some(value) = record.as_str() {
        return value.to_string();
    }

    record.to_string()
}

#[cfg(test)]
mod tests {
    use taskforceai_app_protocol::RunStatus;

    use super::{preview, status_bullet, status_label};

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
        }
    }

    #[test]
    fn preview_truncates_on_character_boundaries() {
        assert_eq!(preview("short", 10), "short");
        assert_eq!(preview("abcdef", 3), "abc...");
        assert_eq!(preview("áβçd", 3), "áβç...");
    }
}
