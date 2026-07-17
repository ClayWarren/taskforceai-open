use ratatui::style::Style;
use ratatui::text::{Line, Text};
use ratatui::widgets::{Paragraph, Wrap};
use ratatui::Frame;

use crate::state::AppState;

use super::style::{bg, text, text_faint};

pub(super) fn render_raw_output(frame: &mut Frame<'_>, state: &AppState) {
    let mut lines = state
        .copyable_text()
        .lines()
        .map(|line| Line::styled(line.to_string(), Style::default().fg(text())))
        .collect::<Vec<_>>();
    lines.push(Line::raw(""));
    lines.push(Line::styled(
        "Ctrl-R returns to the full interface · use your terminal selection shortcut to copy",
        Style::default().fg(text_faint()),
    ));
    frame.render_widget(
        Paragraph::new(Text::from(lines))
            .style(Style::default().fg(text()).bg(bg()))
            .wrap(Wrap { trim: false }),
        frame.area(),
    );
}

#[cfg(test)]
mod tests {
    use ratatui::backend::TestBackend;
    use ratatui::Terminal;

    use super::*;
    use crate::test_support::initialized_default_capabilities;

    #[test]
    fn raw_output_renders_copyable_multiline_text() {
        let backend = TestBackend::new(80, 12);
        let mut terminal = Terminal::new(backend).expect("terminal");
        let mut state = AppState::new(initialized_default_capabilities(), Vec::new());
        state.command_output = Some("Title\nBody".to_string());
        terminal
            .draw(|frame| render_raw_output(frame, &state))
            .expect("raw output render");
    }
}
