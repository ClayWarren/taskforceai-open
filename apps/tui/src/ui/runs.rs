use std::borrow::Cow;

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
                        line,
                        Style::default().fg(ACCENT).add_modifier(Modifier::BOLD),
                    )
                } else {
                    Line::styled(line, Style::default().fg(TEXT))
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

pub(super) fn model_selector_lines(state: &AppState) -> Vec<Line<'_>> {
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
    let mut lines = Vec::with_capacity(3 + selector.options.len().saturating_mul(2));
    lines.push(Line::from(vec![
        Span::styled(
            "Model selector",
            Style::default().fg(ACCENT).add_modifier(Modifier::BOLD),
        ),
        Span::styled(
            "  Up/Down choose, Enter select, Esc close",
            Style::default().fg(TEXT_FAINT),
        ),
    ]));
    lines.push(Line::from(vec![
        Span::styled("current ", Style::default().fg(TEXT_FAINT)),
        Span::styled(selected, Style::default().fg(ACCENT)),
        Span::styled("  catalog ", Style::default().fg(TEXT_FAINT)),
        Span::styled(catalog, Style::default().fg(TEXT_MUTED)),
    ]));
    lines.push(Line::raw(""));

    for (index, option) in selector.options.iter().enumerate() {
        let highlighted = selector.selected_index == index;
        let active = selected == option.id.as_str();
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
        let mut label =
            Vec::with_capacity(6 + usize::from(option.usage_multiple.is_some()).saturating_mul(3));
        label.push(Span::styled(marker, style));
        label.push(Span::styled(" ", style));
        label.push(Span::styled(option.id.as_str(), style));
        label.push(Span::styled(" [", style));
        label.push(Span::styled(option.badge.as_str(), style));
        label.push(Span::styled("]", style));
        if let Some(usage) = option.usage_multiple {
            label.push(Span::styled(" ", style));
            label.push(Span::styled(compact_float(usage), style));
            label.push(Span::styled("x", style));
        }
        lines.push(Line::from(label));
        if let Some(description) = &option.description {
            if !description.is_empty() {
                let style = Style::default().fg(TEXT_MUTED);
                lines.push(Line::from(vec![
                    Span::styled("    ", style),
                    Span::styled(description.as_str(), style),
                ]));
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

fn command_palette_lines(state: &AppState) -> Vec<Line<'_>> {
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
            Span::styled(*command, style),
        ]));
    }

    lines
}

pub(super) fn run_detail_lines(run: &RunRecord) -> Vec<Line<'_>> {
    let mut lines = vec![
        Line::from(vec![
            Span::styled("Run ", Style::default().fg(TEXT_FAINT)),
            Span::styled(
                run.id.as_str(),
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
        Line::styled(run.prompt.as_str(), Style::default().fg(TEXT)),
        Line::raw(""),
        Line::from(vec![Span::styled(
            "Response",
            Style::default().fg(ACCENT).add_modifier(Modifier::BOLD),
        )]),
        Line::styled(
            run.output
                .as_ref()
                .map(|output| format_generated_media_output(output))
                .unwrap_or(Cow::Borrowed("Waiting for output")),
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

fn run_item(run: &RunRecord, selected: bool) -> ListItem<'_> {
    let marker = if selected { "> " } else { "  " };
    let output = run
        .output
        .as_ref()
        .map(|value| preview(value, 48))
        .unwrap_or_default();
    let prompt = preview(&run.prompt, 54);
    let id = preview(&run.id, 10);
    let line = Line::from(vec![
        Span::styled(marker, Style::default().fg(WARN)),
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
            if output.is_empty() {
                Cow::Borrowed("")
            } else {
                Cow::Owned(format!("  {output}"))
            },
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
    use ratatui::Terminal;
    use serde_json::json;
    use taskforceai_app_protocol::{
        Capabilities, InitializeResult, ModelListResult, ModelOptionRecord, RunRecord, RunStatus,
        ServerInfo, TransportInfo,
    };

    use super::{
        preview, render_runs, run_detail_lines, run_item, status_bullet, status_label, status_style,
    };
    use crate::state::{AppState, UiAction};

    fn initialized() -> InitializeResult {
        InitializeResult {
            server: ServerInfo::default(),
            transport: TransportInfo {
                kind: "stdio".to_string(),
                encoding: "jsonl".to_string(),
            },
            capabilities: Capabilities::default(),
        }
    }

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
    fn preview_truncates_on_character_boundaries() {
        assert_eq!(preview("short", 10), "short");
        assert_eq!(preview("abcdef", 3), "abc...");
        assert_eq!(preview("áβçd", 3), "áβç...");
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
                },
                ModelOptionRecord {
                    id: "gpt-5".to_string(),
                    label: "GPT-5".to_string(),
                    badge: "deep".to_string(),
                    description: Some("".to_string()),
                    usage_multiple: Some(2.25),
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

        let empty = AppState::new(initialized(), Vec::new());
        terminal
            .draw(|frame| render_runs(frame, area, &empty))
            .expect("empty runs should render");

        let selected = AppState::new(initialized(), vec![bench_run(1), bench_run(2)]);
        terminal
            .draw(|frame| render_runs(frame, area, &selected))
            .expect("selected run should render");

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
