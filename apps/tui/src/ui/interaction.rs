use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Clear, Padding, Paragraph, Wrap};
use ratatui::Frame;

use crate::state::AppState;

use super::style::{panel_block, ACCENT, BG, BORDER_FOCUS, TEXT, TEXT_FAINT, TEXT_MUTED, WARN};

pub(super) fn render_interaction(frame: &mut Frame<'_>, state: &AppState) {
    let Some(interaction) = state.pending_interaction.as_ref() else {
        return;
    };
    let area = centered_rect(frame.area(), 76, interaction_height(interaction));
    frame.render_widget(Clear, area);

    let mut lines = interaction
        .message
        .lines()
        .map(|line| Line::styled(line.to_string(), Style::default().fg(TEXT)))
        .collect::<Vec<_>>();
    lines.push(Line::raw(""));
    for (index, option) in interaction.options.iter().enumerate() {
        let selected = interaction.selected_index == index;
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
                Style::default().fg(WARN),
            ),
            Span::styled(option.label.clone(), style),
        ]));
        if !option.description.is_empty() {
            lines.push(Line::from(vec![
                Span::raw("    "),
                Span::styled(option.description.clone(), Style::default().fg(TEXT_MUTED)),
            ]));
        }
    }
    if interaction.accepts_text() {
        lines.push(Line::raw(""));
        lines.push(Line::from(vec![
            Span::styled(
                "Answer ",
                Style::default().fg(ACCENT).add_modifier(Modifier::BOLD),
            ),
            Span::styled(interaction.input.clone(), Style::default().fg(TEXT)),
            Span::styled("▏", Style::default().fg(BORDER_FOCUS)),
        ]));
    }
    lines.push(Line::raw(""));
    lines.push(Line::styled(
        interaction.method.clone(),
        Style::default().fg(TEXT_FAINT),
    ));
    lines.push(Line::styled(
        "↑/↓ select · Enter confirm · Esc cancel",
        Style::default().fg(TEXT_FAINT),
    ));

    frame.render_widget(
        Paragraph::new(lines)
            .style(Style::default().fg(TEXT).bg(BG))
            .wrap(Wrap { trim: false })
            .block(
                panel_block(format!(" ACTION REQUIRED · {} ", interaction.title), true)
                    .padding(Padding::horizontal(1)),
            ),
        area,
    );
}

fn interaction_height(interaction: &crate::state::PendingInteraction) -> u16 {
    let message_lines = interaction.message.lines().count();
    let option_lines = interaction
        .options
        .iter()
        .map(|option| 1 + usize::from(!option.description.is_empty()))
        .sum::<usize>();
    let input_lines = if interaction.accepts_text() { 2 } else { 0 };
    (message_lines + option_lines + input_lines + 5)
        .clamp(9, 24)
        .try_into()
        .unwrap_or(24)
}

fn centered_rect(area: Rect, width_percent: u16, height: u16) -> Rect {
    let width = area
        .width
        .saturating_mul(width_percent)
        .saturating_div(100)
        .max(30);
    let width = width.min(area.width);
    let height = height.min(area.height);
    let vertical = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(area.height.saturating_sub(height) / 2),
            Constraint::Length(height),
            Constraint::Min(0),
        ])
        .split(area);
    Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Length(area.width.saturating_sub(width) / 2),
            Constraint::Length(width),
            Constraint::Min(0),
        ])
        .split(vertical[1])[1]
}

#[cfg(test)]
mod tests {
    use ratatui::backend::TestBackend;
    use ratatui::Terminal;
    use serde_json::json;
    use taskforceai_app_protocol::{JsonRpcServerRequest, JSONRPC_VERSION};

    use super::*;
    use crate::test_support::initialized_default_capabilities;

    fn request(method: &str, params: serde_json::Value) -> JsonRpcServerRequest {
        JsonRpcServerRequest {
            jsonrpc: JSONRPC_VERSION.to_string(),
            id: json!(1),
            method: method.to_string(),
            params,
        }
    }

    #[test]
    fn interaction_overlay_renders_approval_text_and_empty_states() {
        let backend = TestBackend::new(100, 30);
        let mut terminal = Terminal::new(backend).expect("terminal");
        let mut state = AppState::new(initialized_default_capabilities(), Vec::new());
        terminal
            .draw(|frame| render_interaction(frame, &state))
            .expect("empty interaction render");

        state
            .open_interaction(request(
                "item/commandExecution/requestApproval",
                json!({
                    "threadId":"t", "turnId":"u", "itemId":"i",
                    "reason":"Run tests", "command":["cargo","test"], "cwd":"/workspace"
                }),
            ))
            .expect("approval");
        state.move_interaction_selection(1);
        terminal
            .draw(|frame| render_interaction(frame, &state))
            .expect("approval render");

        state.cancel_interaction();
        state
            .open_interaction(request(
                "item/tool/requestUserInput",
                json!({
                    "threadId":"t", "turnId":"u", "itemId":"i",
                    "questions":[{"id":"note","header":"Note","question":"Line one\nLine two","options":[]}]
                }),
            ))
            .expect("text input");
        state.paste_interaction_input("answer");
        terminal
            .draw(|frame| render_interaction(frame, &state))
            .expect("text interaction render");

        assert_eq!(centered_rect(Rect::new(0, 0, 10, 5), 76, 24).width, 10);
    }
}
