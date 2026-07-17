use ratatui::buffer::CellWidth;
use ratatui::layout::Rect;
#[cfg(test)]
use ratatui::style::Modifier;
use ratatui::style::Style;
use ratatui::text::{Line, Span};
use ratatui::widgets::Paragraph;
use ratatui::Frame;

use crate::state::{AppState, FocusArea};

#[cfg(test)]
use super::style::border_focus;
use super::style::{accent, panel_block, text, text_faint, text_muted};

pub(super) fn render_composer(frame: &mut Frame<'_>, area: Rect, state: &AppState) {
    render_composer_with_title(frame, area, state, " PROMPT ");
}

pub(super) fn render_launch_composer(frame: &mut Frame<'_>, area: Rect, state: &AppState) {
    render_composer_with_title(frame, area, state, "");
}

fn render_composer_with_title(
    frame: &mut Frame<'_>,
    area: Rect,
    state: &AppState,
    title: &'static str,
) {
    let lines = composer_lines(state);
    let (vertical_scroll, horizontal_scroll) = composer_scroll(area, state);
    frame.render_widget(
        Paragraph::new(lines)
            .style(Style::default().fg(text()))
            .scroll((vertical_scroll, horizontal_scroll))
            .block(panel_block(title, state.focus == FocusArea::Prompt)),
        area,
    );
    if let Some(position) = prompt_cursor_position(area, state) {
        frame.set_cursor_position(position);
    }
}

fn composer_lines(state: &AppState) -> Vec<Line<'_>> {
    let mut lines = Vec::new();
    if !state.attachments.is_empty() {
        let mut attachment_spans =
            vec![Span::styled("Attachments ", Style::default().fg(accent()))];
        for (index, attachment) in state.attachments.iter().enumerate() {
            if index > 0 {
                attachment_spans.push(Span::styled(" ", Style::default().fg(text_muted())));
            }
            attachment_spans.push(Span::styled(
                format!("[{}]", attachment.name),
                Style::default()
                    .fg(accent())
                    .add_modifier(ratatui::style::Modifier::BOLD),
            ));
        }
        lines.push(Line::from(attachment_spans));
    }
    if state.prompt_input.is_empty() {
        lines.push(Line::from(vec![
            Span::styled("> ", Style::default().fg(accent())),
            Span::styled(
                if state.task_mode == crate::state::TaskMode::Code {
                    "Ask TaskForceAI, @mention a file, $skill, / for commands, or ! for shell"
                } else {
                    "Ask TaskForceAI, use $skill, or type / for commands"
                },
                Style::default().fg(text_faint()),
            ),
        ]));
        return lines;
    }
    for (index, prompt_line) in state.prompt_input.split('\n').enumerate() {
        let mut spans = vec![Span::styled(
            if index == 0 { "> " } else { "  " },
            Style::default().fg(accent()),
        )];
        spans.extend(prompt_text_spans(state, prompt_line));
        lines.push(Line::from(spans));
    }
    lines
}

fn prompt_text_spans(state: &AppState, line: &str) -> Vec<Span<'static>> {
    let mut spans = Vec::new();
    let mut remainder = line;
    while !remainder.is_empty() {
        let next = state
            .pasted_blocks
            .iter()
            .filter_map(|block| remainder.find(&block.marker).map(|index| (index, block)))
            .min_by_key(|(index, _)| *index);
        let Some((index, block)) = next else {
            spans.push(Span::styled(
                remainder.to_string(),
                Style::default().fg(text()),
            ));
            break;
        };
        if index > 0 {
            spans.push(Span::styled(
                remainder[..index].to_string(),
                Style::default().fg(text()),
            ));
        }
        spans.push(Span::styled(
            block.marker.clone(),
            Style::default()
                .fg(accent())
                .add_modifier(ratatui::style::Modifier::BOLD),
        ));
        remainder = &remainder[index + block.marker.len()..];
    }
    spans
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
        spans.push(Span::styled("< ", Style::default().fg(text_faint())));
        used = 2;
    }
    for (index, suggestion) in state.command_suggestions.iter().enumerate().skip(start) {
        let separator_width = usize::from(used > 0) * 2;
        let chip_width = suggestion.chars().count() + 2;
        if used + separator_width + chip_width > available_width {
            if used + separator_width + 2 <= available_width {
                spans.push(Span::styled(" >", Style::default().fg(text_faint())));
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
                .fg(super::style::bg())
                .bg(border_focus())
                .add_modifier(Modifier::BOLD)
        } else {
            Style::default().fg(text_faint())
        };
        spans.push(Span::styled(format!(" {suggestion} "), style));
        used += chip_width;
    }
    spans
}

pub(super) fn prompt_cursor_position(area: Rect, state: &AppState) -> Option<(u16, u16)> {
    if state.effort_selector_active()
        || state.model_selector_active()
        || state.agent_mode_selector_active()
        || state.team_config_active()
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
        .cell_width();
    let attachment_offset = usize::from(!state.attachments.is_empty());
    let visible_rows = usize::from(area.height.saturating_sub(2));
    let logical_row = attachment_offset + line_index;
    let row_offset = logical_row.saturating_sub(visible_rows.saturating_sub(1));
    let visible_row = logical_row.saturating_sub(row_offset);
    let content_width = area.width.saturating_sub(2);
    let total_column = 2_u16.saturating_add(column);
    let horizontal_scroll = total_column.saturating_sub(content_width.saturating_sub(1));
    let x = area
        .x
        .saturating_add(1)
        .saturating_add(total_column.saturating_sub(horizontal_scroll))
        .min(area.x.saturating_add(area.width.saturating_sub(2)));
    let y = area
        .y
        .saturating_add(1)
        .saturating_add(visible_row.min(u16::MAX as usize) as u16)
        .min(area.y.saturating_add(area.height.saturating_sub(2)));
    Some((x, y))
}

fn composer_scroll(area: Rect, state: &AppState) -> (u16, u16) {
    if area.width < 4 || area.height < 3 {
        return (0, 0);
    }
    let cursor = state.prompt_cursor.min(state.prompt_input.len());
    let before = &state.prompt_input[..cursor];
    let line_index = before.bytes().filter(|byte| *byte == b'\n').count();
    let column = before
        .rsplit_once('\n')
        .map_or(before, |(_, line)| line)
        .cell_width();
    let attachment_offset = usize::from(!state.attachments.is_empty());
    let visible_rows = usize::from(area.height.saturating_sub(2));
    let logical_row = attachment_offset + line_index;
    let vertical = logical_row.saturating_sub(visible_rows.saturating_sub(1));
    let content_width = area.width.saturating_sub(2);
    let horizontal = 2_u16
        .saturating_add(column)
        .saturating_sub(content_width.saturating_sub(1));
    (vertical.min(u16::MAX as usize) as u16, horizontal)
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
        state.attachments = vec![
            AttachmentRecord {
                id: "a1".into(),
                name: "notes.md".into(),
                path: "/tmp/notes.md".into(),
                mime_type: "text/markdown".into(),
                size: 12,
            },
            AttachmentRecord {
                id: "a2".into(),
                name: "more.md".into(),
                path: "/tmp/more.md".into(),
                mime_type: "text/markdown".into(),
                size: 8,
            },
        ];
        let backend = TestBackend::new(60, 8);
        let mut terminal = Terminal::new(backend).expect("terminal");
        terminal
            .draw(|frame| render_composer(frame, frame.area(), &state))
            .expect("render attachments");
        state.focus = FocusArea::Runs;
        assert!(prompt_cursor_position(Rect::new(0, 0, 2, 2), &state).is_none());
    }

    #[test]
    fn work_placeholder_does_not_advertise_code_only_ui() {
        let mut state = AppState::new(initialized_default_capabilities(), Vec::new());
        state.task_mode = crate::state::TaskMode::Work;
        let text = composer_lines(&state)
            .into_iter()
            .flat_map(|line| line.spans)
            .map(|span| span.content.into_owned())
            .collect::<String>();
        assert!(text.contains("$skill"));
        assert!(!text.contains("@mention"));
        assert!(!text.contains("shell"));

        state.task_mode = crate::state::TaskMode::Code;
        let text = composer_lines(&state)
            .into_iter()
            .flat_map(|line| line.spans)
            .map(|span| span.content.into_owned())
            .collect::<String>();
        assert!(text.contains("@mention"));

        state.prompt_input = "before [Pasted text #1] after".to_string();
        state.pasted_blocks.push(crate::state::PastedBlock {
            marker: "[Pasted text #1]".to_string(),
            content: "secret".to_string(),
        });
        let spans = prompt_text_spans(&state, &state.prompt_input);
        assert_eq!(spans.len(), 3);
        assert_eq!(spans[1].content, "[Pasted text #1]");
    }

    #[test]
    fn composer_scroll_and_cursor_follow_multiline_wide_input() {
        let mut state = AppState::new(initialized_default_capabilities(), Vec::new());
        assert_eq!(composer_scroll(Rect::new(0, 0, 3, 2), &state), (0, 0));
        state.prompt_input = "one\ntwo\nthree\nfour".to_string();
        state.prompt_cursor = state.prompt_input.len();
        let area = Rect::new(0, 0, 10, 4);
        assert_eq!(composer_scroll(area, &state), (2, 0));
        assert_eq!(prompt_cursor_position(area, &state), Some((7, 2)));

        state.prompt_input = "界界界界界".to_string();
        state.prompt_cursor = state.prompt_input.len();
        assert_eq!(composer_scroll(area, &state), (0, 5));
        assert_eq!(prompt_cursor_position(area, &state), Some((8, 1)));
    }
}
