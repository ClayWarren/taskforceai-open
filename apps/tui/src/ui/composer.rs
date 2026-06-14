use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::Paragraph;
use ratatui::Frame;

use crate::state::{AppState, FocusArea};

use super::style::{focused_block, ACCENT, BG, BORDER_FOCUS, TEXT, TEXT_FAINT};

pub(super) fn render_composer(frame: &mut Frame<'_>, area: Rect, state: &AppState) {
    let prompt = if !state.command_suggestions.is_empty() {
        let mut spans = vec![
            Span::styled("> ", Style::default().fg(ACCENT)),
            Span::styled(state.prompt_input.clone(), Style::default().fg(TEXT)),
            Span::styled("  ", Style::default().fg(TEXT_FAINT)),
        ];
        let used_width = 4_usize.saturating_add(state.prompt_input.chars().count());
        let available_width = usize::from(area.width.saturating_sub(2)).saturating_sub(used_width);
        spans.extend(command_suggestion_spans(state, available_width));
        Line::from(spans)
    } else if state.prompt_input.is_empty() {
        Line::from(vec![
            Span::styled("> ", Style::default().fg(ACCENT)),
            Span::styled(
                "Ask TaskForceAI or type / for commands",
                Style::default().fg(TEXT_FAINT),
            ),
        ])
    } else {
        Line::from(vec![
            Span::styled("> ", Style::default().fg(ACCENT)),
            Span::styled(state.prompt_input.clone(), Style::default().fg(TEXT)),
        ])
    };
    frame.render_widget(
        Paragraph::new(prompt)
            .style(Style::default().fg(TEXT))
            .block(focused_block(" PROMPT ", state.focus == FocusArea::Prompt)),
        area,
    );
    if let Some(position) = prompt_cursor_position(area, state) {
        frame.set_cursor_position(position);
    }
}

pub(super) fn command_suggestion_spans(
    state: &AppState,
    available_width: usize,
) -> Vec<Span<'static>> {
    let mut spans = Vec::new();
    if available_width == 0 || state.command_suggestions.is_empty() {
        return spans;
    }

    let start = command_suggestion_window_start(state);
    let mut used = 0_usize;
    if start > 0 && available_width >= 2 {
        spans.push(Span::styled("< ", Style::default().fg(TEXT_FAINT)));
        used = 2;
    }

    for (index, suggestion) in state.command_suggestions.iter().enumerate().skip(start) {
        let separator_width = if used > 0 { 2 } else { 0 };
        let chip_width = suggestion_chip_width(suggestion);
        if used + separator_width + chip_width > available_width {
            if used + separator_width + 2 <= available_width {
                if used > 0 {
                    spans.push(Span::raw(" "));
                }
                spans.push(Span::styled(">", Style::default().fg(TEXT_FAINT)));
            }
            break;
        }
        if used > 0 {
            spans.push(Span::raw("  "));
            used += 2;
        }
        let selected = state.selected_command_suggestion == Some(index);
        let style = if selected {
            Style::default()
                .fg(BG)
                .bg(BORDER_FOCUS)
                .add_modifier(Modifier::BOLD)
        } else {
            Style::default().fg(TEXT_FAINT)
        };
        spans.push(Span::styled(format!(" {suggestion} "), style));
        used += chip_width;
    }
    spans
}

fn command_suggestion_window_start(state: &AppState) -> usize {
    let selected = state.selected_command_suggestion.unwrap_or(0);
    selected.min(state.command_suggestions.len().saturating_sub(1))
}

fn suggestion_chip_width(suggestion: &str) -> usize {
    suggestion.chars().count() + 2
}

pub(super) fn prompt_cursor_position(area: Rect, state: &AppState) -> Option<(u16, u16)> {
    if state.focus != FocusArea::Prompt || area.width < 4 || area.height < 3 {
        return None;
    }

    let prompt_prefix_width = 2_u16;
    let input_width = state.prompt_input.chars().count().min(u16::MAX as usize) as u16;
    let first_text_column = area.x.saturating_add(1);
    let last_text_column = area.x.saturating_add(area.width.saturating_sub(2));
    let x = first_text_column
        .saturating_add(prompt_prefix_width)
        .saturating_add(input_width)
        .min(last_text_column);
    Some((x, area.y.saturating_add(1)))
}
