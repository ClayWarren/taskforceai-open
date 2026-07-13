use ratatui::layout::Rect;
#[cfg(test)]
use ratatui::style::Modifier;
use ratatui::style::Style;
use ratatui::text::{Line, Span};
use ratatui::widgets::{Paragraph, Wrap};
use ratatui::Frame;

use crate::state::{AppState, FocusArea};

#[cfg(test)]
use super::style::BORDER_FOCUS;
use super::style::{panel_block, ACCENT, TEXT, TEXT_FAINT, TEXT_MUTED};

pub(super) fn render_composer(frame: &mut Frame<'_>, area: Rect, state: &AppState) {
    let lines = composer_lines(state);
    frame.render_widget(
        Paragraph::new(lines)
            .style(Style::default().fg(TEXT))
            .wrap(Wrap { trim: false })
            .block(panel_block(" PROMPT ", state.focus == FocusArea::Prompt)),
        area,
    );
    if let Some(position) = prompt_cursor_position(area, state) {
        frame.set_cursor_position(position);
    }
}

fn composer_lines(state: &AppState) -> Vec<Line<'_>> {
    let mut lines = Vec::new();
    if !state.attachments.is_empty() {
        lines.push(Line::from(vec![
            Span::styled("Attachments ", Style::default().fg(ACCENT)),
            Span::styled(
                state
                    .attachments
                    .iter()
                    .map(|attachment| attachment.name.as_str())
                    .collect::<Vec<_>>()
                    .join(" · "),
                Style::default().fg(TEXT_MUTED),
            ),
        ]));
    }
    if state.prompt_input.is_empty() {
        lines.push(Line::from(vec![
            Span::styled("> ", Style::default().fg(ACCENT)),
            Span::styled(
                "Ask TaskForceAI, @mention a file, or type / for commands",
                Style::default().fg(TEXT_FAINT),
            ),
        ]));
        return lines;
    }
    for (index, prompt_line) in state.prompt_input.split('\n').enumerate() {
        lines.push(Line::from(vec![
            Span::styled(
                if index == 0 { "> " } else { "  " },
                Style::default().fg(ACCENT),
            ),
            Span::styled(prompt_line.to_string(), Style::default().fg(TEXT)),
        ]));
    }
    lines
}

#[cfg(test)]
pub(super) fn command_suggestion_spans(state: &AppState, available_width: usize) -> Vec<Span<'_>> {
    let mut spans = Vec::with_capacity(state.command_suggestions.len().saturating_mul(4));
    if available_width == 0 || state.command_suggestions.is_empty() {
        return spans;
    }
    let start = state
        .selected_command_suggestion
        .unwrap_or(0)
        .min(state.command_suggestions.len().saturating_sub(1));
    let mut used = 0_usize;
    if start > 0 && available_width >= 2 {
        spans.push(Span::styled("< ", Style::default().fg(TEXT_FAINT)));
        used = 2;
    }
    for (index, suggestion) in state.command_suggestions.iter().enumerate().skip(start) {
        let separator_width = usize::from(used > 0) * 2;
        let chip_width = suggestion.chars().count() + 2;
        if used + separator_width + chip_width > available_width {
            if used + separator_width + 2 <= available_width {
                spans.push(Span::styled(" >", Style::default().fg(TEXT_FAINT)));
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
                .fg(super::style::BG)
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

pub(super) fn prompt_cursor_position(area: Rect, state: &AppState) -> Option<(u16, u16)> {
    if state.effort_selector_active()
        || state.focus != FocusArea::Prompt
        || area.width < 4
        || area.height < 3
    {
        return None;
    }
    let cursor = state.prompt_cursor.min(state.prompt_input.len());
    let before = &state.prompt_input[..cursor];
    let line_index = before.bytes().filter(|byte| *byte == b'\n').count();
    let column = before
        .rsplit_once('\n')
        .map_or(before, |(_, line)| line)
        .chars()
        .count();
    let attachment_offset = usize::from(!state.attachments.is_empty());
    let visible_rows = usize::from(area.height.saturating_sub(2));
    let logical_row = attachment_offset + line_index;
    let row_offset = logical_row.saturating_sub(visible_rows.saturating_sub(1));
    let visible_row = logical_row.saturating_sub(row_offset);
    let x = area
        .x
        .saturating_add(3)
        .saturating_add(column.min(u16::MAX as usize) as u16)
        .min(area.x.saturating_add(area.width.saturating_sub(2)));
    let y = area
        .y
        .saturating_add(1)
        .saturating_add(visible_row.min(u16::MAX as usize) as u16)
        .min(area.y.saturating_add(area.height.saturating_sub(2)));
    Some((x, y))
}

#[cfg(test)]
mod tests {
    use ratatui::backend::TestBackend;
    use ratatui::Terminal;
    use taskforceai_app_protocol::AttachmentRecord;

    use super::*;
    use crate::test_support::initialized_default_capabilities;

    #[test]
    fn composer_renders_multiline_input() {
        let mut state = AppState::new(initialized_default_capabilities(), Vec::new());
        state.prompt_input = "first\nsecond".to_string();
        state.prompt_cursor = state.prompt_input.len();
        let backend = TestBackend::new(60, 8);
        let mut terminal = Terminal::new(backend).expect("terminal");
        terminal
            .draw(|frame| render_composer(frame, frame.area(), &state))
            .expect("render");
        assert_eq!(
            prompt_cursor_position(Rect::new(0, 0, 60, 8), &state),
            Some((9, 2))
        );
    }

    #[test]
    fn composer_renders_empty_prompt_and_attachments() {
        let mut state = AppState::new(initialized_default_capabilities(), Vec::new());
        state.attachments = vec![AttachmentRecord {
            id: "a1".into(),
            name: "notes.md".into(),
            path: "/tmp/notes.md".into(),
            mime_type: "text/markdown".into(),
            size: 12,
        }];
        let backend = TestBackend::new(60, 8);
        let mut terminal = Terminal::new(backend).expect("terminal");
        terminal
            .draw(|frame| render_composer(frame, frame.area(), &state))
            .expect("render attachments");
        state.focus = FocusArea::Runs;
        assert!(prompt_cursor_position(Rect::new(0, 0, 2, 2), &state).is_none());
    }
}
