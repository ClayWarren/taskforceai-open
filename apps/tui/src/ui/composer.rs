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
            Span::styled(state.prompt_input.as_str(), Style::default().fg(TEXT)),
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
            Span::styled(state.prompt_input.as_str(), Style::default().fg(TEXT)),
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

pub(super) fn command_suggestion_spans(state: &AppState, available_width: usize) -> Vec<Span<'_>> {
    let mut spans = Vec::with_capacity(state.command_suggestions.len().saturating_mul(4));
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
            } // coverage:ignore-line -- structural overflow marker close.
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
        spans.push(Span::styled(" ", style));
        spans.push(Span::styled(*suggestion, style));
        spans.push(Span::styled(" ", style));
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

#[cfg(test)]
mod tests {
    use ratatui::backend::TestBackend;
    use ratatui::layout::Rect;
    use ratatui::Terminal;
    use taskforceai_app_protocol::{Capabilities, InitializeResult, ServerInfo, TransportInfo};

    use super::{command_suggestion_spans, prompt_cursor_position, render_composer};
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
    fn render_composer_draws_empty_prompt_text_and_suggestions() {
        let area = Rect::new(0, 0, 80, 3);
        let mut state = AppState::new(initialized(), Vec::new());
        let backend = TestBackend::new(80, 3);
        let mut terminal = Terminal::new(backend).expect("terminal");

        terminal
            .draw(|frame| render_composer(frame, area, &state))
            .expect("empty composer should render");

        state.apply(UiAction::AppendPrompt('/'));
        terminal
            .draw(|frame| render_composer(frame, area, &state))
            .expect("suggestion composer should render");

        state.prompt_input = "plain prompt".to_string();
        state.command_suggestions.clear();
        terminal
            .draw(|frame| render_composer(frame, area, &state))
            .expect("plain composer should render");
    }

    #[test]
    fn suggestion_spans_handle_zero_width_and_overflow() {
        let mut state = AppState::new(initialized(), Vec::new());
        state.apply(UiAction::AppendPrompt('/'));
        state.selected_command_suggestion = Some(3);

        assert!(command_suggestion_spans(&state, 0).is_empty());
        let spans = command_suggestion_spans(&state, 10);
        assert!(!spans.is_empty());
        let spans = command_suggestion_spans(&state, 6);
        assert!(spans.iter().any(|span| span.content.as_ref() == ">"));
    }

    #[test]
    fn cursor_position_rejects_non_prompt_focus_and_tiny_areas() {
        let mut state = AppState::new(initialized(), Vec::new());
        let area = Rect::new(1, 2, 10, 3);

        assert_eq!(prompt_cursor_position(Rect::new(0, 0, 3, 3), &state), None);
        state.apply(UiAction::ToggleFocus);
        assert_eq!(prompt_cursor_position(area, &state), None);
    }
}
